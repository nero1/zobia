/**
 * RootErrorBoundary
 *
 * A last-resort error boundary placed ABOVE every app provider (theme, auth,
 * react-query, etc.) in `app/_layout.tsx`.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * expo-router's exported `ErrorBoundary` only wraps the *routes* rendered
 * inside the navigator. If one of the root providers — or the root layout's own
 * JSX (status bar, global modals) — throws while rendering, that error escapes
 * the router boundary entirely and React unmounts the whole tree, leaving the
 * app stuck on a blank white screen after the splash with no way to recover.
 *
 * This boundary converts that failure mode into a visible, self-describing
 * screen with a "Try again" action, so a render-time crash in a provider can
 * never again present as a silent white screen. It cannot catch errors thrown
 * during *module evaluation* (those happen before React runs) — for that we
 * guard the eager native-store constructions at their source.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { env } from '@/lib/env';

/**
 * Show full error detail on every non-production build (development / preview /
 * staging) so an installed test APK — which has no Metro/CLI logs and, in
 * release mode, no red box — still surfaces the real cause instead of a generic
 * message. Production keeps the friendly, detail-free screen.
 */
const DEBUG_FLAG = process.env.EXPO_PUBLIC_DEBUG_OVERLAY;
const SHOW_ERROR_DETAIL =
  DEBUG_FLAG === '1' || DEBUG_FLAG === 'true'
    ? true
    : DEBUG_FLAG === '0' || DEBUG_FLAG === 'false'
      ? false
      : __DEV__ || env.APP_ENV !== 'production';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    // Surface the real error to the console/EAS logs so the underlying cause is
    // diagnosable instead of being swallowed by a blank screen. (console.error
    // is also captured by lib/debug/logStore for the on-screen overlay.)
    console.error('[RootErrorBoundary] Uncaught error in root tree:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack });
  }

  handleReset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  render(): React.ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          The app hit an unexpected error while starting up. You can try again —
          if it keeps happening, please reinstall or contact support.
        </Text>
        {SHOW_ERROR_DETAIL && (
          <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailContent}>
            <Text style={styles.detailMessage} selectable>
              {error.name}: {error.message}
            </Text>
            {error.stack ? (
              <Text style={styles.detail} selectable>
                {error.stack}
              </Text>
            ) : null}
            {componentStack ? (
              <Text style={styles.detail} selectable>
                {componentStack}
              </Text>
            ) : null}
          </ScrollView>
        )}
        <Pressable
          style={styles.button}
          onPress={this.handleReset}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: '#4B5563',
    textAlign: 'center',
  },
  detailScroll: {
    alignSelf: 'stretch',
    maxHeight: 260,
    marginTop: 4,
  },
  detailContent: {
    paddingVertical: 4,
  },
  detailMessage: {
    fontSize: 13,
    color: '#B91C1C',
    fontWeight: '600',
    marginBottom: 6,
  },
  detail: {
    fontSize: 11,
    color: '#9CA3AF',
    marginTop: 4,
  },
  button: {
    marginTop: 12,
    backgroundColor: '#2563EB',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
