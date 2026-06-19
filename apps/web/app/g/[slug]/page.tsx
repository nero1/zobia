/**
 * app/g/[slug]/page.tsx
 *
 * Public, SSR, crawlable game page at /g/<slug>.
 *
 * Games are an upcoming feature; this route + the `games` table give the URL
 * scheme and referral links (e.g. /g/tapontap?r=8732623) a real backing now.
 * Legacy UUID links and retired slugs 301-redirect to the canonical slug URL.
 *
 * Added to PUBLIC_PREFIXES in middleware.ts and listed in the sitemap.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { resolvePublicGame } from "@/lib/public/resolveGame";
import { NOT_FOUND_METADATA } from "@/lib/public/roomMetadata";
import GameCoverActions from "@/components/games/GameCoverActions";
import AdSlot from "@/components/ads/AdSlot";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolvePublicGame(slug).catch(() => null);
  if (!resolved) return NOT_FOUND_METADATA;

  const { game } = resolved;
  const title = `${game.name} — Zobia Social`;
  const description = game.tagline ?? game.description?.slice(0, 155) ?? `Play ${game.name} on Zobia Social.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: game.cover_image_url ? [{ url: game.cover_image_url }] : [],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: game.cover_image_url ? [game.cover_image_url] : [],
    },
    alternates: { canonical: `/g/${game.slug}` },
  };
}

export default async function PublicGamePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const resolved = await resolvePublicGame(slug).catch(() => null);

  if (!resolved) notFound();

  if (resolved.canonicalRedirectSlug && resolved.canonicalRedirectSlug !== slug) {
    redirect(`/g/${resolved.canonicalRedirectSlug}`);
  }

  const { game } = resolved;

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-12">
        {game.cover_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.cover_image_url}
            alt={`${game.name} cover`}
            className="w-full h-48 object-cover rounded-xl mb-6"
            width={800}
            height={192}
          />
        ) : (
          <div className="text-6xl text-center mb-6" aria-hidden="true">
            {game.cover_emoji}
          </div>
        )}

        <h1 className="text-3xl font-bold mb-2">{game.name}</h1>

        {game.tagline && (
          <p className="text-lg text-muted-foreground mb-4">{game.tagline}</p>
        )}

        {game.category && (
          <span className="mb-4 inline-block rounded-full bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-300">
            {game.category}
          </span>
        )}

        {(game.long_description || game.description) && (
          <p className="text-muted-foreground mb-6 whitespace-pre-wrap">
            {game.long_description || game.description}
          </p>
        )}

        {(game.reward_credits_per_win > 0 || game.reward_xp_per_win > 0 || game.reward_stars_per_win > 0) && (
          <p className="mb-6 text-sm font-medium text-emerald-500">
            Win to earn
            {game.reward_credits_per_win > 0 ? ` +${game.reward_credits_per_win} credits` : ""}
            {game.reward_xp_per_win > 0 ? ` +${game.reward_xp_per_win} XP` : ""}
            {game.reward_stars_per_win > 0 ? ` +${game.reward_stars_per_win} ⭐` : ""}
          </p>
        )}

        {(game.play_cost_credits > 0 || game.play_cost_stars > 0) && (
          <p className="mb-6 text-sm text-amber-500">
            Costs
            {game.play_cost_credits > 0 ? ` ${game.play_cost_credits} credits` : ""}
            {game.play_cost_stars > 0 ? ` ${game.play_cost_stars} ⭐` : ""} per play
          </p>
        )}

        <div className="my-8">
          <GameCoverActions slug={game.slug} name={game.name} />
        </div>

        <AdSlot placement="game-cover" />
      </div>
    </main>
  );
}
