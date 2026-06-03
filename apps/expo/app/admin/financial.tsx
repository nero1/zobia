import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface FinancialStats {
  totalRevenueKobo: number;
  pendingPayoutsKobo: number;
  pendingPayoutCount: number;
  coinsInCirculation: number;
}

interface PayoutRequest {
  id: string;
  creator_id: string;
  creator_username: string;
  amount_kobo: number;
  status: string;
  created_at: string;
}

function koboToNaira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

export default function AdminFinancialScreen() {
  const [stats, setStats] = useState<FinancialStats | null>(null);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadData() {
    const token = storage.getString("authToken");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const [statsRes, payoutsRes] = await Promise.all([
      fetch(`${API_BASE}/api/admin/financial`, { headers }),
      fetch(`${API_BASE}/api/admin/payouts?status=pending&limit=20`, { headers }),
    ]);
    if (statsRes.ok) setStats((await statsRes.json()).data?.stats ?? null);
    if (payoutsRes.ok) setPayouts((await payoutsRes.json()).data?.payouts ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void loadData(); }, []);

  async function approvePayout(payoutId: string) {
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/payouts/${payoutId}/approve`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) setPayouts((prev) => prev.filter((p) => p.id !== payoutId));
    else Alert.alert("Error", "Approval failed.");
  }

  if (loading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>;

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadData(); }} />}
    >
      {stats && (
        <View className="mx-4 mt-4 bg-white rounded-xl p-4 shadow-sm mb-4">
          <Text className="text-base font-bold text-gray-900 mb-3">Platform Revenue</Text>
          {[
            { label: "Total Revenue", value: koboToNaira(stats.totalRevenueKobo) },
            { label: "Pending Payouts", value: koboToNaira(stats.pendingPayoutsKobo) },
            { label: "Pending Requests", value: String(stats.pendingPayoutCount) },
            { label: "Coins in Circulation", value: stats.coinsInCirculation.toLocaleString() },
          ].map((row) => (
            <View key={row.label} className="flex-row justify-between py-1">
              <Text className="text-gray-600">{row.label}</Text>
              <Text className="font-semibold text-gray-900">{row.value}</Text>
            </View>
          ))}
        </View>
      )}

      <Text className="px-4 font-semibold text-gray-700 mb-2">Pending Payouts ({payouts.length})</Text>
      {payouts.map((p) => (
        <View key={p.id} className="bg-white mx-4 mb-2 rounded-xl p-4 shadow-sm flex-row items-center">
          <View className="flex-1">
            <Text className="font-medium text-gray-900">@{p.creator_username}</Text>
            <Text className="text-gray-500 text-sm">{koboToNaira(p.amount_kobo)}</Text>
          </View>
          <TouchableOpacity
            className="bg-emerald-600 px-4 py-2 rounded-lg"
            onPress={() => Alert.alert("Approve payout?", `Pay ${koboToNaira(p.amount_kobo)} to @${p.creator_username}?`, [
              { text: "Cancel" },
              { text: "Approve", onPress: () => void approvePayout(p.id) },
            ])}
          >
            <Text className="text-white font-medium text-sm">Approve</Text>
          </TouchableOpacity>
        </View>
      ))}
      {payouts.length === 0 && <Text className="text-center text-gray-400 py-4">No pending payouts</Text>}
    </ScrollView>
  );
}
