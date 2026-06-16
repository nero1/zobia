/**
 * app/merch/store-settings.tsx
 *
 * Creator merch store settings screen.
 * Allows toggling physical goods and selecting default fulfillment method.
 */

import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { translateApiError } from '@/lib/i18n/apiErrors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StoreSettings {
  physical_goods_enabled: boolean;
  default_fulfillment_method: string;
}

interface ManifestFeatures {
  physicalGoodsEnabled: boolean;
  physicalGoodsManualFulfillment: boolean;
  physicalGoodsPartnerFulfillment: boolean;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchStoreSettings(creatorId: string): Promise<StoreSettings> {
  const { data } = await apiClient.get<{ data: { store: StoreSettings } }>(`/merch/${creatorId}`);
  return {
    physical_goods_enabled: data?.data?.store?.physical_goods_enabled ?? false,
    default_fulfillment_method: data?.data?.store?.default_fulfillment_method ?? 'manual',
  };
}

async function fetchManifestFeatures(): Promise<ManifestFeatures> {
  const { data } = await apiClient.get<{ features: ManifestFeatures }>('/manifest');
  return data?.features ?? {
    physicalGoodsEnabled: false,
    physicalGoodsManualFulfillment: true,
    physicalGoodsPartnerFulfillment: false,
  };
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function StoreSettingsScreen() {
  const { creatorId } = useLocalSearchParams<{ creatorId: string }>();
  const { isDark, colors: themeColors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { data: store } = useQuery({
    queryKey: ['store-settings', creatorId],
    queryFn: () => fetchStoreSettings(creatorId!),
    enabled: !!creatorId,
  });

  const { data: manifest } = useQuery({
    queryKey: ['manifest-features'],
    queryFn: fetchManifestFeatures,
    staleTime: 5 * 60_000,
  });

  const [physicalGoodsEnabled, setPhysicalGoodsEnabled] = useState<boolean | null>(null);
  const [defaultFulfillment, setDefaultFulfillment] = useState<string | null>(null);

  const effectivePhysical = physicalGoodsEnabled ?? store?.physical_goods_enabled ?? false;
  const effectiveFulfillment = defaultFulfillment ?? store?.default_fulfillment_method ?? 'manual';

  const saveMutation = useMutation({
    mutationFn: (patch: { physicalGoodsEnabled?: boolean; defaultFulfillmentMethod?: string }) =>
      apiClient.patch(`/merch/${creatorId}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['store-settings', creatorId] });
      Alert.alert('Saved', 'Store settings updated.');
    },
    onError: (err: Error & { response?: { data?: { error?: { code?: string; message?: string } } } }) => {
      const code = err?.response?.data?.error?.code ?? null;
      const msg = err?.response?.data?.error?.message ?? err?.message ?? 'Failed to save settings.';
      Alert.alert('Error', translateApiError(t, code, msg));
    },
  });

  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const mutedColor = isDark ? colors.neutral[400] : colors.neutral[500];
  const surfaceColor = isDark ? colors.neutral[800] : colors.neutral[0];
  const borderColor = isDark ? colors.neutral[700] : colors.neutral[200];

  if (!manifest?.physicalGoodsEnabled) {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={[styles.disabledText, { color: mutedColor }]}>
            Physical goods sales are not currently available on this platform.
          </Text>
          <Button label="Go back" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.title, { color: textColor }]}>Store Settings</Text>

        {/* Physical goods toggle */}
        <View style={[styles.card, { backgroundColor: surfaceColor, borderColor }]}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.toggleLabel, { color: textColor }]}>Sell Physical Products</Text>
              <Text style={[styles.toggleDesc, { color: mutedColor }]}>
                Allow buyers to purchase physical items from your store.
              </Text>
            </View>
            <Switch
              value={effectivePhysical}
              onValueChange={(v) => setPhysicalGoodsEnabled(v)}
              trackColor={{ false: colors.neutral[300], true: colors.brand.blue }}
            />
          </View>
        </View>

        {/* Fulfillment method (only when physical goods enabled) */}
        {effectivePhysical && (
          <View style={[styles.card, { backgroundColor: surfaceColor, borderColor }]}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>Default Fulfillment</Text>

            {manifest.physicalGoodsManualFulfillment && (
              <Pressable
                style={[styles.fulfillmentOption, { borderColor: effectiveFulfillment === 'manual' ? colors.brand.blue : borderColor }]}
                onPress={() => setDefaultFulfillment('manual')}
                accessibilityRole="radio"
              >
                <View style={[styles.radioCircle, { borderColor: effectiveFulfillment === 'manual' ? colors.brand.blue : mutedColor }]}>
                  {effectiveFulfillment === 'manual' && <View style={[styles.radioFill, { backgroundColor: colors.brand.blue }]} />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fulfillmentLabel, { color: textColor }]}>Manual Fulfillment</Text>
                  <Text style={[styles.fulfillmentDesc, { color: mutedColor }]}>
                    Ship orders yourself and update tracking manually.
                  </Text>
                </View>
              </Pressable>
            )}

            {manifest.physicalGoodsPartnerFulfillment && (
              <Pressable
                style={[styles.fulfillmentOption, { borderColor: borderColor, opacity: 0.6 }]}
                onPress={() => Alert.alert('Coming Soon', 'Partner Integration is coming soon. Use Manual Fulfillment for now.')}
                accessibilityRole="radio"
              >
                <View style={[styles.radioCircle, { borderColor: mutedColor }]} />
                <View style={{ flex: 1 }}>
                  <View style={styles.fulfillmentLabelRow}>
                    <Text style={[styles.fulfillmentLabel, { color: textColor }]}>Partner Integration</Text>
                    <View style={styles.comingSoonBadge}>
                      <Text style={styles.comingSoonText}>Coming Soon</Text>
                    </View>
                  </View>
                  <Text style={[styles.fulfillmentDesc, { color: mutedColor }]}>
                    Connect with a fulfillment partner for automated shipping.
                  </Text>
                </View>
              </Pressable>
            )}
          </View>
        )}

        <Button
          label={saveMutation.isPending ? 'Saving...' : 'Save Settings'}
          variant="primary"
          onPress={() => saveMutation.mutate({
            physicalGoodsEnabled: effectivePhysical,
            defaultFulfillmentMethod: effectiveFulfillment,
          })}
          disabled={saveMutation.isPending}
          style={styles.saveBtn}
        />
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  disabledText: { fontSize: 15, textAlign: 'center' },

  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700' },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleLabel: { fontSize: 15, fontWeight: '600' },
  toggleDesc: { fontSize: 12, marginTop: 2 },

  fulfillmentOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    padding: 12,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  radioFill: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  fulfillmentLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fulfillmentLabel: { fontSize: 15, fontWeight: '600' },
  fulfillmentDesc: { fontSize: 12, marginTop: 2 },
  comingSoonBadge: {
    backgroundColor: '#f3f4f6',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  comingSoonText: { fontSize: 10, fontWeight: '700', color: '#6b7280' },

  saveBtn: { marginTop: 4 },
});
