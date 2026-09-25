/**
 * apps/web/lib/public/resolveBusinessPage.ts
 *
 * Resolves a public Business Page by its URL identifier for the crawlable
 * /p/<slug> page. Mirrors resolveBlog: current slug, legacy UUID (301 to
 * slug), and retired slug via slug_redirects. Only active pages belonging
 * to an active business account are returned — suspended/banned/
 * deactivated pages, or pages of a suspended business account, 404 publicly.
 */

import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import { looksLikeUuid } from "@zobia/shared/utils";
import { lookupSlugRedirect } from "@/lib/slug";

export interface PublicBusinessPage {
  id: string;
  slug: string;
  name: string;
  bio: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  view_count: number;
  post_count: number;
  business_account_id: string;
  business_name: string;
  verified: boolean;
  tier: string;
  created_at: string;
}

export interface ResolvedBusinessPage {
  page: PublicBusinessPage;
  canonicalRedirectSlug: string | null;
}

async function queryBy(column: "slug" | "id", value: string): Promise<PublicBusinessPage | null> {
  const orm = await getDb();
  const [row] = await orm
    .select({
      id: schema.businessPages.id,
      slug: schema.businessPages.slug,
      name: schema.businessPages.name,
      bio: schema.businessPages.bio,
      avatarUrl: schema.businessPages.avatarUrl,
      coverImageUrl: schema.businessPages.coverImageUrl,
      viewCount: schema.businessPages.viewCount,
      postCount: schema.businessPages.postCount,
      businessAccountId: schema.businessPages.businessAccountId,
      businessName: schema.businessAccounts.businessName,
      verified: schema.businessAccounts.verified,
      tier: schema.businessAccounts.tier,
      createdAt: schema.businessPages.createdAt,
    })
    .from(schema.businessPages)
    .innerJoin(schema.businessAccounts, eq(schema.businessAccounts.id, schema.businessPages.businessAccountId))
    .where(
      and(
        isNull(schema.businessPages.deletedAt),
        eq(schema.businessPages.status, "active"),
        eq(schema.businessAccounts.status, "active"),
        column === "slug" ? eq(schema.businessPages.slug, value) : eq(schema.businessPages.id, value)
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    bio: row.bio,
    avatar_url: row.avatarUrl,
    cover_image_url: row.coverImageUrl,
    view_count: row.viewCount,
    post_count: row.postCount,
    business_account_id: row.businessAccountId,
    business_name: row.businessName,
    verified: row.verified ?? false,
    tier: row.tier,
    created_at: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
  };
}

export async function resolvePublicBusinessPage(identifier: string): Promise<ResolvedBusinessPage | null> {
  const bySlug = await queryBy("slug", identifier);
  if (bySlug) return { page: bySlug, canonicalRedirectSlug: null };

  if (looksLikeUuid(identifier)) {
    const byId = await queryBy("id", identifier);
    if (byId) return { page: byId, canonicalRedirectSlug: byId.slug };
  }

  const redirect = await lookupSlugRedirect("business_page", identifier).catch(() => null);
  if (redirect) {
    const byId = await queryBy("id", redirect.entityId);
    if (byId) return { page: byId, canonicalRedirectSlug: byId.slug };
  }

  return null;
}
