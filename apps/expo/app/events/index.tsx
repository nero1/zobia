/**
 * app/events/index.tsx
 *
 * Platform Events screen.
 *
 * Features:
 *  - Active events highlighted with "LIVE" badge
 *  - Monthly gift drop details with purchase button
 *  - Flash XP events with countdown
 *  - Cultural events with dates and description
 *  - FlatList layout
 */

import React, { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventType = 'gift_drop' | 'flash_xp' | 'cultural' | 'seasonal' | 'general';

interface PlatformEvent {
  id: string;
  title: string;
  description: string;
  eventType: EventType;
  isActive: boolean;
  startsAt: string;
  endsAt: string | null;
  purchasePrice?: number;
  xpMultiplier?: number;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchEvents(): Promise<PlatformEvent[]> {
  const { data } = await apiClient.get('/events');
  return data.events ?? [];
}

async function purchaseGiftDrop(eventId: string): Promise<void> {
  await apiClient.post(`/events/${eventId}/purchase`);
}

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------

function useCountdown(endsAt: string | null): string {
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!endsAt) return;
    const update = () => {
      const diff = new Date(endsAt).getTime() - Date.now();
      if (diff <= 0) { setLabel('Ended'); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setLabel(`${h}h ${m}m ${s}s`);
    };
    update();
    const id = setInterval(update, 1_000);
    return () => clearInterval(id);
  }, [endsAt]);

  return label;
}

// ---------------------------------------------------------------------------
// Event card
// ---------------------------------------------------------------------------

const EVENT_EMOJIS: Record<EventType, string> = {
  gift_drop: '🎁',
  flash_xp: '⚡',
  cultural: '🎉',
  seasonal: '🌸',
  general: '📅',
};

function EventCard({ event, onPurchase }: { event: PlatformEvent; onPurchase: (id: string) => void }) {
  const { colors: themeColors } = useTheme();
  const currency = useCurrency();
  const countdown = useCountdown(event.isActive ? event.endsAt : null);

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: themeColors.surface, borderColor: event.isActive ? colors.brand.blue : themeColors.border },
        event.isActive && styles.cardActive,
      ]}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardEmoji}>{EVENT_EMOJIS[event.eventType]}</Text>
        <View style={styles.cardTitleBlock}>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.cardTitle, { color: themeColors.text }]} numberOfLines={1}>
              {event.title}
            </Text>
            {event.isActive && (
              <View style={styles.liveBadge}>
                <Text style={styles.liveBadgeText}>LIVE</Text>
              </View>
            )}
          </View>

          {/* Flash XP countdown */}
          {event.eventType === 'flash_xp' && event.isActive && countdown ? (
            <Text style={styles.countdown}>⏳ {countdown} remaining</Text>
          ) : null}

          {/* Gift drop / flash XP multiplier */}
          {event.eventType === 'flash_xp' && event.xpMultiplier ? (
            <Text style={[styles.xpMultiplier, { color: colors.brand.gold }]}>
              {event.xpMultiplier}× XP
            </Text>
          ) : null}

          {/* Date range */}
          {(event.eventType === 'cultural' || event.eventType === 'seasonal') && (
            <Text style={[styles.dateRange, { color: themeColors.textMuted }]}>
              {new Date(event.startsAt).toLocaleDateString()}
              {event.endsAt ? ` – ${new Date(event.endsAt).toLocaleDateString()}` : ''}
            </Text>
          )}
        </View>
      </View>

      <Text style={[styles.cardDescription, { color: themeColors.textMuted }]} numberOfLines={4}>
        {event.description}
      </Text>

      {/* Gift drop purchase */}
      {event.eventType === 'gift_drop' && event.isActive && event.purchasePrice !== undefined && (
        <TouchableOpacity
          style={styles.purchaseBtn}
          onPress={() => onPurchase(event.id)}
          accessibilityRole="button"
          accessibilityLabel={`Purchase gift drop for ${event.purchasePrice} ${currency.softPlural.toLowerCase()}`}
        >
          <Text style={styles.purchaseBtnText}>
            🪙 Purchase for {event.purchasePrice} {currency.softPlural.toLowerCase()}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3].map((i) => <View key={i} style={styles.skeletonCard} />)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function EventsScreen() {
  const { colors: themeColors } = useTheme();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data: events = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['events'],
    queryFn: fetchEvents,
  });

  const purchaseMutation = useMutation({
    mutationFn: purchaseGiftDrop,
    onSuccess: () => {
      Alert.alert('Purchase Successful!', 'Your gift drop has been purchased. Check your inventory.');
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    onError: () => Alert.alert('Error', 'Purchase failed. Please try again.'),
  });

  async function onRefresh() {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }

  if (isLoading) return <Screen><Skeleton /></Screen>;

  if (isError) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            Could not load events.
          </Text>
        </View>
      </Screen>
    );
  }

  // Sort: active first, then by start date
  const sorted = [...events].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime();
  });

  return (
    <FlatList
      data={sorted}
      keyExtractor={(e) => e.id}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />
      }
      ListHeaderComponent={() => (
        <View style={styles.listHeader}>
          <Text style={[styles.screenTitle, { color: themeColors.text }]}>Events</Text>
          <Text style={[styles.screenSubtitle, { color: themeColors.textMuted }]}>
            Active and upcoming platform events
          </Text>
        </View>
      )}
      renderItem={({ item }) => (
        <EventCard
          event={item}
          onPurchase={(id) => purchaseMutation.mutate(id)}
        />
      )}
      ListEmptyComponent={() => (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
            No events right now. Check back soon!
          </Text>
        </View>
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },

  listHeader: { marginBottom: 8, gap: 4 },
  screenTitle: { fontSize: 22, fontWeight: '800' },
  screenSubtitle: { fontSize: 14 },

  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  cardActive: {
    borderWidth: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  cardEmoji: { fontSize: 28, marginTop: 2 },
  cardTitleBlock: { flex: 1, gap: 3 },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  cardTitle: { fontSize: 16, fontWeight: '700', flex: 1 },
  liveBadge: {
    backgroundColor: colors.semantic.error,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveBadgeText: { color: colors.neutral[0], fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  countdown: { fontSize: 13, color: colors.semantic.warning, fontWeight: '600' },
  xpMultiplier: { fontSize: 14, fontWeight: '800' },
  dateRange: { fontSize: 12 },
  cardDescription: { fontSize: 14, lineHeight: 20 },

  purchaseBtn: {
    backgroundColor: colors.brand.blue,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 4,
  },
  purchaseBtnText: { color: colors.neutral[0], fontSize: 14, fontWeight: '700' },

  emptyState: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 15, textAlign: 'center' },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  skeletonContainer: { padding: 16, gap: 12 },
  skeletonCard: { height: 140, borderRadius: 14, backgroundColor: colors.neutral[200] },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';
