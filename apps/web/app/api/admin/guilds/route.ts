export const dynamic = 'force-dynamic';

/**
 * app/api/admin/guilds/route.ts
 *
 * Admin guild management — list all guilds with filtering.
 * Mirrors app/api/admin/rooms/route.ts.
 *
 * GET /api/admin/guilds
 *   Query params:
 *     search   — filter by guild name or captain username
 *     status   — "all" | "active" | "inactive" | "suspended" | "banned"
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

interface AdminGuildRow {
  id: string;
  name: string;
  crest_emoji: string;
  description: string | null;
  city: string | null;
  country: string;
  captain_id: string;
  captain_username: string;
  tier: string;
  member_count: number;
  treasury_balance: string;
  recruitment_type: string;
  is_active: boolean;
  is_suspended: boolean;
  suspension_reason: string | null;
  is_banned: boolean;
  admin_notes: string | null;
  created_at: string;
}

export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

    const { rows: userRows } = await db.query<{ is_admin: boolean; is_moderator: boolean }>(
      `SELECT is_admin, COALESCE(is_moderator, FALSE) AS is_moderator
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [auth.user.sub]
    );
    if (!userRows[0]?.is_admin && !userRows[0]?.is_moderator) {
      throw forbidden("Admin or moderator access required");
    }

    const url = new URL(req.url);
    const search = url.searchParams.get("search")?.trim() ?? "";
    const status = url.searchParams.get("status") ?? "all";
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "30"), 100);
    const cursor = url.searchParams.get("cursor");

    const conditions: string[] = ["g.deleted_at IS NULL"];
    const values: SqlParam[] = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(g.name ILIKE $${paramIdx} OR u.username ILIKE $${paramIdx})`);
      values.push(`%${search}%`);
      paramIdx++;
    }

    if (cursor) {
      conditions.push(`g.created_at < $${paramIdx}::timestamptz`);
      values.push(cursor);
      paramIdx++;
    }

    switch (status) {
      case "active":
        conditions.push("g.is_active = TRUE AND g.is_suspended = FALSE AND g.is_banned = FALSE");
        break;
      case "inactive":
        conditions.push("g.is_active = FALSE AND g.is_banned = FALSE");
        break;
      case "suspended":
        conditions.push("g.is_suspended = TRUE");
        break;
      case "banned":
        conditions.push("g.is_banned = TRUE");
        break;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    values.push(limit + 1);
    const limitParam = paramIdx;

    const { rows } = await db.query<AdminGuildRow>(
      `SELECT
         g.id, g.name, g.crest_emoji, g.description, g.city, g.country,
         g.captain_id, u.username AS captain_username,
         g.tier, g.member_count, g.treasury_balance::text AS treasury_balance,
         g.recruitment_type, g.is_active, g.is_suspended, g.suspension_reason,
         g.is_banned, g.admin_notes, g.created_at
       FROM guilds g
       JOIN users u ON u.id = g.captain_id
       ${where}
       ORDER BY g.created_at DESC
       LIMIT $${limitParam}`,
      values
    );

    const hasNextPage = rows.length > limit;
    const data = hasNextPage ? rows.slice(0, limit) : rows;

    return NextResponse.json({
      success: true,
      data: {
        guilds: data,
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
