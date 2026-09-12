"use client";

/**
 * app/(admin)/gate44/quests/boosts/page.tsx
 *
 * Admin quest-category "campaign boost" — promote a feature's daily quests
 * for a date range (e.g. "show more blog/wiki quests this week"). Read by
 * lib/quests/questEngine.ts generateDailyDeck() to weight selection; if
 * nothing is scheduled, the engine picks with no bias (default behavior).
 */

import { useState, useEffect, useCallback } from "react";

interface Boost {
  id: string;
  feature_key: string;
  weight_multiplier: string;
  starts_at: string;
  ends_at: string;
  note: string | null;
  created_by_username: string | null;
  created_at: string;
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function isActive(b: Boost): boolean {
  const now = Date.now();
  return new Date(b.starts_at).getTime() <= now && new Date(b.ends_at).getTime() >= now;
}

export default function QuestBoostsPage() {
  const [boosts, setBoosts] = useState<Boost[]>([]);
  const [featureKeys, setFeatureKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const [featureKey, setFeatureKey] = useState("blogs");
  const [weightMultiplier, setWeightMultiplier] = useState(2);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/quest-boosts");
      const json = await res.json();
      if (json.success) {
        setBoosts(json.data.boosts);
        setFeatureKeys(json.data.featureKeys);
        if (json.data.featureKeys?.length) setFeatureKey((f) => f || json.data.featureKeys[0]);
      }
    } catch {
      setError("Failed to load boosts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/quest-boosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureKey,
          weightMultiplier: Number(weightMultiplier),
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          note: note.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to create boost");
      setStartsAt(""); setEndsAt(""); setNote(""); setWeightMultiplier(2);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create boost");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/admin/quest-boosts/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to delete");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-white mb-1">Daily Quest Campaign Boosts</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Promote a feature&apos;s quests for a date range — e.g. show more Blog and Wiki quests for the next week. When
        nothing is scheduled here, the system automatically picks quests across all enabled features with no bias.
      </p>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      <form onSubmit={handleCreate} className="mb-6 p-5 border border-neutral-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-900 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Feature</label>
            <select value={featureKey} onChange={(e) => setFeatureKey(e.target.value)} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800">
              {featureKeys.map((k) => <option key={k} value={k}>{FEATURE_LABELS[k] ?? k}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Weight (higher = shown more)</label>
            <input type="number" min="1.1" max="10" step="0.5" value={weightMultiplier} onChange={(e) => setWeightMultiplier(Number(e.target.value))} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Start *</label>
            <input required type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">End *</label>
            <input required type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">Note (optional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full px-3 py-2 border border-neutral-200 dark:border-neutral-700 rounded-lg text-sm bg-white dark:bg-neutral-800" placeholder="e.g. Wiki launch week" />
        </div>
        <button type="submit" disabled={creating} className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {creating ? "Scheduling…" : "Schedule Boost"}
        </button>
      </form>

      {loading ? (
        <div className="text-center py-12 text-neutral-500">Loading…</div>
      ) : boosts.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-neutral-200 dark:border-neutral-700 rounded-xl text-neutral-500">
          No boosts scheduled — quests are picked with no bias across enabled features.
        </div>
      ) : (
        <div className="space-y-2">
          {boosts.map((b) => (
            <div key={b.id} className="p-3 border border-neutral-200 dark:border-neutral-700 rounded-xl bg-white dark:bg-neutral-900 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-neutral-900 dark:text-white">{FEATURE_LABELS[b.feature_key] ?? b.feature_key}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${isActive(b) ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500"}`}>
                    {isActive(b) ? "Active" : new Date(b.starts_at) > new Date() ? "Upcoming" : "Ended"}
                  </span>
                  <span className="text-xs text-neutral-500">×{b.weight_multiplier}</span>
                </div>
                <p className="text-xs text-neutral-500 mt-0.5">{formatDate(b.starts_at)} → {formatDate(b.ends_at)}{b.note ? ` · ${b.note}` : ""}</p>
              </div>
              <button onClick={() => handleDelete(b.id)} className="px-3 py-1 rounded-lg bg-red-100 text-red-700 text-xs font-semibold hover:bg-red-200">
                End now
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
