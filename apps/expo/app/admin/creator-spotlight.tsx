import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, FlatList, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl, TextInput, Modal, KeyboardAvoidingView, Platform
} from "react-native";
import { useTranslation } from "react-i18next";
import { storage } from "@/lib/offline/store";
import { translateApiError } from "@/lib/i18n/apiErrors";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface Spotlight {
  id: string;
  creator_id: string;
  month_year: string;
  blurb: string | null;
  is_active: boolean;
  created_at: string;
  creator_username: string | null;
  creator_display_name: string | null;
  admin_username: string | null;
}

const EMPTY_FORM = { creatorId: "", monthYear: "", blurb: "" };

function formatMonthYear(my: string) {
  const [year, month] = my.split("-");
  const d = new Date(Number(year), Number(month) - 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function AdminCreatorSpotlightScreen() {
  const { t } = useTranslation();
  const [spotlights, setSpotlights] = useState<Spotlight[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function loadSpotlights() {
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/creator-spotlight`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setSpotlights(data.spotlights ?? []);
    }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void loadSpotlights(); }, []);

  async function createSpotlight() {
    if (!form.creatorId.trim() || !form.monthYear.trim()) {
      Alert.alert("Validation", "Creator ID and month/year are required.");
      return;
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(form.monthYear.trim())) {
      Alert.alert("Validation", "Month/year must be in YYYY-MM format (e.g. 2025-07).");
      return;
    }
    setSaving(true);
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/creator-spotlight`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        creatorId: form.creatorId.trim(),
        monthYear: form.monthYear.trim(),
        blurb: form.blurb.trim() || undefined,
      }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      const data = await res.json();
      const created: Spotlight = data.spotlight;
      if (created) setSpotlights((prev) => [created, ...prev]);
      setShowCreate(false);
      setForm(EMPTY_FORM);
    } else {
      const err = await res?.json().catch(() => null);
      Alert.alert("Error", translateApiError(t, err?.error?.code, err?.error?.message ?? "Failed to create spotlight."));
    }
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator color="#2563EB" />
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={spotlights}
        keyExtractor={(s) => s.id}
        className="bg-gray-50"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadSpotlights(); }} />}
        ListHeaderComponent={
          <TouchableOpacity
            className="mx-3 mt-4 mb-2 bg-blue-600 rounded-xl py-3 items-center"
            onPress={() => { setForm(EMPTY_FORM); setShowCreate(true); }}
          >
            <Text className="text-white font-semibold">+ New Spotlight</Text>
          </TouchableOpacity>
        }
        ListEmptyComponent={
          <View className="items-center py-8">
            <Text className="text-gray-400">No spotlights yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className="bg-white mx-3 my-2 rounded-xl p-4 shadow-sm">
            <View className="flex-row items-start justify-between mb-1">
              <View className="flex-1 mr-2">
                <Text className="font-semibold text-gray-900">
                  {item.creator_display_name ?? item.creator_username ?? item.creator_id}
                </Text>
                {item.creator_username && (
                  <Text className="text-gray-500 text-sm">@{item.creator_username}</Text>
                )}
              </View>
              <View className="items-end">
                <Text className="text-sm font-medium text-blue-700">{formatMonthYear(item.month_year)}</Text>
                {item.is_active && (
                  <View className="mt-1 bg-emerald-100 px-2 py-0.5 rounded-full">
                    <Text className="text-emerald-700 text-xs font-medium">Active</Text>
                  </View>
                )}
              </View>
            </View>
            {item.blurb ? (
              <Text className="text-gray-600 text-sm mt-1" numberOfLines={3}>{item.blurb}</Text>
            ) : null}
            {item.admin_username && (
              <Text className="text-gray-400 text-xs mt-2">Created by @{item.admin_username}</Text>
            )}
          </View>
        )}
      />

      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View className="flex-1 bg-black/50 justify-end">
            <View className="bg-white rounded-t-2xl p-6">
              <Text className="text-lg font-bold text-gray-900 mb-4">New Creator Spotlight</Text>

              <Text className="text-gray-600 text-sm font-medium mb-1">Creator ID (UUID)</Text>
              <TextInput
                className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900 mb-3"
                value={form.creatorId}
                onChangeText={(v) => setForm((f) => ({ ...f, creatorId: v }))}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text className="text-gray-600 text-sm font-medium mb-1">Month / Year</Text>
              <TextInput
                className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900 mb-3"
                value={form.monthYear}
                onChangeText={(v) => setForm((f) => ({ ...f, monthYear: v }))}
                placeholder="2025-07"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Text className="text-gray-600 text-sm font-medium mb-1">Spotlight Message (optional)</Text>
              <TextInput
                className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900 mb-4"
                value={form.blurb}
                onChangeText={(v) => setForm((f) => ({ ...f, blurb: v }))}
                placeholder="Why this creator is special this month…"
                placeholderTextColor="#9CA3AF"
                multiline
                numberOfLines={4}
                textAlignVertical="top"
              />

              <View className="flex-row gap-3">
                <TouchableOpacity
                  className="flex-1 border border-gray-300 rounded-xl py-3 items-center"
                  onPress={() => setShowCreate(false)}
                  disabled={saving}
                >
                  <Text className="text-gray-700 font-medium">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="flex-1 bg-blue-600 rounded-xl py-3 items-center"
                  onPress={() => void createSpotlight()}
                  disabled={saving}
                >
                  {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold">Create</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
