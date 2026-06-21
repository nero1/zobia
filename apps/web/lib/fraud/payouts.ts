/**
 * lib/fraud/payouts.ts
 *
 * Payout fraud detection checks.
 *
 * Called before every payout request. Returns a result indicating whether
 * the payout should be flagged for manual admin review. Does NOT block
 * payouts — it forces them into awaiting_approval so a human can decide.
 *
 * Checks performed:
 *   1. New-account gift inflow: large coin volume from accounts < 7 days old
 *   2. Velocity: too many payout requests in the past 24 hours
 *   3. Trust score: creator trust score below minimum threshold
 */

import type { DatabaseAdapter } from "@/lib/db/interface";
import { getManifestValue } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FraudCheckResult {
  /** Whether the payout should be flagged for manual review. */
  isSuspicious: boolean;
  /** Human-readable reasons for the flag (logged + shown to admin). */
  reasons: string[];
  /** True when the check result forces manual approval regardless of amount. */
  forceManual: boolean;
}

// ---------------------------------------------------------------------------
// System actor sentinel UUID for audit log entries generated without a human actor
// ---------------------------------------------------------------------------

const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------------------
// Thresholds — defaults used when manifest values are unavailable
// ---------------------------------------------------------------------------

/** Minimum coins received from new accounts to trigger the inflow flag. */
const SUSPICIOUS_INFLOW_THRESHOLD_COINS = 5_000;
/** Minimum number of distinct new accounts to trigger the inflow flag. */
const SUSPICIOUS_INFLOW_MIN_ACCOUNTS = 3;
/** Age threshold (days) below which a sender account is considered "new". */
const NEW_ACCOUNT_AGE_DAYS = 7;
/** Max payout requests in 24 hours before velocity flag fires. */
const MAX_PAYOUT_REQUESTS_PER_DAY = 3;
/** Trust score below which any payout request is forced to manual review. */
const MIN_TRUST_SCORE_FOR_AUTO = 30;

// ---------------------------------------------------------------------------
// Main check
// ---------------------------------------------------------------------------

/**
 * Run all fraud checks for a payout request.
 *
 * @param creatorId  - UUID of the creator requesting the payout
 * @param grossKobo  - Gross amount requested in kobo
 * @param db         - Database adapter (use the shared singleton in route handlers)
 * @returns FraudCheckResult
 */
export async function checkPayoutFraud(
  creatorId: string,
  grossKobo: number,
  db: DatabaseAdapter
): Promise<FraudCheckResult> {
  const reasons: string[] = [];

  // FRAUD-02: Read thresholds from manifest so they can be tuned without deploys
  const [inflowThresholdRaw, newAccountAgeDaysRaw, maxPayoutsPerDayRaw, giftWindowDaysRaw] = await Promise.all([
    getManifestValue('fraud_inflow_threshold_coins'),
    getManifestValue('fraud_new_account_age_days'),
    getManifestValue('fraud_max_payouts_per_day'),
    getManifestValue('fraud_gift_window_days'),
  ]).catch(() => [null, null, null, null]);

  const effectiveInflowThreshold = parseInt(inflowThresholdRaw ?? String(SUSPICIOUS_INFLOW_THRESHOLD_COINS), 10) || SUSPICIOUS_INFLOW_THRESHOLD_COINS;
  const effectiveNewAccountAgeDays = parseInt(newAccountAgeDaysRaw ?? String(NEW_ACCOUNT_AGE_DAYS), 10) || NEW_ACCOUNT_AGE_DAYS;
  const effectiveMaxPayoutsPerDay = parseInt(maxPayoutsPerDayRaw ?? String(MAX_PAYOUT_REQUESTS_PER_DAY), 10) || MAX_PAYOUT_REQUESTS_PER_DAY;
  const effectiveGiftWindowDays = parseInt(giftWindowDaysRaw ?? "7", 10) || 7;

  await Promise.all([
    checkNewAccountGiftInflow(creatorId, db, reasons, effectiveInflowThreshold, effectiveNewAccountAgeDays, effectiveGiftWindowDays),
    checkPayoutVelocity(creatorId, db, reasons, effectiveMaxPayoutsPerDay),
    checkTrustScore(creatorId, db, reasons),
  ]);

  const isSuspicious = reasons.length > 0;

  if (isSuspicious) {
    // Log to system_alerts — best-effort, never blocks the calling flow
    await db
      .query(
        `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
         VALUES ('payout_fraud_flag', 'critical', $1, $2::jsonb, NOW())`,
        [
          `Payout fraud flag: creator ${creatorId} requested ₦${(grossKobo / 100).toFixed(2)}. Reasons: ${reasons.join('; ')}`,
          JSON.stringify({ creatorId, grossKobo, reasons }),
        ]
      )
      .catch(() => {});

    // FRAUD-03: Use SYSTEM_ACTOR_ID instead of NULL — admin_audit_log.admin_id is NOT NULL
    await db
      .query(
        `INSERT INTO admin_audit_log (admin_id, action, resource, resource_id, after_val, created_at)
         VALUES (
           $3::uuid,
           'payout_fraud_flagged', 'creator_payouts', $1, $2::jsonb, NOW()
         )`,
        [creatorId, JSON.stringify({ creatorId, grossKobo, reasons }), SYSTEM_ACTOR_ID]
      )
      .catch(() => {});
  }

  return { isSuspicious, reasons, forceManual: isSuspicious };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

async function checkNewAccountGiftInflow(
  creatorId: string,
  db: DatabaseAdapter,
  reasons: string[],
  inflowThreshold: number,
  newAccountAgeDays: number,
  giftWindowDays: number
): Promise<void> {
  try {
    // Union room gifts AND direct DM gifts so wash-trading via DMs is caught too
    const { rows } = await db.query<{ total_coins: string; account_count: string }>(
      `SELECT
         COALESCE(SUM(combined.coin_cost), 0)::TEXT  AS total_coins,
         COUNT(DISTINCT combined.sender_id)::TEXT      AS account_count
       FROM (
         -- Room gifts received in the creator's rooms
         SELECT g.coin_cost, g.sender_id
         FROM gifts g
         JOIN rooms r ON r.id = g.room_id
         JOIN users sender ON sender.id = g.sender_id
         WHERE r.creator_id = $1
           AND sender.created_at >= NOW() - ($2 * INTERVAL '1 day')
           AND g.created_at >= NOW() - ($3 * INTERVAL '1 day')

         UNION ALL

         -- Direct (DM) gifts sent to the creator
         SELECT g2.coin_cost, g2.sender_id
         FROM gifts g2
         JOIN users sender2 ON sender2.id = g2.sender_id
         WHERE g2.recipient_id = $1
           AND g2.room_id IS NULL
           AND sender2.created_at >= NOW() - ($2 * INTERVAL '1 day')
           AND g2.created_at >= NOW() - ($3 * INTERVAL '1 day')
       ) combined`,
      [creatorId, newAccountAgeDays, giftWindowDays]
    );

    const totalCoins = parseInt(rows[0]?.total_coins ?? "0", 10);
    const accountCount = parseInt(rows[0]?.account_count ?? "0", 10);

    if (
      totalCoins >= inflowThreshold &&
      accountCount >= SUSPICIOUS_INFLOW_MIN_ACCOUNTS
    ) {
      reasons.push(
        `Received ${totalCoins.toLocaleString()} coins from ${accountCount} accounts aged < ${newAccountAgeDays} days in the past ${giftWindowDays} days (room + DM gifts combined)`
      );
    }
  } catch {
    // Non-fatal: skip this check if the gifts table doesn't exist yet
  }
}

async function checkPayoutVelocity(
  creatorId: string,
  db: DatabaseAdapter,
  reasons: string[],
  maxPayoutsPerDay: number
): Promise<void> {
  try {
    const { rows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::TEXT AS count
       FROM creator_payouts
       WHERE creator_id = $1
         AND created_at >= NOW() - INTERVAL '24 hours'
         AND status NOT IN ('retrying', 'system_retry')`,
      [creatorId]
    );

    const count = parseInt(rows[0]?.count ?? "0", 10);
    if (count >= maxPayoutsPerDay) {
      reasons.push(`${count} payout requests in the past 24 hours (max ${maxPayoutsPerDay})`);
    }
  } catch {
    // Non-fatal
  }
}

async function checkTrustScore(
  creatorId: string,
  db: DatabaseAdapter,
  reasons: string[]
): Promise<void> {
  try {
    const { rows } = await db.query<{ trust_score: number }>(
      `SELECT trust_score FROM users WHERE id = $1 LIMIT 1`,
      [creatorId]
    );

    const score = rows[0]?.trust_score ?? 50;
    if (score < MIN_TRUST_SCORE_FOR_AUTO) {
      reasons.push(`Trust score ${score} is below the auto-approval minimum (${MIN_TRUST_SCORE_FOR_AUTO})`);
    }
  } catch {
    // Non-fatal
  }
}
