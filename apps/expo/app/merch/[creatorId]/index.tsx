/**
 * app/merch/[creatorId]/index.tsx
 *
 * Individual creator merch store screen (PRD §14 — Elite tier+ Creator Merch Store).
 *
 * Shows creator's store details and product list.
 * Users can purchase products with coins or real money.
 */

import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';
import { useCurrency } from '@/lib/hooks/useCurrency';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MerchProduct {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  coinPrice: number | null;
  stock: number | null;
  isDigital: boolean;
  available: boolean;
  imageUrl: string | null;
}

interface MerchStore {
  creatorId: string;
  creatorName: string;
  storeName: string;
  storeDescription: string | null;
  avatarEmoji: string;
  products: MerchProduct[];
}

interface PurchaseResponse {
  success: boolean;
  orderId: string;
  paymentUrl?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CreatorMerchStoreScreen() {
  const { creatorId } = useLocalSearchParams<{ creatorId: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isDark } = useTheme();
  const currency = useCurrency();

  const themedStyles = {
    bg: isDark ? colors.neutral[900] : colors.neutral[50],
    card: isDark ? colors.neutral[800] : colors.neutral[0],
    border: isDark ? colors.neutral[700] : colors.neutral[200],
    text: isDark ? colors.neutral[50] : colors.neutral[900],
    sub: isDark ? colors.neutral[400] : colors.neutral[500],
  };

  // Load store data
  const { data: store, isLoading, error } = useQuery<MerchStore>({
    queryKey: ['merch-store', creatorId],
    queryFn: async () => {
      const res = await apiClient.get<{ store: MerchStore }>(`/merch/${creatorId}`);
      return res.store;
    },
    enabled: !!creatorId,
    staleTime: 30_000,
  });

  // Purchase mutation
  const purchaseMutation = useMutation({
    mutationFn: async (productId: string) => {
      return apiClient.post<PurchaseResponse>(
        `/merch/${creatorId}/products/${productId}/purchase`,
        { paymentMethod: 'coins' }
      );
    },
    onSuccess: (data, productId) => {
      void queryClient.invalidateQueries({ queryKey: ['merch-store', creatorId] });
      void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      if (data.paymentUrl) {
        Alert.alert('Purchase', 'Redirecting to payment…');
      } else {
        Alert.alert('Success! 🎉', 'Your purchase was successful.');
      }
    },
    onError: (err: Error) => {
      Alert.alert('Purchase Failed', err.message ?? 'Please try again.');
    },
  });

  const handlePurchase = useCallback(
    (product: MerchProduct) => {
      if (!product.available) {
        Alert.alert('Out of Stock', 'This product is currently unavailable.');
        return;
      }

      const priceLabel = product.coinPrice != null
        ? `${product.coinPrice.toLocaleString()} ${currency.softPlural.toLowerCase()}`
        : `₦${product.price.toLocaleString()}`;

      Alert.alert(
        `Buy "${product.name}"`,
        `This costs ${priceLabel}. Continue?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Buy',
            onPress: () => purchaseMutation.mutate(product.id),
          },
        ]
      );
    },
    [purchaseMutation]
  );

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderProduct = useCallback(
    ({ item }: { item: MerchProduct }) => {
      const priceLabel = item.coinPrice != null
        ? `🪙 ${item.coinPrice.toLocaleString()} ${currency.softPlural.toLowerCase()}`
        : `₦${item.price.toLocaleString()}`;
      const stockLabel = item.stock != null ? `${item.stock} left` : null;

      return (
        <View style={[styles.productCard, { backgroundColor: themedStyles.card, borderColor: themedStyles.border }]}>
          {/* Product image placeholder */}
          <View style={[styles.productImageBox, { backgroundColor: themedStyles.bg }]}>
            <Text style={styles.productImageEmoji}>{item.isDigital ? '💾' : '📦'}</Text>
          </View>

          <View style={styles.productBody}>
            <Text style={[styles.productName, { color: themedStyles.text }]} numberOfLines={2}>
              {item.name}
            </Text>
            {item.description && (
              <Text style={[styles.productDesc, { color: themedStyles.sub }]} numberOfLines={2}>
                {item.description}
              </Text>
            )}
            <View style={styles.productFooter}>
              <View>
                <Text style={styles.productPrice}>{priceLabel}</Text>
                {stockLabel && (
                  <Text style={[styles.stockLabel, { color: themedStyles.sub }]}>{stockLabel}</Text>
                )}
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.buyButton,
                  !item.available && styles.buyButtonDisabled,
                  pressed && styles.buyButtonPressed,
                ]}
                onPress={() => handlePurchase(item)}
                disabled={!item.available || purchaseMutation.isPending}
                accessibilityLabel={`Buy ${item.name} for ${priceLabel}`}
              >
                <Text style={styles.buyButtonText}>
                  {item.available ? 'Buy' : 'Sold Out'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      );
    },
    [handlePurchase, purchaseMutation.isPending, themedStyles]
  );

  // ---------------------------------------------------------------------------
  // Loading / error states
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.brand.gold} />
        </View>
      </Screen>
    );
  }

  if (error || !store) {
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: themedStyles.sub }]}>
            Could not load this store.
          </Text>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Go Back</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <Screen>
      <FlatList
        data={store.products}
        keyExtractor={(item) => item.id}
        renderItem={renderProduct}
        contentContainerStyle={[styles.list, { backgroundColor: themedStyles.bg }]}
        ListHeaderComponent={
          <View style={[styles.header, { borderBottomColor: themedStyles.border }]}>
            {/* Back button */}
            <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Go back">
              <Text style={[styles.backBtnText, { color: themedStyles.sub }]}>← Back</Text>
            </Pressable>

            {/* Store hero */}
            <View style={styles.storeHero}>
              <Text style={styles.storeAvatar}>{store.avatarEmoji}</Text>
              <Text style={[styles.storeName, { color: themedStyles.text }]}>{store.storeName}</Text>
              <Text style={[styles.creatorName, { color: themedStyles.sub }]}>
                by {store.creatorName}
              </Text>
              {store.storeDescription && (
                <Text style={[styles.storeDesc, { color: themedStyles.sub }]}>
                  {store.storeDescription}
                </Text>
              )}
            </View>

            <Text style={[styles.sectionLabel, { color: themedStyles.sub }]}>
              {store.products.length} product{store.products.length !== 1 ? 's' : ''}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={[styles.emptyText, { color: themedStyles.sub }]}>
              This store has no products yet.
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
  list: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    marginTop: 48,
  },

  // Header
  header: {
    padding: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    marginBottom: 8,
  },
  backBtn: {
    paddingVertical: 8,
    marginBottom: 8,
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
  storeHero: {
    alignItems: 'center',
    paddingVertical: 12,
    gap: 4,
  },
  storeAvatar: {
    fontSize: 48,
    marginBottom: 8,
  },
  storeName: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  creatorName: {
    fontSize: 13,
    textAlign: 'center',
  },
  storeDesc: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 280,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
  },

  // Product card
  productCard: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
  },
  productImageBox: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  productImageEmoji: {
    fontSize: 32,
  },
  productBody: {
    flex: 1,
    padding: 10,
    gap: 4,
  },
  productName: {
    fontSize: 14,
    fontWeight: '700',
  },
  productDesc: {
    fontSize: 12,
  },
  productFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  productPrice: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.brand.gold,
  },
  stockLabel: {
    fontSize: 11,
    marginTop: 1,
  },
  buyButton: {
    backgroundColor: colors.brand.gold,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  buyButtonDisabled: {
    backgroundColor: colors.neutral[300],
  },
  buyButtonPressed: {
    opacity: 0.8,
  },
  buyButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.neutral[0],
  },
});
