import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, TextInput, Modal,
} from "react-native";
import { storage } from "@/lib/offline/store";
import { useCurrency } from "@/lib/hooks/useCurrency";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface BrandedRoom {
  id: string;
  name: string;
  brand_name: string;
  brand_logo_url: string | null;
  room_id: string;
  entry_fee_coins: number;
  sponsored: boolean;
  is_active: boolean;
  starts_at: string;
  ends_at: string;
  created_at: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

export default function BrandedRoomsAdminScreen() {
  const currency = useCurrency();
  const [rooms, setRooms] = useState<BrandedRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // Form state
  const [brandName, setBrandName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [entryFee, setEntryFee] = useState("0");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    try {
      const token = storage.getString("authToken");
      const res = await fetch(`${API_BASE}/api/admin/branded-rooms`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setRooms(data.data?.rooms ?? []);
    } catch { /* ignore */ }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void load(); }, []);

  async function handleCreate() {
    if (!brandName.trim() || !roomName.trim()) {
      Alert.alert("Validation", "Brand name and room name are required.");
      return;
    }
    setCreating(true);
    try {
      const token = storage.getString("authToken");
      const res = await fetch(`${API_BASE}/api/admin/branded-rooms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          brand_name: brandName.trim(),
          room_name: roomName.trim(),
          entry_fee_coins: parseInt(entryFee) || 0,
          starts_at: startsAt || new Date().toISOString(),
          ends_at: endsAt || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreate(false);
        setBrandName(""); setRoomName(""); setEntryFee("0"); setStartsAt(""); setEndsAt("");
        void load();
      } else {
        Alert.alert("Error", data.error?.message ?? "Failed to create branded room");
      }
    } catch {
      Alert.alert("Error", "Network error");
    }
    setCreating(false);
  }

  async function handleToggle(room: BrandedRoom) {
    const token = storage.getString("authToken");
    await fetch(`${API_BASE}/api/admin/branded-rooms/${room.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ is_active: !room.is_active }),
    }).catch(() => {});
    void load();
  }

  if (loading) return (
    <View className="flex-1 items-center justify-center">
      <ActivityIndicator size="large" color="#0891B2" />
    </View>
  );

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
    >
      <View className="px-4 pt-6 pb-2 flex-row items-center justify-between">
        <View>
          <Text className="text-2xl font-bold text-gray-900">🏢 Branded Rooms</Text>
          <Text className="text-gray-500 text-sm mt-1">Sponsor-branded chat rooms</Text>
        </View>
        <TouchableOpacity
          className="bg-cyan-600 px-4 py-2 rounded-xl"
          onPress={() => setShowCreate(true)}
        >
          <Text className="text-white font-semibold">+ Create</Text>
        </TouchableOpacity>
      </View>

      {rooms.length === 0 && (
        <View className="mx-4 mt-8 items-center">
          <Text className="text-gray-400 text-base">No branded rooms yet.</Text>
        </View>
      )}

      {rooms.map((room) => (
        <View key={room.id} className="mx-4 mb-3 bg-white rounded-xl p-4 shadow-sm">
          <View className="flex-row items-start justify-between">
            <View className="flex-1 mr-3">
              <Text className="font-bold text-gray-900 text-base">{room.name}</Text>
              <Text className="text-cyan-700 font-semibold text-sm mt-0.5">by {room.brand_name}</Text>
            </View>
            <View className={`px-2 py-1 rounded-full ${room.is_active ? "bg-green-100" : "bg-gray-100"}`}>
              <Text className={`text-xs font-semibold ${room.is_active ? "text-green-700" : "text-gray-500"}`}>
                {room.is_active ? "Active" : "Inactive"}
              </Text>
            </View>
          </View>

          <View className="mt-3 flex-row flex-wrap gap-2">
            {room.sponsored && (
              <View className="bg-amber-50 px-3 py-1 rounded-lg">
                <Text className="text-amber-700 text-xs font-semibold">Sponsored</Text>
              </View>
            )}
            <View className="bg-blue-50 px-3 py-1 rounded-lg">
              <Text className="text-blue-700 text-xs">
                {room.entry_fee_coins > 0 ? `${room.entry_fee_coins} ${currency.softPlural.toLowerCase()} entry` : "Free entry"}
              </Text>
            </View>
            {room.starts_at && (
              <View className="bg-gray-50 px-3 py-1 rounded-lg">
                <Text className="text-gray-600 text-xs">Starts: {formatDate(room.starts_at)}</Text>
              </View>
            )}
            {room.ends_at && (
              <View className="bg-red-50 px-3 py-1 rounded-lg">
                <Text className="text-red-600 text-xs">Ends: {formatDate(room.ends_at)}</Text>
              </View>
            )}
          </View>

          <TouchableOpacity
            className={`mt-3 py-2 rounded-xl ${room.is_active ? "bg-red-50" : "bg-green-50"}`}
            onPress={() => handleToggle(room)}
          >
            <Text className={`text-center text-sm font-semibold ${room.is_active ? "text-red-600" : "text-green-600"}`}>
              {room.is_active ? "Deactivate" : "Activate"}
            </Text>
          </TouchableOpacity>
        </View>
      ))}

      {/* Create Modal */}
      <Modal visible={showCreate} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-white">
          <View className="px-4 pt-6 pb-4 border-b border-gray-200 flex-row items-center justify-between">
            <Text className="text-xl font-bold text-gray-900">New Branded Room</Text>
            <TouchableOpacity onPress={() => setShowCreate(false)}>
              <Text className="text-blue-600 font-semibold">Cancel</Text>
            </TouchableOpacity>
          </View>
          <ScrollView className="flex-1 px-4 pt-4">
            <Text className="text-sm font-medium text-gray-700 mb-1">Brand Name *</Text>
            <TextInput
              className="border border-gray-300 rounded-xl px-3 py-2 mb-4 text-gray-900"
              value={brandName}
              onChangeText={setBrandName}
              placeholder="e.g. Pepsi Nigeria"
            />

            <Text className="text-sm font-medium text-gray-700 mb-1">Room Name *</Text>
            <TextInput
              className="border border-gray-300 rounded-xl px-3 py-2 mb-4 text-gray-900"
              value={roomName}
              onChangeText={setRoomName}
              placeholder="e.g. Pepsi Fan Zone"
            />

            <Text className="text-sm font-medium text-gray-700 mb-1">Entry Fee ({currency.softPlural.toLowerCase()})</Text>
            <TextInput
              className="border border-gray-300 rounded-xl px-3 py-2 mb-4 text-gray-900"
              value={entryFee}
              onChangeText={setEntryFee}
              keyboardType="number-pad"
              placeholder="0"
            />

            <Text className="text-sm font-medium text-gray-700 mb-1">Starts At (ISO 8601)</Text>
            <TextInput
              className="border border-gray-300 rounded-xl px-3 py-2 mb-4 text-gray-900"
              value={startsAt}
              onChangeText={setStartsAt}
              placeholder="2025-01-15T10:00:00Z (leave blank = now)"
            />

            <Text className="text-sm font-medium text-gray-700 mb-1">Ends At (ISO 8601)</Text>
            <TextInput
              className="border border-gray-300 rounded-xl px-3 py-2 mb-4 text-gray-900"
              value={endsAt}
              onChangeText={setEndsAt}
              placeholder="2025-01-30T23:59:59Z (optional)"
            />

            <TouchableOpacity
              className="bg-cyan-600 rounded-xl py-3 mb-8"
              onPress={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white text-center font-semibold text-base">Create Branded Room</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </ScrollView>
  );
}
