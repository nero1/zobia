"use client";

/**
 * components/portals/PortalViewTracker.tsx
 *
 * Records one view of a portal page (and a click when it arrived from a feed
 * suggestion card, `?src=feed`), deduped per portal per day in localStorage —
 * same offline-friendly, write-saving approach as
 * components/business/PageViewTracker.tsx. The key is not user-scoped on
 * purpose: it only holds public portal ids + a date, never user data.
 */

import { useEffect } from "react";

const KEY = "zobia:portals:viewed:v1";

export function PortalViewTracker({ slug }: { slug: string }) {
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    let seen: Record<string, string> = {};
    try {
      seen = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
    } catch {
      seen = {};
    }
    if (seen[slug] === today) return;

    const src = new URLSearchParams(window.location.search).get("src");
    fetch(`/api/public/portals/${encodeURIComponent(slug)}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ src: src === "feed" || src === "search" ? src : "direct" }),
    })
      .then((res) => {
        if (!res.ok) return;
        seen[slug] = today;
        // Keep the map small: only the 200 most recent entries.
        const entries = Object.entries(seen).slice(-200);
        try {
          localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
        } catch {
          /* best-effort */
        }
      })
      .catch(() => {});
  }, [slug]);

  return null;
}
