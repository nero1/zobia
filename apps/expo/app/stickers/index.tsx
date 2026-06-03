import React, { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl, Modal, ScrollView
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface StickerPack {
  id: string;
  name: string;
  description: string | null;
  cover_emoji: string;
  pack_type: "free" | "earnable" | "premium";
  coin_price: number;
  unlock_condition: string | null;
  unlocked: boolean;
  stickers?: Array<{ id: string; name: string; emoji: string }>;
}

export default function StickerStoreScreen() {
  const [packs, setPacks] = useState<StickerPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [previewPack, setPreviewPack] = useState<StickerPack | null>(null);

  async function loadPacks() {
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/stickers`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => null);
    if (!res?.ok) return;
    setPacks((await res.json()).data?.packs ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void loadPacks(); }, []);

  async function unlockPack(pack: StickerPack) {
    if (pack.unlocked) return;
    if (pack.pack_type === "earnable") {
      Alert.alert("Earnable Pack", pack.unlock_condition ?? "Complete special challenges to unlock.");
      return;
    }
    Alert.alert(
      `Unlock ${pack.name}`,
      `Cost: ${pack.coin_price} coins`,
      [
        { text: "Cancel" },
        {
          text: "Unlock", onPress: async () => {
            const token = storage.getString("authToken");
            const res = await fetch(`${API_BASE}/api/stickers`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({ packId: pack.id }),
            });
            if (res.ok) {
              setPacks((prev) => prev.map((p) => p.id === pack.id ? { ...p, unlocked: true } : p));
              Alert.alert("🎨 Unlocked!", `${pack.name} is now available!`);
            } else {
              const err = await res.json();
              Alert.alert("Error", err.error?.message ?? "Unlock failed.");
            }
          },
        },
      ]
    );
  }

  if (loading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>;

  return (
    <>
      <FlatList
        data={packs}
        numColumns={2}
        keyExtractor={(p) => p.id}
        className="flex-1 bg-gray-50"
        contentContainerClassName="p-3"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadPacks(); }} />}
        renderItem={({ item }) => (
          <View className="flex-1 m-2 bg-white rounded-xl shadow-sm overflow-hidden">
            <TouchableOpacity
              className="items-center p-4"
              onPress={() => setPreviewPack(item)}
            >
              <Text className="text-5xl mb-2">{item.cover_emoji}</Text>
              <Text className="font-semibold text-gray-900 text-center">{item.name}</Text>
              {item.unlocked && <Text className="text-xs text-emerald-600 mt-1">✓ Owned</Text>}
              {!item.unlocked && item.pack_type === "premium" && (
                <Text className="text-xs text-violet-600 mt-1">{item.coin_price} 🪙</Text>
              )}
              {!item.unlocked && item.pack_type === "earnable" && (
                <Text className="text-xs text-amber-600 mt-1">🏆 Earnable</Text>
              )}
              {item.pack_type === "free" && !item.unlocked && (
                <Text className="text-xs text-blue-600 mt-1">Free</Text>
              )}
            </TouchableOpacity>
            {!item.unlocked && (
              <TouchableOpacity
                className={`mx-3 mb-3 py-2 rounded-lg items-center ${
                  item.pack_type === "earnable" ? "bg-amber-100" : "bg-blue-600"
                }`}
                onPress={() => void unlockPack(item)}
              >
                <Text className={`text-sm font-medium ${item.pack_type === "earnable" ? "text-amber-700" : "text-white"}`}>
                  {item.pack_type === "earnable" ? "How to Earn" : "Unlock"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      />

      {/* Preview Modal */}
      <Modal visible={!!previewPack} transparent animationType="slide" onRequestClose={() => setPreviewPack(null)}>
        <View className="flex-1 justify-end bg-black/50">
          <View className="bg-white rounded-t-3xl px-5 pt-5 pb-8 max-h-1/2">
            <View className="flex-row items-center mb-4">
              <Text className="text-3xl mr-3">{previewPack?.cover_emoji}</Text>
              <View className="flex-1">
                <Text className="text-lg font-bold text-gray-900">{previewPack?.name}</Text>
                <Text className="text-gray-500 text-sm">{previewPack?.description}</Text>
              </View>
              <TouchableOpacity onPress={() => setPreviewPack(null)}>
                <Text className="text-gray-400 text-xl">✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {(previewPack?.stickers ?? []).map((s) => (
                <View key={s.id} className="items-center mr-4">
                  <Text className="text-4xl">{s.emoji}</Text>
                  <Text className="text-xs text-gray-500 mt-1">{s.name}</Text>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
