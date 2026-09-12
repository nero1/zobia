/**
 * lib/market/types.ts
 *
 * Shared shape for the Market page — normalizes creator-sold items
 * (merch_products) and platform-sold items (store_items + the boost_types
 * catalog + the Season Pass) into one card shape the UI renders identically.
 */

export type MarketCategory =
  | "digital"
  | "physical"
  | "cosmetics_themes"
  | "boosts_passes"
  | "credits";

export type MarketSection = "sponsored" | "featured" | "trending" | "platform";
export type MarketSort = "price" | "popularity" | "rating";

export interface MarketItem {
  id: string;
  kind: "creator" | "platform";
  category: MarketCategory;
  name: string;
  description: string | null;
  imageUrl: string | null;
  /** Coin price — the primary currency almost everything on the Market is priced in. */
  priceCoin: number | null;
  starsCost: number | null;
  creatorId: string | null;
  creatorUsername: string | null;
  creatorDisplayName: string | null;
  /** 1-5, averaged from merch_product_reviews. Creator items only. */
  rating: number | null;
  ratingCount: number;
  /** Completed-order count — the popularity signal for creator items. */
  orderCount: number;
  isSponsored: boolean;
  isAdminFeatured: boolean;
  referralEnabled: boolean;
  referralCommissionPct: number | null;
  /** Where "Buy"/"View" navigates to. */
  href: string;
}
