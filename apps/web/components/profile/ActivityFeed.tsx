"use client";

/**
 * components/profile/ActivityFeed.tsx
 *
 * "Activities" tab on the profile page — GET /api/users/[userId]/activity.
 * Read-only, cheap (plain indexed Postgres query, LIMIT-bound, no Redis).
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface ActivityItem {
  type: "rank_up" | "badge" | "guild_join";
  emoji: string;
  label: string;
  occurredAt: string;
}

/** Reports whether the feed loaded successfully — used by the parent to decide default-tab logic isn't needed here (Activities has no "hide tab if empty" rule), but callers may still want it, e.g. to avoid rendering the tab body at all when the fetch 403s. */
export function useProfileActivity(userId: string) {
  const [activities, setActivities] = useState<ActivityItem[] | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(userId)}/activity`, { credentials: "include" });
        if (res.status === 403) {
          if (!cancelled) { setForbidden(true); setActivities([]); }
          return;
        }
        if (!res.ok) {
          if (!cancelled) setActivities([]);
          return;
        }
        const body = await res.json() as { activities?: ActivityItem[] };
        if (!cancelled) setActivities(body.activities ?? []);
      } catch {
        if (!cancelled) setActivities([]);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  return { activities, forbidden };
}

export function ActivityFeed({ activities }: { activities: ActivityItem[] | null }) {
  const { t } = useTranslation();

  if (activities === null) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return <p className="py-6 text-center text-sm text-neutral-500">{t("profile.activities.empty", "No activity yet")}</p>;
  }

  return (
    <ul className="space-y-2">
      {activities.map((a, i) => (
        <li
          key={`${a.type}-${a.occurredAt}-${i}`}
          className="flex items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-800"
        >
          <span className="text-lg">{a.emoji}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-neutral-700 dark:text-neutral-300">{a.label}</span>
          <span className="shrink-0 text-xs text-neutral-400">{new Date(a.occurredAt).toLocaleDateString()}</span>
        </li>
      ))}
    </ul>
  );
}
