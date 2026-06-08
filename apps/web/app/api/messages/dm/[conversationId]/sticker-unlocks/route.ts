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
import { db } from "@/lib/db";
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
    const { rows: convRows } = await db.query<{
      user_id_1: string;
      user_id_2: string;
    }>(
      `SELECT user_id_1, user_id_2
       FROM dm_conversations
       WHERE id = $1
       LIMIT 1`,
      [conversationId]
    );

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
    const { rows: unlockRows } = await db.query<{
      pack_name: string;
      unlocked_at: string;
    }>(
      `SELECT pack_name, unlocked_at
       FROM dm_score_sticker_unlocks
       WHERE (user_id_1 = $1 AND user_id_2 = $2)
          OR (user_id_1 = $2 AND user_id_2 = $1)`,
      [conv.user_id_1, conv.user_id_2]
    );

    const persistedUnlocks = new Map(
      unlockRows.map((r) => [r.pack_name, r.unlocked_at])
    );

    const unlocks: StickerUnlock[] = SCORE_UNLOCKS.map((su) => {
      const isUnlocked = score.score >= su.threshold;
      const unlockedAt = persistedUnlocks.get(su.packName) ?? null;
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
