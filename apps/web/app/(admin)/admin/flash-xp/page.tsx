"use client";

/**
 * app/(admin)/admin/flash-xp/page.tsx
 *
 * Admin Flash XP events management page.
 * Lists flash XP events and provides a form to create new ones.
 * Implements the two-phase timing model: announced_at is public,
 * fires_at is kept secret from users.
 * Data from GET/POST /api/admin/flash-xp.
 * Admin-only (redirect if not admin).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlashXpEvent {
  id: string;
  name: string;
  description: string | null;
  announced_at: string;
  fires_at: string;
  ends_at: string;
  multiplier: number;
  is_active: boolean;
  fired: boolean;
  created_at: string;
}

interface FlashXpFormData {
  name: string;
  description: string;
  announced_at: string;
  fires_at: string;
  ends_at: string;
  multiplier: number;
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

function toLocalDatetimeValue(isoOrOffset: string | number): string {
  const d = typeof isoOrOffset === "number"
    ? new Date(Date.now() + isoOrOffset)
    : new Date(isoOrOffset);
  return d.toISOString().slice(0, 16);
}

function defaultFormData(): FlashXpFormData {
  const ONE_HOUR = 60 * 60 * 1000;
  const SIX_HOURS = 6 * ONE_HOUR;
  const EIGHT_HOURS = 8 * ONE_HOUR;
  return {
    name: "",
    description: "",
    announced_at: toLocalDatetimeValue(ONE_HOUR),
    fires_at: toLocalDatetimeValue(SIX_HOURS),
    ends_at: toLocalDatetimeValue(EIGHT_HOURS),
    multiplier: 2.0,
  };
}

function eventStatus(event: FlashXpEvent): { label: string; classes: string } {
  const now = Date.now();
  const fires = new Date(event.fires_at).getTime();
  const ends = new Date(event.ends_at).getTime();
  const announced = new Date(event.announced_at).getTime();

  if (now > ends) {
    return { label: "Ended", classes: "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400" };
  }
  if (now >= fires) {
    return { label: "Active", classes: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300" };
  }
  if (now >= announced) {
    return { label: "Announced", classes: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" };
  }
  return { label: "Upcoming", classes: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" };
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function RowSkeleton() {
  return (
    <tr>
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-neutral-200 dark:bg-neutral-700" />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminFlashXpPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [events, setEvents] = useState<FlashXpEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FlashXpFormData>(defaultFormData);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  function update<K extends keyof FlashXpFormData>(key: K, value: FlashXpFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormError(null);
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/flash-xp", { credentials: "include" });
        if (res.status === 401 || res.status === 403) { window.location.href = "/admin/login"; return; }
        if (!res.ok) throw new Error("Failed to load flash XP events");
        const data = (await res.json()) as { data: { events: FlashXpEvent[] } };
        setEvents(data.data.events);
      } catch (e) {
        setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Unknown error") : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const announcedAt = new Date(form.announced_at);
    const firesAt = new Date(form.fires_at);
    const endsAt = new Date(form.ends_at);
    const ONE_HOUR_MS = 60 * 60 * 1000;

    if (announcedAt >= firesAt) {
      setFormError("Announced At must be before Fires At.");
      return;
    }
    if (firesAt >= endsAt) {
      setFormError("Fires At must be before Ends At.");
      return;
    }
    if (firesAt.getTime() - announcedAt.getTime() < ONE_HOUR_MS) {
      setFormError("Fires At must be at least 1 hour after Announced At.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/flash-xp", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description || undefined,
          announced_at: announcedAt.toISOString(),
          fires_at: firesAt.toISOString(),
          ends_at: endsAt.toISOString(),
          multiplier: form.multiplier,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg = (body as { error?: { message?: string } })?.error?.message ?? "Failed to create event";
        throw new Error(msg);
      }

      const created = (await res.json()) as { data: { event: FlashXpEvent } };
      setEvents((prev) => [created.data.event, ...prev]);
      setForm(defaultFormData());
      setShowForm(false);
      showToast("Flash XP event created!");
    } catch (e) {
      setFormError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Create failed") : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Flash XP Events</h1>
        <button
          onClick={() => { setShowForm((v) => !v); setFormError(null); }}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {showForm ? "Cancel" : "New Flash XP Event"}
        </button>
      </div>

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

      {/* Phase timing info */}
      <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
        <span className="font-semibold">Phase timing:</span> Announced X hours before firing (min 1h). <span className="font-semibold">Fires At is kept secret from users</span> — they only see the announcement window.
      </div>

      {/* Create form */}
      {showForm && (
        <div className="mb-6 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <h2 className="mb-4 text-base font-bold text-neutral-900 dark:text-neutral-50">New Flash XP Event</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                Name *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
                required
                minLength={3}
                maxLength={150}
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                rows={2}
                maxLength={500}
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>

            {/* Dates row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* Announced At */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                  Announced At *
                </label>
                <input
                  type="datetime-local"
                  value={form.announced_at}
                  onChange={(e) => update("announced_at", e.target.value)}
                  required
                  className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                />
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Shown publicly to users.
                </p>
              </div>

              {/* Fires At */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                  Fires At *
                </label>
                <input
                  type="datetime-local"
                  value={form.fires_at}
                  onChange={(e) => update("fires_at", e.target.value)}
                  required
                  className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                />
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  Pick a time within the announcement window — users won&apos;t see this exact time.
                </p>
              </div>

              {/* Ends At */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                  Ends At *
                </label>
                <input
                  type="datetime-local"
                  value={form.ends_at}
                  onChange={(e) => update("ends_at", e.target.value)}
                  required
                  className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </div>
            </div>

            {/* Multiplier */}
            <div className="max-w-xs">
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                XP Multiplier
              </label>
              <input
                type="number"
                value={form.multiplier}
                onChange={(e) => update("multiplier", parseFloat(e.target.value) || 2.0)}
                min={1}
                max={5}
                step={0.5}
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>

            {/* Form error */}
            {formError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                {formError}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => { setShowForm(false); setFormError(null); }}
                disabled={saving}
                className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !form.name.trim()}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? "Creating…" : "Create Flash XP Event"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Load error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
              <th className="px-4 py-3 text-left font-semibold">Name</th>
              <th className="px-4 py-3 text-left font-semibold">Announced At</th>
              <th className="px-4 py-3 text-left font-semibold">Fires At</th>
              <th className="px-4 py-3 text-left font-semibold">Ends At</th>
              <th className="px-4 py-3 text-right font-semibold">XP ×</th>
              <th className="px-4 py-3 text-center font-semibold">Fired</th>
              <th className="px-4 py-3 text-center font-semibold">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-neutral-500">
                  No flash XP events yet. Click &quot;New Flash XP Event&quot; to create one.
                </td>
              </tr>
            ) : (
              events.map((event) => {
                const status = eventStatus(event);
                return (
                  <tr key={event.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                    <td className="px-4 py-3 font-semibold text-neutral-900 dark:text-neutral-100">
                      {event.name}
                      {event.description && (
                        <p className="text-xs font-normal text-neutral-500 line-clamp-1">{event.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-600 dark:text-neutral-400">
                      {formatDate(event.announced_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-600 dark:text-neutral-400">
                      {formatDate(event.fires_at)}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-600 dark:text-neutral-400">
                      {formatDate(event.ends_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {event.multiplier > 1 ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                          {event.multiplier}x
                        </span>
                      ) : (
                        <span className="text-xs text-neutral-400">1x</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-full ${
                          event.fired ? "bg-teal-500" : "bg-neutral-300 dark:bg-neutral-600"
                        }`}
                      />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.classes}`}>
                        {status.label}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
