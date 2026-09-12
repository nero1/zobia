"use client";

/**
 * lib/hooks/useCurrentUserId.ts
 *
 * Small client hook returning the signed-in user's id, for components that
 * need to scope localStorage keys per-user (e.g. New Member Quest dismissal
 * state) without pulling in a bigger session/user context. Fetches
 * GET /api/users/me once, same endpoint every other client component on
 * this page already calls.
 */

import { useEffect, useState } from "react";

export function useCurrentUserId(): string | null | undefined {
  // undefined = loading, null = not signed in / unknown
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { user?: { id?: string } } | null) => {
        if (cancelled) return;
        const id = json?.user?.id;
        setUserId(typeof id === "string" ? id : null);
      })
      .catch(() => {
        if (!cancelled) setUserId(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return userId;
}
