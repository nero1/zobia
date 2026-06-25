/**
 * app/(tabs)/friends.tsx
 *
 * Friends tab — My Friends, Requests (Received/Sent), and Discover sections.
 */

import React, { useCallback, useState } from 'react';
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
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  requester_id?: string;
  addressee_id?: string;
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
type RequestsSubTab = 'received' | 'sent';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FriendsTab() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const { t } = useTranslation();

  const bg = isDark ? colors.neutral[950] : colors.neutral[50];
  const cardBg = isDark ? colors.neutral[900] : colors.neutral[0];
  const border = isDark ? colors.neutral[800] : colors.neutral[200];
  const textPrimary = isDark ? colors.neutral[50] : colors.neutral[900];
  const textSecondary = isDark ? colors.neutral[400] : colors.neutral[500];
  const subTabActiveBg = isDark ? colors.neutral[800] : colors.neutral[0];

  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('friends');
  const [requestsSubTab, setRequestsSubTab] = useState<RequestsSubTab>('received');
  const [actioning, setActioning] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data: friends = [], isLoading: friendsLoading, refetch: refetchFriends } = useQuery<Friend[]>({
    queryKey: ['friends'],
    queryFn: async () => {
      const { data } = await apiClient.get('/friends');
      return (data?.data ?? []) as Friend[];
    },
  });

  const { data: receivedRequests = [], isLoading: requestsLoading, refetch: refetchReceived } = useQuery<FriendRequest[]>({
    queryKey: ['friend-requests', 'received'],
    queryFn: async () => {
      const { data } = await apiClient.get('/friends/requests');
      return (data?.data ?? []) as FriendRequest[];
    },
  });

  const { data: sentRequests = [], refetch: refetchSent } = useQuery<FriendRequest[]>({
    queryKey: ['friend-requests', 'sent'],
    queryFn: async () => {
      const { data } = await apiClient.get('/friends/requests/sent');
      return (data?.data ?? []) as FriendRequest[];
    },
  });

  const { data: suggestions = [], isLoading: suggestionsLoading, refetch: refetchSuggestions } = useQuery<Suggestion[]>({
    queryKey: ['friend-suggestions'],
    queryFn: async () => {
      const { data } = await apiClient.get('/friends/suggestions');
      return (data?.suggestions ?? []) as Suggestion[];
    },
  });

  const loading = friendsLoading || requestsLoading || suggestionsLoading;

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.all([refetchFriends(), refetchReceived(), refetchSent(), refetchSuggestions()])
      .finally(() => setRefreshing(false));
  }, [refetchFriends, refetchReceived, refetchSent, refetchSuggestions]);

  const respondToRequest = async (requestId: string, action: 'accept' | 'reject') => {
    setActioning(requestId);
    try {
      await apiClient.put(`/friends/${requestId}`, { action });
      await qc.invalidateQueries({ queryKey: ['friend-requests'] });
      if (action === 'accept') await qc.invalidateQueries({ queryKey: ['friends'] });
    } catch { /* non-fatal */ }
    finally { setActioning(null); }
  };

  const withdrawRequest = async (requestId: string) => {
    setActioning(requestId);
    try {
      await apiClient.delete(`/friends/${requestId}`);
      await qc.invalidateQueries({ queryKey: ['friend-requests', 'sent'] });
    } catch { /* non-fatal */ }
    finally { setActioning(null); }
  };

  const sendRequest = async (userId: string) => {
    setActioning(userId);
    try {
      await apiClient.post('/friends', { userId });
      await qc.invalidateQueries({ queryKey: ['friend-suggestions'] });
    } catch { /* non-fatal */ }
    finally { setActioning(null); }
  };

  const removeFriend = async (friendId: string) => {
    setActioning(friendId);
    try {
      await apiClient.delete(`/friends/${friendId}`);
      await qc.invalidateQueries({ queryKey: ['friends'] });
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

  const totalRequests = receivedRequests.length + sentRequests.length;
  const tabs: { id: Tab; label: string }[] = [
    { id: 'friends', label: t('friends.tabs.myFriends') },
    {
      id: 'requests',
      label: totalRequests > 0
        ? `${t('friends.tabs.requests')} (${totalRequests})`
        : t('friends.tabs.requests'),
    },
    { id: 'discover', label: t('friends.tabs.discover') },
  ];

  const renderFriends = () => {
    if (friends.length === 0)
      return <Text style={[styles.emptyText, { color: textSecondary }]}>{t('friends.empty.noFriends')}</Text>;
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
            {actioning === f.id ? '…' : t('friends.removeFriend')}
          </Text>
        </Pressable>
      </View>
    ));
  };

  const renderReceivedRequests = () => {
    if (receivedRequests.length === 0)
      return <Text style={[styles.emptyText, { color: textSecondary }]}>{t('friends.empty.noReceivedRequests')}</Text>;
    return receivedRequests.map((r) => (
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
            <Text style={styles.primaryBtnText}>{actioning === r.id ? '…' : t('friends.accept')}</Text>
          </Pressable>
          <Pressable
            onPress={() => respondToRequest(r.id, 'reject')}
            disabled={actioning === r.id}
            style={[styles.actionBtn, { borderColor: border }]}
          >
            <Text style={[styles.actionBtnText, { color: textSecondary }]}>{t('friends.decline')}</Text>
          </Pressable>
        </View>
      </View>
    ));
  };

  const renderSentRequests = () => {
    if (sentRequests.length === 0)
      return <Text style={[styles.emptyText, { color: textSecondary }]}>{t('friends.empty.noSentRequests')}</Text>;
    return sentRequests.map((r) => (
      <View key={r.id} style={[styles.row, { borderBottomColor: border }]}>
        <View style={[styles.avatar, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100] }]}>
          <Text style={styles.avatarEmoji}>{r.avatar_emoji || '😊'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.displayName, { color: textPrimary }]}>{r.display_name ?? r.username}</Text>
          <Text style={[styles.username, { color: textSecondary }]}>@{r.username}</Text>
        </View>
        <Pressable
          onPress={() => withdrawRequest(r.id)}
          disabled={actioning === r.id}
          style={[styles.actionBtn, { borderColor: border }]}
        >
          <Text style={[styles.actionBtnText, { color: textSecondary }]}>
            {actioning === r.id ? '…' : t('friends.requests.withdraw')}
          </Text>
        </Pressable>
      </View>
    ));
  };

  const renderDiscover = () => {
    if (suggestions.length === 0)
      return <Text style={[styles.emptyText, { color: textSecondary }]}>{t('friends.empty.noSuggestions')}</Text>;
    return suggestions.map((s) => (
      <View key={s.id} style={[styles.row, { borderBottomColor: border }]}>
        <View style={[styles.avatar, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100] }]}>
          <Text style={styles.avatarEmoji}>{s.avatarEmoji || '😊'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.displayName, { color: textPrimary }]}>{s.displayName}</Text>
          <Text style={[styles.username, { color: textSecondary }]}>
            @{s.username}{s.mutualFriendCount > 0 ? ` · ${s.mutualFriendCount} ${s.mutualFriendCount === 1 ? t('friends.mutualFriend') : t('friends.mutualFriends')}` : ''}
          </Text>
        </View>
        <Pressable
          onPress={() => sendRequest(s.id)}
          disabled={actioning === s.id}
          style={[styles.primaryBtn, { backgroundColor: colors.brand.blue }]}
        >
          <Text style={styles.primaryBtnText}>{actioning === s.id ? '…' : t('friends.addFriend')}</Text>
        </Pressable>
      </View>
    ));
  };

  return (
    <ScrollView
      style={[{ flex: 1 }, { backgroundColor: bg }]}
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={[styles.heading, { color: textPrimary }]}>{t('friends.title')}</Text>

      {/* Main tab bar */}
      <View style={[styles.tabBar, { backgroundColor: cardBg, borderColor: border }]}>
        {tabs.map((tabItem) => (
          <Pressable
            key={tabItem.id}
            onPress={() => setTab(tabItem.id)}
            style={[
              styles.tabBtn,
              tab === tabItem.id && { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[50] },
            ]}
          >
            <Text
              style={[
                styles.tabBtnText,
                { color: tab === tabItem.id ? (isDark ? colors.neutral[50] : colors.neutral[900]) : textSecondary },
              ]}
            >
              {tabItem.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Content */}
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
        {tab === 'friends' && renderFriends()}
        {tab === 'requests' && (
          <>
            {/* Requests sub-tab bar */}
            <View style={[styles.subTabBar, { borderBottomColor: border }]}>
              {(['received', 'sent'] as RequestsSubTab[]).map((st) => {
                const count = st === 'received' ? receivedRequests.length : sentRequests.length;
                const isActive = requestsSubTab === st;
                return (
                  <Pressable
                    key={st}
                    onPress={() => setRequestsSubTab(st)}
                    style={[
                      styles.subTabBtn,
                      isActive && [styles.subTabBtnActive, { backgroundColor: subTabActiveBg, borderColor: border }],
                    ]}
                  >
                    <Text style={[styles.subTabBtnText, { color: isActive ? (isDark ? colors.neutral[50] : colors.neutral[900]) : textSecondary }]}>
                      {st === 'received' ? t('friends.requests.received') : t('friends.requests.sent')}
                      {count > 0 ? ` (${count})` : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {requestsSubTab === 'received' ? renderReceivedRequests() : renderSentRequests()}
          </>
        )}
        {tab === 'discover' && renderDiscover()}
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
  subTabBar: {
    flexDirection: 'row', borderBottomWidth: 1, paddingHorizontal: 4, paddingTop: 4,
  },
  subTabBtn: {
    flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8, marginBottom: 4,
  },
  subTabBtnActive: {
    borderWidth: 1,
  },
  subTabBtnText: { fontSize: 12, fontWeight: '600' },
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
