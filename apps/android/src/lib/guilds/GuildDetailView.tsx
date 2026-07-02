/**
 * apps/android/src/lib/guilds/GuildDetailView.tsx
 *
 * Shared guild-detail rendering used by both guild.tsx (own guild, via
 * GET /api/guilds/:guildId with isMember=true) and guilds/$guildId.tsx
 * (any guild, public). Mirrors apps/web/app/(app)/guilds/[guildId]/page.tsx.
 */

import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { GuildDetail, GuildMemberRole } from './types';

export type GuildTierBase = 'bronze' | 'silver' | 'gold' | 'platinum' | 'legend';

export function tierBase(tier: string): GuildTierBase {
  const base = tier.split('_')[0];
  return (['bronze', 'silver', 'gold', 'platinum', 'legend'] as const).includes(base as GuildTierBase)
    ? (base as GuildTierBase)
    : 'bronze';
}

// No purple/gradients (PRD Appendix B) — Legend uses primary blue, not web's purple.
export const TIER_BADGE: Record<GuildTierBase, { classes: string; label: string; emoji: string }> = {
  bronze: { classes: 'bg-amber-100 text-amber-700', label: 'Bronze', emoji: '🥉' },
  silver: { classes: 'bg-neutral-200 text-neutral-700', label: 'Silver', emoji: '🥈' },
  gold: { classes: 'bg-amber-200 text-amber-800', label: 'Gold', emoji: '🥇' },
  platinum: { classes: 'bg-teal-100 text-teal-700', label: 'Platinum', emoji: '💎' },
  legend: { classes: 'bg-primary-100 text-primary-700', label: 'Legend', emoji: '👑' },
};

const ROLE_BADGE: Record<GuildMemberRole, string> = {
  captain: 'bg-amber-100 text-amber-700',
  veteran: 'bg-blue-100 text-blue-700',
  recruiter: 'bg-teal-100 text-teal-700',
  member: '',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function secondsUntil(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

function formatCountdown(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function SectionCard({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-neutral-700">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export function GuildDetailView({
  guild,
  backTo,
  actions,
}: {
  guild: GuildDetail;
  backTo?: string;
  actions?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { classes, label, emoji } = TIER_BADGE[tierBase(guild.tier)];
  const tierPct = guild.tierXpRequired > 0 ? Math.min(100, Math.round((guild.guildXp / guild.tierXpRequired) * 100)) : 100;
  const [warSecs, setWarSecs] = useState(guild.activeWar ? secondsUntil(guild.activeWar.endsAt) : 0);

  useEffect(() => {
    if (!guild.activeWar) return;
    const id = setInterval(() => setWarSecs(secondsUntil(guild.activeWar!.endsAt)), 1000);
    return () => clearInterval(id);
  }, [guild.activeWar]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {backTo && (
        <Link to={backTo} className="inline-flex items-center gap-1.5 text-sm text-neutral-500">
          ← {t('guild.guildLabel')}
        </Link>
      )}

      {/* Header */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-start gap-4">
          <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-4xl ${guild.tier === 'legend' ? 'animate-pulse' : ''}`}>
            {guild.crestEmoji}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-neutral-900">{guild.name}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${classes}`}>{emoji} {label}</span>
            </div>
            {guild.city && <p className="text-sm text-neutral-500">📍 {guild.city}</p>}
            {guild.description && <p className="mt-1 text-sm text-neutral-600">{guild.description}</p>}
            <p className="text-sm text-neutral-500">{t('guild.members', { count: guild.memberCount })} / {guild.maxMembers}</p>

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
                <span>{t('guild.tierXP')}</span>
                <span className="tabular-nums">{guild.guildXp.toLocaleString()} / {guild.tierXpRequired.toLocaleString()}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-neutral-200">
                <div className="h-full rounded-full bg-primary-500" style={{ width: `${tierPct}%` }} />
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-neutral-500">{t('guild.treasury')}</p>
            <p className="text-lg font-bold text-amber-600">
              {guild.treasuryBalance !== null ? guild.treasuryBalance.toLocaleString() : '—'} <span className="text-sm font-normal">🪙</span>
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 divide-x divide-neutral-200 rounded-xl border border-neutral-200">
          {[
            { label: t('guild.warsWon', { count: guild.warWins }), value: guild.warWins.toLocaleString() },
            { label: t('guild.warsLost', { count: guild.warLosses }), value: guild.warLosses.toLocaleString() },
            { label: t('guild.members', { count: guild.memberCount }), value: `${guild.memberCount}/${guild.maxMembers}` },
          ].map((s, i) => (
            <div key={i} className="flex flex-col items-center py-3">
              <span className="text-sm font-bold text-neutral-900">{s.value}</span>
              <span className="text-xs text-neutral-400">{s.label}</span>
            </div>
          ))}
        </div>

        {actions && <div className="mt-4">{actions}</div>}
      </div>

      {/* Active war */}
      {guild.activeWar && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-red-700">{t('guild.activeWar')}</h2>
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
              {t('guild.endsIn', { time: formatCountdown(warSecs) })}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-center">
              <span className="text-3xl">{guild.crestEmoji}</span>
              <p className="mt-1 text-sm font-bold text-neutral-900">{guild.name}</p>
              <p className="text-2xl font-bold text-primary-600">{guild.activeWar.myScore}</p>
            </div>
            <span className="text-xl font-bold text-neutral-400">VS</span>
            <div className="text-center">
              <span className="text-3xl">{guild.activeWar.opponentCrestEmoji}</span>
              <p className="mt-1 text-sm font-bold text-neutral-900">{guild.activeWar.opponentName}</p>
              <p className="text-2xl font-bold text-red-600">{guild.activeWar.opponentScore}</p>
            </div>
          </div>
        </div>
      )}

      {/* Active quests */}
      {guild.activeQuests.length > 0 && (
        <SectionCard title="🎯 Guild Quests">
          <div className="divide-y divide-neutral-100">
            {guild.activeQuests.map((q) => (
              <div key={q.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-neutral-900">{q.title}</p>
                    {q.description && <p className="mt-0.5 text-xs text-neutral-500">{q.description}</p>}
                    <div className="mt-2">
                      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200">
                        <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.min(100, Math.round(q.progressPct))}%` }} />
                      </div>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                    +{q.rewardXp.toLocaleString()} XP
                  </span>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Members */}
      <SectionCard title={`👥 ${t('guild.membersSection')} (${guild.memberCount})`}>
        <div className="divide-y divide-neutral-100">
          {guild.members.slice(0, 20).map((m) => (
            <Link
              key={m.userId}
              to="/profile/$username"
              params={{ username: m.username }}
              className="flex items-center gap-3 px-5 py-3 active:bg-neutral-50"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl">{m.avatarEmoji}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-neutral-900 truncate">{m.displayName ?? `@${m.username}`}</span>
                  {m.role !== 'member' && (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${ROLE_BADGE[m.role]}`}>{m.role}</span>
                  )}
                </div>
                <p className="text-xs text-neutral-500">{t('guild.xpContributed', { xp: m.contributionScore.toLocaleString() })}</p>
              </div>
            </Link>
          ))}
          {guild.memberCount > 20 && (
            <div className="px-5 py-3 text-center text-xs text-neutral-400">+{guild.memberCount - 20} more</div>
          )}
        </div>
      </SectionCard>

      {/* War history */}
      {guild.warHistory.length > 0 && (
        <SectionCard title={t('guild.warHistory')}>
          <div className="divide-y divide-neutral-100">
            {guild.warHistory.map((w) => (
              <div key={w.id} className="flex items-center gap-4 px-5 py-3">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    w.result === 'win' ? 'bg-teal-100 text-teal-700' : w.result === 'loss' ? 'bg-red-100 text-red-700' : 'bg-neutral-100 text-neutral-600'
                  }`}
                >
                  {w.result === 'win' ? 'W' : w.result === 'loss' ? 'L' : 'D'}
                </span>
                <span className="text-xl">{w.opponentCrestEmoji}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-900 truncate">vs {w.opponentName}</p>
                  <p className="text-xs text-neutral-500">
                    {w.myScore.toLocaleString()} – {w.opponentScore.toLocaleString()} · {formatDate(w.endedAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Alliance */}
      {guild.allianceHistory.length > 0 && (
        <SectionCard title={t('guild.allianceHistory')}>
          <div className="divide-y divide-neutral-100">
            {guild.allianceHistory.map((a) => (
              <div key={a.id} className="flex items-center gap-4 px-5 py-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-100 text-sm">🤝</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-900">{a.allianceName}</p>
                  <p className="text-xs text-neutral-500">
                    {a.role === 'initiator' ? t('guild.allianceFounded') : t('guild.allianceJoined')} {formatDate(a.joinedAt)}
                    {a.leftAt ? ` · ${t('guild.allianceLeft', { date: formatDate(a.leftAt) })}` : ` · ${t('guild.allianceActive')}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <p className="text-center text-xs text-neutral-400">Founded {formatDate(guild.createdAt)}</p>
    </div>
  );
}
