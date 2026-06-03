import React, { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface SponsoredQuest {
  id: string;
  brand_name: string;
  title: string;
  description: string;
  target_action: string;
  target_value: number;
  reward_coins: number;
  creator_payout_kobo: number;
  min_creator_tier: string;
  ends_at: string | null;
  applied?: boolean;
}

function koboToNaira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 0 })}`;
}

export default function CreatorMarketplaceScreen() {
  const [quests, setQuests] = useState<SponsoredQuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadQuests() {
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/quests/sponsored`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => null);
    if (!res?.ok) return;
    setQuests((await res.json()).data?.quests ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  async function applyForQuest(questId: string) {
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/quests/sponsored/${questId}/apply`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.ok) {
      setQuests((prev) => prev.map((q) => q.id === questId ? { ...q, applied: true } : q));
      Alert.alert("Applied!", "Your application has been submitted for review.");
    } else {
      const err = await res.json();
      Alert.alert("Error", err.error?.message ?? "Application failed.");
    }
  }

  useEffect(() => { void loadQuests(); }, []);

  if (loading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>;

  return (
    <FlatList
      data={quests}
      keyExtractor={(q) => q.id}
      className="flex-1 bg-gray-50"
      contentContainerClassName="p-4"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadQuests(); }} />}
      ListHeaderComponent={
        <View className="mb-4">
          <Text className="text-xl font-bold text-gray-900">Sponsored Quests</Text>
          <Text className="text-gray-500 text-sm mt-1">Partner with brands and earn creator payouts</Text>
        </View>
      }
      ListEmptyComponent={
        <View className="items-center py-10">
          <Text className="text-4xl mb-3">🛒</Text>
          <Text className="text-gray-500">No sponsored quests available</Text>
        </View>
      }
      renderItem={({ item }) => (
        <View className="bg-white rounded-xl p-4 mb-3 shadow-sm">
          <View className="flex-row items-start justify-between mb-2">
            <View className="flex-1">
              <Text className="text-xs text-blue-600 font-medium uppercase mb-1">{item.brand_name}</Text>
              <Text className="font-bold text-gray-900 text-base">{item.title}</Text>
            </View>
            <View className="items-end ml-3">
              <Text className="text-xs text-gray-400">Payout</Text>
              <Text className="font-bold text-emerald-600">{koboToNaira(item.creator_payout_kobo)}</Text>
            </View>
          </View>
          <Text className="text-gray-600 text-sm mb-3">{item.description}</Text>
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-xs text-gray-400">
                {item.target_action} · {item.target_value} target · {item.reward_coins} 🪙 for followers
              </Text>
              <Text className="text-xs text-gray-400 mt-0.5">Min tier: {item.min_creator_tier}</Text>
            </View>
            <TouchableOpacity
              className={`px-4 py-2 rounded-lg ${item.applied ? "bg-gray-100" : "bg-blue-600"}`}
              onPress={() => !item.applied && Alert.alert("Apply?", `Apply for "${item.title}" by ${item.brand_name}?`, [
                { text: "Cancel" },
                { text: "Apply", onPress: () => void applyForQuest(item.id) },
              ])}
              disabled={item.applied}
            >
              <Text className={`text-sm font-medium ${item.applied ? "text-gray-400" : "text-white"}`}>
                {item.applied ? "Applied" : "Apply"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    />
  );
}
