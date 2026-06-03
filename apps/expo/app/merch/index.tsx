/**
 * app/merch/index.tsx
 *
 * Creator Merch screen.
 *
 * Features:
 *  - List of creator merch stores (fetch from /api/merch)
 *  - Tap store to view products
 *  - "Buy" button → POST purchase
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
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

interface MerchProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  available: boolean;
}

interface MerchStore {
  creatorId: string;
  creatorName: string;
  storeName: string;
  avatarEmoji: string;
  productCount: number;
  products?: MerchProduct[];
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchStores(): Promise<MerchStore[]> {
  const { data } = await apiClient.get('/api/merch');
  return data.stores ?? [];
}

async function fetchStoreProducts(creatorId: string): Promise<MerchProduct[]> {
  const { data } = await apiClient.get(`/api/merch/${creatorId}/products`);
  return data.products ?? [];
}

async function purchaseProduct(creatorId: string, productId: string): Promise<void> {
  await apiClient.post(`/api/merch/${creatorId}/products/${productId}/purchase`);
}

// ---------------------------------------------------------------------------
// Product card
// ---------------------------------------------------------------------------

function ProductCard({ product, creatorId }: { product: MerchProduct; creatorId: string }) {
  const { colors: themeColors } = useTheme();
  const queryClient = useQueryClient();

  const purchaseMutation = useMutation({
    mutationFn: () => purchaseProduct(creatorId, product.id),
    onSuccess: () => {
      Alert.alert('Purchased!', `You purchased ${product.name}.`);
      queryClient.invalidateQueries({ queryKey: ['merch-products', creatorId] });
    },
    onError: () => Alert.alert('Error', 'Purchase failed. Please try again.'),
  });

  return (
    <View style={[styles.productCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}>
      <View style={styles.productInfo}>
        <Text style={[styles.productName, { color: themeColors.text }]}>{product.name}</Text>
        {product.description ? (
          <Text style={[styles.productDescription, { color: themeColors.textMuted }]} numberOfLines={2}>
            {product.description}
          </Text>
        ) : null}
        <Text style={styles.productPrice}>
          {product.currency} {product.price.toFixed(2)}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.buyBtn, !product.available && styles.buyBtnDisabled]}
        onPress={() => {
          if (!product.available) return;
          Alert.alert(
            'Confirm Purchase',
            `Buy "${product.name}" for ${product.currency} ${product.price.toFixed(2)}?`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Buy', onPress: () => purchaseMutation.mutate() },
            ],
          );
        }}
        disabled={!product.available || purchaseMutation.isPending}
        accessibilityRole="button"
        accessibilityLabel={`Buy ${product.name}`}
      >
        {purchaseMutation.isPending ? (
          <ActivityIndicator size="small" color={colors.neutral[0]} />
        ) : (
          <Text style={styles.buyBtnText}>
            {product.available ? 'Buy' : 'Sold Out'}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Store detail view
// ---------------------------------------------------------------------------

function StoreDetail({ store, onBack }: { store: MerchStore; onBack: () => void }) {
  const { colors: themeColors } = useTheme();

  const { data: products = [], isLoading, isError } = useQuery({
    queryKey: ['merch-products', store.creatorId],
    queryFn: () => fetchStoreProducts(store.creatorId),
  });

  return (
    <FlatList
      data={products}
      keyExtractor={(p) => p.id}
      contentContainerStyle={styles.productList}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={() => (
        <View>
          <Pressable style={styles.backBtn} onPress={onBack} accessibilityRole="button">
            <Text style={styles.backBtnText}>← Back</Text>
          </Pressable>
          <View style={[styles.storeHeader, { backgroundColor: themeColors.surface }]}>
            <Text style={styles.storeHeaderEmoji}>{store.avatarEmoji}</Text>
            <Text style={[styles.storeHeaderName, { color: themeColors.text }]}>{store.storeName}</Text>
            <Text style={[styles.storeHeaderCreator, { color: themeColors.textMuted }]}>
              by {store.creatorName}
            </Text>
          </View>
          {isLoading && <ActivityIndicator style={{ marginTop: 20 }} color={colors.brand.blue} />}
          {isError && (
            <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
              Could not load products.
            </Text>
          )}
        </View>
      )}
      renderItem={({ item }) => <ProductCard product={item} creatorId={store.creatorId} />}
      ListEmptyComponent={() =>
        !isLoading ? (
          <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
            No products in this store yet.
          </Text>
        ) : null
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Store card (list view)
// ---------------------------------------------------------------------------

function StoreCard({ store, onPress }: { store: MerchStore; onPress: () => void }) {
  const { colors: themeColors } = useTheme();
  return (
    <Pressable
      style={[styles.storeCard, { backgroundColor: themeColors.surface, borderColor: themeColors.border }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${store.storeName}`}
    >
      <View style={styles.storeAvatar}>
        <Text style={styles.storeAvatarEmoji}>{store.avatarEmoji}</Text>
      </View>
      <View style={styles.storeInfo}>
        <Text style={[styles.storeName, { color: themeColors.text }]} numberOfLines={1}>
          {store.storeName}
        </Text>
        <Text style={[styles.storeCreatorName, { color: themeColors.textMuted }]} numberOfLines={1}>
          by {store.creatorName}
        </Text>
        <Text style={[styles.storeProductCount, { color: colors.brand.blue }]}>
          {store.productCount} product{store.productCount !== 1 ? 's' : ''}
        </Text>
      </View>
      <Text style={[styles.chevron, { color: themeColors.textMuted }]}>›</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function Skeleton() {
  return (
    <View style={styles.skeletonContainer}>
      {[1, 2, 3].map((i) => <View key={i} style={styles.skeletonRow} />)}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function MerchScreen() {
  const { colors: themeColors } = useTheme();
  const [selectedStore, setSelectedStore] = useState<MerchStore | null>(null);

  const { data: stores = [], isLoading, isError } = useQuery({
    queryKey: ['merch-stores'],
    queryFn: fetchStores,
  });

  if (selectedStore) {
    return (
      <Screen disableBottomInset>
        <StoreDetail store={selectedStore} onBack={() => setSelectedStore(null)} />
      </Screen>
    );
  }

  if (isLoading) return <Screen><Skeleton /></Screen>;

  if (isError) {
    return (
      <Screen>
        <View style={styles.errorState}>
          <Text style={[styles.errorText, { color: themeColors.textMuted }]}>
            Could not load stores.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={stores}
        keyExtractor={(s) => s.creatorId}
        contentContainerStyle={styles.storeList}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          <View style={styles.listHeader}>
            <Text style={[styles.screenTitle, { color: themeColors.text }]}>Creator Merch</Text>
            <Text style={[styles.screenSubtitle, { color: themeColors.textMuted }]}>
              Digital products from your favourite creators
            </Text>
          </View>
        )}
        renderItem={({ item }) => (
          <StoreCard store={item} onPress={() => setSelectedStore(item)} />
        )}
        ListEmptyComponent={() => (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: themeColors.textMuted }]}>
              No merch stores yet. Check back soon!
            </Text>
          </View>
        )}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  listHeader: { paddingHorizontal: 16, paddingTop: 16, marginBottom: 8, gap: 4 },
  screenTitle: { fontSize: 22, fontWeight: '800' },
  screenSubtitle: { fontSize: 14 },

  storeList: { padding: 16, gap: 10 },
  storeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 12,
    minHeight: 70,
  },
  storeAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeAvatarEmoji: { fontSize: 26 },
  storeInfo: { flex: 1 },
  storeName: { fontSize: 15, fontWeight: '700' },
  storeCreatorName: { fontSize: 12, marginTop: 1 },
  storeProductCount: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  chevron: { fontSize: 22, fontWeight: '300' },

  // Store detail
  backBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: 'center',
  },
  backBtnText: { fontSize: 15, color: colors.brand.blue, fontWeight: '600' },
  storeHeader: {
    alignItems: 'center',
    padding: 20,
    gap: 6,
    marginBottom: 12,
  },
  storeHeaderEmoji: { fontSize: 48 },
  storeHeaderName: { fontSize: 20, fontWeight: '800' },
  storeHeaderCreator: { fontSize: 14 },

  productList: { padding: 16, gap: 10 },
  productCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  productInfo: { flex: 1, gap: 3 },
  productName: { fontSize: 15, fontWeight: '700' },
  productDescription: { fontSize: 12, lineHeight: 18 },
  productPrice: { fontSize: 14, fontWeight: '800', color: colors.brand.blue, marginTop: 2 },
  buyBtn: {
    backgroundColor: colors.brand.blue,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buyBtnDisabled: { backgroundColor: colors.neutral[300] },
  buyBtnText: { color: colors.neutral[0], fontSize: 14, fontWeight: '700' },

  emptyState: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 14, textAlign: 'center' },

  errorState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { fontSize: 15, textAlign: 'center' },

  skeletonContainer: { padding: 16, gap: 12 },
  skeletonRow: { height: 80, borderRadius: 14, backgroundColor: colors.neutral[200] },
});
