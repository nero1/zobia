import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/ui/Screen';

/**
 * Guild tab — Phase 1 placeholder.
 * Will display the user's guild, leaderboard, and XP progress in later phases.
 */
export default function GuildScreen() {
  const { t } = useTranslation();

  return (
    <Screen>
      <View className="flex-1 items-center justify-center gap-2">
        <Text className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          {t('guild.title')}
        </Text>
        <Text className="text-base text-neutral-500 dark:text-neutral-400">
          {t('common.comingSoon')}
        </Text>
      </View>
    </Screen>
  );
}
