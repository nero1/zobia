/**
 * apps/android/src/components/tweets/VideoEmbed.tsx
 *
 * Renders a Tweet's video embed inside the Capacitor WebView.
 *
 *  - YouTube: a standard privacy-enhanced iframe embed — this renders fine
 *    inside a Capacitor Android WebView (it's just cross-origin `<iframe>`
 *    content, same as any in-app browser).
 *  - TikTok: deliberately NOT using TikTok's `embed.js` blockquote-hydration
 *    embed here (unlike the web version in
 *    apps/web/components/tweets/VideoEmbed.tsx). That script injects a
 *    same-page `<iframe>` of its own and relies on third-party script
 *    execution + cookies that are unreliable inside an embedded Android
 *    WebView (no user gesture context, stricter third-party-cookie
 *    defaults, and TikTok's player occasionally refuses to mount at all in
 *    non-browser WebViews). Instead we show a lightweight "Watch on TikTok"
 *    card and open the real video in the system browser via
 *    `@capacitor/browser`'s in-app browser tab — reliable everywhere, at the
 *    cost of not auto-playing inline.
 */

import { Browser } from '@capacitor/browser';
import type { TweetVideoProvider } from './types';

export function VideoEmbed({
  provider,
  videoUrl,
  videoEmbedId,
}: {
  provider: TweetVideoProvider;
  videoUrl: string;
  videoEmbedId: string;
}) {
  if (provider === 'youtube') {
    return (
      <div className="mt-3 aspect-video w-full overflow-hidden rounded-xl border border-neutral-200">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoEmbedId}`}
          title="YouTube video"
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void Browser.open({ url: videoUrl })}
      className="mt-3 flex w-full items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-left"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-black text-xl text-white">🎵</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-neutral-900">Watch on TikTok</p>
        <p className="truncate text-xs text-neutral-500">{videoUrl}</p>
      </div>
      <span className="shrink-0 text-neutral-400">↗</span>
    </button>
  );
}
