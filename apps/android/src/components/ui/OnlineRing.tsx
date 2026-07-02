/**
 * apps/android/src/components/ui/OnlineRing.tsx
 *
 * Ported from apps/web/components/ui/OnlineRing.tsx (PRD §2.2 "Online rings
 * around profile avatars") — wraps an avatar with a presence indicator ring
 * + dot. "online" = steady teal, "recently_active" = amber, "offline" =
 * neutral. Pass `knownStatus` (from a list endpoint like GET /friends/online)
 * to skip the per-avatar GET /presence/:userId fetch.
 */

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api/client';

type PresenceStatus = 'online' | 'recently_active' | 'offline';

interface OnlineRingProps {
  userId: string;
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  knownStatus?: PresenceStatus;
}

const RING_SIZE: Record<string, string> = { sm: 'ring-2', md: 'ring-2', lg: 'ring-[3px]' };
const DOT_SIZE: Record<string, string> = { sm: 'h-2 w-2 ring-1', md: 'h-2.5 w-2.5 ring-1', lg: 'h-3 w-3 ring-[2px]' };
const STATUS_RING: Record<PresenceStatus, string> = {
  online: 'ring-teal-500',
  recently_active: 'ring-amber-400',
  offline: 'ring-neutral-300',
};
const STATUS_DOT: Record<PresenceStatus, string> = {
  online: 'bg-teal-500',
  recently_active: 'bg-amber-400',
  offline: 'bg-neutral-300',
};

export function OnlineRing({ userId, size = 'md', children, knownStatus }: OnlineRingProps) {
  const [status, setStatus] = useState<PresenceStatus>(knownStatus ?? 'offline');

  useEffect(() => {
    if (knownStatus) { setStatus(knownStatus); return; }
    if (!userId) return;
    let cancelled = false;
    apiClient
      .get<{ status?: PresenceStatus; data?: { status?: PresenceStatus } }>(`/presence/${userId}`)
      .then(({ data: d }) => {
        const resolved = d?.data?.status ?? d?.status;
        if (!cancelled && resolved) setStatus(resolved);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [userId, knownStatus]);

  return (
    <div className="relative inline-flex shrink-0">
      <div className={`rounded-full ${RING_SIZE[size]} ${STATUS_RING[status]}`} role="img" aria-label={`Status: ${status.replace('_', ' ')}`}>
        {children}
      </div>
      <span className={`absolute -bottom-0.5 -right-0.5 rounded-full ring-white ${DOT_SIZE[size]} ${STATUS_DOT[status]}`} />
    </div>
  );
}
