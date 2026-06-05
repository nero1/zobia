/**
 * app/admin/announcements.tsx
 *
 * Admin screen for managing announcement modals and banners.
 * Two tabs: Modals | Banners
 */

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  TextInput,
  Modal,
  ScrollView,
  StyleSheet,
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AnnouncementModal {
  id: string;
  content: string;
  start_at: string;
  end_at: string;
  target_plans: string[];
  is_active: boolean;
  created_at?: string;
}

interface AnnouncementBanner {
  id: string;
  title?: string;
  content: string;
  is_active: boolean;
  start_at?: string;
  end_at?: string;
}

type TabKey = "modals" | "banners";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAuthHeaders(): Record<string, string> {
  const token = storage.getString("authToken");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Create Modal Form
// ---------------------------------------------------------------------------

interface CreateModalFormProps {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function CreateModalForm({ visible, onClose, onCreated }: CreateModalFormProps) {
  const [content, setContent] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [targetPlans, setTargetPlans] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!content.trim()) {
      Alert.alert("Validation", "Content is required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/announcements/modals`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          content: content.trim(),
          start_at: startAt.trim() || new Date().toISOString(),
          end_at: endAt.trim() || new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
          target_plans: targetPlans
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          is_active: true,
        }),
      });
      if (!res.ok) throw new Error("Failed to create modal");
      setContent("");
      setStartAt("");
      setEndAt("");
      setTargetPlans("");
      onCreated();
      onClose();
    } catch {
      Alert.alert("Error", "Could not create modal announcement.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={styles.formSheet}>
        <View style={styles.formHeader}>
          <Text style={styles.formTitle}>New Modal Announcement</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.formCancel}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.fieldLabel}>Content *</Text>
        <TextInput
          style={[styles.textArea]}
          value={content}
          onChangeText={setContent}
          placeholder="Enter announcement content…"
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        <Text style={styles.fieldLabel}>Start Date (ISO, optional)</Text>
        <TextInput
          style={styles.input}
          value={startAt}
          onChangeText={setStartAt}
          placeholder="e.g. 2025-06-01T00:00:00Z"
          autoCapitalize="none"
        />

        <Text style={styles.fieldLabel}>End Date (ISO, optional)</Text>
        <TextInput
          style={styles.input}
          value={endAt}
          onChangeText={setEndAt}
          placeholder="e.g. 2025-06-30T23:59:59Z"
          autoCapitalize="none"
        />

        <Text style={styles.fieldLabel}>Target Plans (comma-separated, optional)</Text>
        <TextInput
          style={styles.input}
          value={targetPlans}
          onChangeText={setTargetPlans}
          placeholder="e.g. free, pro, enterprise"
          autoCapitalize="none"
        />

        <TouchableOpacity
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitBtnText}>Create Modal</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Modal item card
// ---------------------------------------------------------------------------

function ModalCard({
  item,
  onToggle,
}: {
  item: AnnouncementModal;
  onToggle: (id: string, active: boolean) => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.statusDot, item.is_active ? styles.dotActive : styles.dotInactive]} />
        <Text style={styles.cardStatus}>{item.is_active ? "Active" : "Inactive"}</Text>
        {item.target_plans?.length > 0 && (
          <Text style={styles.cardMeta}> · {item.target_plans.join(", ")}</Text>
        )}
      </View>

      <Text style={styles.cardContent} numberOfLines={3}>{item.content}</Text>

      <View style={styles.cardDates}>
        <Text style={styles.dateText}>From: {formatDate(item.start_at)}</Text>
        <Text style={styles.dateText}>To: {formatDate(item.end_at)}</Text>
      </View>

      <TouchableOpacity
        style={[styles.toggleBtn, item.is_active ? styles.toggleBtnDeactivate : styles.toggleBtnActivate]}
        onPress={() => onToggle(item.id, !item.is_active)}
      >
        <Text style={[styles.toggleBtnText, item.is_active ? styles.toggleTextDeactivate : styles.toggleTextActivate]}>
          {item.is_active ? "Deactivate" : "Activate"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Banner item card
// ---------------------------------------------------------------------------

function BannerCard({
  item,
  onToggle,
}: {
  item: AnnouncementBanner;
  onToggle: (id: string, active: boolean) => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={[styles.statusDot, item.is_active ? styles.dotActive : styles.dotInactive]} />
        <Text style={styles.cardStatus}>{item.is_active ? "Active" : "Inactive"}</Text>
      </View>

      {item.title && <Text style={styles.cardTitle}>{item.title}</Text>}
      <Text style={styles.cardContent} numberOfLines={3}>{item.content}</Text>

      {(item.start_at || item.end_at) && (
        <View style={styles.cardDates}>
          <Text style={styles.dateText}>From: {formatDate(item.start_at)}</Text>
          <Text style={styles.dateText}>To: {formatDate(item.end_at)}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.toggleBtn, item.is_active ? styles.toggleBtnDeactivate : styles.toggleBtnActivate]}
        onPress={() => onToggle(item.id, !item.is_active)}
      >
        <Text style={[styles.toggleBtnText, item.is_active ? styles.toggleTextDeactivate : styles.toggleTextActivate]}>
          {item.is_active ? "Deactivate" : "Activate"}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function AdminAnnouncementsScreen() {
  const [activeTab, setActiveTab] = useState<TabKey>("modals");
  const [modals, setModals] = useState<AnnouncementModal[]>([]);
  const [banners, setBanners] = useState<AnnouncementBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  async function loadData() {
    try {
      const headers = getAuthHeaders();
      const [modalsRes, bannersRes] = await Promise.all([
        fetch(`${API_BASE}/api/admin/announcements/modals`, { headers }),
        fetch(`${API_BASE}/api/admin/announcements/banners`, { headers }),
      ]);
      if (modalsRes.ok) {
        const d = await modalsRes.json();
        setModals(d.data?.modals ?? d.modals ?? []);
      }
      if (bannersRes.ok) {
        const d = await bannersRes.json();
        setBanners(d.data?.banners ?? d.banners ?? []);
      }
    } catch {
      // ignore, show empty state
    }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void loadData(); }, []);

  async function handleToggleModal(id: string, is_active: boolean) {
    const res = await fetch(`${API_BASE}/api/admin/announcements/modals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ is_active }),
    }).catch(() => null);
    if (res?.ok) {
      setModals((prev) =>
        prev.map((m) => (m.id === id ? { ...m, is_active } : m))
      );
    } else {
      Alert.alert("Error", "Could not update modal.");
    }
  }

  async function handleToggleBanner(id: string, is_active: boolean) {
    const res = await fetch(`${API_BASE}/api/admin/announcements/banners/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ is_active }),
    }).catch(() => null);
    if (res?.ok) {
      setBanners((prev) =>
        prev.map((b) => (b.id === id ? { ...b, is_active } : b))
      );
    } else {
      Alert.alert("Error", "Could not update banner.");
    }
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
      {/* Tab bar */}
      <View style={styles.tabBar}>
        {(["modals", "banners"] as TabKey[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === "modals" ? "Modals" : "Banners"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === "modals" && (
        <FlatList
          data={modals}
          keyExtractor={(item) => item.id}
          style={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void loadData(); }}
            />
          }
          ListHeaderComponent={
            <TouchableOpacity style={styles.createBtn} onPress={() => setShowCreateModal(true)}>
              <Text style={styles.createBtnText}>+ New Modal</Text>
            </TouchableOpacity>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No modal announcements found.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <ModalCard item={item} onToggle={handleToggleModal} />
          )}
        />
      )}

      {activeTab === "banners" && (
        <FlatList
          data={banners}
          keyExtractor={(item) => item.id}
          style={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void loadData(); }}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No banner announcements found.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <BannerCard item={item} onToggle={handleToggleBanner} />
          )}
        />
      )}

      <CreateModalForm
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={loadData}
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
  list: { flex: 1 },

  tabBar: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabActive: { borderBottomColor: "#2563EB" },
  tabText: { fontSize: 14, fontWeight: "600", color: "#6b7280" },
  tabTextActive: { color: "#2563EB" },

  card: {
    backgroundColor: "#fff",
    marginHorizontal: 12,
    marginVertical: 6,
    borderRadius: 12,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  dotActive: { backgroundColor: "#10b981" },
  dotInactive: { backgroundColor: "#d1d5db" },
  cardStatus: { fontSize: 12, fontWeight: "600", color: "#374151" },
  cardMeta: { fontSize: 12, color: "#6b7280" },
  cardTitle: { fontSize: 14, fontWeight: "700", color: "#111827", marginBottom: 4 },
  cardContent: { fontSize: 13, color: "#4b5563", lineHeight: 18, marginBottom: 8 },
  cardDates: { flexDirection: "row", gap: 12, marginBottom: 10 },
  dateText: { fontSize: 11, color: "#9ca3af" },

  toggleBtn: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
  toggleBtnActivate: { backgroundColor: "#f0fdf4", borderColor: "#86efac" },
  toggleBtnDeactivate: { backgroundColor: "#fef2f2", borderColor: "#fca5a5" },
  toggleBtnText: { fontSize: 13, fontWeight: "600" },
  toggleTextActivate: { color: "#16a34a" },
  toggleTextDeactivate: { color: "#dc2626" },

  createBtn: {
    margin: 12,
    backgroundColor: "#2563EB",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  createBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  emptyState: { padding: 40, alignItems: "center" },
  emptyText: { color: "#9ca3af", fontSize: 14 },

  // Form sheet
  formSheet: { flex: 1, padding: 20, backgroundColor: "#fff" },
  formHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
    marginTop: 8,
  },
  formTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
  formCancel: { fontSize: 15, color: "#2563EB", fontWeight: "600" },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 14 },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#f9fafb",
  },
  textArea: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#f9fafb",
    minHeight: 100,
  },
  submitBtn: {
    marginTop: 28,
    backgroundColor: "#2563EB",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
    marginBottom: 40,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
