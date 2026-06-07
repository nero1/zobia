/**
 * Admin coin refund management screen.
 *
 * Lists pending refund requests with the ability to process (issue) a refund.
 * Calls GET /api/admin/refunds and POST /api/admin/refunds.
 *
 * Route: /admin/refunds (accessible from admin dashboard)
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

interface Refund {
  id: string;
  user_id: string;
  username: string | null;
  amount_coins: number;
  reason: string;
  reference_id: string;
  status: 'pending' | 'processed';
  processed_by: string | null;
  created_at: string;
  processed_at: string | null;
}

type StatusFilter = 'pending' | 'processed' | 'all';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function AdminRefundsScreen() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);

  // Issue refund modal
  const [issueModalVisible, setIssueModalVisible] = useState(false);
  const [issueUserId, setIssueUserId] = useState('');
  const [issueAmount, setIssueAmount] = useState('');
  const [issueReason, setIssueReason] = useState('');
  const [issueRef, setIssueRef] = useState('');
  const [issuing, setIssuing] = useState(false);

  const LIMIT = 30;

  async function loadRefunds(newOffset: number, replace: boolean, currentStatus: StatusFilter) {
    const token = storage.getString('authToken');
    const res = await fetch(
      `${API_BASE}/api/admin/refunds?status=${currentStatus}&limit=${LIMIT}&offset=${newOffset}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    ).catch(() => null);

    if (res?.ok) {
      const data = await res.json();
      const fetched: Refund[] = data.data?.refunds ?? [];
      setRefunds((prev) => (replace ? fetched : [...prev, ...fetched]));
      setTotal(data.data?.total ?? 0);
      setOffset(newOffset + fetched.length);
    }
    setLoading(false);
    setRefreshing(false);
    setLoadingMore(false);
  }

  useEffect(() => {
    setLoading(true);
    setRefunds([]);
    setOffset(0);
    void loadRefunds(0, true, statusFilter);
  }, [statusFilter]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setOffset(0);
    void loadRefunds(0, true, statusFilter);
  }, [statusFilter]);

  const loadMore = useCallback(() => {
    if (loadingMore || offset >= total) return;
    setLoadingMore(true);
    void loadRefunds(offset, false, statusFilter);
  }, [loadingMore, offset, total, statusFilter]);

  async function handleIssueRefund() {
    const amountNum = parseInt(issueAmount, 10);
    if (!issueUserId.trim()) {
      Alert.alert('Error', 'User ID is required.');
      return;
    }
    if (!amountNum || amountNum <= 0) {
      Alert.alert('Error', 'Enter a valid coin amount.');
      return;
    }
    if (issueReason.trim().length < 5) {
      Alert.alert('Error', 'Reason must be at least 5 characters.');
      return;
    }
    if (!issueRef.trim()) {
      Alert.alert('Error', 'Reference ID is required.');
      return;
    }

    setIssuing(true);
    const token = storage.getString('authToken');
    const res = await fetch(`${API_BASE}/api/admin/refunds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        userId: issueUserId.trim(),
        amountCoins: amountNum,
        reason: issueReason.trim(),
        referenceId: issueRef.trim(),
      }),
    }).catch(() => null);

    if (res?.ok) {
      const data = await res.json();
      Alert.alert(
        'Refund Issued',
        `${data.data?.amountRefunded ?? amountNum} coins refunded to @${data.data?.username ?? issueUserId}.`
      );
      setIssueModalVisible(false);
      setIssueUserId('');
      setIssueAmount('');
      setIssueReason('');
      setIssueRef('');
      // Reload list
      setOffset(0);
      void loadRefunds(0, true, statusFilter);
    } else {
      const err = await res?.json().catch(() => null);
      Alert.alert('Error', err?.error?.message ?? 'Failed to issue refund.');
    }
    setIssuing(false);
  }

  const tabs: { key: StatusFilter; label: string }[] = [
    { key: 'pending', label: 'Pending' },
    { key: 'processed', label: 'Processed' },
    { key: 'all', label: 'All' },
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
            style={[styles.tabBtn, statusFilter === t.key && styles.tabBtnActive]}
            onPress={() => setStatusFilter(t.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: statusFilter === t.key }}
          >
            <Text style={[styles.tabLabel, statusFilter === t.key && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={refunds}
        keyExtractor={(r) => r.id}
        style={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.listHeaderText}>{total} refund{total !== 1 ? 's' : ''}</Text>
            <TouchableOpacity
              style={styles.newRefundBtn}
              onPress={() => setIssueModalVisible(true)}
              accessibilityRole="button"
            >
              <Text style={styles.newRefundBtnText}>+ Issue Refund</Text>
            </TouchableOpacity>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No {statusFilter} refunds</Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator color="#2563EB" />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.refundCard}>
            <View style={styles.refundHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.username}>@{item.username ?? item.user_id}</Text>
                <Text style={styles.refId} numberOfLines={1}>Ref: {item.reference_id}</Text>
              </View>
              <View style={styles.amountBlock}>
                <Text style={styles.coinAmount}>{item.amount_coins} coins</Text>
                <View style={[
                  styles.statusBadge,
                  item.status === 'processed' ? styles.statusDone : styles.statusPending,
                ]}>
                  <Text style={styles.statusText}>{item.status}</Text>
                </View>
              </View>
            </View>

            <Text style={styles.reason} numberOfLines={2}>{item.reason}</Text>
            <Text style={styles.date}>{formatDate(item.created_at)}</Text>
            {item.processed_at && (
              <Text style={styles.processedAt}>Processed: {formatDate(item.processed_at)}</Text>
            )}
          </View>
        )}
      />

      {/* Issue Refund Modal */}
      <Modal
        visible={issueModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIssueModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Issue Coin Refund</Text>

            <Text style={styles.fieldLabel}>User ID (UUID)</Text>
            <TextInput
              style={styles.input}
              value={issueUserId}
              onChangeText={setIssueUserId}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.fieldLabel}>Coins to Refund</Text>
            <TextInput
              style={styles.input}
              value={issueAmount}
              onChangeText={setIssueAmount}
              placeholder="e.g. 100"
              placeholderTextColor="#9ca3af"
              keyboardType="number-pad"
            />

            <Text style={styles.fieldLabel}>Reason</Text>
            <TextInput
              style={[styles.input, styles.multilineInput]}
              value={issueReason}
              onChangeText={setIssueReason}
              placeholder="Reason for refund (min 5 chars)"
              placeholderTextColor="#9ca3af"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <Text style={styles.fieldLabel}>Reference ID</Text>
            <TextInput
              style={styles.input}
              value={issueRef}
              onChangeText={setIssueRef}
              placeholder="Original transaction or payment reference"
              placeholderTextColor="#9ca3af"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.cancelModalBtn}
                onPress={() => setIssueModalVisible(false)}
                disabled={issuing}
              >
                <Text style={styles.cancelModalText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.issueBtn, issuing && { opacity: 0.5 }]}
                onPress={handleIssueRefund}
                disabled={issuing}
                accessibilityRole="button"
              >
                {issuing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.issueBtnText}>Issue Refund</Text>
                )}
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
    fontSize: 13,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  listHeaderText: {
    fontSize: 12,
    color: '#6b7280',
    fontWeight: '500',
  },
  newRefundBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  newRefundBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
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
  refundCard: {
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
  refundHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  username: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
  },
  refId: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },
  amountBlock: {
    alignItems: 'flex-end',
    gap: 4,
  },
  coinAmount: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  statusPending: {
    backgroundColor: '#fef3c7',
  },
  statusDone: {
    backgroundColor: '#d1fae5',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#374151',
    textTransform: 'uppercase',
  },
  reason: {
    fontSize: 13,
    color: '#374151',
    lineHeight: 18,
    marginBottom: 6,
  },
  date: {
    fontSize: 11,
    color: '#9ca3af',
  },
  processedAt: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 2,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    gap: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: '#111827',
    backgroundColor: '#f9fafb',
  },
  multilineInput: {
    minHeight: 72,
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
    paddingBottom: 8,
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
  issueBtn: {
    flex: 1,
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  issueBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
});
