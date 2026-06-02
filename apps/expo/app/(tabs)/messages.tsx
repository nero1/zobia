import { View, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/ui/Screen';

/**
 * Messages tab — Phase 1 placeholder.
 * Will display direct and guild message threads in later phases.
 */
export default function MessagesScreen() {
  const { t } = useTranslation();

  return (
    <Screen>
      <View className="flex-1 items-center justify-center gap-2">
        <Text className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          {t('messages.title')}
        </Text>
        <Text className="text-base text-neutral-500 dark:text-neutral-400">
          {t('common.comingSoon')}
        </Text>
      </View>
    </Screen>
  );
}
