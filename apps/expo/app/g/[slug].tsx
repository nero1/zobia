/**
 * app/g/[slug].tsx
 *
 * Expo universal-link landing for games (/g/<slug>). Non-members see a login
 * gate (the ?r= referral on the link is captured globally by
 * useReferralCaptureFromLink in app/_layout.tsx, so attribution survives).
 * Members get a "Play" button that opens the game in the WebView host.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { useIsAuthenticated } from '@/lib/auth/hooks';
import { apiClient } from '@/lib/api/client';

interface GameSummary {
  slug: string;
  name: string;
  tagline: string | null;
  coverEmoji: string;
  longDescription: string | null;
  description: string | null;
}

export default function PublicGameLink() {
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const isAuthed = useIsAuthenticated();
  const [game, setGame] = useState<GameSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthed || !slug) {
      setLoading(false);
      return;
    }
    apiClient
      .get(`/games/${slug}`)
      .then((res) => setGame(res.data.data.game as GameSummary))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAuthed, slug]);

  return (
    <Screen>
      <Stack.Screen options={{ title: game?.name ?? t('games.title', 'Games') }} />
      <View style={styles.container}>
        <Text style={styles.emoji} accessibilityElementsHidden>{game?.coverEmoji ?? '🎮'}</Text>
        <Text style={[styles.title, { color: colors.text }]}>{game?.name ?? t('games.title', 'Game')}</Text>
        {game?.tagline ? <Text style={[styles.body, { color: colors.textMuted }]}>{game.tagline}</Text> : null}
        {game?.longDescription || game?.description ? (
          <Text style={[styles.body, { color: colors.textMuted }]}>{game?.longDescription || game?.description}</Text>
        ) : null}

        {loading ? (
          <ActivityIndicator />
        ) : isAuthed ? (
          <Button
            label={`▶ ${t('games.play', 'Play')}`}
            onPress={() => router.push({ pathname: '/games/play', params: { slug } })}
          />
        ) : (
          <View style={{ gap: 10, width: '100%' }}>
            <Text style={[styles.body, { color: colors.text, fontWeight: '600' }]}>
              {t('games.loginToPlay', 'Log in to play this game')}
            </Text>
            <Button label={t('auth.login', 'Log in')} onPress={() => router.push('/auth/login')} />
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  emoji: { fontSize: 56 },
  title: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 15, textAlign: 'center', marginBottom: 12 },
});
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';
