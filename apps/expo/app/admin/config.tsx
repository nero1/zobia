/**
 * app/admin/config.tsx
 *
 * Admin config panel (mobile).
 * Displays and edits x_manifest key-value pairs (platform configuration).
 * Admin-only screen.
 */

import React, { useState, useCallback } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConfigEntry {
  key: string;
  value: string;
  description: string | null;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchConfig(): Promise<ConfigEntry[]> {
  const { data } = await apiClient.get('/admin/config');
  return data.items ?? data;
}

async function updateConfig(key: string, value: string): Promise<void> {
  await apiClient.put('/admin/config', { key, value });
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface ConfigRowProps {
  item: ConfigEntry;
  onEdit: (item: ConfigEntry) => void;
}

function ConfigRow({ item, onEdit }: ConfigRowProps) {
  const { colors: themeColors } = useTheme();
  return (
    <Pressable
      style={[styles.row, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}
      onPress={() => onEdit(item)}
      accessibilityRole="button"
    >
      <View style={styles.rowContent}>
        <Text style={[styles.rowKey, { color: themeColors.text }]} numberOfLines={1}>{item.key}</Text>
        <Text style={[styles.rowValue, { color: themeColors.textMuted }]} numberOfLines={1}>{item.value}</Text>
        {item.description && (
          <Text style={[styles.rowDesc, { color: themeColors.textMuted }]} numberOfLines={1}>{item.description}</Text>
        )}
      </View>
      <Text style={[styles.rowEdit, { color: colors.brand.blue }]}>Edit</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Edit modal (inline)
// ---------------------------------------------------------------------------

interface EditPanelProps {
  item: ConfigEntry;
  onSave: (key: string, value: string) => void;
  onCancel: () => void;
  loading: boolean;
}

function EditPanel({ item, onSave, onCancel, loading }: EditPanelProps) {
  const { colors: themeColors, isDark } = useTheme();
  const [draft, setDraft] = useState(item.value);

  return (
    <View style={[styles.editPanel, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
      <Text style={[styles.editKey, { color: themeColors.text }]}>{item.key}</Text>
      {item.description && (
        <Text style={[styles.editDesc, { color: themeColors.textMuted }]}>{item.description}</Text>
      )}
      <TextInput
        style={[
          styles.editInput,
          {
            backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100],
            color: themeColors.text,
          },
        ]}
        value={draft}
        onChangeText={setDraft}
        multiline
        autoFocus
        accessibilityLabel={`Edit value for ${item.key}`}
      />
      <View style={styles.editActions}>
        <Button label="Cancel" variant="ghost" onPress={onCancel} style={styles.editBtn} />
        <Button
          label="Save"
          variant="primary"
          onPress={() => onSave(item.key, draft.trim())}
          loading={loading}
          style={styles.editBtn}
        />
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function AdminConfigScreen() {
  const queryClient = useQueryClient();
  const { colors: themeColors } = useTheme();
  const [editingItem, setEditingItem] = useState<ConfigEntry | null>(null);

  const { data: items = [], isLoading, refetch } = useQuery({
    queryKey: ['admin', 'config'],
    queryFn: fetchConfig,
  });

  const saveMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => updateConfig(key, value),
    onSuccess: () => {
      setEditingItem(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'config'] });
    },
    onError: () => {
      Alert.alert('Error', 'Failed to update config. Please try again.');
    },
  });

  const handleSave = useCallback((key: string, value: string) => {
    saveMutation.mutate({ key, value });
  }, [saveMutation]);

  return (
    <Screen scrollable={false} contentStyle={styles.container}>
      <Text style={[styles.heading, { color: themeColors.text }]}>Platform Config</Text>
      <Text style={[styles.subheading, { color: themeColors.textMuted }]}>
        Edit x_manifest key-value pairs. Changes take effect immediately.
      </Text>

      {editingItem && (
        <EditPanel
          item={editingItem}
          onSave={handleSave}
          onCancel={() => setEditingItem(null)}
          loading={saveMutation.isPending}
        />
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <ConfigRow item={item} onEdit={setEditingItem} />
        )}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
              {isLoading ? 'Loading...' : 'No config entries found.'}
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
    gap: 8,
  },
  rowContent: { flex: 1, gap: 2 },
  rowKey: { fontSize: 14, fontWeight: '700' },
  rowValue: { fontSize: 13 },
  rowDesc: { fontSize: 11, fontStyle: 'italic' },
  rowEdit: { fontSize: 13, fontWeight: '600' },

  editPanel: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 16,
    gap: 8,
  },
  editKey: { fontSize: 15, fontWeight: '700' },
  editDesc: { fontSize: 12 },
  editInput: {
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  editActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  editBtn: { minWidth: 80 },

  empty: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center' },
});
