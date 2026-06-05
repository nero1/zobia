import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert, Modal,
  TextInput, KeyboardAvoidingView, Platform
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface ClassroomRoom {
  id: string;
  name: string;
  description: string;
  creator_id: string;
  creator_username: string;
  enrolment_fee_ngn: number | null;
  class_start_date: string | null;
  class_end_date: string | null;
  member_count: number;
}

interface Quiz {
  id: string;
  title: string;
  description: string | null;
  xp_reward: number;
  pass_score: number;
  is_active: boolean;
}

interface Enrolment {
  id: string;
  paid: boolean;
  enrolled_at: string;
}

interface CurriculumModule {
  title: string;
  description?: string;
  resources?: string[];
}

export default function ClassroomScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const [room, setRoom] = useState<ClassroomRoom | null>(null);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Module state
  const [modules, setModules] = useState<CurriculumModule[]>([]);
  const [showAddModuleModal, setShowAddModuleModal] = useState(false);
  const [moduleTitle, setModuleTitle] = useState("");
  const [moduleDescription, setModuleDescription] = useState("");
  const [moduleResources, setModuleResources] = useState("");
  const [savingModule, setSavingModule] = useState(false);

  async function loadData() {
    if (!roomId) return;
    const token = storage.getString("authToken");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const [roomRes, quizRes, modulesRes] = await Promise.all([
      fetch(`${API_BASE}/api/rooms/${roomId}`, { headers }),
      fetch(`${API_BASE}/api/classroom/${roomId}/quizzes`, { headers }),
      fetch(`${API_BASE}/api/classroom/${roomId}/modules`, { headers }),
    ]);

    if (roomRes.ok) setRoom((await roomRes.json()).data?.room ?? null);
    if (quizRes.ok) setQuizzes((await quizRes.json()).data?.quizzes ?? []);
    if (modulesRes.ok) setModules((await modulesRes.json()).data?.modules ?? []);

    // Check enrolment
    const me = await fetch(`${API_BASE}/api/users/me`, { headers });
    if (me.ok) {
      const meData = await me.json();
      // Simplified: check if enrolled via room membership
      setEnrolment(meData.data?.classroomEnrolments?.find((e: Enrolment & { room_id: string }) => e.room_id === roomId) ?? null);
      const uid = meData.data?.user?.id ?? meData.data?.id ?? meData.id ?? null;
      if (typeof uid === "string") setCurrentUserId(uid);
    }

    setLoading(false);
    setRefreshing(false);
  }

  async function handleAddModule() {
    if (!moduleTitle.trim()) {
      Alert.alert("Title required", "Please enter a module title.");
      return;
    }
    setSavingModule(true);
    const token = storage.getString("authToken");
    const resourceList = moduleResources
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
    try {
      const res = await fetch(`${API_BASE}/api/classroom/${roomId}/modules`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title: moduleTitle.trim(),
          ...(moduleDescription.trim() && { description: moduleDescription.trim() }),
          ...(resourceList.length > 0 && { resources: resourceList }),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setModules(data.data?.modules ?? []);
        setModuleTitle("");
        setModuleDescription("");
        setModuleResources("");
        setShowAddModuleModal(false);
        Alert.alert("Module added!", "The new module has been added to this classroom.");
      } else {
        Alert.alert("Error", data.message ?? data.error?.message ?? "Failed to add module.");
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setSavingModule(false);
    }
  }

  async function handleDeleteModule(index: number) {
    Alert.alert("Delete module?", "This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const token = storage.getString("authToken");
          try {
            const res = await fetch(`${API_BASE}/api/classroom/${roomId}/modules`, {
              method: "DELETE",
              headers: {
                "Content-Type": "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              body: JSON.stringify({ index }),
            });
            const data = await res.json();
            if (res.ok) setModules(data.data?.modules ?? []);
            else Alert.alert("Error", data.message ?? "Failed to delete module.");
          } catch {
            Alert.alert("Error", "Network error. Please try again.");
          }
        },
      },
    ]);
  }

  async function enroll() {
    setEnrolling(true);
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/classroom/${roomId}/enroll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ paymentMethod: "balance" }),
    });
    setEnrolling(false);
    if (res.ok) {
      const data = await res.json();
      setEnrolment(data.enrolment);
      Alert.alert("Enrolled!", `You're now enrolled. +${data.xpAwarded} XP earned.`);
    } else {
      const err = await res.json();
      Alert.alert("Enrolment Failed", err.error?.message ?? "Please try again.");
    }
  }

  useEffect(() => { void loadData(); }, [roomId]);

  const isCreator = currentUserId != null && room != null && currentUserId === room.creator_id;

  if (loading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>;
  if (!room) return <View className="flex-1 items-center justify-center"><Text className="text-gray-400">Classroom not found</Text></View>;

  return (
    <View className="flex-1 bg-gray-50">
    <ScrollView
      className="flex-1"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void loadData(); }} />}
    >
      {/* Header */}
      <View className="bg-blue-700 px-5 py-6">
        <Text className="text-white text-xl font-bold">{room.name}</Text>
        <Text className="text-blue-200 text-sm mt-1">by @{room.creator_username}</Text>
        <Text className="text-blue-100 text-sm mt-2">{room.description}</Text>
        <View className="flex-row mt-3">
          <Text className="text-blue-200 text-xs">👥 {room.member_count} enrolled</Text>
          {room.enrolment_fee_ngn && room.enrolment_fee_ngn > 0 && (
            <Text className="text-blue-200 text-xs ml-4">💰 ₦{room.enrolment_fee_ngn}</Text>
          )}
        </View>
      </View>

      {/* Enrolment CTA */}
      {!enrolment ? (
        <View className="mx-4 mt-4 bg-white rounded-xl p-4 shadow-sm">
          <Text className="font-semibold text-gray-900 mb-1">Not yet enrolled</Text>
          <Text className="text-gray-500 text-sm mb-3">
            {room.enrolment_fee_ngn && room.enrolment_fee_ngn > 0
              ? `Enrol for ${room.enrolment_fee_ngn} coins`
              : "Free enrolment — join now!"}
          </Text>
          <TouchableOpacity
            className={`py-3 rounded-xl items-center ${enrolling ? "bg-gray-200" : "bg-blue-600"}`}
            onPress={() => void enroll()}
            disabled={enrolling}
          >
            <Text className="text-white font-bold">{enrolling ? "Enrolling..." : "Enrol Now"}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View className="mx-4 mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex-row items-center">
          <Text className="text-emerald-600 text-lg mr-2">✅</Text>
          <Text className="text-emerald-700 font-medium">Enrolled since {new Date(enrolment.enrolled_at).toLocaleDateString()}</Text>
        </View>
      )}

      {/* Curriculum Modules */}
      <View className="mx-4 mt-4">
        <Text className="font-bold text-gray-900 mb-3">Modules ({modules.length})</Text>
        {modules.length === 0 ? (
          <View className="bg-white rounded-xl p-4 items-center">
            <Text className="text-gray-400">No modules yet</Text>
          </View>
        ) : (
          modules.map((mod, index) => (
            <View key={index} className="bg-white rounded-xl p-4 mb-3 shadow-sm">
              <View className="flex-row items-start justify-between">
                <View className="flex-1">
                  <Text className="font-semibold text-gray-900">{mod.title}</Text>
                  {mod.description && (
                    <Text className="text-gray-500 text-sm mt-0.5">{mod.description}</Text>
                  )}
                  {mod.resources && mod.resources.length > 0 && (
                    <Text className="text-xs text-blue-500 mt-1">
                      {mod.resources.length} resource{mod.resources.length !== 1 ? "s" : ""}
                    </Text>
                  )}
                </View>
                {isCreator && (
                  <TouchableOpacity
                    onPress={() => void handleDeleteModule(index)}
                    className="ml-3 px-2 py-1"
                  >
                    <Text className="text-red-400 text-xs">Delete</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))
        )}
      </View>

      {/* Quizzes */}
      <View className="mx-4 mt-4">
        <Text className="font-bold text-gray-900 mb-3">Quizzes ({quizzes.length})</Text>
        {quizzes.length === 0 ? (
          <View className="bg-white rounded-xl p-4 items-center">
            <Text className="text-gray-400">No quizzes yet</Text>
          </View>
        ) : (
          quizzes.map((quiz) => (
            <TouchableOpacity
              key={quiz.id}
              className="bg-white rounded-xl p-4 mb-3 shadow-sm"
              onPress={() => enrolment && router.push(`/classroom/quiz/${quiz.id}` as any)}
              disabled={!enrolment}
            >
              <View className="flex-row items-start justify-between">
                <View className="flex-1">
                  <Text className="font-semibold text-gray-900">{quiz.title}</Text>
                  {quiz.description && <Text className="text-gray-500 text-sm mt-0.5">{quiz.description}</Text>}
                </View>
                <View className="items-end ml-3">
                  <Text className="text-xs text-violet-600 font-medium">+{quiz.xp_reward} XP</Text>
                  <Text className="text-xs text-gray-400">{quiz.pass_score}% to pass</Text>
                </View>
              </View>
              {!enrolment && <Text className="text-xs text-amber-600 mt-2">Enrol to access</Text>}
            </TouchableOpacity>
          ))
        )}
      </View>
      <View className="h-24" />
    </ScrollView>

    {/* FAB: Add Module (creator only) */}
    {isCreator && (
      <TouchableOpacity
        className="absolute bottom-8 right-6 bg-violet-600 rounded-full w-14 h-14 items-center justify-center shadow-lg"
        onPress={() => setShowAddModuleModal(true)}
        accessibilityLabel="Add module"
        accessibilityRole="button"
      >
        <Text className="text-white text-2xl font-bold leading-none">+</Text>
      </TouchableOpacity>
    )}

    {/* Add Module Modal */}
    <Modal
      visible={showAddModuleModal}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setShowAddModuleModal(false)}
    >
      <KeyboardAvoidingView
        className="flex-1 bg-white"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View className="flex-row items-center justify-between px-5 py-4 border-b border-gray-200">
          <Text className="text-lg font-bold text-gray-900">Add Module</Text>
          <TouchableOpacity onPress={() => setShowAddModuleModal(false)}>
            <Text className="text-gray-400 text-base font-semibold">Cancel</Text>
          </TouchableOpacity>
        </View>

        <ScrollView className="flex-1 px-5 pt-4" keyboardShouldPersistTaps="handled">
          {/* Title */}
          <Text className="text-sm font-semibold text-gray-700 mb-1">
            Title <Text className="text-red-500">*</Text>
          </Text>
          <TextInput
            className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900 mb-4"
            placeholder="e.g. Introduction to JavaScript"
            value={moduleTitle}
            onChangeText={setModuleTitle}
            maxLength={200}
          />

          {/* Description */}
          <Text className="text-sm font-semibold text-gray-700 mb-1">Description (optional)</Text>
          <TextInput
            className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900 mb-4"
            placeholder="Briefly describe this module…"
            value={moduleDescription}
            onChangeText={setModuleDescription}
            multiline
            numberOfLines={3}
            maxLength={1000}
            textAlignVertical="top"
          />

          {/* Resources */}
          <Text className="text-sm font-semibold text-gray-700 mb-1">
            Resources (optional, one URL per line)
          </Text>
          <TextInput
            className="bg-gray-100 rounded-xl px-4 py-3 text-gray-900 mb-6"
            placeholder={"https://example.com/lesson1\nhttps://example.com/slides"}
            value={moduleResources}
            onChangeText={setModuleResources}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
          />

          <TouchableOpacity
            className={`rounded-xl py-4 items-center mb-8 ${savingModule ? "bg-gray-300" : "bg-violet-600"}`}
            onPress={() => void handleAddModule()}
            disabled={savingModule}
          >
            <Text className="text-white font-bold text-base">
              {savingModule ? "Saving…" : "Add Module"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
    </View>
  );
}
