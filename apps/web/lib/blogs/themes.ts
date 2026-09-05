/**
 * lib/blogs/themes.ts
 *
 * Blog theme engine (migration 0022). A theme is a `blog_themes` DB row
 * (admin-editable: enabled/gating/pricing) paired with a `layoutVariant` key
 * that a fixed, code-defined set of React components (components/blogs/
 * layouts/*) know how to render — see LAYOUT_VARIANTS below for the
 * legitimate set. The DB table is the source of truth for whether a theme
 * is currently offered and to whom; the layout components are the source of
 * truth for how it actually renders.
 *
 * Purchasing reuses the existing cosmetics ledger (`user_cosmetics`,
 * store_items) for themes that have a `store_item_id` — a theme's ownership
 * check is "does the caller own store_items row X", exactly like any other
 * cosmetic. Free-default and plan-included themes need no ownership row at
 * all; availability is computed from the caller's plan/business tier.
 */

import { db } from "@/lib/db";
import type { SqlParam, TransactionClient } from "@/lib/db/interface";
import { debitCoins } from "@/lib/economy/coins";
import { debitStars } from "@/lib/economy/stars";
import { badRequest, forbidden, notFound } from "@/lib/api/errors";
import type { Plan } from "@zobia/types";
import type { BusinessTier } from "@/lib/business/limits";

/** The only layout variants that have real, structurally-distinct React implementations. Adding a theme with any other value would fall back to 'classic' at render time. */
export const LAYOUT_VARIANTS = ["classic", "magazine", "minimal-cards", "sidebar-left"] as const;
export type LayoutVariant = (typeof LAYOUT_VARIANTS)[number];

export interface ThemeTokens {
  bg: string;
  card: string;
  accent: string;
  text: string;
  muted: string;
}

export interface BlogThemeRow {
  id: string;
  name: string;
  description: string | null;
  layout_variant: string;
  config: ThemeTokens;
  included_for_plans: string[];
  included_for_business_tiers: string[];
  is_free_default: boolean;
  store_item_id: string | null;
  credits_cost: number | null;
  stars_cost: number | null;
  enabled: boolean;
  sort_order: number;
}

function normalizeLayoutVariant(v: string): LayoutVariant {
  return (LAYOUT_VARIANTS as readonly string[]).includes(v) ? (v as LayoutVariant) : "classic";
}

export const DEFAULT_THEME_TOKENS: ThemeTokens = { bg: "#0a0a0a", card: "#171717", accent: "#14b8a6", text: "#fafafa", muted: "#a3a3a3" };
const DEFAULT_TOKENS = DEFAULT_THEME_TOKENS;

/** Defensively parse a theme's `config` jsonb, falling back to sane defaults for any missing/malformed field — mirrors lib/blogs/menu.ts's normalizeMenuConfig idiom. */
function normalizeThemeTokens(raw: unknown): ThemeTokens {
  if (!raw || typeof raw !== "object") return DEFAULT_TOKENS;
  const obj = raw as Partial<ThemeTokens>;
  return {
    bg: typeof obj.bg === "string" ? obj.bg : DEFAULT_TOKENS.bg,
    card: typeof obj.card === "string" ? obj.card : DEFAULT_TOKENS.card,
    accent: typeof obj.accent === "string" ? obj.accent : DEFAULT_TOKENS.accent,
    text: typeof obj.text === "string" ? obj.text : DEFAULT_TOKENS.text,
    muted: typeof obj.muted === "string" ? obj.muted : DEFAULT_TOKENS.muted,
  };
}

function hydrateThemeRow(row: BlogThemeRow): BlogThemeRow {
  return { ...row, config: normalizeThemeTokens(row.config) };
}

/** Full catalog (admin view — includes disabled rows). */
export async function listAllThemes(): Promise<BlogThemeRow[]> {
  const { rows } = await db.query<BlogThemeRow>(`SELECT * FROM blog_themes ORDER BY sort_order ASC, name ASC`);
  return rows.map(hydrateThemeRow);
}

/** Enabled-only catalog (owner-facing). */
export async function listEnabledThemes(): Promise<BlogThemeRow[]> {
  const { rows } = await db.query<BlogThemeRow>(`SELECT * FROM blog_themes WHERE enabled = TRUE ORDER BY sort_order ASC, name ASC`);
  return rows.map(hydrateThemeRow);
}

export async function getTheme(themeId: string): Promise<BlogThemeRow | null> {
  const { rows } = await db.query<BlogThemeRow>(`SELECT * FROM blog_themes WHERE id = $1 LIMIT 1`, [themeId]);
  return rows[0] ? hydrateThemeRow(rows[0]) : null;
}

export function resolveLayout(theme: Pick<BlogThemeRow, "layout_variant">): LayoutVariant {
  return normalizeLayoutVariant(theme.layout_variant);
}

export type ThemeAvailability = "free_default" | "plan_included" | "owned" | "purchasable" | "locked";

export interface ThemeWithAvailability extends BlogThemeRow {
  availability: ThemeAvailability;
  isActive: boolean;
}

/**
 * Which themes a given blog's owner can see/use, and at what status —
 * mirrors the plan-gating idiom in lib/blogs/limits.ts. `ownerPlan` and
 * `ownerBusinessTier` (null for a personal blog) decide plan-inclusion;
 * ownership of a purchasable theme is read from user_cosmetics via its
 * linked store_item_id, exactly like any other cosmetic.
 */
export async function getAvailableThemesForBlog(
  blogId: string,
  activeThemeId: string,
  ownerId: string,
  ownerPlan: string,
  ownerBusinessTier: string | null
): Promise<ThemeWithAvailability[]> {
  const themes = await listEnabledThemes();
  const storeItemIds = themes.map((t) => t.store_item_id).filter((id): id is string => !!id);

  const ownedSet = new Set<string>();
  if (storeItemIds.length > 0) {
    const { rows } = await db.query<{ store_item_id: string }>(
      `SELECT store_item_id FROM user_cosmetics WHERE user_id = $1 AND store_item_id = ANY($2::uuid[])`,
      [ownerId, storeItemIds]
    );
    rows.forEach((r) => ownedSet.add(r.store_item_id));
  }

  return themes.map((theme) => {
    let availability: ThemeAvailability;
    if (theme.is_free_default) {
      availability = "free_default";
    } else if ((theme.included_for_plans ?? []).includes(ownerPlan) || (ownerBusinessTier && (theme.included_for_business_tiers ?? []).includes(ownerBusinessTier))) {
      availability = "plan_included";
    } else if (theme.store_item_id && ownedSet.has(theme.store_item_id)) {
      availability = "owned";
    } else if (theme.store_item_id && (theme.credits_cost || theme.stars_cost)) {
      availability = "purchasable";
    } else {
      availability = "locked";
    }
    return { ...theme, availability, isActive: theme.id === activeThemeId };
  });
}

async function assertEntitled(themeId: string, blogId: string, ownerId: string, ownerPlan: string, ownerBusinessTier: string | null): Promise<BlogThemeRow> {
  const theme = await getTheme(themeId);
  if (!theme || !theme.enabled) throw notFound("Theme not found");

  if (theme.is_free_default) return theme;
  if ((theme.included_for_plans ?? []).includes(ownerPlan)) return theme;
  if (ownerBusinessTier && (theme.included_for_business_tiers ?? []).includes(ownerBusinessTier)) return theme;

  if (theme.store_item_id) {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM user_cosmetics WHERE user_id = $1 AND store_item_id = $2 LIMIT 1`, [ownerId, theme.store_item_id]);
    if (rows[0]) return theme;
  }

  throw forbidden("You don't own this theme yet.", "BLOG_THEME_NOT_OWNED");
}

/** Sets `blogs.active_theme_id`, after verifying the caller is entitled to the theme (free/plan-included/already-purchased). */
export async function equipTheme(blogId: string, ownerId: string, ownerPlan: string, ownerBusinessTier: string | null, themeId: string): Promise<void> {
  const theme = await assertEntitled(themeId, blogId, ownerId, ownerPlan, ownerBusinessTier);
  await db.query(`UPDATE blogs SET active_theme_id = $2, updated_at = NOW() WHERE id = $1`, [blogId, theme.id]);
}

/**
 * Purchases a theme (Credits or Stars) via the same ledger the generic
 * cosmetics store uses, then equips it. No-op charge (still equips) if the
 * caller already owns it or it's free/plan-included — mirrors the
 * idempotent-purchase behavior of POST /api/economy/cosmetics.
 */
export async function purchaseAndEquipTheme(
  blogId: string,
  ownerId: string,
  ownerPlan: string,
  ownerBusinessTier: string | null,
  themeId: string,
  currency: "credits" | "stars"
): Promise<{ alreadyOwned: boolean }> {
  const theme = await getTheme(themeId);
  if (!theme || !theme.enabled) throw notFound("Theme not found");

  if (theme.is_free_default || (theme.included_for_plans ?? []).includes(ownerPlan) || (ownerBusinessTier && (theme.included_for_business_tiers ?? []).includes(ownerBusinessTier))) {
    await equipTheme(blogId, ownerId, ownerPlan, ownerBusinessTier, themeId);
    return { alreadyOwned: true };
  }

  if (!theme.store_item_id) throw badRequest("This theme is not purchasable.", "BLOG_THEME_NOT_PURCHASABLE");

  const { rows: existingRows } = await db.query<{ id: string }>(`SELECT id FROM user_cosmetics WHERE user_id = $1 AND store_item_id = $2 LIMIT 1`, [ownerId, theme.store_item_id]);
  if (existingRows[0]) {
    await equipTheme(blogId, ownerId, ownerPlan, ownerBusinessTier, themeId);
    return { alreadyOwned: true };
  }

  const cost = currency === "credits" ? theme.credits_cost : theme.stars_cost;
  if (!cost || cost <= 0) throw badRequest(`This theme cannot be purchased with ${currency === "credits" ? "Credits" : "Stars"}.`, "BLOG_THEME_WRONG_CURRENCY");

  const referenceId = `blog_theme_purchase:${theme.store_item_id}:${ownerId}`;
  await db.transaction(async (tx: TransactionClient) => {
    if (currency === "credits") {
      await debitCoins(ownerId, cost, "blog_theme_purchase", referenceId, `Purchased blog theme: ${theme.name}`, { themeId: theme.id }, tx);
    } else {
      await debitStars(ownerId, cost, "blog_theme_purchase", referenceId, `Purchased blog theme: ${theme.name}`, tx);
    }
    await tx.query(
      `INSERT INTO user_cosmetics (user_id, store_item_id, cosmetic_type, is_active, acquired_at)
       VALUES ($1, $2, 'blog_theme', FALSE, NOW()) ON CONFLICT (user_id, store_item_id) DO NOTHING`,
      [ownerId, theme.store_item_id]
    );
    await tx.query(`UPDATE blogs SET active_theme_id = $2, updated_at = NOW() WHERE id = $1`, [blogId, theme.id]);
  });

  return { alreadyOwned: false };
}

// ---------------------------------------------------------------------------
// Admin CRUD (gate44/blogs/themes)
// ---------------------------------------------------------------------------

export interface AdminUpdateThemeInput {
  enabled?: boolean;
  includedForPlans?: Plan[];
  includedForBusinessTiers?: BusinessTier[];
  creditsCost?: number | null;
  starsCost?: number | null;
}

export async function adminUpdateTheme(themeId: string, input: AdminUpdateThemeInput): Promise<void> {
  const fields: string[] = [];
  const params: SqlParam[] = [themeId];
  const push = (col: string, value: SqlParam, cast?: string) => {
    params.push(value);
    fields.push(`${col} = $${params.length}${cast ? `::${cast}` : ""}`);
  };
  if (input.enabled !== undefined) push("enabled", input.enabled);
  if (input.includedForPlans !== undefined) push("included_for_plans", input.includedForPlans, "text[]");
  if (input.includedForBusinessTiers !== undefined) push("included_for_business_tiers", input.includedForBusinessTiers, "text[]");
  if (input.creditsCost !== undefined) push("credits_cost", input.creditsCost);
  if (input.starsCost !== undefined) push("stars_cost", input.starsCost);
  if (fields.length === 0) return;
  const { rowCount } = await db.query(`UPDATE blog_themes SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $1`, params);
  if (!rowCount) throw notFound("Theme not found");
}
