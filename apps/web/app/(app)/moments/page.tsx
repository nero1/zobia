"use client";

/**
 * app/(app)/moments/page.tsx
 *
 * Moments feed page.
 * Fetches real moments from GET /api/moments and shows them as cards.
 * Each card displays author info, content, time, and reactions count.
 */

import { useState, useEffect } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Moment {
  id: string;
  authorId: string;
  authorUsername: string;
  authorAvatarEmoji: string;
  content: string;
  imageUrl?: string | null;
  caption?: string | null;
  reactionsCount: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function MomentSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-neutral-200 dark:bg-neutral-700" />
        <div className="space-y-1.5">
          <div className="h-3.5 w-28 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-3 w-16 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-4 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-4 w-4/5 rounded bg-neutral-200 dark:bg-neutral-700" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Moment card
// ---------------------------------------------------------------------------

function MomentCard({ moment }: { moment: Moment }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      {/* Author header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">
          {moment.authorAvatarEmoji}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/profile/${moment.authorId}`}
            className="text-sm font-semibold text-neutral-900 hover:underline dark:text-neutral-100"
          >
            @{moment.authorUsername}
          </Link>
          <p className="text-xs text-neutral-400">{timeAgo(moment.createdAt)}</p>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-3">
        <p className="text-sm text-neutral-800 dark:text-neutral-200 whitespace-pre-line">{moment.content}</p>

        {/* Optional image */}
        {moment.imageUrl && (
          <div className="mt-3 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={moment.imageUrl}
              alt={moment.caption ?? "Moment image"}
              className="w-full object-cover"
              loading="lazy"
            />
          </div>
        )}

        {/* Optional caption */}
        {moment.caption && (
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">{moment.caption}</p>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center border-t border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span>❤️</span>
          <span>{moment.reactionsCount.toLocaleString()} {moment.reactionsCount === 1 ? "reaction" : "reactions"}</span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Moments feed — fetches and displays real moments from the API.
 */
export default function MomentsPage() {
  const [moments, setMoments] = useState<Moment[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/moments", { credentials: "include" });
        if (res.status === 401) { window.location.href = "/login"; return; }
        if (!res.ok) throw new Error("Failed to load moments");
        const data = (await res.json()) as { moments?: Moment[] };
        setMoments(data.moments ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
        setMoments([]);
      }
    })();
  }, []);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Moments</h1>
          <p className="mt-0.5 text-sm text-neutral-500">Short clips and photos from the community</p>
        </div>
        <Link
          href="/moments/create"
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Share a Moment
        </Link>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Feed */}
      {moments === undefined ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <MomentSkeleton key={i} />
          ))}
        </div>
      ) : moments.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-12 text-center dark:border-neutral-700 dark:bg-neutral-900">
          <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-200 text-3xl dark:bg-neutral-800">
            🎬
          </div>
          <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">No moments yet</h3>
          <p className="mt-1 text-sm text-neutral-500">Be the first to share a moment with the community!</p>
          <Link
            href="/moments/create"
            className="mt-4 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Share a Moment
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {moments.map((moment) => (
            <MomentCard key={moment.id} moment={moment} />
          ))}
        </div>
      )}
    </div>
  );
}
