"use client";

/**
 * components/classroom/QuizCard.tsx
 *
 * Displays a single classroom quiz with title, XP reward, pass score,
 * and start/passed state.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Quiz {
  id: string;
  title: string;
  description: string | null;
  xp_reward: number;
  pass_score: number; // percentage (0–100)
  question_count: number;
}

interface QuizCardProps {
  quiz: Quiz;
  onStart: () => void;
  attempted?: boolean;
  passed?: boolean;
  score?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * QuizCard — displays a quiz summary with start / passed state.
 */
export function QuizCard({ quiz, onStart, attempted = false, passed = false, score }: QuizCardProps) {
  return (
    <div className="flex flex-col rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      {/* Title + badges row */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{quiz.title}</h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* XP badge */}
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
            +{quiz.xp_reward} XP
          </span>
          {/* Passed badge */}
          {passed && (
            <span className="flex items-center gap-0.5 rounded-full bg-teal-100 px-2.5 py-0.5 text-xs font-bold text-teal-700 dark:bg-teal-900/40 dark:text-teal-400">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Passed
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      {quiz.description && (
        <p className="mb-3 text-sm text-neutral-500 dark:text-neutral-400 line-clamp-2">{quiz.description}</p>
      )}

      {/* Stats row */}
      <div className="mb-4 flex flex-wrap gap-3 text-xs text-neutral-500">
        <span className="flex items-center gap-1">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {quiz.question_count} questions
        </span>
        <span className="flex items-center gap-1">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Pass: {quiz.pass_score}%
        </span>
        {attempted && score !== undefined && (
          <span className={`flex items-center gap-1 font-semibold ${score >= quiz.pass_score ? "text-teal-600 dark:text-teal-400" : "text-red-600 dark:text-red-400"}`}>
            Your score: {score}%
          </span>
        )}
      </div>

      {/* Action */}
      {passed ? (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-teal-50 py-2.5 text-sm font-semibold text-teal-700 dark:bg-teal-900/20 dark:text-teal-400">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Passed ✓
        </div>
      ) : (
        <button
          onClick={onStart}
          className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          {attempted ? "Retry Quiz" : "Start Quiz"}
        </button>
      )}
    </div>
  );
}
