export const dynamic = 'force-dynamic';

/**
 * app/api/admin/rooms/[roomId]/route.ts
 *
 * Admin room management — per-room actions.
 *
 * PATCH /api/admin/rooms/:roomId
 *   Body: { action, ...actionFields }
 *   Actions:
 *     set_active       — activate room
 *     set_inactive     — deactivate room
 *     suspend          — suspend room (requires reason)
 *     unsuspend        — clear suspension
 *     ban              — ban room
 *     flag             — flag room for review (requires reason)
 *     unflag           — clear flag
 *     disable_monetization
 *     enable_monetization
 *     update_details   — edit name, description, type, max_members
 *     add_admin_notes  — set admin notes
 *
 * DELETE /api/admin/rooms/:roomId
 *   Hard-delete (soft: sets deleted_at). Admin only.
 *
 * Admin and moderators only (some actions admin-only).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, forbidden, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const patchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_active") }),
  z.object({ action: z.literal("set_inactive") }),
  z.object({ action: z.literal("suspend"),   reason: z.string().min(3).max(500) }),
  z.object({ action: z.literal("unsuspend") }),
  z.object({ action: z.literal("ban") }),
  z.object({ action: z.literal("flag"),      reason: z.string().min(3).max(500) }),
  z.object({ action: z.literal("unflag") }),
  z.object({ action: z.literal("disable_monetization") }),
  z.object({ action: z.literal("enable_monetization") }),
  z.object({
    action:      z.literal("update_details"),
    name:        z.string().min(2).max(80).optional(),
    description: z.string().max(500).optional(),
    type:        z.enum(["free_open","vip","drop","tipping","classroom","guild"]).optional(),
    max_members: z.number().int().positive().max(10000).optional(),
    creator_id:  z.string().uuid().optional(),
  }),
  z.object({ action: z.literal("add_admin_notes"), notes: z.string().max(2000) }),
]);

interface RoomCtx {
  params: Promise<{ roomId: string }>;
  auth: { user: { sub: string } };
}

async function requireAdminOrMod(userId: string) {
  const { rows } = await db.query<{ is_admin: boolean; is_moderator: boolean }>(
    `SELECT is_admin, COALESCE(is_moderator, FALSE) AS is_moderator
     FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  if (!rows[0]) throw forbidden("User not found");
  return rows[0];
}

export const PATCH = withAuth(async (req: NextRequest, { params, auth }: RoomCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { roomId } = await params;
    if (!UUID_RE.test(roomId)) throw badRequest("roomId must be a valid UUID");

    const roles = await requireAdminOrMod(auth.user.sub);
    if (!roles.is_admin && !roles.is_moderator) throw forbidden("Admin or moderator access required");

    const body = await validateBody(req, patchSchema);

    // Some destructive actions require full admin
    const adminOnlyActions = ["ban", "add_admin_notes"];
    if (adminOnlyActions.includes(body.action) && !roles.is_admin) {
      throw forbidden("Administrator access required for this action");
    }

    // Verify room exists
    const { rows: roomRows } = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM rooms WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [roomId]
    );
    if (!roomRows[0]) throw notFound("Room not found");

    let updateSql = "";
    const updateValues: unknown[] = [];

    switch (body.action) {
      case "set_active":
        updateSql = `is_active = TRUE, is_suspended = FALSE, updated_at = NOW()`;
        break;

      case "set_inactive":
        updateSql = `is_active = FALSE, updated_at = NOW()`;
        break;

      case "suspend":
        updateSql = `is_suspended = TRUE, suspended_at = NOW(), suspended_by = $2, suspension_reason = $3, is_active = FALSE, updated_at = NOW()`;
        updateValues.push(auth.user.sub, body.reason);
        break;

      case "unsuspend":
        updateSql = `is_suspended = FALSE, suspended_at = NULL, suspended_by = NULL, suspension_reason = NULL, is_active = TRUE, updated_at = NOW()`;
        break;

      case "ban":
        updateSql = `is_banned = TRUE, banned_at = NOW(), banned_by = $2, is_active = FALSE, is_suspended = FALSE, updated_at = NOW()`;
        updateValues.push(auth.user.sub);
        break;

      case "flag":
        updateSql = `flagged_at = NOW(), flagged_by = $2, flag_reason = $3, updated_at = NOW()`;
        updateValues.push(auth.user.sub, body.reason);
        break;

      case "unflag":
        updateSql = `flagged_at = NULL, flagged_by = NULL, flag_reason = NULL, updated_at = NOW()`;
        break;

      case "disable_monetization":
        updateSql = `monetization_disabled = TRUE, updated_at = NOW()`;
        break;

      case "enable_monetization":
        updateSql = `monetization_disabled = FALSE, updated_at = NOW()`;
        break;

      case "update_details": {
        const setParts: string[] = ["updated_at = NOW()"];
        let idx = 2;
        if (body.name !== undefined)        { setParts.push(`name = $${idx++}`);        updateValues.push(body.name); }
        if (body.description !== undefined) { setParts.push(`description = $${idx++}`); updateValues.push(body.description); }
        if (body.type !== undefined)        { setParts.push(`type = $${idx++}`);        updateValues.push(body.type); }
        if (body.max_members !== undefined) { setParts.push(`max_members = $${idx++}`); updateValues.push(body.max_members); }
        if (body.creator_id !== undefined)  { setParts.push(`creator_id = $${idx++}`); updateValues.push(body.creator_id); }
        updateSql = setParts.join(", ");
        break;
      }

      case "add_admin_notes":
        updateSql = `admin_notes = $2, updated_at = NOW()`;
        updateValues.push(body.notes);
        break;
    }

    // Build parameterised query: $1 is always roomId
    const allValues = [roomId, ...updateValues];
    await db.query(`UPDATE rooms SET ${updateSql} WHERE id = $1`, allValues);

    return NextResponse.json({ success: true, data: { roomId, action: body.action } });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (req: NextRequest, { params, auth }: RoomCtx) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { roomId } = await params;
    if (!UUID_RE.test(roomId)) throw badRequest("roomId must be a valid UUID");

    // Only full admins can hard-delete rooms
    const { rows: userRows } = await db.query<{ is_admin: boolean }>(
      `SELECT is_admin FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [auth.user.sub]
    );
    if (!userRows[0]?.is_admin) throw forbidden("Administrator access required");

    const { rows: roomRows } = await db.query<{ id: string }>(
      `SELECT id FROM rooms WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [roomId]
    );
    if (!roomRows[0]) throw notFound("Room not found");

    await db.query(
      `UPDATE rooms SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [roomId]
    );

    return NextResponse.json({ success: true, data: { roomId, deleted: true } });
  } catch (err) {
    return handleApiError(err);
  }
});
