"use client";

/**
 * components/bbforum/ReplyForm.tsx
 *
 * Minimized-by-default reply box for a thread (app/f/[slug]/page.tsx),
 * matching the Answers "write an answer" expand-on-click pattern.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReplyForm({ threadSlug, locked }: { threadSlug: string; locked: boolean }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (body.trim().length < 2) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/forum/threads/${threadSlug}/posts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: body.trim() }),
      });
      if (res.status === 401) { router.push("/auth/login"); return; }
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message ?? "Failed to post reply");
      setBody("");
      setExpanded(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post reply");
    } finally {
      setSubmitting(false);
    }
  }

  if (locked) {
    return <p className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/50">🔒 This thread is locked — no new replies.</p>;
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="mt-4 w-full rounded-xl border border-dashed border-neutral-300 px-4 py-3 text-left text-sm text-neutral-500 hover:border-primary-400 hover:text-primary-600 dark:border-neutral-700 dark:hover:border-primary-600"
      >
        Write a reply…
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-2 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      {error && <p className="text-xs text-red-600">{error}</p>}
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write your reply…"
        rows={4}
        maxLength={20000}
        className="w-full rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
      />
      <div className="flex gap-2">
        <button type="button" onClick={() => setExpanded(false)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-700 dark:border-neutral-700 dark:text-neutral-200">
          Cancel
        </button>
        <button type="submit" disabled={submitting} className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
          {submitting ? "Posting…" : "Post Reply"}
        </button>
      </div>
    </form>
  );
}
