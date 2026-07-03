/**
 * apps/android/src/routes/admin/feature-flags.tsx
 *
 * Feature Flags panel — mirrors apps/web/app/(admin)/admin/feature-flags/page.tsx:
 * lists every `feature_*` x_manifest key with a toggle switch, auto-saving on
 * flip. LABEL_MAP enriches known keys with a human label/description; unknown
 * keys fall back to a generated Title Case label.
 *
 * GET /api/admin/config filtered client-side to `feature_*` keys (same data
 * source the web page reads), so this stays in sync with the Config page's
 * "AdMob" group entries that also happen to start with `feature_`.
 * PUT /api/admin/feature-flags  { key, enabled } → { key, enabled }.
 */

import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { AdminToggle, AdminToast, AdminErrorState, AdminEmptyState, adminInputClass, timeAgo } from '@/components/admin/AdminUI';

interface RawManifestEntry {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string | null;
}

interface FeatureFlag {
  key: string;
  labelKey: string;
  labelDefault: string;
  descKey: string;
  descDefault: string;
  enabled: boolean;
  updatedAt: string | null;
}

const LABEL_MAP: Record<string, { label: string; desc: string }> = {
  feature_rooms: { label: 'Rooms', desc: 'Enable the live audio/video Rooms feature.' },
  feature_direct_messages: { label: 'Direct Messages', desc: 'Enable one-to-one and group direct messaging.' },
  feature_gifts: { label: 'Virtual Gifts', desc: 'Allow users to send virtual gifts during live rooms.' },
  feature_rankings: { label: 'Rankings & Leaderboards', desc: 'Show weekly and all-time XP leaderboards.' },
  feature_community_notes: { label: 'Community Notes', desc: 'Enable crowdsourced fact-checking notes on posts (similar to X/Twitter Community Notes).' },
  feature_star_purchase: { label: 'Star Currency Purchase', desc: 'Allow users to directly purchase Star currency with real money. Disable to use coins-only economy.' },
  feature_nemesis_system: { label: 'Nemesis System', desc: 'Enable the Nemesis rival assignment system: users are matched with rivals for weekly challenges.' },
  feature_guild_wars: { label: 'Guild Wars', desc: 'Enable the Guild Wars PvP event where guilds compete for XP and prizes.' },
  feature_classrooms: { label: 'ClassRooms', desc: 'Enable ClassRoom knowledge rooms where hosts can run structured Q&A sessions.' },
  feature_business_accounts: { label: 'Business Accounts', desc: 'Enable Business Account tiers with analytics, branded rooms, and API access.' },
  feature_admob_ads: { label: 'AdMob Ads', desc: 'Show AdMob banner and interstitial ads to free-tier users.' },
  feature_rewarded_ads: { label: 'Rewarded Ads', desc: 'Allow free-tier users to watch rewarded ads in exchange for coins.' },
  feature_merch_store: { label: 'Creator Merch Store', desc: 'Enable the Creator Merch Store for Elite-tier creators to sell branded merchandise.' },
  feature_games: { label: 'Games', desc: 'Master switch for the Games feature: the directory, /g game pages, challenges, wagers and the gaming track.' },
  feature_platform_council: { label: 'Platform Council', desc: 'Enable the Platform Council — the top 50 users by Legacy Score get a vote on platform decisions.' },
  feature_alliance_system: { label: 'Guild Alliance System', desc: 'Enable Guild Alliances: Platinum+ guilds can form multi-guild alliances for joint wars.' },
  feature_pin_auth: { label: 'PIN Authentication', desc: 'Allow users to set a 4-digit PIN as a secondary authentication method.' },
  feature_profile_stats: { label: 'Profile Stats Page', desc: 'Enable the User Profile Stats page. Configure which plans get the Basic vs Full view at Admin > Profile Stats.' },
};

function fallbackLabel(key: string): string {
  return key.replace(/^feature_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function fetchFlags(): Promise<FeatureFlag[]> {
  const { data } = await apiClient.get<RawManifestEntry[]>('/admin/config');
  const entries = (data ?? []).filter((e) => e.key.startsWith('feature_'));
  const flags: FeatureFlag[] = entries.map((e) => {
    const known = LABEL_MAP[e.key];
    return {
      key: e.key,
      labelKey: `admin.featureFlags.meta.${e.key}.label`,
      labelDefault: known?.label ?? fallbackLabel(e.key),
      descKey: `admin.featureFlags.meta.${e.key}.desc`,
      descDefault: known?.desc ?? e.description ?? '',
      enabled: e.value === 'true',
      updatedAt: e.updatedAt,
    };
  });
  flags.sort((a, b) => {
    const aKnown = a.key in LABEL_MAP ? 0 : 1;
    const bKnown = b.key in LABEL_MAP ? 0 : 1;
    if (aKnown !== bKnown) return aKnown - bKnown;
    return a.key.localeCompare(b.key);
  });
  return flags;
}

function FlagRow({ flag, onToggle, busy }: { flag: FeatureFlag; onToggle: (key: string, enabled: boolean) => void; busy: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3 border-b border-neutral-100 py-3.5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] text-neutral-400">{flag.key}</p>
        <p className="text-sm font-semibold text-neutral-900">{t(flag.labelKey, flag.labelDefault)}</p>
        <p className="mt-0.5 text-xs text-neutral-500">{t(flag.descKey, flag.descDefault)}</p>
        <p className="mt-1 text-[10px] text-neutral-400">{t('admin.featureFlags.lastUpdated', 'Last updated')}: {timeAgo(flag.updatedAt)}</p>
      </div>
      <div className="mt-0.5 shrink-0">
        <AdminToggle checked={flag.enabled} onChange={(v) => onToggle(flag.key, v)} disabled={busy} />
      </div>
    </div>
  );
}

function AdminFeatureFlagsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const { data, status, refetch } = useQuery({ queryKey: ['admin', 'feature-flags'], queryFn: fetchFlags });

  const toggleMutation = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => apiClient.put('/admin/feature-flags', { key, enabled }),
    onMutate: async ({ key, enabled }) => {
      await qc.cancelQueries({ queryKey: ['admin', 'feature-flags'] });
      const prev = qc.getQueryData<FeatureFlag[]>(['admin', 'feature-flags']);
      qc.setQueryData<FeatureFlag[]>(['admin', 'feature-flags'], (old) => old?.map((f) => (f.key === key ? { ...f, enabled } : f)));
      return { prev };
    },
    onError: (_err, { key }, ctx) => {
      if (ctx?.prev) qc.setQueryData(['admin', 'feature-flags'], ctx.prev);
      showToast(t('admin.moderation.actionFailed', 'Action failed'), 'error');
      void key;
    },
    onSuccess: (_res, { key, enabled }) => {
      showToast(t('admin.featureFlags.toggled', '{{key}} {{state}}', { key, state: enabled ? t('admin.featureFlags.enabled', 'enabled') : t('admin.featureFlags.disabled', 'disabled') }));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin', 'feature-flags'] }),
  });

  const filtered = (data ?? []).filter(
    (f) => search === '' || f.key.toLowerCase().includes(search.toLowerCase()) || f.labelDefault.toLowerCase().includes(search.toLowerCase()),
  );
  const enabledCount = (data ?? []).filter((f) => f.enabled).length;

  return (
    <div className="px-4 py-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{t('admin.featureFlags', 'Feature Flags')}</h1>
          {status === 'success' && (
            <p className="text-xs text-neutral-500">{t('admin.featureFlags.enabledCount', '{{enabled}} of {{total}} enabled', { enabled: enabledCount, total: data.length })}</p>
          )}
        </div>
      </div>
      <p className="mb-4 text-xs text-neutral-500">{t('admin.featureFlags.description', 'Enable or disable platform features globally.')}</p>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('admin.featureFlags.filterPlaceholder', 'Filter flags…')}
        className={`${adminInputClass} mb-4`}
      />

      {toast && <AdminToast message={toast.msg} type={toast.type} />}

      {status === 'error' && <AdminErrorState onRetry={() => refetch()} />}

      {status === 'pending' && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4">
              <div className="h-3 w-40 rounded bg-neutral-200" />
              <div className="mt-2 h-4 w-56 rounded bg-neutral-100" />
            </div>
          ))}
        </div>
      )}

      {status === 'success' && filtered.length === 0 && (
        <AdminEmptyState icon="🚀" title={t('admin.featureFlags.noneFound', 'No flags found')} />
      )}

      {status === 'success' && filtered.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 shadow-card">
          {filtered.map((flag) => (
            <FlagRow
              key={flag.key}
              flag={flag}
              busy={toggleMutation.isPending && toggleMutation.variables?.key === flag.key}
              onToggle={(key, enabled) => toggleMutation.mutate({ key, enabled })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/admin/feature-flags')({
  component: AdminFeatureFlagsPage,
});
