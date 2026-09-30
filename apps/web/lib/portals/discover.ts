/**
 * lib/portals/discover.ts
 *
 * The payload behind the /h discovery hub: featured, trending hashtags,
 * rising, places & schools, newest and popular portals, in ONE cached object
 * (memory 20 s -> Redis, single-flight; see cache.ts), so a busy hub costs a
 * handful of indexed queries per cache window, not per visitor.
 *
 * Only live portals (official / auto) are listed; trending hashtags include
 * tags that have no portal (they link to a tag page).
 */

import { desc, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { loadManifest } from "@/lib/manifest";
import type { PortalCard, PortalDiscover, TrendingTag } from "@zobia/types";
import { getCachedPortalValue } from "./cache";
import { isBoostActive, isSponsorshipActive } from "./constants";
import { getActivityCounts, toPortalCard, type PortalRow } from "./repo";

export const DISCOVER_CACHE_ID = "discover";

const LIVE: ("official" | "auto")[] = ["official", "auto"];
const FEATURED_MAX = 8;
const SECTION_MAX = 12;
const TAGS_MAX = 24;

/** Pure: pick featured portals (pinned, boosted, sponsored, then officials by followers). Exported for tests. */
export function pickFeatured(rows: PortalRow[], now: number = Date.now(), max = FEATURED_MAX): PortalRow[] {
  const promoted = rows.filter((r) => r.isPinned || isBoostActive(r, now) || isSponsorshipActive(r.sponsoredUntil, now));
  promoted.sort(
    (a, b) =>
      Number(b.isPinned) - Number(a.isPinned) ||
      (isBoostActive(b, now) ? b.boostWeight : 0) - (isBoostActive(a, now) ? a.boostWeight : 0) ||
      b.followerCount - a.followerCount
  );
  const picked = promoted.slice(0, max);
  if (picked.length >= 4) return picked;
  const have = new Set(picked.map((p) => p.id));
  const officials = rows.filter((r) => r.status === "official" && !have.has(r.id)).sort((a, b) => b.followerCount - a.followerCount);
  return [...picked, ...officials].slice(0, Math.min(max, Math.max(4, picked.length)));
}

async function build(): Promise<PortalDiscover> {
  const manifest = await loadManifest();
  const windowHours = Math.max(1, manifest.portals.trendingWindowHours);
  const orm = await getDb();

  const live = await orm
    .select()
    .from(schema.portals)
    .where(inArray(schema.portals.status, LIVE))
    .orderBy(desc(schema.portals.followerCount), desc(schema.portals.createdAt))
    .limit(200);

  const places = live.filter((r) => !!r.city).slice(0, SECTION_MAX);
  const newest = [...live].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, SECTION_MAX);
  const popular = live.slice(0, SECTION_MAX);
  const featured = pickFeatured(live);

  const activity = await getActivityCounts(live.map((r) => r.hashtagId), windowHours);
  const rising = live
    .filter((r) => (activity.get(r.hashtagId) ?? 0) > 0)
    .sort((a, b) => (activity.get(b.hashtagId) ?? 0) - (activity.get(a.hashtagId) ?? 0))
    .slice(0, SECTION_MAX);

  const card = (r: PortalRow): PortalCard => toPortalCard(r, activity.get(r.hashtagId) ?? 0);

  const { rows: tagRows } = await orm.execute<{ slug: string; posts: number; authors: number; has_portal: boolean } & Record<string, unknown>>(sql`
    SELECT h.slug, COUNT(*)::int AS posts, COUNT(DISTINCT ch.author_id)::int AS authors,
           EXISTS (SELECT 1 FROM portals p WHERE p.hashtag_id = h.id AND p.status IN ('official', 'auto')) AS has_portal
    FROM content_hashtags ch
    JOIN hashtags h ON h.id = ch.hashtag_id
    WHERE ch.created_at > NOW() - make_interval(hours => ${windowHours})
      AND h.is_blocked = false AND h.alias_of IS NULL
    GROUP BY h.id, h.slug
    ORDER BY authors DESC, posts DESC, h.slug
    LIMIT ${TAGS_MAX}
  `);
  const trendingTags: TrendingTag[] = tagRows.map((t) => ({ slug: t.slug, postCount: Number(t.posts), authorCount: Number(t.authors), hasPortal: !!t.has_portal }));

  return {
    featured: featured.map(card),
    trendingTags,
    rising: rising.map(card),
    places: places.map(card),
    newest: newest.map(card),
    popular: popular.map(card),
    generatedAt: new Date().toISOString(),
  };
}

export async function getDiscoverPayload(): Promise<PortalDiscover> {
  return getCachedPortalValue<PortalDiscover>(DISCOVER_CACHE_ID, build);
}
