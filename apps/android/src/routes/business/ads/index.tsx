/**
 * apps/android/src/routes/business/ads/index.tsx
 *
 * Advertising Panel — mirrors apps/web/app/(app)/business/ads/page.tsx.
 * Growth+ tiers submit Sponsored Quests for admin/AI approval.
 */

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

interface BusinessAccount {
  tier: string;
}
interface BusinessPageOption {
  id: string;
  name: string;
  status: string;
}
interface SponsoredQuest {
  id: string;
  title: string;
  description: string;
  reward_coins: number;
  moderation_status: 'pending' | 'approved' | 'rejected';
  is_active: boolean;
}

async function fetchAccount(): Promise<BusinessAccount | null> {
  try {
    const { data } = await apiClient.get<{ business: BusinessAccount }>('/business');
    return data.business;
  } catch {
    return null;
  }
}

async function fetchQuests() {
  const { data } = await apiClient.get<{ quests: SponsoredQuest[] }>('/business/sponsored-quests');
  return data.quests;
}

async function fetchPages() {
  const { data } = await apiClient.get<{ pages: BusinessPageOption[] }>('/business/pages');
  return data.pages.filter((p) => p.status === 'active');
}

function badgeClass(status: string) {
  if (status === 'approved') return 'bg-green-100 text-green-700';
  if (status === 'rejected') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-700';
}

function BusinessAdsPage() {
  const qc = useQueryClient();
  const { data: account } = useQuery({ queryKey: ['business', 'me'], queryFn: fetchAccount });
  const { data: quests, status } = useQuery({ queryKey: ['business', 'sponsored-quests'], queryFn: fetchQuests, enabled: !!account });
  const { data: pages } = useQuery({ queryKey: ['business', 'pages', 'active'], queryFn: fetchPages, enabled: !!account });

  const [showForm, setShowForm] = useState(false);
  const [businessPageId, setBusinessPageId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [requirements, setRequirements] = useState('');
  const [rewardCoins, setRewardCoins] = useState(1000);
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submitMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/business/sponsored-quests', {
        businessPageId,
        title: title.trim(),
        description: description.trim(),
        requirements: requirements.trim(),
        rewardCoins: Number(rewardCoins),
        maxApplications: 10,
        deadline: new Date(deadline).toISOString(),
      }),
    onSuccess: () => {
      setShowForm(false);
      setTitle(''); setDescription(''); setRequirements(''); setDeadline('');
      qc.invalidateQueries({ queryKey: ['business', 'sponsored-quests'] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to submit'),
  });

  const tierAllowed = account?.tier === 'growth' || account?.tier === 'enterprise';

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <h1 className="text-lg font-bold text-neutral-900 mb-3">Advertising Panel</h1>

      {account && !tierAllowed ? (
        <div className="bg-white rounded-xl p-4 shadow-card text-center">
          <p className="text-sm text-neutral-600">Sponsored Quests require the Growth tier or higher.</p>
          <Link to="/business" className="mt-2 inline-block text-sm font-semibold text-primary-600">Upgrade on web/PWA →</Link>
        </div>
      ) : (
        <>
          {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              disabled={!pages || pages.length === 0}
              className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40 mb-4"
            >
              + Submit Sponsored Quest
            </button>
          ) : (
            <div className="bg-white rounded-xl p-4 shadow-card mb-4 space-y-2">
              <select value={businessPageId} onChange={(e) => setBusinessPageId(e.target.value)} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm">
                <option value="">Select a page…</option>
                {(pages ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Quest title" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" rows={2} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
              <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} placeholder="Requirements" rows={2} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
              <input type="number" min={100} value={rewardCoins} onChange={(e) => setRewardCoins(Number(e.target.value))} placeholder="Reward coins" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
              <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
              <button
                onClick={() => businessPageId && title && description && requirements && deadline && submitMutation.mutate()}
                disabled={submitMutation.isPending}
                className="w-full rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {submitMutation.isPending ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>
          )}

          {status === 'pending' ? (
            <p className="text-center text-sm text-neutral-400 py-8">Loading…</p>
          ) : !quests || quests.length === 0 ? (
            <p className="text-center text-sm text-neutral-400 py-8">No Sponsored Quests yet.</p>
          ) : (
            <div className="space-y-2">
              {quests.map((q) => (
                <div key={q.id} className="bg-white rounded-xl p-4 shadow-card">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-sm text-neutral-900 truncate">{q.title}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${badgeClass(q.moderation_status)}`}>{q.moderation_status}</span>
                  </div>
                  <p className="text-xs text-neutral-500 line-clamp-2">{q.description}</p>
                  <p className="text-xs text-neutral-400 mt-1">🪙 {q.reward_coins.toLocaleString()} coins</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/business/ads/')({
  component: BusinessAdsPage,
});
