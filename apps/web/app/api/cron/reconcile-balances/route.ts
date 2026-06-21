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
import { timingSafeEqual } from "crypto";
import { db } from "@/lib/db";

const BATCH_SIZE = 500;
const AUTO_CORRECT_THRESHOLD = 50;

function isValidSecret(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const authHeader = req.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!isValidSecret(token, cronSecret)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let discrepanciesFound = 0;
  let autoCorrected = 0;
  let offset = 0;
  // BUG-M05: Bound the while(true) loop so a large dataset can't cause a silent
  // mid-run timeout. MAX_ITERATIONS × BATCH_SIZE = 100 000 users per invocation.
  // Incomplete runs return a partial-success response so operators know to re-run.
  const MAX_ITERATIONS = 200;
  let iterations = 0;

  while (true) {
    if (++iterations > MAX_ITERATIONS) {
      console.error(`[reconcile-balances] Hit iteration cap (${MAX_ITERATIONS}), stopping early at offset ${offset}`);
      return NextResponse.json(
        { ok: false, partial: true, discrepanciesFound, autoCorrected, stoppedAtOffset: offset },
        { status: 206 }
      );
    }
    const { rows: users } = await db.query<{ id: string; xp_total: number; coin_balance: number }>(
      `SELECT id, xp_total, coin_balance FROM users
       WHERE deleted_at IS NULL ORDER BY id LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );
    if (users.length === 0) break;

    const userIds = users.map((u) => u.id);

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

    // Batch auto-correct XP
    if (fixXpIds.length > 0) {
      await db.query(
        `UPDATE users SET xp_total = updates.val, updated_at = NOW()
         FROM (SELECT unnest($1::uuid[]) AS uid, unnest($2::int[]) AS val) updates
         WHERE id = updates.uid`,
        [fixXpIds, fixXpValues]
      ).catch(() => {});
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

    offset += BATCH_SIZE;
  }

  return NextResponse.json({ ok: true, discrepanciesFound, autoCorrected });
}
