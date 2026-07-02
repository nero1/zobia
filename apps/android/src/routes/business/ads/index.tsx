/**
 * apps/android/src/routes/business/ads/index.tsx
 *
 * Advertising Panel — mirrors apps/web/app/(app)/business/ads/page.tsx.
 * Two tabs: Ad Campaigns (self-service, requires verified Business Account
 * + KYC Tier 1+ owner) and Sponsored Quests (Growth+ tier).
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
interface AdCampaign {
  id: string;
  name: string;
  status: string;
  moderation_status: 'pending' | 'approved' | 'rejected';
  cpm_credits: string;
  total_budget_credits: string;
  spent_credits: string;
}
interface Eligibility {
  eligible: boolean;
  reason?: string;
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

async function fetchEligibility(): Promise<Eligibility> {
  const { data } = await apiClient.get<Eligibility>('/business/ads/eligibility');
  return data;
}

async function fetchCampaigns() {
  const { data } = await apiClient.get<{ campaigns: AdCampaign[] }>('/business/ads/campaigns');
  return data.campaigns;
}

function badgeClass(status: string) {
  if (status === 'approved') return 'bg-green-100 text-green-700';
  if (status === 'rejected') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-700';
}

// ---------------------------------------------------------------------------
// Ad Campaigns tab
// ---------------------------------------------------------------------------

const PLACEMENTS = [
  { key: 'feed_banner', label: 'Feed banner (300×250)', size: '300x250' },
  { key: 'messages_banner', label: 'Messages banner (320×50)', size: '320x50' },
  { key: 'room_instream', label: 'Room in-stream native', size: 'native' },
  { key: 'interstitial_global', label: 'Interstitial', size: 'interstitial' },
  { key: 'rewarded_global', label: 'Rewarded video', size: 'rewarded' },
] as const;

function AdCampaignsTab() {
  const qc = useQueryClient();
  const { data: eligibility } = useQuery({ queryKey: ['ads', 'eligibility'], queryFn: fetchEligibility });
  const { data: campaigns, status } = useQuery({ queryKey: ['ads', 'campaigns'], queryFn: fetchCampaigns, enabled: !!eligibility?.eligible });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [placementKey, setPlacementKey] = useState<(typeof PLACEMENTS)[number]['key']>('feed_banner');
  const [creativeTitle, setCreativeTitle] = useState('');
  const [clickUrl, setClickUrl] = useState('');
  const [budgetCredits, setBudgetCredits] = useState(5000);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: campaign } = await apiClient.post<{ campaign: { id: string } }>('/business/ads/campaigns', {
        name: name.trim(),
        objective: 'traffic',
      });
      const campaignId = campaign.campaign.id;
      const placement = PLACEMENTS.find((p) => p.key === placementKey)!;
      await apiClient.post(`/business/ads/campaigns/${campaignId}/creatives`, {
        placementKey,
        format: 'text',
        size: placement.size,
        title: creativeTitle.trim() || undefined,
        clickUrl: clickUrl.trim(),
      });
      if (budgetCredits > 0) {
        await apiClient.post(`/business/ads/campaigns/${campaignId}/fund`, { amountCredits: Number(budgetCredits) });
      }
      await apiClient.post(`/business/ads/campaigns/${campaignId}/submit`, {});
    },
    onSuccess: () => {
      setShowForm(false);
      setName(''); setCreativeTitle(''); setClickUrl(''); setBudgetCredits(5000);
      qc.invalidateQueries({ queryKey: ['ads', 'campaigns'] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : 'Failed to create campaign'),
  });

  const runStateMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'pause' | 'stop' }) =>
      apiClient.patch(`/business/ads/campaigns/${id}`, { action }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ads', 'campaigns'] }),
  });

  if (!eligibility) return <p className="text-center text-sm text-neutral-400 py-8">Loading…</p>;

  if (!eligibility.eligible) {
    return (
      <div className="bg-white rounded-xl p-4 shadow-card text-center">
        <p className="text-sm text-neutral-600">{eligibility.reason ?? 'You are not eligible to place ads yet.'}</p>
        <Link to="/business" className="mt-2 inline-block text-sm font-semibold text-primary-600">Manage Business Account →</Link>
      </div>
    );
  }

  return (
    <>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white mb-4">
          + New Ad Campaign
        </button>
      ) : (
        <div className="bg-white rounded-xl p-4 shadow-card mb-4 space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <select value={placementKey} onChange={(e) => setPlacementKey(e.target.value as typeof placementKey)} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm">
            {PLACEMENTS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <input value={creativeTitle} onChange={(e) => setCreativeTitle(e.target.value)} placeholder="Ad title" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <input value={clickUrl} onChange={(e) => setClickUrl(e.target.value)} placeholder="Destination URL" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <input type="number" min={0} value={budgetCredits} onChange={(e) => setBudgetCredits(Number(e.target.value))} placeholder="Budget (Credits)" className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <button
            onClick={() => name && clickUrl && createMutation.mutate()}
            disabled={createMutation.isPending}
            className="w-full rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {createMutation.isPending ? 'Creating…' : 'Create & Submit for Review'}
          </button>
        </div>
      )}

      {status === 'pending' ? (
        <p className="text-center text-sm text-neutral-400 py-8">Loading…</p>
      ) : !campaigns || campaigns.length === 0 ? (
        <p className="text-center text-sm text-neutral-400 py-8">No ad campaigns yet.</p>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <div key={c.id} className="bg-white rounded-xl p-4 shadow-card">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-semibold text-sm text-neutral-900 truncate">{c.name}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${badgeClass(c.moderation_status)}`}>{c.moderation_status}</span>
              </div>
              <p className="text-xs text-neutral-400">
                Spent {Number(c.spent_credits).toLocaleString()} / {Number(c.total_budget_credits).toLocaleString()} Credits
              </p>
              {c.moderation_status === 'approved' && (
                <div className="mt-2 flex gap-2">
                  {c.status !== 'active' && (
                    <button onClick={() => runStateMutation.mutate({ id: c.id, action: 'activate' })} className="rounded-lg bg-green-600 px-2.5 py-1 text-[11px] font-semibold text-white">Activate</button>
                  )}
                  {c.status === 'active' && (
                    <button onClick={() => runStateMutation.mutate({ id: c.id, action: 'pause' })} className="rounded-lg border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-700">Pause</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sponsored Quests tab (pre-existing)
// ---------------------------------------------------------------------------

function SponsoredQuestsTab({ account, pages }: { account: BusinessAccount | null | undefined; pages: BusinessPageOption[] | undefined }) {
  const qc = useQueryClient();
  const { data: quests, status } = useQuery({ queryKey: ['business', 'sponsored-quests'], queryFn: fetchQuests, enabled: !!account });

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

  if (account && !tierAllowed) {
    return (
      <div className="bg-white rounded-xl p-4 shadow-card text-center">
        <p className="text-sm text-neutral-600">Sponsored Quests require the Growth tier or higher.</p>
        <Link to="/business" className="mt-2 inline-block text-sm font-semibold text-primary-600">Upgrade on web/PWA →</Link>
      </div>
    );
  }

  return (
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
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function BusinessAdsPage() {
  const { data: account } = useQuery({ queryKey: ['business', 'me'], queryFn: fetchAccount });
  const { data: pages } = useQuery({ queryKey: ['business', 'pages', 'active'], queryFn: fetchPages, enabled: !!account });
  const [tab, setTab] = useState<'campaigns' | 'quests'>('campaigns');

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <h1 className="text-lg font-bold text-neutral-900 mb-3">Advertising Panel</h1>

      <div className="flex gap-2 rounded-xl bg-neutral-100 p-1 mb-4">
        <button onClick={() => setTab('campaigns')} className={`flex-1 rounded-lg py-2 text-xs font-semibold ${tab === 'campaigns' ? 'bg-white text-neutral-900 shadow-card' : 'text-neutral-500'}`}>
          Ad Campaigns
        </button>
        <button onClick={() => setTab('quests')} className={`flex-1 rounded-lg py-2 text-xs font-semibold ${tab === 'quests' ? 'bg-white text-neutral-900 shadow-card' : 'text-neutral-500'}`}>
          Sponsored Quests
        </button>
      </div>

      {tab === 'campaigns' ? <AdCampaignsTab /> : <SponsoredQuestsTab account={account} pages={pages} />}
    </div>
  );
}

export const Route = createFileRoute('/business/ads/')({
  component: BusinessAdsPage,
});
