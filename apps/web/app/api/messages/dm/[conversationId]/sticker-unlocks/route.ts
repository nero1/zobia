export const dynamic = 'force-dynamic';

/**
 * app/api/messages/dm/[conversationId]/sticker-unlocks/route.ts
 *
 * GET /api/messages/dm/[conversationId]/sticker-unlocks
 *
 * Returns exclusive sticker reaction packs unlocked for this DM conversation
 * based on the conversation score thresholds.
 *
 * Unlock thresholds (PRD §5):
 *   Score ≥ 100  → "Exclusive Reactions Pack 1" unlocked
 *   Score ≥ 250  → "Exclusive Reactions Pack 2" unlocked
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, forbidden } from "@/lib/api/errors";
import { getConversationScore } from "@/lib/messaging/conversationScore";

interface StickerUnlock {
  packName: string;
  packDescription: string;
  threshold: number;
  unlocked: boolean;
  unlockedAt: string | null;
}

const SCORE_UNLOCKS: { threshold: number; packName: string; packDescription: string }[] = [
  {
    threshold: 100,
    packName: "Exclusive Reactions Pack 1",
    packDescription: "Special reactions only for long-running DM conversations",
  },
  {
    threshold: 250,
    packName: "Exclusive Reactions Pack 2",
    packDescription: "Rare reactions for your closest connections",
  },
];

export const GET = withAuth(async (
  req: NextRequest,
  { params, auth }: { params: { conversationId: string }; auth: { user: { sub: string } } }
) => {
  try {
    const conversationId = (await params).conversationId;
    const userId = auth.user.sub;

    // Verify user is a participant in this conversation
    const orm = await getDb();
    const convRows = await orm
      .select({
        user_id_1: schema.dmConversations.userId1,
        user_id_2: schema.dmConversations.userId2,
      })
      .from(schema.dmConversations)
      .where(eq(schema.dmConversations.id, conversationId))
      .limit(1);

    if (convRows.length === 0) {
      return NextResponse.json({ success: true, data: [], error: null });
    }

    const conv = convRows[0];
    if (conv.user_id_1 !== userId && conv.user_id_2 !== userId) {
      throw forbidden("Not a participant in this conversation");
    }

    const otherId =
      conv.user_id_1 === userId ? conv.user_id_2 : conv.user_id_1;

    const score = await getConversationScore(userId, otherId);

    // Fetch persisted unlock timestamps from dm_score_sticker_unlocks
    const unlockRows = await orm
      .select({
        pack_name: schema.dmScoreStickerUnlocks.packName,
        unlocked_at: schema.dmScoreStickerUnlocks.unlockedAt,
      })
      .from(schema.dmScoreStickerUnlocks)
      .where(
        or(
          and(eq(schema.dmScoreStickerUnlocks.userId1, conv.user_id_1), eq(schema.dmScoreStickerUnlocks.userId2, conv.user_id_2)),
          and(eq(schema.dmScoreStickerUnlocks.userId1, conv.user_id_2), eq(schema.dmScoreStickerUnlocks.userId2, conv.user_id_1))
        )
      );

    const persistedUnlocks = new Map(
      unlockRows.map((r) => [r.pack_name, r.unlocked_at])
    );

    const unlocks: StickerUnlock[] = SCORE_UNLOCKS.map((su) => {
      const isUnlocked = score.score >= su.threshold;
      const unlockedAtDate = persistedUnlocks.get(su.packName) ?? null;
      const unlockedAt = unlockedAtDate ? unlockedAtDate.toISOString() : null;
      return {
        packName: su.packName,
        packDescription: su.packDescription,
        threshold: su.threshold,
        unlocked: isUnlocked,
        unlockedAt: isUnlocked ? (unlockedAt ?? new Date().toISOString()) : null,
      };
    });

    return NextResponse.json({ success: true, data: unlocks, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
