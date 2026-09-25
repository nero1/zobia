export const dynamic = 'force-dynamic';

/**
 * app/api/seasons/[seasonId]/pass/gift/route.ts
 *
 * POST /api/seasons/:seasonId/pass/gift
 * Gift a paid Season Pass to another user.
 *
 * Body: { recipientUserId: string }
 *
 * - Gets season pass price from the season record
 * - Deducts coins from sender (pass_price_coins)
 * - Grants paid pass to recipient (upsert user_season_passes with is_paid=true)
 * - Awards XP to sender (Generosity Track)
 * - Sends notification to recipient
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { debitCoins } from "@/lib/economy/coins";
import { safeAwardXP } from "@/lib/xp/safeAwardXP";
import { insertNotification } from "@/lib/notifications/insert";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** XP awarded to the sender for gifting a season pass (Generosity Track). */
const GENEROSITY_XP_FOR_PASS_GIFT = 300;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const giftPassSchema = z.object({
  recipientUserId: z.string().uuid("recipientUserId must be a valid UUID"),
});

// ---------------------------------------------------------------------------
// POST /api/seasons/[seasonId]/pass/gift
// ---------------------------------------------------------------------------

/**
 * Gift a paid season pass to another user.
 *
 * Deducts pass_price_coins from sender, grants paid pass to recipient,
 * awards Generosity Track XP to sender, and notifies recipient.
 */
export const POST = withAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { seasonId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

      const { seasonId } = params;
      const senderId = auth.user.sub;
      const body = await validateBody(req, giftPassSchema);
      const { recipientUserId } = body;

      if (recipientUserId === senderId) {
        throw badRequest("Cannot gift a season pass to yourself");
      }

      const orm = await getDb();

      // Verify recipient exists and is active
      const [recipient] = await orm
        .select({
          id: schema.users.id,
          username: schema.users.username,
          displayName: schema.users.displayName,
        })
        .from(schema.users)
        .where(and(eq(schema.users.id, recipientUserId), isNull(schema.users.deletedAt)))
        .limit(1);

      if (!recipient) throw notFound("Recipient not found");

      const result = await orm.transaction(async (tx) => {
        // 1. Lock and verify season
        const [season] = await tx
          .select({
            id: schema.seasons.id,
            name: schema.seasons.name,
            isActive: schema.seasons.isActive,
            passPriceCoins: schema.seasons.passPriceCoins,
            endsAt: schema.seasons.endsAt,
          })
          .from(schema.seasons)
          .where(eq(schema.seasons.id, seasonId))
          .for("update");
        if (!season) throw notFound("Season not found");
        if (!season.isActive || new Date(season.endsAt) <= new Date()) {
          throw badRequest("Season is no longer active", "SEASON_ENDED");
        }

        // 2. Check recipient doesn't already have paid pass
        const [existingPass] = await tx
          .select({ isPaid: schema.userSeasonPasses.isPaid })
          .from(schema.userSeasonPasses)
          .where(and(eq(schema.userSeasonPasses.userId, recipientUserId), eq(schema.userSeasonPasses.seasonId, seasonId)));
        if (existingPass?.isPaid) {
          throw conflict(
            "This user already owns the paid pass for this season",
            "PASS_ALREADY_OWNED"
          );
        }

        // 3. Debit coins from sender atomically.
        // SYS-CL-07: scope the reference per sender+recipient so gifting passes for
        // the same season to different recipients doesn't collide.
        await debitCoins(
          senderId,
          season.passPriceCoins,
          "season_pass_gift",
          `season_pass_gift:${seasonId}:${senderId}:${recipientUserId}`,
          `Gifted Season Pass (${season.name}) to @${recipient.username}`,
          { recipientUserId, seasonId },
          tx
        );

        // 4. Upsert paid pass for recipient
        const [pass] = await tx
          .insert(schema.userSeasonPasses)
          .values({ userId: recipientUserId, seasonId, isPaid: true, seasonXp: BigInt(0), purchasedAt: new Date() })
          .onConflictDoUpdate({
            target: [schema.userSeasonPasses.userId, schema.userSeasonPasses.seasonId],
            set: { isPaid: true, purchasedAt: new Date(), updatedAt: new Date() },
          })
          .returning();

        // 5. Award Generosity Track XP to sender via the canonical safeAwardXP
        // path (writes xp_ledger with the required base_amount + updates the
        // user's track XP and leaderboard snapshots in one place).
        await safeAwardXP(
          senderId,
          GENEROSITY_XP_FOR_PASS_GIFT,
          "generosity",
          "season_pass_gift",
          `season_pass_gift:${seasonId}:${senderId}:${recipientUserId}`,
          tx
        ).catch(() => {});

        // 6. Notify recipient
        const [sender] = await tx
          .select({ username: schema.users.username })
          .from(schema.users)
          .where(eq(schema.users.id, senderId))
          .limit(1);
        const senderUsername = sender?.username ?? "Someone";

        await insertNotification(
          tx,
          recipientUserId,
          "season_pass_gifted",
          "Season Pass Gifted",
          `@${senderUsername} gifted you the paid Season Pass for ${season.name}!`,
          {
            seasonId,
            seasonName: season.name,
            fromUserId: senderId,
            fromUsername: senderUsername,
          }
        ).catch(() => {});

        return {
          pass: {
            id: pass.id,
            user_id: pass.userId,
            season_id: pass.seasonId,
            is_paid: pass.isPaid,
            season_xp: Number(pass.seasonXp),
            season_rank: pass.seasonRank,
            purchased_at: pass.purchasedAt,
            created_at: pass.createdAt,
          },
          coinsSpent: season.passPriceCoins,
          xpAwarded: GENEROSITY_XP_FOR_PASS_GIFT,
          recipient: {
            id: recipient.id,
            username: recipient.username,
          },
        };
      });

      return NextResponse.json({ success: true, data: result, error: null }, { status: 201 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "INSUFFICIENT_BALANCE") {
        return handleApiError(
          badRequest(
            "Insufficient coins to gift this season pass.",
            "INSUFFICIENT_BALANCE"
          )
        );
      }
      return handleApiError(err);
    }
  }
);
