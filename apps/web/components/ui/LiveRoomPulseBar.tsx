"use client";

import { useState, useEffect } from "react";
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

export function LiveRoomPulseBar({
  roomId,
  initialActiveCount = 0,
  initialMaxCapacity = 10000,
  className,
}: LiveRoomPulseBarProps) {
  const [activeCount, setActiveCount] = useState(initialActiveCount);
  const [maxCapacity, setMaxCapacity] = useState(initialMaxCapacity);

  useEffect(() => {
    let cancelled = false;

    function fetchPulse() {
      fetch(`/api/rooms/${roomId}/pulse`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: PulseResponse | null) => {
          if (!cancelled && d) {
            setActiveCount(d.activeCount);
            setMaxCapacity(d.maxCapacity);
          }
        })
        .catch(() => {});
    }

    fetchPulse();
    const id = setInterval(fetchPulse, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [roomId]);

  return (
    <RoomPulseBar
      activeCount={activeCount}
      maxCapacity={maxCapacity}
      className={className}
    />
  );
}
