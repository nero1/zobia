"use client";

/**
 * AnnouncementModal
 *
 * Web announcement modal overlay.
 * Renders one announcement per login session using sessionStorage.
 * Content is rendered via dangerouslySetInnerHTML with a sanitization note.
 * Backdrop click and × button both close the modal.
 *
 * @example
 * <AnnouncementModal announcement={ann} />
 *
 * NOTE: Sanitize HTML server-side (e.g. with DOMPurify or sanitize-html)
 * before passing to this component. The `content` prop is rendered as raw HTML.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnnouncementData {
  id: string;
  title: string;
  content: string; // pre-sanitized HTML or plain text
  startAt?: string | null;
  endAt?: string | null;
}

interface AnnouncementModalProps {
  /** The announcement to display. Pass null/undefined to show nothing. */
  announcement: AnnouncementData | null | undefined;
  /** Override the session storage key (useful for testing). */
  storageKey?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Centered announcement modal overlay.
 * Shown once per session per announcement ID.
 * Dismissible via × button or backdrop click.
 */
export function AnnouncementModal({
  announcement,
  storageKey = "zobia_ann_seen",
}: AnnouncementModalProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!announcement) return;
    try {
      const seen = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]") as string[];
      if (!seen.includes(announcement.id)) {
        setVisible(true);
      }
    } catch {
      setVisible(true);
    }
  }, [announcement, storageKey]);

  const dismiss = useCallback(() => {
    if (!announcement) return;
    try {
      const seen = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]") as string[];
      sessionStorage.setItem(storageKey, JSON.stringify([...seen, announcement.id]));
    } catch { /* ignore */ }
    setVisible(false);
  }, [announcement, storageKey]);

  // Handle Escape key
  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, dismiss]);

  if (!visible || !announcement) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ann-modal-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div className="relative w-full max-w-md rounded-2xl border border-neutral-200 bg-white shadow-modal dark:border-neutral-800 dark:bg-neutral-900">
        {/* Close button */}
        <button
          onClick={dismiss}
          aria-label="Close announcement"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          ✕
        </button>

        {/* Content */}
        <div className="p-6 pt-5">
          <h2
            id="ann-modal-title"
            className="mb-3 pr-8 text-lg font-bold text-neutral-900 dark:text-neutral-50"
          >
            {announcement.title}
          </h2>
          <div
            className="prose prose-sm max-w-none text-neutral-700 dark:prose-invert dark:text-neutral-300"
            /* Content is expected to be pre-sanitized before being passed to this component */
            dangerouslySetInnerHTML={{ __html: announcement.content }}
          />
          <button
            onClick={dismiss}
            className="mt-5 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
