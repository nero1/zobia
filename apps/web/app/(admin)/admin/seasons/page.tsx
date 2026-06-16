"use client";

/**
 * app/(admin)/admin/seasons/page.tsx
 *
 * Season management page for the admin panel.
 * Lists all seasons and allows creating new ones via an inline form/modal.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Season {
  id: string;
  name: string;
  theme: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  pass_price_coins: number;
  reward_pool_coins: number;
  description: string | null;
  created_at: string;
  created_by: string | null;
}

interface CreateSeasonForm {
  name: string;
  theme: string;
  starts_at: string;
  ends_at: string;
  pass_price_coins: string;
  reward_pool_coins: string;
  description: string;
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

function seasonStatus(season: Season): { label: string; classes: string } {
  const now = new Date();
  const start = new Date(season.starts_at);
  const end = new Date(season.ends_at);

  if (season.is_active && now >= start && now <= end) {
    return { label: "Active", classes: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300" };
  }
  if (start > now) {
    return { label: "Upcoming", classes: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" };
  }
  return { label: "Ended", classes: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400" };
}

// ISO datetime-local format: YYYY-MM-DDTHH:mm
function toDatetimeLocal(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16);
}

const EMPTY_FORM: CreateSeasonForm = {
  name: "",
  theme: "",
  starts_at: "",
  ends_at: "",
  pass_price_coins: "500",
  reward_pool_coins: "0",
  description: "",
};

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex gap-2">
        <div className="h-5 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-5 w-16 rounded-full bg-neutral-200 dark:bg-neutral-700" />
      </div>
      <div className="mb-2 h-3 w-48 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-3 w-64 rounded bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Season Modal
// ---------------------------------------------------------------------------

interface CreateSeasonModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function CreateSeasonModal({ onClose, onCreated }: CreateSeasonModalProps) {
  const { t: tSub } = useTranslation();
  const [form, setForm] = useState<CreateSeasonForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function set(field: keyof CreateSeasonForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    if (!form.name.trim() || form.name.trim().length < 3) {
      setFormError("Season name must be at least 3 characters.");
      return;
    }
    if (!form.theme.trim()) {
      setFormError("Theme is required.");
      return;
    }
    if (!form.starts_at || !form.ends_at) {
      setFormError("Start and end dates are required.");
      return;
    }
    if (new Date(form.ends_at) <= new Date(form.starts_at)) {
      setFormError("End date must be after start date.");
      return;
    }
    const passPriceCoins = parseInt(form.pass_price_coins, 10);
    if (isNaN(passPriceCoins) || passPriceCoins < 1) {
      setFormError("Pass price must be a positive integer.");
      return;
    }
    const rewardPoolCoins = parseInt(form.reward_pool_coins, 10);
    if (isNaN(rewardPoolCoins) || rewardPoolCoins < 0) {
      setFormError("Reward pool must be zero or a positive integer.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/seasons", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          theme: form.theme.trim(),
          startsAt: new Date(form.starts_at).toISOString(),
          endsAt: new Date(form.ends_at).toISOString(),
          passPriceCoins,
          rewardPoolCoins,
          description: form.description.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        { const e2 = new Error((body as { error?: { message?: string }; message?: string }).error?.message ?? (body as { error?: string }).error as string ?? "Failed to create season") as Error & { code?: string | null }; e2.code = (body as { error?: { code?: string } }).error?.code ?? null; throw e2; };
      }
      onCreated();
      onClose();
    } catch (e) {
      setFormError(e instanceof Error ? translateApiError(tSub, (e as Error & { code?: string | null }).code, e.message || "Failed to create season") : "Failed to create season");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-6 shadow-modal dark:border-neutral-700 dark:bg-neutral-900">
        <h2 className="mb-5 text-lg font-bold text-neutral-900 dark:text-neutral-50">
          Create Season
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Name
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Season 3 — Rise of the Legends"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-50"
            />
          </div>

          {/* Theme */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Theme
            </label>
            <input
              type="text"
              value={form.theme}
              onChange={(e) => set("theme", e.target.value)}
              placeholder="fire, ocean, neon, etc."
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-50"
            />
          </div>

          {/* Start / End dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Starts At
              </label>
              <input
                type="datetime-local"
                value={form.starts_at}
                onChange={(e) => set("starts_at", e.target.value)}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Ends At
              </label>
              <input
                type="datetime-local"
                value={form.ends_at}
                onChange={(e) => set("ends_at", e.target.value)}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-50"
              />
            </div>
          </div>

          {/* Pass price / Reward pool */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Pass Price (coins)
              </label>
              <input
                type="number"
                min={1}
                value={form.pass_price_coins}
                onChange={(e) => set("pass_price_coins", e.target.value)}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
                Reward Pool (coins)
              </label>
              <input
                type="number"
                min={0}
                value={form.reward_pool_coins}
                onChange={(e) => set("reward_pool_coins", e.target.value)}
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-50"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-neutral-500">
              Description (optional)
            </label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Season lore or description shown in-app…"
              className="w-full resize-none rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-50"
            />
          </div>

          {formError && (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
              {formError}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex flex-1 items-center justify-center rounded-lg bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                "Create Season"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Season card
// ---------------------------------------------------------------------------

function SeasonCard({ season }: { season: Season }) {
  const { label, classes } = seasonStatus(season);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-50">{season.name}</h2>
          <p className="text-xs text-neutral-500">Theme: <span className="font-medium text-neutral-700 dark:text-neutral-300">{season.theme}</span></p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${classes}`}>{label}</span>
      </div>

      {season.description && (
        <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">{season.description}</p>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-500 sm:grid-cols-4">
        <div>
          <span className="block font-semibold uppercase tracking-wider text-neutral-400">Starts</span>
          <span className="text-neutral-700 dark:text-neutral-300">{formatDate(season.starts_at)}</span>
        </div>
        <div>
          <span className="block font-semibold uppercase tracking-wider text-neutral-400">Ends</span>
          <span className="text-neutral-700 dark:text-neutral-300">{formatDate(season.ends_at)}</span>
        </div>
        <div>
          <span className="block font-semibold uppercase tracking-wider text-neutral-400">Pass Price</span>
          <span className="font-semibold text-amber-600 dark:text-amber-400">{season.pass_price_coins.toLocaleString()} coins</span>
        </div>
        <div>
          <span className="block font-semibold uppercase tracking-wider text-neutral-400">Reward Pool</span>
          <span className="font-semibold text-teal-600 dark:text-teal-400">{season.reward_pool_coins.toLocaleString()} coins</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminSeasonsPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchSeasons = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/seasons", { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load seasons");
      const data = (await res.json()) as { success: boolean; data: { seasons: Season[] } };
      setSeasons(data.data.seasons);
    } catch (e) {
      setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Unknown error") : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSeasons();
  }, [fetchSeasons]);

  function handleCreated() {
    showToast("Season created");
    void fetchSeasons();
  }

  return (
    <div className="relative">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Seasons</h1>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
        >
          + Create Season
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${
            toast.type === "success" ? "bg-teal-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <CreateSeasonModal
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)
        ) : seasons.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-20 dark:border-neutral-800 dark:bg-neutral-900">
            <span className="text-4xl">🏆</span>
            <p className="mt-3 text-lg font-semibold text-neutral-700 dark:text-neutral-300">
              No seasons yet
            </p>
            <p className="mt-1 text-sm text-neutral-500">
              Create the first season to get started.
            </p>
          </div>
        ) : (
          seasons.map((s) => <SeasonCard key={s.id} season={s} />)
        )}
      </div>
    </div>
  );
}
