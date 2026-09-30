/**
 * Integration tests: hashtags + Portals (migration 0018)
 *
 * Runs the REAL service/repo/SQL against a real Postgres (TEST_DATABASE_URL,
 * all migrations applied) so column names, UNION branches, upserts, merges,
 * the auto-portal lifecycle and the suggestion sampler are proven end to end.
 *
 * Only the infrastructure edges are mocked: Redis, the manifest and the
 * logger. getDb() is pointed at the test pool. Rows are created with unique
 * random tags and cleaned up in afterAll (no outer transaction: the services
 * open their own).
 */

import { randomUUID } from "crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { integrationSetup, closeTestPool, getTestPool } from "./setup";
import { createUser } from "./helpers";

const mockManifest = {
  features: { portals: true },
  portals: {
    autoCreateEnabled: true,
    autoMinPosts: 3,
    autoMinDistinctUsers: 2,
    trendingWindowHours: 48,
    archiveAfterDays: 30,
    feedSuggestionEvery: 8,
    feedSuggestionMaxPortals: 3,
    cacheTtlSeconds: 600,
  },
};

jest.mock("@/lib/manifest", () => ({
  loadManifest: jest.fn(async () => mockManifest),
  requireFeatureEnabled: jest.fn(async () => undefined),
}));
jest.mock("@/lib/logger", () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } }));
jest.mock("@/lib/redis", () => {
  const store = new Map<string, string>();
  return {
    redis: {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      setex: jest.fn(async (k: string, _s: number, v: string) => { store.set(k, v); return "OK"; }),
      del: jest.fn(async (k: string) => { store.delete(k); return 1; }),
    },
  };
});
jest.mock("@/lib/db/drizzle", () => {
  const actual = jest.requireActual("@/lib/db/drizzle");
  const { schema } = jest.requireActual("@/lib/db/schema");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const setup = require("./setup");
  return {
    ...actual,
    schema,
    getDb: async () => drizzle(setup.getTestPool(), { schema }),
  };
});

import { syncContentHashtags, resolveHashtag, searchHashtags } from "@/lib/hashtags/service";
import {
  upsertOfficialPortal,
  resolvePortal,
  mergeHashtags,
  setHashtagBlocked,
  followPortal,
  unfollowPortal,
  listPortals,
  getPortalStats,
  bumpPortalStat,
  updatePortal,
} from "@/lib/portals/repo";
import { fetchTaggedFeed, fetchPortalPeople, fetchPortalRooms, fetchPortalGuilds } from "@/lib/portals/content";
import { getPortalPayload } from "@/lib/portals/page";
import { runPortalLifecycle, sweepStaleContentHashtags } from "@/lib/portals/trending";
import { pickPortalSuggestions, invalidateSuggestionCache } from "@/lib/portals/suggestions";
import { getDb } from "@/lib/db/drizzle";
import { fetchFeedPage } from "@/lib/feed/aggregator";
import { resolveTagPage } from "@/lib/portals/tagPage";
import { getDiscoverPayload } from "@/lib/portals/discover";
import { sql } from "drizzle-orm";

let dbAvailable = false;
const tag = (name: string) => `${name}${randomUUID().slice(0, 6).replace(/-/g, "")}`;
const createdSlugs: string[] = [];
const createdUserIds: string[] = [];

beforeAll(async () => {
  dbAvailable = await integrationSetup();
});

afterAll(async () => {
  if (dbAvailable) {
    const pool = getTestPool();
    await pool.query(`DELETE FROM portals WHERE slug = ANY($1)`, [createdSlugs]);
    await pool.query(`DELETE FROM content_hashtags WHERE hashtag_id IN (SELECT id FROM hashtags WHERE slug = ANY($1))`, [createdSlugs]);
    await pool.query(`DELETE FROM hashtags WHERE slug = ANY($1)`, [createdSlugs]);
    await pool.query(`DELETE FROM tweets WHERE user_id = ANY($1)`, [createdUserIds]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [createdUserIds]);
  }
  await closeTestPool();
});

async function seedUser() {
  const client = await getTestPool().connect();
  try {
    const u = await createUser(client);
    createdUserIds.push(u.id);
    return u;
  } finally {
    client.release();
  }
}

async function seedTweet(userId: string, content: string): Promise<string> {
  const orm = await getDb();
  const id = randomUUID();
  await orm.execute(sql`INSERT INTO tweets (id, user_id, content) VALUES (${id}, ${userId}, ${content})`);
  await syncContentHashtags(orm, { contentType: "tweet", contentId: id, authorId: userId, texts: [content] });
  return id;
}

describe("hashtags + portals [integration]", () => {
  it("syncs tags, is idempotent, diffs on edit, and keeps use_count honest", async () => {
    if (!dbAvailable) return;
    const t1 = tag("lagos");
    const t2 = tag("uniben");
    createdSlugs.push(t1, t2);
    const u = await seedUser();
    const orm = await getDb();
    const id = randomUUID();
    await orm.execute(sql`INSERT INTO tweets (id, user_id, content) VALUES (${id}, ${u.id}, 'x')`);

    const a = await syncContentHashtags(orm, { contentType: "tweet", contentId: id, authorId: u.id, texts: [`hi #${t1} #${t2}`] });
    expect(a.slugs.sort()).toEqual([t1, t2].sort());
    await syncContentHashtags(orm, { contentType: "tweet", contentId: id, authorId: u.id, texts: [`hi #${t1} #${t2}`] });
    expect((await resolveHashtag(t1))?.useCount).toBe(1);

    await syncContentHashtags(orm, { contentType: "tweet", contentId: id, authorId: u.id, texts: [`now only #${t1}`] });
    expect((await resolveHashtag(t2))?.useCount).toBe(0);
    expect((await resolveHashtag(t1))?.useCount).toBe(1);

    await syncContentHashtags(orm, { contentType: "tweet", contentId: id, authorId: u.id, texts: [] });
    expect((await resolveHashtag(t1))?.useCount).toBe(0);
  });

  it("a tagging failure inside a caller transaction rolls back to a savepoint and never aborts the post", async () => {
    if (!dbAvailable) return;
    const u = await seedUser();
    const orm = await getDb();
    const id = randomUUID();
    await orm.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO tweets (id, user_id, content) VALUES (${id}, ${u.id}, 'kept')`);
      // An invalid content_type violates the CHECK constraint inside the savepoint.
      const r = await syncContentHashtags(tx, { contentType: "bogus" as never, contentId: id, authorId: u.id, texts: ["#whatever"] });
      expect(r.slugs).toEqual([]);
      // The outer transaction is still healthy: this statement must succeed.
      await tx.execute(sql`UPDATE tweets SET content = 'still here' WHERE id = ${id}`);
    });
    const { rows } = await orm.execute<{ content: string } & Record<string, unknown>>(sql`SELECT content FROM tweets WHERE id = ${id}`);
    expect(rows[0]?.content).toBe("still here");
  });

  it("creates an official portal, resolves it, builds the full payload, caches it", async () => {
    if (!dbAvailable) return;
    const slug = tag("edo");
    createdSlugs.push(slug);
    const u = await seedUser();
    await seedTweet(u.id, `Edo pride #${slug}`);

    const portal = await upsertOfficialPortal({ slug, title: "Edo", tagline: "Home of Benin", accentColor: "#ff8800", city: "Benin" }, u.id);
    expect(portal.status).toBe("official");
    const resolved = await resolvePortal(slug.toUpperCase());
    expect(resolved?.row.id).toBe(portal.id);

    const payload = await getPortalPayload(resolved!.row);
    expect(payload.portal.title).toBe("Edo");
    expect(payload.sections.feed.some((i) => i.contentType === "tweet")).toBe(true);
    expect(payload.sections.people[0]?.userId).toBe(u.id);
    const again = await getPortalPayload(resolved!.row);
    expect(again.generatedAt).toBe(payload.generatedAt);
  });

  it("every UNION branch compiles and the new/top pagination works", async () => {
    if (!dbAvailable) return;
    const slug = tag("pager");
    createdSlugs.push(slug);
    const u = await seedUser();
    for (let i = 0; i < 5; i++) await seedTweet(u.id, `post ${i} #${slug}`);
    const tagRow = await resolveHashtag(slug);
    const p1 = await fetchTaggedFeed(tagRow!.id, { sort: "new", limit: 2 });
    expect(p1.items).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await fetchTaggedFeed(tagRow!.id, { sort: "new", limit: 2, cursor: p1.nextCursor });
    expect(p2.items).toHaveLength(2);
    expect(new Set([...p1.items, ...p2.items].map((i) => i.contentId)).size).toBe(4);
    const top = await fetchTaggedFeed(tagRow!.id, { sort: "top", limit: 3 });
    expect(top.items.length).toBe(3);
    expect((await fetchPortalRooms(tagRow!.id, null)).length).toBe(0);
    expect((await fetchPortalGuilds(tagRow!.id, "nowhere")).length).toBe(0);
    expect((await fetchPortalPeople(tagRow!.id))[0]?.postCount).toBe(5);
  });

  it("merges one tag into another, following aliases and moving links", async () => {
    if (!dbAvailable) return;
    const from = tag("uniben"), into = tag("uniben2");
    createdSlugs.push(from, into);
    const u = await seedUser();
    await seedTweet(u.id, `a #${from}`);
    await seedTweet(u.id, `b #${into}`);
    await upsertOfficialPortal({ slug: into }, u.id);
    const moved = await mergeHashtags(from, into);
    expect(moved.moved).toBe(1);
    expect((await resolveHashtag(from))?.slug).toBe(into);
    expect((await resolveHashtag(into))?.useCount).toBe(2);
    const viaAlias = await resolvePortal(from);
    expect(viaAlias?.canonicalSlug).toBe(into);
    // New posts using the merged tag land on the survivor.
    const orm = await getDb();
    const id = randomUUID();
    await orm.execute(sql`INSERT INTO tweets (id, user_id, content) VALUES (${id}, ${u.id}, 'c')`);
    const r = await syncContentHashtags(orm, { contentType: "tweet", contentId: id, authorId: u.id, texts: [`#${from}`] });
    expect(r.slugs).toEqual([into]);
  });

  it("blocks a tag: links removed, portal suppressed, future tagging skipped", async () => {
    if (!dbAvailable) return;
    const slug = tag("spam");
    createdSlugs.push(slug);
    const u = await seedUser();
    await seedTweet(u.id, `x #${slug}`);
    const portal = await upsertOfficialPortal({ slug }, u.id);
    await setHashtagBlocked(slug, true);
    expect(await resolvePortal(slug)).toBeNull();
    expect((await resolvePortal(slug, { includeSuppressed: true }))).toBeNull(); // blocked tags never resolve
    const orm = await getDb();
    const id = randomUUID();
    await orm.execute(sql`INSERT INTO tweets (id, user_id, content) VALUES (${id}, ${u.id}, 'c')`);
    expect((await syncContentHashtags(orm, { contentType: "tweet", contentId: id, authorId: u.id, texts: [`#${slug}`] })).slugs).toEqual([]);
    expect(portal.id).toBeTruthy();
    await setHashtagBlocked(slug, false);
    expect((await resolvePortal(slug, { includeSuppressed: true }))?.row.status).toBe("suppressed");
  });

  it("follow/unfollow keeps follower_count exact and stats accumulate", async () => {
    if (!dbAvailable) return;
    const slug = tag("follow");
    createdSlugs.push(slug);
    const a = await seedUser(), b = await seedUser();
    const p = await upsertOfficialPortal({ slug }, a.id);
    expect((await followPortal(p.id, a.id)).followerCount).toBe(1);
    expect((await followPortal(p.id, a.id)).followerCount).toBe(1);
    expect((await followPortal(p.id, b.id)).followerCount).toBe(2);
    expect((await unfollowPortal(p.id, a.id)).followerCount).toBe(1);
    await bumpPortalStat(p.id, "views", 3);
    const stats = await getPortalStats(p.id, 7);
    expect(stats.totals.views).toBe(3);
    expect(stats.totals.follows).toBe(2);
  });

  it("lifecycle: promotes only past BOTH thresholds, never reserved/blocked, archives quiet auto portals, sweeps deleted content", async () => {
    if (!dbAvailable) return;
    const hot = tag("hot"), oneUser = tag("solo"), quiet = tag("quiet");
    createdSlugs.push(hot, oneUser, quiet);
    const u1 = await seedUser(), u2 = await seedUser();
    const tweets: string[] = [];
    for (const u of [u1, u2, u1]) tweets.push(await seedTweet(u.id, `x #${hot}`));
    for (let i = 0; i < 4; i++) await seedTweet(u1.id, `x #${oneUser}`); // enough posts, one author
    const r1 = await runPortalLifecycle();
    expect(r1.promoted).toBeGreaterThanOrEqual(1);
    expect((await resolvePortal(hot))?.row.status).toBe("auto");
    expect(await resolvePortal(oneUser)).toBeNull();

    // Archive: make an auto portal quiet.
    const orm = await getDb();
    await orm.execute(sql`INSERT INTO hashtags (slug, display) VALUES (${quiet}, ${quiet}) ON CONFLICT DO NOTHING`);
    await orm.execute(sql`INSERT INTO portals (slug, hashtag_id, title, status, last_activity_at) SELECT ${quiet}, id, 'Quiet', 'auto', NOW() - INTERVAL '90 days' FROM hashtags WHERE slug = ${quiet}`);
    await runPortalLifecycle();
    expect((await resolvePortal(quiet))?.row.status).toBe("archived");

    // Sweep: soft-delete a tweet -> its link disappears.
    await orm.execute(sql`UPDATE tweets SET deleted_at = NOW() WHERE id = ${tweets[0]}`);
    expect(await sweepStaleContentHashtags()).toBeGreaterThanOrEqual(1);
    expect((await resolveHashtag(hot))?.useCount).toBe(2);
  });

  it("admin list/update/search and suggestions respect boost and follows", async () => {
    if (!dbAvailable) return;
    const a = tag("alpha"), b = tag("bravo");
    createdSlugs.push(a, b);
    const u = await seedUser();
    const pa = await upsertOfficialPortal({ slug: a, boostWeight: 100 }, u.id);
    const pb = await upsertOfficialPortal({ slug: b }, u.id);
    await updatePortal(pb.id, { tagline: "hi", status: "official" });
    const { cards } = await listPortals({ statuses: ["official"], q: a, limit: 10 }, 48);
    expect(cards.map((c) => c.slug)).toContain(a);
    expect(cards.find((c) => c.slug === a)?.isPromoted).toBe(true);
    expect((await searchHashtags(a.slice(0, 5), 5)).map((h) => h.slug)).toContain(a);

    await invalidateSuggestionCache();
    const picks = await pickPortalSuggestions(u.id, "for_you:");
    expect(picks.length).toBeGreaterThan(0);
    await followPortal(pa.id, u.id);
    await invalidateSuggestionCache();
    const after = await pickPortalSuggestions(u.id, "for_you:");
    expect(after.find((p) => p.slug === a)).toBeUndefined();
  });

  it("the Home Feed attaches a portal suggestion to a full page and skips it on short pages", async () => {
    if (!dbAvailable) return;
    const u = await seedUser();
    const slug = tag("feedportal");
    createdSlugs.push(slug);
    await upsertOfficialPortal({ slug, boostWeight: 100 }, u.id);
    await invalidateSuggestionCache();
    for (let i = 0; i < 9; i++) await seedTweet(u.id, `feed filler ${i}`);

    const full = await fetchFeedPage("new", u.id, null, 20);
    expect(full.items.length).toBeGreaterThanOrEqual(8);
    expect(full.portalSuggestion?.afterIndex).toBe(mockManifest.portals.feedSuggestionEvery);
    expect(full.portalSuggestion?.portals.length).toBeGreaterThan(0);
    expect(full.portalSuggestion!.portals.length).toBeLessThanOrEqual(mockManifest.portals.feedSuggestionMaxPortals);

    const short = await fetchFeedPage("new", u.id, null, 3);
    expect(short.portalSuggestion).toBeUndefined();

    const saved = mockManifest.features.portals;
    mockManifest.features.portals = false;
    expect((await fetchFeedPage("new", u.id, null, 20)).portalSuggestion).toBeUndefined();
    mockManifest.features.portals = saved;
  });

  it("a tag with content but no portal resolves to a read-only tag page; empty, blocked and merged tags behave", async () => {
    if (!dbAvailable) return;
    const u = await seedUser();
    const lonely = tag("lonely");
    const empty = tag("emptytag");
    const target = tag("survivor");
    const alias = tag("aliasof");
    createdSlugs.push(lonely, empty, target, alias);

    expect(await resolveTagPage(lonely)).toBeNull(); // unknown tag
    await seedTweet(u.id, `nobody made a portal for #${lonely}`);
    const page = await resolveTagPage(lonely.toUpperCase());
    expect(page?.canonicalSlug).toBe(lonely);
    expect(page?.row.status as string).toBe("tag");
    expect(page?.row.id).toBe(`tag:${page?.hashtagId}`);

    const payload = await getPortalPayload(page!.row);
    expect(payload.portal.status).toBe("tag");
    expect(payload.sections.feed.some((i) => i.contentType === "tweet")).toBe(true);

    // A tag that exists but has no visible content -> null.
    const orm = await getDb();
    await orm.execute(sql`INSERT INTO hashtags (slug, display) VALUES (${empty}, ${empty})`);
    expect(await resolveTagPage(empty)).toBeNull();

    // Blocked -> null.
    await setHashtagBlocked(lonely, true);
    expect(await resolveTagPage(lonely)).toBeNull();
    await setHashtagBlocked(lonely, false);

    // Merged alias resolves to the survivor's tag page.
    await seedTweet(u.id, `#${target} content`);
    await seedTweet(u.id, `#${alias} content`);
    await mergeHashtags(alias, target);
    expect((await resolveTagPage(alias))?.canonicalSlug).toBe(target);
  });

  it("the discovery hub payload lists featured, trending tags (with and without portals), places and popular portals", async () => {
    if (!dbAvailable) return;
    const u = await seedUser();
    const placeSlug = tag("place");
    const plainTag = tag("plainhot");
    createdSlugs.push(placeSlug, plainTag);
    await upsertOfficialPortal({ slug: placeSlug, city: "Benin", isPinned: true, title: "Place" }, u.id);
    await seedTweet(u.id, `in the place #${placeSlug}`);
    await seedTweet(u.id, `no portal yet #${plainTag}`);

    await invalidateSuggestionCache();
    const hub = await getDiscoverPayload();
    expect(hub.featured.map((p) => p.slug)).toContain(placeSlug);
    expect(hub.places.map((p) => p.slug)).toContain(placeSlug);
    expect(hub.newest.length).toBeGreaterThan(0);
    const tagsBySlug = new Map(hub.trendingTags.map((t) => [t.slug, t]));
    expect(tagsBySlug.get(plainTag)?.hasPortal).toBe(false);
    expect(tagsBySlug.get(placeSlug)?.hasPortal).toBe(true);
    // Cached: a second call returns the same snapshot.
    expect((await getDiscoverPayload()).generatedAt).toBe(hub.generatedAt);
  });
});
