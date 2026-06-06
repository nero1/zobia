/**
 * app/api/cron/guild-wars/route.ts
 *
 * Hourly CRON handler for guild war lifecycle management.
 *
 * Called every hour via cron-jobs.org:
 *   URL: /api/cron/guild-wars
 *   Header: Authorization: Bearer <CRON_SECRET>
 *
 * Responsibilities (idempotent — safe to call multiple times):
 *  1. Find wars that should enter Final Hour (ends_at ≤ now + 1 hour, status = 'active')
 *     → Transition them to 'final_hour' and notify all guild members.
 *  2. Find wars that have ended (ends_at < now, status in ['active', 'final_hour'])
 *     → Call resolveWar() for each and mark them 'completed'.
 *
 * Returns { processed, finalHourStarted, resolved }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveWar } from "@/lib/guilds/warEngine";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Validates the CRON secret from the Authorization header.
 * Returns true only when the header matches CRON_SECRET exactly.
 */
function validateCronSecret(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = req.headers.get("authorization");
  return authHeader === `Bearer ${cronSecret}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuildWarRow {
  id: string;
  guild_a_id: string;
  guild_b_id: string;
  challenger_guild_id: string;
  defender_guild_id: string;
  status: string;
  ends_at: string;
}

interface GuildMemberRow {
  user_id: string;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Hourly guild war CRON.
 * Protected by CRON_SECRET Bearer token.
 * All operations are idempotent — re-running after a partial failure is safe.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!validateCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

  let finalHourStarted = 0;
  let resolved = 0;
  const errors: string[] = [];

  // -------------------------------------------------------------------------
  // Step 1: Transition wars to Final Hour
  // Wars whose ends_at falls within the next hour (and are still 'active').
  // -------------------------------------------------------------------------
  try {
    const finalHourCandidates = await db.query<GuildWarRow>(
      `SELECT id, challenger_guild_id, defender_guild_id, status, ends_at
       FROM guild_wars
       WHERE status = 'active'
         AND ends_at <= $1
         AND ends_at > $2`,
      [oneHourFromNow.toISOString(), now.toISOString()]
    );

    for (const war of finalHourCandidates.rows) {
      try {
        // Mark as final_hour
        await db.query(
          `UPDATE guild_wars SET status = 'final_hour', updated_at = NOW()
           WHERE id = $1 AND status = 'active'`,
          [war.id]
        );

        // Collect all member user IDs from both guilds
        const membersResult = await db.query<GuildMemberRow>(
          `SELECT user_id FROM guild_members
           WHERE guild_id = ANY($1::uuid[]) AND left_at IS NULL`,
          [[war.challenger_guild_id, war.defender_guild_id]]
        );

        // Insert in-app notifications for all members
        const userIds = membersResult.rows.map((r) => r.user_id);
        if (userIds.length > 0) {
          // Batch insert notifications (one per member)
          const values = userIds
            .map(
              (_, i) =>
                `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`
            )
            .join(", ");
          const params: (string | boolean)[] = [];
          for (const userId of userIds) {
            params.push(
              userId,
              "guild_war_final_hour",
              JSON.stringify({ war_id: war.id }),
              false
            );
          }
          await db.query(
            `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
             VALUES ${values.replace(/\$(\d+)/g, (_, n) => `$${n}`)}
             ON CONFLICT DO NOTHING`,
            params
          );
        }

        finalHourStarted++;
      } catch (err) {
        errors.push(`finalHour war ${war.id}: ${String(err)}`);
      }
    }
  } catch (err) {
    errors.push(`finalHourQuery: ${String(err)}`);
  }

  // -------------------------------------------------------------------------
  // Step 2: Resolve completed wars
  // Wars whose ends_at has passed and are still active or in final_hour.
  // -------------------------------------------------------------------------
  try {
    const completedWars = await db.query<GuildWarRow>(
      `SELECT id, guild_a_id, guild_b_id, challenger_guild_id, defender_guild_id, status, ends_at
       FROM guild_wars
       WHERE status IN ('active', 'final_hour')
         AND ends_at < $1`,
      [now.toISOString()]
    );

    for (const war of completedWars.rows) {
      try {
        const result = await resolveWar(war.id, db);

        await db.query(
          `UPDATE guild_wars SET status = 'completed', updated_at = NOW()
           WHERE id = $1 AND status != 'completed'`,
          [war.id]
        );

        // Award rematch token to the losing guild
        const loserGuildId = result.winnerGuildId === war.challenger_guild_id
          ? war.defender_guild_id
          : war.challenger_guild_id;
        await db.query(
          `INSERT INTO guild_war_rematch_tokens
             (guild_id, war_id, discount_percent, is_used, expires_at)
           VALUES ($1, $2, 50, false, NOW() + INTERVAL '7 days')
           ON CONFLICT DO NOTHING`,
          [loserGuildId, war.id]
        );

        resolved++;
      } catch (err) {
        errors.push(`resolveWar ${war.id}: ${String(err)}`);
      }
    }
  } catch (err) {
    errors.push(`resolveQuery: ${String(err)}`);
  }

  // -------------------------------------------------------------------------
  // Step 3: Auto-close Drop Rooms whose closes_at has passed
  // Drop rooms are time-limited; auto-deactivate them after their window.
  // -------------------------------------------------------------------------
  let dropRoomsClosed = 0;
  try {
    const closedRooms = await db.query<{ id: string }>(
      `UPDATE rooms
       SET is_active = false, updated_at = NOW()
       WHERE (type = 'drop' OR room_type = 'drop')
         AND is_active = true
         AND drop_ends_at IS NOT NULL
         AND drop_ends_at < $1
         AND deleted_at IS NULL
       RETURNING id`,
      [now.toISOString()]
    );
    dropRoomsClosed = closedRooms.rows.length;
  } catch (err) {
    errors.push(`dropRoomAutoClose: ${String(err)}`);
  }

  // -------------------------------------------------------------------------
  // Step 4: Expire old telegram_login_states (older than 10 minutes)
  // -------------------------------------------------------------------------
  try {
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    await db.query(
      `DELETE FROM telegram_login_states WHERE created_at < $1`,
      [tenMinutesAgo]
    );
  } catch {
    // Non-critical; ignore
  }

  // -------------------------------------------------------------------------
  // Step 5: Flash XP — send 6-hour advance announcement notifications
  //
  // PRD §2.4: Flash events are "announced 6 hours in advance but firing at an
  // unannounced moment within that window."
  //
  // When announced_at <= NOW() and announcement_notification_sent = FALSE,
  // blast a push notification to all active users and mark the event sent.
  // -------------------------------------------------------------------------
  let flashXpAnnounced = 0;
  try {
    const { rows: toAnnounce } = await db.query<{
      id: string;
      name: string;
      fires_at: string;
      ends_at: string;
      multiplier: string;
    }>(
      `SELECT id, name, fires_at, ends_at, multiplier::TEXT AS multiplier
       FROM flash_xp_events
       WHERE is_active = TRUE
         AND announced_at <= $1
         AND announcement_notification_sent = FALSE
         AND fires_at > $1`,
      [now.toISOString()]
    );

    for (const evt of toAnnounce) {
      try {
        // Mark as announced atomically before sending notifications
        // (so re-runs after a partial send don't re-announce)
        const { rowCount } = await db.query(
          `UPDATE flash_xp_events
           SET announcement_notification_sent = TRUE,
               notification_sent_at = NOW()
           WHERE id = $1 AND announcement_notification_sent = FALSE`,
          [evt.id]
        );

        if (!rowCount || rowCount === 0) continue; // Another instance beat us

        // Insert in-app notifications for all active users (last 30 days)
        await db.query(
          `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
           SELECT id,
                  'flash_xp_announced',
                  $1::jsonb,
                  FALSE,
                  NOW()
           FROM users
           WHERE deleted_at IS NULL
             AND last_active_at > NOW() - INTERVAL '30 days'
           ON CONFLICT DO NOTHING`,
          [
            JSON.stringify({
              eventId: evt.id,
              name: evt.name,
              multiplier: parseFloat(evt.multiplier),
              windowEnd: evt.ends_at,
              message: `⚡ Double XP is happening sometime before ${new Date(evt.ends_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })} today! Stay active.`,
            }),
          ]
        );

        flashXpAnnounced++;
      } catch (err) {
        errors.push(`flashXpAnnounce(${evt.id}): ${String(err)}`);
      }
    }
  } catch (err) {
    errors.push(`flashXpAnnouncements: ${String(err)}`);
  }

  // -------------------------------------------------------------------------
  // Step 6: Flash XP — activate events that have reached their fires_at time
  //
  // fires_at is the actual (hidden) moment the event starts. When the clock
  // passes fires_at and fired = FALSE, mark the event as fired and insert a
  // platform-wide in-app notification signalling the event is NOW live.
  //
  // The XP multiplier is applied at award time by checking flash_xp_events
  // for any active row where fired=TRUE, fires_at<=NOW(), ends_at>NOW().
  // -------------------------------------------------------------------------
  let flashXpFired = 0;
  try {
    const { rows: toFire } = await db.query<{
      id: string;
      name: string;
      multiplier: string;
      ends_at: string;
    }>(
      `SELECT id, name, multiplier::TEXT AS multiplier, ends_at
       FROM flash_xp_events
       WHERE is_active = TRUE
         AND fired = FALSE
         AND fires_at <= $1
         AND ends_at > $1`,
      [now.toISOString()]
    );

    for (const evt of toFire) {
      try {
        // Atomically mark as fired
        const { rowCount } = await db.query(
          `UPDATE flash_xp_events
           SET fired = TRUE, updated_at = NOW()
           WHERE id = $1 AND fired = FALSE`,
          [evt.id]
        );

        if (!rowCount || rowCount === 0) continue;

        // Insert high-urgency in-app notification for all active users
        await db.query(
          `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
           SELECT id,
                  'flash_xp_live',
                  $1::jsonb,
                  FALSE,
                  NOW()
           FROM users
           WHERE deleted_at IS NULL
             AND last_active_at > NOW() - INTERVAL '7 days'
           ON CONFLICT DO NOTHING`,
          [
            JSON.stringify({
              eventId: evt.id,
              name: evt.name,
              multiplier: parseFloat(evt.multiplier),
              endsAt: evt.ends_at,
              message: `⚡ ${evt.name} is LIVE NOW! ${evt.multiplier}× XP until ${new Date(evt.ends_at).toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" })}. Go earn!`,
            }),
          ]
        );

        flashXpFired++;
      } catch (err) {
        errors.push(`flashXpFire(${evt.id}): ${String(err)}`);
      }
    }
  } catch (err) {
    errors.push(`flashXpFiring: ${String(err)}`);
  }

  return NextResponse.json({
    ok: true,
    processed: finalHourStarted + resolved + dropRoomsClosed + flashXpAnnounced + flashXpFired,
    finalHourStarted,
    resolved,
    dropRoomsClosed,
    flashXpAnnounced,
    flashXpFired,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: now.toISOString(),
  });
}
