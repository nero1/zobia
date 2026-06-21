export const dynamic = 'force-dynamic';
// BUG-M05: Increase maxDuration to allow reconciliation across large user tables.
// The default was 10 s which would time out mid-loop on datasets > ~5 000 users.
export const maxDuration = 300;

/**
 * GET /api/cron/reconcile-balances
 *
 * Nightly CRON: detect and flag balance discrepancies between
 * users.xp_total/coin_balance and their respective ledger sums. (BUG-31)
 *
 * Fixes applied:
 *  - BUG-CRON-02: use BigInt for coin/XP values to avoid precision loss on large balances.
 *  - BUG-CRON-01: raise critical system_alert when discrepancy exceeds AUTO_CORRECT_THRESHOLD.
 *  - BUG-CRON-05: AUTO_CORRECT_THRESHOLD now read from manifest (default 50).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateCronSecret } from "@/lib/cron/auth";
import { getManifestValue } from "@/lib/manifest";

const BATCH_SIZE = 500;
const DEFAULT_AUTO_CORRECT_THRESHOLD = 50;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  // BUG-CRON-05: read threshold from manifest so operators can tune without a code deploy
  const manifestThreshold = await getManifestValue('reconcileAutoCorrectThreshold').catch(() => null);
  const AUTO_CORRECT_THRESHOLD = (typeof manifestThreshold === 'number' && manifestThreshold > 0)
    ? manifestThreshold
    : DEFAULT_AUTO_CORRECT_THRESHOLD;

  let discrepanciesFound = 0;
  let autoCorrected = 0;
  // PERF-06: Use keyset (cursor-based) pagination instead of OFFSET to avoid
  // full-table scans that grow with each page. Cursor is the last seen user id.
  let lastId = '00000000-0000-0000-0000-000000000000';
  // BUG-M05: Bound the while(true) loop so a large dataset can't cause a silent
  // mid-run timeout. MAX_ITERATIONS × BATCH_SIZE = 100 000 users per invocation.
  // Incomplete runs return a partial-success response so operators know to re-run.
  const MAX_ITERATIONS = 200;
  let iterations = 0;

  while (true) {
    if (++iterations > MAX_ITERATIONS) {
      console.error(`[reconcile-balances] Hit iteration cap (${MAX_ITERATIONS}), stopping early at cursor ${lastId}`);
      return NextResponse.json(
        { ok: false, partial: true, discrepanciesFound, autoCorrected, stoppedAtCursor: lastId },
        { status: 206 }
      );
    }
    // BUG-CRON-03 FIX: single CTE reads wallet balances and ledger sums in one
    // snapshot-consistent query, eliminating the TOCTOU window where a concurrent
    // XP award could change balances between the separate SELECT and SUM queries.
    const { rows: batchRows } = await db.query<{
      id: string;
      xp_total: string;
      coin_balance: string;
      xp_ledger_sum: string;
      coin_ledger_sum: string;
    }>(
      `WITH batch AS (
         SELECT id, xp_total::text, coin_balance::text
         FROM users
         WHERE deleted_at IS NULL AND id > $1
         ORDER BY id LIMIT $2
       ),
       xp_sums AS (
         SELECT user_id, COALESCE(SUM(amount), 0)::text AS ledger_sum
         FROM xp_ledger WHERE user_id IN (SELECT id FROM batch) GROUP BY user_id
       ),
       coin_sums AS (
         SELECT user_id, COALESCE(SUM(amount), 0)::text AS ledger_sum
         FROM coin_ledger WHERE user_id IN (SELECT id FROM batch) GROUP BY user_id
       )
       SELECT b.id, b.xp_total, b.coin_balance,
              COALESCE(x.ledger_sum, '0') AS xp_ledger_sum,
              COALESCE(c.ledger_sum, '0') AS coin_ledger_sum
       FROM batch b
       LEFT JOIN xp_sums x ON x.user_id = b.id
       LEFT JOIN coin_sums c ON c.user_id = b.id`,
      [lastId, BATCH_SIZE]
    );
    const users = batchRows;
    if (users.length === 0) break;

    lastId = users[users.length - 1].id;

    // BUG-CRON-02: use BigInt to avoid IEEE 754 precision loss on large balances
    const xpMap   = new Map(users.map((r) => [r.id, BigInt(r.xp_ledger_sum)]));
    const coinMap = new Map(users.map((r) => [r.id, BigInt(r.coin_ledger_sum)]));

    // Classify discrepancies for this batch
    const discXpIds: string[] = [], discXpLedger: bigint[] = [], discXpBal: bigint[] = [];
    const discCoinIds: string[] = [], discCoinLedger: bigint[] = [], discCoinBal: bigint[] = [];
    const fixXpIds: string[] = [], fixXpValues: bigint[] = [];
    const fixCoinIds: string[] = [], fixCoinValues: bigint[] = [];
    // Large discrepancies above threshold — alert without auto-correcting
    const largeXpDiscrepancies: Array<{ userId: string; ledgerSum: bigint; walletBalance: bigint; delta: bigint }> = [];
    const largeCoinDiscrepancies: Array<{ userId: string; ledgerSum: bigint; walletBalance: bigint; delta: bigint }> = [];

    for (const user of users) {
      const ledgerXp    = xpMap.get(user.id)   ?? 0n;
      const ledgerCoins = coinMap.get(user.id) ?? 0n;
      const walletXp    = BigInt(user.xp_total);
      const walletCoins = BigInt(user.coin_balance);
      const xpDelta    = walletXp > ledgerXp ? walletXp - ledgerXp : ledgerXp - walletXp;
      const coinDelta  = walletCoins > ledgerCoins ? walletCoins - ledgerCoins : ledgerCoins - walletCoins;

      if (xpDelta > 0n) {
        discrepanciesFound++;
        discXpIds.push(user.id);
        discXpLedger.push(ledgerXp);
        discXpBal.push(walletXp);
        if (xpDelta <= BigInt(AUTO_CORRECT_THRESHOLD)) {
          fixXpIds.push(user.id);
          fixXpValues.push(ledgerXp);
          autoCorrected++;
        } else {
          // BUG-CRON-01: large discrepancy — alert but do not auto-correct
          largeXpDiscrepancies.push({ userId: user.id, ledgerSum: ledgerXp, walletBalance: walletXp, delta: xpDelta });
        }
      }

      if (coinDelta > 0n) {
        discrepanciesFound++;
        discCoinIds.push(user.id);
        discCoinLedger.push(ledgerCoins);
        discCoinBal.push(walletCoins);
        if (coinDelta <= BigInt(AUTO_CORRECT_THRESHOLD)) {
          fixCoinIds.push(user.id);
          fixCoinValues.push(ledgerCoins);
          autoCorrected++;
        } else {
          // BUG-CRON-01: large discrepancy — alert but do not auto-correct
          largeCoinDiscrepancies.push({ userId: user.id, ledgerSum: ledgerCoins, walletBalance: walletCoins, delta: coinDelta });
        }
      }
    }

    // DISC-01: plain INSERT (no ON CONFLICT UPDATE) so each detection is a new row.
    // History is preserved; use the active index (WHERE resolved = false) for lookups.
    if (discXpIds.length > 0) {
      await db.query(
        `INSERT INTO audit_discrepancies (user_id, asset_type, ledger_sum, wallet_balance, detected_at)
         SELECT unnest($1::uuid[]), 'xp', unnest($2::bigint[]), unnest($3::bigint[]), NOW()`,
        [discXpIds, discXpLedger.map(String), discXpBal.map(String)]
      ).catch(() => {});
    }

    if (discCoinIds.length > 0) {
      await db.query(
        `INSERT INTO audit_discrepancies (user_id, asset_type, ledger_sum, wallet_balance, detected_at)
         SELECT unnest($1::uuid[]), 'coins', unnest($2::bigint[]), unnest($3::bigint[]), NOW()`,
        [discCoinIds, discCoinLedger.map(String), discCoinBal.map(String)]
      ).catch(() => {});
    }

    // BUG-CRON-01: Raise critical alerts for large discrepancies that exceed the threshold.
    for (const d of largeXpDiscrepancies) {
      await db.query(
        `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
         VALUES ('balance_discrepancy', 'critical', $1, $2::jsonb, NOW())`,
        [
          `Large XP discrepancy for user ${d.userId}: delta ${d.delta} (above auto-correct threshold ${AUTO_CORRECT_THRESHOLD})`,
          JSON.stringify({ userId: d.userId, assetType: 'xp', ledgerSum: String(d.ledgerSum), walletBalance: String(d.walletBalance), delta: String(d.delta), threshold: AUTO_CORRECT_THRESHOLD }),
        ]
      ).catch(() => {});
    }

    for (const d of largeCoinDiscrepancies) {
      await db.query(
        `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
         VALUES ('balance_discrepancy', 'critical', $1, $2::jsonb, NOW())`,
        [
          `Large coin discrepancy for user ${d.userId}: delta ${d.delta} (above auto-correct threshold ${AUTO_CORRECT_THRESHOLD})`,
          JSON.stringify({ userId: d.userId, assetType: 'coins', ledgerSum: String(d.ledgerSum), walletBalance: String(d.walletBalance), delta: String(d.delta), threshold: AUTO_CORRECT_THRESHOLD }),
        ]
      ).catch(() => {});
    }

    // AUDIT-01: Insert audit records and alert on ALL auto-corrections (RECONCILE-01).
    for (let i = 0; i < fixXpIds.length; i++) {
      const userId = fixXpIds[i];
      const ledgerSum = fixXpValues[i];
      const walletBalance = discXpBal[discXpIds.indexOf(userId)];
      const discrepancyAmount = ledgerSum > walletBalance ? ledgerSum - walletBalance : walletBalance - ledgerSum;
      await db.query(
        `INSERT INTO audit_discrepancies (user_id, asset_type, ledger_sum, wallet_balance, detected_at, notes)
         VALUES ($1, 'xp', $2, $3, NOW(), 'auto-corrected by reconcile-balances CRON')`,
        [userId, String(ledgerSum), String(walletBalance)]
      ).catch(() => {});
      await db.query(
        `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
         VALUES ('balance_discrepancy', 'warning', $1, $2::jsonb, NOW())`,
        [
          `XP balance auto-corrected for user ${userId}: delta ${discrepancyAmount}`,
          JSON.stringify({ userId, assetType: 'xp', ledgerSum: String(ledgerSum), walletBalance: String(walletBalance), discrepancyAmount: String(discrepancyAmount) }),
        ]
      ).catch(() => {});
    }

    // Batch auto-correct XP
    if (fixXpIds.length > 0) {
      await db.query(
        `UPDATE users SET xp_total = updates.val::bigint, updated_at = NOW()
         FROM (SELECT unnest($1::uuid[]) AS uid, unnest($2::text[]) AS val) updates
         WHERE id = updates.uid`,
        [fixXpIds, fixXpValues.map(String)]
      ).catch(() => {});
    }

    for (let i = 0; i < fixCoinIds.length; i++) {
      const userId = fixCoinIds[i];
      const ledgerSum = fixCoinValues[i];
      const walletBalance = discCoinBal[discCoinIds.indexOf(userId)];
      const discrepancyAmount = ledgerSum > walletBalance ? ledgerSum - walletBalance : walletBalance - ledgerSum;
      await db.query(
        `INSERT INTO audit_discrepancies (user_id, asset_type, ledger_sum, wallet_balance, detected_at, notes)
         VALUES ($1, 'coins', $2, $3, NOW(), 'auto-corrected by reconcile-balances CRON')`,
        [userId, String(ledgerSum), String(walletBalance)]
      ).catch(() => {});
      await db.query(
        `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
         VALUES ('balance_discrepancy', 'warning', $1, $2::jsonb, NOW())`,
        [
          `Coin balance auto-corrected for user ${userId}: delta ${discrepancyAmount}`,
          JSON.stringify({ userId, assetType: 'coins', ledgerSum: String(ledgerSum), walletBalance: String(walletBalance), discrepancyAmount: String(discrepancyAmount) }),
        ]
      ).catch(() => {});
    }

    // Batch auto-correct coins
    if (fixCoinIds.length > 0) {
      await db.query(
        `UPDATE users SET coin_balance = updates.val::bigint, updated_at = NOW()
         FROM (SELECT unnest($1::uuid[]) AS uid, unnest($2::text[]) AS val) updates
         WHERE id = updates.uid`,
        [fixCoinIds, fixCoinValues.map(String)]
      ).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, discrepanciesFound, autoCorrected });
}
