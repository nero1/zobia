"use client";

/**
 * app/(admin)/admin/gift-drop/page.tsx
 *
 * Admin Monthly Mystery Gift Drop management page.
 *
 * Lists all scheduled gift drops (past, active, upcoming) and provides a
 * form to schedule a new one. Each drop is available for 48 hours, announced
 * 24 hours in advance, then retired permanently (PRD §25).
 *
 * Data from GET/POST /api/admin/gift-drop.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GiftDrop {
  id: string;
  gift_item_id: string;
  title: string;
  available_from: string;
  available_until: string;
  announced_at: string | null;
  is_active: boolean;
  created_at: string;
  gift_item_name: string | null;
  gift_item_retired: boolean | null;
}

interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  tier: number;
  coin_price: number;
  is_retired: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dropStatus(drop: GiftDrop): { label: string; colour: string } {
  const now = new Date();
  const from = new Date(drop.available_from);
  const until = new Date(drop.available_until);
  if (now < from) return { label: "Upcoming", colour: "text-blue-600 bg-blue-50" };
  if (now >= from && now <= until) return { label: "Active", colour: "text-green-700 bg-green-50" };
  return { label: "Ended", colour: "text-neutral-500 bg-neutral-100" };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function AdminGiftDropPage() {
  const [drops, setDrops] = useState<GiftDrop[]>([]);
  const [giftItems, setGiftItems] = useState<GiftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    giftItemId: "",
    startAt: "",
  });

  // Fetch gift drops list
  const fetchDrops = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/gift-drop", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load gift drops");
      const data = (await res.json()) as { drops: GiftDrop[] };
      setDrops(data.drops ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch available (non-retired) gift items for the dropdown
  const fetchGiftItems = useCallback(async () => {
    try {
      const res = await fetch("/api/economy/gifts/catalogue?limit=100", { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { items?: GiftItem[]; gifts?: GiftItem[] };
      const all = data.items ?? data.gifts ?? [];
      setGiftItems(all.filter((g) => !g.is_retired));
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    void fetchDrops();
    void fetchGiftItems();
  }, [fetchDrops, fetchGiftItems]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/gift-drop", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          giftItemId: form.giftItemId,
          startAt: form.startAt,
        }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? data.message ?? "Failed to schedule drop");
      setShowForm(false);
      setForm({ giftItemId: "", startAt: "" });
      await fetchDrops();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setSubmitting(false);
    }
  }

  // Default startAt to 24 hours from now for the form
  const defaultStartAt = new Date(Date.now() + 24 * 3600_000)
    .toISOString()
    .slice(0, 16);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
            Monthly Mystery Gift Drop
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Schedule limited-edition gifts available for 48 hours only — announced 24 hours in
            advance, then retired permanently (PRD §25).
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setShowForm((v) => !v);
            setForm({ giftItemId: "", startAt: defaultStartAt });
          }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {showForm ? "Cancel" : "+ Schedule Drop"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 rounded-xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
        >
          <h2 className="mb-4 text-base font-semibold text-neutral-900 dark:text-neutral-50">
            Schedule New Gift Drop
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Gift Item */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                Gift Item *
              </label>
              <select
                required
                value={form.giftItemId}
                onChange={(e) => setForm((f) => ({ ...f, giftItemId: e.target.value }))}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              >
                <option value="">Select a gift item…</option>
                {giftItems.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.emoji} {g.name} — {g.coin_price.toLocaleString()} coins (Tier {g.tier})
                  </option>
                ))}
              </select>
            </div>

            {/* Start date/time */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                Available From *
                <span className="ml-1 font-normal text-neutral-400">
                  (Announced 24 h in advance; ends 48 h later)
                </span>
              </label>
              <input
                type="datetime-local"
                required
                value={form.startAt}
                onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
                min={new Date().toISOString().slice(0, 16)}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !form.giftItemId || !form.startAt}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Scheduling…" : "Schedule Drop"}
            </button>
          </div>
        </form>
      )}

      {/* Drops table */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800"
            />
          ))}
        </div>
      ) : drops.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 py-16 text-center dark:border-neutral-700">
          <p className="text-4xl">🎁</p>
          <p className="mt-3 text-sm font-medium text-neutral-500">No gift drops scheduled yet.</p>
          <p className="text-xs text-neutral-400">
            Monthly mystery gift drops are announced 24 h in advance and available for 48 h only.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900">
                {["Gift Item", "Available From", "Available Until", "Announced At", "Status"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-neutral-500"
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {drops.map((drop) => {
                const { label, colour } = dropStatus(drop);
                return (
                  <tr
                    key={drop.id}
                    className="bg-white hover:bg-neutral-50 dark:bg-neutral-950 dark:hover:bg-neutral-900"
                  >
                    <td className="px-4 py-3 font-medium text-neutral-900 dark:text-neutral-100">
                      {drop.gift_item_name ?? drop.gift_item_id.slice(0, 8)}
                      {drop.gift_item_retired && (
                        <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-600">
                          Retired
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                      {formatDate(drop.available_from)}
                    </td>
                    <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                      {formatDate(drop.available_until)}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">
                      {drop.announced_at ? formatDate(drop.announced_at) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${colour}`}>
                        {label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Info callout */}
      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        <strong>How it works:</strong> The CRON announces the drop 24 hours before{" "}
        <em>available_from</em>, then activates it at <em>available_from</em> and retires it 48
        hours later. Users who purchase the gift during the window receive a permanent record on
        their profile. Once retired, the gift can never be obtained again.
      </div>
    </div>
  );
}
