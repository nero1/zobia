/**
 * Zobia Social — Screen wrapper component.
 *
 * Every screen in the app should use `<Screen>` as its outermost element.
 * It provides:
 *  - Safe area insets via `react-native-safe-area-context`
 *  - Theme-aware background colour
 *  - The global `<OfflineBanner>` at the top
 *  - Optional scroll behaviour
 */

import React, { type ReactNode } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { OfflineBanner } from '@/components/offline/OfflineBanner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Edge = 'top' | 'bottom' | 'left' | 'right';

interface ScreenProps {
  children: ReactNode;
  /** When true the content area is scrollable. Default: false. */
  scrollable?: boolean;
  /** Additional styles applied to the inner content container. */
  contentStyle?: StyleProp<ViewStyle>;
  /** When true, the offline banner is hidden (e.g. chat screens). */
  hideOfflineBanner?: boolean;
  /** Opt-out of bottom safe-area padding (e.g. screens with a sticky footer). */
  disableBottomInset?: boolean;
  /**
   * Explicit list of safe-area edges to pad. When provided it fully controls
   * which insets are applied (and `disableBottomInset` is ignored). When
   * omitted, the default is top/left/right plus bottom (unless
   * `disableBottomInset` is set).
   */
  edges?: Edge[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Screen — base wrapper for all app screens.
 *
 * @example
 * export default function MyScreen() {
 *   return (
 *     <Screen scrollable>
 *       <Text>Hello</Text>
 *     </Screen>
 *   );
 * }
 */
export function Screen({
  children,
  scrollable = false,
  contentStyle,
  hideOfflineBanner = false,
  disableBottomInset = false,
  edges,
}: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const appliedEdges: Edge[] =
    edges ?? (['top', 'left', 'right', ...(disableBottomInset ? [] : ['bottom'])] as Edge[]);

  const containerStyle: ViewStyle = {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: appliedEdges.includes('top') ? insets.top : 0,
    paddingLeft: appliedEdges.includes('left') ? insets.left : 0,
    paddingRight: appliedEdges.includes('right') ? insets.right : 0,
    paddingBottom: appliedEdges.includes('bottom') ? insets.bottom : 0,
  };

  const content = scrollable ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.scrollContent, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, contentStyle]}>{children}</View>
  );

  return (
    <View style={containerStyle}>
      {!hideOfflineBanner && <OfflineBanner />}
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
});
