/**
 * components/offline/OfflineBanner.tsx
 *
 * Offline / reconnected indicator banner.
 *
 * - Shows a small, grey, dismissible banner when the browser loses network
 *   connectivity. The app stays fully usable behind it (offline-first): cached
 *   pages and the last-seen data keep rendering and refresh automatically once
 *   the connection returns.
 * - Shows a brief "back online" confirmation before hiding.
 * - Uses only the browser's navigator.onLine and online/offline events.
 *
 * NO purple colors. NO gradients.
 */

"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { useTranslation } from "react-i18next";

type ConnectionState = "online" | "offline" | "reconnected";

/**
 * Offline indicator banner.
 * Renders nothing when the user is online and the reconnected flash has
 * dismissed, or when the user has closed the offline banner for this outage.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const [state, setState] = useState<ConnectionState>("online");
  // The offline banner is closeable; track dismissal so it stays hidden for the
  // current outage and reappears on the next offline transition.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Sync with current state on mount (SSR is always "online")
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setState("offline");
    }

    let reconnectedTimer: ReturnType<typeof setTimeout>;

    const handleOffline = () => {
      clearTimeout(reconnectedTimer);
      setDismissed(false); // a fresh outage re-shows the banner
      setState("offline");
    };

    const handleOnline = () => {
      setState("reconnected");
      reconnectedTimer = setTimeout(() => setState("online"), 3000);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      clearTimeout(reconnectedTimer);
    };
  }, []);

  if (state === "online") return null;
  if (state === "offline" && dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={clsx(
        "fixed top-0 inset-x-0 z-50 flex items-center justify-center gap-2 px-3 py-1 text-xs font-medium transition-colors duration-300",
        state === "offline" &&
          "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-100",
        state === "reconnected" && "bg-success-600 text-white",
      )}
    >
      {state === "offline" && (
        <>
          <span aria-hidden="true">●</span>
          <span>{t("offline.banner")}</span>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label={t("offline.dismiss")}
            className="ml-1 rounded p-0.5 leading-none opacity-70 transition-opacity hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-neutral-500"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </>
      )}
      {state === "reconnected" && (
        <>
          <span aria-hidden="true">✓</span>
          <span>{t("offline.reconnected")}</span>
        </>
      )}
    </div>
  );
}
