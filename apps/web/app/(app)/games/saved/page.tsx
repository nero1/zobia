"use client";

/**
 * app/(app)/games/saved/page.tsx
 *
 * Saved Games — manage save slots (pause an in-progress game, resume it
 * later from here or from the game's own pregame screen). Slot count is
 * plan-gated (Free 0 / Plus 1 / Pro 3 / Max 5 by default, admin-configurable
 * at /admin/config). If a downgrade drops the limit below the current save
 * count, this page surfaces the overage and lets the user pick which saves
 * to delete — or confirm auto-deleting the oldest ones.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

interface GameSave {
  id: string;
  game_id: string;
  game_slug: string;
  game_name: string;
  cover_emoji: string;
  label: string | null;
  score: number;
  created_at: string;
  updated_at: string;
}

export default function SavedGamesPage() {
  const { t } = useTranslation();
  const [saves, setSaves] = useState<GameSave[]>([]);
  const [limit, setLimit] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<"selected" | "oldest" | null>(null);
  const [reconciling, setReconciling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/games/saves", { credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load saved games.");
      setSaves(json.data.saves ?? []);
      setLimit(json.data.limit ?? 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleDelete(id: string) {
    if (!confirm(t("games.savedGames.deleteConfirm", "Delete this saved game? This can't be undone."))) return;
    try {
      const res = await fetch(`/api/games/saves/${id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) setSaves((prev) => prev.filter((s) => s.id !== id));
    } catch { /* ignore */ }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function reconcile(deleteIds?: string[]) {
    setReconciling(true);
    try {
      const res = await fetch("/api/games/saves/reconcile", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deleteIds ? { deleteIds } : {}),
      });
      const json = await res.json();
      if (res.ok) {
        const deletedIds = new Set<string>(json.data?.deletedIds ?? []);
        setSaves((prev) => prev.filter((s) => !deletedIds.has(s.id)));
        setSelected(new Set());
      }
    } catch { /* ignore */ } finally {
      setReconciling(false);
      setConfirming(null);
    }
  }

  const over = Math.max(0, saves.length - limit);

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="animate-pulse space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-card" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">{t("games.savedGames.title", "Saved Games")}</h1>
        <Link href="/games" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← {t("games.title", "Games")}
        </Link>
      </div>

      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      {limit > 0 && (
        <p className="mb-4 text-xs text-muted-foreground">
          {t("games.savedGames.slotsUsed", "{{count}} of {{limit}} slots used", { count: saves.length, limit })}
        </p>
      )}

      {limit === 0 && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
          {t("games.savedGames.noSlots", "Your plan doesn't include save slots. Upgrade to Plus, Pro, or Max to save in-progress games.")}
        </div>
      )}

      {/* Overage — plan downgrade dropped the limit below the current save count */}
      {over > 0 && (
        <div className="mb-5 rounded-xl border border-amber-600 bg-amber-950/20 p-4 flex flex-col gap-3">
          <h2 className="text-sm font-bold text-amber-400">{t("games.savedGames.overageTitle", "You have more saves than your plan allows")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("games.savedGames.overageDescription", "Your plan allows {{limit}} save slot(s), but you have {{count}}. Select which to delete, or we'll remove the oldest {{over}} automatically.", { limit, count: saves.length, over })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => setConfirming("selected")}
              className="rounded-lg border border-amber-600 px-3 py-1.5 text-xs font-semibold text-amber-400 hover:bg-amber-950/40 disabled:opacity-40"
            >
              {t("games.savedGames.selectToDelete", "Select saves to delete")} ({selected.size})
            </button>
            <button
              type="button"
              onClick={() => setConfirming("oldest")}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            >
              {t("games.savedGames.deleteOldest", "Delete oldest automatically")}
            </button>
          </div>
        </div>
      )}

      {/* Confirm dialog */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl flex flex-col gap-4">
            <p className="text-base font-bold text-foreground">{t("games.savedGames.proceed", "Proceed?")}</p>
            <p className="text-sm text-muted-foreground">
              {confirming === "selected"
                ? t("games.savedGames.overageDescription", "Your plan allows {{limit}} save slot(s), but you have {{count}}. Select which to delete, or we'll remove the oldest {{over}} automatically.", { limit, count: saves.length, over })
                : t("games.savedGames.deleteOldest", "Delete oldest automatically")}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                disabled={reconciling}
                className="flex-1 rounded-xl border border-border py-2.5 text-sm font-semibold text-foreground hover:bg-accent disabled:opacity-60"
              >
                {t("games.savedGames.proceedCancel", "No, cancel")}
              </button>
              <button
                type="button"
                onClick={() => void reconcile(confirming === "selected" ? Array.from(selected) : undefined)}
                disabled={reconciling}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {t("games.savedGames.proceedConfirm", "Yes, delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {saves.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {t("games.savedGames.empty", "No saved games yet. Pause a game and choose \"Save & Quit\" to save your progress here.")}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {saves.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              {over > 0 && (
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggleSelect(s.id)}
                  className="h-4 w-4 rounded border-border"
                />
              )}
              <span className="text-2xl">{s.cover_emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{s.label ?? s.game_name}</p>
                <p className="text-xs text-muted-foreground">
                  {t("games.score", "Score")}: {s.score} · {new Date(s.updated_at).toLocaleDateString()}
                </p>
              </div>
              <Link
                href={`/g/${s.game_slug}/play`}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
              >
                {t("games.savedGames.resume", "Resume")}
              </Link>
              <button
                type="button"
                onClick={() => void handleDelete(s.id)}
                className="rounded-lg border border-red-600 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-950/30"
              >
                {t("games.savedGames.delete", "Delete")}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
