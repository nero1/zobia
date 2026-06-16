"use client";

/**
 * app/(admin)/admin/community-notes/page.tsx
 *
 * Community notes review page for the admin panel.
 * Lists community notes by status and allows approve / reject / escalate actions.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommunityNote {
  id: string;
  author_id: string;
  author_username: string | null;
  target_id: string;
  target_type: string;
  content: string;
  status: string;
  reviewed_by: string | null;
  reviewer_username: string | null;
  admin_comment: string | null;
  created_at: string;
  reviewed_at: string | null;
}

type TabKey = "pending" | "approved" | "rejected";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const TARGET_TYPE_BADGE: Record<string, string> = {
  message: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  post: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  room: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  user: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
};

const STATUS_BADGE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  approved: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  escalated: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
};

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-3 flex gap-2">
        <div className="h-5 w-20 rounded-full bg-neutral-200 dark:bg-neutral-700" />
        <div className="h-5 w-16 rounded-full bg-neutral-200 dark:bg-neutral-700" />
      </div>
      <div className="mb-2 h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="mb-2 h-4 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
      <div className="h-4 w-1/2 rounded bg-neutral-200 dark:bg-neutral-700" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Note card
// ---------------------------------------------------------------------------

interface NoteCardProps {
  note: CommunityNote;
  onAction: (noteId: string, action: "approve" | "reject" | "escalate") => Promise<void>;
  busy: string | null;
}

function NoteCard({ note, onAction, busy }: NoteCardProps) {
  const isBusy = busy === note.id;
  const targetBadge = TARGET_TYPE_BADGE[note.target_type] ?? TARGET_TYPE_BADGE.message;
  const statusBadge = STATUS_BADGE[note.status] ?? STATUS_BADGE.pending;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-card dark:border-neutral-800 dark:bg-neutral-900">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-neutral-800 dark:text-neutral-100">
          @{note.author_username ?? note.author_id}
        </span>
        <span className="text-neutral-400">commented on</span>
        <span className={`rounded-full px-2 py-0.5 font-semibold ${targetBadge}`}>
          {note.target_type}
        </span>
        <span className={`rounded-full px-2 py-0.5 font-semibold ${statusBadge}`}>
          {note.status}
        </span>
        <span className="ml-auto text-neutral-400">{timeAgo(note.created_at)}</span>
      </div>

      {/* Content */}
      <p className="mb-3 text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
        {note.content}
      </p>

      {/* Target ID */}
      <p className="mb-3 truncate text-xs text-neutral-400">
        Target ID: {note.target_id}
      </p>

      {/* Actions – shown only for pending notes */}
      {note.status === "pending" && (
        <div className="flex flex-wrap gap-2">
          <button
            disabled={isBusy}
            onClick={() => onAction(note.id, "approve")}
            className="rounded-lg bg-teal-100 px-3 py-1.5 text-xs font-semibold text-teal-700 transition-colors hover:bg-teal-200 disabled:opacity-50 dark:bg-teal-900 dark:text-teal-300"
          >
            {isBusy ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              "Approve"
            )}
          </button>
          <button
            disabled={isBusy}
            onClick={() => onAction(note.id, "reject")}
            className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-200 disabled:opacity-50 dark:bg-red-900 dark:text-red-300"
          >
            {isBusy ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              "Reject"
            )}
          </button>
          <button
            disabled={isBusy}
            onClick={() => onAction(note.id, "escalate")}
            className="rounded-lg bg-purple-100 px-3 py-1.5 text-xs font-semibold text-purple-700 transition-colors hover:bg-purple-200 disabled:opacity-50 dark:bg-purple-900 dark:text-purple-300"
          >
            {isBusy ? (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              "Escalate"
            )}
          </button>
        </div>
      )}

      {/* Reviewed info */}
      {note.status !== "pending" && (
        <div className="rounded-lg border border-neutral-100 bg-neutral-50 p-2 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-800/50">
          <span className="font-medium capitalize">{note.status}</span>
          {note.reviewer_username && <> · by @{note.reviewer_username}</>}
          {note.reviewed_at && <> · {formatDate(note.reviewed_at)}</>}
          {note.admin_comment && (
            <p className="mt-1 italic">&ldquo;{note.admin_comment}&rdquo;</p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminCommunityNotesPage() {
  const { t } = useTranslation();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [tab, setTab] = useState<TabKey>("pending");
  const [notes, setNotes] = useState<CommunityNote[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchNotes = useCallback(async (status: TabKey) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ status, limit: "50", offset: "0" });
      const res = await fetch(`/api/admin/community-notes?${params}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) {
        window.location.href = "/admin/login";
        return;
      }
      if (!res.ok) throw new Error("Failed to load community notes");
      const data = (await res.json()) as {
        success: boolean;
        data: { notes: CommunityNote[]; total: number };
      };
      setNotes(data.data.notes);
      setTotal(data.data.total);
    } catch (e) {
      setError(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Unknown error") : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchNotes(tab);
  }, [tab, fetchNotes]);

  async function handleAction(noteId: string, action: "approve" | "reject" | "escalate") {
    setBusy(noteId);
    try {
      const res = await fetch("/api/admin/community-notes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId, action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        { const e2 = new Error((body as { error?: { message?: string }; message?: string }).error?.message ?? (body as { error?: string }).error as string ?? "Action failed") as Error & { code?: string | null }; e2.code = (body as { error?: { code?: string } }).error?.code ?? null; throw e2; };
      }
      const actionLabel = action === "approve" ? "approved" : action === "reject" ? "rejected" : "escalated";
      showToast(`Note ${actionLabel}`);
      await fetchNotes(tab);
    } catch (e) {
      showToast(e instanceof Error ? translateApiError(tRef.current, (e as Error & { code?: string | null }).code, e.message || "Action failed") : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <div className="relative">
      <h1 className="mb-6 text-2xl font-bold text-neutral-900 dark:text-neutral-50">
        Community Notes
      </h1>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${
            toast.type === "success" ? "bg-teal-600" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-neutral-200 bg-neutral-100 p-1 dark:border-neutral-800 dark:bg-neutral-800/50">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
              tab === key
                ? "bg-white text-neutral-900 shadow-card dark:bg-neutral-900 dark:text-neutral-50"
                : "text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Total count */}
      {!loading && total > 0 && (
        <p className="mb-4 text-xs text-neutral-400">{total} note{total !== 1 ? "s" : ""} total</p>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Content */}
      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <CardSkeleton key={i} />)
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-white py-20 dark:border-neutral-800 dark:bg-neutral-900">
            <span className="text-4xl">📝</span>
            <p className="mt-3 text-lg font-semibold text-neutral-700 dark:text-neutral-300">
              No {tab} notes
            </p>
            <p className="mt-1 text-sm text-neutral-500">
              There are no community notes with status &ldquo;{tab}&rdquo; right now.
            </p>
          </div>
        ) : (
          notes.map((n) => (
            <NoteCard key={n.id} note={n} onAction={handleAction} busy={busy} />
          ))
        )}
      </div>
    </div>
  );
}
