/**
 * app/api/users/me/settings/route.ts
 *
 * GET  /api/users/me/settings  – Return current notification and account settings
 * PATCH /api/users/me/settings – Update notification preferences and account settings
 *
 * Manages granular notification toggles per PRD §16:
 *   - new_message, friend_request, gift_received, rank_up,
 *     war_start, season_end, announcement
 * Also manages email-level toggles (all email on/off, non-critical email on/off)
 * and push notification granularity.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db, SqlParam } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const settingsSchema = z.object({
  // Push notification toggles
  dm_notifications:      z.boolean().optional(),
  guild_notifications:   z.boolean().optional(),
  streak_notifications:  z.boolean().optional(),
  notify_new_message:    z.boolean().optional(),
  notify_friend_request: z.boolean().optional(),
  notify_gift_received:  z.boolean().optional(),
  notify_rank_up:        z.boolean().optional(),
  notify_war_start:      z.boolean().optional(),
  notify_season_end:     z.boolean().optional(),
  notify_announcement:   z.boolean().optional(),
  // Email toggles
  email_all_enabled:     z.boolean().optional(),
  email_non_critical:    z.boolean().optional(),
  // Account preferences
  locale:                z.string().min(2).max(10).optional(),
}).strict();

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface SettingsRow {
  dm_notifications:      boolean;
  guild_notifications:   boolean;
  streak_notifications:  boolean;
  notify_new_message:    boolean;
  notify_friend_request: boolean;
  notify_gift_received:  boolean;
  notify_rank_up:        boolean;
  notify_war_start:      boolean;
  notify_season_end:     boolean;
  notify_announcement:   boolean;
  email_all_enabled:     boolean;
  email_non_critical:    boolean;
  locale:                string | null;
}

// ---------------------------------------------------------------------------
// GET /api/users/me/settings
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows } = await db.query<SettingsRow>(
      `SELECT dm_notifications,
              guild_notifications,
              streak_notifications,
              COALESCE(notify_new_message, true)    AS notify_new_message,
              COALESCE(notify_friend_request, true) AS notify_friend_request,
              COALESCE(notify_gift_received, true)  AS notify_gift_received,
              COALESCE(notify_rank_up, true)        AS notify_rank_up,
              COALESCE(notify_war_start, true)      AS notify_war_start,
              COALESCE(notify_season_end, true)     AS notify_season_end,
              COALESCE(notify_announcement, true)   AS notify_announcement,
              COALESCE(email_all_enabled, true)     AS email_all_enabled,
              COALESCE(email_non_critical, true)    AS email_non_critical,
              locale
       FROM users
       WHERE id = $1 AND deleted_at IS NULL
       LIMIT 1`,
      [userId]
    );

    if (!rows[0]) throw notFound("User not found");

    return NextResponse.json({
      success: true,
      data: {
        notifications: {
          push: {
            dmMessages:     rows[0].dm_notifications,
            guildActivity:  rows[0].guild_notifications,
            streakAlert:    rows[0].streak_notifications,
            newMessage:     rows[0].notify_new_message,
            friendRequest:  rows[0].notify_friend_request,
            giftReceived:   rows[0].notify_gift_received,
            rankUp:         rows[0].notify_rank_up,
            warStart:       rows[0].notify_war_start,
            seasonEnd:      rows[0].notify_season_end,
            announcement:   rows[0].notify_announcement,
          },
          email: {
            allEnabled:     rows[0].email_all_enabled,
            nonCritical:    rows[0].email_non_critical,
          },
        },
        locale: rows[0].locale ?? "en",
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/users/me/settings
// ---------------------------------------------------------------------------

export const PATCH = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const body = await validateBody(req, settingsSchema);
    const userId = auth.user.sub;

    const setClauses: string[] = [];
    const values: SqlParam[] = [];
    let idx = 1;

    const boolFields: (keyof typeof body)[] = [
      "dm_notifications", "guild_notifications", "streak_notifications",
      "notify_new_message", "notify_friend_request", "notify_gift_received",
      "notify_rank_up", "notify_war_start", "notify_season_end", "notify_announcement",
      "email_all_enabled", "email_non_critical",
    ];

    for (const field of boolFields) {
      if (body[field] !== undefined) {
        setClauses.push(`${field} = $${idx}`);
        values.push(body[field]);
        idx++;
      }
    }

    if (body.locale !== undefined) {
      setClauses.push(`locale = $${idx}`);
      values.push(body.locale);
      idx++;
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ success: true, data: {}, error: null });
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(userId);

    await db.query(
      `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${idx} AND deleted_at IS NULL`,
      values
    );

    return NextResponse.json({
      success: true,
      data: { updated: setClauses.length - 1 },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});
