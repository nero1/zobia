/**
 * apps/web/lib/public/resolveBlog.ts
 *
 * Resolves a public blog by its URL identifier for the crawlable /b/<slug>
 * page. Mirrors resolveGame/resolveRoom: current slug, legacy UUID (301 to
 * slug), and retired slug via slug_redirects. Only active, live blogs are
 * returned — suspended/banned/deactivated/deleted blogs 404 publicly.
 */

import { db } from "@/lib/db";
import { looksLikeUuid } from "@zobia/shared/utils";
import { lookupSlugRedirect } from "@/lib/slug";

export interface PublicBlog {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  show_subscriber_count: boolean;
  hide_author_info: boolean;
  comments_enabled: boolean;
  subscriber_count: number;
  post_count: number;
  owner_id: string;
  owner_username: string;
  owner_display_name: string;
  owner_avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResolvedBlog {
  blog: PublicBlog;
  canonicalRedirectSlug: string | null;
}

const SELECT = `
  SELECT b.id, b.slug, b.title, b.tagline, b.description, b.avatar_url, b.cover_image_url,
         b.show_subscriber_count, b.hide_author_info, b.comments_enabled, b.subscriber_count, b.post_count,
         b.owner_id, u.username AS owner_username, u.display_name AS owner_display_name, u.avatar_url AS owner_avatar_url,
         b.created_at, b.updated_at
  FROM blogs b
  JOIN users u ON u.id = b.owner_id
  WHERE b.deleted_at IS NULL AND b.status = 'active'
`;

async function queryBy(column: "slug" | "id", value: string): Promise<PublicBlog | null> {
  const { rows } = await db.query<PublicBlog>(`${SELECT} AND b.${column} = $1 LIMIT 1`, [value]);
  return rows[0] ?? null;
}

export async function resolvePublicBlog(identifier: string): Promise<ResolvedBlog | null> {
  const bySlug = await queryBy("slug", identifier);
  if (bySlug) return { blog: bySlug, canonicalRedirectSlug: null };

  if (looksLikeUuid(identifier)) {
    const byId = await queryBy("id", identifier);
    if (byId) return { blog: byId, canonicalRedirectSlug: byId.slug };
  }

  const redirect = await lookupSlugRedirect("blog", identifier).catch(() => null);
  if (redirect) {
    const byId = await queryBy("id", redirect.entityId);
    if (byId) return { blog: byId, canonicalRedirectSlug: byId.slug };
  }

  return null;
}
