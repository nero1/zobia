/**
 * lib/portals/tagPage.ts
 *
 * "Tag pages": `/h/<slug>` for a hashtag that has visible content but no
 * portal row. Most tags never become portals (auto needs a burst of posts from
 * several authors, official needs an admin), yet every `#tag` in a Tweet links
 * here, so without this fallback most hashtag links would 404.
 *
 * A tag page is a *virtual portal*: a synthetic PortalRow (never stored) fed
 * through the normal page builder, so it gets the same sections and the same
 * two-tier cache (keyed `tag:<hashtagId>`). It has status "tag": no follow, no
 * admin copy, noindex.
 */

import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { normaliseHashtag } from "@zobia/shared/utils";
import { DEFAULT_PORTAL_SECTIONS } from "./constants";
import { fetchTaggedFeed } from "./content";
import type { PortalRow } from "./repo";

export interface ResolvedTagPage {
  hashtagId: string;
  /** Canonical (alias-resolved) slug. */
  canonicalSlug: string;
  display: string;
  row: PortalRow;
}

/** Cache/identity id of a virtual portal. */
export function tagPageId(hashtagId: string): string {
  return `tag:${hashtagId}`;
}

export function isVirtualPortalId(id: string): boolean {
  return id.startsWith("tag:");
}

function virtualRow(hashtagId: string, slug: string, display: string): PortalRow {
  const now = new Date();
  return {
    id: tagPageId(hashtagId),
    slug,
    hashtagId,
    title: `#${display}`,
    tagline: null,
    description: null,
    coverImageUrl: null,
    accentColor: null,
    // Not a real PortalStatus; typed loosely because the row is never persisted.
    status: "tag" as unknown as PortalRow["status"],
    sections: DEFAULT_PORTAL_SECTIONS,
    bbBoardId: null,
    city: null,
    isPinned: false,
    boostWeight: 0,
    boostStartsAt: null,
    boostEndsAt: null,
    sponsoredUntil: null,
    sponsorName: null,
    followerCount: 0,
    lastActivityAt: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Resolve a hashtag that has no portal into a virtual portal. Returns null when
 * the tag is unknown, blocked, or has no visible content at all (the only case
 * that should 404).
 */
export async function resolveTagPage(rawSlug: string): Promise<ResolvedTagPage | null> {
  const slug = normaliseHashtag(rawSlug);
  if (!slug) return null;
  const orm = await getDb();

  const [tag] = await orm
    .select({ id: schema.hashtags.id, slug: schema.hashtags.slug, display: schema.hashtags.display, aliasOf: schema.hashtags.aliasOf, isBlocked: schema.hashtags.isBlocked })
    .from(schema.hashtags)
    .where(eq(schema.hashtags.slug, slug))
    .limit(1);
  if (!tag || tag.isBlocked) return null;

  let target = { id: tag.id, slug: tag.slug, display: tag.display };
  if (tag.aliasOf) {
    const [survivor] = await orm
      .select({ id: schema.hashtags.id, slug: schema.hashtags.slug, display: schema.hashtags.display, isBlocked: schema.hashtags.isBlocked })
      .from(schema.hashtags)
      .where(eq(schema.hashtags.id, tag.aliasOf))
      .limit(1);
    if (!survivor || survivor.isBlocked) return null;
    target = { id: survivor.id, slug: survivor.slug, display: survivor.display };
  }

  // Needs at least one visible thing: a feed item (same visibility rules as the
  // portal feed) or a tagged, live guild (guilds are not feed items).
  const feed = await fetchTaggedFeed(target.id, { sort: "new", limit: 1 });
  let hasContent = feed.items.length > 0;
  if (!hasContent) {
    const { rows } = await orm.execute<{ one: number } & Record<string, unknown>>(sql`
      SELECT 1 AS one FROM content_hashtags ch JOIN guilds g ON g.id = ch.content_id
      WHERE ch.hashtag_id = ${target.id} AND ch.content_type = 'guild' AND g.is_active = true AND g.deleted_at IS NULL
      LIMIT 1
    `);
    hasContent = rows.length > 0;
  }
  if (!hasContent) return null;

  return { hashtagId: target.id, canonicalSlug: target.slug, display: target.display, row: virtualRow(target.id, target.slug, target.display) };
}

/** True when a portal row exists for this hashtag (used to avoid showing a tag page for a real portal). */
export async function hashtagHasPortal(hashtagId: string): Promise<boolean> {
  const orm = await getDb();
  const [row] = await orm.select({ id: schema.portals.id }).from(schema.portals).where(and(eq(schema.portals.hashtagId, hashtagId))).limit(1);
  return !!row;
}
