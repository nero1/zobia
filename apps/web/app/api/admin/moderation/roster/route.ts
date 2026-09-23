export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/moderation/roster
 *
 * Central roster of every account currently flagged with any staff role
 * (Platform Mod, Ad Moderator, Support, Senior Support) — powers
 * /gate44/moderation/roster so an admin doesn't have to search for each
 * user individually in User Management. Grant/revoke still goes through
 * the existing POST /api/admin/users/[userId]/actions endpoint (the
 * upgrade_/downgrade_ actions) — this route is read-only.
 *
 * Admin-only — is_admin verified from DATABASE by withAdminAuth.
 *
 * @module app/api/admin/moderation/roster
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";

interface RosterRow {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_emoji: string | null;
  is_admin: boolean;
  is_moderator: boolean;
  is_ad_moderator: boolean;
  is_support: boolean;
  is_senior_support: boolean;
  is_suspended: boolean;
  is_banned: boolean;
}

export const GET = withAdminAuth(async (_req: NextRequest, _ctx) => {
  try {
    const { rows } = await db.query<RosterRow>(
      `SELECT id, username, display_name, avatar_emoji,
              COALESCE(is_admin, false) AS is_admin,
              COALESCE(is_moderator, false) AS is_moderator,
              COALESCE(is_ad_moderator, false) AS is_ad_moderator,
              COALESCE(is_support, false) AS is_support,
              COALESCE(is_senior_support, false) AS is_senior_support,
              COALESCE(is_suspended, false) AS is_suspended,
              COALESCE(is_banned, false) AS is_banned
       FROM users
       WHERE deleted_at IS NULL
         AND (
           COALESCE(is_moderator, false) = true
           OR COALESCE(is_ad_moderator, false) = true
           OR COALESCE(is_support, false) = true
           OR COALESCE(is_senior_support, false) = true
         )
       ORDER BY username ASC NULLS LAST
       LIMIT 500`
    );

    const roster = rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      avatarEmoji: row.avatar_emoji,
      isAdmin: row.is_admin,
      isModerator: row.is_moderator,
      isAdModerator: row.is_ad_moderator,
      isSupport: row.is_support,
      isSeniorSupport: row.is_senior_support,
      isSuspended: row.is_suspended,
      isBanned: row.is_banned,
    }));

    return NextResponse.json({ roster });
  } catch (err) {
    return handleApiError(err);
  }
});
