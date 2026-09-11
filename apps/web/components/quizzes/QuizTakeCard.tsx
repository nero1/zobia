"use client";

/**
 * components/quizzes/QuizTakeCard.tsx
 *
 * Interactive "take the quiz" card for the public quiz page
 * (app/quiz/[slug]/page.tsx). Renders each question with radio buttons
 * (single/true_false) or checkboxes (multiple), grades client-side only
 * after the server responds — correctOptionIds are never trusted/rendered
 * before a graded attempt comes back, since the public page always loads
 * the quiz with includeAnswers=false.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

interface QuizOption {
  id: string;
  label: string;
}

interface QuizQuestion {
  id: string;
  prompt: string;
  type: string;
  points: number;
  options: QuizOption[];
}

interface QuizBestAttempt {
  score: number;
  totalPoints: number;
  scorePercent: number;
  passed: boolean;
}

interface QuizForCard {
  slug: string;
  passingScorePercent: number;
  maxAttemptsPerUser: number;
  questions: QuizQuestion[];
  myAttemptCount: number;
  myBestAttempt: QuizBestAttempt | null;
}

interface PerQuestionResult {
  questionId: string;
  isCorrect: boolean;
  correctOptionIds: string[];
}

interface AttemptResult {
  score: number;
  totalPoints: number;
  scorePercent: number;
  passed: boolean;
  rewardClaimed: number | null;
  perQuestionResult: PerQuestionResult[];
}

function ResultsSummary({ result, passingScorePercent }: { result: AttemptResult | QuizBestAttempt; passingScorePercent: number }) {
  const { t } = useTranslation();
  return (
    <div
      className={`rounded-xl border px-4 py-3 text-sm ${
        result.passed
          ? "border-emerald-700 bg-emerald-950/30 text-emerald-300"
          : "border-red-800 bg-red-950/30 text-red-300"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">
          {result.passed ? t("quizzes.take.passed", "Passed! 🎉") : t("quizzes.take.failed", "Not quite")}
        </span>
        <span className="tabular-nums">{result.score}/{result.totalPoints} · {result.scorePercent}%</span>
      </div>
      <p className="mt-1 text-xs opacity-90">
        {t("quizzes.take.passThreshold", "Passing score: {{pct}}%", { pct: passingScorePercent })}
      </p>
    </div>
  );
}

export function QuizTakeCard({ quiz, viewerSignedIn }: { quiz: QuizForCard; viewerSignedIn: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);

  const usedAllAttempts = quiz.myAttemptCount >= quiz.maxAttemptsPerUser;
  const allAnswered = quiz.questions.every((q) => (answers[q.id]?.length ?? 0) > 0);

  function selectSingle(questionId: string, optionId: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: [optionId] }));
  }

  function toggleMultiple(questionId: string, optionId: string) {
    setAnswers((prev) => {
      const current = prev[questionId] ?? [];
      const next = current.includes(optionId) ? current.filter((x) => x !== optionId) : [...current, optionId];
      return { ...prev, [questionId]: next };
    });
  }

  async function handleSubmit() {
    if (!allAnswered || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = { answers: quiz.questions.map((q) => ({ questionId: q.id, selectedOptionIds: answers[q.id] ?? [] })) };
      const res = await fetch(`/api/quizzes/${quiz.slug}/attempt`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        router.push("/auth/login");
        return;
      }
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const err = new Error(json?.error?.message ?? "Failed to submit quiz") as Error & { code?: string | null };
        err.code = json?.error?.code ?? null;
        throw err;
      }
      setResult(json.data as AttemptResult);
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(translateApiError(t, err.code, err.message || "Something went wrong"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!viewerSignedIn) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-center">
        <p className="text-sm text-muted-foreground">{t("quizzes.take.signInPrompt", "Sign in to take this quiz.")}</p>
        <Link href="/auth/login" className="mt-3 inline-block rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
          {t("quizzes.take.signIn", "Sign in")}
        </Link>
      </div>
    );
  }

  if (result) {
    const byQuestion = new Map(result.perQuestionResult.map((r) => [r.questionId, r]));
    return (
      <div className="space-y-4">
        <ResultsSummary result={result} passingScorePercent={quiz.passingScorePercent} />
        {result.rewardClaimed != null && (
          <p className="text-xs font-medium text-amber-400">
            {t("quizzes.take.rewardClaimed", "You earned {{amount}} credits from the reward pot!", { amount: result.rewardClaimed })}
          </p>
        )}
        <div className="space-y-3">
          {quiz.questions.map((q, idx) => {
            const qResult = byQuestion.get(q.id);
            const mySelection = answers[q.id] ?? [];
            const correctIds = qResult?.correctOptionIds ?? [];
            return (
              <div key={q.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">{idx + 1}. {q.prompt}</p>
                  <span className={`shrink-0 text-xs font-semibold ${qResult?.isCorrect ? "text-emerald-400" : "text-red-400"}`}>
                    {qResult?.isCorrect ? t("quizzes.take.correct", "✓ Correct") : t("quizzes.take.incorrect", "✗ Incorrect")}
                  </span>
                </div>
                <div className="mt-2 space-y-1.5">
                  {q.options.map((o) => {
                    const isCorrectOption = correctIds.includes(o.id);
                    const wasSelected = mySelection.includes(o.id);
                    return (
                      <div
                        key={o.id}
                        className={`rounded-lg border px-3 py-1.5 text-sm ${
                          isCorrectOption
                            ? "border-emerald-700 bg-emerald-950/30 text-emerald-300"
                            : wasSelected
                              ? "border-red-800 bg-red-950/30 text-red-300"
                              : "border-border text-muted-foreground"
                        }`}
                      >
                        {isCorrectOption && <span className="mr-1">✓</span>}
                        {!isCorrectOption && wasSelected && <span className="mr-1">✗</span>}
                        {o.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (usedAllAttempts) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          {t("quizzes.take.noAttemptsLeft", "You've used all your attempts on this quiz.")}
        </div>
        {quiz.myBestAttempt && <ResultsSummary result={quiz.myBestAttempt} passingScorePercent={quiz.passingScorePercent} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-xs text-red-300">{error}</div>
      )}
      {quiz.questions.map((q, idx) => {
        const selectedForQ = answers[q.id] ?? [];
        const isMultiple = q.type === "multiple";
        return (
          <div key={q.id} className="rounded-xl border border-border bg-card p-4">
            <p className="text-sm font-medium text-foreground">{idx + 1}. {q.prompt}</p>
            <div className="mt-2 space-y-1.5">
              {q.options.map((o) => {
                const isSelected = selectedForQ.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => (isMultiple ? toggleMultiple(q.id, o.id) : selectSingle(q.id, o.id))}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      isSelected
                        ? "border-primary-500 bg-primary-950/30 text-foreground"
                        : "border-border bg-background text-foreground hover:bg-accent"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center border ${isMultiple ? "rounded-md" : "rounded-full"} ${
                        isSelected ? "border-primary-500 bg-primary-500" : "border-neutral-500"
                      }`}
                    >
                      {isSelected && <span className="text-[10px] leading-none text-white">✓</span>}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!allAnswered || submitting}
        className="w-full rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
      >
        {submitting ? t("quizzes.take.submitting", "Submitting…") : t("quizzes.take.submit", "Submit Quiz")}
      </button>
    </div>
  );
}
