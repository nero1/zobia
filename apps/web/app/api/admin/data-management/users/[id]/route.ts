export const dynamic = 'force-dynamic';

/**
 * PATCH  /api/admin/data-management/users/:id — edit an allowlist of safe
 *   fields (displayName, bio, city, country, plan, isVerified, email,
 *   username — email/username uniqueness validated like the OAuth route).
 * DELETE /api/admin/data-management/users/:id — soft-delete via the shared
 *   lib/users/anonymizeAccount.ts helper. Refuses to delete another admin
 *   (mirrors the guard in app/api/admin/users/[userId]/impersonate/route.ts).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, conflict, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";
import { anonymizeUserAccount } from "@/lib/users/anonymizeAccount";

const paramsSchema = z.object({ id: z.string().uuid() });

const patchSchema = z.object({
  displayName: z.string().min(1).max(50).optional(),
  bio: z.string().max(300).nullable().optional(),
  city: z.string().max(100).nullable().optional(),
  country: z.string().max(10).nullable().optional(),
  plan: z.enum(["free", "plus", "pro", "max"]).optional(),
  isVerified: z.boolean().optional(),
  email: z.string().email().optional(),
  username: z.string().min(3).max(30).regex(/^[a-z0-9_]+$/i).optional(),
});

export const PATCH = withAdminAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { id } = paramsSchema.parse(params);
    const body = await validateBody(req, patchSchema);

    const orm = await getDb();
    const u = schema.users;

    if (body.email || body.username) {
      const [dupe] = await orm
        .select({ id: u.id })
        .from(u)
        .where(
          and(
            ne(u.id, id),
            or(
              body.email ? eq(u.email, body.email) : sql`false`,
              body.username ? eq(u.username, body.username) : sql`false`
            )
          )
        )
        .limit(1);
      if (dupe) throw conflict("Another user already has that email or username.");
    }

    const updates: Partial<typeof schema.users.$inferInsert> = {};
    if (body.displayName !== undefined) updates.displayName = body.displayName;
    if (body.bio !== undefined) updates.bio = body.bio;
    if (body.city !== undefined) updates.city = body.city;
    if (body.country !== undefined) updates.country = body.country;
    if (body.plan !== undefined) updates.plan = body.plan;
    if (body.isVerified !== undefined) updates.isVerified = body.isVerified;
    if (body.email !== undefined) updates.email = body.email;
    if (body.username !== undefined) updates.username = body.username;

    if (Object.keys(updates).length === 0) throw badRequest("No fields to update.");
    updates.updatedAt = new Date();

    const [updated] = await orm
      .update(u)
      .set(updates)
      .where(and(eq(u.id, id), isNull(u.deletedAt)))
      .returning({ id: u.id, username: u.username, email: u.email, display_name: u.displayName });
    if (!updated) throw notFound("User not found");

    writeAuditLog({
      actorId: auth.user.sub,
      action: "admin_edit_user",
      targetId: id,
      metadata: { fields: Object.keys(body) },
    });

    return NextResponse.json({ user: updated }, { status: 200 });
  } catch (err) {
    if (err instanceof z.ZodError) return handleApiError(badRequest("Invalid request", { issues: err.issues }));
    const pgErr = err as { code?: string };
    if (pgErr.code === "23505") return handleApiError(conflict("Another user already has that email or username."));
    return handleApiError(err);
  }
});

export const DELETE = withAdminAuth<{ id: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const { id } = paramsSchema.parse(params);

    const orm = await getDb();
    const u = schema.users;

    const [target] = await orm
      .select({ id: u.id, username: u.username, is_admin: u.isAdmin })
      .from(u)
      .where(and(eq(u.id, id), isNull(u.deletedAt)))
      .limit(1);
    if (!target) throw notFound("User not found");
    // Privilege-escalation / lockout guard, mirrors
    // app/api/admin/users/[userId]/impersonate/route.ts.
    if (target.is_admin) throw forbidden("Cannot delete another admin account.");

    await anonymizeUserAccount(id, { reason: "admin_delete" });

    writeAuditLog({
      actorId: auth.user.sub,
      action: "admin_delete_user",
      targetId: id,
      metadata: { username: target.username },
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    if (err instanceof z.ZodError) return handleApiError(badRequest("Invalid user id"));
    return handleApiError(err);
  }
});
