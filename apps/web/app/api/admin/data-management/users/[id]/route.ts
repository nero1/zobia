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
import { db } from "@/lib/db";
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

    if (body.email || body.username) {
      const { rows: dupes } = await db.query<{ id: string }>(
        `SELECT id FROM users
         WHERE id != $1 AND (
           ($2::text IS NOT NULL AND email = $2) OR
           ($3::text IS NOT NULL AND username = $3)
         ) LIMIT 1`,
        [id, body.email ?? null, body.username ?? null]
      );
      if (dupes[0]) throw conflict("Another user already has that email or username.");
    }

    const updates: string[] = [];
    const values: (string | boolean | null)[] = [id];
    let idx = 2;
    const set = (col: string, val: string | boolean | null | undefined) => {
      if (val === undefined) return;
      updates.push(`${col} = $${idx++}`);
      values.push(val);
    };
    set("display_name", body.displayName);
    set("bio", body.bio);
    set("city", body.city);
    set("country", body.country);
    set("plan", body.plan);
    set("is_verified", body.isVerified);
    set("email", body.email);
    set("username", body.username);

    if (updates.length === 0) throw badRequest("No fields to update.");
    updates.push("updated_at = NOW()");

    const { rows } = await db.query<{ id: string; username: string; email: string | null; display_name: string | null }>(
      `UPDATE users SET ${updates.join(", ")} WHERE id = $1 AND deleted_at IS NULL
       RETURNING id, username, email, display_name`,
      values
    );
    if (!rows[0]) throw notFound("User not found");

    writeAuditLog({
      actorId: auth.user.sub,
      action: "admin_edit_user",
      targetId: id,
      metadata: { fields: Object.keys(body) },
    });

    return NextResponse.json({ user: rows[0] }, { status: 200 });
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

    const { rows } = await db.query<{ id: string; username: string; is_admin: boolean }>(
      `SELECT id, username, is_admin FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [id]
    );
    const target = rows[0];
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
