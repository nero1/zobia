/**
 * components/deeplink/SlugRedirect.tsx
 *
 * Shared landing UI for the Expo universal-link screens (app/u|r|c/[..].tsx).
 * When the app is opened via a public, SEO-friendly link such as
 * https://zobia.vercel.app/r/dorcas-cuisine, expo-router lands on the matching
 * file route. That route renders this component, which resolves the slug (or
 * username) to the internal UUID via /api/public/resolve and replaces the
 * navigation with the real in-app screen (e.g. /rooms/<uuid>).
 *
 * Shows a brief spinner while resolving and a not-found message on failure, so
 * a stale or private link never dead-ends silently.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { apiClient } from '@/lib/api/client';
import { useTheme } from '@/lib/theme';

type ResolveType = 'room' | 'course' | 'profile' | 'game';

interface SlugRedirectProps {
  type: ResolveType;
  /** The slug or username taken from the universal-link path. */
  identifier: string;
  /** Builds the internal app path from the resolved record id. */
  toInternalPath: (id: string) => string;
  notFoundLabel: string;
}

export function SlugRedirect({
  type,
  identifier,
  toInternalPath,
  notFoundLabel,
}: SlugRedirectProps) {
  const { colors: themeColors } = useTheme();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      try {
        const { data } = await apiClient.get<{ found: boolean; id?: string }>(
          '/public/resolve',
          { params: { type, id: identifier } },
        );
        if (cancelled) return;
        if (data?.found && data.id) {
          router.replace(toInternalPath(data.id) as never);
        } else {
          setNotFound(true);
        }
      } catch {
        if (!cancelled) setNotFound(true);
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
  }, [type, identifier, toInternalPath]);

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      {notFound ? (
        <Text style={[styles.text, { color: themeColors.textMuted }]}>
          {notFoundLabel}
        </Text>
      ) : (
        <ActivityIndicator color={themeColors.primary} size="large" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  text: { fontSize: 16, textAlign: 'center' },
});
