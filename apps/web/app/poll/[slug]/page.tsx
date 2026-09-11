/**
 * app/poll/[slug]/page.tsx
 *
 * Public, SSR, crawlable poll page at /poll/<slug>. Mirrors app/b/[slug]/[postSlug]/page.tsx's
 * structure: resolve directly from the service layer (not the API route),
 * an optional viewer via getOptionalServerUser(), a JSON-LD block, and
 * interactive bits (voting, sharing, funding) hydrated client-side.
 *
 * 404s (via notFound()) when the poll doesn't exist or is disabled.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPollBySlug, recordPollView, getPollTreasury } from "@/lib/polls/service";
import { getOptionalServerUser } from "@/lib/auth/serverUser";
import { generateStructuredData } from "@/lib/seo/metadata";
import { formatShortDate } from "@/lib/format/date";
import { Avatar } from "@/components/ui/Avatar";
import { PollVoteCard } from "@/components/polls/PollVoteCard";
import { PollShareButton } from "@/components/polls/PollShareButton";
import { FundTreasuryModal } from "@/components/polls/FundTreasuryModal";

const DEFAULT_OG_IMAGE = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app"}/og-default.png`;

const NOT_FOUND_METADATA: Metadata = {
  title: "Poll not found — Zobia Social",
  description: "This poll doesn't exist or is no longer available.",
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const poll = await getPollBySlug(slug).catch(() => null);
  if (!poll || poll.status === "disabled") return NOT_FOUND_METADATA;

  const title = `${poll.title} — Poll — Zobia Social`;
  const description = poll.description?.slice(0, 155) ?? `Vote on "${poll.title}" — a poll by @${poll.creatorUsername ?? "a Zobia Social user"}.`;

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: DEFAULT_OG_IMAGE }], type: "website", siteName: "Zobia Social" },
    twitter: { card: "summary_large_image", title, description, images: [DEFAULT_OG_IMAGE] },
    alternates: { canonical: `/poll/${poll.slug}` },
  };
}

export default async function PublicPollPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const viewer = await getOptionalServerUser();
  const poll = await getPollBySlug(slug, viewer?.userId ?? null).catch(() => null);
  if (!poll || poll.status === "disabled") notFound();

  // Fire and forget — never block render on the view counter.
  void recordPollView(poll.id);

  const treasury = await getPollTreasury(poll.id).catch(() => null);
  const treasuryActive = !!treasury && treasury.status === "active" && treasury.claimantCount < treasury.maxClaimants;

  const totalVotes = poll.options.reduce((sum, o) => sum + o.voteCount, 0);
  const pageUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app"}/poll/${poll.slug}`;

  const schema = generateStructuredData("Thing", {
    "@type": "ItemList",
    name: poll.title,
    description: poll.description ?? undefined,
    url: pageUrl,
    numberOfItems: poll.options.length,
    itemListElement: poll.options.map((o, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: o.label,
    })),
  });

  return (
    <main className="min-h-screen bg-background">
      {/* eslint-disable-next-line react/no-danger */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: schema }} />
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Link href="/polls" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Polls
        </Link>

        <header className="mt-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>📊 Poll</span>
            {poll.status === "closed" && <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-neutral-300">Closed</span>}
          </div>
          <h1 className="mt-2 text-3xl font-bold text-foreground">{poll.title}</h1>
          {poll.description && <p className="mt-2 text-muted-foreground">{poll.description}</p>}
        </header>

        <div className="mt-4 flex items-center gap-3 rounded-xl border border-border bg-card p-3">
          <Avatar src={poll.creatorAvatarUrl} name={poll.creatorUsername ?? "?"} size="sm" rankTier="none" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">@{poll.creatorUsername ?? "unknown"}</div>
            <div className="text-xs text-muted-foreground">{formatShortDate(poll.createdAt)}</div>
          </div>
        </div>

        {treasuryActive && treasury && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-300">
            🎁 Powered by a reward pot: {treasury.rewardPerClaimant} credits each for the next {treasury.maxClaimants - treasury.claimantCount} people who vote!
          </div>
        )}

        <div className="mt-6">
          <PollVoteCard poll={poll} viewerSignedIn={!!viewer} />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            {poll.voterCount} {poll.voterCount === 1 ? "voter" : "voters"} · {totalVotes} {totalVotes === 1 ? "vote" : "votes"} · 👁 {poll.viewCount} views
          </div>
          <PollShareButton slug={poll.slug} />
        </div>

        {poll.isOwner && (
          <div className="mt-8 rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Owner tools</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Fund a reward pot so the first people who vote (or share) split it evenly, in credits.
            </p>
            <div className="mt-3">
              <FundTreasuryModal contentType="poll" slug={poll.slug} initialTreasury={treasury} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
