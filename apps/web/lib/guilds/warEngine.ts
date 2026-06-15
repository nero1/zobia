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
  guild_xp: number;
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
  const selfResult = await db.query<GuildRow>(
    `SELECT id, guild_xp, city FROM guilds WHERE id = $1 AND is_active = TRUE`,
    [guildId]
  );
  const self = selfResult.rows[0];
  if (!self) return null;

  const minXP = Math.floor(self.guild_xp * (1 - OPPONENT_XP_TOLERANCE));
  const maxXP = Math.ceil(self.guild_xp * (1 + OPPONENT_XP_TOLERANCE));

  // Guilds currently involved in an active war
  const activeWarResult = await db.query<{ guild_id: string }>(
    `SELECT DISTINCT unnest(ARRAY[challenger_guild_id, defender_guild_id]) AS guild_id
     FROM guild_wars
     WHERE status IN ('active', 'final_hour')`,
    []
  );
  const busyGuilds = new Set(activeWarResult.rows.map((r) => r.guild_id));
  busyGuilds.add(guildId);

  const cooldownCutoff = new Date(
    Date.now() - WAR_COOLDOWN_HOURS * 60 * 60 * 1000
  ).toISOString();

  // Build the busy guild exclusion list for use in the SQL query.
  // Using = ALL with an empty array is always TRUE in PostgreSQL, so we can
  // always pass busyGuildIds as $4 without conditionally changing the query.
  const busyGuildIds = [...busyGuilds];

  // Try same-city first, then any city — exclusions are in the SQL so LIMIT 5
  // applies to post-filtered eligible opponents (WAR-LIMIT-01).
  for (const cityFilter of [true, false]) {
    const conditions = [
      `g.is_active = TRUE`,
      `g.guild_xp BETWEEN $1 AND $2`,
      `(g.last_war_ended_at IS NULL OR g.last_war_ended_at < $3)`,
      `g.id != ALL($4::uuid[])`,
    ];
    const params: (string | number | string[])[] = [minXP, maxXP, cooldownCutoff, busyGuildIds];
    let paramIdx = 5;

    if (cityFilter && self.city) {
      conditions.push(`g.city = $${paramIdx++}`);
      params.push(self.city);
    }

    const candidateResult = await db.query<{ id: string }>(
      `SELECT g.id FROM guilds g
       WHERE ${conditions.join(" AND ")}
       ORDER BY ABS(g.guild_xp - $${paramIdx}) ASC
       LIMIT 5`,
      [...params, self.guild_xp]
    );

    if (candidateResult.rows.length > 0) {
      return candidateResult.rows[0].id;
    }
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
export async function distributeWarRewards(
  warId: string,
  winnerGuildId: string,
  db: DatabaseAdapter,
  txClient?: TransactionClient
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
    const topShare = Math.floor(pool * 0.3);
    const secondShare = members.length >= 2 ? Math.floor(pool * 0.2) : 0;
    const remainderPool = pool - topShare - secondShare;
    const remainingMembers = Math.max(members.length - 2, 0);
    const equalShare =
      remainingMembers > 0 ? Math.floor(remainderPool / remainingMembers) : 0;

    // Distribute any remainder (from flooring) to the top contributor
    const totalDistributed = topShare + secondShare + equalShare * remainingMembers;
    const coinRemainder = pool - totalDistributed;

    for (let i = 0; i < members.length; i++) {
      const { user_id } = members[i];
      let coins = 0;
      if (i === 0) coins = topShare + coinRemainder;
      else if (i === 1) coins = secondShare;
      else coins = equalShare;

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

    // Top contributor bonus XP
    if (members[0]) {
      // BUG-14: use safeAwardXP for DLQ fallback and idempotency
      await safeAwardXP(members[0].user_id, TOP_CONTRIBUTOR_BONUS_XP, "competitor", "top_contributor_war", `war:${warId}:${members[0].user_id}:top`, client);
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
): Promise<{ winnerGuildId: string; loserGuildId: string }> {
  let winnerGuildId!: string;
  let loserGuildId!: string;

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

    // Award scaled win XP (200–500) to winning members based on contribution rank
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
      // BUG-14: use safeAwardXP for DLQ fallback and idempotency
      await safeAwardXP(user_id, memberXP, "competitor", "win_guild_war", `war:${warId}:${user_id}:win`, client);
    }

    // Award Guild XP (500–5,000 based on opponent strength) for tier progression
    const guildXPReward = Math.min(
      WAR_WIN_GUILD_XP_MAX,
      Math.max(WAR_WIN_GUILD_XP_MIN, Math.round((war.defender_points + war.challenger_points) * 2))
    );
    await client.query(
      `UPDATE guilds SET guild_xp = guild_xp + $1, updated_at = NOW() WHERE id = $2`,
      [guildXPReward, winnerGuildId]
    );
    await client.query(
      `INSERT INTO guild_tier_history (guild_id, from_tier, to_tier, guild_xp_at)
       SELECT $1, tier, tier, guild_xp FROM guilds WHERE id = $1
       ON CONFLICT DO NOTHING`,
      [winnerGuildId]
    ).catch(() => {});

    // Distribute coin rewards within the same transaction (ZB-03)
    await distributeWarRewards(warId, winnerGuildId, db, client);
  });

  return { winnerGuildId, loserGuildId };
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
 */
export async function consumeRematchToken(
  guildId: string,
  db: DatabaseAdapter
): Promise<void> {
  await db.query(
    `UPDATE guild_war_rematch_tokens
     SET is_used = true
     WHERE id = (
       SELECT id FROM guild_war_rematch_tokens
       WHERE guild_id = $1 AND is_used = false AND expires_at > NOW()
       ORDER BY created_at ASC
       LIMIT 1
     )`,
    [guildId]
  );
}
