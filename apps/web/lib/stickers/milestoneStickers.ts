/**
 * lib/stickers/milestoneStickers.ts
 *
 * Earnable Sticker Pack grants from Track Milestone Unlocks.
 *
 * PRD §5: "Earnable packs (unlocked through progression milestones)."
 *
 * When a user reaches a defined track milestone, this module grants them
 * the corresponding sticker pack automatically.
 */

import type { DatabaseAdapter } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MilestonePackGrant {
  unlockKey: string;
  packName: string;
  packDescription: string;
  stickerCount: number;
}

// ---------------------------------------------------------------------------
// Grants catalogue
// ---------------------------------------------------------------------------

/**
 * Maps each track milestone unlock key to an earnable sticker pack.
 * Unlock keys match those defined in lib/xp/trackMilestones.ts.
 */
export const MILESTONE_STICKER_GRANTS: MilestonePackGrant[] = [
  {
    // Social L5 — matches trackMilestones.ts key
    unlockKey: "social_custom_conversation_badges",
    packName: "Talker Pack",
    packDescription: "Exclusive stickers for active chatters",
    stickerCount: 8,
  },
  {
    // Social L25
    unlockKey: "social_group_chat_500",
    packName: "Connector Pack",
    packDescription: "Deep connection expression stickers",
    stickerCount: 10,
  },
  {
    // Creator L5
    unlockKey: "creator_rooms_100",
    packName: "Creator Pack",
    packDescription: "Room host reaction stickers",
    stickerCount: 8,
  },
  {
    // Generosity L10
    unlockKey: "generosity_top_gifter_prominent",
    packName: "Patron Pack",
    packDescription: "Big spender flex stickers",
    stickerCount: 8,
  },
  {
    // Knowledge L25 — key corrected to match trackMilestones.ts
    unlockKey: "knowledge_cohost_classrooms",
    packName: "Scholar Pack",
    packDescription: "Learning and wisdom stickers",
    stickerCount: 10,
  },
  {
    // Explorer L10 — key corrected to match trackMilestones.ts
    unlockKey: "explorer_pin_limit_5",
    packName: "Wanderer Pack",
    packDescription: "Adventure and discovery stickers",
    stickerCount: 8,
  },
  {
    // Competitor L15 — key corrected to match trackMilestones.ts
    unlockKey: "competitor_nemesis_system",
    packName: "Fighter Pack",
    packDescription: "Competitive rivalry stickers",
    stickerCount: 8,
  },
];

// ---------------------------------------------------------------------------
// Grant function
// ---------------------------------------------------------------------------

/**
 * Awards any sticker packs earned by a newly-reached milestone unlock.
 *
 * Called by the XP award flow after `checkAndAwardTrackMilestones` returns
 * newly unlocked milestones.
 *
 * @param userId    - The user to award packs to
 * @param unlockKey - The milestone unlock key just granted
 * @param db        - Active database adapter
 * @returns Names of packs awarded (empty array if none matched or already owned)
 */
export async function awardMilestoneStickers(
  userId: string,
  unlockKey: string,
  db: DatabaseAdapter
): Promise<string[]> {
  const grant = MILESTONE_STICKER_GRANTS.find((g) => g.unlockKey === unlockKey);
  if (!grant) return [];

  const awarded: string[] = [];

  try {
    // Check whether the user already owns a pack with this name
    const { rows: existing } = await db.query<{ id: string }>(
      `SELECT sp.id
       FROM user_sticker_packs usp
       JOIN sticker_packs sp ON sp.id = usp.sticker_pack_id
       WHERE usp.user_id = $1 AND sp.name = $2
       LIMIT 1`,
      [userId, grant.packName]
    );

    if (existing.length > 0) return []; // already owned

    // Find or create the sticker pack
    let packId: string;
    const { rows: packRows } = await db.query<{ id: string }>(
      "SELECT id FROM sticker_packs WHERE name = $1 LIMIT 1",
      [grant.packName]
    );

    if (packRows.length > 0) {
      packId = packRows[0].id;
    } else {
      const { rows: newPack } = await db.query<{ id: string }>(
        `INSERT INTO sticker_packs
           (name, description, pack_type, sticker_count, is_earnable, price_coins)
         VALUES ($1, $2, 'earnable', $3, TRUE, 0)
         ON CONFLICT (name) DO NOTHING
         RETURNING id`,
        [grant.packName, grant.packDescription, grant.stickerCount]
      );
      if (!newPack[0]) return []; // race condition — skip
      packId = newPack[0].id;
    }

    // Grant the pack to the user
    await db.query(
      `INSERT INTO user_sticker_packs (user_id, sticker_pack_id, acquired_via)
       VALUES ($1, $2, 'milestone')
       ON CONFLICT DO NOTHING`,
      [userId, packId]
    );

    awarded.push(grant.packName);
  } catch (err) {
    // Non-fatal — log and continue
    console.error("[milestoneStickers] Failed to award pack", { userId, unlockKey, err });
  }

  return awarded;
}
