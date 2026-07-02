"use client";

/**
 * app/(app)/answers/ask/page.tsx
 *
 * Ask a question on Zobia Answers. Mirrors app/(app)/moments/create/page.tsx's
 * form/error-handling conventions.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { useForumConfig } from "@/lib/hooks/useForumConfig";

const MAX_TITLE = 200;
const MAX_BODY = 5000;

interface CategoryOption {
  id: string;
  slug: string;
  name: string;
  iconEmoji: string;
}

export default function AskQuestionPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const forumConfig = useForumConfig();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levelTooLow, setLevelTooLow] = useState<{ minLevel: number; currentLevel: number } | null>(null);

  useEffect(() => {
    fetch("/api/answers/categories", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((json) => setCategories(json.data ?? []))
      .catch(() => setCategories([]));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 10 || body.trim().length < 20) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/answers/questions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), categoryId: categoryId || undefined }),
      });
      if (res.status === 401) { router.push("/auth/login"); return; }
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string; params?: { minLevel?: number; currentLevel?: number } };
        };
        const code = d.error?.code ?? null;
        if (code === "FORUM_LEVEL_TOO_LOW" && d.error?.params) {
          setLevelTooLow({ minLevel: d.error.params.minLevel ?? forumConfig.minLevelToPost, currentLevel: d.error.params.currentLevel ?? 0 });
          return;
        }
        const err = new Error(d.error?.message ?? "Failed to post question") as Error & { code?: string | null };
        err.code = code;
        throw err;
      }
      const json = await res.json();
      router.push(`/answers/${json.data.id}`);
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
        <Link href="/answers" className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Back to Zobia Answers">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">{t("answers.ask.title", "Ask a Question")}</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {levelTooLow && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            {t("answers.ask.levelTooLow", "You must reach Level {{level}} to post. Your current level is {{current}}.", { level: levelTooLow.minLevel, current: levelTooLow.currentLevel })}
          </div>
        )}

        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t("answers.ask.titleLabel", "Title")}</h2>
          </div>
          <div className="p-5">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, MAX_TITLE))}
              placeholder={t("answers.ask.titlePlaceholder", "What's your question?")}
              maxLength={MAX_TITLE}
              className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
            />
            <div className="mt-1.5 flex justify-end">
              <span className={`text-xs tabular-nums ${title.length >= MAX_TITLE ? "text-red-500" : "text-neutral-400"}`}>{title.length}/{MAX_TITLE}</span>
            </div>
          </div>
        </div>

        {categories.length > 0 && (
          <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
            <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
              <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t("answers.ask.categoryLabel", "Category")}</h2>
            </div>
            <div className="p-5">
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              >
                <option value="">{t("answers.ask.categoryNone", "No category (General)")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.iconEmoji} {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
          <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{t("answers.ask.bodyLabel", "Details")}</h2>
          </div>
          <div className="p-5">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
              placeholder={t("answers.ask.bodyPlaceholder", "Add all the details someone would need to answer…")}
              rows={8}
              maxLength={MAX_BODY}
              className="w-full resize-none rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder-neutral-500"
            />
            <div className="mt-1.5 flex justify-end">
              <span className={`text-xs tabular-nums ${body.length >= MAX_BODY ? "text-red-500" : "text-neutral-400"}`}>{body.length}/{MAX_BODY}</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Link href="/answers" className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-center text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
            {t("answers.ask.cancel", "Cancel")}
          </Link>
          <button
            type="submit"
            disabled={title.trim().length < 10 || body.trim().length < 20 || submitting}
            className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {submitting ? t("answers.ask.posting", "Posting…") : t("answers.ask.post", "Post Question")}
          </button>
        </div>
      </form>
    </div>
  );
}
