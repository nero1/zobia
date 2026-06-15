export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/reconcile-balances
 *
 * Nightly CRON: detect and flag balance discrepancies between
 * users.xp_total/coin_balance and their respective ledger sums. (BUG-31)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

const BATCH_SIZE = 500;
const AUTO_CORRECT_THRESHOLD = 50; // auto-correct discrepancies smaller than this

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization");
  const secret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  let discrepanciesFound = 0;
  let autoCorrected = 0;
  let offset = 0;

  while (true) {
    const { rows: users } = await db.query<{ id: string; xp_total: number; coin_balance: number }>(
      `SELECT id, xp_total, coin_balance FROM users
       WHERE deleted_at IS NULL
       ORDER BY id
       LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );
    if (users.length === 0) break;

    const userIds = users.map((u) => u.id);

    const { rows: xpSums } = await db.query<{ user_id: string; ledger_sum: string }>(
      `SELECT user_id, COALESCE(SUM(amount), 0)::text AS ledger_sum
       FROM xp_ledger WHERE user_id = ANY($1) GROUP BY user_id`,
      [userIds]
    );
    const { rows: coinSums } = await db.query<{ user_id: string; ledger_sum: string }>(
      `SELECT user_id, COALESCE(SUM(amount), 0)::text AS ledger_sum
       FROM coin_ledger WHERE user_id = ANY($1) GROUP BY user_id`,
      [userIds]
    );

    const xpMap = new Map(xpSums.map((r) => [r.user_id, parseInt(r.ledger_sum, 10)]));
    const coinMap = new Map(coinSums.map((r) => [r.user_id, parseInt(r.ledger_sum, 10)]));

    for (const user of users) {
      const ledgerXp = xpMap.get(user.id) ?? 0;
      const ledgerCoins = coinMap.get(user.id) ?? 0;

      const xpDelta = Math.abs(user.xp_total - ledgerXp);
      const coinDelta = Math.abs(user.coin_balance - ledgerCoins);

      if (xpDelta > 0) {
        discrepanciesFound++;
        await db.query(
          `INSERT INTO audit_discrepancies (user_id, asset_type, ledger_sum, wallet_balance, detected_at)
           VALUES ($1, 'xp', $2, $3, NOW())
           ON CONFLICT (user_id, asset_type) DO UPDATE
             SET ledger_sum = EXCLUDED.ledger_sum,
                 wallet_balance = EXCLUDED.wallet_balance,
                 detected_at = NOW(),
                 resolved = FALSE`,
          [user.id, ledgerXp, user.xp_total]
        ).catch(() => {});

        if (xpDelta <= AUTO_CORRECT_THRESHOLD) {
          await db.query(
            `UPDATE users SET xp_total = $1, updated_at = NOW() WHERE id = $2`,
            [ledgerXp, user.id]
          ).catch(() => {});
          autoCorrected++;
        }
      }

      if (coinDelta > 0) {
        discrepanciesFound++;
        await db.query(
          `INSERT INTO audit_discrepancies (user_id, asset_type, ledger_sum, wallet_balance, detected_at)
           VALUES ($1, 'coins', $2, $3, NOW())
           ON CONFLICT (user_id, asset_type) DO UPDATE
             SET ledger_sum = EXCLUDED.ledger_sum,
                 wallet_balance = EXCLUDED.wallet_balance,
                 detected_at = NOW(),
                 resolved = FALSE`,
          [user.id, ledgerCoins, user.coin_balance]
        ).catch(() => {});

        if (coinDelta <= AUTO_CORRECT_THRESHOLD) {
          await db.query(
            `UPDATE users SET coin_balance = $1, updated_at = NOW() WHERE id = $2`,
            [ledgerCoins, user.id]
          ).catch(() => {});
          autoCorrected++;
        }
      }
    }

    offset += BATCH_SIZE;
  }

  return NextResponse.json({ ok: true, discrepanciesFound, autoCorrected });
}
