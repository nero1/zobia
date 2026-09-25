/**
 * apps/web/lib/public/resolveWiki.ts
 *
 * Resolves a public wiki by its URL identifier for the crawlable /w/<slug>
 * page. Mirrors resolveBlog.ts: current slug, legacy UUID (301 to slug),
 * and retired slug via slug_redirects. Wikis are viewable while 'active' or
 * 'paused' (paused = read-only but still publicly browsable); suspended,
 * banned, deactivated, or deleted wikis 404 publicly.
 */

import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { looksLikeUuid } from "@zobia/shared/utils";
import { lookupSlugRedirect } from "@/lib/slug";

export interface PublicWiki {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  contribute_policy: string;
  status: string;
  page_count: number;
  contributor_count: number;
  view_count: number;
  owner_id: string;
  owner_username: string;
  owner_display_name: string | null;
  owner_avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResolvedWiki {
  wiki: PublicWiki;
  canonicalRedirectSlug: string | null;
}

async function queryBy(column: "slug" | "id", value: string): Promise<PublicWiki | null> {
  const orm = await getDb();
  const [row] = await orm
    .select({
      id: schema.wikis.id,
      slug: schema.wikis.slug,
      name: schema.wikis.name,
      description: schema.wikis.description,
      avatarUrl: schema.wikis.avatarUrl,
      coverImageUrl: schema.wikis.coverImageUrl,
      contributePolicy: schema.wikis.contributePolicy,
      status: schema.wikis.status,
      pageCount: schema.wikis.pageCount,
      contributorCount: schema.wikis.contributorCount,
      viewCount: schema.wikis.viewCount,
      ownerId: schema.wikis.ownerId,
      ownerUsername: schema.users.username,
      ownerDisplayName: schema.users.displayName,
      ownerAvatarUrl: schema.users.avatarUrl,
      createdAt: schema.wikis.createdAt,
      updatedAt: schema.wikis.updatedAt,
    })
    .from(schema.wikis)
    .innerJoin(schema.users, eq(schema.users.id, schema.wikis.ownerId))
    .where(
      and(
        isNull(schema.wikis.deletedAt),
        inArray(schema.wikis.status, ["active", "paused"]),
        column === "slug" ? eq(schema.wikis.slug, value) : eq(schema.wikis.id, value)
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    avatar_url: row.avatarUrl,
    cover_image_url: row.coverImageUrl,
    contribute_policy: row.contributePolicy,
    status: row.status,
    page_count: row.pageCount,
    contributor_count: row.contributorCount,
    view_count: row.viewCount,
    owner_id: row.ownerId,
    owner_username: row.ownerUsername,
    owner_display_name: row.ownerDisplayName,
    owner_avatar_url: row.ownerAvatarUrl,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function resolvePublicWiki(identifier: string): Promise<ResolvedWiki | null> {
  const bySlug = await queryBy("slug", identifier);
  if (bySlug) return { wiki: bySlug, canonicalRedirectSlug: null };

  if (looksLikeUuid(identifier)) {
    const byId = await queryBy("id", identifier);
    if (byId) return { wiki: byId, canonicalRedirectSlug: byId.slug };
  }

  const redirect = await lookupSlugRedirect("wiki", identifier).catch(() => null);
  if (redirect) {
    const byId = await queryBy("id", redirect.entityId);
    if (byId) return { wiki: byId, canonicalRedirectSlug: byId.slug };
  }

  return null;
}
