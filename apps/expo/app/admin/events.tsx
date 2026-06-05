import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface PlatformEvent {
  id: string;
  name: string;
  description: string | null;
  event_type: string;
  xp_multiplier: number;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  is_recurring_annual: boolean;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

function StatusBadge({ event }: { event: PlatformEvent }) {
  const now = Date.now();
  const starts = new Date(event.starts_at).getTime();
  const ends = new Date(event.ends_at).getTime();
  if (!event.is_active) return (
    <View className="px-2 py-0.5 rounded-full bg-gray-100">
      <Text className="text-gray-500 text-xs font-semibold">Inactive</Text>
    </View>
  );
  if (now < starts) return (
    <View className="px-2 py-0.5 rounded-full bg-blue-100">
      <Text className="text-blue-700 text-xs font-semibold">Upcoming</Text>
    </View>
  );
  if (now > ends) return (
    <View className="px-2 py-0.5 rounded-full bg-gray-100">
      <Text className="text-gray-500 text-xs font-semibold">Ended</Text>
    </View>
  );
  return (
    <View className="px-2 py-0.5 rounded-full bg-green-100">
      <Text className="text-green-700 text-xs font-semibold">Live</Text>
    </View>
  );
}

export default function EventsAdminScreen() {
  const [events, setEvents] = useState<PlatformEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    try {
      const token = storage.getString("authToken");
      const res = await fetch(`${API_BASE}/api/admin/events`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      setEvents(data.data?.events ?? []);
    } catch { /* ignore */ }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void load(); }, []);

  async function handleToggle(evt: PlatformEvent) {
    const token = storage.getString("authToken");
    await fetch(`${API_BASE}/api/admin/events/${evt.id}`, {
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
      <ActivityIndicator size="large" color="#EA580C" />
    </View>
  );

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
    >
      <View className="px-4 pt-6 pb-2">
        <Text className="text-2xl font-bold text-gray-900">🗓️ Platform Events</Text>
        <Text className="text-gray-500 text-sm mt-1">Cultural events & XP multipliers</Text>
      </View>

      {events.length === 0 && (
        <View className="mx-4 mt-8 items-center">
          <Text className="text-gray-400 text-base">No platform events configured.</Text>
        </View>
      )}

      {events.map((evt) => (
        <View key={evt.id} className="mx-4 mb-3 bg-white rounded-xl p-4 shadow-sm">
          <View className="flex-row items-start justify-between">
            <View className="flex-1 mr-3">
              <Text className="font-bold text-gray-900 text-base">{evt.name}</Text>
              {evt.description ? (
                <Text className="text-gray-500 text-sm mt-0.5" numberOfLines={2}>{evt.description}</Text>
              ) : null}
            </View>
            <StatusBadge event={evt} />
          </View>

          <View className="mt-3 flex-row flex-wrap gap-2">
            <View className="bg-orange-50 px-3 py-1 rounded-lg">
              <Text className="text-orange-700 text-xs font-semibold">{evt.event_type}</Text>
            </View>
            {evt.xp_multiplier > 1 && (
              <View className="bg-violet-50 px-3 py-1 rounded-lg">
                <Text className="text-violet-700 text-xs font-semibold">{evt.xp_multiplier}× XP</Text>
              </View>
            )}
            {evt.is_recurring_annual && (
              <View className="bg-teal-50 px-3 py-1 rounded-lg">
                <Text className="text-teal-700 text-xs font-semibold">🔁 Annual</Text>
              </View>
            )}
          </View>

          <View className="mt-2 flex-row gap-3">
            <Text className="text-gray-400 text-xs">Start: {formatDate(evt.starts_at)}</Text>
            <Text className="text-gray-400 text-xs">End: {formatDate(evt.ends_at)}</Text>
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
    </ScrollView>
  );
}
