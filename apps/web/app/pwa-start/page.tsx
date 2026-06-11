"use client";

/**
 * app/pwa-start/page.tsx
 *
 * PWA entry point. Listed as the manifest start_url so the PWA always
 * starts here instead of a potentially stale cached route.
 *
 * Immediately redirects:
 *   - Authenticated users  → /home
 *   - Unauthenticated users → /auth/login
 *
 * This page is intentionally NetworkOnly in the service worker so every
 * PWA launch always hits the server and avoids stale-cache 404s.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PwaStartPage() {
  const router = useRouter();

  useEffect(() => {
    // Ask the server whether the current session is valid.
    // /api/users/me returns 200 if authenticated, 401 if not.
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => {
        if (r.ok) {
          router.replace("/home");
        } else {
          router.replace("/auth/login");
        }
      })
      .catch(() => {
        // Network error: try to open the app anyway; middleware will handle auth
        router.replace("/home");
      });
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white dark:bg-neutral-900">
      <div className="flex flex-col items-center gap-3">
        <span className="text-4xl" aria-hidden="true">⚡</span>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading Zobia…</p>
      </div>
    </div>
  );
}
