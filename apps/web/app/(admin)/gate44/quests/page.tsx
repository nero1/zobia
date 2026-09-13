"use client";

/**
 * app/(admin)/gate44/quests/page.tsx
 *
 * Admin Quests catalog — the base list of quest_templates rows that
 * lib/quests/questEngine.ts generateDailyDeck() draws a user's daily deck
 * from. This is the third quest-admin surface (see also /gate44/quests/boosts
 * for temporary per-feature weighting, and /gate44/sponsored-quests for
 * advertiser-funded quests) and the only one that manages the catalog of
 * quest *definitions* itself: reward amounts, eligibility, and which
 * feature (if any) gates a quest.
 *
 * See app/api/admin/quests/route.ts for exactly what is and isn't editable
 * and why (action_type is a fixed, code-wired vocabulary; deck size per plan
 * and the full-deck completion bonus are hardcoded constants, not data).
 */

import { useCallback, useEffect, useState } from "react";

interface Quest {
  id: string;
  title: string;
  description: string;
  action_type: string;
  target_count: number;
  xp_reward: number;
  coin_reward: number;
  category: string;
  icon: string | null;
  plan_required: string | null;
  track: string | null;
  feature_key: string | null;
  is_active: boolean;
  assigned_count: string;
  completed_count: string;
}

interface QuestsResponse {
  quests: Quest[];
  featureKeys: string[];
  actionTypes: string[];
  tracks: string[];
  statsWindowDays: number;
}

const FEATURE_LABELS: Record<string, string> = {
  games: "Games",
  blogs: "Blogs",
  wiki: "Wiki",
  polls: "Polls",
  quizzes: "Quizzes",
  bbforum: "Forum",
  gifts: "Gifts",
  rooms: "Rooms",
};

const PLAN_OPTIONS = ["free", "plus", "pro", "max"];

interface EditDraft {
  title: string;
  description: string;
  targetCount: number;
  xpReward: number;
  coinReward: number;
  category: string;
  icon: string | null;
  planRequired: string | null;
  track: string | null;
  featureKey: string | null;
}

interface CreateForm {
  title: string;
  description: string;
  actionType: string;
  targetCount: string;
  xpReward: string;
  coinReward: string;
  category: string;
  icon: string;
  planRequired: string;
  track: string;
  featureKey: string;
}

function defaultCreateForm(actionTypes: string[], tracks: string[]): CreateForm {
  return {
    title: "",
    description: "",
    actionType: actionTypes[0] ?? "",
    targetCount: "1",
    xpReward: "100",
    coinReward: "0",
    category: "general",
    icon: "⭐",
    planRequired: "free",
    track: tracks[0] ?? "main",
    featureKey: "",
  };
}

function completionRate(q: Quest): string {
  const assigned = parseInt(q.assigned_count, 10) || 0;
  const completed = parseInt(q.completed_count, 10) || 0;
  if (assigned === 0) return "—";
  return `${Math.round((completed / assigned) * 100)}%`;
}

export default function AdminQuestsPage() {
  const [data, setData] = useState<QuestsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateForm>(defaultCreateForm([], []));
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/quests", { credentials: "include" });
      const json = (await res.json()) as { success: boolean; data?: QuestsResponse; error?: { message?: string } };
      if (!json.success || !json.data) throw new Error(json.error?.message ?? "Failed to load quests");
      setData(json.data);
      setForm((f) => (f.actionType ? f : defaultCreateForm(json.data!.actionTypes, json.data!.tracks)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load quests");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/quests", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          actionType: form.actionType,
          targetCount: parseInt(form.targetCount, 10) || 1,
          xpReward: parseInt(form.xpReward, 10) || 0,
          coinReward: parseInt(form.coinReward, 10) || 0,
          category: form.category || "general",
          icon: form.icon || undefined,
          planRequired: form.planRequired,
          track: form.track,
          featureKey: form.featureKey || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to create quest");
      showToast("Quest template created!");
      setShowForm(false);
      setForm(defaultCreateForm(data?.actionTypes ?? [], data?.tracks ?? []));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create quest");
    } finally {
      setCreating(false);
    }
  }

  function startEdit(q: Quest) {
    setEditingId(q.id);
    setEditDraft({
      title: q.title,
      description: q.description,
      targetCount: q.target_count,
      xpReward: q.xp_reward,
      coinReward: q.coin_reward,
      category: q.category,
      icon: q.icon,
      planRequired: q.plan_required,
      track: q.track,
      featureKey: q.feature_key,
    });
  }

  async function saveEdit(id: string) {
    if (!editDraft) return;
    setSavingId(id);
    try {
      const d = editDraft;
      const res = await fetch(`/api/admin/quests/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: d.title,
          description: d.description,
          targetCount: Number(d.targetCount),
          xpReward: Number(d.xpReward),
          coinReward: Number(d.coinReward),
          category: d.category,
          icon: d.icon || null,
          planRequired: d.planRequired,
          track: d.track,
          featureKey: d.featureKey || null,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to save");
      showToast("Quest updated");
      setEditingId(null);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSavingId(null);
    }
  }

  async function toggleActive(id: string, value: boolean) {
    try {
      const res = await fetch(`/api/admin/quests/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: value }),
      });
      const json = await res.json();
      if (!json.success) throw new Error();
      setData((prev) =>
        prev ? { ...prev, quests: prev.quests.map((q) => (q.id === id ? { ...q, is_active: value } : q)) } : prev
      );
    } catch {
      showToast("Failed to update", "error");
    }
  }

  const quests = data?.quests ?? [];
  const actionTypes = data?.actionTypes ?? [];
  const tracks = data?.tracks ?? [];

  return (
    <div className="relative">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Quests</h1>
          <p className="mt-1 text-sm text-neutral-500">
            The catalog of quest templates the daily deck engine draws from. See also{" "}
            <a href="/gate44/quests/boosts" className="text-blue-600 hover:underline">Campaign Boosts</a> (temporary
            per-feature weighting) and{" "}
            <a href="/gate44/sponsored-quests" className="text-blue-600 hover:underline">Sponsored Quests</a>{" "}
            (advertiser-funded — managed separately, not listed below).
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {showForm ? "Cancel" : "+ New Quest"}
        </button>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-5 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
        <span className="font-semibold text-neutral-700 dark:text-neutral-300">Hardcoded, not editable here:</span>{" "}
        daily deck size (free 3 / plus 4 / pro 5 / max 6 quests) and the 500 XP full-deck completion bonus are
        constants in <code className="rounded bg-neutral-200 px-1 py-0.5 text-xs dark:bg-neutral-800">lib/quests/questEngine.ts</code>.
        Sponsored-quest injection odds and CPM are data, but edited at{" "}
        <a href="/gate44/config" className="text-blue-600 hover:underline">Config</a> (search &quot;sponsored_quest&quot;), not here.
        Each quest&apos;s <span className="font-mono text-xs">action_type</span> is fixed once created — it&apos;s the string
        ~20 feature endpoints call to advance progress, so changing it after creation would silently break the quest.
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-6 space-y-3 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Title *</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" placeholder="e.g. Poll Creator" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Icon (emoji)</label>
              <input value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} maxLength={8} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Description *</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required rows={2} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Action Type *</label>
              <select value={form.actionType} onChange={(e) => setForm({ ...form, actionType: e.target.value })} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">
                {actionTypes.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Target Count *</label>
              <input type="number" min={1} value={form.targetCount} onChange={(e) => setForm({ ...form, targetCount: e.target.value })} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">XP Reward</label>
              <input type="number" min={0} value={form.xpReward} onChange={(e) => setForm({ ...form, xpReward: e.target.value })} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Credit Reward</label>
              <input type="number" min={0} value={form.coinReward} onChange={(e) => setForm({ ...form, coinReward: e.target.value })} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Category</label>
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Min Plan</label>
              <select value={form.planRequired} onChange={(e) => setForm({ ...form, planRequired: e.target.value })} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">
                {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">XP Track</label>
              <select value={form.track} onChange={(e) => setForm({ ...form, track: e.target.value })} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">
                {tracks.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Feature dependency</label>
              <select value={form.featureKey} onChange={(e) => setForm({ ...form, featureKey: e.target.value })} className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100">
                <option value="">None (always eligible)</option>
                {(data?.featureKeys ?? []).map((k) => <option key={k} value={k}>{FEATURE_LABELS[k] ?? k}</option>)}
              </select>
            </div>
          </div>
          {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>}
          <button type="submit" disabled={creating} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
            {creating ? "Creating…" : "Create Quest"}
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs uppercase tracking-wider text-neutral-500 dark:border-neutral-800">
              <th className="px-4 py-3 text-left font-semibold">Quest</th>
              <th className="px-4 py-3 text-left font-semibold">Feature</th>
              <th className="px-4 py-3 text-left font-semibold">Action type</th>
              <th className="px-4 py-3 text-right font-semibold">Target</th>
              <th className="px-4 py-3 text-right font-semibold">XP</th>
              <th className="px-4 py-3 text-right font-semibold">Credits</th>
              <th className="px-4 py-3 text-left font-semibold">Min plan</th>
              <th className="px-4 py-3 text-left font-semibold">Track</th>
              <th className="px-4 py-3 text-right font-semibold" title="Completion rate over the last 30 days">30d rate</th>
              <th className="px-4 py-3 text-center font-semibold">Active</th>
              <th className="px-4 py-3 text-center font-semibold">Edit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-neutral-500">Loading…</td></tr>
            ) : quests.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-neutral-500">No quest templates yet</td></tr>
            ) : (
              quests.map((q) =>
                editingId === q.id && editDraft ? (
                  <tr key={q.id} className="bg-blue-50/50 dark:bg-blue-950/20">
                    <td colSpan={11} className="px-4 py-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-neutral-500">Title</label>
                          <input value={editDraft.title} onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })} className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800" />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-xs font-semibold text-neutral-500">Description</label>
                          <input value={editDraft.description} onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })} className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-neutral-500">Target count</label>
                          <input type="number" min={1} value={editDraft.targetCount} onChange={(e) => setEditDraft({ ...editDraft, targetCount: Number(e.target.value) })} className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-neutral-500">XP reward</label>
                          <input type="number" min={0} value={editDraft.xpReward} onChange={(e) => setEditDraft({ ...editDraft, xpReward: Number(e.target.value) })} className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-neutral-500">Credit reward</label>
                          <input type="number" min={0} value={editDraft.coinReward} onChange={(e) => setEditDraft({ ...editDraft, coinReward: Number(e.target.value) })} className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-neutral-500">Category</label>
                          <input value={editDraft.category} onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })} className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800" />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-neutral-500">Min plan</label>
                          <select value={editDraft.planRequired ?? "free"} onChange={(e) => setEditDraft({ ...editDraft, planRequired: e.target.value })} className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800">
                            {PLAN_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-neutral-500">XP track</label>
                          <select value={editDraft.track ?? "main"} onChange={(e) => setEditDraft({ ...editDraft, track: e.target.value })} className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800">
                            {tracks.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-neutral-500">Feature dependency</label>
                          <select value={editDraft.featureKey ?? ""} onChange={(e) => setEditDraft({ ...editDraft, featureKey: e.target.value })} className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-800">
                            <option value="">None</option>
                            {(data?.featureKeys ?? []).map((k) => <option key={k} value={k}>{FEATURE_LABELS[k] ?? k}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => saveEdit(q.id)} disabled={savingId === q.id} className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                          {savingId === q.id ? "Saving…" : "Save"}
                        </button>
                        <button onClick={() => setEditingId(null)} className="rounded-lg border border-neutral-300 px-4 py-1.5 text-xs font-semibold text-neutral-600 dark:border-neutral-600 dark:text-neutral-300">
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={q.id} className={`hover:bg-neutral-50 dark:hover:bg-neutral-800/50 ${!q.is_active ? "opacity-50" : ""}`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-neutral-900 dark:text-neutral-100">{q.icon ?? "⭐"} {q.title}</div>
                      <div className="text-xs text-neutral-500">{q.description}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-600 dark:text-neutral-400">{q.feature_key ? (FEATURE_LABELS[q.feature_key] ?? q.feature_key) : "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500">{q.action_type}</td>
                    <td className="px-4 py-3 text-right">{q.target_count}</td>
                    <td className="px-4 py-3 text-right">{q.xp_reward}</td>
                    <td className="px-4 py-3 text-right">{q.coin_reward}</td>
                    <td className="px-4 py-3 text-xs">{q.plan_required ?? "free"}</td>
                    <td className="px-4 py-3 text-xs">{q.track ?? "main"}</td>
                    <td className="px-4 py-3 text-right text-xs text-neutral-500">{completionRate(q)}</td>
                    <td className="px-4 py-3 text-center">
                      <input type="checkbox" checked={q.is_active} onChange={(e) => toggleActive(q.id, e.target.checked)} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => startEdit(q)} className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800">
                        Edit
                      </button>
                    </td>
                  </tr>
                )
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
