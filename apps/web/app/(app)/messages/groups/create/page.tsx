"use client";

/**
 * app/(app)/messages/groups/create/page.tsx
 *
 * Create a new group chat (PRD §5 — Group Chats up to 300 total members,
 * capacity/creation limits admin-configurable via /gate44/config).
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
import { useTranslation } from "react-i18next";
import { translateApiError } from "@/lib/i18n/apiErrors";

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

interface ApiErrorResponse {
  error?: { code?: string; message?: string };
  message?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CreateGroupPage() {
  const router = useRouter();
  const { t } = useTranslation();

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
    if (!groupName.trim()) { setError(t("messages.groupCreate.nameRequired")); return; }
    if (selected.size === 0) { setError(t("messages.groupCreate.memberRequired")); return; }

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

      const data = await res.json() as CreateGroupResponse & ApiErrorResponse;

      if (!res.ok) {
        // handleApiError() responses shape errors as { error: { code, message } },
        // not a bare string — rendering the object directly crashed this page.
        const code = data.error?.code ?? null;
        const fallback = data.error?.message ?? data.message ?? t("messages.groupCreate.failed");
        setError(translateApiError(t, code, fallback));
        return;
      }

      router.push(`/messages/groups/${data.group.id}`);
    } catch {
      setError(t("error.networkError"));
    } finally {
      setCreating(false);
    }
  }, [groupName, tag, selected, router, t]);

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
        <h1 className="text-xl font-black text-neutral-900 dark:text-white">{t("messages.groupCreate.title")}</h1>
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
          {t("messages.groupCreate.nameLabel")}
        </label>
        <input
          type="text"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder={t("messages.groupCreate.namePlaceholder")}
          maxLength={100}
          className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />
      </div>

      {/* Tag */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          {t("messages.groupCreate.typeLabel")}
        </label>
        <div className="flex flex-wrap gap-2">
          {(["Personal", "General", "Crew", "Study Group", "Business", "Other"] as const).map((tagOption) => (
            <button
              key={tagOption}
              type="button"
              onClick={() => setTag(tagOption === tag ? "" : tagOption)}
              className={`rounded-full px-4 py-2 text-sm transition-all ${
                tag === tagOption
                  ? "bg-amber-400 font-semibold text-neutral-900"
                  : "border border-neutral-200 text-neutral-600 hover:border-amber-300 dark:border-neutral-700 dark:text-neutral-400"
              }`}
            >
              {t(`messages.groupTypes.${tagOption.toLowerCase().replace(/\s+/g, "")}`, tagOption)}
            </button>
          ))}
        </div>
      </div>

      {/* Member search */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-neutral-700 dark:text-neutral-300">
          {t("messages.groupCreate.addMembers")} {selected.size > 0 && <span className="text-amber-600">({selected.size} {t("messages.groupCreate.selected")})</span>}
        </label>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("messages.groupCreate.searchFriendsPlaceholder")}
          className="mb-2 w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 dark:border-neutral-700 dark:bg-neutral-800 dark:text-white"
        />

        {loadingFriends ? (
          <div className="py-8 text-center text-sm text-neutral-400">{t("messages.groupCreate.loadingFriends")}</div>
        ) : friends.length === 0 ? (
          <div className="py-8 text-center text-sm text-neutral-400">
            {t("messages.groupCreate.noFriendsYet")}
          </div>
        ) : filteredFriends.length === 0 ? (
          <div className="py-4 text-center text-sm text-neutral-400">{t("messages.groupCreate.noFriendsMatch", { query: search })}</div>
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
        {creating ? t("messages.groupCreate.creating") : t("messages.groupCreate.submit")}
      </button>
    </div>
  );
}
