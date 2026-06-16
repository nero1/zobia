import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl
} from "react-native";
import { useTranslation } from "react-i18next";
import { storage } from "@/lib/offline/store";
import { translateApiError } from "@/lib/i18n/apiErrors";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface CommunityNote {
  id: string;
  author_id: string;
  author_username: string | null;
  target_id: string;
  target_type: string;
  content: string;
  status: string;
  reviewed_by: string | null;
  reviewer_username: string | null;
  admin_comment: string | null;
  created_at: string;
  reviewed_at: string | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function AdminCommunityNotesScreen() {
  const { t } = useTranslation();
  const [notes, setNotes] = useState<CommunityNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);

  const LIMIT = 30;

  async function loadNotes(newOffset: number, replace: boolean) {
    const token = storage.getString("authToken");
    const res = await fetch(
      `${API_BASE}/api/admin/community-notes?status=pending&limit=${LIMIT}&offset=${newOffset}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    ).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      const fetched: CommunityNote[] = data.data?.notes ?? [];
      setNotes((prev) => replace ? fetched : [...prev, ...fetched]);
      setTotal(data.data?.total ?? 0);
      setOffset(newOffset + fetched.length);
    }
    setLoading(false);
    setRefreshing(false);
    setLoadingMore(false);
  }

  useEffect(() => { void loadNotes(0, true); }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadNotes(0, true);
  }, []);

  const loadMore = useCallback(() => {
    if (loadingMore || offset >= total) return;
    setLoadingMore(true);
    void loadNotes(offset, false);
  }, [loadingMore, offset, total]);

  async function handleAction(note: CommunityNote, action: "approve" | "reject") {
    setActingId(note.id);
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/community-notes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ noteId: note.id, action }),
    }).catch(() => null);
    if (res?.ok) {
      setNotes((prev) => prev.filter((n) => n.id !== note.id));
      setTotal((t) => Math.max(0, t - 1));
    } else {
      const err = await res?.json().catch(() => null);
      Alert.alert("Error", translateApiError(t, err?.error?.code, err?.error?.message ?? `Failed to ${action} note.`));
    }
    setActingId(null);
  }

  function confirmAction(note: CommunityNote, action: "approve" | "reject") {
    const label = action === "approve" ? "Approve" : "Reject";
    Alert.alert(
      `${label} note?`,
      `${label} this community note from @${note.author_username ?? note.author_id.slice(0, 8)}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: label,
          style: action === "reject" ? "destructive" : "default",
          onPress: () => void handleAction(note, action),
        },
      ]
    );
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color="#2563EB" />
      </View>
    );
  }

  return (
    <FlatList
      data={notes}
      keyExtractor={(n) => n.id}
      className="bg-gray-50"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      onEndReached={loadMore}
      onEndReachedThreshold={0.3}
      ListHeaderComponent={
        <View className="mx-3 mt-4 mb-2 bg-white rounded-xl px-4 py-3 shadow-sm flex-row items-center justify-between">
          <Text className="text-gray-700 font-semibold">Pending Notes</Text>
          <Text className="text-blue-600 font-bold">{total}</Text>
        </View>
      }
      ListEmptyComponent={
        <View className="items-center py-8">
          <Text className="text-gray-400">No pending community notes</Text>
        </View>
      }
      ListFooterComponent={
        loadingMore ? (
          <View className="py-4 items-center">
            <ActivityIndicator color="#2563EB" />
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        const isActing = actingId === item.id;
        return (
          <View className="bg-white mx-3 my-2 rounded-xl p-4 shadow-sm">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="font-semibold text-gray-900">
                @{item.author_username ?? item.author_id.slice(0, 8)}
              </Text>
              <Text className="text-xs text-gray-400">{formatDate(item.created_at)}</Text>
            </View>
            <View className="flex-row mb-2">
              <Text className="text-xs text-gray-500">
                Target: <Text className="font-medium text-gray-700">{item.target_type}</Text>
                {" "}#{item.target_id.slice(0, 8)}
              </Text>
            </View>
            <Text className="text-gray-700 text-sm mb-3" numberOfLines={4}>{item.content}</Text>
            {isActing ? (
              <View className="items-center py-2">
                <ActivityIndicator color="#2563EB" />
              </View>
            ) : (
              <View className="flex-row gap-2">
                <TouchableOpacity
                  className="flex-1 bg-red-100 rounded-lg py-2 items-center"
                  onPress={() => confirmAction(item, "reject")}
                >
                  <Text className="text-red-700 font-medium text-sm">Reject</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-emerald-600 rounded-lg py-2 items-center"
                  onPress={() => confirmAction(item, "approve")}
                >
                  <Text className="text-white font-medium text-sm">Approve</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        );
      }}
    />
  );
}
