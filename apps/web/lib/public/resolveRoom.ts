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

import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq, inArray, isNull } from "drizzle-orm";
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

async function queryBy(
  column: "slug" | "id",
  value: string,
  types: string[]
): Promise<PublicRoom | null> {
  const orm = await getDb();
  const [row] = await orm
    .select({
      id: schema.rooms.id,
      slug: schema.rooms.slug,
      name: schema.rooms.name,
      description: schema.rooms.description,
      type: schema.rooms.type,
      coverImageUrl: schema.rooms.coverImageUrl,
      createdAt: schema.rooms.createdAt,
      updatedAt: schema.rooms.updatedAt,
      creatorUsername: schema.users.username,
    })
    .from(schema.rooms)
    .leftJoin(schema.users, eq(schema.users.id, schema.rooms.creatorId))
    .where(
      and(
        isNull(schema.rooms.deletedAt),
        eq(schema.rooms.isActive, true),
        inArray(schema.rooms.type, types),
        column === "slug" ? eq(schema.rooms.slug, value) : eq(schema.rooms.id, value)
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    type: row.type,
    cover_image_url: row.coverImageUrl,
    created_at: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
    updated_at: row.updatedAt ? row.updatedAt.toISOString() : new Date().toISOString(),
    creator_username: row.creatorUsername,
  };
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
