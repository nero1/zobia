"use client";

/**
 * app/(app)/messages/groups/page.tsx
 *
 * Group chats list page (PRD §5 — Group Chats up to 300 members).
 * Shows all group chats the user belongs to with name, member count,
 * last message, and timestamp.
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GroupChat {
  id: string;
  name: string;
  avatar_emoji: string;
  tag: string | null;
  member_count: number;
  max_members: number;
  last_message_at: string;
  user_role: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function GroupSkeleton() {
  return (
    <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3 px-4 py-4">
          <div className="h-11 w-11 shrink-0 rounded-full bg-neutral-200 dark:bg-neutral-700" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-32 rounded bg-neutral-200 dark:bg-neutral-700" />
            <div className="h-3 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
          </div>
          <div className="h-3 w-10 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function GroupChatsPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupChat[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/messages/group", { credentials: "include" });
        if (res.status === 401) { window.location.href = "/auth/login"; return; }
        if (!res.ok) throw new Error("Failed to load group chats");
        const data = (await res.json()) as { items?: GroupChat[] };
        setGroups(data.items ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      }
    })();
  }, []);

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <Link
            href="/messages"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            aria-label="Back to messages"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-50">Group Chats</h1>
        </div>
        <Link
          href="/messages/groups/create"
          className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          + Create Group
        </Link>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Group list */}
      <div className="rounded-xl border border-neutral-200 bg-white shadow-card dark:border-neutral-800 dark:bg-neutral-900">
        {groups === undefined ? (
          <GroupSkeleton />
        ) : groups.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <span className="text-4xl">👥</span>
            <p className="mt-3 text-base font-semibold text-neutral-700 dark:text-neutral-300">No group chats yet</p>
            <p className="mt-1 text-sm text-neutral-400">Create a group to chat with multiple people at once</p>
            <Link
              href="/messages/groups/create"
              className="mt-4 inline-block rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
            >
              Create Group
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {groups.map((group) => (
              <Link
                key={group.id}
                href={`/messages/groups/${group.id}`}
                className="flex items-center gap-3 px-4 py-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
              >
                {/* Avatar */}
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-2xl dark:bg-neutral-800">
                  {group.avatar_emoji}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                      {group.name}
                    </span>
                    <span className="shrink-0 text-xs text-neutral-400">{timeAgo(group.last_message_at)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-neutral-500">
                      {group.member_count} member{group.member_count !== 1 ? "s" : ""}
                    </p>
                    {group.tag && (
                      <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
                        {group.tag}
                      </span>
                    )}
                    {group.user_role === "admin" && (
                      <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-600 dark:bg-amber-950/40 dark:text-amber-400">
                        Admin
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
