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
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';

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
  is_daily_quest_eligible: boolean;
  total_budget_credits: string;
  spent_credits: string;
  estimated_reach: number | null;
  impressions_count: number;
  auto_paused: boolean;
  pause_reason: string | null;
}

// Mirrors lib/quests/sponsoredQuestPacing.ts SPONSORED_QUEST_DURATION_PRESETS —
// kept as a plain constant since that module pulls in server-only DB access.
const DURATION_PRESETS = [
  { key: '3d', label: '3 days', days: 3 },
  { key: '1w', label: '1 week', days: 7 },
  { key: '2w', label: '2 weeks', days: 14 },
  { key: '1m', label: '1 month', days: 30 },
  { key: '2m', label: '2 months', days: 60 },
] as const;
type DurationPresetKey = (typeof DURATION_PRESETS)[number]['key'];
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
  { key: 'feed_banner', labelKey: 'ads.campaigns.placement.feedBanner', size: '300x250' },
  { key: 'messages_banner', labelKey: 'ads.campaigns.placement.messagesBanner', size: '320x50' },
  { key: 'room_instream', labelKey: 'ads.campaigns.placement.roomInstream', size: 'native' },
  { key: 'interstitial_global', labelKey: 'ads.campaigns.placement.interstitial', size: 'interstitial' },
  { key: 'rewarded_global', labelKey: 'ads.campaigns.placement.rewardedVideo', size: 'rewarded' },
] as const;

function AdCampaignsTab() {
  const { t } = useTranslation();
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
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('ads.campaigns.createFailed', 'Failed to create campaign')),
  });

  const runStateMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'pause' | 'stop' }) =>
      apiClient.patch(`/business/ads/campaigns/${id}`, { action }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ads', 'campaigns'] }),
  });

  if (!eligibility) return <p className="text-center text-sm text-neutral-400 py-8">{t('action.loading', 'Loading…')}</p>;

  if (!eligibility.eligible) {
    return (
      <div className="bg-white rounded-xl p-4 shadow-card text-center">
        <p className="text-sm text-neutral-600">{eligibility.reason ?? t('ads.campaigns.ineligible', 'You are not eligible to place ads yet.')}</p>
        <Link to="/business" className="mt-2 inline-block text-sm font-semibold text-primary-600">{t('ads.manageBusinessAccount', 'Manage Business Account →')}</Link>
      </div>
    );
  }

  return (
    <>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

      {!showForm ? (
        <button onClick={() => setShowForm(true)} className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white mb-4">
          {t('ads.campaigns.new', '+ New Ad Campaign')}
        </button>
      ) : (
        <div className="bg-white rounded-xl p-4 shadow-card mb-4 space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('ads.campaigns.name', 'Campaign Name')} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <select value={placementKey} onChange={(e) => setPlacementKey(e.target.value as typeof placementKey)} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm">
            {PLACEMENTS.map((p) => <option key={p.key} value={p.key}>{t(p.labelKey)}</option>)}
          </select>
          <input value={creativeTitle} onChange={(e) => setCreativeTitle(e.target.value)} placeholder={t('ads.campaigns.title', 'Ad Title')} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <input value={clickUrl} onChange={(e) => setClickUrl(e.target.value)} placeholder={t('ads.campaigns.destinationUrl', 'Destination URL')} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <input type="number" min={0} value={budgetCredits} onChange={(e) => setBudgetCredits(Number(e.target.value))} placeholder={t('ads.campaigns.budget', 'Budget (Credits)')} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <button
            onClick={() => name && clickUrl && createMutation.mutate()}
            disabled={createMutation.isPending}
            className="w-full rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {createMutation.isPending ? t('ads.campaigns.submitting', 'Submitting…') : t('ads.campaigns.submit', 'Create & Submit for Review')}
          </button>
        </div>
      )}

      {status === 'pending' ? (
        <p className="text-center text-sm text-neutral-400 py-8">{t('action.loading', 'Loading…')}</p>
      ) : !campaigns || campaigns.length === 0 ? (
        <p className="text-center text-sm text-neutral-400 py-8">{t('ads.campaigns.empty', 'No ad campaigns yet.')}</p>
      ) : (
        <div className="space-y-2">
          {campaigns.map((c) => (
            <div key={c.id} className="bg-white rounded-xl p-4 shadow-card">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-semibold text-sm text-neutral-900 truncate">{c.name}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${badgeClass(c.moderation_status)}`}>{c.moderation_status}</span>
              </div>
              <p className="text-xs text-neutral-400">
                {t('ads.campaigns.spentLine', 'Spent {{spent}} / {{total}} Credits', {
                  spent: Number(c.spent_credits).toLocaleString(),
                  total: Number(c.total_budget_credits).toLocaleString(),
                })}
              </p>
              {c.moderation_status === 'approved' && (
                <div className="mt-2 flex gap-2">
                  {c.status !== 'active' && (
                    <button onClick={() => runStateMutation.mutate({ id: c.id, action: 'activate' })} className="rounded-lg bg-green-600 px-2.5 py-1 text-[11px] font-semibold text-white">{t('ads.campaigns.activate', 'Activate')}</button>
                  )}
                  {c.status === 'active' && (
                    <button onClick={() => runStateMutation.mutate({ id: c.id, action: 'pause' })} className="rounded-lg border border-neutral-200 px-2.5 py-1 text-[11px] font-semibold text-neutral-700">{t('ads.campaigns.pause', 'Pause')}</button>
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
  const { t } = useTranslation();
  const currency = useCurrency();
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

  const [runInDailyDecks, setRunInDailyDecks] = useState(false);
  const [durationPreset, setDurationPreset] = useState<DurationPresetKey>('1w');
  const [totalBudgetCredits, setTotalBudgetCredits] = useState(5000);
  const [dailyBudgetCredits, setDailyBudgetCredits] = useState('');
  const [targetAction, setTargetAction] = useState('');
  const [restartingId, setRestartingId] = useState<string | null>(null);

  const durationDays = DURATION_PRESETS.find((p) => p.key === durationPreset)?.days ?? 7;
  const estimatedReach = runInDailyDecks ? Math.floor((totalBudgetCredits / 500) * 1000) : 0;

  const submitMutation = useMutation({
    mutationFn: () => {
      const startsAt = new Date();
      const endsAt = new Date(startsAt.getTime() + durationDays * 86_400_000);
      return apiClient.post('/business/sponsored-quests', {
        businessPageId,
        title: title.trim(),
        description: description.trim(),
        requirements: requirements.trim(),
        rewardCoins: Number(rewardCoins),
        maxApplications: 10,
        deadline: new Date(deadline).toISOString(),
        isDailyQuestEligible: runInDailyDecks,
        startsAt: runInDailyDecks ? startsAt.toISOString() : undefined,
        endsAt: runInDailyDecks ? endsAt.toISOString() : undefined,
        totalBudgetCredits: runInDailyDecks ? Number(totalBudgetCredits) : 0,
        dailyBudgetCredits: runInDailyDecks && dailyBudgetCredits ? Number(dailyBudgetCredits) : undefined,
        targetAction: runInDailyDecks && targetAction.trim() ? targetAction.trim() : undefined,
      });
    },
    onSuccess: () => {
      setShowForm(false);
      setTitle(''); setDescription(''); setRequirements(''); setDeadline('');
      setRunInDailyDecks(false); setTotalBudgetCredits(5000); setDailyBudgetCredits(''); setTargetAction('');
      qc.invalidateQueries({ queryKey: ['business', 'sponsored-quests'] });
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('ads.quests.submitFailed', 'Failed to submit')),
  });

  const restartMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/business/sponsored-quests/${id}/restart`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['business', 'sponsored-quests'] }),
    onError: (err: unknown) => setError(err instanceof Error ? err.message : t('ads.quests.restartFailed', 'Failed to restart')),
    onSettled: () => setRestartingId(null),
  });

  const tierAllowed = account?.tier === 'growth' || account?.tier === 'enterprise';

  if (account && !tierAllowed) {
    return (
      <div className="bg-white rounded-xl p-4 shadow-card text-center">
        <p className="text-sm text-neutral-600">{t('ads.quests.tierRequired', 'Sponsored Quests require the Growth tier or higher.')}</p>
        <Link to="/business" className="mt-2 inline-block text-sm font-semibold text-primary-600">{t('ads.quests.upgradeOnWeb', 'Upgrade on web/PWA →')}</Link>
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
          {t('ads.quests.submitButton', '+ Submit Sponsored Quest')}
        </button>
      ) : (
        <div className="bg-white rounded-xl p-4 shadow-card mb-4 space-y-2">
          <select value={businessPageId} onChange={(e) => setBusinessPageId(e.target.value)} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm">
            <option value="">{t('ads.quests.selectPage', 'Select a page…')}</option>
            {(pages ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('ads.quests.titlePlaceholder', 'Quest title')} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('ads.quests.descriptionPlaceholder', 'Description')} rows={2} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} placeholder={t('ads.quests.requirementsPlaceholder', 'Requirements')} rows={2} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <input type="number" min={100} value={rewardCoins} onChange={(e) => setRewardCoins(Number(e.target.value))} placeholder={t('ads.quests.rewardPlaceholder', 'Reward {{currency}}', { currency: currency.softPlural })} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
          <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />

          <div className="rounded-lg border border-dashed border-neutral-300 p-3 space-y-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-neutral-700">
              <input type="checkbox" checked={runInDailyDecks} onChange={(e) => setRunInDailyDecks(e.target.checked)} />
              {t('ads.quests.dailyDeckToggle', "Also boost this in regular users' daily quest decks")}
            </label>
            {runInDailyDecks && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {DURATION_PRESETS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setDurationPreset(p.key)}
                      className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${durationPreset === p.key ? 'border-primary-600 bg-primary-600 text-white' : 'border-neutral-300 text-neutral-600'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <input type="number" min={0} value={totalBudgetCredits} onChange={(e) => setTotalBudgetCredits(Number(e.target.value))} placeholder={t('ads.quests.totalBudget', 'Total Budget ({{currency}})', { currency: currency.softPlural })} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
                <input type="number" min={0} value={dailyBudgetCredits} onChange={(e) => setDailyBudgetCredits(e.target.value)} placeholder={t('ads.quests.dailyCap', 'Daily Cap ({{currency}}, optional)', { currency: currency.softPlural })} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
                <input value={targetAction} onChange={(e) => setTargetAction(e.target.value)} placeholder={t('ads.quests.targetActionPlaceholder', 'Action to complete (optional)')} className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm" />
                <p className="text-[11px] text-neutral-400">
                  {t('ads.quests.estimatedReach', 'Estimated reach: {{count}} impressions.', { count: estimatedReach.toLocaleString() })}
                </p>
              </>
            )}
          </div>

          <button
            onClick={() => businessPageId && title && description && requirements && deadline && submitMutation.mutate()}
            disabled={submitMutation.isPending}
            className="w-full rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitMutation.isPending ? t('ads.campaigns.submitting', 'Submitting…') : t('ads.quests.submit', 'Submit for Approval')}
          </button>
        </div>
      )}

      {status === 'pending' ? (
        <p className="text-center text-sm text-neutral-400 py-8">{t('action.loading', 'Loading…')}</p>
      ) : !quests || quests.length === 0 ? (
        <p className="text-center text-sm text-neutral-400 py-8">{t('ads.quests.empty', 'No Sponsored Quests yet.')}</p>
      ) : (
        <div className="space-y-2">
          {quests.map((q) => (
            <div key={q.id} className="bg-white rounded-xl p-4 shadow-card">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-semibold text-sm text-neutral-900 truncate">{q.title}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${badgeClass(q.moderation_status)}`}>{q.moderation_status}</span>
              </div>
              <p className="text-xs text-neutral-500 line-clamp-2">{q.description}</p>
              {q.pause_reason && (
                <p className="text-[11px] text-amber-600 mt-1">
                  ⚠️ {t('ads.quests.pausedNote', 'Paused: {{reason}}. Restart it once resolved.', { reason: q.pause_reason })}
                </p>
              )}
              <p className="text-xs text-neutral-400 mt-1">🪙 {t('ads.quests.rewardLabel', '{{count}} {{currency}}', { count: q.reward_coins, currency: currency.softPlural })}</p>
              {q.is_daily_quest_eligible && (
                <p className="text-[11px] text-neutral-400 mt-0.5">
                  {t('ads.quests.spendLine', '{{spent}}/{{total}} {{currency}} spent · {{impressions}} impressions', {
                    spent: Number(q.spent_credits).toLocaleString(),
                    total: Number(q.total_budget_credits).toLocaleString(),
                    currency: currency.softPlural,
                    impressions: q.impressions_count.toLocaleString(),
                  })}
                  {q.estimated_reach ? ` · ${t('ads.quests.estReach', 'est. reach {{count}}', { count: q.estimated_reach.toLocaleString() })}` : ''}
                </p>
              )}
              {q.auto_paused && (
                <button
                  onClick={() => { setRestartingId(q.id); restartMutation.mutate(q.id); }}
                  disabled={restartMutation.isPending}
                  className="mt-2 rounded-lg bg-success-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                >
                  {restartingId === q.id && restartMutation.isPending ? '…' : t('ads.quests.restart', 'Restart')}
                </button>
              )}
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
  const { t } = useTranslation();
  const { data: account } = useQuery({ queryKey: ['business', 'me'], queryFn: fetchAccount });
  const { data: pages } = useQuery({ queryKey: ['business', 'pages', 'active'], queryFn: fetchPages, enabled: !!account });
  const [tab, setTab] = useState<'campaigns' | 'quests'>('campaigns');

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4">
      <h1 className="text-lg font-bold text-neutral-900 mb-3">{t('ads.panelTitle', 'Advertising Panel')}</h1>

      <div className="flex gap-2 rounded-xl bg-neutral-100 p-1 mb-4">
        <button onClick={() => setTab('campaigns')} className={`flex-1 rounded-lg py-2 text-xs font-semibold ${tab === 'campaigns' ? 'bg-white text-neutral-900 shadow-card' : 'text-neutral-500'}`}>
          {t('ads.tabs.campaigns', 'Ad Campaigns')}
        </button>
        <button onClick={() => setTab('quests')} className={`flex-1 rounded-lg py-2 text-xs font-semibold ${tab === 'quests' ? 'bg-white text-neutral-900 shadow-card' : 'text-neutral-500'}`}>
          {t('ads.tabs.quests', 'Sponsored Quests')}
        </button>
      </div>

      {tab === 'campaigns' ? <AdCampaignsTab /> : <SponsoredQuestsTab account={account} pages={pages} />}
    </div>
  );
}

export const Route = createFileRoute('/business/ads/')({
  component: BusinessAdsPage,
});
