export const dynamic = 'force-dynamic';

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
import { db, SqlParam } from "@/lib/db";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";
import { resolveRoomCap } from "@/lib/rooms/capacity";
import { getRoomPresenceCount } from "@/lib/presence/room";
import { meetsMinimumTrust } from "@/lib/trust/trustScore";
import { sendPushNotificationBatch } from "@/lib/notifications/push";
import { getTrackXPThreshold } from "@/lib/xp/engine";
import { generateUniqueSlug } from "@/lib/slug";
import { toRoomCardPayload } from "@/lib/rooms/serialize";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Creator tiers that are allowed to create rooms (lowercase, matching DB constraint). */
const CREATOR_TIERS_ALLOWED = ["rising", "verified", "elite", "icon"] as const;

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
  /** Filter by live availability: only available (not full) or only full rooms. */
  availability: z.enum(["all", "available", "full"]).optional(),
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
  type: z.enum(["free_open", "vip", "drop", "tipping", "classroom", "guild", "limited"]),
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
  /** Limited room duration in minutes (120–360). Required for limited rooms. */
  durationMinutes: z.number().int().min(120).max(360).optional(),
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
  /**
   * Guild to attach a Guild Room to. Only honoured for admins (who can create
   * a Guild Room for any guild); non-admins are always attached to a guild
   * they own/administer, resolved server-side.
   */
  guildId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface RoomRow {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  type: string;
  category: string;
  city: string | null;
  cover_emoji: string;
  cover_image_url: string | null;
  creator_id: string;
  creator_username: string;
  creator_display_name: string | null;
  creator_avatar_emoji: string;
  creator_tier: string | null;
  member_count: number;
  max_members: number;
  is_active: boolean;
  is_featured: boolean;
  is_sponsored: boolean;
  subscription_price_ngn: number | null;
  entry_fee_ngn: number | null;
  drop_starts_at: string | null;
  drop_ends_at: string | null;
  enrolment_fee_ngn: number | null;
  trending_score: number;
  recent_message_count: number;
  total_messages: number;
  health_score: number;
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
          WHEN u.creator_tier = 'icon'     THEN 60
          WHEN u.creator_tier = 'elite'    THEN 50
          WHEN u.creator_tier = 'verified' THEN 20
          WHEN u.creator_tier = 'rising'   THEN 10
          ELSE 0
        END
      + (COALESCE(r.health_score, 100) - 50)
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
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
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
    const queryParams: SqlParam[] = [];
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

    // In non-trending mode, rooms with health < 40 are sorted last (PRD §10).
    const orderBy = params.trending
      ? `(${vibeCategoryBoost}${buildTrendingOrderClause().trim().replace(" DESC", "")}) DESC`
      : `CASE WHEN COALESCE(r.health_score, 100) < 40 THEN 1 ELSE 0 END ASC, r.updated_at DESC`;

    // Caller-scoped joins so each card can show join state + favorite state
    // without a second round-trip per room.
    const callerParam = paramIndex++;
    queryParams.push(auth.user.sub);

    const { rows } = await db.query<
      RoomRow & { is_joined: boolean; is_favorited: boolean; is_promoted: boolean }
    >(
      `SELECT
         r.id,
         r.name,
         r.description,
         r.type,
         r.category,
         r.city,
         r.cover_emoji,
         r.cover_image_url,
         r.slug,
         r.creator_id,
         u.username         AS creator_username,
         u.display_name     AS creator_display_name,
         u.avatar_emoji     AS creator_avatar_emoji,
         u.creator_tier,
         r.member_count,
         r.max_members,
         r.is_active,
         r.is_featured,
         r.is_sponsored,
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
         COALESCE(r.health_score, 100) AS health_score,
         -- Paid promotion boost: rooms with an active promotion appear higher
         (rp.id IS NOT NULL AND rp.ends_at > NOW()) AS is_promoted,
         (caller_member.user_id IS NOT NULL) AS is_joined,
         (caller_pin.id IS NOT NULL)         AS is_favorited,
         r.created_at,
         r.updated_at
       FROM rooms r
       JOIN users u ON u.id = r.creator_id
       LEFT JOIN room_promotions rp ON rp.room_id = r.id AND rp.is_active = TRUE AND rp.ends_at > NOW()
       LEFT JOIN room_members caller_member ON caller_member.room_id = r.id AND caller_member.user_id = $${callerParam}
       LEFT JOIN room_pins caller_pin ON caller_pin.room_id = r.id AND caller_pin.user_id = $${callerParam}
       WHERE ${conditions.join(" AND ")}
       ORDER BY
         -- Promoted rooms (via room_promotions or spotlight power) surface first
         CASE WHEN (rp.id IS NOT NULL AND rp.ends_at > NOW()) OR (r.spotlight_until IS NOT NULL AND r.spotlight_until > NOW()) THEN 0 ELSE 1 END ASC,
         ${orderBy}
       LIMIT $${limitParam}`,
      queryParams
    );

    // nextCursor reflects the unfiltered page so pagination still advances even
    // when an availability filter hides some rooms from the current page.
    const nextCursor =
      rows.length === params.limit ? rows[rows.length - 1]?.created_at ?? null : null;

    // Enrich each room with its LIVE presence count + soft cap so discovery can
    // show a "Full" badge and filter by availability. Presence is a cheap Redis
    // read per room (page size ≤ 50).
    const manifest = await loadManifest();
    let items = await Promise.all(
      rows.map(async (r) => {
        const cap = resolveRoomCap(r.type, r.max_members, manifest);
        const presentCount = await getRoomPresenceCount(r.id);
        const isFull = presentCount >= cap;
        return {
          ...toRoomCardPayload(r, {
            isFull,
            presentCount,
            capacity: cap,
            isPromoted: r.is_promoted,
            isJoined: r.is_joined,
            isFavorited: r.is_favorited,
          }),
          _isFull: isFull,
        };
      }),
    );

    if (params.availability === "available") {
      items = items.filter((r) => !r._isFull);
    } else if (params.availability === "full") {
      items = items.filter((r) => r._isFull);
    }
    const cleanItems = items.map(({ _isFull, ...rest }) => rest);

    return NextResponse.json(
      { items: cleanItems, nextCursor, hasMore: nextCursor !== null },
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
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, createRoomSchema);

    // Verify creator eligibility. is_admin is re-checked against the database
    // (never trusted from the JWT alone) since it grants a bypass of every
    // eligibility gate below — admins can create any room type per the PRD's
    // "admin can take all actions" rule.
    const { rows: userRows } = await db.query<{
      creator_role: boolean;
      creator_tier: string | null;
      xp_creator: number;
      is_admin: boolean;
    }>(
      `SELECT creator_role, creator_tier, COALESCE(xp_creator, 0) AS xp_creator, is_admin
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [auth.user.sub]
    );

    const user = userRows[0];
    if (!user) throw forbidden("User not found");
    const isAdmin = user.is_admin;

    const isEligible =
      isAdmin ||
      user.creator_role ||
      (user.creator_tier !== null &&
        CREATOR_TIERS_ALLOWED.includes(user.creator_tier as (typeof CREATOR_TIERS_ALLOWED)[number]));

    if (!isEligible) {
      throw forbidden(
        "A creator account is required to create rooms. Reach Rising tier or apply for creator status."
      );
    }

    // Creator Track L5/L20 room capacity gates (PRD §7)
    // Validate type-specific pricing
    const manifest = await loadManifest();
    const vipPricing = manifest.features?.vipRoomPricing ?? {
      minNgn: 200,
      maxNgn: 10_000,
    };

    // Resolved outside the switch so the INSERT below can attach the room to
    // its guild (rooms.guild_id + the guild_rooms join row). Only populated
    // for type === "guild".
    let resolvedGuildId: string | null = null;

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
        if (body.enrolmentFeeNgn > 0 && !isAdmin) {
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
        const platinumAndAbove = ["platinum_1", "platinum_2", "platinum_3", "legend"];

        if (isAdmin && body.guildId) {
          // Admins may attach a Guild Room to any guild regardless of tier.
          const { rows: guildRows } = await db.query<{ id: string }>(
            `SELECT id FROM guilds WHERE id = $1 LIMIT 1`,
            [body.guildId]
          );
          if (!guildRows[0]) throw badRequest("Guild not found");
          resolvedGuildId = guildRows[0].id;
          break;
        }

        // Guild rooms require the guild to be Platinum-tier or above, and the
        // caller to own/administer it — unless the caller is an admin, who
        // only needs *some* owned/administered guild (tier check skipped).
        const { rows: guildTierRows } = await db.query<{ id: string; tier: string }>(
          `SELECT g.id, g.tier FROM guilds g
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
        if (!guildTierRows[0] || (!isAdmin && !platinumAndAbove.includes(guildTier ?? ""))) {
          throw forbidden("Guild Rooms are only available to Platinum-tier Guilds and above.");
        }
        resolvedGuildId = guildTierRows[0].id;
        break;
      }

      case "limited":
        if (body.durationMinutes === undefined) {
          throw badRequest("durationMinutes is required for Limited rooms (120–360 minutes)");
        }
        break;

      default:
        break;
    }

    // Seed the room's soft cap (`max_members`) from the manifest default for its
    // type. This is the per-room override resolveRoomCap() reads; the creator can
    // raise it later via a paid capacity upgrade. Caps bound realtime fan-out.
    const maxMembers =
      (manifest.roomCaps as Record<string, number>)[body.type] ??
      manifest.roomCaps.free_open;

    // Compute drop_ends_at
    let dropEndsAt: string | null = null;
    if (body.type === "drop" && body.dropStartsAt && body.dropDurationMinutes) {
      const endsAt = new Date(
        new Date(body.dropStartsAt).getTime() + body.dropDurationMinutes * 60 * 1000
      );
      dropEndsAt = endsAt.toISOString();
    }

    // Guild rooms are private to guild members; every other type is public
    // discovery content. The `rooms_public_requires_slug` CHECK constraint
    // enforces that public rooms always carry a slug, so the slug must be
    // generated *before* the row is inserted (a slug can't be back-filled
    // after the fact — the constraint is checked on the INSERT statement
    // itself, not deferred to COMMIT). This mirrors the pattern already used
    // for games (see app/api/admin/games/route.ts): generate the slug from
    // the name using a throwaway fallback id for the rare all-emoji/empty-name
    // case, then insert it directly.
    const isPublic = body.type !== "guild";
    const slug = isPublic
      ? await generateUniqueSlug("room", body.name, crypto.randomUUID())
      : null;

    const room = await db.transaction(async (tx) => {
      const { rows: roomRows } = await tx.query<RoomRow>(
        `INSERT INTO rooms (
           name, description, type, category, city,
           cover_emoji, cover_image_url, creator_id,
           max_members, subscription_price_ngn, entry_fee_ngn,
           drop_starts_at, drop_ends_at, enrolment_fee_ngn,
           curriculum, class_start_date, class_end_date,
           duration_minutes, slug, is_public, guild_id,
           member_count, total_messages, is_active
         )
         VALUES (
           $1, $2, $3, $4, $5,
           $6, $7, $8,
           $9, $10, $11,
           $12, $13, $14,
           $15, $16, $17,
           $18, $19, $20, $21,
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
          body.durationMinutes ?? null,
          slug,
          isPublic,
          resolvedGuildId,
        ]
      );

      const room = roomRows[0];
      if (!room) throw new Error("Room creation failed");

      // Auto-join creator as creator member
      await tx.query(
        `INSERT INTO room_members (room_id, user_id, role, joined_at)
         VALUES ($1, $2, 'creator', NOW())`,
        [room.id, auth.user.sub]
      );

      // Guild Rooms are looked up by the guild_rooms join table (GET
      // /api/rooms/[roomId]) *and* by rooms.guild_id directly (POST
      // /api/rooms/[roomId]/join) — both must be populated or the room is
      // unreachable even by its own creator.
      if (resolvedGuildId) {
        await tx.query(
          `INSERT INTO guild_rooms (guild_id, room_id) VALUES ($1, $2)
           ON CONFLICT (guild_id, room_id) DO NOTHING`,
          [resolvedGuildId, room.id]
        );
      }

      return room;
    });

    // Notify Explorer Track L25+ users in the same city (PRD §7 — Nomad milestone perk).
    // Fire-and-forget: errors never block the response.
    if (room.city) {
      const NOMAD_XP_THRESHOLD = getTrackXPThreshold(25);
      db.query<{ id: string }>(
        `SELECT id FROM users
         WHERE xp_explorer >= $1
           AND city ILIKE $2
           AND id != $3
           AND deleted_at IS NULL
         LIMIT 500`,
        [NOMAD_XP_THRESHOLD, `%${room.city}%`, auth.user.sub]
      ).then(async ({ rows: nomadUsers }) => {
        if (nomadUsers.length === 0) return;
        const userIds = nomadUsers.map((u) => u.id);
        const notifPayload = JSON.stringify({ roomId: room.id, roomName: room.name, city: room.city });
        await db.query(
          `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
           SELECT unnest($1::uuid[]), 'new_city_room', $2::jsonb, FALSE, NOW()`,
          [userIds, notifPayload]
        );
        sendPushNotificationBatch(
          nomadUsers.map((u) => ({
            userId: u.id,
            title: "New Room in Your City 🌍",
            body: `${room.name} just opened in ${room.city}. Be first to join!`,
            data: { action: `/rooms/${room.id}` },
            priority: "normal" as const,
          }))
        ).catch(() => {/* fire-and-forget */});
      }).catch(() => {/* fire-and-forget */});
    }

    return NextResponse.json({ room }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
