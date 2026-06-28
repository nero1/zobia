import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTheme } from '@/lib/theme';
import { useDrawer } from '@/components/layout/SwipeDrawer';

const HEADER_CONTENT_HEIGHT = 56;

export function AppHeader() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { openDrawer } = useDrawer();
  const router = useRouter();

  const headerHeight = HEADER_CONTENT_HEIGHT + insets.top;

  return (
    <View
      style={[
        styles.container,
        {
          height: headerHeight,
          paddingTop: insets.top,
          backgroundColor: colors.surface,
          borderBottomColor: colors.border,
        },
      ]}
    >
      <Pressable
        onPress={openDrawer}
        style={styles.iconButton}
        hitSlop={8}
        accessibilityLabel="Open navigation menu"
        accessibilityRole="button"
      >
        <Ionicons name="menu" size={26} color={colors.text} />
      </Pressable>

      <Text style={[styles.wordmark, { color: colors.primary }]}>Zobia</Text>

      <Pressable
        onPress={() => router.push('/notifications' as never)}
        style={styles.iconButton}
        hitSlop={8}
        accessibilityLabel="Notifications"
        accessibilityRole="button"
      >
        <Ionicons name="notifications-outline" size={24} color={colors.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
});
