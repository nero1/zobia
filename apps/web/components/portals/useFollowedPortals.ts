"use client";

/**
 * components/portals/useFollowedPortals.ts
 *
 * The signed-in user's followed portals. Renders instantly from a cached copy
 * in localStorage, scoped by user id (accounts sharing a device never see each
 * other's follows, and it works offline), then refreshes from
 * GET /api/portals/following.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth/hooks";
import type { PortalCard } from "@zobia/types";

const followKey = (userId: string) => `zobia:portals:following:v1:${userId}`;

export function useFollowedPortals(): { userId: string | null; following: PortalCard[] | null } {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [following, setFollowing] = useState<PortalCard[] | null>(null);

  useEffect(() => {
    if (!userId) {
      setFollowing(null);
      return;
    }
    try {
      const cached = localStorage.getItem(followKey(userId));
      if (cached) setFollowing(JSON.parse(cached) as PortalCard[]);
    } catch {
      /* ignore */
    }
    let cancelled = false;
    fetch("/api/portals/following", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled || !json?.data) return;
        const list = json.data.portals as PortalCard[];
        setFollowing(list);
        try {
          localStorage.setItem(followKey(userId), JSON.stringify(list));
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { userId, following };
}
