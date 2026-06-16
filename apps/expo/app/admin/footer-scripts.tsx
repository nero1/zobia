import React, { useEffect, useState } from "react";
import {
  View, Text, FlatList, TouchableOpacity, Switch,
  Alert, ActivityIndicator, RefreshControl, TextInput, Modal
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface FooterScript {
  id: string;
  name: string;
  content: string;
  isActive: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
}

const EMPTY_FORM = { name: "", content: "" };

export default function AdminFooterScriptsScreen() {
  const [scripts, setScripts] = useState<FooterScript[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function loadScripts() {
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/footer-scripts`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => null);
    if (res?.ok) {
      const data = await res.json();
      setScripts(data.data?.scripts ?? []);
    }
    setLoading(false);
    setRefreshing(false);
  }

  useEffect(() => { void loadScripts(); }, []);

  async function toggleActive(script: FooterScript) {
    setTogglingId(script.id);
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/footer-scripts/${script.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ isActive: !script.isActive }),
    }).catch(() => null);
    if (res?.ok) {
      setScripts((prev) =>
        prev.map((s) => s.id === script.id ? { ...s, isActive: !s.isActive } : s)
      );
    } else {
      Alert.alert("Error", "Failed to update script. Please try again.");
    }
    setTogglingId(null);
  }

  async function deleteScript(id: string, name: string) {
    Alert.alert("Delete script?", `Delete "${name}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          const token = storage.getString("authToken");
          const res = await fetch(`${API_BASE}/api/admin/footer-scripts/${id}`, {
            method: "DELETE",
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }).catch(() => null);
          if (res?.ok) {
            setScripts((prev) => prev.filter((s) => s.id !== id));
          } else {
            Alert.alert("Error", "Failed to delete script.");
          }
        }
      },
    ]);
  }

  async function addScript() {
    if (!form.name.trim() || !form.content.trim()) {
      Alert.alert("Validation", "Name and script content are required.");
      return;
    }
    setSaving(true);
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/admin/footer-scripts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ name: form.name.trim(), content: form.content.trim() }),
    }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      const data = await res.json();
      const created: FooterScript = data.data?.script;
      if (created) setScripts((prev) => [...prev, created]);
      setShowAdd(false);
      setForm(EMPTY_FORM);
    } else {
      Alert.alert("Error", "Failed to add footer script.");
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
        data={scripts}
        keyExtractor={(s) => s.id}
        className="bg-gray-50"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadScripts(); }} />}
        ListHeaderComponent={
          <TouchableOpacity
            className="mx-3 mt-4 mb-2 bg-blue-600 rounded-xl py-3 items-center"
            onPress={() => { setForm(EMPTY_FORM); setShowAdd(true); }}
          >
            <Text className="text-white font-semibold">+ Add Footer Script</Text>
          </TouchableOpacity>
        }
        ListEmptyComponent={
          <View className="items-center py-8">
            <Text className="text-gray-400">No footer scripts</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className="bg-white mx-3 my-2 rounded-xl p-4 shadow-sm">
            <View className="flex-row items-center justify-between mb-1">
              <Text className="font-semibold text-gray-900 flex-1 mr-2" numberOfLines={1}>{item.name}</Text>
              <Switch
                value={item.isActive}
                onValueChange={() => void toggleActive(item)}
                disabled={togglingId === item.id}
                trackColor={{ false: "#d1d5db", true: "#2563EB" }}
                thumbColor="#fff"
              />
            </View>
            <Text className="text-gray-500 text-xs font-mono mt-1 mb-3" numberOfLines={2}>
              {item.content}
            </Text>
            <TouchableOpacity
              className="self-start bg-red-100 rounded-lg px-4 py-1.5"
              onPress={() => void deleteScript(item.id, item.name)}
            >
              <Text className="text-red-700 font-medium text-sm">Delete</Text>
            </TouchableOpacity>
          </View>
        )}
      />

      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-white rounded-t-2xl p-6">
            <Text className="text-lg font-bold text-gray-900 mb-4">Add Footer Script</Text>
            <Text className="text-gray-600 text-sm font-medium mb-1">Name</Text>
            <TextInput
              className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900 mb-3"
              value={form.name}
              onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
              placeholder="e.g. Google Analytics"
              placeholderTextColor="#9CA3AF"
            />
            <Text className="text-gray-600 text-sm font-medium mb-1">Script Tag / Content</Text>
            <TextInput
              className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900 mb-4 font-mono"
              value={form.content}
              onChangeText={(v) => setForm((f) => ({ ...f, content: v }))}
              placeholder={'<script>…</script>'}
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View className="flex-row gap-3">
              <TouchableOpacity
                className="flex-1 border border-gray-300 rounded-xl py-3 items-center"
                onPress={() => setShowAdd(false)}
                disabled={saving}
              >
                <Text className="text-gray-700 font-medium">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className="flex-1 bg-blue-600 rounded-xl py-3 items-center"
                onPress={() => void addScript()}
                disabled={saving}
              >
                {saving ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-semibold">Add</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
