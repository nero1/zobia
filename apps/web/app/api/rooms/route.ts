/**
 * app/api/rooms/route.ts
 *
 * Room discovery and creation endpoints.
 *
 * GET /api/rooms
 *   Discovery feed for public rooms.
 *   Query params:
 *     - city        Filter by city slug
 *     - category    Room category (education, entertainment, business, …)
 *     - type        Room type (free_open | vip | drop | tipping | classroom | guild)
 *     - trending    "1" to sort by trending score (activity last 2 hrs weighted)
 *     - friends_in_room  "1" to filter to rooms where the caller's followees are members
 *     - cursor      Pagination cursor (opaque string)
 *     - limit       Page size (default 20, max 50)
 *
 * POST /api/rooms
 *   Create a new room. Requires creator role or Rising+ creator tier.
 *   Validates room type and pricing constraints from x_manifest.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";
import { meetsMinimumTrust } from "@/lib/trust/trustScore";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum members in a free_open room. */
const FREE_OPEN_MAX_MEMBERS = 10_000;

/** Creator tiers that are allowed to create rooms (ordered ascending). */
const CREATOR_TIERS_ALLOWED = ["Rising", "Verified", "Pro", "Elite"] as const;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const listRoomsQuerySchema = z.object({
  city: z.string().optional(),
  category: z.string().optional(),
  type: z
    .enum(["free_open", "vip", "drop", "tipping", "classroom", "guild"])
    .optional(),
  trending: z
    .string()
    .optional()
    .transform((v) => v === "1"),
  friends_in_room: z
    .string()
    .optional()
    .transform((v) => v === "1"),
  cursor: z.string().optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(parseInt(v, 10), 50) : 20)),
});

const createRoomSchema = z.object({
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(80, "Name cannot exceed 80 characters"),
  description: z.string().max(500, "Description cannot exceed 500 characters").optional(),
  type: z.enum(["free_open", "vip", "drop", "tipping", "classroom", "guild"]),
  category: z.string().min(1).max(50),
  city: z.string().max(100).optional(),
  coverEmoji: z.string().max(10).default("💬"),
  coverImageUrl: z.string().url().optional(),
  /** Monthly subscription price in Naira for VIP rooms (₦200–₦10,000). */
  subscriptionPriceNgn: z.number().int().min(200).max(10_000).optional(),
  /** One-time entry fee in Naira for Drop rooms. */
  entryFeeNgn: z.number().int().min(50).optional(),
  /** Drop room session duration in minutes (30–1440). */
  dropDurationMinutes: z.number().int().min(30).max(1440).optional(),
  /** Drop room scheduled start time (ISO 8601). */
  dropStartsAt: z.string().datetime().optional(),
  /** Classroom enrolment fee in Naira. 0 = free. */
  enrolmentFeeNgn: z.number().int().min(0).optional(),
  /** Classroom curriculum JSON (array of lesson objects). */
  curriculum: z
    .array(
      z.object({
        title: z.string().max(200),
        description: z.string().max(1000).optional(),
        order: z.number().int().min(0),
      })
    )
    .max(100)
    .optional(),
  /** Classroom start date (ISO 8601 date). */
  classStartDate: z.string().optional(),
  /** Classroom end date (ISO 8601 date). */
  classEndDate: z.string().optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface RoomRow {
  id: string;
  name: string;
  description: string | null;
  type: string;
  category: string;
  city: string | null;
  cover_emoji: string;
  cover_image_url: string | null;
  creator_id: string;
  creator_username: string;
  creator_avatar_emoji: string;
  creator_tier: string | null;
  member_count: number;
  max_members: number;
  is_active: boolean;
  subscription_price_ngn: number | null;
  entry_fee_ngn: number | null;
  drop_starts_at: string | null;
  drop_ends_at: string | null;
  enrolment_fee_ngn: number | null;
  trending_score: number;
  recent_message_count: number;
  total_messages: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a trending score expression for SQL ORDER BY.
 *
 * Weights message activity in last 2 hours, member count, and featured flag.
 */
function buildTrendingOrderClause(): string {
  return `
    (
      COALESCE(
        (SELECT COUNT(*) FROM room_messages rm
         WHERE rm.room_id = r.id
           AND rm.created_at > NOW() - INTERVAL '2 hours'),
        0
      ) * 3
      + r.member_count * 0.5
      + CASE WHEN r.is_featured THEN 200 ELSE 0 END
      + CASE
          WHEN u.creator_tier = 'Elite' THEN 50
          WHEN u.creator_tier = 'Pro'   THEN 30
          WHEN u.creator_tier = 'Verified' THEN 20
          ELSE 0
        END
    ) DESC
  `;
}

// ---------------------------------------------------------------------------
// GET /api/rooms
// ---------------------------------------------------------------------------

/**
 * Return a paginated discovery feed of public rooms.
 *
 * Sorting priority when trending=1: activity score → creator tier → featured.
 * Otherwise: city proximity (city match first) → recent activity → created_at.
 *
 * Guild rooms are excluded from public discovery (private to guild members).
 *
 * @returns JSON { items, nextCursor, hasMore }
 */
export const GET = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const params = validateSearchParams(req.nextUrl.searchParams, listRoomsQuerySchema);

    // Fetch user's Vibe Quiz personalization to seed category affinity (PRD §4)
    // The vibe quiz answer for q1 ("argue/gist/learn/flex") maps to room categories.
    let vibeCategories: string[] = [];
    try {
      const { rows: vibeRows } = await db.query<{ onboarding_personalization: unknown }>(
        `SELECT onboarding_personalization FROM users WHERE id = $1 LIMIT 1`,
        [auth.user.sub]
      );
      const personalization = vibeRows[0]?.onboarding_personalization as Record<string, string> | null;
      if (personalization) {
        // roomAffinity is the vibe quiz q1 answer: argue|gist|learn|flex
        const affinity = personalization.roomAffinity ?? personalization.categoryAffinity ?? null;
        if (affinity) {
          // Map vibe quiz answers to room categories
          const VIBE_CATEGORY_MAP: Record<string, string[]> = {
            argue:  ["debate", "politics", "sports"],
            gist:   ["entertainment", "lifestyle", "gossip"],
            learn:  ["education", "knowledge", "technology"],
            flex:   ["music", "fashion", "creativity"],
          };
          vibeCategories = VIBE_CATEGORY_MAP[affinity] ?? [affinity];
        }
      }
    } catch {
      // Non-fatal — personalization is a best-effort boost
    }

    const conditions: string[] = [
      "r.is_active = TRUE",
      "r.type != 'guild'", // Guild rooms not discoverable publicly
    ];
    const queryParams: unknown[] = [];
    let paramIndex = 1;

    if (params.city) {
      conditions.push(`r.city ILIKE $${paramIndex++}`);
      queryParams.push(`%${params.city}%`);
    }

    if (params.category) {
      conditions.push(`r.category ILIKE $${paramIndex++}`);
      queryParams.push(`%${params.category}%`);
    }

    if (params.type) {
      conditions.push(`r.type = $${paramIndex++}`);
      queryParams.push(params.type);
    }

    if (params.friends_in_room) {
      conditions.push(`
        EXISTS (
          SELECT 1 FROM room_members rme
          JOIN follows uf ON uf.following_id = rme.user_id
          WHERE rme.room_id = r.id
            AND uf.follower_id = $${paramIndex++}
        )
      `);
      queryParams.push(auth.user.sub);
    }

    // Cursor pagination using created_at
    if (params.cursor) {
      conditions.push(`r.created_at < $${paramIndex++}`);
      queryParams.push(params.cursor);
    }

    // Page size param
    queryParams.push(params.limit);
    const limitParam = paramIndex++;

    // Vibe Quiz category affinity boost: rooms matching the user's preferred categories
    // are surfaced higher in discovery (PRD §4 — quiz results silently configure home feed)
    const vibeCategoryBoost =
      vibeCategories.length > 0
        ? `CASE WHEN r.category = ANY(ARRAY[${vibeCategories.map((_, i) => `$${paramIndex + i}`).join(",")}]::TEXT[]) THEN 100 ELSE 0 END + `
        : "";
    if (vibeCategories.length > 0) {
      vibeCategories.forEach((c) => queryParams.push(c));
      paramIndex += vibeCategories.length;
    }

    const orderBy = params.trending
      ? `(${vibeCategoryBoost}${buildTrendingOrderClause().trim().replace(" DESC", "")}) DESC`
      : `${vibeCategoryBoost}r.updated_at DESC`;

    const { rows } = await db.query<RoomRow>(
      `SELECT
         r.id,
         r.name,
         r.description,
         r.type,
         r.category,
         r.city,
         r.cover_emoji,
         r.cover_image_url,
         r.creator_id,
         u.username         AS creator_username,
         u.avatar_emoji     AS creator_avatar_emoji,
         u.creator_tier,
         r.member_count,
         r.max_members,
         r.is_active,
         r.subscription_price_ngn,
         r.entry_fee_ngn,
         r.drop_starts_at,
         r.drop_ends_at,
         r.enrolment_fee_ngn,
         COALESCE(
           (SELECT COUNT(*) FROM room_messages rm
            WHERE rm.room_id = r.id
              AND rm.created_at > NOW() - INTERVAL '2 hours'),
           0
         ) AS trending_score,
         COALESCE(
           (SELECT COUNT(*) FROM room_messages rm
            WHERE rm.room_id = r.id
              AND rm.created_at > NOW() - INTERVAL '2 hours'),
           0
         ) AS recent_message_count,
         r.total_messages,
         r.created_at,
         r.updated_at
       FROM rooms r
       JOIN users u ON u.id = r.creator_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY ${orderBy}
       LIMIT $${limitParam}`,
      queryParams
    );

    const nextCursor =
      rows.length === params.limit ? rows[rows.length - 1]?.created_at ?? null : null;

    return NextResponse.json(
      { items: rows, nextCursor, hasMore: nextCursor !== null },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/rooms
// ---------------------------------------------------------------------------

/**
 * Create a new room.
 *
 * Requirements:
 *  - Caller must have creator_role = true OR creator_tier in CREATOR_TIERS_ALLOWED.
 *  - Pricing constraints are validated against the x_manifest config.
 *  - VIP: subscriptionPriceNgn required in manifest range.
 *  - Drop: entryFeeNgn and dropDurationMinutes required.
 *  - Classroom: enrolmentFeeNgn required (may be 0).
 *
 * @returns JSON { room } with status 201
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, createRoomSchema);

    // Verify creator eligibility
    const { rows: userRows } = await db.query<{
      creator_role: boolean;
      creator_tier: string | null;
    }>(
      `SELECT creator_role, creator_tier FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [auth.user.sub]
    );

    const user = userRows[0];
    if (!user) throw forbidden("User not found");

    const isEligible =
      user.creator_role ||
      (user.creator_tier !== null &&
        CREATOR_TIERS_ALLOWED.includes(user.creator_tier as (typeof CREATOR_TIERS_ALLOWED)[number]));

    if (!isEligible) {
      throw forbidden(
        "A creator account is required to create rooms. Reach Rising tier or apply for creator status."
      );
    }

    // Validate type-specific pricing
    const manifest = await loadManifest();
    const vipPricing = manifest.features?.vipRoomPricing ?? {
      minNgn: 200,
      maxNgn: 10_000,
    };

    switch (body.type) {
      case "vip":
        if (body.subscriptionPriceNgn === undefined) {
          throw badRequest("subscriptionPriceNgn is required for VIP rooms");
        }
        if (
          body.subscriptionPriceNgn < (vipPricing.minNgn ?? 200) ||
          body.subscriptionPriceNgn > (vipPricing.maxNgn ?? 10_000)
        ) {
          throw badRequest(
            `VIP subscription price must be between ₦${vipPricing.minNgn} and ₦${vipPricing.maxNgn}`
          );
        }
        break;

      case "drop":
        if (body.entryFeeNgn === undefined) {
          throw badRequest("entryFeeNgn is required for Drop rooms");
        }
        if (body.dropDurationMinutes === undefined) {
          throw badRequest("dropDurationMinutes is required for Drop rooms");
        }
        break;

      case "classroom":
        if (body.enrolmentFeeNgn === undefined) {
          throw badRequest("enrolmentFeeNgn is required for Classroom rooms (use 0 for free)");
        }
        // Trust Score gate: paid ClassRooms require 30-day account age + trust score ≥ 40 (PRD §19)
        if (body.enrolmentFeeNgn > 0) {
          const eligible = await meetsMinimumTrust(auth.user.sub, "classroom_creation", db);
          if (!eligible) {
            throw forbidden(
              "Paid ClassRooms require a 30-day account history and a minimum trust score. " +
              "Your account needs more time on the platform."
            );
          }
        }
        break;

      case "guild": {
        // Guild rooms require the guild to be Platinum-tier or above
        const { rows: guildTierRows } = await db.query<{ tier: string }>(
          `SELECT g.tier FROM guilds g
           JOIN guild_members gm ON gm.guild_id = g.id
           WHERE gm.user_id = $1 AND gm.role IN ('owner', 'admin')
           ORDER BY
             CASE g.tier
               WHEN 'legend'     THEN 1
               WHEN 'platinum_3' THEN 2
               WHEN 'platinum_2' THEN 3
               WHEN 'platinum_1' THEN 4
               ELSE 99
             END ASC
           LIMIT 1`,
          [auth.user.sub]
        );
        const guildTier = guildTierRows[0]?.tier ?? null;
        const platinumAndAbove = ["platinum_1", "platinum_2", "platinum_3", "legend"];
        if (!guildTier || !platinumAndAbove.includes(guildTier)) {
          throw forbidden("Guild Rooms are only available to Platinum-tier Guilds and above.");
        }
        break;
      }

      default:
        break;
    }

    // Compute max_members
    const maxMembers =
      body.type === "free_open" ? FREE_OPEN_MAX_MEMBERS : null;

    // Compute drop_ends_at
    let dropEndsAt: string | null = null;
    if (body.type === "drop" && body.dropStartsAt && body.dropDurationMinutes) {
      const endsAt = new Date(
        new Date(body.dropStartsAt).getTime() + body.dropDurationMinutes * 60 * 1000
      );
      dropEndsAt = endsAt.toISOString();
    }

    const room = await db.transaction(async (tx) => {
      const { rows: roomRows } = await tx.query<RoomRow>(
        `INSERT INTO rooms (
           name, description, type, category, city,
           cover_emoji, cover_image_url, creator_id,
           max_members, subscription_price_ngn, entry_fee_ngn,
           drop_starts_at, drop_ends_at, enrolment_fee_ngn,
           curriculum, class_start_date, class_end_date,
           member_count, total_messages, is_active
         )
         VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8,
           $9, $10, $11,
           $12, $13, $14,
           $15, $16, $17,
           1, 0, TRUE
         )
         RETURNING *`,
        [
          body.name,
          body.description ?? null,
          body.type,
          body.category,
          body.city ?? null,
          body.coverEmoji,
          body.coverImageUrl ?? null,
          auth.user.sub,
          maxMembers,
          body.subscriptionPriceNgn ?? null,
          body.entryFeeNgn ?? null,
          body.dropStartsAt ?? null,
          dropEndsAt,
          body.enrolmentFeeNgn ?? null,
          body.curriculum ? JSON.stringify(body.curriculum) : null,
          body.classStartDate ?? null,
          body.classEndDate ?? null,
        ]
      );

      const room = roomRows[0];
      if (!room) throw new Error("Room creation failed");

      // Auto-join creator as admin member
      await tx.query(
        `INSERT INTO room_members (room_id, user_id, role, joined_at)
         VALUES ($1, $2, 'admin', NOW())`,
        [room.id, auth.user.sub]
      );

      return room;
    });

    return NextResponse.json({ room }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
