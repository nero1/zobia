"use client";

/**
 * app/(admin)/admin/events/page.tsx
 *
 * Admin events management page.
 * Table of platform events with create/edit and toggle active/inactive.
 * Data from GET /api/admin/events.
 * Admin-only (redirect if not admin).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventType = "xp_boost" | "seasonal" | "challenge" | "community" | "other";

interface PlatformEvent {
  id: string;
  name: string;
  type: EventType;
  description: string | null;
  startsAt: string;
  endsAt: string;
  xpMultiplier: number;
  isActive: boolean;
  createdAt: string;
}

interface EventFormData {
  name: string;
  type: EventType;
  description: string;
  startsAt: string;
  endsAt: string;
  xpMultiplier: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function defaultFormData(): EventFormData {
  const now = new Date();
  const later = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    name: "",
    type: "xp_boost",
    description: "",
    startsAt: now.toISOString().slice(0, 16),
    endsAt: later.toISOString().slice(0, 16),
    xpMultiplier: 2,
  };
}

const EVENT_TYPES: { value: EventType; label: string }[] = [
  { value: "xp_boost", label: "XP Boost" },
  { value: "seasonal", label: "Seasonal" },
  { value: "challenge", label: "Challenge" },
  { value: "community", label: "Community" },
  { value: "other", label: "Other" },
];

// ---------------------------------------------------------------------------
// Skeleton
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
// Create / Edit modal
// ---------------------------------------------------------------------------

interface EventModalProps {
  initial: EventFormData;
  onSave: (data: EventFormData) => Promise<void>;
  onClose: () => void;
  saving: boolean;
  title: string;
}

function EventModal({ initial, onSave, onClose, saving, title }: EventModalProps) {
  const [form, setForm] = useState<EventFormData>(initial);

  function update<K extends keyof EventFormData>(key: K, value: EventFormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="mb-4 text-lg font-bold text-neutral-900 dark:text-neutral-50">{title}</h3>
        <div className="space-y-3">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Event Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              required
              maxLength={80}
              className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          {/* Type */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Type *</label>
            <select
              value={form.type}
              onChange={(e) => update("type", e.target.value as EventType)}
              className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            >
              {EVENT_TYPES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              rows={2}
              maxLength={300}
              className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Starts At</label>
              <input
                type="datetime-local"
                value={form.startsAt}
                onChange={(e) => update("startsAt", e.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Ends At</label>
              <input
                type="datetime-local"
                value={form.endsAt}
                onChange={(e) => update("endsAt", e.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
          </div>
          {/* XP Multiplier */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">XP Multiplier</label>
            <input
              type="number"
              value={form.xpMultiplier}
              onChange={(e) => update("xpMultiplier", parseFloat(e.target.value) || 1)}
              min={1}
              max={10}
              step={0.5}
              className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
        </div>
        <div className="mt-5 flex gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(form)}
            disabled={saving || !form.name.trim()}
            className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Event"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Admin events management page.
 */
export default function AdminEventsPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/events", { credentials: "include" });
        if (res.status === 401 || res.status === 403) { window.location.href = "/admin/login"; return; }
        if (!res.ok) throw new Error("Failed to load events");
        const data = (await res.json()) as { events: PlatformEvent[] };
        setEvents(data.events);
      } catch (e) {
        setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Unknown error") : "Unknown error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleCreate(form: EventFormData) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/events", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          description: form.description || null,
          starts_at: new Date(form.startsAt).toISOString(),
          ends_at: new Date(form.endsAt).toISOString(),
          xp_multiplier: form.xpMultiplier,
        }),
      });
      if (!res.ok) throw new Error("Failed to create event");
      const created = (await res.json()) as PlatformEvent;
      setEvents((prev) => [created, ...prev]);
      setShowModal(false);
      showToast("Event created!");
    } catch (e) {
      showToast(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Create failed") : "Create failed", "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(event: PlatformEvent) {
    setToggling(event.id);
    try {
      const res = await fetch(`/api/admin/events/${event.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !event.isActive }),
      });
      if (!res.ok) throw new Error("Toggle failed");
      setEvents((prev) => prev.map((e) => (e.id === event.id ? { ...e, isActive: !e.isActive } : e)));
      showToast(`Event ${!event.isActive ? "activated" : "deactivated"}`);
    } catch (e) {
      showToast(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Toggle failed") : "Toggle failed", "error");
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="relative">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Platform Events</h1>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Create Event
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

      {/* Modal */}
      {showModal && (
        <EventModal
          title="Create Event"
          initial={defaultFormData()}
          onSave={handleCreate}
          onClose={() => setShowModal(false)}
          saving={saving}
        />
      )}

      {/* Error */}
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
              <th className="px-4 py-3 text-left font-semibold">Type</th>
              <th className="px-4 py-3 text-left font-semibold">Dates</th>
              <th className="px-4 py-3 text-right font-semibold">XP ×</th>
              <th className="px-4 py-3 text-center font-semibold">Active</th>
              <th className="px-4 py-3 text-center font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <RowSkeleton key={i} />)
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-neutral-500">
                  No events yet. Click &quot;Create Event&quot; to add one.
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event.id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
                  <td className="px-4 py-3 font-semibold text-neutral-900 dark:text-neutral-100">
                    {event.name}
                    {event.description && (
                      <p className="text-xs font-normal text-neutral-500 line-clamp-1">{event.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 capitalize text-neutral-600 dark:text-neutral-400">
                    {event.type.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">
                    <span className="text-xs">{formatDate(event.startsAt)} – {formatDate(event.endsAt)}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {event.xpMultiplier > 1 ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                        {event.xpMultiplier}x
                      </span>
                    ) : (
                      <span className="text-xs text-neutral-400">1x</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${
                        event.isActive ? "bg-teal-500" : "bg-neutral-300 dark:bg-neutral-600"
                      }`}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => handleToggle(event)}
                      disabled={toggling === event.id}
                      className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ${
                        event.isActive
                          ? "bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300"
                          : "bg-teal-100 text-teal-700 hover:bg-teal-200 dark:bg-teal-900 dark:text-teal-300"
                      }`}
                    >
                      {toggling === event.id ? "…" : event.isActive ? "Deactivate" : "Activate"}
                    </button>
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
