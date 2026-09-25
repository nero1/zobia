"use client";

/**
 * components/auth/SessionExpiredModal.tsx
 *
 * App-wide "you've been signed out" notice.
 *
 * Mounted once in the authenticated app layout. It listens to the session bus
 * (lib/auth/sessionExpiredBus) and, the moment an unrecoverable 401 is observed
 * anywhere in the tab — a background chat poll, an axios call, or the user
 * trying to send a message in a room that was left open while the session
 * expired — it pops a blocking modal prompting the user to sign back in.
 *
 * This closes the gap where a long-lived page (e.g. a chat room) keeps showing
 * stale content after the session has silently expired: instead of swallowing
 * the 401, the next poll or user action surfaces this notice.
 */

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import {
  clearAuthCookies,
  installSessionExpiryFetchGuard,
  onSessionExpired,
  resetSessionExpired,
} from "@/lib/auth/sessionExpiredBus";

// Installed once, at module-evaluation time on the client. This is the one
// place that's guaranteed to be imported by every route (mounted at the
// app root in app/layout.tsx), so it's the natural home for wiring up the
// global 401 guard that lets pages using a raw `fetch()` still surface this
// modal — see installSessionExpiryFetchGuard's doc comment for why.
installSessionExpiryFetchGuard();

export function SessionExpiredModal() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Never raise the notice on the auth screens themselves (the login page
    // already shows its own expired banner via the redirect reason).
    const onAuthRoute = pathname?.startsWith("/auth");
    const unsubscribe = onSessionExpired(() => {
      if (!onAuthRoute) setOpen(true);
    });
    return unsubscribe;
  }, [pathname]);

  const goToLogin = useCallback(() => {
    setOpen(false);
    resetSessionExpired();
    const onAdminRoute = pathname?.startsWith("/gate44");
    const loginPath = onAdminRoute ? "/gate44/login" : "/auth/login";
    const fallback = onAdminRoute ? "/gate44" : "/home";
    const redirect = pathname && !pathname?.startsWith("/auth") ? pathname : fallback;
    const target = `${loginPath}?reason=session_expired&redirect=${encodeURIComponent(redirect)}`;
    // markSessionExpired() already fired clearAuthCookies() in the
    // background when this notice first appeared, but await it explicitly
    // here too: if the user clicks through fast enough that it's still in
    // flight, navigating before it lands leaves the stale zobia_at cookie in
    // place and middleware bounces /auth/login straight back to /home
    // without ever showing the real sign-in screen (see markSessionExpired's
    // doc comment in lib/auth/sessionExpiredBus.ts).
    void clearAuthCookies().finally(() => router.push(target));
  }, [pathname, router]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="session-expired-title"
      aria-describedby="session-expired-body"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
        <h2
          id="session-expired-title"
          className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
        >
          {t("auth.sessionExpired.title")}
        </h2>
        <p
          id="session-expired-body"
          className="mt-2 text-sm text-neutral-600 dark:text-neutral-300"
        >
          {t("auth.sessionExpired.banner")}
        </p>
        <button
          type="button"
          onClick={goToLogin}
          autoFocus
          className="mt-5 w-full rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 dark:focus:ring-offset-neutral-900"
        >
          {t("auth.sessionExpired.signIn")}
        </button>
      </div>
    </div>
  );
}
