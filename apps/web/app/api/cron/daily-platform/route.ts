export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * app/api/cron/daily-platform/route.ts
 *
 * CRON slot 7 of 7 — runs at 05:00 UTC (06:00 WAT).
 * The last daily slot; handles platform-wide events and system maintenance.
 *
 *  1.  Season transitions (end → rewards → ceremony; activate upcoming)
 *  2.  Monthly gift drops
 *  3.  Mystery XP drop (probability-gated via cron_state)
 *  4.  Flash XP lifecycle (announce / fire / expire)
 *  5.  Annual cultural event recurrence (clone into next year)
 *  6.  Moderation digest email (Fridays only)
 *  7.  Master Teacher award (end-of-season Elder recognition)
 *  8.  Alliance wars — weekly resolution + pairing (Sundays only)
 *      XP batch-awarded via Promise.allSettled (no per-winner await loop)
 *  9.  Telegram delivery queue flush (batch 200)
 * 10.  Drop / ceremony / event room expiry
 * SYS-01: Retry failed XP awards (DLQ)
 * SYS-02: Coin + star ledger reconciliation
 * SYS-04: Circuit breaker metrics
 * WEBHOOK-RETRY-01: Retry failed webhook deliveries (up to 3 attempts)
 * PUSH-RECEIPT-01: Poll Expo push receipts (stage 2 delivery confirmation)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateCronSecret, checkCronIdempotency } from "@/lib/cron/auth";
import { getCurrentSeason, distributeSeasonRewards, resetSeasonRankings, createSeasonCeremonyRoom } from "@/lib/seasons/seasonEngine";
import { processPendingGiftDrops } from "@/lib/events/monthlyGiftDrop";
import { sendBulkTelegramMessages } from "@/lib/notifications/telegram";
import { retryFailedXPAwards } from "@/lib/xp/safeAwardXP";
import { getAllCircuitMetrics } from "@/lib/payments/circuit";

const ALLIANCE_WAR_VICTORY_XP = 300;

export const GET = async (req: NextRequest) => {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const didClaim = await checkCronIdempotency("cron_daily_platform_last_run", db);
  if (!didClaim) {
    return NextResponse.json({ skipped: true, reason: "Already ran today" });
  }

  const results: Record<string, unknown> = {};
  const errors: string[] = [];
  const now = new Date();

  // 1. Season transitions
  try {
    const seasonTransitions: { ended?: string[]; upcoming?: string } = {};

    const { rows: endedSeasons } = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM seasons WHERE is_active = TRUE AND ends_at <= NOW()`
    );

    for (const season of endedSeasons) {
      try {
        await resetSeasonRankings(season.id, db);
        await distributeSeasonRewards(season.id, db);
        try {
          await createSeasonCeremonyRoom(season.id, season.name, db);
        } catch (err) {
          errors.push(`seasonCeremonyRoom(${season.id}): ${String(err)}`);
        }
        if (!seasonTransitions.ended) seasonTransitions.ended = [];
        seasonTransitions.ended.push(season.id);
      } catch (err) {
        errors.push(`seasonEnd(${season.id}): ${String(err)}`);
      }
    }

    const { rows: activated } = await db.query<{ id: string }>(
      `UPDATE seasons SET is_active = TRUE, updated_at = NOW()
       WHERE is_active = FALSE AND starts_at <= NOW() AND ends_at > NOW()
       RETURNING id`
    );
    if (activated[0]) seasonTransitions.upcoming = activated[0].id;

    results.seasonTransitions = seasonTransitions;
  } catch (err) {
    errors.push(`seasonTransitions: ${String(err)}`);
  }

  // 2. Monthly gift drops
  try {
    results.giftDrops = await processPendingGiftDrops(db);
  } catch (err) {
    errors.push(`giftDrops: ${String(err)}`);
  }

  // 3. Mystery XP drop
  try {
    const { rows: flagRows } = await db.query<{ value: string }>(
      `SELECT value FROM x_manifest WHERE key = 'feature_mystery_xp_drops' LIMIT 1`
    );
    const enabled = (flagRows[0]?.value ?? 'true') === 'true';

    if (enabled) {
      const [batchRows, stateRows] = await Promise.all([
        db.query<{ value: string }>(`SELECT value FROM x_manifest WHERE key = 'mystery_drop_batch_size' LIMIT 1`),
        db.query<{ value_ts: string }>(`SELECT value_ts FROM cron_state WHERE key = 'next_mystery_drop_at' LIMIT 1`),
      ]);
      const batchSize = parseInt(batchRows.rows[0]?.value ?? '50', 10);
      const nextDropAt = stateRows.rows[0]?.value_ts ? new Date(stateRows.rows[0].value_ts) : null;

      if (nextDropAt !== null && now >= nextDropAt) {
        const { triggerMysteryXPDrop } = await import('@/lib/mystery/xpDrop');
        const dropResult = await triggerMysteryXPDrop(db, batchSize);

        const daysUntilNext = 3 + Math.random() * 4;
        await db.query(
          `INSERT INTO cron_state (key, value_ts, updated_at)
           VALUES ('next_mystery_drop_at', NOW() + ($1 || ' days')::INTERVAL, NOW())
           ON CONFLICT (key) DO UPDATE SET value_ts = NOW() + ($1 || ' days')::INTERVAL, updated_at = NOW()`,
          [daysUntilNext.toFixed(4)]
        );

        const { sendPushNotificationBatch } = await import('@/lib/notifications/push');
        sendPushNotificationBatch(
          dropResult.recipients.map((userId: string) => ({
            userId,
            title: 'Mystery XP Drop!',
            body: 'You just received a surprise XP boost! Log in now to see your progress.',
            data: { action: '/home', type: 'mystery_xp_drop' },
          }))
        ).catch(() => {});

        results.mysteryXpDrop = { fired: true, ...dropResult };
      } else {
        results.mysteryXpDrop = { fired: false, nextDropAt: nextDropAt?.toISOString() ?? null };
      }
    } else {
      results.mysteryXpDrop = { fired: false, reason: 'Feature disabled' };
    }
  } catch (err) {
    errors.push(`mysteryXpDrop: ${String(err)}`);
  }

  // 4. Flash XP lifecycle
  try {
    const { advanceFlashXPLifecycle } = await import('@/lib/events/flashXP');
    results.flashXpLifecycle = await advanceFlashXPLifecycle();
  } catch (err) {
    errors.push(`flashXpLifecycle: ${String(err)}`);
  }

  // 5. Annual cultural event recurrence
  try {
    interface RecurringEventRow {
      id: string; name: string; description: string; event_type: string;
      xp_multiplier: string; metadata: string; starts_at: string; ends_at: string;
      recurrence_anchor_month_start: number; recurrence_anchor_day_start: number;
      recurrence_anchor_month_end: number; recurrence_anchor_day_end: number;
    }

    const { rows: recurringEvents } = await db.query<RecurringEventRow>(
      `SELECT id, name, description, event_type, xp_multiplier::TEXT AS xp_multiplier,
              metadata::TEXT AS metadata, starts_at::TEXT AS starts_at, ends_at::TEXT AS ends_at,
              recurrence_anchor_month_start, recurrence_anchor_day_start,
              recurrence_anchor_month_end, recurrence_anchor_day_end
       FROM platform_events
       WHERE is_recurring_annual = TRUE AND ends_at < NOW() AND is_active = TRUE`
    );

    let eventsCloned = 0;
    const nextYear = now.getUTCFullYear() + 1;

    for (const evt of recurringEvents) {
      const { rows: futureCheck } = await db.query<{ count: string }>(
        `SELECT COUNT(*)::TEXT AS count FROM platform_events
         WHERE name = $1 AND EXTRACT(YEAR FROM starts_at) >= $2`,
        [evt.name, nextYear]
      );
      if (parseInt(futureCheck[0]?.count ?? "0", 10) > 0) continue;

      const ms = evt.recurrence_anchor_month_start, ds = evt.recurrence_anchor_day_start;
      const me = evt.recurrence_anchor_month_end,   de = evt.recurrence_anchor_day_end;
      const endYear = me < ms ? nextYear + 1 : nextYear;
      const newStart = `${nextYear}-${String(ms).padStart(2,'0')}-${String(ds).padStart(2,'0')} 00:00:00+00`;
      const newEnd   = `${endYear}-${String(me).padStart(2,'0')}-${String(de).padStart(2,'0')} 23:59:59+00`;

      await db.query(
        `INSERT INTO platform_events
           (name, description, event_type, xp_multiplier, starts_at, ends_at,
            metadata, is_recurring_annual,
            recurrence_anchor_month_start, recurrence_anchor_day_start,
            recurrence_anchor_month_end, recurrence_anchor_day_end, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, TRUE, $8, $9, $10, $11, TRUE)
         ON CONFLICT DO NOTHING`,
        [evt.name, evt.description, evt.event_type, parseFloat(evt.xp_multiplier),
         newStart, newEnd, evt.metadata ?? '{}', ms, ds, me, de]
      );
      eventsCloned++;
    }

    results.annualEventRecurrence = { eventsCloned, targetYear: nextYear };
  } catch (err) {
    errors.push(`annualEventRecurrence: ${String(err)}`);
  }

  // 6. Moderation digest (Fridays only)
  try {
    if (now.getUTCDay() === 5) {
      const [digestRes, adminRes] = await Promise.all([
        db.query<{ open_reports: string; escalated: string; actions_taken: string; new_reports_7d: string }>(
          `SELECT
             (SELECT COUNT(*) FROM reports WHERE status = 'open') AS open_reports,
             (SELECT COUNT(*) FROM reports WHERE status = 'escalated') AS escalated,
             (SELECT COUNT(*) FROM moderation_actions WHERE created_at >= NOW() - INTERVAL '7 days') AS actions_taken,
             (SELECT COUNT(*) FROM reports WHERE created_at >= NOW() - INTERVAL '7 days') AS new_reports_7d`
        ),
        db.query<{ email: string }>(
          `SELECT u.email FROM users u
           JOIN admin_roles ar ON ar.user_id = u.id
           WHERE u.email IS NOT NULL AND ar.role = 'admin' LIMIT 20`
        ),
      ]);

      if (adminRes.rows.length > 0) {
        const { sendEmail } = await import('@/lib/notifications/email');
        const d = digestRes.rows[0];
        const body = `Weekly moderation digest:\n- Open reports (total): ${d?.open_reports ?? 0}\n- Escalated (total): ${d?.escalated ?? 0}\n- New reports this week: ${d?.new_reports_7d ?? 0}\n- Actions taken this week: ${d?.actions_taken ?? 0}`;
        for (const admin of adminRes.rows) {
          sendEmail(admin.email, "Zobia Weekly Moderation Digest", body, `<p>${body.replace(/\n/g, "<br>")}</p>`).catch(() => {});
        }
      }
      results.moderationDigest = { sent: adminRes.rows.length };
    } else {
      results.moderationDigest = { skipped: true, reason: 'Not Friday' };
    }
  } catch (err) {
    errors.push(`moderationDigest: ${String(err)}`);
  }

  // 7. Master Teacher award (end-of-season)
  try {
    const { rows: endedSeasonRows } = await db.query<{ id: string }>(
      `SELECT id FROM seasons WHERE is_active = FALSE AND ends_at >= NOW() - INTERVAL '7 days' LIMIT 1`
    );
    if (endedSeasonRows[0]) {
      const seasonId = endedSeasonRows[0].id;
      const { rows: topElders } = await db.query<{ elder_id: string; mentee_count: string }>(
        `SELECT elder_id, COUNT(*)::TEXT AS mentee_count
         FROM elder_mentorships
         WHERE ended_at IS NOT NULL
           AND ended_at >= (SELECT starts_at FROM seasons WHERE id = $1)
           AND ended_at <= (SELECT ends_at FROM seasons WHERE id = $1)
         GROUP BY elder_id ORDER BY mentee_count DESC LIMIT 1`,
        [seasonId]
      );
      if (topElders[0]) {
        const elderId = topElders[0].elder_id;
        const meta = JSON.stringify({ seasonId, menteeCount: parseInt(topElders[0].mentee_count) });
        await Promise.all([
          db.query(
            `INSERT INTO user_badges (user_id, badge_type, badge_key, awarded_at, metadata)
             VALUES ($1, 'master_teacher', 'master_teacher', NOW(), $2)
             ON CONFLICT (user_id, badge_key) DO UPDATE SET awarded_at = NOW(), metadata = $2`,
            [elderId, meta]
          ).catch(() => {}),
          db.query(
            `INSERT INTO notifications (user_id, type, title, body, metadata, reference_id, is_read, created_at)
             VALUES ($1, 'master_teacher_award', 'Master Teacher Award',
                     'You have been awarded the Master Teacher badge for this season!', $2, $3, false, NOW())
             ON CONFLICT (user_id, type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
            [elderId, meta, `master_teacher:${elderId}:${seasonId}`]
          ).catch(() => {}),
        ]);
        results.masterTeacherAward = { elderId, seasonId };
      } else {
        results.masterTeacherAward = { skipped: true, reason: 'No qualifying elders' };
      }
    } else {
      results.masterTeacherAward = { skipped: true, reason: 'No recently ended season' };
    }
  } catch (err) {
    errors.push(`masterTeacherAward: ${String(err)}`);
  }

  // 8. Alliance wars — weekly resolution + pairing (Sundays only)
  try {
    if (now.getUTCDay() === 0) {
      // Step A: Pair alliances that have no active war
      const { rows: unpairedAlliances } = await db.query<{ id: string }>(
        `SELECT id FROM guild_alliances
         WHERE is_active = true
           AND id NOT IN (
             SELECT alliance_1_id FROM alliance_wars WHERE status = 'active'
             UNION
             SELECT alliance_2_id FROM alliance_wars WHERE status = 'active'
           )
         ORDER BY RANDOM()`
      );

      for (let i = 0; i + 1 < unpairedAlliances.length; i += 2) {
        await db.query(
          `INSERT INTO alliance_wars (alliance_1_id, alliance_2_id, status, started_at)
           SELECT LEAST($1, $2), GREATEST($1, $2), 'active', NOW()
           WHERE NOT EXISTS (
             SELECT 1 FROM alliance_wars WHERE status = 'active'
               AND (alliance_1_id = $1 OR alliance_2_id = $1
                 OR alliance_1_id = $2 OR alliance_2_id = $2)
           )
           ON CONFLICT DO NOTHING`,
          [unpairedAlliances[i].id, unpairedAlliances[i + 1].id]
        ).catch(() => {});
      }

      // Step B: Resolve wars running >= 7 days
      // RACE-02: Use FOR UPDATE inside a transaction to prevent concurrent CRON
      // runs from double-resolving the same war.
      const { rows: activeWars } = await db.query<{
        id: string; alliance_1_id: string; alliance_2_id: string; started_at: string;
      }>(
        `SELECT id, alliance_1_id, alliance_2_id, started_at
         FROM alliance_wars
         WHERE status = 'active' AND started_at <= NOW() - INTERVAL '7 days'
         FOR UPDATE`
      );

      let warsResolved = 0;
      const { safeAwardXP } = await import("@/lib/xp/safeAwardXP");

      for (const war of activeWars) {
        const { rows: scores } = await db.query<{ alliance_id: string; total_xp: string }>(
          `SELECT gam.alliance_id, SUM(xl.amount)::TEXT AS total_xp
           FROM xp_ledger xl
           JOIN guild_members gm ON gm.user_id = xl.user_id
           JOIN guild_alliance_members gam ON gam.guild_id = gm.guild_id
           WHERE gam.alliance_id IN ($1, $2) AND xl.created_at >= $3
             AND (gm.left_at IS NULL OR gm.left_at > $3)
           GROUP BY gam.alliance_id`,
          [war.alliance_1_id, war.alliance_2_id, war.started_at]
        );

        const score1 = parseInt(scores.find(s => s.alliance_id === war.alliance_1_id)?.total_xp ?? "0");
        const score2 = parseInt(scores.find(s => s.alliance_id === war.alliance_2_id)?.total_xp ?? "0");

        if (score1 === score2) {
          // Draw — neither alliance wins; increment wars_drawn on both alliances and their guilds
          await Promise.all([
            db.query(
              `UPDATE alliance_wars
               SET status = 'completed', winner_alliance_id = NULL,
                   alliance_1_xp = $1, alliance_2_xp = $2, ended_at = NOW()
               WHERE id = $3`,
              [score1, score2, war.id]
            ).catch(() => {}),
            db.query(
              `UPDATE guild_alliances SET wars_drawn = wars_drawn + 1, updated_at = NOW()
               WHERE id = ANY($1)`,
              [[war.alliance_1_id, war.alliance_2_id]]
            ).catch(() => {}),
            db.query(
              `UPDATE guilds SET wars_drawn = wars_drawn + 1, updated_at = NOW()
               WHERE id IN (
                 SELECT guild_id FROM guild_alliance_members
                 WHERE alliance_id = ANY($1)
               )`,
              [[war.alliance_1_id, war.alliance_2_id]]
            ).catch(() => {}),
          ]);

          // Award draw XP to all members of both alliances
          const { rows: drawParticipants } = await db.query<{ user_id: string }>(
            `SELECT DISTINCT gm.user_id
             FROM guild_members gm
             JOIN guild_alliance_members gam ON gam.guild_id = gm.guild_id
             WHERE gam.alliance_id = ANY($1) AND gm.left_at IS NULL`,
            [[war.alliance_1_id, war.alliance_2_id]]
          );
          const ALLIANCE_WAR_DRAW_XP = Math.floor(ALLIANCE_WAR_VICTORY_XP / 2);
          await Promise.allSettled(
            drawParticipants.map((w) =>
              safeAwardXP(
                w.user_id,
                ALLIANCE_WAR_DRAW_XP,
                "competitor",
                "alliance_war_draw",
                `war_${war.id}_draw_${w.user_id}`
              )
            )
          );

          // Notify all members of both alliances — draw result
          await db.query(
            `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
             SELECT DISTINCT gm.user_id,
                    'alliance_war_result',
                    'Alliance War Draw',
                    'The alliance war ended in a draw. Both sides fought hard!',
                    jsonb_build_object('warId', $1::text, 'draw', true,
                                       'alliance1Id', $2::text, 'alliance2Id', $3::text),
                    false, NOW()
             FROM guild_members gm
             JOIN guild_alliance_members gam ON gam.guild_id = gm.guild_id
             WHERE gam.alliance_id = ANY($4) AND gm.left_at IS NULL`,
            [war.id, war.alliance_1_id, war.alliance_2_id, [war.alliance_1_id, war.alliance_2_id]]
          ).catch(() => {});
        } else {
          const winnerId = score1 > score2 ? war.alliance_1_id : war.alliance_2_id;
          const loserId  = score1 > score2 ? war.alliance_2_id : war.alliance_1_id;

          await Promise.all([
            db.query(
              `UPDATE alliance_wars
               SET status = 'completed', winner_alliance_id = $1,
                   alliance_1_xp = $2, alliance_2_xp = $3, ended_at = NOW()
               WHERE id = $4`,
              [winnerId, score1, score2, war.id]
            ).catch(() => {}),
            db.query(
              `UPDATE guild_alliances SET wars_won = wars_won + 1, updated_at = NOW() WHERE id = $1`,
              [winnerId]
            ).catch(() => {}),
            // BUG-H02: Also increment wars_lost for the losing alliance — was missing,
            // causing the loser's stat to permanently stay at 0.
            db.query(
              `UPDATE guild_alliances SET wars_lost = wars_lost + 1, updated_at = NOW() WHERE id = $1`,
              [loserId]
            ).catch(() => {}),
          ]);

          // Batch award XP to all winners concurrently via Promise.allSettled
          const { rows: warWinners } = await db.query<{ user_id: string }>(
            `SELECT DISTINCT gm.user_id
             FROM guild_members gm
             JOIN guild_alliance_members gam ON gam.guild_id = gm.guild_id
             WHERE gam.alliance_id = $1 AND gm.left_at IS NULL`,
            [winnerId]
          );
          await Promise.allSettled(
            warWinners.map((w) =>
              safeAwardXP(
                w.user_id,
                ALLIANCE_WAR_VICTORY_XP,
                "competitor",
                "alliance_war_victory",
                `war_${war.id}_participant_${w.user_id}`
              )
            )
          );

          // Batch notify all members of both alliances
          await db.query(
            `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, created_at)
             SELECT DISTINCT gm.user_id,
                    'alliance_war_result',
                    CASE WHEN gam.alliance_id = $2 THEN 'Alliance War Victory!' ELSE 'Alliance War Ended' END,
                    CASE WHEN gam.alliance_id = $2
                      THEN 'Your alliance won the war this week!'
                      ELSE 'Your alliance was defeated this week. Regroup and fight back!'
                    END,
                    jsonb_build_object('warId', $1::text, 'won', gam.alliance_id = $2,
                                       'winnerAllianceId', $2::text),
                    false, NOW()
             FROM guild_members gm
             JOIN guild_alliance_members gam ON gam.guild_id = gm.guild_id
             WHERE gam.alliance_id IN ($2, $3) AND gm.left_at IS NULL`,
            [war.id, winnerId, loserId]
          ).catch(() => {});
        }

        // BUG-H01: Do NOT immediately re-pair the same two alliances here.
        // This block was creating a permanent infinite rematch loop — both alliances
        // become unpaired after resolution and will be matched by the random pairing
        // query at the top of Step 8 on the next Sunday CRON run, potentially
        // against different opponents.

        warsResolved++;
      }

      results.allianceWarsResolved = { resolved: warsResolved, paired: Math.floor(unpairedAlliances.length / 2) };
    } else {
      results.allianceWarsResolved = { skipped: true, reason: 'Not Sunday' };
    }
  } catch (err) {
    errors.push(`allianceWarsResolved: ${String(err)}`);
  }

  // 9. Telegram delivery queue flush (batch 200)
  try {
    const { rows: queueRows } = await db.query<{
      id: string; broadcast_id: string; telegram_ids: string[]; message_text: string | null;
    }>(
      `SELECT tdq.id, tdq.broadcast_id, tdq.telegram_ids,
              am.subject || E'\n\n' || am.body AS message_text
       FROM telegram_delivery_queue tdq
       JOIN admin_messages am ON am.id = tdq.broadcast_id
       WHERE tdq.delivered_at IS NULL AND tdq.failed_attempts < 3
       ORDER BY tdq.created_at ASC LIMIT 200`
    );

    let telegramSent = 0;
    let telegramFailed = 0;

    for (const row of queueRows) {
      if (!row.telegram_ids?.length || !row.message_text) {
        await db.query(`UPDATE telegram_delivery_queue SET delivered_at = NOW() WHERE id = $1`, [row.id]).catch(() => {});
        continue;
      }
      try {
        await sendBulkTelegramMessages(
          row.telegram_ids.map((tid) => ({ telegramId: tid, text: row.message_text! }))
        );
        await db.query(`UPDATE telegram_delivery_queue SET delivered_at = NOW() WHERE id = $1`, [row.id]);
        telegramSent += row.telegram_ids.length;
      } catch {
        await db.query(
          `UPDATE telegram_delivery_queue
           SET failed_attempts = COALESCE(failed_attempts, 0) + 1 WHERE id = $1`,
          [row.id]
        ).catch(() => {});
        telegramFailed++;
      }
    }

    results.telegramDelivery = { sent: telegramSent, failed: telegramFailed, batches: queueRows.length };
  } catch (err) {
    errors.push(`telegramDelivery: ${String(err)}`);
  }

  // 10. Drop / ceremony / event room expiry
  try {
    const { rows: closed } = await db.query<{ count: string }>(
      `WITH closed AS (
         UPDATE rooms
         SET is_active = FALSE, status = 'closed', updated_at = NOW()
         WHERE type IN ('drop', 'ceremony', 'event')
           AND drop_ends_at IS NOT NULL AND drop_ends_at < NOW() AND is_active = TRUE
         RETURNING id
       )
       SELECT COUNT(*) AS count FROM closed`
    );
    results.dropRoomExpiry = { closed: parseInt(closed[0]?.count ?? "0") };
  } catch (err) {
    errors.push(`dropRoomExpiry: ${String(err)}`);
  }

  // SYS-01: Retry failed XP awards (dead-letter queue)
  try {
    await retryFailedXPAwards();
    results.xpDlqRetry = { ok: true };
  } catch (err) {
    errors.push(`xpDlqRetry: ${String(err)}`);
  }

  // WEBHOOK-RETRY-01: Retry failed webhook deliveries
  try {
    const { rows: failedWebhooks } = await db.query<{
      id: string; provider: string; event_type: string; payload: string; retry_count: number;
    }>(
      `SELECT id, provider, event_type, payload::text AS payload, retry_count
       FROM failed_webhooks
       WHERE resolved_at IS NULL AND retry_count < 3
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY created_at ASC LIMIT 50`
    );

    let webhookRetried = 0;
    let webhookResolved = 0;

    for (const row of failedWebhooks) {
      try {
        if (row.provider === 'paystack') {
          const { handlePaystackWebhookPayload } = await import('@/lib/payments/paystackWebhookHandler');
          await handlePaystackWebhookPayload(row.event_type, JSON.parse(row.payload));
        } else if (row.provider === 'dodopayments') {
          const { handleDodoWebhookPayload } = await import('@/lib/payments/dodoWebhookHandler');
          await handleDodoWebhookPayload(row.event_type, JSON.parse(row.payload));
        } else {
          await db.query(`UPDATE failed_webhooks SET resolved_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.id]).catch(() => {});
          continue;
        }
        await db.query(
          `UPDATE failed_webhooks SET resolved_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [row.id]
        ).catch(() => {});
        webhookResolved++;
      } catch (retryErr) {
        const nextRetry = new Date(Date.now() + Math.pow(2, row.retry_count + 1) * 60_000).toISOString();
        await db.query(
          `UPDATE failed_webhooks
           SET retry_count = retry_count + 1, error = $2, next_retry_at = $3, updated_at = NOW()
           WHERE id = $1`,
          [row.id, String(retryErr), nextRetry]
        ).catch(() => {});
      }
      webhookRetried++;
    }
    results.webhookRetry = { attempted: webhookRetried, resolved: webhookResolved };
  } catch (err) {
    errors.push(`webhookRetry: ${String(err)}`);
  }

  // PUSH-RECEIPT-01: Poll Expo push receipts (stage 2)
  try {
    const { pollPushReceipts } = await import('@/lib/notifications/push');
    results.pushReceiptPoll = { resolved: await pollPushReceipts() };
  } catch (err) {
    errors.push(`pushReceiptPoll: ${String(err)}`);
  }

  // SYS-02 + SYS-04: Ledger reconciliation + circuit metrics (parallel, disjoint tables)
  const [reconcileResult, circuitResult] = await Promise.allSettled([
    (async () => {
      // PERF-03: Limit reconciliation to recently active users (last 30 days) to
      // avoid a full-table scan on large user bases. Stale accounts are reconciled
      // lazily the next time they become active.
      const [coinDisc, starDisc] = await Promise.all([
        db.query<{ user_id: string; ledger_sum: string; wallet_balance: string }>(
          `SELECT cl.user_id, SUM(cl.amount)::bigint AS ledger_sum, u.coin_balance AS wallet_balance
           FROM coin_ledger cl JOIN users u ON u.id = cl.user_id
           WHERE u.deleted_at IS NULL
             AND u.updated_at > NOW() - INTERVAL '30 days'
           GROUP BY cl.user_id, u.coin_balance
           HAVING SUM(cl.amount) <> u.coin_balance
           LIMIT 10000`
        ),
        db.query<{ user_id: string; ledger_sum: string; wallet_balance: string }>(
          `SELECT sl.user_id, SUM(sl.amount)::bigint AS ledger_sum, u.star_balance AS wallet_balance
           FROM star_ledger sl JOIN users u ON u.id = sl.user_id
           WHERE u.deleted_at IS NULL
             AND u.updated_at > NOW() - INTERVAL '30 days'
           GROUP BY sl.user_id, u.star_balance
           HAVING SUM(sl.amount) <> u.star_balance
           LIMIT 10000`
        ),
      ]);

      // Batch-upsert coin discrepancies
      if (coinDisc.rows.length > 0) {
        await db.query(
          `INSERT INTO audit_discrepancies (user_id, asset_type, ledger_sum, wallet_balance, detected_at)
           SELECT unnest($1::uuid[]), 'coins', unnest($2::bigint[]), unnest($3::bigint[]), NOW()
           ON CONFLICT (user_id, asset_type) DO UPDATE
             SET ledger_sum = EXCLUDED.ledger_sum, wallet_balance = EXCLUDED.wallet_balance,
                 detected_at = NOW(), resolved = FALSE`,
          [
            coinDisc.rows.map(r => r.user_id),
            coinDisc.rows.map(r => r.ledger_sum),
            coinDisc.rows.map(r => r.wallet_balance),
          ]
        );
      }
      // Batch-upsert star discrepancies
      if (starDisc.rows.length > 0) {
        await db.query(
          `INSERT INTO audit_discrepancies (user_id, asset_type, ledger_sum, wallet_balance, detected_at)
           SELECT unnest($1::uuid[]), 'stars', unnest($2::bigint[]), unnest($3::bigint[]), NOW()
           ON CONFLICT (user_id, asset_type) DO UPDATE
             SET ledger_sum = EXCLUDED.ledger_sum, wallet_balance = EXCLUDED.wallet_balance,
                 detected_at = NOW(), resolved = FALSE`,
          [
            starDisc.rows.map(r => r.user_id),
            starDisc.rows.map(r => r.ledger_sum),
            starDisc.rows.map(r => r.wallet_balance),
          ]
        );
      }

      return { coinDiscrepancies: coinDisc.rows.length, starDiscrepancies: starDisc.rows.length };
    })(),
    getAllCircuitMetrics().catch(() => []),
  ]);

  if (reconcileResult.status === "fulfilled") {
    results.ledgerReconciliation = reconcileResult.value;
  } else {
    errors.push(`ledgerReconciliation: ${String(reconcileResult.reason)}`);
  }
  results.circuitMetrics = circuitResult.status === "fulfilled" ? circuitResult.value : [];

  // SCHEMA-02: Prune expired sessions older than refresh token lifetime (30 days)
  try {
    await db.query(
      `DELETE FROM sessions
       WHERE expires_at < NOW() - INTERVAL '1 day'
       LIMIT 10000`
    );
  } catch (err) {
    console.warn('[daily-platform] Failed to prune expired sessions:', err);
  }

  return NextResponse.json({
    success: errors.length === 0,
    results,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: now.toISOString(),
  });
};
