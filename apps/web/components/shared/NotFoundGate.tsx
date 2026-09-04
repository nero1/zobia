"use client";

/**
 * components/shared/NotFoundGate.tsx
 *
 * Wraps a page whose visibility is controlled by an admin feature flag.
 * - Feature enabled: renders children normally for everyone.
 * - Feature disabled + viewer is admin: renders children with a banner
 *   noting the feature is off for regular users (so admins can still work
 *   with/preview the page).
 * - Feature disabled + viewer is not admin: renders a 404-style not-found
 *   block instead of the page content.
 *
 * This is a client-side visual gate (the page itself is a client component),
 * not a real HTTP 404 — pair it with a server-side feature check on any
 * route that also needs to be unreachable to search engines/crawlers.
 */

import Link from "next/link";
import { useTranslation } from "react-i18next";

export function NotFoundGate({
  enabled,
  isAdmin,
  featureLabel,
  children,
}: {
  enabled: boolean;
  isAdmin: boolean;
  /** Human label used in the admin notice and not-found message, e.g. "Answers". */
  featureLabel: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();

  if (enabled) return <>{children}</>;

  if (isAdmin) {
    return (
      <div>
        <div className="mx-auto max-w-2xl px-4 pt-4 sm:px-6">
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <strong>{featureLabel}</strong> {t("notFoundGate.adminNotice", "is turned off for regular users. You can see this page because you're an admin — everyone else gets a not-found page until you re-enable it in admin settings.")}
          </div>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center px-4 py-24 text-center">
      <span className="text-5xl">🔍</span>
      <h1 className="mt-4 text-xl font-bold text-neutral-900 dark:text-neutral-50">{t("notFoundGate.title", "Page not found")}</h1>
      <p className="mt-2 text-sm text-neutral-500">{t("notFoundGate.body", "This page isn't available right now.")}</p>
      <Link href="/home" className="mt-6 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
        {t("notFoundGate.goHome", "Go home")}
      </Link>
    </div>
  );
}
