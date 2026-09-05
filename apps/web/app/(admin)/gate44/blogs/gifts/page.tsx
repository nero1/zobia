"use client";

/**
 * app/(admin)/gate44/blogs/gifts/page.tsx
 *
 * Admin control over Rewarded Gifts (migration 0024): the sitewide
 * feature_blog_gifts + blog_monetization_enabled toggles (also editable at
 * gate44/config), plus a cross-blog table of every gift tier with an
 * admin override to disable one. Mirrors gate44/blogs/themes's table shape.
 * Revenue share for gifts follows the existing per-plan blog_rev_share_pct_*
 * keys (see gate44/config → Blogs) — the same convention as paywall
 * unlocks, so there's no separate gifts-only rate here.
 */

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { formatShortDate } from "@/lib/format/date";

interface TierRow {
  id: string;
  name: string;
  benefit_type: string;
  credits_price: number | null;
  stars_price: number | null;
  max_redemptions: number | null;
  redemption_count: number;
  expires_at: string | null;
  enabled: boolean;
  created_at: string;
  blog_slug: string;
  blog_title: string;
  owner_username: string | null;
}

export default function AdminBlogGiftsPage() {
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [flags, setFlags] = useState<{ feature_blog_gifts?: string; blog_monetization_enabled?: string }>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tiersRes, configRes] = await Promise.all([
        fetch("/api/admin/blogs/gifts", { credentials: "include" }),
        fetch("/api/admin/config", { credentials: "include" }),
      ]);
      const tiersJson = await tiersRes.json().catch(() => null);
      const configJson = await configRes.json().catch(() => null);
      setTiers(tiersJson?.data?.tiers ?? []);
      const entries: { key: string; value: string }[] = configJson?.data ?? [];
      const found: Record<string, string> = {};
      for (const e of entries) {
        if (e.key === "feature_blog_gifts" || e.key === "blog_monetization_enabled") found[e.key] = e.value;
      }
      setFlags(found);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggleFlag(key: "feature_blog_gifts" | "blog_monetization_enabled") {
    const next = flags[key] === "true" ? "false" : "true";
    setBusy(key);
    try {
      const res = await fetch(`/api/admin/config/${key}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: next }),
      });
      if (!res.ok) throw new Error("Update failed");
      setFlags((prev) => ({ ...prev, [key]: next }));
      showToast("Saved");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function toggleTier(tier: TierRow) {
    setBusy(tier.id);
    try {
      const res = await fetch(`/api/admin/blogs/gifts/${tier.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !tier.enabled }),
      });
      if (!res.ok) throw new Error("Update failed");
      setTiers((prev) => prev.map((t) => (t.id === tier.id ? { ...t, enabled: !t.enabled } : t)));
      showToast("Saved");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Rewarded Gifts</h1>
        <Link href="/gate44/blogs" className="text-sm font-semibold text-teal-600 hover:underline dark:text-teal-400">← All Blogs</Link>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-teal-600 px-4 py-3 text-sm font-medium text-white shadow-modal">{toast}</div>
      )}

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block font-semibold text-neutral-900 dark:text-neutral-50">Gifts feature</span>
              <span className="block text-xs text-neutral-500">Sitewide on/off for tiers, purchases, and the &quot;Send a Gift&quot; section.</span>
            </span>
            <input
              type="checkbox"
              disabled={busy === "feature_blog_gifts"}
              checked={flags.feature_blog_gifts !== "false"}
              onChange={() => toggleFlag("feature_blog_gifts")}
            />
          </label>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block font-semibold text-neutral-900 dark:text-neutral-50">Blog monetization kill-switch</span>
              <span className="block text-xs text-neutral-500">Master switch for ALL blog monetization: paywall unlocks, reward pots, and gifts. Also at gate44/config → Blogs.</span>
            </span>
            <input
              type="checkbox"
              disabled={busy === "blog_monetization_enabled"}
              checked={flags.blog_monetization_enabled !== "false"}
              onChange={() => toggleFlag("blog_monetization_enabled")}
            />
          </label>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-3">Tier</th>
              <th className="px-4 py-3">Blog</th>
              <th className="px-4 py-3">Benefit</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Redeemed</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Enabled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 7 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" /></td>)}</tr>
              ))
            ) : tiers.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-neutral-500">No gift tiers yet.</td></tr>
            ) : tiers.map((tier) => (
              <tr key={tier.id}>
                <td className="px-4 py-3 font-medium text-neutral-900 dark:text-neutral-50">{tier.name}</td>
                <td className="px-4 py-3">
                  <Link href={`/b/${tier.blog_slug}`} target="_blank" className="text-teal-600 hover:underline dark:text-teal-400">{tier.blog_title}</Link>
                  <div className="text-xs text-neutral-500">@{tier.owner_username}</div>
                </td>
                <td className="px-4 py-3 capitalize text-neutral-600 dark:text-neutral-400">{tier.benefit_type.replace(/_/g, " ")}</td>
                <td className="px-4 py-3 tabular-nums text-neutral-600 dark:text-neutral-400">
                  {[tier.credits_price ? `${tier.credits_price}c` : null, tier.stars_price ? `${tier.stars_price}★` : null].filter(Boolean).join(" / ")}
                </td>
                <td className="px-4 py-3 tabular-nums">{tier.redemption_count}{tier.max_redemptions ? ` / ${tier.max_redemptions}` : ""}</td>
                <td className="px-4 py-3 text-neutral-500">{formatShortDate(tier.created_at)}</td>
                <td className="px-4 py-3">
                  <input type="checkbox" disabled={busy === tier.id} checked={tier.enabled} onChange={() => toggleTier(tier)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
