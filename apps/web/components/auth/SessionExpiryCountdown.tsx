"use client";

/**
 * components/auth/SessionExpiryCountdown.tsx
 *
 * Warns the user 30 seconds before their access token is about to expire —
 * while the tab is actually visible — and lets them extend the session with
 * one tap instead of getting silently signed out mid-task.
 *
 * Mounted once in the authenticated app layout, alongside SessionExpiredModal
 * (which announces the session has ALREADY died; this component is the
 * proactive warning that comes before that ever happens). Driven entirely by
 * lib/auth/sessionExpiryBus.ts — no polling, no extra Redis/API calls beyond
 * the one refresh the user (or the natural silent-refresh flow) triggers.
 *
 * "Screen is on" is interpreted as the tab being visible
 * (document.visibilityState === "visible") — the countdown timer only runs
 * while that's true, so a backgrounded tab doesn't burn a countdown down to
 * zero and pop the warning the instant the user switches back.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Trans, useTranslation } from "react-i18next";
import { onSessionExpiryChange, setSessionExpiresAt } from "@/lib/auth/sessionExpiryBus";
import { rawFetch } from "@/lib/auth/sessionExpiredBus";
import { useAuth } from "@/lib/auth/hooks";

/** Show the warning this many ms before the access token actually expires. */
const WARNING_WINDOW_MS = 30_000;

export function SessionExpiryCountdown() {
  const { t } = useTranslation();
  const pathname = usePathname();
  // Ensures the expiry bus gets primed from GET /api/auth/me even on a page
  // that mounts no other component calling useAuth() — the fetch itself is
  // module-level deduped (see lib/auth/hooks.ts), so this never costs an
  // extra request when something else already triggered it.
  useAuth();
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [extending, setExtending] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => onSessionExpiryChange(setExpiresAt), []);

  const tick = useCallback(() => {
    setExpiresAt((current) => {
      if (current == null) {
        setRemainingMs(null);
        return current;
      }
      const remaining = current - Date.now();
      // Once the token has actually expired, hand off to the normal
      // 401 → markSessionExpired flow instead of counting into negative
      // numbers — this component is only the proactive warning.
      setRemainingMs(remaining > 0 ? remaining : null);
      return current;
    });
  }, []);

  useEffect(() => {
    function startOrStopTimer() {
      const visible = document.visibilityState === "visible";
      if (visible && expiresAt != null && !intervalRef.current) {
        tick();
        intervalRef.current = setInterval(tick, 1000);
      } else if ((!visible || expiresAt == null) && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        if (expiresAt == null) setRemainingMs(null);
      }
    }

    startOrStopTimer();
    document.addEventListener("visibilitychange", startOrStopTimer);
    return () => {
      document.removeEventListener("visibilitychange", startOrStopTimer);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [expiresAt, tick]);

  const extendSession = useCallback(async () => {
    setExtending(true);
    try {
      const res = await rawFetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { expiresIn?: number } | null;
        setSessionExpiresAt(
          typeof body?.expiresIn === "number" ? Date.now() + body.expiresIn * 1000 : null
        );
      }
      // On failure, do nothing extra here — the next real request will 401
      // and the existing session-expired flow (SessionExpiredModal) takes over.
    } finally {
      setExtending(false);
    }
  }, []);

  const onAuthRoute = pathname?.startsWith("/auth");
  const visible =
    !onAuthRoute && remainingMs != null && remainingMs > 0 && remainingMs <= WARNING_WINDOW_MS;

  if (!visible) return null;

  const seconds = Math.max(1, Math.ceil((remainingMs as number) / 1000));

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expiry-countdown-title"
      aria-describedby="session-expiry-countdown-body"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
        <h2
          id="session-expiry-countdown-title"
          className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
        >
          {t("auth.sessionExpiryCountdown.title")}
        </h2>
        <p
          id="session-expiry-countdown-body"
          className="mt-2 text-sm text-neutral-600 dark:text-neutral-300"
        >
          <Trans
            i18nKey="auth.sessionExpiryCountdown.body"
            values={{ seconds }}
            components={{ bold: <strong /> }}
          />
        </p>
        <button
          type="button"
          onClick={extendSession}
          disabled={extending}
          autoFocus
          className="mt-5 w-full rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-60 dark:focus:ring-offset-neutral-900"
        >
          {extending
            ? t("auth.sessionExpiryCountdown.extending")
            : t("auth.sessionExpiryCountdown.dontLogMeOut")}
        </button>
      </div>
    </div>
  );
}
