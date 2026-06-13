/**
 * components/ui/PresenceDot.tsx
 *
 * Animated presence indicator dot for React Native.
 * Fetches user presence status from GET /api/presence/[userId].
 *
 * - online          → teal pulsing dot (active within 5 min)
 * - recently_active → amber dot (active within 1 hour)
 * - offline         → grey dot, no animation
 *
 * PRD §2.2 — The Presence Layer
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PresenceStatus = 'online' | 'recently_active' | 'offline';

interface PresenceDotProps {
  userId: string;
  size?: number;
}

// ---------------------------------------------------------------------------
// Colors per status
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<PresenceStatus, string> = {
  online: '#14b8a6',          // teal-500
  recently_active: '#f59e0b', // amber-400
  offline: '#9ca3af',         // neutral-400
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Small animated dot showing a user's live presence status.
 * Renders as an absolutely-positioned overlay — place inside a relative View.
 */
export function PresenceDot({ userId, size = 12 }: PresenceDotProps) {
  const { data } = useQuery<{ status: PresenceStatus }>({
    queryKey: ['presence', userId],
    queryFn: () =>
      apiClient
        .get<{ data: { status: PresenceStatus } }>(`/presence/${userId}`)
        .then((r) => r.data.data),
    staleTime: 60_000,       // refresh every 60 s
    refetchInterval: 90_000, // background poll
  });

  const status = data?.status ?? 'offline';
  const color = STATUS_COLOR[status];

  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (status === 'offline') return;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.8, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [status, pulseAnim]);

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Pulse ring (online/recently_active only) */}
      {status !== 'offline' && (
        <Animated.View
          style={[
            styles.pulse,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: color,
              opacity: 0.4,
              transform: [{ scale: pulseAnim }],
            },
          ]}
        />
      )}
      {/* Solid dot */}
      <View
        style={[
          styles.dot,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    position: 'absolute',
  },
  dot: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
});
