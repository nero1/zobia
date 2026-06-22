/**
 * lib/guilds/warEngine.ts
 *
 * Guild War calculation engine.
 *
 * Responsibilities:
 *  - Calculating war points for activities (doubled in the Final Hour)
 *  - Resolving completed wars and distributing XP + coin rewards
 *  - Finding a suitable war opponent within ±15% of the declaring guild's XP
 *  - Distributing coins by contribution rank among winners
 *
 * Constants:
 *  - WAR_DURATION_HOURS     = 48  (total war length)
 *  - FINAL_HOUR_MULTIPLIER  = 2   (war points doubled in the last 60 min)
 *  - WAR_COOLDOWN_HOURS     = 72  (minimum gap between wars for a guild)
 *  - OPPONENT_XP_TOLERANCE  = 0.15 (±15% XP band for matchmaking)
 */

import type { DatabaseAdapter, TransactionClient } from "@/lib/db/interface";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";
import { creditCoins } from "@/lib/economy/coins";
import { logger } from "@/lib/logger";
import { getManifestValue } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Multiplier applied to all war-point-earning activities during the Final Hour. */
export const FINAL_HOUR_MULTIPLIER = 2;

/** Total war duration in hours. */
export const WAR_DURATION_HOURS = 48;

/** Minimum hours between wars for a single guild. */
export const WAR_COOLDOWN_HOURS = 72;

/** Reduced cooldown during a platform War Event. */
export const WAR_EVENT_COOLDOWN_HOURS = 48;

/** Acceptable XP deviation (fraction) when finding a war opponent. */
const OPPONENT_XP_TOLERANCE = 0.15;

/** XP awarded to winning guild members — scales by contribution rank (PRD: 200–500). */
const WAR_WIN_XP_MIN = 200;
const WAR_WIN_XP_MAX = 500;

/** XP awarded to all members on a draw — 50% of win XP range. */
const WAR_DRAW_XP_MIN = 100;
const WAR_DRAW_XP_MAX = 250;

/** Guild XP awarded to the winning guild for tier progression (PRD: 500–5,000). */
const WAR_WIN_GUILD_XP_MIN = 500;
const WAR_WIN_GUILD_XP_MAX = 5_000;

/** Bonus XP for the top individual war contributor. */
const TOP_CONTRIBUTOR_BONUS_XP = 1_000;

/** Total coins distributed to the winning guild's treasury (split by rank). */
const WAR_WIN_TREASURY_COINS = 2_000;

/** Coins charged from a guild's treasury to declare war. */
export const WAR_ENTRY_FEE_COINS = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WarActivity =
  | "send_message"
  | "react_to_message"
  | "join_room"
  | "host_room"
  | "send_gift"
  | "complete_quest"
  | "refer_user";

interface WarActivityPoints {
  [key: string]: number;
}

const BASE_WAR_POINTS: WarActivityPoints = {
  send_message: 1,
  react_to_message: 2,
  join_room: 5,
  host_room: 20,
  send_gift: 15,
  complete_quest: 30,
  refer_user: 50,
};

interface GuildWarRow {
  id: string;
  challenger_guild_id: string;
  defender_guild_id: string;
  status: "active" | "final_hour" | "completed" | "cancelled";
  challenger_points: number;
  defender_points: number;
  winner_guild_id: string | null;
  starts_at: string;
  ends_at: string;
  final_hour_starts_at: string;
}

interface GuildRow {
  id: string;
  // pg driver returns PostgreSQL bigint as a string to avoid IEEE 754 precision loss
  guild_xp: string | number;
  city: string | null;
  last_war_ended_at: string | null;
}

interface MemberContributionRow {
  user_id: string;
  guild_id: string;
  war_points: number;
  username: string;
}

// ---------------------------------------------------------------------------
// calculateWarPoints
// ---------------------------------------------------------------------------

/**
 * Returns the war points earned for a given activity type.
 * In the Final Hour, all points are doubled per the FINAL_HOUR_MULTIPLIER.
 *
 * @param activity     - The activity type being performed.
 * @param isFinalHour  - Whether the war is currently in its final hour.
 * @returns Integer war points for the activity.
 */
export function calculateWarPoints(activity: WarActivity, isFinalHour: boolean): number {
  const base = BASE_WAR_POINTS[activity] ?? 1;
  return isFinalHour ? base * FINAL_HOUR_MULTIPLIER : base;
}

// ---------------------------------------------------------------------------
// findWarOpponent
// ---------------------------------------------------------------------------

/**
 * Finds a suitable guild to declare war on.
 *
 * Selection criteria (in priority order):
 *  1. Guild XP within ±15% of the declaring guild's XP
 *  2. Not the same guild
 *  3. Not currently at war
 *  4. Passed the 72-hour cooldown since their last war
 *  5. Prefers same city (if available)
 *
 * @param guildId - The UUID of the guild declaring war.
 * @param db      - Active database adapter.
 * @returns The UUID of a suitable opponent guild, or null if none found.
 */
export async function findWarOpponent(
  guildId: string,
  db: DatabaseAdapter
): Promise<string | null> {
  // Step 1: Load own guild stats.
  const { rows: selfRows } = await db.query<{ id: string; guild_xp: string | number; city: string | null }>(
    `SELECT id, guild_xp, city FROM guilds WHERE id = $1 AND is_active = TRUE`,
    [guildId]
  );
  const self = selfRows[0];
  if (!self) return null;

  const selfXP = Number(self.guild_xp);
  const minXP = Math.floor(selfXP * (1 - OPPONENT_XP_TOLERANCE));
  const maxXP = Math.ceil(selfXP * (1 + OPPONENT_XP_TOLERANCE));

  // Step 2: Collect all guild IDs currently locked in an active war.
  const { rows: busyRows } = await db.query<{ guild_id: string }>(
    `SELECT DISTINCT unnest(ARRAY[challenger_guild_id, defender_guild_id]) AS guild_id
     FROM guild_wars
     WHERE status IN ('active', 'final_hour')`
  );
  // Exclude both busy guilds and the declaring guild itself (exclusion applied
  // SQL-side via g.id != ALL($4::uuid[]) to avoid TOCTOU between the busy
  // check and the candidate fetch).
  const excludedIds: string[] = [...busyRows.map((r) => r.guild_id), guildId];

  const manifestCooldown = await getManifestValue('warCooldownHours').catch(() => null);
  const effectiveCooldownHours =
    (typeof manifestCooldown === 'number' && manifestCooldown > 0)
      ? manifestCooldown
      : WAR_COOLDOWN_HOURS;

  // Step 3: Find candidates within ±15% XP band, preferring same city first.
  for (const cityFilter of [true, false]) {
    const cityClause = cityFilter && self.city ? `AND g.city = $5` : '';
    const params: (number | string | string[])[] = [
      minXP,
      maxXP,
      effectiveCooldownHours,
      excludedIds,
      ...(cityFilter && self.city ? [self.city] : []),
    ];

    const selfXPParam = cityFilter && self.city ? 6 : 5;
    const { rows } = await db.query<{ id: string }>(
      `SELECT g.id FROM guilds g
       WHERE g.is_active = TRUE
         AND g.guild_xp BETWEEN $1 AND $2
         AND (g.last_war_ended_at IS NULL
              OR g.last_war_ended_at < NOW() - ($3 * INTERVAL '1 hour'))
         AND g.id != ALL($4::uuid[])
         ${cityClause}
       ORDER BY ABS(g.guild_xp - $${selfXPParam}) ASC
       LIMIT 5`,
      [...params, selfXP]
    );

    if (rows.length > 0) return rows[0].id;
  }

  return null;
}

// ---------------------------------------------------------------------------
// distributeWarRewards
// ---------------------------------------------------------------------------

/**
 * Distributes coins to winning guild members by contribution rank.
 *
 * Top contributor receives 30% of the pool.
 * Second contributor receives 20%.
 * Remaining members share the remaining 50% equally.
 *
 * ZB-03: Uses creditCoins with a per-user reference (war:warId:userId) so the
 * unique partial index on coin_ledger is not violated when multiple members win.
 *
 * @param warId          - UUID of the resolved war.
 * @param winnerGuildId  - UUID of the winning guild.
 * @param db             - Active database adapter.
 * @param txClient       - Optional transaction client; when provided the work
 *                         runs inside the caller's transaction instead of a new one.
 */
interface PendingXPAward {
  userId: string;
  amount: number;
  track: "competitor";
  source: string;
  ref: string;
}

export async function distributeWarRewards(
  warId: string,
  winnerGuildId: string,
  db: DatabaseAdapter,
  txClient?: TransactionClient,
  pendingXPAwards: PendingXPAward[] = []
): Promise<void> {
  const run = async (client: TransactionClient) => {
    const contribResult = await client.query<MemberContributionRow>(
      `SELECT wc.user_id, wc.guild_id, wc.war_points, u.username
       FROM war_contributions wc
       JOIN users u ON u.id = wc.user_id AND u.deleted_at IS NULL
       WHERE wc.war_id = $1 AND wc.guild_id = $2
       ORDER BY wc.war_points DESC`,
      [warId, winnerGuildId]
    );

    const members = contribResult.rows;
    if (members.length === 0) return;

    const pool = WAR_WIN_TREASURY_COINS;

    // Pre-compute each member's coin share based on guild size to avoid
    // the 80/20 mis-split that the general formula produces for 2-member guilds.
    const userCoins: number[] = new Array(members.length).fill(0);
    if (members.length === 1) {
      userCoins[0] = pool;
    } else {
      // Top 30%, second 20%, rest split equally from remaining 50%.
      // With fewer than 3 members the unallocated remainder rolls up to the
      // top contributor via coinRemainder so the full pool is always paid out.
      const topShare = Math.floor(pool * 0.3);
      const secondShare = Math.floor(pool * 0.2);
      const remainderPool = pool - topShare - secondShare;
      const remainingMembers = members.length - 2;
      const equalShare = remainingMembers > 0 ? Math.floor(remainderPool / remainingMembers) : 0;
      const coinRemainder = remainderPool - equalShare * remainingMembers;
      userCoins[0] = topShare + coinRemainder;
      userCoins[1] = secondShare;
      for (let i = 2; i < members.length; i++) userCoins[i] = equalShare;
    }

    for (let i = 0; i < members.length; i++) {
      const { user_id } = members[i];
      const coins = userCoins[i];

      if (coins <= 0) continue;

      await creditCoins(
        user_id,
        coins,
        "war_reward",
        `war:${warId}:${user_id}`,
        "Guild war win reward",
        { warId, rank: i + 1 },
        client
      );
    }

    // Top contributor bonus XP — returned as pending; caller issues post-commit to avoid phantom DLQ
    if (members[0]) {
      pendingXPAwards.push({
        userId: members[0].user_id,
        amount: TOP_CONTRIBUTOR_BONUS_XP,
        track: "competitor" as const,
        source: "top_contributor_war",
        ref: `war:${warId}:${members[0].user_id}:top`,
      });
    }
  };

  if (txClient) {
    await run(txClient);
  } else {
    await db.transaction(run);
  }
}

// ---------------------------------------------------------------------------
// resolveWar
// ---------------------------------------------------------------------------

/**
 * Resolves a completed war.
 *
 * Steps:
 *  1. Confirms the war is in an end-eligible state.
 *  2. Determines the winner by point total (draw goes to challenger).
 *  3. Awards base XP to all winning guild members.
 *  4. Calls distributeWarRewards for coin distribution.
 *  5. Updates guild stats (wars_won, wars_lost, last_war_ended_at).
 *  6. Sets guild_wars.status = 'completed'.
 *
 * @param warId - UUID of the war to resolve.
 * @param db    - Active database adapter.
 * @returns Object with the winner and loser guild IDs.
 */
export async function resolveWar(
  warId: string,
  db: DatabaseAdapter
): Promise<{ winnerGuildId: string | null; loserGuildId: string | null; outcome: "win" | "draw" }> {
  let winnerGuildId: string | null = null;
  let loserGuildId: string | null = null;
  let outcome: "win" | "draw" = "win";

  // Collect XP awards from within the transaction; issue them post-commit to
  // prevent phantom DLQ entries if the transaction rolls back (B09).
  const pendingXPAwards: Array<{
    userId: string; amount: number; track: "competitor"; source: string; ref: string;
  }> = [];

  // ZB-07: The FOR UPDATE lock and all mutations run inside a single transaction
  // so concurrent calls cannot both see the war as unresolved.
  await db.transaction(async (client) => {
    const warResult = await client.query<GuildWarRow>(
      `SELECT * FROM guild_wars WHERE id = $1 FOR UPDATE`,
      [warId]
    );
    const war = warResult.rows[0];
    if (!war) throw new Error(`[warEngine] War not found: ${warId}`);
    if (war.status === "completed" || war.status === "cancelled") {
      throw new Error(`[warEngine] War ${warId} is already resolved`);
    }

    if (war.challenger_points === war.defender_points) {
      outcome = "draw";
    }

    if (outcome === "draw") {
      // Draw: no winner, no wars_won/wars_lost increments, both guilds get wars_drawn
      winnerGuildId = null;
      loserGuildId = null;

      await client.query(
        `UPDATE guild_wars
         SET status = 'completed', winner_guild_id = NULL, updated_at = NOW()
         WHERE id = $1`,
        [warId]
      );

      await client.query(
        `UPDATE guilds SET wars_drawn = wars_drawn + 1, last_war_ended_at = NOW(), updated_at = NOW()
         WHERE id = $1 OR id = $2`,
        [war.challenger_guild_id, war.defender_guild_id]
      );

      // Collect draw XP awards (100–250) for post-commit issuance
      for (const guildId of [war.challenger_guild_id, war.defender_guild_id]) {
        const drawMembers = await client.query<{ user_id: string; war_points: number }>(
          `SELECT gm.user_id, COALESCE(wc.war_points, 0) AS war_points
           FROM guild_members gm
           LEFT JOIN war_contributions wc ON wc.user_id = gm.user_id AND wc.war_id = $2
           WHERE gm.guild_id = $1 AND gm.left_at IS NULL
           ORDER BY war_points DESC`,
          [guildId, warId]
        );
        const drawCount = drawMembers.rows.length;
        for (let i = 0; i < drawCount; i++) {
          const { user_id } = drawMembers.rows[i];
          const scale = drawCount > 1 ? 1 - i / (drawCount - 1) : 1;
          const memberXP = Math.round(WAR_DRAW_XP_MIN + scale * (WAR_DRAW_XP_MAX - WAR_DRAW_XP_MIN));
          pendingXPAwards.push({ userId: user_id, amount: memberXP, track: "competitor", source: "draw_guild_war", ref: `war:${warId}:${user_id}:draw` });
        }
      }
    } else {
      winnerGuildId =
        war.challenger_points >= war.defender_points
          ? war.challenger_guild_id
          : war.defender_guild_id;
      loserGuildId =
        winnerGuildId === war.challenger_guild_id
          ? war.defender_guild_id
          : war.challenger_guild_id;

      // Mark war as completed
      await client.query(
        `UPDATE guild_wars
         SET status = 'completed', winner_guild_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [winnerGuildId, warId]
      );

      // Update guild stats
      await client.query(
        `UPDATE guilds SET wars_won = wars_won + 1, last_war_ended_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [winnerGuildId]
      );
      await client.query(
        `UPDATE guilds SET wars_lost = wars_lost + 1, last_war_ended_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [loserGuildId]
      );

      // Collect win XP awards (200–500) for post-commit issuance
      const winnerMembers = await client.query<{ user_id: string; war_points: number }>(
        `SELECT gm.user_id, COALESCE(wc.war_points, 0) AS war_points
         FROM guild_members gm
         LEFT JOIN war_contributions wc ON wc.user_id = gm.user_id AND wc.war_id = $2
         WHERE gm.guild_id = $1 AND gm.left_at IS NULL
         ORDER BY war_points DESC`,
        [winnerGuildId, warId]
      );

      const memberCount = winnerMembers.rows.length;
      for (let i = 0; i < memberCount; i++) {
        const { user_id } = winnerMembers.rows[i];
        const scale = memberCount > 1 ? 1 - i / (memberCount - 1) : 1;
        const memberXP = Math.round(WAR_WIN_XP_MIN + scale * (WAR_WIN_XP_MAX - WAR_WIN_XP_MIN));
        pendingXPAwards.push({ userId: user_id, amount: memberXP, track: "competitor", source: "win_guild_war", ref: `war:${warId}:${user_id}:win` });
      }

      // Award Guild XP (500–5,000 based on opponent strength) for tier progression
      const guildXPReward = Math.min(
        WAR_WIN_GUILD_XP_MAX,
        Math.max(WAR_WIN_GUILD_XP_MIN, Math.round((war.defender_points + war.challenger_points) * 2))
      );

      // Capture pre-war tier BEFORE updating guild_xp so from_tier reflects
      // the tier at the start of the war, not the (possibly recalculated) post-war tier.
      const { rows: preTierRows } = await client.query<{ tier: string }>(
        `SELECT tier FROM guilds WHERE id = $1`,
        [winnerGuildId]
      );
      const fromTier = preTierRows[0]?.tier ?? null;

      await client.query(
        `UPDATE guilds SET guild_xp = guild_xp + $1, updated_at = NOW() WHERE id = $2`,
        [guildXPReward, winnerGuildId]
      );
      // Include war_id so each war produces at most one tier history entry per guild.
      await client.query(
        `INSERT INTO guild_tier_history (guild_id, from_tier, to_tier, guild_xp_at, war_id)
         SELECT $1, $3, tier, guild_xp, $2::uuid FROM guilds WHERE id = $1
         ON CONFLICT (guild_id, war_id) WHERE war_id IS NOT NULL DO NOTHING`,
        [winnerGuildId, warId, fromTier]
      ).catch((err) => logger.error({ warId, err }, "[resolveWar] Failed to write guild tier history"));

      // Distribute coin rewards and collect top-contributor XP within the same transaction (ZB-03)
      await distributeWarRewards(warId, winnerGuildId!, db, client, pendingXPAwards);
    }
  });

  // Issue all XP awards after the transaction commits to prevent phantom DLQ entries (B09)
  for (const award of pendingXPAwards) {
    await safeAwardXP(award.userId, award.amount, award.track, award.source, award.ref);
  }

  return { winnerGuildId, loserGuildId, outcome };
}

// ---------------------------------------------------------------------------
// getRematchDiscount
// ---------------------------------------------------------------------------

/**
 * Check if a guild has an unused rematch token and return the discount.
 * Returns the discount percent (0 if no token).
 */
export async function getRematchDiscount(
  guildId: string,
  db: DatabaseAdapter
): Promise<number> {
  const { rows } = await db.query<{ id: string; discount_percent: number }>(
    `SELECT id, discount_percent FROM guild_war_rematch_tokens
     WHERE guild_id = $1 AND is_used = false AND expires_at > NOW()
     ORDER BY created_at ASC
     LIMIT 1`,
    [guildId]
  );
  return rows[0]?.discount_percent ?? 0;
}

// ---------------------------------------------------------------------------
// consumeRematchToken
// ---------------------------------------------------------------------------

/**
 * Mark a rematch token as used after it has been applied.
 * Uses a single atomic CTE to prevent TOCTOU races where two concurrent
 * calls both read the same unused token before either updates it.
 * Returns true if a token was consumed, false if no eligible token existed.
 */
export async function consumeRematchToken(
  guildId: string,
  db: DatabaseAdapter
): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `WITH consumed AS (
       UPDATE guild_war_rematch_tokens
         SET is_used = true
       WHERE id = (
         SELECT id FROM guild_war_rematch_tokens
         WHERE guild_id = $1 AND is_used = false AND expires_at > NOW()
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id
     )
     SELECT id FROM consumed`,
    [guildId]
  );
  return rows.length > 0;
}
