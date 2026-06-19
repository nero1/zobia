/**
 * app/r/[slug]/page.tsx
 *
 * Public, SSR, crawlable room page at /r/<slug>.
 *
 * Only free_open rooms are listed in the sitemap and accessible here; gated
 * rooms resolve to 404 so private content is never exposed.
 *
 * Backward compatibility:
 *   - Legacy /r/<uuid> links 301-redirect to /r/<slug>.
 *   - Retired slugs (after a rename) 301-redirect via slug_redirects.
 *
 * Added to PUBLIC_PREFIXES in middleware.ts so crawlers are not redirected to
 * login. Listed in the sitemap at the same path.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { resolvePublicRoom } from "@/lib/public/resolveRoom";
import { buildRoomMetadata, NOT_FOUND_METADATA } from "@/lib/public/roomMetadata";
import { PublicRoomView } from "@/components/public/PublicRoomView";

/** Room types served at /r (social rooms — not courses, not guild rooms). */
const ROOM_TYPES = ["free_open", "vip", "drop", "tipping", "limited"];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolvePublicRoom(slug, ROOM_TYPES).catch(() => null);
  if (!resolved) return NOT_FOUND_METADATA;
  return buildRoomMetadata(resolved.room, "/r");
}

export default async function PublicRoomPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const resolved = await resolvePublicRoom(slug, ROOM_TYPES).catch(() => null);

  if (!resolved) notFound();

  // Legacy UUID / retired slug → permanent redirect to the canonical slug URL.
  if (resolved.canonicalRedirectSlug && resolved.canonicalRedirectSlug !== slug) {
    redirect(`/r/${resolved.canonicalRedirectSlug}`);
  }

  return (
    <PublicRoomView room={resolved.room} ctaLabel="Join Zobia Social to enter this room" />
  );
}
