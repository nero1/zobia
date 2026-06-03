import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, FlatList, TouchableOpacity,
  TextInput, Modal, ActivityIndicator, RefreshControl
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface Moment {
  id: string;
  user_id: string;
  username: string;
  avatar_emoji: string;
  content: string;
  view_count: number;
  expires_at: string;
  created_at: string;
  has_viewed: boolean;
}

export default function MomentsScreen() {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [posting, setPosting] = useState(false);

  async function loadMoments() {
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/moments`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => null);
    if (!res?.ok) return;
    setMoments((await res.json()).data?.moments ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  async function postMoment() {
    if (!newContent.trim()) return;
    setPosting(true);
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/moments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ content: newContent.trim(), content_type: "text" }),
    });
    setPosting(false);
    if (res.ok) {
      setNewContent("");
      setComposing(false);
      void loadMoments();
    }
  }

  function timeLeft(expiresAt: string) {
    const ms = new Date(expiresAt).getTime() - Date.now();
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return h > 0 ? `${h}h left` : `${m}m left`;
  }

  useEffect(() => { void loadMoments(); }, []);

  if (loading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>;

  return (
    <>
      <FlatList
        data={moments}
        keyExtractor={(m) => m.id}
        className="flex-1 bg-gray-50"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadMoments(); }} />}
        ListHeaderComponent={
          <View className="px-4 pt-4 pb-2">
            <TouchableOpacity
              className="bg-white border border-blue-200 rounded-xl px-4 py-3 flex-row items-center"
              onPress={() => setComposing(true)}
            >
              <Text className="text-2xl mr-3">✍️</Text>
              <Text className="text-gray-400 flex-1">Share a moment... (disappears in 24h)</Text>
            </TouchableOpacity>
          </View>
        }
        ListEmptyComponent={
          <View className="items-center py-10">
            <Text className="text-5xl mb-3">✨</Text>
            <Text className="text-gray-500 text-base">No moments yet</Text>
            <Text className="text-gray-400 text-sm mt-1">Be the first to share one!</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className={`bg-white mx-4 mb-3 rounded-xl p-4 shadow-sm ${!item.has_viewed ? "border-l-4 border-blue-500" : ""}`}>
            <View className="flex-row items-center mb-2">
              <Text className="text-xl mr-2">{item.avatar_emoji}</Text>
              <Text className="font-semibold text-gray-900 flex-1">@{item.username}</Text>
              <Text className="text-xs text-gray-400">{timeLeft(item.expires_at)}</Text>
            </View>
            <Text className="text-gray-700">{item.content}</Text>
            <Text className="text-xs text-gray-400 mt-2">{item.view_count} views</Text>
          </View>
        )}
      />

      {/* Compose modal */}
      <Modal visible={composing} animationType="slide" transparent onRequestClose={() => setComposing(false)}>
        <View className="flex-1 justify-end bg-black/50">
          <View className="bg-white rounded-t-3xl px-5 pt-5 pb-8">
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-lg font-bold text-gray-900">Share a Moment</Text>
              <TouchableOpacity onPress={() => setComposing(false)}>
                <Text className="text-gray-400 text-xl">✕</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              className="bg-gray-50 rounded-xl p-4 text-gray-800 h-24 mb-4"
              placeholder="What's on your mind? (disappears in 24 hours)"
              value={newContent}
              onChangeText={setNewContent}
              multiline
              autoFocus
              maxLength={500}
              textAlignVertical="top"
            />
            <Text className="text-xs text-gray-400 text-right mb-4">{newContent.length}/500</Text>
            <TouchableOpacity
              className={`py-4 rounded-xl items-center ${posting || !newContent.trim() ? "bg-gray-200" : "bg-blue-600"}`}
              onPress={() => void postMoment()}
              disabled={posting || !newContent.trim()}
            >
              <Text className={`font-bold ${posting || !newContent.trim() ? "text-gray-400" : "text-white"}`}>
                {posting ? "Posting..." : "Post Moment"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}
