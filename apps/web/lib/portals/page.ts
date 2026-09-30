/**
 * lib/portals/page.ts
 *
 * Builds the viewer-independent payload of a portal page (header + every
 * section) and serves it through the two-tier cache. Viewer-specific state
 * (am I following?) is NOT part of the cached payload; it is fetched
 * separately by the route so one cached payload serves every viewer.
 *
 * Disabled sections are not queried at all, and empty ones cost one cheap
 * indexed query; the UI hides any section that came back empty.
 *
 * @module lib/portals/page
 */

import { loadManifest } from "@/lib/manifest";
import type { PortalPayload, PortalSections } from "@zobia/types";
import { getCachedPortalValue } from "./cache";
import { normalizeSections } from "./constants";
import {
  fetchBoardThreads,
  fetchForumBoard,
  fetchPortalGuilds,
  fetchPortalPeople,
  fetchPortalRooms,
  fetchSectionItems,
  fetchTaggedFeed,
} from "./content";
import { getActivityCounts, toPortalCard, type PortalRow } from "./repo";
import { getDb, schema } from "@/lib/db/drizzle";
import { eq } from "drizzle-orm";

const FEED_SIZE = 12;
const SECTION_SIZE = 6;

async function build(row: PortalRow): Promise<PortalPayload> {
  const sections = normalizeSections(row.sections);
  const on = new Set(sections.filter((s) => s.enabled).map((s) => s.key));
  const manifest = await loadManifest();

  const orm = await getDb();
  const [tag] = await orm.select({ slug: schema.hashtags.slug }).from(schema.hashtags).where(eq(schema.hashtags.id, row.hashtagId)).limit(1);

  const empty = Promise.resolve([]);
  const [activity, feed, rooms, guilds, people, forumBoard, taggedThreads, wiki, questions, blogs, polls] = await Promise.all([
    getActivityCounts([row.hashtagId], manifest.portals.trendingWindowHours),
    on.has("feed") ? fetchTaggedFeed(row.hashtagId, { sort: "top", limit: FEED_SIZE }).then((p) => p.items) : empty,
    on.has("rooms") ? fetchPortalRooms(row.hashtagId, row.city) : empty,
    on.has("guilds") ? fetchPortalGuilds(row.hashtagId, row.city) : empty,
    on.has("people") ? fetchPortalPeople(row.hashtagId) : empty,
    on.has("forum") ? fetchForumBoard(row.bbBoardId) : Promise.resolve(null),
    on.has("forum") ? fetchSectionItems(row.hashtagId, ["forum_thread"], SECTION_SIZE) : empty,
    on.has("wiki") ? fetchSectionItems(row.hashtagId, ["wiki_page"], SECTION_SIZE) : empty,
    on.has("questions") ? fetchSectionItems(row.hashtagId, ["forum_question"], SECTION_SIZE) : empty,
    on.has("blogs") ? fetchSectionItems(row.hashtagId, ["blog_post"], SECTION_SIZE) : empty,
    on.has("polls") ? fetchSectionItems(row.hashtagId, ["poll", "quiz"], SECTION_SIZE) : empty,
  ]);

  // An official board's own threads lead the forum section, then tagged threads.
  let forum = taggedThreads;
  if (forumBoard) {
    const boardThreads = await fetchBoardThreads(forumBoard.id, SECTION_SIZE);
    const seen = new Set(boardThreads.map((t) => t.contentId));
    forum = [...boardThreads, ...taggedThreads.filter((t) => !seen.has(t.contentId))].slice(0, SECTION_SIZE);
  }

  const payloadSections: PortalSections = { feed, rooms, guilds, people, forumBoard, forum, wiki, questions, blogs, polls };
  return {
    portal: {
      ...toPortalCard(row, activity.get(row.hashtagId) ?? 0),
      description: row.description,
      city: row.city,
      sections,
      hashtag: tag?.slug ?? row.slug,
      isPinned: row.isPinned,
      createdAt: row.createdAt.toISOString(),
    },
    sections: payloadSections,
    generatedAt: new Date().toISOString(),
  };
}

export async function getPortalPayload(row: PortalRow): Promise<PortalPayload> {
  return getCachedPortalValue<PortalPayload>(row.id, () => build(row));
}
