"use client";

/**
 * app/appeal/page.tsx
 *
 * Suspension/ban appeal submission page.
 *
 * Reached only via the `code` query param — a short-lived, identity-verified
 * appeal token issued at the moment of a blocked login attempt (see
 * lib/auth/appealToken.ts and app/api/auth/google/callback,
 * app/api/auth/telegram/callback). This is deliberately NOT a public
 * "email us" form: without a valid code the page shows an error and a link
 * back to login instead of a form.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import { apiClient } from "@/lib/api/client";
import { formatShortDateTime } from "@/lib/format/date";

interface TokenInfo {
  valid: boolean;
  email: string | null;
  appealType: "suspension" | "ban";
  reason: string | null;
  suspendedUntil: string | null;
}

function AppealContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const code = searchParams?.get("code") ?? "";

  const [checking, setChecking] = useState(true);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!code) { setChecking(false); return; }
    apiClient
      .get<{ data: TokenInfo }>("/api/appeals/token", { params: { code } })
      .then(({ data }) => {
        setTokenInfo(data.data);
        if (data.data.email) setContactEmail(data.data.email);
      })
      .catch(() => setTokenInfo({ valid: false, email: null, appealType: "suspension", reason: null, suspendedUntil: null }))
      .finally(() => setChecking(false));
  }, [code]);

  async function handleSubmit() {
    setStatus("submitting");
    setErrorMsg("");
    try {
      const { data } = await apiClient.post<{ data?: { message?: string }; error?: { message?: string } }>(
        "/api/appeals",
        { code, reason: reasonText, contactEmail: contactEmail || undefined }
      );
      if (data?.data) {
        setStatus("success");
      } else {
        throw new Error(data?.error?.message ?? t("appeal.error.submitFailed"));
      }
    } catch (err) {
      setStatus("error");
      const message =
        err && typeof err === "object" && "response" in err
          ? ((err as { response?: { data?: { error?: { message?: string } } } }).response?.data?.error?.message ?? undefined)
          : undefined;
      setErrorMsg(message ?? (err instanceof Error ? err.message : t("appeal.error.submitFailed")));
    }
  }

  if (checking) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-primary-600" />
      </main>
    );
  }

  if (!code || !tokenInfo?.valid) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-6 dark:bg-neutral-950">
        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-elevated dark:border-neutral-800 dark:bg-neutral-900">
          <h1 className="text-xl font-black text-neutral-900 dark:text-white">{t("appeal.invalidLink.title")}</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("appeal.invalidLink.body")}</p>
          <a href="/auth/login" className="inline-block text-sm font-semibold text-primary-600 underline dark:text-primary-400">
            {t("appeal.backToLogin")}
          </a>
        </div>
      </main>
    );
  }

  if (status === "success") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-6 dark:bg-neutral-950">
        <div className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-elevated dark:border-neutral-800 dark:bg-neutral-900">
          <div className="text-4xl">✅</div>
          <h1 className="text-xl font-black text-neutral-900 dark:text-white">{t("appeal.success.title")}</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {t("appeal.success.body", { email: contactEmail || tokenInfo.email || "" })}
          </p>
          <a href="/auth/login" className="inline-block text-sm font-semibold text-primary-600 underline dark:text-primary-400">
            {t("appeal.backToLogin")}
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 py-10 dark:bg-neutral-950">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-elevated dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="mb-1 text-xl font-black text-neutral-900 dark:text-white">
          {tokenInfo.appealType === "ban" ? t("appeal.title.ban") : t("appeal.title.suspension")}
        </h1>
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">{t("appeal.intro")}</p>

        {tokenInfo.reason && (
          <div className="mb-4 rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            <p className="mb-0.5 font-semibold">{t("appeal.originalReasonLabel")}</p>
            <p>{tokenInfo.reason}</p>
          </div>
        )}
        {tokenInfo.appealType === "suspension" && tokenInfo.suspendedUntil && (
          <p className="mb-4 text-xs text-neutral-500">
            {t("auth.error.suspendedUntilLabel")}: {formatShortDateTime(tokenInfo.suspendedUntil)}
          </p>
        )}

        {status === "error" && (
          <div role="alert" className="mb-4 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-950 dark:text-danger-300">
            {errorMsg}
          </div>
        )}

        <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {t("appeal.reasonLabel")}
        </label>
        <textarea
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          rows={6}
          maxLength={2000}
          placeholder={t("appeal.reasonPlaceholder")}
          className="mb-4 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
        />

        <label className="mb-1 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
          {t("appeal.contactEmailLabel")}
        </label>
        <input
          type="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder={t("appeal.contactEmailPlaceholder")}
          className="mb-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
        />
        <p className="mb-4 text-xs text-neutral-400">{t("appeal.contactEmailHint")}</p>

        <button
          onClick={handleSubmit}
          disabled={status === "submitting" || reasonText.trim().length < 20 || !contactEmail}
          className="w-full rounded-xl bg-amber-400 px-6 py-3 text-sm font-bold text-neutral-900 transition-colors hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "submitting" ? t("appeal.submitting") : t("appeal.submitBtn")}
        </button>
      </div>
    </main>
  );
}

export default function AppealPage() {
  return (
    <Suspense>
      <AppealContent />
    </Suspense>
  );
}
