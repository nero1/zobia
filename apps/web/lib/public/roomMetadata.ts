/**
 * apps/web/lib/public/roomMetadata.ts
 *
 * Shared Open Graph / Twitter metadata builder for the public room and course
 * pages. Keeps the canonical URL pointed at the slug path for the given
 * surface ("/r" for rooms, "/c" for courses).
 */

import type { Metadata } from "next";
import type { PublicRoom } from "@/lib/public/resolveRoom";

export function buildRoomMetadata(
  room: PublicRoom,
  pathPrefix: "/r" | "/c"
): Metadata {
  const canonicalSlug = room.slug ?? room.id;
  const surfaceWord = pathPrefix === "/c" ? "class" : "room";

  const title = `${room.name} — Zobia Social`;
  const description = room.description
    ? room.description.slice(0, 155)
    : `Join ${room.name} on Zobia Social${
        room.creator_username ? `, hosted by @${room.creator_username}` : ""
      }.`;

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
      canonical: `${pathPrefix}/${canonicalSlug}`,
    },
    other: { "zobia:surface": surfaceWord },
  };
}

export const NOT_FOUND_METADATA: Metadata = {
  title: "Not found — Zobia Social",
  robots: { index: false },
};
