/**
 * apps/android/src/routes/rooms/index.tsx
 *
 * Room list. GET /api/rooms.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { apiClient } from '@/lib/api/client';
import type { Room } from '@zobia/shared/types';

/** Rooms carry `isFavorited` from GET /api/rooms (see lib/rooms/serialize.ts, web side). */
type RoomWithFavorite = Room & { isFavorited?: boolean };

async function fetchRooms() {
  const { data } = await apiClient.get<{ items: RoomWithFavorite[] }>('/rooms?limit=30');
  return data?.items ?? [];
}

const ROOM_TYPE_LABELS: Record<string, string> = {
  free_open: 'Free',
  vip: 'VIP',
  drop: 'Drop',
  tipping: 'Tipping',
  classroom: 'Classroom',
  guild: 'Guild',
};

function RoomsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: rooms, status, refetch } = useQuery({
    queryKey: ['rooms'],
    queryFn: fetchRooms,
    staleTime: 30_000,
  });

  // Favorite (heart) toggle — reuses the existing room-pin endpoint
  // (/api/rooms/pinned, PRD §3 "Room Pins") that backs the web Faves tab.
  const toggleFavorite = useMutation({
    mutationFn: ({ roomId, next }: { roomId: string; next: boolean }) =>
      next
        ? apiClient.post('/rooms/pinned', { roomId })
        : apiClient.delete('/rooms/pinned', { data: { roomId } }),
    onMutate: ({ roomId, next }) => {
      qc.setQueryData<RoomWithFavorite[]>(['rooms'], (prev = []) =>
        prev.map((r) => (r.id === roomId ? { ...r, isFavorited: next } : r))
      );
    },
    onError: (_err, { roomId, next }) => {
      qc.setQueryData<RoomWithFavorite[]>(['rooms'], (prev = []) =>
        prev.map((r) => (r.id === roomId ? { ...r, isFavorited: !next } : r))
      );
    },
  });

  return (
    <div className="h-full overflow-y-auto bg-neutral-50 px-4 py-4 space-y-3">
      {status === 'pending' && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl p-4 shadow-card animate-pulse">
              <div className="h-5 bg-neutral-200 rounded w-1/2 mb-2" />
              <div className="h-4 bg-neutral-100 rounded w-3/4 mb-3" />
              <div className="flex gap-2">
                <div className="h-6 bg-neutral-200 rounded-full w-16" />
                <div className="h-6 bg-neutral-100 rounded-full w-20" />
              </div>
            </div>
          ))}
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <p className="text-neutral-500 text-sm">{t('error.generic')}</p>
          <button onClick={() => refetch()} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm">
            {t('android.error.retry')}
          </button>
        </div>
      )}

      {status === 'success' && rooms?.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <p className="text-neutral-500 text-sm">{t('rooms.empty')}</p>
        </div>
      )}

      {rooms?.map((room) => (
        <div key={room.id} className="relative bg-white rounded-xl shadow-card active:scale-98 transition-transform">
          <Link to="/rooms/$roomId" params={{ roomId: room.id }} className="block p-4">
            <div className="flex items-start justify-between mb-1 pr-8">
              <h3 className="font-semibold text-neutral-900 text-sm flex-1 pr-2">{room.name}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                room.roomType === 'vip' ? 'bg-gold-100 text-gold-700' :
                room.roomType === 'drop' ? 'bg-primary-100 text-primary-700' :
                'bg-neutral-100 text-neutral-600'
              }`}>
                {ROOM_TYPE_LABELS[room.roomType] ?? room.roomType}
              </span>
            </div>
            {room.description && (
              <p className="text-neutral-500 text-xs mb-2 line-clamp-2">{room.description}</p>
            )}
            <div className="flex items-center gap-3 text-xs text-neutral-400">
              <span>👥 {room.memberCount.toLocaleString()} {t('rooms.members', { count: room.memberCount })}</span>
              {room.isActive && <span className="text-success-600 font-medium">● LIVE</span>}
            </div>
          </Link>
          <button
            type="button"
            onClick={() => toggleFavorite.mutate({ roomId: room.id, next: !room.isFavorited })}
            aria-label={room.isFavorited ? t('room.removeFavorite') : t('room.addFavorite')}
            className="absolute right-3 top-3 text-lg"
          >
            {room.isFavorited ? '❤️' : '🤍'}
          </button>
        </div>
      ))}
    </div>
  );
}

export const Route = createFileRoute('/rooms/')({
  component: RoomsPage,
});
