/**
 * lib/economy/giftItems.ts
 *
 * Shared create-gift-item logic for the sitewide Gifts economy catalog.
 * Used by POST /api/admin/gifts (standalone gift creation) and
 * POST /api/admin/gift-drop (inline "create a new gift for this drop"),
 * so both routes insert `gift_items` rows the same way instead of
 * duplicating the INSERT.
 */

import type { DatabaseAdapter } from "@/lib/db/interface";

export interface CreateGiftItemInput {
  name: string;
  emoji: string;
  coinCost: number;
  tier: number;
  animationUrl?: string | null;
  spectacleThresholdCoins?: number | null;
}

export interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinCost: number;
  tier: number;
  animationUrl: string | null;
  spectacleThresholdCoins: number | null;
  isActive: boolean;
  createdAt: string;
}

interface GiftItemInsertRow {
  id: string;
  name: string;
  emoji: string;
  coin_cost: number;
  tier: number;
  animation_url: string | null;
  spectacle_threshold_coins: number | null;
  is_active: boolean;
  created_at: string;
}

/**
 * Insert a new gift_items row. Caller is responsible for validating `input`
 * (e.g. via createGiftSchema in app/api/admin/gifts/route.ts) before calling.
 */
export async function createGiftItem(
  input: CreateGiftItemInput,
  db: DatabaseAdapter
): Promise<GiftItem> {
  const { rows } = await db.query<GiftItemInsertRow>(
    `INSERT INTO gift_items (name, emoji, coin_cost, tier, animation_url, spectacle_threshold_coins, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE)
     RETURNING id, name, emoji, coin_cost, tier, animation_url, spectacle_threshold_coins, is_active, created_at`,
    [
      input.name,
      input.emoji,
      input.coinCost,
      input.tier,
      input.animationUrl ?? null,
      input.spectacleThresholdCoins ?? null,
    ]
  );

  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji,
    coinCost: row.coin_cost,
    tier: row.tier,
    animationUrl: row.animation_url,
    spectacleThresholdCoins: row.spectacle_threshold_coins,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}
