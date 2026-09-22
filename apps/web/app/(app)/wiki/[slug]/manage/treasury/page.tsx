"use client";

/**
 * app/(app)/wiki/[slug]/manage/treasury/page.tsx
 *
 * Reward pot for a wiki (owner only) — fund/edit/turn off via
 * GET/POST/PATCH/DELETE /api/wiki/<slug>/treasury. Mirrors
 * components/blogs/TreasuryPanel.tsx's shape (a per-post treasury there;
 * per-wiki here — first N distinct contributors/sharers split the pot).
 *
 * Once a pot exists, editing goes through PATCH (adjust amount/max
 * claimants) rather than re-POSTing — a plain re-fund used to additively
 * bump the amount while overwriting max_claimants outright, desyncing the
 * per-claimant reward from what earlier claimants had already been paid.
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
  const slug = params?.slug;

  const [ready, setReady] = useState(false);
  const [treasury, setTreasury] = useState<TreasuryState | null>(null);
  const [amount, setAmount] = useState(100);
  const [maxClaimants, setMaxClaimants] = useState(10);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEditing = !!treasury && treasury.status !== "closed";

  useEffect(() => {
    (async () => {
      const wikiRes = await fetch(`/api/wiki/${slug}`, { credentials: "include" });
      const wikiJson = await wikiRes.json().catch(() => null);
      if (!wikiJson?.data?.isOwner) { router.replace(`/wiki/${slug}`); return; }

      const treasuryRes = await fetch(`/api/wiki/${slug}/treasury`, { credentials: "include" });
      const treasuryJson = await treasuryRes.json().catch(() => null);
      const t: TreasuryState | null = treasuryJson?.data?.treasury ?? null;
      setTreasury(t);
      if (t && t.status !== "closed") {
        setAmount(t.fundedAmount);
        setMaxClaimants(t.maxClaimants);
      }
      setReady(true);
    })();
  }, [slug, router]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/wiki/${slug}/treasury`, {
        method: isEditing ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, maxClaimants }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? t("wiki.treasury.errors.generic", "Failed to save reward pot"));
      setTreasury(json.data.treasury);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wiki.treasury.errors.generic", "Failed to save reward pot"));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!confirm(t("wiki.treasury.confirmTurnOff", "Turn off this reward pot? Unclaimed funds are refunded to your balance."))) return;
    setClosing(true);
    setError(null);
    try {
      const res = await fetch(`/api/wiki/${slug}/treasury`, { method: "DELETE", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? t("wiki.treasury.errors.generic", "Failed to turn off reward pot"));
      setTreasury(json.data.treasury);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("wiki.treasury.errors.generic", "Failed to turn off reward pot"));
    } finally {
      setClosing(false);
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
            <span className="text-xs text-muted-foreground">
              {isEditing ? t("wiki.treasury.totalAmountLabel", "Total credits") : t("wiki.treasury.amountLabel", "Add credits")}
            </span>
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
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? isEditing
                ? t("wiki.treasury.saving", "Saving…")
                : t("wiki.treasury.funding", "Funding…")
              : isEditing
                ? t("wiki.treasury.saveChanges", "Save changes")
                : t("wiki.treasury.fund", "Fund pot")}
          </button>
          {isEditing && (
            <button
              type="button"
              onClick={turnOff}
              disabled={closing}
              className="rounded-lg border border-red-900/50 px-3 py-1.5 text-sm font-semibold text-red-400 hover:bg-red-950/30 disabled:opacity-50"
            >
              {closing ? t("wiki.treasury.turningOff", "Turning off…") : t("wiki.treasury.turnOff", "Turn off reward")}
            </button>
          )}
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}
