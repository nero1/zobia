"use client";

/**
 * AnnouncementBanner
 *
 * Sticky top announcement banner.
 * Renders a fixed-position banner at the top of the page.
 * Dismissible via × button; shifts content via CSS padding.
 * Dismissed state persisted to sessionStorage per banner ID.
 *
 * Usage: Mount inside the root layout so it renders on all pages.
 *
 * @example
 * <AnnouncementBanner banner={activeBanner} />
 */

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BannerData {
  id: string;
  content: string; // pre-sanitized HTML or plain text
  severity?: "info" | "warning" | "success"; // affects background color
}

interface AnnouncementBannerProps {
  /** The banner to display. Pass null/undefined to show nothing. */
  banner: BannerData | null | undefined;
  /** Override the session storage key (useful for testing). */
  storageKey?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_CLASSES: Record<NonNullable<BannerData["severity"]>, string> = {
  info: "bg-blue-600 text-white",
  warning: "bg-amber-500 text-white",
  success: "bg-teal-600 text-white",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Fixed top announcement banner.
 * Adds padding to document body when visible to prevent content overlap.
 * Dismissed once per session per banner ID.
 */
export function AnnouncementBanner({
  banner,
  storageKey = "zobia_banner_dismissed",
}: AnnouncementBannerProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!banner) return;
    try {
      const dismissed = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]") as string[];
      if (!dismissed.includes(banner.id)) {
        setVisible(true);
      }
    } catch {
      setVisible(true);
    }
  }, [banner, storageKey]);

  // Push page content down by applying padding-top to the body
  useEffect(() => {
    if (visible) {
      document.documentElement.style.setProperty("--banner-height", "2.75rem");
    } else {
      document.documentElement.style.setProperty("--banner-height", "0px");
    }
    return () => document.documentElement.style.setProperty("--banner-height", "0px");
  }, [visible]);

  function dismiss() {
    if (!banner) return;
    try {
      const dismissed = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]") as string[];
      sessionStorage.setItem(storageKey, JSON.stringify([...dismissed, banner.id]));
    } catch { /* ignore */ }
    setVisible(false);
  }

  if (!visible || !banner) return null;

  const bgClass = SEVERITY_CLASSES[banner.severity ?? "info"];

  return (
    <div
      role="banner"
      className={`fixed inset-x-0 top-0 z-[9998] flex min-h-11 items-center justify-between px-4 py-2 ${bgClass}`}
    >
      <div className="flex-1 text-center">
        <span
          className="text-sm font-medium leading-tight"
          /* Content is expected to be pre-sanitized before being passed to this component */
          dangerouslySetInnerHTML={{ __html: banner.content }}
        />
      </div>
      <button
        onClick={dismiss}
        aria-label="Dismiss banner"
        className="ml-3 shrink-0 rounded p-1 opacity-80 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/50"
      >
        ✕
      </button>
    </div>
  );
}
