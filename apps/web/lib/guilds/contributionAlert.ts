/**
 * lib/guilds/contributionAlert.ts
 *
 * Utility for identifying guild members with below-average war contributions
 * and recording alerts for them.
 *
 * Used by cron jobs or post-war resolution hooks to encourage low-contributing
 * members to participate more in future wars.
 */

import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WarContributionRow {
  user_id: string;
  war_points: number;
}

interface GuildWarRow {
  id: string;
  ended_at: string | null;
}

interface AlertUpsertResult {
  userId: string;
  warPoints: number;
  averagePoints: number;
  alerted: boolean;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Find the last completed war for a guild and compute average war points.
 * Members below average are upserted into guild_contribution_alerts.
 *
 * @param guildId - The guild's UUID.
 * @returns Array of alert results indicating which members were flagged.
 */
export async function checkGuildContributions(
  guildId: string
): Promise<AlertUpsertResult[]> {
  // Find the last completed war involving this guild
  const { rows: warRows } = await db.query<GuildWarRow>(
    `SELECT id, ended_at
     FROM guild_wars
     WHERE (challenger_guild_id = $1 OR defender_guild_id = $1)
       AND status = 'completed'
       AND ended_at IS NOT NULL
     ORDER BY ended_at DESC
     LIMIT 1`,
    [guildId]
  );

  if (!warRows[0]) {
    // No completed war found
    return [];
  }

  const warId = warRows[0].id;

  // Fetch all contributions for this guild in that war
  const { rows: contributions } = await db.query<WarContributionRow>(
    `SELECT user_id, war_points
     FROM war_contributions
     WHERE war_id = $1 AND guild_id = $2`,
    [warId, guildId]
  );

  if (contributions.length === 0) return [];

  // Calculate average
  const total = contributions.reduce((sum, c) => sum + c.war_points, 0);
  const average = total / contributions.length;

  // Identify below-average contributors
  const belowAverage = contributions.filter((c) => c.war_points < average);
  const results: AlertUpsertResult[] = [];

  for (const member of belowAverage) {
    await db.query(
      `INSERT INTO guild_contribution_alerts
         (guild_id, user_id, weeks_below, alerted_at, resolved)
       VALUES ($1, $2, 1, NOW(), FALSE)
       ON CONFLICT (guild_id, user_id) DO UPDATE
         SET weeks_below = guild_contribution_alerts.weeks_below + 1,
             alerted_at = NOW(),
             resolved = FALSE`,
      [guildId, member.user_id]
    );

    results.push({
      userId: member.user_id,
      warPoints: member.war_points,
      averagePoints: Math.round(average),
      alerted: true,
    });
  }

  // Resolve alerts for members who met or exceeded average
  const aboveAverage = contributions.filter((c) => c.war_points >= average);
  for (const member of aboveAverage) {
    await db.query(
      `UPDATE guild_contribution_alerts
       SET resolved = TRUE
       WHERE guild_id = $1 AND user_id = $2 AND resolved = FALSE`,
      [guildId, member.user_id]
    );
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

/**
 * Run contribution checks for a guild and optionally trigger notifications.
 * This is the primary entry point called from cron jobs or war resolution.
 *
 * Currently stores alert records; notification delivery can be layered
 * on top by a separate notification worker reading guild_contribution_alerts.
 *
 * @param guildId - The guild's UUID.
 */
export async function sendGuildContributionAlerts(guildId: string): Promise<void> {
  const results = await checkGuildContributions(guildId);

  if (results.length > 0) {
    console.info(
      `[contributionAlert] Guild ${guildId}: ${results.length} member(s) flagged for low contribution`
    );
  }
}
