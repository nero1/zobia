"use client";

/**
 * app/(app)/guild-discovery/page.tsx
 *
 * Guild Discovery page — web equivalent of the Expo onboarding/guild-discovery screen.
 * Recommends up to 3 guilds based on the authenticated user's city.
 * Accessible at /guild-discovery (shown after 24h via notifications or manual nav).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Guild {
  id: string;
  name: string;
  crestEmoji: string;
  description: string | null;
  city: string | null;
  tier: string;
  memberCount: number;
  guildXp: number;
  warWins: number;
  isRecruiting: boolean;
  sameCity: boolean;
}

interface DiscoveryData {
  guilds: Guild[];
  userCity: string | null;
  guildEmphasis: "guild" | "solo" | null;
  soloNote: string | null;
  tooNew?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIER_XP_BOOST: Record<string, number> = {
  bronze: 5,
  silver: 10,
  gold: 20,
  platinum: 30,
  legend: 50,
};

const TIER_BADGE: Record<string, string> = {
  bronze: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  silver: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  gold: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  platinum: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  legend: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
};

async function fetchDiscovery(): Promise<DiscoveryData> {
  const res = await fetch("/api/guilds/discovery", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load guild recommendations");
  const json = (await res.json()) as { data: DiscoveryData };
  return json.data;
}

async function joinGuild(guildId: string): Promise<void> {
  const res = await fetch(`/api/guilds/${guildId}/join`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as {
      message?: string;
      error?: string | { code?: string | null; message?: string };
    };
    const errMsg =
      typeof json.error === "string" ? json.error : json.error?.message;
    const errCode = typeof json.error === "string" ? null : json.error?.code ?? null;
    const err = new Error(errMsg ?? json.message ?? "Failed to join guild") as Error & {
      code?: string | null;
    };
    err.code = errCode;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Guild card
// ---------------------------------------------------------------------------

function GuildCard({
  guild,
  joinedId,
  joiningId,
  onJoin,
}: {
  guild: Guild;
  joinedId: string | null;
  joiningId: string | null;
  onJoin: (id: string) => void;
}) {
  const isJoined = joinedId === guild.id;
  const isJoining = joiningId === guild.id;
  const anyJoined = joinedId !== null;
  const xpBoost = TIER_XP_BOOST[guild.tier] ?? 5;
  const tierBadge = TIER_BADGE[guild.tier] ?? TIER_BADGE.bronze;

  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        isJoined
          ? "border-teal-400 bg-teal-50 dark:border-teal-600 dark:bg-teal-950/30"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <div className="flex items-center gap-4">
        {/* Crest */}
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-neutral-100 text-3xl dark:bg-neutral-800">
          {guild.crestEmoji}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-bold text-neutral-900 dark:text-neutral-50">
              {guild.name}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${tierBadge}`}>
              {guild.tier}
            </span>
          </div>

          {guild.city && (
            <p className="mt-0.5 text-xs text-neutral-500">
              📍 {guild.city}
              {guild.sameCity && (
                <span className="ml-1.5 rounded-full bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                  Near you
                </span>
              )}
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span>{(guild.memberCount ?? 0).toLocaleString()} members</span>
            {guild.warWins > 0 && <span>· {guild.warWins} wars won</span>}
            <span className="rounded-full bg-blue-50 px-2 py-0.5 font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              +{xpBoost}% XP
            </span>
          </div>

          {guild.description && (
            <p className="mt-1 line-clamp-2 text-xs text-neutral-500">{guild.description}</p>
          )}
        </div>

        {/* Action */}
        <div className="shrink-0">
          {isJoined ? (
            <span className="rounded-xl bg-teal-100 px-4 py-2 text-sm font-bold text-teal-700 dark:bg-teal-900 dark:text-teal-300">
              ✓ Joined!
            </span>
          ) : (
            <button
              onClick={() => onJoin(guild.id)}
              disabled={isJoining || anyJoined}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isJoining ? "Joining…" : "Join"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function GuildCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 shrink-0 rounded-2xl bg-neutral-200 dark:bg-neutral-700" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-36 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-3 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-3 w-48 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
        <div className="h-9 w-16 rounded-xl bg-neutral-200 dark:bg-neutral-700" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function GuildDiscoveryPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const [joinedId, setJoinedId] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["guilds", "discovery"],
    queryFn: fetchDiscovery,
    staleTime: 120_000,
  });

  const joinMutation = useMutation({
    mutationFn: joinGuild,
    onMutate: (guildId) => {
      setJoiningId(guildId);
      setJoinError(null);
    },
    onSuccess: (_, guildId) => {
      setJoinedId(guildId);
      setJoiningId(null);
      void queryClient.invalidateQueries({ queryKey: ["guilds"] });
    },
    onError: (err) => {
      setJoiningId(null);
      const error = err as Error & { code?: string | null };
      setJoinError(
        err instanceof Error
          ? translateApiError(t, error.code, error.message || "Failed to join guild")
          : "Failed to join guild"
      );
    },
  });

  const guilds = data?.guilds?.slice(0, 3) ?? [];

  return (
    <div className="mx-auto max-w-xl space-y-5 py-4">
      {/* Header */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
          Almost There
        </p>
        <h1 className="mt-1 text-2xl font-extrabold text-neutral-900 dark:text-neutral-50">
          Crews near you are recruiting
        </h1>
        <p className="mt-1.5 text-sm text-neutral-600 dark:text-neutral-400">
          Joining a Guild earns you bonus XP on everything you do.
        </p>
        {data?.userCity && (
          <p className="mt-1 text-xs text-neutral-400">Showing guilds near {data.userCity}</p>
        )}
      </div>

      {/* Solo note */}
      {data?.soloNote && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
          💡 {data.soloNote}
        </div>
      )}

      {/* Too new notice */}
      {data?.tooNew && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-center dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-2xl">⏳</p>
          <p className="mt-2 font-semibold text-amber-800 dark:text-amber-300">Come back soon!</p>
          <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
            Guild recommendations unlock after your first 24 hours on Zobia.
          </p>
        </div>
      )}

      {/* Guild cards */}
      {isLoading ? (
        <>
          <GuildCardSkeleton />
          <GuildCardSkeleton />
          <GuildCardSkeleton />
        </>
      ) : isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-5 text-center dark:border-red-800 dark:bg-red-950/30">
          <p className="text-sm text-red-700 dark:text-red-300">
            Could not load guild recommendations. Check your connection.
          </p>
          <button
            onClick={() => void refetch()}
            className="mt-3 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/40"
          >
            Retry
          </button>
        </div>
      ) : !data?.tooNew && guilds.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-4 py-10 text-center dark:border-neutral-800 dark:bg-neutral-900">
          <p className="text-4xl">🏛️</p>
          <p className="mt-3 font-semibold text-neutral-900 dark:text-neutral-50">
            No guilds near your city yet
          </p>
          <p className="mt-1 text-sm text-neutral-500">
            Check back soon — or{" "}
            <Link href="/guilds" className="text-blue-600 hover:underline dark:text-blue-400">
              browse all guilds
            </Link>
            .
          </p>
        </div>
      ) : (
        guilds.map((guild) => (
          <GuildCard
            key={guild.id}
            guild={guild}
            joinedId={joinedId}
            joiningId={joiningId}
            onJoin={(id) => joinMutation.mutate(id)}
          />
        ))
      )}

      {/* Join error */}
      {joinError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {joinError}
        </div>
      )}

      {/* CTA */}
      {!data?.tooNew && (
        <div className="flex flex-col gap-3 pt-2 sm:flex-row">
          <button
            onClick={() => router.push("/home")}
            className={`flex-1 rounded-xl px-5 py-3 text-sm font-semibold transition-colors ${
              joinedId
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            {joinedId ? "Continue to Home →" : "Explore on my own"}
          </button>
          {!joinedId && (
            <Link
              href="/guilds"
              className="flex-1 rounded-xl border border-blue-200 bg-blue-50 px-5 py-3 text-center text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900/40"
            >
              Browse All Guilds
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
