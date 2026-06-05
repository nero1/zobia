import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, TextInput, Modal,
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface FlashXpEvent {
  id: string;
  name: string;
  description: string | null;
  multiplier: number;
  announced_at: string;
  fires_at: string;
  ends_at: string;
  is_active: boolean;
  fired: boolean;
  created_at: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

export default function FlashXpAdminScreen() {
  const [events, setEvents] = useState<FlashXpEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [multiplier, setMultiplier] = useState("2");
  const [firesAt, setFiresAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const token = storage.getString("authToken");
      const res = await fetch(`${API_BASE}/api/admin/flash-xp`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setEvents(data.data?.events ?? []);
    } catch { /* ignore */ }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void load(); }, []);

  async function handleCreate() {
    if (!name.trim() || !firesAt || !endsAt) {
      Alert.alert("Validation", "Name, fires at, and ends at are required.");
      return;
    }
    setCreating(true);
    try {
      const token = storage.getString("authToken");
      const res = await fetch(`${API_BASE}/api/admin/flash-xp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          multiplier: parseFloat(multiplier) || 2,
          fires_at: firesAt,
          ends_at: endsAt,
          announced_at: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreate(false);
        setName(""); setDescription(""); setMultiplier("2"); setFiresAt(""); setEndsAt("");
        void load();
      } else {
        Alert.alert("Error", data.error?.message ?? "Failed to create event");
      }
    } catch {
      Alert.alert("Error", "Network error");
    }
    setCreating(false);
  }

  async function handleToggle(evt: FlashXpEvent) {
    const token = storage.getString("authToken");
    await fetch(`${API_BASE}/api/admin/flash-xp/${evt.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ is_active: !evt.is_active }),
    }).catch(() => {});
    void load();
  }

  if (loading) return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator size="large" color="#7C3AED" />
    </View>
  );

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
    >
      <View className="px-4 pt-6 pb-2 flex-row items-center justify-between">
        <View>
          <Text className="text-2xl font-bold text-gray-900">⚡ Flash XP Events</Text>
          <Text className="text-gray-500 text-sm mt-1">Manage XP multiplier events</Text>
        </View>
        <TouchableOpacity
          className="bg-violet-600 px-4 py-2 rounded-xl"
          onPress={() => setShowCreate(true)}
        >
          <Text className="text-white font-semibold">+ Create</Text>
        </TouchableOpacity>
      </View>

      {events.length === 0 && (
        <View className="mx-4 mt-8 items-center">
          <Text className="text-gray-400 text-base">No flash XP events yet.</Text>
        </View>
      )}

      {events.map((evt) => (
        <View key={evt.id} className="mx-4 mb-3 bg-white rounded-xl p-4 shadow-sm">
          <View className="flex-row items-start justify-between">
            <View className="flex-1 mr-3">
              <Text className="font-bold text-gray-900 text-base">{evt.name}</Text>
              {evt.description ? (
                <Text className="text-gray-500 text-sm mt-0.5">{evt.description}</Text>
              ) : null}
            </View>
            <View className={`px-2 py-1 rounded-full ${evt.is_active ? "bg-green-100" : "bg-gray-100"}`}>
              <Text className={`text-xs font-semibold ${evt.is_active ? "text-green-700" : "text-gray-500"}`}>
                {evt.fired ? "LIVE" : evt.is_active ? "Scheduled" : "Inactive"}
              </Text>
            </View>
          </View>

          <View className="mt-3 flex-row flex-wrap gap-2">
            <View className="bg-violet-50 px-3 py-1 rounded-lg">
              <Text className="text-violet-700 font-bold text-sm">{evt.multiplier}× XP</Text>
            </View>
            <View className="bg-blue-50 px-3 py-1 rounded-lg">
              <Text className="text-blue-700 text-xs">Fires: {formatDate(evt.fires_at)}</Text>
            </View>
            <View className="bg-red-50 px-3 py-1 rounded-lg">
              <Text className="text-red-700 text-xs">Ends: {formatDate(evt.ends_at)}</Text>
            </View>
          </View>

          <TouchableOpacity
            className={`mt-3 py-2 rounded-xl ${evt.is_active ? "bg-red-50" : "bg-green-50"}`}
            onPress={() => handleToggle(evt)}
          >
            <Text className={`text-center text-sm font-semibold ${evt.is_active ? "text-red-600" : "text-green-600"}`}>
              {evt.is_active ? "Deactivate" : "Activate"}
            </Text>
          </TouchableOpacity>
        </View>
      ))}

      {/* Create Modal */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-white">
          <View className="px-4 pt-6 pb-4 border-b border-gray-200 flex-row items-center justify-between">
            <Text className="text-xl font-bold text-gray-900">New Flash XP Event</Text>
            <TouchableOpacity onPress={() => setShowCreate(false)}>
              <Text className="text-blue-600 font-semibold">Cancel</Text>
            </TouchableOpacity>
          </View>
          <ScrollView className="flex-1 px-4 pt-4">
            <Text className="text-sm font-medium text-gray-700 mb-1">Event Name *</Text>
            <TextInput
              className="border border-gray-300 rounded-xl px-3 py-2 mb-4 text-gray-900"
              value={name}
              onChangeText={setName}
              placeholder="e.g. Weekend XP Blitz"
            />

            <Text className="text-sm font-medium text-gray-700 mb-1">Description</Text>
            <TextInput
              className="border border-gray-300 rounded-xl px-3 py-2 mb-4 text-gray-900"
              value={description}
              onChangeText={setDescription}
              placeholder="Optional description"
              multiline
            />

            <Text className="text-sm font-medium text-gray-700 mb-1">XP Multiplier *</Text>
            <TextInput
              className="border border-gray-300 rounded-xl px-3 py-2 mb-4 text-gray-900"
              value={multiplier}
              onChangeText={setMultiplier}
              placeholder="e.g. 2 for double XP"
              keyboardType="decimal-pad"
            />

            <Text className="text-sm font-medium text-gray-700 mb-1">Fires At (ISO 8601) *</Text>
            <TextInput
              className="border border-gray-300 rounded-xl px-3 py-2 mb-4 text-gray-900"
              value={firesAt}
              onChangeText={setFiresAt}
              placeholder="2025-01-15T18:00:00Z"
            />

            <Text className="text-sm font-medium text-gray-700 mb-1">Ends At (ISO 8601) *</Text>
            <TextInput
              className="border border-gray-300 rounded-xl px-3 py-2 mb-4 text-gray-900"
              value={endsAt}
              onChangeText={setEndsAt}
              placeholder="2025-01-16T18:00:00Z"
            />

            <TouchableOpacity
              className="bg-violet-600 rounded-xl py-3 mb-8"
              onPress={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white text-center font-semibold text-base">Create Event</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}
