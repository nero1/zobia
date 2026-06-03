"use client";

/**
 * app/(app)/moments/page.tsx
 *
 * Moments feed page.
 * Shows placeholder grid of moment cards with a "coming soon" state
 * and a "Share a moment" CTA button.
 */

import { useState } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Placeholder moment card
// ---------------------------------------------------------------------------

interface PlaceholderMoment {
  id: string;
  emoji: string;
  label: string;
}

const PLACEHOLDER_MOMENTS: PlaceholderMoment[] = [
  { id: "1", emoji: "🌅", label: "Morning vibes" },
  { id: "2", emoji: "🎶", label: "Music session" },
  { id: "3", emoji: "🍕", label: "Food time" },
  { id: "4", emoji: "📚", label: "Study grind" },
  { id: "5", emoji: "🏋️", label: "Gym day" },
  { id: "6", emoji: "🎮", label: "Gaming" },
];

function MomentCardPlaceholder({ moment }: { moment: PlaceholderMoment }) {
  return (
    <div className="group relative aspect-[9/16] overflow-hidden rounded-2xl border border-neutral-200 bg-gradient-to-br from-neutral-100 to-neutral-200 dark:border-neutral-800 dark:from-neutral-800 dark:to-neutral-900">
      {/* Blurred/locked overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 backdrop-blur-sm">
        <span className="text-5xl">{moment.emoji}</span>
        <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{moment.label}</p>
      </div>
      {/* Coming soon badge */}
      <div className="absolute left-2 top-2 rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold text-neutral-600 backdrop-blur-sm dark:bg-neutral-900/80 dark:text-neutral-400">
        Soon
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Moments feed — shows a coming-soon state with placeholder cards.
 */
export default function MomentsPage() {
  const [dismissed, setDismissed] = useState(false);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
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
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          Share
        </Link>
      </div>

      {/* Coming soon banner */}
      {!dismissed && (
        <div className="relative overflow-hidden rounded-2xl border border-blue-200 bg-blue-50 p-6 dark:border-blue-800 dark:bg-blue-950/30">
          <button
            onClick={() => setDismissed(true)}
            className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700"
            aria-label="Dismiss"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-3xl dark:bg-blue-900">
              📸
            </div>
            <div>
              <h2 className="text-lg font-bold text-blue-900 dark:text-blue-100">Moments are coming soon</h2>
              <p className="mt-1 text-sm text-blue-700 dark:text-blue-300">
                Share short videos and photos with your followers. Be among the first to post when it launches!
              </p>
              <Link
                href="/moments/create"
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Share a Moment
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Placeholder grid */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">Preview</p>
        <div className="grid grid-cols-3 gap-2">
          {PLACEHOLDER_MOMENTS.map((moment) => (
            <MomentCardPlaceholder key={moment.id} moment={moment} />
          ))}
        </div>
      </div>

      {/* CTA at bottom */}
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center dark:border-neutral-700 dark:bg-neutral-900">
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-neutral-200 text-3xl dark:bg-neutral-800">
          🎬
        </div>
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">Be the first to post</h3>
        <p className="mt-1 text-sm text-neutral-500">Moments launches soon — your clips will appear here.</p>
        <Link
          href="/moments/create"
          className="mt-4 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Share a Moment
        </Link>
      </div>
    </div>
  );
}
