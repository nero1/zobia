/**
 * app/c/[slug]/page.tsx
 *
 * Public, SSR, crawlable course / classroom page at /c/<slug>.
 *
 * Courses are rooms of type 'classroom'. Only public, live classrooms are
 * served; anything else resolves to 404. Legacy UUID links and retired slugs
 * 301-redirect to the canonical /c/<slug> URL.
 *
 * Added to PUBLIC_PREFIXES in middleware.ts and listed in the sitemap.
 */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { resolvePublicRoom } from "@/lib/public/resolveRoom";
import { buildRoomMetadata, NOT_FOUND_METADATA } from "@/lib/public/roomMetadata";
import { PublicRoomView } from "@/components/public/PublicRoomView";

/** Courses are classroom-type rooms. */
const COURSE_TYPES = ["classroom"];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolvePublicRoom(slug, COURSE_TYPES).catch(() => null);
  if (!resolved) return NOT_FOUND_METADATA;
  return buildRoomMetadata(resolved.room, "/c");
}

export default async function PublicCoursePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const resolved = await resolvePublicRoom(slug, COURSE_TYPES).catch(() => null);

  if (!resolved) notFound();

  if (resolved.canonicalRedirectSlug && resolved.canonicalRedirectSlug !== slug) {
    redirect(`/c/${resolved.canonicalRedirectSlug}`);
  }

  return (
    <PublicRoomView room={resolved.room} ctaLabel="Join Zobia Social to enrol in this class" />
  );
}
