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
import { eq, and, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody, validateSearchParams } from "@/lib/api/middleware";
import { handleApiError, badRequest, forbidden, conflict } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";
import { isCaptchaSurfaceEnabled, verifyCaptcha } from "@/lib/security/captcha";
import { resolveRoomCap } from "@/lib/rooms/capacity";
import { getRoomPresenceCount } from "@/lib/presence/room";
import { meetsMinimumTrust } from "@/lib/trust/trustScore";
import { sendPushNotificationBatch } from "@/lib/notifications/push";
import { getTrackXPThreshold } from "@/lib/xp/engine";
import { generateUniqueSlug } from "@/lib/slug";
import { toRoomCardPayload } from "@/lib/rooms/serialize";
import { checkSlugAvailability } from "@/lib/classroom/slug";
import { buildModule } from "@/lib/classroom/curriculum";
import { getMaxClassrooms, getFreeMinLevel } from "@/lib/classroom/draftLimits";

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
  /** Show only rooms created by this user (used by the "see all rooms by this creator" link on profiles). */
  creator_id: z.string().uuid().optional(),
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
   * Classroom only: the creator-chosen public slug (/c/<slug>). Defaults to a
   * suggestion derived from the name; validated + availability-checked
   * server-side (lib/classroom/slug.ts).
   */
  slug: z.string().trim().min(1).max(120).optional(),
  /** Classroom only: list it on the creator's public "Classrooms by" page. */
  showInCreatorListing: z.boolean().optional(),
  /**
   * Guild to attach a Guild Room to. Only honoured for admins (who can create
   * a Guild Room for any guild); non-admins are always attached to a guild
   * they own/administer, resolved server-side.
   */
  guildId: z.string().uuid().optional(),
  captchaToken: z.string().max(4000).optional(),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

type RoomRow = Record<string, unknown> & {
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
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a trending score expression for SQL ORDER BY.
 *
 * Weights message activity in last 2 hours, member count, and featured flag.
 */
function buildTrendingScoreExpr() {
  return sql`
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
    )
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

    const params2 = validateSearchParams(req.nextUrl.searchParams, listRoomsQuerySchema);
    const orm = await getDb();

    // Fetch user's Vibe Quiz personalization to seed category affinity (PRD §4)
    // The vibe quiz answer for q1 ("argue/gist/learn/flex") maps to room categories.
    let vibeCategories: string[] = [];
    try {
      const [vibeRow] = await orm
        .select({ onboardingPersonalization: schema.users.onboardingPersonalization })
        .from(schema.users)
        .where(eq(schema.users.id, auth.user.sub))
        .limit(1);
      const personalization = vibeRow?.onboardingPersonalization as Record<string, string> | null;
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

    const conditions: ReturnType<typeof sql>[] = [
      sql`r.is_active = TRUE`,
      sql`r.type != 'guild'`, // Guild rooms not discoverable publicly
    ];

    if (params2.city) {
      conditions.push(sql`r.city ILIKE ${`%${params2.city}%`}`);
    }

    if (params2.category) {
      conditions.push(sql`r.category ILIKE ${`%${params2.category}%`}`);
    }

    if (params2.type) {
      conditions.push(sql`r.type = ${params2.type}`);
    }

    if (params2.creator_id) {
      conditions.push(sql`r.creator_id = ${params2.creator_id}`);
    }

    if (params2.friends_in_room) {
      conditions.push(sql`
        EXISTS (
          SELECT 1 FROM room_members rme
          JOIN follows uf ON uf.following_id = rme.user_id
          WHERE rme.room_id = r.id
            AND uf.follower_id = ${auth.user.sub}
        )
      `);
    }

    // Cursor pagination using created_at
    if (params2.cursor) {
      conditions.push(sql`r.created_at < ${params2.cursor}`);
    }

    // Vibe Quiz category affinity boost: rooms matching the user's preferred categories
    // are surfaced higher in discovery (PRD §4 — quiz results silently configure home feed)
    const vibeCategoryBoost =
      vibeCategories.length > 0
        ? sql`CASE WHEN r.category = ANY(${vibeCategories}::TEXT[]) THEN 100 ELSE 0 END + `
        : sql``;

    // In non-trending mode, rooms with health < 40 are sorted last (PRD §10).
    const orderBy = params2.trending
      ? sql`(${vibeCategoryBoost}${buildTrendingScoreExpr()}) DESC`
      : sql`CASE WHEN COALESCE(r.health_score, 100) < 40 THEN 1 ELSE 0 END ASC, r.updated_at DESC`;

    // Caller-scoped joins so each card can show join state + favorite state
    // without a second round-trip per room.
    const result = await orm.execute<
      RoomRow & { is_joined: boolean; is_favorited: boolean; is_promoted: boolean }
    >(sql`
      SELECT
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
      LEFT JOIN room_members caller_member ON caller_member.room_id = r.id AND caller_member.user_id = ${auth.user.sub}
      LEFT JOIN room_pins caller_pin ON caller_pin.room_id = r.id AND caller_pin.user_id = ${auth.user.sub}
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY
        -- Promoted rooms (via room_promotions or spotlight power) surface first
        CASE WHEN (rp.id IS NOT NULL AND rp.ends_at > NOW()) OR (r.spotlight_until IS NOT NULL AND r.spotlight_until > NOW()) THEN 0 ELSE 1 END ASC,
        ${orderBy}
      LIMIT ${params2.limit}
    `);
    const rows = result.rows;

    // nextCursor reflects the unfiltered page so pagination still advances even
    // when an availability filter hides some rooms from the current page.
    const nextCursor =
      rows.length === params2.limit ? rows[rows.length - 1]?.created_at ?? null : null;

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

    if (params2.availability === "available") {
      items = items.filter((r) => !r._isFull);
    } else if (params2.availability === "full") {
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
    const orm = await getDb();

    if (await isCaptchaSurfaceEnabled("create_room")) {
      const ip = getClientIp(req);
      if (!body.captchaToken || !(await verifyCaptcha(body.captchaToken, ip, "create_room"))) {
        throw badRequest("CAPTCHA verification failed. Please try again.", "CAPTCHA_FAILED");
      }
    }

    // Verify creator eligibility. is_admin is re-checked against the database
    // (never trusted from the JWT alone) since it grants a bypass of every
    // eligibility gate below — admins can create any room type per the PRD's
    // "admin can take all actions" rule.
    const [user] = await orm
      .select({
        creatorRole: schema.users.creatorRole,
        creatorTier: schema.users.creatorTier,
        xpCreator: schema.users.xpCreator,
        isAdmin: schema.users.isAdmin,
        plan: schema.users.plan,
        levelCreator: schema.users.levelCreator,
      })
      .from(schema.users)
      .where(and(eq(schema.users.id, auth.user.sub), sql`${schema.users.deletedAt} IS NULL`));

    if (!user) throw forbidden("User not found");
    const isAdmin = user.isAdmin;

    const isEligible =
      isAdmin ||
      user.creatorRole ||
      (user.creatorTier !== null &&
        CREATOR_TIERS_ALLOWED.includes(user.creatorTier as (typeof CREATOR_TIERS_ALLOWED)[number]));

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

      case "classroom": {
        if (body.enrolmentFeeNgn === undefined) {
          throw badRequest("enrolmentFeeNgn is required for Classroom rooms (use 0 for free)");
        }
        // Trust Score gate: paid ClassRooms require 30-day account age + trust score ≥ 40 (PRD §19)
        if (body.enrolmentFeeNgn > 0 && !isAdmin) {
          const eligible = await meetsMinimumTrust(
            auth.user.sub,
            "classroom_creation",
            orm
          );
          if (!eligible) {
            throw forbidden(
              "Paid ClassRooms require a 30-day account history and a minimum trust score. " +
              "Your account needs more time on the platform."
            );
          }
        }

        if (!isAdmin) {
          const plan = user.plan ?? "free";
          if (plan === "free") {
            const minLevel = await getFreeMinLevel();
            if ((user.levelCreator ?? 1) < minLevel) {
              throw forbidden(
                `You need to reach Creator Level ${minLevel} before creating a classroom on the Free plan. Upgrade your plan to create one now.`,
                "CLASSROOM_LEVEL_TOO_LOW"
              );
            }
          }
          const [maxClassrooms, [{ n }]] = await Promise.all([
            getMaxClassrooms(plan),
            orm
              .select({ n: sql<string>`COUNT(*)` })
              .from(schema.rooms)
              .where(and(
                eq(schema.rooms.creatorId, auth.user.sub),
                eq(schema.rooms.type, 'classroom'),
                sql`${schema.rooms.deletedAt} IS NULL`,
              )),
          ]);
          if (Number(n ?? 0) >= maxClassrooms) {
            throw forbidden(
              `Your plan allows up to ${maxClassrooms} classrooms (draft + live). Publish or delete one, or upgrade your plan, to create another.`,
              "CLASSROOM_LIMIT_REACHED"
            );
          }
        }
        break;
      }

      case "guild": {
        const platinumAndAbove = ["platinum_1", "platinum_2", "platinum_3", "legend"];

        if (isAdmin && body.guildId) {
          // Admins may attach a Guild Room to any guild regardless of tier.
          const [guildRow] = await orm
            .select({ id: schema.guilds.id })
            .from(schema.guilds)
            .where(eq(schema.guilds.id, body.guildId))
            .limit(1);
          if (!guildRow) throw badRequest("Guild not found");
          resolvedGuildId = guildRow.id;
          break;
        }

        // Guild rooms require the guild to be Platinum-tier or above, and the
        // caller to own/administer it — unless the caller is an admin, who
        // only needs *some* owned/administered guild (tier check skipped).
        const guildTierResult = await orm.execute<{ id: string; tier: string }>(sql`
          SELECT g.id, g.tier FROM guilds g
          JOIN guild_members gm ON gm.guild_id = g.id
          WHERE gm.user_id = ${auth.user.sub} AND gm.role IN ('owner', 'admin')
          ORDER BY
            CASE g.tier
              WHEN 'legend'     THEN 1
              WHEN 'platinum_3' THEN 2
              WHEN 'platinum_2' THEN 3
              WHEN 'platinum_1' THEN 4
              ELSE 99
            END ASC
          LIMIT 1
        `);
        const guildTierRow = guildTierResult.rows[0];
        const guildTier = guildTierRow?.tier ?? null;
        if (!guildTierRow || (!isAdmin && !platinumAndAbove.includes(guildTier ?? ""))) {
          throw forbidden("Guild Rooms are only available to Platinum-tier Guilds and above.");
        }
        resolvedGuildId = guildTierRow.id;
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
    // Classrooms are always created as drafts — the creator must explicitly
    // click Publish (see PATCH /api/classroom/[roomId]) before they're
    // discoverable or enrollable by anyone else. Every other room type keeps
    // the previous immediate-public behavior.
    const isPublic = body.type !== "guild" && body.type !== "classroom";
    let slug: string | null = null;
    if (body.type === "classroom" && body.slug) {
      // Creator-edited slug from the classroom create form. The partial
      // unique index on rooms.slug remains the final race backstop.
      const availability = await checkSlugAvailability(body.slug, null);
      if (!availability.available) {
        throw conflict("That classroom URL isn't available.", "CLASSROOM_SLUG_UNAVAILABLE", { reason: availability.reason });
      }
      slug = availability.slug;
    } else if (isPublic || body.type === "classroom") {
      // Classrooms get a slug reserved immediately even while still a draft
      // (isPublic = false) so Studio can preview /c/<slug> and Publish never
      // fails on a missing URL later.
      slug = await generateUniqueSlug("room", body.name, crypto.randomUUID());
    }

    // Classroom curriculum is always stored in the { modules: [...] } shape
    // (with stable module ids) that the modules API reads — a bare array
    // broke every later module add/edit (jsonb_set on an array path).
    const curriculum =
      body.type === "classroom"
        ? {
            modules: [...(body.curriculum ?? [])]
              .sort((a, b) => a.order - b.order)
              .map((m) => buildModule({ title: m.title, description: m.description })),
          }
        : body.curriculum ?? null;

    const room = await orm.transaction(async (tx) => {
      const roomInsertValues: typeof schema.rooms.$inferInsert = {
        name: body.name,
        description: body.description ?? null,
        type: body.type,
        category: body.category,
        city: body.city ?? null,
        coverEmoji: body.coverEmoji,
        coverImageUrl: body.coverImageUrl ?? null,
        creatorId: auth.user.sub,
        maxMembers,
        subscriptionPriceNgn: body.subscriptionPriceNgn !== undefined ? BigInt(body.subscriptionPriceNgn) : null,
        entryFeeNgn: body.entryFeeNgn !== undefined ? BigInt(body.entryFeeNgn) : null,
        dropStartsAt: body.dropStartsAt ? new Date(body.dropStartsAt) : null,
        dropEndsAt: dropEndsAt ? new Date(dropEndsAt) : null,
        enrolmentFeeNgn: body.enrolmentFeeNgn !== undefined ? BigInt(body.enrolmentFeeNgn) : null,
        curriculum: curriculum ?? null,
        classStartDate: body.classStartDate ?? null,
        classEndDate: body.classEndDate ?? null,
        durationMinutes: body.durationMinutes ?? null,
        slug,
        isPublic,
        guildId: resolvedGuildId,
        showInCreatorListing: body.showInCreatorListing ?? true,
        memberCount: 1,
        totalMessages: 0,
        isActive: true,
      };
      const [insertedRoom] = await tx
        .insert(schema.rooms)
        .values(roomInsertValues)
        .returning();

      const room = insertedRoom;
      if (!room) throw new Error("Room creation failed");

      // Auto-join creator as creator member
      await tx.insert(schema.roomMembers).values({
        roomId: room.id,
        userId: auth.user.sub,
        role: 'creator',
        joinedAt: sql`NOW()`,
      });

      // Guild Rooms are looked up by the guild_rooms join table (GET
      // /api/rooms/[roomId]) *and* by rooms.guild_id directly (POST
      // /api/rooms/[roomId]/join) — both must be populated or the room is
      // unreachable even by its own creator.
      if (resolvedGuildId) {
        await tx
          .insert(schema.guildRooms)
          .values({ guildId: resolvedGuildId, roomId: room.id })
          .onConflictDoNothing();
      }

      return room;
    });

    // Notify Explorer Track L25+ users in the same city (PRD §7 — Nomad milestone perk).
    // Fire-and-forget: errors never block the response.
    if (room.city) {
      const NOMAD_XP_THRESHOLD = getTrackXPThreshold(25);
      orm
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(
          sql`${schema.users.xpExplorer} >= ${NOMAD_XP_THRESHOLD}`,
          sql`${schema.users.city} ILIKE ${`%${room.city}%`}`,
          sql`${schema.users.id} != ${auth.user.sub}`,
          sql`${schema.users.deletedAt} IS NULL`,
        ))
        .limit(500)
        .then(async (nomadUsers) => {
          if (nomadUsers.length === 0) return;
          const userIds = nomadUsers.map((u) => u.id);
          const notifPayload = { roomId: room.id, roomName: room.name, city: room.city };
          await orm.execute(sql`
            INSERT INTO notifications (user_id, type, payload, is_read, created_at)
            SELECT unnest(${userIds}::uuid[]), 'new_city_room', ${JSON.stringify(notifPayload)}::jsonb, FALSE, NOW()
          `);
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

    return NextResponse.json({
      room: {
        ...room,
        subscriptionPriceNgn: room.subscriptionPriceNgn !== null ? Number(room.subscriptionPriceNgn) : null,
        entryFeeNgn: room.entryFeeNgn !== null ? Number(room.entryFeeNgn) : null,
        enrolmentFeeNgn: room.enrolmentFeeNgn !== null ? Number(room.enrolmentFeeNgn) : null,
        subscriptionPriceKobo: room.subscriptionPriceKobo !== null ? Number(room.subscriptionPriceKobo) : null,
        entryFeeKobo: room.entryFeeKobo !== null ? Number(room.entryFeeKobo) : null,
      },
    }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
