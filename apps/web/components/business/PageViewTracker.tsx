"use client";

/**
 * components/business/PageViewTracker.tsx
 *
 * Records one view of a public Business Page, deduped client-side via
 * localStorage (`zobia_biz_page_viewed`) — mirrors
 * components/blogs/PostActions.tsx's view-tracking half exactly, so we
 * don't fire a write on every render/refresh and this stays offline-first.
 */

import { useEffect } from "react";

const VIEWED_STORAGE_KEY = "zobia_biz_page_viewed";

function hasRecordedView(pageId: string): boolean {
  try {
    const raw = localStorage.getItem(VIEWED_STORAGE_KEY);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    return seen.includes(pageId);
  } catch {
    return false;
  }
}

function markViewRecorded(pageId: string): void {
  try {
    const raw = localStorage.getItem(VIEWED_STORAGE_KEY);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    if (!seen.includes(pageId)) {
      seen.push(pageId);
      localStorage.setItem(VIEWED_STORAGE_KEY, JSON.stringify(seen.slice(-500)));
    }
  } catch {
    /* localStorage unavailable — skip, not critical */
  }
}

export function PageViewTracker({ pageId }: { pageId: string }) {
  useEffect(() => {
    if (!hasRecordedView(pageId)) {
      fetch(`/api/business/pages/${pageId}/view`, { method: "POST", credentials: "include" })
        .then((res) => {
          if (res.ok || res.status === 401) markViewRecorded(pageId);
        })
        .catch(() => {});
    }
  }, [pageId]);

  return null;
}
