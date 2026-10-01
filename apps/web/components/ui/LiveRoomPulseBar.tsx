"use client";

import { useQuery } from "@tanstack/react-query";
import { RoomPulseBar } from "@/components/ui/RoomPulseBar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LiveRoomPulseBarProps {
  roomId: string;
  initialActiveCount?: number;
  initialMaxCapacity?: number;
  className?: string;
}

interface PulseResponse {
  roomId: string;
  activeCount: number;
  maxCapacity: number;
  messagesLastHour: number;
}

const POLL_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

async function fetchPulse(roomId: string): Promise<PulseResponse | null> {
  const r = await fetch(`/api/rooms/${roomId}/pulse`, { credentials: "include" });
  return r.ok ? ((await r.json()) as PulseResponse) : null;
}

export function LiveRoomPulseBar({
  roomId,
  initialActiveCount = 0,
  initialMaxCapacity = 10000,
  className,
}: LiveRoomPulseBarProps) {
  // React Query pauses refetchInterval while the tab is hidden (its focus
  // manager listens to visibilitychange), so a backgrounded room tab no
  // longer polls the server every 30 s. Matches the Capacitor app.
  const { data } = useQuery({
    queryKey: ["room-pulse", roomId],
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
