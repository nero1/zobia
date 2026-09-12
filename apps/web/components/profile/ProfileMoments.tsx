"use client";

/**
 * components/profile/ProfileMoments.tsx
 *
 * "Moments" tab on the profile page. There is no "Tweets"/status-post
 * feature in this codebase (see product-decision note in page.tsx) — Moments
 * (app/(app)/moments/page.tsx, GET /api/moments) is the closest existing
 * analog: short public posts with optional media. Fetches this author's
 * active (non-expired) moments via ?userId=, capped at 5 like a compact
 * profile card list.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface Moment {
  id: string;
  content: string;
  content_type: string;
  media_url: string | null;
  caption: string | null;
  created_at: string;
}

/** Fetches (and caches for the session) this user's active moment count/list — shared by the tab-visibility check and the tab body so there's only one request. */
export function useProfileMoments(userId: string) {
  const [moments, setMoments] = useState<Moment[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/moments?userId=${encodeURIComponent(userId)}&limit=5`, { credentials: "include" });
        if (!res.ok) { if (!cancelled) setMoments([]); return; }
        const body = await res.json() as { data?: { moments?: Moment[] } };
        if (!cancelled) setMoments(body.data?.moments ?? []);
      } catch {
        if (!cancelled) setMoments([]);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return moments;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function ProfileMoments({ moments }: { moments: Moment[] | null }) {
  const { t } = useTranslation();

  if (moments === null) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
        ))}
      </div>
    );
  }

  if (moments.length === 0) {
    return <p className="py-6 text-center text-sm text-neutral-500">{t("profile.moments.empty", "No moments yet")}</p>;
  }

  return (
    <div className="space-y-2">
      {moments.map((m) => (
        <div key={m.id} className="rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800">
          {m.content && <p className="whitespace-pre-line text-sm text-neutral-800 dark:text-neutral-200">{m.content}</p>}
          {m.media_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.media_url} alt={m.caption ?? ""} className="mt-2 max-h-48 rounded-md object-cover" loading="lazy" />
          )}
          <p className="mt-1 text-xs text-neutral-400">{timeAgo(m.created_at)}</p>
        </div>
      ))}
    </div>
  );
}
