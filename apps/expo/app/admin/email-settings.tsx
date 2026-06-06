import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Switch, RefreshControl
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface EmailSettings {
  email_all_enabled: boolean;
  email_non_critical_enabled: boolean;
}

export default function AdminEmailSettingsScreen() {
  const [settings, setSettings] = useState<EmailSettings>({
    email_all_enabled: true,
    email_non_critical_enabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function loadSettings() {
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/email-settings`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setSettings({
        email_all_enabled: data.data?.email_all_enabled ?? true,
        email_non_critical_enabled: data.data?.email_non_critical_enabled ?? true,
      });
    }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void loadSettings(); }, []);

  async function saveSettings() {
    setSaving(true);
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/email-settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(settings),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      Alert.alert("Saved", "Email settings updated successfully.");
    } else {
      Alert.alert("Error", "Failed to save email settings.");
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
    <ScrollView
      className="flex-1 bg-gray-50"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadSettings(); }} />}
    >
      <View className="mx-4 mt-4 bg-white rounded-xl p-4 shadow-sm mb-4">
        <Text className="text-base font-bold text-gray-900 mb-1">Email Settings</Text>
        <Text className="text-gray-500 text-sm mb-4">
          Control platform-wide email delivery. Disabling all emails overrides all other settings.
        </Text>

        <View className="border-b border-gray-100 pb-4 mb-4">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 mr-4">
              <Text className="font-medium text-gray-900">All Email Enabled</Text>
              <Text className="text-gray-500 text-sm mt-0.5">
                Master switch — disabling this turns off ALL platform emails.
              </Text>
            </View>
            <Switch
              value={settings.email_all_enabled}
              onValueChange={(val) => setSettings((s) => ({ ...s, email_all_enabled: val }))}
              trackColor={{ false: "#d1d5db", true: "#2563EB" }}
              thumbColor="#fff"
            />
          </View>
        </View>

        <View>
          <View className="flex-row items-center justify-between">
            <View className="flex-1 mr-4">
              <Text className={`font-medium ${settings.email_all_enabled ? "text-gray-900" : "text-gray-400"}`}>
                Non-Critical Email Enabled
              </Text>
              <Text className={`text-sm mt-0.5 ${settings.email_all_enabled ? "text-gray-500" : "text-gray-300"}`}>
                Controls promotional, digest, and non-essential emails.
              </Text>
            </View>
            <Switch
              value={settings.email_non_critical_enabled}
              onValueChange={(val) =>
                setSettings((s) => ({ ...s, email_non_critical_enabled: val }))
              }
              disabled={!settings.email_all_enabled}
              trackColor={{ false: "#d1d5db", true: "#2563EB" }}
              thumbColor="#fff"
            />
          </View>
        </View>
      </View>

      {!settings.email_all_enabled && (
        <View className="mx-4 mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <Text className="text-red-700 text-sm font-medium">
            Warning: All platform emails are currently disabled.
          </Text>
        </View>
      )}

      <View className="mx-4 mb-8">
        <TouchableOpacity
          className="bg-blue-600 rounded-xl py-4 items-center shadow-sm"
          onPress={() => void saveSettings()}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white font-semibold text-base">Save Settings</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
