import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface Payout {
  id: string;
  creator: {
    id: string;
    username: string;
    email: string | null;
  };
  grossKobo: number;
  netKobo: number;
  platformFeeKobo: number;
  status: string;
  bankAccountLast4: string | null;
  createdAt: string;
}

function koboToNaira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export default function AdminPayoutsScreen() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [actingId, setActingId] = useState<string | null>(null);

  const LIMIT = 30;

  async function loadPayouts(newOffset: number, replace: boolean) {
    const token = storage.getString("authToken");
    const res = await fetch(
      `${API_BASE}/api/admin/payouts?status=awaiting_approval&limit=${LIMIT}&offset=${newOffset}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    ).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      const fetched: Payout[] = data.payouts ?? [];
      setPayouts((prev) => replace ? fetched : [...prev, ...fetched]);
      setTotal(data.total ?? 0);
      setOffset(newOffset + fetched.length);
    }
    setLoading(false);
    setRefreshing(false);
    setLoadingMore(false);
  }

  useEffect(() => { void loadPayouts(0, true); }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadPayouts(0, true);
  }, []);

  const loadMore = useCallback(() => {
    if (loadingMore || offset >= total) return;
    setLoadingMore(true);
    void loadPayouts(offset, false);
  }, [loadingMore, offset, total]);

  async function handleAction(payout: Payout, action: "approve" | "reject") {
    setActingId(payout.id);
    const token = storage.getString("authToken");
    const res = await fetch(
      `${API_BASE}/api/admin/payouts/${payout.id}/${action}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: action === "reject" ? JSON.stringify({ reason: "Rejected by admin" }) : undefined,
      }
    ).catch(() => null);
    if (res?.ok) {
      setPayouts((prev) => prev.filter((p) => p.id !== payout.id));
      setTotal((t) => Math.max(0, t - 1));
    } else {
      const err = await res?.json().catch(() => null);
      Alert.alert("Error", err?.error?.message ?? `Failed to ${action} payout.`);
    }
    setActingId(null);
  }

  function confirmAction(payout: Payout, action: "approve" | "reject") {
    const label = action === "approve" ? "Approve" : "Reject";
    const amount = koboToNaira(payout.netKobo);
    Alert.alert(
      `${label} payout?`,
      `${label} ${amount} payout for @${payout.creator.username}?${
        payout.bankAccountLast4 ? `\nBank ending in ${payout.bankAccountLast4}` : ""
      }`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: label,
          style: action === "reject" ? "destructive" : "default",
          onPress: () => void handleAction(payout, action),
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
      data={payouts}
      keyExtractor={(p) => p.id}
      className="bg-gray-50"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      onEndReached={loadMore}
      onEndReachedThreshold={0.3}
      ListHeaderComponent={
        <View className="mx-3 mt-4 mb-2 bg-white rounded-xl px-4 py-3 shadow-sm flex-row items-center justify-between">
          <Text className="text-gray-700 font-semibold">Awaiting Approval</Text>
          <Text className="text-blue-600 font-bold">{total}</Text>
        </View>
      }
      ListEmptyComponent={
        <View className="items-center py-8">
          <Text className="text-gray-400">No pending payouts</Text>
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
            <View className="flex-row items-start justify-between mb-1">
              <View className="flex-1 mr-2">
                <Text className="font-semibold text-gray-900">@{item.creator.username}</Text>
                {item.creator.email && (
                  <Text className="text-gray-500 text-xs">{item.creator.email}</Text>
                )}
              </View>
              <View className="items-end">
                <Text className="font-bold text-gray-900">{koboToNaira(item.netKobo)}</Text>
                <Text className="text-xs text-gray-400">gross {koboToNaira(item.grossKobo)}</Text>
              </View>
            </View>
            <View className="flex-row gap-x-4 mb-3">
              {item.bankAccountLast4 && (
                <Text className="text-xs text-gray-500">
                  Bank: <Text className="font-medium text-gray-700">••••{item.bankAccountLast4}</Text>
                </Text>
              )}
              <Text className="text-xs text-gray-500">
                Fee: <Text className="font-medium text-gray-700">{koboToNaira(item.platformFeeKobo)}</Text>
              </Text>
              <Text className="text-xs text-gray-400">{formatDate(item.createdAt)}</Text>
            </View>
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
