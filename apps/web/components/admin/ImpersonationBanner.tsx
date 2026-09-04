"use client";

/**
 * components/admin/ImpersonationBanner.tsx
 *
 * Fixed bottom bar shown whenever the current session is an admin
 * impersonating another user. Lets the admin end the impersonation and
 * return to their own session at any time.
 *
 * Detected by reading the non-HttpOnly `zobia_impersonating` marker cookie
 * (set by app/api/admin/users/[userId]/impersonate/route.ts) directly from
 * document.cookie — a plain string read, no network round-trip. This
 * deliberately avoids adding a GET /api/auth/me call (and its Redis session
 * read) to every page load for every regular user just to cover this rare
 * admin-only case.
 *
 * Mounted once at the root layout so it covers every page the impersonated
 * view can reach.
 */

import { useEffect, useState } from "react";

function hasImpersonationCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c === "zobia_impersonating=1");
}

export function ImpersonationBanner() {
  const [impersonating, setImpersonating] = useState(false);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    setImpersonating(hasImpersonationCookie());
  }, []);

  async function endImpersonation() {
    setEnding(true);
    try {
      const res = await fetch("/api/auth/impersonate/end", { method: "POST", credentials: "include" });
      if (res.ok) {
        window.location.href = "/gate44/users";
        return;
      }
    } catch {
      // fall through to re-enable the button
    }
    setEnding(false);
  }

  if (!impersonating) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-[9999] flex items-center justify-center gap-3 bg-purple-700 px-4 py-2.5 text-sm font-medium text-white shadow-lg"
    >
      <span>🎭 You are viewing Zobia as this user (impersonation).</span>
      <button
        onClick={endImpersonation}
        disabled={ending}
        className="rounded-lg bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30 disabled:opacity-60"
      >
        {ending ? "Returning…" : "Return to Admin"}
      </button>
    </div>
  );
}
