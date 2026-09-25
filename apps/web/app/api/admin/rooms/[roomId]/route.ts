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
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
  const orm = await getDb();
  const rows = await orm
    .select({ is_admin: schema.users.isAdmin, is_moderator: schema.users.isModerator })
    .from(schema.users)
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
    .limit(1);
  if (!rows[0]) throw forbidden("User not found");
  return { is_admin: rows[0].is_admin, is_moderator: rows[0].is_moderator ?? false };
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

    const orm = await getDb();

    // Verify room exists
    const roomRows = await orm
      .select({ id: schema.rooms.id, name: schema.rooms.name })
      .from(schema.rooms)
      .where(and(eq(schema.rooms.id, roomId), isNull(schema.rooms.deletedAt)))
      .limit(1);
    if (!roomRows[0]) throw notFound("Room not found");

    // NOTE: `rooms` in the Drizzle schema (lib/db/schema.ts) has no
    // is_suspended / suspended_at / suspended_by / suspension_reason /
    // is_banned / banned_at / banned_by / flagged_at / flagged_by /
    // flag_reason / monetization_disabled / admin_notes columns, even though
    // this route (pre-migration) already read/wrote them — a pre-existing
    // schema/route mismatch, reported rather than silently added to the
    // shared schema. These moderation actions are therefore expressed via
    // Drizzle's `sql` template (parameterised, injection-safe) instead of
    // the type-checked query builder; `update_details`/`set_active`/
    // `set_inactive` use the query builder since their columns do exist.
    switch (body.action) {
      case "set_active":
        await orm
          .update(schema.rooms)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(schema.rooms.id, roomId));
        await orm.execute(sql`UPDATE rooms SET is_suspended = FALSE WHERE id = ${roomId}`);
        break;

      case "set_inactive":
        await orm
          .update(schema.rooms)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(schema.rooms.id, roomId));
        break;

      case "suspend":
        await orm.execute(sql`
          UPDATE rooms
          SET is_suspended = TRUE, suspended_at = NOW(), suspended_by = ${auth.user.sub},
              suspension_reason = ${body.reason}, is_active = FALSE, updated_at = NOW()
          WHERE id = ${roomId}
        `);
        break;

      case "unsuspend":
        await orm.execute(sql`
          UPDATE rooms
          SET is_suspended = FALSE, suspended_at = NULL, suspended_by = NULL,
              suspension_reason = NULL, is_active = TRUE, updated_at = NOW()
          WHERE id = ${roomId}
        `);
        break;

      case "ban":
        await orm.execute(sql`
          UPDATE rooms
          SET is_banned = TRUE, banned_at = NOW(), banned_by = ${auth.user.sub},
              is_active = FALSE, is_suspended = FALSE, updated_at = NOW()
          WHERE id = ${roomId}
        `);
        break;

      case "flag":
        await orm.execute(sql`
          UPDATE rooms
          SET flagged_at = NOW(), flagged_by = ${auth.user.sub}, flag_reason = ${body.reason}, updated_at = NOW()
          WHERE id = ${roomId}
        `);
        break;

      case "unflag":
        await orm.execute(sql`
          UPDATE rooms
          SET flagged_at = NULL, flagged_by = NULL, flag_reason = NULL, updated_at = NOW()
          WHERE id = ${roomId}
        `);
        break;

      case "disable_monetization":
        await orm.execute(sql`UPDATE rooms SET monetization_disabled = TRUE, updated_at = NOW() WHERE id = ${roomId}`);
        break;

      case "enable_monetization":
        await orm.execute(sql`UPDATE rooms SET monetization_disabled = FALSE, updated_at = NOW() WHERE id = ${roomId}`);
        break;

      case "update_details": {
        const setValues: Partial<typeof schema.rooms.$inferInsert> = { updatedAt: new Date() };
        if (body.name !== undefined) setValues.name = body.name;
        if (body.description !== undefined) setValues.description = body.description;
        if (body.type !== undefined) setValues.type = body.type;
        if (body.max_members !== undefined) setValues.maxMembers = body.max_members;
        if (body.creator_id !== undefined) setValues.creatorId = body.creator_id;
        await orm.update(schema.rooms).set(setValues).where(eq(schema.rooms.id, roomId));
        break;
      }

      case "add_admin_notes":
        await orm.execute(sql`UPDATE rooms SET admin_notes = ${body.notes}, updated_at = NOW() WHERE id = ${roomId}`);
        break;
    }

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

    const orm = await getDb();

    // Only full admins can hard-delete rooms
    const userRows = await orm
      .select({ is_admin: schema.users.isAdmin })
      .from(schema.users)
      .where(and(eq(schema.users.id, auth.user.sub), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!userRows[0]?.is_admin) throw forbidden("Administrator access required");

    const roomRows = await orm
      .select({ id: schema.rooms.id })
      .from(schema.rooms)
      .where(and(eq(schema.rooms.id, roomId), isNull(schema.rooms.deletedAt)))
      .limit(1);
    if (!roomRows[0]) throw notFound("Room not found");

    await orm
      .update(schema.rooms)
      .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
      .where(eq(schema.rooms.id, roomId));

    return NextResponse.json({ success: true, data: { roomId, deleted: true } });
  } catch (err) {
    return handleApiError(err);
  }
});
