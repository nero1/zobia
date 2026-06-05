/**
 * app/admin/kyc.tsx
 *
 * Admin screen for reviewing pending KYC applications.
 */

import React, { useEffect, useState } from "react";
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
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface KYCApplication {
  id: string;
  creator_id: string;
  creator_username: string;
  full_name: string;
  document_type: string;
  status: string;
  submitted_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAuthHeaders(): Record<string, string> {
  const token = storage.getString("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDocumentType(type: string): string {
  return type
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Reject reason modal
// ---------------------------------------------------------------------------

interface RejectModalProps {
  visible: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

function RejectReasonModal({ visible, onCancel, onConfirm }: RejectModalProps) {
  const [reason, setReason] = useState("");

  function handleConfirm() {
    onConfirm(reason.trim());
    setReason("");
  }

  function handleCancel() {
    setReason("");
    onCancel();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.overlay}>
        <View style={styles.rejectSheet}>
          <Text style={styles.rejectTitle}>Reject KYC Application</Text>
          <Text style={styles.rejectSubtitle}>
            Optionally provide a reason that will be sent to the creator.
          </Text>
          <TextInput
            style={styles.rejectInput}
            value={reason}
            onChangeText={setReason}
            placeholder="Reason for rejection (optional)"
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />
          <View style={styles.rejectActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirmRejectBtn} onPress={handleConfirm}>
              <Text style={styles.confirmRejectBtnText}>Reject</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// KYC card
// ---------------------------------------------------------------------------

interface KYCCardProps {
  item: KYCApplication;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  processing: boolean;
}

function KYCCard({ item, onApprove, onReject, processing }: KYCCardProps) {
  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarLetter}>
            {item.creator_username?.[0]?.toUpperCase() ?? "?"}
          </Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.username}>@{item.creator_username}</Text>
          <Text style={styles.fullName}>{item.full_name}</Text>
        </View>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>{item.status.toUpperCase()}</Text>
        </View>
      </View>

      {/* Details */}
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Document</Text>
        <Text style={styles.detailValue}>{formatDocumentType(item.document_type)}</Text>
      </View>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Submitted</Text>
        <Text style={styles.detailValue}>{formatDate(item.submitted_at)}</Text>
      </View>
      <View style={styles.detailRow}>
        <Text style={styles.detailLabel}>Creator ID</Text>
        <Text style={[styles.detailValue, styles.mono]} numberOfLines={1}>{item.creator_id}</Text>
      </View>

      {/* Actions */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.approveBtn, processing && styles.btnDisabled]}
          onPress={() => onApprove(item.id)}
          disabled={processing}
        >
          {processing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.approveBtnText}>Approve</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.rejectBtn, processing && styles.btnDisabled]}
          onPress={() => onReject(item.id)}
          disabled={processing}
        >
          <Text style={styles.rejectBtnText}>Reject</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function AdminKYCScreen() {
  const [applications, setApplications] = useState<KYCApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Reject modal state
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);

  async function loadApplications() {
    try {
      const res = await fetch(`${API_BASE}/api/admin/kyc?status=pending`, {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setApplications(data.data?.applications ?? data.applications ?? []);
      }
    } catch {
      // ignore
    }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void loadApplications(); }, []);

  async function submitAction(
    applicationId: string,
    action: "approve" | "reject",
    reason?: string,
  ) {
    setProcessingId(applicationId);
    try {
      const res = await fetch(`${API_BASE}/api/admin/kyc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ applicationId, action, ...(reason ? { reason } : {}) }),
      });
      if (res.ok) {
        setApplications((prev) => prev.filter((a) => a.id !== applicationId));
      } else {
        Alert.alert("Error", `Could not ${action} application. Please try again.`);
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setProcessingId(null);
    }
  }

  function handleApprove(id: string) {
    Alert.alert(
      "Approve KYC",
      "Approve this KYC application?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve",
          onPress: () => void submitAction(id, "approve"),
        },
      ],
    );
  }

  function handleRejectPress(id: string) {
    setRejectTargetId(id);
  }

  function handleRejectConfirm(reason: string) {
    if (rejectTargetId) {
      void submitAction(rejectTargetId, "reject", reason || undefined);
    }
    setRejectTargetId(null);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={applications}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void loadApplications(); }}
          />
        }
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.listHeaderTitle}>Pending KYC Applications</Text>
            <Text style={styles.listHeaderCount}>{applications.length} pending</Text>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyText}>No pending KYC applications</Text>
            <Text style={styles.emptySubtext}>All applications have been reviewed.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <KYCCard
            item={item}
            onApprove={handleApprove}
            onReject={handleRejectPress}
            processing={processingId === item.id}
          />
        )}
      />

      <RejectReasonModal
        visible={rejectTargetId !== null}
        onCancel={() => setRejectTargetId(null)}
        onConfirm={handleRejectConfirm}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  listHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  listHeaderTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
  listHeaderCount: { fontSize: 13, color: "#6b7280", marginTop: 2 },

  card: {
    backgroundColor: "#fff",
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 14,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },

  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarLetter: { fontSize: 18, fontWeight: "700", color: "#2563EB" },
  cardInfo: { flex: 1 },
  username: { fontSize: 15, fontWeight: "700", color: "#111827" },
  fullName: { fontSize: 13, color: "#6b7280", marginTop: 1 },
  statusBadge: {
    backgroundColor: "#fef9c3",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: { fontSize: 10, fontWeight: "700", color: "#92400e" },

  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#f3f4f6",
  },
  detailLabel: { fontSize: 12, color: "#9ca3af", fontWeight: "500" },
  detailValue: { fontSize: 13, color: "#374151", fontWeight: "500", maxWidth: "65%" },
  mono: { fontFamily: "monospace", fontSize: 11 },

  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  approveBtn: {
    flex: 1,
    backgroundColor: "#16a34a",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  approveBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  rejectBtn: {
    flex: 1,
    backgroundColor: "#fef2f2",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#fca5a5",
  },
  rejectBtnText: { color: "#dc2626", fontWeight: "700", fontSize: 14 },
  btnDisabled: { opacity: 0.5 },

  emptyState: { padding: 48, alignItems: "center" },
  emptyIcon: { fontSize: 36, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: "600", color: "#374151" },
  emptySubtext: { fontSize: 13, color: "#9ca3af", marginTop: 4 },

  // Reject modal
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  rejectSheet: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    width: "100%",
    maxWidth: 400,
  },
  rejectTitle: { fontSize: 17, fontWeight: "700", color: "#111827", marginBottom: 6 },
  rejectSubtitle: { fontSize: 13, color: "#6b7280", marginBottom: 14 },
  rejectInput: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#f9fafb",
    minHeight: 80,
  },
  rejectActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: "center",
  },
  cancelBtnText: { color: "#374151", fontWeight: "600", fontSize: 14 },
  confirmRejectBtn: {
    flex: 1,
    backgroundColor: "#dc2626",
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: "center",
  },
  confirmRejectBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
