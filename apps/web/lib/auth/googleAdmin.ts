import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { getSessionFresh, createSession } from "./session";
import { generateTotpSecret, verifyTotp } from "./totp";
import { encryptField, decryptField } from "@/lib/security/fieldEncryption";
import { redis } from "@/lib/redis";
import {
  badRequest,
  conflict,
  forbidden,
  unauthorized,
} from "@/lib/api/errors";

async function authority(userId: string, sid: string) {
  const session = await getSessionFresh(sid);
  if (!session || session.uid !== userId || session.impersonatedBy)
    throw unauthorized("A current Google sign-in is required");
  const db = await getDb();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(
      and(
        eq(schema.users.id, userId),
        eq(schema.users.isAdmin, true),
        isNull(schema.users.deletedAt),
        eq(schema.users.isBanned, false),
        sql`NOT(COALESCE(${schema.users.isSuspended},false) AND (${schema.users.suspendedUntil} IS NULL OR ${schema.users.suspendedUntil}>NOW()))`,
        sql`${schema.users.sessionValidAfter}<=${session.created_at}::timestamptz`,
      ),
    )
    .limit(1);
  if (!user) throw forbidden("This account does not have administrator access");
  return { db, user, session };
}
export async function googleAdminStatus(userId: string, sid: string) {
  const { user, session } = await authority(userId, sid);
  const policy = { userId, twoFaEnabled: user.totpEnabled, magicWordSet: !!user.adminMagicWordHash };
  if (!user.totpEnabled) return { state: "authorized" as const, ...policy };
  if (
    session.authProvider !== "google" ||
    (!session.adminSession &&
      Date.now() - Date.parse(session.created_at) > 15 * 60 * 1000)
  )
    return { state: "google_required" as const, ...policy };
  if (session.adminSession && user.totpEnabled)
    return { state: "authorized" as const, ...policy };
  return {
    ...policy,
    state: user.totpEnabled
      ? ("verify_required" as const)
      : ("setup_required" as const),
  };
}
const pendingKey = (sid: string) => `admin:google:totp:${sid}`;
export async function googleAdminStep(
  userId: string,
  sid: string,
  action: "setup" | "enroll" | "verify",
  code?: string,
) {
  const { db, user, session } = await authority(userId, sid);
  if (
    session.authProvider !== "google" ||
    (!session.adminSession &&
      Date.now() - Date.parse(session.created_at) > 15 * 60 * 1000)
  )
    throw forbidden(
      "Continue with Google before administrator verification",
      "GOOGLE_ADMIN_REQUIRED",
    );
  if (action === "setup") {
    if (user.totpEnabled)
      throw conflict("An authenticator is already configured");
    const key = pendingKey(sid);
    let secret: string;
    const existing = await redis.get(key);
    if (existing) {
      const plain = decryptField(existing);
      if (!plain) throw badRequest("Restart authenticator setup");
      secret = plain;
    } else {
      secret = generateTotpSecret();
      const created = await redis.set(
        key,
        encryptField(secret),
        "EX",
        600,
        "NX",
      );
      if (created === null) {
        const winner = await redis.get(key);
        const plain = winner ? decryptField(winner) : null;
        if (!plain) throw conflict("Restart authenticator setup");
        secret = plain;
      }
    }
    const label = encodeURIComponent(`Zobia:${user.email ?? user.username}`);
    return {
      state: "setup_required" as const,
      secret,
      otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=Zobia&algorithm=SHA1&digits=6&period=30`,
    };
  }
  if (!code || !/^\d{6}$/.test(code))
    throw badRequest("Enter the six-digit authenticator code");
  const stored =
    action === "enroll" ? await redis.get(pendingKey(sid)) : user.totpSecret;
  if (action === "enroll" && user.totpEnabled)
    throw conflict("An authenticator is already configured");
  if (action === "verify" && !user.totpEnabled)
    throw badRequest("Set up an authenticator first");
  const secret = stored ? decryptField(stored) : null;
  if (!secret || !verifyTotp(secret, code))
    throw badRequest(
      "Invalid or expired authenticator code",
      "TOTP_INVALID_CODE",
    );
  if (
    (await redis.set(`totp:used:${userId}:${code}`, "1", "EX", 90, "NX")) ===
    null
  )
    throw badRequest(
      "This code was already used. Wait for the next code.",
      "TOTP_REPLAY",
    );
  if (action === "enroll") {
    const changed = await db
      .update(schema.users)
      .set({
        totpEnabled: true,
        totpSecret: encryptField(secret),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.users.id, userId),
          eq(schema.users.isAdmin, true),
          eq(schema.users.totpEnabled, false),
          eq(schema.users.isBanned, false),
          isNull(schema.users.deletedAt),
          sql`${schema.users.sessionValidAfter}<=${session.created_at}::timestamptz`,
          sql`NOT(COALESCE(${schema.users.isSuspended},false) AND (${schema.users.suspendedUntil} IS NULL OR ${schema.users.suspendedUntil}>NOW()))`,
        ),
      )
      .returning({ id: schema.users.id });
    if (!changed.length)
      throw conflict("Security settings changed. Restart verification");
    await redis.del(pendingKey(sid));
  }
  // New authenticated SID after the factor proof; never promote the old
  // Google token, which may still be held by another browser/device.
  const current = await authority(userId, sid);
  if (
    !current.user.totpEnabled ||
    decryptField(current.user.totpSecret ?? "") !== secret
  )
    throw conflict("Security settings changed. Restart verification");
  const tokens = await createSession(
    {
      id: user.id,
      email: user.email,
      username: user.username,
      is_admin: true,
      is_moderator: user.isModerator ?? false,
      is_creator: user.isCreator ?? false,
      onboarding_completed: user.onboardingCompleted ?? false,
    },
    {
      adminSession: true,
      authProvider: "google",
      verifiedGoogleSourceSid: sid,
      ip: session.ip,
      ua: session.ua,
    },
  );
  return { state: "authorized" as const, tokens };
}
