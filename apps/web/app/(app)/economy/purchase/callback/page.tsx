"use client";

/**
 * app/(app)/economy/purchase/callback/page.tsx
 *
 * Paystack redirect target after a coin/star purchase.
 * Paystack appends ?reference=...&trxref=... to the URL.
 * This page verifies the payment with the backend and shows
 * a success or error state with a link back to the wallet.
 */

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Inner component (needs useSearchParams, so must be inside Suspense)
// ---------------------------------------------------------------------------

function CallbackContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();
  const reference =
    searchParams.get("reference") ?? searchParams.get("trxref");

  const [status, setStatus] = useState<"loading" | "success" | "pending" | "error">(
    "loading",
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!reference) {
      setStatus("error");
      setMessage(t("purchase.callback.noReference"));
      return;
    }

    fetch("/api/economy/coins/purchase/verify", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.success || d.data) {
          setStatus("success");
          setMessage(
            d.message ?? "Payment confirmed! Your coins have been credited.",
          );
        } else if (d.pending) {
          setStatus("pending");
          setMessage(
            d.error?.message ?? "Your payment is being processed. Your coins will appear in your wallet shortly.",
          );
        } else {
          setStatus("error");
          setMessage(
            d.error?.message ??
              d.error ??
              "Payment verification failed. Please contact support.",
          );
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage(t("purchase.callback.networkError"));
      });
  }, [reference, t]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        {status === "loading" && (
          <div className="flex flex-col items-center gap-4 text-center">
            {/* Spinner */}
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-neutral-200 border-t-blue-600 dark:border-neutral-700 dark:border-t-blue-400" />
            <p className="text-base font-medium text-neutral-700 dark:text-neutral-300">
              {t("purchase.callback.verifying")}
            </p>
            <p className="text-sm text-neutral-500 dark:text-neutral-400">
              {t("purchase.callback.verifyingHint")}
            </p>
          </div>
        )}

        {status === "success" && (
          <div className="flex flex-col items-center gap-4 text-center">
            {/* Success icon */}
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
              <svg
                className="h-7 w-7 text-green-600 dark:text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
              {t("purchase.callback.success")}
            </h1>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {message}
            </p>
            <Link
              href="/wallet"
              className="mt-2 w-full rounded-xl bg-blue-600 py-2.5 text-center text-sm font-semibold text-white hover:bg-blue-700 active:bg-blue-800"
            >
              {t("purchase.callback.goToWallet")}
            </Link>
          </div>
        )}

        {status === "pending" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
              <svg className="h-7 w-7 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2M12 2a10 10 0 100 20A10 10 0 0012 2z" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">{t("purchase.callback.pending")}</h1>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{message}</p>
            <Link href="/wallet" className="mt-2 w-full rounded-xl bg-blue-600 py-2.5 text-center text-sm font-semibold text-white hover:bg-blue-700 active:bg-blue-800">
              {t("purchase.callback.goToWallet")}
            </Link>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
              <svg
                className="h-7 w-7 text-red-600 dark:text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">
              {t("purchase.callback.error")}
            </h1>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              {message}
            </p>
            <Link
              href="/wallet"
              className="mt-2 w-full rounded-xl border border-neutral-300 bg-white py-2.5 text-center text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              {t("purchase.callback.goToWallet")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page export — wraps CallbackContent in Suspense for useSearchParams
// ---------------------------------------------------------------------------

export default function PurchaseCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-neutral-50 dark:bg-neutral-950">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-neutral-200 border-t-blue-600 dark:border-neutral-700 dark:border-t-blue-400" />
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
