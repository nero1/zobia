"use client";

/**
 * app/(app)/inbox/page.tsx
 *
 * Inbox page — admin messages to the user.
 * - Lists messages with subject, body, sender badge, timestamp
 * - Mark as read on click (POST /api/inbox/[id]/read)
 * - Unread messages shown with highlighted border
 * - Empty state when no messages
 */

import { useState, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InboxMessage {
  id: string;
  subject: string;
  body: string;
  senderName?: string;
  createdAt: string;
  readAt: string | null;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded bg-neutral-200 dark:bg-neutral-700 ${className}`} />;
}

function InboxSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 space-y-2">
              <SkeletonBlock className="h-4 w-48" />
              <SkeletonBlock className="h-3 w-full" />
              <SkeletonBlock className="h-3 w-2/3" />
            </div>
            <SkeletonBlock className="h-4 w-20 shrink-0" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Message Card
// ---------------------------------------------------------------------------

interface MessageCardProps {
  message: InboxMessage;
  onRead: (id: string) => void;
}

function MessageCard({ message, onRead }: MessageCardProps) {
  const unread = !message.readAt;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => { if (unread) onRead(message.id); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { if (unread) onRead(message.id); } }}
      className={`cursor-pointer rounded-xl border bg-white p-5 transition-colors hover:bg-neutral-50 dark:bg-neutral-900 dark:hover:bg-neutral-800/50 ${
        unread
          ? "border-blue-400 dark:border-blue-600"
          : "border-neutral-200 dark:border-neutral-800"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {unread && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-label="Unread" />
            )}
            <h3
              className={`text-sm font-semibold ${
                unread
                  ? "text-neutral-900 dark:text-neutral-50"
                  : "text-neutral-600 dark:text-neutral-400"
              }`}
            >
              {message.subject}
            </h3>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
              From Zobia
            </span>
          </div>
          <p className="mt-1.5 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-400">
            {message.body}
          </p>
        </div>
        <span className="shrink-0 text-xs text-neutral-400">
          {new Date(message.createdAt).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center py-16 text-center">
      <span className="text-5xl">📭</span>
      <h2 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-50">No messages</h2>
      <p className="mt-1 text-sm text-neutral-500">
        You have no messages from Zobia yet. Check back soon!
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function InboxPage() {
  const [messages, setMessages] = useState<InboxMessage[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/inbox", { credentials: "include" });
        if (res.status === 401) { window.location.href = "/auth/login"; return; }
        if (!res.ok) throw new Error("Failed to load inbox");
        const data = (await res.json()) as
          | InboxMessage[]
          | { messages?: InboxMessage[] }
          | { data?: InboxMessage[] };
        const list: InboxMessage[] = Array.isArray(data)
          ? data
          : (data as { messages?: InboxMessage[] }).messages ??
            (data as { data?: InboxMessage[] }).data ??
            [];
        setMessages(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
        setMessages([]);
      }
    })();
  }, []);

  async function handleMarkRead(id: string) {
    // Optimistic update
    setMessages((prev) =>
      prev?.map((m) => (m.id === id ? { ...m, readAt: new Date().toISOString() } : m))
    );
    try {
      await fetch(`/api/inbox/${id}/read`, { method: "POST", credentials: "include" });
    } catch {
      // Non-fatal — UI already updated optimistically
    }
  }

  if (messages === undefined) {
    return (
      <div className="mx-auto max-w-2xl p-4 sm:p-6">
        <h1 className="mb-5 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Inbox</h1>
        <InboxSkeleton />
      </div>
    );
  }

  const unreadCount = messages.filter((m) => !m.readAt).length;

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Inbox</h1>
        {unreadCount > 0 && (
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900 dark:text-blue-300">
            {unreadCount} unread
          </span>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {messages.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-3">
          {messages.map((msg) => (
            <MessageCard key={msg.id} message={msg} onRead={handleMarkRead} />
          ))}
        </div>
      )}
    </div>
  );
}
