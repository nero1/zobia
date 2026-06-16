import React from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { AxiosError } from "axios";
import { apiClient } from "@/lib/api/client";
import { translateApiError } from "@/lib/i18n/apiErrors";

const ICON_III_XP_REQUIRED = 100_000;

interface PrestigeData {
  current_rank: string;
  xp_total: number;
  prestige_level: number;
  can_prestige: boolean;
  prestige_history: Array<{
    level: number;
    xp_at_prestige: number;
    prestiged_at: string;
  }>;
}

const PRESTIGE_BADGES = ["🌟", "⭐⭐", "🌠", "👑"];

async function fetchPrestige(): Promise<PrestigeData> {
  const { data } = await apiClient.get<{ data: PrestigeData }>("/prestige");
  return data.data;
}

async function doPrestigeRequest(): Promise<PrestigeData> {
  const { data } = await apiClient.post<{ data: PrestigeData }>("/prestige");
  return data.data;
}

export default function PrestigeScreen() {
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  const { data, isLoading, isError, refetch, isRefetching } = useQuery<PrestigeData>({
    queryKey: ["prestige"],
    queryFn: fetchPrestige,
    staleTime: 30_000,
  });

  const prestigeMutation = useMutation<PrestigeData, Error>({
    mutationFn: doPrestigeRequest,
    onSuccess: (updated) => {
      queryClient.setQueryData(["prestige"], updated);
      Alert.alert("🌟 " + t('prestige.prestigeAchieved'), t('prestige.nowLevel', { level: updated.prestige_level }));
    },
    onError: (err) => {
      const axiosErr = err as AxiosError<{ error?: { code?: string; message?: string } }>;
      const code = axiosErr.response?.data?.error?.code ?? null;
      const message = axiosErr.response?.data?.error?.message ?? err.message ?? "Prestige failed. Please try again.";
      Alert.alert("Error", translateApiError(t, code, message));
    },
  });

  function handlePrestige() {
    if (!data?.can_prestige) return;
    Alert.alert(
      t('prestige.confirmTitle'),
      t('prestige.confirmBody'),
      [
        { text: t('action.cancel', 'Cancel') },
        {
          text: t('prestige.yesPrestige'),
          style: "destructive",
          onPress: () => prestigeMutation.mutate(),
        },
      ]
    );
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color="#2563EB" />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-gray-400 mb-4">{t('prestige.loadError')}</Text>
        <TouchableOpacity onPress={() => void refetch()} className="px-4 py-2 bg-violet-600 rounded-lg">
          <Text className="text-white font-semibold">{t('action.retry', 'Retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const xpProgress = Math.min((data.xp_total / ICON_III_XP_REQUIRED) * 100, 100);

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      {/* Hero */}
      <View className="bg-gradient-to-b from-violet-700 to-violet-900 px-6 pt-8 pb-10 items-center">
        <Text className="text-5xl mb-2">{PRESTIGE_BADGES[data.prestige_level] ?? "🌟"}</Text>
        <Text className="text-white text-2xl font-bold">{t('prestige.currentPrestige')} {data.prestige_level}</Text>
        <Text className="text-violet-200 text-sm mt-1">{data.current_rank}</Text>
      </View>

      {/* Progress to prestige */}
      <View className="bg-white mx-4 -mt-4 rounded-xl p-5 shadow-sm">
        <Text className="font-semibold text-gray-800 mb-1">
          {t('prestige.progressTo', { level: data.prestige_level + 1 })}
        </Text>
        <Text className="text-gray-500 text-xs mb-3">{t('prestige.requiresIconIII')}</Text>
        <View className="bg-gray-100 rounded-full h-3 overflow-hidden">
          <View className="bg-violet-600 h-full rounded-full" style={{ width: `${xpProgress}%` }} />
        </View>
        <Text className="text-gray-600 text-xs mt-1 text-right">
          {data.xp_total.toLocaleString()} / {ICON_III_XP_REQUIRED.toLocaleString()} XP
        </Text>
      </View>

      {/* Prestige info */}
      <View className="bg-white mx-4 mt-3 rounded-xl p-4 shadow-sm">
        <Text className="font-semibold text-gray-800 mb-3">{t('prestige.whatItDoes')}</Text>
        {[
          { icon: "🔄", label: t('prestige.mainRankResetsToNewcomer') },
          { icon: "✅", label: t('prestige.trackLevelsPreserved') },
          { icon: "🏅", label: t('prestige.earnBadge') },
          { icon: "👑", label: t('prestige.badgeOnProfile') },
        ].map((item) => (
          <View key={item.label} className="flex-row items-center mb-2">
            <Text className="text-lg mr-3">{item.icon}</Text>
            <Text className="text-gray-700">{item.label}</Text>
          </View>
        ))}
      </View>

      {/* History */}
      {data.prestige_history.length > 0 && (
        <View className="bg-white mx-4 mt-3 rounded-xl p-4 shadow-sm">
          <Text className="font-semibold text-gray-800 mb-3">{t('prestige.history')}</Text>
          {data.prestige_history.map((h: PrestigeData['prestige_history'][number]) => (
            <View key={h.level} className="flex-row justify-between py-1">
              <Text className="text-gray-600">{PRESTIGE_BADGES[h.level]} {t('prestige.currentPrestige')} {h.level}</Text>
              <Text className="text-gray-400 text-sm">
                {h.xp_at_prestige.toLocaleString()} XP · {new Date(h.prestiged_at).toLocaleDateString()}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Prestige button */}
      <View className="mx-4 mt-4 mb-8">
        <TouchableOpacity
          className={`py-4 rounded-xl items-center ${data.can_prestige ? "bg-violet-600" : "bg-gray-200"}`}
          onPress={handlePrestige}
          disabled={!data.can_prestige || prestigeMutation.isPending}
        >
          <Text className={`font-bold text-base ${data.can_prestige ? "text-white" : "text-gray-400"}`}>
            {prestigeMutation.isPending
              ? t('prestige.processing')
              : data.can_prestige
              ? t('prestige.prestigeNow')
              : t('prestige.requiresLevel', { level: 'Icon III' })}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
