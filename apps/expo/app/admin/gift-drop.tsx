import React, { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl, TextInput, Modal, KeyboardAvoidingView, Platform
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface GiftDrop {
  id: string;
  gift_item_id: string;
  title: string;
  available_from: string;
  available_until: string;
  announced_at: string | null;
  is_active: boolean;
  created_at: string;
  gift_item_name: string | null;
  gift_item_retired: boolean | null;
  status: "active" | "upcoming" | "scheduled" | "past";
}

const EMPTY_FORM = { giftItemId: "", startAt: "" };

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  active:    { bg: "bg-emerald-100", text: "text-emerald-700" },
  upcoming:  { bg: "bg-amber-100",   text: "text-amber-700" },
  scheduled: { bg: "bg-blue-100",    text: "text-blue-700" },
  past:      { bg: "bg-gray-100",    text: "text-gray-600" },
};

export default function AdminGiftDropScreen() {
  const [drops, setDrops] = useState<GiftDrop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function loadDrops() {
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/gift-drop`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setDrops(data.drops ?? []);
    }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void loadDrops(); }, []);

  async function scheduleDrop() {
    if (!form.giftItemId.trim() || !form.startAt.trim()) {
      Alert.alert("Validation", "Gift Item ID and start date/time are required.");
      return;
    }
    const startDate = new Date(form.startAt.trim());
    if (isNaN(startDate.getTime())) {
      Alert.alert("Validation", "Start date must be a valid ISO 8601 datetime (e.g. 2025-08-01T10:00:00Z).");
      return;
    }
    if (startDate <= new Date()) {
      Alert.alert("Validation", "Start date must be in the future.");
      return;
    }
    setSaving(true);
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/gift-drop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        giftItemId: form.giftItemId.trim(),
        startAt: startDate.toISOString(),
      }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      const data = await res.json();
      const created: GiftDrop = data.drop;
      if (created) setDrops((prev) => [created, ...prev]);
      setShowCreate(false);
      setForm(EMPTY_FORM);
    } else {
      const err = await res?.json().catch(() => null);
      Alert.alert("Error", err?.error?.message ?? "Failed to schedule gift drop.");
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
        data={drops}
        keyExtractor={(d) => d.id}
        className="bg-gray-50"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadDrops(); }} />}
        ListHeaderComponent={
          <TouchableOpacity
            className="mx-3 mt-4 mb-2 bg-blue-600 rounded-xl py-3 items-center"
            onPress={() => { setForm(EMPTY_FORM); setShowCreate(true); }}
          >
            <Text className="text-white font-semibold">+ Schedule New Drop</Text>
          </TouchableOpacity>
        }
        ListEmptyComponent={
          <View className="items-center py-8">
            <Text className="text-gray-400">No gift drops scheduled</Text>
          </View>
        }
        renderItem={({ item }) => {
          const style = STATUS_STYLE[item.status] ?? STATUS_STYLE.past;
          return (
            <View className="bg-white mx-3 my-2 rounded-xl p-4 shadow-sm">
              <View className="flex-row items-start justify-between mb-1">
                <View className="flex-1 mr-2">
                  <Text className="font-semibold text-gray-900" numberOfLines={1}>
                    {item.title || item.gift_item_name || "Gift Drop"}
                  </Text>
                  {item.gift_item_name && item.title !== item.gift_item_name && (
                    <Text className="text-gray-500 text-sm">{item.gift_item_name}</Text>
                  )}
                </View>
                <View className={`${style.bg} px-2 py-0.5 rounded-full`}>
                  <Text className={`${style.text} text-xs font-medium capitalize`}>{item.status}</Text>
                </View>
              </View>
              <View className="flex-row gap-x-4 mt-1">
                <Text className="text-xs text-gray-500">
                  From: <Text className="font-medium text-gray-700">{formatDate(item.available_from)}</Text>
                </Text>
              </View>
              <Text className="text-xs text-gray-500 mt-0.5">
                Until: <Text className="font-medium text-gray-700">{formatDate(item.available_until)}</Text>
              </Text>
              {item.gift_item_retired && (
                <View className="mt-2 bg-red-50 rounded-lg px-3 py-1">
                  <Text className="text-red-700 text-xs">Gift item has been retired</Text>
                </View>
              )}
            </View>
          );
        }}
      />

      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View className="flex-1 bg-black/50 justify-end">
            <View className="bg-white rounded-t-2xl p-6">
              <Text className="text-lg font-bold text-gray-900 mb-4">Schedule Gift Drop</Text>

              <Text className="text-gray-600 text-sm font-medium mb-1">Gift Item ID (UUID)</Text>
              <TextInput
                className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900 mb-3"
                value={form.giftItemId}
                onChangeText={(v) => setForm((f) => ({ ...f, giftItemId: v }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text className="text-gray-600 text-sm font-medium mb-1">Start Date/Time (ISO 8601)</Text>
              <TextInput
                className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900 mb-4"
                value={form.startAt}
                onChangeText={(v) => setForm((f) => ({ ...f, startAt: v }))}
                placeholder="2025-08-01T10:00:00Z"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
              />

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
                  onPress={() => void scheduleDrop()}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold">Schedule</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
