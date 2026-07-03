/**
 * apps/android/src/routes/creator/broadcasts.tsx
 *
 * Creator broadcasts — mirrors apps/web/app/(app)/creator/broadcasts/
 * page.tsx: monthly allowance card, compose modal, and send history.
 * GET/POST /api/creator/broadcasts (plain JSON, no {success,data,error}
 * envelope — matches the actual route, verified against
 * apps/web/app/api/creator/broadcasts/route.ts).
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface BroadcastAllowance {
  tier: string;
  freeRemaining: number;
  freeTotal: number;
  additionalCoinCost: number;
  canSend: boolean;
  reason?: string;
}

interface Broadcast {
  id: string;
  subject: string;
  body: string;
  sentAt: string;
  recipientCount: number;
}

interface BroadcastsData {
  allowance: BroadcastAllowance;
  broadcasts: Broadcast[];
}

async function fetchBroadcasts(): Promise<BroadcastsData> {
  const { data } = await apiClient.get<BroadcastsData>('/creator/broadcasts');
  return data;
}

function ComposeModal({ allowance, onClose, onSend, sending }: {
  allowance: BroadcastAllowance;
  onClose: () => void;
  onSend: (subject: string, body: string) => void;
  sending: boolean;
}) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit() {
    setLocalError(null);
    if (!body.trim()) { setLocalError(t('creator.broadcasts.errorBodyRequired')); return; }
    if (body.length > 1000) { setLocalError(t('creator.broadcasts.errorBodyTooLong')); return; }
    onSend(subject.trim(), body.trim());
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed left-4 right-4 top-1/2 z-50 max-h-[85vh] -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-neutral-100 bg-white px-4 py-4">
          <h2 className="text-base font-semibold text-neutral-900">{t('creator.broadcasts.composeTitle')}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-neutral-500">✕</button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-xs text-neutral-600">
            {allowance.freeRemaining > 0
              ? t('creator.broadcasts.freeBannerPlural', { count: allowance.freeRemaining, tier: allowance.tier })
              : t('creator.broadcasts.noFreeLeft', { amount: allowance.additionalCoinCost.toLocaleString() })}
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-700">{t('creator.broadcasts.subjectLabel')}</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={200}
              placeholder={t('creator.broadcasts.subjectPlaceholder')}
              className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
            />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-xs font-semibold text-neutral-700">
              <span>{t('creator.broadcasts.bodyLabel')}</span>
              <span className={body.length > 950 ? 'text-red-500' : 'text-neutral-400'}>{t('creator.broadcasts.charCount', { current: body.length })}</span>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={1000}
              placeholder={t('creator.broadcasts.bodyPlaceholder')}
              className="w-full resize-none rounded-xl border border-neutral-300 px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none"
            />
          </div>
          {localError && <p className="text-xs text-red-600">{localError}</p>}
          <div className="flex gap-3">
            <button
              onClick={handleSubmit}
              disabled={sending || !allowance.canSend}
              className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {sending ? t('creator.broadcasts.sending') : allowance.freeRemaining > 0 ? t('creator.broadcasts.sendFree') : t('creator.broadcasts.sendPaid', { count: allowance.additionalCoinCost })}
            </button>
            <button onClick={onClose} className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-semibold text-neutral-700">
              {t('creator.broadcasts.cancel')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function CreatorBroadcastsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [composing, setComposing] = useState(false);

  const { data, status, error } = useQuery({ queryKey: ['creator', 'broadcasts'], queryFn: fetchBroadcasts, retry: false });

  const sendMutation = useMutation({
    mutationFn: async ({ subject, body }: { subject: string; body: string }) => {
      await apiClient.post('/creator/broadcasts', { subject, body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['creator', 'broadcasts'] });
      setComposing(false);
    },
  });

  if (status === 'pending') {
    return (
      <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4 space-y-3">
        <div className="h-24 animate-pulse rounded-xl bg-neutral-200" />
        <div className="h-48 animate-pulse rounded-xl bg-neutral-200" />
      </div>
    );
  }

  const accessDenied = status === 'error' && (error as { response?: { status?: number } })?.response?.status === 403;

  if (accessDenied) {
    return (
      <div className="flex flex-col items-center py-16 px-6 text-center">
        <span className="text-5xl">🔒</span>
        <h2 className="mt-4 text-xl font-bold text-neutral-900">{t('creator.broadcasts.accessDeniedTitle')}</h2>
        <p className="mt-2 text-sm text-neutral-600">{t('creator.broadcasts.accessDeniedDesc')}</p>
      </div>
    );
  }

  if (status === 'error' || !data) {
    return <div className="p-6 text-sm text-red-600">{t('creator.broadcasts.loadError')}</div>;
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 space-y-3 px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-neutral-900">{t('creator.broadcasts.title')}</h1>
        {data.allowance.canSend && (
          <button onClick={() => setComposing(true)} className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white">
            {t('creator.broadcasts.sendBtn')}
          </button>
        )}
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card">
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">{t('creator.broadcasts.monthlyAllowance')}</h2>
        <div className="flex items-center justify-between">
          <p className="text-sm text-neutral-600">
            <span className="text-xl font-bold text-neutral-900">{data.allowance.freeRemaining}</span>{' '}
            {t('creator.broadcasts.freeOfTotal', { remaining: data.allowance.freeRemaining, total: data.allowance.freeTotal })}
          </p>
          {!data.allowance.canSend && data.allowance.reason && (
            <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-600">{data.allowance.reason}</span>
          )}
        </div>
        <p className="mt-1 text-xs text-neutral-500">{t('creator.broadcasts.tierLabel', { tier: data.allowance.tier })}</p>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-card">
        <div className="border-b border-neutral-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-700">{t('creator.broadcasts.historyTitle')}</h2>
        </div>
        {data.broadcasts.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-neutral-500">{t('creator.broadcasts.historyEmpty')}</div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {data.broadcasts.map((b) => (
              <div key={b.id} className="px-4 py-3">
                <h3 className="text-sm font-semibold text-neutral-900">{b.subject || t('creator.broadcasts.subjectOptional')}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-neutral-600">{b.body}</p>
                <div className="mt-1.5 flex items-center justify-between text-xs text-neutral-400">
                  <span>{new Date(b.sentAt).toLocaleDateString()}</span>
                  <span>{t('creator.broadcasts.recipients', { count: b.recipientCount })}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {composing && (
        <ComposeModal
          allowance={data.allowance}
          onClose={() => setComposing(false)}
          onSend={(subject, body) => sendMutation.mutate({ subject, body })}
          sending={sendMutation.isPending}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/creator/broadcasts')({
  component: CreatorBroadcastsPage,
});
