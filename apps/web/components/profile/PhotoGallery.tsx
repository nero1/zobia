"use client";

/**
 * components/profile/PhotoGallery.tsx
 *
 * Profile photo gallery. Sources images from Moments — the only existing
 * feature that stores public per-user images (GET /api/moments already
 * powers app/(app)/moments/page.tsx) — filtered to this user's media-bearing
 * moments via ?userId=&mediaOnly=1 (see app/api/moments/route.ts). No new
 * storage, no new endpoint.
 *
 * Note: Moments expire 24h after posting, so this gallery only ever shows
 * recent media, not a permanent archive — an accepted limitation of reusing
 * Moments rather than building new storage for this feature.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface GalleryMoment {
  id: string;
  media_url: string | null;
  caption: string | null;
  created_at: string;
}

export function PhotoGallery({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [photos, setPhotos] = useState<GalleryMoment[] | null>(null);
  const [lightbox, setLightbox] = useState<GalleryMoment | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/moments?userId=${encodeURIComponent(userId)}&mediaOnly=1&limit=24`, { credentials: "include" });
        if (!res.ok) return;
        const body = await res.json() as { data?: { moments?: GalleryMoment[] } };
        if (!cancelled) setPhotos(body.data?.moments ?? []);
      } catch {
        if (!cancelled) setPhotos([]);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (photos === null) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
        ))}
      </div>
    );
  }

  if (photos.length === 0) {
    return <p className="py-6 text-center text-sm text-neutral-500">{t("profile.gallery.empty", "No photos yet")}</p>;
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setLightbox(p)}
            className="aspect-square overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800"
          >
            {p.media_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.media_url} alt={p.caption ?? ""} className="h-full w-full object-cover" loading="lazy" />
            )}
          </button>
        ))}
      </div>

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          {lightbox.media_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={lightbox.media_url}
              alt={lightbox.caption ?? ""}
              className="max-h-[85vh] max-w-full rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label={t("action.close", "Close")}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
