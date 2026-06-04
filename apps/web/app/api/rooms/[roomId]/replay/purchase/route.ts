/**
 * app/api/rooms/[roomId]/replay/purchase/route.ts
 *
 * POST /api/rooms/:roomId/replay/purchase
 *
 * Purchases access to a paid Drop Room replay.
 * Deducts the replay fee in coins from the user's balance and records
 * a coin_ledger entry with transaction_type = 'replay_access'.
 * Idempotent — purchasing a replay the user already owns is a no-op.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

export const POST = withAuth(
  async (
    _req: NextRequest,
    { params, auth }: { params: { roomId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

      const { roomId } = params;
      const userId = auth.user.sub;

      // Fetch replay
      const { rows: replayRows } = await db.query<{
        id: string;
        creator_id: string;
        title: string;
        replay_fee_kobo: string;
        is_published: boolean;
      }>(
        `SELECT id, creator_id, title, replay_fee_kobo::TEXT, is_published
         FROM drop_room_replays
         WHERE room_id = $1 LIMIT 1`,
        [roomId]
      );

      const replay = replayRows[0];
      if (!replay) throw notFound("Replay not found for this room");
      if (!replay.is_published) throw notFound("Replay is not yet published");

      const replayFeeKobo = parseInt(replay.replay_fee_kobo, 10);
      const isFree = replayFeeKobo <= 0;

      // Creator always has access
      if (replay.creator_id === userId || isFree) {
        return NextResponse.json({ success: true, alreadyOwned: true }, { status: 200 });
      }

      const replayFeeCoins = Math.ceil(replayFeeKobo / 100);

      // Idempotency: check if already paid
      const { rows: accessRows } = await db.query<{ id: string }>(
        `SELECT id FROM coin_ledger
         WHERE user_id = $1
           AND reference_id = $2
           AND transaction_type = 'replay_access'
         LIMIT 1`,
        [userId, replay.id]
      );

      if (accessRows[0]) {
        return NextResponse.json({ success: true, alreadyOwned: true }, { status: 200 });
      }

      // Deduct coins in transaction
      await db.transaction(async (tx) => {
        const { rows: userRows } = await tx.query<{ coin_balance: number }>(
          `SELECT coin_balance FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
          [userId]
        );
        if (!userRows[0]) throw notFound("User not found");

        const { coin_balance } = userRows[0];
        if (coin_balance < replayFeeCoins) {
          throw forbidden(
            `Insufficient coins. Replay access costs ${replayFeeCoins} coins.`
          );
        }

        const newBalance = coin_balance - replayFeeCoins;

        await tx.query(
          `UPDATE users SET coin_balance = $1, updated_at = NOW() WHERE id = $2`,
          [newBalance, userId]
        );

        await tx.query(
          `INSERT INTO coin_ledger
             (user_id, amount, balance_before, balance_after, transaction_type, description, reference_id, created_at)
           VALUES ($1, $2, $3, $4, 'replay_access', $5, $6, NOW())`,
          [
            userId,
            -replayFeeCoins,
            coin_balance,
            newBalance,
            `Replay access: ${replay.title}`,
            replay.id,
          ]
        );
      });

      return NextResponse.json(
        { success: true, coinsDeducted: replayFeeCoins },
        { status: 200 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);
