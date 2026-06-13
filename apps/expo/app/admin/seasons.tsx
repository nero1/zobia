import React, { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl, TextInput, Modal, KeyboardAvoidingView, Platform
} from "react-native";
import { storage } from "@/lib/offline/store";
import { useCurrency } from "@/lib/hooks/useCurrency";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface Season {
  id: string;
  name: string;
  theme: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  pass_price_coins: number;
  reward_pool_coins: number;
  description: string | null;
  created_at: string;
}

interface CreateForm {
  name: string;
  theme: string;
  startsAt: string;
  endsAt: string;
  passPriceCoins: string;
  rewardPoolCoins: string;
  description: string;
}

const EMPTY_FORM: CreateForm = {
  name: "", theme: "", startsAt: "", endsAt: "",
  passPriceCoins: "500", rewardPoolCoins: "0", description: "",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

export default function AdminSeasonsScreen() {
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const currency = useCurrency();

  async function loadSeasons() {
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/seasons`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setSeasons(data.data?.seasons ?? []);
    }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void loadSeasons(); }, []);

  async function createSeason() {
    if (!form.name.trim() || !form.theme.trim() || !form.startsAt.trim() || !form.endsAt.trim()) {
      Alert.alert("Validation", "Name, theme, start date, and end date are required.");
      return;
    }
    const startsAt = new Date(form.startsAt.trim());
    const endsAt = new Date(form.endsAt.trim());
    if (isNaN(startsAt.getTime()) || isNaN(endsAt.getTime())) {
      Alert.alert("Validation", "Dates must be valid ISO 8601 datetimes (e.g. 2025-09-01T00:00:00Z).");
      return;
    }
    if (endsAt <= startsAt) {
      Alert.alert("Validation", "End date must be after start date.");
      return;
    }
    setSaving(true);
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/seasons`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        name: form.name.trim(),
        theme: form.theme.trim(),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        passPriceCoins: parseInt(form.passPriceCoins, 10) || 500,
        rewardPoolCoins: parseInt(form.rewardPoolCoins, 10) || 0,
        description: form.description.trim() || undefined,
      }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      const data = await res.json();
      const created: Season = data.data?.season;
      if (created) setSeasons((prev) => [created, ...prev]);
      setShowCreate(false);
      setForm(EMPTY_FORM);
    } else {
      const err = await res?.json().catch(() => null);
      Alert.alert("Error", err?.error?.message ?? "Failed to create season.");
    }
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color="#2563EB" />
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={seasons}
        keyExtractor={(s) => s.id}
        className="bg-gray-50"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadSeasons(); }} />}
        ListHeaderComponent={
          <TouchableOpacity
            className="mx-3 mt-4 mb-2 bg-blue-600 rounded-xl py-3 items-center"
            onPress={() => { setForm(EMPTY_FORM); setShowCreate(true); }}
          >
            <Text className="text-white font-semibold">+ Create New Season</Text>
          </TouchableOpacity>
        }
        ListEmptyComponent={
          <View className="items-center py-8">
            <Text className="text-gray-400">No seasons yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className="bg-white mx-3 my-2 rounded-xl p-4 shadow-sm">
            <View className="flex-row items-start justify-between mb-1">
              <View className="flex-1 mr-2">
                <Text className="font-semibold text-gray-900" numberOfLines={1}>{item.name}</Text>
                <Text className="text-gray-500 text-sm capitalize">Theme: {item.theme}</Text>
              </View>
              {item.is_active ? (
                <View className="bg-emerald-100 px-2 py-0.5 rounded-full">
                  <Text className="text-emerald-700 text-xs font-medium">Active</Text>
                </View>
              ) : new Date(item.starts_at) > new Date() ? (
                <View className="bg-blue-100 px-2 py-0.5 rounded-full">
                  <Text className="text-blue-700 text-xs font-medium">Upcoming</Text>
                </View>
              ) : (
                <View className="bg-gray-100 px-2 py-0.5 rounded-full">
                  <Text className="text-gray-600 text-xs font-medium">Past</Text>
                </View>
              )}
            </View>
            <View className="flex-row gap-x-4 mt-1">
              <Text className="text-xs text-gray-500">
                Start: <Text className="font-medium text-gray-700">{formatDate(item.starts_at)}</Text>
              </Text>
              <Text className="text-xs text-gray-500">
                End: <Text className="font-medium text-gray-700">{formatDate(item.ends_at)}</Text>
              </Text>
            </View>
            <View className="flex-row gap-x-4 mt-1">
              <Text className="text-xs text-gray-500">
                Pass: <Text className="font-medium text-gray-700">{item.pass_price_coins} {currency.softPlural.toLowerCase()}</Text>
              </Text>
              <Text className="text-xs text-gray-500">
                Pool: <Text className="font-medium text-gray-700">{item.reward_pool_coins.toLocaleString()} {currency.softPlural.toLowerCase()}</Text>
              </Text>
            </View>
            {item.description && (
              <Text className="text-gray-500 text-sm mt-2" numberOfLines={2}>{item.description}</Text>
            )}
          </View>
        )}
      />

      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View className="flex-1 bg-black/50 justify-end">
            <View className="bg-white rounded-t-2xl p-6">
              <Text className="text-lg font-bold text-gray-900 mb-4">Create Season</Text>

              {(
                [
                  { label: "Name", key: "name", placeholder: "Season 4 — Edge of Glory" },
                  { label: "Theme", key: "theme", placeholder: "fire / ocean / neon…" },
                  { label: "Start (ISO 8601)", key: "startsAt", placeholder: "2025-09-01T00:00:00Z" },
                  { label: "End (ISO 8601)", key: "endsAt", placeholder: "2025-11-30T23:59:59Z" },
                  { label: `Pass Price (${currency.softPlural.toLowerCase()})`, key: "passPriceCoins", placeholder: "500" },
                  { label: `Reward Pool (${currency.softPlural.toLowerCase()})`, key: "rewardPoolCoins", placeholder: "0" },
                ] as const
              ).map(({ label, key, placeholder }) => (
                <View key={key} className="mb-3">
                  <Text className="text-gray-600 text-sm font-medium mb-1">{label}</Text>
                  <TextInput
                    className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900"
                    value={form[key]}
                    onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
                    placeholder={placeholder}
                    placeholderTextColor="#9CA3AF"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType={key === "passPriceCoins" || key === "rewardPoolCoins" ? "numeric" : "default"}
                  />
                </View>
              ))}

              <View className="mb-4">
                <Text className="text-gray-600 text-sm font-medium mb-1">Description (optional)</Text>
                <TextInput
                  className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900"
                  value={form.description}
                  onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
                  placeholder="Season lore and description…"
                  placeholderTextColor="#9CA3AF"
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                />
              </View>

              <View className="flex-row gap-3">
                <TouchableOpacity
                  className="flex-1 border border-gray-300 rounded-xl py-3 items-center"
                  onPress={() => setShowCreate(false)}
                  disabled={saving}
                >
                  <Text className="text-gray-700 font-medium">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-blue-600 rounded-xl py-3 items-center"
                  onPress={() => void createSeason()}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold">Create</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
