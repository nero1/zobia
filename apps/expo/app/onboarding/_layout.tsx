import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';

import { colors } from '@/lib/theme/colors';

/**
 * Onboarding stack layout.
 *
 * Four steps:
 *   1. index         — username, avatar emoji, city
 *   2. vibe-quiz     — 4-question vibe quiz
 *   3. welcome-drop  — 500 XP celebration
 *   4. first-contact — invite contacts, first room, accept New Member Quest
 *
 * No header is shown; each screen manages its own back affordance if needed.
 */
export default function OnboardingLayout() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: isDark ? colors.neutral[950] : colors.neutral[50],
        },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="vibe-quiz" />
      <Stack.Screen name="welcome-drop" />
      <Stack.Screen name="first-contact" />
    </Stack>
  );
}
