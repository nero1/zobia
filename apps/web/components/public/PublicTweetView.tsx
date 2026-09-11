/**
 * components/public/PublicTweetView.tsx
 *
 * Presentational, server-rendered view for a public Tweet, shown at the
 * crawlable /t/<tweetId> page. Mirrors components/public/PublicForumQuestionView.tsx's
 * markup/CTA pattern so all public SEO surfaces feel consistent.
 */

import type { PublicTweet } from "@/lib/public/resolveTweet";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

function TweetBody({ tweet }: { tweet: PublicTweet }) {
  return (
    <>
      {tweet.content && <p className="mb-4 whitespace-pre-wrap text-foreground">{tweet.content}</p>}
      {tweet.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tweet.image_url} alt="" className="mb-4 max-h-96 w-full rounded-2xl object-cover" />
      )}
      {tweet.video_provider && tweet.video_embed_id && (
        <div className="mb-4 aspect-video w-full overflow-hidden rounded-2xl">
          <iframe
            src={
              tweet.video_provider === "youtube"
                ? `https://www.youtube.com/embed/${tweet.video_embed_id}`
                : `https://www.tiktok.com/embed/v2/${tweet.video_embed_id}`
            }
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
    </>
  );
}

export function PublicTweetView({ tweet }: { tweet: PublicTweet }) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-lg">
            {tweet.author_avatar_emoji ?? "🐦"}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {tweet.author_display_name ?? tweet.author_username}
            </p>
            <p className="text-xs text-muted-foreground">@{tweet.author_username} · {timeAgo(tweet.created_at)}</p>
          </div>
        </div>

        <TweetBody tweet={tweet} />

        <p className="mb-8 text-sm text-muted-foreground">
          {tweet.likes_count} {tweet.likes_count === 1 ? "like" : "likes"} · {tweet.retweets_count}{" "}
          {tweet.retweets_count === 1 ? "retweet" : "retweets"} · {tweet.replies_count}{" "}
          {tweet.replies_count === 1 ? "reply" : "replies"}
        </p>

        {tweet.top_replies.length > 0 && (
          <div className="mb-10 space-y-4">
            <h2 className="text-lg font-semibold">Replies</h2>
            {tweet.top_replies.map((reply) => (
              <div key={reply.id} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
                <TweetBody tweet={reply} />
                <p className="text-xs text-muted-foreground">
                  {reply.author_display_name ?? reply.author_username} · {timeAgo(reply.created_at)}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* CTA */}
        <div className="text-center">
          <a
            href="/auth/login"
            className="inline-block rounded-lg bg-primary px-6 py-2 font-medium text-primary-foreground transition hover:opacity-90"
          >
            Join Zobia Social to reply, like, or retweet
          </a>
        </div>
      </div>
    </main>
  );
}
