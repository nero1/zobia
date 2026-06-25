import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, Modal, Pressable,
  StyleSheet,
} from "react-native";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { apiClient } from "@/lib/api/client";

interface User {
  id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string;
  rank: string;
  plan: string;
  trust_score: number;
  created_at: string;
}

type UserAction = "suspend" | "ban" | "restore" | "upgrade_moderator";

async function performUserAction(
  userId: string,
  action: UserAction,
  reason?: string,
  durationHours?: number,
): Promise<void> {
  const body: Record<string, unknown> = { action };
  if (reason) body.reason = reason;
  if (durationHours !== undefined) body.duration_hours = durationHours;

  await apiClient.post(`/admin/users/${userId}/actions`, body);
}

// ---------------------------------------------------------------------------
// Reason prompt modal
// ---------------------------------------------------------------------------

interface ReasonModalProps {
  visible: boolean;
  title: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

function ReasonModal({ visible, title, onConfirm, onCancel }: ReasonModalProps) {
  const [reason, setReason] = useState("");

  const handleConfirm = () => {
    onConfirm(reason.trim());
    setReason("");
  };

  const handleCancel = () => {
    setReason("");
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleCancel}
    >
      <View style={reasonStyles.container}>
        <View style={reasonStyles.header}>
          <Text style={reasonStyles.title}>{title}</Text>
          <Pressable onPress={handleCancel} hitSlop={12}>
            <Text style={reasonStyles.closeBtn}>✕</Text>
          </Pressable>
        </View>

        <View style={reasonStyles.body}>
          <Text style={reasonStyles.label}>Reason (optional)</Text>
          <TextInput
            style={reasonStyles.input}
            placeholder="Enter a reason for this action..."
            placeholderTextColor="#9ca3af"
            value={reason}
            onChangeText={setReason}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            autoFocus
            maxLength={500}
          />

          <TouchableOpacity
            style={reasonStyles.confirmBtn}
            onPress={handleConfirm}
          >
            <Text style={reasonStyles.confirmBtnText}>Confirm</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={reasonStyles.cancelBtn}
            onPress={handleCancel}
          >
            <Text style={reasonStyles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const reasonStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e5e7eb",
  },
  title: { fontSize: 18, fontWeight: "700", color: "#111827" },
  closeBtn: { fontSize: 18, color: "#6b7280" },
  body: { padding: 20, gap: 12 },
  label: { fontSize: 14, fontWeight: "600", color: "#374151" },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#d1d5db",
    padding: 12,
    fontSize: 14,
    color: "#111827",
    minHeight: 100,
    backgroundColor: "#f9fafb",
  },
  confirmBtn: {
    backgroundColor: "#2563EB",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  confirmBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  cancelBtn: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  cancelBtnText: { color: "#6b7280", fontWeight: "600", fontSize: 15 },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function AdminUsersScreen() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [hasMore, setHasMore] = useState(false);

  // Use a ref for the cursor to avoid it appearing in useCallback deps (FIX-10)
  const cursorRef = useRef<string | null>(null);

  // Reason modal state
  const [reasonModal, setReasonModal] = useState<{
    visible: boolean;
    title: string;
    onConfirm: (reason: string) => void;
  }>({ visible: false, title: "", onConfirm: () => {} });

  const loadUsers = useCallback(async (reset = false) => {
    const params = new URLSearchParams({ limit: "30" });
    if (search) params.set("search", search);
    if (!reset && cursorRef.current) params.set("cursor", cursorRef.current);

    try {
      const { data } = await apiClient.get(`/admin/users?${params}`);
      const rows: User[] = data.data?.users ?? [];
      setUsers(reset ? rows : (prev) => [...prev, ...rows]);
      cursorRef.current = data.data?.nextCursor ?? null;
      setHasMore(Boolean(data.data?.nextCursor));
    } catch (err) {
      // BUG-020 FIX: surface load failures so admins see an error rather than blank.
      console.error('[admin] Failed to load users:', err);
      Alert.alert(t('common.error'), t('admin.usersLoadError', 'Failed to load users. Pull down to retry.'));
    }
    setLoading(false);
    setRefreshing(false);
  }, [search, t]); // cursor intentionally omitted — use cursorRef instead (FIX-10)

  useEffect(() => { void loadUsers(true); }, [loadUsers]);

  function promptReason(title: string, onConfirm: (reason: string) => void) {
    setReasonModal({ visible: true, title, onConfirm });
  }

  function closeReasonModal() {
    setReasonModal((prev) => ({ ...prev, visible: false }));
  }

  async function executeAction(
    userId: string,
    username: string,
    action: UserAction,
    reason?: string,
    durationHours?: number,
  ) {
    try {
      await performUserAction(userId, action, reason, durationHours);
      // Refresh the list to reflect updated state
      cursorRef.current = null;
      void loadUsers(true);
      Alert.alert("Done", `Action "${action}" applied to @${username}.`);
    } catch (e) {
      const err = e as Error & { code?: string | null };
      Alert.alert("Error", translateApiError(t, err.code, e instanceof Error ? e.message : "Action failed. Please try again."));
    }
  }

  function showActionMenu(user: User) {
    Alert.alert(
      `@${user.username}`,
      "Choose an action",
      [
        {
          text: "Suspend (7 days)",
          onPress: () =>
            promptReason("Suspend @" + user.username, (reason) => {
              closeReasonModal();
              void executeAction(user.id, user.username, "suspend", reason, 168);
            }),
        },
        {
          text: "Permanent Ban",
          style: "destructive",
          onPress: () =>
            promptReason("Ban @" + user.username, (reason) => {
              closeReasonModal();
              void executeAction(user.id, user.username, "ban", reason);
            }),
        },
        {
          text: "Restore Account",
          onPress: () =>
            Alert.alert(
              "Restore Account",
              `Remove all suspensions/bans from @${user.username}?`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Restore",
                  onPress: () => void executeAction(user.id, user.username, "restore"),
                },
              ],
            ),
        },
        {
          text: "Make Moderator",
          onPress: () =>
            Alert.alert(
              "Make Moderator",
              `Grant moderator role to @${user.username}?`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Confirm",
                  onPress: () => void executeAction(user.id, user.username, "upgrade_moderator"),
                },
              ],
            ),
        },
        { text: "Cancel", style: "cancel" },
      ],
    );
  }

  return (
    <View className="flex-1 bg-gray-50">
      <View className="px-4 pt-4 pb-2">
        <TextInput
          className="bg-white border border-gray-200 rounded-xl px-4 py-2 text-gray-800"
          placeholder="Search users..."
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
      </View>

      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); cursorRef.current = null; void loadUsers(true); }} />}
        onEndReached={() => { if (hasMore) void loadUsers(); }}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          loading
            ? <View className="items-center py-8"><ActivityIndicator color="#2563EB" /></View>
            : <View className="items-center py-8"><Text className="text-gray-400">No users found</Text></View>
        }
        renderItem={({ item }) => (
          <View className="flex-row items-center bg-white mx-3 mb-2 px-4 py-3 rounded-xl shadow-sm">
            <Text className="text-2xl mr-3">{item.avatar_emoji}</Text>
            <View className="flex-1">
              <Text className="font-semibold text-gray-900">@{item.username}</Text>
              <Text className="text-gray-500 text-xs">{item.rank} • {item.plan} • Trust: {item.trust_score}</Text>
            </View>
            <TouchableOpacity
              onPress={() => showActionMenu(item)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel={`Actions for @${item.username}`}
              accessibilityRole="button"
              className="w-8 h-8 items-center justify-center rounded-lg bg-gray-100"
            >
              <Text className="text-gray-500 text-lg font-bold">⋮</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <ReasonModal
        visible={reasonModal.visible}
        title={reasonModal.title}
        onConfirm={reasonModal.onConfirm}
        onCancel={closeReasonModal}
      />
    </View>
  );
}
