/**
 * app/games/leaderboards.tsx
 *
 * Per-game high-score leaderboards (mobile). Pick a game; see its top players.
 * The overall gaming-track (XP) ranking lives on the main Leaderboards screen
 * under the "Gaming" track pill.
 */

import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { apiClient } from '@/lib/api/client';

interface GameSummary { slug: string; name: string; }
interface Row { rank: number; username: string; displayName: string; avatarEmoji: string; bestScore: number; }

export default function GamesLeaderboardsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [slug, setSlug] = useState<string>('');

  const gamesQ = useQuery({
    queryKey: ['games', 'list'],
    queryFn: async () => {
      const res = await apiClient.get('/games');
      const list = (res.data.data.games ?? []) as GameSummary[];
      if (list[0] && !slug) setSlug(list[0].slug);
      return list;
    },
  });

  const boardQ = useQuery({
    queryKey: ['games', 'leaderboard', slug],
    enabled: !!slug,
    queryFn: async () => {
      const res = await apiClient.get(`/games/${slug}/leaderboard`);
      return (res.data.data.rows ?? []) as Row[];
    },
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: t('games.leaderboards', 'Leaderboards') }} />
      <View style={styles.pills}>
        {(gamesQ.data ?? []).map((g: GameSummary) => (
          <Pressable key={g.slug} onPress={() => setSlug(g.slug)}
            style={[styles.pill, { backgroundColor: slug === g.slug ? colors.primary : colors.surface }]}>
            <Text style={{ color: slug === g.slug ? '#fff' : colors.text, fontSize: 12 }}>{g.name}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={boardQ.data ?? []}
        keyExtractor={(r) => r.username}
        contentContainerStyle={{ padding: 12 }}
        ListEmptyComponent={<Text style={{ color: colors.textMuted, padding: 16 }}>{t('games.noScores', 'No scores yet. Be the first!')}</Text>}
        renderItem={({ item }) => (
          <View style={[styles.row, { borderBottomColor: colors.border }]}>
            <Text style={[styles.rank, { color: colors.textMuted }]}>{item.rank}</Text>
            <Text style={styles.emoji}>{item.avatarEmoji}</Text>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{item.displayName || item.username}</Text>
            <Text style={styles.scoreText}>{item.bestScore}</Text>
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 12 },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  rank: { width: 24, fontWeight: '700' },
  emoji: { fontSize: 20 },
  name: { flex: 1, fontWeight: '500' },
  scoreText: { color: '#10b981', fontWeight: '700' },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';
