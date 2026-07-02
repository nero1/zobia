/**
 * apps/web/lib/public/resolveBusinessPage.ts
 *
 * Resolves a public Business Page by its URL identifier for the crawlable
 * /p/<slug> page. Mirrors resolveBlog: current slug, legacy UUID (301 to
 * slug), and retired slug via slug_redirects. Only active pages belonging
 * to an active business account are returned — suspended/banned/
 * deactivated pages, or pages of a suspended business account, 404 publicly.
 */

import { db } from "@/lib/db";
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

const SELECT = `
  SELECT bp.id, bp.slug, bp.name, bp.bio, bp.avatar_url, bp.cover_image_url, bp.view_count, bp.post_count,
         bp.business_account_id, ba.business_name, ba.verified, ba.tier, bp.created_at
  FROM business_pages bp
  JOIN business_accounts ba ON ba.id = bp.business_account_id
  WHERE bp.deleted_at IS NULL AND bp.status = 'active' AND ba.status = 'active'
`;

async function queryBy(column: "slug" | "id", value: string): Promise<PublicBusinessPage | null> {
  const { rows } = await db.query<PublicBusinessPage>(`${SELECT} AND bp.${column} = $1 LIMIT 1`, [value]);
  return rows[0] ?? null;
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
