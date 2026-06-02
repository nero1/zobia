import { View, Text, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/ui/Screen';
import { colors } from '@/lib/theme/colors';

/**
 * Home tab — Phase 1 placeholder.
 * Renders the app name and a loading indicator as a skeleton state.
 */
export default function HomeScreen() {
  const { t } = useTranslation();

  return (
    <Screen>
      <View className="flex-1 items-center justify-center gap-4">
        <Text className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          {t('home.title')}
        </Text>
        <Text className="text-base text-neutral-500 dark:text-neutral-400">
          {t('home.subtitle')}
        </Text>
        <ActivityIndicator size="large" color={colors.brand.blue} />
      </View>
    </Screen>
  );
}
