/**
 * app/h/page.tsx
 *
 * Public Portals directory at /h: trending, popular and new hashtag portals,
 * with search. Server-rendered first page (crawlable) + client refetch for
 * search/sort (components/portals/PortalDirectory.tsx).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadManifest } from "@/lib/manifest";
import { listPortals } from "@/lib/portals/repo";
import { PortalDirectory } from "@/components/portals/PortalDirectory";
import { PortalNav } from "@/components/portals/PortalNav";
import { PortalDirectoryHeader } from "@/components/portals/PortalDirectoryHeader";
import type { PortalCard } from "@zobia/shared/types";

export const metadata: Metadata = {
  title: { absolute: "Portals — Zobia Social" },
  description: "Discover hashtag portals on Zobia Social: places, schools and topics, each with its own feed, rooms, guilds, people and forum.",
  alternates: { canonical: "/h" },
};

export default async function PortalsDirectoryPage() {
  const manifest = await loadManifest();
  if (!manifest.features.portals) notFound();

  let initial: PortalCard[] = [];
  try {
    initial = (await listPortals({ statuses: ["official", "auto"], sort: "trending", limit: 36 }, manifest.portals.trendingWindowHours)).cards;
  } catch {
    initial = []; // DB unavailable at render time — the client refetches
  }

  return (
    <main className="min-h-screen bg-background">
      <PortalNav redirectTo="/h" />
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <PortalDirectoryHeader />
        <PortalDirectory initial={initial} />
      </div>
    </main>
  );
}
