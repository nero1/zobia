/**
 * lib/portals/suggestions.ts
 *
 * "Portals for you" cards injected into the Home Feed. Server-side so the
 * web app, the PWA and the Capacitor app all get the same placement from the
 * one /api/feed response (FeedPage.portalSuggestion).
 *
 * Selection is a seeded weighted sample (without replacement) over a small,
 * cached candidate list, so:
 *   - admin boost_weight / sponsorship / pinning directly raise how often a
 *     portal is shown ("admin boostable, controls frequency and prominence");
 *   - trending activity and followers give organic portals a fair share;
 *   - portals the viewer already follows are skipped;
 *   - the seed is (user, feed page, hour), so a refresh within the hour
 *     shows the same portals but deeper pages and later hours rotate.
 *
 * Redis cost: candidates are cached in memory (5 min) and Redis (10 min,
 * one key for everyone); the only per-request DB read is the viewer's
 * follow set, and only on feed pages that actually render a card.
 *
 * @module lib/portals/suggestions
 */

import { getDb, schema } from "@/lib/db/drizzle";
import { redis } from "@/lib/redis";
import { memDel, memGet, memSet } from "@/lib/cache/memory";
import { loadManifest } from "@/lib/manifest";
import { logger } from "@/lib/logger";
import type { PortalCard } from "@zobia/shared/types";
import { isBoostActive, isSponsorshipActive } from "./constants";
import { bumpPortalImpressions, getActivityCounts, listFollowedPortalIds, toPortalCard } from "./repo";
import { desc, inArray, sql } from "drizzle-orm";

interface Candidate {
  card: PortalCard;
  weight: number;
}

const MEM_KEY = "portals:suggest:mem";
const REDIS_KEY = "portals:suggest:v1";
const MEM_TTL_MS = 5 * 60_000;
const REDIS_TTL_S = 10 * 60;
const MAX_CANDIDATES = 60;

/** Pure: weight a portal for suggestion sampling. Exported for tests. */
export function suggestionWeight(input: {
  status: string;
  isPinned: boolean;
  boostWeight: number;
  boostActive: boolean;
  sponsored: boolean;
  activityCount: number;
  followerCount: number;
}): number {
  const organic = 1 + Math.log2(1 + Math.max(0, input.activityCount)) + 0.5 * Math.log2(1 + Math.max(0, input.followerCount));
  let w = organic;
  if (input.status === "official") w *= 1.5;
  if (input.isPinned) w *= 2;
  // boost 0..100 multiplies weight up to 11x; sponsorship is worth a boost of 50.
  const boost = input.boostActive ? input.boostWeight : 0;
  const effectiveBoost = Math.max(boost, input.sponsored ? 50 : 0);
  w *= 1 + effectiveBoost / 10;
  return w;
}

/** Deterministic PRNG (mulberry32) seeded from a string. Exported for tests. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pure: weighted sample without replacement. Exported for tests. */
export function weightedSample<T extends { weight: number }>(items: T[], count: number, rand: () => number): T[] {
  const pool = items.filter((i) => i.weight > 0);
  const out: T[] = [];
  while (out.length < count && pool.length > 0) {
    const total = pool.reduce((s, i) => s + i.weight, 0);
    let r = rand() * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= pool[idx].weight;
      if (r <= 0) break;
    }
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

async function loadCandidates(): Promise<Candidate[]> {
  const manifest = await loadManifest();
  const orm = await getDb();
  const rows = await orm
    .select()
    .from(schema.portals)
    .where(inArray(schema.portals.status, ["official", "auto"]))
    .orderBy(desc(schema.portals.isPinned), desc(schema.portals.boostWeight), sql`${schema.portals.lastActivityAt} DESC NULLS LAST`)
    .limit(MAX_CANDIDATES);
  const activity = await getActivityCounts(rows.map((r) => r.hashtagId), manifest.portals.trendingWindowHours);
  return rows.map((row) => {
    const activityCount = activity.get(row.hashtagId) ?? 0;
    return {
      card: toPortalCard(row, activityCount),
      weight: suggestionWeight({
        status: row.status,
        isPinned: row.isPinned,
        boostWeight: row.boostWeight,
        boostActive: isBoostActive(row),
        sponsored: isSponsorshipActive(row.sponsoredUntil),
        activityCount,
        followerCount: row.followerCount,
      }),
    };
  });
}

async function getCandidates(): Promise<Candidate[]> {
  const mem = memGet<Candidate[]>(MEM_KEY);
  if (mem) return mem;
  try {
    const cached = await redis.get(REDIS_KEY);
    if (cached) {
      const v = JSON.parse(cached) as Candidate[];
      memSet(MEM_KEY, v, MEM_TTL_MS);
      return v;
    }
  } catch (err) {
    logger.error({ err }, "[portals] suggestion candidate Redis read failed — recomputing");
  }
  const fresh = await loadCandidates();
  memSet(MEM_KEY, fresh, MEM_TTL_MS);
  try {
    await redis.setex(REDIS_KEY, REDIS_TTL_S, JSON.stringify(fresh));
  } catch (err) {
    logger.error({ err }, "[portals] suggestion candidate Redis write failed (non-fatal)");
  }
  return fresh;
}

export async function invalidateSuggestionCache(): Promise<void> {
  memDel(MEM_KEY);
  try {
    await redis.del(REDIS_KEY);
  } catch (err) {
    logger.error({ err }, "[portals] suggestion cache invalidate failed (non-fatal)");
  }
}

/**
 * Pick the portals for one feed page. Returns [] when suggestions are off,
 * nothing qualifies, or anything fails (a suggestion card must never break
 * the feed).
 */
export async function pickPortalSuggestions(userId: string | null, pageKey: string): Promise<PortalCard[]> {
  try {
    const manifest = await loadManifest();
    if (!manifest.features.portals || manifest.portals.feedSuggestionEvery <= 0) return [];
    const max = Math.max(1, manifest.portals.feedSuggestionMaxPortals);

    const candidates = await getCandidates();
    if (candidates.length === 0) return [];

    const followed = userId ? new Set(await listFollowedPortalIds(userId)) : new Set<string>();
    const eligible = candidates.filter((c) => !followed.has(c.card.id));
    const hourBucket = Math.floor(Date.now() / 3_600_000);
    const rand = seededRandom(`${userId ?? "anon"}:${pageKey}:${hourBucket}`);
    const picked = weightedSample(eligible, max, rand).map((c) => c.card);

    if (picked.length > 0) {
      // Fire-and-forget: one multi-row upsert, never blocks the feed.
      bumpPortalImpressions(picked.map((p) => p.id)).catch((err) =>
        logger.error({ err }, "[portals] impression bump failed (non-fatal)")
      );
    }
    return picked;
  } catch (err) {
    logger.error({ err }, "[portals] pickPortalSuggestions failed (non-fatal)");
    return [];
  }
}
