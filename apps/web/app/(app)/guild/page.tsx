"use client";

/**
 * app/(app)/guild/page.tsx
 *
 * Guild page (web version).
 * If not in a guild: discovery panel with local guilds to join.
 * If in a guild: guild header, tier progress, treasury, war status, members, history.
 */

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GuildTier = "bronze" | "silver" | "gold" | "platinum" | "diamond";

interface GuildSummary {
  id: string;
  name: string;
  emblem: string;
  tier: GuildTier;
  warsWon: number;
  memberCount: number;
  city: string;
}

interface GuildMember {
  userId: string;
  username: string;
  avatarEmoji: string;
  role: "leader" | "officer" | "member";
  contribution: number;
}

interface WarHistory {
  id: string;
  opponentName: string;
  result: "win" | "loss" | "draw";
  score: string;
  endedAt: string;
}

interface ActiveWar {
  opponentName: string;
  opponentEmblem: string;
  myScore: number;
  opponentScore: number;
  endsAt: string;
}

interface AllianceHistory {
  id: string;
  allianceName: string;
  role: "founder" | "member";
  joinedAt: string;
  leftAt: string | null;
}

interface MyGuild {
  id: string;
  name: string;
  emblem: string;
  tier: GuildTier;
  tierXP: number;
  tierXPRequired: number;
  treasuryBalance: number;
  memberCount: number;
  maxMembers: number;
  members: GuildMember[];
  warHistory: WarHistory[];
  allianceHistory: AllianceHistory[];
  activeWar: ActiveWar | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIER_BADGE: Record<GuildTier, { classes: string; label: string }> = {
  bronze: { classes: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300", label: "Bronze" },
  silver: { classes: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300", label: "Silver" },
  gold: { classes: "bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200", label: "Gold" },
  platinum: { classes: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300", label: "Platinum" },
  diamond: { classes: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300", label: "Diamond" },
};

const ROLE_BADGE: Record<string, string> = {
  leader: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200",
  officer: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  member: "",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function secondsRemaining(iso: string): number {
  return Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000));
}

function formatCountdown(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ---------------------------------------------------------------------------
// Discovery panel
// ---------------------------------------------------------------------------

interface DiscoveryProps {
  guilds: GuildSummary[];
  loading: boolean;
  onJoin: (id: string) => Promise<void>;
  joiningId: string | null;
}

function GuildDiscovery({ guilds, loading, onJoin, joiningId }: DiscoveryProps) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Join a Guild</h1>
        <p className="mt-1 text-sm text-neutral-500">Guilds near you — compete in wars and climb the tiers</p>
      </div>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex gap-4">
                <div className="h-12 w-12 rounded-full bg-neutral-200 dark:bg-neutral-700" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
                  <div className="h-3 w-48 rounded bg-neutral-200 dark:bg-neutral-700" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        guilds.map((g) => {
          const { classes, label } = TIER_BADGE[g.tier];
          return (
            <div key={g.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
              <Link href={`/guilds/${g.id}`}>
                <span className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-neutral-100 text-3xl hover:opacity-80 dark:bg-neutral-800">{g.emblem}</span>
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/guilds/${g.id}`} className="hover:underline">
                    <h3 className="font-bold text-neutral-900 dark:text-neutral-100">{g.name}</h3>
                  </Link>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${classes}`}>{label}</span>
                </div>
                <p className="text-xs text-neutral-500">{g.city} · {g.memberCount} members · {g.warsWon} wars won</p>
              </div>
              <div className="flex gap-2">
                <Link href={`/guilds/${g.id}`} className="rounded-xl border border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300">
                  View
                </Link>
                <button
                  disabled={joiningId === g.id}
                  onClick={() => onJoin(g.id)}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {joiningId === g.id ? "Joining…" : "Join"}
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guild dashboard
// ---------------------------------------------------------------------------

interface GuildDashboardProps {
  guild: MyGuild;
}

function GuildDashboard({ guild }: GuildDashboardProps) {
  const { classes, label } = TIER_BADGE[guild.tier];
  const tierPct = Math.min(100, Math.round((guild.tierXP / guild.tierXPRequired) * 100));
  const [warSecs, setWarSecs] = useState(guild.activeWar ? secondsRemaining(guild.activeWar.endsAt) : 0);

  useEffect(() => {
    if (!guild.activeWar) return;
    const id = setInterval(() => setWarSecs(secondsRemaining(guild.activeWar!.endsAt)), 1000);
    return () => clearInterval(id);
  }, [guild.activeWar]);

  return (
    <div className="space-y-5">
      {/* Guild header */}
      <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex flex-wrap items-start gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-neutral-100 text-4xl dark:bg-neutral-800">{guild.emblem}</span>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-50">{guild.name}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${classes}`}>{label}</span>
            </div>
            <p className="text-sm text-neutral-500">{guild.memberCount}/{guild.maxMembers} members</p>

            {/* Tier progress */}
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
                <span>Tier XP</span>
                <span className="tabular-nums">{guild.tierXP.toLocaleString()} / {guild.tierXPRequired.toLocaleString()}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${tierPct}%` }} />
              </div>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-neutral-500">Treasury</p>
            <p className="text-lg font-bold text-amber-600">{guild.treasuryBalance.toLocaleString()} <span className="text-sm font-normal">🪙</span></p>
          </div>
        </div>
      </div>

      {/* Active war */}
      {guild.activeWar && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-800 dark:bg-red-950/20">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold text-red-700 dark:text-red-300">⚔️ Active War</h2>
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900 dark:text-red-300">
              Ends in {formatCountdown(warSecs)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-center">
              <span className="text-3xl">{guild.emblem}</span>
              <p className="mt-1 text-sm font-bold text-neutral-900 dark:text-neutral-100">{guild.name}</p>
              <p className="text-2xl font-bold text-blue-600">{guild.activeWar.myScore}</p>
            </div>
            <span className="text-xl font-bold text-neutral-400">VS</span>
            <div className="text-center">
              <span className="text-3xl">{guild.activeWar.opponentEmblem}</span>
              <p className="mt-1 text-sm font-bold text-neutral-900 dark:text-neutral-100">{guild.activeWar.opponentName}</p>
              <p className="text-2xl font-bold text-red-600">{guild.activeWar.opponentScore}</p>
            </div>
          </div>
        </div>
      )}

      {/* Members */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Members</h2>
        </div>
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {guild.members.map((m) => (
            <Link
              key={m.userId}
              href={`/profile/${m.userId}`}
              className="flex items-center gap-3 px-5 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">{m.avatarEmoji}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">@{m.username}</span>
                  {m.role !== "member" && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${ROLE_BADGE[m.role]}`}>{m.role}</span>
                  )}
                </div>
                <p className="text-xs text-neutral-500">{m.contribution.toLocaleString()} XP contributed</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* War history */}
      {guild.warHistory.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">⚔️ War History</h2>
          </div>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {guild.warHistory.map((w) => (
              <div key={w.id} className="flex items-center gap-4 px-5 py-3">
                <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${w.result === "win" ? "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300" : w.result === "loss" ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800"}`}>
                  {w.result === "win" ? "W" : w.result === "loss" ? "L" : "D"}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">vs {w.opponentName}</p>
                  <p className="text-xs text-neutral-500">{w.score} · {formatDate(w.endedAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alliance history — PRD §13: "every Alliance formed is permanently visible" */}
      {guild.allianceHistory && guild.allianceHistory.length > 0 && (
        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">🤝 Alliance History</h2>
          </div>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {guild.allianceHistory.map((a) => (
              <div key={a.id} className="flex items-center gap-4 px-5 py-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-100 text-sm dark:bg-teal-900">🤝</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{a.allianceName}</p>
                  <p className="text-xs text-neutral-500">
                    {a.role === "founder" ? "Founded" : "Joined"} {formatDate(a.joinedAt)}
                    {a.leftAt ? ` · Left ${formatDate(a.leftAt)}` : " · Active"}
                  </p>
                </div>
                {!a.leftAt && (
                  <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">Active</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Guild page — shows discovery or dashboard depending on guild membership.
 */
export default function GuildPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [myGuild, setMyGuild] = useState<MyGuild | null | undefined>(undefined); // undefined = loading
  const [nearbyGuilds, setNearbyGuilds] = useState<GuildSummary[]>([]);
  const [loadingNearby, setLoadingNearby] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/guild/mine", { credentials: "include" });
        if (res.status === 401) { window.location.href = "/auth/login"; return; }
        if (res.status === 404) {
          setMyGuild(null);
          setLoadingNearby(true);
          const nearbyRes = await fetch("/api/guilds/nearby?limit=3", { credentials: "include" });
          const data = (await nearbyRes.json()) as { guilds: GuildSummary[] };
          setNearbyGuilds(data.guilds);
          setLoadingNearby(false);
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
          const errCode = typeof body.error === "string" ? null : body.error?.code ?? null;
          const err = new Error(errMsg ?? body.message ?? "Failed to load guild") as Error & { code?: string | null };
          err.code = errCode;
          throw err;
        }
        setMyGuild((await res.json()) as MyGuild);
      } catch (e) {
        const err = e as Error & { code?: string | null };
        setError(e instanceof Error ? translateApiError(tRef.current, err.code, err.message || "Unknown error") : "Unknown error");
      }
    })();
  }, []);

  async function handleJoin(guildId: string) {
    setJoiningId(guildId);
    try {
      const res = await fetch(`/api/guilds/${guildId}/join`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
        const errCode = typeof body.error === "string" ? null : body.error?.code ?? null;
        const err = new Error(errMsg ?? body.message ?? "Failed to join") as Error & { code?: string | null };
        err.code = errCode;
        throw err;
      }
      // Reload page state after joining
      const gRes = await fetch("/api/guild/mine", { credentials: "include" });
      setMyGuild((await gRes.json()) as MyGuild);
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(e instanceof Error ? translateApiError(t, err.code, err.message || "Error joining guild") : "Error joining guild");
    } finally {
      setJoiningId(null);
    }
  }

  if (myGuild === undefined) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-4 sm:p-6">
      {myGuild ? (
        <GuildDashboard guild={myGuild} />
      ) : (
        <GuildDiscovery
          guilds={nearbyGuilds}
          loading={loadingNearby}
          onJoin={handleJoin}
          joiningId={joiningId}
        />
      )}
    </div>
  );
}
