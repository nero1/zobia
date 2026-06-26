import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput,
  Alert, ActivityIndicator, RefreshControl
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { storage } from "@/lib/offline/store";
import { translateApiError } from "@/lib/i18n/apiErrors";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface Alliance {
  id: string;
  name: string;
  description: string | null;
  wars_won: number;
  member_guilds: { guild_id: string; guild_name: string; joined_at: string }[];
}

export default function AllianceScreen() {
  const { guildId } = useLocalSearchParams<{ guildId: string }>();
  const { t } = useTranslation();
  const [alliance, setAlliance] = useState<Alliance | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [allianceName, setAllianceName] = useState("");
  const [allianceDesc, setAllianceDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadAlliance = useCallback(async () => {
    if (!guildId) return;
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/guilds/${guildId}/alliances`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setAlliance(data.data?.alliance ?? null);
    }
    setLoading(false);
    setRefreshing(false);
  }, [guildId]);

  async function createAlliance() {
    if (!allianceName.trim()) return;
    setSubmitting(true);
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/guilds/${guildId}/alliances`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action: "create", name: allianceName.trim(), description: allianceDesc.trim() }),
    });
    setSubmitting(false);
    if (res.ok) {
      setCreating(false);
      void loadAlliance();
    } else {
      const err = await res.json();
      Alert.alert("Error", translateApiError(t, err.error?.code, err.error?.message ?? "Failed to create alliance."));
    }
  }

  async function leaveAlliance() {
    Alert.alert("Leave Alliance?", "Your guild will no longer be part of this alliance.", [
      { text: "Cancel" },
      {
        text: "Leave", style: "destructive", onPress: async () => {
          const token = storage.getString("authToken");
          await fetch(`${API_BASE}/api/guilds/${guildId}/alliances`, {
            method: "DELETE",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          setAlliance(null);
        },
      },
    ]);
  }

  useEffect(() => { void loadAlliance(); }, [loadAlliance]);

  if (loading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>;

  if (!alliance && !creating) {
    return (
      <ScrollView className="flex-1 bg-gray-50" contentContainerClassName="p-4 items-center pt-10">
        <Text className="text-5xl mb-4">⚔️</Text>
        <Text className="text-xl font-bold text-gray-900 mb-2">No Alliance</Text>
        <Text className="text-gray-500 text-center mb-8">Your guild is not part of any alliance yet. Create one or join an existing alliance.</Text>
        <TouchableOpacity className="w-full bg-blue-600 rounded-xl py-4 items-center mb-3" onPress={() => setCreating(true)}>
          <Text className="text-white font-bold">Create Alliance</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (creating) {
    return (
      <ScrollView className="flex-1 bg-gray-50" contentContainerClassName="p-4">
        <Text className="text-lg font-bold text-gray-900 mb-4">Create Alliance</Text>
        <TextInput className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-3 text-gray-800"
          placeholder="Alliance name" value={allianceName} onChangeText={setAllianceName} />
        <TextInput className="bg-white border border-gray-200 rounded-xl px-4 py-3 mb-4 text-gray-800 h-20"
          placeholder="Description (optional)" value={allianceDesc} onChangeText={setAllianceDesc} multiline textAlignVertical="top" />
        <TouchableOpacity className={`py-4 rounded-xl items-center ${submitting ? "bg-gray-200" : "bg-blue-600"}`}
          onPress={() => void createAlliance()} disabled={submitting}>
          <Text className="text-white font-bold">{submitting ? "Creating..." : "Create Alliance"}</Text>
        </TouchableOpacity>
        <TouchableOpacity className="mt-3 items-center" onPress={() => setCreating(false)}>
          <Text className="text-gray-500">Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 bg-gray-50" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadAlliance(); }} />}>
      <View className="bg-gradient-to-b from-indigo-700 to-indigo-900 px-6 py-8 items-center">
        <Text className="text-4xl mb-2">⚔️</Text>
        <Text className="text-white text-2xl font-bold">{alliance!.name}</Text>
        <Text className="text-indigo-200 text-sm">{alliance!.wars_won} wars won</Text>
      </View>
      <View className="bg-white mx-4 mt-4 rounded-xl p-4 shadow-sm">
        <Text className="font-semibold text-gray-800 mb-1">About</Text>
        <Text className="text-gray-600">{alliance!.description ?? "No description"}</Text>
      </View>
      <View className="bg-white mx-4 mt-3 rounded-xl p-4 shadow-sm">
        <Text className="font-semibold text-gray-800 mb-3">Member Guilds ({alliance!.member_guilds.length})</Text>
        {alliance!.member_guilds.map((g) => (
          <View key={g.guild_id} className="flex-row justify-between py-2 border-b border-gray-50">
            <Text className="text-gray-700 font-medium">{g.guild_name}</Text>
            <Text className="text-gray-400 text-xs">Joined {new Date(g.joined_at).toLocaleDateString()}</Text>
          </View>
        ))}
      </View>
      <View className="mx-4 mt-4 mb-8">
        <TouchableOpacity className="bg-red-50 border border-red-200 rounded-xl py-3 items-center" onPress={() => void leaveAlliance()}>
          <Text className="text-red-600 font-medium">Leave Alliance</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';
