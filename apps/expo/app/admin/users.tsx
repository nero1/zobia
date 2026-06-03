import React, { useEffect, useState } from "react";
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  ActivityIndicator, RefreshControl
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface User {
  id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string;
  rank: string;
  plan: string;
  trust_score: number;
  created_at: string;
}

export default function AdminUsersScreen() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);

  async function loadUsers(reset = false) {
    const token = storage.getString("authToken");
    const params = new URLSearchParams({ limit: "30" });
    if (search) params.set("search", search);
    if (!reset && cursor) params.set("cursor", cursor);

    const res = await fetch(`${API_BASE}/api/admin/users?${params}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => null);

    if (!res?.ok) return;
    const data = await res.json();
    const rows: User[] = data.data?.users ?? [];
    setUsers(reset ? rows : (prev) => [...prev, ...rows]);
    setCursor(data.data?.nextCursor ?? null);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void loadUsers(true); }, [search]);

  return (
    <View className="flex-1 bg-gray-50">
      <View className="px-4 pt-4 pb-2">
        <TextInput
          className="bg-white border border-gray-200 rounded-xl px-4 py-2 text-gray-800"
          placeholder="Search users..."
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
      </View>

      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadUsers(true); }} />}
        onEndReached={() => { if (cursor) void loadUsers(); }}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          loading
            ? <View className="items-center py-8"><ActivityIndicator color="#2563EB" /></View>
            : <View className="items-center py-8"><Text className="text-gray-400">No users found</Text></View>
        }
        renderItem={({ item }) => (
          <View className="flex-row items-center bg-white mx-3 mb-2 px-4 py-3 rounded-xl shadow-sm">
            <Text className="text-2xl mr-3">{item.avatar_emoji}</Text>
            <View className="flex-1">
              <Text className="font-semibold text-gray-900">@{item.username}</Text>
              <Text className="text-gray-500 text-xs">{item.rank} • {item.plan} • Trust: {item.trust_score}</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}
