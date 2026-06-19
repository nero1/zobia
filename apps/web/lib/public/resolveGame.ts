/**
 * apps/web/lib/public/resolveGame.ts
 *
 * Resolves a public game by its URL identifier for the crawlable /g/<slug>
 * page. Mirrors resolveRoom: current slug, legacy UUID (301 to slug), and
 * retired slug via slug_redirects. Only public, live games are returned.
 */

import { db } from "@/lib/db";
import { looksLikeUuid } from "@zobia/shared/utils";
import { lookupSlugRedirect } from "@/lib/slug";

export interface PublicGame {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  cover_image_url: string | null;
  cover_emoji: string;
  created_at: string;
  updated_at: string;
}

export interface ResolvedGame {
  game: PublicGame;
  canonicalRedirectSlug: string | null;
}

const SELECT = `
  SELECT id, slug, name, tagline, description, cover_image_url, cover_emoji,
         created_at, updated_at
  FROM games
  WHERE deleted_at IS NULL
    AND is_active = TRUE
    AND is_public = TRUE
`;

async function queryBy(column: "slug" | "id", value: string): Promise<PublicGame | null> {
  const { rows } = await db.query<PublicGame>(`${SELECT} AND ${column} = $1 LIMIT 1`, [value]);
  return rows[0] ?? null;
}

export async function resolvePublicGame(identifier: string): Promise<ResolvedGame | null> {
  const bySlug = await queryBy("slug", identifier);
  if (bySlug) return { game: bySlug, canonicalRedirectSlug: null };

  if (looksLikeUuid(identifier)) {
    const byId = await queryBy("id", identifier);
    if (byId) return { game: byId, canonicalRedirectSlug: byId.slug };
  }

  const redirect = await lookupSlugRedirect("game", identifier).catch(() => null);
  if (redirect) {
    const byId = await queryBy("id", redirect.entityId);
    if (byId) return { game: byId, canonicalRedirectSlug: byId.slug };
  }

  return null;
}
