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
 * broadcast quotas bleed into each other (0001_consolidated_schema.sql).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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

// NOTE: `creator_broadcasts.business_account_id` exists in the real table
// (db/migrations/0001_consolidated_schema.sql) but is missing from the
// Drizzle schema (lib/db/schema.ts) — a genuine schema gap. Using
// orm.execute(sql`...`) here instead of the query builder until that
// column is added to schema.ts.
async function countMonthlyBusinessBroadcasts(businessAccountId: string): Promise<number> {
  const orm = await getDb();
  const result = await orm.execute(sql`
    SELECT COUNT(*)::text AS cnt
    FROM creator_broadcasts
    WHERE business_account_id = ${businessAccountId}
      AND sender_id IS NULL
      AND created_at >= DATE_TRUNC('month', NOW())
  `);
  const row = result.rows[0] as { cnt: string } | undefined;
  return parseInt(row?.cnt ?? "0", 10);
}

async function fetchFollowers(ownerId: string): Promise<Array<{ user_id: string; telegram_id: string | null }>> {
  const orm = await getDb();
  const rows = await orm
    .select({
      user_id: schema.follows.followerId,
      telegram_id: schema.users.telegramId,
    })
    .from(schema.follows)
    .innerJoin(schema.users, eq(schema.users.id, schema.follows.followerId))
    .where(
      and(eq(schema.follows.followingId, ownerId), isNull(schema.users.deletedAt))
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
  const orm = await getDb();
  const [row] = await orm
    .select({
      id: schema.businessAccounts.id,
      user_id: schema.businessAccounts.userId,
      tier: schema.businessAccounts.tier,
      status: schema.businessAccounts.status,
    })
    .from(schema.businessAccounts)
    .where(eq(schema.businessAccounts.userId, userId))
    .limit(1);
  if (!row) throw notFound("Business account not found");
  return row;
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

    const orm = await getDb();
    const historyResult = await orm.execute(sql`
      SELECT id, subject, content, created_at, recipient_count
      FROM creator_broadcasts
      WHERE business_account_id = ${business.id} AND sender_id IS NULL
      ORDER BY created_at DESC
      LIMIT 50
    `);
    const historyRows = historyResult.rows as unknown as BroadcastHistoryRow[];

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

    const orm = await getDb();
    const broadcast = await orm.transaction(async (tx) => {
      const insertResult = await tx.execute(sql`
        INSERT INTO creator_broadcasts
          (business_account_id, subject, content, recipient_count, cost_coins)
        VALUES (${business.id}, ${body.subject ?? null}, ${body.content}, ${recipientCount}, 0)
        RETURNING id, created_at
      `);
      const broadcastRecord = insertResult.rows[0] as
        | { id: string; created_at: string }
        | undefined;
      if (!broadcastRecord) throw new Error("Broadcast creation failed");

      const userIds = followers.map((f) => f.user_id);
      await tx.execute(sql`
        INSERT INTO creator_broadcasts
          (sender_id, recipient_id, content, message_type, reference_id, business_account_id)
        SELECT ${business.user_id}, u, ${body.content}, 'business_broadcast', ${broadcastRecord.id}, ${business.id}
        FROM UNNEST(${userIds}::uuid[]) AS u
      `);

      return broadcastRecord;
    });

    const telegramFollowers = followers.filter((f) => f.telegram_id);
    if (telegramFollowers.length > 0) {
      void orm
        .insert(schema.telegramDeliveryQueue)
        .values({
          broadcastId: broadcast.id,
          telegramIds: telegramFollowers.map((f) => f.telegram_id),
        })
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
