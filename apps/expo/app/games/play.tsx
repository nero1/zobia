/**
 * app/games/play.tsx
 *
 * Full-screen game host. Loads the selected game in the shared WebView. Accepts
 * ?slug= (solo) and optional ?challengeId= (challenge round). On game over it
 * shows the score + reward and lets the player exit / replay.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { GameWebView } from '@/components/games/GameWebView';

export default function PlayGameScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { slug, challengeId } = useLocalSearchParams<{ slug: string; challengeId?: string }>();
  const [result, setResult] = useState<{ score: number; reward?: { credits: number; xp: number; stars: number } } | null>(null);
  const [key, setKey] = useState(0);

  if (!slug) {
    return (
      <Screen>
        <View style={styles.center}><Text style={{ color: colors.text }}>{t('games.empty', 'No game selected.')}</Text></View>
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <Stack.Screen options={{ title: t('games.play', 'Play') }} />
      {result ? (
        <View style={styles.center}>
          <Text style={[styles.score, { color: colors.text }]}>{t('games.title', 'Score')}: {result.score}</Text>
          {result.reward && (result.reward.credits > 0 || result.reward.xp > 0 || result.reward.stars > 0) ? (
            <Text style={{ color: '#10b981', marginTop: 8 }}>
              +{result.reward.credits} {t('games.credits', 'credits')} · +{result.reward.xp} XP
              {result.reward.stars > 0 ? ` · +${result.reward.stars} ⭐` : ''}
            </Text>
          ) : null}
          <View style={styles.row}>
            {!challengeId && (
              <Pressable onPress={() => { setResult(null); setKey((k) => k + 1); }} style={[styles.btn, { backgroundColor: colors.primary }]}>
                <Text style={styles.btnText}>{t('games.play', 'Play again')}</Text>
              </Pressable>
            )}
            <Pressable onPress={() => router.back()} style={[styles.btn, { backgroundColor: colors.surface }]}>
              <Text style={[styles.btnText, { color: colors.text }]}>{t('common.goHome', 'Done')}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <GameWebView
          key={key}
          slug={slug}
          challengeId={challengeId ?? null}
          onGameOver={(payload) => setResult(payload)}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  score: { fontSize: 26, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 12, marginTop: 24 },
  btn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 },
  btnText: { color: '#fff', fontWeight: '700' },
});
