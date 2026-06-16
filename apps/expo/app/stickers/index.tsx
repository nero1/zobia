import React, { useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl, Modal, ScrollView,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AxiosError } from "axios";
import { apiClient } from "@/lib/api/client";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { translateApiError } from "@/lib/i18n/apiErrors";

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

async function fetchStickerPacks(): Promise<StickerPack[]> {
  const { data } = await apiClient.get<{ data: { packs: StickerPack[] } }>("/stickers");
  return data.data?.packs ?? [];
}

async function unlockStickerPack(packId: string): Promise<void> {
  await apiClient.post("/stickers", { packId });
}

export default function StickerStoreScreen() {
  const queryClient = useQueryClient();
  const currency = useCurrency();
  const { t } = useTranslation();
  const [previewPack, setPreviewPack] = useState<StickerPack | null>(null);

  const { data: packs = [], isLoading, isRefetching, refetch } = useQuery<StickerPack[]>({
    queryKey: ["stickers", "packs"],
    queryFn: fetchStickerPacks,
    staleTime: 60_000,
  });

  const unlockMutation = useMutation<void, Error, string>({
    mutationFn: unlockStickerPack,
    onSuccess: (_, packId) => {
      queryClient.setQueryData<StickerPack[]>(["stickers", "packs"], (prev: StickerPack[] | undefined) =>
        prev?.map((p: StickerPack) => (p.id === packId ? { ...p, unlocked: true } : p)) ?? []
      );
      const pack = packs.find((p: StickerPack) => p.id === packId);
      Alert.alert("🎨 Unlocked!", `${pack?.name ?? "Pack"} is now available!`);
    },
    onError: (err) => {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? err.message ?? "Unlock failed.";
      Alert.alert("Error", translateApiError(t, code, message));
    },
  });

  function handleUnlock(pack: StickerPack) {
    if (pack.unlocked) return;
    if (pack.pack_type === "earnable") {
      Alert.alert(t('stickers.earn'), pack.unlock_condition ?? t('stickers.earn'));
      return;
    }
    Alert.alert(`Unlock ${pack.name}`, `Cost: ${pack.coin_price} ${currency.softPlural.toLowerCase()}`, [
      { text: "Cancel" },
      {
        text: "Unlock",
        onPress: () => unlockMutation.mutate(pack.id),
      },
    ]);
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color="#2563EB" />
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={packs}
        numColumns={2}
        keyExtractor={(p) => p.id}
        className="flex-1 bg-gray-50"
        contentContainerClassName="p-3"
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />
        }
        renderItem={({ item }) => (
          <View className="flex-1 m-2 bg-white rounded-xl shadow-sm overflow-hidden">
            <TouchableOpacity className="items-center p-4" onPress={() => setPreviewPack(item)}>
              <Text className="text-5xl mb-2">{item.cover_emoji}</Text>
              <Text className="font-semibold text-gray-900 text-center">{item.name}</Text>
              {item.unlocked && <Text className="text-xs text-emerald-600 mt-1">✓ {t('stickers.owned')}</Text>}
              {!item.unlocked && item.pack_type === "premium" && (
                <Text className="text-xs text-violet-600 mt-1">{item.coin_price} 🪙</Text>
              )}
              {!item.unlocked && item.pack_type === "earnable" && (
                <Text className="text-xs text-amber-600 mt-1">🏆 {t('stickers.earn')}</Text>
              )}
              {item.pack_type === "free" && !item.unlocked && (
                <Text className="text-xs text-blue-600 mt-1">{t('stickers.free')}</Text>
              )}
            </TouchableOpacity>
            {!item.unlocked && (
              <TouchableOpacity
                className={`mx-3 mb-3 py-2 rounded-lg items-center ${
                  item.pack_type === "earnable" ? "bg-amber-100" : "bg-blue-600"
                }`}
                onPress={() => handleUnlock(item)}
                disabled={unlockMutation.isPending && unlockMutation.variables === item.id}
              >
                <Text
                  className={`text-sm font-medium ${
                    item.pack_type === "earnable" ? "text-amber-700" : "text-white"
                  }`}
                >
                  {unlockMutation.isPending && unlockMutation.variables === item.id
                    ? t('stickers.unlocking')
                    : item.pack_type === "earnable"
                    ? t('stickers.earn')
                    : t('stickers.unlock')}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      />

      {/* Preview Modal */}
      <Modal
        visible={!!previewPack}
        transparent
        animationType="slide"
        onRequestClose={() => setPreviewPack(null)}
      >
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
