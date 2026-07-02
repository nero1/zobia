/**
 * apps/android/src/routes/elder.tsx
 *
 * Elder system — mirrors apps/web/app/(app)/elder/page.tsx (GET /api/elder).
 * Three states driven entirely by the response's isElder/isEligible flags:
 *  - isElder: dashboard with mentees list + mentorship XP
 *    (DELETE /api/elder/mentees/:userId to remove)
 *  - isEligible (and not Elder): eligibility/application info
 *  - neither: informational page + "Request a Mentor" button
 *    (POST /api/elder/request)
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface Mentee {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji?: string;
  rankName: string;
  xpEarned: number;
  joinedAt: string;
  status: 'active' | 'pending' | 'inactive';
}

interface ElderData {
  isElder: boolean;
  isEligible: boolean;
  eligibilityReason?: string;
  prestigeLevel?: number;
  lastActiveAt?: string;
  mentees?: Mentee[];
  mentorshipXpEarned?: number;
  maxMentees?: number;
  hasMentor?: boolean;
  canRequestMentor?: boolean;
  rankName?: string;
}

async function fetchElder(): Promise<ElderData> {
  const { data } = await apiClient.get<ElderData>('/elder');
  return data;
}

async function removeMentee(userId: string) {
  await apiClient.delete(`/elder/mentees/${userId}`);
}

async function requestMentor() {
  await apiClient.post('/elder/request');
}

function ElderDashboard({ data, onRemove, removing }: { data: ElderData; onRemove: (id: string) => void; removing: string | null }) {
  const { t } = useTranslation();
  const mentees = data.mentees ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('elder.dashboard.menteesLabel')}</p>
          <p className="mt-1 text-2xl font-bold text-neutral-900">{mentees.length} / {data.maxMentees ?? 5}</p>
        </div>
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t('elder.dashboard.mentorshipXpLabel')}</p>
          <p className="mt-1 text-2xl font-bold text-neutral-900">{(data.mentorshipXpEarned ?? 0).toLocaleString()}</p>
        </div>
        <div className="col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-600">{t('elder.dashboard.statusLabel')}</p>
          <p className="mt-1 text-sm font-bold text-amber-700">{t('elder.dashboard.statusValue')}</p>
          <p className="text-xs text-amber-600">{t('elder.dashboard.prestige', { level: data.prestigeLevel ?? 0 })}</p>
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700">{t('elder.dashboard.yourMentees')}</h2>
        </div>
        {mentees.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-neutral-500">{t('elder.dashboard.noMentees')}</div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {mentees.map((m) => (
              <div key={m.userId} className="flex items-center gap-3 px-4 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl">
                  {m.avatarEmoji ?? '👤'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link to="/profile/$username" params={{ username: m.username }} className="text-sm font-semibold text-neutral-900">
                      {m.displayName}
                    </Link>
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${
                        m.status === 'active'
                          ? 'bg-teal-100 text-teal-700'
                          : m.status === 'pending'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-neutral-100 text-neutral-600'
                      }`}
                    >
                      {m.status}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500">
                    @{m.username} · {m.rankName} · {t('elder.dashboard.xpEarned', { xp: m.xpEarned.toLocaleString() })}
                  </p>
                </div>
                <button
                  onClick={() => onRemove(m.userId)}
                  disabled={removing === m.userId}
                  className="shrink-0 rounded-lg border border-danger-300 px-2.5 py-1 text-xs font-semibold text-danger-600 disabled:opacity-50"
                >
                  {removing === m.userId ? '…' : t('elder.dashboard.remove')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EligibilityView({ data }: { data: ElderData }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
        <h2 className="text-lg font-bold text-amber-700">{t('elder.eligibility.title')}</h2>
        <p className="mt-2 text-sm text-amber-600">{t('elder.eligibility.body')}</p>
        {data.eligibilityReason && <p className="mt-2 text-xs text-amber-500">{data.eligibilityReason}</p>}
      </div>
      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-neutral-700">{t('elder.eligibility.requirements')}</h3>
        <ul className="space-y-2 text-sm text-neutral-600">
          <li className="flex items-center gap-2">
            <span className={data.prestigeLevel && data.prestigeLevel >= 3 ? 'text-teal-500' : 'text-neutral-400'}>
              {data.prestigeLevel && data.prestigeLevel >= 3 ? '✓' : '○'}
            </span>
            {t('elder.eligibility.prestige', { level: data.prestigeLevel ?? 0 })}
          </li>
          <li className="flex items-center gap-2">
            <span className="text-teal-500">✓</span>
            {t('elder.eligibility.active')}
          </li>
        </ul>
      </div>
    </div>
  );
}

function NonEligibleView({ data, onRequest, requesting, requested }: { data: ElderData; onRequest: () => void; requesting: boolean; requested: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="text-lg font-bold text-neutral-900">{t('elder.nonEligible.title')}</h2>
        <p className="mt-2 text-sm text-neutral-600">{t('elder.nonEligible.body')}</p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-neutral-700">{t('elder.nonEligible.howToTitle')}</h3>
        <ul className="space-y-2 text-sm text-neutral-600">
          <li className="flex items-center gap-2">
            <span className="text-neutral-400">○</span>
            {t('elder.nonEligible.step1')}
          </li>
          <li className="flex items-center gap-2">
            <span className="text-neutral-400">○</span>
            {t('elder.nonEligible.step2')}
          </li>
        </ul>
      </div>

      {(data.canRequestMentor || data.hasMentor === false) && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
          <h3 className="mb-2 text-sm font-semibold text-blue-700">{t('elder.nonEligible.wantMentor')}</h3>
          <p className="mb-4 text-xs text-blue-600">{t('elder.nonEligible.wantMentorBody')}</p>
          {requested ? (
            <p className="text-sm font-semibold text-teal-600">{t('elder.nonEligible.requestSent')}</p>
          ) : (
            <button
              onClick={onRequest}
              disabled={requesting}
              className="rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {requesting ? t('elder.nonEligible.requesting') : t('elder.nonEligible.requestButton')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ElderPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [removing, setRemoving] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  const { data, status, refetch } = useQuery({ queryKey: ['elder'], queryFn: fetchElder, staleTime: 30_000 });

  const removeMutation = useMutation({
    mutationFn: removeMentee,
    onMutate: (userId) => setRemoving(userId),
    onSettled: () => setRemoving(null),
    onSuccess: (_data, userId) => {
      qc.setQueryData<ElderData | undefined>(['elder'], (prev) =>
        prev ? { ...prev, mentees: prev.mentees?.filter((m) => m.userId !== userId) } : prev
      );
    },
  });

  const requestMutation = useMutation({
    mutationFn: requestMentor,
    onSuccess: () => setRequested(true),
  });

  if (status === 'pending') {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-6 animate-pulse space-y-4">
        <div className="h-8 w-40 bg-neutral-200 rounded" />
        <div className="h-32 bg-neutral-200 rounded-xl" />
        <div className="h-48 bg-neutral-200 rounded-xl" />
      </div>
    );
  }

  if (status === 'error' || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
        <button onClick={() => refetch()} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">
          {t('android.error.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-6">
      <h1 className="text-xl font-bold text-neutral-900 mb-4">{t('elder.title')}</h1>

      {data.isElder ? (
        <ElderDashboard data={data} onRemove={(id) => removeMutation.mutate(id)} removing={removing} />
      ) : data.isEligible ? (
        <EligibilityView data={data} />
      ) : (
        <NonEligibleView
          data={data}
          onRequest={() => requestMutation.mutate()}
          requesting={requestMutation.isPending}
          requested={requested}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/elder')({
  component: ElderPage,
});
