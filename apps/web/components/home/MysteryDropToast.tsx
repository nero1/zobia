"use client";

/**
 * components/home/MysteryDropToast.tsx
 *
 * Relocated, unchanged-behavior Mystery XP Drop toast (PRD §2.1) — was
 * inline in app/(app)/home/page.tsx. Fetches recent unread mystery drop
 * notifications and shows a dismissible toast.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface MysteryDropNotification {
  xpAmount: number;
  receivedAt: string;
}

export function MysteryDropToast() {
  const { t } = useTranslation();
  const [drop, setDrop] = useState<MysteryDropNotification | null>(null);

  useEffect(() => {
    fetch("/api/notifications?type=mystery_xp_drop&unread=true&limit=1", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { notifications?: Array<{ payload?: { xpAmount?: number }; created_at?: string }> } | null) => {
        const latest = d?.notifications?.[0];
        if (latest) {
          setDrop({
            xpAmount: latest.payload?.xpAmount ?? 0,
            receivedAt: latest.created_at ?? new Date().toISOString(),
          });
        }
      })
      .catch(() => {});
  }, []);

  if (!drop || drop.xpAmount <= 0) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3 shadow-md dark:border-yellow-700 dark:bg-yellow-950/40">
      <span className="text-2xl">⚡</span>
      <div className="flex-1">
        <p className="text-sm font-bold text-yellow-900 dark:text-yellow-200">{t("home.mysteryDrop.title")}</p>
        <p className="text-xs text-yellow-700 dark:text-yellow-400">
          {t("home.mysteryDrop.body", { xp: drop.xpAmount.toLocaleString() })}
        </p>
      </div>
      <button
        onClick={() => setDrop(null)}
        className="text-yellow-500 hover:text-yellow-700 dark:hover:text-yellow-300"
        aria-label={t("action.close")}
      >
        ✕
      </button>
    </div>
  );
}
