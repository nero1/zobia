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
import { PortalDiscoverHub } from "@/components/portals/PortalDiscoverHub";
import { getDiscoverPayload } from "@/lib/portals/discover";
import { PortalNav } from "@/components/portals/PortalNav";
import { PortalDirectoryHeader } from "@/components/portals/PortalDirectoryHeader";
import type { PortalCard, PortalDiscover } from "@zobia/types";

export const metadata: Metadata = {
  title: { absolute: "Portals — Zobia Social" },
  description: "Discover hashtag portals on Zobia Social: places, schools and topics, each with its own feed, rooms, guilds, people and forum.",
  alternates: { canonical: "/h" },
};

export default async function PortalsDirectoryPage() {
  const manifest = await loadManifest();
  if (!manifest.features.portals) notFound();

  // DB unavailable at render time: the client refetches both.
  const [hub, directory] = await Promise.all([
    getDiscoverPayload().catch((): PortalDiscover | null => null),
    listPortals({ statuses: ["official", "auto"], sort: "trending", limit: 36 }, manifest.portals.trendingWindowHours)
      .then((r) => r.cards)
      .catch((): PortalCard[] => []),
  ]);

  return (
    <main className="min-h-screen bg-background">
      <PortalNav redirectTo="/h" />
      <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
        <PortalDirectoryHeader />
        <PortalDiscoverHub initial={hub} directoryInitial={directory} />
      </div>
    </main>
  );
}
