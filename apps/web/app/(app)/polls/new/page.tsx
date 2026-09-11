"use client";

/**
 * app/(app)/polls/new/page.tsx
 *
 * Create a poll. Mirrors app/(app)/answers/ask/page.tsx's form/error-handling
 * conventions. Client-side validation mirrors the Zod schema in
 * app/api/polls/route.ts: title 5-200 chars, 2-10 options of 1-200 chars
 * each (trimmed, blanks dropped server-side).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 2000;
const MAX_OPTION = 200;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

export default function CreatePollPage() {
  const router = useRouter();
  const { t } = useTranslation();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [closesAt, setClosesAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levelTooLow, setLevelTooLow] = useState<{ minLevel: number; currentLevel: number } | null>(null);

  const trimmedOptions = options.map((o) => o.trim()).filter(Boolean);
  const isValid = title.trim().length >= 5 && title.trim().length <= MAX_TITLE && trimmedOptions.length >= MIN_OPTIONS && trimmedOptions.length <= MAX_OPTIONS;

  function updateOption(idx: number, value: string) {
    setOptions((prev) => prev.map((o, i) => (i === idx ? value.slice(0, MAX_OPTION) : o)));
  }

  function addOption() {
    setOptions((prev) => (prev.length < MAX_OPTIONS ? [...prev, ""] : prev));
  }

  function removeOption(idx: number) {
    setOptions((prev) => (prev.length > MIN_OPTIONS ? prev.filter((_, i) => i !== idx) : prev));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || submitting) return;
    setSubmitting(true);
    setError(null);
    setLevelTooLow(null);
    try {
      const res = await fetch("/api/polls", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          options: trimmedOptions,
          allowMultiple,
          closesAt: closesAt ? new Date(closesAt).toISOString() : undefined,
        }),
      });
      if (res.status === 401) { router.push("/auth/login"); return; }
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string; params?: { minLevel?: number; currentLevel?: number } };
        };
        const code = d.error?.code ?? null;
        if (code === "POLL_LEVEL_TOO_LOW" && d.error?.params) {
          setLevelTooLow({ minLevel: d.error.params.minLevel ?? 1, currentLevel: d.error.params.currentLevel ?? 0 });
          return;
        }
        const err = new Error(d.error?.message ?? "Failed to create poll") as Error & { code?: string | null };
        err.code = code;
        throw err;
      }
      const json = await res.json();
      router.push(`/poll/${json.data.slug}`);
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
        <Link href="/polls" className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Back to Polls">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("polls.new.title", "Create Poll")}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {levelTooLow && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            {t("polls.new.levelTooLow", "You must reach Level {{level}} to create a poll. Your current level is {{current}}.", { level: levelTooLow.minLevel, current: levelTooLow.currentLevel })}
          </div>
        )}

        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t("polls.new.titleLabel", "Question")}</h2>
          </div>
          <div className="p-5">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
              placeholder={t("polls.new.titlePlaceholder", "What do you want to ask?")}
              maxLength={MAX_TITLE}
              className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
            />
            <div className="mt-1.5 flex justify-end">
              <span className={`text-xs tabular-nums ${title.length >= MAX_TITLE ? "text-red-500" : "text-neutral-400"}`}>{title.length}/{MAX_TITLE}</span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t("polls.new.descriptionLabel", "Description (optional)")}</h2>
          </div>
          <div className="p-5">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
              placeholder={t("polls.new.descriptionPlaceholder", "Add any extra context…")}
              rows={3}
              maxLength={MAX_DESCRIPTION}
              className="w-full resize-none rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
            />
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t("polls.new.optionsLabel", "Options")}</h2>
          </div>
          <div className="space-y-2 p-5">
            {options.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={opt}
                  onChange={(e) => updateOption(idx, e.target.value)}
                  placeholder={t("polls.new.optionPlaceholder", "Option {{n}}", { n: idx + 1 })}
                  maxLength={MAX_OPTION}
                  className="flex-1 rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
                />
                {options.length > MIN_OPTIONS && (
                  <button
                    type="button"
                    onClick={() => removeOption(idx)}
                    aria-label={t("polls.new.removeOption", "Remove option")}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-red-500 dark:hover:bg-neutral-800"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {options.length < MAX_OPTIONS && (
              <button
                type="button"
                onClick={addOption}
                className="mt-1 text-sm font-semibold text-primary-600 hover:text-primary-700 dark:text-primary-400"
              >
                {t("polls.new.addOption", "+ Add option")}
              </button>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="space-y-4 p-5">
            <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300">
              <input
                type="checkbox"
                checked={allowMultiple}
                onChange={(e) => setAllowMultiple(e.target.checked)}
                className="h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-primary-500 dark:border-neutral-700"
              />
              {t("polls.new.allowMultiple", "Allow multiple choices")}
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
                {t("polls.new.closesAtLabel", "Closes at (optional)")}
              </span>
              <input
                type="datetime-local"
                value={closesAt}
                onChange={(e) => setClosesAt(e.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </label>
          </div>
        </div>

        <div className="flex gap-3">
          <Link href="/polls" className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-center text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
            {t("polls.new.cancel", "Cancel")}
          </Link>
          <button
            type="submit"
            disabled={!isValid || submitting}
            className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {submitting ? t("polls.new.posting", "Creating…") : t("polls.new.post", "Create Poll")}
          </button>
        </div>
      </form>
    </div>
  );
}
