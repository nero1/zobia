"use client";

/**
 * components/home/GuildDiscoveryPanel.tsx
 *
 * Relocated, unchanged-behavior Guild Discovery panel (PRD §4 — shown to
 * users with no guild) — was inline in app/(app)/home/page.tsx. Fetches
 * GET /api/guilds/discovery, which itself already returns an empty array
 * for users already in a guild.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

interface DiscoveryGuild {
  id: string;
  name: string;
  crestEmoji: string;
  tier: string;
  memberCount: number;
  warWins: number;
  city: string | null;
}

function GuildDiscoverySkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 h-4 w-40 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-neutral-200 dark:bg-neutral-700" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-28 rounded bg-neutral-200 dark:bg-neutral-700" />
              <div className="h-2.5 w-20 rounded bg-neutral-200 dark:bg-neutral-700" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GuildDiscoveryPanel() {
  const { t } = useTranslation();
  const [guilds, setGuilds] = useState<DiscoveryGuild[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/guilds/discovery", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { data?: { guilds?: DiscoveryGuild[] } } | null) => setGuilds(d?.data?.guilds ?? []))
      .catch(() => setGuilds([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <GuildDiscoverySkeleton />;
  if (!guilds || guilds.length === 0) return null;

  return (
    <div className="rounded-xl border border-blue-200 bg-white p-4 shadow-card dark:border-blue-800 dark:bg-neutral-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t("home.guildDiscovery.title")}</h2>
        <Link href="/guild" className="text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400">
          {t("home.guildDiscovery.seeAll")}
        </Link>
      </div>
      <div className="space-y-3">
        {guilds.map((guild) => (
          <div key={guild.id} className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xl dark:bg-blue-950/40">
              {guild.crestEmoji}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-50">{guild.name}</p>
              <p className="text-xs text-neutral-500">
                <span className="capitalize">{guild.tier.replace("_", " ")}</span>
                {" · "}
                {guild.memberCount} members
                {(guild.warWins ?? 0) > 0 && ` · ${guild.warWins} wars won`}
                {guild.city && ` · ${guild.city}`}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Link
                href={`/guilds/${guild.id}`}
                className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300"
              >
                {t("home.guildDiscovery.view")}
              </Link>
              <Link
                href={`/guild?join=${guild.id}`}
                className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                {t("home.guildDiscovery.join")}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
