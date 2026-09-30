"use client";

/**
 * app/(admin)/gate44/portals/page.tsx
 *
 * Admin console for Hashtags + Portals (/h/<slug>):
 *  - Portals tab: every portal (official / auto / archived / suppressed) with
 *    activity, followers and boost state; create official portals, promote or
 *    suppress auto ones, edit copy/cover/sections, set the feed boost dial
 *    (0-100) + schedule, sponsorship, and read 30-day analytics.
 *  - Hashtags tab: tag explorer to curate (make a portal), merge duplicates
 *    (#Uniben -> #uniben) and block/unblock abusive tags.
 *
 * Data: /api/admin/portals, /api/admin/portals/[id], /api/admin/portals/hashtags.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { PORTAL_SECTION_KEYS } from "@/lib/portals/constants";
import type { PortalSectionConfig, PortalStatus } from "@zobia/types";

interface AdminPortal {
  id: string;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  coverImageUrl: string | null;
  accentColor: string | null;
  city: string | null;
  bbBoardId: string | null;
  status: PortalStatus;
  sections: PortalSectionConfig[];
  isPinned: boolean;
  boostWeight: number;
  boostStartsAt: string | null;
  boostEndsAt: string | null;
  sponsoredUntil: string | null;
  sponsorName: string | null;
  followerCount: number;
  activityCount: number;
  lastActivityAt: string | null;
  createdAt: string;
}

interface HashtagRow {
  slug: string;
  useCount: number;
  isBlocked: boolean;
  aliasOf: string | null;
  hasPortal: boolean;
  lastUsedAt: string | null;
}

interface Stats {
  totals: { views: number; impressions: number; clicks: number; follows: number };
}

const STATUS_BADGE: Record<PortalStatus, string> = {
  official: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  auto: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  archived: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  suppressed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

const inputCls = "w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900";
const btnCls = "rounded-lg px-2 py-1 text-xs font-semibold disabled:opacity-50";

/** ISO -> value for <input type="datetime-local"> (local time). */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  return v ? new Date(v).toISOString() : null;
}

interface FormState {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  coverImageUrl: string;
  accentColor: string;
  city: string;
  bbBoardId: string;
  sections: PortalSectionConfig[];
  isPinned: boolean;
  boostWeight: number;
  boostStartsAt: string;
  boostEndsAt: string;
  sponsorName: string;
  sponsoredUntil: string;
}

function emptyForm(slug = ""): FormState {
  return {
    slug,
    title: "",
    tagline: "",
    description: "",
    coverImageUrl: "",
    accentColor: "",
    city: "",
    bbBoardId: "",
    sections: PORTAL_SECTION_KEYS.map((key) => ({ key, enabled: true })),
    isPinned: false,
    boostWeight: 0,
    boostStartsAt: "",
    boostEndsAt: "",
    sponsorName: "",
    sponsoredUntil: "",
  };
}

function formFrom(p: AdminPortal): FormState {
  return {
    slug: p.slug,
    title: p.title,
    tagline: p.tagline ?? "",
    description: p.description ?? "",
    coverImageUrl: p.coverImageUrl ?? "",
    accentColor: p.accentColor ?? "",
    city: p.city ?? "",
    bbBoardId: p.bbBoardId ?? "",
    sections: p.sections,
    isPinned: p.isPinned,
    boostWeight: p.boostWeight,
    boostStartsAt: toLocalInput(p.boostStartsAt),
    boostEndsAt: toLocalInput(p.boostEndsAt),
    sponsorName: p.sponsorName ?? "",
    sponsoredUntil: toLocalInput(p.sponsoredUntil),
  };
}

function bodyFrom(f: FormState) {
  return {
    title: f.title.trim() || undefined,
    tagline: f.tagline.trim() || null,
    description: f.description.trim() || null,
    coverImageUrl: f.coverImageUrl.trim() || null,
    accentColor: f.accentColor.trim() || null,
    city: f.city.trim() || null,
    bbBoardId: f.bbBoardId.trim() || null,
    sections: f.sections,
    isPinned: f.isPinned,
    boostWeight: f.boostWeight,
    boostStartsAt: fromLocalInput(f.boostStartsAt),
    boostEndsAt: fromLocalInput(f.boostEndsAt),
    sponsorName: f.sponsorName.trim() || null,
    sponsoredUntil: fromLocalInput(f.sponsoredUntil),
  };
}

export default function AdminPortalsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"portals" | "hashtags">("portals");
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ---- Portals tab -------------------------------------------------------
  const [status, setStatus] = useState<"all" | PortalStatus>("all");
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [rows, setRows] = useState<AdminPortal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; form: FormState } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const h = setTimeout(() => setDq(q), 300);
    return () => clearTimeout(h);
  }, [q]);

  const loadPortals = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100", sort: "new" });
      if (status !== "all") params.set("status", status);
      if (dq) params.set("q", dq);
      const res = await fetch(`/api/admin/portals?${params}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/gate44/login";
        return;
      }
      const json = await res.json();
      setRows(json?.data?.portals ?? []);
      setTotal(json?.data?.total ?? 0);
    } catch {
      showToast(t("admin.portals.loadError", "Failed to load portals"), "error");
    } finally {
      setLoading(false);
    }
  }, [status, dq, showToast, t]);

  useEffect(() => {
    if (tab === "portals") void loadPortals();
  }, [tab, loadPortals]);

  async function call(url: string, method: string, body?: unknown): Promise<{ ok: boolean; json: any }> {
    const res = await fetch(url, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, json };
  }

  async function patch(id: string, body: Record<string, unknown>, okMsg: string) {
    setBusy(id);
    const r = await call(`/api/admin/portals/${id}`, "PATCH", body);
    setBusy(null);
    if (!r.ok) return showToast(r.json?.error?.message ?? r.json?.error ?? t("admin.portals.actionFailed", "Action failed"), "error");
    showToast(okMsg);
    await loadPortals();
  }

  async function remove(p: AdminPortal) {
    if (!window.confirm(t("admin.portals.confirmDelete", "Delete the #{{slug}} portal? The hashtag and its posts stay.", { slug: p.slug }))) return;
    setBusy(p.id);
    const r = await call(`/api/admin/portals/${p.id}`, "DELETE");
    setBusy(null);
    if (!r.ok) return showToast(t("admin.portals.actionFailed", "Action failed"), "error");
    showToast(t("admin.portals.deleted", "Portal deleted"));
    await loadPortals();
  }

  async function openEdit(p: AdminPortal) {
    setStats(null);
    setEditing({ id: p.id, form: formFrom(p) });
    const r = await call(`/api/admin/portals/${p.id}`, "GET");
    if (r.ok) setStats(r.json?.data?.stats ?? null);
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    const body = bodyFrom(editing.form);
    const r = editing.id
      ? await call(`/api/admin/portals/${editing.id}`, "PATCH", body)
      : await call(`/api/admin/portals`, "POST", { slug: editing.form.slug, ...body });
    setSaving(false);
    if (!r.ok) {
      const issues = r.json?.error?.issues ?? r.json?.issues;
      return showToast(issues?.[0]?.message ?? r.json?.error?.message ?? r.json?.error ?? t("admin.portals.actionFailed", "Action failed"), "error");
    }
    showToast(t("admin.portals.saved", "Portal saved"));
    setEditing(null);
    await loadPortals();
  }

  function moveSection(idx: number, dir: -1 | 1) {
    setEditing((prev) => {
      if (!prev) return prev;
      const next = [...prev.form.sections];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...prev, form: { ...prev.form, sections: next } };
    });
  }

  // ---- Hashtags tab ------------------------------------------------------
  const [tq, setTq] = useState("");
  const [dtq, setDtq] = useState("");
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [tags, setTags] = useState<HashtagRow[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);

  useEffect(() => {
    const h = setTimeout(() => setDtq(tq), 300);
    return () => clearTimeout(h);
  }, [tq]);

  const loadTags = useCallback(async () => {
    setTagsLoading(true);
    try {
      const params = new URLSearchParams({ blocked: blockedOnly ? "1" : "0", limit: "60" });
      if (dtq) params.set("q", dtq);
      const res = await fetch(`/api/admin/portals/hashtags?${params}`, { credentials: "include" });
      const json = await res.json();
      setTags(json?.data?.hashtags ?? []);
    } catch {
      showToast(t("admin.portals.loadError", "Failed to load"), "error");
    } finally {
      setTagsLoading(false);
    }
  }, [blockedOnly, dtq, showToast, t]);

  useEffect(() => {
    if (tab === "hashtags") void loadTags();
  }, [tab, loadTags]);

  async function tagAction(body: Record<string, unknown>, okMsg: string) {
    const r = await call(`/api/admin/portals/hashtags`, "POST", body);
    if (!r.ok) return showToast(r.json?.error?.message ?? r.json?.error ?? t("admin.portals.actionFailed", "Action failed"), "error");
    showToast(okMsg);
    await loadTags();
  }

  return (
    <div className="relative">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("admin.portals.title", "Portals")}</h1>
        <div className="flex items-center gap-3">
          <Link href="/gate44/config" className="text-sm font-semibold text-teal-600 hover:underline dark:text-teal-400">
            {t("admin.portals.settings", "Settings")} →
          </Link>
          <button onClick={() => setEditing({ id: null, form: emptyForm() })} className="rounded-lg bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700">
            {t("admin.portals.new", "New official portal")}
          </button>
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-[60] rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>{toast.msg}</div>
      )}

      <div className="mb-4 flex w-fit gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50">
        {(["portals", "hashtags"] as const).map((x) => (
          <button
            key={x}
            onClick={() => setTab(x)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${tab === x ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-900 dark:text-neutral-50" : "text-neutral-500 hover:text-neutral-700"}`}
          >
            {x === "portals" ? t("admin.portals.tab.portals", "Portals") : t("admin.portals.tab.hashtags", "Hashtags")}
          </button>
        ))}
      </div>

      {tab === "portals" && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("admin.portals.search", "Search tag or title…")} className={`${inputCls} max-w-xs`} />
            <div className="flex flex-wrap gap-1">
              {(["all", "official", "auto", "archived", "suppressed"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${status === s ? "bg-teal-600 text-white" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <span className="text-xs text-neutral-500">{t("admin.portals.total", "{{count}} portals", { count: total })}</span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-3">{t("admin.portals.col.portal", "Portal")}</th>
                  <th className="px-4 py-3">{t("admin.portals.col.status", "Status")}</th>
                  <th className="px-4 py-3">{t("admin.portals.col.followers", "Followers")}</th>
                  <th className="px-4 py-3">{t("admin.portals.col.activity", "Activity")}</th>
                  <th className="px-4 py-3">{t("admin.portals.col.boost", "Boost")}</th>
                  <th className="px-4 py-3">{t("admin.portals.col.actions", "Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {loading && rows.length === 0 ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 6 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" /></td>)}</tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-neutral-500">{t("admin.portals.empty", "No portals yet.")}</td></tr>
                ) : (
                  rows.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3">
                        <Link href={`/h/${p.slug}`} target="_blank" className="font-semibold text-neutral-900 hover:underline dark:text-neutral-50">#{p.slug}</Link>
                        <div className="text-xs text-neutral-500">{p.title}{p.isPinned ? " · 📌" : ""}</div>
                      </td>
                      <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[p.status]}`}>{p.status}</span></td>
                      <td className="px-4 py-3 tabular-nums">{p.followerCount}</td>
                      <td className="px-4 py-3 tabular-nums">{p.activityCount}</td>
                      <td className="px-4 py-3 tabular-nums">{p.boostWeight > 0 ? p.boostWeight : "–"}{p.sponsorName ? ` · ${p.sponsorName}` : ""}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <button disabled={busy === p.id} onClick={() => openEdit(p)} className={`${btnCls} bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300`}>{t("admin.portals.edit", "Edit")}</button>
                          {p.status === "auto" && <button disabled={busy === p.id} onClick={() => patch(p.id, { status: "official" }, t("admin.portals.promoted", "Promoted to official"))} className={`${btnCls} bg-teal-100 text-teal-700 hover:bg-teal-200 dark:bg-teal-900 dark:text-teal-300`}>{t("admin.portals.promote", "Promote")}</button>}
                          {(p.status === "archived" || p.status === "suppressed") && <button disabled={busy === p.id} onClick={() => patch(p.id, { status: "auto" }, t("admin.portals.restored", "Restored"))} className={`${btnCls} bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300`}>{t("admin.portals.restore", "Restore")}</button>}
                          {p.status !== "suppressed" && <button disabled={busy === p.id} onClick={() => patch(p.id, { status: "suppressed" }, t("admin.portals.suppressedMsg", "Portal suppressed"))} className={`${btnCls} bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900 dark:text-orange-300`}>{t("admin.portals.suppress", "Suppress")}</button>}
                          <button disabled={busy === p.id} onClick={() => remove(p)} className={`${btnCls} bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300`}>{t("admin.portals.delete", "Delete")}</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "hashtags" && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <input type="search" value={tq} onChange={(e) => setTq(e.target.value)} placeholder={t("admin.portals.tagSearch", "Search hashtags…")} className={`${inputCls} max-w-xs`} />
            <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
              <input type="checkbox" checked={blockedOnly} onChange={(e) => setBlockedOnly(e.target.checked)} /> {t("admin.portals.blockedOnly", "Blocked only")}
            </label>
            <button
              onClick={() => {
                const s = window.prompt(t("admin.portals.blockPrompt", "Hashtag to block (without #)"));
                if (s) void tagAction({ action: "block", slug: s }, t("admin.portals.blockedMsg", "Hashtag blocked"));
              }}
              className="ml-auto rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              {t("admin.portals.blockNew", "Block a hashtag")}
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-3">{t("admin.portals.col.tag", "Hashtag")}</th>
                  <th className="px-4 py-3">{t("admin.portals.col.uses", "Uses")}</th>
                  <th className="px-4 py-3">{t("admin.portals.col.portal", "Portal")}</th>
                  <th className="px-4 py-3">{t("admin.portals.col.actions", "Actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {tagsLoading && tags.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-neutral-500">…</td></tr>
                ) : tags.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-neutral-500">{t("admin.portals.noTags", "No hashtags.")}</td></tr>
                ) : (
                  tags.map((h) => (
                    <tr key={h.slug}>
                      <td className="px-4 py-3 font-semibold">#{h.slug}{h.aliasOf ? <span className="ml-2 text-xs font-normal text-neutral-500">{t("admin.portals.merged", "merged")}</span> : null}</td>
                      <td className="px-4 py-3 tabular-nums">{h.useCount}</td>
                      <td className="px-4 py-3">{h.hasPortal ? "✓" : "–"}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {!h.isBlocked && !h.aliasOf && <button onClick={() => setEditing({ id: null, form: emptyForm(h.slug) })} className={`${btnCls} bg-teal-100 text-teal-700 hover:bg-teal-200 dark:bg-teal-900 dark:text-teal-300`}>{t("admin.portals.makePortal", "Make portal")}</button>}
                          {!h.isBlocked && !h.aliasOf && (
                            <button
                              onClick={() => {
                                const into = window.prompt(t("admin.portals.mergePrompt", "Merge #{{slug}} into which hashtag? (without #)", { slug: h.slug }));
                                if (into) void tagAction({ action: "merge", slug: h.slug, into }, t("admin.portals.mergedMsg", "Hashtags merged"));
                              }}
                              className={`${btnCls} bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300`}
                            >
                              {t("admin.portals.merge", "Merge into…")}
                            </button>
                          )}
                          {h.isBlocked ? (
                            <button onClick={() => tagAction({ action: "unblock", slug: h.slug }, t("admin.portals.unblockedMsg", "Hashtag unblocked"))} className={`${btnCls} bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300`}>{t("admin.portals.unblock", "Unblock")}</button>
                          ) : (
                            <button onClick={() => window.confirm(t("admin.portals.confirmBlock", "Block #{{slug}}? Its links are removed and its portal suppressed.", { slug: h.slug })) && tagAction({ action: "block", slug: h.slug }, t("admin.portals.blockedMsg", "Hashtag blocked"))} className={`${btnCls} bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300`}>{t("admin.portals.block", "Block")}</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" role="dialog" aria-modal="true">
          <div className="my-8 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-modal dark:bg-neutral-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-50">
                {editing.id ? t("admin.portals.editTitle", "Edit portal #{{slug}}", { slug: editing.form.slug }) : t("admin.portals.newTitle", "New official portal")}
              </h2>
              <button onClick={() => setEditing(null)} aria-label={t("action.close", "Close")} className="text-neutral-400 hover:text-neutral-700">✕</button>
            </div>

            {stats && (
              <div className="mb-4 grid grid-cols-4 gap-2 text-center text-xs">
                {(["views", "impressions", "clicks", "follows"] as const).map((k) => (
                  <div key={k} className="rounded-lg bg-neutral-100 p-2 dark:bg-neutral-800">
                    <div className="text-lg font-bold tabular-nums text-neutral-900 dark:text-neutral-50">{stats.totals[k]}</div>
                    <div className="capitalize text-neutral-500">{t(`admin.portals.stat.${k}`, k)} · 30d</div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block font-medium">{t("admin.portals.field.slug", "Hashtag (slug)")}</span>
                <input className={inputCls} value={editing.form.slug} disabled={!!editing.id} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, slug: e.target.value.replace(/^#/, "") } })} placeholder="lagos" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">{t("admin.portals.field.title", "Title")}</span>
                <input className={inputCls} maxLength={80} value={editing.form.title} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, title: e.target.value } })} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">{t("admin.portals.field.tagline", "Tagline")}</span>
                <input className={inputCls} maxLength={160} value={editing.form.tagline} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, tagline: e.target.value } })} />
              </label>
              <label className="text-sm sm:col-span-2">
                <span className="mb-1 block font-medium">{t("admin.portals.field.description", "Description")}</span>
                <textarea className={inputCls} rows={3} maxLength={1200} value={editing.form.description} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, description: e.target.value } })} />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">{t("admin.portals.field.cover", "Cover image URL")}</span>
                <input className={inputCls} value={editing.form.coverImageUrl} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, coverImageUrl: e.target.value } })} placeholder="https://…" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">{t("admin.portals.field.accent", "Accent colour")}</span>
                <div className="flex gap-2">
                  <input type="color" className="h-9 w-12 rounded border border-neutral-200 dark:border-neutral-700" value={/^#[0-9a-fA-F]{6}$/.test(editing.form.accentColor) ? editing.form.accentColor : "#0d9488"} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, accentColor: e.target.value } })} />
                  <input className={inputCls} value={editing.form.accentColor} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, accentColor: e.target.value } })} placeholder="#0d9488" />
                </div>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">{t("admin.portals.field.city", "Place / school keyword")}</span>
                <input className={inputCls} maxLength={80} value={editing.form.city} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, city: e.target.value } })} placeholder="Benin" />
                <span className="mt-1 block text-xs text-neutral-500">{t("admin.portals.field.cityHint", "Rooms and guilds whose city matches appear even without the hashtag.")}</span>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">{t("admin.portals.field.board", "Official forum board ID")}</span>
                <input className={inputCls} value={editing.form.bbBoardId} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, bbBoardId: e.target.value } })} placeholder="uuid (optional)" />
              </label>
            </div>

            <fieldset className="mt-4">
              <legend className="mb-1 text-sm font-medium">{t("admin.portals.field.sections", "Sections (order and visibility)")}</legend>
              <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">
                {editing.form.sections.map((s, i) => (
                  <li key={s.key} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={s.enabled}
                      onChange={(e) => setEditing({ ...editing, form: { ...editing.form, sections: editing.form.sections.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)) } })}
                    />
                    <span className="flex-1">{t(`portals.section.${s.key}`, s.key)}</span>
                    <button type="button" onClick={() => moveSection(i, -1)} disabled={i === 0} className="px-1 text-neutral-500 disabled:opacity-30" aria-label="Move up">↑</button>
                    <button type="button" onClick={() => moveSection(i, 1)} disabled={i === editing.form.sections.length - 1} className="px-1 text-neutral-500 disabled:opacity-30" aria-label="Move down">↓</button>
                  </li>
                ))}
              </ul>
            </fieldset>

            <div className="mt-4 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
              <p className="mb-2 text-sm font-semibold">{t("admin.portals.field.boostTitle", "Feed prominence")}</p>
              <label className="block text-sm">
                <span className="mb-1 block">{t("admin.portals.field.boost", "Boost weight")}: <strong className="tabular-nums">{editing.form.boostWeight}</strong> / 100</span>
                <input type="range" min={0} max={100} step={5} className="w-full" value={editing.form.boostWeight} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, boostWeight: Number(e.target.value) } })} />
                <span className="text-xs text-neutral-500">{t("admin.portals.field.boostHint", "0 = organic only. 100 = shown up to ~11x more often in feed suggestions.")}</span>
              </label>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <label className="text-sm"><span className="mb-1 block">{t("admin.portals.field.boostStart", "Boost starts")}</span><input type="datetime-local" className={inputCls} value={editing.form.boostStartsAt} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, boostStartsAt: e.target.value } })} /></label>
                <label className="text-sm"><span className="mb-1 block">{t("admin.portals.field.boostEnd", "Boost ends")}</span><input type="datetime-local" className={inputCls} value={editing.form.boostEndsAt} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, boostEndsAt: e.target.value } })} /></label>
                <label className="text-sm"><span className="mb-1 block">{t("admin.portals.field.sponsor", "Sponsor name")}</span><input className={inputCls} maxLength={80} value={editing.form.sponsorName} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, sponsorName: e.target.value } })} /></label>
                <label className="text-sm"><span className="mb-1 block">{t("admin.portals.field.sponsorUntil", "Sponsored until")}</span><input type="datetime-local" className={inputCls} value={editing.form.sponsoredUntil} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, sponsoredUntil: e.target.value } })} /></label>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm">
                <input type="checkbox" checked={editing.form.isPinned} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, isPinned: e.target.checked } })} /> {t("admin.portals.field.pinned", "Pinned (2x suggestion weight, never auto-archived)")}
              </label>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="rounded-lg px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-800">{t("action.cancel", "Cancel")}</button>
              <button onClick={save} disabled={saving || (!editing.id && editing.form.slug.trim().length < 2)} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
                {saving ? t("action.saving", "Saving…") : t("action.save", "Save")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
