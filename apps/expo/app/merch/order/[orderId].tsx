/**
 * app/merch/order/[orderId].tsx
 *
 * Buyer order tracking screen.
 * Shows status stepper, tracking timeline, and Confirm Receipt button.
 */

import React from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Screen } from '@/components/ui/Screen';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';
import { apiClient } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrackingUpdate {
  status: string;
  note: string;
  timestamp: string;
}

interface OrderDetail {
  id: string;
  product_name: string;
  creator_username: string;
  amount_kobo: number;
  status: string;
  fulfillment_method: string | null;
  seller_notes: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  confirmed_at: string | null;
  tracking_updates: TrackingUpdate[];
  shipping_name: string | null;
  shipping_address: string | null;
  shipping_city: string | null;
  shipping_country: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_STEPS = ['pending', 'shipped', 'in_transit', 'delivered', 'completed'];
const STATUS_LABELS: Record<string, string> = {
  pending: 'Order Placed',
  shipped: 'Shipped',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  completed: 'Confirmed',
  refunded: 'Refunded',
};
const STATUS_EMOJIS: Record<string, string> = {
  pending: '📦',
  shipped: '🚚',
  in_transit: '🚚',
  delivered: '🏠',
  completed: '✅',
  refunded: '↩️',
};

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchOrder(orderId: string): Promise<OrderDetail> {
  const { data } = await apiClient.get<{ data: { orders: OrderDetail[] } }>('/merch/orders');
  const order = data?.data?.orders?.find((o: OrderDetail) => o.id === orderId);
  if (!order) throw new Error('Order not found');
  return order;
}

async function confirmReceipt(orderId: string): Promise<void> {
  await apiClient.patch(`/merch/orders/${orderId}/confirm-receipt`, {});
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function OrderTrackingScreen() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { isDark } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: order, isLoading, isError } = useQuery({
    queryKey: ['merch-order', orderId],
    queryFn: () => fetchOrder(orderId!),
    enabled: !!orderId,
    refetchInterval: 30_000,
  });

  const confirmMutation = useMutation({
    mutationFn: () => confirmReceipt(orderId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merch-order', orderId] });
      queryClient.invalidateQueries({ queryKey: ['merch-orders'] });
    },
  });

  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const mutedColor = isDark ? colors.neutral[400] : colors.neutral[500];
  const surfaceColor = isDark ? colors.neutral[800] : colors.neutral[50];
  const borderColor = isDark ? colors.neutral[700] : colors.neutral[200];

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.brand.blue} />
        </View>
      </Screen>
    );
  }

  if (isError || !order) {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={[styles.errorText, { color: colors.semantic.error }]}>
            Could not load order details.
          </Text>
          <Button label="Go back" variant="secondary" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const currentStepIdx = STATUS_STEPS.indexOf(order.status);
  const isDelivered = order.status === 'delivered';
  const isCompleted = order.status === 'completed';

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Order header */}
        <View style={[styles.card, { backgroundColor: surfaceColor, borderColor }]}>
          <Text style={[styles.productName, { color: textColor }]}>{order.product_name}</Text>
          <Text style={[styles.seller, { color: mutedColor }]}>Sold by @{order.creator_username}</Text>
          <Text style={[styles.amount, { color: textColor }]}>
            ₦{(order.amount_kobo / 100).toFixed(2)}
          </Text>
          <Text style={[styles.orderId, { color: mutedColor }]}>Order #{order.id.slice(0, 8)}</Text>
        </View>

        {/* Status stepper */}
        <View style={[styles.card, { backgroundColor: surfaceColor, borderColor }]}>
          <Text style={[styles.sectionTitle, { color: textColor }]}>Order Status</Text>
          {STATUS_STEPS.map((step, idx) => {
            const isActive = step === order.status || (order.status === 'in_transit' && step === 'shipped');
            const isDone = currentStepIdx > idx || isCompleted;
            const stepColor = isDone || isActive ? colors.brand.blue : (isDark ? colors.neutral[600] : colors.neutral[300]);
            return (
              <View key={step} style={styles.stepRow}>
                <View style={[styles.stepDot, { backgroundColor: stepColor }]}>
                  <Text style={styles.stepEmoji}>{STATUS_EMOJIS[step]}</Text>
                </View>
                <View style={styles.stepInfo}>
                  <Text style={[styles.stepLabel, { color: isDone || isActive ? textColor : mutedColor, fontWeight: isActive ? '700' : '400' }]}>
                    {STATUS_LABELS[step]}
                  </Text>
                  {step === 'shipped' && order.shipped_at && (
                    <Text style={[styles.stepDate, { color: mutedColor }]}>
                      {new Date(order.shipped_at).toLocaleDateString()}
                    </Text>
                  )}
                  {step === 'delivered' && order.delivered_at && (
                    <Text style={[styles.stepDate, { color: mutedColor }]}>
                      {new Date(order.delivered_at).toLocaleDateString()}
                    </Text>
                  )}
                  {step === 'completed' && order.confirmed_at && (
                    <Text style={[styles.stepDate, { color: mutedColor }]}>
                      {new Date(order.confirmed_at).toLocaleDateString()}
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>

        {/* Tracking timeline */}
        {order.tracking_updates && order.tracking_updates.length > 0 && (
          <View style={[styles.card, { backgroundColor: surfaceColor, borderColor }]}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>Tracking Updates</Text>
            {order.tracking_updates.map((update: TrackingUpdate, i: number) => (
              <View key={i} style={styles.trackingEntry}>
                <Text style={[styles.trackingNote, { color: textColor }]}>{update.note}</Text>
                <Text style={[styles.trackingTime, { color: mutedColor }]}>
                  {new Date(update.timestamp).toLocaleString()}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Shipping details */}
        {order.shipping_name && (
          <View style={[styles.card, { backgroundColor: surfaceColor, borderColor }]}>
            <Text style={[styles.sectionTitle, { color: textColor }]}>Shipping To</Text>
            <Text style={[styles.shippingText, { color: textColor }]}>{order.shipping_name}</Text>
            <Text style={[styles.shippingText, { color: mutedColor }]}>{order.shipping_address}</Text>
            <Text style={[styles.shippingText, { color: mutedColor }]}>
              {order.shipping_city}, {order.shipping_country}
            </Text>
          </View>
        )}

        {/* Confirm Receipt */}
        {isDelivered && (
          <View style={styles.actionArea}>
            <Text style={[styles.confirmPrompt, { color: textColor }]}>
              Has your order arrived?
            </Text>
            <Button
              label={confirmMutation.isPending ? 'Confirming...' : 'Confirm Receipt'}
              variant="primary"
              onPress={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending}
            />
          </View>
        )}

        {isCompleted && (
          <View style={[styles.completedBadge, { backgroundColor: `${colors.brand.green}18` }]}>
            <Text style={[styles.completedText, { color: colors.brand.green }]}>
              ✅ Order complete — thank you!
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  errorText: { fontSize: 15, textAlign: 'center' },

  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  productName: { fontSize: 18, fontWeight: '700' },
  seller: { fontSize: 13 },
  amount: { fontSize: 20, fontWeight: '800' },
  orderId: { fontSize: 11 },

  sectionTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },

  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 4,
  },
  stepDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepEmoji: { fontSize: 16 },
  stepInfo: { flex: 1, paddingTop: 4 },
  stepLabel: { fontSize: 14 },
  stepDate: { fontSize: 11, marginTop: 2 },

  trackingEntry: {
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.2)',
    gap: 2,
  },
  trackingNote: { fontSize: 13 },
  trackingTime: { fontSize: 11 },

  shippingText: { fontSize: 13, lineHeight: 20 },

  actionArea: { gap: 10, paddingTop: 4 },
  confirmPrompt: { fontSize: 15, fontWeight: '600', textAlign: 'center' },

  completedBadge: {
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  completedText: { fontSize: 15, fontWeight: '700' },
});
