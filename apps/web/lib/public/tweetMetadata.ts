/**
 * apps/web/lib/public/tweetMetadata.ts
 *
 * Open Graph / Twitter metadata builder for the public Tweet page (/t/<id>),
 * mirroring lib/public/forumMetadata.ts's pattern for Answers questions.
 */

import type { Metadata } from "next";
import type { PublicTweet } from "@/lib/public/resolveTweet";

export { NOT_FOUND_METADATA } from "@/lib/public/roomMetadata";

function snippet(tweet: PublicTweet): string {
  if (tweet.content) return tweet.content.slice(0, 155);
  if (tweet.image_url) return "Shared an image on Zobia Social.";
  if (tweet.video_provider) return "Shared a video on Zobia Social.";
  return "A Tweet on Zobia Social.";
}

export function buildTweetMetadata(tweet: PublicTweet): Metadata {
  const author = tweet.author_display_name ?? tweet.author_username;
  const title = `${author} on Zobia Social: "${snippet(tweet)}"`;
  const description = snippet(tweet);
  const image = tweet.image_url ?? undefined;

  return {
    title,
    description,
    keywords: ["Tweets", "Zobia Social", author],
    openGraph: {
      title,
      description,
      type: "article",
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
    alternates: {
      canonical: `/t/${tweet.id}`,
    },
    other: { "zobia:surface": "tweet" },
  };
}
