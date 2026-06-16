/**
 * app/admin/feature-flags.tsx
 *
 * Admin feature flags screen (mobile).
 * Toggle feature flags on/off with live preview.
 * Admin-only screen.
 */

import React from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  audience: 'all' | 'beta' | 'admin' | string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchFlags(): Promise<FeatureFlag[]> {
  const { data } = await apiClient.get('/admin/feature-flags');
  return data.items ?? data;
}

async function toggleFlag(key: string, enabled: boolean): Promise<void> {
  await apiClient.put('/admin/feature-flags', { key, enabled });
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface FlagRowProps {
  flag: FeatureFlag;
  onToggle: (key: string, enabled: boolean) => void;
  isLoading: boolean;
}

function FlagRow({ flag, onToggle, isLoading }: FlagRowProps) {
  const { colors: themeColors } = useTheme();

  const audienceColor =
    flag.audience === 'admin'
      ? colors.semantic.error
      : flag.audience === 'beta'
      ? colors.semantic.warning
      : colors.brand.green;

  return (
    <View style={[styles.row, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
      <View style={styles.rowLeft}>
        <View style={styles.rowHeader}>
          <Text style={[styles.rowKey, { color: themeColors.text }]} numberOfLines={1}>{flag.key}</Text>
          <View style={[styles.audienceBadge, { backgroundColor: `${audienceColor}22` }]}>
            <Text style={[styles.audienceBadgeText, { color: audienceColor }]}>{flag.audience}</Text>
          </View>
        </View>
        {flag.description && (
          <Text style={[styles.rowDesc, { color: themeColors.textMuted }]} numberOfLines={2}>{flag.description}</Text>
        )}
      </View>
      <Switch
        value={flag.enabled}
        onValueChange={(val) => onToggle(flag.key, val)}
        disabled={isLoading}
        trackColor={{ false: colors.neutral[300], true: colors.brand.blue }}
        thumbColor={colors.neutral[0]}
        accessibilityLabel={`Toggle ${flag.key}`}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function AdminFeatureFlagsScreen() {
  const queryClient = useQueryClient();
  const { colors: themeColors } = useTheme();

  const { data: flags = [], isLoading, refetch } = useQuery({
    queryKey: ['admin', 'feature-flags'],
    queryFn: fetchFlags,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      toggleFlag(key, enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'feature-flags'] });
    },
    onMutate: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      await queryClient.cancelQueries({ queryKey: ['admin', 'feature-flags'] });
      const prev = queryClient.getQueryData<FeatureFlag[]>(['admin', 'feature-flags']);
      queryClient.setQueryData<FeatureFlag[]>(['admin', 'feature-flags'], (old: FeatureFlag[] | undefined) =>
        old?.map((f: FeatureFlag) => (f.key === key ? { ...f, enabled } : f)) ?? []
      );
      return { prev };
    },
    onError: (_err, { key }, ctx) => {
      Alert.alert('Error', `Failed to toggle ${key}. Please try again.`);
      if (ctx?.prev) {
        queryClient.setQueryData(['admin', 'feature-flags'], ctx.prev);
      }
    },
  });

  const handleToggle = (key: string, enabled: boolean) => {
    toggleMutation.mutate({ key, enabled });
  };

  const enabledCount = flags.filter((f: FeatureFlag) => f.enabled).length;

  return (
    <Screen scrollable={false} contentStyle={styles.container}>
      <Text style={[styles.heading, { color: themeColors.text }]}>Feature Flags</Text>
      <Text style={[styles.subheading, { color: themeColors.textMuted }]}>
        {enabledCount} of {flags.length} flags enabled
      </Text>

      <FlatList
        data={flags}
        keyExtractor={(f) => f.key}
        renderItem={({ item }) => (
          <FlagRow
            flag={item}
            onToggle={handleToggle}
            isLoading={toggleMutation.isPending}
          />
        )}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
              {isLoading ? 'Loading...' : 'No feature flags found.'}
            </Text>
          </View>
        }
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { padding: 16 },
  heading: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  subheading: { fontSize: 13, marginBottom: 16 },
  list: { paddingBottom: 32 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  rowLeft: { flex: 1, gap: 4 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowKey: { fontSize: 14, fontWeight: '700', flex: 1 },
  rowDesc: { fontSize: 12 },

  audienceBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  audienceBadgeText: { fontSize: 10, fontWeight: '700' },

  empty: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center' },
});
