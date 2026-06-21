export const dynamic = 'force-dynamic';
export const maxDuration = 10;

/**
 * app/api/cron/guild-wars/route.ts
 *
 * Hourly CRON handler for guild war lifecycle management.
 *
 * DEPLOYMENT NOTE: Vercel's hobby plan only allows 1 CRON per day.
 * This route must be triggered externally via cron-jobs.org (or similar service).
 * Set up hourly calls to: https://zobia.vercel.app/api/cron/guild-wars
 * with header: Authorization: Bearer <CRON_SECRET>
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
import { validateCronSecret } from "@/lib/cron/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GuildWarRow {
  id: string;
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

        // Insert in-app notifications for all members — reference_id = war id
        // ensures ON CONFLICT deduplicates CRON re-runs (BUG-NOTIF-02).
        const userIds = membersResult.rows.map((r) => r.user_id);
        if (userIds.length > 0) {
          // Batch insert notifications (one per member) using modern title/body/metadata format
          const values = userIds
            .map(
              (_, i) =>
                `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}::jsonb, $${i * 6 + 6})`
            )
            .join(", ");
          const params: (string | boolean)[] = [];
          for (const userId of userIds) {
            params.push(
              userId,
              "guild_war_final_hour",
              "⚔️ Final Hour!",
              "Your guild's war is entering the final hour! Give it everything you've got.",
              JSON.stringify({ war_id: war.id }),
              `guild_war_final_hour:${war.id}`
            );
          }
          await db.query(
            `INSERT INTO notifications (user_id, type, title, body, metadata, reference_id)
             VALUES ${values}
             ON CONFLICT (user_id, type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
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
      `SELECT id, challenger_guild_id, defender_guild_id, status, ends_at
       FROM guild_wars
       WHERE status IN ('active', 'final_hour')
         AND ends_at < $1`,
      [now.toISOString()]
    );

    for (const war of completedWars.rows) {
      try {
        // resolveWar() sets status = 'completed' internally within its own transaction
        const result = await resolveWar(war.id, db);

        // Award rematch token to the losing guild — skip on draw (no loser)
        if (result.outcome !== 'draw' && result.loserGuildId) {
          await db.query(
            `INSERT INTO guild_war_rematch_tokens
               (guild_id, war_id, discount_percent, is_used, expires_at)
             VALUES ($1, $2, 50, false, NOW() + INTERVAL '7 days')
             ON CONFLICT DO NOTHING`,
            [result.loserGuildId, war.id]
          );
        }

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
  // Steps 5–6: Flash XP lifecycle — announce, fire (shared lib handles expiry too)
  // -------------------------------------------------------------------------
  let flashXpAnnounced = 0;
  let flashXpFired = 0;
  try {
    const { advanceFlashXPLifecycle } = await import('@/lib/events/flashXP');
    const flashResult = await advanceFlashXPLifecycle();
    flashXpAnnounced = flashResult.announced;
    flashXpFired = flashResult.fired;
  } catch (err) {
    errors.push(`flashXpLifecycle: ${String(err)}`);
  }

  // -------------------------------------------------------------------------
  // Step 7: Guild tier minimum member enforcement (PRD §13) — set-based batch
  //
  // Three separate UPDATEs replace the previous per-guild N+1 loop:
  //   A) Reset guilds that recovered above their tier minimum.
  //   C) Downgrade guilds that have been below-minimum for 7+ days and notify.
  //   B) Stamp below_min_since for guilds newly below minimum (first time only).
  //
  // GUILD-01: consolidated to use below_min_since (timestamp) — the canonical
  // column also used by daily-guilds — instead of below_minimum_days (integer).
  // Date math on the timestamp replaces the daily-increment counter pattern.
  //
  // ORDER MATTERS: downgrade (C) runs BEFORE stamp (B). Guilds C just downgraded
  // have below_min_since reset to NULL, so B will re-stamp them at NOW() if they
  // are still below their (now lower) tier minimum — a fresh countdown at day 0,
  // which is correct for an understaffed guild.
  //
  // Tier minimums: bronze=5, silver=10, gold=15, platinum=20, legend=25
  // -------------------------------------------------------------------------

  // Reusable CASE expression for minimum member count per tier group
  const TIER_MIN_CASE = `
    CASE
      WHEN tier LIKE 'bronze%' THEN 5
      WHEN tier LIKE 'silver%' THEN 10
      WHEN tier LIKE 'gold%'   THEN 15
      WHEN tier LIKE 'platinum%' THEN 20
      WHEN tier = 'legend'     THEN 25
      ELSE 0
    END
  `;

  // Downgrade: legend→platinum, platinum→gold, gold→silver, silver→bronze (floor)
  const TIER_DOWNGRADE_CASE = `
    CASE
      WHEN tier = 'legend'     THEN 'platinum'
      WHEN tier LIKE 'platinum%' THEN 'gold'
      WHEN tier LIKE 'gold%'   THEN 'silver'
      ELSE 'bronze'
    END
  `;

  let guildTierDowngrades = 0;

  try {
    // A) Reset healthy guilds — clear below_min_since when back above minimum
    await db.query(
      `UPDATE guilds g
       SET below_min_since = NULL, updated_at = NOW()
       WHERE g.deleted_at IS NULL AND g.is_active = TRUE
         AND g.below_min_since IS NOT NULL
         AND (
           SELECT COUNT(*) FROM guild_members gm
           WHERE gm.guild_id = g.id AND gm.left_at IS NULL
         ) >= ${TIER_MIN_CASE}`
    );

    // C) Downgrade guilds that have been below-minimum for 7+ days, notify captains
    //    (runs BEFORE the stamp step so it reads the original below_min_since)
    const downgradeWeek = now.toISOString().slice(0, 10);
    const { rows: downgraded } = await db.query<{
      id: string; captain_id: string; old_tier: string; new_tier: string;
    }>(
      `WITH to_downgrade AS (
         SELECT g.id, g.captain_id, g.tier AS old_tier,
                ${TIER_DOWNGRADE_CASE} AS new_tier
         FROM guilds g
         WHERE g.deleted_at IS NULL AND g.is_active = TRUE
           AND g.below_min_since IS NOT NULL
           AND g.below_min_since <= NOW() - INTERVAL '7 days'
           AND (
             SELECT COUNT(*) FROM guild_members gm
             WHERE gm.guild_id = g.id AND gm.left_at IS NULL
           ) < ${TIER_MIN_CASE}
       ),
       updated AS (
         UPDATE guilds SET tier = td.new_tier, below_min_since = NULL, updated_at = NOW()
         FROM to_downgrade td
         WHERE guilds.id = td.id
         RETURNING guilds.id, td.captain_id, td.old_tier, td.new_tier
       )
       SELECT id, captain_id, old_tier, new_tier FROM updated`
    );

    if (downgraded.length > 0) {
      // Batch-insert captain notifications. Use a subquery to expand unnest() once
      // so each array column is only referenced once — avoids N² cross-join if
      // the same array is unnested more than once in a flat SELECT.
      await db.query(
        `INSERT INTO notifications (user_id, type, title, body, metadata, is_read, reference_id, created_at)
         SELECT sub.captain_id,
                'guild_tier_downgrade',
                'Guild Tier Downgrade',
                'Your guild has been downgraded due to insufficient members. Recruit more members to restore your tier.',
                jsonb_build_object('guildId', sub.guild_id, 'previousTier', sub.old_tier, 'newTier', sub.new_tier),
                false,
                'guild_tier_downgrade:' || sub.guild_id || ':' || $5,
                NOW()
         FROM (SELECT unnest($1::uuid[]) AS captain_id,
                      unnest($2::text[]) AS guild_id,
                      unnest($3::text[]) AS old_tier,
                      unnest($4::text[]) AS new_tier) sub
         ON CONFLICT (user_id, type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`,
        [
          downgraded.map(d => d.captain_id),
          downgraded.map(d => d.id),
          downgraded.map(d => d.old_tier),
          downgraded.map(d => d.new_tier),
          downgradeWeek,
        ]
      ).catch(() => {});

      guildTierDowngrades = downgraded.length;
    }

    // B) Stamp below_min_since for guilds that are below minimum but not yet flagged.
    //    Runs AFTER the downgrade pass. Guilds C just downgraded had below_min_since
    //    reset to NULL; if still below their (now lower) tier minimum they will be
    //    re-stamped at NOW() here — a fresh 7-day countdown, which is correct.
    //    COALESCE preserves the existing timestamp for guilds already in the countdown.
    await db.query(
      `UPDATE guilds g
       SET below_min_since = COALESCE(g.below_min_since, NOW()), updated_at = NOW()
       WHERE g.deleted_at IS NULL AND g.is_active = TRUE
         AND (
           SELECT COUNT(*) FROM guild_members gm
           WHERE gm.guild_id = g.id AND gm.left_at IS NULL
         ) < ${TIER_MIN_CASE}`
    );
  } catch (err) {
    errors.push(`guildTierMinimumCheck: ${String(err)}`);
  }

  // -------------------------------------------------------------------------
  // Step 8: Auto-close expired Limited rooms (PRD §6 — new room type)
  // Limited rooms have a duration_minutes and should auto-close after it elapses.
  // -------------------------------------------------------------------------
  let limitedRoomsClosed = 0;
  try {
    const { rows: closedLimited } = await db.query<{ id: string }>(
      `UPDATE rooms
       SET is_active = false, updated_at = NOW()
       WHERE type = 'limited'
         AND is_active = true
         AND created_at + (duration_minutes || ' minutes')::INTERVAL < $1
         AND deleted_at IS NULL
       RETURNING id`,
      [now.toISOString()]
    );
    limitedRoomsClosed = closedLimited.length;
  } catch (err) {
    errors.push(`limitedRoomAutoClose: ${String(err)}`);
  }

  return NextResponse.json({
    ok: true,
    processed: finalHourStarted + resolved + dropRoomsClosed + flashXpAnnounced + flashXpFired + guildTierDowngrades + limitedRoomsClosed,
    finalHourStarted,
    resolved,
    dropRoomsClosed,
    flashXpAnnounced,
    flashXpFired,
    guildTierDowngrades,
    limitedRoomsClosed,
    errors: errors.length > 0 ? errors : undefined,
    timestamp: now.toISOString(),
  });
}
