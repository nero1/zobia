"use client";

/**
 * app/(admin)/gate44/moderation/roster/page.tsx
 *
 * Central moderator roster — every account currently flagged with any
 * staff role (Platform Mod, Ad Moderator, Support, Senior Support) in one
 * list with inline revoke, plus a search box to grant a role to any user
 * without hunting for them in User Management. Reuses the existing
 * POST /api/admin/users/[userId]/actions upgrade_/downgrade_ actions —
 * no new authorization logic. Admin-only.
 */

import { useState, useEffect, useCallback, useRef } from "react";

interface RosterUser {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarEmoji: string | null;
  isAdmin: boolean;
  isModerator: boolean;
  isAdModerator: boolean;
  isSupport: boolean;
  isSeniorSupport: boolean;
  isSuspended: boolean;
  isBanned: boolean;
}

interface SearchUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar_emoji: string;
}

type RoleAction =
  | "upgrade_moderator"
  | "downgrade_moderator"
  | "upgrade_ad_moderator"
  | "downgrade_ad_moderator"
  | "upgrade_support"
  | "downgrade_support"
  | "upgrade_senior_support"
  | "downgrade_senior_support";

const ROLE_BADGES: { key: keyof RosterUser; label: string; color: string }[] = [
  { key: "isModerator", label: "Platform Mod", color: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300" },
  { key: "isAdModerator", label: "Ad Moderator", color: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300" },
  { key: "isSupport", label: "Support", color: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300" },
  { key: "isSeniorSupport", label: "Senior Support", color: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300" },
];

function Avatar({ emoji }: { emoji: string | null }) {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-sm dark:bg-neutral-800">
      {emoji || "🙂"}
    </div>
  );
}

export default function ModerationRosterPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [roster, setRoster] = useState<RosterUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const [search, setSearch] = useState("");
  const [suggestions, setSuggestions] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setIsAdmin(!!(json?.user ?? json)?.is_admin))
      .catch(() => setIsAdmin(false));
  }, []);

  const loadRoster = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/admin/moderation/roster", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to load roster"))))
      .then((data) => setRoster(data.roster ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load roster"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isAdmin) loadRoster();
    else if (isAdmin === false) setLoading(false);
  }, [isAdmin, loadRoster]);

  useEffect(() => {
    if (search.length < 2) { setSuggestions([]); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearching(true);
      fetch(`/api/users/search?q=${encodeURIComponent(search)}&limit=8`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setSuggestions(data?.data?.users ?? data?.users ?? []))
        .catch(() => setSuggestions([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  async function performAction(userId: string, action: RoleAction) {
    setBusy(`${userId}:${action}`);
    try {
      const res = await fetch(`/api/admin/users/${userId}/actions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "Action failed");
      showToast("Updated");
      loadRoster();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Action failed", "error");
    } finally {
      setBusy(null);
    }
  }

  if (isAdmin === false) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-lg font-semibold text-neutral-700 dark:text-neutral-300">Admin access required</p>
      </div>
    );
  }

  return (
    <div className="relative">
      <h1 className="mb-2 text-2xl font-bold text-neutral-900 dark:text-neutral-50">Moderation Roster</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Every account currently flagged with a staff role, in one place. Search for a user to grant a new role, or
        revoke one below. Full per-role capability toggles live at /gate44/moderation/settings.
      </p>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-xl px-4 py-3 text-sm font-medium text-white shadow-modal ${toast.type === "success" ? "bg-teal-600" : "bg-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {/* Grant a role — search any user */}
      <div className="mb-6 rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="mb-2 text-sm font-bold text-neutral-900 dark:text-neutral-50">Grant a role</h2>
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by username…"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-50"
          />
          {(suggestions.length > 0 || searching) && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-700 dark:bg-neutral-800">
              {searching && <div className="px-4 py-3 text-sm text-neutral-500">Searching…</div>}
              {suggestions.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Avatar emoji={u.avatar_emoji} />
                    <div>
                      <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">{u.display_name ?? u.username}</p>
                      <p className="text-xs text-neutral-500">@{u.username}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => void performAction(u.id, "upgrade_moderator")}
                      disabled={busy === `${u.id}:upgrade_moderator`}
                      className="rounded-lg bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-200 disabled:opacity-50 dark:bg-blue-900 dark:text-blue-300"
                    >
                      + Mod
                    </button>
                    <button
                      type="button"
                      onClick={() => void performAction(u.id, "upgrade_ad_moderator")}
                      disabled={busy === `${u.id}:upgrade_ad_moderator`}
                      className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-200 disabled:opacity-50 dark:bg-amber-900 dark:text-amber-300"
                    >
                      + Ad Mod
                    </button>
                    <button
                      type="button"
                      onClick={() => void performAction(u.id, "upgrade_support")}
                      disabled={busy === `${u.id}:upgrade_support`}
                      className="rounded-lg bg-purple-100 px-2 py-1 text-xs font-semibold text-purple-700 hover:bg-purple-200 disabled:opacity-50 dark:bg-purple-900 dark:text-purple-300"
                    >
                      + Support
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />)}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <p className="text-sm text-neutral-500">{error}</p>
          <button type="button" onClick={loadRoster} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 dark:border-neutral-700 dark:text-neutral-300">
            Retry
          </button>
        </div>
      ) : roster.length === 0 ? (
        <div className="rounded-xl border border-neutral-200 bg-white p-8 text-center text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
          No staff-flagged accounts yet.
        </div>
      ) : (
        <div className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
          {roster.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
              <div className="flex items-center gap-2.5">
                <Avatar emoji={u.avatarEmoji} />
                <div>
                  <p className="text-sm font-medium text-neutral-900 dark:text-neutral-50">
                    {u.displayName ?? u.username}
                    {u.isSuspended && <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-300">Suspended</span>}
                    {u.isBanned && <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900 dark:text-red-300">Banned</span>}
                  </p>
                  <p className="text-xs text-neutral-500">@{u.username}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {ROLE_BADGES.filter((b) => u[b.key]).map((b) => (
                      <span key={b.label} className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${b.color}`}>{b.label}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {u.isModerator && (
                  <button
                    type="button"
                    onClick={() => void performAction(u.id, "downgrade_moderator")}
                    disabled={busy === `${u.id}:downgrade_moderator`}
                    className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    Revoke Mod
                  </button>
                )}
                {u.isAdModerator && (
                  <button
                    type="button"
                    onClick={() => void performAction(u.id, "downgrade_ad_moderator")}
                    disabled={busy === `${u.id}:downgrade_ad_moderator`}
                    className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    Revoke Ad Mod
                  </button>
                )}
                {u.isSupport && (
                  <button
                    type="button"
                    onClick={() => void performAction(u.id, "downgrade_support")}
                    disabled={busy === `${u.id}:downgrade_support`}
                    className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    Revoke Support
                  </button>
                )}
                {u.isSupport && !u.isSeniorSupport && (
                  <button
                    type="button"
                    onClick={() => void performAction(u.id, "upgrade_senior_support")}
                    disabled={busy === `${u.id}:upgrade_senior_support`}
                    className="rounded-lg bg-teal-100 px-2.5 py-1 text-xs font-semibold text-teal-700 hover:bg-teal-200 disabled:opacity-50 dark:bg-teal-900 dark:text-teal-300"
                  >
                    + Senior
                  </button>
                )}
                {u.isSeniorSupport && (
                  <button
                    type="button"
                    onClick={() => void performAction(u.id, "downgrade_senior_support")}
                    disabled={busy === `${u.id}:downgrade_senior_support`}
                    className="rounded-lg border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    Revoke Senior
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
