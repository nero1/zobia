"use client";

/**
 * app/(app)/messages/groups/create/page.tsx
 *
 * Create a new group chat (PRD §5 — Group Chats up to 300 members).
 *
 * - Enter group name (required)
 * - Select a tag: Study Group / Crew / Business
 * - Pick members from friends list via search
 * - Submit → POST /api/messages/group
 * - Redirects to the new group conversation on success
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Friend {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
}

interface FriendsResponse {
  friends?: Friend[];
  data?: Friend[];
}

interface CreateGroupResponse {
  group: { id: string; name: string };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CreateGroupPage() {
  const router = useRouter();

  const [groupName, setGroupName] = useState("");
  const [tag, setTag] = useState<"Personal" | "General" | "Study Group" | "Crew" | "Business" | "Other" | "">("");
  const [search, setSearch] = useState("");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingFriends, setLoadingFriends] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Load friends
  // ---------------------------------------------------------------------------
  useEffect(() => {
    setLoadingFriends(true);
    fetch("/api/friends", { credentials: "include" })
      .then((r) => r.json())
      .then((d: FriendsResponse) => setFriends(d.friends ?? d.data ?? []))
      .catch(() => setFriends([]))
      .finally(() => setLoadingFriends(false));
  }, []);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const filteredFriends = friends.filter(
    (f) =>
      f.username.toLowerCase().includes(search.toLowerCase()) ||
      f.displayName.toLowerCase().includes(search.toLowerCase())
  );

  function toggleMember(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------
  const handleCreate = useCallback(async () => {
    if (!groupName.trim()) { setError("Group name is required."); return; }
    if (selected.size === 0) { setError("Add at least one member."); return; }

    setCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/messages/group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: groupName.trim(),
          tag: tag || undefined,
          memberIds: Array.from(selected),
        }),
      });

      const data = await res.json() as CreateGroupResponse & { error?: string };

      if (!res.ok) {
        setError(data.error ?? "Failed to create group.");
        return;
      }

      router.push(`/messages/groups/${data.group.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setCreating(false);
    }
  }, [groupName, tag, selected, router]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/messages/groups"
          className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          ←
        </Link>
        <h1 className="text-xl font-black text-neutral-900 dark:text-white">New Group Chat</h1>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Group name */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          Group name *
        </label>
        <input
          type="text"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="Enter a name for this group"
          maxLength={100}
          className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />
      </div>

      {/* Tag */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          Group type
        </label>
        <div className="flex gap-2">
          {(["Personal", "General", "Crew", "Study Group", "Business", "Other"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTag(t === tag ? "" : t)}
              className={`rounded-full px-4 py-2 text-sm transition-all ${
                tag === t
                  ? "bg-amber-400 font-semibold text-neutral-900"
                  : "border border-neutral-200 text-neutral-600 hover:border-amber-300 dark:border-neutral-700 dark:text-neutral-400"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Member search */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          Add members {selected.size > 0 && <span className="text-amber-600">({selected.size} selected)</span>}
        </label>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search friends…"
          className="mb-2 w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />

        {loadingFriends ? (
          <div className="py-8 text-center text-sm text-neutral-400">Loading friends…</div>
        ) : friends.length === 0 ? (
          <div className="py-8 text-center text-sm text-neutral-400">
            Add some friends first before creating a group.
          </div>
        ) : filteredFriends.length === 0 ? (
          <div className="py-4 text-center text-sm text-neutral-400">No friends match &quot;{search}&quot;</div>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-neutral-200 p-2 dark:border-neutral-700">
            {filteredFriends.map((f) => (
              <button
                key={f.userId}
                type="button"
                onClick={() => toggleMember(f.userId)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all ${
                  selected.has(f.userId)
                    ? "bg-amber-50 dark:bg-amber-900/20"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-700"
                }`}
              >
                <span className="text-xl">{f.avatarEmoji || "👤"}</span>
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold text-neutral-900 dark:text-white">
                    {f.displayName}
                  </p>
                  <p className="truncate text-xs text-neutral-500">@{f.username}</p>
                </div>
                {selected.has(f.userId) && (
                  <span className="text-amber-500 font-bold">✓</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Submit */}
      <button
        type="button"
        onClick={() => void handleCreate()}
        disabled={creating || !groupName.trim() || selected.size === 0}
        className="w-full rounded-xl bg-amber-400 py-3.5 text-sm font-bold text-neutral-900 hover:bg-amber-500 disabled:opacity-40 transition-colors"
      >
        {creating ? "Creating group…" : "Create Group 🚀"}
      </button>
    </div>
  );
}
