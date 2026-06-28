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

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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

  // Bug 23 fix: capture toInternalPath in a ref so it doesn't cause the effect
  // to re-run on every render (which would create an infinite re-resolve loop).
  const toInternalPathRef = useRef(toInternalPath);
  useEffect(() => { toInternalPathRef.current = toInternalPath; });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);

    async function resolve() {
      try {
        const { data } = await apiClient.get<{ found: boolean; id?: string }>(
          '/public/resolve',
          { params: { type, id: identifier }, signal: controller.signal },
        );
        if (cancelled) return;
        if (data?.found && data.id) {
          router.replace(toInternalPathRef.current(data.id) as never);
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
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [type, identifier]); // toInternalPath excluded: toInternalPathRef.current always holds latest

  return (
    <View style={[styles.container, { backgroundColor: themeColors.background }]}>
      {notFound ? (
        <>
          <Text style={[styles.text, { color: themeColors.textMuted }]}>
            {notFoundLabel}
          </Text>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>Go Back</Text>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator color={themeColors.primary} size="large" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  text: { fontSize: 16, textAlign: 'center' },
  backBtn: { marginTop: 8, paddingVertical: 10, paddingHorizontal: 20 },
  backBtnText: { fontSize: 15, fontWeight: '600', color: '#1A73E8' },
});
