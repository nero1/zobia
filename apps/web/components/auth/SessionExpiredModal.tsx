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
import { onSessionExpired, resetSessionExpired } from "@/lib/auth/sessionExpiredBus";

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
    const redirect = pathname && !pathname.startsWith("/auth") ? pathname : "/home";
    router.push(
      `/auth/login?reason=session_expired&redirect=${encodeURIComponent(redirect)}`,
    );
  }, [pathname, router]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
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
