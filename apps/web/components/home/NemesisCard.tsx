"use client";

/**
 * components/home/NemesisCard.tsx
 *
 * Relocated, unchanged-behavior "Your Nemesis" widget — was inline in
 * app/(app)/home/page.tsx as `NemesisWidget`/`NemesisSkeleton`. Fetches
 * GET /api/nemesis and posts { action: "challenge" } to the same route on
 * the challenge button.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

interface NemesisData {
  rivalUserId: string;
  rivalUsername: string;
  rivalAvatarEmoji: string;
  myXP: number;
  rivalXP: number;
}

interface NemesisApiResponse {
  me: { userId: string; displayName: string; avatarEmoji: string; xp: number } | null;
  nemesis: { userId: string; displayName: string; avatarEmoji: string; xp: number } | null;
  comparison?: { userXP: number; nemesisXP: number; delta: number; userIsAhead: boolean } | null;
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 dark:bg-neutral-700 ${className}`} />;
}

function NemesisSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <SkeletonBlock className="mb-3 h-4 w-24" />
      <div className="flex items-center gap-4">
        <SkeletonBlock className="h-12 w-12 rounded-full" />
        <div className="flex-1 space-y-2">
          <SkeletonBlock className="h-4 w-32" />
          <SkeletonBlock className="h-2 w-full" />
        </div>
        <SkeletonBlock className="h-12 w-12 rounded-full" />
      </div>
      <SkeletonBlock className="mt-4 h-9 w-full rounded-xl" />
    </div>
  );
}

export function NemesisCard() {
  const { t } = useTranslation();
  const [nemesis, setNemesis] = useState<NemesisData | null | undefined>(undefined);
  const [challenging, setChallenging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/nemesis", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: NemesisApiResponse | null) => {
        if (!d?.nemesis || !d?.me) { setNemesis(null); return; }
        setNemesis({
          rivalUserId: d.nemesis.userId,
          rivalUsername: d.nemesis.displayName,
          rivalAvatarEmoji: d.nemesis.avatarEmoji,
          myXP: d.comparison?.userXP ?? d.me.xp,
          rivalXP: d.comparison?.nemesisXP ?? d.nemesis.xp,
        });
      })
      .catch(() => setNemesis(null));
  }, []);

  const handleChallenge = useCallback(async () => {
    setChallenging(true);
    try {
      const res = await fetch("/api/nemesis", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "challenge" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
        const errCode = typeof body.error === "string" ? null : body.error?.code ?? null;
        const errParams = typeof body.error === "string" ? {} : (body.error?.params ?? {});
        const err = new Error(errMsg ?? body.message ?? "Challenge failed") as Error & { code?: string | null; params?: Record<string, unknown> };
        err.code = errCode;
        err.params = errParams;
        throw err;
      }
    } catch (e) {
      const err = e as Error & { code?: string | null; params?: Record<string, unknown> };
      setError(e instanceof Error ? translateApiError(t, err.code, err.message || "Failed to challenge rival", err.params ?? {}) : "Failed to challenge rival");
    } finally {
      setChallenging(false);
    }
  }, [t]);

  if (nemesis === undefined) return <NemesisSkeleton />;
  if (!nemesis) return null;

  const total = nemesis.myXP + nemesis.rivalXP;
  const myPct = total > 0 ? Math.round((nemesis.myXP / total) * 100) : 50;
  const ahead = nemesis.myXP >= nemesis.rivalXP;
  const diff = Math.abs(nemesis.myXP - nemesis.rivalXP);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("home.nemesis.title")}</h2>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-2xl dark:bg-blue-900">
          🧑
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
            <span className="font-semibold text-blue-600">{t("home.nemesis.you")}</span>
            <span className="font-semibold text-red-600">@{nemesis.rivalUsername}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-red-100 dark:bg-red-900/30">
            <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${myPct}%` }} />
          </div>
          <p className="mt-1.5 text-center text-xs font-semibold text-neutral-600 dark:text-neutral-400">
            {ahead ? (
              <span className="text-teal-600">{t("home.nemesis.ahead", { diff: diff.toLocaleString() })}</span>
            ) : (
              <span className="text-red-600">{t("home.nemesis.behind", { diff: diff.toLocaleString() })}</span>
            )}
          </p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-2xl dark:bg-red-900">
          {nemesis.rivalAvatarEmoji}
        </div>
      </div>
      <button
        onClick={handleChallenge}
        disabled={challenging}
        className="mt-4 w-full rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      >
        {challenging ? t("home.nemesis.challenging") : t("home.nemesis.challenge")}
      </button>
    </div>
  );
}
