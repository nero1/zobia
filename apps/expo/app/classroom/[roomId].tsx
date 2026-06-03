import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert
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

export default function ClassroomScreen() {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const router = useRouter();
  const [room, setRoom] = useState<ClassroomRoom | null>(null);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function loadData() {
    if (!roomId) return;
    const token = storage.getString("authToken");
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const [roomRes, quizRes] = await Promise.all([
      fetch(`${API_BASE}/api/rooms/${roomId}`, { headers }),
      fetch(`${API_BASE}/api/classroom/${roomId}/quizzes`, { headers }),
    ]);

    if (roomRes.ok) setRoom((await roomRes.json()).data?.room ?? null);
    if (quizRes.ok) setQuizzes((await quizRes.json()).data?.quizzes ?? []);

    // Check enrolment
    const me = await fetch(`${API_BASE}/api/users/me`, { headers });
    if (me.ok) {
      const meData = await me.json();
      // Simplified: check if enrolled via room membership
      setEnrolment(meData.data?.classroomEnrolments?.find((e: Enrolment & { room_id: string }) => e.room_id === roomId) ?? null);
    }

    setLoading(false);
    setRefreshing(false);
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

  if (loading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>;
  if (!room) return <View className="flex-1 items-center justify-center"><Text className="text-gray-400">Classroom not found</Text></View>;

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
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
      <View className="h-8" />
    </ScrollView>
  );
}
