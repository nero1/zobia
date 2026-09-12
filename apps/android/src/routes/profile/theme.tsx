/**
 * apps/android/src/routes/profile/theme.tsx
 *
 * Profile theme picker — mirrors apps/web/app/(app)/profile/theme/page.tsx:
 * equip a free/owned theme, or buy a locked one with Credits/Stars.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

interface ThemeTokens {
  bg: string;
  card: string;
  accent: string;
  text: string;
  muted: string;
}

interface ThemeOption {
  id: string;
  name: string;
  description: string | null;
  config: ThemeTokens;
  credits_cost: number | null;
  stars_cost: number | null;
  availability: 'free_default' | 'plan_included' | 'owned' | 'purchasable' | 'locked';
  isActive: boolean;
}

async function fetchThemes(): Promise<ThemeOption[]> {
  const { data } = await apiClient.get<{ data: { themes: ThemeOption[] } }>('/profile-themes');
  return data.data?.themes ?? [];
}

function ProfileThemePage() {
  const qc = useQueryClient();
  const { data: themes, status } = useQuery({ queryKey: ['profile-themes'], queryFn: fetchThemes });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  async function equip(theme: ThemeOption) {
    setBusyId(theme.id);
    try {
      await apiClient.post('/profile-themes/equip', {
        themeId: theme.id,
        currency: theme.availability === 'purchasable' ? 'credits' : undefined,
      });
      showToast(`${theme.name} equipped!`);
      await qc.invalidateQueries({ queryKey: ['profile-themes'] });
    } catch (e) {
      const err = e as { response?: { data?: { error?: { message?: string } } } };
      showToast(err.response?.data?.error?.message ?? 'Failed to equip theme', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 space-y-4 px-4 py-4">
      <div>
        <Link to="/settings" className="text-sm text-neutral-500">← Settings</Link>
        <h1 className="text-xl font-bold text-neutral-900">🎨 Profile Theme</h1>
        <p className="mt-1 text-sm text-neutral-500">Pick a color skin for your profile. More themes are sold on the Market.</p>
      </div>

      {toast && (
        <div className={`fixed bottom-6 left-4 right-4 z-50 rounded-xl px-4 py-3 text-center text-sm font-medium text-white shadow-lg ${toast.type === 'success' ? 'bg-teal-600' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}

      {status === 'pending' ? (
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-neutral-200" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {(themes ?? []).map((theme) => (
            <div
              key={theme.id}
              className="flex flex-col overflow-hidden rounded-2xl border"
              style={{ borderColor: theme.isActive ? theme.config.accent : 'transparent', backgroundColor: theme.config.card }}
            >
              <div className="h-16" style={{ background: `linear-gradient(135deg, ${theme.config.bg}, ${theme.config.accent})` }} />
              <div className="p-3">
                <p className="text-sm font-semibold" style={{ color: theme.config.text }}>{theme.name}</p>
                {theme.availability === 'purchasable' && theme.credits_cost && (
                  <p className="mt-1 text-xs" style={{ color: theme.config.muted }}>🪙 {theme.credits_cost.toLocaleString()}</p>
                )}
                <button
                  onClick={() => equip(theme)}
                  disabled={busyId === theme.id || theme.isActive || theme.availability === 'locked'}
                  className="mt-2 w-full rounded-lg py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  style={{ backgroundColor: theme.config.accent }}
                >
                  {theme.isActive ? 'Equipped' : theme.availability === 'purchasable' ? 'Buy & Equip' : theme.availability === 'locked' ? 'Locked' : 'Equip'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/profile/theme')({
  component: ProfileThemePage,
});
