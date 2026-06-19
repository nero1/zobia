/**
 * apps/web/lib/public/resolveRoom.ts
 *
 * Resolves a public room by its URL identifier for the crawlable SSR pages
 * (/r/<slug> rooms and /c/<slug> courses). Handles three cases so old links
 * never break:
 *
 *   1. Current slug          -> serve the room.
 *   2. Legacy /r/<uuid> link -> serve, and signal a 301 to the slug URL.
 *   3. Retired slug (rename) -> look up slug_redirects, 301 to the new slug.
 *
 * Only public, live rooms of the requested type(s) are returned; anything else
 * resolves to null so the route can render notFound() and never leak gated
 * content.
 */

import { db } from "@/lib/db";
import { looksLikeUuid } from "@zobia/shared/utils";
import { lookupSlugRedirect } from "@/lib/slug";

export interface PublicRoom {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  type: string;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
  creator_username: string | null;
}

export interface ResolvedRoom {
  room: PublicRoom;
  /**
   * When set, the request arrived via a legacy/retired identifier and the
   * route should issue a permanent redirect to this canonical slug.
   */
  canonicalRedirectSlug: string | null;
}

const SELECT = `
  SELECT r.id, r.slug, r.name, r.description, r.type, r.cover_image_url,
         r.created_at, r.updated_at, u.username AS creator_username
  FROM rooms r
  LEFT JOIN users u ON u.id = r.creator_id
  WHERE r.deleted_at IS NULL
    AND r.is_active = TRUE
    AND r.type = ANY($2::text[])
`;

async function queryBy(
  column: "slug" | "id",
  value: string,
  types: string[]
): Promise<PublicRoom | null> {
  const { rows } = await db.query<PublicRoom>(
    `${SELECT} AND r.${column} = $1 LIMIT 1`,
    [value, types]
  );
  return rows[0] ?? null;
}

/**
 * Resolve a public room.
 *
 * @param identifier  The slug (or legacy UUID) from the URL.
 * @param types       Allowed room types (e.g. ["free_open"] for /r,
 *                    ["classroom"] for /c).
 */
export async function resolvePublicRoom(
  identifier: string,
  types: string[]
): Promise<ResolvedRoom | null> {
  // 1. Current slug — the common case, served as-is.
  const bySlug = await queryBy("slug", identifier, types);
  if (bySlug) return { room: bySlug, canonicalRedirectSlug: null };

  // 2. Legacy /r/<uuid> link — serve, but ask the caller to 301 to the slug.
  if (looksLikeUuid(identifier)) {
    const byId = await queryBy("id", identifier, types);
    if (byId) {
      return { room: byId, canonicalRedirectSlug: byId.slug };
    }
  }

  // 3. Retired slug from a rename — follow the redirect record to the room.
  const redirect = await lookupSlugRedirect("room", identifier).catch(() => null);
  if (redirect) {
    const byId = await queryBy("id", redirect.entityId, types);
    if (byId) {
      return { room: byId, canonicalRedirectSlug: byId.slug };
    }
  }

  return null;
}
