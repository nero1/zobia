export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * app/api/cron/daily-users/route.ts
 *
 * CRON slot 2 of 7 — runs at 00:00 UTC (01:00 WAT).
 * Vercel Hobby: scheduled via vercel.json, once per day.
 *
 * User-state jobs that depend on daily-core having run first:
 *  1. Detect inactivity events (3 / 7 / 14 / 30 / 90 day thresholds)
 *  2. Guild discovery prompts for new users (single batch INSERT)
 *  3. Expire unclaimed 90-day comeback coin reservations
 *
 * All operations are set-based or batched — no per-row loops.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateCronSecret, checkCronIdempotency } from "@/lib/cron/auth";

const INACTIVITY_TRIGGERS = [3, 7, 14, 30, 90] as const;
const COMEBACK_COIN_AMOUNT = 200;

export const GET = async (req: NextRequest) => {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const didClaim = await checkCronIdempotency("cron_daily_users_last_run", db);
  if (!didClaim) {
    return NextResponse.json({ skipped: true, reason: "Already ran today" });
  }

  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  // 1. Inactivity event detection — one query per threshold (set-based INSERT)
  try {
    const inactivityEvents: Record<number, number> = {};
    for (const days of INACTIVITY_TRIGGERS) {
      const cutoff     = new Date(Date.now() - days       * 86_400_000).toISOString();
      const oneDayBack = new Date(Date.now() - (days + 1) * 86_400_000).toISOString();
      const { rows } = await db.query<{ count: string }>(
        `WITH flagged AS (
           INSERT INTO user_inactivity_events (user_id, inactive_days, created_at)
           SELECT id, $1, NOW()
           FROM users
           WHERE deleted_at IS NULL
             AND last_active_at BETWEEN $2 AND $3
             AND NOT EXISTS (
               SELECT 1 FROM user_inactivity_events
               WHERE user_id = users.id AND inactive_days = $1
                 AND created_at > NOW() - INTERVAL '7 days'
             )
           ON CONFLICT DO NOTHING
           RETURNING 1
         )
         SELECT COUNT(*) AS count FROM flagged`,
        [days, oneDayBack, cutoff]
      );
      inactivityEvents[days] = parseInt(rows[0]?.count ?? "0");
    }
    results.inactivityEvents = inactivityEvents;
  } catch (err) {
    errors.push(`inactivityEvents: ${String(err)}`);
  }

  // 2. Guild discovery prompts — single batch INSERT...SELECT (was per-user loop)
  try {
    const { rows } = await db.query<{ count: string }>(
      `WITH notified AS (
         INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
         SELECT u.id,
                'guild_discovery',
                'Join a Guild',
                'Crews near you are recruiting! Join a Guild to earn XP boosts.',
                '{}',
                false,
                NOW()
         FROM users u
         WHERE u.created_at BETWEEN NOW() - INTERVAL '25 hours' AND NOW() - INTERVAL '23 hours'
           AND u.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM guild_members gm WHERE gm.user_id = u.id)
           AND NOT EXISTS (
             SELECT 1 FROM notifications n
             WHERE n.user_id = u.id AND n.type = 'guild_discovery'
           )
         RETURNING 1
       )
       SELECT COUNT(*) AS count FROM notified`
    );
    results.guildDiscoveryPrompts = { notified: parseInt(rows[0]?.count ?? "0") };
  } catch (err) {
    errors.push(`guildDiscoveryPrompts: ${String(err)}`);
  }

  // 3. Expire unclaimed comeback coin reservations (7-day window)
  try {
    const { rows: expiredBonusUsers } = await db.query<{
      user_id: string;
    }>(
      `SELECT cl.user_id
       FROM coin_ledger cl
       JOIN users u ON u.id = cl.user_id
       WHERE cl.transaction_type = 'comeback_bonus_reserved'
         AND cl.created_at < NOW() - INTERVAL '7 days'
         AND NOT EXISTS (
           SELECT 1 FROM coin_ledger cl2
           WHERE cl2.user_id = cl.user_id
             AND cl2.transaction_type = 'comeback_bonus_claimed'
             AND cl2.created_at > cl.created_at
         )
         AND (u.last_active_at IS NULL OR u.last_active_at < cl.created_at)
         AND u.deleted_at IS NULL`
    );

    let expiredBonuses = 0;
    const { debitCoins } = await import("@/lib/economy/coins");
    for (const row of expiredBonusUsers) {
      try {
        await db.transaction(async (tx) => {
          await debitCoins(
            row.user_id,
            COMEBACK_COIN_AMOUNT,
            "comeback_bonus_expired",
            `comeback_reversal:${row.user_id}`,
            "Comeback bonus expired (7-day window passed)",
            {},
            tx
          );
        });
        expiredBonuses++;
      } catch (coinErr) {
        if ((coinErr as NodeJS.ErrnoException)?.code !== 'INSUFFICIENT_BALANCE') {
          console.error('[cron/daily-users] Comeback bonus expiry error:', row.user_id, coinErr);
        }
      }
    }
    results.comebackBonusExpiry = { expired: expiredBonuses };
  } catch (err) {
    errors.push(`comebackBonusExpiry: ${String(err)}`);
  }

  return NextResponse.json({
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  });
};
