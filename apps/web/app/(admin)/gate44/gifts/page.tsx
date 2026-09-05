"use client";

/**
 * app/(admin)/admin/gifts/page.tsx
 *
 * Admin Gifts Catalog — manage all gift items (create, edit, retire/restore).
 * Cursor-paginated, handles millions of records without full-table scans.
 */

import { useState, useEffect, useCallback } from "react";
import { GIFT_TIER_LABELS } from "@zobia/shared/utils";
import { useCurrency } from "@/lib/hooks/useCurrency";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GiftBenefitType = "sender_badge" | "room_privilege" | "blog_privilege" | "custom_text";

interface RewardConfig {
  benefitType: GiftBenefitType;
  label: string;
  description?: string;
  durationDays?: number | null;
  customText?: string;
}

interface GiftItem {
  id: string;
  name: string;
  emoji: string;
  coinCost: number;
  tier: number;
  animationUrl: string | null;
  spectacleThresholdCoins: number | null;
  isActive: boolean;
  isRewarded?: boolean;
  rewardConfig?: RewardConfig | null;
  createdAt: string;
}

interface GiftForm {
  name: string;
  emoji: string;
  coinCost: string;
  tier: string;
  animationUrl: string;
  spectacleThresholdCoins: string;
  isRewarded: boolean;
  benefitType: GiftBenefitType;
  rewardLabel: string;
  rewardDescription: string;
  durationDays: string;
  customText: string;
}

const BENEFIT_TYPE_LABELS: Record<GiftBenefitType, string> = {
  sender_badge: "Sender badge",
  room_privilege: "Room privilege",
  blog_privilege: "Blog privilege",
  custom_text: "Custom text reward",
};

const EMPTY_FORM: GiftForm = {
  name: "",
  emoji: "",
  coinCost: "",
  tier: "1",
  animationUrl: "",
  spectacleThresholdCoins: "",
  isRewarded: false,
  benefitType: "sender_badge",
  rewardLabel: "",
  rewardDescription: "",
  durationDays: "",
  customText: "",
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
      T{tier} {GIFT_TIER_LABELS[tier]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminGiftsPage() {
  const currency = useCurrency();
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
      isRewarded: gift.isRewarded ?? false,
      benefitType: gift.rewardConfig?.benefitType ?? "sender_badge",
      rewardLabel: gift.rewardConfig?.label ?? "",
      rewardDescription: gift.rewardConfig?.description ?? "",
      durationDays: gift.rewardConfig?.durationDays != null ? String(gift.rewardConfig.durationDays) : "",
      customText: gift.rewardConfig?.customText ?? "",
    });
    setShowForm(true);
  }

  async function submitForm() {
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      emoji: form.emoji.trim(),
      coinCost: parseInt(form.coinCost, 10),
      tier: parseInt(form.tier, 10),
      animationUrl: form.animationUrl.trim() || null,
      spectacleThresholdCoins: form.spectacleThresholdCoins ? parseInt(form.spectacleThresholdCoins, 10) : null,
      isRewarded: form.isRewarded,
    };

    if (!body.name || !body.emoji || isNaN(body.coinCost as number) || isNaN(body.tier as number)) {
      showToast("Name, emoji, coin cost, and tier are required", "error");
      return;
    }

    if (form.isRewarded) {
      if (!form.rewardLabel.trim()) {
        showToast("Reward label is required for a rewarded gift", "error");
        return;
      }
      if (form.benefitType === "custom_text" && !form.customText.trim()) {
        showToast("Custom text is required when the benefit type is 'Custom text reward'", "error");
        return;
      }
      body.rewardConfig = {
        benefitType: form.benefitType,
        label: form.rewardLabel.trim(),
        description: form.rewardDescription.trim() || undefined,
        durationDays: form.durationDays ? parseInt(form.durationDays, 10) : null,
        customText: form.benefitType === "custom_text" ? form.customText.trim() : undefined,
      };
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
                    {gift.isRewarded && (
                      <span
                        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700"
                        title={gift.rewardConfig?.label ? `Unlocks: ${gift.rewardConfig.label}` : undefined}
                      >
                        ✨ Rewarded{gift.rewardConfig?.label ? `: ${gift.rewardConfig.label}` : ""}
                      </span>
                    )}
                    {!gift.isActive && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">Retired</span>
                    )}
                  </div>
                  <p className="text-xs text-neutral-500">{gift.coinCost.toLocaleString()} {currency.softPlural.toLowerCase()}</p>
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
                  <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{currency.softSingular} Cost</label>
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
                      <option key={t} value={t}>T{t} — {GIFT_TIER_LABELS[t]}</option>
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
                <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Spectacle threshold {currency.softPlural.toLowerCase()} (optional)</label>
                <input
                  type="number"
                  min="1"
                  value={form.spectacleThresholdCoins}
                  onChange={(e) => setForm((f) => ({ ...f, spectacleThresholdCoins: e.target.value }))}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                />
              </div>

              {/* Rewarded Gifts (migration 0026) — sending this gift to the actual
                  owner/admin/creator of a room or blog unlocks the reward below. */}
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                  <input
                    type="checkbox"
                    checked={form.isRewarded}
                    onChange={(e) => setForm((f) => ({ ...f, isRewarded: e.target.checked }))}
                    className="h-4 w-4 rounded"
                  />
                  ✨ Rewarded gift
                </label>
                <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-400/80">
                  Sending this to a room or blog owner unlocks a reward for the sender.
                </p>

                {form.isRewarded && (
                  <div className="mt-3 space-y-3 border-t border-amber-200 pt-3 dark:border-amber-900">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Benefit type</label>
                      <select
                        value={form.benefitType}
                        onChange={(e) => setForm((f) => ({ ...f, benefitType: e.target.value as GiftBenefitType }))}
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                      >
                        {(Object.keys(BENEFIT_TYPE_LABELS) as GiftBenefitType[]).map((bt) => (
                          <option key={bt} value={bt}>{BENEFIT_TYPE_LABELS[bt]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Label (e.g. &quot;VIP Supporter&quot;)</label>
                      <input
                        value={form.rewardLabel}
                        onChange={(e) => setForm((f) => ({ ...f, rewardLabel: e.target.value }))}
                        maxLength={80}
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Description (shown to the sender before they send)</label>
                      <textarea
                        value={form.rewardDescription}
                        onChange={(e) => setForm((f) => ({ ...f, rewardDescription: e.target.value }))}
                        rows={2}
                        maxLength={500}
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Duration (days) — blank = permanent</label>
                      <input
                        type="number"
                        min="1"
                        value={form.durationDays}
                        onChange={(e) => setForm((f) => ({ ...f, durationDays: e.target.value }))}
                        className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                      />
                    </div>
                    {form.benefitType === "custom_text" && (
                      <div>
                        <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">Custom text (e.g. claim instructions)</label>
                        <textarea
                          value={form.customText}
                          onChange={(e) => setForm((f) => ({ ...f, customText: e.target.value }))}
                          rows={3}
                          maxLength={2000}
                          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
                        />
                      </div>
                    )}
                  </div>
                )}
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
