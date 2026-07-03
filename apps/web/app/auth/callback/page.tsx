"use client";

/**
 * app/auth/callback/page.tsx
 *
 * Browser-visible fallback for the Android App Link OAuth callback
 * (BUG-CAP-04 fix).
 *
 * apps/android now passes `https://<web-origin>/auth/callback` (a verified
 * Android App Link, see AndroidManifest.xml's `zobia.org` intent-filter) as
 * its OAuth redirect target instead of the zobia:// custom scheme. Verified
 * App Links are exclusive to the one app that owns the domain, so this is
 * more secure than a custom scheme — but if a given device hasn't finished
 * App Link verification yet (e.g. assetlinks.json not yet updated with the
 * real signing certificate, or the OS hasn't re-verified after install), the
 * link opens in the browser instead of the app. Without this page that would
 * be a bare 404 and a dead-end login. This page hands off to the app via the
 * zobia:// custom-scheme fallback (still declared, unverified, in the native
 * manifest) and otherwise shows the user how to continue manually.
 */

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";

function CallbackContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const preAuthCode = searchParams.get("pre_auth_code");

  const fallbackDeepLink = (() => {
    const qs = new URLSearchParams();
    if (code) qs.set("code", code);
    if (preAuthCode) qs.set("pre_auth_code", preAuthCode);
    return `zobia://auth/callback${qs.toString() ? `?${qs.toString()}` : ""}`;
  })();

  const hasToken = !!(code || preAuthCode);

  useEffect(() => {
    if (!hasToken) return;
    // Best-effort automatic hand-off. Mobile browsers frequently block a
    // script-initiated custom-scheme navigation without a user gesture, so
    // this is a bonus, not the only path — the visible button below always
    // works.
    window.location.href = fallbackDeepLink;
  }, [hasToken, fallbackDeepLink]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 text-5xl">📱</div>
        <h1 className="mb-2 text-xl font-black text-neutral-900 dark:text-white">
          {t("authCallback.title")}
        </h1>
        <p className="mb-6 text-sm text-neutral-600 dark:text-neutral-400">
          {hasToken ? t("authCallback.body") : t("authCallback.missingCode")}
        </p>

        {hasToken && (
          <a
            href={fallbackDeepLink}
            className="inline-flex w-full items-center justify-center rounded-xl bg-amber-400 px-6 py-3 text-sm font-bold text-neutral-900 transition-colors hover:bg-amber-500"
          >
            {t("authCallback.openAppBtn")}
          </a>
        )}
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <CallbackContent />
    </Suspense>
  );
}
