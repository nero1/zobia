/**
 * apps/web/lib/public/resolveBlog.ts
 *
 * Resolves a public blog by its URL identifier for the crawlable /b/<slug>
 * page. Mirrors resolveGame/resolveRoom: current slug, legacy UUID (301 to
 * slug), and retired slug via slug_redirects. Only active, live blogs are
 * returned — suspended/banned/deactivated/deleted blogs 404 publicly.
 */

import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import { looksLikeUuid } from "@zobia/shared/utils";
import { lookupSlugRedirect } from "@/lib/slug";
import { normalizeMenuConfig, type BlogMenuConfig } from "@/lib/blogs/menu";

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
  menu_config: BlogMenuConfig;
  active_theme_id: string;
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

async function queryBy(column: "slug" | "id", value: string): Promise<PublicBlog | null> {
  const orm = await getDb();
  const [row] = await orm
    .select({
      id: schema.blogs.id,
      slug: schema.blogs.slug,
      title: schema.blogs.title,
      tagline: schema.blogs.tagline,
      description: schema.blogs.description,
      avatarUrl: schema.blogs.avatarUrl,
      coverImageUrl: schema.blogs.coverImageUrl,
      showSubscriberCount: schema.blogs.showSubscriberCount,
      hideAuthorInfo: schema.blogs.hideAuthorInfo,
      commentsEnabled: schema.blogs.commentsEnabled,
      subscriberCount: schema.blogs.subscriberCount,
      postCount: schema.blogs.postCount,
      menuConfig: schema.blogs.menuConfig,
      activeThemeId: schema.blogs.activeThemeId,
      ownerId: schema.blogs.ownerId,
      ownerUsername: schema.users.username,
      ownerDisplayName: schema.users.displayName,
      ownerAvatarUrl: schema.users.avatarUrl,
      createdAt: schema.blogs.createdAt,
      updatedAt: schema.blogs.updatedAt,
    })
    .from(schema.blogs)
    .innerJoin(schema.users, eq(schema.users.id, schema.blogs.ownerId))
    .where(
      and(
        isNull(schema.blogs.deletedAt),
        eq(schema.blogs.status, "active"),
        column === "slug" ? eq(schema.blogs.slug, value) : eq(schema.blogs.id, value)
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    tagline: row.tagline,
    description: row.description,
    avatar_url: row.avatarUrl,
    cover_image_url: row.coverImageUrl,
    show_subscriber_count: row.showSubscriberCount,
    hide_author_info: row.hideAuthorInfo,
    comments_enabled: row.commentsEnabled,
    subscriber_count: row.subscriberCount,
    post_count: row.postCount,
    menu_config: normalizeMenuConfig(row.menuConfig),
    active_theme_id: row.activeThemeId,
    owner_id: row.ownerId,
    owner_username: row.ownerUsername,
    owner_display_name: row.ownerDisplayName,
    owner_avatar_url: row.ownerAvatarUrl,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
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
