"use client";

/**
 * components/classroom/QuizBuilder.tsx
 *
 * Form for creators to build a quiz for a classroom room.
 * Supports dynamic question list with 4 options each.
 * Submits via POST /api/classroom/:roomId/quizzes.
 */

import { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuizOption {
  label: "A" | "B" | "C" | "D";
  text: string;
}

interface QuizQuestion {
  id: string;
  questionText: string;
  options: QuizOption[];
  correctOption: "A" | "B" | "C" | "D";
}

interface QuizBuilderProps {
  roomId: string;
  onCreated: (quiz: unknown) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OPTION_LABELS = ["A", "B", "C", "D"] as const;

function makeQuestion(): QuizQuestion {
  return {
    id: crypto.randomUUID(),
    questionText: "",
    options: OPTION_LABELS.map((label) => ({ label, text: "" })),
    correctOption: "A",
  };
}

// ---------------------------------------------------------------------------
// Question editor
// ---------------------------------------------------------------------------

interface QuestionEditorProps {
  question: QuizQuestion;
  index: number;
  onChange: (updated: QuizQuestion) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function QuestionEditor({ question, index, onChange, onRemove, canRemove }: QuestionEditorProps) {
  function updateText(text: string) {
    onChange({ ...question, questionText: text });
  }

  function updateOption(label: "A" | "B" | "C" | "D", text: string) {
    onChange({
      ...question,
      options: question.options.map((o) => (o.label === label ? { ...o, text } : o)),
    });
  }

  function setCorrect(label: "A" | "B" | "C" | "D") {
    onChange({ ...question, correctOption: label });
  }

  return (
    <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800/50">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-semibold text-neutral-600 dark:text-neutral-400">
          Question {index + 1}
        </span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            aria-label="Remove question"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      {/* Question text */}
      <textarea
        value={question.questionText}
        onChange={(e) => updateText(e.target.value)}
        placeholder="Enter question text…"
        rows={2}
        required
        className="mb-3 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
      />

      {/* Options */}
      <div className="mb-3 space-y-2">
        {question.options.map((option) => (
          <div key={option.label} className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-neutral-300 bg-white text-xs font-bold text-neutral-600 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
              {option.label}
            </span>
            <input
              type="text"
              value={option.text}
              onChange={(e) => updateOption(option.label, e.target.value)}
              placeholder={`Option ${option.label}`}
              required
              className="flex-1 rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
        ))}
      </div>

      {/* Correct answer */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-neutral-500">Correct answer:</span>
        <select
          value={question.correctOption}
          onChange={(e) => setCorrect(e.target.value as "A" | "B" | "C" | "D")}
          className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm font-semibold focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
        >
          {OPTION_LABELS.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * QuizBuilder — form for creating a quiz within a classroom room.
 */
export function QuizBuilder({ roomId, onCreated }: QuizBuilderProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [xpReward, setXpReward] = useState(50);
  const [passScore, setPassScore] = useState(70);
  const [questions, setQuestions] = useState<QuizQuestion[]>([makeQuestion()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addQuestion() {
    setQuestions((prev) => [...prev, makeQuestion()]);
  }

  function updateQuestion(id: string, updated: QuizQuestion) {
    setQuestions((prev) => prev.map((q) => (q.id === id ? updated : q)));
  }

  function removeQuestion(id: string) {
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        xp_reward: xpReward,
        pass_score: passScore,
        questions: questions.map((q) => ({
          question_text: q.questionText.trim(),
          options: q.options.map((o) => ({ label: o.label, text: o.text.trim() })),
          correct_option: q.correctOption,
        })),
      };
      const res = await fetch(`/api/classroom/${roomId}/quizzes`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Failed to create quiz");
      }
      const created = await res.json();
      onCreated(created);
      // Reset form
      setTitle("");
      setDescription("");
      setXpReward(50);
      setPassScore(70);
      setQuestions([makeQuestion()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Title */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          Quiz Title <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Chapter 1 — Foundations"
          required
          maxLength={100}
          className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
        />
      </div>

      {/* Description */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description of the quiz…"
          rows={2}
          maxLength={300}
          className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
        />
      </div>

      {/* XP + pass score row */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            XP Reward
          </label>
          <input
            type="number"
            value={xpReward}
            onChange={(e) => setXpReward(Math.max(1, parseInt(e.target.value) || 50))}
            min={1}
            max={1000}
            className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
            Pass Score (%)
          </label>
          <input
            type="number"
            value={passScore}
            onChange={(e) => setPassScore(Math.min(100, Math.max(0, parseInt(e.target.value) || 70)))}
            min={0}
            max={100}
            className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
          />
        </div>
      </div>

      {/* Questions */}
      <div>
        <p className="mb-3 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          Questions ({questions.length})
        </p>
        <div className="space-y-3">
          {questions.map((q, i) => (
            <QuestionEditor
              key={q.id}
              question={q}
              index={i}
              onChange={(updated) => updateQuestion(q.id, updated)}
              onRemove={() => removeQuestion(q.id)}
              canRemove={questions.length > 1}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={addQuestion}
          className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-blue-300 px-4 py-2.5 text-sm font-semibold text-blue-600 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/30"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add Question
        </button>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {submitting ? "Creating Quiz…" : "Create Quiz"}
      </button>
    </form>
  );
}
