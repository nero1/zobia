/**
 * app/messages/new.tsx
 *
 * New DM screen.
 *
 * Features:
 *  - Search users by username
 *  - Friend list quick-select
 *  - Shows DM cost info per plan
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchUser {
  id: string;
  displayName: string;
  username: string;
  avatarEmoji: string;
  isFriend: boolean;
}

interface Friend {
  userId: string;
  displayName: string;
  username: string;
  avatarEmoji: string;
}

interface DMCostInfo {
  plan: string;
  costPerDM: number;
  isUnlimited: boolean;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function searchUsers(query: string): Promise<SearchUser[]> {
  if (query.length < 2) return [];
  const { data } = await apiClient.get('/users/search', { params: { q: query, limit: 20 } });
  return data.data?.users ?? [];
}

async function fetchFriends(): Promise<Friend[]> {
  const { data } = await apiClient.get('/friends');
  return data.friends ?? [];
}

async function fetchDMCostInfo(): Promise<DMCostInfo> {
  const { data } = await apiClient.get('/messages/dm-cost-info');
  return data;
}

async function startConversation(targetUserId: string): Promise<{ conversationId: string }> {
  const { data } = await apiClient.post('/messages/dm', { targetUserId });
  return data;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function UserRow({ user, onSelect }: { user: SearchUser | Friend; onSelect: () => void }) {
  const { colors: themeColors } = useTheme();
  return (
    <Pressable
      onPress={onSelect}
      style={[styles.userRow, { borderBottomColor: themeColors.border }]}
      accessibilityRole="button"
      accessibilityLabel={`Message ${(user as SearchUser).displayName}`}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarEmoji}>{user.avatarEmoji}</Text>
      </View>
      <View style={styles.userInfo}>
        <Text style={[styles.displayName, { color: themeColors.text }]}>
          {(user as SearchUser).displayName}
        </Text>
        <Text style={[styles.username, { color: themeColors.textMuted }]}>
          @{user.username}
          {'isFriend' in user && user.isFriend ? ' · Friend' : ''}
        </Text>
      </View>
      <Text style={[styles.messageIcon, { color: colors.brand.blue }]}>✉</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/**
 * NewDMScreen — search or pick a friend to start a DM conversation.
 */
export default function NewDMScreen() {
  const router = useRouter();
  const { colors: themeColors } = useTheme();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const { data: searchResults = [], isFetching: isSearching } = useQuery({
    queryKey: ['user-search', debouncedQuery],
    queryFn: () => searchUsers(debouncedQuery),
    enabled: debouncedQuery.length >= 2,
  });

  const { data: friends = [] } = useQuery({
    queryKey: ['friends'],
    queryFn: fetchFriends,
  });

  const { data: dmCostInfo } = useQuery({
    queryKey: ['dm-cost-info'],
    queryFn: fetchDMCostInfo,
  });

  const startConvMutation = useMutation({
    mutationFn: startConversation,
    onSuccess: (data) => {
      router.replace(`/messages/${data.conversationId}`);
    },
  });

  const handleSelect = (userId: string) => {
    startConvMutation.mutate(userId);
  };

  const showSearch = debouncedQuery.length >= 2;

  return (
    <Screen disableBottomInset>
      {/* Search bar */}
      <View style={[styles.searchBar, { backgroundColor: themeColors.surface, borderBottomColor: themeColors.border }]}>
        <Text style={[styles.searchIcon, { color: themeColors.textMuted }]}>🔍</Text>
        <TextInput
          style={[styles.searchInput, { color: themeColors.text }]}
          placeholder="Search by username…"
          placeholderTextColor={themeColors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoFocus
          autoCapitalize="none"
          returnKeyType="search"
        />
        {isSearching && <ActivityIndicator size="small" color={colors.brand.blue} />}
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} style={styles.clearBtn} accessibilityLabel="Clear search">
            <Text style={[styles.clearBtnText, { color: themeColors.textMuted }]}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* DM cost info */}
      {dmCostInfo && !dmCostInfo.isUnlimited && (
        <View style={styles.costInfo}>
          <Text style={[styles.costInfoText, { color: themeColors.textMuted }]}>
            💬 DMs cost {dmCostInfo.costPerDM} coin{dmCostInfo.costPerDM !== 1 ? 's' : ''} per message
            {' '}({dmCostInfo.plan} plan)
          </Text>
        </View>
      )}

      <FlatList
        data={showSearch ? searchResults : friends}
        keyExtractor={(u) => u.id}
        renderItem={({ item }) => (
          <UserRow
            user={item}
            onSelect={() => handleSelect(item.id)}
          />
        )}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          !showSearch ? (
            <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>
              Friends
            </Text>
          ) : null
        }
        ListEmptyComponent={() =>
          showSearch && !isSearching ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
                No users found for "{debouncedQuery}"
              </Text>
            </View>
          ) : !showSearch && friends.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
                No friends yet. Search by username above.
              </Text>
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
    minHeight: 56,
  },
  searchIcon: { fontSize: 16 },
  searchInput: {
    flex: 1,
    fontSize: 16,
    minHeight: 36,
  },
  clearBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearBtnText: { fontSize: 14, fontWeight: '600' },

  costInfo: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: `${colors.brand.blue}0C`,
  },
  costInfoText: { fontSize: 13 },

  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingVertical: 10,
    textTransform: 'uppercase',
  },

  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
    minHeight: 60,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: { fontSize: 24 },
  userInfo: { flex: 1 },
  displayName: { fontSize: 15, fontWeight: '600' },
  username: { fontSize: 13, marginTop: 2 },
  messageIcon: { fontSize: 18 },

  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center' },
});
