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
 * - Grants paid pass to recipient (upsert season_passes with is_paid=true)
 * - Awards XP to sender (Generosity Track)
 * - Sends notification to recipient
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound, conflict } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { debitCoins } from "@/lib/economy/coins";

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
// Row types
// ---------------------------------------------------------------------------

interface SeasonRow {
  id: string;
  name: string;
  is_active: boolean;
  pass_price_coins: number;
  ends_at: string;
}

interface SeasonPassRow {
  id: string;
  user_id: string;
  season_id: string;
  is_paid: boolean;
  season_xp: number;
  season_rank: number | null;
  purchased_at: string | null;
  created_at: string;
}

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

      // Verify recipient exists and is active
      const { rows: recipientRows } = await db.query<{
        id: string;
        username: string;
        display_name: string | null;
      }>(
        `SELECT id, username, display_name
         FROM users
         WHERE id = $1 AND deleted_at IS NULL
         LIMIT 1`,
        [recipientUserId]
      );

      if (!recipientRows[0]) throw notFound("Recipient not found");
      const recipient = recipientRows[0];

      const result = await db.transaction(async (tx) => {
        // 1. Lock and verify season
        const { rows: seasonRows } = await tx.query<SeasonRow>(
          `SELECT id, name, is_active, pass_price_coins, ends_at
           FROM seasons WHERE id = $1 FOR UPDATE`,
          [seasonId]
        );
        const season = seasonRows[0];
        if (!season) throw notFound("Season not found");
        if (!season.is_active || new Date(season.ends_at) <= new Date()) {
          throw badRequest("Season is no longer active", "SEASON_ENDED");
        }

        // 2. Check recipient doesn't already have paid pass
        const { rows: existingPass } = await tx.query<{ is_paid: boolean }>(
          `SELECT is_paid FROM user_season_passes WHERE user_id = $1 AND season_id = $2`,
          [recipientUserId, seasonId]
        );
        if (existingPass[0]?.is_paid) {
          throw conflict(
            "This user already owns the paid pass for this season",
            "PASS_ALREADY_OWNED"
          );
        }

        // 3. Debit coins from sender atomically
        await debitCoins(
          senderId,
          season.pass_price_coins,
          "season_pass_gift",
          seasonId,
          `Gifted Season Pass (${season.name}) to @${recipient.username}`,
          { recipientUserId, seasonId },
          tx
        );

        // 4. Upsert paid pass for recipient
        const { rows: passRows } = await tx.query<SeasonPassRow>(
          `INSERT INTO user_season_passes
             (user_id, season_id, is_paid, season_xp, purchased_at, created_at)
           VALUES ($1, $2, TRUE, 0, NOW(), NOW())
           ON CONFLICT (user_id, season_id) DO UPDATE
             SET is_paid = TRUE, purchased_at = NOW(), updated_at = NOW()
           RETURNING id, user_id, season_id, is_paid, season_xp, season_rank, purchased_at, created_at`,
          [recipientUserId, seasonId]
        );

        // 5. Award Generosity Track XP to sender
        await tx.query(
          `UPDATE users
           SET xp_total = xp_total + $1,
               xp_generosity = COALESCE(xp_generosity, 0) + $1,
               updated_at = NOW()
           WHERE id = $2`,
          [GENEROSITY_XP_FOR_PASS_GIFT, senderId]
        ).catch(() => {});

        await tx.query(
          `INSERT INTO xp_ledger
             (user_id, action, xp_amount, multiplier, xp_net, metadata, created_at)
           VALUES ($1, 'season_pass_gift', $2, 1.0, $2, $3, NOW())`,
          [
            senderId,
            GENEROSITY_XP_FOR_PASS_GIFT,
            JSON.stringify({ recipientUserId, seasonId }),
          ]
        ).catch(() => {});

        // 6. Notify recipient
        const { rows: senderRows } = await tx.query<{ username: string }>(
          `SELECT username FROM users WHERE id = $1 LIMIT 1`,
          [senderId]
        );
        const senderUsername = senderRows[0]?.username ?? "Someone";

        await tx.query(
          `INSERT INTO notifications (user_id, type, payload, is_read, created_at)
           VALUES ($1, 'season_pass_gifted', $2, false, NOW())`,
          [
            recipientUserId,
            JSON.stringify({
              seasonId,
              seasonName: season.name,
              fromUserId: senderId,
              fromUsername: senderUsername,
              message: `@${senderUsername} gifted you the paid Season Pass for ${season.name}!`,
            }),
          ]
        ).catch(() => {});

        return {
          pass: passRows[0],
          coinsSpent: season.pass_price_coins,
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
