/**
 * lib/feed/ranking.ts
 *
 * Home Feed ("for_you") tier ordering, per the product priority list:
 *
 *   6. Boosted content        (active ad_campaigns boost, non-staff author)
 *   5. Organic popular        (all-time engagement)
 *   4. Organic trending       (recent engagement VELOCITY, time-decayed)
 *   3. Business page posts    (non-boosted, weighted by business_accounts.tier)
 *   2. In-house boosted       (active ad_campaigns boost, admin/mod author)
 *   1. Interest-based         (user_interests match, falls back to recency)
 *
 * Each tier always ranks above the next — implemented as
 * `finalScore = tierWeight*1_000_000 + inTierScore` where inTierScore is a
 * normalized (0-1) in-tier score, so no amount of in-tier score can cross a
 * tier boundary.
 *
 * SIMPLIFICATION (documented per product ask): "organic popular" (tier 5)
 * excludes any per-impression attribution of views/engagement that happened
 * while a boost was active — the platform does not track per-impression
 * boost attribution today, so each content type's own all-time counters are
 * used as-is. This can double-count a boosted item's boosted-era engagement
 * into its organic popularity score. Future work: attribute ad_events
 * impressions/clicks back to the underlying content's own counters (or
 * subtract them here) once that plumbing exists.
 */

import type { FeedItem, FeedTier } from "./types";

// ---------------------------------------------------------------------------
// Tier weights — higher wins. Gaps are deliberately large (not 6..1) so a
// future tier can be inserted without renumbering everything.
// ---------------------------------------------------------------------------

export const TIER_WEIGHT: Record<FeedTier, number> = {
  boosted: 60,
  organic_popular: 50,
  organic_trending: 40,
  business: 30,
  in_house_boosted: 20,
  interest: 10,
  recency: 5,
};

const TIER_MULTIPLIER = 1_000_000;

export function computeFinalScore(tier: FeedTier, inTierScore: number): number {
  const clamped = Math.max(0, Math.min(1, inTierScore));
  return TIER_WEIGHT[tier] * TIER_MULTIPLIER + clamped;
}

/**
 * Min-max normalize a list of raw scores to [0,1]. Flat input (all equal,
 * including all-zero) normalizes to 0.5 for every item rather than dividing
 * by zero — ties then fall back to whatever secondary sort the caller
 * applies (recency).
 */
export function normalizeScores(raw: number[]): number[] {
  if (raw.length === 0) return [];
  const min = Math.min(...raw);
  const max = Math.max(...raw);
  if (max - min < 1e-9) return raw.map(() => 0.5);
  return raw.map((v) => (v - min) / (max - min));
}

/** Time-decayed velocity score: raw engagement / (hours since created + 2)^1.5 — same "hot" formula used by /api/tweets for_you. */
export function velocityScore(engagement: number, createdAt: string | Date): number {
  const ageHours = Math.max(0, (Date.now() - new Date(createdAt).getTime()) / 3_600_000);
  return engagement / Math.pow(ageHours + 2, 1.5);
}

const BUSINESS_TIER_RANK: Record<string, number> = { starter: 1, growth: 2, enterprise: 3 };

export function businessTierScore(tier: string | null | undefined): number {
  if (!tier) return 1;
  return BUSINESS_TIER_RANK[tier] ?? 1;
}

/**
 * Score a candidate item against a user's weighted interest tags. Falls back
 * to a small recency-based score when nothing matches (per product ask:
 * "or just recency" for content types without real tagging) — see
 * FeedItem.tags header comment in types.ts for the tagging simplification.
 */
export function interestMatchScore(
  item: Pick<FeedItem, "tags" | "createdAt">,
  interestWeights: Map<string, number>
): number {
  let weight = 0;
  for (const tag of item.tags) {
    const w = interestWeights.get(tag.toLowerCase());
    if (w) weight += w;
  }
  if (weight > 0) return weight;
  // Recency fallback, decayed over 30 days.
  const ageDays = Math.max(0, (Date.now() - new Date(item.createdAt).getTime()) / 86_400_000);
  return Math.max(0, 1 - ageDays / 30) * 0.1; // small — never outranks a real interest match
}

/**
 * Merge candidate lists from every tier into one deduplicated, sorted pool.
 * When the same (contentType, contentId) appears in more than one tier
 * (e.g. a business post that is also organically popular), the HIGHEST
 * tier occurrence wins and the rest are dropped.
 */
export function mergeTiers(tierLists: FeedItem[][]): FeedItem[] {
  const byKey = new Map<string, FeedItem>();
  for (const list of tierLists) {
    for (const item of list) {
      const key = `${item.contentType}:${item.contentId}`;
      const existing = byKey.get(key);
      if (!existing || item.finalScore > existing.finalScore) {
        byKey.set(key, item);
      }
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.finalScore - a.finalScore);
}
