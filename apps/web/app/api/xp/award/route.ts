export const dynamic = 'force-dynamic';

/**
 * app/api/xp/award/route.ts
 *
 * Internal XP award endpoint.
 *
 * POST /api/xp/award
 *   - Internal route: requires CRON_SECRET or SERVICE_TOKEN header (not a user JWT)
 *   - Body: { userId, action, options?, multiplierContext }
 *   - Calls calculateXPForAction and applyMultipliers from lib/xp/engine
 *   - Writes to xp_ledger (append-only)
 *   - Updates user's xp_total and the relevant track XP column in a transaction
 *   - Updates rank_name, rank_level, rank_sublevel if changed
 *   - Updates legacy_score (always cumulative, never resets)
 *   - Updates leaderboard_snapshots for main and city scopes
 *   - Returns { xpAwarded, newTotal, rankUp? }
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { validateBody } from "@/lib/api/middleware";
import { handleApiError, unauthorized, notFound } from "@/lib/api/errors";
import { enforceRateLimit, getClientIp, RATE_LIMITS } from "@/lib/security/rateLimit";
import { env } from "@/lib/env";
import {
  calculateXPForAction,
  applyMultipliers,
  getRankForXP,
  getTrackLevelForXP,
  ACTION_TRACKS,
  type XPAction,
  type XPMultiplierContext,
} from "@/lib/xp/engine";
import {
  checkAndAwardTrackMilestones,
  type TrackMilestone,
} from "@/lib/xp/trackMilestones";
import { awardMilestoneStickers } from "@/lib/stickers/milestoneStickers";
import { advanceNewMemberQuestStep, type NewMemberQuestStepId } from "@/lib/quests/newMemberQuestEngine";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  xp_total: number;
  legacy_score: number;
  rank_name: string;
  rank_level: number;
  rank_sublevel: number;
  city: string | null;
  xp_social: number;
  xp_creator: number;
  xp_competitor: number;
  xp_generosity: number;
  xp_knowledge: number;
  xp_explorer: number;
  prestige_cycle_boost_expires_at: string | null;
  gender: string | null;
  creator_tier: string | null;
  is_creator: boolean;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const awardXpSchema = z.object({
  userId: z.string().uuid("userId must be a valid UUID"),
  action: z.string().min(1, "action is required").max(100) as z.ZodType<XPAction>,
  options: z
    .object({
      amount: z.number().int().positive().optional(),
      streakDays: z.number().int().positive().optional(),
    })
    .optional(),
  multiplierContext: z.object({
    plan: z.enum(["free", "plus", "pro", "max"]),
    guildTier: z.string().optional(),
    hasActiveSeasonPass: z.boolean().optional(),
    hasActiveXPBooster: z.boolean().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Track column map
// ---------------------------------------------------------------------------

const TRACK_COLUMN: Record<string, string> = {
  social: "xp_social",
  creator: "xp_creator",
  competitor: "xp_competitor",
  generosity: "xp_generosity",
  knowledge: "xp_knowledge",
  explorer: "xp_explorer",
};

const TRACK_LEVEL_COLUMN: Record<string, string> = {
  social: "level_social",
  creator: "level_creator",
  competitor: "level_competitor",
  generosity: "level_generosity",
  knowledge: "level_knowledge",
  explorer: "level_explorer",
};

// ---------------------------------------------------------------------------
// Service auth validation
// ---------------------------------------------------------------------------

/**
 * Validate the service token from the Authorization header.
 * Accepts either CRON_SECRET or SERVICE_TOKEN.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param req - Incoming request
 * @throws {ApiError} 401 if token is missing or invalid
 */
function validateServiceToken(req: NextRequest): void {
  const authHeader = req.headers.get("authorization");
  const cronSecret = req.headers.get("x-cron-secret");

  // Check x-cron-secret header first (used by cron jobs)
  const cronToken = process.env.CRON_SECRET ?? "";
  if (cronSecret && cronSecret.length > 0 && cronSecret.length === cronToken.length) {
    let mismatch = 0;
    for (let i = 0; i < cronSecret.length; i++) {
      mismatch |= cronSecret.charCodeAt(i) ^ cronToken.charCodeAt(i);
    }
    if (mismatch === 0) return;
  }

  // Check Authorization Bearer header (used by internal services)
  if (!authHeader?.startsWith("Bearer ")) {
    throw unauthorized("Service authorization token required");
  }
  const token = authHeader.slice(7);
  const expected = process.env.SERVICE_TOKEN ?? env.JWT_SECRET;

  if (token.length !== expected.length) {
    throw unauthorized("Invalid service authorization token");
  }
  let mismatch = 0;
  for (let i = 0; i < token.length; i++) {
    mismatch |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) {
    throw unauthorized("Invalid service authorization token");
  }
}

// ---------------------------------------------------------------------------
// POST /api/xp/award
// ---------------------------------------------------------------------------

/**
 * Award XP to a user for a specific action.
 *
 * Uses the XP engine to calculate base XP and apply all multipliers.
 * All database writes are wrapped in a transaction for financial integrity.
 * Leaderboard snapshots are updated on every award (not recalculated on read).
 *
 * @returns JSON { xpAwarded, newTotal, rankUp?: { from, to, sublevelFrom, sublevelTo } }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit(ip, "ip", RATE_LIMITS.xpAward);

    // This endpoint requires service auth – not a user JWT
    validateServiceToken(req);

    const body = await validateBody(req, awardXpSchema);

    const orm = await getDb();

    const result = await orm.transaction(async (client) => {
      // 1. Lock user row for update
      const userRows = await client
        .select({
          id: schema.users.id,
          xp_total: schema.users.xpTotal,
          legacy_score: schema.users.legacyScore,
          rank_name: schema.users.rankName,
          rank_level: schema.users.rankLevel,
          rank_sublevel: schema.users.rankSublevel,
          city: schema.users.city,
          xp_social: schema.users.xpSocial,
          xp_creator: schema.users.xpCreator,
          xp_competitor: schema.users.xpCompetitor,
          xp_generosity: schema.users.xpGenerosity,
          xp_knowledge: schema.users.xpKnowledge,
          xp_explorer: schema.users.xpExplorer,
          prestige_cycle_boost_expires_at: schema.users.prestigeCycleBoostExpiresAt,
          gender: schema.users.gender,
          creator_tier: schema.users.creatorTier,
          is_creator: schema.users.isCreator,
        })
        .from(schema.users)
        .where(and(eq(schema.users.id, body.userId), isNull(schema.users.deletedAt)))
        .for("update");

      const userRow = userRows[0];
      if (!userRow) throw notFound(`User ${body.userId} not found`);
      const user: UserRow = {
        ...userRow,
        xp_total: Number(userRow.xp_total),
        legacy_score: Number(userRow.legacy_score),
        xp_social: Number(userRow.xp_social),
        xp_creator: Number(userRow.xp_creator),
        xp_competitor: Number(userRow.xp_competitor),
        xp_generosity: Number(userRow.xp_generosity),
        xp_knowledge: Number(userRow.xp_knowledge),
        xp_explorer: Number(userRow.xp_explorer),
        prestige_cycle_boost_expires_at: userRow.prestige_cycle_boost_expires_at
          ? userRow.prestige_cycle_boost_expires_at.toISOString()
          : null,
      };

      // Check for active XP booster in DB (overrides caller-provided value)
      const boosterRows = await client
        .select({ id: schema.userXpBoosters.id })
        .from(schema.userXpBoosters)
        .where(and(eq(schema.userXpBoosters.userId, body.userId), gt(schema.userXpBoosters.expiresAt, sql`NOW()`)))
        .limit(1);
      const hasActiveXPBooster = boosterRows.length > 0;
      // Override the multiplier context with the real value
      body.multiplierContext.hasActiveXPBooster = hasActiveXPBooster;

      // Check for active Flash XP event (PRD §2.4, §8, §25):
      // When a flash_xp_event has been fired (fired=TRUE) and is still within
      // its window (fires_at <= NOW() <= ends_at), apply the event's multiplier
      // on top of all other multipliers. Users benefit automatically — no opt-in needed.
      const flashRows = await client
        .select({ multiplier: sql<string>`${schema.flashXpEvents.multiplier}::TEXT` })
        .from(schema.flashXpEvents)
        .where(
          and(
            eq(schema.flashXpEvents.isActive, true),
            eq(schema.flashXpEvents.fired, true),
            sql`${schema.flashXpEvents.firesAt} <= NOW()`,
            gt(schema.flashXpEvents.endsAt, sql`NOW()`)
          )
        )
        .orderBy(desc(schema.flashXpEvents.multiplier))
        .limit(1);
      const activeFlashMultiplier = flashRows.length > 0 ? parseFloat(flashRows[0].multiplier) : 1.0;

      // Check for active cultural platform_events that apply an XP multiplier.
      // Events with female_creator_only=true in metadata only apply to female creators.
      const culturalRows = await client
        .select({
          xp_multiplier: sql<string>`${schema.platformEvents.xpMultiplier}::TEXT`,
          metadata: schema.platformEvents.metadata,
        })
        .from(schema.platformEvents)
        .where(
          and(
            eq(schema.platformEvents.eventType, "cultural"),
            sql`${schema.platformEvents.startsAt} <= NOW()`,
            gt(schema.platformEvents.endsAt, sql`NOW()`),
            sql`${schema.platformEvents.xpMultiplier} > 1`
          )
        )
        .orderBy(desc(schema.platformEvents.xpMultiplier))
        .limit(5);
      let activeCulturalMultiplier = 1.0;
      for (const evt of culturalRows) {
        const meta = (evt.metadata as Record<string, unknown>) ?? {};
        const femaleOnly = meta.female_creator_only === true;
        if (femaleOnly) {
          const isFemaleCreator = user.gender === 'female' && user.is_creator;
          if (!isFemaleCreator) continue;
        }
        const multiplier = parseFloat(evt.xp_multiplier);
        if (multiplier > activeCulturalMultiplier) activeCulturalMultiplier = multiplier;
      }

      // 2. Calculate XP using engine
      const MESSAGING_ACTIONS = new Set<XPAction>([
        "send_text_message",
        "send_sticker",
        "send_gift_message",
        "receive_gift_and_react",
        "send_room_message",
      ]);
      const ctx: XPMultiplierContext = {
        plan: body.multiplierContext.plan,
        guildTier: body.multiplierContext.guildTier,
        hasActiveSeasonPass: body.multiplierContext.hasActiveSeasonPass,
        hasActiveXPBooster: body.multiplierContext.hasActiveXPBooster,
        prestigeCycleBoostExpiresAt: user.prestige_cycle_boost_expires_at,
        isMessagingAction: MESSAGING_ACTIONS.has(body.action),
      };

      const baseXp = calculateXPForAction(body.action, body.options);
      // Apply base multipliers from plan/guild/season/booster stack
      const baseAwardedXp = applyMultipliers(baseXp, ctx);
      // Apply Flash XP event multiplier on top (integer floor to stay precise)
      const afterFlash = activeFlashMultiplier > 1.0
        ? Math.floor(baseAwardedXp * activeFlashMultiplier)
        : baseAwardedXp;
      // Apply cultural event multiplier (e.g. Women's Month female creator boost)
      const xpAwarded = activeCulturalMultiplier > 1.0
        ? Math.floor(afterFlash * activeCulturalMultiplier)
        : afterFlash;

      if (xpAwarded <= 0) {
        return { xpAwarded: 0, newTotal: user.xp_total, rankUp: undefined };
      }

      // 3. Determine which track this action affects (in addition to main)
      const track = ACTION_TRACKS[body.action] ?? null;

      // 4. Write to xp_ledger (append-only)
      await client.insert(schema.xpLedger).values({
        // xp_ledger has no `multiplier` column (it is derivable as amount / base_amount).
        userId: body.userId,
        amount: xpAwarded,
        track: track ?? "main",
        source: body.action,
        baseAmount: baseXp,
      });

      // 5. Compute new totals and rank
      const newXpTotal = user.xp_total + xpAwarded;
      const newLegacyScore = user.legacy_score + xpAwarded;

      const rankBefore = getRankForXP(user.xp_total);
      const rankAfter = getRankForXP(newXpTotal);

      // Update track XP column if applicable
      let newTrackXp: number | null = null;
      let newTrackLevel: number | null = null;
      const trackUpdates: Partial<typeof schema.users.$inferInsert> = {};
      if (track && TRACK_COLUMN[track]) {
        const currentTrackXp = ((user as unknown) as Record<string, number>)[`xp_${track}`] ?? 0;
        newTrackXp = currentTrackXp + xpAwarded;
        const trackLevelInfo = getTrackLevelForXP(track as Parameters<typeof getTrackLevelForXP>[0], newTrackXp);
        newTrackLevel = trackLevelInfo.level;

        const TRACK_XP_KEY: Record<string, keyof typeof schema.users.$inferInsert> = {
          social: "xpSocial",
          creator: "xpCreator",
          competitor: "xpCompetitor",
          generosity: "xpGenerosity",
          knowledge: "xpKnowledge",
          explorer: "xpExplorer",
        };
        const TRACK_LEVEL_KEY: Record<string, keyof typeof schema.users.$inferInsert> = {
          social: "levelSocial",
          creator: "levelCreator",
          competitor: "levelCompetitor",
          generosity: "levelGenerosity",
          knowledge: "levelKnowledge",
          explorer: "levelExplorer",
        };
        (trackUpdates as Record<string, unknown>)[TRACK_XP_KEY[track]] = BigInt(newTrackXp);
        (trackUpdates as Record<string, unknown>)[TRACK_LEVEL_KEY[track]] = newTrackLevel;
      }

      // 6. Atomic update of users row
      await client
        .update(schema.users)
        .set({
          xpTotal: BigInt(newXpTotal),
          legacyScore: BigInt(newLegacyScore),
          rankName: rankAfter.rankName,
          rankLevel: rankAfter.rankNumber,
          rankSublevel: rankAfter.sublevel,
          updatedAt: sql`NOW()`,
          ...trackUpdates,
        })
        .where(eq(schema.users.id, body.userId));

      // 7. Detect rank-up
      const didRankUp =
        rankAfter.rankName !== rankBefore.rankName ||
        rankAfter.sublevel !== rankBefore.sublevel;

      let rankUp: { from: string; to: string; sublevelFrom: number; sublevelTo: number } | undefined;
      if (didRankUp) {
        rankUp = {
          from: rankBefore.rankName,
          to: rankAfter.rankName,
          sublevelFrom: rankBefore.sublevel,
          sublevelTo: rankAfter.sublevel,
        };
        // Log the rank-up event
        await client
          .insert(schema.rankUpEvents)
          .values({
            userId: body.userId,
            rankFrom: rankBefore.rankName,
            rankTo: rankAfter.rankName,
            xpAtEvent: BigInt(newXpTotal),
          })
          .onConflictDoNothing()
          .catch(() => {});

        // Notify the user of their rank-up
        await client
          .insert(schema.notifications)
          .values({
            userId: body.userId,
            type: "rank_up",
            payload: { from: rankBefore.rankName, to: rankAfter.rankName, sublevelTo: rankAfter.sublevel },
            isRead: false,
          })
          .catch(() => {});

        // Elder mentorship rank-up celebration — notify both parties (PRD §7)
        const elderRows = await client
          .select({ elder_id: schema.elderMentorships.elderId })
          .from(schema.elderMentorships)
          .where(and(eq(schema.elderMentorships.menteeId, body.userId), isNull(schema.elderMentorships.endedAt)))
          .limit(1)
          .catch(() => [] as Array<{ elder_id: string }>);

        if (elderRows[0]) {
          const celebPayload = {
            menteeId: body.userId,
            elderId: elderRows[0].elder_id,
            rankTo: rankAfter.rankName,
          };
          await Promise.all([
            client
              .insert(schema.notifications)
              .values({ userId: elderRows[0].elder_id, type: "mentee_rank_up", payload: celebPayload, isRead: false })
              .catch(() => {}),
            client
              .insert(schema.notifications)
              .values({ userId: body.userId, type: "mentee_rank_up_self", payload: celebPayload, isRead: false })
              .catch(() => {}),
          ]);
        }
      }

      // 8. Update leaderboard_snapshots (upsert for main + city scopes, plus track-specific)
      // NOTE: the actual unique index on leaderboard_snapshots (see
      // lib/db/schema.ts) is an expression index on
      // (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, '')),
      // not a plain (user_id, track, scope, city, season_id) constraint — the
      // conflict target below matches the real index so the upsert can
      // actually take its DO UPDATE path; every call is still wrapped in
      // .catch() exactly as before, so the outer transaction is never put at
      // risk by this best-effort read-model write.
      await client.execute(sql`
        INSERT INTO leaderboard_snapshots (user_id, track, scope, city, xp_value, updated_at)
        VALUES (${body.userId}, 'main', 'global', NULL, ${newXpTotal}, NOW())
        ON CONFLICT (user_id, track, scope, (COALESCE(city, '')), (COALESCE(season_id::text, '')))
        DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()
      `).catch(() => {
        // leaderboard_snapshots may not exist yet – non-fatal
      });

      if (user.city) {
        await client.execute(sql`
          INSERT INTO leaderboard_snapshots (user_id, track, scope, city, xp_value, updated_at)
          VALUES (${body.userId}, 'main', 'city', ${user.city}, ${newXpTotal}, NOW())
          ON CONFLICT (user_id, track, scope, (COALESCE(city, '')), (COALESCE(season_id::text, '')))
          DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()
        `).catch(() => {});
      }

      // BUG-056: Also upsert track-specific leaderboard rows so per-track
      // leaderboards reflect the awarded XP in real time.
      if (track && TRACK_COLUMN[track] && newTrackXp !== null) {
        await client.execute(sql`
          INSERT INTO leaderboard_snapshots (user_id, track, scope, city, xp_value, updated_at)
          VALUES (${body.userId}, ${track}, 'global', NULL, ${newTrackXp}, NOW())
          ON CONFLICT (user_id, track, scope, (COALESCE(city, '')), (COALESCE(season_id::text, '')))
          DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()
        `).catch(() => {});
        if (user.city) {
          await client.execute(sql`
            INSERT INTO leaderboard_snapshots (user_id, track, scope, city, xp_value, updated_at)
            VALUES (${body.userId}, ${track}, 'city', ${user.city}, ${newTrackXp}, NOW())
            ON CONFLICT (user_id, track, scope, (COALESCE(city, '')), (COALESCE(season_id::text, '')))
            DO UPDATE SET xp_value = EXCLUDED.xp_value, updated_at = NOW()
          `).catch(() => {});
        }
      }

      return {
        xpAwarded,
        newTotal: newXpTotal,
        rankUp,
        track: track ?? null,
        newTrackXp,
        newTrackLevel,
        // newTrackLevel is needed for milestone checking below — pass it through
        _trackForMilestones: track,
        _newTrackLevelForMilestones: newTrackLevel,
      };
    });

    // Check and award track milestones outside the transaction (best-effort, non-blocking).
    // We do this after the transaction commits so that the level write is durable first.
    let milestoneUnlocks: TrackMilestone[] = [];
    const stickerPacksAwarded: string[] = [];
    if (result._trackForMilestones && result._newTrackLevelForMilestones !== null) {
      const trackLevel = result._newTrackLevelForMilestones as number;
      try {
        milestoneUnlocks = await checkAndAwardTrackMilestones(
          body.userId,
          result._trackForMilestones,
          trackLevel,
          await getDb()
        );
        // Award sticker packs for each newly unlocked milestone
        for (const milestone of milestoneUnlocks) {
          try {
            const orm = await getDb();
            const awarded = await awardMilestoneStickers(body.userId, milestone.unlockKey, orm);
            stickerPacksAwarded.push(...awarded);
          } catch {
            // Non-fatal — sticker grant failure never breaks XP award
          }
        }
      } catch (err) {
        // Milestone check failure must never break the XP award response
        logger.error({ err: err }, "[xp/award] Milestone check failed (non-fatal):");
      }
    }

    // Check and mark New Member Quest step completions (best-effort, non-blocking).
    // Maps XP action types to the corresponding quest step IDs. Delegates to the
    // shared engine (lib/quests/newMemberQuestEngine.ts) used by every other
    // action route so there is a single source of truth for this write.
    const NEW_MEMBER_QUEST_STEP_MAP: Partial<Record<XPAction, NewMemberQuestStepId>> = {
      send_text_message:    "send_message",
      join_new_room:        "join_room",
      send_gift_message:    "gift_someone",
      add_new_friend:       "add_friend",
      daily_login:          "daily_login",
    };

    const questStep = NEW_MEMBER_QUEST_STEP_MAP[body.action];
    if (questStep) {
      void advanceNewMemberQuestStep(orm, body.userId, questStep);
    }

    // Nemesis overtake check — fire notification if user just surpassed their nemesis (PRD §2.3)
    void (async () => {
      try {
        const nemesisRows = await orm
          .select({
            nemesis_user_id: schema.nemesisAssignments.nemesisUserId,
            nemesis_xp: schema.users.xpTotal,
          })
          .from(schema.nemesisAssignments)
          .innerJoin(schema.users, eq(schema.users.id, schema.nemesisAssignments.nemesisUserId))
          .where(and(eq(schema.nemesisAssignments.userId, body.userId), eq(schema.nemesisAssignments.isActive, true)))
          .limit(1);
        if (!nemesisRows[0]) return;

        const { nemesis_user_id: nemesisId, nemesis_xp: nemesisXpRaw } = nemesisRows[0];
        const nemesisXP = Number(nemesisXpRaw);
        const xpBefore = result.newTotal - result.xpAwarded;
        const xpAfter  = result.newTotal;

        // User just overtook nemesis
        if (xpBefore < nemesisXP && xpAfter >= nemesisXP) {
          await orm
            .insert(schema.notifications)
            .values({
              userId: body.userId,
              type: "nemesis_overtaken",
              payload: { nemesisId, userXP: xpAfter, nemesisXP },
              isRead: false,
            })
            .catch(() => {});
        }
        // Nemesis check: if nemesis lost their lead, notify nemesis they were overtaken
        if (xpBefore < nemesisXP && xpAfter >= nemesisXP) {
          await orm
            .insert(schema.notifications)
            .values({
              userId: nemesisId,
              type: "nemesis_overtook_you",
              payload: { userId: body.userId, userXP: xpAfter, nemesisXP },
              isRead: false,
            })
            .catch(() => {});
        }
      } catch {
        // Nemesis check is non-fatal
      }
    })();

    // Strip internal fields before sending the response
    const { _trackForMilestones: _t, _newTrackLevelForMilestones: _l, ...publicResult } = result;
    void _t; void _l; // suppress unused variable warnings

    return NextResponse.json({ ...publicResult, milestoneUnlocks, stickerPacksAwarded }, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
}
