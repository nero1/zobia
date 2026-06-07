/**
 * Admin payouts management screen.
 *
 * Shows pending payouts (awaiting_approval) with approve/reject actions,
 * plus tabs for processing, completed, failed, and appeals.
 *
 * Route: /admin/payouts (accessible from admin tab)
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  StyleSheet,
} from 'react-native';
import { storage } from '@/lib/offline/store';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? '';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BankSnapshot {
  bank_name: string;
  account_name: string;
  last4: string;
  recipient_code: string;
}

interface Payout {
  id: string;
  creator: {
    id: string;
    username: string;
    email: string | null;
  };
  grossKobo: number;
  netKobo: number;
  platformFeeKobo: number;
  status: string;
  payoutMethod: 'bank_transfer' | 'coins' | 'crypto';
  region: 'nigeria' | 'global';
  bankAccountSnapshot: BankSnapshot | null;
  walletAddressSnapshot: string | null;
  retryCount: number;
  appealStatus: 'pending' | 'resolved' | 'dismissed' | null;
  createdAt: string;
}

type TabKey = 'awaiting_approval' | 'processing' | 'completed' | 'failed' | 'appeals';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function koboToNaira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function methodLabel(method: Payout['payoutMethod']): string {
  switch (method) {
    case 'bank_transfer': return 'Bank Transfer';
    case 'coins': return 'Coins';
    case 'crypto': return 'USDT/Tron';
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function AdminPayoutsScreen() {
  const [tab, setTab] = useState<TabKey>('awaiting_approval');
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);

  // Reject modal
  const [rejectModalId, setRejectModalId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const LIMIT = 30;

  async function loadPayouts(newOffset: number, replace: boolean, currentTab: TabKey) {
    const token = storage.getString('authToken');
    const statusParam = currentTab === 'appeals' ? 'awaiting_approval&appealPending=true' : currentTab;
    const res = await fetch(
      `${API_BASE}/api/admin/payouts?status=${statusParam}&limit=${LIMIT}&offset=${newOffset}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    ).catch(() => null);

    if (res?.ok) {
      const data = await res.json();
      const fetched: Payout[] = data.payouts ?? [];
      setPayouts((prev) => (replace ? fetched : [...prev, ...fetched]));
      setTotal(data.total ?? 0);
      setOffset(newOffset + fetched.length);
    }
    setLoading(false);
    setRefreshing(false);
    setLoadingMore(false);
  }

  useEffect(() => {
    setLoading(true);
    setPayouts([]);
    setOffset(0);
    void loadPayouts(0, true, tab);
  }, [tab]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setOffset(0);
    void loadPayouts(0, true, tab);
  }, [tab]);

  const loadMore = useCallback(() => {
    if (loadingMore || offset >= total) return;
    setLoadingMore(true);
    void loadPayouts(offset, false, tab);
  }, [loadingMore, offset, total, tab]);

  async function handleApprove(payout: Payout) {
    Alert.alert(
      'Approve payout?',
      `Approve ${koboToNaira(payout.netKobo)} for @${payout.creator.username}?${
        payout.bankAccountSnapshot
          ? `\nBank: ${payout.bankAccountSnapshot.bank_name} ····${payout.bankAccountSnapshot.last4}`
          : payout.walletAddressSnapshot
          ? `\nMethod: USDT/Tron (manual send)`
          : ''
      }`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: async () => {
            setActingId(payout.id);
            const token = storage.getString('authToken');
            const res = await fetch(`${API_BASE}/api/admin/payouts/${payout.id}/approve`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
            }).catch(() => null);
            if (res?.ok) {
              setPayouts((prev) => prev.filter((p) => p.id !== payout.id));
              setTotal((t) => Math.max(0, t - 1));
            } else {
              const err = await res?.json().catch(() => null);
              Alert.alert('Error', err?.error?.message ?? 'Failed to approve payout.');
            }
            setActingId(null);
          },
        },
      ]
    );
  }

  async function handleReject() {
    if (!rejectModalId) return;
    if (rejectReason.trim().length < 10) {
      Alert.alert('Error', 'Rejection reason must be at least 10 characters.');
      return;
    }
    setActingId(rejectModalId);
    const token = storage.getString('authToken');
    const res = await fetch(`${API_BASE}/api/admin/payouts/${rejectModalId}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ reason: rejectReason }),
    }).catch(() => null);

    if (res?.ok) {
      setPayouts((prev) => prev.filter((p) => p.id !== rejectModalId));
      setTotal((t) => Math.max(0, t - 1));
      setRejectModalId(null);
      setRejectReason('');
    } else {
      const err = await res?.json().catch(() => null);
      Alert.alert('Error', err?.error?.message ?? 'Failed to reject payout.');
    }
    setActingId(null);
  }

  async function handleResolveAppeal(payoutId: string, action: 'approve' | 'dismiss') {
    Alert.alert(
      action === 'approve' ? 'Approve Appeal?' : 'Dismiss Appeal?',
      action === 'approve'
        ? 'This will re-open the payout for processing.'
        : 'This will dismiss the creator\'s appeal.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action === 'approve' ? 'Approve' : 'Dismiss',
          style: action === 'dismiss' ? 'destructive' : 'default',
          onPress: async () => {
            setActingId(payoutId);
            const token = storage.getString('authToken');
            const res = await fetch(`${API_BASE}/api/admin/payouts/${payoutId}/appeal`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({ action }),
            }).catch(() => null);
            if (res?.ok) {
              setPayouts((prev) => prev.filter((p) => p.id !== payoutId));
              setTotal((t) => Math.max(0, t - 1));
            } else {
              const err = await res?.json().catch(() => null);
              Alert.alert('Error', err?.error?.message ?? 'Failed to resolve appeal.');
            }
            setActingId(null);
          },
        },
      ]
    );
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'awaiting_approval', label: 'Pending' },
    { key: 'processing', label: 'Processing' },
    { key: 'completed', label: 'Done' },
    { key: 'failed', label: 'Failed' },
    { key: 'appeals', label: 'Appeals' },
  ];

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#2563EB" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Tab bar */}
      <View style={styles.tabBar}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
            onPress={() => setTab(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.key }}
          >
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={payouts}
        keyExtractor={(p) => p.id}
        style={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.listHeaderText}>{total} payout{total !== 1 ? 's' : ''}</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No {tab.replace(/_/g, ' ')} payouts</Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator color="#2563EB" />
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const isActing = actingId === item.id;
          return (
            <View style={styles.payoutCard}>
              {/* Creator + amount row */}
              <View style={styles.payoutHeader}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.creatorName}>@{item.creator.username}</Text>
                  {item.creator.email && (
                    <Text style={styles.creatorEmail} numberOfLines={1}>
                      {item.creator.email}
                    </Text>
                  )}
                </View>
                <View style={styles.amountBlock}>
                  <Text style={styles.netAmount}>{koboToNaira(item.netKobo)}</Text>
                  <Text style={styles.grossAmount}>gross {koboToNaira(item.grossKobo)}</Text>
                </View>
              </View>

              {/* Details row */}
              <View style={styles.detailsRow}>
                <Text style={styles.detailChip}>{methodLabel(item.payoutMethod)}</Text>
                <Text style={styles.detailChip}>{item.region}</Text>
                {item.bankAccountSnapshot && (
                  <Text style={styles.detailChip}>
                    {item.bankAccountSnapshot.bank_name} ····{item.bankAccountSnapshot.last4}
                  </Text>
                )}
                {item.retryCount > 0 && (
                  <Text style={[styles.detailChip, { color: '#d97706' }]}>
                    Retry {item.retryCount}
                  </Text>
                )}
              </View>

              <Text style={styles.payoutDate}>{formatDate(item.createdAt)}</Text>

              {/* Actions */}
              {isActing ? (
                <View style={styles.actingContainer}>
                  <ActivityIndicator color="#2563EB" />
                </View>
              ) : tab === 'awaiting_approval' ? (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.rejectBtn}
                    onPress={() => { setRejectModalId(item.id); setRejectReason(''); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Reject payout for ${item.creator.username}`}
                  >
                    <Text style={styles.rejectBtnText}>Reject</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.approveBtn}
                    onPress={() => handleApprove(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Approve payout for ${item.creator.username}`}
                  >
                    <Text style={styles.approveBtnText}>Approve</Text>
                  </TouchableOpacity>
                </View>
              ) : tab === 'appeals' ? (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.dismissBtn}
                    onPress={() => handleResolveAppeal(item.id, 'dismiss')}
                    accessibilityRole="button"
                    accessibilityLabel={`Dismiss appeal for ${item.creator.username}`}
                  >
                    <Text style={styles.dismissBtnText}>Dismiss</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.approveBtn}
                    onPress={() => handleResolveAppeal(item.id, 'approve')}
                    accessibilityRole="button"
                    accessibilityLabel={`Approve appeal for ${item.creator.username}`}
                  >
                    <Text style={styles.approveBtnText}>Approve Appeal</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          );
        }}
      />

      {/* Reject reason modal */}
      <Modal
        visible={rejectModalId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRejectModalId(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reject Payout</Text>
            <Text style={styles.modalSub}>
              Provide a reason for rejection (shown to the creator).
            </Text>
            <TextInput
              style={styles.reasonInput}
              value={rejectReason}
              onChangeText={setRejectReason}
              placeholder="Enter rejection reason (min 10 chars)…"
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.cancelModalBtn}
                onPress={() => { setRejectModalId(null); setRejectReason(''); }}
              >
                <Text style={styles.cancelModalText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmRejectBtn, actingId === rejectModalId && { opacity: 0.5 }]}
                onPress={handleReject}
                disabled={actingId === rejectModalId}
              >
                <Text style={styles.confirmRejectText}>
                  {actingId === rejectModalId ? 'Rejecting…' : 'Confirm Reject'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#2563EB',
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
  },
  tabLabelActive: {
    color: '#2563EB',
  },
  list: {
    flex: 1,
  },
  listHeader: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  listHeaderText: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  footerLoader: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  payoutCard: {
    backgroundColor: '#fff',
    marginHorizontal: 12,
    marginBottom: 10,
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  payoutHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  creatorName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  creatorEmail: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },
  amountBlock: {
    alignItems: 'flex-end',
  },
  netAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  grossAmount: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 1,
  },
  detailsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 6,
  },
  detailChip: {
    fontSize: 11,
    color: '#6b7280',
    backgroundColor: '#f3f4f6',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  payoutDate: {
    fontSize: 11,
    color: '#9ca3af',
    marginBottom: 12,
  },
  actingContainer: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: '#fee2e2',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  rejectBtnText: {
    color: '#dc2626',
    fontWeight: '700',
    fontSize: 14,
  },
  approveBtn: {
    flex: 1,
    backgroundColor: '#059669',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  approveBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  dismissBtn: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
  },
  dismissBtnText: {
    color: '#6b7280',
    fontWeight: '700',
    fontSize: 14,
  },
  // Reject modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    gap: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
  },
  modalSub: {
    fontSize: 13,
    color: '#6b7280',
    lineHeight: 18,
  },
  reasonInput: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    minHeight: 80,
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  cancelModalBtn: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelModalText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6b7280',
  },
  confirmRejectBtn: {
    flex: 1,
    backgroundColor: '#dc2626',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  confirmRejectText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
