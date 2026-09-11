"use client";

/**
 * components/polls/FundTreasuryModal.tsx
 *
 * Shared "fund a reward pot" widget for a poll or quiz creator, used on
 * both app/poll/[slug]/page.tsx and app/quiz/[slug]/page.tsx (only rendered
 * when isOwner === true). Funds from the creator's own Credits balance —
 * mirrors the balance-fetch pattern in app/(app)/blogs/gift/[slug]/page.tsx
 * (GET /api/economy/coins/balance) and useCurrency() for the display name.
 *
 * POST /api/polls/:slug/treasury or /api/quizzes/:slug/treasury
 *   { amount, maxClaimants }
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { translateApiError } from "@/lib/i18n/apiErrors";

export interface TreasuryState {
  id: string;
  fundedAmount: number;
  remainingAmount: number;
  maxClaimants: number;
  claimantCount: number;
  status: string;
  rewardPerClaimant: number;
}

export function FundTreasuryModal({
  contentType,
  slug,
  initialTreasury,
}: {
  contentType: "poll" | "quiz";
  slug: string;
  initialTreasury: TreasuryState | null;
}) {
  const { t } = useTranslation();
  const currency = useCurrency();
  const [open, setOpen] = useState(false);
  const [treasury, setTreasury] = useState<TreasuryState | null>(initialTreasury);
  const [balance, setBalance] = useState<number | null>(null);
  const [amount, setAmount] = useState("100");
  const [maxClaimants, setMaxClaimants] = useState("10");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/economy/coins/balance", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { balance?: number } | null) => {
        if (data?.balance != null) setBalance(data.balance);
      })
      .catch(() => {});
  }, [open]);

  const explainer =
    contentType === "poll"
      ? t("polls.treasury.explain", "The first N people who vote (or share) will split this pot evenly.")
      : t("quizzes.treasury.explain", "The first N people who PASS (or share) will split this pot evenly.");

  async function handleFund() {
    const amountNum = parseInt(amount, 10);
    const maxClaimantsNum = parseInt(maxClaimants, 10);
    if (!Number.isInteger(amountNum) || amountNum <= 0 || !Number.isInteger(maxClaimantsNum) || maxClaimantsNum <= 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const endpoint = contentType === "poll" ? `/api/polls/${slug}/treasury` : `/api/quizzes/${slug}/treasury`;
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amountNum, maxClaimants: maxClaimantsNum }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const err = new Error(json?.error?.message ?? "Failed to fund reward pot") as Error & { code?: string | null };
        err.code = json?.error?.code ?? null;
        throw err;
      }
      setTreasury(json.data as TreasuryState);
      setOpen(false);
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(translateApiError(t, err.code, err.message || "Something went wrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      {treasury && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
          🎁 {treasury.fundedAmount} {currency.softPlural.toLowerCase()} funded · {treasury.claimantCount}/{treasury.maxClaimants} claimed ·{" "}
          {treasury.rewardPerClaimant} {currency.softPlural.toLowerCase()} each · {treasury.status}
        </div>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground hover:bg-accent"
        >
          🎁 {t("polls.treasury.fundButton", "Fund reward pot")}
        </button>
      ) : (
        <div className="rounded-xl border border-border bg-background p-4">
          <p className="mb-3 text-xs text-muted-foreground">{explainer}</p>

          {balance != null && (
            <p className="mb-3 text-xs text-muted-foreground">
              {t("polls.treasury.balance", "Your balance:")}{" "}
              <span className="font-semibold text-foreground">{balance.toLocaleString()} {currency.softPlural.toLowerCase()}</span>
            </p>
          )}

          {error && <div className="mb-3 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("polls.treasury.amountLabel", "Amount ({{currency}})", { currency: currency.softPlural })}
              </span>
              <input
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("polls.treasury.maxClaimantsLabel", "Max claimants")}
              </span>
              <input
                type="number"
                min={1}
                value={maxClaimants}
                onChange={(e) => setMaxClaimants(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </label>
          </div>

          {amount && maxClaimants && parseInt(amount, 10) > 0 && parseInt(maxClaimants, 10) > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("polls.treasury.perClaimantPreview", "≈ {{perClaimant}} {{currency}} per person", {
                perClaimant: Math.floor(parseInt(amount, 10) / parseInt(maxClaimants, 10)),
                currency: currency.softPlural.toLowerCase(),
              })}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 rounded-xl border border-border py-2 text-sm font-semibold text-foreground hover:bg-accent"
            >
              {t("polls.treasury.cancel", "Cancel")}
            </button>
            <button
              type="button"
              onClick={handleFund}
              disabled={submitting}
              className="flex-1 rounded-xl bg-primary-600 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {submitting ? t("polls.treasury.funding", "Funding…") : t("polls.treasury.confirm", "Fund pot")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
