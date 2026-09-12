"use client";

/**
 * app/(app)/wiki/[slug]/manage/treasury/page.tsx
 *
 * Reward pot for a wiki (owner only) — fund/top-up
 * GET/POST /api/wiki/<slug>/treasury. Mirrors
 * components/blogs/TreasuryPanel.tsx's shape (a per-post treasury there;
 * per-wiki here — first N distinct contributors/sharers split the pot).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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

export default function WikiTreasuryPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [ready, setReady] = useState(false);
  const [treasury, setTreasury] = useState<TreasuryState | null>(null);
  const [amount, setAmount] = useState(100);
  const [maxClaimants, setMaxClaimants] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const wikiRes = await fetch(`/api/wiki/${slug}`, { credentials: "include" });
      const wikiJson = await wikiRes.json().catch(() => null);
      if (!wikiJson?.data?.isOwner) { router.replace(`/wiki/${slug}`); return; }

      const treasuryRes = await fetch(`/api/wiki/${slug}/treasury`, { credentials: "include" });
      const treasuryJson = await treasuryRes.json().catch(() => null);
      setTreasury(treasuryJson?.data?.treasury ?? null);
      setReady(true);
    })();
  }, [slug, router]);

  async function fund() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/wiki/${slug}/treasury`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, maxClaimants }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? t("wiki.treasury.errors.generic", "Failed to fund reward pot"));
      setTreasury(json.data.treasury);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wiki.treasury.errors.generic", "Failed to fund reward pot"));
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-4">
      <div>
        <Link href={`/wiki/${slug}/manage`} className="mb-2 inline-block text-xs text-muted-foreground hover:text-foreground">
          ← {t("wiki.dashboard.backToManage", "Back to manage")}
        </Link>
        <h1 className="text-2xl font-bold text-foreground">{t("wiki.dashboard.treasury", "Reward Pot")}</h1>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-xs text-muted-foreground">
          {t("wiki.treasury.hint", "Fund a Credits pot for this wiki — the first contributors or sharers split it evenly.")}
        </p>

        {treasury && (
          <div className="rounded-lg bg-neutral-900/50 p-3 text-xs text-muted-foreground space-y-1">
            <div>{t("wiki.treasury.status", "Status: {{status}}", { status: treasury.status })}</div>
            <div>{t("wiki.treasury.claimed", "{{claimed}} / {{max}} claimed", { claimed: treasury.claimantCount, max: treasury.maxClaimants })}</div>
            <div>{t("wiki.treasury.remaining", "{{remaining}} of {{funded}} credits remaining", { remaining: treasury.remainingAmount, funded: treasury.fundedAmount })}</div>
            <div>{t("wiki.treasury.perClaimant", "{{amount}} credits per claimant", { amount: treasury.rewardPerClaimant })}</div>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t("wiki.treasury.amountLabel", "Add credits")}</span>
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
            <span className="text-xs text-muted-foreground">{t("wiki.treasury.maxClaimantsLabel", "Max claimants")}</span>
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
            {busy ? t("wiki.treasury.funding", "Funding…") : treasury ? t("wiki.treasury.topUp", "Top up") : t("wiki.treasury.fund", "Fund pot")}
          </button>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}
