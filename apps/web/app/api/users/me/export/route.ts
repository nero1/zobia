export const dynamic = 'force-dynamic';

/**
 * app/api/users/me/export/route.ts
 *
 * POST /api/users/me/export
 *
 * GDPR data export endpoint. Synchronously gathers the user's data,
 * encodes it as a JSON blob, stores it as a downloadable data URL,
 * and returns a download link valid for 7 days.
 *
 * Rate limited to 1 request per 24 hours per user.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, ApiError } from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface UserProfileRow {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_emoji: string | null;
  city: string | null;
  country: string | null;
  locale: string | null;
  plan: string;
  created_at: string;
}

interface MessageRow {
  id: string;
  content: string | null;
  message_type: string;
  created_at: string;
}

interface CoinLedgerRow {
  id: string;
  amount: number;
  reason: string;
  created_at: string;
}

interface FriendRow {
  friend_id: string;
  username: string | null;
  display_name: string | null;
  created_at: string;
}

interface GuildMembershipRow {
  guild_id: string;
  guild_name: string;
  role: string;
  joined_at: string;
}

interface QuestRow {
  quest_id: string;
  title: string;
  completed_at: string | null;
  progress: number;
}

// ---------------------------------------------------------------------------
// Rate limit check (1 request per 24 hours)
// ---------------------------------------------------------------------------

async function checkExportRateLimit(userId: string): Promise<void> {
  const { rows } = await db.query<{ created_at: string }>(
    `SELECT created_at
     FROM data_export_requests
     WHERE user_id = $1
       AND created_at > NOW() - INTERVAL '24 hours'
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );

  if (rows[0]) {
    const nextAvailableAt = new Date(rows[0].created_at);
    nextAvailableAt.setHours(nextAvailableAt.getHours() + 24);
    throw new ApiError(
      429,
      "EXPORT_RATE_LIMITED",
      `You can only request a data export once per 24 hours. Next available at ${nextAvailableAt.toISOString()}`
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/users/me/export
// ---------------------------------------------------------------------------

/**
 * Request a GDPR data export for the authenticated user.
 *
 * @returns JSON { requestId, downloadUrl, expiresAt }
 */
export const POST = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    // Enforce 24-hour rate limit
    await checkExportRateLimit(userId);

    // Create a pending request record
    const { rows: requestRows } = await db.query<{ id: string }>(
      `INSERT INTO data_export_requests (user_id, status, created_at)
       VALUES ($1, 'pending', NOW())
       RETURNING id`,
      [userId]
    );
    const requestId = requestRows[0]!.id;

    // Gather all user data in parallel
    const [
      profileResult,
      messagesResult,
      coinLedgerResult,
      friendsResult,
      guildResult,
      questsResult,
    ] = await Promise.all([
      // User profile
      db.query<UserProfileRow>(
        `SELECT id, email, username, display_name, bio, avatar_emoji,
                city, country, locale, plan, created_at
         FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
        [userId]
      ),
      // Last 1000 messages sent
      db.query<MessageRow>(
        `SELECT id, content, message_type, created_at
         FROM messages
         WHERE sender_id = $1 AND is_deleted = FALSE
         ORDER BY created_at DESC
         LIMIT 1000`,
        [userId]
      ),
      // Coin ledger (last 500 entries)
      db.query<CoinLedgerRow>(
        `SELECT id, amount, reason, created_at
         FROM coin_ledger
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 500`,
        [userId]
      ),
      // Friends list
      db.query<FriendRow>(
        `SELECT f.friend_id, u.username, u.display_name, f.created_at
         FROM friends f
         JOIN users u ON u.id = f.friend_id
         WHERE f.user_id = $1`,
        [userId]
      ),
      // Guild memberships
      db.query<GuildMembershipRow>(
        `SELECT gm.guild_id, g.name AS guild_name, gm.role, gm.joined_at
         FROM guild_members gm
         JOIN guilds g ON g.id = gm.guild_id
         WHERE gm.user_id = $1`,
        [userId]
      ),
      // Quest history
      db.query<QuestRow>(
        `SELECT uq.quest_id, q.title, uq.completed_at, uq.progress
         FROM user_quests uq
         JOIN quests q ON q.id = uq.quest_id
         WHERE uq.user_id = $1
         ORDER BY uq.completed_at DESC NULLS LAST`,
        [userId]
      ),
    ]);

    // Build the export payload
    const exportData = {
      exportedAt: new Date().toISOString(),
      profile: profileResult.rows[0] ?? null,
      messages: messagesResult.rows,
      coinLedger: coinLedgerResult.rows,
      friends: friendsResult.rows,
      guildMemberships: guildResult.rows,
      questHistory: questsResult.rows,
    };

    // Encode as base64 data URL (no external storage required for demo)
    const jsonBlob = JSON.stringify(exportData, null, 2);
    const base64 = Buffer.from(jsonBlob, "utf-8").toString("base64");
    const downloadUrl = `data:application/json;base64,${base64}`;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Update the request record with the download URL and expiry
    await db.query(
      `UPDATE data_export_requests
       SET status = 'completed',
           download_url = $2,
           expires_at = $3,
           completed_at = NOW()
       WHERE id = $1`,
      [requestId, downloadUrl, expiresAt.toISOString()]
    );

    return NextResponse.json(
      {
        requestId,
        downloadUrl,
        expiresAt: expiresAt.toISOString(),
      },
      { status: 200 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
