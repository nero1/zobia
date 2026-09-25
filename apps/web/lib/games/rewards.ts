/**
 * lib/games/rewards.ts
 *
 * Reward plumbing for the games feature. Everything that grants a player
 * credits / stars / gaming-XP goes through here so the economy ledgers, the
 * gaming progression track (xp_gaming / level_gaming) and the track-milestone
 * unlock engine stay consistent.
 *
 * All grants are idempotent via a stable `reference_id` so a retried request
 * never double-pays.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { creditCoins } from "@/lib/economy/coins";
import { creditStars } from "@/lib/economy/stars";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";
import { getTrackLevelForXP } from "@/lib/xp/engine";
import { checkAndAwardTrackMilestones } from "@/lib/xp/trackMilestones";
import { logger } from "@/lib/logger";

export interface RewardBundle {
  credits: number;
  xp: number;
  stars: number;
}

/** Human-friendly fallback labels for reward sources that aren't tied to a single game. */
const FRIENDLY_SOURCE_LABELS: Record<string, string> = {
  game_play_milestone: "Play milestone",
};

/**
 * Grant a bundle of credits / gaming-XP / stars to a user, idempotently.
 * Recomputes the user's gaming level and fires any newly reached gaming track
 * milestones. Returns the bundle actually granted (zeros are skipped).
 *
 * `gameName` (when known) is used to build a specific wallet transaction
 * description, e.g. "Game reward: Zobia Tetris" instead of the generic
 * "Game reward: game_win" — see wallet transaction history.
 */
export async function grantGamingReward(
  userId: string,
  bundle: RewardBundle,
  source: string,
  referenceId: string,
  // NOTE: creditCoins/creditStars (lib/economy/coins.ts, lib/economy/stars.ts)
  // are being migrated to Drizzle concurrently and may still type their
  // txClient param as TransactionClient — if so this produces a transient
  // type mismatch below that resolves once that migration lands.
  client?: DbOrTx,
  gameName?: string | null
): Promise<RewardBundle> {
  const credits = Math.max(0, Math.floor(bundle.credits));
  const xp = Math.max(0, Math.floor(bundle.xp));
  const stars = Math.max(0, Math.floor(bundle.stars));
  const label = gameName ?? FRIENDLY_SOURCE_LABELS[source] ?? source;
  const description = `Game reward: ${label}`;

  if (credits > 0) {
    // TODO(drizzle-migration): lib/economy/coins.ts is being migrated to
    // Drizzle concurrently by another agent — creditCoins still types its
    // txClient param as the legacy TransactionClient, so passing our DbOrTx
    // `client` here is a transient type mismatch that resolves once that
    // migration lands.
    await creditCoins(
      userId,
      credits,
      "game_reward",
      `${referenceId}:credits`,
      description,
      { source, gameName: gameName ?? undefined },
      client
    ).catch((err) => logger.error({ userId, source }, `[games] credit reward failed: ${err}`));
  }

  if (stars > 0) {
    await creditStars(
      userId,
      stars,
      "game_reward",
      `${referenceId}:stars`,
      description,
      client
    ).catch((err) => logger.error({ userId, source }, `[games] star reward failed: ${err}`));
  }

  if (xp > 0) {
    // safeAwardXP updates xp_total + xp_gaming. We then recompute level_gaming.
    // BUG-026 FIX: when `client` is a caller-supplied transaction, safeAwardXP rethrows
    // on failure instead of writing to the DLQ. Catch here and write the DLQ entry via
    // globalDb (outside the transaction) so XP is never silently lost. We do NOT rethrow
    // so the rest of the reward bundle (credits, stars) and the outer transaction can
    // commit successfully — XP will be retried by the daily CRON.
    try {
      await safeAwardXP(userId, xp, "gaming", source, `${referenceId}:xp`, client);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ userId, source, referenceId }, `[grantGamingReward] XP award failed inside tx — writing to DLQ: ${errorMessage}`);
      const globalDb = await getDb();
      await globalDb
        .insert(schema.failedXpAwards)
        .values({
          userId,
          amount: xp,
          track: "gaming",
          source,
          referenceId: `${referenceId}:xp`,
          errorMessage,
          retryCount: 0,
        })
        .onConflictDoNothing()
        .catch((dlqErr) => {
          logger.error({ userId, source }, `[grantGamingReward] Failed to write XP to DLQ: ${dlqErr}`);
        });
    }
    await recomputeGamingLevel(userId, client ?? (await getDb()));
  }

  return { credits, xp, stars };
}

/**
 * Recompute level_gaming from xp_gaming and persist it, then award any track
 * milestones the user has newly reached. Best-effort (never throws).
 */
export async function recomputeGamingLevel(
  userId: string,
  client: DbOrTx
): Promise<void> {
  try {
    const [row] = await client
      .select({ xpGaming: schema.users.xpGaming })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), sql`${schema.users.deletedAt} IS NULL`))
      .limit(1);
    if (!row) return;
    const info = getTrackLevelForXP("gaming", Number(row.xpGaming ?? 0));
    await client
      .update(schema.users)
      .set({ levelGaming: info.level, updatedAt: new Date() })
      .where(eq(schema.users.id, userId));
    await checkAndAwardTrackMilestones(userId, "gaming", info.level, client);
  } catch (err) {
    logger.warn({ userId }, `[games] recomputeGamingLevel failed: ${err}`);
  }
}

/**
 * After a counted play, evaluate global "games played" milestones and grant any
 * unclaimed ones. Idempotent via the game_milestone_claims primary key.
 */
export async function checkPlayMilestones(userId: string): Promise<void> {
  try {
    const globalDb = await getDb();
    const [countRow] = await globalDb
      .select({ plays: sql<number>`COUNT(*)::int` })
      .from(schema.gamePlays)
      .where(and(eq(schema.gamePlays.userId, userId), eq(schema.gamePlays.counted, true)));
    const totalPlays = countRow?.plays ?? 0;
    if (totalPlays === 0) return;

    const milestones = await globalDb
      .select({
        gamesPlayedThreshold: schema.gamePlayMilestones.gamesPlayedThreshold,
        rewardCredits: schema.gamePlayMilestones.rewardCredits,
        rewardXp: schema.gamePlayMilestones.rewardXp,
        rewardStars: schema.gamePlayMilestones.rewardStars,
      })
      .from(schema.gamePlayMilestones)
      .where(
        and(
          eq(schema.gamePlayMilestones.isActive, true),
          sql`${schema.gamePlayMilestones.gamesPlayedThreshold} <= ${totalPlays}`,
          sql`NOT EXISTS (
            SELECT 1 FROM ${schema.gameMilestoneClaims} c
            WHERE c.user_id = ${userId} AND c.threshold = ${schema.gamePlayMilestones.gamesPlayedThreshold}
          )`
        )
      )
      .orderBy(sql`${schema.gamePlayMilestones.gamesPlayedThreshold} ASC`);

    for (const m of milestones) {
      // Claim first (idempotency gate), then pay.
      const claimed = await globalDb
        .insert(schema.gameMilestoneClaims)
        .values({ userId, threshold: m.gamesPlayedThreshold })
        .onConflictDoNothing()
        .returning({ threshold: schema.gameMilestoneClaims.threshold });
      if (claimed.length === 0) continue; // another request already claimed it

      await grantGamingReward(
        userId,
        { credits: m.rewardCredits, xp: m.rewardXp, stars: m.rewardStars },
        "game_play_milestone",
        `milestone:${userId}:${m.gamesPlayedThreshold}`
      );
    }
  } catch (err) {
    logger.error({ err, userId }, `[games] checkPlayMilestones failed`);
  }
}
