export const dynamic = 'force-dynamic';

/**
 * app/api/admin/rooms/route.ts
 *
 * Admin room management — list all rooms with filtering.
 *
 * GET /api/admin/rooms
 *   Query params:
 *     search   — filter by room name or creator username
 *     status   — "all" | "active" | "inactive" | "suspended" | "banned" | "flagged"
 *     type     — room type filter
 *     limit    — page size (default 30, max 100)
 *     cursor   — pagination cursor (created_at ISO string)
 *
 * Admin and moderators only.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { SqlParam } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

interface AdminRoomRow {
  id: string;
  name: string;
  description: string | null;
  type: string;
  cover_emoji: string;
  creator_id: string;
  creator_username: string;
  member_count: number;
  is_active: boolean;
  is_suspended: boolean;
  suspension_reason: string | null;
  is_banned: boolean;
  flagged_at: string | null;
  flag_reason: string | null;
  monetization_disabled: boolean;
  admin_notes: string | null;
  created_at: string;
}

export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    // Require admin or moderator
    const { rows: userRows } = await db.query<{ is_admin: boolean; is_moderator: boolean }>(
      `SELECT is_admin, COALESCE(is_moderator, FALSE) AS is_moderator
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [auth.user.sub]
    );
    if (!userRows[0]?.is_admin && !userRows[0]?.is_moderator) {
      throw forbidden("Admin or moderator access required");
    }

    const url = new URL(req.url);
    const search  = url.searchParams.get("search")?.trim() ?? "";
    const status  = url.searchParams.get("status") ?? "all";
    const type    = url.searchParams.get("type") ?? "";
    const limit   = Math.min(Number(url.searchParams.get("limit") ?? "30"), 100);
    const cursor  = url.searchParams.get("cursor");

    const conditions: string[] = ["r.deleted_at IS NULL"];
    const values: SqlParam[] = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(r.name ILIKE $${paramIdx} OR u.username ILIKE $${paramIdx})`);
      values.push(`%${search}%`);
      paramIdx++;
    }

    if (type) {
      conditions.push(`r.type = $${paramIdx}`);
      values.push(type);
      paramIdx++;
    }

    if (cursor) {
      conditions.push(`r.created_at < $${paramIdx}::timestamptz`);
      values.push(cursor);
      paramIdx++;
    }

    switch (status) {
      case "active":
        conditions.push("r.is_active = TRUE AND COALESCE(r.is_suspended, FALSE) = FALSE AND COALESCE(r.is_banned, FALSE) = FALSE");
        break;
      case "inactive":
        conditions.push("r.is_active = FALSE AND COALESCE(r.is_banned, FALSE) = FALSE");
        break;
      case "suspended":
        conditions.push("COALESCE(r.is_suspended, FALSE) = TRUE");
        break;
      case "banned":
        conditions.push("COALESCE(r.is_banned, FALSE) = TRUE");
        break;
      case "flagged":
        conditions.push("r.flagged_at IS NOT NULL");
        break;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    values.push(limit + 1);
    const limitParam = paramIdx;

    const { rows } = await db.query<AdminRoomRow>(
      `SELECT
         r.id,
         r.name,
         r.description,
         r.type,
         r.cover_emoji,
         r.creator_id,
         u.username                                   AS creator_username,
         r.member_count,
         r.is_active,
         COALESCE(r.is_suspended, FALSE)              AS is_suspended,
         r.suspension_reason,
         COALESCE(r.is_banned, FALSE)                 AS is_banned,
         r.flagged_at,
         r.flag_reason,
         COALESCE(r.monetization_disabled, FALSE)     AS monetization_disabled,
         r.admin_notes,
         r.created_at
       FROM rooms r
       JOIN users u ON u.id = r.creator_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${limitParam}`,
      values
    );

    const hasNextPage = rows.length > limit;
    const data = hasNextPage ? rows.slice(0, limit) : rows;

    return NextResponse.json({
      success: true,
      data: {
        rooms: data,
        pagination: {
          hasNextPage,
          nextCursor: hasNextPage ? data[data.length - 1]?.created_at ?? null : null,
        },
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
});
