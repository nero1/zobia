"use client";

/**
 * app/(admin)/admin/forum/posts/page.tsx
 *
 * Answers question/answer management table. Mirrors the table
 * pattern from admin/users/page.tsx (row-based badges + inline actions
 * instead of a detail drawer, since forum content actions are simple
 * single-click toggles).
 */

import { useState, useEffect, useCallback } from "react";

type PostType = "question" | "answer";

interface QuestionRow {
  id: string;
  title: string;
  body: string;
  status: string;
  vote_score: number;
  answer_count: number;
  favorite_count: number;
  is_locked: boolean;
  created_at: string;
  author_username: string | null;
}

interface AnswerRow {
  id: string;
  question_id: string;
  body: string;
  status: string;
  vote_score: number;
  depth: number;
  created_at: string;
  author_username: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  visible: "bg-success-100 text-success-700 dark:bg-success-900 dark:text-success-300",
  removed: "bg-danger-100 text-danger-700 dark:bg-danger-900 dark:text-danger-300",
  needs_review: "bg-gold-100 text-gold-700 dark:bg-gold-900 dark:text-gold-300",
};

// ---------------------------------------------------------------------------
// Edit modal — shared for question (title + body) and answer (body only)
// ---------------------------------------------------------------------------

interface EditTarget {
  id: string;
  type: PostType;
  title: string;
  body: string;
}

interface EditModalProps {
  target: EditTarget;
  onSave: (id: string, title: string, body: string) => Promise<void>;
  onClose: () => void;
  saving: boolean;
}

function EditModal({ target, onSave, onClose, saving }: EditModalProps) {
  const [title, setTitle] = useState(target.title);
  const [body, setBody] = useState(target.body);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-6 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        <h3 className="mb-4 text-lg font-bold text-neutral-900 dark:text-neutral-50">
          Edit {target.type === "question" ? "Question" : "Answer"}
        </h3>
        <div className="space-y-3">
          {target.type === "question" && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-semibold text-neutral-600 dark:text-neutral-400">Body</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              maxLength={10000}
              className="w-full rounded-xl border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
            />
          </div>
        </div>
        <div className="mt-5 flex gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-xl border border-neutral-300 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-300"
          >
            Cancel
          </button>
          <button
            onClick={() => onSave(target.id, title, body)}
            disabled={saving || !body.trim()}
            className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RowSkeleton({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        </td>
      ))}
    </tr>
  );
}

export default function AdminForumPostsPage() {
  const [type, setType] = useState<PostType>("question");
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [answers, setAnswers] = useState<AnswerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, kind: "success" | "error" = "success") => {
    setToast({ msg, type: kind });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        const u = json?.user ?? json;
        setIsAdmin(!!u?.is_admin);
        setIsModerator(!!u?.is_moderator);
      })
      .catch(() => {});
  }, []);

  const fetchPosts = useCallback(async (t: PostType) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/forum/posts?type=${t}&limit=50`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) { window.location.href = "/gate44/login"; return; }
      const data = (await res.json()) as { data?: { items?: (QuestionRow | AnswerRow)[] } };
      if (t === "question") setQuestions((data.data?.items ?? []) as QuestionRow[]);
      else setAnswers((data.data?.items ?? []) as AnswerRow[]);
    } catch {
      showToast("Failed to load posts", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void fetchPosts(type); }, [type, fetchPosts]);

  async function handleAction(id: string, action: "remove" | "restore" | "lock" | "unlock") {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/forum/posts/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: type, action }),
      });
      if (!res.ok) throw new Error("Action failed");
      showToast("Action applied");
      await fetchPosts(type);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleEditSave(id: string, title: string, body: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/forum/posts/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType: type, action: "edit", title, body }),
      });
      if (!res.ok) throw new Error("Edit failed");
      showToast("Saved");
      setEditTarget(null);
      await fetchPosts(type);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Edit failed", "error");
    } finally {
      setSaving(false);
    }
  }

  const canEdit = isAdmin || isModerator;

  return (
    <div className="relative">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Manage Posts</h1>

      {editTarget && (
        <EditModal
          target={editTarget}
          onSave={handleEditSave}
          onClose={() => setEditTarget(null)}
          saving={saving}
        />
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-4 flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50 w-fit">
        {(["question", "answer"] as PostType[]).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${type === t ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-900 dark:text-neutral-50" : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"}`}
          >
            {t}s
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table className="min-w-full divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-3">{type === "question" ? "Title" : "Body"}</th>
              <th className="px-4 py-3">Author</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Votes</th>
              {type === "question" && <th className="px-4 py-3">Answers</th>}
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => <RowSkeleton key={i} cols={type === "question" ? 7 : 6} />)
            ) : type === "question" ? (
              questions.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-neutral-500">No questions.</td></tr>
              ) : questions.map((q) => (
                <tr key={q.id}>
                  <td className="max-w-xs truncate px-4 py-3 font-medium text-neutral-900 dark:text-neutral-50">{q.title}</td>
                  <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">@{q.author_username ?? "unknown"}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[q.status] ?? ""}`}>{q.status.replace(/_/g, " ")}</span>
                    {q.is_locked && <span className="ml-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">🔒 locked</span>}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{q.vote_score}</td>
                  <td className="px-4 py-3 tabular-nums">{q.answer_count}</td>
                  <td className="px-4 py-3 text-neutral-500">{new Date(q.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {canEdit && (
                        <button
                          onClick={() => setEditTarget({ id: q.id, type: "question", title: q.title, body: q.body })}
                          className="rounded-lg bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300"
                        >
                          Edit
                        </button>
                      )}
                      {q.status === "visible" ? (
                        <button disabled={busy === q.id} onClick={() => handleAction(q.id, "remove")} className="rounded-lg bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-200 disabled:opacity-50 dark:bg-orange-900 dark:text-orange-300">Remove</button>
                      ) : isAdmin ? (
                        <button disabled={busy === q.id} onClick={() => handleAction(q.id, "restore")} className="rounded-lg bg-teal-100 px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-200 disabled:opacity-50 dark:bg-teal-900 dark:text-teal-300">Restore</button>
                      ) : null}
                      {isAdmin && (
                        q.is_locked ? (
                          <button disabled={busy === q.id} onClick={() => handleAction(q.id, "unlock")} className="rounded-lg bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300">Unlock</button>
                        ) : (
                          <button disabled={busy === q.id} onClick={() => handleAction(q.id, "lock")} className="rounded-lg bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-200 disabled:opacity-50 dark:bg-neutral-800 dark:text-neutral-300">Lock</button>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              ))
            ) : answers.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-neutral-500">No answers.</td></tr>
            ) : answers.map((a) => (
              <tr key={a.id}>
                <td className="max-w-xs truncate px-4 py-3 text-neutral-900 dark:text-neutral-50">{a.body}</td>
                <td className="px-4 py-3 text-neutral-600 dark:text-neutral-400">@{a.author_username ?? "unknown"}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[a.status] ?? ""}`}>{a.status.replace(/_/g, " ")}</span>
                </td>
                <td className="px-4 py-3 tabular-nums">{a.vote_score}</td>
                <td className="px-4 py-3 text-neutral-500">{new Date(a.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    {canEdit && (
                      <button
                        onClick={() => setEditTarget({ id: a.id, type: "answer", title: "", body: a.body })}
                        className="rounded-lg bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-300"
                      >
                        Edit
                      </button>
                    )}
                    {a.status === "visible" ? (
                      <button disabled={busy === a.id} onClick={() => handleAction(a.id, "remove")} className="rounded-lg bg-orange-100 px-2 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-200 disabled:opacity-50 dark:bg-orange-900 dark:text-orange-300">Remove</button>
                    ) : isAdmin ? (
                      <button disabled={busy === a.id} onClick={() => handleAction(a.id, "restore")} className="rounded-lg bg-teal-100 px-2 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-200 disabled:opacity-50 dark:bg-teal-900 dark:text-teal-300">Restore</button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
