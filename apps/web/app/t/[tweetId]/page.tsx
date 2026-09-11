/**
 * app/t/[tweetId]/page.tsx
 *
 * Public, SSR, crawlable Tweet page at /t/<tweetId> — the short-URL
 * counterpart to /a/<slug> for Answers and /b/<slug> for Blogs.
 *
 * Only visible (non-deleted, non-deleted-author) Tweets are servable here;
 * anything else resolves to 404 so removed content is never exposed. The
 * interactive, authenticated experience (like, reply, retweet, threading)
 * lives at /tweets/<id> — this page is a lightweight public preview + CTA,
 * matching how /a/<slug> relates to /answers/<id>.
 *
 * Tweets have no slug (see db/migrations/0039_tweets.sql) — the id is the
 * only identifier, so unlike /a/<slug> there's no legacy-uuid redirect case.
 *
 * Added to PUBLIC_PREFIXES in middleware.ts so crawlers are not redirected to
 * login. Listed in the sitemap at the same path.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolvePublicTweet } from "@/lib/public/resolveTweet";
import { buildTweetMetadata, NOT_FOUND_METADATA } from "@/lib/public/tweetMetadata";
import { PublicTweetView } from "@/components/public/PublicTweetView";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ tweetId: string }>;
}): Promise<Metadata> {
  const { tweetId } = await params;
  const tweet = await resolvePublicTweet(tweetId).catch(() => null);
  if (!tweet) return NOT_FOUND_METADATA;
  return buildTweetMetadata(tweet);
}

export default async function PublicTweetPage({
  params,
}: {
  params: Promise<{ tweetId: string }>;
}) {
  const { tweetId } = await params;
  const tweet = await resolvePublicTweet(tweetId).catch(() => null);
  if (!tweet) notFound();

  return <PublicTweetView tweet={tweet} />;
}
