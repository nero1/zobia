/**
 * app/g/[slug].tsx
 *
 * Expo universal-link landing for games (/g/<slug>). Games are an upcoming
 * feature with no in-app screen yet, so this shows a "coming soon" notice.
 * Any ?r= referral on the link has already been captured globally by
 * useReferralCaptureFromLink in app/_layout.tsx, so attribution still works
 * even before the games experience ships.
 */

import { StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';

export default function PublicGameLink() {
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <Screen>
      <Stack.Screen options={{ title: t('games.title', 'Games') }} />
      <View style={styles.container}>
        <Text style={styles.emoji} accessibilityElementsHidden>
          🎮
        </Text>
        <Text style={[styles.title, { color: colors.text }]}>
          {t('games.comingSoonTitle', 'Games are coming soon')}
        </Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          {t(
            'games.comingSoonBody',
            'This game will be playable in the app shortly. Your invite has been saved.',
          )}
        </Text>
        <Button label={t('common.goHome', 'Go home')} onPress={() => router.replace('/(tabs)')} />
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
