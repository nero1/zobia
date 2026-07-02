/**
 * lib/blogs/limits.ts
 *
 * Per-plan Blogs limits and creator revenue-share rates. Admin-configurable
 * via x_manifest keys, read through the shared manifest cache (15s memory +
 * 60s Redis) to keep Redis calls minimal — same idiom as
 * lib/plans/saveSlots.ts.
 */

import { getManifestValue } from "@/lib/manifest";
import type { Plan } from "@zobia/types";

/** Max articles + pages combined, per plan. */
const DEFAULT_MAX_POSTS: Record<Plan, number> = {
  free: 30,
  plus: 100,
  pro: 200,
  max: 500,
};

/** Max words per article. Every paid plan shares the same higher ceiling. */
const DEFAULT_MAX_WORDS: Record<Plan, number> = {
  free: 1000,
  plus: 5000,
  pro: 5000,
  max: 5000,
};

/** Creator's share (%) of net paywall/ad revenue, after provider fees, VAT and referral commission. */
const DEFAULT_REV_SHARE_PCT: Record<Plan, number> = {
  free: 40,
  plus: 50,
  pro: 60,
  max: 70,
};

/** Stats depth: 'basic' | 'more' | 'detailed' | 'detailed_export' — see PRD §Blogs. */
export const STATS_TIER: Record<Plan, "basic" | "more" | "detailed" | "detailed_export"> = {
  free: "basic",
  plus: "more",
  pro: "detailed_export",
  max: "detailed_export",
};

function normalizePlan(plan: string): Plan {
  return (plan in DEFAULT_MAX_POSTS ? plan : "free") as Plan;
}

export async function getMaxBlogPosts(plan: string): Promise<number> {
  const key = normalizePlan(plan);
  const raw = await getManifestValue(`blog_max_posts_${key}`);
  const parsed = raw != null ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  return DEFAULT_MAX_POSTS[key];
}

export async function getMaxWordsForPlan(plan: string): Promise<number> {
  const key = normalizePlan(plan);
  const raw = await getManifestValue(`blog_max_words_${key}`);
  const parsed = raw != null ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(parsed) && parsed >= 100) return parsed;
  return DEFAULT_MAX_WORDS[key];
}

/** Returns an integer percentage (0-100), e.g. 40 for 40%. */
export async function getBlogRevSharePct(plan: string): Promise<number> {
  const key = normalizePlan(plan);
  const raw = await getManifestValue(`blog_rev_share_pct_${key}`);
  const parsed = raw != null ? parseFloat(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) return parsed;
  return DEFAULT_REV_SHARE_PCT[key];
}

export function getStatsTier(plan: string): "basic" | "more" | "detailed" | "detailed_export" {
  return STATS_TIER[normalizePlan(plan)];
}

export interface BlogEconomyConfig {
  /** Provider payment-processing fee (%), e.g. Paystack ~3. */
  paystackFeePct: number;
  /** Google Play Billing fee (%) — applied when the unlock/spend is IAP-funded. */
  googlePlayFeePct: number;
  /** VAT (%) deducted before the creator's revenue share is computed. */
  vatPct: number;
}

const DEFAULT_ECONOMY: BlogEconomyConfig = {
  paystackFeePct: 3,
  googlePlayFeePct: 10,
  vatPct: 7.5,
};

async function getFloat(key: string, fallback: number): Promise<number> {
  const raw = await getManifestValue(key);
  const parsed = raw != null ? parseFloat(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export async function getBlogEconomyConfig(): Promise<BlogEconomyConfig> {
  const [paystackFeePct, googlePlayFeePct, vatPct] = await Promise.all([
    getFloat("blog_paystack_fee_pct", DEFAULT_ECONOMY.paystackFeePct),
    getFloat("blog_google_play_fee_pct", DEFAULT_ECONOMY.googlePlayFeePct),
    getFloat("blog_vat_pct", DEFAULT_ECONOMY.vatPct),
  ]);
  return { paystackFeePct, googlePlayFeePct, vatPct };
}

export const BLOG_PLAN_DEFAULTS = {
  maxPosts: DEFAULT_MAX_POSTS,
  maxWords: DEFAULT_MAX_WORDS,
  revSharePct: DEFAULT_REV_SHARE_PCT,
  economy: DEFAULT_ECONOMY,
};
