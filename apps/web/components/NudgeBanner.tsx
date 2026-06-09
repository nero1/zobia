"use client";

/**
 * NudgeBanner
 *
 * Dismissible in-app banner nudging users who haven't set an email address
 * to add one for account recovery.
 *
 * PRD §4: "After onboarding, the user is periodically (but not aggressively)
 * encouraged to add an email address for account recovery and to set a password.
 * Both are optional but surfaced as strongly recommended."
 *
 * Display rules:
 *  - Only shown when user has no email set AND hasn't dismissed before
 *  - Dismissed state stored in sessionStorage (resets on next login)
 *  - Clicking "Add Email" navigates to /settings
 *  - Clicking "Dismiss" calls /api/users/me/nudge-dismiss and hides
 */

import { useState, useEffect } from "react";
import Link from "next/link";

const SESSION_KEY = "zobia_nudge_dismissed";

interface NudgeBannerProps {
  hasEmail: boolean;
  nudgeDismissedAt?: string | null;
}

export function NudgeBanner({ hasEmail, nudgeDismissedAt }: NudgeBannerProps) {
  const [visible, setVisible] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    // Don't show if user already has email or permanently dismissed
    if (hasEmail || nudgeDismissedAt) {
      setVisible(false);
      return;
    }

    // Don't show if session-dismissed
    try {
      if (sessionStorage.getItem(SESSION_KEY) === "1") {
        setVisible(false);
        return;
      }
    } catch {
      // sessionStorage unavailable
    }

    setVisible(true);
  }, [hasEmail, nudgeDismissedAt]);

  const handleDismiss = async () => {
    setDismissing(true);
    try {
      // Session-only dismiss (instant)
      try {
        sessionStorage.setItem(SESSION_KEY, "1");
      } catch {
        // ignore
      }
      setVisible(false);

      // Persistent dismiss (best-effort, fire and forget)
      await fetch("/api/users/me/nudge-dismiss", { method: "POST" });
    } catch {
      setVisible(false);
    } finally {
      setDismissing(false);
    }
  };

  if (!visible) return null;

  return (
    <div
      role="banner"
      className="relative flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm dark:border-blue-800 dark:bg-blue-950"
    >
      {/* Icon */}
      <span className="shrink-0 text-blue-600 dark:text-blue-400" aria-hidden="true">
        🔒
      </span>

      {/* Message */}
      <p className="flex-1 text-blue-800 dark:text-blue-200">
        <strong>Protect your account.</strong> Add your email for account recovery —
        it takes 30 seconds. Your progress is worth protecting.
      </p>

      {/* CTAs */}
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/settings"
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
        >
          Add Email
        </Link>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={dismissing}
          aria-label="Dismiss account recovery nudge"
          className="rounded-md border border-blue-300 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-900"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
