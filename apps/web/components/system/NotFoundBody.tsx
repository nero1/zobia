/**
 * components/system/NotFoundBody.tsx
 *
 * Presentational 404 body shared by app/not-found.tsx (route-not-found) and
 * the (app) layout's feature-flag page gate (app/(app)/layout.tsx — a
 * disabled feature's page must look exactly like a real 404, with no hint
 * that a feature exists there). Keep this generic: no feature names, no
 * "this feature is disabled" copy.
 */

import Link from "next/link";

export function NotFoundBody({ loggedIn = true }: { loggedIn?: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
      <div className="mb-6 select-none text-8xl font-extrabold text-neutral-200 dark:text-neutral-800">
        404
      </div>

      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-10 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="mb-3 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          Page Not Found
        </h1>
        <p className="mb-8 text-neutral-600 dark:text-neutral-400">
          The page you&apos;re looking for doesn&apos;t exist or has been moved. Let&apos;s
          get you back on track.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href={loggedIn ? "/home" : "/"}
            className="rounded-xl bg-primary-600 px-6 py-3 text-sm font-semibold text-white shadow-elevated transition-colors hover:bg-primary-700"
          >
            Go back home
          </Link>
          {!loggedIn && (
            <Link
              href="/auth/login"
              className="rounded-xl border border-neutral-300 bg-white px-6 py-3 text-sm font-semibold text-neutral-700 shadow-card transition-colors hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              Log in
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
