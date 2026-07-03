/**
 * apps/android/src/routes/admin/games.tsx
 *
 * Admin Games catalog management — mirrors apps/web/app/(admin)/admin/games/page.tsx:
 * list every game (active + inactive) with summary stats, create/edit a
 * game's cover page + rewards + play cost, activate/deactivate, delete, and
 * view per-game stats. This is catalog *management*, distinct from the
 * read-only user-facing /games page already in this app.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { GAME_CATEGORIES, type GameCategory } from '@zobia/shared/types';
import { KNOWN_ENGINE_KEYS } from '@zobia/shared/utils';
import {
  AdminCard,
  AdminCardSkeleton,
  AdminEmptyState,
  AdminErrorState,
  AdminToast,
  AdminBadge,
  AdminConfirmDialog,
  AdminField,
  adminInputClass,
  fmtNumber,
} from '@/components/admin/AdminUI';

interface GameRow {
  id: string;
  slug: string;
  name: string;
  category: GameCategory | null;
  engine_key: string | null;
  cover_emoji: string;
  cover_image_url: string | null;
  tagline: string | null;
  is_active: boolean;
  sort_order: number;
  reward_credits_per_win: number;
  reward_xp_per_win: number;
  reward_stars_per_win: number;
  play_cost_credits: number;
  play_cost_stars: number;
  max_score: number | null;
  min_play_seconds: number;
  play_count: number;
  players: number;
  total_wins: number;
  challenges: number;
}

interface GameStats {
  name: string;
  plays: { total_plays: number; counted_plays: number; unique_players: number; avg_score: number | null; max_score: number | null };
  winsRewarded: number;
  challenges: { total: number; completed: number; wager_volume: number };
}

type FormState = {
  id?: string;
  name: string;
  slug: string;
  category: GameCategory;
  engine_key: string;
  cover_emoji: string;
  cover_image_url: string;
  tagline: string;
  description: string;
  reward_credits_per_win: number;
  reward_xp_per_win: number;
  reward_stars_per_win: number;
  play_cost_credits: number;
  play_cost_stars: number;
  max_score: number | null;
  min_play_seconds: number;
  sort_order: number;
  is_active: boolean;
};

function emptyForm(): FormState {
  return {
    name: '',
    slug: '',
    category: 'Puzzle',
    engine_key: KNOWN_ENGINE_KEYS[0] ?? 'tetris',
    cover_emoji: '🎮',
    cover_image_url: '',
    tagline: '',
    description: '',
    reward_credits_per_win: 50,
    reward_xp_per_win: 40,
    reward_stars_per_win: 0,
    play_cost_credits: 0,
    play_cost_stars: 0,
    max_score: null,
    min_play_seconds: 5,
    sort_order: 0,
    is_active: true,
  };
}

function fromGame(g: GameRow): FormState {
  return {
    id: g.id,
    name: g.name,
    slug: g.slug,
    category: g.category ?? 'Puzzle',
    engine_key: g.engine_key ?? (KNOWN_ENGINE_KEYS[0] ?? 'tetris'),
    cover_emoji: g.cover_emoji,
    cover_image_url: g.cover_image_url ?? '',
    tagline: g.tagline ?? '',
    description: '',
    reward_credits_per_win: g.reward_credits_per_win,
    reward_xp_per_win: g.reward_xp_per_win,
    reward_stars_per_win: g.reward_stars_per_win,
    play_cost_credits: g.play_cost_credits,
    play_cost_stars: g.play_cost_stars,
    max_score: g.max_score,
    min_play_seconds: g.min_play_seconds,
    sort_order: g.sort_order,
    is_active: g.is_active,
  };
}

async function fetchGames(): Promise<GameRow[]> {
  const { data } = await apiClient.get<{ games: GameRow[] }>('/admin/games');
  return data?.games ?? [];
}

function GameFormModal({ initial, onSave, onClose, saving }: { initial: FormState; onSave: (form: FormState) => void; onClose: () => void; saving: boolean }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<FormState>(initial);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <h3 className="mb-4 text-base font-bold text-neutral-900">{form.id ? t('admin.games.editTitle', 'Edit Game') : t('admin.games.createTitle', 'New Game')}</h3>
        <div className="space-y-3">
          <AdminField label={t('admin.games.name', 'Name')}>
            <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className={adminInputClass} />
          </AdminField>
          <AdminField label={t('admin.games.slug', 'Slug (optional, auto from name)')}>
            <input type="text" value={form.slug} onChange={(e) => set('slug', e.target.value)} className={adminInputClass} />
          </AdminField>
          <div className="grid grid-cols-2 gap-3">
            <AdminField label={t('admin.games.category', 'Category')}>
              <select value={form.category} onChange={(e) => set('category', e.target.value as GameCategory)} className={adminInputClass}>
                {GAME_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </AdminField>
            <AdminField label={t('admin.games.engine', 'Engine')}>
              <select value={form.engine_key} onChange={(e) => set('engine_key', e.target.value)} className={adminInputClass}>
                {KNOWN_ENGINE_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </AdminField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <AdminField label={t('admin.games.emoji', 'Emoji')}>
              <input type="text" value={form.cover_emoji} onChange={(e) => set('cover_emoji', e.target.value)} className={adminInputClass} />
            </AdminField>
            <AdminField label={t('admin.games.coverImageUrl', 'Cover Image URL')}>
              <input type="text" value={form.cover_image_url} onChange={(e) => set('cover_image_url', e.target.value)} placeholder="https://…" className={adminInputClass} />
            </AdminField>
          </div>
          <AdminField label={t('admin.games.tagline', 'Tagline (listing)')}>
            <input type="text" value={form.tagline} onChange={(e) => set('tagline', e.target.value)} className={adminInputClass} />
          </AdminField>
          <AdminField label={t('admin.games.description', 'Short description')}>
            <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} className={`${adminInputClass} resize-none`} />
          </AdminField>
          <div className="grid grid-cols-3 gap-2">
            <AdminField label={t('admin.games.winCredits', 'Win credits')}>
              <input type="number" value={form.reward_credits_per_win} onChange={(e) => set('reward_credits_per_win', Number(e.target.value))} className={adminInputClass} />
            </AdminField>
            <AdminField label={t('admin.games.winXp', 'Win XP')}>
              <input type="number" value={form.reward_xp_per_win} onChange={(e) => set('reward_xp_per_win', Number(e.target.value))} className={adminInputClass} />
            </AdminField>
            <AdminField label={t('admin.games.winStars', 'Win stars')}>
              <input type="number" value={form.reward_stars_per_win} onChange={(e) => set('reward_stars_per_win', Number(e.target.value))} className={adminInputClass} />
            </AdminField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <AdminField label={t('admin.games.playCostCredits', 'Play cost (credits)')}>
              <input type="number" value={form.play_cost_credits} onChange={(e) => set('play_cost_credits', Number(e.target.value))} className={adminInputClass} />
            </AdminField>
            <AdminField label={t('admin.games.playCostStars', 'Play cost (stars)')}>
              <input type="number" value={form.play_cost_stars} onChange={(e) => set('play_cost_stars', Number(e.target.value))} className={adminInputClass} />
            </AdminField>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <AdminField label={t('admin.games.maxScore', 'Max score')}>
              <input
                type="number"
                value={form.max_score ?? ''}
                onChange={(e) => set('max_score', e.target.value === '' ? null : Number(e.target.value))}
                className={adminInputClass}
              />
            </AdminField>
            <AdminField label={t('admin.games.minPlaySecs', 'Min play secs')}>
              <input type="number" value={form.min_play_seconds} onChange={(e) => set('min_play_seconds', Number(e.target.value))} className={adminInputClass} />
            </AdminField>
            <AdminField label={t('admin.games.sortOrder', 'Sort order')}>
              <input type="number" value={form.sort_order} onChange={(e) => set('sort_order', Number(e.target.value))} className={adminInputClass} />
            </AdminField>
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
            {t('admin.events.active', 'Active')}
          </label>
        </div>
        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onClose} disabled={saving} className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onSave(form)}
            disabled={saving || !form.name.trim()}
            className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? '…' : t('admin.games.save', 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatsOverlay({ stats, onClose }: { stats: GameStats; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex-none flex items-center justify-between border-b border-neutral-200 px-4 py-3" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}>
        <h2 className="text-base font-semibold text-neutral-900">{stats.name} — {t('admin.games.stats', 'Stats')}</h2>
        <button onClick={onClose} aria-label={t('nav.closeMenu')} className="rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2.5 p-4">
        {[
          { label: t('admin.games.totalPlays', 'Total plays'), value: fmtNumber(stats.plays.total_plays) },
          { label: t('admin.games.countedPlays', 'Counted plays'), value: fmtNumber(stats.plays.counted_plays) },
          { label: t('admin.games.uniquePlayers', 'Unique players'), value: fmtNumber(stats.plays.unique_players) },
          { label: t('admin.games.avgScore', 'Avg score'), value: stats.plays.avg_score != null ? String(Math.round(stats.plays.avg_score)) : '—' },
          { label: t('admin.games.maxScoreAchieved', 'Max score achieved'), value: stats.plays.max_score != null ? fmtNumber(stats.plays.max_score) : '—' },
          { label: t('admin.games.winsRewarded', 'Wins rewarded'), value: fmtNumber(stats.winsRewarded) },
          { label: t('admin.games.challengesTotal', 'Challenges (total)'), value: fmtNumber(stats.challenges.total) },
          { label: t('admin.games.challengesCompleted', 'Challenges completed'), value: fmtNumber(stats.challenges.completed) },
          { label: t('admin.games.wagerVolume', 'Wager volume (credits)'), value: fmtNumber(stats.challenges.wager_volume) },
        ].map((s) => (
          <div key={s.label} className="flex items-center justify-between rounded-lg border border-neutral-200 p-3">
            <span className="text-sm text-neutral-600">{s.label}</span>
            <span className="text-sm font-semibold text-neutral-900">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminGamesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [editing, setEditing] = useState<FormState | null>(null);
  const [statsFor, setStatsFor] = useState<GameStats | null>(null);
  const [deleting, setDeleting] = useState<GameRow | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'games'], queryFn: fetchGames });

  const filtered = (data ?? []).filter((g) => {
    const matchesSearch = !search || g.name.toLowerCase().includes(search.toLowerCase()) || g.slug.includes(search.toLowerCase());
    const matchesCat = !categoryFilter || g.category === categoryFilter;
    return matchesSearch && matchesCat;
  });

  const saveMutation = useMutation({
    mutationFn: (form: FormState) => {
      const payload = {
        name: form.name,
        slug: form.slug || undefined,
        category: form.category,
        engineKey: form.engine_key,
        tagline: form.tagline || null,
        description: form.description || null,
        coverEmoji: form.cover_emoji,
        coverImageUrl: form.cover_image_url || null,
        rewardCreditsPerWin: form.reward_credits_per_win,
        rewardXpPerWin: form.reward_xp_per_win,
        rewardStarsPerWin: form.reward_stars_per_win,
        playCostCredits: form.play_cost_credits,
        playCostStars: form.play_cost_stars,
        maxScore: form.max_score,
        minPlaySeconds: form.min_play_seconds,
        sortOrder: form.sort_order,
        isActive: form.is_active,
      };
      return form.id ? apiClient.put(`/admin/games/${form.id}`, payload) : apiClient.post('/admin/games', payload);
    },
    onSuccess: () => {
      showToast(t('admin.games.saved', 'Game saved'));
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['admin', 'games'] });
    },
    onError: () => showToast(t('admin.games.saveFailed', 'Save failed'), 'error'),
  });

  const toggleMutation = useMutation({
    mutationFn: (g: GameRow) => apiClient.put(`/admin/games/${g.id}`, { isActive: !g.is_active }),
    onSuccess: () => {
      showToast(t('admin.events.updated', 'Game updated'));
      qc.invalidateQueries({ queryKey: ['admin', 'games'] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/admin/games/${id}`),
    onSuccess: () => {
      showToast(t('admin.games.deleted', 'Game deleted'));
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ['admin', 'games'] });
    },
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  const statsMutation = useMutation({
    mutationFn: async (g: GameRow) => (await apiClient.get<GameStats>(`/admin/games/${g.id}/stats`)).data,
    onSuccess: (data) => setStatsFor(data),
    onError: () => showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error'),
  });

  return (
    <div className="px-4 py-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-neutral-900">
          {t('admin.nav.games', 'Games')} <span className="text-sm font-normal text-neutral-500">({data?.length ?? 0})</span>
        </h1>
        <button type="button" onClick={() => setEditing(emptyForm())} className="rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white">
          + {t('admin.games.new', 'New')}
        </button>
      </div>

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      <div className="mb-4 flex gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.games.searchPlaceholder', 'Search games…')}
          className={`${adminInputClass} flex-1`}
        />
        <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={`${adminInputClass} w-32 shrink-0`}>
          <option value="">{t('admin.games.allCategories', 'All')}</option>
          {GAME_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="space-y-2.5">
        {status === 'pending' && Array.from({ length: 5 }).map((_, i) => <AdminCardSkeleton key={i} />)}
        {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}
        {status === 'success' && filtered.length === 0 && <AdminEmptyState icon="🎮" title={t('admin.games.noResults', 'No games match your search')} />}
        {status === 'success' &&
          filtered.map((g) => (
            <AdminCard key={g.id}>
              <div className="flex items-start gap-3">
                <span className="text-3xl">{g.cover_emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="font-semibold text-neutral-900 truncate">{g.name}</p>
                    <AdminBadge label={g.category ?? '—'} />
                    <AdminBadge label={g.is_active ? t('admin.events.active', 'Active') : t('admin.events.inactive', 'Inactive')} color={g.is_active ? 'green' : 'neutral'} />
                  </div>
                  <p className="text-xs text-neutral-500">/{g.slug}</p>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    {fmtNumber(g.play_count)} {t('admin.games.plays', 'plays')} · {fmtNumber(g.players)} {t('admin.games.players', 'players')} ·{' '}
                    {g.reward_credits_per_win}c/{g.reward_xp_per_win}xp{g.reward_stars_per_win ? `/${g.reward_stars_per_win}⭐` : ''}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button type="button" onClick={() => statsMutation.mutate(g)} className="rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                  {t('admin.games.stats', 'Stats')}
                </button>
                <button type="button" onClick={() => setEditing(fromGame(g))} className="rounded-lg bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-700">
                  {t('admin.games.edit', 'Edit')}
                </button>
                <button
                  type="button"
                  disabled={toggleMutation.isPending}
                  onClick={() => toggleMutation.mutate(g)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-50 ${g.is_active ? 'bg-gold-100 text-gold-800' : 'bg-success-100 text-success-700'}`}
                >
                  {g.is_active ? t('admin.events.deactivate', 'Deactivate') : t('admin.events.activate', 'Activate')}
                </button>
                <button type="button" onClick={() => setDeleting(g)} className="rounded-lg bg-danger-100 px-2.5 py-1 text-xs font-semibold text-danger-700">
                  {t('common.delete', 'Delete')}
                </button>
              </div>
            </AdminCard>
          ))}
      </div>

      {editing && <GameFormModal initial={editing} onSave={(form) => saveMutation.mutate(form)} onClose={() => setEditing(null)} saving={saveMutation.isPending} />}

      {statsFor && <StatsOverlay stats={statsFor} onClose={() => setStatsFor(null)} />}

      {deleting && (
        <AdminConfirmDialog
          title={t('admin.games.confirmDelete', 'Delete "{{name}}"?', { name: deleting.name })}
          description={t('admin.games.confirmDeleteDesc', 'It will disappear from the directory immediately.')}
          confirmLabel={t('common.delete', 'Delete')}
          cancelLabel={t('common.cancel')}
          danger
          pending={deleteMutation.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/games')({
  component: AdminGamesPage,
});
