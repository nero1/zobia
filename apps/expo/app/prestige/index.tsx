import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";
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

export default function PrestigeScreen() {
  const [data, setData] = useState<PrestigeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [prestiging, setPrestiging] = useState(false);

  useEffect(() => {
    const token = storage.getString("authToken");
    fetch(`${API_BASE}/api/prestige`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((d) => setData(d.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function doPrestige() {
    if (!data?.can_prestige) return;
    Alert.alert(
      "Prestige Now?",
      "Your main XP rank resets to Newcomer, but all 6 track levels are preserved. You'll earn a Prestige badge. This cannot be undone.",
      [
        { text: "Cancel" },
        {
          text: "Prestige!", style: "destructive", onPress: async () => {
            setPrestiging(true);
            const token = storage.getString("authToken");
            const res = await fetch(`${API_BASE}/api/prestige`, {
              method: "POST",
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (res.ok) {
              const updated = await res.json();
              setData(updated.data);
              Alert.alert("🌟 Prestige Complete!", `You are now Prestige ${updated.data?.prestige_level ?? 1}!`);
            } else {
              Alert.alert("Error", "Prestige failed. Please try again.");
            }
            setPrestiging(false);
          },
        },
      ]
    );
  }

  if (loading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>;
  if (!data) return <View className="flex-1 items-center justify-center"><Text className="text-gray-400">Unable to load prestige data</Text></View>;

  const xpProgress = Math.min((data.xp_total / ICON_III_XP_REQUIRED) * 100, 100);

  return (
    <ScrollView className="flex-1 bg-gray-50">
      {/* Hero */}
      <View className="bg-gradient-to-b from-violet-700 to-violet-900 px-6 pt-8 pb-10 items-center">
        <Text className="text-5xl mb-2">{PRESTIGE_BADGES[data.prestige_level] ?? "🌟"}</Text>
        <Text className="text-white text-2xl font-bold">Prestige {data.prestige_level}</Text>
        <Text className="text-violet-200 text-sm mt-1">{data.current_rank}</Text>
      </View>

      {/* Progress to prestige */}
      <View className="bg-white mx-4 -mt-4 rounded-xl p-5 shadow-sm">
        <Text className="font-semibold text-gray-800 mb-1">Progress to Prestige {data.prestige_level + 1}</Text>
        <Text className="text-gray-500 text-xs mb-3">Requires Icon III (100,000 XP)</Text>
        <View className="bg-gray-100 rounded-full h-3 overflow-hidden">
          <View className="bg-violet-600 h-full rounded-full" style={{ width: `${xpProgress}%` }} />
        </View>
        <Text className="text-gray-600 text-xs mt-1 text-right">
          {data.xp_total.toLocaleString()} / {ICON_III_XP_REQUIRED.toLocaleString()} XP
        </Text>
      </View>

      {/* Prestige info */}
      <View className="bg-white mx-4 mt-3 rounded-xl p-4 shadow-sm">
        <Text className="font-semibold text-gray-800 mb-3">What Prestige Does</Text>
        {[
          { icon: "🔄", label: "Main rank resets to Newcomer" },
          { icon: "✅", label: "All 6 track levels preserved" },
          { icon: "🏅", label: "Earn a permanent Prestige badge" },
          { icon: "👑", label: "Prestige badge displayed on profile" },
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
          <Text className="font-semibold text-gray-800 mb-3">Prestige History</Text>
          {data.prestige_history.map((h) => (
            <View key={h.level} className="flex-row justify-between py-1">
              <Text className="text-gray-600">{PRESTIGE_BADGES[h.level]} Prestige {h.level}</Text>
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
          onPress={() => void doPrestige()}
          disabled={!data.can_prestige || prestiging}
        >
          <Text className={`font-bold text-base ${data.can_prestige ? "text-white" : "text-gray-400"}`}>
            {prestiging ? "Processing..." : data.can_prestige ? "✨ Prestige Now" : "Reach Icon III to Prestige"}
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
