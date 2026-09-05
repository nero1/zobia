"use client";

/**
 * components/blogs/TreasuryPanel.tsx
 *
 * Owner-only panel (shown in the post editor, for already-saved posts) to
 * fund/top-up a post's Credits reward pot and see its current state. The
 * first `maxClaimants` readers who comment on or share the post split the
 * pot evenly — see lib/blogs/service.ts's fundPostTreasury/claimTreasuryReward.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface TreasuryState {
  id: string;
  fundedAmount: number;
  remainingAmount: number;
  maxClaimants: number;
  claimantCount: number;
  status: string;
  rewardPerClaimant: number;
}

export function TreasuryPanel({ blogSlug, postSlug }: { blogSlug: string; postSlug: string }) {
  const { t } = useTranslation();
  const [treasury, setTreasury] = useState<TreasuryState | null | undefined>(undefined);
  const [amount, setAmount] = useState(100);
  const [maxClaimants, setMaxClaimants] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/blogs/${blogSlug}/posts/${postSlug}/treasury`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setTreasury(json?.data?.treasury ?? null))
      .catch(() => setTreasury(null));
  }, [blogSlug, postSlug]);

  async function fund() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/blogs/${blogSlug}/posts/${postSlug}/treasury`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, maxClaimants }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to fund reward pot");
      setTreasury(json.data.treasury);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fund reward pot");
    } finally {
      setBusy(false);
    }
  }

  if (treasury === undefined) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{t("blogs.treasury.title", "Reward pot")}</h3>
      <p className="text-xs text-muted-foreground">
        {t("blogs.treasury.hint", "Fund a Credits pot for this post — the first readers who comment or share split it evenly.")}
      </p>

      {treasury && (
        <div className="rounded-lg bg-neutral-900/50 p-3 text-xs text-muted-foreground space-y-1">
          <div>{t("blogs.treasury.status", "Status: {{status}}", { status: treasury.status })}</div>
          <div>{t("blogs.treasury.claimed", "{{claimed}} / {{max}} claimed", { claimed: treasury.claimantCount, max: treasury.maxClaimants })}</div>
          <div>{t("blogs.treasury.remaining", "{{remaining}} of {{funded}} credits remaining", { remaining: treasury.remainingAmount, funded: treasury.fundedAmount })}</div>
          <div>{t("blogs.treasury.perClaimant", "{{amount}} credits per claimant", { amount: treasury.rewardPerClaimant })}</div>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("blogs.treasury.amountLabel", "Add credits")}</span>
          <input
            type="number"
            min={1}
            max={1000000}
            value={amount}
            onChange={(e) => setAmount(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("blogs.treasury.maxClaimantsLabel", "Max claimants")}</span>
          <input
            type="number"
            min={1}
            max={10000}
            value={maxClaimants}
            onChange={(e) => setMaxClaimants(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-28 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground"
          />
        </label>
        <button
          type="button"
          onClick={fund}
          disabled={busy}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? t("blogs.treasury.funding", "Funding…") : treasury ? t("blogs.treasury.topUp", "Top up") : t("blogs.treasury.fund", "Fund pot")}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
