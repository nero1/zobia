"use client";

/**
 * components/home/PresenceTabs.tsx
 *
 * Presence/liveness sub-section for the Home Dashboard logo tab: an
 * "Online Friends" tab (unchanged behavior from the old inline FriendsRow —
 * GET /api/friends/online + OnlineRing) and a "Recently Active" tab, using
 * the same GET /api/friends/online response, which already computes both
 * `isOnline` (last_active_at within 5 min) and general recent-activity
 * inclusion (within 60 min) server-side — see that route's doc comment. No
 * new presence data source is invented here; "Recently Active" simply shows
 * the friends from the same response that are NOT currently online.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { OnlineRing } from "@/components/ui/OnlineRing";

interface Friend {
  userId: string;
  username: string;
  avatarEmoji: string;
  isOnline?: boolean;
}

function FriendsSkeleton() {
  return (
    <div className="flex gap-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="animate-pulse flex flex-col items-center gap-1">
          <div className="h-11 w-11 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-2.5 w-10 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      ))}
    </div>
  );
}

function FriendGrid({ friends, emptyKey }: { friends: Friend[]; emptyKey: string }) {
  const { t } = useTranslation();
  if (friends.length === 0) {
    return <p className="text-xs text-neutral-400">{t(emptyKey)}</p>;
  }
  return (
    <div className="flex flex-wrap gap-4">
      {friends.map((f) => (
        <Link key={f.userId} href={`/profile/${f.userId}`} className="flex flex-col items-center gap-1 hover:opacity-80">
          <OnlineRing userId={f.userId} size="md" knownStatus={f.isOnline ? "online" : "recently_active"}>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">
              {f.avatarEmoji}
            </div>
          </OnlineRing>
          <span className="max-w-[3rem] truncate text-xs text-neutral-500">@{f.username}</span>
        </Link>
      ))}
    </div>
  );
}

export function PresenceTabs() {
  const { t } = useTranslation();
  const [friends, setFriends] = useState<Friend[] | undefined>(undefined);
  const [tab, setTab] = useState<"online" | "recent">("online");

  useEffect(() => {
    fetch("/api/friends/online", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { data?: Friend[]; friends?: Friend[] } | null) => setFriends(d?.data ?? d?.friends ?? []))
      .catch(() => setFriends([]));
  }, []);

  const online = (friends ?? []).filter((f) => f.isOnline);
  const recentlyActive = (friends ?? []).filter((f) => !f.isOnline);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-center gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-neutral-800">
        <button
          onClick={() => setTab("online")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            tab === "online" ? "bg-white shadow-sm dark:bg-neutral-900" : "text-neutral-500"
          }`}
        >
          {t("home.presence.online")}
        </button>
        <button
          onClick={() => setTab("recent")}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
            tab === "recent" ? "bg-white shadow-sm dark:bg-neutral-900" : "text-neutral-500"
          }`}
        >
          {t("home.presence.recentlyActive")}
        </button>
      </div>
      <p className="mb-3 text-[11px] text-neutral-400">{t("home.friends.privacyHint")}</p>
      {friends === undefined ? (
        <FriendsSkeleton />
      ) : tab === "online" ? (
        <FriendGrid friends={online} emptyKey="home.presence.emptyOnline" />
      ) : (
        <FriendGrid friends={recentlyActive} emptyKey="home.presence.emptyRecent" />
      )}
    </div>
  );
}
