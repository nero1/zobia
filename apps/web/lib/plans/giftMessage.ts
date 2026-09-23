/**
 * lib/plans/giftMessage.ts
 *
 * Config for the optional "Add a message" box on the Send Gift flow
 * (PRD §12 Gift Economy). Admin-configurable via x_manifest
 * `gift_message_*` keys (migration 0007), read through the shared manifest
 * cache (30s memory + 10min Redis) to keep Redis calls minimal — same idiom
 * as lib/plans/saveSlots.ts.
 *
 * Rules (see PRD):
 *   - Free-plan users unlock the feature at a minimum account level
 *     (gift_message_free_min_level, default 5) — separate from the
 *     per-plan on/off toggle, which still applies on top of the level gate.
 *   - Plus/Pro/Max and all Business tiers have it on by default with an
 *     increasing max-word ceiling.
 *   - Every toggle and word limit is independently admin-editable at
 *     /gate44/gifts/message-settings.
 */

import { getManifestValue } from "@/lib/manifest";
import type { Plan } from "@zobia/types";
import type { BusinessTier } from "@/lib/business/limits";

/** A plan slug, or a business tier prefixed the same way lib/plans/allPlanOptions.ts does. */
export type GiftMessageTier = Plan | `business_${BusinessTier}`;

const DEFAULT_MAX_WORDS: Record<GiftMessageTier, number> = {
  free: 40,
  plus: 50,
  pro: 100,
  max: 250,
  business_starter: 50,
  business_growth: 100,
  business_enterprise: 250,
};

const DEFAULT_ENABLED: Record<GiftMessageTier, boolean> = {
  free: true,
  plus: true,
  pro: true,
  max: true,
  business_starter: true,
  business_growth: true,
  business_enterprise: true,
};

const DEFAULT_FREE_MIN_LEVEL = 5;

function normalizeTier(plan: string, businessTier: string | null | undefined): GiftMessageTier {
  if (businessTier === "starter" || businessTier === "growth" || businessTier === "enterprise") {
    return `business_${businessTier}` as GiftMessageTier;
  }
  return (plan in DEFAULT_MAX_WORDS ? plan : "free") as GiftMessageTier;
}

export interface GiftMessageConfig {
  /** Master on/off switch for the whole feature. */
  globallyEnabled: boolean;
  /** Whether this specific plan/tier has the feature toggled on. */
  tierEnabled: boolean;
  /** Max words allowed in the message for this plan/tier. */
  maxWords: number;
  /** Minimum account level required (Free plan only; 1 for all other plans/tiers). */
  minLevel: number;
  /** True only when every gate above is satisfied — the convenience field callers actually want. */
  eligible: boolean;
}

/**
 * Resolves the full gift-message eligibility for a user, given their plan,
 * business tier (if any), and current account (rank) level.
 */
export async function getGiftMessageConfig(
  plan: string,
  businessTier: string | null | undefined,
  accountLevel: number
): Promise<GiftMessageConfig> {
  const tier = normalizeTier(plan, businessTier);

  const globalRaw = await getManifestValue("gift_message_enabled");
  const globallyEnabled = globalRaw == null ? true : globalRaw === "true";

  const enabledRaw = await getManifestValue(`gift_message_enabled_${tier}`);
  const tierEnabled = enabledRaw == null ? DEFAULT_ENABLED[tier] : enabledRaw === "true";

  const maxWordsRaw = await getManifestValue(`gift_message_max_words_${tier}`);
  const parsedMaxWords = maxWordsRaw != null ? parseInt(maxWordsRaw, 10) : NaN;
  const maxWords = Number.isFinite(parsedMaxWords) && parsedMaxWords >= 0 ? parsedMaxWords : DEFAULT_MAX_WORDS[tier];

  let minLevel = 1;
  if (tier === "free") {
    const minLevelRaw = await getManifestValue("gift_message_free_min_level");
    const parsedMinLevel = minLevelRaw != null ? parseInt(minLevelRaw, 10) : NaN;
    minLevel = Number.isFinite(parsedMinLevel) && parsedMinLevel >= 0 ? parsedMinLevel : DEFAULT_FREE_MIN_LEVEL;
  }

  const eligible = globallyEnabled && tierEnabled && accountLevel >= minLevel;

  return { globallyEnabled, tierEnabled, maxWords, minLevel, eligible };
}

/** Word count using the same tokenization the server validates against — whitespace-delimited. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** All tiers, for the admin settings page. */
export const GIFT_MESSAGE_TIERS: GiftMessageTier[] = [
  "free",
  "plus",
  "pro",
  "max",
  "business_starter",
  "business_growth",
  "business_enterprise",
];

export const GIFT_MESSAGE_TIER_LABELS: Record<GiftMessageTier, string> = {
  free: "Free",
  plus: "Plus",
  pro: "Pro",
  max: "Max",
  business_starter: "Business Starter",
  business_growth: "Business Growth",
  business_enterprise: "Business Enterprise",
};
