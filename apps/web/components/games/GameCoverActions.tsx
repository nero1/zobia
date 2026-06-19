"use client";

/**
 * components/games/GameCoverActions.tsx
 *
 * The interactive footer of the public /g/<slug> cover page.
 *  - Guests see "Log in to play" buttons (Google + more options), preserving a
 *    redirect back to the game and any captured referral code.
 *  - Logged-in members see a "Play now" button plus a "Share" button that copies
 *    a referral link to the game.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/hooks";
import { buildGameReferralUrl } from "@zobia/shared/utils";

export default function GameCoverActions({ slug, name }: { slug: string; name: string }) {
  const { user, isLoading } = useAuth();
  const [copied, setCopied] = useState(false);
  const [refCode, setRefCode] = useState<string | null>(null);

  const playPath = `/g/${slug}/play`;

  useEffect(() => {
    if (!user) return;
    fetch("/api/referrals", { credentials: "include" })
      .then((r) => r.json())
      .then((b) => setRefCode(b?.data?.referralCode ?? null))
      .catch(() => {});
  }, [user]);

  async function handleGoogle() {
    try {
      const redirect = encodeURIComponent(playPath);
      const res = await fetch(`/api/auth/google?web_redirect=${redirect}`);
      const data = (await res.json()) as { url?: string };
      if (data.url) window.location.href = data.url;
    } catch {
      window.location.href = `/auth/login?redirect=${encodeURIComponent(playPath)}`;
    }
  }

  async function handleShare() {
    const origin = window.location.origin;
    const url = buildGameReferralUrl(origin, slug, refCode);
    try {
      if (navigator.share) {
        await navigator.share({ title: name, url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* user cancelled */
    }
  }

  if (isLoading) {
    return <div className="h-11 w-full animate-pulse rounded-lg bg-neutral-800" />;
  }

  if (user) {
    return (
      <div className="flex flex-col items-center gap-3">
        <a
          href={playPath}
          className="inline-block rounded-lg bg-primary px-8 py-3 text-base font-semibold text-primary-foreground transition hover:opacity-90"
        >
          ▶ Play {name}
        </a>
        <button
          type="button"
          onClick={handleShare}
          className="text-sm font-medium text-muted-foreground underline-offset-2 hover:underline"
        >
          {copied ? "Link copied!" : "Share & earn referrals"}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xs flex-col items-center gap-3">
      <p className="text-sm font-medium text-muted-foreground">Log in to play this game</p>
      <button
        type="button"
        onClick={handleGoogle}
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50"
      >
        <span className="font-bold text-[#4285F4]">G</span> Continue with Google
      </button>
      <a
        href={`/auth/login?redirect=${encodeURIComponent(playPath)}`}
        className="w-full rounded-xl bg-primary px-4 py-3 text-center text-sm font-semibold text-primary-foreground transition hover:opacity-90"
      >
        More login options
      </a>
    </div>
  );
}
