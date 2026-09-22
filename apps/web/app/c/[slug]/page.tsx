/**
 * app/c/[slug]/page.tsx
 *
 * The classroom homepage at /c/<slug> — public, SSR and crawlable for public
 * classrooms, and the full Skool-style community + LMS for members:
 * community feed, lessons, live-session calendar (external meeting links +
 * recordings), the classroom's own leaderboard, plus Share/Boost/Manage.
 *
 * The server resolves the classroom and builds the role-filtered homepage
 * payload directly from the service layer (lib/classroom/home.ts) so the
 * first paint — and what crawlers index — needs no client round trip.
 * Visitors only ever receive visitor-safe data (outline, schedule, no
 * meeting/recording links, no feed). Legacy UUID links and retired slugs
 * 301 to the canonical /c/<slug>.
 *
 * Listed in middleware PUBLIC_PREFIXES ("/c/") and in the sitemap.
 */

import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, permanentRedirect } from "next/navigation";
import { getOptionalServerUser } from "@/lib/auth/serverUser";
import { loadManifest } from "@/lib/manifest";
import { NOT_FOUND_METADATA } from "@/lib/public/roomMetadata";
import { serializeJsonLd } from "@/lib/seo/metadata";
import { loadClassroomContext } from "@/lib/classroom/access";
import { buildClassroomHome } from "@/lib/classroom/home";
import { resolveClassroomIdentifier } from "@/lib/classroom/resolve";
import { recordClassroomView } from "@/lib/classroom/stats";
import { ClassroomHome } from "@/components/classroom/ClassroomHome";

export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";

async function load(slug: string) {
  const resolved = await resolveClassroomIdentifier(slug).catch(() => null);
  if (!resolved) return null;
  const viewer = await getOptionalServerUser();
  const ctx = await loadClassroomContext({ id: resolved.id }, viewer?.userId ?? null).catch(() => null);
  if (!ctx) return null;
  return { resolved, viewer, ctx };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await load(slug);
  if (!loaded) return NOT_FOUND_METADATA;
  const { classroom } = loaded.ctx;
  const indexable = classroom.isPublic && classroom.isActive;
  const title = `${classroom.name} — Classroom — Zobia Social`;
  const description = classroom.description
    ? classroom.description.slice(0, 155)
    : `Join ${classroom.name}, a classroom by @${classroom.creatorUsername} on Zobia Social.`;
  const canonical = `/c/${classroom.slug ?? classroom.id}`;
  return {
    title,
    description,
    robots: indexable ? undefined : { index: false, follow: false },
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "Zobia Social",
      images: classroom.coverImageUrl ? [{ url: classroom.coverImageUrl }] : [],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: classroom.coverImageUrl ? [classroom.coverImageUrl] : [],
    },
    alternates: { canonical },
  };
}

export default async function ClassroomHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const manifest = await loadManifest().catch(() => null);
  if (manifest && !manifest.features.classrooms) notFound();

  const loaded = await load(slug);
  if (!loaded) notFound();
  const { resolved, viewer, ctx } = loaded;

  if (resolved.redirectTo && resolved.redirectTo !== slug) {
    permanentRedirect(`/c/${resolved.redirectTo}`);
  }

  const { classroom } = ctx;
  const insider = ctx.viewer.can.viewMemberContent;
  // Private / archived classrooms are only shown to their own members; to
  // everyone else they are indistinguishable from a missing page.
  if ((!classroom.isPublic || !classroom.isActive) && !insider) notFound();

  if (!ctx.viewer.isCreator) recordClassroomView(classroom.id);

  const home = await buildClassroomHome(ctx);
  const pageUrl = `${APP_URL}/c/${classroom.slug ?? classroom.id}`;

  const jsonLd = classroom.isPublic
    ? serializeJsonLd({
        "@context": "https://schema.org",
        "@type": "Course",
        name: classroom.name,
        description: classroom.description ?? undefined,
        url: pageUrl,
        provider: {
          "@type": "Person",
          name: classroom.creatorDisplayName,
          url: `${APP_URL}/u/${classroom.creatorUsername}`,
        },
        offers: {
          "@type": "Offer",
          category: classroom.enrolmentFeeNgn > 0 ? "Paid" : "Free",
          price: classroom.enrolmentFeeNgn,
          priceCurrency: "NGN",
        },
        hasCourseInstance: home.upcomingEvents.slice(0, 3).map((e) => ({
          "@type": "CourseInstance",
          name: e.title,
          courseMode: "online",
          startDate: e.startsAt,
          ...(e.endsAt ? { endDate: e.endsAt } : {}),
        })),
        syllabusSections: home.modules.map((m) => ({ "@type": "Syllabus", name: m.title, description: m.description })),
      })
    : null;

  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {jsonLd && (
        // eslint-disable-next-line react/no-danger
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      )}
      <Suspense fallback={null}>
        <ClassroomHome initial={home} signedIn={!!viewer} />
      </Suspense>
    </main>
  );
}
