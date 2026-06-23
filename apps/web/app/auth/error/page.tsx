"use client";

/**
 * app/auth/error/page.tsx
 *
 * User-friendly OAuth error page — replaces raw JSON "white screen of death"
 * responses from the Google auth callback.
 *
 * Error codes:
 *   session_expired  — CSRF cookie expired (user paused on Google's account picker)
 *   rate_limited     — Too many login attempts
 *   invalid_request  — Malformed OAuth callback parameters
 *   unexpected       — Unhandled server error
 */

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";

type ErrorCode = "session_expired" | "rate_limited" | "invalid_request" | "unexpected" | "email_not_verified";

function ErrorContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const code = (searchParams.get("code") ?? "unexpected") as ErrorCode;

  const config: Record<ErrorCode, { icon: string; title: string; body: string; hint: string }> = {
    session_expired: {
      icon: "⏱️",
      title: t("authError.sessionExpired.title"),
      body: t("authError.sessionExpired.body"),
      hint: t("authError.sessionExpired.hint"),
    },
    rate_limited: {
      icon: "🚦",
      title: t("authError.rateLimited.title"),
      body: t("authError.rateLimited.body"),
      hint: t("authError.rateLimited.hint"),
    },
    invalid_request: {
      icon: "🔗",
      title: t("authError.invalidRequest.title"),
      body: t("authError.invalidRequest.body"),
      hint: t("authError.invalidRequest.hint"),
    },
    email_not_verified: {
      icon: "📧",
      title: t("authError.emailNotVerified.title"),
      body: t("authError.emailNotVerified.body"),
      hint: t("authError.emailNotVerified.hint"),
    },
    unexpected: {
      icon: "⚠️",
      title: t("authError.unexpected.title"),
      body: t("authError.unexpected.body"),
      hint: t("authError.unexpected.hint"),
    },
  };

  const err = config[code] ?? config.unexpected;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4 text-5xl">{err.icon}</div>
        <h1 className="mb-2 text-xl font-black text-neutral-900 dark:text-white">{err.title}</h1>
        <p className="mb-1 text-sm text-neutral-600 dark:text-neutral-400">{err.body}</p>
        <p className="mb-6 text-xs text-neutral-400 dark:text-neutral-500">{err.hint}</p>

        <Link
          href="/auth/login"
          className="inline-flex w-full items-center justify-center rounded-xl bg-amber-400 px-6 py-3 text-sm font-bold text-neutral-900 transition-colors hover:bg-amber-500"
        >
          {t("authError.tryAgainBtn")}
        </Link>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense>
      <ErrorContent />
    </Suspense>
  );
}
