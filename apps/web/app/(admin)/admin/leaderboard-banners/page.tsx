"use client";

/**
 * app/(admin)/admin/leaderboard-banners/page.tsx
 *
 * Admin UI for managing sponsored leaderboard banners.
 * Lists all banners with inline active toggle, creation form, and delete.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SponsoredBanner {
  id: string;
  sponsorName: string;
  sponsorLogoUrl: string | null;
  ctaText: string;
  ctaUrl: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  impressions: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDateInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16);
}

function formatDateDisplay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Create Banner Form
// ---------------------------------------------------------------------------

interface BannerFormProps {
  onSave: (data: Omit<SponsoredBanner, "id" | "impressions" | "isActive" | "createdAt">) => Promise<void>;
  onCancel: () => void;
}

function BannerForm({ onSave, onCancel }: BannerFormProps) {
  const [sponsorName, setSponsorName] = useState("");
  const [sponsorLogoUrl, setSponsorLogoUrl] = useState("");
  const [ctaText, setCtaText] = useState("");
  const [ctaUrl, setCtaUrl] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSave({
        sponsorName,
        sponsorLogoUrl: sponsorLogoUrl || null,
        ctaText,
        ctaUrl,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save banner");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-900 dark:bg-blue-950/30"
    >
      <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
        Create Sponsored Banner
      </h3>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Sponsor Name
          </label>
          <input
            required
            value={sponsorName}
            onChange={(e) => setSponsorName(e.target.value)}
            placeholder="Acme Corp"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>

        <div className="col-span-2">
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Sponsor Logo URL
            <span className="ml-1 font-normal text-neutral-400">(optional)</span>
          </label>
          <input
            type="url"
            value={sponsorLogoUrl}
            onChange={(e) => setSponsorLogoUrl(e.target.value)}
            placeholder="https://example.com/logo.png"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            CTA Text
          </label>
          <input
            required
            value={ctaText}
            onChange={(e) => setCtaText(e.target.value)}
            placeholder="Learn More"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            CTA URL
          </label>
          <input
            required
            type="url"
            value={ctaUrl}
            onChange={(e) => setCtaUrl(e.target.value)}
            placeholder="https://example.com/offer"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Starts At
          </label>
          <input
            required
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
            Ends At
          </label>
          <input
            required
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Create Banner"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Banner Row
// ---------------------------------------------------------------------------

interface BannerRowProps {
  banner: SponsoredBanner;
  onToggle: (id: string, isActive: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  busy: string | null;
}

function BannerRow({ banner, onToggle, onDelete, busy }: BannerRowProps) {
  const isBusy = busy === banner.id;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      {banner.sponsorLogoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={banner.sponsorLogoUrl}
          alt={banner.sponsorName}
          className="h-8 w-8 rounded object-contain"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-neutral-900 dark:text-neutral-100">
          {banner.sponsorName}
        </p>
        <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">
          {banner.ctaText} &rarr;{" "}
          <a
            href={banner.ctaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-blue-600"
          >
            {banner.ctaUrl}
          </a>
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
          <span
            className={`rounded-full px-2 py-0.5 font-semibold ${
              banner.isActive
                ? "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300"
                : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
            }`}
          >
            {banner.isActive ? "Active" : "Inactive"}
          </span>
          <span>
            {formatDateDisplay(banner.startsAt)} — {formatDateDisplay(banner.endsAt)}
          </span>
          <span>{banner.impressions.toLocaleString()} impressions</span>
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        <button
          disabled={isBusy}
          onClick={() => onToggle(banner.id, !banner.isActive)}
          className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300"
        >
          {isBusy ? "…" : banner.isActive ? "Deactivate" : "Activate"}
        </button>
        <button
          disabled={isBusy}
          onClick={() => onDelete(banner.id)}
          className="rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900 dark:text-red-300"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

/**
 * Admin Leaderboard Banners management page.
 * Requires admin authentication (enforced by middleware).
 */
export default function AdminLeaderboardBannersPage() {
  const [banners, setBanners] = useState<SponsoredBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchBanners = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/leaderboard-banners", {
        credentials: "include",
      });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load banners");
      const data = (await res.json()) as { data: { banners: SponsoredBanner[] } };
      setBanners(data.data.banners);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBanners();
  }, [fetchBanners]);

  async function handleCreate(
    formData: Omit<SponsoredBanner, "id" | "impressions" | "isActive" | "createdAt">
  ) {
    const res = await fetch("/api/admin/leaderboard-banners", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sponsorName: formData.sponsorName,
        sponsorLogoUrl: formData.sponsorLogoUrl,
        ctaText: formData.ctaText,
        ctaUrl: formData.ctaUrl,
        startsAt: formData.startsAt,
        endsAt: formData.endsAt,
      }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new Error(err.error?.message ?? "Failed to create banner");
    }
    showToast("Banner created");
    setCreating(false);
    await fetchBanners();
  }

  async function handleToggle(id: string, isActive: boolean) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/leaderboard-banners/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (!res.ok) throw new Error("Failed to update banner");
      showToast(`Banner ${isActive ? "activated" : "deactivated"}`);
      await fetchBanners();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this sponsored banner?")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/leaderboard-banners/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete banner");
      showToast("Banner deleted");
      await fetchBanners();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative space-y-6">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        Leaderboard Banners
      </h1>
      <p className="text-sm text-neutral-500 dark:text-neutral-400">
        Manage sponsored banners displayed on the leaderboard page. Only one banner can be active at a time. The currently active, in-range banner is shown to all users.
      </p>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${
            toast.type === "success" ? "bg-teal-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Banner list */}
      <div className="space-y-3">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
              >
                <div className="mb-2 h-5 w-48 rounded bg-neutral-200 dark:bg-neutral-700" />
                <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
              </div>
            ))
          : banners.length === 0
          ? (
              <div className="rounded-xl border border-neutral-200 bg-white py-12 text-center dark:border-neutral-800 dark:bg-neutral-900">
                <p className="text-neutral-500">No sponsored banners yet</p>
              </div>
            )
          : banners.map((banner) => (
              <BannerRow
                key={banner.id}
                banner={banner}
                onToggle={handleToggle}
                onDelete={handleDelete}
                busy={busy}
              />
            ))}
      </div>

      {/* Create form / button */}
      {creating ? (
        <BannerForm onSave={handleCreate} onCancel={() => setCreating(false)} />
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-xl border-2 border-dashed border-blue-300 px-5 py-4 text-sm font-semibold text-blue-600 hover:border-blue-400 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/30"
        >
          + Create Banner
        </button>
      )}
    </div>
  );
}
