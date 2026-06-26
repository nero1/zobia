/**
 * app/games/index.tsx
 *
 * Games directory (mobile). Lists active games grouped by category and links to
 * challenges + leaderboards. Games render via the shared WebView host.
 */

import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { apiClient } from '@/lib/api/client';
import { AdBanner } from '@/components/ads/AdBanner';

interface GameSummary {
  slug: string;
  name: string;
  tagline: string | null;
  coverEmoji: string;
  category: string | null;
  rewardCreditsPerWin: number;
  playCostCredits: number;
  playCostStars: number;
}

export default function GamesDirectoryScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();

  const { data, isLoading, error } = useQuery({
    queryKey: ['games', 'directory'],
    queryFn: async () => {
      const res = await apiClient.get('/games');
      return res.data.data as { games: GameSummary[] };
    },
  });

  const games = useMemo(() => data?.games ?? [], [data]);
  const disabled = (error as { response?: { status?: number } })?.response?.status === 403;

  return (
    <Screen>
      <Stack.Screen options={{ title: t('games.title', 'Games') }} />

      <View style={styles.header}>
        <Pressable onPress={() => router.push('/games/challenges')} style={[styles.pill, { backgroundColor: colors.surface }]}>
          <Text style={{ color: colors.text }}>{t('games.challenges', 'Challenges')}</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/games/leaderboards')} style={[styles.pill, { backgroundColor: colors.surface }]}>
          <Text style={{ color: colors.text }}>{t('games.leaderboards', 'Leaderboards')}</Text>
        </Pressable>
      </View>

      <AdBanner placement="games-directory" />

      {disabled ? (
        <View style={styles.center}>
          <Text style={[styles.emoji]}>🎮</Text>
          <Text style={[styles.title, { color: colors.text }]}>{t('games.unavailableTitle', 'Games are currently unavailable')}</Text>
          <Text style={{ color: colors.textMuted, textAlign: 'center' }}>{t('games.unavailableBody', 'This feature has been turned off. Check back soon!')}</Text>
        </View>
      ) : (
        <FlatList
          data={games}
          keyExtractor={(g) => g.slug}
          numColumns={2}
          contentContainerStyle={{ padding: 12, gap: 12 }}
          columnWrapperStyle={{ gap: 12 }}
          ListEmptyComponent={
            !isLoading ? <Text style={{ color: colors.textMuted, padding: 16 }}>{t('games.empty', 'No games are available right now.')}</Text> : null
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/games/play', params: { slug: item.slug } })}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Text style={styles.cardEmoji}>{item.coverEmoji}</Text>
              <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
              {item.tagline ? <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={2}>{item.tagline}</Text> : null}
              <Text style={{ color: '#10b981', fontSize: 12, marginTop: 4 }}>
                {item.rewardCreditsPerWin > 0 ? `+${item.rewardCreditsPerWin} ${t('games.credits', 'credits')}` : t('games.freePlay', 'Free to play')}
              </Text>
              {(item.playCostCredits > 0 || item.playCostStars > 0) ? (
                <Text style={{ color: '#f59e0b', fontSize: 12 }}>
                  {item.playCostCredits > 0 ? `${item.playCostCredits} ${t('games.credits', 'credits')}` : `${item.playCostStars} ⭐`}
                </Text>
              ) : null}
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', gap: 8, padding: 12 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  card: { flex: 1, borderRadius: 14, borderWidth: 1, padding: 14 },
  cardEmoji: { fontSize: 34, marginBottom: 6 },
  cardTitle: { fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  emoji: { fontSize: 56 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';
