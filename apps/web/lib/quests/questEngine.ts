/**
 * lib/quests/questEngine.ts
 *
 * Daily quest deck engine.
 *
 * Each user gets a deck of 3–6 quests per day based on their plan:
 *  - free : 3 quests
 *  - plus : 4 quests
 *  - pro  : 5 quests
 *  - max  : 6 quests
 *
 * Completing the entire deck awards a 500 XP bonus.
 * Quests reset at midnight UTC (stored as quest_date = YYYY-MM-DD in UTC).
 */

import { randomBytes } from "crypto";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import type { Plan } from "@zobia/types";
import { creditCoins } from "@/lib/economy/coins";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";
import type { XPTrack } from "@/lib/xp/safeAwardXP";
import { publishRealtimeEvent } from "@/lib/realtime";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import { loadManifest, type ZobiaManifest } from "@/lib/manifest";
import {
  getEligibleSponsoredQuestTemplates,
  getSponsoredQuestSpendToday,
  recordSponsoredQuestImpression,
} from "@/lib/quests/sponsoredQuestPacing";

// Maps a ProgressionTrack name to the corresponding users table column
export const TRACK_COLUMN: Record<string, string> = {
  main: "xp_total",
  social: "xp_social",
  creator: "xp_creator",
  competitor: "xp_competitor",
  generosity: "xp_generosity",
  knowledge: "xp_knowledge",
  explorer: "xp_explorer",
  gaming: "xp_gaming",
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** XP bonus for completing every quest in today's deck. */
const DECK_COMPLETION_BONUS_XP = 500;

/** Number of quests per plan tier. */
const DECK_SIZE_BY_PLAN: Record<Plan, number> = {
  free: 3,
  plus: 4,
  pro: 5,
  max: 6,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestTemplate {
  id: string;
  title: string;
  description: string;
  action_type: string;
  target_count: number;
  xp_reward: number;
  coin_reward: number;
  category: string;
  icon: string | null;
  plan_required: Plan | null;
  /** Parallel progression track this quest's XP reward feeds (PRD §7), e.g. 'social', 'explorer'. */
  track: string;
  /** Manifest feature key gating this template (NULL = always eligible). */
  feature_key?: string | null;
}

/**
 * quest_templates.feature_key values used by the seeded feature-gated
 * templates (migration 0047) — each must be a real `manifest.features` key
 * so `manifest.features[key]` gates it correctly. Also the vocabulary
 * accepted by the admin quest-category boost picker (quest_feature_boosts).
 */
export const QUEST_FEATURE_KEYS: (keyof ZobiaManifest["features"])[] = [
  "games",
  "blogs",
  "wiki",
  "polls",
  "quizzes",
  "bbforum",
  "gifts",
  "rooms",
];

/**
 * The vocabulary of `quest_templates.action_type` values that some piece of
 * application code actually increments via triggerActivityQuestProgress()
 * (grep the call sites before adding to this list). This is NOT a DB enum —
 * action_type is a plain text column — but a quest whose action_type isn't
 * one of these can never make progress, since nothing in the codebase would
 * ever call triggerActivityQuestProgress() with a matching string. Used by
 * the admin Quests catalog (/gate44/quests) to constrain the action_type
 * picker on quest creation to values that are actually wired up.
 */
export const QUEST_ACTION_TYPES = [
  "messages",
  "room_join",
  "gift",
  "login_streak",
  "guild_quest",
  "xp_meta",
  "game_play",
  "blog_publish",
  "blog_comment",
  "wiki_edit",
  "poll_vote",
  "poll_create",
  "quiz_complete",
  "quiz_perfect",
  "forum_reply",
  "forum_create_thread",
  "market_purchase",
] as const;
export type QuestActionType = (typeof QUEST_ACTION_TYPES)[number];

export interface QuestDeckItem extends QuestTemplate {
  progress_count: number;
  completed: boolean;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// CSPRNG helpers
// ---------------------------------------------------------------------------

/**
 * Returns a cryptographically random integer in [0, max) using rejection
 * sampling to avoid modulo bias.
 */
function cryptoRandInt(max: number): number {
  if (max <= 1) return 0;
  const bytesNeeded = 4;
  const limit = 0x100000000 - (0x100000000 % max);
  let val: number;
  do {
    val = randomBytes(bytesNeeded).readUInt32BE(0);
  } while (val >= limit);
  return val % max;
}

// ---------------------------------------------------------------------------
// generateDailyDeck
// ---------------------------------------------------------------------------

/**
 * Generates (or returns cached) the daily quest deck for a user.
 *
 * Quest selection uses a cryptographically random Fisher-Yates shuffle
 * (crypto.randomBytes) — not a seeded deterministic source, so each call
 * may return a different ordering even for the same user and date.
 *
 * @param userId - UUID of the user requesting the deck.
 * @param plan   - The user's subscription plan.
 * @param db     - Drizzle db instance or an active transaction handle.
 * @returns Ordered array of quest deck items with current progress.
 */
export async function generateDailyDeck(
  userId: string,
  plan: Plan,
  db: DbOrTx
): Promise<QuestDeckItem[]> {
  const today = new Date().toISOString().slice(0, 10);
  const deckSize = DECK_SIZE_BY_PLAN[plan] ?? 3;

  // BUG-006 FIX: acquire a per-user+date distributed lock before inserting the
  // deck. Without this, two concurrent requests arriving at the same time (e.g.
  // two tabs opening simultaneously) could each insert a disjoint subset of
  // quests, producing a deck larger than deckSize — because ON CONFLICT DO
  // NOTHING operates per-row, not per-user+date.
  const lockKey = `quest_deck_lock:${userId}:${today}`;
  const lockValue = randomBytes(16).toString("hex");
  const LOCK_TTL_SECONDS = 10;

  // REDIS-COST-01: check for an existing deck BEFORE taking the lock.
  //
  // This function runs on every home-dashboard load. The lock exists solely to
  // stop two concurrent requests each inserting a disjoint subset of quests on
  // the ONE day a user's deck is first generated (BUG-006) — but it used to be
  // acquired unconditionally, costing a SET NX, a GET and a DEL (three Redis
  // commands) on every single home load for the rest of that user's life, to
  // guard an operation that had already happened. Reading the deck first means
  // the lock is only taken on a genuine miss: once per user per day, instead of
  // once per page view.
  const preCheckDeck = await db
    .select({ questId: schema.userQuestDecks.questId })
    .from(schema.userQuestDecks)
    .where(and(eq(schema.userQuestDecks.userId, userId), eq(schema.userQuestDecks.assignedDate, today)))
    .limit(1);

  let lockHeld = false;
  if (preCheckDeck.length === 0) {
    // BUG-006 FIX: acquire a per-user+date distributed lock before inserting the
    // deck. Without this, two concurrent requests arriving at the same time (e.g.
    // two tabs opening simultaneously) could each insert a disjoint subset of
    // quests, producing a deck larger than deckSize — because ON CONFLICT DO
    // NOTHING operates per-row, not per-user+date.
    const acquired = await redis.set(lockKey, lockValue, "EX", LOCK_TTL_SECONDS, "NX");
    lockHeld = acquired === "OK";

    if (!lockHeld) {
      // Another instance is generating the deck — wait briefly then fall through
      // to the re-query below (the other instance will have persisted the rows).
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  try {
    // BUG-009 FIX: re-read inside the lock. The pre-check above raced with any
    // other instance that may have been mid-insert; this second read is the
    // authoritative one, and it is the read the INSERT decision is made on.
    // Skipped entirely when the pre-check already found a deck, so the common
    // case still costs exactly one query.
    const existingDeck =
      preCheckDeck.length > 0
        ? preCheckDeck
        : await db
            .select({ questId: schema.userQuestDecks.questId })
            .from(schema.userQuestDecks)
            .where(and(eq(schema.userQuestDecks.userId, userId), eq(schema.userQuestDecks.assignedDate, today)))
            .limit(1);

    let sponsoredSlot: { id: string; sponsoredQuestId: string; costCredits: number } | null = null;

    if (existingDeck.length === 0) {
      // loadManifest() is in-process memory cached (zero Redis calls when
      // warm — see lib/manifest/index.ts) so this doesn't add to Redis load.
      const manifest = await loadManifest();
      const enabledFeatureKeys = QUEST_FEATURE_KEYS.filter((key) => manifest.features[key]);

      // Plan hierarchy (BUG-QS01): a user's plan unlocks quests requiring
      // their own tier and every tier below it.
      const allowedPlanTiers: string[] = ["free"];
      if (plan === "plus" || plan === "pro" || plan === "max") allowedPlanTiers.push("plus");
      if (plan === "pro" || plan === "max") allowedPlanTiers.push("pro");
      if (plan === "max") allowedPlanTiers.push("max");

      // Fetch ALL eligible quest templates for this plan without a DB-level shuffle.
      // Selection is done in application code via a CSPRNG-based Fisher-Yates shuffle
      // so no key material is passed to the DB and the shuffle is cryptographically
      // unpredictable. Templates for a disabled feature (feature_key not in the
      // enabled list) and sponsored-quest shadow rows (handled separately below)
      // are excluded at the SQL level.
      const allTemplatesRaw = await db
        .select({
          id: schema.questTemplates.id,
          title: schema.questTemplates.title,
          description: schema.questTemplates.description,
          actionType: schema.questTemplates.actionType,
          targetCount: schema.questTemplates.targetCount,
          xpReward: schema.questTemplates.xpReward,
          coinReward: schema.questTemplates.coinReward,
          category: schema.questTemplates.category,
          icon: schema.questTemplates.icon,
          planRequired: schema.questTemplates.planRequired,
          track: schema.questTemplates.track,
          featureKey: schema.questTemplates.featureKey,
        })
        .from(schema.questTemplates)
        .where(
          and(
            eq(schema.questTemplates.isActive, true),
            isNull(schema.questTemplates.sponsoredQuestId),
            or(isNull(schema.questTemplates.validDate), eq(schema.questTemplates.validDate, today)),
            or(
              isNull(schema.questTemplates.featureKey),
              inArray(schema.questTemplates.featureKey, enabledFeatureKeys)
            ),
            or(
              isNull(schema.questTemplates.planRequired),
              inArray(schema.questTemplates.planRequired, allowedPlanTiers)
            )
          )
        );

      const allTemplates: QuestTemplate[] = allTemplatesRaw.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        action_type: r.actionType,
        target_count: r.targetCount,
        xp_reward: r.xpReward,
        coin_reward: r.coinReward,
        category: r.category,
        icon: r.icon,
        plan_required: r.planRequired as Plan | null,
        track: r.track ?? "main",
        feature_key: r.featureKey,
      }));

      // Admin "campaign boost" (PRD quests request — promote a feature's
      // quests for a date range). Weight is applied by replicating a
      // boosted template a few extra times in the shuffle pool: a cheap,
      // auditable approximation of weighted sampling that keeps the
      // existing CSPRNG Fisher-Yates shuffle untouched. Capped at 5x so one
      // huge weight can't crowd out every other quest category.
      const activeBoosts = await db
        .select({
          featureKey: schema.questFeatureBoosts.featureKey,
          weightMultiplier: schema.questFeatureBoosts.weightMultiplier,
        })
        .from(schema.questFeatureBoosts)
        .where(
          and(
            lte(schema.questFeatureBoosts.startsAt, sql`NOW()`),
            gte(schema.questFeatureBoosts.endsAt, sql`NOW()`)
          )
        );
      const boostByFeature = new Map(activeBoosts.map((b) => [b.featureKey, Number(b.weightMultiplier)]));

      const pool: QuestTemplate[] = [];
      for (const t of allTemplates) {
        pool.push(t);
        const weight = t.feature_key ? boostByFeature.get(t.feature_key) : undefined;
        if (weight && weight > 1) {
          const extraCopies = Math.min(Math.round(weight) - 1, 4);
          for (let i = 0; i < extraCopies; i++) pool.push(t);
        }
      }

      // Fisher-Yates shuffle using crypto.randomBytes — O(n) in-place, unbiased
      for (let i = pool.length - 1; i > 0; i--) {
        const j = cryptoRandInt(i + 1);
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      // De-dupe replicated boost copies before slicing — the replication
      // above is only meant to bias *which* templates survive the shuffle,
      // not to let one template occupy two deck slots.
      const seen = new Set<string>();
      const shuffled = pool.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
      const selectedTemplates = shuffled.slice(0, deckSize);

      // Sponsored Quest injection (PRD sponsored quests — "infused into
      // daily quests"): with probability sponsoredDailySlotChance, swap the
      // deck's last slot for a budget-eligible Sponsored Quest.
      if (manifest.questSystem.sponsoredInjectionEnabled && selectedTemplates.length > 0) {
        const roll = cryptoRandInt(1_000_000) / 1_000_000;
        if (roll < manifest.questSystem.sponsoredDailySlotChance) {
          const candidates = await getEligibleSponsoredQuestTemplates(db);
          const affordable: typeof candidates = [];
          for (const c of candidates) {
            const cpm = Number(c.cpm_credits) || manifest.questSystem.sponsoredDefaultCpmCredits;
            const costCredits = cpm / 1000;
            if (c.daily_budget_credits) {
              const spentToday = await getSponsoredQuestSpendToday(db, c.sponsored_quest_id);
              if (spentToday + costCredits > Number(c.daily_budget_credits)) continue;
            }
            affordable.push(c);
          }
          if (affordable.length > 0) {
            const pick = affordable[cryptoRandInt(affordable.length)];
            const cpm = Number(pick.cpm_credits) || manifest.questSystem.sponsoredDefaultCpmCredits;
            selectedTemplates[selectedTemplates.length - 1] = {
              id: pick.id,
              title: pick.title,
              description: pick.description,
              action_type: pick.action_type,
              target_count: pick.target_count,
              xp_reward: pick.xp_reward,
              coin_reward: pick.coin_reward,
              category: pick.category,
              icon: pick.icon,
              plan_required: pick.plan_required as Plan | null,
              track: pick.track,
              feature_key: null,
            };
            sponsoredSlot = { id: pick.id, sponsoredQuestId: pick.sponsored_quest_id, costCredits: cpm / 1000 };
          }
        }
      }

      if (selectedTemplates.length > 0) {
        const questIds = selectedTemplates.map((t) => t.id);
        await db
          .insert(schema.userQuestDecks)
          .values(questIds.map((questId) => ({ userId, questId, assignedDate: today })))
          .onConflictDoNothing();

        // Bill the impression only once the deck is actually persisted, and
        // only on this (the deck-generating) call — a concurrent request
        // that lost the lock re-queries the DB below instead of billing again.
        if (sponsoredSlot) {
          await recordSponsoredQuestImpression(db, sponsoredSlot.sponsoredQuestId, userId, sponsoredSlot.costCredits);
        }
      }
    }
  } finally {
    // Release the lock only if we still own it (avoid releasing a lock taken by
    // another instance after our TTL expired). Skipped entirely when we never
    // took the lock, which is the overwhelmingly common path.
    //
    // The compare-and-delete runs as one Lua script rather than GET-then-DEL:
    // that is both atomic (closing the window where the TTL expires and another
    // instance acquires the lock between our read and our delete) and one Redis
    // round-trip instead of two.
    if (lockHeld) {
      await redis
        .eval(
          `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`,
          1,
          lockKey,
          lockValue
        )
        .catch(() => {});
    }
  }

  // BUG-009 FIX: always re-query user_quest_decks + quest_templates after the
  // INSERT so the returned array reflects what is actually in the DB in a
  // stable, deterministic order (id ASC). Returning the in-memory shuffled
  // array produced different orderings on repeated calls within the same day.
  const assignedRows = await db
    .select({
      id: schema.questTemplates.id,
      title: schema.questTemplates.title,
      description: schema.questTemplates.description,
      actionType: schema.questTemplates.actionType,
      targetCount: schema.questTemplates.targetCount,
      xpReward: schema.questTemplates.xpReward,
      coinReward: schema.questTemplates.coinReward,
      category: schema.questTemplates.category,
      icon: schema.questTemplates.icon,
      planRequired: schema.questTemplates.planRequired,
      track: schema.questTemplates.track,
      progressCount: sql<number>`COALESCE(${schema.userQuestProgress.progressCount}, 0)`,
      completed: sql<boolean>`COALESCE(${schema.userQuestProgress.completed}, FALSE)`,
      completedAt: schema.userQuestProgress.completedAt,
    })
    .from(schema.userQuestDecks)
    .innerJoin(schema.questTemplates, eq(schema.questTemplates.id, schema.userQuestDecks.questId))
    .leftJoin(
      schema.userQuestProgress,
      and(
        eq(schema.userQuestProgress.userId, userId),
        eq(schema.userQuestProgress.questId, schema.questTemplates.id),
        eq(schema.userQuestProgress.questDate, today)
      )
    )
    .where(and(eq(schema.userQuestDecks.userId, userId), eq(schema.userQuestDecks.assignedDate, today)))
    .orderBy(asc(schema.userQuestDecks.id));

  return assignedRows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    action_type: row.actionType,
    target_count: row.targetCount,
    xp_reward: row.xpReward,
    coin_reward: row.coinReward,
    category: row.category,
    icon: row.icon,
    plan_required: row.planRequired as Plan | null,
    track: row.track ?? "main",
    progress_count: Number(row.progressCount),
    completed: Boolean(row.completed),
    completed_at: row.completedAt ? new Date(row.completedAt).toISOString() : null,
  }));
}

// ---------------------------------------------------------------------------
// updateQuestProgress
// ---------------------------------------------------------------------------

/**
 * Increments a user's progress on a specific quest.
 * Marks the quest complete if the target is reached.
 * Awards XP + coins on first completion (idempotent).
 *
 * @param userId    - UUID of the user.
 * @param questId   - UUID of the quest template.
 * @param increment - How much to add to the progress counter (default 1).
 * @param db        - Drizzle db instance or an active transaction handle.
 * @returns The updated progress state and any rewards awarded.
 */
export async function updateQuestProgress(
  userId: string,
  questId: string,
  increment: number = 1,
  db: DbOrTx
): Promise<{
  progress_count: number;
  completed: boolean;
  newly_completed: boolean;
  xp_awarded: number;
  coins_awarded: number;
}> {
  // BUG-022 FIX: reject non-positive increments before touching the DB.
  // A zero or negative increment would decrement progress or be a no-op,
  // neither of which is a valid quest progress update. Callers that pass
  // a negative increment (e.g. due to a sign-flip bug) would silently corrupt
  // quest progress without this guard.
  if (typeof increment !== "number" || !Number.isFinite(increment) || increment <= 0) {
    throw new Error(`[questEngine] updateQuestProgress: increment must be a positive number, got ${increment}`);
  }

  const today = new Date().toISOString().slice(0, 10);

  // Collect XP/coin award details inside the transaction and issue the
  // actual award only AFTER the transaction commits. This prevents phantom
  // DLQ entries: if the transaction rolls back, there is no XP to award and
  // no DLQ entry should be written.
  //
  // NOTE: coin crediting (creditCoins, lib/economy/coins.ts) is deferred
  // post-commit rather than run inside this Drizzle transaction because
  // lib/economy/coins.ts has not yet been migrated off the raw
  // TransactionClient interface (it is out of scope for this migration) and
  // cannot accept a Drizzle transaction handle. This mirrors the pre-existing
  // deferred-XP pattern below but is a small atomicity change from the
  // original behaviour, where the coin credit ran inside the same DB
  // transaction as the quest-progress write. See migration report.
  let pendingXP: { amount: number; track: XPTrack; ref: string } | null = null;
  let pendingCoinCredit: { amount: number; ref: string } | null = null;
  // PRD §7 (Elder System): Elder earns 10% of a Mentee's quest XP as a Mentorship Bonus.
  let pendingElderBonus: { elderId: string; amount: number; ref: string; menteeId: string } | null = null;

  const orm = await getDb();
  const result = await orm.transaction(async (tx) => {
    const [quest] = await tx
      .select({
        id: schema.questTemplates.id,
        targetCount: schema.questTemplates.targetCount,
        xpReward: schema.questTemplates.xpReward,
        coinReward: schema.questTemplates.coinReward,
        actionType: schema.questTemplates.actionType,
        category: schema.questTemplates.category,
        icon: schema.questTemplates.icon,
        planRequired: schema.questTemplates.planRequired,
        track: schema.questTemplates.track,
        sponsoredQuestId: schema.questTemplates.sponsoredQuestId,
      })
      .from(schema.questTemplates)
      .where(
        and(
          eq(schema.questTemplates.id, questId),
          eq(schema.questTemplates.isActive, true),
          or(isNull(schema.questTemplates.validDate), eq(schema.questTemplates.validDate, today))
        )
      )
      .limit(1);
    if (!quest) throw new Error(`[questEngine] Quest not found: ${questId}`);

    const [deckCheck] = await tx
      .select({ questId: schema.userQuestDecks.questId })
      .from(schema.userQuestDecks)
      .where(
        and(
          eq(schema.userQuestDecks.userId, userId),
          eq(schema.userQuestDecks.questId, questId),
          eq(schema.userQuestDecks.assignedDate, today)
        )
      )
      .limit(1);
    if (!deckCheck) throw new Error(`[questEngine] Quest ${questId} not in user's deck`);

    const [current] = await tx
      .select({
        progressCount: schema.userQuestProgress.progressCount,
        completed: schema.userQuestProgress.completed,
      })
      .from(schema.userQuestProgress)
      .where(
        and(
          eq(schema.userQuestProgress.userId, userId),
          eq(schema.userQuestProgress.questId, questId),
          eq(schema.userQuestProgress.questDate, today)
        )
      )
      .for("update");

    if (current?.completed) {
      return {
        progress_count: current.progressCount,
        completed: true,
        newly_completed: false,
        xp_awarded: 0,
        coins_awarded: 0,
      };
    }

    const prevCount = current?.progressCount ?? 0;
    const newCount = Math.min(prevCount + increment, quest.targetCount);
    const nowCompleted = newCount >= quest.targetCount;

    if (current) {
      await tx
        .update(schema.userQuestProgress)
        .set({
          progressCount: newCount,
          completed: nowCompleted,
          completedAt: nowCompleted ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.userQuestProgress.userId, userId),
            eq(schema.userQuestProgress.questId, questId),
            eq(schema.userQuestProgress.questDate, today)
          )
        );
    } else {
      await tx.insert(schema.userQuestProgress).values({
        userId,
        questId,
        questDate: today,
        progressCount: newCount,
        completed: nowCompleted,
        completedAt: nowCompleted ? new Date() : null,
      });
    }

    let xpAwarded = 0;
    let coinsAwarded = 0;

    if (nowCompleted) {
      xpAwarded = quest.xpReward;
      coinsAwarded = quest.coinReward;

      // Quest XP is routed by quest_templates.track (e.g. 'social', 'explorer',
      // 'generosity') — NOT by ACTION_TRACKS, which is keyed by XPAction values
      // from lib/xp/engine.ts and uses a different naming namespace than
      // quest_templates.action_type (e.g. 'send_text_message' vs 'messages').
      // Looking action_type up in ACTION_TRACKS never matched, so every quest
      // completion silently fell back to the main track regardless of category.
      const questTrack = quest.track ?? "main";
      const xpTrack = (TRACK_COLUMN[questTrack] ? questTrack : "main") as XPTrack;
      if (!TRACK_COLUMN[questTrack]) {
        logger.warn({ questId, track: questTrack }, "[questEngine] unknown quest track — awarding main XP");
      }
      const questCompletionRef = `quest:${questId}:${userId}:${today}`;

      // Defer XP award to post-commit; record intent here
      pendingXP = { amount: xpAwarded, track: xpTrack, ref: questCompletionRef };

      // Coin award also deferred to post-commit — see note above pendingCoinCredit.
      // SYS-CL-01: per-user, per-day reference (mirrors questCompletionRef above) — a bare
      // questId would collide across every user completing the same quest template.
      if (coinsAwarded > 0) {
        pendingCoinCredit = { amount: coinsAwarded, ref: questCompletionRef };
      }

      // Sponsored Quests panel stats (creator/owner-facing) — non-blocking.
      if (quest.sponsoredQuestId) {
        await tx
          .update(schema.sponsoredQuests)
          .set({ completionsCount: sql`${schema.sponsoredQuests.completionsCount} + 1` })
          .where(eq(schema.sponsoredQuests.id, quest.sponsoredQuestId))
          .catch((err: unknown) =>
            logger.error(
              { err, sponsoredQuestId: quest.sponsoredQuestId },
              "[questEngine] Failed to bump sponsored quest completions_count"
            )
          );
      }

      // PRD §7: Elder mentorship bonus — 10% of quest XP to the user's active Elder mentor.
      const [elder] = await tx
        .select({ elderId: schema.elderMentorships.elderId })
        .from(schema.elderMentorships)
        .where(and(eq(schema.elderMentorships.menteeId, userId), eq(schema.elderMentorships.status, "active")))
        .limit(1);
      const elderBonus = Math.floor(xpAwarded * 0.1);
      if (elder && elderBonus > 0) {
        pendingElderBonus = {
          elderId: elder.elderId,
          amount: elderBonus,
          ref: `mentorship_bonus:${questCompletionRef}`,
          menteeId: userId,
        };
      }
    }

    return {
      progress_count: newCount,
      completed: nowCompleted,
      newly_completed: nowCompleted,
      xp_awarded: xpAwarded,
      coins_awarded: coinsAwarded,
    };
  });

  // Issue coin credit after the transaction commits (see note above).
  const capturedCoinCredit = pendingCoinCredit as { amount: number; ref: string } | null;
  if (capturedCoinCredit) {
    try {
      await creditCoins(userId, capturedCoinCredit.amount, "quest_reward", capturedCoinCredit.ref, "Daily quest reward", {});
    } catch (err) {
      logger.error({ err, userId, questId }, "[questEngine] Failed to credit quest coin reward (non-fatal)");
    }
  }

  // Issue XP award after the transaction commits so a rollback doesn't leave
  // a phantom DLQ entry for XP that was never actually lost.
  // Type assertion needed because TS narrows `let` vars assigned inside async callbacks to their
  // initial type (null) after the await; the runtime value is correct.
  const capturedXP = pendingXP as { amount: number; track: XPTrack; ref: string } | null;
  if (capturedXP) {
    await safeAwardXP(userId, capturedXP.amount, capturedXP.track, "quest_complete", capturedXP.ref);
  }

  const capturedElderBonus = pendingElderBonus as { elderId: string; amount: number; ref: string; menteeId: string } | null;
  if (capturedElderBonus) {
    await safeAwardXP(capturedElderBonus.elderId, capturedElderBonus.amount, "main", "mentorship_bonus", capturedElderBonus.ref);
    try {
      const { insertNotification } = await import("@/lib/notifications/insert");
      const notifyOrm = await getDb();
      await insertNotification(
        notifyOrm,
        capturedElderBonus.elderId,
        "mentorship_bonus",
        "Mentorship bonus earned!",
        `Your mentee earned ${capturedElderBonus.amount} XP for you by completing a quest.`,
        { menteeId: capturedElderBonus.menteeId, bonusXP: capturedElderBonus.amount }
      );
    } catch (err) {
      logger.error({ err, elderId: capturedElderBonus.elderId }, "[questEngine] Failed to notify elder of mentorship bonus (non-fatal)");
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// checkDeckCompletion
// ---------------------------------------------------------------------------

/**
 * Checks whether a user has completed their entire daily quest deck.
 * If all quests are complete and the bonus hasn't been awarded yet,
 * awards the 500 XP deck completion bonus.
 *
 * @param userId - UUID of the user.
 * @param date   - ISO date string (YYYY-MM-DD) to check. Defaults to today UTC.
 * @param db     - Drizzle db instance or an active transaction handle.
 * @returns Whether the deck was completed and whether the bonus was newly awarded.
 */
export async function checkDeckCompletion(
  userId: string,
  date: string,
  db: DbOrTx
): Promise<{ deckComplete: boolean; bonusAwarded: boolean; bonusXP: number }> {
  // Track whether we should issue XP after the transaction commits.
  let shouldAwardBonus = false;
  const deckRef = `deck_completion:${userId}:${date}`;

  const orm = await getDb();
  const result = await orm.transaction(async (tx) => {
    // Lock user row to serialize concurrent calls
    await tx
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .for("update");

    // Check quest completion for the user's assigned deck only.
    // Without the deck filter, progress on quests from other decks would
    // incorrectly count toward completion of today's assigned deck (BUG-008).
    const [row] = await tx
      .select({
        total: sql<string>`(SELECT COUNT(*) FROM ${schema.userQuestDecks}
          WHERE ${schema.userQuestDecks.userId} = ${userId} AND ${schema.userQuestDecks.assignedDate} = ${date}::date)`,
        completedCount: sql<string>`COUNT(*) FILTER (WHERE ${schema.userQuestProgress.completed} = TRUE)`,
        bonusAlreadyAwarded: sql<boolean>`EXISTS (
          SELECT 1 FROM ${schema.xpLedger}
          WHERE ${schema.xpLedger.userId} = ${userId} AND ${schema.xpLedger.source} = 'deck_completion'
            AND ${schema.xpLedger.referenceId} = ${deckRef}
        )`,
      })
      .from(schema.userQuestProgress)
      .where(
        and(
          eq(schema.userQuestProgress.userId, userId),
          eq(schema.userQuestProgress.questDate, date),
          sql`${schema.userQuestProgress.questId} IN (
            SELECT ${schema.userQuestDecks.questId} FROM ${schema.userQuestDecks}
            WHERE ${schema.userQuestDecks.userId} = ${userId} AND ${schema.userQuestDecks.assignedDate} = ${date}::date
          )`
        )
      );

    if (!row) return { deckComplete: false, bonusAwarded: false, bonusXP: 0 };

    const total = parseInt(row.total);
    const completed = parseInt(row.completedCount);
    const deckComplete = total > 0 && completed >= total;

    if (!deckComplete || row.bonusAlreadyAwarded) {
      return { deckComplete, bonusAwarded: false, bonusXP: 0 };
    }

    // Mark that bonus should be awarded post-commit (avoids phantom DLQ if tx rolls back)
    shouldAwardBonus = true;

    return { deckComplete: true, bonusAwarded: true, bonusXP: DECK_COMPLETION_BONUS_XP };
  });

  // Issue XP award after the transaction commits so a rollback doesn't leave
  // a phantom DLQ entry for XP that was never actually lost.
  if (shouldAwardBonus) {
    await safeAwardXP(userId, DECK_COMPLETION_BONUS_XP, "main", "deck_completion", deckRef);
  }

  return result;
}

// ---------------------------------------------------------------------------
// triggerActivityQuestProgress
// ---------------------------------------------------------------------------

/**
 * Find all quests in a user's current-day deck that match `actionType`,
 * increment each by 1, award rewards on completion, and fire realtime
 * `reward_earned` events.  Errors are swallowed — call fire-and-forget.
 *
 * @param userId     - UUID of the user performing the action
 * @param actionType - quest_templates.action_type to match (e.g. 'room_join')
 * @param dbAdapter  - Drizzle db instance or an active transaction handle.
 * @param increment  - How much to increment matching quests by (default 1).
 *                     Used by meta-quests like 'xp_meta' where the increment
 *                     equals the XP amount earned rather than a flat unit.
 */
export async function triggerActivityQuestProgress(
  userId: string,
  actionType: string,
  dbAdapter: DbOrTx,
  increment: number = 1
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const matchingQuests = await dbAdapter
      .select({ id: schema.questTemplates.id })
      .from(schema.questTemplates)
      .innerJoin(
        schema.userQuestDecks,
        and(
          eq(schema.userQuestDecks.questId, schema.questTemplates.id),
          eq(schema.userQuestDecks.userId, userId),
          eq(schema.userQuestDecks.assignedDate, today)
        )
      )
      .where(
        and(
          eq(schema.questTemplates.actionType, actionType),
          eq(schema.questTemplates.isActive, true),
          or(isNull(schema.questTemplates.validDate), eq(schema.questTemplates.validDate, today))
        )
      );

    if (matchingQuests.length === 0) return;

    let anyNewlyCompleted = false;

    for (const quest of matchingQuests) {
      try {
        const result = await updateQuestProgress(userId, quest.id, increment, dbAdapter);
        if (result.newly_completed) {
          anyNewlyCompleted = true;
          publishRealtimeEvent(`user:${userId}`, "reward_earned", {
            type: "quest_complete",
            xpAmount: result.xp_awarded,
            coinAmount: result.coins_awarded,
          }).catch(() => {});
        }
      } catch (err) {
        logger.error({ userId, questId: quest.id, err }, "[questEngine] updateQuestProgress failed (non-fatal)");
      }
    }

    if (anyNewlyCompleted) {
      try {
        const deckResult = await checkDeckCompletion(userId, today, dbAdapter);
        if (deckResult.bonusAwarded) {
          publishRealtimeEvent(`user:${userId}`, "reward_earned", {
            type: "deck_complete",
            xpAmount: deckResult.bonusXP,
            coinAmount: 0,
          }).catch(() => {});
        }
      } catch (err) {
        logger.error({ userId, err }, "[questEngine] checkDeckCompletion failed (non-fatal)");
      }
    }
  } catch (err) {
    logger.error({ userId, actionType, err }, "[questEngine] triggerActivityQuestProgress failed");
  }
}

// ---------------------------------------------------------------------------
// resetDailyQuests
// ---------------------------------------------------------------------------

/**
 * CRON: Resets all daily quest progress records for the new day.
 *
 * Only marks old records as "expired" — does not delete them so audit
 * history is preserved. New progress inserts happen on the new date automatically.
 *
 * @param db - Drizzle db instance or an active transaction handle.
 * @returns Number of quest progress rows that were cleared.
 */
export async function resetDailyQuests(db: DbOrTx): Promise<{ clearedRows: number }> {
  const todayUTC = new Date().toISOString().slice(0, 10);

  const cleared = await db
    .update(schema.userQuestProgress)
    .set({ expiredAt: new Date() })
    .where(and(sql`${schema.userQuestProgress.questDate} < ${todayUTC}::date`, isNull(schema.userQuestProgress.expiredAt)))
    .returning({ id: schema.userQuestProgress.id });

  // DATA-01: purge old expired rows to prevent unbounded table growth
  await db
    .delete(schema.userQuestProgress)
    .where(
      and(
        sql`${schema.userQuestProgress.expiredAt} IS NOT NULL`,
        sql`${schema.userQuestProgress.questDate} < ${todayUTC}::date - INTERVAL '7 days'`
      )
    )
    .catch((err: unknown) => {
      logger.error({ err }, "[questEngine] Failed to purge old user_quest_progress rows");
    });

  await db
    .delete(schema.userQuestDecks)
    .where(sql`${schema.userQuestDecks.assignedDate} < CURRENT_DATE - INTERVAL '30 days'`)
    .catch((err: unknown) => {
      logger.warn({ err }, "[questEngine] Failed to prune old user_quest_decks rows");
    });

  return { clearedRows: cleared.length };
}
