/**
 * lib/xp/trackMilestones.ts
 *
 * Track Milestone Unlock Engine
 *
 * Each of the six progression tracks has milestone levels that grant real
 * capability changes (titles, feature unlocks, bonuses). This module defines
 * every milestone, checks whether a user has newly reached them after an XP
 * award, and persists the grants to the database.
 *
 * Database tables expected:
 *   track_milestone_unlocks  (user_id, track, milestone_level, unlocked_at)
 *   user_badges              (user_id, badge_key, awarded_at)   — optional
 *
 * All writes are best-effort: if a table doesn't exist yet the error is caught
 * and logged rather than surfaced to the caller. The function still returns the
 * logically unlocked milestones so the API response is correct.
 */

import type { ProgressionTrack } from "@zobia/types";
import type { DatabaseAdapter } from "@/lib/db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TrackMilestone {
  track: ProgressionTrack;
  level: number;
  title: string;
  description: string;
  /** Stable identifier used to check/grant capability changes. */
  unlockKey: string;
}

// ─── Milestone definitions ────────────────────────────────────────────────────

/**
 * All track milestones across the six progression tracks.
 * Ordered by track then level ascending.
 */
export const TRACK_MILESTONES: TrackMilestone[] = [
  // ── Social ────────────────────────────────────────────────────────────────
  {
    track: "social",
    level: 5,
    title: "Talker",
    description: "Unlocks custom conversation badges to personalise your chats.",
    unlockKey: "social_custom_conversation_badges",
  },
  {
    track: "social",
    level: 25,
    title: "Connector",
    description: "Your group chats can now hold up to 500 members.",
    unlockKey: "social_group_chat_500",
  },
  {
    track: "social",
    level: 50,
    title: "The Connector",
    description: "You are now eligible for the Elder role on the platform.",
    unlockKey: "social_elder_eligibility",
  },

  // ── Creator ───────────────────────────────────────────────────────────────
  {
    track: "creator",
    level: 5,
    title: "Room Opener",
    description: "Your Rooms can now host up to 100 people.",
    unlockKey: "creator_rooms_100",
  },
  {
    track: "creator",
    level: 20,
    title: "Verified Creator",
    description: "Grants the verification badge and access to the Quest Marketplace.",
    unlockKey: "creator_verified_badge_quest_marketplace",
  },
  {
    track: "creator",
    level: 50,
    title: "Room God",
    description: "Revenue share boosted to 85% and your content gets featured in discovery.",
    unlockKey: "creator_revenue_share_85_discovery",
  },

  // ── Competitor ────────────────────────────────────────────────────────────
  {
    track: "competitor",
    level: 15,
    title: "Fighter",
    description: "The Nemesis system activates — you will be matched with rivals to surpass.",
    unlockKey: "competitor_nemesis_system",
  },
  {
    track: "competitor",
    level: 40,
    title: "Champion",
    description: "Unlocks head-to-head XP sprint challenges against other users.",
    unlockKey: "competitor_xp_sprint_challenges",
  },
  {
    track: "competitor",
    level: 50,
    title: "Arena King",
    description: "A trophy shelf is displayed on your public profile.",
    unlockKey: "competitor_trophy_shelf",
  },

  // ── Generosity ────────────────────────────────────────────────────────────
  {
    track: "generosity",
    level: 10,
    title: "Big Spender",
    description: "Your top-gifter notifications become more prominent across the platform.",
    unlockKey: "generosity_top_gifter_prominent",
  },
  {
    track: "generosity",
    level: 40,
    title: "Philanthropist",
    description: "Receive a 5% bonus on all future coin purchases.",
    unlockKey: "generosity_coin_purchase_bonus_5pct",
  },
  {
    track: "generosity",
    level: 50,
    title: "Big Donor",
    description: "Earns the Most Generous badge and a monthly spot on the Gifter Wall.",
    unlockKey: "generosity_most_generous_badge_gifter_wall",
  },

  // ── Knowledge ─────────────────────────────────────────────────────────────
  {
    track: "knowledge",
    level: 25,
    title: "Scholar",
    description: "You can now co-host ClassRooms as an educator.",
    unlockKey: "knowledge_cohost_classrooms",
  },
  {
    track: "knowledge",
    level: 40,
    title: "Sage",
    description: "You can create and publish quizzes inside ClassRooms.",
    unlockKey: "knowledge_create_publish_quizzes",
  },
  {
    track: "knowledge",
    level: 50,
    title: "The Scholar",
    description: "You can issue official Zobia Learning Certificates to students.",
    unlockKey: "knowledge_issue_learning_certificates",
  },

  // ── Explorer ──────────────────────────────────────────────────────────────
  {
    track: "explorer",
    level: 10,
    title: "Wanderer",
    description: "Your room pin limit increases — you can now pin up to 5 rooms.",
    unlockKey: "explorer_pin_limit_5",
  },
  {
    track: "explorer",
    level: 25,
    title: "Nomad",
    description: "You receive first-access notifications for new city-based rooms.",
    unlockKey: "explorer_city_room_first_access",
  },
  {
    track: "explorer",
    level: 50,
    title: "The Explorer",
    description: "A Rooms Visited counter is shown on your public profile.",
    unlockKey: "explorer_rooms_visited_counter",
  },
];

// ─── Helper: milestones for a given track ─────────────────────────────────────

function milestonesForTrack(track: string): TrackMilestone[] {
  return TRACK_MILESTONES.filter((m) => m.track === track);
}

// ─── Core: check and award newly reached milestones ──────────────────────────

/**
 * Check whether the user has newly reached any track milestones after an XP
 * award and persist the grants.
 *
 * Steps:
 *  1. Collect all milestones for the track at or below newLevel.
 *  2. Query track_milestone_unlocks to see which are already awarded.
 *  3. For each newly reached milestone, insert into track_milestone_unlocks
 *     and (if a title is granted) into user_badges.
 *  4. Return the list of newly unlocked milestones.
 *
 * All DB writes are wrapped in best-effort try/catch blocks so that the
 * absence of optional tables never breaks XP awards.
 *
 * @param userId   - UUID of the user who just received XP
 * @param track    - The progression track that was updated
 * @param newLevel - The user's new level on that track (post-XP)
 * @param db       - Database adapter
 * @returns Array of TrackMilestone objects that were newly unlocked (may be empty)
 */
export async function checkAndAwardTrackMilestones(
  userId: string,
  track: string,
  newLevel: number,
  db: DatabaseAdapter
): Promise<TrackMilestone[]> {
  // 1. All milestones for this track reachable at or below newLevel
  const candidates = milestonesForTrack(track).filter((m) => m.level <= newLevel);
  if (candidates.length === 0) return [];

  // 2. Find which milestones are already recorded in the DB
  let alreadyUnlocked: Set<number> = new Set();
  try {
    const { rows } = await db.query<{ milestone_level: number }>(
      `SELECT milestone_level
       FROM track_milestone_unlocks
       WHERE user_id = $1 AND track = $2`,
      [userId, track]
    );
    alreadyUnlocked = new Set(rows.map((r) => r.milestone_level));
  } catch {
    // Table may not exist yet — treat all as unawarded (safe: ON CONFLICT handles dupes)
  }

  // 3. Identify newly reached milestones
  const newlyUnlocked = candidates.filter((m) => !alreadyUnlocked.has(m.level));
  if (newlyUnlocked.length === 0) return [];

  // 4. Persist each newly unlocked milestone
  for (const milestone of newlyUnlocked) {
    // Insert into track_milestone_unlocks (best-effort)
    try {
      await db.query(
        `INSERT INTO track_milestone_unlocks
           (user_id, track, milestone_level, unlock_key, unlocked_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, track, milestone_level) DO NOTHING`,
        [userId, milestone.track, milestone.level, milestone.unlockKey]
      );
    } catch (err) {
      console.warn(
        `[trackMilestones] Could not insert track_milestone_unlocks for user=${userId} track=${milestone.track} level=${milestone.level}:`,
        err
      );
    }

    // Insert title badge into user_badges (best-effort)
    try {
      await db.query(
        `INSERT INTO user_badges
           (user_id, badge_type, badge_key, awarded_at, metadata)
         VALUES ($1, 'title', $2, NOW(), $3)
         ON CONFLICT (user_id, badge_key) DO NOTHING`,
        [
          userId,
          `title_${milestone.unlockKey}`,
          JSON.stringify({
            track: milestone.track,
            milestoneLevel: milestone.level,
            title: milestone.title,
          }),
        ]
      );
    } catch {
      // user_badges table may not exist or have a different schema — non-fatal
    }

    // Log capability grants for observability
    console.info(
      `[trackMilestones] Unlocked: user=${userId} track=${milestone.track} ` +
        `level=${milestone.level} title="${milestone.title}" key=${milestone.unlockKey}`
    );
  }

  return newlyUnlocked;
}

// ─── Query: all unlocked milestones for a user ────────────────────────────────

/**
 * Return every milestone a user has already unlocked, ordered by unlocked_at.
 *
 * @param userId - UUID of the user
 * @param db     - Database adapter
 */
export async function getUserUnlockedMilestones(
  userId: string,
  db: DatabaseAdapter
): Promise<{ track: string; milestoneLevel: number; unlockedAt: string }[]> {
  try {
    const { rows } = await db.query<{
      track: string;
      milestone_level: number;
      unlocked_at: string;
    }>(
      `SELECT track, milestone_level, unlocked_at
       FROM track_milestone_unlocks
       WHERE user_id = $1
       ORDER BY unlocked_at ASC`,
      [userId]
    );
    return rows.map((r) => ({
      track: r.track,
      milestoneLevel: r.milestone_level,
      unlockedAt: r.unlocked_at,
    }));
  } catch {
    return [];
  }
}

// ─── Query: check a specific unlock key ──────────────────────────────────────

/**
 * Return true if the user has unlocked the capability identified by unlockKey.
 *
 * @param userId    - UUID of the user
 * @param unlockKey - The unlockKey from TrackMilestone (e.g. 'explorer_pin_limit_5')
 * @param db        - Database adapter
 */
export async function hasTrackUnlock(
  userId: string,
  unlockKey: string,
  db: DatabaseAdapter
): Promise<boolean> {
  // Find the milestone(s) with this key
  const milestone = TRACK_MILESTONES.find((m) => m.unlockKey === unlockKey);
  if (!milestone) return false;

  try {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM track_milestone_unlocks
       WHERE user_id = $1 AND track = $2 AND milestone_level = $3
       LIMIT 1`,
      [userId, milestone.track, milestone.level]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

// ─── Generosity: coin purchase bonus ─────────────────────────────────────────

/**
 * Return the coin purchase bonus percentage for a user.
 * Returns 5 if the user has reached Generosity L40 (Philanthropist), 0 otherwise.
 *
 * @param userId - UUID of the user
 * @param db     - Database adapter
 */
export async function getCoinPurchaseBonus(
  userId: string,
  db: DatabaseAdapter
): Promise<number> {
  const hasBonus = await hasTrackUnlock(
    userId,
    "generosity_coin_purchase_bonus_5pct",
    db
  );
  return hasBonus ? 5 : 0;
}

// ─── Explorer: room pin limit ─────────────────────────────────────────────────

/**
 * Plan-based room pin limits (from PRD §3).
 * These are the base limits before any track bonuses are applied.
 */
const PLAN_PIN_LIMITS: Record<string, number> = {
  free: 3,
  plus: 4,
  pro: 5,
  max: 10,
};

/**
 * Minimum pin count granted by Explorer L10 (Wanderer).
 * If the plan limit is below this value and the user has the unlock, the
 * minimum is used instead (the track unlock sets a floor, not an additive bonus).
 */
const WANDERER_PIN_MINIMUM = 5;

/**
 * Return the effective room pin limit for a user, accounting for both plan and
 * Explorer track level.
 *
 * Logic:
 *  - Base limit = plan limit (free=3, plus=4, pro=5, max=10)
 *  - Explorer L10 (Wanderer) sets a floor of 5. If plan limit >= 5 already
 *    (pro/max), the floor has no effect. If plan limit < 5, limit becomes 5.
 *
 * @param userId - UUID of the user
 * @param plan   - The user's current plan slug
 * @param db     - Database adapter
 */
export async function getRoomPinLimit(
  userId: string,
  plan: string,
  db: DatabaseAdapter
): Promise<number> {
  const planLimit = PLAN_PIN_LIMITS[plan] ?? PLAN_PIN_LIMITS.free;

  const hasWanderer = await hasTrackUnlock(userId, "explorer_pin_limit_5", db);
  if (hasWanderer && planLimit < WANDERER_PIN_MINIMUM) {
    return WANDERER_PIN_MINIMUM;
  }

  return planLimit;
}
