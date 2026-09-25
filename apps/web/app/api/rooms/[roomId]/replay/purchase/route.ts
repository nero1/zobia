export const dynamic = 'force-dynamic';

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
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
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
      const orm = await getDb();

      // Fetch replay
      const [replay] = await orm
        .select({
          id: schema.dropRoomReplays.id,
          creator_id: schema.dropRoomReplays.creatorId,
          title: schema.dropRoomReplays.title,
          replay_fee_kobo: schema.dropRoomReplays.replayFeeKobo,
          is_published: schema.dropRoomReplays.isPublished,
        })
        .from(schema.dropRoomReplays)
        .where(eq(schema.dropRoomReplays.roomId, roomId))
        .limit(1);

      if (!replay) throw notFound("Replay not found for this room");
      if (!replay.is_published) throw notFound("Replay is not yet published");

      const replayFeeKobo = Number(replay.replay_fee_kobo);
      const isFree = replayFeeKobo <= 0;

      // Creator always has access
      if (replay.creator_id === userId || isFree) {
        return NextResponse.json({ success: true, alreadyOwned: true }, { status: 200 });
      }

      const replayFeeCoins = Math.ceil(replayFeeKobo / 100);

      // Idempotency: check if already paid
      const [access] = await orm
        .select({ id: schema.coinLedger.id })
        .from(schema.coinLedger)
        .where(
          and(
            eq(schema.coinLedger.userId, userId),
            eq(schema.coinLedger.referenceId, replay.id),
            eq(schema.coinLedger.transactionType, "replay_access")
          )
        )
        .limit(1);

      if (access) {
        return NextResponse.json({ success: true, alreadyOwned: true }, { status: 200 });
      }

      // Deduct coins in transaction
      await orm.transaction(async (tx) => {
        const [userRow] = await tx
          .select({ coin_balance: schema.users.coinBalance })
          .from(schema.users)
          .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
          .for("update");
        if (!userRow) throw notFound("User not found");

        const coin_balance = Number(userRow.coin_balance);
        if (coin_balance < replayFeeCoins) {
          throw forbidden(
            `Insufficient coins. Replay access costs ${replayFeeCoins} coins.`
          );
        }

        const newBalance = coin_balance - replayFeeCoins;

        await tx
          .update(schema.users)
          .set({ coinBalance: BigInt(newBalance), updatedAt: new Date() })
          .where(eq(schema.users.id, userId));

        await tx.insert(schema.coinLedger).values({
          userId,
          amount: BigInt(-replayFeeCoins),
          balanceBefore: BigInt(coin_balance),
          balanceAfter: BigInt(newBalance),
          transactionType: "replay_access",
          description: `Replay access: ${replay.title}`,
          referenceId: replay.id,
        });
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
