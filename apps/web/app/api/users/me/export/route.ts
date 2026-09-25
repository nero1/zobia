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
import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
  transaction_type: string;
  description: string | null;
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
  const db = await getDb();
  const [row] = await db
    .select({ createdAt: schema.dataExportRequests.createdAt })
    .from(schema.dataExportRequests)
    .where(
      and(
        eq(schema.dataExportRequests.userId, userId),
        gt(schema.dataExportRequests.createdAt, sql`NOW() - INTERVAL '24 hours'`)
      )
    )
    .orderBy(desc(schema.dataExportRequests.createdAt))
    .limit(1);

  if (row?.createdAt) {
    const nextAvailableAt = new Date(row.createdAt);
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

    const db = await getDb();

    // Create a pending request record
    const [requestRow] = await db
      .insert(schema.dataExportRequests)
      .values({ userId, status: "pending" })
      .returning({ id: schema.dataExportRequests.id });
    const requestId = requestRow!.id;

    // Gather all user data in parallel
    const [
      profileRows,
      messageRows,
      coinLedgerRows,
      friendRows,
      guildRows,
      questRows,
    ] = await Promise.all([
      // User profile
      db
        .select({
          id: schema.users.id,
          email: schema.users.email,
          username: schema.users.username,
          display_name: schema.users.displayName,
          bio: schema.users.bio,
          avatar_emoji: schema.users.avatarEmoji,
          city: schema.users.city,
          country: schema.users.country,
          locale: schema.users.locale,
          plan: schema.users.plan,
          created_at: schema.users.createdAt,
        })
        .from(schema.users)
        .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
        .limit(1),
      // Last 1000 messages sent
      db
        .select({
          id: schema.messages.id,
          content: schema.messages.content,
          message_type: schema.messages.messageType,
          created_at: schema.messages.createdAt,
        })
        .from(schema.messages)
        .where(
          and(
            eq(schema.messages.senderId, userId),
            eq(schema.messages.isDeleted, false)
          )
        )
        .orderBy(desc(schema.messages.createdAt))
        .limit(1000),
      // Coin ledger (last 500 entries)
      db
        .select({
          id: schema.coinLedger.id,
          amount: schema.coinLedger.amount,
          transaction_type: schema.coinLedger.transactionType,
          description: schema.coinLedger.description,
          created_at: schema.coinLedger.createdAt,
        })
        .from(schema.coinLedger)
        .where(eq(schema.coinLedger.userId, userId))
        .orderBy(desc(schema.coinLedger.createdAt))
        .limit(500),
      // Friends list (accepted friendships only)
      db
        .select({
          friend_id: schema.users.id,
          username: schema.users.username,
          display_name: schema.users.displayName,
          created_at: schema.friendships.createdAt,
        })
        .from(schema.friendships)
        .innerJoin(
          schema.users,
          eq(
            schema.users.id,
            sql`CASE WHEN ${schema.friendships.requesterId} = ${userId} THEN ${schema.friendships.addresseeId} ELSE ${schema.friendships.requesterId} END`
          )
        )
        .where(
          and(
            or(
              eq(schema.friendships.requesterId, userId),
              eq(schema.friendships.addresseeId, userId)
            ),
            eq(schema.friendships.status, "accepted")
          )
        ),
      // Guild memberships
      db
        .select({
          guild_id: schema.guildMembers.guildId,
          guild_name: schema.guilds.name,
          role: schema.guildMembers.role,
          joined_at: schema.guildMembers.joinedAt,
        })
        .from(schema.guildMembers)
        .innerJoin(schema.guilds, eq(schema.guilds.id, schema.guildMembers.guildId))
        .where(eq(schema.guildMembers.userId, userId)),
      // Quest history (from user_quest_progress — user_quests was dropped in migration 0020)
      db
        .select({
          quest_id: schema.userQuestProgress.questId,
          title: schema.questTemplates.title,
          completed_at: schema.userQuestProgress.completedAt,
          progress: schema.userQuestProgress.progressCount,
        })
        .from(schema.userQuestProgress)
        .innerJoin(
          schema.questTemplates,
          eq(schema.questTemplates.id, schema.userQuestProgress.questId)
        )
        .where(eq(schema.userQuestProgress.userId, userId))
        .orderBy(sql`${schema.userQuestProgress.completedAt} DESC NULLS LAST`),
    ]);

    // Build the export payload. coin_ledger.amount is a Drizzle `bigint`
    // column (JS BigInt) — convert to a JSON-serializable number/string.
    const exportData = {
      exportedAt: new Date().toISOString(),
      profile: profileRows[0] ?? null,
      messages: messageRows,
      coinLedger: coinLedgerRows.map((r) => ({ ...r, amount: Number(r.amount) })),
      friends: friendRows,
      guildMemberships: guildRows,
      questHistory: questRows,
    };

    // Encode as base64 data URL (no external storage required for demo)
    const jsonBlob = JSON.stringify(exportData, null, 2);
    const base64 = Buffer.from(jsonBlob, "utf-8").toString("base64");
    const downloadUrl = `data:application/json;base64,${base64}`;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Update the request record with the download URL and expiry
    await db
      .update(schema.dataExportRequests)
      .set({
        status: "completed",
        downloadUrl,
        expiresAt,
        completedAt: new Date(),
      })
      .where(eq(schema.dataExportRequests.id, requestId));

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
