"use client";

/**
 * components/classroom/QuizBuilder.tsx
 *
 * Form for creators to build a multiple-choice quiz for a classroom
 * (POST /api/classroom/:roomId/quizzes — Knowledge Track Level 40 gate
 * enforced server-side). Sends the exact payload shape the API validates
 * (`question`, `option_a..d`, lowercase `correct_option`); the previous
 * version posted `question_text`/`options[]`, which the API always rejected.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { classroomApi, ClassroomApiError } from "@/lib/classroom/clientApi";

type OptionKey = "a" | "b" | "c" | "d";
const OPTION_KEYS: OptionKey[] = ["a", "b", "c", "d"];

interface DraftQuestion {
  id: string;
  question: string;
  options: Record<OptionKey, string>;
  correct: OptionKey;
}

function makeQuestion(): DraftQuestion {
  return { id: crypto.randomUUID(), question: "", options: { a: "", b: "", c: "", d: "" }, correct: "a" };
}

export function QuizBuilder({ roomId, onCreated, onCancel }: { roomId: string; onCreated: () => void; onCancel?: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [xpReward, setXpReward] = useState(50);
  const [passScore, setPassScore] = useState(70);
  const [questions, setQuestions] = useState<DraftQuestion[]>([makeQuestion()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (id: string, patch: Partial<DraftQuestion>) => setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await classroomApi(`/${roomId}/quizzes`, {
        method: "POST",
        body: {
          title: title.trim(),
          description: description.trim() || undefined,
          xp_reward: xpReward,
          pass_score: passScore,
          questions: questions.map((q) => ({
            question: q.question.trim(),
            option_a: q.options.a.trim(),
            option_b: q.options.b.trim(),
            option_c: q.options.c.trim(),
            option_d: q.options.d.trim(),
            correct_option: q.correct,
          })),
        },
      });
      setTitle("");
      setDescription("");
      setQuestions([makeQuestion()]);
      onCreated();
    } catch (err) {
      const e2 = err as ClassroomApiError;
      setError(translateApiError(t, e2.code, e2.message));
    } finally {
      setSubmitting(false);
    }
  }

  const field = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/50 p-4 dark:border-violet-900 dark:bg-violet-950/30">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      <input className={field} required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("classroom.quiz.titlePlaceholder", "Quiz title, e.g. Chapter 1 — Foundations")} />
      <textarea className={field} rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("classroom.quiz.descriptionPlaceholder", "Description (optional)")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-neutral-500">
          {t("classroom.quiz.xpReward", "Knowledge XP for passing (max 500)")}
          <input type="number" min={1} max={500} className={`mt-1 ${field}`} value={xpReward} onChange={(e) => setXpReward(Math.min(500, Math.max(1, parseInt(e.target.value || "1", 10) || 1)))} />
        </label>
        <label className="text-xs text-neutral-500">
          {t("classroom.quiz.passScore", "Pass mark (%)")}
          <input type="number" min={1} max={100} className={`mt-1 ${field}`} value={passScore} onChange={(e) => setPassScore(Math.min(100, Math.max(1, parseInt(e.target.value || "1", 10) || 1)))} />
        </label>
      </div>
      {questions.map((q, i) => (
        <div key={q.id} className="space-y-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500">{t("classroom.quiz.questionN", "Question {{n}}", { n: i + 1 })}</span>
            {questions.length > 1 && (
              <button type="button" onClick={() => setQuestions((qs) => qs.filter((x) => x.id !== q.id))} className="text-xs text-red-500">
                {t("classroom.module.delete", "Delete")}
              </button>
            )}
          </div>
          <input className={field} required minLength={5} maxLength={500} value={q.question} onChange={(e) => update(q.id, { question: e.target.value })} placeholder={t("classroom.quiz.questionPlaceholder", "Question")} />
          {OPTION_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="radio" name={`correct-${q.id}`} checked={q.correct === k} onChange={() => update(q.id, { correct: k })} aria-label={t("classroom.quiz.markCorrect", "Mark as correct answer")} />
              <span className="w-4 text-xs font-bold uppercase text-neutral-500">{k}</span>
              <input className={field} required maxLength={200} value={q.options[k]} onChange={(e) => update(q.id, { options: { ...q.options, [k]: e.target.value } })} placeholder={t("classroom.quiz.optionPlaceholder", "Answer option")} />
            </label>
          ))}
        </div>
      ))}
      <p className="text-[11px] text-neutral-500">{t("classroom.quiz.correctHint", "Select the radio button next to the correct answer for each question.")}</p>
      <div className="flex flex-wrap gap-2">
        {questions.length < 50 && (
          <button type="button" onClick={() => setQuestions((qs) => [...qs, makeQuestion()])} className="rounded-lg border border-violet-300 px-3 py-1.5 text-sm font-semibold text-violet-600 dark:border-violet-800 dark:text-violet-400">
            {t("classroom.quiz.addQuestion", "+ Add question")}
          </button>
        )}
        <button type="submit" disabled={submitting} className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          {submitting ? t("classroom.module.saving", "Saving…") : t("classroom.quiz.create", "Create quiz")}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg border border-neutral-300 px-4 py-1.5 text-sm dark:border-neutral-700 dark:text-neutral-200">
            {t("classroom.common.cancel", "Cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
