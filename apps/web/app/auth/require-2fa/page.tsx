"use client";

/**
 * app/auth/require-2fa/page.tsx
 *
 * Shown to moderators (and future admin-designated roles) who haven't set
 * up 2FA yet when auth_2fa_required_for_mods is enabled in x_manifest.
 * They must set up 2FA before they can log in.
 */

import Link from "next/link";

export default function Require2FAPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-neutral-200 bg-white px-8 py-10 text-center shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <span className="text-4xl">🔒</span>

          <h1 className="mt-4 text-xl font-bold text-neutral-900 dark:text-neutral-50">
            Two-factor authentication required
          </h1>

          <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Your account has moderator privileges. Platform policy requires all
            moderators to have two-factor authentication enabled before logging in.
          </p>

          <p className="mt-3 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
            Please log in from a session where 2FA is already configured, then
            enable it in{" "}
            <span className="font-semibold text-neutral-800 dark:text-neutral-200">
              Settings → Security
            </span>
            . Once set up, you can log in normally.
          </p>

          <div className="mt-8 flex flex-col gap-3">
            <Link
              href="/auth/login"
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Back to login
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
