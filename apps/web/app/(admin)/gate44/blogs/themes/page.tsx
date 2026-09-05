"use client";

/**
 * app/(admin)/gate44/blogs/themes/page.tsx
 *
 * Admin control over the blog theme catalog (migration 0022): toggle
 * enabled, plan/business-tier gating, and credits/stars price per theme.
 * Mirrors the table pattern from gate44/blogs/page.tsx.
 */

import { useEffect, useState, useCallback } from "react";

interface ThemeRow {
  id: string;
  name: string;
  description: string | null;
  layout_variant: string;
  is_free_default: boolean;
  included_for_plans: string[];
  included_for_business_tiers: string[];
  credits_cost: number | null;
  stars_cost: number | null;
  enabled: boolean;
  store_item_id: string | null;
}

const PLANS = ["free", "plus", "pro", "max"] as const;
const BUSINESS_TIERS = ["starter", "growth", "enterprise"] as const;

export default function AdminBlogThemesPage() {
  const [themes, setThemes] = useState<ThemeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/blogs/themes", { credentials: "include" });
      const json = await res.json();
      setThemes(json?.data?.themes ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/blogs/themes/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Update failed");
      showToast("Saved");
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  function toggleTier(theme: ThemeRow, kind: "plan" | "tier", value: string) {
    if (kind === "plan") {
      const next = theme.included_for_plans.includes(value)
        ? theme.included_for_plans.filter((p) => p !== value)
        : [...theme.included_for_plans, value];
      void patch(theme.id, { includedForPlans: next });
    } else {
      const next = theme.included_for_business_tiers.includes(value)
        ? theme.included_for_business_tiers.filter((p) => p !== value)
        : [...theme.included_for_business_tiers, value];
      void patch(theme.id, { includedForBusinessTiers: next });
    }
  }

  return (
    <div className="relative">
      <h1 className="mb-2 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Blog Themes</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Two free-default themes are always available to every blog. Everything else is gated by plan/business tier, or purchasable with credits/stars via the existing cosmetics ledger.
      </p>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-teal-600 px-4 py-3 text-sm font-medium text-white shadow-modal">{toast}</div>
      )}

      <div className="space-y-4">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-32 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />)
        ) : (
          themes.map((th) => (
            <div key={th.id} className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-neutral-900 dark:text-neutral-50">{th.name}</h2>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-neutral-500 dark:bg-neutral-800">{th.layout_variant}</span>
                    {th.is_free_default && <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">Free default</span>}
                  </div>
                  <p className="mt-1 max-w-lg text-xs text-neutral-500">{th.description}</p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled={busy === th.id} checked={th.enabled} onChange={(e) => patch(th.id, { enabled: e.target.checked })} />
                  Enabled
                </label>
              </div>

              {!th.is_free_default && (
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase text-neutral-500">Free for plans</div>
                    <div className="flex flex-wrap gap-1.5">
                      {PLANS.map((p) => (
                        <button key={p} disabled={busy === th.id} onClick={() => toggleTier(th, "plan", p)} className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${th.included_for_plans.includes(p) ? "bg-teal-600 text-white" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}>{p}</button>
                      ))}
                    </div>
                    <div className="mb-1 mt-3 text-xs font-semibold uppercase text-neutral-500">Free for business tiers</div>
                    <div className="flex flex-wrap gap-1.5">
                      {BUSINESS_TIERS.map((tier) => (
                        <button key={tier} disabled={busy === th.id} onClick={() => toggleTier(th, "tier", tier)} className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${th.included_for_business_tiers.includes(tier) ? "bg-teal-600 text-white" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}>{tier}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase text-neutral-500">Price for everyone else</div>
                    {!th.store_item_id ? (
                      <p className="text-xs text-neutral-500">Not purchasable (no linked store item) — only free/plan-included.</p>
                    ) : (
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-sm">
                          Credits
                          <input
                            type="number"
                            min={0}
                            defaultValue={th.credits_cost ?? ""}
                            onBlur={(e) => patch(th.id, { creditsCost: e.target.value === "" ? null : parseInt(e.target.value, 10) })}
                            className="w-24 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                          />
                        </label>
                        <label className="flex items-center gap-1.5 text-sm">
                          Stars
                          <input
                            type="number"
                            min={0}
                            defaultValue={th.stars_cost ?? ""}
                            onBlur={(e) => patch(th.id, { starsCost: e.target.value === "" ? null : parseInt(e.target.value, 10) })}
                            className="w-24 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
