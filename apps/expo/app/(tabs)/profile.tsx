import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/lib/auth/hooks';

/**
 * Profile tab — Phase 1 placeholder.
 * Will show user stats, avatar, rank, and settings in later phases.
 */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <Screen>
      <View className="flex-1 items-center justify-center gap-2">
        <Text className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          {user?.username ?? t('profile.title')}
        </Text>
        <Text className="text-base text-neutral-500 dark:text-neutral-400">
          {t('common.comingSoon')}
        </Text>
      </View>
    </Screen>
  );
}
