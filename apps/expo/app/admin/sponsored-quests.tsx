import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, TextInput, Modal,
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface SponsoredQuest {
  id: string;
  title: string;
  description: string;
  brand_name: string;
  reward_coins: number;
  reward_xp: number;
  target_action: string;
  target_count: number;
  is_active: boolean;
  starts_at: string;
  ends_at: string;
  completions: number;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

export default function SponsoredQuestsAdminScreen() {
  const [quests, setQuests] = useState<SponsoredQuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [brandName, setBrandName] = useState("");
  const [rewardCoins, setRewardCoins] = useState("100");
  const [rewardXp, setRewardXp] = useState("50");
  const [targetAction, setTargetAction] = useState("send_message");
  const [targetCount, setTargetCount] = useState("10");
  const [endsAt, setEndsAt] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const token = storage.getString("authToken");
      const res = await fetch(`${API_BASE}/api/admin/sponsored-quests`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setQuests(data.data?.quests ?? []);
    } catch { /* ignore */ }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void load(); }, []);

  async function handleCreate() {
    if (!title.trim() || !brandName.trim()) {
      Alert.alert("Validation", "Title and brand name are required.");
      return;
    }
    setCreating(true);
    try {
      const token = storage.getString("authToken");
      const res = await fetch(`${API_BASE}/api/admin/sponsored-quests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          brand_name: brandName.trim(),
          reward_coins: parseInt(rewardCoins) || 100,
          reward_xp: parseInt(rewardXp) || 50,
          target_action: targetAction.trim() || "send_message",
          target_count: parseInt(targetCount) || 10,
          ends_at: endsAt || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreate(false);
        void load();
      } else {
        Alert.alert("Error", data.error?.message ?? "Failed to create quest");
      }
    } catch {
      Alert.alert("Error", "Network error");
    }
    setCreating(false);
  }

  async function handleToggle(quest: SponsoredQuest) {
    const token = storage.getString("authToken");
    await fetch(`${API_BASE}/api/admin/sponsored-quests/${quest.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ is_active: !quest.is_active }),
    }).catch(() => {});
    void load();
  }

  if (loading) return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator size="large" color="#D97706" />
    </View>
  );

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
    >
      <View className="px-4 pt-6 pb-2 flex-row items-center justify-between">
        <View>
          <Text className="text-2xl font-bold text-gray-900">🎯 Sponsored Quests</Text>
          <Text className="text-gray-500 text-sm mt-1">Brand-sponsored user challenges</Text>
        </View>
        <TouchableOpacity
          className="bg-amber-600 px-4 py-2 rounded-xl"
          onPress={() => setShowCreate(true)}
        >
          <Text className="text-white font-semibold">+ Create</Text>
        </TouchableOpacity>
      </View>

      {quests.length === 0 && (
        <View className="mx-4 mt-8 items-center">
          <Text className="text-gray-400 text-base">No sponsored quests yet.</Text>
        </View>
      )}

      {quests.map((quest) => (
        <View key={quest.id} className="mx-4 mb-3 bg-white rounded-xl p-4 shadow-sm">
          <View className="flex-row items-start justify-between">
            <View className="flex-1 mr-3">
              <Text className="font-bold text-gray-900 text-base">{quest.title}</Text>
              <Text className="text-amber-700 font-semibold text-sm mt-0.5">by {quest.brand_name}</Text>
              {quest.description ? (
                <Text className="text-gray-500 text-sm mt-0.5" numberOfLines={2}>{quest.description}</Text>
              ) : null}
            </View>
            <View className={`px-2 py-1 rounded-full ${quest.is_active ? "bg-green-100" : "bg-gray-100"}`}>
              <Text className={`text-xs font-semibold ${quest.is_active ? "text-green-700" : "text-gray-500"}`}>
                {quest.is_active ? "Active" : "Inactive"}
              </Text>
            </View>
          </View>

          <View className="mt-3 flex-row flex-wrap gap-2">
            <View className="bg-yellow-50 px-3 py-1 rounded-lg">
              <Text className="text-yellow-700 text-xs">{quest.reward_coins} coins</Text>
            </View>
            <View className="bg-violet-50 px-3 py-1 rounded-lg">
              <Text className="text-violet-700 text-xs">{quest.reward_xp} XP</Text>
            </View>
            <View className="bg-blue-50 px-3 py-1 rounded-lg">
              <Text className="text-blue-700 text-xs">{quest.target_action} × {quest.target_count}</Text>
            </View>
            <View className="bg-green-50 px-3 py-1 rounded-lg">
              <Text className="text-green-700 text-xs">{quest.completions} completions</Text>
            </View>
          </View>

          {quest.ends_at && (
            <Text className="text-gray-400 text-xs mt-2">Ends: {formatDate(quest.ends_at)}</Text>
          )}

          <TouchableOpacity
            className={`mt-3 py-2 rounded-xl ${quest.is_active ? "bg-red-50" : "bg-green-50"}`}
            onPress={() => handleToggle(quest)}
          >
            <Text className={`text-center text-sm font-semibold ${quest.is_active ? "text-red-600" : "text-green-600"}`}>
              {quest.is_active ? "Deactivate" : "Activate"}
            </Text>
          </TouchableOpacity>
        </View>
      ))}

      {/* Create Modal */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-white">
          <View className="px-4 pt-6 pb-4 border-b border-gray-200 flex-row items-center justify-between">
            <Text className="text-xl font-bold text-gray-900">New Sponsored Quest</Text>
            <TouchableOpacity onPress={() => setShowCreate(false)}>
              <Text className="text-blue-600 font-semibold">Cancel</Text>
            </TouchableOpacity>
          </View>
          <ScrollView className="flex-1 px-4 pt-4">
            {[
              { label: "Quest Title *", value: title, set: setTitle, placeholder: "e.g. Pepsi Challenge" },
              { label: "Brand Name *", value: brandName, set: setBrandName, placeholder: "e.g. Pepsi Nigeria" },
              { label: "Description", value: description, set: setDescription, placeholder: "Quest description" },
              { label: "Coin Reward", value: rewardCoins, set: setRewardCoins, placeholder: "100", numeric: true },
              { label: "XP Reward", value: rewardXp, set: setRewardXp, placeholder: "50", numeric: true },
              { label: "Target Action", value: targetAction, set: setTargetAction, placeholder: "send_message" },
              { label: "Target Count", value: targetCount, set: setTargetCount, placeholder: "10", numeric: true },
              { label: "Ends At (ISO 8601)", value: endsAt, set: setEndsAt, placeholder: "2025-02-01T23:59:59Z" },
            ].map((field) => (
              <View key={field.label}>
                <Text className="text-sm font-medium text-gray-700 mb-1">{field.label}</Text>
                <TextInput
                  className="border border-gray-300 rounded-xl px-3 py-2 mb-4 text-gray-900"
                  value={field.value}
                  onChangeText={field.set}
                  placeholder={field.placeholder}
                  keyboardType={field.numeric ? "number-pad" : "default"}
                />
              </View>
            ))}

            <TouchableOpacity
              className="bg-amber-600 rounded-xl py-3 mb-8"
              onPress={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white text-center font-semibold text-base">Create Quest</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}
