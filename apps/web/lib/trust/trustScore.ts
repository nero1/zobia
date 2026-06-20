/**
 * lib/trust/trustScore.ts
 *
 * Trust score system for Zobia Social.
 *
 * Trust scores are integers 0–100 derived from multiple signals:
 *  - Account age (older = higher base score)
 *  - Report rate (reports against user reduce score)
 *  - Email/phone verification status
 *  - Payment history (completed purchases add trust)
 *  - Prior moderation actions (warnings/bans reduce score)
 *
 * Scores are cached on the users.trust_score column and recomputed
 * on relevant events via updateTrustScore.
 *
 * @module lib/trust/trustScore
 */

import type { DatabaseAdapter } from "@/lib/db/interface";
// Schema-derived types: columns are guaranteed to exist in the users table.
// When the DB schema changes, these imports break at compile time rather than
// at runtime. Use schema.$inferSelect field names as authoritative references.
import { schema } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Signals used to compute a trust score. */
interface TrustSignals {
  accountAgeDays: number;
  reportCount: number;
  warningCount: number;
  isBanned: boolean;
  isVerified: boolean;
  paymentCount: number;
  moderationActionCount: number;
}

/** Events that trigger a trust score update. */
export type TrustEvent =
  | "account_verified"
  | "payment_completed"
  | "report_received"
  | "warning_issued"
  | "ban_lifted"
  | "content_removed"
  | "streak_milestone";

/** Features that require a minimum trust score. */
export type TrustGatedFeature =
  | "classroom_creation"
  | "guild_creation"
  | "send_gift"
  | "withdraw_coins"
  | "moderator_nomination";

// ---------------------------------------------------------------------------
// Trust score thresholds
// ---------------------------------------------------------------------------

/** Minimum trust score required per feature. */
const FEATURE_THRESHOLDS: Record<TrustGatedFeature, number> = {
  classroom_creation: 40,
  guild_creation: 30,
  send_gift: 20,
  withdraw_coins: 50,
  moderator_nomination: 70,
};

/** ClassRoom creation additionally requires 30 days account age. */
const CLASSROOM_MIN_AGE_DAYS = 30;

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

/**
 * Compute a trust score from raw signals.
 *
 * Scoring breakdown (max 100):
 *  - Account age:          up to 30 pts (1 pt per 10 days, capped at 300 days)
 *  - Verification:         +20 pts
 *  - Payment history:      up to 20 pts (2 pts per completed payment, capped at 10)
 *  - Report penalty:       -5 pts per report against user (capped at -30)
 *  - Warning penalty:      -10 pts per warning (capped at -30)
 *  - Moderation actions:   -5 pts per action (content removal, etc.), capped at -30
 *  - Banned:               score = 0
 *
 * @param signals - Aggregated trust signals for the user
 * @returns Integer score 0–100
 */
function computeScore(signals: TrustSignals): number {
  if (signals.isBanned) return 0;

  let score = 0;

  // Account age (1 pt per 10 days, max 30 pts at 300 days)
  score += Math.min(30, Math.floor(signals.accountAgeDays / 10));

  // Verification
  if (signals.isVerified) score += 20;

  // Payment history (2 pts each, max 20 pts)
  score += Math.min(20, signals.paymentCount * 2);

  // Report penalty (5 pts each, max -30)
  score -= Math.min(30, signals.reportCount * 5);

  // Warning penalty (10 pts each, max -30)
  score -= Math.min(30, signals.warningCount * 10);

  // Moderation action penalty (5 pts per action such as content removal, max -30)
  score -= Math.min(30, signals.moderationActionCount * 5);

  return Math.max(0, Math.min(100, score));
}

// ---------------------------------------------------------------------------
// calculateTrustScore
// ---------------------------------------------------------------------------

/**
 * Compute and persist the trust score for a user.
 *
 * Fetches the required signals from the database, computes the score,
 * and updates users.trust_score atomically.
 *
 * @param userId - User UUID
 * @param db     - Database adapter
 * @returns The newly computed trust score (0–100)
 */
export async function calculateTrustScore(
  userId: string,
  db: DatabaseAdapter
): Promise<number> {
  // Compile-time schema validation: if these columns are renamed or removed in
  // schema.ts, the type references below produce a TypeScript error before the
  // mismatch reaches production. The raw SQL query must use snake_case aliases.
  type _CheckColumns = {
    isBanned: typeof schema.users.isBanned;
    isVerified: typeof schema.users.isVerified;
    reportedUserId: typeof schema.reports.reportedUserId;
    targetUserId: typeof schema.moderationActions.targetUserId;
  };
  type TrustSignalRow = {
    account_age_days: string;
    report_count: string;
    warning_count: string;
    is_banned: boolean;
    is_verified: boolean;
    payment_count: string;
    moderation_action_count: string;
  };
  const { rows } = await db.query<TrustSignalRow>(
    `SELECT
       EXTRACT(DAY FROM (NOW() - u.created_at))::int::text  AS account_age_days,
       (SELECT COUNT(*)::text FROM reports WHERE reported_user_id = u.id) AS report_count,
       (SELECT COUNT(*)::text FROM moderation_actions WHERE target_user_id = u.id AND action_type = 'warn') AS warning_count,
       u.is_banned,
       u.is_verified,
       (
         SELECT COUNT(*)::text
         FROM payments
         WHERE user_id = u.id AND status = 'completed'
       )                                                     AS payment_count,
       (
         SELECT COUNT(*)::text
         FROM moderation_actions
         WHERE target_user_id = u.id AND action_type != 'warn'
       )                                                     AS moderation_action_count
     FROM users u
     WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [userId]
  );

  const row = rows[0];
  if (!row) {
    throw new Error(`[trustScore] User not found: ${userId}`);
  }

  const signals: TrustSignals = {
    accountAgeDays: parseInt(row.account_age_days, 10) || 0,
    reportCount: parseInt(row.report_count, 10) || 0,
    warningCount: parseInt(row.warning_count, 10) || 0,
    isBanned: row.is_banned,
    isVerified: row.is_verified,
    paymentCount: parseInt(row.payment_count, 10) || 0,
    moderationActionCount: parseInt(row.moderation_action_count, 10) || 0,
  };

  const score = computeScore(signals);

  await db.query(`UPDATE users SET trust_score = $1 WHERE id = $2`, [
    score,
    userId,
  ]);

  return score;
}

// ---------------------------------------------------------------------------
// batchCalculateTrustScores
// ---------------------------------------------------------------------------

/**
 * Compute and persist trust scores for multiple users in one DB round-trip.
 * Fetches all signals in a single query with LEFT JOINs, computes in JS,
 * then batch-updates all users atomically.
 *
 * @param userIds - Array of user UUIDs to recalculate
 * @param db      - Database adapter
 * @returns Map of userId → computed score
 */
export async function batchCalculateTrustScores(
  userIds: string[],
  db: DatabaseAdapter
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();

  type BatchRow = {
    id: string;
    account_age_days: string;
    report_count: string;
    warning_count: string;
    is_banned: boolean;
    is_verified: boolean;
    payment_count: string;
    moderation_action_count: string;
  };

  const { rows } = await db.query<BatchRow>(
    `SELECT
       u.id,
       EXTRACT(DAY FROM (NOW() - u.created_at))::int::text AS account_age_days,
       COALESCE(rc.report_count, 0)::text       AS report_count,
       COALESCE(wc.warning_count, 0)::text      AS warning_count,
       u.is_banned,
       u.is_verified,
       COALESCE(pc.payment_count, 0)::text      AS payment_count,
       COALESCE(mac.action_count, 0)::text      AS moderation_action_count
     FROM users u
     LEFT JOIN (
       SELECT reported_user_id AS uid, COUNT(*)::int AS report_count
       FROM reports WHERE reported_user_id = ANY($1::uuid[])
       GROUP BY reported_user_id
     ) rc ON rc.uid = u.id
     LEFT JOIN (
       SELECT target_user_id AS uid, COUNT(*)::int AS warning_count
       FROM moderation_actions
       WHERE target_user_id = ANY($1::uuid[]) AND action_type = 'warn'
       GROUP BY target_user_id
     ) wc ON wc.uid = u.id
     LEFT JOIN (
       SELECT user_id AS uid, COUNT(*)::int AS payment_count
       FROM payments
       WHERE user_id = ANY($1::uuid[]) AND status = 'completed'
       GROUP BY user_id
     ) pc ON pc.uid = u.id
     LEFT JOIN (
       SELECT target_user_id AS uid, COUNT(*)::int AS action_count
       FROM moderation_actions
       WHERE target_user_id = ANY($1::uuid[]) AND action_type != 'warn'
       GROUP BY target_user_id
     ) mac ON mac.uid = u.id
     WHERE u.id = ANY($1::uuid[]) AND u.deleted_at IS NULL`,
    [userIds]
  );

  const scores = new Map<string, number>();
  const updateIds: string[] = [];
  const updateScores: number[] = [];

  for (const row of rows) {
    const score = computeScore({
      accountAgeDays: parseInt(row.account_age_days, 10) || 0,
      reportCount: parseInt(row.report_count, 10) || 0,
      warningCount: parseInt(row.warning_count, 10) || 0,
      isBanned: row.is_banned,
      isVerified: row.is_verified,
      paymentCount: parseInt(row.payment_count, 10) || 0,
      moderationActionCount: parseInt(row.moderation_action_count, 10) || 0,
    });
    scores.set(row.id, score);
    updateIds.push(row.id);
    updateScores.push(score);
  }

  if (updateIds.length > 0) {
    await db.query(
      `UPDATE users u
       SET trust_score = updates.score, updated_at = NOW()
       FROM (SELECT unnest($1::uuid[]) AS id, unnest($2::int[]) AS score) updates
       WHERE u.id = updates.id`,
      [updateIds, updateScores]
    );
  }

  return scores;
}

// ---------------------------------------------------------------------------
// updateTrustScore
// ---------------------------------------------------------------------------

/**
 * Trigger a trust score recalculation in response to a relevant event.
 *
 * This is a convenience wrapper that logs the event and calls
 * calculateTrustScore. Errors are caught and logged — trust score
 * updates should never block the primary operation.
 *
 * @param userId - User UUID
 * @param event  - The event that triggered the update
 * @param db     - Database adapter
 */
export async function updateTrustScore(
  userId: string,
  event: TrustEvent,
  db: DatabaseAdapter
): Promise<void> {
  try {
    const newScore = await calculateTrustScore(userId, db);
    console.info(
      `[trustScore] Updated for user ${userId} (event: ${event}) → ${newScore}`
    );
  } catch (err) {
    console.error(
      `[trustScore] Failed to update for user ${userId} (event: ${event}):`,
      err
    );
  }
}

// ---------------------------------------------------------------------------
// meetsMinimumTrust
// ---------------------------------------------------------------------------

/**
 * Check whether a user meets the minimum trust requirements for a feature.
 *
 * For classroom_creation, additionally enforces the 30-day account age rule.
 * Reads trust_score from the database. Pass `forceRecalculate: true` after
 * moderation events (ban lifted, warning issued, etc.) to ensure the cached
 * column reflects the current state before gating.
 *
 * @param userId           - User UUID
 * @param feature          - The feature being gated
 * @param db               - Database adapter
 * @param forceRecalculate - When true, recomputes the score from signals before
 *                           checking the threshold (useful after moderation actions)
 * @returns true if the user is eligible
 */
export async function meetsMinimumTrust(
  userId: string,
  feature: TrustGatedFeature,
  db: DatabaseAdapter,
  { forceRecalculate = false }: { forceRecalculate?: boolean } = {}
): Promise<boolean> {
  // Compile-time schema validation: TypeScript errors if these columns change in schema.ts.
  type _CheckGateColumns = {
    trustScore: typeof schema.users.trustScore;
    isBanned: typeof schema.users.isBanned;
  };
  type TrustGateRow = {
    trust_score: number | null;
    account_age_days: number;
    is_banned: boolean;
  };
  const { rows } = await db.query<TrustGateRow>(
    `SELECT
       trust_score,
       EXTRACT(DAY FROM (NOW() - created_at))::int AS account_age_days,
       is_banned
     FROM users
     WHERE id = $1 AND deleted_at IS NULL`,
    [userId]
  );

  const user = rows[0];
  if (!user || user.is_banned) return false;

  // Recompute when explicitly requested (e.g. after a ban lift or warning) or
  // when the cached score is null (new users haven't had a score computed yet).
  let score = user.trust_score;
  if (score === null || forceRecalculate) {
    try {
      score = await calculateTrustScore(userId, db);
    } catch {
      score = 0;
    }
  }

  const requiredScore = FEATURE_THRESHOLDS[feature];
  if (score < requiredScore) return false;

  // ClassRoom requires 30-day account age in addition to trust score
  if (feature === "classroom_creation") {
    if (user.account_age_days < CLASSROOM_MIN_AGE_DAYS) return false;
  }

  return true;
}
