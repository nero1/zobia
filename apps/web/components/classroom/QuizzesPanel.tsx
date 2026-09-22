"use client";

/**
 * components/classroom/QuizzesPanel.tsx
 *
 * Classroom quizzes: members take them (one attempt each — passing awards
 * the quiz's Knowledge XP plus classroom points, a perfect score earns the
 * Quiz Ace badge); the creator builds and retires them.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";
import { QuizBuilder } from "@/components/classroom/QuizBuilder";

interface QuizSummary {
  id: string;
  title: string;
  description: string | null;
  xp_reward: number;
  pass_score: number;
  questionCount: number;
  attempted: boolean;
  myScore: number | null;
  passed: boolean;
}

interface QuizDetail {
  quiz: { id: string; title: string; description: string | null; xpReward: number; passScore: number };
  questions: Array<{ id: string; question: string; options: Array<{ key: "a" | "b" | "c" | "d"; text: string }> }>;
  attempt: { score: number; passed: boolean; xpAwarded: number } | null;
}

interface AttemptResult {
  score: number;
  passed: boolean;
  correctCount: number;
  totalQuestions: number;
  xpAwarded: number;
  classroomPointsAwarded?: number;
}

function QuizTaker({ roomId, quizId, onDone }: { roomId: string; quizId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const detail = useQuery({ queryKey: ["classroom", roomId, "quiz", quizId], queryFn: () => classroomApi<QuizDetail>(`/${roomId}/quizzes/${quizId}`) });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () => classroomApi<AttemptResult>(`/${roomId}/quizzes/${quizId}/attempt`, { method: "POST", body: { answers } }),
    onSuccess: (r) => {
      setResult(r);
      onDone();
    },
    onError: (e) => setError(translateApiError(t, (e as ClassroomApiError).code, (e as Error).message)),
  });

  if (detail.isPending) return <div className="h-32 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />;
  if (!detail.data) return <p className="text-sm text-red-600">{t("classroom.error.loadFailed", "Failed to load classrooms")}</p>;
  const { questions, attempt, quiz } = detail.data;
  const done = result ?? (attempt ? { ...attempt, correctCount: 0, totalQuestions: questions.length } : null);

  if (done) {
    return (
      <div className={`rounded-xl p-4 text-sm ${done.passed ? "bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"}`}>
        <p className="font-semibold">
          {done.passed ? t("classroom.quiz.passed", "Passed with {{score}}%!", { score: done.score }) : t("classroom.quiz.failed", "You scored {{score}}% (pass mark {{pass}}%).", { score: done.score, pass: quiz.passScore })}
        </p>
        {result && result.passed && (
          <p className="mt-1">
            {t("classroom.quiz.rewards", "+{{xp}} Knowledge XP · +{{points}} classroom points", { xp: result.xpAwarded, points: result.classroomPointsAwarded ?? 0 })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {questions.map((q, i) => (
        <fieldset key={q.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
          <legend className="px-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {i + 1}. {q.question}
          </legend>
          {q.options.map((o) => (
            <label key={o.key} className="mt-1 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input type="radio" name={q.id} checked={answers[q.id] === o.key} onChange={() => setAnswers({ ...answers, [q.id]: o.key })} />
              {o.text}
            </label>
          ))}
        </fieldset>
      ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-[11px] text-neutral-500">{t("classroom.quiz.oneAttempt", "You get one attempt — check your answers before submitting.")}</p>
      <button
        type="button"
        disabled={submit.isPending || Object.keys(answers).length < questions.length}
        onClick={() => submit.mutate()}
        className="rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {t("classroom.quiz.submit", "Submit answers")}
      </button>
    </div>
  );
}

export function QuizzesPanel({ roomId, canTake, canManage }: { roomId: string; canTake: boolean; canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const key = ["classroom", roomId, "quizzes"];
  const quizzes = useQuery({ queryKey: key, queryFn: () => classroomApi<{ quizzes: QuizSummary[] }>(`/${roomId}/quizzes`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["classroom", roomId, "home"] });
  };
  const retire = useMutation({ mutationFn: (id: string) => classroomApi(`/${roomId}/quizzes/${id}`, { method: "DELETE" }), onSettled: refresh });

  const list = quizzes.data?.quizzes ?? [];
  if (!canManage && list.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500">{t("classroom.quiz.title", "Quizzes")}</h3>
      {list.map((q) => (
        <div key={q.id} className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{q.title}</p>
              <p className="text-[11px] text-neutral-500">
                {t("classroom.quiz.meta", "{{count}} questions · pass {{pass}}% · +{{xp}} XP", { count: q.questionCount, pass: q.pass_score, xp: q.xp_reward })}
                {q.attempted && ` · ${q.passed ? t("classroom.quiz.statusPassed", "Passed") : t("classroom.quiz.statusAttempted", "Attempted")} (${q.myScore}%)`}
              </p>
            </div>
            <div className="flex gap-2">
              {canTake && (
                <button type="button" onClick={() => setOpenId(openId === q.id ? null : q.id)} className="rounded-lg bg-violet-600 px-3 py-1 text-xs font-semibold text-white">
                  {q.attempted ? t("classroom.quiz.viewResult", "View result") : t("classroom.quiz.start", "Start quiz")}
                </button>
              )}
              {canManage && (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(t("classroom.quiz.retireConfirm", "Remove this quiz? Existing results are kept."))) retire.mutate(q.id);
                  }}
                  className="text-xs text-red-500"
                >
                  {t("classroom.module.delete", "Delete")}
                </button>
              )}
            </div>
          </div>
          {openId === q.id && (
            <div className="mt-3">
              <QuizTaker roomId={roomId} quizId={q.id} onDone={refresh} />
            </div>
          )}
        </div>
      ))}
      {canManage &&
        (building ? (
          <QuizBuilder roomId={roomId} onCreated={() => { setBuilding(false); refresh(); }} onCancel={() => setBuilding(false)} />
        ) : (
          <button type="button" onClick={() => setBuilding(true)} className="rounded-lg border border-violet-300 px-3 py-1.5 text-sm font-semibold text-violet-600 dark:border-violet-800 dark:text-violet-400">
            {t("classroom.quiz.new", "+ New quiz")}
          </button>
        ))}
    </section>
  );
}
