/**
 * components/offline/OfflineBanner.tsx
 *
 * Offline / reconnected indicator banner.
 *
 * - Shows a banner when the browser loses network connectivity.
 * - Shows a brief "back online" confirmation before hiding.
 * - Uses only the browser's navigator.onLine and online/offline events.
 *
 * NO purple colors. NO gradients.
 */

"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";

type ConnectionState = "online" | "offline" | "reconnected";

/**
 * Offline indicator banner.
 * Renders nothing when the user is online and the reconnected flash has dismissed.
 */
export function OfflineBanner() {
  const [state, setState] = useState<ConnectionState>("online");

  useEffect(() => {
    // Sync with current state on mount (SSR is always "online")
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setState("offline");
    }

    let reconnectedTimer: ReturnType<typeof setTimeout>;

    const handleOffline = () => {
      clearTimeout(reconnectedTimer);
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

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={clsx(
        "fixed top-0 inset-x-0 z-50 flex items-center justify-center px-4 py-2 text-sm font-medium transition-colors duration-300",
        state === "offline" &&
          "bg-neutral-800 text-white dark:bg-neutral-700",
        state === "reconnected" &&
          "bg-success-600 text-white"
      )}
    >
      {state === "offline" && (
        <>
          <span className="mr-2" aria-hidden="true">⚠</span>
          You&apos;re offline. Some features may not be available.
        </>
      )}
      {state === "reconnected" && (
        <>
          <span className="mr-2" aria-hidden="true">✓</span>
          You&apos;re back online!
        </>
      )}
    </div>
  );
}
