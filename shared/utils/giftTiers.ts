/**
 * shared/utils/giftTiers.ts
 *
 * The sitewide Gifts economy (send a gift to another user or a room owner
 * using coins/credits) supports 5 gift tiers. This label map is the single
 * source of truth so the admin gift catalog UI and the public gift
 * catalogue API stay in sync instead of duplicating the copy.
 */

export const GIFT_TIER_LABELS: Record<number, string> = {
  1: "Friendly",
  2: "Warm",
  3: "Grand",
  4: "Epic",
  5: "Legendary",
};

export const GIFT_TIER_MIN = 1;
export const GIFT_TIER_MAX = 5;
