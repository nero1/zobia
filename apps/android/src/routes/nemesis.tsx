/**
 * apps/android/src/routes/nemesis.tsx
 *
 * Nemesis — mirrors apps/web/app/(app)/nemesis/page.tsx. GET /api/nemesis
 * returns a flat (not {success,data,error}-wrapped) payload; POST
 * /api/nemesis/challenge starts a 7-day XP sprint. Both endpoints already
 * matched their web caller's expectations — no contract bugs found here.
 */

import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface NemesisParty {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  xp: number;
}

interface NemesisData {
  nemesis: NemesisParty | null;
  me: NemesisParty | null;
  sprintActive?: boolean;
  sprintEndsAt?: string | null;
  comparison?: { userXP: number; nemesisXP: number; delta: number; userIsAhead: boolean } | null;
  recentActivity?: Array<{ id: string; userId: string; description: string; xpEarned: number; createdAt: string }>;
}

function formatTimeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'Soon';
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function nextSundayIso(): string {
  const now = new Date();
  const day = now.getDay();
  const daysUntilSunday = day === 0 ? 7 : 7 - day;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntilSunday);
  next.setHours(0, 0, 0, 0);
  return next.toISOString();
}

async function fetchNemesis(): Promise<NemesisData> {
  const { data } = await apiClient.get<NemesisData & { data?: NemesisData }>('/nemesis');
  return data.data ?? data;
}

async function sendChallenge() {
  await apiClient.post('/nemesis/challenge');
}

function NemesisCard({ data, onChallenge, challenging }: { data: NemesisData; onChallenge: () => void; challenging: boolean }) {
  const { t } = useTranslation();
  const { nemesis, me, comparison } = data;

  if (!nemesis || !me) {
    return (
      <div className="bg-white border border-neutral-200 rounded-2xl p-6 text-center">
        <div className="text-4xl mb-3">👻</div>
        <h3 className="font-bold text-neutral-700 mb-1">{t('nemesis.noNemesis')}</h3>
        <p className="text-sm text-neutral-500">{t('nemesis.noNemesisDesc')}</p>
      </div>
    );
  }

  const myXP = comparison?.userXP ?? me.xp;
  const rivalXP = comparison?.nemesisXP ?? nemesis.xp;
  const delta = comparison?.delta ?? myXP - rivalXP;
  const isLeading = delta >= 0;

  return (
    <div className="bg-white border border-neutral-200 rounded-2xl overflow-hidden">
      <div className="bg-primary-600 p-1" />
      <div className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col items-center flex-1">
            <span className="text-4xl">{me.avatarEmoji}</span>
            <span className="font-bold text-sm mt-1 text-neutral-900 truncate max-w-full">{me.displayName}</span>
            <span className="text-sm font-bold text-primary-600 mt-1">{myXP.toLocaleString()} XP</span>
          </div>

          <div className="flex flex-col items-center">
            <span className="text-xl font-black text-neutral-400">VS</span>
            <span className={`text-xs font-bold mt-1 ${isLeading ? 'text-success-600' : 'text-danger-600'}`}>
              {isLeading ? t('nemesis.youLead', { amount: Math.abs(delta).toLocaleString() }) : t('nemesis.behind', { amount: Math.abs(delta).toLocaleString() })}
            </span>
          </div>

          <div className="flex flex-col items-center flex-1">
            <span className="text-4xl">{nemesis.avatarEmoji}</span>
            <span className="font-bold text-sm mt-1 text-neutral-900 truncate max-w-full">{nemesis.displayName}</span>
            <span className="text-sm font-bold text-danger-500 mt-1">{rivalXP.toLocaleString()} XP</span>
          </div>
        </div>

        {(data.recentActivity ?? []).length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-2">Recent Activity</div>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {(data.recentActivity ?? []).slice(0, 6).map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${a.userId === me.userId ? 'bg-primary-500' : 'bg-danger-500'}`} />
                  <span className="flex-1 text-neutral-600 truncate capitalize">{a.description}</span>
                  <span className="font-semibold text-neutral-700">+{a.xpEarned} XP</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <Link
            to="/profile/$username"
            params={{ username: nemesis.username }}
            className="flex-1 text-center py-2 px-4 bg-neutral-100 text-neutral-700 rounded-lg text-sm font-semibold"
          >
            {t('nemesis.viewProfile')}
          </Link>
          <button
            onClick={onChallenge}
            disabled={!!data.sprintActive || challenging}
            className="flex-1 py-2 px-4 bg-primary-600 text-white rounded-lg text-sm font-semibold disabled:opacity-60"
          >
            {challenging ? '…' : data.sprintActive ? t('nemesis.sprintStandings') : `${t('nemesis.challenge')} 🔥`}
          </button>
        </div>
      </div>
    </div>
  );
}

function NemesisSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-48 bg-neutral-100 rounded-2xl" />
      <div className="h-32 bg-neutral-100 rounded-2xl" />
    </div>
  );
}

function NemesisPage() {
  const { t } = useTranslation();
  const [timeLeft, setTimeLeft] = useState('');

  const { data, status, refetch } = useQuery({ queryKey: ['nemesis'], queryFn: fetchNemesis });
  const challengeMutation = useMutation({
    mutationFn: sendChallenge,
    onSuccess: () => refetch(),
  });

  useEffect(() => {
    const nextRefreshAt = nextSundayIso();
    const tick = () => setTimeLeft(formatTimeUntil(nextRefreshAt));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-neutral-900">{t('nemesis.title')}</h1>
        <p className="text-sm text-neutral-500 mt-1">{t('nemesis.subtitle')}</p>
      </div>

      {timeLeft && (
        <div className="flex items-center gap-2 mb-4 text-xs text-neutral-400">
          <span>🔄</span>
          <span>
            {t('nemesis.nextRefresh')} <strong className="text-neutral-600">{timeLeft}</strong>
          </span>
        </div>
      )}

      {status === 'pending' ? (
        <NemesisSkeleton />
      ) : status === 'error' ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-neutral-500">{t('error.generic')}</p>
          <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold">
            {t('nemesis.retry')}
          </button>
        </div>
      ) : (
        <NemesisCard data={data!} onChallenge={() => challengeMutation.mutate()} challenging={challengeMutation.isPending} />
      )}

      <div className="mt-6 bg-neutral-100 rounded-xl p-4">
        <h3 className="text-sm font-bold text-neutral-700 mb-2">{t('nemesis.howItWorks')}</h3>
        <ul className="space-y-1 text-xs text-neutral-500">
          <li>• {t('nemesis.rule1')}</li>
          <li>• {t('nemesis.rule2')}</li>
          <li>• {t('nemesis.rule3')}</li>
          <li>• {t('nemesis.rule4')}</li>
        </ul>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/nemesis')({
  component: NemesisPage,
});
