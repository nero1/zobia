import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl
} from "react-native";
import { apiClient } from "@/lib/api/client";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { koboToNairaStr } from "@/lib/utils/currency";

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
  return koboToNairaStr(kobo);
}

export default function AdminFinancialScreen() {
  const currency = useCurrency();
  const [stats, setStats] = useState<FinancialStats | null>(null);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // M-8 FIX: track load errors so the screen can show a retry button.
  const [loadError, setLoadError] = useState(false);

  async function loadData() {
    setLoadError(false);
    try {
      const [statsRes, payoutsRes] = await Promise.all([
        apiClient.get('/admin/financial'),
        apiClient.get('/admin/payouts?status=pending&limit=20'),
      ]);
      setStats(statsRes.data.data?.stats ?? null);
      setPayouts(payoutsRes.data.data?.payouts ?? []);
    } catch {
      setLoadError(true);
    }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void loadData(); }, []);

  async function approvePayout(payoutId: string) {
    try {
      await apiClient.post(`/admin/payouts/${payoutId}/approve`);
      setPayouts((prev) => prev.filter((p) => p.id !== payoutId));
    } catch {
      Alert.alert("Error", "Approval failed.");
    }
  }

  async function rejectPayout(payoutId: string) {
    try {
      await apiClient.post(`/admin/payouts/${payoutId}/reject`, { reason: "Rejected by admin" });
      setPayouts((prev) => prev.filter((p) => p.id !== payoutId));
    } catch {
      Alert.alert("Error", "Rejection failed.");
    }
  }

  if (loading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>;
  if (loadError) return (
    <View className="flex-1 items-center justify-center gap-3">
      <Text className="text-gray-500 text-sm">Failed to load financial data.</Text>
      <TouchableOpacity className="bg-blue-600 px-4 py-2 rounded-lg" onPress={() => { setLoading(true); void loadData(); }}>
        <Text className="text-white font-medium">Retry</Text>
      </TouchableOpacity>
    </View>
  );

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
            { label: `${currency.softPlural} in Circulation`, value: stats.coinsInCirculation.toLocaleString() },
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
          <View className="flex-row gap-2">
            <TouchableOpacity
              className="bg-red-600 px-4 py-2 rounded-lg"
              onPress={() => Alert.alert("Reject payout?", `Reject ${koboToNaira(p.amount_kobo)} for @${p.creator_username}?`, [
                { text: "Cancel", style: "cancel" },
                { text: "Reject", style: "destructive", onPress: () => void rejectPayout(p.id) },
              ])}
            >
              <Text className="text-white font-medium text-sm">Reject</Text>
            </TouchableOpacity>
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
        </View>
      ))}
      {payouts.length === 0 && <Text className="text-center text-gray-400 py-4">No pending payouts</Text>}
    </ScrollView>
  );
}
