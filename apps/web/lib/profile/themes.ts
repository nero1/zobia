/**
 * lib/profile/themes.ts
 *
 * Profile theme engine — mirrors lib/blogs/themes.ts (blog_themes, migration
 * 0022) exactly, minus the layout-variant concept: a profile theme is purely
 * a color skin (CSS token set) applied to the existing profile page, not a
 * structurally distinct layout, so there's no per-theme React component to
 * pick — just `config` tokens the profile page reads.
 *
 * Purchasing reuses the existing cosmetics ledger (`user_cosmetics`,
 * `store_items`) for themes that have a `store_item_id` — ownership check is
 * "does the caller own store_items row X", exactly like any other cosmetic.
 * The free-default theme needs no ownership row at all.
 */

import { db } from "@/lib/db";
import type { SqlParam, TransactionClient } from "@/lib/db/interface";
import { debitCoins } from "@/lib/economy/coins";
import { debitStars } from "@/lib/economy/stars";
import { badRequest, forbidden, notFound } from "@/lib/api/errors";

export interface ThemeTokens {
  bg: string;
  card: string;
  accent: string;
  text: string;
  muted: string;
}

export interface ProfileThemeRow {
  id: string;
  name: string;
  description: string | null;
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

export const DEFAULT_PROFILE_THEME_TOKENS: ThemeTokens = { bg: "#0a0a0a", card: "#171717", accent: "#14b8a6", text: "#fafafa", muted: "#a3a3a3" };

function normalizeThemeTokens(raw: unknown): ThemeTokens {
  if (!raw || typeof raw !== "object") return DEFAULT_PROFILE_THEME_TOKENS;
  const obj = raw as Partial<ThemeTokens>;
  return {
    bg: typeof obj.bg === "string" ? obj.bg : DEFAULT_PROFILE_THEME_TOKENS.bg,
    card: typeof obj.card === "string" ? obj.card : DEFAULT_PROFILE_THEME_TOKENS.card,
    accent: typeof obj.accent === "string" ? obj.accent : DEFAULT_PROFILE_THEME_TOKENS.accent,
    text: typeof obj.text === "string" ? obj.text : DEFAULT_PROFILE_THEME_TOKENS.text,
    muted: typeof obj.muted === "string" ? obj.muted : DEFAULT_PROFILE_THEME_TOKENS.muted,
  };
}

function hydrate(row: ProfileThemeRow): ProfileThemeRow {
  return { ...row, config: normalizeThemeTokens(row.config) };
}

/** Full catalog (admin view — includes disabled rows). */
export async function listAllProfileThemes(): Promise<ProfileThemeRow[]> {
  const { rows } = await db.query<ProfileThemeRow>(`SELECT * FROM profile_themes ORDER BY sort_order ASC, name ASC`);
  return rows.map(hydrate);
}

/** Enabled-only catalog (owner-facing). */
export async function listEnabledProfileThemes(): Promise<ProfileThemeRow[]> {
  const { rows } = await db.query<ProfileThemeRow>(`SELECT * FROM profile_themes WHERE enabled = TRUE ORDER BY sort_order ASC, name ASC`);
  return rows.map(hydrate);
}

export async function getProfileTheme(themeId: string): Promise<ProfileThemeRow | null> {
  const { rows } = await db.query<ProfileThemeRow>(`SELECT * FROM profile_themes WHERE id = $1 LIMIT 1`, [themeId]);
  return rows[0] ? hydrate(rows[0]) : null;
}

export type ProfileThemeAvailability = "free_default" | "plan_included" | "owned" | "purchasable" | "locked";

export interface ProfileThemeWithAvailability extends ProfileThemeRow {
  availability: ProfileThemeAvailability;
  isActive: boolean;
}

export async function getAvailableProfileThemes(
  userId: string,
  activeThemeId: string,
  userPlan: string,
  userBusinessTier: string | null
): Promise<ProfileThemeWithAvailability[]> {
  const themes = await listEnabledProfileThemes();
  const storeItemIds = themes.map((t) => t.store_item_id).filter((id): id is string => !!id);

  const ownedSet = new Set<string>();
  if (storeItemIds.length > 0) {
    const { rows } = await db.query<{ store_item_id: string }>(
      `SELECT store_item_id FROM user_cosmetics WHERE user_id = $1 AND store_item_id = ANY($2::uuid[])`,
      [userId, storeItemIds]
    );
    rows.forEach((r) => ownedSet.add(r.store_item_id));
  }

  return themes.map((theme) => {
    let availability: ProfileThemeAvailability;
    if (theme.is_free_default) {
      availability = "free_default";
    } else if ((theme.included_for_plans ?? []).includes(userPlan) || (userBusinessTier && (theme.included_for_business_tiers ?? []).includes(userBusinessTier))) {
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

async function assertEntitled(themeId: string, userId: string, userPlan: string, userBusinessTier: string | null): Promise<ProfileThemeRow> {
  const theme = await getProfileTheme(themeId);
  if (!theme || !theme.enabled) throw notFound("Theme not found");

  if (theme.is_free_default) return theme;
  if ((theme.included_for_plans ?? []).includes(userPlan)) return theme;
  if (userBusinessTier && (theme.included_for_business_tiers ?? []).includes(userBusinessTier)) return theme;

  if (theme.store_item_id) {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM user_cosmetics WHERE user_id = $1 AND store_item_id = $2 LIMIT 1`, [userId, theme.store_item_id]);
    if (rows[0]) return theme;
  }

  throw forbidden("You don't own this theme yet.", "PROFILE_THEME_NOT_OWNED");
}

/** Sets `users.active_profile_theme_id`, after verifying the caller is entitled to the theme. */
export async function equipProfileTheme(userId: string, userPlan: string, userBusinessTier: string | null, themeId: string): Promise<void> {
  const theme = await assertEntitled(themeId, userId, userPlan, userBusinessTier);
  await db.query(`UPDATE users SET active_profile_theme_id = $2, updated_at = NOW() WHERE id = $1`, [userId, theme.id]);
}

/**
 * Purchases a theme (Credits or Stars) via the same ledger the generic
 * cosmetics store uses, then equips it. No-op charge (still equips) if the
 * caller already owns it or it's free/plan-included.
 */
export async function purchaseAndEquipProfileTheme(
  userId: string,
  userPlan: string,
  userBusinessTier: string | null,
  themeId: string,
  currency: "credits" | "stars"
): Promise<{ alreadyOwned: boolean }> {
  const theme = await getProfileTheme(themeId);
  if (!theme || !theme.enabled) throw notFound("Theme not found");

  if (theme.is_free_default || (theme.included_for_plans ?? []).includes(userPlan) || (userBusinessTier && (theme.included_for_business_tiers ?? []).includes(userBusinessTier))) {
    await equipProfileTheme(userId, userPlan, userBusinessTier, themeId);
    return { alreadyOwned: true };
  }

  if (!theme.store_item_id) throw badRequest("This theme is not purchasable.", "PROFILE_THEME_NOT_PURCHASABLE");

  const { rows: existingRows } = await db.query<{ id: string }>(`SELECT id FROM user_cosmetics WHERE user_id = $1 AND store_item_id = $2 LIMIT 1`, [userId, theme.store_item_id]);
  if (existingRows[0]) {
    await equipProfileTheme(userId, userPlan, userBusinessTier, themeId);
    return { alreadyOwned: true };
  }

  const cost = currency === "credits" ? theme.credits_cost : theme.stars_cost;
  if (!cost || cost <= 0) throw badRequest(`This theme cannot be purchased with ${currency === "credits" ? "Credits" : "Stars"}.`, "PROFILE_THEME_WRONG_CURRENCY");

  const referenceId = `profile_theme_purchase:${theme.store_item_id}:${userId}`;
  await db.transaction(async (tx: TransactionClient) => {
    if (currency === "credits") {
      await debitCoins(userId, cost, "profile_theme_purchase", referenceId, `Purchased profile theme: ${theme.name}`, { themeId: theme.id }, tx);
    } else {
      await debitStars(userId, cost, "profile_theme_purchase", referenceId, `Purchased profile theme: ${theme.name}`, tx);
    }
    await tx.query(
      `INSERT INTO user_cosmetics (user_id, store_item_id, cosmetic_type, is_active, acquired_at)
       VALUES ($1, $2, 'profile_theme', FALSE, NOW()) ON CONFLICT (user_id, store_item_id) DO NOTHING`,
      [userId, theme.store_item_id]
    );
    await tx.query(`UPDATE users SET active_profile_theme_id = $2, updated_at = NOW() WHERE id = $1`, [userId, theme.id]);
  });

  return { alreadyOwned: false };
}

// ---------------------------------------------------------------------------
// Admin CRUD (gate44/profile-themes)
// ---------------------------------------------------------------------------

export interface AdminUpdateProfileThemeInput {
  enabled?: boolean;
  includedForPlans?: string[];
  includedForBusinessTiers?: string[];
  creditsCost?: number | null;
  starsCost?: number | null;
}

export async function adminUpdateProfileTheme(themeId: string, input: AdminUpdateProfileThemeInput): Promise<void> {
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
  const { rowCount } = await db.query(`UPDATE profile_themes SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $1`, params);
  if (!rowCount) throw notFound("Theme not found");
}
