import React, { useEffect, useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { storage } from "@/lib/offline/store";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

type OptionKey = "a" | "b" | "c" | "d";

interface Question {
  id: string;
  question: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  position: number;
}

interface QuizDetail {
  id: string;
  room_id: string;
  title: string;
  description: string | null;
  xp_reward: number;
  pass_score: number;
  questions: Question[];
}

interface AttemptResult {
  score: number;
  passed: boolean;
  xp_awarded: number;
}

export default function QuizScreen() {
  const { quizId } = useLocalSearchParams<{ quizId: string }>();
  const router = useRouter();
  const [quiz, setQuiz] = useState<QuizDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, OptionKey>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);

  useEffect(() => {
    if (!quizId) return;
    const token = storage.getString("authToken");
    // We need roomId — in practice it's passed via route params or fetched
    fetch(`${API_BASE}/api/classroom/quizzes/${quizId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => r.json())
      .then((d) => setQuiz(d.data?.quiz ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [quizId]);

  function selectAnswer(questionId: string, option: OptionKey) {
    setAnswers((prev) => ({ ...prev, [questionId]: option }));
  }

  async function submitQuiz() {
    if (!quiz) return;
    const unanswered = quiz.questions.filter((q) => !answers[q.id]);
    if (unanswered.length > 0) {
      Alert.alert("Incomplete", `Please answer all ${quiz.questions.length} questions.`);
      return;
    }
    setSubmitting(true);
    const token = storage.getString("authToken");
    const res = await fetch(`${API_BASE}/api/classroom/${quiz.room_id}/quizzes/${quiz.id}/attempt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ answers }),
    });
    setSubmitting(false);
    if (res.ok) {
      const data = await res.json();
      setResult(data.data);
    } else {
      Alert.alert("Error", "Submission failed. Please try again.");
    }
  }

  if (loading) return <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>;
  if (!quiz) return <View className="flex-1 items-center justify-center"><Text className="text-gray-400">Quiz not found</Text></View>;

  // Results screen
  if (result) {
    return (
      <View className="flex-1 bg-gray-50 items-center justify-center px-6">
        <Text className="text-6xl mb-4">{result.passed ? "🎉" : "😔"}</Text>
        <Text className="text-2xl font-bold text-gray-900 mb-2">
          {result.passed ? "You Passed!" : "Not Quite"}
        </Text>
        <Text className="text-5xl font-bold text-blue-600 mb-2">{result.score}%</Text>
        <Text className="text-gray-500 mb-6">
          {result.passed ? `Required: ${quiz.pass_score}% — you exceeded it!` : `Need ${quiz.pass_score}% to pass`}
        </Text>
        {result.xp_awarded > 0 && (
          <View className="bg-violet-100 rounded-xl px-6 py-3 mb-6">
            <Text className="text-violet-700 font-bold text-center">+{result.xp_awarded} Knowledge XP earned!</Text>
          </View>
        )}
        <TouchableOpacity className="w-full bg-blue-600 rounded-xl py-4 items-center" onPress={() => router.back()}>
          <Text className="text-white font-bold">Back to Classroom</Text>
        </TouchableOpacity>
        {!result.passed && (
          <TouchableOpacity className="mt-3" onPress={() => { setResult(null); setAnswers({}); setCurrentIndex(0); }}>
            <Text className="text-blue-600 font-medium">Try Again</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const question = quiz.questions[currentIndex];
  const options: { key: OptionKey; text: string }[] = [
    { key: "a", text: question.option_a },
    { key: "b", text: question.option_b },
    { key: "c", text: question.option_c },
    { key: "d", text: question.option_d },
  ];
  const selected = answers[question.id];
  const isLast = currentIndex === quiz.questions.length - 1;

  return (
    <View className="flex-1 bg-gray-50">
      {/* Progress */}
      <View className="bg-white px-4 py-3 border-b border-gray-100">
        <View className="flex-row justify-between mb-1">
          <Text className="text-gray-500 text-sm">{quiz.title}</Text>
          <Text className="text-gray-500 text-sm">{currentIndex + 1} / {quiz.questions.length}</Text>
        </View>
        <View className="bg-gray-100 rounded-full h-2">
          <View className="bg-blue-600 h-full rounded-full" style={{ width: `${((currentIndex + 1) / quiz.questions.length) * 100}%` }} />
        </View>
      </View>

      <ScrollView className="flex-1 px-4 py-5">
        <Text className="text-lg font-semibold text-gray-900 mb-6">{question.question}</Text>

        {options.map(({ key, text }) => (
          <TouchableOpacity
            key={key}
            className={`rounded-xl p-4 mb-3 border-2 ${
              selected === key ? "bg-blue-50 border-blue-600" : "bg-white border-gray-200"
            }`}
            onPress={() => selectAnswer(question.id, key)}
          >
            <View className="flex-row items-center">
              <View className={`w-7 h-7 rounded-full border-2 items-center justify-center mr-3 ${
                selected === key ? "bg-blue-600 border-blue-600" : "border-gray-300"
              }`}>
                <Text className={`text-sm font-bold ${selected === key ? "text-white" : "text-gray-500"}`}>
                  {key.toUpperCase()}
                </Text>
              </View>
              <Text className={`flex-1 ${selected === key ? "text-blue-800 font-medium" : "text-gray-700"}`}>{text}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Navigation */}
      <View className="flex-row px-4 py-4 bg-white border-t border-gray-100 gap-3">
        {currentIndex > 0 && (
          <TouchableOpacity
            className="flex-1 border border-gray-200 rounded-xl py-3 items-center"
            onPress={() => setCurrentIndex((i) => i - 1)}
          >
            <Text className="text-gray-600 font-medium">← Back</Text>
          </TouchableOpacity>
        )}
        {!isLast ? (
          <TouchableOpacity
            className={`flex-1 rounded-xl py-3 items-center ${selected ? "bg-blue-600" : "bg-gray-200"}`}
            onPress={() => selected && setCurrentIndex((i) => i + 1)}
            disabled={!selected}
          >
            <Text className={`font-medium ${selected ? "text-white" : "text-gray-400"}`}>Next →</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            className={`flex-1 rounded-xl py-3 items-center ${submitting ? "bg-gray-200" : "bg-emerald-600"}`}
            onPress={() => void submitQuiz()}
            disabled={submitting}
          >
            <Text className={`font-bold ${submitting ? "text-gray-400" : "text-white"}`}>
              {submitting ? "Submitting..." : "Submit Quiz"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
export { ErrorBoundary } from '@/components/ui/ScreenErrorBoundary';
