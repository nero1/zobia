"use client";

/**
 * app/(app)/answers/[id]/page.tsx
 *
 * Zobia Answers — question detail with Reddit-style threaded (nested,
 * indented) answers, upvote/downvote, "Mark as best answer", inline reply
 * composer with the level-gate/credit-bypass prompt, and "Continue this
 * thread" lazy-loading for deep reply chains.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/ui/Avatar";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Author {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarEmoji: string | null;
}

interface QuestionDetail {
  id: string;
  title: string;
  body: string;
  author: Author;
  voteScore: number;
  answerCount: number;
  favoriteCount: number;
  isLocked: boolean;
  bestAnswerId: string | null;
  createdAt: string;
  myVote: -1 | 0 | 1;
  isFavorited: boolean;
  isAuthor: boolean;
}

interface AnswerNode {
  id: string;
  questionId: string;
  parentAnswerId: string | null;
  depth: number;
  body: string;
  author: Author;
  voteScore: number;
  createdAt: string;
  myVote: -1 | 0 | 1;
  isBestAnswer: boolean;
  replies: AnswerNode[];
  replyCount: number;
  fullyExpanded?: boolean;
}

const MAX_VISUAL_DEPTH = 6;

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** Rebuilds a nested tree from the flat list returned by the thread endpoint (first item is the root itself). */
function buildTreeFromFlat(flat: AnswerNode[], rootId: string): AnswerNode[] {
  const byParent = new Map<string, AnswerNode[]>();
  for (const node of flat) {
    if (node.id === rootId) continue;
    const key = node.parentAnswerId ?? "";
    const list = byParent.get(key) ?? [];
    list.push({ ...node, replies: [], fullyExpanded: true });
    byParent.set(key, list);
  }
  function attach(nodes: AnswerNode[]): AnswerNode[] {
    return nodes.map((n) => {
      const children = byParent.get(n.id) ?? [];
      return { ...n, replies: attach(children), replyCount: children.length, fullyExpanded: true };
    });
  }
  return attach(byParent.get(rootId) ?? []);
}

export default function QuestionDetailPage() {
  const params = useParams<{ id: string }>();
  const questionId = params.id;
  const router = useRouter();
  const { t } = useTranslation();
  const currency = useCurrency();

  const [question, setQuestion] = useState<QuestionDetail | null>(null);
  const [answers, setAnswers] = useState<AnswerNode[]>([]);
  const [answersCursor, setAnswersCursor] = useState<string | null>(null);
  const [answersHasMore, setAnswersHasMore] = useState(false);
  const [sort, setSort] = useState<"best" | "new">("best");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newAnswerBody, setNewAnswerBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [expandingId, setExpandingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bypassPrompt, setBypassPrompt] = useState<{ minLevel: number; bypassCostCredits: number; parentAnswerId: string | null; body: string } | null>(null);
  const [reportTarget, setReportTarget] = useState<{ type: "question" | "answer"; id: string } | null>(null);
  const [reportSubmitted, setReportSubmitted] = useState(false);

  const fetchQuestion = useCallback(async () => {
    const res = await fetch(`/api/answers/questions/${questionId}`, { credentials: "include" });
    if (res.status === 401) { router.push("/auth/login"); return; }
    if (res.status === 404) { setError(t("answers.detail.notFound", "Question not found.")); return; }
    if (!res.ok) throw new Error("Failed to load question");
    const json = await res.json();
    setQuestion(json.data);
  }, [questionId, router, t]);

  const fetchAnswers = useCallback(async (append = false, afterCursor: string | null = null, nextSort = sort) => {
    if (append) setLoadingMore(true); else setLoading(true);
    try {
      const qs = new URLSearchParams({ sort: nextSort, limit: "10" });
      if (afterCursor) qs.set("cursor", afterCursor);
      const res = await fetch(`/api/answers/questions/${questionId}/answers?${qs.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load answers");
      const json = await res.json();
      const data = json.data as { answers: AnswerNode[]; nextCursor: string | null; hasMore: boolean };
      setAnswers((prev) => (append ? [...prev, ...data.answers] : data.answers));
      setAnswersCursor(data.nextCursor);
      setAnswersHasMore(data.hasMore);
    } catch (e) {
      setError(e instanceof Error ? translateApiError(t, null, e.message) : "Something went wrong");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [questionId, sort, t]);

  useEffect(() => {
    setError(null);
    Promise.all([fetchQuestion(), fetchAnswers(false, null, sort)]).catch((e) => {
      setError(e instanceof Error ? e.message : "Something went wrong");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId]);

  useEffect(() => {
    void fetchAnswers(false, null, sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);

  async function handleVoteQuestion(value: 1 | -1) {
    if (!question) return;
    const wasVote = question.myVote;
    const nextVote = wasVote === value ? 0 : value;
    const delta = nextVote - wasVote;
    setQuestion({ ...question, myVote: nextVote as -1 | 0 | 1, voteScore: question.voteScore + delta });
    try {
      const res = await fetch(`/api/answers/questions/${questionId}/vote`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("vote failed");
      const json = await res.json();
      setQuestion((prev) => (prev ? { ...prev, voteScore: json.data.voteScore, myVote: json.data.myVote } : prev));
    } catch {
      setQuestion((prev) => (prev ? { ...prev, myVote: wasVote, voteScore: prev.voteScore - delta } : prev));
    }
  }

  async function handleFavorite() {
    if (!question) return;
    const next = !question.isFavorited;
    setQuestion({ ...question, isFavorited: next, favoriteCount: question.favoriteCount + (next ? 1 : -1) });
    try {
      await fetch(`/api/answers/questions/${questionId}/favorite`, { method: next ? "POST" : "DELETE", credentials: "include" });
    } catch {
      setQuestion((prev) => (prev ? { ...prev, isFavorited: !next, favoriteCount: prev.favoriteCount + (next ? -1 : 1) } : prev));
    }
  }

  function updateNodeInTree(nodes: AnswerNode[], id: string, updater: (n: AnswerNode) => AnswerNode): AnswerNode[] {
    return nodes.map((n) => {
      if (n.id === id) return updater(n);
      if (n.replies.length > 0) return { ...n, replies: updateNodeInTree(n.replies, id, updater) };
      return n;
    });
  }

  async function handleVoteAnswer(id: string, value: 1 | -1) {
    setAnswers((prev) => updateNodeInTree(prev, id, (n) => {
      const nextVote = n.myVote === value ? 0 : value;
      return { ...n, myVote: nextVote as -1 | 0 | 1, voteScore: n.voteScore + (nextVote - n.myVote) };
    }));
    try {
      const res = await fetch(`/api/answers/questions/${questionId}/answers/${id}/vote`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }),
      });
      if (!res.ok) throw new Error("vote failed");
      const json = await res.json();
      setAnswers((prev) => updateNodeInTree(prev, id, (n) => ({ ...n, voteScore: json.data.voteScore, myVote: json.data.myVote })));
    } catch {
      await fetchAnswers(false, null, sort);
    }
  }

  async function submitAnswer(body: string, parentAnswerId: string | null, payBypass = false) {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/answers/questions/${questionId}/answers`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, parentAnswerId, payBypass }),
      });
      if (res.status === 401) { router.push("/auth/login"); return; }
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string; params?: { minLevel?: number; bypassCostCredits?: number } };
        };
        const code = d.error?.code ?? null;
        if ((code === "FORUM_COMMENT_LEVEL_TOO_LOW" || code === "INSUFFICIENT_FORUM_COMMENT_FUNDS") && d.error?.params) {
          setBypassPrompt({
            minLevel: d.error.params.minLevel ?? 1,
            bypassCostCredits: d.error.params.bypassCostCredits ?? 1,
            parentAnswerId,
            body,
          });
          return;
        }
        throw new Error(d.error?.message ?? "Failed to post answer");
      }
      setNewAnswerBody("");
      setReplyBody("");
      setReplyingTo(null);
      setBypassPrompt(null);
      await Promise.all([fetchAnswers(false, null, sort), fetchQuestion()]);
    } catch (e) {
      setError(e instanceof Error ? translateApiError(t, null, e.message) : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMarkBest(answerId: string) {
    try {
      const res = await fetch(`/api/answers/questions/${questionId}/best-answer`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answerId }),
      });
      if (!res.ok) throw new Error("Failed to mark best answer");
      await Promise.all([fetchQuestion(), fetchAnswers(false, null, sort)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  async function handleExpandThread(answerId: string) {
    setExpandingId(answerId);
    try {
      const res = await fetch(`/api/answers/questions/${questionId}/answers/${answerId}/thread`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load thread");
      const json = await res.json();
      const flat = json.data.thread as AnswerNode[];
      const tree = buildTreeFromFlat(flat, answerId);
      setAnswers((prev) => updateNodeInTree(prev, answerId, (n) => ({ ...n, replies: tree, fullyExpanded: true })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setExpandingId(null);
    }
  }

  const currencyName = useMemo(() => (bypassPrompt?.bypassCostCredits === 1 ? currency.softSingular : currency.softPlural), [bypassPrompt, currency]);

  async function submitReport(reportType: string) {
    if (!reportTarget) return;
    try {
      await fetch("/api/reports", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportType,
          ...(reportTarget.type === "question" ? { reportedForumQuestionId: reportTarget.id } : { reportedForumAnswerId: reportTarget.id }),
        }),
      });
    } catch {
      // Reporting is best-effort — the reporter never learns the outcome anyway.
    } finally {
      setReportTarget(null);
      setReportSubmitted(true);
      setTimeout(() => setReportSubmitted(false), 3000);
    }
  }

  function AnswerNodeView({ node }: { node: AnswerNode }) {
    const visualDepth = Math.min(node.depth, MAX_VISUAL_DEPTH);
    const showMoreCount = node.replyCount - node.replies.length;

    return (
      <div className={node.depth > 0 ? "mt-3 border-l-2 border-neutral-200 pl-3 dark:border-neutral-800" : "mt-3"} style={{ marginLeft: node.depth > 0 ? 0 : undefined }}>
        <div className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <Avatar name={node.author.displayName ?? node.author.username ?? "?"} emoji={node.author.avatarEmoji ?? undefined} size="xs" rankTier="none" />
            <span className="font-semibold text-neutral-700 dark:text-neutral-300">@{node.author.username ?? "unknown"}</span>
            <span>·</span>
            <span>{timeAgo(node.createdAt)}</span>
            {node.isBestAnswer && (
              <span className="rounded-full bg-teal-100 px-2 py-0.5 font-semibold text-teal-700 dark:bg-teal-900 dark:text-teal-300">✓ Best Answer</span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">{node.body}</p>
          <div className="mt-2 flex items-center gap-3 text-xs">
            <button onClick={() => handleVoteAnswer(node.id, 1)} className={`rounded px-1.5 py-0.5 ${node.myVote === 1 ? "bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300" : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>▲</button>
            <span className="font-semibold tabular-nums text-neutral-600 dark:text-neutral-400">{node.voteScore}</span>
            <button onClick={() => handleVoteAnswer(node.id, -1)} className={`rounded px-1.5 py-0.5 ${node.myVote === -1 ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>▼</button>
            <button onClick={() => setReplyingTo(replyingTo === node.id ? null : node.id)} className="font-semibold text-neutral-500 hover:text-primary-600 dark:hover:text-primary-400">
              {t("answers.reply", "Reply")}
            </button>
            {question?.isAuthor && !question.bestAnswerId && (
              <button onClick={() => handleMarkBest(node.id)} className="font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400">
                {t("answers.markBest", "Mark as best")}
              </button>
            )}
            <button onClick={() => setReportTarget({ type: "answer", id: node.id })} className="ml-auto font-medium text-neutral-400 hover:text-red-600 dark:hover:text-red-400">
              {t("answers.report", "Report")}
            </button>
          </div>

          {replyingTo === node.id && (
            <div className="mt-3 space-y-2">
              <textarea
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value.slice(0, 3000))}
                rows={3}
                placeholder={t("answers.replyPlaceholder", "Write a reply…")}
                className="w-full resize-none rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
              <div className="flex gap-2">
                <button onClick={() => setReplyingTo(null)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
                  {t("answers.ask.cancel", "Cancel")}
                </button>
                <button
                  disabled={!replyBody.trim() || submitting}
                  onClick={() => void submitAnswer(replyBody.trim(), node.id)}
                  className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {t("answers.postReply", "Post Reply")}
                </button>
              </div>
            </div>
          )}
        </div>

        {node.replies.map((child) => <AnswerNodeView key={child.id} node={child} />)}

        {showMoreCount > 0 && (
          <button
            onClick={() => void handleExpandThread(node.id)}
            disabled={expandingId === node.id}
            className="mt-2 ml-2 text-xs font-semibold text-primary-600 hover:underline disabled:opacity-50 dark:text-primary-400"
          >
            {expandingId === node.id ? t("answers.loadingMore", "Loading…") : t("answers.viewMoreReplies", "View {{count}} more replies →", { count: showMoreCount })}
          </button>
        )}
      </div>
    );
  }

  if (error && !question) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center">
        <p className="text-sm text-neutral-500">{error}</p>
        <Link href="/answers" className="mt-3 inline-block text-sm font-semibold text-primary-600 hover:underline">← {t("answers.title", "Zobia Answers")}</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      <Link href="/answers" className="mb-4 inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300">
        ← {t("answers.title", "Zobia Answers")}
      </Link>

      {loading && !question ? (
        <div className="animate-pulse space-y-3">
          <div className="h-6 w-2/3 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-24 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      ) : question ? (
        <>
          <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
            <div className="flex gap-3">
              <div className="flex flex-col items-center gap-1 pt-0.5">
                <button onClick={() => handleVoteQuestion(1)} className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm ${question.myVote === 1 ? "bg-primary-100 text-primary-700 dark:bg-primary-900 dark:text-primary-300" : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>▲</button>
                <span className="text-sm font-semibold tabular-nums text-neutral-700 dark:text-neutral-300">{question.voteScore}</span>
                <button onClick={() => handleVoteQuestion(-1)} className={`flex h-7 w-7 items-center justify-center rounded-lg text-sm ${question.myVote === -1 ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300" : "text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>▼</button>
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-lg font-bold text-neutral-900 dark:text-neutral-50">
                  {question.title}
                  {question.isLocked && <span className="ml-2 text-sm text-neutral-400">🔒 {t("answers.locked", "Locked")}</span>}
                </h1>
                <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">{question.body}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                  <Avatar name={question.author.displayName ?? question.author.username ?? "?"} emoji={question.author.avatarEmoji ?? undefined} size="xs" rankTier="none" />
                  <span>@{question.author.username ?? "unknown"}</span>
                  <span>·</span>
                  <span>{timeAgo(question.createdAt)}</span>
                  <button onClick={() => void handleFavorite()} className={`rounded-full px-1.5 py-0.5 ${question.isFavorited ? "text-amber-500" : "text-neutral-300 hover:text-amber-400"}`}>
                    {question.isFavorited ? "★" : "☆"} {question.favoriteCount}
                  </button>
                  <button onClick={() => setReportTarget({ type: "question", id: question.id })} className="ml-auto font-medium text-neutral-400 hover:text-red-600 dark:hover:text-red-400">
                    {t("answers.report", "Report")}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* New top-level answer composer */}
          {!question.isLocked && (
            <div className="mt-4 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
              <textarea
                value={newAnswerBody}
                onChange={(e) => setNewAnswerBody(e.target.value.slice(0, 5000))}
                rows={4}
                placeholder={t("answers.answerPlaceholder", "Write an answer…")}
                className="w-full resize-none rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
              />
              <div className="mt-2 flex justify-end">
                <button
                  disabled={!newAnswerBody.trim() || submitting}
                  onClick={() => void submitAnswer(newAnswerBody.trim(), null)}
                  className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {submitting ? t("answers.ask.posting", "Posting…") : t("answers.postAnswer", "Post Answer")}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{error}</div>
          )}

          {/* Answer sort */}
          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              {question.answerCount} {question.answerCount === 1 ? t("answers.answer", "Answer") : t("answers.answers", "Answers")}
            </h2>
            <div className="flex gap-1 text-xs">
              {(["best", "new"] as const).map((s) => (
                <button key={s} onClick={() => setSort(s)} className={`rounded-lg px-2.5 py-1 font-semibold ${sort === s ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
                  {s === "best" ? t("answers.sortBest", "Best") : t("answers.sortNew", "New")}
                </button>
              ))}
            </div>
          </div>

          <div>
            {loading ? (
              <div className="mt-3 animate-pulse space-y-2">
                <div className="h-16 rounded bg-neutral-200 dark:bg-neutral-700" />
                <div className="h-16 rounded bg-neutral-200 dark:bg-neutral-700" />
              </div>
            ) : answers.length === 0 ? (
              <p className="mt-4 text-sm text-neutral-500">{t("answers.noAnswers", "No answers yet — be the first to help!")}</p>
            ) : (
              answers.map((a) => <AnswerNodeView key={a.id} node={a} />)
            )}

            {answersHasMore && !loading && (
              <button
                onClick={() => void fetchAnswers(true, answersCursor, sort)}
                disabled={loadingMore}
                className="mt-4 w-full rounded-xl border border-neutral-200 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {loadingMore ? t("answers.loadingMore", "Loading…") : t("answers.loadMoreAnswers", "Load More Answers")}
              </button>
            )}
          </div>
        </>
      ) : null}

      {/* Comment credit-bypass prompt */}
      {bypassPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setBypassPrompt(null)}>
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setBypassPrompt(null)} className="absolute right-4 top-4 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" aria-label="Close">✕</button>
            <h2 className="mb-2 text-base font-bold text-neutral-900 dark:text-neutral-50">{t("answers.bypass.title", "Reach Level {{level}} or spend Credits", { level: bypassPrompt.minLevel })}</h2>
            <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
              {t("answers.bypass.message", "You need Level {{level}} to comment for free. Spend {{cost}} {{currency}} to post this comment now?", { level: bypassPrompt.minLevel, cost: bypassPrompt.bypassCostCredits, currency: currencyName })}
            </p>
            <div className="flex gap-2">
              <button onClick={() => setBypassPrompt(null)} className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800">
                {t("answers.ask.cancel", "Cancel")}
              </button>
              <button
                onClick={() => void submitAnswer(bypassPrompt.body, bypassPrompt.parentAnswerId, true)}
                className="flex-1 rounded-xl bg-amber-500 py-2 text-sm font-semibold text-white hover:bg-amber-600"
              >
                {t("answers.bypass.confirm", "Spend {{cost}} {{currency}}", { cost: bypassPrompt.bypassCostCredits, currency: currencyName })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Report modal */}
      {reportTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setReportTarget(null)}>
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 dark:bg-neutral-900" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setReportTarget(null)} className="absolute right-4 top-4 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" aria-label="Close">✕</button>
            <h2 className="mb-3 text-base font-bold text-neutral-900 dark:text-neutral-50">{t("answers.report.title", "Report content")}</h2>
            <div className="space-y-1.5">
              {["spam", "harassment", "hate_speech", "misinformation", "sexual_content", "other"].map((rt) => (
                <button
                  key={rt}
                  onClick={() => void submitReport(rt)}
                  className="block w-full rounded-lg border border-neutral-200 px-3 py-2 text-left text-sm capitalize text-neutral-700 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                >
                  {rt.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {reportSubmitted && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-neutral-900 px-4 py-3 text-sm font-medium text-white shadow-modal dark:bg-neutral-100 dark:text-neutral-900">
          {t("answers.report.submitted", "Report submitted. Thank you.")}
        </div>
      )}
    </div>
  );
}
