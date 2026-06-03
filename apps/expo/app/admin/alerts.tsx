import React, { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface Alert {
  id: string;
  alert_type: string;
  severity: "info" | "warning" | "error";
  message: string;
  resolved: boolean;
  created_at: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: "bg-blue-50 border-blue-200",
  warning: "bg-amber-50 border-amber-200",
  error: "bg-red-50 border-red-200",
};

const SEVERITY_TEXT: Record<string, string> = {
  info: "text-blue-700",
  warning: "text-amber-700",
  error: "text-red-700",
};

export default function AdminAlertsScreen() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadAlerts() {
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/alerts?resolved=false&limit=40`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => null);
    if (!res?.ok) return;
    setAlerts((await res.json()).data?.alerts ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  async function resolveAlert(alertId: string) {
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/alerts/${alertId}/resolve`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) setAlerts((prev) => prev.filter((a) => a.id !== alertId));
  }

  useEffect(() => { void loadAlerts(); }, []);

  if (loading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>;

  return (
    <FlatList
      data={alerts}
      keyExtractor={(a) => a.id}
      className="bg-gray-50 flex-1"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadAlerts(); }} />}
      contentContainerClassName="px-4 pt-4"
      ListEmptyComponent={<View className="items-center py-8"><Text className="text-gray-400">No active alerts</Text></View>}
      renderItem={({ item }) => (
        <View className={`border rounded-xl p-4 mb-3 ${SEVERITY_COLORS[item.severity] ?? "bg-gray-50 border-gray-200"}`}>
          <View className="flex-row items-center justify-between mb-1">
            <Text className={`font-semibold text-sm uppercase ${SEVERITY_TEXT[item.severity] ?? "text-gray-700"}`}>
              {item.severity} · {item.alert_type}
            </Text>
            <Text className="text-xs text-gray-400">
              {new Date(item.created_at).toLocaleDateString()}
            </Text>
          </View>
          <Text className="text-gray-700 text-sm mb-3">{item.message}</Text>
          <TouchableOpacity
            className="bg-white border border-gray-200 rounded-lg py-2 items-center"
            onPress={() => void resolveAlert(item.id)}
          >
            <Text className="text-gray-600 font-medium text-sm">Mark Resolved</Text>
          </TouchableOpacity>
        </View>
      )}
    />
  );
}
