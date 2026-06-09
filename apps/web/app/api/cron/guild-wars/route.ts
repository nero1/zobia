export const dynamic = 'force-dynamic';

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
  // Step 7: Guild tier minimum member enforcement (PRD §13)
  //
  // Each guild tier requires a minimum member count. Guilds that fall below
  // their minimum increment below_minimum_days. After 7 consecutive days,
  // they are downgraded one tier and the captain is notified.
  //
  // Tier minimums: bronze=5, silver=10, gold=15, platinum=20, legend=25
  // -------------------------------------------------------------------------
  const TIER_MIN_MEMBERS: Record<string, number> = {
    bronze: 5,
    silver: 10,
    gold: 15,
    platinum: 20,
    legend: 25,
  };
  const TIER_ORDER_DOWN = ['bronze', 'silver', 'gold', 'platinum', 'legend'];
  let guildTierDowngrades = 0;

  try {
    const { rows: guilds } = await db.query<{
      id: string;
      tier: string;
      captain_id: string;
      below_minimum_days: number;
      member_count: number;
    }>(
      `SELECT g.id, g.tier, g.captain_id, g.below_minimum_days,
              (SELECT COUNT(*) FROM guild_members gm WHERE gm.guild_id = g.id AND gm.left_at IS NULL)::int AS member_count
       FROM guilds g
       WHERE g.deleted_at IS NULL AND g.is_active = TRUE AND g.tier != 'bronze'`
    );

    for (const guild of guilds) {
      try {
        const minMembers = TIER_MIN_MEMBERS[guild.tier] ?? 0;
        if (guild.member_count >= minMembers) {
          // Back to healthy — reset counter
          if (guild.below_minimum_days > 0) {
            await db.query(
              `UPDATE guilds SET below_minimum_days = 0, updated_at = NOW() WHERE id = $1`,
              [guild.id]
            );
          }
        } else {
          const newDays = guild.below_minimum_days + 1;
          if (newDays >= 7) {
            // Downgrade one tier
            const currentIdx = TIER_ORDER_DOWN.indexOf(guild.tier);
            const newTier = currentIdx > 0 ? TIER_ORDER_DOWN[currentIdx - 1] : guild.tier;
            await db.query(
              `UPDATE guilds SET tier = $1, below_minimum_days = 0, updated_at = NOW() WHERE id = $2`,
              [newTier, guild.id]
            );
            // Notify captain
            await db.query(
              `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
               VALUES ($1, 'guild_tier_downgrade', $2::jsonb, false, NOW())`,
              [guild.captain_id, JSON.stringify({ guildId: guild.id, previousTier: guild.tier, newTier })]
            );
            guildTierDowngrades++;
          } else {
            await db.query(
              `UPDATE guilds SET below_minimum_days = $1, updated_at = NOW() WHERE id = $2`,
              [newDays, guild.id]
            );
          }
        }
      } catch (err) {
        errors.push(`guildTierCheck(${guild.id}): ${String(err)}`);
      }
    }
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
