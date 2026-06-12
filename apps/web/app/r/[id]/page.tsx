/**
 * app/r/[id]/page.tsx
 *
 * Public, SSR, crawlable room page.
 * Only free_open rooms are listed in the sitemap and accessible here.
 * Gated rooms return 404 so private content is never exposed.
 *
 * Route: /r/[id]
 * Listed in sitemap at the same path.
 * Added to PUBLIC_PREFIXES in middleware.ts so crawlers are not redirected to login.
 */

import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface PublicRoom {
  id: string;
  name: string;
  description: string | null;
  type: string;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
  creator_username: string | null;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function getPublicRoom(id: string): Promise<PublicRoom | null> {
  const { rows } = await db.query<PublicRoom>(
    `SELECT r.id, r.name, r.description, r.type, r.cover_image_url,
            r.created_at, r.updated_at, u.username AS creator_username
     FROM rooms r
     LEFT JOIN users u ON u.id = r.creator_id
     WHERE r.id = $1
       AND r.type = 'free_open'
       AND r.deleted_at IS NULL
       AND r.is_active = TRUE
     LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// generateMetadata
// ---------------------------------------------------------------------------

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> },
  _parent: ResolvingMetadata
): Promise<Metadata> {
  const { id } = await params;
  const room = await getPublicRoom(id).catch(() => null);

  if (!room) {
    return {
      title: "Room not found — Zobia Social",
      robots: { index: false },
    };
  }

  const title = `${room.name} — Zobia Social`;
  const description = room.description
    ? room.description.slice(0, 155)
    : `Join ${room.name} on Zobia Social${room.creator_username ? `, hosted by @${room.creator_username}` : ""}.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: room.cover_image_url ? [{ url: room.cover_image_url }] : [],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: room.cover_image_url ? [room.cover_image_url] : [],
    },
    alternates: {
      canonical: `/r/${id}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function PublicRoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const room = await getPublicRoom(id).catch(() => null);

  if (!room) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Cover image */}
        {room.cover_image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={room.cover_image_url}
            alt={`${room.name} cover`}
            className="w-full h-48 object-cover rounded-xl mb-6"
            width={800}
            height={192}
          />
        )}

        <h1 className="text-3xl font-bold mb-2">{room.name}</h1>

        {room.creator_username && (
          <p className="text-sm text-muted-foreground mb-4">
            Hosted by{" "}
            <a href={`/u/${room.creator_username}`} className="text-primary hover:underline">
              @{room.creator_username}
            </a>
          </p>
        )}

        {room.description && (
          <p className="text-muted-foreground mb-8 whitespace-pre-wrap">{room.description}</p>
        )}

        {/* CTA */}
        <div className="text-center">
          <a
            href="/auth/login"
            className="inline-block bg-primary text-primary-foreground px-6 py-2 rounded-lg font-medium hover:opacity-90 transition"
          >
            Join Zobia Social to enter this room
          </a>
        </div>
      </div>
    </main>
  );
}
