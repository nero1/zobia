export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * app/api/cron/daily-economy/route.ts
 *
 * CRON slot 5 of 7 — runs at 03:00 UTC (04:00 WAT).
 *
 *  1. Creator Fund cycle (seed on day 1, distribute on day 5)
 *  2. Monthly plan coin bonus (1st of month only)
 *  3. Ad revenue share auto-enrolment (1st of month only)
 *  4. Weekly automated creator payouts (Fridays only)
 *  5. Referral 7-day streak qualifying bonuses
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateCronSecret, checkCronIdempotency } from "@/lib/cron/auth";

export const GET = async (req: NextRequest) => {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const didClaim = await checkCronIdempotency("cron_daily_economy_last_run", db);
  if (!didClaim) {
    return NextResponse.json({ skipped: true, reason: "Already ran today" });
  }

  const results: Record<string, unknown> = {};
  const errors: string[] = [];
  const nowDate = new Date();
  const utcDay = nowDate.getUTCDate();
  const dayOfWeek = nowDate.getUTCDay();

  // 1. Creator Fund — seed on day 1, distribute on day 5
  if (utcDay === 1) {
    try {
      const prevMonth = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - 1, 1));
      const prevMonthKey = `ad_revenue_${prevMonth.getUTCFullYear()}_${String(prevMonth.getUTCMonth() + 1).padStart(2, '0')}_kobo`;
      const { rows: revenueRows } = await db.query<{ value: string }>(
        `SELECT value FROM x_manifest WHERE key = $1 LIMIT 1`, [prevMonthKey]
      );
      const newPoolKobo = Math.floor(parseInt(revenueRows[0]?.value ?? "0", 10) * 0.05);
      await db.query(
        `INSERT INTO x_manifest (key, value) VALUES ('creator_fund_balance_kobo', $1::text)
         ON CONFLICT (key) DO UPDATE
           SET value = (COALESCE(x_manifest.value::NUMERIC, 0) + $1)::TEXT, updated_at = NOW()`,
        [String(newPoolKobo)]
      );
      results.creatorFundSeed = { seededKobo: newPoolKobo };
    } catch (err) {
      errors.push(`creatorFundSeed: ${String(err)}`);
    }
  }

  if (utcDay === 5) {
    try {
      const { distributeCreatorFund } = await import('@/lib/creator/fund');
      const { rows: fundRows } = await db.query<{ value: string }>(
        `SELECT value FROM x_manifest WHERE key = 'creator_fund_balance_kobo' LIMIT 1`
      );
      const poolKobo = parseInt(fundRows[0]?.value ?? "0", 10);
      if (poolKobo > 0) {
        const fundResult = await distributeCreatorFund(poolKobo);
        await db.query(
          `INSERT INTO x_manifest (key, value) VALUES ('creator_fund_balance_kobo', '0')
           ON CONFLICT (key) DO UPDATE SET value = '0', updated_at = NOW()`
        );
        results.creatorFundDistribution = { creatorsRewarded: fundResult, poolKobo };
      } else {
        results.creatorFundDistribution = { skipped: true, reason: 'Pool is empty' };
      }
    } catch (err) {
      errors.push(`creatorFundDistribution: ${String(err)}`);
    }
  }

  // 2. Monthly plan coin bonus (1st only)
  try {
    if (utcDay === 1) {
      const monthKey = nowDate.toISOString().slice(0, 7);
      const PLAN_MONTHLY_BONUS: Record<string, number> = { plus: 50, pro: 200, max: 500 };
      try {
        await db.transaction(async (tx) => {
          for (const [plan, bonus] of Object.entries(PLAN_MONTHLY_BONUS)) {
            await tx.query(
              `WITH eligible AS (
                 SELECT id, coin_balance FROM users
                 WHERE plan = $1 AND deleted_at IS NULL AND NOT COALESCE(is_banned, false)
                   AND NOT EXISTS (
                     SELECT 1 FROM coin_ledger
                     WHERE user_id = users.id AND transaction_type = 'subscription_bonus'
                       AND reference_id LIKE 'plan:' || users.id::text || ':' || $4
                   )
               ),
               ledger_rows AS (
                 INSERT INTO coin_ledger
                   (user_id, amount, balance_before, balance_after, transaction_type, reference_id, description, created_at)
                 SELECT id, $2, coin_balance, coin_balance + $2, 'subscription_bonus',
                        'plan:' || id::text || ':' || $4, $3, NOW()
                 FROM eligible
                 ON CONFLICT (transaction_type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
                 RETURNING user_id
               )
               UPDATE users SET coin_balance = coin_balance + $2, updated_at = NOW()
               WHERE id IN (SELECT user_id FROM ledger_rows)`,
              [plan, bonus, `Monthly ${plan} plan bonus`, monthKey]
            );
          }
        });
        results.monthlyPlanBonus = { ran: true, plansProcessed: Object.keys(PLAN_MONTHLY_BONUS).length };
      } catch (txErr: unknown) {
        if ((txErr as { code?: string })?.code === '23505') {
          results.monthlyPlanBonus = { ran: true, skipped: 'Already awarded this month' };
        } else {
          errors.push(`monthlyPlanBonus: ${String(txErr)}`);
        }
      }
    } else {
      results.monthlyPlanBonus = { ran: false, reason: "Not the 1st of the month" };
    }
  } catch (err) {
    errors.push(`monthlyPlanBonus: ${String(err)}`);
  }

  // 3. Ad revenue share auto-enrolment (1st only)
  try {
    if (utcDay === 1) {
      const lastMonthStart = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth() - 1, 1));
      const lastMonthEnd   = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1));
      const monthKey       = lastMonthStart.toISOString().slice(0, 10);

      const { rows: mauRows } = await db.query<{ room_id: string; mau_count: string }>(
        `SELECT rm.room_id, COUNT(DISTINCT rm.user_id)::TEXT AS mau_count
         FROM room_members rm
         JOIN rooms r ON r.id = rm.room_id
         WHERE r.type = 'free_open' AND r.is_active = TRUE
           AND rm.joined_at < $2 AND (rm.left_at IS NULL OR rm.left_at >= $1)
         GROUP BY rm.room_id`,
        [lastMonthStart.toISOString(), lastMonthEnd.toISOString()]
      ).catch(() => ({ rows: [] as Array<{ room_id: string; mau_count: string }> }));

      let snapshotted = 0, enrolled = 0;
      if (mauRows.length > 0) {
        // Batch upsert MAU snapshots
        await db.query(
          `INSERT INTO room_monthly_active_users (room_id, month, mau_count)
           SELECT unnest($1::uuid[]), $2::date, unnest($3::int[])
           ON CONFLICT (room_id, month) DO UPDATE SET mau_count = EXCLUDED.mau_count`,
          [mauRows.map(r => r.room_id), monthKey, mauRows.map(r => parseInt(r.mau_count, 10))]
        ).catch(() => {});
        snapshotted = mauRows.length;

        // Enrol rooms with 500+ MAU in ad revenue share
        const eligibleRoomIds = mauRows.filter(r => parseInt(r.mau_count, 10) >= 500).map(r => r.room_id);
        if (eligibleRoomIds.length > 0) {
          const { rows: enrolledRooms } = await db.query<{ id: string }>(
            `UPDATE rooms SET is_ad_enrolled = TRUE, updated_at = NOW()
             WHERE id = ANY($1::uuid[]) AND is_ad_enrolled = FALSE
             RETURNING id`,
            [eligibleRoomIds]
          ).catch(() => ({ rows: [] as Array<{ id: string }> }));
          enrolled = enrolledRooms.length;

          if (enrolledRooms.length > 0) {
            const mauMap = new Map(mauRows.map(r => [r.room_id, parseInt(r.mau_count, 10)]));
            await db.query(
              `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
               SELECT r.creator_id, 'ad_revenue_enrolled', 'Ad Revenue Enabled',
                      'Your room has been enrolled in ad revenue sharing based on monthly active users.',
                      jsonb_build_object('roomId', r.id::text, 'mauCount', sub.mau),
                      false, NOW()
               FROM rooms r
               JOIN (SELECT unnest($1::uuid[]) AS room_id, unnest($2::int[]) AS mau) sub ON sub.room_id = r.id`,
              [enrolledRooms.map(r => r.id), enrolledRooms.map(r => mauMap.get(r.id) ?? 0)]
            ).catch(() => {});
          }
        }
      }
      results.adRevenueEnrolment = { snapshotted, enrolled, month: monthKey };
    } else {
      results.adRevenueEnrolment = { ran: false, reason: 'Not the 1st of the month' };
    }
  } catch (err) {
    errors.push(`adRevenueEnrolment: ${String(err)}`);
  }

  // 4. Weekly automated payouts (Fridays only)
  try {
    if (dayOfWeek === 5) {
      const MIN_PAYOUT_KOBO = 100_000;
      const { rows: payoutCandidates } = await db.query<{
        creator_id: string; balance_kobo: number; recipient_code: string;
      }>(
        `SELECT u.id AS creator_id, u.available_earnings_kobo AS balance_kobo, u.payout_recipient_code AS recipient_code
         FROM users u
         WHERE u.is_creator = TRUE AND NOT COALESCE(u.is_banned, false) AND u.deleted_at IS NULL
           AND u.payout_recipient_code IS NOT NULL
           AND u.available_earnings_kobo >= $1
           AND NOT EXISTS (
             SELECT 1 FROM creator_payouts cp WHERE cp.creator_id = u.id AND cp.status IN ('awaiting_approval', 'processing')
           )`,
        [MIN_PAYOUT_KOBO]
      );

      let payoutsInitiated = 0;
      const { checkPayoutFraud } = await import('@/lib/fraud/payouts');
      for (const candidate of payoutCandidates) {
        try {
          const idempotencyKey = `weekly_${candidate.creator_id}_${nowDate.toISOString().slice(0, 10)}`;
          const fraudResult = await checkPayoutFraud(candidate.creator_id, candidate.balance_kobo, db);
          const status = fraudResult.forceManual ? 'awaiting_approval' : 'pending';
          await db.transaction(async (tx) => {
            const { rows: bankRows } = await tx.query<{ bank_name: string | null; account_number: string | null; account_name: string | null; recipient_code: string | null }>(
              `SELECT bank_name, account_number, account_name, recipient_code
               FROM creator_bank_accounts WHERE creator_id = $1 AND is_primary = TRUE AND deleted_at IS NULL LIMIT 1`,
              [candidate.creator_id]
            );
            const bankSnapshot = bankRows[0] ? { bank_name: bankRows[0].bank_name, account_number: bankRows[0].account_number, account_name: bankRows[0].account_name, recipient_code: bankRows[0].recipient_code } : null;
            const { rowCount: payoutInsertCount } = await tx.query(
              `INSERT INTO creator_payouts
                 (creator_id, amount_kobo, net_kobo, gross_kobo, platform_fee_kobo, provider, status, idempotency_key, bank_account_snapshot, created_at)
               VALUES ($1, $2, $2, $2, 0, 'paystack', $3, $4, $5, NOW())
               ON CONFLICT (idempotency_key) DO NOTHING`,
              [candidate.creator_id, candidate.balance_kobo, status, idempotencyKey, bankSnapshot ? JSON.stringify(bankSnapshot) : null]
            );
            if ((payoutInsertCount ?? 0) > 0) {
              await tx.query(
                `UPDATE users SET available_earnings_kobo = available_earnings_kobo - $1, updated_at = NOW() WHERE id = $2`,
                [candidate.balance_kobo, candidate.creator_id]
              );
            }
          });
          payoutsInitiated++;
        } catch { /* Non-fatal per-creator */ }
      }
      results.weeklyAutomatedPayouts = { initiated: payoutsInitiated };
    }
  } catch (err) {
    errors.push(`weeklyAutomatedPayouts: ${String(err)}`);
  }

  // 5. Referral 7-day streak qualifying
  try {
    const { getManifestValue } = await import("@/lib/manifest");
    const { creditCoins } = await import("@/lib/economy/coins");

    const qualifyingAction = (await getManifestValue("referral_qualifying_action")) ?? "coin_purchase";
    if (qualifyingAction === "login_streak_7" || qualifyingAction === "both") {
      const xpBonus = parseInt((await getManifestValue("referral_tier1_xp_bonus")) ?? "500", 10) || 500;
      const coinBonus = parseInt((await getManifestValue("referral_tier1_coin_bonus")) ?? "100", 10) || 100;
      const { safeAwardXP: _safeXP } = await import("@/lib/xp/safeAwardXP");
      const cronDate = nowDate.toISOString().slice(0, 10);
      let streakQualified = 0;

      await db.transaction(async (tx) => {
        const { rows: streakReferrals } = await tx.query<{ id: string; referrer_id: string; referred_id: string }>(
          `SELECT r.id, r.referrer_id, r.referred_id
           FROM referrals r JOIN users u ON u.id = r.referred_id
           WHERE r.qualified = false AND r.tier = 1 AND u.login_streak_days >= 7 AND u.deleted_at IS NULL
           FOR UPDATE OF r SKIP LOCKED`
        );

        for (const referral of streakReferrals) {
          try {
            await tx.query(
              `UPDATE referrals SET qualified = true, qualified_at = NOW(), coin_reward = $1, xp_reward = $2 WHERE id = $3`,
              [coinBonus, xpBonus, referral.id]
            );
            await _safeXP(referral.referrer_id, xpBonus, "social", "referral_qualified_streak", `referral_streak_${referral.id}_${cronDate}`, tx);
            if (coinBonus > 0) {
              await creditCoins(referral.referrer_id, coinBonus, "referral_bonus", referral.id, "One-time referral bonus (7-day streak)", {}, tx);
            }
            streakQualified++;
          } catch (err) {
            console.error("[cron/daily-economy] Referral streak error:", err);
          }
        }
      });
      results.referralStreakQualifying = { qualified: streakQualified };
    }
  } catch (err) {
    errors.push(`referralStreakQualifying: ${String(err)}`);
  }

  return NextResponse.json({
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  });
};
