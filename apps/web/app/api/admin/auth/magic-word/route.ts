export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { z } from "zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { getSessionFresh, type SessionRecord } from "@/lib/auth/session";
import { hashAdminMagicWord } from "@/lib/auth/adminMagicWord";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { conflict, forbidden, unauthorized } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp } from "@/lib/security/rateLimit";

const recentGoogle = (session: SessionRecord) => {
  const age = Date.now() - Date.parse(session.created_at);
  return (
    session.authProvider === "google" &&
    !session.impersonatedBy &&
    age >= 0 &&
    age <= 10 * 60_000
  );
};
const respond = (data: unknown) =>
  NextResponse.json(
    { success: true, data, error: null },
    { headers: { "Cache-Control": "no-store" } },
  );
const bodySchema = z.object({
  // Retained for existing credential-based API clients. The UI uses Google.
  password: z.string().min(1).max(1024).optional(),
  userId: z.string().uuid().optional(),
  magicWord: z
    .string()
    .min(6)
    .max(200)
    .refine(
      (value) => value.trim().length >= 6,
      "Use at least six non-space characters",
    ),
});

export const GET = withAdminAuth(async (_req, { auth }) => {
  const session = await getSessionFresh(auth.user.sid);
  if (!session || session.uid !== auth.user.sub)
    throw unauthorized("Session revoked");
  const orm = await getDb();
  const [row] = await orm
    .select({ word: schema.users.adminMagicWordHash })
    .from(schema.users)
    .where(eq(schema.users.id, auth.user.sub))
    .limit(1);
  return respond({
    userId: auth.user.sub,
    isSet: !!row?.word,
    googleReauthRequired: !recentGoogle(session),
  });
});

export const POST = withAdminAuth(async (req, { auth }) => {
  await enforceRateLimit(auth.user.sub, "user", {
    name: "admin:magic-word:save",
    limit: 5,
    windowMs: 15 * 60_000,
    bypassL1: true,
  });
  await enforceRateLimit(getClientIp(req), "ip", {
    name: "admin:magic-word:save:ip",
    limit: 20,
    windowMs: 15 * 60_000,
    bypassL1: true,
  });
  const body = await validateBody(req, bodySchema);
  if (
    (body.password === undefined || body.userId !== undefined) &&
    body.userId !== auth.user.sub
  )
    throw conflict(
      "The signed-in account changed. Refresh before saving.",
      "ACCOUNT_CHANGED",
    );
  const orm = await getDb();
  const [row] = await orm
    .select({
      passwordHash: schema.users.passwordHash,
      word: schema.users.adminMagicWordHash,
    })
    .from(schema.users)
    .where(eq(schema.users.id, auth.user.sub))
    .limit(1);
  if (!row) throw forbidden("Administrator access required");
  const source = await getSessionFresh(auth.user.sid);
  if (!source || source.uid !== auth.user.sub || source.impersonatedBy)
    throw unauthorized("Session revoked");
  if (body.password !== undefined) {
    if (!row.passwordHash || !(await compare(body.password, row.passwordHash)))
      throw forbidden("Current password is incorrect", "INVALID_PASSWORD");
  } else if (!recentGoogle(source)) {
    throw forbidden(
      "Sign in with Google again before saving your Secret Magic Word",
      "GOOGLE_REAUTH_REQUIRED",
    );
  }
  const word = await hashAdminMagicWord(body.magicWord);
  const current = await getSessionFresh(auth.user.sid);
  if (!current || current.uid !== auth.user.sub || current.impersonatedBy)
    throw unauthorized("Session revoked");
  if (body.password === undefined && !recentGoogle(current))
    throw forbidden(
      "Sign in with Google again before saving",
      "GOOGLE_REAUTH_REQUIRED",
    );
  const changed = await orm
    .update(schema.users)
    .set({ adminMagicWordHash: word, updatedAt: new Date() })
    .where(
      and(
        eq(schema.users.id, auth.user.sub),
        eq(schema.users.isAdmin, true),
        isNull(schema.users.deletedAt),
        eq(schema.users.isBanned, false),
        sql`NOT (COALESCE(${schema.users.isSuspended}, false) AND (${schema.users.suspendedUntil} IS NULL OR ${schema.users.suspendedUntil}>NOW()))`,
        sql`${schema.users.sessionValidAfter}<=${current.created_at}::timestamptz`,
        sql`(${schema.users.totpEnabled}=false OR ${current.adminSession === true})`,
        row.word === null
          ? isNull(schema.users.adminMagicWordHash)
          : eq(schema.users.adminMagicWordHash, row.word),
        body.password !== undefined && row.passwordHash
          ? eq(schema.users.passwordHash, row.passwordHash)
          : undefined,
      ),
    )
    .returning({ id: schema.users.id });
  if (!changed.length)
    throw conflict(
      "Security settings changed. Refresh and try again.",
      "SECURITY_SETTINGS_CHANGED",
    );
  return respond({ userId: auth.user.sub, isSet: true });
});
