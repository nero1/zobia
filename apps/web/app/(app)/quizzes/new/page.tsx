"use client";

/**
 * app/(app)/quizzes/new/page.tsx
 *
 * Create a quiz. Mirrors app/(app)/polls/new/page.tsx's form/error-handling
 * conventions, extended for a dynamic list of questions. Client-side
 * validation mirrors the Zod schema in app/api/quizzes/route.ts: title
 * 5-200 chars, 1-25 questions, each with a 1-500 char prompt and 2-8
 * options (1-200 chars each) with at least one marked correct (exactly one
 * for single/true_false).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
const MAX_PROMPT = 500;
const MAX_OPTION = 200;
const MIN_QUESTION_OPTIONS = 2;
const MAX_QUESTION_OPTIONS = 8;
const MAX_QUESTIONS = 25;

type QuestionType = "single" | "multiple" | "true_false";

interface OptionDraft {
  key: string;
  label: string;
  isCorrect: boolean;
}

interface QuestionDraft {
  key: string;
  prompt: string;
  type: QuestionType;
  points: number;
  options: OptionDraft[];
}

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `k${keySeq}`;
}

function newOption(label = ""): OptionDraft {
  return { key: nextKey(), label, isCorrect: false };
}

function newQuestion(): QuestionDraft {
  return { key: nextKey(), prompt: "", type: "single", points: 1, options: [newOption(), newOption()] };
}

function trueFalseOptions(): OptionDraft[] {
  return [
    { key: nextKey(), label: "True", isCorrect: false },
    { key: nextKey(), label: "False", isCorrect: false },
  ];
}

function questionIsValid(q: QuestionDraft): boolean {
  const prompt = q.prompt.trim();
  if (prompt.length === 0 || prompt.length > MAX_PROMPT) return false;
  const labeled = q.options.filter((o) => o.label.trim().length > 0);
  if (labeled.length < MIN_QUESTION_OPTIONS) return false;
  const correctCount = labeled.filter((o) => o.isCorrect).length;
  if (correctCount === 0) return false;
  if ((q.type === "single" || q.type === "true_false") && correctCount > 1) return false;
  return true;
}

export default function CreateQuizPage() {
  const router = useRouter();
  const { t } = useTranslation();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [passingScorePercent, setPassingScorePercent] = useState("60");
  const [maxAttemptsPerUser, setMaxAttemptsPerUser] = useState("1");
  const [questions, setQuestions] = useState<QuestionDraft[]>([newQuestion()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levelTooLow, setLevelTooLow] = useState<{ minLevel: number; currentLevel: number } | null>(null);

  const passingScoreNum = parseInt(passingScorePercent, 10);
  const maxAttemptsNum = parseInt(maxAttemptsPerUser, 10);
  const isValid =
    title.trim().length >= 5 &&
    title.trim().length <= MAX_TITLE &&
    questions.length >= 1 &&
    questions.length <= MAX_QUESTIONS &&
    Number.isInteger(passingScoreNum) && passingScoreNum >= 0 && passingScoreNum <= 100 &&
    Number.isInteger(maxAttemptsNum) && maxAttemptsNum >= 1 &&
    questions.every(questionIsValid);

  function updateQuestion(qKey: string, patch: Partial<QuestionDraft>) {
    setQuestions((prev) => prev.map((q) => (q.key === qKey ? { ...q, ...patch } : q)));
  }

  function setQuestionType(qKey: string, type: QuestionType) {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.key !== qKey) return q;
        if (type === "true_false") return { ...q, type, options: trueFalseOptions() };
        // Coming from true_false, restore a couple of blank options instead of locked True/False.
        const options = q.type === "true_false" ? [newOption(), newOption()] : q.options.map((o) => (type === "single" ? { ...o } : o));
        return { ...q, type, options };
      })
    );
  }

  function addQuestion() {
    setQuestions((prev) => (prev.length < MAX_QUESTIONS ? [...prev, newQuestion()] : prev));
  }

  function removeQuestion(qKey: string) {
    setQuestions((prev) => (prev.length > 1 ? prev.filter((q) => q.key !== qKey) : prev));
  }

  function updateOptionLabel(qKey: string, oKey: string, label: string) {
    setQuestions((prev) =>
      prev.map((q) => (q.key === qKey ? { ...q, options: q.options.map((o) => (o.key === oKey ? { ...o, label: label.slice(0, MAX_OPTION) } : o)) } : q))
    );
  }

  function toggleCorrect(qKey: string, oKey: string) {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.key !== qKey) return q;
        if (q.type === "multiple") {
          return { ...q, options: q.options.map((o) => (o.key === oKey ? { ...o, isCorrect: !o.isCorrect } : o)) };
        }
        // single / true_false — exactly one correct option (radio behaviour)
        return { ...q, options: q.options.map((o) => ({ ...o, isCorrect: o.key === oKey })) };
      })
    );
  }

  function addOption(qKey: string) {
    setQuestions((prev) => prev.map((q) => (q.key === qKey && q.options.length < MAX_QUESTION_OPTIONS ? { ...q, options: [...q.options, newOption()] } : q)));
  }

  function removeOption(qKey: string, oKey: string) {
    setQuestions((prev) =>
      prev.map((q) => (q.key === qKey && q.options.length > MIN_QUESTION_OPTIONS ? { ...q, options: q.options.filter((o) => o.key !== oKey) } : q))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError(null);
    setLevelTooLow(null);
    try {
      const res = await fetch("/api/quizzes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          passingScorePercent: passingScoreNum,
          maxAttemptsPerUser: maxAttemptsNum,
          questions: questions.map((q) => ({
            prompt: q.prompt.trim(),
            type: q.type,
            points: q.points && q.points > 0 ? q.points : undefined,
            options: q.options.filter((o) => o.label.trim().length > 0).map((o) => ({ label: o.label.trim(), isCorrect: o.isCorrect })),
          })),
        }),
      });
      if (res.status === 401) { router.push("/auth/login"); return; }
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string; params?: { minLevel?: number; currentLevel?: number } };
        };
        const code = d.error?.code ?? null;
        if (code === "QUIZ_LEVEL_TOO_LOW" && d.error?.params) {
          setLevelTooLow({ minLevel: d.error.params.minLevel ?? 1, currentLevel: d.error.params.currentLevel ?? 0 });
          return;
        }
        const err = new Error(d.error?.message ?? "Failed to create quiz") as Error & { code?: string | null };
        err.code = code;
        throw err;
      }
      const json = await res.json();
      router.push(`/quiz/${json.data.slug}`);
    } catch (e) {
      const err = e as Error & { code?: string | null };
      setError(e instanceof Error ? translateApiError(t, err.code, err.message || "Something went wrong") : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl p-4 sm:p-6">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/quizzes" className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Back to Quizzes">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("quizzes.new.title", "Create Quiz")}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {levelTooLow && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            {t("quizzes.new.levelTooLow", "You must reach Level {{level}} to create a quiz. Your current level is {{current}}.", { level: levelTooLow.minLevel, current: levelTooLow.currentLevel })}
          </div>
        )}

        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t("quizzes.new.titleLabel", "Title")}</h2>
          </div>
          <div className="space-y-4 p-5">
            <div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
                placeholder={t("quizzes.new.titlePlaceholder", "Name your quiz")}
                maxLength={MAX_TITLE}
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
              />
              <div className="mt-1.5 flex justify-end">
                <span className={`text-xs tabular-nums ${title.length >= MAX_TITLE ? "text-red-500" : "text-neutral-400"}`}>{title.length}/{MAX_TITLE}</span>
              </div>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
              placeholder={t("quizzes.new.descriptionPlaceholder", "Description (optional)")}
              rows={2}
              maxLength={MAX_DESCRIPTION}
              className="w-full resize-none rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t("quizzes.new.passingScoreLabel", "Passing score (%)")}</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={passingScorePercent}
                  onChange={(e) => setPassingScorePercent(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-400">{t("quizzes.new.maxAttemptsLabel", "Max attempts per user")}</span>
                <input
                  type="number"
                  min={1}
                  value={maxAttemptsPerUser}
                  onChange={(e) => setMaxAttemptsPerUser(e.target.value)}
                  className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {questions.map((q, qIdx) => (
            <div key={q.key} className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-3 dark:border-neutral-800">
                <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  {t("quizzes.new.questionN", "Question {{n}}", { n: qIdx + 1 })}
                </h3>
                {questions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeQuestion(q.key)}
                    className="text-xs font-semibold text-red-500 hover:text-red-600"
                  >
                    {t("quizzes.new.removeQuestion", "Remove")}
                  </button>
                )}
              </div>
              <div className="space-y-3 p-5">
                <input
                  type="text"
                  value={q.prompt}
                  onChange={(e) => updateQuestion(q.key, { prompt: e.target.value.slice(0, MAX_PROMPT) })}
                  placeholder={t("quizzes.new.promptPlaceholder", "Question prompt")}
                  maxLength={MAX_PROMPT}
                  className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
                />

                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400">{t("quizzes.new.typeLabel", "Type")}</label>
                  <select
                    value={q.type}
                    onChange={(e) => setQuestionType(q.key, e.target.value as QuestionType)}
                    className="rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                  >
                    <option value="single">{t("quizzes.new.typeSingle", "Single answer")}</option>
                    <option value="multiple">{t("quizzes.new.typeMultiple", "Multiple answers")}</option>
                    <option value="true_false">{t("quizzes.new.typeTrueFalse", "True / False")}</option>
                  </select>
                  <label className="ml-auto flex items-center gap-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                    {t("quizzes.new.pointsLabel", "Points")}
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={q.points}
                      onChange={(e) => updateQuestion(q.key, { points: parseInt(e.target.value, 10) || 1 })}
                      className="w-16 rounded-lg border border-neutral-300 bg-neutral-50 px-2 py-1 text-xs focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    />
                  </label>
                </div>

                <div className="space-y-2">
                  {q.options.map((o) => {
                    const isRadio = q.type !== "multiple";
                    const locked = q.type === "true_false";
                    return (
                      <div key={o.key} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleCorrect(q.key, o.key)}
                          aria-label={t("quizzes.new.markCorrect", "Mark correct")}
                          className={`flex h-6 w-6 shrink-0 items-center justify-center border-2 ${isRadio ? "rounded-full" : "rounded-md"} ${
                            o.isCorrect ? "border-emerald-500 bg-emerald-500 text-white" : "border-neutral-300 dark:border-neutral-600"
                          }`}
                        >
                          {o.isCorrect && "✓"}
                        </button>
                        <input
                          type="text"
                          value={o.label}
                          disabled={locked}
                          onChange={(e) => updateOptionLabel(q.key, o.key, e.target.value)}
                          placeholder={t("quizzes.new.optionPlaceholder", "Option")}
                          maxLength={MAX_OPTION}
                          className="flex-1 rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:opacity-70 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
                        />
                        {!locked && q.options.length > MIN_QUESTION_OPTIONS && (
                          <button
                            type="button"
                            onClick={() => removeOption(q.key, o.key)}
                            aria-label={t("quizzes.new.removeOption", "Remove option")}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-red-500 dark:hover:bg-neutral-800"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {q.type !== "true_false" && q.options.length < MAX_QUESTION_OPTIONS && (
                    <button
                      type="button"
                      onClick={() => addOption(q.key)}
                      className="text-xs font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400"
                    >
                      {t("quizzes.new.addOption", "+ Add option")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {questions.length < MAX_QUESTIONS && (
            <button
              type="button"
              onClick={addQuestion}
              className="w-full rounded-xl border border-dashed border-neutral-300 py-3 text-sm font-semibold text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {t("quizzes.new.addQuestion", "+ Add question")}
            </button>
          )}
        </div>

        <div className="flex gap-3">
          <Link href="/quizzes" className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-center text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
            {t("quizzes.new.cancel", "Cancel")}
          </Link>
          <button
            type="submit"
            disabled={!isValid || submitting}
            className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {submitting ? t("quizzes.new.posting", "Creating…") : t("quizzes.new.post", "Create Quiz")}
          </button>
        </div>
      </form>
    </div>
  );
}
