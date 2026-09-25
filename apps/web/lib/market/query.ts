/**
 * lib/market/query.ts
 *
 * Backend for the Market page. Two source tables feed it:
 *   - merch_products (creator-sold digital/physical items)
 *   - store_items + boost_types (platform-sold cosmetics/themes/boosts/credits)
 *
 * Sections (PRD "Market"):
 *   - sponsored: creator items the creator paid to promote (merch_products.is_sponsored,
 *     while sponsored_until is in the future).
 *   - featured: admin-curated creator items (is_admin_featured) + admin-curated
 *     platform items (store_items.is_featured).
 *   - trending: creator items, weighted-random rotation that favors items
 *     crossing the "trending" order-count threshold (fair discovery — every
 *     active item gets rotation, popular ones show up slightly more often).
 *   - platform: all active platform items (store_items + boost_types + the
 *     Season Pass), grouped for the grid.
 *
 * Sort by price/popularity/rating is only meaningful for creator items (no
 * rating concept exists for platform items, and "popularity" for a coin pack
 * isn't a useful signal) — the `sort` param is a no-op for platform-only
 * queries beyond price.
 */

import { getDb } from "@/lib/db/drizzle";
import { sql, type SQL } from "drizzle-orm";
import { getManifestValue } from "@/lib/manifest";
import type { MarketCategory, MarketItem, MarketSection, MarketSort } from "./types";

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

interface CreatorItemRow {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  product_type: string;
  price_kobo: string;
  is_sponsored: boolean;
  is_admin_featured: boolean;
  referral_enabled: boolean;
  referral_commission_pct: string | null;
  creator_id: string;
  creator_username: string | null;
  creator_display_name: string | null;
  avg_rating: string | null;
  rating_count: string;
  order_count: string;
}

interface PlatformItemRow {
  id: string;
  name: string;
  description: string | null;
  item_type: string;
  cosmetic_type: string | null;
  coins_cost: string | null;
  stars_cost: number | null;
  price_kobo: string | null;
  is_featured: boolean;
  sort_order: number;
}

interface BoostTypeRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  coins_cost: number | null;
  stars_cost: number | null;
  sort_order: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function koboToCoins(kobo: number): number {
  return Math.ceil(kobo / 100);
}

function creatorProductCategory(productType: string): MarketCategory {
  return productType === "physical" ? "physical" : "digital";
}

function platformItemCategory(itemType: string, cosmeticType: string | null): MarketCategory {
  if (itemType === "coin_pack" || itemType === "star_pack") return "credits";
  if (itemType === "cosmetic") {
    if (cosmeticType === "blog_theme" || cosmeticType === "profile_theme") return "cosmetics_themes";
    return "cosmetics_themes";
  }
  return "boosts_passes";
}

function mapCreatorRow(row: CreatorItemRow): MarketItem {
  return {
    id: row.id,
    kind: "creator",
    category: creatorProductCategory(row.product_type),
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    priceCoin: koboToCoins(parseInt(row.price_kobo, 10)),
    starsCost: null,
    creatorId: row.creator_id,
    creatorUsername: row.creator_username,
    creatorDisplayName: row.creator_display_name,
    rating: row.avg_rating ? Math.round(parseFloat(row.avg_rating) * 10) / 10 : null,
    ratingCount: parseInt(row.rating_count, 10) || 0,
    orderCount: parseInt(row.order_count, 10) || 0,
    isSponsored: row.is_sponsored,
    isAdminFeatured: row.is_admin_featured,
    referralEnabled: row.referral_enabled,
    referralCommissionPct: row.referral_commission_pct ? parseFloat(row.referral_commission_pct) : null,
    href: `/merch/${row.creator_id}`,
  };
}

function mapPlatformRow(row: PlatformItemRow): MarketItem {
  return {
    id: row.id,
    kind: "platform",
    category: platformItemCategory(row.item_type, row.cosmetic_type),
    name: row.name,
    description: row.description,
    imageUrl: null,
    priceCoin: row.coins_cost ? parseInt(row.coins_cost, 10) : null,
    starsCost: row.stars_cost,
    creatorId: null,
    creatorUsername: null,
    creatorDisplayName: null,
    rating: null,
    ratingCount: 0,
    orderCount: 0,
    isSponsored: false,
    isAdminFeatured: row.is_featured,
    referralEnabled: false,
    referralCommissionPct: null,
    href: row.item_type === "coin_pack" || row.item_type === "star_pack" ? "/wallet" : "/wallet#store",
  };
}

function mapBoostRow(row: BoostTypeRow): MarketItem {
  return {
    id: row.key,
    kind: "platform",
    category: "boosts_passes",
    name: row.label,
    description: row.description,
    imageUrl: null,
    priceCoin: row.coins_cost,
    starsCost: row.stars_cost,
    creatorId: null,
    creatorUsername: null,
    creatorDisplayName: null,
    rating: null,
    ratingCount: 0,
    orderCount: 0,
    isSponsored: false,
    isAdminFeatured: false,
    referralEnabled: false,
    referralCommissionPct: null,
    href: "/wallet#boosts",
  };
}

const CREATOR_ITEM_SELECT = sql.raw(`
  SELECT mp.id, mp.name, mp.description, mp.image_url, mp.product_type,
         mp.price_kobo::TEXT AS price_kobo, mp.is_sponsored, mp.is_admin_featured,
         mp.referral_enabled, mp.referral_commission_pct::TEXT AS referral_commission_pct,
         ms.creator_id, u.username AS creator_username, u.display_name AS creator_display_name,
         r.avg_rating::TEXT AS avg_rating, COALESCE(r.rating_count, 0)::TEXT AS rating_count,
         COALESCE(o.order_count, 0)::TEXT AS order_count
  FROM merch_products mp
  JOIN merch_stores ms ON ms.id = mp.store_id AND ms.is_active = TRUE
  JOIN users u ON u.id = ms.creator_id AND u.deleted_at IS NULL
  LEFT JOIN (
    SELECT product_id, AVG(rating) AS avg_rating, COUNT(*) AS rating_count
    FROM merch_product_reviews GROUP BY product_id
  ) r ON r.product_id = mp.id
  LEFT JOIN (
    SELECT product_id, COUNT(*) AS order_count
    FROM merch_orders WHERE status = 'completed' GROUP BY product_id
  ) o ON o.product_id = mp.id
  WHERE mp.is_active = TRUE
`);

const SORT_SQL: Record<MarketSort, SQL> = {
  price: sql.raw("mp.price_kobo ASC"),
  popularity: sql.raw("COALESCE(o.order_count, 0) DESC"),
  rating: sql.raw("COALESCE(r.avg_rating, 0) DESC"),
};

// ---------------------------------------------------------------------------
// Section queries
// ---------------------------------------------------------------------------

export interface MarketSectionOptions {
  category?: MarketCategory;
  sort?: MarketSort;
  limit?: number;
  offset?: number;
}

async function queryCreatorItems(
  whereExtra: SQL,
  opts: MarketSectionOptions,
  orderOverride?: SQL
): Promise<MarketItem[]> {
  if (opts.category && opts.category !== "digital" && opts.category !== "physical") {
    return []; // creator items are only digital/physical
  }
  let categoryClause: SQL = sql``;
  if (opts.category === "physical") {
    categoryClause = sql`AND mp.product_type = 'physical'`;
  } else if (opts.category === "digital") {
    categoryClause = sql`AND mp.product_type IN ('digital', 'course_material')`;
  }

  const order = orderOverride ?? SORT_SQL[opts.sort ?? "popularity"];
  const limit = Math.min(opts.limit ?? 12, 60);
  const offset = opts.offset ?? 0;

  const orm = await getDb();
  const { rows } = await orm.execute<CreatorItemRow & Record<string, unknown>>(sql`
    ${CREATOR_ITEM_SELECT} ${whereExtra} ${categoryClause} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}
  `);
  return rows.map(mapCreatorRow);
}

/** Sponsored (paid promotion) creator items — deterministic order, most-recently-boosted first. */
export async function getSponsoredItems(opts: MarketSectionOptions = {}): Promise<MarketItem[]> {
  return queryCreatorItems(
    sql`AND mp.is_sponsored = TRUE AND (mp.sponsored_until IS NULL OR mp.sponsored_until > NOW())`,
    opts,
    sql.raw("mp.updated_at DESC")
  );
}

/** Admin-curated creator items. */
export async function getAdminFeaturedCreatorItems(opts: MarketSectionOptions = {}): Promise<MarketItem[]> {
  return queryCreatorItems(sql`AND mp.is_admin_featured = TRUE`, opts, sql.raw("mp.updated_at DESC"));
}

/**
 * Trending/random creator items — fair rotation weighted so items crossing
 * the trending threshold (market_trending_min_orders) show up
 * market_trending_boost_weight times more often, but every active item still
 * gets a chance (SQL random() over the full set, weighted).
 */
export async function getTrendingItems(opts: MarketSectionOptions = {}): Promise<MarketItem[]> {
  const [minOrdersStr, weightStr] = await Promise.all([
    getManifestValue("market_trending_min_orders"),
    getManifestValue("market_trending_boost_weight"),
  ]);
  const minOrders = minOrdersStr ? parseInt(minOrdersStr, 10) : 5;
  const weight = weightStr ? parseFloat(weightStr) : 2.0;

  return queryCreatorItems(
    sql``,
    opts,
    sql`(random() * (CASE WHEN COALESCE(o.order_count, 0) >= ${minOrders} THEN ${weight}::numeric ELSE 1 END)) DESC`
  );
}

/** All active platform items (store_items cosmetics/credits) + boost catalog + Season Pass, for the grid section. */
export async function getPlatformItems(opts: MarketSectionOptions = {}): Promise<MarketItem[]> {
  const limit = Math.min(opts.limit ?? 18, 60);
  const offset = opts.offset ?? 0;

  if (opts.category === "digital" || opts.category === "physical") return [];

  const items: MarketItem[] = [];

  const orm = await getDb();

  if (!opts.category || opts.category === "credits" || opts.category === "cosmetics_themes") {
    const itemTypeFilter = sql.raw(
      opts.category === "credits"
        ? `item_type IN ('coin_pack', 'star_pack')`
        : opts.category === "cosmetics_themes"
        ? `item_type = 'cosmetic'`
        : `item_type IN ('coin_pack', 'star_pack', 'cosmetic')`
    );
    const { rows } = await orm.execute<PlatformItemRow & Record<string, unknown>>(sql`
      SELECT id, name, description, item_type, cosmetic_type,
              coins_cost::TEXT AS coins_cost, stars_cost, price_kobo::TEXT AS price_kobo,
              is_featured, sort_order
       FROM store_items
       WHERE is_active = TRUE AND (valid_until IS NULL OR valid_until > NOW()) AND ${itemTypeFilter}
       ORDER BY is_featured DESC, sort_order ASC, price_kobo ASC NULLS LAST
       LIMIT ${limit} OFFSET ${offset}
    `);
    items.push(...rows.map(mapPlatformRow));
  }

  if (!opts.category || opts.category === "boosts_passes") {
    const { rows } = await orm.execute<BoostTypeRow & Record<string, unknown>>(sql`
      SELECT id, key, label, description, coins_cost, stars_cost, sort_order
       FROM boost_types WHERE is_active = TRUE ORDER BY sort_order ASC LIMIT ${limit}
    `);
    items.push(...rows.map(mapBoostRow));
  }

  return items.slice(0, limit);
}

/** Admin-featured platform items only (used by the "Featured" section alongside admin-featured creator items). */
export async function getAdminFeaturedPlatformItems(limit = 6): Promise<MarketItem[]> {
  const orm = await getDb();
  const { rows } = await orm.execute<PlatformItemRow & Record<string, unknown>>(sql`
    SELECT id, name, description, item_type, cosmetic_type,
            coins_cost::TEXT AS coins_cost, stars_cost, price_kobo::TEXT AS price_kobo,
            is_featured, sort_order
     FROM store_items
     WHERE is_active = TRUE AND is_featured = TRUE AND (valid_until IS NULL OR valid_until > NOW())
     ORDER BY sort_order ASC LIMIT ${limit}
  `);
  return rows.map(mapPlatformRow);
}

// ---------------------------------------------------------------------------
// Home assembly
// ---------------------------------------------------------------------------

export interface MarketHome {
  sponsored: MarketItem[];
  featured: MarketItem[];
  trending: MarketItem[];
  platform: MarketItem[];
}

/** Assembles the Market home page: capped sections, each with a "view more" section param. */
export async function getMarketHome(): Promise<MarketHome> {
  const [sponsored, featuredCreator, featuredPlatform, trending, platform] = await Promise.all([
    getSponsoredItems({ limit: 6 }),
    getAdminFeaturedCreatorItems({ limit: 4 }),
    getAdminFeaturedPlatformItems(4),
    getTrendingItems({ limit: 6 }),
    getPlatformItems({ limit: 9 }),
  ]);

  return {
    sponsored,
    featured: [...featuredCreator, ...featuredPlatform].slice(0, 6),
    trending,
    platform,
  };
}

export async function getMarketSection(section: MarketSection, opts: MarketSectionOptions): Promise<MarketItem[]> {
  switch (section) {
    case "sponsored":
      return getSponsoredItems(opts);
    case "featured": {
      const [creatorItems, platformItems] = await Promise.all([
        getAdminFeaturedCreatorItems(opts),
        opts.category && opts.category !== "cosmetics_themes" && opts.category !== "credits" && opts.category !== "boosts_passes"
          ? Promise.resolve([])
          : getAdminFeaturedPlatformItems(opts.limit ?? 24),
      ]);
      return [...creatorItems, ...platformItems];
    }
    case "trending":
      return getTrendingItems(opts);
    case "platform":
      return getPlatformItems(opts);
    default:
      return [];
  }
}
