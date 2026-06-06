import React, { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, Switch,
  Alert, ActivityIndicator, RefreshControl
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface LeaderboardBanner {
  id: string;
  sponsorName: string;
  sponsorLogoUrl: string | null;
  ctaText: string;
  ctaUrl: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  impressions: number;
  createdAt: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

function statusLabel(banner: LeaderboardBanner) {
  const now = new Date();
  const start = new Date(banner.startsAt);
  const end = new Date(banner.endsAt);
  if (!banner.isActive) return { label: "Inactive", color: "bg-gray-100", text: "text-gray-600" };
  if (now < start) return { label: "Scheduled", color: "bg-blue-100", text: "text-blue-700" };
  if (now > end) return { label: "Expired", color: "bg-red-100", text: "text-red-700" };
  return { label: "Live", color: "bg-emerald-100", text: "text-emerald-700" };
}

export default function AdminLeaderboardBannersScreen() {
  const [banners, setBanners] = useState<LeaderboardBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  async function loadBanners() {
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/leaderboard-banners`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setBanners(data.data?.banners ?? []);
    }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void loadBanners(); }, []);

  async function toggleActive(banner: LeaderboardBanner) {
    setTogglingId(banner.id);
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/leaderboard-banners/${banner.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ isActive: !banner.isActive }),
    }).catch(() => null);
    if (res?.ok) {
      setBanners((prev) =>
        prev.map((b) => b.id === banner.id ? { ...b, isActive: !b.isActive } : b)
      );
    } else {
      Alert.alert("Error", "Failed to update banner status.");
    }
    setTogglingId(null);
  }

  async function deleteBanner(id: string, name: string) {
    Alert.alert("Delete banner?", `Delete "${name}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          const token = storage.getString("authToken");
          const res = await fetch(`${API_BASE}/api/admin/leaderboard-banners/${id}`, {
            method: "DELETE",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }).catch(() => null);
          if (res?.ok) {
            setBanners((prev) => prev.filter((b) => b.id !== id));
          } else {
            Alert.alert("Error", "Failed to delete banner.");
          }
        }
      },
    ]);
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
      data={banners}
      keyExtractor={(b) => b.id}
      className="bg-gray-50"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadBanners(); }} />}
      ListEmptyComponent={
        <View className="items-center py-8">
          <Text className="text-gray-400">No leaderboard banners</Text>
        </View>
      }
      renderItem={({ item }) => {
        const status = statusLabel(item);
        return (
          <View className="bg-white mx-3 my-2 rounded-xl p-4 shadow-sm">
            <View className="flex-row items-start justify-between mb-2">
              <View className="flex-1 mr-2">
                <Text className="font-semibold text-gray-900" numberOfLines={1}>{item.sponsorName}</Text>
                <Text className="text-gray-500 text-sm" numberOfLines={1}>{item.ctaText}</Text>
              </View>
              <View className={`${status.color} px-2 py-0.5 rounded-full`}>
                <Text className={`${status.text} text-xs font-medium`}>{status.label}</Text>
              </View>
            </View>

            <View className="flex-row mb-2 gap-x-4">
              <Text className="text-xs text-gray-500">
                Start: <Text className="font-medium text-gray-700">{formatDate(item.startsAt)}</Text>
              </Text>
              <Text className="text-xs text-gray-500">
                End: <Text className="font-medium text-gray-700">{formatDate(item.endsAt)}</Text>
              </Text>
            </View>

            <Text className="text-xs text-gray-400 mb-3">
              {item.impressions.toLocaleString()} impressions
            </Text>

            <View className="flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Text className="text-sm text-gray-600">Active</Text>
                <Switch
                  value={item.isActive}
                  onValueChange={() => void toggleActive(item)}
                  disabled={togglingId === item.id}
                  trackColor={{ false: "#d1d5db", true: "#2563EB" }}
                  thumbColor="#fff"
                />
              </View>
              <TouchableOpacity
                className="bg-red-100 rounded-lg px-4 py-1.5"
                onPress={() => void deleteBanner(item.id, item.sponsorName)}
              >
                <Text className="text-red-700 font-medium text-sm">Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      }}
    />
  );
}
