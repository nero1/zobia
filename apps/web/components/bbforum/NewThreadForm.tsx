"use client";

/**
 * components/bbforum/NewThreadForm.tsx
 *
 * Client island embedded in the server-rendered board page
 * (app/forum/[boardSlug]/page.tsx). Starts collapsed (matches the Answers
 * "write an answer" minimized-form pattern) — expands on click. Redirects
 * to login if the POST comes back 401 (anonymous visitors can read but not post).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewThreadForm({ boardSlug }: { boardSlug: string }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 5 || body.trim().length < 10) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/forum/boards/${boardSlug}/threads`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      });
      if (res.status === 401) { router.push("/auth/login"); return; }
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to create thread");
      router.push(`/f/${json.data.thread.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create thread");
    } finally {
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="mb-4 w-full rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-left text-sm text-neutral-500 hover:border-primary-400 hover:text-primary-600 dark:border-neutral-700 dark:hover:border-primary-600"
      >
        + Start a new thread…
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 space-y-2 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Thread title"
        maxLength={200}
        className="w-full rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What's on your mind?"
        rows={4}
        maxLength={20000}
        className="w-full rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
      />
      <div className="flex gap-2">
        <button type="button" onClick={() => setExpanded(false)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-700 dark:border-neutral-700 dark:text-neutral-200">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
          {submitting ? "Posting…" : "Post Thread"}
        </button>
      </div>
    </form>
  );
}
