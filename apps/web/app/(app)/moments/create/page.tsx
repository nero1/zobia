"use client";

/**
 * app/(app)/moments/create/page.tsx
 *
 * Create a new Moment — text content with optional image URL and caption.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { useMomentsConfig } from "@/lib/hooks/useMomentsConfig";

const MAX_CONTENT = 500;
const MAX_CAPTION = 200;

interface InsufficientFundsInfo {
  costCredits: number;
  costStars: number;
  creditBalance?: number;
  starBalance?: number;
}

/**
 * Moments create form page.
 */
export default function CreateMomentPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const currency = useCurrency();
  const momentsConfig = useMomentsConfig();

  const [content, setContent] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [optionalExpanded, setOptionalExpanded] = useState(false);
  const [payCurrency, setPayCurrency] = useState<"credits" | "stars">("credits");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficientFunds, setInsufficientFunds] = useState<InsufficientFundsInfo | null>(null);

  const bothCurrenciesAvailable = momentsConfig.costCredits > 0 && momentsConfig.costStars > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, string> = { content: content.trim() };
      if (imageUrl.trim()) {
        body.media_url = imageUrl.trim();
        body.content_type = "image";
      }
      if (caption.trim()) body.caption = caption.trim();
      if (!momentsConfig.isFree) body.currency = payCurrency;

      const res = await fetch("/api/moments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.status === 401) { router.push("/auth/login"); return; }
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as {
          message?: string;
          error?: {
            code?: string;
            message?: string;
            params?: { costCredits?: number; costStars?: number; creditBalance?: number; starBalance?: number; minLevel?: number; currentLevel?: number };
          };
        };
        const code = d.error?.code ?? null;
        const message = d.error?.message ?? d.message ?? "Failed to post moment";

        if (code === "INSUFFICIENT_MOMENT_FUNDS") {
          setInsufficientFunds({
            costCredits: d.error?.params?.costCredits ?? momentsConfig.costCredits,
            costStars: d.error?.params?.costStars ?? momentsConfig.costStars,
            creditBalance: d.error?.params?.creditBalance,
            starBalance: d.error?.params?.starBalance,
          });
          return;
        }

        const err = new Error(message) as Error & { code?: string | null };
        err.code = code;
        throw err;
      }

      router.push("/moments");
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(e instanceof Error ? translateApiError(t, err.code, err.message || "Something went wrong") : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Link
          href="/moments"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          aria-label="Back to Moments"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("moments.create.title")}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Content */}
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t("moments.create.whatsHappening")}</h2>
          </div>
          <div className="p-5">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value.slice(0, MAX_CONTENT))}
              placeholder={t("moments.create.placeholder")}
              rows={4}
              maxLength={MAX_CONTENT}
              className="w-full resize-none rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
            />
            <div className="mt-1.5 flex justify-end">
              <span className={`text-xs tabular-nums ${content.length >= MAX_CONTENT ? "text-red-500" : "text-neutral-400"}`}>
                {content.length}/{MAX_CONTENT}
              </span>
            </div>
          </div>
        </div>

        {/* Optional fields — collapsed by default, mirrors the New Member Quest banner pattern */}
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setOptionalExpanded((v) => !v)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setOptionalExpanded((v) => !v); }}
            className="flex cursor-pointer items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800"
            aria-expanded={optionalExpanded}
          >
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t("moments.create.optional")}</h2>
            <span className="text-xs text-neutral-400">{optionalExpanded ? "▲" : "▼"}</span>
          </div>
          {optionalExpanded && (
            <div className="space-y-4 p-5">
              {/* Image URL */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  {t("moments.create.imageUrl")}
                </label>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder={t("moments.create.imageUrlPlaceholder")}
                  className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
                />
              </div>

              {/* Caption */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  {t("moments.create.caption")}
                </label>
                <input
                  type="text"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION))}
                  placeholder={t("moments.create.captionPlaceholder")}
                  maxLength={MAX_CAPTION}
                  className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
                />
                <div className="mt-1 flex justify-end">
                  <span className={`text-xs tabular-nums ${caption.length >= MAX_CAPTION ? "text-red-500" : "text-neutral-400"}`}>
                    {caption.length}/{MAX_CAPTION}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Pricing notice + currency picker */}
        {!momentsConfig.isFree && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              {t("moments.create.costNotice", {
                cost: payCurrency === "credits" ? momentsConfig.costCredits : momentsConfig.costStars,
                currency: payCurrency === "credits" ? currency.softPlural : currency.premiumPlural,
              })}
            </p>
            {bothCurrenciesAvailable && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-amber-700 dark:text-amber-400">{t("moments.create.payWith")}:</span>
                <div className="flex overflow-hidden rounded-lg border border-amber-300 dark:border-amber-700">
                  <button
                    type="button"
                    onClick={() => setPayCurrency("credits")}
                    className={`px-2.5 py-1 font-semibold transition-colors ${payCurrency === "credits" ? "bg-amber-500 text-white" : "bg-white text-amber-700 dark:bg-neutral-900 dark:text-amber-300"}`}
                  >
                    {currency.softPlural}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayCurrency("stars")}
                    className={`px-2.5 py-1 font-semibold transition-colors ${payCurrency === "stars" ? "bg-amber-500 text-white" : "bg-white text-amber-700 dark:bg-neutral-900 dark:text-amber-300"}`}
                  >
                    {currency.premiumPlural}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Link
            href="/moments"
            className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-center text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {t("moments.create.cancel")}
          </Link>
          <button
            type="submit"
            disabled={!content.trim() || submitting}
            className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? t("moments.create.posting") : t("moments.create.post")}
          </button>
        </div>
      </form>

      {/* Insufficient funds popup */}
      {insufficientFunds && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setInsufficientFunds(null)}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setInsufficientFunds(null)}
              className="absolute right-4 top-4 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              aria-label="Close"
            >
              ✕
            </button>
            <h2 className="mb-2 text-base font-bold text-neutral-900 dark:text-neutral-50">
              {t("moments.create.insufficientTitle", { currency: `${currency.softPlural}/${currency.premiumPlural}` })}
            </h2>
            <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
              {t("moments.create.insufficientMessage", {
                costCredits: insufficientFunds.costCredits,
                costStars: insufficientFunds.costStars,
              })}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setInsufficientFunds(null)}
                className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {t("moments.create.gotIt")}
              </button>
              <Link
                href="/wallet?buy=true"
                className="flex-1 rounded-xl bg-amber-500 py-2 text-center text-sm font-semibold text-white hover:bg-amber-600"
                onClick={() => setInsufficientFunds(null)}
              >
                {t("moments.create.buyCredits", { currency: currency.softPlural })}
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
