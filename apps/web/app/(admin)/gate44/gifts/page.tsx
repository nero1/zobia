"use client";

/**
 * app/(admin)/admin/gifts/page.tsx
 *
 * Admin Gifts Catalog — manage all gift items (create, edit, retire/restore).
 * Cursor-paginated, handles millions of records without full-table scans.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinCost: number;
  tier: number;
  animationUrl: string | null;
  spectacleThresholdCoins: number | null;
  isActive: boolean;
  createdAt: string;
}

interface GiftForm {
  name: string;
  emoji: string;
  coinCost: string;
  tier: string;
  animationUrl: string;
  spectacleThresholdCoins: string;
}

const EMPTY_FORM: GiftForm = {
  name: "",
  emoji: "",
  coinCost: "",
  tier: "1",
  animationUrl: "",
  spectacleThresholdCoins: "",
};

const TIER_LABELS: Record<number, string> = {
  1: "Friendly",
  2: "Warm",
  3: "Grand",
  4: "Epic",
  5: "Legendary",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tierBadge(tier: number) {
  const colours = [
    "",
    "bg-neutral-100 text-neutral-600",
    "bg-blue-100 text-blue-700",
    "bg-teal-100 text-teal-700",
    "bg-amber-100 text-amber-700",
    "bg-purple-100 text-purple-700",
  ];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${colours[tier] ?? colours[1]}`}>
      T{tier} {TIER_LABELS[tier]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminGiftsPage() {
  const [gifts, setGifts] = useState<GiftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<GiftItem | null>(null);
  const [form, setForm] = useState<GiftForm>(EMPTY_FORM);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchGifts = useCallback(async (reset = true) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "50" });
    if (showRetired) params.set("retired", "true");
    if (!reset && cursor) params.set("cursor", cursor);

    try {
      const res = await fetch(`/api/admin/gifts?${params}`, { credentials: "include" });
      const json = await res.json();
      if (json.success) {
        setGifts((prev) => reset ? json.data.gifts : [...prev, ...json.data.gifts]);
        setCursor(json.data.nextCursor ?? null);
        setHasMore(!!json.data.nextCursor);
      } else {
        showToast(json.error?.message ?? "Failed to load gifts", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setLoading(false);
    }
  }, [showRetired, cursor, showToast]);

  useEffect(() => {
    void fetchGifts(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRetired]);

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(gift: GiftItem) {
    setEditTarget(gift);
    setForm({
      name: gift.name,
      emoji: gift.emoji,
      coinCost: String(gift.coinCost),
      tier: String(gift.tier),
      animationUrl: gift.animationUrl ?? "",
      spectacleThresholdCoins: gift.spectacleThresholdCoins != null ? String(gift.spectacleThresholdCoins) : "",
    });
    setShowForm(true);
  }

  async function submitForm() {
    const body = {
      name: form.name.trim(),
      emoji: form.emoji.trim(),
      coinCost: parseInt(form.coinCost, 10),
      tier: parseInt(form.tier, 10),
      animationUrl: form.animationUrl.trim() || null,
      spectacleThresholdCoins: form.spectacleThresholdCoins ? parseInt(form.spectacleThresholdCoins, 10) : null,
    };

    if (!body.name || !body.emoji || isNaN(body.coinCost) || isNaN(body.tier)) {
      showToast("Name, emoji, coin cost, and tier are required", "error");
      return;
    }

    setBusy("form");
    try {
      const url = editTarget ? `/api/admin/gifts/${editTarget.id}` : "/api/admin/gifts";
      const method = editTarget ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        showToast(editTarget ? "Gift updated" : "Gift created");
        setShowForm(false);
        await fetchGifts(true);
      } else {
        showToast(json.error?.message ?? "Failed to save", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setBusy(null);
    }
  }

  async function toggleRetire(gift: GiftItem) {
    setBusy(gift.id);
    try {
      const res = await fetch(`/api/admin/gifts/${gift.id}`, {
        method: gift.isActive ? "DELETE" : "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: gift.isActive ? undefined : JSON.stringify({ isActive: true }),
      });
      const json = await res.json();
      if (json.success) {
        showToast(gift.isActive ? "Gift retired" : "Gift restored");
        await fetchGifts(true);
      } else {
        showToast(json.error?.message ?? "Action failed", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Gifts Catalog</h1>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
          <input
            type="checkbox"
            checked={showRetired}
            onChange={(e) => setShowRetired(e.target.checked)}
            className="h-4 w-4 rounded"
          />
          Show retired
        </label>
        <button
          onClick={openCreate}
          className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-neutral-900 hover:bg-amber-500 transition-colors"
        >
          + New Gift
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-4 right-4 left-4 sm:left-auto z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {/* Gift list */}
      {loading && gifts.length === 0 ? (
        <div className="py-12 text-center text-neutral-500">Loading…</div>
      ) : gifts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-200 py-12 text-center text-neutral-500 dark:border-neutral-700">
          No gifts found.
        </div>
      ) : (
        <div className="space-y-2">
          {gifts.map((gift) => (
            <div
              key={gift.id}
              className={`rounded-xl border bg-white p-3 sm:p-4 dark:bg-neutral-900 ${gift.isActive ? "border-neutral-200 dark:border-neutral-800" : "border-neutral-100 opacity-60 dark:border-neutral-800"}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-2xl">{gift.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-neutral-900 dark:text-white">{gift.name}</span>
                    {tierBadge(gift.tier)}
                    {!gift.isActive && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">Retired</span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-500">{gift.coinCost.toLocaleString()} coins</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    disabled={!!busy}
                    onClick={() => openEdit(gift)}
                    className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-950 dark:text-blue-300"
                  >
                    Edit
                  </button>
                  <button
                    disabled={!!busy}
                    onClick={() => void toggleRetire(gift)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${
                      gift.isActive
                        ? "bg-red-100 text-red-700 hover:bg-red-200"
                        : "bg-teal-100 text-teal-700 hover:bg-teal-200"
                    }`}
                  >
                    {gift.isActive ? "Retire" : "Restore"}
                  </button>
                </div>
              </div>
            </div>
          ))}

          {hasMore && (
            <button
              onClick={() => void fetchGifts(false)}
              disabled={loading}
              className="w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-medium text-neutral-500 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700"
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900">
            <h3 className="mb-4 font-semibold text-neutral-900 dark:text-white">
              {editTarget ? `Edit "${editTarget.name}"` : "New Gift Item"}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                  placeholder="e.g. Rose"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Emoji</label>
                <input
                  value={form.emoji}
                  onChange={(e) => setForm((f) => ({ ...f, emoji: e.target.value }))}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                  placeholder="🌹"
                  maxLength={10}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Coin Cost</label>
                  <input
                    type="number"
                    min="1"
                    value={form.coinCost}
                    onChange={(e) => setForm((f) => ({ ...f, coinCost: e.target.value }))}
                    className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Tier (1–5)</label>
                  <select
                    value={form.tier}
                    onChange={(e) => setForm((f) => ({ ...f, tier: e.target.value }))}
                    className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                  >
                    {[1, 2, 3, 4, 5].map((t) => (
                      <option key={t} value={t}>T{t} — {TIER_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Animation URL (optional)</label>
                <input
                  value={form.animationUrl}
                  onChange={(e) => setForm((f) => ({ ...f, animationUrl: e.target.value }))}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                  placeholder="https://…"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Spectacle threshold coins (optional)</label>
                <input
                  type="number"
                  min="1"
                  value={form.spectacleThresholdCoins}
                  onChange={(e) => setForm((f) => ({ ...f, spectacleThresholdCoins: e.target.value }))}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => setShowForm(false)}
                className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm font-medium dark:border-neutral-700"
              >
                Cancel
              </button>
              <button
                onClick={() => void submitForm()}
                disabled={busy === "form"}
                className="flex-1 rounded-lg bg-amber-400 py-2 text-sm font-bold text-neutral-900 hover:bg-amber-500 disabled:opacity-50"
              >
                {busy === "form" ? "Saving…" : editTarget ? "Save Changes" : "Create Gift"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
