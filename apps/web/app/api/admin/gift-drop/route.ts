export const dynamic = 'force-dynamic';

/**
 * app/api/admin/gift-drop/route.ts
 *
 * Admin endpoints for Monthly Mystery Gift Drops.
 *
 * GET  /api/admin/gift-drop
 *   List all gift drops: active, upcoming, and past.
 *   Sorted by available_from DESC.
 *
 * POST /api/admin/gift-drop
 *   Schedule a new gift drop.
 *   Body: { giftItemId: string, startAt: string (ISO 8601) }
 *   - Admin only.
 *   - Validates that the gift item exists and is not already retired.
 *   - Validates that startAt is in the future.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import {
  scheduleMonthlyGiftDrop,
  type MonthlyGiftDrop,
} from "@/lib/events/monthlyGiftDrop";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const scheduleDropSchema = z.object({
  giftItemId: z.string().uuid("giftItemId must be a valid UUID"),
  startAt: z.string().datetime("startAt must be a valid ISO 8601 datetime"),
});

// ---------------------------------------------------------------------------
// DB row type for list
// ---------------------------------------------------------------------------

interface GiftDropRow {
  id: string;
  gift_item_id: string;
  title: string;
  available_from: string;
  available_until: string;
  announced_at: string | null;
  is_active: boolean;
  created_at: string;
  gift_item_name: string | null;
  gift_item_retired: boolean | null;
}

// ---------------------------------------------------------------------------
// GET /api/admin/gift-drop
// ---------------------------------------------------------------------------

/**
 * List all gift drops with their underlying gift item name and retired status.
 *
 * @returns JSON { drops: GiftDropRow[] }
 */
export const GET = withAdminAuth(async (_req: NextRequest) => {
  try {
    const { rows } = await db.query<GiftDropRow>(
      `SELECT
         mgd.id,
         mgd.gift_item_id,
         mgd.title,
         mgd.available_from,
         mgd.available_until,
         mgd.announced_at,
         mgd.is_active,
         mgd.created_at,
         gi.name  AS gift_item_name,
         gi.is_retired AS gift_item_retired
       FROM monthly_gift_drops mgd
       LEFT JOIN gift_items gi ON gi.id = mgd.gift_item_id
       ORDER BY mgd.available_from DESC`
    );

    // Annotate each drop with its status category
    const now = new Date();
    const drops = rows.map((row) => {
      const from = new Date(row.available_from);
      const until = new Date(row.available_until);

      let status: "active" | "upcoming" | "past" | "scheduled";
      if (row.is_active && from <= now && until > now) {
        status = "active";
      } else if (!row.is_active && from > now) {
        status = from.getTime() - now.getTime() <= 24 * 60 * 60 * 1000
          ? "upcoming"
          : "scheduled";
      } else {
        status = "past";
      }

      return { ...row, status };
    });

    return NextResponse.json({ drops }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/gift-drop
// ---------------------------------------------------------------------------

/**
 * Schedule a new monthly gift drop.
 *
 * Validates:
 *  - giftItemId points to an existing, non-retired gift item.
 *  - startAt is in the future.
 *
 * @returns JSON { drop: MonthlyGiftDrop }
 */
export const POST = withAdminAuth(async (req: NextRequest) => {
  try {
    const body = await validateBody(req, scheduleDropSchema);

    const startAt = new Date(body.startAt);
    if (startAt <= new Date()) {
      throw badRequest("startAt must be in the future");
    }

    // Validate gift item exists and is not retired
    const { rows: itemRows } = await db.query<{
      id: string;
      name: string;
      is_retired: boolean;
    }>(
      `SELECT id, name, is_retired FROM gift_items WHERE id = $1 LIMIT 1`,
      [body.giftItemId]
    );

    if (!itemRows[0]) {
      throw badRequest(`Gift item ${body.giftItemId} does not exist`);
    }
    if (itemRows[0].is_retired) {
      throw badRequest("Cannot schedule a drop for a retired gift item");
    }

    // Check for overlapping active drops
    const { rows: overlap } = await db.query<{ count: string }>(
      `SELECT COUNT(*) AS count
       FROM monthly_gift_drops
       WHERE is_active = TRUE
         OR (available_from <= $2 AND available_until >= $1)`,
      [startAt.toISOString(), new Date(startAt.getTime() + 48 * 60 * 60 * 1000).toISOString()]
    );

    if (parseInt(overlap[0]?.count ?? "0") > 0) {
      throw badRequest(
        "A gift drop already exists that overlaps this time window"
      );
    }

    const drop: MonthlyGiftDrop = await scheduleMonthlyGiftDrop(
      body.giftItemId,
      startAt,
      db
    );

    return NextResponse.json({ drop }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
