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
 *
 * NOTE: `profile_themes` has no Drizzle table definition in lib/db/schema.ts,
 * so queries against it are kept as `sql` templates run through the Drizzle
 * instance rather than the query builder.
 */

import { getDb, schema } from "@/lib/db/drizzle";
import { sql, eq, and } from "drizzle-orm";
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

export type ProfileThemeRow = {
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
};

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
  const orm = await getDb();
  const { rows } = await orm.execute<ProfileThemeRow>(sql`SELECT * FROM profile_themes ORDER BY sort_order ASC, name ASC`);
  return rows.map(hydrate);
}

/** Enabled-only catalog (owner-facing). */
export async function listEnabledProfileThemes(): Promise<ProfileThemeRow[]> {
  const orm = await getDb();
  const { rows } = await orm.execute<ProfileThemeRow>(sql`SELECT * FROM profile_themes WHERE enabled = TRUE ORDER BY sort_order ASC, name ASC`);
  return rows.map(hydrate);
}

export async function getProfileTheme(themeId: string): Promise<ProfileThemeRow | null> {
  const orm = await getDb();
  const { rows } = await orm.execute<ProfileThemeRow>(sql`SELECT * FROM profile_themes WHERE id = ${themeId} LIMIT 1`);
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
    const orm = await getDb();
    const rows = await orm
      .select({ storeItemId: schema.userCosmetics.storeItemId })
      .from(schema.userCosmetics)
      .where(and(eq(schema.userCosmetics.userId, userId), sql`${schema.userCosmetics.storeItemId} = ANY(${storeItemIds}::uuid[])`));
    rows.forEach((r) => ownedSet.add(r.storeItemId));
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
    const orm = await getDb();
    const rows = await orm
      .select({ id: schema.userCosmetics.id })
      .from(schema.userCosmetics)
      .where(and(eq(schema.userCosmetics.userId, userId), eq(schema.userCosmetics.storeItemId, theme.store_item_id)))
      .limit(1);
    if (rows[0]) return theme;
  }

  throw forbidden("You don't own this theme yet.", "PROFILE_THEME_NOT_OWNED");
}

/** Sets `users.active_profile_theme_id`, after verifying the caller is entitled to the theme. */
export async function equipProfileTheme(userId: string, userPlan: string, userBusinessTier: string | null, themeId: string): Promise<void> {
  const theme = await assertEntitled(themeId, userId, userPlan, userBusinessTier);
  const orm = await getDb();
  // `users.active_profile_theme_id` has no Drizzle column definition in
  // lib/db/schema.ts, so this stays a `sql` template through the Drizzle
  // instance instead of the query builder.
  await orm.execute(sql`UPDATE users SET active_profile_theme_id = ${theme.id}, updated_at = NOW() WHERE id = ${userId}`);
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

  const orm = await getDb();
  const existingRows = await orm
    .select({ id: schema.userCosmetics.id })
    .from(schema.userCosmetics)
    .where(and(eq(schema.userCosmetics.userId, userId), eq(schema.userCosmetics.storeItemId, theme.store_item_id)))
    .limit(1);
  if (existingRows[0]) {
    await equipProfileTheme(userId, userPlan, userBusinessTier, themeId);
    return { alreadyOwned: true };
  }

  const cost = currency === "credits" ? theme.credits_cost : theme.stars_cost;
  if (!cost || cost <= 0) throw badRequest(`This theme cannot be purchased with ${currency === "credits" ? "Credits" : "Stars"}.`, "PROFILE_THEME_WRONG_CURRENCY");

  const referenceId = `profile_theme_purchase:${theme.store_item_id}:${userId}`;
  await orm.transaction(async (tx) => {
    if (currency === "credits") {
      await debitCoins(userId, cost, "profile_theme_purchase", referenceId, `Purchased profile theme: ${theme.name}`, { themeId: theme.id }, tx);
    } else {
      await debitStars(userId, cost, "profile_theme_purchase", referenceId, `Purchased profile theme: ${theme.name}`, tx);
    }
    await tx
      .insert(schema.userCosmetics)
      .values({ userId, storeItemId: theme.store_item_id!, cosmeticType: "profile_theme", isActive: false, acquiredAt: new Date() })
      .onConflictDoNothing({ target: [schema.userCosmetics.userId, schema.userCosmetics.storeItemId] });
    // `users.active_profile_theme_id` has no Drizzle column definition.
    await tx.execute(sql`UPDATE users SET active_profile_theme_id = ${theme.id}, updated_at = NOW() WHERE id = ${userId}`);
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
  const setClauses: ReturnType<typeof sql>[] = [];
  if (input.enabled !== undefined) setClauses.push(sql`enabled = ${input.enabled}`);
  if (input.includedForPlans !== undefined) setClauses.push(sql`included_for_plans = ${input.includedForPlans}::text[]`);
  if (input.includedForBusinessTiers !== undefined) setClauses.push(sql`included_for_business_tiers = ${input.includedForBusinessTiers}::text[]`);
  if (input.creditsCost !== undefined) setClauses.push(sql`credits_cost = ${input.creditsCost}`);
  if (input.starsCost !== undefined) setClauses.push(sql`stars_cost = ${input.starsCost}`);
  if (setClauses.length === 0) return;

  const orm = await getDb();
  const result = await orm.execute<never>(
    sql`UPDATE profile_themes SET ${sql.join(setClauses, sql`, `)}, updated_at = NOW() WHERE id = ${themeId}`
  );
  if (!result.rowCount) throw notFound("Theme not found");
}
