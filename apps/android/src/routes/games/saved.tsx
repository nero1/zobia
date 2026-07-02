/**
 * apps/android/src/routes/games/saved.tsx
 *
 * Saved Games — mirrors apps/web app/(app)/games/saved/page.tsx. Slot count
 * is plan-gated (GET /api/games/saves returns { saves, limit, count }).
 *
 * The Android app doesn't host gameplay in-app yet (the game detail page's
 * Play button isn't wired to an engine — games run on web/PWA), so "Resume"
 * opens the web play page in the in-app browser (same Browser.open pattern
 * used for OAuth) rather than trying to resume an engine that isn't here.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Browser } from '@capacitor/browser';
import { apiClient } from '@/lib/api/client';
import { universalLink } from '@/lib/deeplinks/routes';

interface GameSave {
  id: string;
  game_id: string;
  game_slug: string;
  game_name: string;
  cover_emoji: string;
  label: string | null;
  score: number;
  updated_at: string;
}

interface SavesResponse {
  saves: GameSave[];
  limit: number;
  count: number;
}

async function fetchSaves() {
  const { data } = await apiClient.get<SavesResponse>('/games/saves');
  return data;
}

function SavedGamesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<'selected' | 'oldest' | null>(null);

  const { data, status } = useQuery({
    queryKey: ['games', 'saves'],
    queryFn: fetchSaves,
  });

  const deleteOne = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/games/saves/${id}`),
    onSuccess: (_r, id) => {
      qc.setQueryData<SavesResponse | undefined>(['games', 'saves'], (prev) =>
        prev ? { ...prev, saves: prev.saves.filter((s) => s.id !== id) } : prev
      );
    },
  });

  const reconcile = useMutation({
    mutationFn: (deleteIds?: string[]) =>
      apiClient.post<{ deletedIds: string[] }>('/games/saves/reconcile', deleteIds ? { deleteIds } : {}),
    onSuccess: (res) => {
      const deletedIds = new Set(res.data.deletedIds);
      qc.setQueryData<SavesResponse | undefined>(['games', 'saves'], (prev) =>
        prev ? { ...prev, saves: prev.saves.filter((s) => !deletedIds.has(s.id)) } : prev
      );
      setSelected(new Set());
      setConfirming(null);
    },
  });

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const saves = data?.saves ?? [];
  const limit = data?.limit ?? 0;
  const over = Math.max(0, saves.length - limit);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-neutral-900">{t('games.savedGames.title', 'Saved Games')}</h1>
        <Link to="/games" className="text-sm text-primary-600">
          ← {t('games.title', 'Games')}
        </Link>
      </div>

      {status === 'pending' && (
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-white" />
          ))}
        </div>
      )}

      {status === 'success' && limit === 0 && (
        <div className="mb-4 rounded-xl bg-white p-4 text-sm text-neutral-500">
          {t('games.savedGames.noSlots', "Your plan doesn't include save slots. Upgrade to Plus, Pro, or Max to save in-progress games.")}
        </div>
      )}

      {status === 'success' && limit > 0 && (
        <p className="mb-3 text-xs text-neutral-400">
          {t('games.savedGames.slotsUsed', '{{count}} of {{limit}} slots used', { count: saves.length, limit })}
        </p>
      )}

      {over > 0 && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 flex flex-col gap-3">
          <h2 className="text-sm font-bold text-amber-700">{t('games.savedGames.overageTitle', 'You have more saves than your plan allows')}</h2>
          <p className="text-xs text-amber-800">
            {t('games.savedGames.overageDescription', "Your plan allows {{limit}} save slot(s), but you have {{count}}. Select which to delete, or we'll remove the oldest {{over}} automatically.", { limit, count: saves.length, over })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => setConfirming('selected')}
              className="rounded-lg border border-amber-400 px-3 py-1.5 text-xs font-semibold text-amber-700 disabled:opacity-40"
            >
              {t('games.savedGames.selectToDelete', 'Select saves to delete')} ({selected.size})
            </button>
            <button
              type="button"
              onClick={() => setConfirming('oldest')}
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              {t('games.savedGames.deleteOldest', 'Delete oldest automatically')}
            </button>
          </div>
        </div>
      )}

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl flex flex-col gap-4">
            <p className="text-base font-bold text-neutral-900">{t('games.savedGames.proceed', 'Proceed?')}</p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                disabled={reconcile.isPending}
                className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60"
              >
                {t('games.savedGames.proceedCancel', 'No, cancel')}
              </button>
              <button
                type="button"
                onClick={() => reconcile.mutate(confirming === 'selected' ? Array.from(selected) : undefined)}
                disabled={reconcile.isPending}
                className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {t('games.savedGames.proceedConfirm', 'Yes, delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {status === 'success' && saves.length === 0 && (
        <p className="py-10 text-center text-sm text-neutral-500">
          {t('games.savedGames.empty', 'No saved games yet. Pause a game and choose "Save & Quit" to save your progress here.')}
        </p>
      )}

      {saves.length > 0 && (
        <div className="flex flex-col gap-2">
          {saves.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-card">
              {over > 0 && (
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggleSelect(s.id)}
                  className="h-4 w-4"
                />
              )}
              <span className="text-2xl">{s.cover_emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-neutral-900">{s.label ?? s.game_name}</p>
                <p className="text-xs text-neutral-400">
                  {t('games.score', 'Score')}: {s.score} · {new Date(s.updated_at).toLocaleDateString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => Browser.open({ url: universalLink(`/g/${s.game_slug}/play`) })}
                className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white"
              >
                {t('games.savedGames.resume', 'Resume')}
              </button>
              <button
                type="button"
                onClick={() => deleteOne.mutate(s.id)}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-600"
              >
                {t('games.savedGames.delete', 'Delete')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/games/saved')({
  component: SavedGamesPage,
});
