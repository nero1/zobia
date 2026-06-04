"use client";

/**
 * app/(app)/community-notes/page.tsx
 *
 * Community Notes page — admin-toggleable crowdsourced fact-checking.
 *
 * Shows all active community notes on flagged content.
 * Users can submit notes on flagged content and vote helpful/unhelpful.
 * Notes with sufficient helpful votes are shown alongside the original content.
 * Admin-toggled via feature flag community_notes_enabled in x_manifest.
 *
 * PRD §19 — Trust, Safety & Community Health.
 */

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommunityNote {
  id: string;
  targetType: "message" | "room" | "profile" | "guild";
  targetId: string;
  targetSnippet: string | null;
  authorId: string;
  authorUsername: string;
  authorAvatarEmoji: string;
  content: string;
  helpfulVotes: number;
  unhelpfulVotes: number;
  status: "pending" | "visible" | "removed";
  userVote: "helpful" | "unhelpful" | null;
  createdAt: string;
}

interface NotesResponse {
  items: CommunityNote[];
  nextCursor: string | null;
  hasMore: boolean;
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

function statusBadge(status: CommunityNote["status"]): {
  label: string;
  color: string;
  bg: string;
} {
  switch (status) {
    case "visible":
      return { label: "Visible", color: "#166534", bg: "#dcfce7" };
    case "removed":
      return { label: "Removed", color: "#991b1b", bg: "#fee2e2" };
    default:
      return { label: "Pending", color: "#92400e", bg: "#fef3c7" };
  }
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function NoteSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 animate-pulse">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700" />
            <div className="space-y-1.5">
              <div className="h-3 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-2.5 w-20 bg-gray-100 dark:bg-gray-600 rounded" />
            </div>
          </div>
          <div className="h-4 w-full bg-gray-200 dark:bg-gray-700 rounded mb-2" />
          <div className="h-4 w-3/4 bg-gray-100 dark:bg-gray-600 rounded" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Submit Note Modal
// ---------------------------------------------------------------------------

interface SubmitNoteModalProps {
  onClose: () => void;
  onSubmit: (content: string) => Promise<void>;
}

function SubmitNoteModal({ onClose, onSubmit }: SubmitNoteModalProps) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (trimmed.length < 20) {
      setError("Note must be at least 20 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit note.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg p-6">
        <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-1">
          Add Community Note
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Add helpful context to flagged content. Notes must be factual and constructive.
        </p>
        <textarea
          className="w-full border border-gray-200 dark:border-gray-600 rounded-xl p-3 text-sm
                     bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-gray-100
                     placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500
                     resize-none min-h-[120px]"
          placeholder="Provide context or clarification about this content…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          maxLength={500}
        />
        <div className="flex items-center justify-between mt-1 mb-4">
          <span className="text-xs text-gray-400">{content.length}/500</span>
          {error && <span className="text-xs text-red-500">{error}</span>}
        </div>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300
                       hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || content.trim().length < 20}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white
                       hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Submitting…" : "Submit Note"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Note card
// ---------------------------------------------------------------------------

interface NoteCardProps {
  note: CommunityNote;
  onVote: (noteId: string, vote: "helpful" | "unhelpful") => void;
  voting: string | null;
}

function NoteCard({ note, onVote, voting }: NoteCardProps) {
  const badge = statusBadge(note.status);
  const isVoting = voting === note.id;
  const net = note.helpfulVotes - note.unhelpfulVotes;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-base select-none flex-shrink-0">
          {note.authorAvatarEmoji || "👤"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">
              @{note.authorUsername}
            </span>
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ color: badge.color, backgroundColor: badge.bg }}
            >
              {badge.label}
            </span>
            <span className="text-xs text-gray-400">{timeAgo(note.createdAt)}</span>
          </div>
          {note.targetSnippet && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">
              On: &ldquo;{note.targetSnippet}&rdquo;
            </p>
          )}
        </div>
        {/* Net helpfulness score */}
        <span
          className={`text-sm font-bold tabular-nums flex-shrink-0 ${
            net > 0 ? "text-green-600" : net < 0 ? "text-red-500" : "text-gray-400"
          }`}
        >
          {net > 0 ? "+" : ""}{net}
        </span>
      </div>

      {/* Note content */}
      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{note.content}</p>

      {/* Vote buttons */}
      {note.status !== "removed" && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => onVote(note.id, "helpful")}
            disabled={isVoting}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
              ${
                note.userVote === "helpful"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : "bg-gray-100 text-gray-600 hover:bg-green-50 hover:text-green-700 dark:bg-gray-700 dark:text-gray-300"
              }
              disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <span>👍</span>
            <span>Helpful ({note.helpfulVotes})</span>
          </button>
          <button
            onClick={() => onVote(note.id, "unhelpful")}
            disabled={isVoting}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
              ${
                note.userVote === "unhelpful"
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-700 dark:bg-gray-700 dark:text-gray-300"
              }
              disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <span>👎</span>
            <span>Not Helpful ({note.unhelpfulVotes})</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type FilterStatus = "all" | "pending" | "visible" | "removed";

export default function CommunityNotesPage() {
  const [notes, setNotes] = useState<CommunityNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [voting, setVoting] = useState<string | null>(null);
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);

  // Check if feature is enabled
  useEffect(() => {
    fetch("/api/admin/feature-flags")
      .then((r) => r.json())
      .then((data) => {
        const flags = data.flags as Array<{ key: string; enabled: boolean }>;
        const flag = flags?.find((f) => f.key === "community_notes_enabled");
        setFeatureEnabled(flag ? flag.enabled : true); // default enabled
      })
      .catch(() => setFeatureEnabled(true));
  }, []);

  const fetchNotes = useCallback(
    async (replace: boolean, beforeCursor?: string) => {
      const params = new URLSearchParams({ limit: "20" });
      if (filter !== "all") params.set("status", filter);
      if (beforeCursor) params.set("cursor", beforeCursor);

      const res = await fetch(`/api/community-notes?${params}`);
      if (!res.ok) throw new Error("Failed to load community notes");
      const data: NotesResponse = await res.json();

      setNotes((prev) => (replace ? data.items : [...prev, ...data.items]));
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    },
    [filter]
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchNotes(true)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [fetchNotes]);

  const handleLoadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await fetchNotes(false, cursor);
    } catch (err) {
      console.error("Load more failed:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleVote = useCallback(async (noteId: string, vote: "helpful" | "unhelpful") => {
    setVoting(noteId);
    try {
      const res = await fetch(`/api/community-notes/${noteId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vote }),
      });
      if (!res.ok) throw new Error("Vote failed");
      const data = await res.json();
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId
            ? {
                ...n,
                helpfulVotes: data.helpfulVotes ?? n.helpfulVotes,
                unhelpfulVotes: data.unhelpfulVotes ?? n.unhelpfulVotes,
                userVote: data.userVote ?? vote,
              }
            : n
        )
      );
    } catch (err) {
      console.error("Vote error:", err);
    } finally {
      setVoting(null);
    }
  }, []);

  const handleSubmitNote = async (content: string) => {
    const res = await fetch("/api/community-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error ?? "Failed to submit note");
    }
    // Refresh notes list
    setLoading(true);
    await fetchNotes(true).finally(() => setLoading(false));
  };

  const FILTERS: { label: string; value: FilterStatus }[] = [
    { label: "All Notes", value: "all" },
    { label: "Pending", value: "pending" },
    { label: "Visible", value: "visible" },
    { label: "Removed", value: "removed" },
  ];

  if (featureEnabled === false) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center">
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Community Notes Unavailable
        </h1>
        <p className="text-gray-500 dark:text-gray-400">
          This feature is currently disabled by platform administrators.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Page header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Community Notes
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Community-sourced context on flagged content. Anyone can contribute helpful notes.
            </p>
          </div>
          <button
            onClick={() => setShowSubmitModal(true)}
            className="flex-shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            + Add Note
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl mb-5 overflow-x-auto">
        {FILTERS.map(({ label, value }) => (
          <button
            key={value}
            onClick={() => setFilter(value)}
            className={`flex-1 min-w-max px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === value
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <NoteSkeleton />
      ) : error ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">⚠️</div>
          <p className="text-red-500 font-medium">{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              fetchNotes(true).catch(setError).finally(() => setLoading(false));
            }}
            className="mt-3 text-sm text-blue-600 hover:underline"
          >
            Try again
          </button>
        </div>
      ) : notes.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-5xl mb-4">📝</div>
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-1">
            No notes yet
          </h3>
          <p className="text-sm text-gray-400 dark:text-gray-500">
            Be the first to add helpful context to flagged content.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onVote={handleVote}
              voting={voting}
            />
          ))}

          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="w-full py-3 text-sm font-medium text-blue-600 hover:text-blue-700
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}

      {/* Submit note modal */}
      {showSubmitModal && (
        <SubmitNoteModal
          onClose={() => setShowSubmitModal(false)}
          onSubmit={handleSubmitNote}
        />
      )}
    </div>
  );
}
