/**
 * apps/web/lib/public/resolveGame.ts
 *
 * Resolves a public game by its URL identifier for the crawlable /g/<slug>
 * page. Mirrors resolveRoom: current slug, legacy UUID (301 to slug), and
 * retired slug via slug_redirects. Only public, live games are returned.
 */

import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq, isNull } from "drizzle-orm";
import { looksLikeUuid } from "@zobia/shared/utils";
import { lookupSlugRedirect } from "@/lib/slug";

export interface PublicGame {
  id: string;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  long_description: string | null;
  category: string | null;
  cover_image_url: string | null;
  cover_emoji: string;
  engine_key: string | null;
  reward_credits_per_win: number;
  reward_xp_per_win: number;
  reward_stars_per_win: number;
  play_cost_credits: number;
  play_cost_stars: number;
  created_at: string;
  updated_at: string;
}

export interface ResolvedGame {
  game: PublicGame;
  canonicalRedirectSlug: string | null;
}

type GameRow = typeof schema.games.$inferSelect;

function toPublicGame(row: GameRow): PublicGame {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    long_description: row.longDescription,
    category: row.category,
    cover_image_url: row.coverImageUrl,
    cover_emoji: row.coverEmoji,
    engine_key: row.engineKey,
    reward_credits_per_win: row.rewardCreditsPerWin,
    reward_xp_per_win: row.rewardXpPerWin,
    reward_stars_per_win: row.rewardStarsPerWin,
    play_cost_credits: row.playCostCredits,
    play_cost_stars: row.playCostStars,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

async function queryBy(column: "slug" | "id", value: string): Promise<PublicGame | null> {
  const orm = await getDb();
  const [row] = await orm
    .select()
    .from(schema.games)
    .where(
      and(
        isNull(schema.games.deletedAt),
        eq(schema.games.isActive, true),
        eq(schema.games.isPublic, true),
        column === "slug" ? eq(schema.games.slug, value) : eq(schema.games.id, value)
      )
    )
    .limit(1);
  return row ? toPublicGame(row) : null;
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
