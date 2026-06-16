"use client";

/**
 * app/(admin)/admin/creator-spotlight/page.tsx
 *
 * Admin page for managing Creator of the Month Spotlights (PRD §25).
 *
 * Features:
 *  - Table of all past and current spotlights with creator info.
 *  - "Creator of Month" badge on the active spotlight row.
 *  - Form to add a new monthly spotlight: creator ID/username, blurb, month.
 *  - Data from GET /api/admin/creator-spotlight.
 *  - Submission to POST /api/admin/creator-spotlight.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Spotlight {
  id: string;
  creator_id: string;
  month_year: string;
  blurb: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  creator_username: string | null;
  creator_display_name: string | null;
  creator_avatar_url: string | null;
  admin_username: string | null;
}

interface FormData {
  creatorId: string;
  monthYear: string;
  blurb: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format YYYY-MM into a human-readable month + year string. */
function formatMonthYear(my: string): string {
  const [year, month] = my.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

/** Return the current month in YYYY-MM format for the default form value. */
function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function defaultForm(): FormData {
  return { creatorId: "", monthYear: currentMonthValue(), blurb: "" };
}

// ---------------------------------------------------------------------------
// Badge component
// ---------------------------------------------------------------------------

function SpotlightBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
      <svg
        className="h-3 w-3"
        fill="currentColor"
        viewBox="0 0 20 20"
        aria-hidden="true"
      >
        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
      </svg>
      Creator of the Month
    </span>
  );
}

// ---------------------------------------------------------------------------
// Row skeleton
// ---------------------------------------------------------------------------

function RowSkeleton() {
  return (
    <tr>
      {Array.from({ length: 6 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-neutral-200 dark:bg-neutral-700" />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Add spotlight form
// ---------------------------------------------------------------------------

interface AddFormProps {
  onSubmit: (data: FormData) => Promise<void>;
  saving: boolean;
}

function AddSpotlightForm({ onSubmit, saving }: AddFormProps) {
  const [form, setForm] = useState<FormData>(defaultForm());

  function update<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.creatorId.trim()) return;
    await onSubmit(form);
    setForm(defaultForm());
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
    >
      <h2 className="mb-4 text-base font-semibold text-neutral-900 dark:text-neutral-50">
        Add New Spotlight
      </h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Creator ID */}
        <div className="lg:col-span-1">
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">
            Creator User ID *
          </label>
          <input
            type="text"
            value={form.creatorId}
            onChange={(e) => update("creatorId", e.target.value.trim())}
            placeholder="UUID of the creator"
            required
            className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
          />
          <p className="mt-0.5 text-xs text-neutral-400">
            Paste the user&apos;s UUID from the Users page.
          </p>
        </div>

        {/* Month picker */}
        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">
            Month *
          </label>
          <input
            type="month"
            value={form.monthYear}
            onChange={(e) => update("monthYear", e.target.value)}
            required
            className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>

        {/* Blurb */}
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">
            Blurb{" "}
            <span className="font-normal text-neutral-400">(optional)</span>
          </label>
          <input
            type="text"
            value={form.blurb}
            onChange={(e) => update("blurb", e.target.value)}
            placeholder="Short promo text shown on the Discover page…"
            maxLength={500}
            className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="submit"
          disabled={saving || !form.creatorId.trim()}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? (
            "Saving…"
          ) : (
            <>
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Add Spotlight
            </>
          )}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminCreatorSpotlightPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [spotlights, setSpotlights] = useState<Spotlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{
    msg: string;
    type: "success" | "error";
  } | null>(null);

  const showToast = useCallback(
    (msg: string, type: "success" | "error" = "success") => {
      setToast({ msg, type });
      setTimeout(() => setToast(null), 3500);
    },
    []
  );

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/creator-spotlight", {
          credentials: "include",
        });
        if (res.status === 401 || res.status === 403) {
          window.location.href = "/admin/login";
          return;
        }
        if (!res.ok) throw new Error("Failed to load spotlights");
        const data = (await res.json()) as { spotlights: Spotlight[] };
        setSpotlights(data.spotlights);
      } catch (e) {
        setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Unknown error") : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleAdd(form: FormData) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/creator-spotlight", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorId: form.creatorId,
          monthYear: form.monthYear,
          blurb: form.blurb || undefined,
        }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(err?.error?.message ?? "Failed to create spotlight");
      }

      const data = (await res.json()) as { spotlight: Spotlight };
      setSpotlights((prev) => [data.spotlight, ...prev]);
      showToast("Spotlight created!");
    } catch (e) {
      showToast(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Create failed") : "Create failed", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
          Creator of the Month
        </h1>
        <SpotlightBadge />
      </div>

      <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">
        Highlight one creator per month. The active spotlight appears on the
        Discover page with the creator&apos;s badge and promo blurb.
      </p>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            toast.type === "success" ? "bg-teal-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Add form */}
      <div className="mb-8">
        <AddSpotlightForm onSubmit={handleAdd} saving={saving} />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Spotlights table */}
      <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
              <th className="px-4 py-3 text-left font-semibold">Month</th>
              <th className="px-4 py-3 text-left font-semibold">Creator</th>
              <th className="px-4 py-3 text-left font-semibold">Blurb</th>
              <th className="px-4 py-3 text-center font-semibold">Status</th>
              <th className="px-4 py-3 text-left font-semibold">Added By</th>
              <th className="px-4 py-3 text-left font-semibold">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => <RowSkeleton key={i} />)
            ) : spotlights.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-neutral-500"
                >
                  No spotlights yet. Use the form above to add the first one.
                </td>
              </tr>
            ) : (
              spotlights.map((s) => (
                <tr
                  key={s.id}
                  className={`hover:bg-neutral-50 dark:hover:bg-neutral-800/50 ${
                    s.is_active
                      ? "bg-amber-50/50 dark:bg-amber-950/20"
                      : ""
                  }`}
                >
                  {/* Month */}
                  <td className="px-4 py-3 font-semibold text-neutral-900 dark:text-neutral-100">
                    {formatMonthYear(s.month_year)}
                    <p className="text-xs font-normal text-neutral-400">
                      {s.month_year}
                    </p>
                  </td>

                  {/* Creator */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {s.creator_avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={s.creator_avatar_url}
                          alt={s.creator_username ?? "Creator"}
                          className="h-8 w-8 rounded-full object-cover ring-2 ring-neutral-200 dark:ring-neutral-700"
                        />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700 ring-2 ring-neutral-200 dark:bg-primary-900 dark:text-primary-300 dark:ring-neutral-700">
                          {(s.creator_display_name ?? s.creator_username ?? "?")
                            .charAt(0)
                            .toUpperCase()}
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-neutral-900 dark:text-neutral-100">
                          {s.creator_display_name ?? s.creator_username ?? "—"}
                        </p>
                        {s.creator_username && (
                          <p className="text-xs text-neutral-400">
                            @{s.creator_username}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Blurb */}
                  <td className="max-w-xs px-4 py-3 text-neutral-600 dark:text-neutral-400">
                    {s.blurb ? (
                      <p className="line-clamp-2 text-sm">{s.blurb}</p>
                    ) : (
                      <span className="text-xs text-neutral-400">—</span>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 text-center">
                    {s.is_active ? (
                      <SpotlightBadge />
                    ) : (
                      <span className="inline-block rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                        Past
                      </span>
                    )}
                  </td>

                  {/* Added by */}
                  <td className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">
                    {s.admin_username ? `@${s.admin_username}` : "—"}
                  </td>

                  {/* Created at */}
                  <td className="px-4 py-3 text-xs text-neutral-500 dark:text-neutral-400">
                    {new Date(s.created_at).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
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
