/**
 * app/(tabs)/rooms.tsx
 *
 * Rooms discovery tab — Phase 4.
 *
 * Features:
 *  - Discovery feed with room cards
 *  - Three tabs: Trending, Near Me (city), Friends In Room
 *  - Search bar (filters by name/category)
 *  - Room type filter chips (free_open, vip, drop, tipping, classroom)
 *  - Pull-to-refresh
 *  - Skeleton loaders on initial load
 *  - Cursor-based pagination with load-more on scroll end
 *  - Navigates to /rooms/[roomId] on card press
 *  - Create Room FAB (creators only)
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/ui/Screen';
import { useTranslation } from 'react-i18next';
import { RoomCard, type RoomCardData } from '@/components/rooms/RoomCard';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/hooks';
import type { RoomType } from '@zobia/shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DiscoveryTab = 'trending' | 'nearby' | 'friends';

type FilterChip = RoomType | 'all';

interface DiscoveryTabConfig {
  key: DiscoveryTab;
  label: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Labels are resolved via t() in the component; keys are used for lookup.
const TABS: DiscoveryTabConfig[] = [
  { key: 'trending', label: 'trending' },
  { key: 'nearby', label: 'nearby' },
  { key: 'friends', label: 'friends' },
];

const FILTER_CHIPS: { key: FilterChip; label: string }[] = [
  { key: 'all', label: 'all' },
  { key: 'free_open', label: 'free' },
  { key: 'vip', label: 'vip' },
  { key: 'drop', label: 'drop' },
  { key: 'tipping', label: 'tipping' },
  { key: 'classroom', label: 'class' },
];

const ROOM_TYPE_FILTER_COLOR: Record<FilterChip, string> = {
  all: colors.neutral[700],
  free_open: colors.brand.blue,
  vip: colors.brand.gold,
  drop: colors.semantic.error,
  tipping: colors.brand.green,
  classroom: '#0D9488',
  guild: colors.brand.gold,
};

// ---------------------------------------------------------------------------
// Skeleton loader
// ---------------------------------------------------------------------------

function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonCover} />
      <View style={styles.skeletonBody}>
        <View style={styles.skeletonLine} />
        <View style={[styles.skeletonLine, { width: '60%' }]} />
        <View style={styles.skeletonPulse} />
      </View>
    </View>
  );
}

function SkeletonList() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <SkeletonCard key={i} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Hook: pinned rooms
// ---------------------------------------------------------------------------

function usePinnedRooms() {
  const [pinned, setPinned] = useState<RoomCardData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiClient.get<{ rooms: RoomCardData[] }>('/rooms/pinned')
      .then(({ data }) => setPinned(data.rooms ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { pinned, loading };
}

// ---------------------------------------------------------------------------
// Pinned rooms horizontal strip
// ---------------------------------------------------------------------------

function PinnedRoomsStrip({ rooms, onPress }: { rooms: RoomCardData[]; onPress: (r: RoomCardData) => void }) {
  if (rooms.length === 0) return null;
  return (
    <View style={styles.pinnedSection}>
      <Text style={styles.pinnedTitle}>📌 Pinned</Text>
      <FlatList
        horizontal
        data={rooms}
        keyExtractor={(r) => r.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pinnedList}
        renderItem={({ item }) => (
          <Pressable style={styles.pinnedCard} onPress={() => onPress(item)}>
            <Text style={styles.pinnedEmoji}>{item.coverEmoji ?? '🏠'}</Text>
            <Text style={styles.pinnedName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.pinnedCount}>{item.memberCount ?? 0} members</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Hook: fetch rooms
// ---------------------------------------------------------------------------

function useRoomsQuery(
  tab: DiscoveryTab,
  typeFilter: FilterChip,
  searchQuery: string,
  availability: 'all' | 'available' | 'full',
  userCity?: string
) {
  const [rooms, setRooms] = useState<RoomCardData[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildParams = useCallback(
    (cursor?: string) => {
      const params: Record<string, string> = {};
      if (tab === 'trending') params.trending = '1';
      if (tab === 'nearby' && userCity) params.city = userCity;
      if (tab === 'friends') params.friends_in_room = '1';
      if (typeFilter !== 'all') params.type = typeFilter;
      if (availability !== 'all') params.availability = availability;
      if (searchQuery.trim()) params.search = searchQuery.trim();
      if (cursor) params.cursor = cursor;
      return params;
    },
    [tab, typeFilter, availability, searchQuery, userCity]
  );

  // BUG-MED-05: use a ref so `fetchRooms` doesn't include `loading` in its
  // deps (which caused a stale-closure loop and double-fetches on every render).
  const loadingRef = useRef(false);

  const fetchRooms = useCallback(
    async (cursor?: string, isRefresh = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      try {
        if (isRefresh) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError(null);

        const params = buildParams(cursor);
        const qs = new URLSearchParams(params).toString();
        const { data } = await apiClient.get<{
          items: (RoomCardData & { is_full?: boolean })[];
          nextCursor: string | null;
          hasMore: boolean;
        }>(`/rooms?${qs}`);

        // API returns snake_case is_full — surface it as isFull for the card.
        const mapped = data.items.map((it) => ({ ...it, isFull: it.isFull ?? it.is_full }));
        if (isRefresh || !cursor) {
          setRooms(mapped);
        } else {
          setRooms((prev) => [...prev, ...mapped]);
        }
        setNextCursor(data.nextCursor);
        setHasMore(data.hasMore);
      } catch {
        setError('rooms.loadError');
      } finally {
        loadingRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [buildParams]
  );

  useEffect(() => {
    setRooms([]);
    setNextCursor(null);
    setHasMore(true);
    fetchRooms(undefined, false);
  }, [tab, typeFilter, availability, searchQuery, fetchRooms]);

  const refresh = useCallback(() => fetchRooms(undefined, true), [fetchRooms]);
  const loadMore = useCallback(() => {
    if (hasMore && nextCursor && !loading) {
      fetchRooms(nextCursor);
    }
  }, [hasMore, nextCursor, loading, fetchRooms]);

  return { rooms, loading, refreshing, error, refresh, loadMore, hasMore };
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/**
 * Rooms discovery tab — main entry point for finding and joining rooms.
 */
export default function RoomsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<DiscoveryTab>('trending');
  const [typeFilter, setTypeFilter] = useState<FilterChip>('all');
  const [availability, setAvailability] = useState<'all' | 'available' | 'full'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<TextInput>(null);

  const { rooms, loading, refreshing, error, refresh, loadMore, hasMore } =
    useRoomsQuery(activeTab, typeFilter, searchQuery, availability, user?.city);
  const { pinned } = usePinnedRooms();

  const handleRoomPress = useCallback(
    (room: RoomCardData) => {
      router.push(`/rooms/${room.id}` as never);
    },
    [router]
  );

  const handleCreateRoom = useCallback(() => {
    router.push('/rooms/create' as never);
  }, [router]);

  const renderItem = useCallback(
    ({ item }: { item: RoomCardData }) => (
      <RoomCard room={item} onPress={handleRoomPress} style={styles.cardItem} />
    ),
    [handleRoomPress]
  );

  const renderFooter = () => {
    if (!hasMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="small" color={colors.brand.blue} />
      </View>
    );
  };

  const renderEmpty = () => {
    if (loading) return <SkeletonList />;
    if (error) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      );
    }
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No rooms found.</Text>
        <Text style={styles.emptySubText}>Try a different filter or search.</Text>
      </View>
    );
  };

  return (
    <Screen>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Rooms</Text>
        {user && (
          <Pressable
            style={styles.createBtn}
            onPress={handleCreateRoom}
            accessibilityRole="button"
            accessibilityLabel="Create a room"
          >
            <Text style={styles.createBtnText}>+ Create</Text>
          </Pressable>
        )}
      </View>

      {/* Pinned rooms */}
      <PinnedRoomsStrip rooms={pinned} onPress={handleRoomPress} />

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchInputWrapper}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder="Search rooms..."
            placeholderTextColor={colors.neutral[400]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
        </View>
        <Pressable
          style={styles.filterBtn}
          onPress={() => router.push('/rooms/discover' as never)}
          accessibilityLabel="Advanced filters"
        >
          <Text style={styles.filterBtnText}>Filters</Text>
        </Pressable>
      </View>

      {/* Discovery tabs */}
      <View style={styles.tabRow}>
        {TABS.map((tab) => (
          <Pressable
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === tab.key }}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab.key && styles.tabTextActive,
              ]}
            >
              {t(`rooms.tab.${tab.key}`)}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Type filter chips */}
      <FlatList
        horizontal
        data={FILTER_CHIPS}
        keyExtractor={(item) => item.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
        renderItem={({ item }) => (
          <Pressable
            style={[
              styles.chip,
              typeFilter === item.key && {
                backgroundColor: ROOM_TYPE_FILTER_COLOR[item.key],
                borderColor: ROOM_TYPE_FILTER_COLOR[item.key],
              },
            ]}
            onPress={() => setTypeFilter(item.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: typeFilter === item.key }}
          >
            <Text
              style={[
                styles.chipText,
                typeFilter === item.key && styles.chipTextActive,
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        )}
        style={styles.chipsList}
      />

      {/* Availability filter chips */}
      <View style={styles.availabilityRow}>
        {([
          { key: 'all', label: t('room.availabilityAll') },
          { key: 'available', label: t('room.availabilityAvailable') },
          { key: 'full', label: t('room.availabilityFull') },
        ] as const).map((item) => (
          <Pressable
            key={item.key}
            style={[styles.chip, availability === item.key && styles.availabilityChipActive]}
            onPress={() => setAvailability(item.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: availability === item.key }}
          >
            <Text style={[styles.chipText, availability === item.key && styles.chipTextActive]}>
              {item.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Room feed */}
      <FlatList
        data={rooms}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        contentContainerStyle={styles.feedContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.brand.blue}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.neutral[900],
  },
  createBtn: {
    backgroundColor: colors.brand.blue,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnText: {
    color: colors.neutral[0],
    fontSize: 14,
    fontWeight: '700',
  },

  // Search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.neutral[100],
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
    gap: 6,
  },
  searchIcon: {
    fontSize: 14,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.neutral[900],
    height: 40,
  },
  filterBtn: {
    backgroundColor: colors.neutral[100],
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[700],
  },

  // Tabs
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[200],
    paddingHorizontal: 16,
  },
  tab: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginRight: 20,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: colors.brand.blue,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.neutral[500],
  },
  tabTextActive: {
    color: colors.brand.blue,
  },

  // Filter chips
  chipsList: {
    marginTop: 10,
  },
  chipsRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingRight: 16,
  },
  availabilityRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  availabilityChipActive: {
    backgroundColor: colors.brand.blue,
    borderColor: colors.brand.blue,
  },
  chip: {
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: colors.neutral[300],
    paddingHorizontal: 14,
    paddingVertical: 6,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[600],
  },
  chipTextActive: {
    color: colors.neutral[0],
  },

  // Feed
  feedContent: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 32,
  },
  cardItem: {
    // marginBottom handled by RoomCard styles
  },

  // Footer loader
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },

  // Empty / error
  centered: {
    flex: 1,
    paddingTop: 60,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.neutral[600],
  },
  emptySubText: {
    fontSize: 13,
    color: colors.neutral[400],
  },
  errorText: {
    fontSize: 14,
    color: colors.semantic.error,
    textAlign: 'center',
  },

  // Pinned rooms strip
  pinnedSection: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  pinnedTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.neutral[500],
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pinnedList: {
    gap: 10,
    paddingRight: 4,
  },
  pinnedCard: {
    backgroundColor: colors.neutral[0],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: 'center',
    width: 96,
  },
  pinnedEmoji: {
    fontSize: 24,
    marginBottom: 4,
  },
  pinnedName: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.neutral[800],
    textAlign: 'center',
    marginBottom: 2,
  },
  pinnedCount: {
    fontSize: 10,
    color: colors.neutral[400],
  },

  // Skeleton
  skeletonCard: {
    backgroundColor: colors.neutral[0],
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    marginBottom: 12,
  },
  skeletonCover: {
    height: 72,
    backgroundColor: colors.neutral[100],
  },
  skeletonBody: {
    padding: 12,
    gap: 8,
  },
  skeletonLine: {
    height: 14,
    backgroundColor: colors.neutral[200],
    borderRadius: 7,
    width: '80%',
  },
  skeletonPulse: {
    height: 4,
    backgroundColor: colors.neutral[100],
    borderRadius: 2,
  },
});
