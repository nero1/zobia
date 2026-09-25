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
 *      OR { newGift: {name, emoji, coinCost, tier, animationUrl?, spectacleThresholdCoins?}, startAt }
 *   - Admin only.
 *   - Exactly one of giftItemId (use an existing gift) or newGift (create a
 *     new gift item inline, then use it) must be provided.
 *   - Validates that the gift item exists and is not already retired.
 *   - Validates that startAt is in the future.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import {
  scheduleMonthlyGiftDrop,
  type MonthlyGiftDrop,
} from "@/lib/events/monthlyGiftDrop";
import { createGiftItem } from "@/lib/economy/giftItems";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const newGiftSchema = z.object({
  name: z.string().min(1).max(100),
  emoji: z.string().min(1).max(10),
  coinCost: z.number().int().positive(),
  tier: z.number().int().min(1).max(5),
  animationUrl: z.string().url().nullable().optional(),
  spectacleThresholdCoins: z.number().int().positive().nullable().optional(),
});

// Exactly one of `giftItemId` (use an existing gift) or `newGift` (create a
// new gift_items row and use it) must be provided.
const scheduleDropSchema = z
  .object({
    giftItemId: z.string().uuid("giftItemId must be a valid UUID").optional(),
    newGift: newGiftSchema.optional(),
    startAt: z.string().datetime("startAt must be a valid ISO 8601 datetime"),
  })
  .refine((body) => Boolean(body.giftItemId) !== Boolean(body.newGift), {
    message: "Provide exactly one of giftItemId or newGift",
    path: ["giftItemId"],
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
    const orm = await getDb();
    const rows = await orm
      .select({
        id: schema.monthlyGiftDrops.id,
        gift_item_id: schema.monthlyGiftDrops.giftItemId,
        title: schema.monthlyGiftDrops.title,
        available_from: schema.monthlyGiftDrops.availableFrom,
        available_until: schema.monthlyGiftDrops.availableUntil,
        announced_at: schema.monthlyGiftDrops.announcedAt,
        is_active: schema.monthlyGiftDrops.isActive,
        created_at: schema.monthlyGiftDrops.createdAt,
        gift_item_name: schema.giftItems.name,
        gift_item_retired: schema.giftItems.isRetired,
      })
      .from(schema.monthlyGiftDrops)
      .leftJoin(schema.giftItems, eq(schema.giftItems.id, schema.monthlyGiftDrops.giftItemId))
      .orderBy(sql`${schema.monthlyGiftDrops.availableFrom} DESC`);

    // Annotate each drop with its status category
    const now = new Date();
    const drops = rows.map((row) => {
      const from = row.available_from;
      const until = row.available_until;

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

    let giftItemId: string;

    const orm = await getDb();

    if (body.newGift) {
      // Create the gift item inline, reusing the same insert logic as
      // POST /api/admin/gifts, then schedule the drop against it.
      const gift = await createGiftItem(body.newGift, orm);
      giftItemId = gift.id;
    } else {
      // The Zod refinement above guarantees giftItemId is set when newGift is not.
      if (!body.giftItemId) {
        throw badRequest("giftItemId is required when newGift is not provided");
      }

      // Validate gift item exists and is not retired
      const [item] = await orm
        .select({ id: schema.giftItems.id, name: schema.giftItems.name, is_retired: schema.giftItems.isRetired })
        .from(schema.giftItems)
        .where(eq(schema.giftItems.id, body.giftItemId))
        .limit(1);

      if (!item) {
        throw badRequest(`Gift item ${body.giftItemId} does not exist`);
      }
      if (item.is_retired) {
        throw badRequest("Cannot schedule a drop for a retired gift item");
      }
      giftItemId = item.id;
    }

    // Check for overlapping active drops
    const windowEnd = new Date(startAt.getTime() + 48 * 60 * 60 * 1000);
    const [overlap] = await orm
      .select({ count: sql<string>`COUNT(*)` })
      .from(schema.monthlyGiftDrops)
      .where(
        sql`${schema.monthlyGiftDrops.isActive} = TRUE
          OR (${schema.monthlyGiftDrops.availableFrom} <= ${windowEnd} AND ${schema.monthlyGiftDrops.availableUntil} >= ${startAt})`
      );

    if (parseInt(overlap?.count ?? "0") > 0) {
      throw badRequest(
        "A gift drop already exists that overlaps this time window"
      );
    }

    const drop: MonthlyGiftDrop = await scheduleMonthlyGiftDrop(
      giftItemId,
      startAt,
      orm
    );

    return NextResponse.json({ drop }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
