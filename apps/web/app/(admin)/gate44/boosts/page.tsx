"use client";

/**
 * app/(admin)/gate44/boosts/page.tsx
 *
 * Admin Boost Catalog — create new boost/multiplier types (moved off the
 * previously-hardcoded BOOSTER_CONFIG map, see app/api/economy/boosters/
 * route.ts) and toggle existing ones active/inactive.
 *
 * IMPORTANT: for a boost to be purchasable on the Capacitor Android app via
 * Google Play Billing, a matching product must also be created in Play
 * Console with the same product ID entered here as "IAP Product ID" — see
 * docs/HOW-IT-WORKS.md "Boosts & Play Billing".
 */

import { useState, useEffect } from "react";

interface BoostType {
  id: string;
  key: string;
  label: string;
  description: string | null;
  multiplier_bp: number;
  duration_hours: number;
  coins_cost: number | null;
  stars_cost: number | null;
  iap_product_id: string | null;
  stackable: boolean;
  is_active: boolean;
  sort_order: number;
}

interface BoostForm {
  key: string;
  label: string;
  description: string;
  multiplierBp: string;
  durationHours: string;
  coinsCost: string;
  iapProductId: string;
  stackable: boolean;
}

function defaultForm(): BoostForm {
  return { key: "", label: "", description: "", multiplierBp: "100", durationHours: "24", coinsCost: "", iapProductId: "", stackable: false };
}

export default function AdminBoostsPage() {
  const [boosts, setBoosts] = useState<BoostType[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<BoostForm>(defaultForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/boosts", { credentials: "include" });
      const json = (await res.json()) as { data?: { boosts: BoostType[] } };
      setBoosts(json.data?.boosts ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/boosts", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: form.key,
          label: form.label,
          description: form.description || undefined,
          multiplierBp: parseInt(form.multiplierBp, 10) || 0,
          durationHours: parseInt(form.durationHours, 10),
          coinsCost: form.coinsCost ? parseInt(form.coinsCost, 10) : undefined,
          iapProductId: form.iapProductId || undefined,
          stackable: form.stackable,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: { message?: string } })?.error?.message ?? "Failed to create boost");
      }
      showToast("Boost type created!");
      setForm(defaultForm());
      setShowForm(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create boost");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id: string, value: boolean) {
    try {
      const res = await fetch(`/api/admin/boosts/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: value }),
      });
      if (!res.ok) throw new Error();
      setBoosts((prev) => prev.map((b) => (b.id === id ? { ...b, is_active: value } : b)));
    } catch {
      showToast("Failed to update", "error");
    }
  }

  return (
    <div className="relative">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Boost Catalog</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {showForm ? "Cancel" : "+ New Boost Type"}
        </button>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        <span className="font-semibold">Play Billing note:</span> for the Capacitor Android app to sell a new boost, also create a matching product in Google Play Console using the same IAP Product ID entered below.
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 space-y-3 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Key (snake_case) *</label>
              <input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} required pattern="[a-z0-9_]+" className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" placeholder="e.g. weekend_double_xp" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Label *</label>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" placeholder="e.g. Weekend Double XP" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Multiplier (bp, 100=1x)</label>
              <input type="number" value={form.multiplierBp} onChange={(e) => setForm({ ...form, multiplierBp: e.target.value })} min={0} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Duration (hours) *</label>
              <input type="number" value={form.durationHours} onChange={(e) => setForm({ ...form, durationHours: e.target.value })} required min={1} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Coins Cost</label>
              <input type="number" value={form.coinsCost} onChange={(e) => setForm({ ...form, coinsCost: e.target.value })} min={0} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">IAP Product ID</label>
              <input value={form.iapProductId} onChange={(e) => setForm({ ...form, iapProductId: e.target.value })} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" placeholder="e.g. boost_weekend_double_xp" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
            <input type="checkbox" checked={form.stackable} onChange={(e) => setForm({ ...form, stackable: e.target.checked })} />
            Stackable (users can buy more than one active at once — for one-shot consumables)
          </label>
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>}
          <button type="submit" disabled={saving} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {saving ? "Creating…" : "Create Boost Type"}
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
              <th className="px-4 py-3 text-left font-semibold">Key</th>
              <th className="px-4 py-3 text-left font-semibold">Label</th>
              <th className="px-4 py-3 text-right font-semibold">Multiplier</th>
              <th className="px-4 py-3 text-right font-semibold">Duration</th>
              <th className="px-4 py-3 text-right font-semibold">Coins</th>
              <th className="px-4 py-3 text-left font-semibold">IAP ID</th>
              <th className="px-4 py-3 text-center font-semibold">Active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-neutral-500">Loading…</td></tr>
            ) : boosts.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-neutral-500">No boost types yet</td></tr>
            ) : (
              boosts.map((b) => (
                <tr key={b.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                  <td className="px-4 py-3 font-mono text-xs text-neutral-600 dark:text-neutral-400">{b.key}</td>
                  <td className="px-4 py-3 font-semibold text-neutral-900 dark:text-neutral-100">{b.label}</td>
                  <td className="px-4 py-3 text-right">{(b.multiplier_bp / 100).toFixed(1)}x</td>
                  <td className="px-4 py-3 text-right">{b.duration_hours}h</td>
                  <td className="px-4 py-3 text-right">{b.coins_cost ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-neutral-500">{b.iap_product_id ?? "—"}</td>
                  <td className="px-4 py-3 text-center">
                    <input type="checkbox" checked={b.is_active} onChange={(e) => toggleActive(b.id, e.target.checked)} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
