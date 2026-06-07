"use client";

/**
 * app/(app)/guilds/[guildId]/page.tsx
 *
 * Public guild profile page.
 * Shows the full guild profile — viewable by anyone, not just members.
 * Features:
 *  - Guild header: crest emoji, name, tier badge, city, description
 *  - Stats row: members, wars won, war losses, XP total
 *  - Tier progress bar
 *  - Active war banner (if in a war)
 *  - Top members list with contribution scores
 *  - War history
 *  - Alliance history
 *  - Guild Quests summary
 *  - Join / Leave / Already-member button
 *  - Links: create room → guild room (if Platinum+)
 */

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GuildTier = "bronze" | "silver" | "gold" | "platinum" | "legend";

interface GuildMember {
  userId: string;
  username: string;
  displayName: string | null;
  avatarEmoji: string;
  role: "captain" | "veteran" | "recruiter" | "member";
  contributionScore: number;
  joinedAt: string;
}

interface WarRecord {
  id: string;
  opponentName: string;
  opponentCrestEmoji: string;
  result: "win" | "loss" | "pending";
  myScore: number;
  opponentScore: number;
  endedAt: string | null;
}

interface ActiveWar {
  id: string;
  opponentName: string;
  opponentCrestEmoji: string;
  myScore: number;
  opponentScore: number;
  endsAt: string;
  finalHour: boolean;
}

interface AllianceRecord {
  id: string;
  allianceName: string;
  role: "initiator" | "ally";
  joinedAt: string;
  leftAt: string | null;
}

interface GuildQuest {
  id: string;
  title: string;
  description: string;
  progressPct: number;
  rewardXp: number;
  endsAt: string;
}

interface GuildDetail {
  id: string;
  name: string;
  crestEmoji: string;
  description: string | null;
  city: string | null;
  tier: GuildTier;
  guildXp: number;
  tierXpRequired: number;
  memberCount: number;
  maxMembers: number;
  warWins: number;
  warLosses: number;
  treasuryBalance: number | null; // only for members
  isOpenToJoin: boolean;
  isMember: boolean;
  isCaptain: boolean;
  activeWar: ActiveWar | null;
  members: GuildMember[];
  warHistory: WarRecord[];
  allianceHistory: AllianceRecord[];
  activeQuests: GuildQuest[];
  recruitmentMode: "open" | "approval" | "invite_only";
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIER_CONFIG: Record<GuildTier, { label: string; emoji: string; classes: string; xpBoost: string }> = {
  bronze: { label: "Bronze", emoji: "🥉", classes: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300", xpBoost: "+5%" },
  silver: { label: "Silver", emoji: "🥈", classes: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300", xpBoost: "+10%" },
  gold: { label: "Gold", emoji: "🥇", classes: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300", xpBoost: "+20%" },
  platinum: { label: "Platinum", emoji: "💎", classes: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300", xpBoost: "+30%" },
  legend: { label: "Legend", emoji: "👑", classes: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300", xpBoost: "+50%" },
};

const ROLE_BADGE: Record<string, { label: string; classes: string }> = {
  captain: { label: "Captain", classes: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200" },
  veteran: { label: "Veteran", classes: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  recruiter: { label: "Recruiter", classes: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300" },
  member: { label: "", classes: "" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function secondsUntil(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

function formatCountdown(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function GuildDetailSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start gap-5">
          <div className="h-16 w-16 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className="flex-1 space-y-3">
            <div className="h-6 w-48 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-4 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-4 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
          </div>
        </div>
      </div>
      <div className="h-32 animate-pulse rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
      <div className="h-64 animate-pulse rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active War Banner (with live contribution leaderboard)
// ---------------------------------------------------------------------------

interface WarContributor {
  user_id: string;
  username: string;
  display_name: string;
  avatar_emoji: string;
  rank_name: string;
  war_points: number;
  guild_id: string;
}

function ActiveWarBanner({ war, guildId }: { war: ActiveWar; guildId: string }) {
  const [secs, setSecs] = useState(secondsUntil(war.endsAt));
  const [contributors, setContributors] = useState<WarContributor[]>([]);

  useEffect(() => {
    const t = setInterval(() => setSecs(secondsUntil(war.endsAt)), 1000);
    return () => clearInterval(t);
  }, [war.endsAt]);

  // Fetch per-member war contribution leaderboard (refreshes every 60 s)
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`/api/guilds/wars/${war.id}/leaderboard`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { data?: { contributions?: WarContributor[] } } | null) => {
          if (!cancelled && d?.data?.contributions) setContributors(d.data.contributions);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [war.id]);

  // Split contributors by own guild vs opponent
  const myContribs = contributors.filter((c) => c.guild_id === guildId)
    .sort((a, b) => b.war_points - a.war_points)
    .slice(0, 5);

  return (
    <div className={`rounded-xl border p-5 space-y-4 ${war.finalHour ? "border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/30" : "border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/20"}`}>
      <div className="flex items-center justify-between">
        <h2 className={`font-bold ${war.finalHour ? "text-red-700 dark:text-red-300" : "text-orange-700 dark:text-orange-300"}`}>
          {war.finalHour ? "🔥 FINAL HOUR — WAR ONGOING" : "⚔️ Active Guild War"}
        </h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${war.finalHour ? "bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-200" : "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300"}`}>
          {formatCountdown(secs)}
        </span>
      </div>

      {/* Score scoreboard */}
      <div className="flex items-center justify-around">
        <div className="text-center">
          <p className="text-4xl font-black tabular-nums text-blue-600">{war.myScore.toLocaleString()}</p>
          <p className="mt-1 text-xs text-neutral-500">Our Score</p>
        </div>
        <div className="text-center">
          <span className="text-2xl font-bold text-neutral-400">VS</span>
          <div className="flex items-center gap-2 justify-center mt-1">
            <span className="text-xl">{war.opponentCrestEmoji}</span>
            <p className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{war.opponentName}</p>
          </div>
        </div>
        <div className="text-center">
          <p className="text-4xl font-black tabular-nums text-red-600">{war.opponentScore.toLocaleString()}</p>
          <p className="mt-1 text-xs text-neutral-500">Their Score</p>
        </div>
      </div>

      {/* Top contributors from our guild */}
      {myContribs.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">Top Contributors</p>
          <div className="space-y-1">
            {myContribs.map((c, i) => (
              <div key={c.user_id} className="flex items-center gap-2 rounded-lg px-3 py-1.5 bg-white/60 dark:bg-neutral-900/40">
                <span className="w-4 shrink-0 text-xs font-bold text-neutral-400 tabular-nums">{i + 1}</span>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-base dark:bg-neutral-800">
                  {c.avatar_emoji}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {c.display_name || c.username}
                </span>
                <span className="ml-auto shrink-0 text-xs font-bold tabular-nums text-blue-600 dark:text-blue-400">
                  {c.war_points.toLocaleString()} pts
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Members list
// ---------------------------------------------------------------------------

function MemberRow({ member }: { member: GuildMember }) {
  const role = ROLE_BADGE[member.role];
  return (
    <Link
      href={`/profile/${member.userId}`}
      className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">
        {member.avatarEmoji}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
            {member.displayName ?? `@${member.username}`}
          </span>
          <span className="shrink-0 text-xs text-neutral-400">@{member.username}</span>
          {member.role !== "member" && role.label && (
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${role.classes}`}>
              {role.label}
            </span>
          )}
        </div>
        <p className="text-xs text-neutral-500">{member.contributionScore.toLocaleString()} pts contributed</p>
      </div>
      <span className="shrink-0 text-xs text-neutral-400">{formatDate(member.joinedAt)}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// War history
// ---------------------------------------------------------------------------

function WarHistoryRow({ war }: { war: WarRecord }) {
  const isPending = war.result === "pending";
  return (
    <div className="flex items-center gap-4 px-5 py-3">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        war.result === "win" ? "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300"
        : war.result === "loss" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
        : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800"
      }`}>
        {war.result === "win" ? "W" : war.result === "loss" ? "L" : "…"}
      </span>
      <span className="text-xl">{war.opponentCrestEmoji}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
          vs {war.opponentName}
        </p>
        <p className="text-xs text-neutral-500">
          {war.myScore.toLocaleString()} – {war.opponentScore.toLocaleString()}
          {war.endedAt && ` · ${formatDate(war.endedAt)}`}
          {isPending && " · In progress"}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alliance history
// ---------------------------------------------------------------------------

function AllianceRow({ alliance }: { alliance: AllianceRecord }) {
  return (
    <div className="flex items-center gap-4 px-5 py-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-100 text-sm dark:bg-teal-900">
        🤝
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{alliance.allianceName}</p>
        <p className="text-xs text-neutral-500">
          {alliance.role === "initiator" ? "Founded" : "Joined"} {formatDate(alliance.joinedAt)}
          {alliance.leftAt ? ` · Left ${formatDate(alliance.leftAt)}` : " · Active"}
        </p>
      </div>
      {!alliance.leftAt && (
        <span className="shrink-0 rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">
          Active
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active quests
// ---------------------------------------------------------------------------

function QuestRow({ quest }: { quest: GuildQuest }) {
  const pct = Math.min(100, Math.round(quest.progressPct));
  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{quest.title}</p>
          {quest.description && (
            <p className="mt-0.5 text-xs text-neutral-500">{quest.description}</p>
          )}
          <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
              <span>{pct}% complete</span>
              <span>Ends {formatDate(quest.endsAt)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
              <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">
          +{quest.rewardXp.toLocaleString()} XP
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section card wrapper
// ---------------------------------------------------------------------------

function SectionCard({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{title}</h2>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function GuildProfilePage() {
  const params = useParams<{ guildId: string }>();
  const router = useRouter();
  const guildId = params.guildId;

  const [guild, setGuild] = useState<GuildDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!guildId) return;
    try {
      const res = await fetch(`/api/guilds/${guildId}`, { credentials: "include" });
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (res.status === 404) { setGuild(null); return; }
      if (!res.ok) throw new Error("Failed to load guild");
      const json = (await res.json()) as { guild?: GuildDetail; data?: GuildDetail };
      setGuild(json.guild ?? json.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }, [guildId]);

  useEffect(() => { void load(); }, [load]);

  async function handleJoin() {
    if (!guildId) return;
    setActionPending(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/join`, { method: "POST", credentials: "include" });
      const json = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(json.message ?? "Failed to join guild");
      setActionMsg("You have joined the guild!");
      await load();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Error joining guild");
    } finally {
      setActionPending(false);
    }
  }

  async function handleLeave() {
    if (!guildId || !confirm("Leave this guild? You will lose your contribution score.")) return;
    setActionPending(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/members`, { method: "DELETE", credentials: "include" });
      const json = (await res.json()) as { message?: string };
      if (!res.ok) throw new Error(json.message ?? "Failed to leave guild");
      setActionMsg("You have left the guild.");
      router.push("/guild");
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Error leaving guild");
      setActionPending(false);
    }
  }

  if (guild === undefined) return <GuildDetailSkeleton />;

  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      </div>
    );
  }

  if (!guild) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-center">
        <span className="text-5xl">🏰</span>
        <h1 className="mt-3 text-xl font-bold text-neutral-900 dark:text-neutral-50">Guild not found</h1>
        <p className="mt-1 text-sm text-neutral-500">This guild may have been disbanded or the link is incorrect.</p>
        <Link href="/guild" className="mt-4 inline-block rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
          Browse Guilds
        </Link>
      </div>
    );
  }

  const { label: tierLabel, emoji: tierEmoji, classes: tierClasses, xpBoost } = TIER_CONFIG[guild.tier] ?? TIER_CONFIG.bronze;
  const tierPct = guild.tierXpRequired > 0 ? Math.min(100, Math.round((guild.guildXp / guild.tierXpRequired) * 100)) : 100;
  const recruitmentLabel: Record<string, string> = {
    open: "Open to all",
    approval: "Application required",
    invite_only: "Invite only",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
      {/* Back link */}
      <Link href="/guild" className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">
        ← All Guilds
      </Link>

      {/* Guild header */}
      <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {/* Crest — Legend tier gets a pulse animation (no gradients per PRD Appendix B) */}
          <div className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-neutral-100 text-5xl dark:bg-neutral-800${guild.tier === 'legend' ? ' animate-pulse' : ''}`}>
            {guild.crestEmoji}
          </div>

          <div className="flex-1 min-w-0">
            {/* Name + tier */}
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-black text-neutral-900 dark:text-neutral-50">{guild.name}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${tierClasses}`}>
                {tierEmoji} {tierLabel}
              </span>
              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                {xpBoost} XP
              </span>
            </div>

            {/* City */}
            {guild.city && (
              <p className="mt-1 text-sm text-neutral-500">📍 {guild.city}</p>
            )}

            {/* Description */}
            {guild.description && (
              <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{guild.description}</p>
            )}

            {/* Recruitment mode */}
            <p className="mt-1 text-xs text-neutral-400">{recruitmentLabel[guild.recruitmentMode] ?? guild.recruitmentMode}</p>

            {/* Tier XP progress */}
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
                <span>Tier progress</span>
                <span className="tabular-nums">{guild.guildXp.toLocaleString()} / {guild.tierXpRequired.toLocaleString()}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${tierPct}%` }} />
              </div>
            </div>
          </div>

          {/* Action button */}
          <div className="shrink-0">
            {guild.isMember ? (
              <button
                onClick={handleLeave}
                disabled={actionPending || guild.isCaptain}
                title={guild.isCaptain ? "Captains cannot leave. Transfer captaincy first." : undefined}
                className="rounded-xl border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {actionPending ? "…" : guild.isCaptain ? "Captain" : "Leave Guild"}
              </button>
            ) : guild.isOpenToJoin ? (
              <button
                onClick={handleJoin}
                disabled={actionPending}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {actionPending ? "Joining…" : "Join Guild"}
              </button>
            ) : (
              <span className="rounded-xl border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-400 dark:border-neutral-700">
                {guild.recruitmentMode === "invite_only" ? "Invite only" : "Apply required"}
              </span>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="mt-5 grid grid-cols-4 divide-x divide-neutral-200 rounded-xl border border-neutral-200 dark:divide-neutral-700 dark:border-neutral-700">
          {[
            { label: "Members", value: `${guild.memberCount}/${guild.maxMembers}` },
            { label: "Wars Won", value: guild.warWins.toLocaleString() },
            { label: "Wars Lost", value: guild.warLosses.toLocaleString() },
            { label: "Treasury", value: guild.treasuryBalance !== null ? `${guild.treasuryBalance.toLocaleString()} 🪙` : "—" },
          ].map(({ label, value }) => (
            <div key={label} className="flex flex-col items-center py-3 px-2">
              <span className="text-lg font-bold text-neutral-900 dark:text-neutral-50">{value}</span>
              <span className="text-xs text-neutral-400">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Action feedback message */}
      {actionMsg && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${actionMsg.startsWith("Error") || actionMsg.includes("Failed") ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300" : "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300"}`}>
          {actionMsg}
        </div>
      )}

      {/* Active war banner */}
      {guild.activeWar && <ActiveWarBanner war={guild.activeWar} guildId={guild.id} />}

      {/* Active guild quests */}
      {guild.activeQuests.length > 0 && (
        <SectionCard title="🎯 Guild Quests">
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {guild.activeQuests.map((q) => <QuestRow key={q.id} quest={q} />)}
          </div>
        </SectionCard>
      )}

      {/* Members */}
      <SectionCard title={`👥 Members (${guild.memberCount})`}>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {guild.members.slice(0, 20).map((m) => <MemberRow key={m.userId} member={m} />)}
          {guild.memberCount > 20 && (
            <div className="px-5 py-3 text-center text-xs text-neutral-400">
              +{guild.memberCount - 20} more members
            </div>
          )}
        </div>
      </SectionCard>

      {/* War history */}
      {guild.warHistory.length > 0 && (
        <SectionCard title="⚔️ War History">
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {guild.warHistory.map((w) => <WarHistoryRow key={w.id} war={w} />)}
          </div>
        </SectionCard>
      )}

      {/* Alliance history */}
      {guild.allianceHistory.length > 0 && (
        <SectionCard title="🤝 Alliance History">
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {guild.allianceHistory.map((a) => <AllianceRow key={a.id} alliance={a} />)}
          </div>
        </SectionCard>
      )}

      {/* Guild created at */}
      <p className="text-center text-xs text-neutral-400">
        Guild founded {formatDate(guild.createdAt)}
      </p>
    </div>
  );
}
