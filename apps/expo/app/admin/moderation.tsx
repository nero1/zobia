import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl
} from "react-native";
import { useTranslation } from "react-i18next";
import { apiClient } from "@/lib/api/client";
import { translateApiError } from "@/lib/i18n/apiErrors";

interface Report {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  reported_username: string;
  content_excerpt: string;
  category: string;
  ai_confidence: number;
  status: string;
  created_at: string;
}

const LIMIT = 30;

export default function AdminModerationScreen() {
  const { t } = useTranslation();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const cursorRef = useRef<string | null>(null);

  const loadReports = useCallback(async (reset = false) => {
    const params = new URLSearchParams({ status: 'pending', limit: String(LIMIT) });
    if (!reset && cursorRef.current) params.set('cursor', cursorRef.current);

    try {
      const { data } = await apiClient.get(`/admin/moderation?${params}`);
      const rows: Report[] = data.data?.reports ?? [];
      setReports(reset ? rows : (prev) => [...prev, ...rows]);
      cursorRef.current = data.data?.nextCursor ?? null;
      setHasMore(Boolean(data.data?.nextCursor));
    } catch (err) {
      // BUG-021/BUG-018 FIX: surface load failures instead of silently failing.
      console.error('[admin] Failed to load moderation reports:', err);
    }
    setLoading(false);
    setRefreshing(false);
    setLoadingMore(false);
  }, []);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    void loadReports(false);
  }, [loadingMore, hasMore, loadReports]);

  useEffect(() => { void loadReports(true); }, [loadReports]);

  async function handleAction(reportId: string, action: "warn" | "suspend" | "dismiss") {
    try {
      await apiClient.post(`/admin/moderation/${reportId}/action`, { action });
      setReports((prev) => prev.filter((r) => r.id !== reportId));
    } catch (err: unknown) {
      // BUG-022 FIX: use translateApiError so backend reason codes are surfaced.
      const apiErr = err as { response?: { data?: { error?: { code?: string; message?: string } } } };
      const code = apiErr?.response?.data?.error?.code;
      const msg = apiErr?.response?.data?.error?.message;
      Alert.alert(t('common.error'), translateApiError(t, code, msg ?? t('admin.actionFailed', 'Action failed. Please try again.')));
    }
  }

  if (loading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>;

  return (
    <FlatList
      data={reports}
      keyExtractor={(r) => r.id}
      className="bg-gray-50"
      onEndReached={loadMore}
      onEndReachedThreshold={0.3}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); cursorRef.current = null; void loadReports(true); }} />}
      ListEmptyComponent={<View className="items-center py-8"><Text className="text-gray-400">No pending reports</Text></View>}
      renderItem={({ item }) => (
        <View className="bg-white mx-3 my-2 rounded-xl p-4 shadow-sm">
          <View className="flex-row items-center justify-between mb-1">
            <Text className="font-semibold text-gray-900">@{item.reported_username}</Text>
            <Text className="text-xs text-gray-400">{item.category} • {Math.round(item.ai_confidence * 100)}% confident</Text>
          </View>
          <Text className="text-gray-600 text-sm mb-3" numberOfLines={2}>{item.content_excerpt}</Text>
          <View className="flex-row gap-2">
            <TouchableOpacity
              className="flex-1 bg-amber-100 rounded-lg py-2 items-center"
              onPress={() => void handleAction(item.id, "warn")}
            >
              <Text className="text-amber-700 font-medium text-sm">⚠️ Warn</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 bg-red-100 rounded-lg py-2 items-center"
              onPress={() => Alert.alert("Suspend user?", "This will suspend the user.", [
                { text: "Cancel" },
                { text: "Suspend", style: "destructive", onPress: () => void handleAction(item.id, "suspend") },
              ])}
            >
              <Text className="text-red-700 font-medium text-sm">🚫 Suspend</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 bg-gray-100 rounded-lg py-2 items-center"
              onPress={() => void handleAction(item.id, "dismiss")}
            >
              <Text className="text-gray-600 font-medium text-sm">✕ Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    />
  );
}
