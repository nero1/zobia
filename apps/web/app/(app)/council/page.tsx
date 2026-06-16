"use client";

/**
 * app/(app)/council/page.tsx
 *
 * Platform Council page.
 * Shows council member list with rank, username, legacy score.
 * Shows submitted ideas with vote counts.
 * Council members see a "Submit Idea" form and can vote on ideas.
 * Data from GET /api/council and GET /api/council/ideas.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CouncilMember {
  userId: string;
  username: string;
  avatarEmoji: string;
  rank: number;
  legacyScore: number;
}

interface CouncilIdea {
  id: string;
  title: string;
  description: string;
  authorId: string;
  authorUsername: string;
  upvotes: number;
  downvotes: number;
  status: "pending" | "under_review" | "accepted" | "rejected";
  createdAt: string;
  userVote: "up" | "down" | null;
}

interface CurrentUser {
  id: string;
  isCouncilMember: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function MemberSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-3 py-2">
      <div className="h-4 w-4 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-8 w-8 rounded-full bg-neutral-200 dark:bg-neutral-700" />
      <div className="flex-1">
        <div className="h-3 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
      </div>
      <div className="h-3 w-16 rounded bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

function IdeaSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const IDEA_STATUS: Record<string, string> = {
  pending: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  under_review: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  accepted: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

// ---------------------------------------------------------------------------
// Idea card
// ---------------------------------------------------------------------------

interface IdeaCardProps {
  idea: CouncilIdea;
  canVote: boolean;
  onVote: (ideaId: string, direction: "up" | "down") => void;
  voting: string | null;
}

function IdeaCard({ idea, canVote, onVote, voting }: IdeaCardProps) {
  const isVoting = voting === idea.id;

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="font-semibold text-neutral-900 dark:text-neutral-100">{idea.title}</h3>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${IDEA_STATUS[idea.status] ?? IDEA_STATUS.pending}`}>
          {idea.status.replace(/_/g, " ")}
        </span>
      </div>
      <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400 line-clamp-3">{idea.description}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1 text-xs text-neutral-500">
          <Link href={`/profile/${idea.authorId}`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
            @{idea.authorUsername}
          </Link>
          <span>·</span>
          <span>{timeAgo(idea.createdAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Upvote */}
          <button
            onClick={() => canVote && onVote(idea.id, "up")}
            disabled={!canVote || isVoting}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
              idea.userVote === "up"
                ? "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300"
                : "bg-neutral-100 text-neutral-600 hover:bg-teal-50 hover:text-teal-600 dark:bg-neutral-800 dark:text-neutral-400"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            ▲ {idea.upvotes}
          </button>
          {/* Downvote */}
          <button
            onClick={() => canVote && onVote(idea.id, "down")}
            disabled={!canVote || isVoting}
            className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
              idea.userVote === "down"
                ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                : "bg-neutral-100 text-neutral-600 hover:bg-red-50 hover:text-red-600 dark:bg-neutral-800 dark:text-neutral-400"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            ▼ {idea.downvotes}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

/**
 * Platform Council page — view council members, ideas, vote, and submit ideas.
 */
export default function CouncilPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [members, setMembers] = useState<CouncilMember[]>([]);
  const [ideas, setIdeas] = useState<CouncilIdea[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingIdeas, setLoadingIdeas] = useState(true);
  const [voting, setVoting] = useState<string | null>(null);
  const [showIdeaForm, setShowIdeaForm] = useState(false);
  const [ideaTitle, setIdeaTitle] = useState("");
  const [ideaDescription, setIdeaDescription] = useState("");
  const [submittingIdea, setSubmittingIdea] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    // Fetch current user
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d: CurrentUser | null) => setUser(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/council", { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load council");
        const data = (await res.json()) as { members: CouncilMember[] };
        setMembers(data.members);
      } catch { /* fail silently */ }
      finally { setLoadingMembers(false); }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/council/ideas", { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load ideas");
        const data = (await res.json()) as { ideas: CouncilIdea[] };
        setIdeas(data.ideas);
      } catch { /* fail silently */ }
      finally { setLoadingIdeas(false); }
    })();
  }, []);

  async function handleVote(ideaId: string, direction: "up" | "down") {
    setVoting(ideaId);
    try {
      const res = await fetch(`/api/council/ideas/${ideaId}/vote`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction }),
      });
      if (!res.ok) throw new Error("Vote failed");
      setIdeas((prev) =>
        prev.map((idea) => {
          if (idea.id !== ideaId) return idea;
          const prev_vote = idea.userVote;
          const upDelta = direction === "up" ? 1 : prev_vote === "up" ? -1 : 0;
          const downDelta = direction === "down" ? 1 : prev_vote === "down" ? -1 : 0;
          return {
            ...idea,
            upvotes: idea.upvotes + upDelta,
            downvotes: idea.downvotes + downDelta,
            userVote: prev_vote === direction ? null : direction,
          };
        })
      );
    } catch {
      showToast("Vote failed", "error");
    } finally {
      setVoting(null);
    }
  }

  async function handleSubmitIdea(e: React.FormEvent) {
    e.preventDefault();
    setSubmittingIdea(true);
    setError(null);
    try {
      const res = await fetch("/api/council/ideas", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: ideaTitle.trim(), description: ideaDescription.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Failed to submit idea");
      }
      const newIdea = (await res.json()) as CouncilIdea;
      setIdeas((prev) => [newIdea, ...prev]);
      setIdeaTitle("");
      setIdeaDescription("");
      setShowIdeaForm(false);
      showToast("Idea submitted successfully!");
    } catch (e) {
      setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Failed to submit") : "Failed to submit");
    } finally {
      setSubmittingIdea(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 sm:p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Platform Council</h1>
        <p className="mt-1 text-sm text-neutral-500">Elected members who guide platform direction through voted ideas.</p>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-lg ${
            toast.type === "success" ? "bg-teal-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Council members */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-neutral-500">Council Members</h2>
        <div className="rounded-2xl border border-neutral-200 bg-white divide-y divide-neutral-100 dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {loadingMembers
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="px-4 py-3"><MemberSkeleton /></div>
              ))
            : members.length === 0
            ? (
              <div className="px-4 py-8 text-center text-sm text-neutral-500">No council members yet.</div>
            )
            : members.map((member) => (
              <div key={member.userId} className="flex items-center gap-3 px-4 py-3">
                <span className="w-6 text-center text-sm font-bold text-neutral-400">#{member.rank}</span>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xl dark:bg-neutral-800">
                  {member.avatarEmoji}
                </span>
                <Link href={`/profile/${member.userId}`} className="flex-1 text-sm font-semibold text-neutral-900 hover:underline dark:text-neutral-100">
                  @{member.username}
                </Link>
                <span className="text-sm font-bold text-amber-600">{member.legacyScore.toLocaleString()} ⚜️</span>
              </div>
            ))}
        </div>
      </section>

      {/* Ideas section */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-500">Community Ideas</h2>
          {user?.isCouncilMember && !showIdeaForm && (
            <button
              onClick={() => setShowIdeaForm(true)}
              className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Submit Idea
            </button>
          )}
        </div>

        {/* Submit idea form */}
        {showIdeaForm && (
          <form onSubmit={handleSubmitIdea} className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/30">
            <h3 className="mb-3 font-semibold text-blue-900 dark:text-blue-100">New Idea</h3>
            {error && (
              <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                {error}
              </div>
            )}
            <div className="mb-3">
              <input
                type="text"
                value={ideaTitle}
                onChange={(e) => setIdeaTitle(e.target.value)}
                placeholder="Idea title…"
                required
                maxLength={120}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
            <div className="mb-3">
              <textarea
                value={ideaDescription}
                onChange={(e) => setIdeaDescription(e.target.value)}
                placeholder="Describe your idea in detail…"
                required
                rows={3}
                maxLength={1000}
                className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-100"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowIdeaForm(false)}
                className="flex-1 rounded-xl border border-neutral-300 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingIdea}
                className="flex-1 rounded-xl bg-blue-600 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {submittingIdea ? "Submitting…" : "Submit"}
              </button>
            </div>
          </form>
        )}

        {/* Ideas list */}
        <div className="space-y-3">
          {loadingIdeas
            ? Array.from({ length: 4 }).map((_, i) => <IdeaSkeleton key={i} />)
            : ideas.length === 0
            ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-neutral-200 bg-white py-16 dark:border-neutral-800 dark:bg-neutral-900">
                <span className="text-4xl">💡</span>
                <p className="mt-3 font-semibold text-neutral-700 dark:text-neutral-300">No ideas yet</p>
                <p className="mt-1 text-sm text-neutral-500">Council members can submit platform ideas here.</p>
              </div>
            )
            : ideas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                canVote={!!user?.isCouncilMember}
                onVote={handleVote}
                voting={voting}
              />
            ))}
        </div>
      </section>
    </div>
  );
}
