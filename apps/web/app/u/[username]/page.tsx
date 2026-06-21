/**
 * app/u/[username]/page.tsx
 *
 * Public, SSR, crawlable user profile page.
 * Accessible without authentication so search engines can index profiles.
 *
 * Route: /u/[username]
 * Listed in sitemap at the same path.
 * Added to PUBLIC_PREFIXES in middleware.ts so crawlers are not redirected to login.
 */

import type { Metadata, ResolvingMetadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.vercel.app";

const SUPPORTED_LOCALES = ["en", "fr", "ar", "sw", "ha", "pt", "am", "zu"] as const;

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface PublicProfile {
  id: string;
  username: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  is_creator: boolean;
  created_at: string;
  xp_total: number;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function getPublicProfile(username: string): Promise<PublicProfile | null> {
  const { rows } = await db.query<PublicProfile>(
    `SELECT id, username, display_name, bio, avatar_url, is_creator, created_at, xp_total
     FROM users
     WHERE username = $1 AND deleted_at IS NULL AND is_banned = FALSE
     LIMIT 1`,
    [username]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// generateMetadata
// ---------------------------------------------------------------------------

export async function generateMetadata(
  { params }: { params: Promise<{ username: string }> },
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const { username } = await params;
  const profile = await getPublicProfile(username).catch(() => null);

  if (!profile) {
    return {
      title: "Profile not found — Zobia Social",
      robots: { index: false },
    };
  }

  const title = `${profile.display_name ?? profile.username} (@${profile.username}) — Zobia Social`;
  const description = profile.bio
    ? `${profile.bio.slice(0, 155)}`
    : `Check out @${profile.username}'s profile on Zobia Social.`;

  // TASK-28: hreflang alternates for all 8 supported locales
  const hreflangLanguages: Record<string, string> = {
    "x-default": `${APP_URL}/u/${username}`,
  };
  for (const locale of SUPPORTED_LOCALES) {
    hreflangLanguages[locale] = locale === "en"
      ? `${APP_URL}/u/${username}`
      : `${APP_URL}/${locale}/u/${username}`;
  }

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: profile.avatar_url ? [{ url: profile.avatar_url }] : [],
      type: "profile",
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: profile.avatar_url ? [profile.avatar_url] : [],
    },
    alternates: {
      canonical: `${APP_URL}/u/${username}`,
      languages: hreflangLanguages,
    },
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await getPublicProfile(username).catch(() => null);

  if (!profile) {
    notFound();
  }

  // TASK-27: schema.org JSON-LD structured data for rich-snippet eligibility
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    mainEntity: {
      "@type": "Person",
      name: profile.display_name ?? profile.username,
      url: `${APP_URL}/u/${profile.username}`,
      description: profile.bio ?? undefined,
      image: profile.avatar_url ?? undefined,
    },
  };

  return (
    <main className="min-h-screen bg-background">
      {/* TASK-27: JSON-LD structured data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Avatar */}
        <div className="flex items-center gap-4 mb-6">
          {profile.avatar_url ? (
            // TASK-29: use Next.js Image for WebP conversion, lazy loading, and LCP optimisation
            <Image
              src={profile.avatar_url}
              alt={`${profile.username} avatar`}
              className="w-20 h-20 rounded-full object-cover"
              width={80}
              height={80}
              priority
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center text-3xl font-bold">
              {(profile.display_name ?? profile.username)[0]?.toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold">{profile.display_name ?? profile.username}</h1>
            <p className="text-muted-foreground">@{profile.username}</p>
            {profile.is_creator && (
              <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                Creator
              </span>
            )}
          </div>
        </div>

        {/* Bio */}
        {profile.bio && (
          <p className="text-sm text-muted-foreground mb-6 whitespace-pre-wrap">{profile.bio}</p>
        )}

        {/* Stats */}
        <div className="grid grid-cols-1 gap-4 mb-8">
          <div className="rounded-lg border p-4 text-center">
            <p className="text-2xl font-bold">{profile.xp_total.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">XP</p>
          </div>
        </div>

        {/* CTA */}
        <div className="text-center">
          <a
            href="/auth/login"
            className="inline-block bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium hover:opacity-90 transition"
          >
            Join Zobia Social to connect
          </a>
        </div>
      </div>
    </main>
  );
}
