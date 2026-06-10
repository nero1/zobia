/**
 * app/(tabs)/friends.tsx
 *
 * Friends tab — My Friends, Requests, and Discover sections.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Friend {
  id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string;
  rank_name: string | null;
}

interface FriendRequest {
  id: string;
  requester_id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string;
  created_at: string;
}

interface Suggestion {
  id: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  rankName: string | null;
  mutualFriendCount: number;
}

type Tab = 'friends' | 'requests' | 'discover';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FriendsTab() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const bg = isDark ? colors.neutral[950] : colors.neutral[50];
  const cardBg = isDark ? colors.neutral[900] : colors.neutral[0];
  const border = isDark ? colors.neutral[800] : colors.neutral[200];
  const textPrimary = isDark ? colors.neutral[50] : colors.neutral[900];
  const textSecondary = isDark ? colors.neutral[400] : colors.neutral[500];

  const [tab, setTab] = useState<Tab>('friends');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actioning, setActioning] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [fr, rr, sr] = await Promise.all([
        apiClient.get('/api/friends').catch(() => null),
        apiClient.get('/api/friends/requests').catch(() => null),
        apiClient.get('/api/friends/suggestions').catch(() => null),
      ]);
      setFriends((fr?.data?.data ?? []) as Friend[]);
      setRequests((rr?.data?.data ?? []) as FriendRequest[]);
      setSuggestions((sr?.data?.suggestions ?? []) as Suggestion[]);
    } catch { /* non-fatal */ }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); void load(); };

  const respondToRequest = async (requestId: string, action: 'accept' | 'decline') => {
    setActioning(requestId);
    try {
      await apiClient.patch(`/api/friends/${requestId}`, { action });
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch { /* non-fatal */ }
    finally { setActioning(null); }
  };

  const sendRequest = async (userId: string) => {
    setActioning(userId);
    try {
      await apiClient.post('/api/friends', { userId });
      setSuggestions((prev) => prev.filter((s) => s.id !== userId));
    } catch { /* non-fatal */ }
    finally { setActioning(null); }
  };

  const removeFriend = async (friendId: string) => {
    setActioning(friendId);
    try {
      await apiClient.delete(`/api/friends/${friendId}`);
      setFriends((prev) => prev.filter((f) => f.id !== friendId));
    } catch { /* non-fatal */ }
    finally { setActioning(null); }
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: bg }]}>
        <ActivityIndicator color={colors.brand.blue} />
      </View>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'friends', label: 'My Friends' },
    { id: 'requests', label: `Requests${requests.length > 0 ? ` (${requests.length})` : ''}` },
    { id: 'discover', label: 'Discover' },
  ];

  const renderContent = () => {
    if (tab === 'friends') {
      if (friends.length === 0)
        return <Text style={[styles.emptyText, { color: textSecondary }]}>You haven't added any friends yet. Go to Discover to find people.</Text>;
      return friends.map((f) => (
        <View key={f.id} style={[styles.row, { borderBottomColor: border }]}>
          <View style={[styles.avatar, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100] }]}>
            <Text style={styles.avatarEmoji}>{f.avatar_emoji || '😊'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.displayName, { color: textPrimary }]}>{f.display_name ?? f.username}</Text>
            <Text style={[styles.username, { color: textSecondary }]}>@{f.username}</Text>
          </View>
          <Pressable
            onPress={() => removeFriend(f.id)}
            disabled={actioning === f.id}
            style={[styles.actionBtn, { borderColor: border }]}
          >
            <Text style={[styles.actionBtnText, { color: textSecondary }]}>
              {actioning === f.id ? '…' : 'Remove'}
            </Text>
          </Pressable>
        </View>
      ));
    }

    if (tab === 'requests') {
      if (requests.length === 0)
        return <Text style={[styles.emptyText, { color: textSecondary }]}>No pending friend requests.</Text>;
      return requests.map((r) => (
        <View key={r.id} style={[styles.row, { borderBottomColor: border }]}>
          <View style={[styles.avatar, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100] }]}>
            <Text style={styles.avatarEmoji}>{r.avatar_emoji || '😊'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.displayName, { color: textPrimary }]}>{r.display_name ?? r.username}</Text>
            <Text style={[styles.username, { color: textSecondary }]}>@{r.username}</Text>
          </View>
          <View style={{ gap: 6 }}>
            <Pressable
              onPress={() => respondToRequest(r.id, 'accept')}
              disabled={actioning === r.id}
              style={[styles.primaryBtn, { backgroundColor: colors.brand.blue }]}
            >
              <Text style={styles.primaryBtnText}>{actioning === r.id ? '…' : 'Accept'}</Text>
            </Pressable>
            <Pressable
              onPress={() => respondToRequest(r.id, 'decline')}
              disabled={actioning === r.id}
              style={[styles.actionBtn, { borderColor: border }]}
            >
              <Text style={[styles.actionBtnText, { color: textSecondary }]}>Decline</Text>
            </Pressable>
          </View>
        </View>
      ));
    }

    // Discover
    if (suggestions.length === 0)
      return <Text style={[styles.emptyText, { color: textSecondary }]}>No suggestions right now. Join more rooms and guilds to discover people.</Text>;
    return suggestions.map((s) => (
      <View key={s.id} style={[styles.row, { borderBottomColor: border }]}>
        <View style={[styles.avatar, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100] }]}>
          <Text style={styles.avatarEmoji}>{s.avatarEmoji || '😊'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.displayName, { color: textPrimary }]}>{s.displayName}</Text>
          <Text style={[styles.username, { color: textSecondary }]}>
            @{s.username}{s.mutualFriendCount > 0 ? ` · ${s.mutualFriendCount} mutual` : ''}
          </Text>
        </View>
        <Pressable
          onPress={() => sendRequest(s.id)}
          disabled={actioning === s.id}
          style={[styles.primaryBtn, { backgroundColor: colors.brand.blue }]}
        >
          <Text style={styles.primaryBtnText}>{actioning === s.id ? '…' : 'Add'}</Text>
        </Pressable>
      </View>
    ));
  };

  return (
    <ScrollView
      style={{ backgroundColor: bg }}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={[styles.heading, { color: textPrimary }]}>Friends</Text>

      {/* Tab bar */}
      <View style={[styles.tabBar, { backgroundColor: cardBg, borderColor: border }]}>
        {tabs.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => setTab(t.id)}
            style={[
              styles.tabBtn,
              tab === t.id && { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[50] },
            ]}
          >
            <Text
              style={[
                styles.tabBtnText,
                { color: tab === t.id ? (isDark ? colors.neutral[50] : colors.neutral[900]) : textSecondary },
              ]}
            >
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Content */}
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
        {renderContent()}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  container: { padding: 16, paddingBottom: 100 },
  heading: { fontSize: 24, fontWeight: '700', marginBottom: 16 },
  tabBar: {
    flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 4, marginBottom: 12,
  },
  tabBtn: { flex: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  tabBtnText: { fontSize: 12, fontWeight: '600' },
  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1,
  },
  avatar: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  avatarEmoji: { fontSize: 20 },
  displayName: { fontSize: 14, fontWeight: '600' },
  username: { fontSize: 12, marginTop: 2 },
  emptyText: { fontSize: 14, textAlign: 'center', padding: 24 },
  actionBtn: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  actionBtnText: { fontSize: 12, fontWeight: '500' },
  primaryBtn: { borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center' },
  primaryBtnText: { fontSize: 12, fontWeight: '700', color: '#fff' },
});
