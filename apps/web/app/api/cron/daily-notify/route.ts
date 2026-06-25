export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * app/api/cron/daily-notify/route.ts
 *
 * CRON slot 3 of 7 — runs at 01:00 UTC (02:00 WAT).
 * Depends on daily-users having run first (inactivity events must exist).
 *
 *  1. Re-engagement push/email dispatch (batch personalisation context)
 *  2. Telegram re-engagement — concurrent delivery (was sequential HTTP)
 *  3. Council invitations — single INSERT...SELECT + batch push
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateCronSecret, checkCronIdempotency } from "@/lib/cron/auth";
import { logger } from "@/lib/logger";

const CONCURRENCY = 5;

async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item !== undefined) await fn(item).catch(() => {});
    }
  });
  await Promise.all(workers);
}

export const GET = async (req: NextRequest) => {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const didClaim = await checkCronIdempotency("cron_daily_notify_last_run", db);
  if (!didClaim) {
    return NextResponse.json({ skipped: true, reason: "Already ran today" });
  }

  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  // 1. Re-engagement notification dispatch
  try {
    const { rows: inactiveUsers } = await db.query<{
      user_id: string;
      days_inactive: number;
      email: string | null;
      last_streak_before_break: number;
    }>(
      `SELECT DISTINCT ON (uie.user_id)
         uie.user_id, uie.inactive_days AS days_inactive,
         u.email,
         COALESCE(u.last_streak_before_break, 0) AS last_streak_before_break
       FROM user_inactivity_events uie
       JOIN users u ON u.id = uie.user_id
       WHERE uie.push_email_notified = false
         AND uie.created_at >= NOW() - INTERVAL '25 hours'
       ORDER BY uie.user_id, uie.inactive_days DESC`
    );

    const { getReengagementPayload } = await import('@/lib/notifications/reengagement');
    const { sendPushNotification } = await import('@/lib/notifications/push');
    const { sendEmail } = await import('@/lib/notifications/email');
    const { creditCoins } = await import("@/lib/economy/coins");

    // Parallel context enrichment
    const personalContextMap = new Map<string, { guildEvent?: string; seasonPhase?: string; nemesisContext?: string }>();
    await Promise.allSettled(inactiveUsers.map(async (user) => {
      const ctx: { guildEvent?: string; seasonPhase?: string; nemesisContext?: string } = {};
      try {
        if (user.days_inactive >= 7 && user.days_inactive < 14) {
          const [gwRows, nemesisRows] = await Promise.all([
            db.query<{ is_win: boolean; guild_name: string }>(
              `SELECT gw.winner_guild_id = gm.guild_id AS is_win, g.name AS guild_name
               FROM guild_wars gw
               JOIN guild_members gm ON gm.guild_id IN (gw.challenger_guild_id, gw.defender_guild_id)
                 AND gm.user_id = $1
               JOIN guilds g ON g.id = gm.guild_id
               WHERE gw.status = 'completed' AND gw.ends_at >= NOW() - INTERVAL '30 days'
               ORDER BY gw.ends_at DESC LIMIT 1`,
              [user.user_id]
            ),
            db.query<{ xp_delta: number }>(
              `SELECT (nu.xp_total - u.xp_total) AS xp_delta
               FROM nemesis_assignments na
               JOIN users u  ON u.id  = na.user_id
               JOIN users nu ON nu.id = na.nemesis_user_id
               WHERE na.user_id = $1 LIMIT 1`,
              [user.user_id]
            ),
          ]);
          if (gwRows.rows[0]) {
            const { is_win, guild_name } = gwRows.rows[0];
            ctx.guildEvent = is_win
              ? `Your guild "${guild_name}" won a war while you were away!`
              : `Your guild "${guild_name}" fought hard in your absence.`;
          }
          if (nemesisRows.rows[0]?.xp_delta > 0) {
            ctx.nemesisContext = `Your nemesis gained ${nemesisRows.rows[0].xp_delta.toLocaleString()} XP while you were away.`;
          }
        } else if (user.days_inactive >= 14) {
          const { rows: seasonRows } = await db.query<{ name: string; starts_at: string; ends_at: string }>(
            `SELECT name, starts_at, ends_at FROM seasons WHERE is_active = TRUE LIMIT 1`
          );
          if (seasonRows[0]) {
            const { name: seasonName, starts_at, ends_at } = seasonRows[0];
            const ratio = (Date.now() - new Date(starts_at).getTime()) / (new Date(ends_at).getTime() - new Date(starts_at).getTime());
            const phase = ratio >= 0.95 ? 'final day' : ratio >= 0.75 ? 'push' : ratio >= 0.25 ? 'mid' : 'opening';
            ctx.seasonPhase = `Season "${seasonName}" is in the ${phase} phase — jump back in!`;
          }
        }
      } catch { /* non-fatal */ }
      personalContextMap.set(user.user_id, ctx);
    }));

    // PERF-07: Await comeback coin transactions with bounded concurrency instead
    // of fire-and-forget, to prevent unbounded parallel DB connections.
    const comebackMonthKey = new Date().toISOString().slice(0, 7);
    await withConcurrency(
      inactiveUsers.filter(u => u.days_inactive === 90),
      5,
      async (user) => {
        await db.transaction(async (tx) => {
          await creditCoins(user.user_id, 200, "comeback_bonus_reserved", `comeback:${user.user_id}:${comebackMonthKey}`, "Comeback bonus — expires in 7 days if unused", {}, tx);
        });
      }
    );

    let dispatched = 0;
    const notifiedIds: string[] = [];
    const notifiedDays: number[] = [];

    for (const user of inactiveUsers) {
      const payload = getReengagementPayload(
        user.user_id, user.days_inactive, user.last_streak_before_break,
        personalContextMap.get(user.user_id)
      );
      if (!payload) continue;
      sendPushNotification(user.user_id, payload.title, payload.body, { action: payload.action }).catch(() => {});
      if (user.email) {
        sendEmail(user.email, payload.title, payload.body, `<p>${payload.body}</p>`, 'reengagement', user.user_id).catch(() => {});
      }
      notifiedIds.push(user.user_id);
      notifiedDays.push(user.days_inactive);
      dispatched++;
    }

    // Batch-mark notified
    if (notifiedIds.length > 0) {
      await db.query(
        `UPDATE user_inactivity_events
         SET push_email_notified = true
         FROM (SELECT unnest($1::uuid[]) AS uid, unnest($2::int[]) AS days) upd
         WHERE user_id = upd.uid AND inactive_days = upd.days AND push_email_notified = false`,
        [notifiedIds, notifiedDays]
      ).catch((err) => {
        logger.error({ err }, '[daily-notify] Failed to mark notifications as sent');
      });
    }

    results.reengagementDispatched = { dispatched };
  } catch (err) {
    errors.push(`reengagementDispatch: ${String(err)}`);
  }

  // 2. Telegram re-engagement — concurrent delivery
  try {
    const { rows: telegramUsers } = await db.query<{
      user_id: string;
      telegram_id: string;
      days_inactive: number;
      last_streak_before_break: number;
    }>(
      `SELECT DISTINCT ON (uie.user_id)
         uie.user_id, u.telegram_id,
         uie.inactive_days AS days_inactive,
         COALESCE(u.last_streak_before_break, 0) AS last_streak_before_break
       FROM user_inactivity_events uie
       JOIN users u ON u.id = uie.user_id
       WHERE uie.telegram_notified = false
         AND uie.created_at >= NOW() - INTERVAL '25 hours'
         AND u.telegram_id IS NOT NULL
         AND u.deleted_at IS NULL
       ORDER BY uie.user_id, uie.inactive_days DESC`
    );

    const { getReengagementPayload } = await import('@/lib/notifications/reengagement');
    const { sendTelegramMessage } = await import('@/lib/notifications/telegram');

    const successIds: string[] = [];
    await withConcurrency(telegramUsers, CONCURRENCY, async (user) => {
      const payload = getReengagementPayload(user.user_id, user.days_inactive, user.last_streak_before_break);
      if (!payload) return;
      await sendTelegramMessage(user.telegram_id, `<b>${payload.title}</b>\n\n${payload.body}`);
      successIds.push(user.user_id);
    });

    if (successIds.length > 0) {
      await db.query(
        `UPDATE user_inactivity_events SET telegram_notified = true
         WHERE user_id = ANY($1::uuid[]) AND telegram_notified = false`,
        [successIds]
      ).catch(() => {});
    }
    results.telegramReengagement = { sent: successIds.length };
  } catch (err) {
    errors.push(`telegramReengagement: ${String(err)}`);
  }

  // 3. Council invitations (last 7 days of month) — single INSERT...SELECT + batch push
  try {
    const now = new Date();
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (now.getUTCDate() >= lastDayOfMonth - 6) {
      const councilRefId = `council_invite:${now.toISOString().slice(0, 7)}`;
      const { sendPushNotification } = await import('@/lib/notifications/push');

      const { rows: invited } = await db.query<{ user_id: string; legacy_score: number }>(
        `WITH candidates AS (
           INSERT INTO notifications (user_id, type, title, body, metadata, reference_id, created_at)
           SELECT u.id, 'council_invitation',
                  'Platform Council Invitation',
                  'You are among the top contributors on Zobia. You have been invited to join the Platform Council.',
                  jsonb_build_object('legacyScore', u.legacy_score),
                  $1, NOW()
           FROM users u
           LEFT JOIN platform_council_members pcm ON pcm.user_id = u.id
           WHERE pcm.user_id IS NULL
             AND u.deleted_at IS NULL
             AND NOT COALESCE(u.is_banned, false)
             AND u.login_streak_days > 0
             AND u.prestige_count >= 5
           ORDER BY u.legacy_score DESC
           LIMIT 50
           ON CONFLICT (user_id, type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
           RETURNING user_id
         )
         SELECT c.user_id, u.legacy_score
         FROM candidates c
         JOIN users u ON u.id = c.user_id`,
        [councilRefId]
      );

      // Batch push fire-and-forget
      await withConcurrency(invited, CONCURRENCY, async (row) => {
        await sendPushNotification(
          row.user_id,
          '🏛️ Platform Council Invitation',
          'You are among the top contributors on Zobia. You have been invited to join the Platform Council.',
          { action: 'open_council' }
        );
      });

      results.councilInvitations = { invited: invited.length };
    } else {
      results.councilInvitations = { skipped: true, reason: 'Not last week of month' };
    }
  } catch (err) {
    errors.push(`councilInvitations: ${String(err)}`);
  }

  return NextResponse.json({
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: new Date().toISOString(),
  });
};
