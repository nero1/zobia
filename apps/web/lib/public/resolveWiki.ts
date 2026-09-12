/**
 * apps/web/lib/public/resolveWiki.ts
 *
 * Resolves a public wiki by its URL identifier for the crawlable /w/<slug>
 * page. Mirrors resolveBlog.ts: current slug, legacy UUID (301 to slug),
 * and retired slug via slug_redirects. Wikis are viewable while 'active' or
 * 'paused' (paused = read-only but still publicly browsable); suspended,
 * banned, deactivated, or deleted wikis 404 publicly.
 */

import { db } from "@/lib/db";
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

const SELECT = `
  SELECT w.id, w.slug, w.name, w.description, w.avatar_url, w.cover_image_url,
         w.contribute_policy, w.status, w.page_count, w.contributor_count, w.view_count,
         w.owner_id, u.username AS owner_username, u.display_name AS owner_display_name, u.avatar_url AS owner_avatar_url,
         w.created_at, w.updated_at
  FROM wikis w
  JOIN users u ON u.id = w.owner_id
  WHERE w.deleted_at IS NULL AND w.status IN ('active', 'paused')
`;

async function queryBy(column: "slug" | "id", value: string): Promise<PublicWiki | null> {
  const { rows } = await db.query<PublicWiki>(`${SELECT} AND w.${column} = $1 LIMIT 1`, [value]);
  return rows[0] ?? null;
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
