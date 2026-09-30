"use client";

/**
 * components/portals/PortalDirectory.tsx
 *
 * The /h discovery page body: search, sort tabs (Trending / Popular / New),
 * a "Following" tab for signed-in users, and a grid of portal tiles.
 *
 * Server-rendered initial list (crawlable) + client refetch for search/sort.
 * Follow list is cached per user in localStorage so it renders instantly and
 * works offline; the key is scoped by user id so accounts sharing a device
 * never see each other's follows.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth/hooks";
import { Icon } from "@/components/ui/Icon";
import { PortalCardTile } from "./PortalCardTile";
import type { PortalCard } from "@zobia/types";

type Tab = "trending" | "followers" | "new" | "following";

function followKey(userId: string): string {
  return `zobia:portals:following:v1:${userId}`;
}

export function PortalDirectory({ initial }: { initial: PortalCard[] }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [tab, setTab] = useState<Tab>("trending");
  const [q, setQ] = useState("");
  const [portals, setPortals] = useState<PortalCard[]>(initial);
  const [following, setFollowing] = useState<PortalCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const reqId = useRef(0);

  const load = useCallback(async (sort: Exclude<Tab, "following">, query: string) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams({ sort, limit: "36" });
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/public/portals?${params.toString()}`);
      if (!res.ok) throw new Error("load failed");
      const json = (await res.json()) as { data?: { portals: PortalCard[] } };
      if (id === reqId.current) setPortals(json.data?.portals ?? []);
    } catch {
      if (id === reqId.current) setError(true);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, []);

  // Debounced refetch on sort/search change (the first render uses the SSR list).
  const first = useRef(true);
  useEffect(() => {
    if (tab === "following") return;
    if (first.current) {
      first.current = false;
      if (!q.trim() && tab === "trending") return;
    }
    const h = setTimeout(() => void load(tab, q), q ? 250 : 0);
    return () => clearTimeout(h);
  }, [tab, q, load]);

  // Following: cached copy first (instant/offline), then network refresh.
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

  const tabs: Tab[] = userId ? ["trending", "followers", "new", "following"] : ["trending", "followers", "new"];
  const list = tab === "following" ? following ?? [] : portals;

  return (
    <div className="space-y-4">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
          <Icon emoji="🔍" size={16} />
        </span>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (tab === "following") setTab("trending");
          }}
          placeholder={t("portals.searchPlaceholder")}
          aria-label={t("portals.searchPlaceholder")}
          maxLength={60}
          className="w-full rounded-xl border border-neutral-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      <div className="flex gap-1 overflow-x-auto" role="tablist">
        {tabs.map((tb) => (
          <button
            key={tb}
            role="tab"
            aria-selected={tab === tb}
            onClick={() => setTab(tb)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ${
              tab === tb ? "bg-primary text-primary-foreground" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300"
            }`}
          >
            {t(`portals.tab.${tb}`)}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{t("portals.loadError")}</p>
      ) : loading && list.length === 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
          <div className="mb-2"><Icon emoji="🧭" size={32} /></div>
          <p className="text-sm text-neutral-500">{tab === "following" ? t("portals.followingEmpty") : t("portals.empty")}</p>
        </div>
      ) : (
        <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 ${loading ? "opacity-60" : ""}`}>
          {list.map((p) => (
            <PortalCardTile key={p.id} portal={p} src="search" />
          ))}
        </div>
      )}
    </div>
  );
}
