/**
 * components/public/PublicRoomView.tsx
 *
 * Presentational, server-rendered view for a public room or course. Shared by
 * the crawlable /r/<slug> (rooms) and /c/<slug> (courses) pages so the markup,
 * OG surface and CTA stay identical.
 */

import type { PublicRoom } from "@/lib/public/resolveRoom";

interface PublicRoomViewProps {
  room: PublicRoom;
  /** Label for the join CTA — varies by surface ("room" vs "class"). */
  ctaLabel: string;
}

export function PublicRoomView({ room, ctaLabel }: PublicRoomViewProps) {
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
            {ctaLabel}
          </a>
        </div>
      </div>
    </main>
  );
}
