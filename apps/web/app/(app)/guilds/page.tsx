"use client";

/**
 * app/(app)/guilds/page.tsx
 *
 * Browse Guilds — full directory with search-by-city, backed by the
 * existing GET /api/guilds (city/tier/open_only filters, cursor pagination).
 *
 * FIX: this used to unconditionally `redirect("/guild-discovery")`, whose
 * own "Browse All Guilds" CTA links back to /guilds — an infinite redirect
 * loop with no way to actually see the full guild list. This page now
 * renders that list instead of bouncing back.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

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

interface GuildRow {
  id: string;
  name: string;
  crest_emoji: string;
  description: string | null;
  city: string | null;
  tier: string;
  guild_xp: number;
  member_count: number;
  recruitment_type: string;
  wars_won: number;
  wars_lost: number;
}

interface GuildsPage {
  items: GuildRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

async function fetchGuilds({ pageParam, city }: { pageParam?: string; city: string }): Promise<GuildsPage> {
  const params = new URLSearchParams({ limit: "20" });
  if (city.trim()) params.set("city", city.trim());
  if (pageParam) params.set("cursor", pageParam);
  const res = await fetch(`/api/guilds?${params.toString()}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load guilds");
  const json = (await res.json()) as { data: GuildsPage };
  return json.data;
}

async function fetchEligibility(): Promise<Eligibility> {
  const res = await fetch(`/api/guilds?eligibility=true`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load eligibility");
  const json = (await res.json()) as { data: Eligibility };
  return json.data;
}

function CreateGuildButton() {
  const { t } = useTranslation();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [loadingEligibility, setLoadingEligibility] = useState(false);
  const [name, setName] = useState("");
  const [crestEmoji, setCrestEmoji] = useState("🛡️");
  const [description, setDescription] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [recruitmentType, setRecruitmentType] = useState<"open" | "approval" | "invite_only">("open");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const user = json?.user ?? json;
        if (user?.country) setCountry(String(user.country).toUpperCase());
      })
      .catch(() => {});
  }, []);

  async function handleOpen() {
    setOpen(true);
    setError(null);
    if (!eligibility) {
      setLoadingEligibility(true);
      try {
        setEligibility(await fetchEligibility());
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
      const res = await fetch("/api/guilds", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          crestEmoji: crestEmoji.trim() || "🛡️",
          description: description.trim() || undefined,
          city: city.trim() || undefined,
          country: country.trim().toUpperCase() || "NG",
          recruitmentType,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = typeof body.error === "object" ? body.error?.code : undefined;
        const msg = typeof body.error === "string" ? body.error : body.error?.message;
        throw new Error(translateApiError(t, code, msg ?? "Failed to create guild"));
      }
      void qc.invalidateQueries({ queryKey: ["guilds"] });
      void qc.invalidateQueries({ queryKey: ["guild"] });
      setOpen(false);
      router.push(`/guilds/${body.data.guildId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create guild");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handleOpen()}
        className="shrink-0 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
      >
        {t("guild.create.button", "Create Guild")}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setOpen(false)}>
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 dark:bg-neutral-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-3 text-lg font-bold text-neutral-900 dark:text-neutral-50">
              {t("guild.create.title", "Create a Guild")}
            </h3>

            {loadingEligibility ? (
              <p className="text-sm text-neutral-500">{t("guild.create.checking", "Checking eligibility…")}</p>
            ) : eligibility && !eligibility.canCreate ? (
              <div className="mb-4 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                <p className="font-semibold">{t("guild.create.notEligible", "You're not eligible to create a guild yet")}</p>
                {eligibility.alreadyInGuild && <p>{t("guild.create.alreadyInGuild", "You already belong to a guild.")}</p>}
                {eligibility.currentLevel < eligibility.minLevel && (
                  <p>{t("guild.create.levelRequirement", "Reach level {{minLevel}} to found a guild (you're level {{currentLevel}}).", { minLevel: eligibility.minLevel, currentLevel: eligibility.currentLevel })}</p>
                )}
                {eligibility.currentTrustScore < eligibility.minTrustScore && (
                  <p>{t("guild.create.trustRequirement", "Build your trust score to {{minTrustScore}}+ first (yours is {{currentTrustScore}}).", { minTrustScore: eligibility.minTrustScore, currentTrustScore: eligibility.currentTrustScore })}</p>
                )}
                {eligibility.currentCoinBalance < eligibility.costCoins && (
                  <p>{t("guild.create.coinsRequirement", "Guild creation costs {{costCoins}} coins (you have {{currentCoinBalance}}).", { costCoins: eligibility.costCoins, currentCoinBalance: eligibility.currentCoinBalance })}</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t("guild.create.name", "Guild Name")}</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t("guild.create.crest", "Crest Emoji")}</label>
                  <input value={crestEmoji} onChange={(e) => setCrestEmoji(e.target.value)} maxLength={4} className="w-20 rounded-lg border border-neutral-300 px-3 py-2 text-center text-lg dark:border-neutral-700 dark:bg-neutral-800" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t("guild.create.description", "Description")}</label>
                  <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t("guild.create.city", "City")}</label>
                    <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
                  </div>
                  <div className="w-24">
                    <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t("guild.create.country", "Country")}</label>
                    <input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="NG" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm uppercase dark:border-neutral-700 dark:bg-neutral-800" />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t("guild.create.recruitment", "Recruitment")}</label>
                  <select value={recruitmentType} onChange={(e) => setRecruitmentType(e.target.value as typeof recruitmentType)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800">
                    <option value="open">{t("guild.create.recruitmentOpen", "Open — anyone can join")}</option>
                    <option value="approval">{t("guild.create.recruitmentApproval", "Approval required")}</option>
                    <option value="invite_only">{t("guild.create.recruitmentInviteOnly", "Invite only")}</option>
                  </select>
                </div>
                <p className="text-xs text-neutral-500">{t("guild.create.costNote", "Creating a guild costs {{cost}} coins.", { cost: 500 })}</p>
              </div>
            )}

            {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="mt-4 flex gap-2">
              <button onClick={() => setOpen(false)} className="flex-1 rounded-lg border border-neutral-300 py-2 text-sm font-medium dark:border-neutral-700">
                {t("common.cancel", "Cancel")}
              </button>
              {(!eligibility || eligibility.canCreate) && (
                <button
                  onClick={() => void handleSubmit()}
                  disabled={submitting || !name.trim() || !country.trim() || loadingEligibility}
                  className="flex-1 rounded-lg bg-primary-600 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {submitting ? t("guild.create.creating", "Creating…") : t("guild.create.submit", "Create Guild")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function tierBase(tier: string): string {
  return tier.split("_")[0];
}

const TIER_BADGE: Record<string, string> = {
  bronze: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  silver: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300",
  gold: "bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200",
  platinum: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  legend: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
};

export default function BrowseGuildsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [city, setCity] = useState("");
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["guilds", "browse", city],
    queryFn: ({ pageParam }) => fetchGuilds({ pageParam, city }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const guilds = data?.pages.flatMap((p) => p.items) ?? [];

  async function handleJoin(guildId: string) {
    setJoiningId(guildId);
    setError(null);
    try {
      const res = await fetch(`/api/guilds/${guildId}/join`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const errMsg = typeof body.error === "string" ? body.error : body.error?.message;
        throw new Error(errMsg ?? "Failed to join guild");
      }
      void qc.invalidateQueries({ queryKey: ["guild"] });
    } catch (e) {
      setError(e instanceof Error ? translateApiError(t, null, e.message) : "Failed to join guild");
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Browse Guilds</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Search every active Guild — or{" "}
            <Link href="/guild-discovery" className="text-blue-600 hover:underline dark:text-blue-400">
              see recommendations near you
            </Link>
            .
          </p>
        </div>
        <CreateGuildButton />
      </div>

      <input
        type="text"
        value={city}
        onChange={(e) => setCity(e.target.value)}
        placeholder="Filter by city…"
        className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
      />

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" />
          ))}
        </div>
      ) : isError ? (
        <p className="py-8 text-center text-sm text-red-600">Failed to load guilds.</p>
      ) : guilds.length === 0 ? (
        <p className="py-12 text-center text-sm text-neutral-500">No guilds found.</p>
      ) : (
        <div className="space-y-3">
          {guilds.map((g) => (
            <div key={g.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <Link href={`/guilds/${g.id}`}>
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-2xl dark:bg-neutral-800">{g.crest_emoji}</span>
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/guilds/${g.id}`} className="font-bold text-neutral-900 hover:underline dark:text-neutral-100">
                    {g.name}
                  </Link>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TIER_BADGE[tierBase(g.tier)] ?? TIER_BADGE.bronze}`}>{g.tier}</span>
                </div>
                <p className="text-xs text-neutral-500">
                  {g.city ? `${g.city} · ` : ""}
                  {g.member_count} members · {g.wars_won} wars won
                </p>
              </div>
              <button
                disabled={joiningId === g.id || g.recruitment_type === "invite_only"}
                onClick={() => handleJoin(g.id)}
                className="shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {joiningId === g.id ? "Joining…" : g.recruitment_type === "invite_only" ? "Invite only" : "Join"}
              </button>
            </div>
          ))}

          {hasNextPage && (
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="w-full rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300"
            >
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
