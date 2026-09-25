/**
 * lib/seasons/seasonEngine.ts
 *
 * Season management engine.
 *
 * Handles season lifecycle: detecting the active season, computing the current
 * phase, resetting competitive rankings at season end, archiving per-user
 * season history, and distributing top-performer rewards.
 *
 * NOTE ON ATOMICITY: lib/economy/coins.ts (creditCoins) and
 * lib/alerts/dispatch.ts (raiseAlert) are out of scope for this Drizzle
 * migration and still take a raw transaction-client type, incompatible with a
 * Drizzle transaction handle. Coin credits below are therefore issued as
 * standalone calls after the surrounding Drizzle transaction commits
 * (mirroring the deferred-XP pattern already used elsewhere in this
 * codebase), and raiseAlert is called against the raw `@/lib/db` adapter
 * outside the transaction. See migration report for detail.
 */

import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { creditCoins } from "@/lib/economy/coins";
import { upsertLeaderboardSnapshot } from "@/lib/leaderboards/engine";
import { logger } from "@/lib/logger";
import { raiseAlert } from "@/lib/alerts/dispatch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Season {
  id: string;
  name: string;
  theme: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  pass_price_coins: number;
  reward_pool_coins: number;
  created_at: string;
}

/** Phase within a season timeline. */
export type SeasonPhase = "opening" | "mid" | "push" | "final_day";

// ---------------------------------------------------------------------------
// getCurrentSeason
// ---------------------------------------------------------------------------

/**
 * Returns the currently active season row, or null if no season is live.
 *
 * @param db - Drizzle db instance or an active transaction handle.
 * @returns The active Season or null.
 */
export async function getCurrentSeason(db: DbOrTx): Promise<Season | null> {
  const [row] = await db
    .select({
      id: schema.seasons.id,
      name: schema.seasons.name,
      theme: schema.seasons.theme,
      startsAt: schema.seasons.startsAt,
      endsAt: schema.seasons.endsAt,
      isActive: schema.seasons.isActive,
      passPriceCoins: schema.seasons.passPriceCoins,
      rewardPoolCoins: schema.seasons.rewardPoolCoins,
      createdAt: schema.seasons.createdAt,
    })
    .from(schema.seasons)
    .where(
      and(
        eq(schema.seasons.isActive, true),
        lte(schema.seasons.startsAt, sql`NOW()`),
        gte(schema.seasons.endsAt, sql`NOW()`)
      )
    )
    .orderBy(desc(schema.seasons.startsAt))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    theme: row.theme ?? "",
    starts_at: new Date(row.startsAt).toISOString(),
    ends_at: new Date(row.endsAt).toISOString(),
    is_active: Boolean(row.isActive),
    pass_price_coins: row.passPriceCoins,
    reward_pool_coins: row.rewardPoolCoins,
    created_at: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// isSeasonActive
// ---------------------------------------------------------------------------

/**
 * Returns true if the given season is currently active based on timestamps.
 *
 * @param season - Season object from the database.
 * @returns Boolean indicating whether the season is live.
 */
export function isSeasonActive(season: Season): boolean {
  const now = Date.now();
  return (
    season.is_active &&
    new Date(season.starts_at).getTime() <= now &&
    new Date(season.ends_at).getTime() > now
  );
}

// ---------------------------------------------------------------------------
// getSeasonPhase
// ---------------------------------------------------------------------------

/**
 * Calculates the current phase of a season based on elapsed time.
 *
 *  - opening   : First 25% of the season duration
 *  - mid       : 25% – 75% of the season
 *  - push      : 75% – 95% of the season
 *  - final_day : Last 5% (or last 24 hours, whichever is smaller)
 *
 * @param season - The season to evaluate.
 * @returns The current phase string.
 */
export function getSeasonPhase(season: Season): SeasonPhase {
  const start = new Date(season.starts_at).getTime();
  const end = new Date(season.ends_at).getTime();
  const now = Date.now();
  const total = end - start;
  const elapsed = Math.max(0, now - start);
  const ratio = elapsed / total;

  // "final_day" fires when the season is in its last 5% OR fewer than 24 hours
  // remain — whichever condition is met first.
  if (ratio >= 0.95 || end - now <= 24 * 60 * 60 * 1000) return "final_day";
  if (ratio >= 0.75) return "push";
  if (ratio >= 0.25) return "mid";
  return "opening";
}

// ---------------------------------------------------------------------------
// resetSeasonRankings
// ---------------------------------------------------------------------------

/**
 * Resets competitive (season-specific) rankings at season end.
 *
 * Only resets the season_rank column and seasonal leaderboard snapshot.
 * Main XP, coins, items, guild membership, and track XP are all preserved.
 *
 * @param seasonId - UUID of the season that just ended.
 * @param db       - Drizzle db instance or an active transaction handle.
 */
export async function resetSeasonRankings(
  seasonId: string,
  db: DbOrTx
): Promise<void> {
  const orm = await getDb();
  await orm.transaction(async (tx) => {
    // Archive leaderboard positions before clearing.
    // season_rank is never written during the season (always NULL), so compute
    // rank on-the-fly from season_xp using RANK() OVER before archiving.
    await tx.execute(sql`
      INSERT INTO season_rank_archives (season_id, user_id, final_rank, final_season_xp, archived_at)
      SELECT ${seasonId}, user_id,
             RANK() OVER (ORDER BY season_xp DESC) AS final_rank,
             season_xp, NOW()
      FROM user_season_passes
      WHERE season_id = ${seasonId}
      ON CONFLICT (season_id, user_id) DO NOTHING
    `);

    // Reset per-season XP and rank
    await tx
      .update(schema.userSeasonPasses)
      .set({ seasonXp: BigInt(0), seasonRank: null })
      .where(eq(schema.userSeasonPasses.seasonId, seasonId));

    // Mark season as inactive first so the subsequent users.season_xp sync can
    // correctly identify any remaining active seasons for concurrent participants.
    // BUG-023: Also set status = 'ended' so distributeSeasonRewards can use an
    // atomic UPDATE ... WHERE status = 'ended' RETURNING id as its idempotency guard.
    await tx
      .update(schema.seasons)
      .set({ isActive: false, status: "ended", rankingsResetAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.seasons.id, seasonId));

    // Sync users.season_xp to reflect the user's current active season (if any),
    // or 0 if they are not participating in any other season.
    // This prevents zeroing XP for users enrolled in a concurrent active season.
    await tx.execute(sql`
      UPDATE users u
      SET season_xp = COALESCE((
        SELECT usp.season_xp
        FROM user_season_passes usp
        JOIN seasons s ON s.id = usp.season_id
        WHERE usp.user_id = u.id AND s.is_active = TRUE
        ORDER BY s.starts_at DESC
        LIMIT 1
      ), 0),
      updated_at = NOW()
      WHERE u.id IN (
        SELECT user_id FROM user_season_passes WHERE season_id = ${seasonId}
      )
    `);
  });
}

// ---------------------------------------------------------------------------
// archiveSeasonForUser
// ---------------------------------------------------------------------------

/**
 * Archives the season result for a single user. Called per-user at season end.
 * Safe to call multiple times (upserts on conflict).
 *
 * @param userId     - UUID of the user.
 * @param seasonId   - UUID of the season.
 * @param finalRank  - The user's final leaderboard rank number.
 * @param db         - Drizzle db instance or an active transaction handle.
 */
export async function archiveSeasonForUser(
  userId: string,
  seasonId: string,
  finalRank: number,
  db: DbOrTx
): Promise<void> {
  await db.execute(sql`
    INSERT INTO season_rank_archives (season_id, user_id, final_rank, final_season_xp, archived_at)
    SELECT ${seasonId}, ${userId}, ${finalRank}, COALESCE(usp.season_xp, 0), NOW()
    FROM user_season_passes usp
    WHERE usp.season_id = ${seasonId} AND usp.user_id = ${userId}
    ON CONFLICT (season_id, user_id) DO UPDATE
      SET final_rank = EXCLUDED.final_rank,
          archived_at = EXCLUDED.archived_at
  `);
}

// ---------------------------------------------------------------------------
// distributeSeasonRewards
// ---------------------------------------------------------------------------

/**
 * Distributes season end rewards to top performers.
 *
 * Reward tiers (based on the season's reward_pool_coins):
 *  - Rank 1:      25% of pool
 *  - Rank 2:      15% of pool
 *  - Rank 3:      10% of pool
 *  - Rank 4–10:   5% of pool each (50% total, evenly split across 7 users)
 *  - All top-10 receive an exclusive season badge recorded in user_badges
 *
 * @param seasonId - UUID of the ended season.
 * @param db       - Drizzle db instance or an active transaction handle.
 */
export async function distributeSeasonRewards(
  seasonId: string,
  db: DbOrTx
): Promise<void> {
  // BUG-023: Atomic status claim to prevent concurrent CRON instances from
  // double-distributing rewards. The UPDATE only succeeds (returns a row) when
  // status = 'ended' — the first caller transitions to 'distributing' and proceeds;
  // all subsequent concurrent callers get 0 rows and exit early.
  const claimResult = await db
    .update(schema.seasons)
    .set({ status: "distributing", updatedAt: new Date() })
    .where(and(eq(schema.seasons.id, seasonId), eq(schema.seasons.status, "ended")))
    .returning({ id: schema.seasons.id, rewardPoolCoins: schema.seasons.rewardPoolCoins });

  if (claimResult.length === 0) {
    // Either the season doesn't exist, wasn't in 'ended' state, or another CRON
    // instance already claimed distribution. Check which case we're in:
    const [existing] = await db
      .select({ id: schema.seasons.id, status: schema.seasons.status })
      .from(schema.seasons)
      .where(eq(schema.seasons.id, seasonId))
      .limit(1);
    if (!existing) {
      throw new Error(`[seasonEngine] Season not found: ${seasonId}`);
    }
    logger.warn(
      { seasonId, status: existing.status },
      '[seasonEngine] distributeSeasonRewards skipped — season not in ended state (already distributing or completed, or another instance claimed it)'
    );
    return;
  }

  const season = claimResult[0];
  const pool = season.rewardPoolCoins;

  // Top 10 by final_rank
  const topUsers = await db
    .select({ userId: schema.seasonRankArchives.userId, finalRank: schema.seasonRankArchives.finalRank })
    .from(schema.seasonRankArchives)
    .where(and(eq(schema.seasonRankArchives.seasonId, seasonId), sql`${schema.seasonRankArchives.finalRank} IS NOT NULL`))
    .orderBy(sql`${schema.seasonRankArchives.finalRank} ASC`)
    .limit(10);

  const rewardShares = [0.25, 0.15, 0.1];

  // BUG-46: When fewer than 4 users placed, the 50% allocated to ranks 4-10 was
  // computed as 0 and silently lost. Instead, redistribute unallocated shares
  // proportionally to the existing top-3 (or fewer) users.
  //
  // Compute per-user coin amounts up-front so we can redistribute any remainder.
  const userCoins: number[] = new Array(topUsers.length).fill(0);

  if (topUsers.length > 3) {
    // Normal case: ranks 1-3 get their fixed shares; ranks 4-10 split 50% evenly.
    const rank4to10Pool = Math.floor(pool * 0.5);
    const rank4to10Count = topUsers.length - 3;
    const rank4to10Share = Math.floor(rank4to10Pool / rank4to10Count);
    const rank4to10Dust = rank4to10Pool - (rank4to10Share * rank4to10Count);
    for (let i = 0; i < topUsers.length; i++) {
      if (i < 3) {
        userCoins[i] = Math.floor(pool * rewardShares[i]);
      } else if (i === 3) {
        userCoins[i] = rank4to10Share + rank4to10Dust;
      } else {
        userCoins[i] = rank4to10Share;
      }
    }
    // Redistribute any coins lost to Math.floor() rounding to rank 1
    // so the full pool is always distributed.
    const totalDistributed = userCoins.reduce((a, b) => a + b, 0);
    const remainder = pool - totalDistributed;
    if (remainder > 0) userCoins[0] += remainder;
  } else {
    // Fewer than 4 users: no rank-4-to-10 recipients exist.
    // Redistribute the unallocated 50% proportionally among the placed users.
    // Proportional weights for the placed users (using the same rewardShares ratios):
    const placedCount = topUsers.length; // 0, 1, 2, or 3
    if (placedCount === 0) {
      // No users placed — nothing to distribute
    } else {
      const activeTiersTotal = rewardShares.slice(0, placedCount).reduce((a, b) => a + b, 0);
      for (let i = 0; i < placedCount; i++) {
        // Scale each user's share up so the full pool is distributed
        userCoins[i] = Math.floor(pool * (rewardShares[i] / activeTiersTotal));
      }
      // Assign any remaining coins due to floor rounding to rank-1
      const distributed = userCoins.slice(0, placedCount).reduce((a, b) => a + b, 0);
      const remainder = pool - distributed;
      if (remainder > 0 && placedCount > 0) {
        userCoins[0] += remainder;
      }
    }
  }

  // Coin awards are deferred to post-commit (see file-level atomicity note).
  const pendingCoinAwards: { userId: string; coins: number; rank: number }[] = [];

  const orm = await getDb();
  await orm.transaction(async (tx) => {
    for (let i = 0; i < topUsers.length; i++) {
      const { userId } = topUsers[i];
      const coins = userCoins[i];

      // ZB-04: Use creditCoins with a per-user reference so the unique partial
      // index on coin_ledger is not violated when multiple users receive rewards.
      if (coins > 0) {
        pendingCoinAwards.push({ userId, coins, rank: i + 1 });
      }

      // Award season badge with a season-specific key so each season's badge is unique (BUG-12)
      await tx
        .insert(schema.userBadges)
        .values({
          userId,
          badgeType: "season_top10",
          badgeKey: `season_top10:${seasonId}`,
          referenceId: seasonId,
        })
        .onConflictDoNothing({
          target: [schema.userBadges.userId, schema.userBadges.badgeKey],
          where: sql`badge_key IS NOT NULL`,
        });
    }

    // Retire all limited-edition gifts that belonged to this season.
    // Once a season ends, these items are no longer purchasable or giftable.
    await tx
      .update(schema.giftItems)
      .set({ isRetired: true })
      .where(
        and(
          eq(schema.giftItems.seasonId, seasonId),
          eq(schema.giftItems.isLimitedEdition, true),
          eq(schema.giftItems.isRetired, false)
        )
      );

    // BUG-023: Mark distribution as completed so the status reflects the final
    // state and any future health-check queries can confirm completion.
    await tx.update(schema.seasons).set({ status: "completed", updatedAt: new Date() }).where(eq(schema.seasons.id, seasonId));
  });

  for (const award of pendingCoinAwards) {
    try {
      await creditCoins(
        award.userId,
        award.coins,
        "season_reward",
        `season:${seasonId}:${award.userId}`,
        "Season end reward",
        { seasonId, rank: award.rank }
      );
    } catch (err) {
      logger.error({ err, seasonId, userId: award.userId }, "[seasonEngine] Failed to credit season reward coins (non-fatal)");
    }
  }
}

// ---------------------------------------------------------------------------
// createSeasonCeremonyRoom
// ---------------------------------------------------------------------------

/**
 * Creates the Season Closing Ceremony Room when a season ends.
 *
 * The room is a public "free_open" type room tied to the ending season.
 * It stays active for 48 hours so members can celebrate and reflect.
 * A system/admin user is used as the creator.
 *
 * @param seasonId   - UUID of the ended season.
 * @param seasonName - Display name of the ended season.
 * @param db         - Drizzle db instance or an active transaction handle.
 */
export async function createSeasonCeremonyRoom(
  seasonId: string,
  seasonName: string,
  db: DbOrTx
): Promise<string | null> {
  try {
    // Fetch the first admin user to be the room creator
    const [admin] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.isAdmin, true), isNull(schema.users.deletedAt)))
      .orderBy(schema.users.createdAt)
      .limit(1);
    const adminId = admin?.id;
    if (!adminId) return null;

    const closesAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const slug = `season-${seasonId.slice(0, 8)}-ceremony`;
    const metadata = { season_ceremony_id: seasonId, is_platform_room: true };

    // BUG-RACE-01: move the existence check inside the transaction and use
    // ON CONFLICT DO NOTHING so concurrent CRON invocations cannot both pass
    // the guard and insert two ceremony rooms for the same season.
    const orm = await getDb();
    const roomId = await orm.transaction(async (tx) => {
      const insertResult = await tx.execute<{ id: string }>(sql`
        INSERT INTO rooms
          (creator_id, name, description, type, slug, is_active, ends_at, metadata)
        VALUES (${adminId}, ${`🏆 ${seasonName} Closing Ceremony`},
                ${`The official closing ceremony for ${seasonName}. Celebrate, reflect, and look ahead to the next season!`},
                'free_open', ${slug}, TRUE, ${closesAt}, ${JSON.stringify(metadata)}::jsonb)
        ON CONFLICT ((metadata->>'season_ceremony_id')) DO NOTHING
        RETURNING id
      `);
      const roomRow = (insertResult.rows as { id: string }[])[0];

      let id: string | null;
      if (!roomRow) {
        // Another concurrent invocation already inserted this room — return its id
        const existingResult = await tx.execute<{ id: string }>(
          sql`SELECT id FROM rooms WHERE metadata->>'season_ceremony_id' = ${seasonId} LIMIT 1`
        );
        id = (existingResult.rows as { id: string }[])[0]?.id ?? null;
      } else {
        id = roomRow.id;
        // Add the admin as the initial room member so the room is not empty on creation.
        await tx
          .insert(schema.roomMembers)
          .values({ roomId: id, userId: adminId, role: "admin" })
          .onConflictDoNothing({
            target: [schema.roomMembers.roomId, schema.roomMembers.userId],
          });
      }
      return id;
    });

    return roomId;
  } catch (err) {
    logger.error({ err }, '[seasonEngine] createSeasonCeremonyRoom failed');
    return null;
  }
}

// ---------------------------------------------------------------------------
// seedSeasonPassMilestones
// ---------------------------------------------------------------------------

/**
 * Seed default pass milestones for a newly created Season.
 * Called after a season is created.
 */
export async function seedSeasonPassMilestones(
  seasonId: string,
  db: DbOrTx
): Promise<void> {
  const freeMilestones = [
    { xp: 500,   type: 'coins',        value: { amount: 50 },    name: '50 Coins',              order: 1 },
    { xp: 1500,  type: 'sticker_pack', value: { packId: 'seasonal_free' }, name: 'Season Sticker Pack', order: 2 },
    { xp: 3000,  type: 'coins',        value: { amount: 100 },   name: '100 Coins',             order: 3 },
    { xp: 6000,  type: 'badge',        value: { badgeType: 'season_participant' }, name: 'Season Badge', order: 4 },
    { xp: 10000, type: 'coins',        value: { amount: 200 },   name: '200 Coins',             order: 5 },
  ];
  const paidMilestones = [
    { xp: 500,   type: 'coins',        value: { amount: 100 },   name: '100 Coins (Paid)',      order: 1 },
    { xp: 1500,  type: 'badge',        value: { badgeType: 'season_pass_holder' }, name: 'Pass Holder Badge', order: 2 },
    { xp: 3000,  type: 'title',        value: { title: 'Season Champion' }, name: 'Title: Season Champion', order: 3 },
    { xp: 6000,  type: 'xp_bonus',     value: { bonusXP: 500 }, name: '500 Bonus XP',           order: 4 },
    { xp: 10000, type: 'badge',        value: { badgeType: 'season_elite', animated: true }, name: 'Elite Season Badge', order: 5 },
    { xp: 15000, type: 'title',        value: { title: 'Legend of the Season' }, name: 'Title: Legend of the Season', order: 6 },
  ];

  const allMilestones = [
    ...freeMilestones.map(m => ({ ...m, tier: 'free' })),
    ...paidMilestones.map(m => ({ ...m, tier: 'paid' })),
  ];

  // FIX-H04: ON CONFLICT now targets (season_id, tier, sort_order) so free and
  // paid milestones with the same sort_order do not conflict with each other.
  for (const m of allMilestones) {
    await db
      .insert(schema.seasonPassMilestones)
      .values({
        seasonId,
        milestoneXp: m.xp,
        tier: m.tier,
        rewardType: m.type,
        rewardValue: m.value,
        displayName: m.name,
        sortOrder: m.order,
      })
      .onConflictDoNothing({
        target: [schema.seasonPassMilestones.seasonId, schema.seasonPassMilestones.tier, schema.seasonPassMilestones.sortOrder],
      });
  }
}

// ---------------------------------------------------------------------------
// getPassMilestones
// ---------------------------------------------------------------------------

/**
 * Get all pass milestones for a season, with claim status for a user.
 */
export async function getPassMilestones(
  seasonId: string,
  userId: string,
  db: DbOrTx
): Promise<Array<{
  id: string;
  milestoneXp: number;
  tier: string;
  rewardType: string;
  rewardValue: unknown;
  displayName: string;
  sortOrder: number;
  isClaimed: boolean;
}>> {
  const rows = await db
    .select({
      id: schema.seasonPassMilestones.id,
      milestoneXp: schema.seasonPassMilestones.milestoneXp,
      tier: schema.seasonPassMilestones.tier,
      rewardType: schema.seasonPassMilestones.rewardType,
      rewardValue: schema.seasonPassMilestones.rewardValue,
      displayName: schema.seasonPassMilestones.displayName,
      sortOrder: schema.seasonPassMilestones.sortOrder,
      claimedAt: schema.userSeasonMilestoneClaims.claimedAt,
    })
    .from(schema.seasonPassMilestones)
    .leftJoin(
      schema.userSeasonMilestoneClaims,
      and(
        eq(schema.userSeasonMilestoneClaims.milestoneId, schema.seasonPassMilestones.id),
        eq(schema.userSeasonMilestoneClaims.userId, userId),
        eq(schema.userSeasonMilestoneClaims.seasonId, seasonId)
      )
    )
    .where(eq(schema.seasonPassMilestones.seasonId, seasonId))
    .orderBy(sql`${schema.seasonPassMilestones.sortOrder} ASC, ${schema.seasonPassMilestones.milestoneXp} ASC`);

  return rows.map(r => ({
    id: r.id,
    milestoneXp: r.milestoneXp,
    tier: r.tier,
    rewardType: r.rewardType,
    rewardValue: r.rewardValue,
    displayName: r.displayName,
    sortOrder: r.sortOrder,
    isClaimed: r.claimedAt !== null,
  }));
}

// ---------------------------------------------------------------------------
// claimPassMilestone
// ---------------------------------------------------------------------------

/**
 * Claim a season pass milestone reward for a user.
 * Checks the user has enough season XP and the milestone isn't already claimed.
 *
 * ZB-06/ZB-22: All checks and the reward grant are wrapped in a single
 * transaction with FOR UPDATE locks so concurrent requests cannot both
 * pass the "not yet claimed" check and each apply the reward.
 * The RETURNING clause tells us whether the INSERT actually ran, preventing
 * the reward from being applied when ON CONFLICT DO NOTHING silently skips it.
 *
 * NOTE: the 'coins' reward branch defers the actual creditCoins() call to
 * post-commit — see file-level atomicity note.
 */
export async function claimPassMilestone(
  userId: string,
  seasonId: string,
  milestoneId: string,
  db: DbOrTx
): Promise<{ success: boolean; rewardType: string; rewardValue: unknown }> {
  let claimed: { rewardType: string; rewardValue: unknown } | null = null;
  // Held in an object (not a bare `let`) because TS's control-flow narrowing
  // does not widen a variable reassigned only inside the transaction closure
  // back from its `null` initializer — reading through a property sidesteps it.
  const coinAwardState: { pendingCoinAward: { amount: number } | null } = { pendingCoinAward: null };

  const orm = await getDb();
  await orm.transaction(async (tx) => {
    // BUG-SEASON-01: reject claims for seasons that are no longer active
    const [season] = await tx
      .select({ isActive: schema.seasons.isActive, endsAt: schema.seasons.endsAt })
      .from(schema.seasons)
      .where(eq(schema.seasons.id, seasonId))
      .limit(1);
    if (!season || !season.isActive || new Date(season.endsAt) <= new Date()) {
      throw new Error('Season is not active — milestone claims are closed');
    }

    // Lock the pass row so concurrent claims for the same user/season are serialised
    const [pass] = await tx
      .select({ seasonXp: schema.userSeasonPasses.seasonXp, hasPaidPass: schema.userSeasonPasses.isPaid })
      .from(schema.userSeasonPasses)
      .where(and(eq(schema.userSeasonPasses.userId, userId), eq(schema.userSeasonPasses.seasonId, seasonId)))
      .for("update");
    if (!pass) throw new Error('User has no season pass');

    const [milestone] = await tx
      .select({
        milestoneXp: schema.seasonPassMilestones.milestoneXp,
        tier: schema.seasonPassMilestones.tier,
        rewardType: schema.seasonPassMilestones.rewardType,
        rewardValue: schema.seasonPassMilestones.rewardValue,
      })
      .from(schema.seasonPassMilestones)
      .where(and(eq(schema.seasonPassMilestones.id, milestoneId), eq(schema.seasonPassMilestones.seasonId, seasonId)));
    if (!milestone) throw new Error('Milestone not found');

    if (milestone.tier === 'paid' && !pass.hasPaidPass) {
      throw new Error('Paid pass required for this milestone');
    }
    if (Number(pass.seasonXp) < milestone.milestoneXp) {
      throw new Error('Insufficient season XP');
    }

    // Attempt claim; a returned row lets us detect whether the row was actually inserted
    const claimRows = await tx
      .insert(schema.userSeasonMilestoneClaims)
      .values({ userId, seasonId, milestoneId })
      .onConflictDoNothing({
        target: [
          schema.userSeasonMilestoneClaims.userId,
          schema.userSeasonMilestoneClaims.seasonId,
          schema.userSeasonMilestoneClaims.milestoneId,
        ],
      })
      .returning({ userId: schema.userSeasonMilestoneClaims.userId });

    // Already claimed — skip reward, return success: false
    if (claimRows.length === 0) return;

    // Apply reward only when the insert actually happened
    if (milestone.rewardType === 'coins') {
      const val = milestone.rewardValue as { amount: number };
      coinAwardState.pendingCoinAward = { amount: val.amount };
    } else if (milestone.rewardType === 'badge' || milestone.rewardType === 'title') {
      const val = milestone.rewardValue as { badgeType?: string; title?: string };
      const badgeType = val.badgeType ?? val.title ?? 'season_reward';
      // Include season discriminator in badge_key to prevent cross-season deduplication collisions
      const badgeKey = `${badgeType}:s${seasonId}`;
      await tx
        .insert(schema.userBadges)
        .values({ userId, badgeType, badgeKey, referenceId: milestoneId })
        .onConflictDoNothing({
          target: [schema.userBadges.userId, schema.userBadges.badgeKey],
        });
    } else if (milestone.rewardType === 'xp_bonus') {
      const val = milestone.rewardValue as { bonusXP: number };
      const referenceId = `season:${seasonId}:milestone:${milestoneId}:user:${userId}`;
      // BUG-H04: Use a single CTE that gates the user_season_passes UPDATE on the
      // users UPDATE succeeding. If the user is soft-deleted, the users UPDATE
      // returns 0 rows, so the pass UPDATE is skipped — preventing XP discrepancies.
      const xpResult = await tx.execute<{ xp_total: number; season_xp: number }>(sql`
        WITH ins AS (
          INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, base_amount, created_at)
          VALUES (${userId}, ${val.bonusXP}, 'main', 'season_milestone_bonus', ${referenceId}, ${val.bonusXP}, NOW())
          ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
          RETURNING id
        ),
        user_updated AS (
          UPDATE users
            SET xp_total  = xp_total  + ${val.bonusXP},
                season_xp = season_xp + ${val.bonusXP},
                updated_at = NOW()
          WHERE id = ${userId} AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM ins)
          RETURNING id, xp_total, season_xp
        )
        UPDATE user_season_passes
          SET season_xp = season_xp + ${val.bonusXP}
        WHERE user_id = ${userId} AND season_id = ${seasonId}
          AND EXISTS (SELECT 1 FROM user_updated)
        RETURNING (SELECT xp_total FROM user_updated) AS xp_total,
                  (SELECT season_xp FROM user_updated) AS season_xp
      `);
      const xpRow = (xpResult.rows as { xp_total: number; season_xp: number }[])[0];
      // Sync leaderboard snapshot so rank reflects the new XP immediately
      if (xpRow) {
        const newXpTotal = Number(xpRow.xp_total);
        // BUG-M01: log snapshot failures rather than silently swallowing them
        await upsertLeaderboardSnapshot(userId, "main", newXpTotal, tx).catch((err) => {
          logger.warn({ err, userId, track: "main" }, "[leaderboard] snapshot upsert failed after season XP bonus");
        });
        await upsertLeaderboardSnapshot(userId, "main", Number(xpRow.season_xp), tx, {
          scope: "season",
          seasonId,
        }).catch((err) => {
          logger.warn({ err, userId, seasonId }, "[leaderboard] season snapshot upsert failed after season XP bonus");
        });
      }
    } else if (milestone.rewardType === 'sticker_pack') {
      const val = milestone.rewardValue as { packId: string };
      // Prefer slug (canonical), fall back to name to avoid ambiguous OR match
      let [pack] = await tx
        .select({ id: schema.stickerPacks.id })
        .from(schema.stickerPacks)
        .where(eq(schema.stickerPacks.slug, val.packId))
        .limit(1);
      if (!pack) {
        [pack] = await tx
          .select({ id: schema.stickerPacks.id })
          .from(schema.stickerPacks)
          .where(eq(schema.stickerPacks.name, val.packId))
          .limit(1);
      }
      const packUuid = pack?.id;
      if (!packUuid) {
        logger.error({ milestoneId, userId }, '[seasonEngine] Sticker pack not found for milestone reward — skipping grant');
        await raiseAlert(tx, {
          type: "missing_sticker_pack",
          category: "other",
          priorityLevel: 4,
          title: "Sticker pack not found for season milestone",
          message: `Sticker pack not found for milestone ${milestoneId}`,
          metadata: { milestoneId, userId },
          dedupeKey: `missing_sticker_pack:${milestoneId}`,
        }).catch(() => {});
        // fall through — milestone is still marked claimed
        claimed = { rewardType: milestone.rewardType, rewardValue: milestone.rewardValue };
        return;
      }
      await tx
        .insert(schema.userStickerPacks)
        .values({ userId, packId: packUuid, unlockedAt: new Date() })
        .onConflictDoNothing({
          target: [schema.userStickerPacks.userId, schema.userStickerPacks.packId],
        });
    } else {
      throw new Error(`[claimPassMilestone] Unhandled reward_type '${milestone.rewardType}' for milestone ${milestoneId} — add handler before season goes live`);
    }

    claimed = { rewardType: milestone.rewardType, rewardValue: milestone.rewardValue };
  });

  if (coinAwardState.pendingCoinAward) {
    try {
      await creditCoins(
        userId,
        coinAwardState.pendingCoinAward.amount,
        "season_milestone",
        `milestone:${milestoneId}`,
        "Season pass milestone reward",
        { milestoneId, seasonId }
      );
    } catch (err) {
      logger.error({ err, userId, milestoneId }, "[seasonEngine] Failed to credit season milestone coins (non-fatal)");
    }
  }

  if (!claimed) {
    // Fetch reward metadata to return a well-typed response for already-claimed milestones
    const db2 = await getDb();
    const [row] = await db2
      .select({ rewardType: schema.seasonPassMilestones.rewardType, rewardValue: schema.seasonPassMilestones.rewardValue })
      .from(schema.seasonPassMilestones)
      .where(eq(schema.seasonPassMilestones.id, milestoneId))
      .limit(1);
    return {
      success: false,
      rewardType: row?.rewardType ?? 'unknown',
      rewardValue: row?.rewardValue ?? {},
    };
  }

  return { success: true, ...(claimed as { rewardType: string; rewardValue: unknown }) };
}
