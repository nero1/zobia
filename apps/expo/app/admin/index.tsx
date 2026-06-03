import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl
} from "react-native";
import { useRouter } from "expo-router";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface AdminStats {
  totalUsers: number;
  activeRooms: number;
  dailyLogins: number;
  pendingReports: number;
  pendingPayouts: number;
  coinsInCirculation: number;
}

function StatCard({
  title, value, route, color
}: {
  title: string; value: number | string; route: string; color: string;
}) {
  const router = useRouter();
  return (
    <TouchableOpacity
      className={`flex-1 m-2 p-4 rounded-xl ${color}`}
      onPress={() => router.push(route as any)}
    >
      <Text className="text-white text-2xl font-bold">{value}</Text>
      <Text className="text-white/80 text-sm mt-1">{title}</Text>
    </TouchableOpacity>
  );
}

export default function AdminOverviewScreen() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadStats() {
    try {
      const token = storage.getString("authToken");
      const res = await fetch(`${API_BASE}/api/admin/overview`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setStats(data.data?.stats ?? null);
    } catch { /* ignore */ }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void loadStats(); }, []);

  if (loading) return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator size="large" color="#2563EB" />
    </View>
  );

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadStats(); }} />}
    >
      <View className="px-4 pt-6 pb-2">
        <Text className="text-2xl font-bold text-gray-900">Admin Dashboard</Text>
        <Text className="text-gray-500 text-sm mt-1">Platform overview</Text>
      </View>

      <View className="flex-row flex-wrap px-2">
        <StatCard title="Total Users" value={stats?.totalUsers ?? 0} route="/admin/users" color="bg-blue-600" />
        <StatCard title="Active Rooms" value={stats?.activeRooms ?? 0} route="/rooms" color="bg-emerald-600" />
        <StatCard title="Daily Logins" value={stats?.dailyLogins ?? 0} route="/admin/users" color="bg-violet-600" />
        <StatCard title="Pending Reports" value={stats?.pendingReports ?? 0} route="/admin/moderation" color="bg-red-500" />
        <StatCard title="Pending Payouts" value={stats?.pendingPayouts ?? 0} route="/admin/financial" color="bg-amber-500" />
        <StatCard title="Coins in Circulation" value={(stats?.coinsInCirculation ?? 0).toLocaleString()} route="/admin/financial" color="bg-teal-600" />
      </View>

      <View className="mx-4 mt-4">
        <Text className="text-gray-700 font-semibold text-base mb-3">Quick Actions</Text>
        {[
          { label: "Moderation Queue", route: "/admin/moderation", icon: "🛡️" },
          { label: "Financial Overview", route: "/admin/financial", icon: "💰" },
          { label: "System Alerts", route: "/admin/alerts", icon: "🔔" },
          { label: "Compose Message", route: "/admin/messages", icon: "✉️" },
        ].map((action) => (
          <TouchableOpacity
            key={action.route}
            className="flex-row items-center bg-white rounded-xl px-4 py-3 mb-2 shadow-sm"
            onPress={() => useRouter().push(action.route as any)}
          >
            <Text className="text-xl mr-3">{action.icon}</Text>
            <Text className="text-gray-800 font-medium">{action.label}</Text>
            <Text className="ml-auto text-gray-400">›</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}
