/**
 * apps/android/src/routes/guilds/index.tsx
 *
 * Browse Guilds directory — mirrors the fixed apps/web/app/(app)/guilds/page.tsx
 * (GET /api/guilds, city filter, cursor pagination). Web's /guild-discovery
 * ("Crews near you are recruiting", 3 recommendations) is the onboarding
 * variant; this is the full searchable directory it links out to.
 */

import { useState, useEffect } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import { TIER_BADGE, tierBase } from '@/lib/guilds/GuildDetailView';
import { adminInputClass } from '@/components/admin/AdminUI';

interface Eligibility {
  canCreate: boolean;
  minLevel: number;
  currentLevel: number;
  minTrustScore: number;
  currentTrustScore: number;
  costCoins: number;
  currentCoinBalance: number;
  alreadyInGuild: boolean;
}

function CreateGuildButton() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [loadingEligibility, setLoadingEligibility] = useState(false);
  const [name, setName] = useState('');
  const [crestEmoji, setCrestEmoji] = useState('🛡️');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [recruitmentType, setRecruitmentType] = useState<'open' | 'approval' | 'invite_only'>('open');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<{ user?: { country?: string } }>('/users/me')
      .then(({ data }) => {
        const c = data?.user?.country;
        if (c) setCountry(c.toUpperCase());
      })
      .catch(() => {});
  }, []);

  async function handleOpen() {
    setOpen(true);
    setError(null);
    if (!eligibility) {
      setLoadingEligibility(true);
      try {
        const { data } = await apiClient.get<{ data: Eligibility }>('/guilds?eligibility=true');
        setEligibility(data.data);
      } catch {
        setEligibility(null);
      } finally {
        setLoadingEligibility(false);
      }
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const { data } = await apiClient.post<{ data: { guildId: string } }>('/guilds', {
        name: name.trim(),
        crestEmoji: crestEmoji.trim() || '🛡️',
        description: description.trim() || undefined,
        city: city.trim() || undefined,
        country: country.trim().toUpperCase() || 'NG',
        recruitmentType,
      });
      await qc.invalidateQueries({ queryKey: ['guilds'] });
      await qc.invalidateQueries({ queryKey: ['guild'] });
      setOpen(false);
      navigate({ to: '/guilds/$guildId', params: { guildId: data.data.guildId } });
    } catch (e: any) {
      const msg = e?.response?.data?.error?.message ?? t('error.generic');
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handleOpen()}
        className="shrink-0 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white"
      >
        {t('guild.create.button', 'Create Guild')}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setOpen(false)}>
          <div className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-bold text-neutral-900">{t('guild.create.title', 'Create a Guild')}</h3>

            {loadingEligibility ? (
              <p className="text-sm text-neutral-500">{t('guild.create.checking', 'Checking eligibility…')}</p>
            ) : eligibility && !eligibility.canCreate ? (
              <div className="mb-4 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                <p className="font-semibold">{t('guild.create.notEligible', "You're not eligible to create a guild yet")}</p>
                {eligibility.alreadyInGuild && <p>{t('guild.create.alreadyInGuild', 'You already belong to a guild.')}</p>}
                {eligibility.currentLevel < eligibility.minLevel && (
                  <p>{t('guild.create.levelRequirement', "Reach level {{minLevel}} to found a guild (you're level {{currentLevel}}).", { minLevel: eligibility.minLevel, currentLevel: eligibility.currentLevel })}</p>
                )}
                {eligibility.currentTrustScore < eligibility.minTrustScore && (
                  <p>{t('guild.create.trustRequirement', 'Build your trust score to {{minTrustScore}}+ first (yours is {{currentTrustScore}}).', { minTrustScore: eligibility.minTrustScore, currentTrustScore: eligibility.currentTrustScore })}</p>
                )}
                {eligibility.currentCoinBalance < eligibility.costCoins && (
                  <p>{t('guild.create.coinsRequirement', 'Guild creation costs {{costCoins}} coins (you have {{currentCoinBalance}}).', { costCoins: eligibility.costCoins, currentCoinBalance: eligibility.currentCoinBalance })}</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('guild.create.name', 'Guild Name')}</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={adminInputClass} data-selectable />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('guild.create.crest', 'Crest Emoji')}</label>
                  <input value={crestEmoji} onChange={(e) => setCrestEmoji(e.target.value)} maxLength={4} className={`${adminInputClass} w-20 text-center text-lg`} data-selectable />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('guild.create.description', 'Description')}</label>
                  <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} className={`${adminInputClass} resize-none`} data-selectable />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('guild.create.city', 'City')}</label>
                    <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} className={adminInputClass} data-selectable />
                  </div>
                  <div className="w-20">
                    <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('guild.create.country', 'Country')}</label>
                    <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="NG" className={`${adminInputClass} uppercase`} data-selectable />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-neutral-600">{t('guild.create.recruitment', 'Recruitment')}</label>
                  <select value={recruitmentType} onChange={(e) => setRecruitmentType(e.target.value as typeof recruitmentType)} className={adminInputClass}>
                    <option value="open">{t('guild.create.recruitmentOpen', 'Open — anyone can join')}</option>
                    <option value="approval">{t('guild.create.recruitmentApproval', 'Approval required')}</option>
                    <option value="invite_only">{t('guild.create.recruitmentInviteOnly', 'Invite only')}</option>
                  </select>
                </div>
                <p className="text-xs text-neutral-500">{t('guild.create.costNote', 'Creating a guild costs {{cost}} coins.', { cost: 500 })}</p>
              </div>
            )}

            {error && <p className="mt-3 text-sm text-danger-600">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button onClick={() => setOpen(false)} className="flex-1 rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700">
                {t('common.cancel', 'Cancel')}
              </button>
              {(!eligibility || eligibility.canCreate) && (
                <button
                  onClick={() => void handleSubmit()}
                  disabled={submitting || !name.trim() || !country.trim() || loadingEligibility}
                  className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {submitting ? t('guild.create.creating', 'Creating…') : t('guild.create.submit', 'Create Guild')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

interface GuildRow {
  id: string;
  name: string;
  crest_emoji: string;
  city: string | null;
  tier: string;
  member_count: number;
  recruitment_type: string;
  wars_won: number;
}

interface GuildsPage {
  items: GuildRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

async function fetchGuilds({ pageParam, city }: { pageParam?: string; city: string }): Promise<GuildsPage> {
  const params = new URLSearchParams({ limit: '20' });
  if (city.trim()) params.set('city', city.trim());
  if (pageParam) params.set('cursor', pageParam);
  const { data } = await apiClient.get<{ data: GuildsPage }>(`/guilds?${params.toString()}`);
  return data.data;
}

function GuildsIndexPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [city, setCity] = useState('');
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const { data, status, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ['guilds', 'browse', city],
    queryFn: ({ pageParam }) => fetchGuilds({ pageParam, city }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const guilds = data?.pages.flatMap((p) => p.items) ?? [];

  async function handleJoin(guildId: string) {
    setJoiningId(guildId);
    try {
      await apiClient.post(`/guilds/${guildId}/join`);
      await qc.invalidateQueries({ queryKey: ['guild', 'mine'] });
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 p-4 space-y-3">
      <div className="flex justify-end">
        <CreateGuildButton />
      </div>
      <input
        type="text"
        value={city}
        onChange={(e) => setCity(e.target.value)}
        placeholder={t('guilds.filterByCity')}
        className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:outline-none"
        data-selectable
      />

      {status === 'pending' ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-neutral-200 bg-white" />
          ))}
        </div>
      ) : status === 'error' ? (
        <p className="py-8 text-center text-sm text-danger-600">{t('error.generic')}</p>
      ) : guilds.length === 0 ? (
        <p className="py-12 text-center text-sm text-neutral-500">{t('guildDiscovery.empty')}</p>
      ) : (
        <>
          {guilds.map((g) => {
            const { classes } = TIER_BADGE[tierBase(g.tier)];
            return (
              <div key={g.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4">
                <Link to="/guilds/$guildId" params={{ guildId: g.id }}>
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-2xl">{g.crest_emoji}</span>
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to="/guilds/$guildId" params={{ guildId: g.id }} className="font-bold text-neutral-900">
                      {g.name}
                    </Link>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${classes}`}>{g.tier.split('_')[0]}</span>
                  </div>
                  <p className="text-xs text-neutral-500">
                    {g.city ? `${g.city} · ` : ''}
                    {t('guildDiscovery.members', { count: g.member_count })} · {t('guildDiscovery.warsWon', { count: g.wars_won })}
                  </p>
                </div>
                <button
                  disabled={joiningId === g.id || g.recruitment_type === 'invite_only'}
                  onClick={() => handleJoin(g.id)}
                  className="shrink-0 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {joiningId === g.id ? t('guildDiscovery.joining') : t('guildDiscovery.join')}
                </button>
              </div>
            );
          })}

          {hasNextPage && (
            <div className="flex justify-center py-3">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="rounded-xl border border-neutral-300 px-5 py-2 text-xs font-semibold text-neutral-700 disabled:opacity-60"
              >
                {isFetchingNextPage ? t('wallet.loadingMore') : t('wallet.loadMore')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const Route = createFileRoute('/guilds/')({
  component: GuildsIndexPage,
});
