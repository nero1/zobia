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
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    // Surface the real error to the console/EAS logs so the underlying cause is
    // diagnosable instead of being swallowed by a blank screen.
    console.error('[RootErrorBoundary] Uncaught error in root tree:', error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          The app hit an unexpected error while starting up. You can try again —
          if it keeps happening, please reinstall or contact support.
        </Text>
        {__DEV__ && (
          <Text style={styles.detail} selectable>
            {error.message}
          </Text>
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
  detail: {
    fontSize: 12,
    color: '#9CA3AF',
    textAlign: 'center',
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
