/**
 * app/merch/seller/orders.tsx
 *
 * Seller order management screen.
 * Lists physical orders grouped by status with fulfillment actions:
 *  - Mark as Sent (with optional step-by-step tracking)
 *  - Add tracking update
 *  - Mark as Delivered
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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

interface SellerOrder {
  id: string;
  product_name: string;
  buyer_username: string;
  amount_kobo: number;
  creator_share_kobo: number;
  status: string;
  fulfillment_method: string | null;
  shipping_name: string | null;
  shipping_city: string | null;
  shipping_country: string | null;
  tracking_updates: unknown[];
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchSellerOrders(): Promise<SellerOrder[]> {
  const { data } = await apiClient.get<{ data: { orders: SellerOrder[] } }>('/merch/seller/orders');
  return data?.data?.orders ?? [];
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  shipped: 'Shipped',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  completed: 'Completed',
  refunded: 'Refunded',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  shipped: '#3b82f6',
  in_transit: '#6366f1',
  delivered: '#10b981',
  completed: '#6b7280',
  refunded: '#ef4444',
};

// ---------------------------------------------------------------------------
// Ship Modal
// ---------------------------------------------------------------------------

interface ShipModalProps {
  orderId: string;
  onClose: () => void;
  onShipped: () => void;
}

function ShipModal({ orderId, onClose, onShipped }: ShipModalProps) {
  const { isDark, colors: themeColors } = useTheme();
  const [useStepTracking, setUseStepTracking] = useState(false);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleConfirm() {
    setLoading(true);
    try {
      await apiClient.patch(`/merch/orders/${orderId}/ship`, { useStepTracking, note: note.trim() || undefined });
      onShipped();
    } catch {
      Alert.alert('Error', 'Failed to mark as shipped. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.modalContainer, { backgroundColor: themeColors.background }]}>
        <Text style={[styles.modalTitle, { color: themeColors.text }]}>Mark as Sent</Text>

        <View style={[styles.modalRow, { borderColor: themeColors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.modalRowLabel, { color: themeColors.text }]}>Add step-by-step updates</Text>
            <Text style={[styles.modalRowDesc, { color: themeColors.textMuted }]}>
              When enabled, buyers see tracking progress. Otherwise order shows "In Transit".
            </Text>
          </View>
          <Switch
            value={useStepTracking}
            onValueChange={setUseStepTracking}
            trackColor={{ false: colors.neutral[300], true: colors.brand.blue }}
          />
        </View>

        {useStepTracking && (
          <TextInput
            style={[styles.noteInput, { backgroundColor: isDark ? colors.neutral[800] : colors.neutral[100], color: themeColors.text, borderColor: themeColors.border }]}
            placeholder="First tracking note (optional)"
            placeholderTextColor={themeColors.textMuted}
            value={note}
            onChangeText={setNote}
          />
        )}

        <View style={styles.modalActions}>
          <Button label="Cancel" variant="ghost" onPress={onClose} style={styles.modalBtn} />
          <Button label={loading ? 'Saving...' : 'Confirm Sent'} variant="primary" onPress={handleConfirm} disabled={loading} style={styles.modalBtn} />
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Order card
// ---------------------------------------------------------------------------

interface OrderCardProps {
  order: SellerOrder;
  onRefresh: () => void;
}

function OrderCard({ order, onRefresh }: OrderCardProps) {
  const { isDark } = useTheme();
  const [showShipModal, setShowShipModal] = useState(false);
  const [showTrackingInput, setShowTrackingInput] = useState(false);
  const [trackingNote, setTrackingNote] = useState('');
  const queryClient = useQueryClient();

  const textColor = isDark ? colors.neutral[100] : colors.neutral[900];
  const mutedColor = isDark ? colors.neutral[400] : colors.neutral[500];
  const surfaceColor = isDark ? colors.neutral[800] : colors.neutral[0];
  const borderColor = isDark ? colors.neutral[700] : colors.neutral[200];

  const deliverMutation = useMutation({
    mutationFn: () => apiClient.patch(`/merch/orders/${order.id}/deliver`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
      onRefresh();
    },
    onError: () => Alert.alert('Error', 'Failed to mark as delivered.'),
  });

  const trackingMutation = useMutation({
    mutationFn: (note: string) => apiClient.patch(`/merch/orders/${order.id}/tracking`, { note }),
    onSuccess: () => {
      setTrackingNote('');
      setShowTrackingInput(false);
      queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
      onRefresh();
    },
    onError: () => Alert.alert('Error', 'Failed to add tracking update.'),
  });

  const statusColor = STATUS_COLORS[order.status] ?? colors.neutral[400];

  return (
    <View style={[styles.orderCard, { backgroundColor: surfaceColor, borderColor }]}>
      {showShipModal && (
        <ShipModal
          orderId={order.id}
          onClose={() => setShowShipModal(false)}
          onShipped={() => {
            setShowShipModal(false);
            queryClient.invalidateQueries({ queryKey: ['seller-orders'] });
            onRefresh();
          }}
        />
      )}

      <View style={styles.orderHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.orderProduct, { color: textColor }]} numberOfLines={1}>{order.product_name}</Text>
          <Text style={[styles.orderBuyer, { color: mutedColor }]}>@{order.buyer_username}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: `${statusColor}20` }]}>
          <Text style={[styles.statusText, { color: statusColor }]}>{STATUS_LABELS[order.status] ?? order.status}</Text>
        </View>
      </View>

      <Text style={[styles.orderEarnings, { color: textColor }]}>
        Your earnings: ₦{(order.creator_share_kobo / 100).toFixed(2)}
      </Text>

      {order.shipping_city && (
        <Text style={[styles.orderShipping, { color: mutedColor }]}>
          📍 {order.shipping_name} · {order.shipping_city}, {order.shipping_country}
        </Text>
      )}

      {/* Actions */}
      {order.status === 'pending' && (
        <Button label="Mark as Sent" variant="primary" size="sm" onPress={() => setShowShipModal(true)} />
      )}

      {order.status === 'shipped' && (
        <View style={styles.actionRow}>
          <Button
            label="Add Update"
            variant="secondary"
            size="sm"
            onPress={() => setShowTrackingInput(!showTrackingInput)}
            style={styles.actionBtn}
          />
          <Button
            label="Mark Delivered"
            variant="primary"
            size="sm"
            onPress={() => deliverMutation.mutate()}
            disabled={deliverMutation.isPending}
            style={styles.actionBtn}
          />
        </View>
      )}

      {order.status === 'in_transit' && (
        <Button
          label={deliverMutation.isPending ? 'Saving...' : 'Mark Delivered'}
          variant="primary"
          size="sm"
          onPress={() => deliverMutation.mutate()}
          disabled={deliverMutation.isPending}
        />
      )}

      {showTrackingInput && (
        <View style={styles.trackingInputRow}>
          <TextInput
            style={[styles.trackingInput, { backgroundColor: isDark ? colors.neutral[700] : colors.neutral[100], color: textColor, borderColor }]}
            placeholder="Tracking update note..."
            placeholderTextColor={mutedColor}
            value={trackingNote}
            onChangeText={setTrackingNote}
          />
          <Pressable
            style={[styles.trackingSendBtn, { backgroundColor: colors.brand.blue }]}
            onPress={() => { if (trackingNote.trim()) trackingMutation.mutate(trackingNote.trim()); }}
            disabled={trackingMutation.isPending}
          >
            <Text style={styles.trackingSendText}>Send</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function SellerOrdersScreen() {
  const { colors: themeColors } = useTheme();
  const { data: orders = [], isLoading, refetch } = useQuery({
    queryKey: ['seller-orders'],
    queryFn: fetchSellerOrders,
    refetchInterval: 30_000,
  });

  const activeOrders = orders.filter((o: SellerOrder) => !['completed', 'refunded'].includes(o.status));
  const historyOrders = orders.filter((o: SellerOrder) => ['completed', 'refunded'].includes(o.status));

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.screenTitle, { color: themeColors.text }]}>Orders</Text>

        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.brand.blue} />
          </View>
        ) : activeOrders.length === 0 && historyOrders.length === 0 ? (
          <View style={styles.centered}>
            <Text style={{ color: themeColors.textMuted, fontSize: 15, textAlign: 'center' }}>
              No orders yet. When buyers purchase your physical products they'll appear here.
            </Text>
          </View>
        ) : (
          <>
            {activeOrders.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>ACTIVE</Text>
                {activeOrders.map((order: SellerOrder) => (
                  <OrderCard key={order.id} order={order} onRefresh={refetch} />
                ))}
              </>
            )}
            {historyOrders.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: themeColors.textMuted }]}>HISTORY</Text>
                {historyOrders.map((order: SellerOrder) => (
                  <OrderCard key={order.id} order={order} onRefresh={refetch} />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  screenTitle: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 8 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },

  orderCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  orderHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  orderProduct: { fontSize: 15, fontWeight: '700' },
  orderBuyer: { fontSize: 12 },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  orderEarnings: { fontSize: 14, fontWeight: '600' },
  orderShipping: { fontSize: 12 },

  actionRow: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1 },

  trackingInputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  trackingInput: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
  },
  trackingSendBtn: {
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: 'center',
  },
  trackingSendText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  modalContainer: { flex: 1, padding: 24, gap: 16 },
  modalTitle: { fontSize: 20, fontWeight: '800' },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalRowLabel: { fontSize: 15, fontWeight: '600' },
  modalRowDesc: { fontSize: 12, marginTop: 2 },
  noteInput: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    fontSize: 14,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modalBtn: { flex: 1 },
});
