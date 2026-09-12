"use client";

/**
 * app/(admin)/gate44/wiki/page.tsx
 *
 * Admin monitoring for all wikis: filter by status, suspend/ban/deactivate/
 * pause/restore/delete, and transfer ownership to another user. Mirrors the
 * table pattern from gate44/blogs/page.tsx, with cursor pagination mirrored
 * from gate44/polls/page.tsx.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { formatShortDate } from "@/lib/format/date";
import { translateApiError } from "@/lib/i18n/apiErrors";

interface WikiRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  status_reason: string | null;
  contribute_policy: string;
  page_count: number;
  contributor_count: number;
  view_count: number;
  created_at: string;
  owner_id: string;
  owner_username: string;
}

type StatusFilter = "all" | "active" | "paused" | "suspended" | "banned" | "deactivated";
type WikiAction = "suspend" | "ban" | "deactivate" | "pause" | "restore" | "delete";

const STATUS_BADGE: Record<string, string> = {
  active: "bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-300",
  paused: "bg-gold-100 text-gold-700 dark:bg-gold-900 dark:text-gold-300",
  suspended: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  banned: "bg-danger-100 text-danger-700 dark:bg-danger-900 dark:text-danger-300",
  deactivated: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
};

const STATUS_FILTERS: StatusFilter[] = ["all", "active", "paused", "suspended", "banned", "deactivated"];

interface UserSearchResult {
  id: string;
  username: string;
}

export default function AdminWikiPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [rows, setRows] = useState<WikiRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, kind: "success" | "error" = "success") => {
    setToast({ msg, type: kind });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchWikis = useCallback(async (s: StatusFilter, q: string, reset = true, cur: string | null = null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: s, limit: "50" });
      if (q) params.set("q", q);
      if (!reset && cur) params.set("cursor", cur);
      const res = await fetch(`/api/admin/wiki?${params.toString()}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) { window.location.href = "/gate44/login"; return; }
      const data = await res.json();
      const items: WikiRow[] = data?.data?.items ?? [];
      setRows((prev) => (reset ? items : [...prev, ...items]));
      setCursor(data?.data?.nextCursor ?? null);
      setHasMore(!!data?.data?.hasMore);
    } catch {
      showToast(t("admin.wiki.loadFailed", "Failed to load wikis"), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => { void fetchWikis(status, debouncedSearch, true); }, [status, debouncedSearch, fetchWikis]);

  async function handleAction(id: string, action: WikiAction) {
    if (action === "delete" && !window.confirm(t("admin.wiki.confirmDelete", "Permanently delete this wiki? This cannot be undone."))) return;
    const reason = action === "suspend" || action === "ban"
      ? window.prompt(t("admin.wiki.reasonPrompt", "Reason (optional):")) ?? undefined
      : undefined;
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/wiki/${id}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(translateApiError(t, json?.error?.code, json?.error?.message ?? t("admin.wiki.actionFailed", "Action failed")));
      showToast(t("admin.wiki.actionApplied", "Action applied"));
      await fetchWikis(status, debouncedSearch, true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("admin.wiki.actionFailed", "Action failed"), "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleTransfer(id: string) {
    const username = window.prompt(t("admin.wiki.transferPrompt", "Transfer to which username?"));
    if (!username?.trim()) return;
    const trimmed = username.trim();
    setBusy(id);
    try {
      const searchRes = await fetch(`/api/admin/users?q=${encodeURIComponent(trimmed)}&limit=5`, { credentials: "include" });
      const searchJson = await searchRes.json();
      const match = ((searchJson?.users ?? []) as UserSearchResult[]).find(
        (u) => u.username.toLowerCase() === trimmed.toLowerCase()
      );
      if (!match) throw new Error(t("admin.wiki.transferNoUser", 'No user found with username "{{username}}"', { username: trimmed }));

      const res = await fetch(`/api/admin/wiki/${id}/transfer`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newOwnerId: match.id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(translateApiError(t, json?.error?.code, json?.error?.message ?? t("admin.wiki.transferFailed", "Transfer failed")));
      showToast(t("admin.wiki.transferSuccess", "Transferred to @{{username}}", { username: trimmed }));
      await fetchWikis(status, debouncedSearch, true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : t("admin.wiki.transferFailed", "Transfer failed"), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("admin.wiki.title", "Wikis")}</h1>
        <Link href="/gate44/wiki/settings" className="text-sm font-semibold text-teal-600 hover:underline dark:text-teal-400">
          {t("admin.wiki.settingsLink", "Settings →")}
        </Link>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-4">
        <input
          type="search"
          placeholder={t("admin.wiki.searchPlaceholder", "Search by name, slug, owner username, or email…")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50 w-fit">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${status === s ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-900 dark:text-neutral-50" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}
          >
            {t(`admin.wiki.status.${s}`, s.charAt(0).toUpperCase() + s.slice(1))}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-3">{t("admin.wiki.column.name", "Name")}</th>
              <th className="px-4 py-3">{t("admin.wiki.column.owner", "Owner")}</th>
              <th className="px-4 py-3">{t("admin.wiki.column.status", "Status")}</th>
              <th className="px-4 py-3">{t("admin.wiki.column.pages", "Pages")}</th>
              <th className="px-4 py-3">{t("admin.wiki.column.contributors", "Contributors")}</th>
              <th className="px-4 py-3">{t("admin.wiki.column.views", "Views")}</th>
              <th className="px-4 py-3">{t("admin.wiki.column.created", "Created")}</th>
              <th className="px-4 py-3">{t("admin.wiki.column.actions", "Actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading && rows.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i}>{Array.from({ length: 8 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" /></td>)}</tr>
              ))
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-neutral-500">{t("admin.wiki.empty", "No wikis.")}</td></tr>
            ) : rows.map((w) => (
              <tr key={w.id}>
                <td className="max-w-xs truncate px-4 py-3 font-medium text-neutral-900 dark:text-neutral-50">
                  <Link href={`/w/${w.slug}`} target="_blank" className="hover:underline">{w.name}</Link>
                </td>
                <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">@{w.owner_username}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[w.status] ?? ""}`}>
                    {t(`admin.wiki.status.${w.status}`, w.status)}
                  </span>
                  {w.status_reason && <div className="mt-0.5 text-[10px] text-neutral-500 max-w-[140px] truncate">{w.status_reason}</div>}
                </td>
                <td className="px-4 py-3 tabular-nums">{w.page_count}</td>
                <td className="px-4 py-3 tabular-nums">{w.contributor_count}</td>
                <td className="px-4 py-3 tabular-nums">{w.view_count}</td>
                <td className="px-4 py-3 text-neutral-500">{formatShortDate(w.created_at)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {w.status !== "active" && (
                      <button disabled={busy === w.id} onClick={() => handleAction(w.id, "restore")} className="rounded-lg bg-teal-100 px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-200 disabled:opacity-50 dark:bg-teal-900 dark:text-teal-300">
                        {t("admin.wiki.action.restore", "Restore")}
                      </button>
                    )}
                    {w.status === "active" && (
                      <>
                        <button disabled={busy === w.id} onClick={() => handleAction(w.id, "pause")} className="rounded-lg bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300">
                          {t("admin.wiki.action.pause", "Pause")}
                        </button>
                        <button disabled={busy === w.id} onClick={() => handleAction(w.id, "suspend")} className="rounded-lg bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-200 disabled:opacity-50 dark:bg-orange-900 dark:text-orange-300">
                          {t("admin.wiki.action.suspend", "Suspend")}
                        </button>
                        <button disabled={busy === w.id} onClick={() => handleAction(w.id, "ban")} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900 dark:text-red-300">
                          {t("admin.wiki.action.ban", "Ban")}
                        </button>
                        <button disabled={busy === w.id} onClick={() => handleAction(w.id, "deactivate")} className="rounded-lg bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300">
                          {t("admin.wiki.action.deactivate", "Deactivate")}
                        </button>
                      </>
                    )}
                    <button disabled={busy === w.id} onClick={() => handleTransfer(w.id)} className="rounded-lg bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200 disabled:opacity-50 dark:bg-blue-900 dark:text-blue-300">
                      {t("admin.wiki.action.transfer", "Transfer")}
                    </button>
                    <button disabled={busy === w.id} onClick={() => handleAction(w.id, "delete")} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-50 dark:bg-red-900 dark:text-red-300">
                      {t("admin.wiki.action.delete", "Delete")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button
          onClick={() => void fetchWikis(status, debouncedSearch, false, cursor)}
          disabled={loading}
          className="mt-3 w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-medium text-neutral-500 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700"
        >
          {loading ? t("admin.wiki.loading", "Loading…") : t("admin.wiki.loadMore", "Load more")}
        </button>
      )}
    </div>
  );
}
