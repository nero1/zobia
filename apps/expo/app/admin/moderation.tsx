import React, { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

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

export default function AdminModerationScreen() {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadReports() {
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/moderation?status=pending&limit=30`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setReports(data.data?.reports ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void loadReports(); }, []);

  async function handleAction(reportId: string, action: "warn" | "suspend" | "dismiss") {
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/moderation/${reportId}/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action }),
    });
    if (res.ok) {
      setReports((prev) => prev.filter((r) => r.id !== reportId));
    } else {
      Alert.alert("Error", "Action failed. Please try again.");
    }
  }

  if (loading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>;

  return (
    <FlatList
      data={reports}
      keyExtractor={(r) => r.id}
      className="bg-gray-50"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadReports(); }} />}
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
