import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  ScrollView, Alert, ActivityIndicator
} from "react-native";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

type BroadcastType = "all" | "by_plan" | "by_role";

export default function AdminMessagesScreen() {
  const [broadcastType, setBroadcastType] = useState<BroadcastType>("all");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [telegramDelivery, setTelegramDelivery] = useState(false);
  const [sending, setSending] = useState(false);

  async function sendMessage() {
    if (!body.trim()) {
      Alert.alert("Error", "Message body is required.");
      return;
    }

    setSending(true);
    const token = storage.getString("authToken");

    const res = await fetch(`${API_BASE}/api/admin/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        broadcast_type: broadcastType,
        subject: subject.trim() || undefined,
        body: body.trim(),
        deliver_telegram: telegramDelivery,
      }),
    }).catch(() => null);

    setSending(false);

    if (res?.ok) {
      const data = await res.json();
      Alert.alert("Sent!", `Message delivered to ${data.data?.recipient_count ?? 0} users.`);
      setSubject("");
      setBody("");
    } else {
      Alert.alert("Error", "Failed to send message.");
    }
  }

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerClassName="p-4">
      <Text className="text-lg font-bold text-gray-900 mb-4">Compose Admin Message</Text>

      {/* Recipient Type */}
      <Text className="text-sm font-medium text-gray-700 mb-2">Send to</Text>
      <View className="flex-row gap-2 mb-4">
        {(["all", "by_plan", "by_role"] as BroadcastType[]).map((t) => (
          <TouchableOpacity
            key={t}
            className={`flex-1 py-2 rounded-lg border items-center ${
              broadcastType === t ? "bg-blue-600 border-blue-600" : "bg-white border-gray-200"
            }`}
            onPress={() => setBroadcastType(t)}
          >
            <Text className={`text-sm font-medium ${broadcastType === t ? "text-white" : "text-gray-600"}`}>
              {t === "all" ? "Everyone" : t === "by_plan" ? "By Plan" : "By Role"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Subject */}
      <Text className="text-sm font-medium text-gray-700 mb-1">Subject (optional)</Text>
      <TextInput
        className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-800 mb-4"
        placeholder="Message subject..."
        value={subject}
        onChangeText={setSubject}
      />

      {/* Body */}
      <Text className="text-sm font-medium text-gray-700 mb-1">Message</Text>
      <TextInput
        className="bg-white border border-gray-200 rounded-xl px-4 py-3 text-gray-800 mb-4 h-32"
        placeholder="Write your message..."
        value={body}
        onChangeText={setBody}
        multiline
        textAlignVertical="top"
      />

      {/* Telegram toggle */}
      <TouchableOpacity
        className="flex-row items-center mb-6"
        onPress={() => setTelegramDelivery((v) => !v)}
      >
        <View className={`w-5 h-5 rounded border-2 mr-2 items-center justify-center ${telegramDelivery ? "bg-blue-600 border-blue-600" : "border-gray-300"}`}>
          {telegramDelivery && <Text className="text-white text-xs">✓</Text>}
        </View>
        <Text className="text-gray-700">Also deliver via Telegram</Text>
      </TouchableOpacity>

      <TouchableOpacity
        className={`py-4 rounded-xl items-center ${sending ? "bg-gray-300" : "bg-blue-600"}`}
        onPress={() => void sendMessage()}
        disabled={sending}
      >
        {sending ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-white font-bold text-base">Send Message</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}
