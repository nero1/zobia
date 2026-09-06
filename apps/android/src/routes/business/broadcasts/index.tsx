/**
 * apps/android/src/routes/business/broadcasts/index.tsx
 *
 * Business Account broadcasts — mirrors
 * apps/web/app/(app)/business/broadcasts/page.tsx. Sends to the business
 * owner's followers, metered by tier per month (PRD §17).
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface Allowance {
  quota: number | null;
  used: number;
  remaining: number | null;
  unlimited: boolean;
}

interface Broadcast {
  id: string;
  subject: string;
  content: string;
  sentAt: string;
  recipientCount: number;
}

async function fetchBroadcasts() {
  const { data } = await apiClient.get<{ tier: string; allowance: Allowance; broadcasts: Broadcast[] }>('/business/broadcasts');
  return data;
}

function BusinessBroadcastsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, status } = useQuery({ queryKey: ['business', 'broadcasts'], queryFn: fetchBroadcasts, staleTime: 30_000 });
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sendMutation = useMutation({
    mutationFn: () => apiClient.post('/business/broadcasts', { subject: subject.trim() || undefined, content: content.trim() }),
    onSuccess: () => {
      setSubject('');
      setContent('');
      setComposing(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ['business', 'broadcasts'] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('business.broadcasts.sendFailed', 'Failed to send')),
  });

  if (status === 'pending') return <div className="p-6 text-center text-neutral-400">{t('action.loading', 'Loading…')}</div>;

  const allowance = data?.allowance;
  const canSend = allowance ? (allowance.unlimited || (allowance.remaining ?? 0) > 0) : false;

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-lg font-bold text-neutral-900">{t('business.broadcasts.title', 'Broadcasts')}</h1>
        <span className="text-xs text-neutral-500 capitalize">{data?.tier} tier</span>
      </div>

      {allowance && (
        <div className="bg-white rounded-xl p-4 shadow-card mb-3">
          <p className="text-sm text-neutral-700">
            {allowance.unlimited
              ? t('business.broadcasts.unlimitedNote', 'Unlimited broadcasts on your plan.')
              : t('business.broadcasts.remainingNote', { remaining: allowance.remaining, quota: allowance.quota, defaultValue: `${allowance.remaining} of ${allowance.quota} broadcasts left this month.` })}
          </p>
          {!allowance.unlimited && (allowance.remaining ?? 0) <= 0 && (
            <Link to="/settings" className="text-xs text-primary-600 underline mt-1 inline-block">
              {t('business.broadcasts.upgradeLink', 'Upgrade for more')}
            </Link>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      {!composing ? (
        <button
          onClick={() => setComposing(true)}
          disabled={!canSend}
          className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40 mb-4"
        >
          {t('business.broadcasts.newBroadcast', 'New Broadcast')}
        </button>
      ) : (
        <div className="bg-white rounded-xl p-4 shadow-card mb-4 space-y-2">
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t('business.broadcasts.subjectLabel', 'Subject (optional)')}
            maxLength={200}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={t('business.broadcasts.contentLabel', 'Message')}
            maxLength={1000}
            rows={4}
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button onClick={() => setComposing(false)} className="flex-1 rounded-lg border border-neutral-200 py-2 text-sm">{t('action.cancel', 'Cancel')}</button>
            <button
              onClick={() => content.trim() && sendMutation.mutate()}
              disabled={sendMutation.isPending || !content.trim()}
              className="flex-1 rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {sendMutation.isPending ? '…' : t('business.broadcasts.send', 'Send')}
            </button>
          </div>
        </div>
      )}

      {(data?.broadcasts ?? []).length === 0 ? (
        <p className="text-center text-sm text-neutral-400 py-10">{t('business.broadcasts.historyEmpty', 'No broadcasts sent yet.')}</p>
      ) : (
        <div className="space-y-2">
          {data?.broadcasts.map((b) => (
            <div key={b.id} className="bg-white rounded-xl p-4 shadow-card">
              {b.subject && <p className="font-semibold text-sm text-neutral-900">{b.subject}</p>}
              <p className="text-sm text-neutral-600 line-clamp-2">{b.content}</p>
              <p className="text-xs text-neutral-400 mt-1">{new Date(b.sentAt).toLocaleDateString()} · {b.recipientCount} recipients</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/business/broadcasts/')({
  component: BusinessBroadcastsPage,
});
