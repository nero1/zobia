"use client";

/**
 * components/ads/BoostContentButton.tsx
 *
 * "Boost this" entry point for any boostable content type (see
 * lib/ads/repo.ts BoostableContentType). Renders next to a piece of
 * content's existing owner-only actions (edit/delete) and, when clicked,
 * opens a small modal that:
 *   1. Checks eligibility via GET /api/ads/boostable (ownership, advertiser
 *      eligibility, feature flag).
 *   2. Lets the owner (or an admin/mod, for an in-house boost) set a budget
 *      and optional duration, then calls POST /api/content/boost — which
 *      creates the underlying ad_campaigns row and submits it for
 *      moderation in one step (see that route for details).
 *   3. Optionally funds the new campaign from the caller's Ad Wallet, via
 *      the same /api/business/ads/campaigns/:id/fund endpoint the full
 *      self-service Ad Campaigns flow uses (app/(app)/business/ads/page.tsx)
 *      — campaign ownership there is by created_by, not business_account_id,
 *      so it works for a personal-advertiser boost campaign too.
 *
 * Hidden entirely when the `boostedPosts` manifest feature flag is off.
 * Visual language (rounded-2xl/xl neutral borders, blue-600 primary button)
 * intentionally matches the existing Ads UI in business/ads/page.tsx — a
 * boost IS an ad campaign under the hood.
 */

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useFeatureEnabled } from "@/lib/hooks/useFeatureFlags";
import { translateApiError } from "@/lib/i18n/apiErrors";
import type { BoostableContentType } from "@/lib/ads/repo";

interface BoostableResponse {
  boostable: boolean;
  reason: string | null;
  isInHouse?: boolean;
  preview?: { title: string | null; body: string | null; imageUrl: string | null };
}

const DURATION_OPTIONS = [
  { key: "3d", days: 3 },
  { key: "1w", days: 7 },
  { key: "2w", days: 14 },
  { key: "1m", days: 30 },
  { key: "none", days: null },
] as const;
type DurationKey = (typeof DURATION_OPTIONS)[number]["key"];

export function BoostContentButton({
  contentType,
  contentId,
  title,
  imageUrl,
  className,
}: {
  contentType: BoostableContentType;
  contentId: string;
  /** Optional preview title shown in the modal — falls back to the server's own preview lookup. */
  title?: string;
  imageUrl?: string | null;
  /** Extra classes for the trigger button, so callers can match surrounding owner-action styling. */
  className?: string;
}) {
  const { t } = useTranslation();
  const boostedPostsEnabled = useFeatureEnabled("boostedPosts");

  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<BoostableResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [budgetCredits, setBudgetCredits] = useState(1000);
  const [duration, setDuration] = useState<DurationKey>("1w");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<{ moderationStatus: "pending" | "approved"; fundNote: string | null } | null>(null);

  if (!boostedPostsEnabled) return null;

  async function openModal() {
    setOpen(true);
    setResult(null);
    setSubmitError(null);
    setChecking(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ contentType, contentId });
      const res = await fetch(`/api/ads/boostable?${params.toString()}`, { credentials: "include" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error?.message ?? t("ads.boost.loadFailed", "Failed to check eligibility"));
      }
      setChecked(json.data as BoostableResponse);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t("ads.boost.loadFailed", "Failed to check eligibility"));
    } finally {
      setChecking(false);
    }
  }

  function close() {
    setOpen(false);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const durationDays = DURATION_OPTIONS.find((d) => d.key === duration)?.days ?? null;
      const endAt = durationDays ? new Date(Date.now() + durationDays * 86_400_000).toISOString() : undefined;

      const boostRes = await fetch("/api/content/boost", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentType, contentId, endAt }),
      });
      const boostJson = await boostRes.json().catch(() => null);
      if (!boostRes.ok || !boostJson?.success) {
        const err = new Error(boostJson?.error?.message ?? t("ads.boost.createFailed", "Failed to submit boost")) as Error & { code?: string | null };
        err.code = boostJson?.error?.code ?? null;
        throw err;
      }

      const campaignId = boostJson.data.campaign.id as string;
      const moderationStatus = boostJson.data.moderation.moderationStatus as "pending" | "approved";
      let fundNote: string | null = null;

      if (budgetCredits > 0) {
        const fundRes = await fetch(`/api/business/ads/campaigns/${campaignId}/fund`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amountCredits: Number(budgetCredits) }),
        });
        const fundJson = await fundRes.json().catch(() => null);
        if (!fundJson?.success) {
          fundNote = fundJson?.error?.message ?? t("ads.boost.fundFailedGeneric", "check your Ad Wallet balance");
        }
      }

      setResult({ moderationStatus, fundNote });
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setSubmitError(translateApiError(t, err.code, err.message || t("ads.boost.createFailed", "Failed to submit boost")));
    } finally {
      setSubmitting(false);
    }
  }

  const previewTitle = title || checked?.preview?.title || t("ads.boost.previewFallbackTitle", "This content");
  const previewImage = imageUrl ?? checked?.preview?.imageUrl ?? null;

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={
          className ??
          "rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        }
      >
        🚀 {t("ads.boost.button", "Boost")}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={close}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={close}
              aria-label={t("ads.boost.close", "Close")}
              className="absolute right-4 top-4 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              ✕
            </button>

            <h2 className="mb-1 pr-6 text-base font-bold text-neutral-900 dark:text-neutral-50">
              🚀 {t("ads.boost.modalTitle", "Boost this content")}
            </h2>

            {result ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300">
                  <p className="font-semibold">{t("ads.boost.successTitle", "Boost submitted!")}</p>
                  <p className="mt-1 text-xs">
                    {result.moderationStatus === "approved"
                      ? t("ads.boost.successBodyApproved", "Your boost was approved and will start running once funded.")
                      : t("ads.boost.successBodyPending", "Your boost is pending moderation review before it starts running.")}
                  </p>
                </div>
                {result.fundNote && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {t("ads.boost.fundFailedNote", "Boost created, but not funded: {{reason}}. Fund it from the Advertising Panel to start running.", { reason: result.fundNote })}
                  </p>
                )}
                <div className="flex gap-2">
                  <button onClick={close} className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold text-neutral-700 dark:border-neutral-700 dark:text-neutral-200">
                    {t("ads.boost.doneButton", "Done")}
                  </button>
                  <Link
                    href="/business/ads"
                    className="flex-1 rounded-xl bg-blue-600 py-2 text-center text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    {t("ads.boost.viewCampaigns", "My Campaigns →")}
                  </Link>
                </div>
              </div>
            ) : checking ? (
              <div className="mt-4 space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
                <div className="h-16 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
              </div>
            ) : loadError ? (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">{loadError}</p>
            ) : checked && !checked.boostable ? (
              <div className="mt-3 space-y-1">
                <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">{t("ads.boost.ineligibleTitle", "Can't boost this yet")}</p>
                <p className="text-sm text-neutral-500">{checked.reason ?? t("ads.boost.ineligibleDefault", "This content isn't eligible to be boosted right now.")}</p>
              </div>
            ) : checked ? (
              <div className="mt-3 space-y-3">
                <div className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/60">
                  {previewImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewImage} alt="" className="h-10 w-10 flex-shrink-0 rounded-lg object-cover" />
                  )}
                  <p className="min-w-0 truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">{previewTitle}</p>
                </div>

                {checked.isInHouse && (
                  <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    {t("ads.boost.inHouseBadge", "In-house boost")}
                  </span>
                )}

                {submitError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{submitError}</div>
                )}

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                    {t("ads.boost.budgetLabel", "Budget (Credits)")}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={budgetCredits}
                    onChange={(e) => setBudgetCredits(Number(e.target.value))}
                    className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                  />
                  <p className="mt-1 text-xs text-neutral-400">
                    {t("ads.boost.budgetHint", "Debited from your Ad Wallet once approved. You can set this to 0 and fund it later from the Advertising Panel.")}
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                    {t("ads.boost.durationLabel", "Duration")}
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {DURATION_OPTIONS.map((d) => (
                      <button
                        key={d.key}
                        type="button"
                        onClick={() => setDuration(d.key)}
                        className={`rounded-lg border px-2.5 py-1 text-xs font-medium ${
                          duration === d.key
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-neutral-300 text-neutral-600 dark:border-neutral-600 dark:text-neutral-300"
                        }`}
                      >
                        {t(`ads.boost.duration.${d.key}`, d.days ? `${d.days}d` : "No end date")}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSubmit}
                  className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {submitting ? t("ads.boost.submitting", "Submitting…") : t("ads.boost.submit", "Boost & Submit for Review")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
