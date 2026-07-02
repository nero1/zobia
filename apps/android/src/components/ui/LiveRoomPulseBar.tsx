/**
 * apps/android/src/components/ui/LiveRoomPulseBar.tsx
 *
 * Ported from apps/web/components/ui/LiveRoomPulseBar.tsx. Polls the same
 * GET /rooms/:roomId/pulse endpoint every 30s (no new backend, no extra
 * Redis calls beyond what the endpoint already does).
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { RoomPulseBar } from './RoomPulseBar';

interface PulseResponse {
  roomId: string;
  activeCount: number;
  maxCapacity: number;
  messagesLastHour: number;
}

const POLL_INTERVAL_MS = 30_000;

async function fetchPulse(roomId: string) {
  const { data } = await apiClient.get<PulseResponse>(`/rooms/${roomId}/pulse`);
  return data;
}

interface LiveRoomPulseBarProps {
  roomId: string;
  initialActiveCount?: number;
  initialMaxCapacity?: number;
  className?: string;
}

export function LiveRoomPulseBar({
  roomId,
  initialActiveCount = 0,
  initialMaxCapacity = 10000,
  className,
}: LiveRoomPulseBarProps) {
  const { data } = useQuery({
    queryKey: ['room-pulse', roomId],
    queryFn: () => fetchPulse(roomId),
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: POLL_INTERVAL_MS,
  });

  return (
    <RoomPulseBar
      activeCount={data?.activeCount ?? initialActiveCount}
      maxCapacity={data?.maxCapacity ?? initialMaxCapacity}
      className={className}
    />
  );
}
