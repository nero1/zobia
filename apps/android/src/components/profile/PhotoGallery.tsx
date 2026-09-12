/**
 * apps/android/src/components/profile/PhotoGallery.tsx
 *
 * Mirrors apps/web/components/profile/PhotoGallery.tsx — profile photo
 * gallery sourced from Moments (?userId=&mediaOnly=1 on GET /api/moments),
 * the only existing public per-user image source. See the web component's
 * docblock for the "Moments expire after 24h" caveat.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';

interface GalleryMoment {
  id: string;
  media_url: string | null;
  caption: string | null;
  created_at: string;
}

async function fetchGallery(userId: string): Promise<GalleryMoment[]> {
  const { data } = await apiClient.get<{ moments: GalleryMoment[] }>(
    `/moments?userId=${encodeURIComponent(userId)}&mediaOnly=1&limit=24`
  );
  return data?.moments ?? [];
}

export function PhotoGallery({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const [lightbox, setLightbox] = useState<GalleryMoment | null>(null);
  const { data: photos, status } = useQuery({
    queryKey: ['profile-gallery', userId],
    queryFn: () => fetchGallery(userId),
    staleTime: 60_000,
  });

  if (status === 'pending') {
    return (
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-square animate-pulse rounded-lg bg-neutral-200" />
        ))}
      </div>
    );
  }

  if (!photos || photos.length === 0) {
    return <p className="py-6 text-center text-sm text-neutral-500">{t('profile.gallery.empty', 'No photos yet')}</p>;
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setLightbox(p)}
            className="aspect-square overflow-hidden rounded-lg bg-neutral-100"
          >
            {p.media_url && <img src={p.media_url} alt={p.caption ?? ''} className="h-full w-full object-cover" />}
          </button>
        ))}
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightbox(null)}
        >
          {lightbox.media_url && (
            <img
              src={lightbox.media_url}
              alt={lightbox.caption ?? ''}
              className="max-h-[85vh] max-w-full rounded-lg object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
