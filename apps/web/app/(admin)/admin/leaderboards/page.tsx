"use client";

/**
 * app/(admin)/admin/leaderboards/page.tsx
 *
 * Leaderboard admin UI — PRD §20.
 * View current season top-50, search users, override/disqualify season XP.
 */

import { useState, useEffect, useCallback } from "react";

interface LeaderboardEntry {
  rank: number;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string | null;
  season_xp: number;
  prestige_count: number | null;
  is_suspended: boolean;
}

interface OverrideModal {
  userId: string;
  username: string;
  currentXp: number;
}

export default function AdminLeaderboardsPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [overrideModal, setOverrideModal] = useState<OverrideModal | null>(null);
  const [overrideXp, setOverrideXp] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideAction, setOverrideAction] = useState<"override" | "disqualify">("override");
  const [overrideSaving, setOverrideSaving] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/leaderboards?limit=50");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { data: { entries: LeaderboardEntry[] } };
      setEntries(data.data.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load leaderboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadLeaderboard(); }, [loadLeaderboard]);

  const filteredEntries = searchQuery
    ? entries.filter(
        (e) =>
          e.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (e.display_name ?? "").toLowerCase().includes(searchQuery.toLowerCase())
      )
    : entries;

  const openOverride = (entry: LeaderboardEntry) => {
    setOverrideModal({ userId: entry.user_id, username: entry.username, currentXp: entry.season_xp });
    setOverrideXp(String(entry.season_xp));
    setOverrideReason("");
    setOverrideAction("override");
    setOverrideError(null);
  };

  const handleSaveOverride = async () => {
    if (!overrideModal) return;
    if (!overrideReason.trim()) { setOverrideError("Reason is required"); return; }

    setOverrideSaving(true);
    setOverrideError(null);
    try {
      const res = await fetch(`/api/admin/leaderboards/${overrideModal.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          season_xp: parseInt(overrideXp, 10) || 0,
          reason: overrideReason.trim(),
          action: overrideAction,
        }),
      });
      const data = (await res.json()) as { success?: boolean; error?: { message?: string } };
      if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`);

      setOverrideModal(null);
      void loadLeaderboard();
    } catch (err) {
      setOverrideError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setOverrideSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">
            Season Leaderboard
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            View top 50 users by season XP. Override or disqualify for competition integrity.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadLeaderboard()}
          className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300"
        >
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className="max-w-sm">
        <input
          type="text"
          placeholder="Search by username…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm focus:border-amber-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
          <table className="w-full text-sm">
            <thead className="border-b border-neutral-200 dark:border-neutral-700">
              <tr className="text-left text-xs font-semibold text-neutral-500 uppercase tracking-wide">
                <th className="px-4 py-3 w-12">#</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3 text-right">Season XP</th>
                <th className="px-4 py-3 text-right">Prestige</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                    {searchQuery ? "No users match your search." : "No leaderboard data yet."}
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => (
                  <tr key={entry.user_id} className="hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors">
                    <td className="px-4 py-3 font-bold text-neutral-400">
                      {entry.rank <= 3 ? (
                        <span>{["🥇", "🥈", "🥉"][entry.rank - 1]}</span>
                      ) : (
                        <span>{entry.rank}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{entry.avatar_emoji ?? "👤"}</span>
                        <div>
                          <p className="font-medium text-neutral-900 dark:text-white">
                            {entry.display_name ?? entry.username}
                          </p>
                          <p className="text-xs text-neutral-500">@{entry.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-neutral-900 dark:text-white">
                      {entry.season_xp.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-neutral-500">
                      {entry.prestige_count ? `P${entry.prestige_count}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {entry.is_suspended ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/30 dark:text-red-400">
                          Suspended
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                          Active
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openOverride(entry)}
                        className="rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                      >
                        Override
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Override Modal */}
      {overrideModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setOverrideModal(null); }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-neutral-900">
            <h2 className="text-lg font-bold text-neutral-900 dark:text-white">
              Override @{overrideModal.username}
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Current season XP: {overrideModal.currentXp.toLocaleString()}
            </p>

            <div className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                  Action
                </label>
                <div className="flex gap-3">
                  {(["override", "disqualify"] as const).map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setOverrideAction(a)}
                      className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                        overrideAction === a
                          ? a === "disqualify"
                            ? "bg-red-500 text-white"
                            : "bg-amber-400 text-neutral-900"
                          : "border border-neutral-200 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"
                      }`}
                    >
                      {a === "override" ? "Set XP" : "Disqualify (0 XP)"}
                    </button>
                  ))}
                </div>
              </div>

              {overrideAction === "override" && (
                <div>
                  <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                    New Season XP
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={overrideXp}
                    onChange={(e) => setOverrideXp(e.target.value)}
                    className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm focus:border-amber-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-neutral-600 dark:text-neutral-400 mb-1">
                  Reason (required, logged to audit trail)
                </label>
                <textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Confirmed bot activity, XP exploit via…"
                  className="w-full resize-none rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm focus:border-amber-400 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
                />
              </div>

              {overrideError && (
                <p className="text-sm text-red-600">{overrideError}</p>
              )}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setOverrideModal(null)}
                className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={overrideSaving}
                onClick={() => void handleSaveOverride()}
                className={`flex-[2] rounded-xl py-2.5 text-sm font-bold transition-colors disabled:opacity-50 ${
                  overrideAction === "disqualify"
                    ? "bg-red-500 text-white hover:bg-red-600"
                    : "bg-amber-400 text-neutral-900 hover:bg-amber-500"
                }`}
              >
                {overrideSaving
                  ? "Saving…"
                  : overrideAction === "disqualify"
                  ? "Disqualify"
                  : "Save Override"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
