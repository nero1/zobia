import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl, TextInput, Modal
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface AutomatedAction {
  id: string;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  target_user_id: string | null;
  metadata: Record<string, unknown> | null;
  reversed_at: string | null;
  reversed_by: string | null;
  reverse_note: string | null;
  created_at: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function AdminAutomatedActionsScreen() {
  const [actions, setActions] = useState<AutomatedAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Reverse modal state
  const [reverseTarget, setReverseTarget] = useState<AutomatedAction | null>(null);
  const [reverseNote, setReverseNote] = useState("");
  const [reversing, setReversing] = useState(false);

  async function loadActions(cursor: string | null = null, replace = true) {
    const token = storage.getString("authToken");
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const url = `${API_BASE}/api/admin/automated-actions?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await fetch(url, { headers }).catch(() => null);
    if (!res?.ok) {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      return;
    }
    const data = await res.json();
    const newItems: AutomatedAction[] = data.items ?? [];
    setActions((prev) => replace ? newItems : [...prev, ...newItems]);
    setNextCursor(data.next_cursor ?? null);
    setHasMore(data.has_more ?? false);
    setLoading(false);
    setRefreshing(false);
    setLoadingMore(false);
  }

  useEffect(() => { void loadActions(); }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadActions(null, true);
  }, []);

  function loadMore() {
    if (!hasMore || loadingMore || !nextCursor) return;
    setLoadingMore(true);
    void loadActions(nextCursor, false);
  }

  async function handleReverse() {
    if (!reverseTarget) return;
    if (!reverseNote.trim()) {
      Alert.alert("Note required", "Please enter a note for the reversal.");
      return;
    }
    setReversing(true);
    const token = storage.getString("authToken");
    const res = await fetch(
      `${API_BASE}/api/admin/automated-actions/${reverseTarget.id}/reverse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ note: reverseNote.trim() }),
      }
    ).catch(() => null);
    setReversing(false);
    if (res?.ok) {
      setActions((prev) =>
        prev.map((a) =>
          a.id === reverseTarget.id
            ? { ...a, reversed_at: new Date().toISOString() }
            : a
        )
      );
      setReverseTarget(null);
      setReverseNote("");
    } else {
      Alert.alert("Error", "Reversal failed. Please try again.");
    }
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color="#2563EB" />
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={actions}
        keyExtractor={(a) => a.id}
        className="bg-gray-50"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          <View className="items-center py-8">
            <Text className="text-gray-400">No automated actions found</Text>
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View className="py-4 items-center">
              <ActivityIndicator color="#2563EB" />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View className="bg-white mx-3 my-2 rounded-xl p-4 shadow-sm">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="font-semibold text-gray-900 text-sm">{item.action_type}</Text>
              {item.reversed_at ? (
                <View className="bg-emerald-100 px-2 py-0.5 rounded-full">
                  <Text className="text-emerald-700 text-xs font-medium">Reversed</Text>
                </View>
              ) : (
                <View className="bg-red-100 px-2 py-0.5 rounded-full">
                  <Text className="text-red-700 text-xs font-medium">Active</Text>
                </View>
              )}
            </View>
            {item.target_type ? (
              <Text className="text-gray-600 text-sm">
                Target: {item.target_type}
                {item.target_user_id ? ` (user)` : ""}
              </Text>
            ) : null}
            <Text className="text-gray-400 text-xs mt-1">{formatDate(item.created_at)}</Text>
            {!item.reversed_at && (
              <TouchableOpacity
                className="mt-3 bg-amber-100 rounded-lg py-2 items-center"
                onPress={() => {
                  setReverseTarget(item);
                  setReverseNote("");
                }}
              >
                <Text className="text-amber-700 font-medium text-sm">Reverse Action</Text>
              </TouchableOpacity>
            )}
            {item.reversed_at && item.reverse_note ? (
              <Text className="text-gray-400 text-xs mt-2 italic">Note: {item.reverse_note}</Text>
            ) : null}
          </View>
        )}
      />

      <Modal
        visible={reverseTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setReverseTarget(null)}
      >
        <View className="flex-1 bg-black/50 items-center justify-center px-6">
          <View className="bg-white rounded-2xl p-6 w-full">
            <Text className="text-lg font-bold text-gray-900 mb-1">Reverse Action</Text>
            <Text className="text-gray-500 text-sm mb-4">
              {reverseTarget?.action_type} — this cannot be undone.
            </Text>
            <Text className="text-gray-700 font-medium mb-1 text-sm">Reversal note *</Text>
            <TextInput
              className="border border-gray-300 rounded-lg px-3 py-2 text-gray-900 mb-4"
              placeholder="Explain why you are reversing this action"
              value={reverseNote}
              onChangeText={setReverseNote}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 border border-gray-300 rounded-lg py-3 items-center"
                onPress={() => setReverseTarget(null)}
                disabled={reversing}
              >
                <Text className="text-gray-700 font-medium">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-amber-500 rounded-lg py-3 items-center"
                onPress={() => void handleReverse()}
                disabled={reversing}
              >
                {reversing ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white font-medium">Reverse</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
