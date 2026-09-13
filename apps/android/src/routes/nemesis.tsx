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
import { useAuth } from '@/lib/auth/store';
import { useFeatureFlags, useFeatureModVisibility, resolveFeatureAccess } from '@/lib/hooks/useManifest';
import { FeatureNotFound } from '@/components/shared/FeatureNotFound';

interface NemesisParty {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  xp: number;
}

interface IncomingChallenge {
  challengeId: string;
  challengerId: string;
  challengerUsername: string;
  challengerDisplayName: string;
  challengerAvatarEmoji: string;
}

interface NemesisData {
  nemesis: NemesisParty | null;
  me: NemesisParty | null;
  optedOut?: boolean;
  sprintActive?: boolean;
  sprintEndsAt?: string | null;
  incomingChallenge?: IncomingChallenge | null;
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

async function acceptChallenge(challengeId: string) {
  await apiClient.post(`/nemesis/challenge/${challengeId}/accept`);
}

function NemesisCard({ data, onChallenge, challenging }: { data: NemesisData; onChallenge: () => void; challenging: boolean }) {
  const { t } = useTranslation();
  const { nemesis, me, comparison, optedOut } = data;

  if (optedOut) {
    return (
      <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-6 text-center">
        <div className="text-4xl mb-3">🔕</div>
        <h3 className="font-bold text-neutral-700 dark:text-neutral-300 mb-1">Nemesis System Off</h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">You&apos;ve turned off Nemesis rivals. Re-enable it anytime in Settings → Privacy.</p>
      </div>
    );
  }

  if (!nemesis || !me) {
    return (
      <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-6 text-center">
        <div className="text-4xl mb-3">👻</div>
        <h3 className="font-bold text-neutral-700 dark:text-neutral-300 mb-1">{t('nemesis.noNemesis')}</h3>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{t('nemesis.noNemesisDesc')}</p>
      </div>
    );
  }

  const myXP = comparison?.userXP ?? me.xp;
  const rivalXP = comparison?.nemesisXP ?? nemesis.xp;
  const delta = comparison?.delta ?? myXP - rivalXP;
  const isLeading = delta >= 0;

  return (
    <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-2xl overflow-hidden">
      <div className="bg-primary-600 p-1" />
      <div className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col items-center flex-1">
            <span className="text-4xl">{me.avatarEmoji}</span>
            <span className="font-bold text-sm mt-1 text-neutral-900 dark:text-neutral-100 truncate max-w-full">{me.displayName}</span>
            <span className="text-sm font-bold text-primary-600 dark:text-primary-300 mt-1">{myXP.toLocaleString()} XP</span>
          </div>

          <div className="flex flex-col items-center">
            <span className="text-xl font-black text-neutral-400 dark:text-neutral-500">VS</span>
            <span className={`text-xs font-bold mt-1 ${isLeading ? 'text-success-600 dark:text-success-300' : 'text-danger-600 dark:text-danger-300'}`}>
              {isLeading ? t('nemesis.youLead', { amount: Math.abs(delta).toLocaleString() }) : t('nemesis.behind', { amount: Math.abs(delta).toLocaleString() })}
            </span>
          </div>

          <div className="flex flex-col items-center flex-1">
            <span className="text-4xl">{nemesis.avatarEmoji}</span>
            <span className="font-bold text-sm mt-1 text-neutral-900 dark:text-neutral-100 truncate max-w-full">{nemesis.displayName}</span>
            <span className="text-sm font-bold text-danger-500 mt-1">{rivalXP.toLocaleString()} XP</span>
          </div>
        </div>

        {(data.recentActivity ?? []).length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wider mb-2">Recent Activity</div>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {(data.recentActivity ?? []).slice(0, 6).map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${a.userId === me.userId ? 'bg-primary-500' : 'bg-danger-500'}`} />
                  <span className="flex-1 text-neutral-600 dark:text-neutral-400 truncate capitalize">{a.description}</span>
                  <span className="font-semibold text-neutral-700 dark:text-neutral-300">+{a.xpEarned} XP</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <Link
            to="/profile/$username"
            params={{ username: nemesis.username }}
            className="flex-1 text-center py-2 px-4 bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded-lg text-sm font-semibold"
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
      <div className="h-48 bg-neutral-100 dark:bg-neutral-800 rounded-2xl" />
      <div className="h-32 bg-neutral-100 dark:bg-neutral-800 rounded-2xl" />
    </div>
  );
}

function NemesisPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const featureFlags = useFeatureFlags();
  const modVisibleKeys = useFeatureModVisibility();
  const access = resolveFeatureAccess(
    featureFlags?.nemesisSystem !== false,
    modVisibleKeys.includes('nemesisSystem'),
    { isAdmin: user?.is_admin, isModerator: user?.is_moderator }
  );
  const [timeLeft, setTimeLeft] = useState('');

  const { data, status, refetch } = useQuery({ queryKey: ['nemesis'], queryFn: fetchNemesis, enabled: access.accessible });
  const challengeMutation = useMutation({
    mutationFn: sendChallenge,
    onSuccess: () => refetch(),
  });
  const acceptMutation = useMutation({
    mutationFn: acceptChallenge,
    onSuccess: () => refetch(),
  });

  useEffect(() => {
    const nextRefreshAt = nextSundayIso();
    const tick = () => setTimeLeft(formatTimeUntil(nextRefreshAt));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  if (!access.accessible) {
    return <FeatureNotFound />;
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 dark:bg-neutral-800 px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">{t('nemesis.title')}</h1>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-1">{t('nemesis.subtitle')}</p>
      </div>

      {timeLeft && (
        <div className="flex items-center gap-2 mb-4 text-xs text-neutral-400 dark:text-neutral-500">
          <span>🔄</span>
          <span>
            {t('nemesis.nextRefresh')} <strong className="text-neutral-600 dark:text-neutral-400">{timeLeft}</strong>
          </span>
        </div>
      )}

      {status === 'pending' ? (
        <NemesisSkeleton />
      ) : status === 'error' ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-neutral-500 dark:text-neutral-400">{t('error.generic')}</p>
          <button onClick={() => refetch()} className="mt-4 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-semibold">
            {t('nemesis.retry')}
          </button>
        </div>
      ) : (
        <>
          {data?.incomingChallenge && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 dark:bg-amber-900/30 p-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-2xl">{data.incomingChallenge.challengerAvatarEmoji}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-amber-900 truncate">
                    {data.incomingChallenge.challengerDisplayName} challenged you to an XP sprint!
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-300">Accept to start the 7-day sprint</p>
                </div>
              </div>
              <button
                onClick={() => acceptMutation.mutate(data.incomingChallenge!.challengeId)}
                disabled={acceptMutation.isPending}
                className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {acceptMutation.isPending ? '…' : 'Accept'}
              </button>
            </div>
          )}
          <NemesisCard data={data!} onChallenge={() => challengeMutation.mutate()} challenging={challengeMutation.isPending} />
        </>
      )}

      <div className="mt-6 bg-neutral-100 dark:bg-neutral-800 rounded-xl p-4">
        <h3 className="text-sm font-bold text-neutral-700 dark:text-neutral-300 mb-2">{t('nemesis.howItWorks')}</h3>
        <ul className="space-y-1 text-xs text-neutral-500 dark:text-neutral-400">
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
