import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, FlatList,
  ActivityIndicator, RefreshControl
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface ActionLogItem {
  id: string;
  action_type: string;
  user_id: string | null;
  username: string | null;
  display_name: string | null;
  description: string | null;
  source_table: string;
  created_at: string;
  reversed_at: string | null;
  reversed_by: string | null;
  reversal_note: string | null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function AdminActionsLogScreen() {
  const [items, setItems] = useState<ActionLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  async function loadItems(cursor: string | null = null, replace = true) {
    const token = storage.getString("authToken");
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    const url = `${API_BASE}/api/admin/actions-log?limit=30${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await fetch(url, { headers }).catch(() => null);
    if (!res?.ok) {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      return;
    }
    const data = await res.json();
    const newItems: ActionLogItem[] = data.data?.items ?? [];
    setItems((prev) => replace ? newItems : [...prev, ...newItems]);
    setNextCursor(data.data?.nextCursor ?? null);
    setHasMore(data.data?.hasMore ?? false);
    setLoading(false);
    setRefreshing(false);
    setLoadingMore(false);
  }

  useEffect(() => { void loadItems(); }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadItems(null, true);
  }, []);

  function loadMore() {
    if (!hasMore || loadingMore || !nextCursor) return;
    setLoadingMore(true);
    void loadItems(nextCursor, false);
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
      data={items}
      keyExtractor={(item) => item.id}
      className="bg-gray-50"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      onEndReached={loadMore}
      onEndReachedThreshold={0.3}
      ListEmptyComponent={
        <View className="items-center py-8">
          <Text className="text-gray-400">No action logs found</Text>
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
              <View className="bg-amber-100 px-2 py-0.5 rounded-full">
                <Text className="text-amber-700 text-xs font-medium">Active</Text>
              </View>
            )}
          </View>
          {item.username ? (
            <Text className="text-gray-600 text-sm">Target: @{item.username}</Text>
          ) : null}
          {item.description ? (
            <Text className="text-gray-500 text-xs mt-1" numberOfLines={2}>{item.description}</Text>
          ) : null}
          <View className="flex-row justify-between mt-2">
            <Text className="text-gray-400 text-xs">{item.source_table}</Text>
            <Text className="text-gray-400 text-xs">{formatDate(item.created_at)}</Text>
          </View>
        </View>
      )}
    />
  );
}
