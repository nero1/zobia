export const dynamic = 'force-dynamic';

/**
 * app/api/business/broadcasts/route.ts
 *
 * GET  /api/business/broadcasts — allowance + send history
 * POST /api/business/broadcasts — send a broadcast to the business owner's followers
 *
 * PRD §17 "Broadcast capability" per Business tier. Audience is opt-in
 * followers of the business account owner (not "all site users" — that
 * stays an admin-only bulk-messaging tool, app/api/admin/messages), and
 * sends are metered by tier per calendar month, with no over-quota paid
 * tier (the business already pays a monthly subscription; this isn't the
 * same pay-per-send economy as personal creator broadcasts).
 *
 * Reuses the creator_broadcasts table/pattern (app/api/creator/broadcasts)
 * rather than inventing a new one, but tags rows with business_account_id
 * so a business owner who is ALSO a personal creator doesn't have the two
 * broadcast quotas bleed into each other (0027_business_broadcasts_and_pending_cancel.sql).
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { logger } from "@/lib/logger";
import { z } from "zod";
import { normalizeBusinessTier, type BusinessTier } from "@/lib/business/limits";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Free monthly broadcast quota per Business tier. Enterprise is effectively unlimited. */
const MONTHLY_QUOTA: Record<BusinessTier, number> = {
  starter: 3,
  growth: 10,
  enterprise: Infinity,
};

const broadcastSchema = z.object({
  subject: z.string().max(200).optional(),
  content: z.string().min(1, "Broadcast content cannot be empty").max(1000, "Broadcast content cannot exceed 1,000 characters"),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function countMonthlyBusinessBroadcasts(businessAccountId: string): Promise<number> {
  const { rows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM creator_broadcasts
     WHERE business_account_id = $1
       AND sender_id IS NULL
       AND created_at >= DATE_TRUNC('month', NOW())`,
    [businessAccountId]
  );
  return parseInt(rows[0]?.cnt ?? "0", 10);
}

async function fetchFollowers(ownerId: string): Promise<Array<{ user_id: string; telegram_id: string | null }>> {
  const { rows } = await db.query<{ user_id: string; telegram_id: string | null }>(
    `SELECT uf.follower_id AS user_id, u.telegram_id
     FROM follows uf
     JOIN users u ON u.id = uf.follower_id
     WHERE uf.following_id = $1
       AND u.deleted_at IS NULL`,
    [ownerId]
  );
  return rows;
}

interface BusinessRow {
  id: string;
  user_id: string;
  tier: string;
  status: string;
}

async function loadBusinessAccount(userId: string): Promise<BusinessRow> {
  const { rows } = await db.query<BusinessRow>(
    `SELECT id, user_id, tier, status FROM business_accounts WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  if (!rows[0]) throw notFound("Business account not found");
  return rows[0];
}

// ---------------------------------------------------------------------------
// GET /api/business/broadcasts
// ---------------------------------------------------------------------------

interface BroadcastHistoryRow {
  id: string;
  subject: string | null;
  content: string;
  created_at: string;
  recipient_count: number;
}

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const business = await loadBusinessAccount(auth.user.sub);
    const tier = normalizeBusinessTier(business.tier);
    const quota = MONTHLY_QUOTA[tier];
    const sentThisMonth = await countMonthlyBusinessBroadcasts(business.id);
    const unlimited = !Number.isFinite(quota);

    const { rows: historyRows } = await db.query<BroadcastHistoryRow>(
      `SELECT id, subject, content, created_at, recipient_count
       FROM creator_broadcasts
       WHERE business_account_id = $1 AND sender_id IS NULL
       ORDER BY created_at DESC
       LIMIT 50`,
      [business.id]
    );

    return NextResponse.json({
      success: true,
      data: {
        tier,
        allowance: {
          quota: unlimited ? null : quota,
          used: sentThisMonth,
          remaining: unlimited ? null : Math.max(0, quota - sentThisMonth),
          unlimited,
        },
        broadcasts: historyRows.map((r) => ({
          id: r.id,
          subject: r.subject ?? "",
          content: r.content,
          sentAt: r.created_at,
          recipientCount: r.recipient_count,
        })),
      },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/business/broadcasts
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

    const business = await loadBusinessAccount(userId);
    if (business.status !== "active") {
      throw forbidden("Your business account must be active to send broadcasts. Renew or resolve your account status first.");
    }

    const body = await validateBody(req, broadcastSchema);

    const tier = normalizeBusinessTier(business.tier);
    const quota = MONTHLY_QUOTA[tier];
    const unlimited = !Number.isFinite(quota);

    if (!unlimited) {
      const sentThisMonth = await countMonthlyBusinessBroadcasts(business.id);
      if (sentThisMonth >= quota) {
        throw forbidden(
          `You've used all ${quota} broadcasts included in your ${tier} plan this month. Upgrade your tier to send more.`,
          "BROADCAST_QUOTA_EXCEEDED"
        );
      }
    }

    const followers = await fetchFollowers(business.user_id);
    const recipientCount = followers.length;
    if (recipientCount === 0) {
      throw badRequest("You have no followers to broadcast to yet");
    }

    const broadcast = await db.transaction(async (tx) => {
      const { rows: broadcastRows } = await tx.query<{ id: string; created_at: string }>(
        `INSERT INTO creator_broadcasts
           (business_account_id, subject, content, recipient_count, cost_coins)
         VALUES ($1, $2, $3, $4, 0)
         RETURNING id, created_at`,
        [business.id, body.subject ?? null, body.content, recipientCount]
      );
      const broadcastRecord = broadcastRows[0];
      if (!broadcastRecord) throw new Error("Broadcast creation failed");

      const userIds = followers.map((f) => f.user_id);
      await tx.query(
        `INSERT INTO creator_broadcasts
           (sender_id, recipient_id, content, message_type, reference_id, business_account_id)
         SELECT $1, u, $2, 'business_broadcast', $3, $4
         FROM UNNEST($5::uuid[]) AS u`,
        [business.user_id, body.content, broadcastRecord.id, business.id, userIds]
      );

      return broadcastRecord;
    });

    const telegramFollowers = followers.filter((f) => f.telegram_id);
    if (telegramFollowers.length > 0) {
      void db
        .query(
          `INSERT INTO telegram_delivery_queue (broadcast_id, telegram_ids) VALUES ($1, $2)`,
          [broadcast.id, JSON.stringify(telegramFollowers.map((f) => f.telegram_id))]
        )
        .catch((err) => {
          logger.error({ err }, "[business/broadcasts] Telegram queue enqueue failed:");
        });
    }

    return NextResponse.json(
      { success: true, data: { broadcastId: broadcast.id, recipientCount }, error: null },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
