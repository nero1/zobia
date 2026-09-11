"use client";

/**
 * components/tweets/VideoEmbed.tsx
 *
 * Renders a Tweet's video embed.
 *  - YouTube: a standard privacy-enhanced (`youtube-nocookie.com`) iframe embed.
 *  - TikTok: TikTok's official public embed — a `<blockquote class="tiktok-embed">`
 *    that `embed.js` (loaded once, lazily, per page) hydrates into a player.
 *    No API key required; this is TikTok's documented oEmbed-less embed method.
 */

import { useEffect, useRef } from "react";
import type { TweetVideoProvider } from "./types";

declare global {
  interface Window {
    tiktokEmbedLoaded?: boolean;
  }
}

let tiktokScriptPromise: Promise<void> | null = null;

/** Loads TikTok's embed.js exactly once per page, reused by every TikTok embed. */
function loadTikTokScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.tiktokEmbedLoaded) return Promise.resolve();
  if (tiktokScriptPromise) return tiktokScriptPromise;

  tiktokScriptPromise = new Promise((resolve) => {
    const existing = document.querySelector('script[src="https://www.tiktok.com/embed.js"]');
    if (existing) {
      window.tiktokEmbedLoaded = true;
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://www.tiktok.com/embed.js";
    script.async = true;
    script.onload = () => {
      window.tiktokEmbedLoaded = true;
      resolve();
    };
    script.onerror = () => resolve(); // Non-fatal — falls back to the static blockquote/link
    document.body.appendChild(script);
  });
  return tiktokScriptPromise;
}

export function VideoEmbed({
  provider,
  videoUrl,
  videoEmbedId,
}: {
  provider: TweetVideoProvider;
  videoUrl: string;
  videoEmbedId: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (provider !== "tiktok") return;
    void loadTikTokScript().then(() => {
      // Re-processing an already-hydrated embed is a no-op for TikTok's script,
      // but a freshly-mounted blockquote (e.g. after client-side navigation)
      // needs the script's global reprocessor called again.
      const w = window as unknown as { tiktokEmbed?: { lib?: { render?: (el: HTMLElement) => void } } };
      if (containerRef.current && w.tiktokEmbed?.lib?.render) {
        w.tiktokEmbed.lib.render(containerRef.current);
      }
    });
  }, [provider, videoEmbedId]);

  if (provider === "youtube") {
    return (
      <div className="mt-3 aspect-video w-full overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoEmbedId}`}
          title="YouTube video"
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="mt-3 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
      <blockquote
        className="tiktok-embed"
        cite={videoUrl}
        data-video-id={videoEmbedId}
        style={{ maxWidth: "100%", minWidth: 0, margin: 0 }}
      >
        <section>
          <a href={videoUrl} target="_blank" rel="noopener noreferrer">
            View on TikTok
          </a>
        </section>
      </blockquote>
    </div>
  );
}
