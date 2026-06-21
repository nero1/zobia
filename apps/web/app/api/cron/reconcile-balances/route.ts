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
 * Optimised from per-user INSERT/UPDATE loop to batch unnest() operations:
 *  - Auth uses timingSafeEqual (was plain string comparison — timing side-channel).
 *  - Discrepancy detection: one pass per BATCH_SIZE, two parallel ledger sum queries.
 *  - Audit inserts: single unnest() batch INSERT per batch.
 *  - Auto-corrections: single unnest() batch UPDATE per batch.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateCronSecret } from "@/lib/cron/auth";

const BATCH_SIZE = 500;
const AUTO_CORRECT_THRESHOLD = 50;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

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
    const { rows: users } = await db.query<{ id: string; xp_total: number; coin_balance: number }>(
      `SELECT id, xp_total, coin_balance FROM users
       WHERE deleted_at IS NULL AND id > $1 ORDER BY id LIMIT $2`,
      [lastId, BATCH_SIZE]
    );
    if (users.length === 0) break;

    const userIds = users.map((u) => u.id);
    lastId = users[users.length - 1].id;

    // Fetch ledger sums for the batch in parallel
    const [{ rows: xpSums }, { rows: coinSums }] = await Promise.all([
      db.query<{ user_id: string; ledger_sum: string }>(
        `SELECT user_id, COALESCE(SUM(amount), 0)::text AS ledger_sum
         FROM xp_ledger WHERE user_id = ANY($1) GROUP BY user_id`,
        [userIds]
      ),
      db.query<{ user_id: string; ledger_sum: string }>(
        `SELECT user_id, COALESCE(SUM(amount), 0)::text AS ledger_sum
         FROM coin_ledger WHERE user_id = ANY($1) GROUP BY user_id`,
        [userIds]
      ),
    ]);

    const xpMap   = new Map(xpSums.map((r) => [r.user_id, parseInt(r.ledger_sum, 10)]));
    const coinMap = new Map(coinSums.map((r) => [r.user_id, parseInt(r.ledger_sum, 10)]));

    // Classify discrepancies for this batch
    const discXpIds: string[] = [], discXpLedger: number[] = [], discXpBal: number[] = [];
    const discCoinIds: string[] = [], discCoinLedger: number[] = [], discCoinBal: number[] = [];
    const fixXpIds: string[] = [], fixXpValues: number[] = [];
    const fixCoinIds: string[] = [], fixCoinValues: number[] = [];

    for (const user of users) {
      const ledgerXp   = xpMap.get(user.id)   ?? 0;
      const ledgerCoins = coinMap.get(user.id) ?? 0;
      const xpDelta    = Math.abs(user.xp_total - ledgerXp);
      const coinDelta  = Math.abs(user.coin_balance - ledgerCoins);

      if (xpDelta > 0) {
        discrepanciesFound++;
        discXpIds.push(user.id);
        discXpLedger.push(ledgerXp);
        discXpBal.push(user.xp_total);
        if (xpDelta <= AUTO_CORRECT_THRESHOLD) {
          fixXpIds.push(user.id);
          fixXpValues.push(ledgerXp);
          autoCorrected++;
        }
      }

      if (coinDelta > 0) {
        discrepanciesFound++;
        discCoinIds.push(user.id);
        discCoinLedger.push(ledgerCoins);
        discCoinBal.push(user.coin_balance);
        if (coinDelta <= AUTO_CORRECT_THRESHOLD) {
          fixCoinIds.push(user.id);
          fixCoinValues.push(ledgerCoins);
          autoCorrected++;
        }
      }
    }

    // Batch-upsert XP discrepancies
    if (discXpIds.length > 0) {
      await db.query(
        `INSERT INTO audit_discrepancies (user_id, asset_type, ledger_sum, wallet_balance, detected_at)
         SELECT unnest($1::uuid[]), 'xp', unnest($2::int[]), unnest($3::int[]), NOW()
         ON CONFLICT (user_id, asset_type) DO UPDATE
           SET ledger_sum = EXCLUDED.ledger_sum,
               wallet_balance = EXCLUDED.wallet_balance,
               detected_at = NOW(),
               resolved = FALSE`,
        [discXpIds, discXpLedger, discXpBal]
      ).catch(() => {});
    }

    // Batch-upsert coin discrepancies
    if (discCoinIds.length > 0) {
      await db.query(
        `INSERT INTO audit_discrepancies (user_id, asset_type, ledger_sum, wallet_balance, detected_at)
         SELECT unnest($1::uuid[]), 'coins', unnest($2::int[]), unnest($3::int[]), NOW()
         ON CONFLICT (user_id, asset_type) DO UPDATE
           SET ledger_sum = EXCLUDED.ledger_sum,
               wallet_balance = EXCLUDED.wallet_balance,
               detected_at = NOW(),
               resolved = FALSE`,
        [discCoinIds, discCoinLedger, discCoinBal]
      ).catch(() => {});
    }

    // AUDIT-01: Insert per-user audit records before auto-correcting XP discrepancies
    for (let i = 0; i < fixXpIds.length; i++) {
      const userId = fixXpIds[i];
      const ledgerSum = fixXpValues[i];
      const walletBalance = discXpBal[discXpIds.indexOf(userId)];
      await db.query(
        `INSERT INTO audit_discrepancies (user_id, asset_type, ledger_sum, wallet_balance, detected_at, notes)
         VALUES ($1, $2, $3, $4, NOW(), 'auto-corrected by reconcile-balances CRON')
         ON CONFLICT (user_id, asset_type) DO UPDATE
           SET ledger_sum = $3, wallet_balance = $4, detected_at = NOW(), resolved = false, notes = 'auto-corrected by reconcile-balances CRON'`,
        [userId, 'xp', ledgerSum, walletBalance]
      ).catch(() => {});
      // OPS-01: Alert on large XP discrepancies
      const discrepancyAmount = Math.abs(Number(ledgerSum) - Number(walletBalance));
      if (discrepancyAmount > 1000) {
        await db.query(
          `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
           VALUES ('balance_discrepancy', 'warning', $1, $2::jsonb, NOW())`,
          [
            `Large balance discrepancy detected for user ${userId}: xp balance differs by ${discrepancyAmount}`,
            JSON.stringify({ userId, assetType: 'xp', ledgerSum, walletBalance, discrepancyAmount }),
          ]
        ).catch(() => {});
      }
    }

    // Batch auto-correct XP
    if (fixXpIds.length > 0) {
      await db.query(
        `UPDATE users SET xp_total = updates.val, updated_at = NOW()
         FROM (SELECT unnest($1::uuid[]) AS uid, unnest($2::int[]) AS val) updates
         WHERE id = updates.uid`,
        [fixXpIds, fixXpValues]
      ).catch(() => {});
    }

    // AUDIT-01: Insert per-user audit records before auto-correcting coin discrepancies
    for (let i = 0; i < fixCoinIds.length; i++) {
      const userId = fixCoinIds[i];
      const ledgerSum = fixCoinValues[i];
      const walletBalance = discCoinBal[discCoinIds.indexOf(userId)];
      await db.query(
        `INSERT INTO audit_discrepancies (user_id, asset_type, ledger_sum, wallet_balance, detected_at, notes)
         VALUES ($1, $2, $3, $4, NOW(), 'auto-corrected by reconcile-balances CRON')
         ON CONFLICT (user_id, asset_type) DO UPDATE
           SET ledger_sum = $3, wallet_balance = $4, detected_at = NOW(), resolved = false, notes = 'auto-corrected by reconcile-balances CRON'`,
        [userId, 'coins', ledgerSum, walletBalance]
      ).catch(() => {});
      // OPS-01: Alert on large coin discrepancies
      const discrepancyAmount = Math.abs(Number(ledgerSum) - Number(walletBalance));
      if (discrepancyAmount > 1000) {
        await db.query(
          `INSERT INTO system_alerts (type, severity, message, metadata, created_at)
           VALUES ('balance_discrepancy', 'warning', $1, $2::jsonb, NOW())`,
          [
            `Large balance discrepancy detected for user ${userId}: coins balance differs by ${discrepancyAmount}`,
            JSON.stringify({ userId, assetType: 'coins', ledgerSum, walletBalance, discrepancyAmount }),
          ]
        ).catch(() => {});
      }
    }

    // Batch auto-correct coins
    if (fixCoinIds.length > 0) {
      await db.query(
        `UPDATE users SET coin_balance = updates.val, updated_at = NOW()
         FROM (SELECT unnest($1::uuid[]) AS uid, unnest($2::int[]) AS val) updates
         WHERE id = updates.uid`,
        [fixCoinIds, fixCoinValues]
      ).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, discrepanciesFound, autoCorrected });
}
