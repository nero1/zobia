"use client";

/**
 * app/(app)/wiki/[slug]/manage/collaborators/page.tsx
 *
 * Collaborators & Moderators: the active collaborator list with
 * grant/revoke moderator, adding/removing "selected" collaborators (only
 * relevant when contribute_policy = 'selected'), and creating/copying
 * invite links. User lookup reuses the existing GET /api/users/search
 * (username prefix search) the way other member-picker UIs in the app do.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";

interface CollaboratorRow {
  id: string;
  user_id: string;
  role: string;
  is_moderator: boolean;
  status: string;
  page_edit_count: number;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

interface InviteRow {
  id: string;
  token: string;
  invited_username: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

interface UserSearchResult {
  id: string;
  username: string;
  displayName: string | null;
}

function UserSearchPicker({ onPick, placeholder }: { onPick: (user: UserSearchResult) => void; placeholder: string }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    const timer = setTimeout(() => {
      fetch(`/api/users/search?q=${encodeURIComponent(q.trim())}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => setResults(json?.data?.users ?? []))
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-border bg-card px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden">
          {results.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => { onPick(u); setQ(""); setResults([]); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
            >
              <span className="font-medium">@{u.username}</span>
              {u.displayName && u.displayName !== u.username && <span className="text-xs text-muted-foreground">{u.displayName}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WikiCollaboratorsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [contributePolicy, setContributePolicy] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<CollaboratorRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [wikiRes, modRes, inviteRes] = await Promise.all([
        fetch(`/api/wiki/${slug}`, { credentials: "include" }),
        fetch(`/api/wiki/${slug}/moderators`, { credentials: "include" }),
        fetch(`/api/wiki/${slug}/invites`, { credentials: "include" }),
      ]);
      const wikiJson = await wikiRes.json().catch(() => null);
      if (!wikiJson?.data?.canManage) { router.replace(`/wiki/${slug}`); return; }
      setContributePolicy(wikiJson.data.wiki.contribute_policy);
      const modJson = await modRes.json().catch(() => null);
      setCollaborators(modJson?.data?.collaborators ?? []);
      const inviteJson = await inviteRes.json().catch(() => null);
      setInvites(inviteJson?.data?.invites ?? []);
    } finally {
      setLoading(false);
    }
  }, [slug, router]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  async function handleGrantModerator(userId: string) {
    setBusyUserId(userId);
    try {
      await fetch(`/api/wiki/${slug}/moderators`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }),
      });
      await loadAll();
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRevokeModerator(userId: string) {
    setBusyUserId(userId);
    try {
      await fetch(`/api/wiki/${slug}/moderators`, {
        method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }),
      });
      await loadAll();
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleAddCollaborator(user: UserSearchResult) {
    setBusyUserId(user.id);
    try {
      const res = await fetch(`/api/wiki/${slug}/collaborators`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: user.id }),
      });
      if (res.ok) await loadAll();
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRemoveCollaborator(userId: string) {
    setBusyUserId(userId);
    try {
      await fetch(`/api/wiki/${slug}/collaborators`, {
        method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }),
      });
      await loadAll();
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleCreateInvite() {
    setCreatingInvite(true);
    setInviteError(null);
    try {
      const res = await fetch(`/api/wiki/${slug}/invites`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: inviteUsername.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? t("wiki.manage.errors.inviteGeneric", "Failed to create invite"));
      setInviteUsername("");
      await loadAll();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : t("wiki.manage.errors.inviteGeneric", "Failed to create invite"));
    } finally {
      setCreatingInvite(false);
    }
  }

  async function copyInviteLink(token: string) {
    const url = `${window.location.origin}/wiki/invite/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    } catch { /* ignore */ }
  }

  if (loading) return <div className="mx-auto max-w-2xl px-4 py-8 text-muted-foreground">{t("wiki.loading", "Loading…")}</div>;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-8">
      <div>
        <Link href={`/wiki/${slug}/manage`} className="mb-2 inline-block text-xs text-muted-foreground hover:text-foreground">
          ← {t("wiki.dashboard.backToManage", "Back to manage")}
        </Link>
        <h1 className="text-2xl font-bold text-foreground">{t("wiki.dashboard.collaborators", "Collaborators")}</h1>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-foreground mb-2">{t("wiki.manage.moderatorsTitle", "Moderators")}</h2>
        <p className="mb-3 text-xs text-muted-foreground">{t("wiki.manage.moderatorsHint", "Moderators can manage settings, pages, and other collaborators just like you.")}</p>
        <div className="space-y-1.5">
          {collaborators.length === 0 && <p className="text-sm text-muted-foreground">{t("wiki.manage.empty", "No collaborators yet.")}</p>}
          {collaborators.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                  @{c.username}
                  {c.is_moderator && <span className="ml-2 rounded-full bg-blue-950/40 px-1.5 py-0.5 text-[10px] text-blue-400">{t("wiki.manage.moderatorBadge", "Moderator")}</span>}
                </div>
                <div className="text-[11px] text-muted-foreground">{t("wiki.manage.editCount", "{{count}} page edits", { count: c.page_edit_count })}</div>
              </div>
              <button
                type="button"
                disabled={busyUserId === c.user_id}
                onClick={() => (c.is_moderator ? handleRevokeModerator(c.user_id) : handleGrantModerator(c.user_id))}
                className="flex-shrink-0 rounded-lg bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
              >
                {c.is_moderator ? t("wiki.manage.revokeModerator", "Remove moderator") : t("wiki.manage.grantModerator", "Make moderator")}
              </button>
            </div>
          ))}
        </div>
      </section>

      {contributePolicy === "selected" && (
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-2">{t("wiki.manage.selectedTitle", "Selected contributors")}</h2>
          <p className="mb-3 text-xs text-muted-foreground">{t("wiki.manage.selectedHint", "Since contribution is set to \"Selected people\", only users added here (or who accepted an invite) can create or edit pages.")}</p>
          <UserSearchPicker onPick={handleAddCollaborator} placeholder={t("wiki.manage.searchPlaceholder", "Search by username to add…")} />
          <div className="mt-3 space-y-1.5">
            {collaborators.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                <div className="text-sm text-foreground">@{c.username}</div>
                <button
                  type="button"
                  disabled={busyUserId === c.user_id}
                  onClick={() => handleRemoveCollaborator(c.user_id)}
                  className="flex-shrink-0 rounded-lg bg-red-950/40 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/70 disabled:opacity-50"
                >
                  {t("wiki.manage.removeCollaborator", "Remove")}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold text-foreground mb-2">{t("wiki.manage.invitesTitle", "Invite links")}</h2>
        <p className="mb-3 text-xs text-muted-foreground">{t("wiki.manage.invitesHint", "Create an open link anyone can use, or target a specific username.")}</p>
        <div className="flex flex-wrap gap-2 mb-3">
          <input
            value={inviteUsername}
            onChange={(e) => setInviteUsername(e.target.value)}
            placeholder={t("wiki.manage.inviteUsernamePlaceholder", "Username (optional — leave blank for an open link)")}
            className="flex-1 min-w-[200px] rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
          />
          <button
            type="button"
            onClick={handleCreateInvite}
            disabled={creatingInvite}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {creatingInvite ? t("wiki.manage.creatingInvite", "Creating…") : t("wiki.manage.createInvite", "Create invite")}
          </button>
        </div>
        {inviteError && <p className="mb-2 text-sm text-red-500">{inviteError}</p>}
        <div className="space-y-1.5">
          {invites.length === 0 && <p className="text-sm text-muted-foreground">{t("wiki.manage.invitesEmpty", "No invites yet.")}</p>}
          {invites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
              <div className="min-w-0">
                <div className="text-sm text-foreground truncate">
                  {inv.invited_username ? `@${inv.invited_username}` : t("wiki.manage.openInvite", "Open link")}
                  {inv.used_at && <span className="ml-2 text-[10px] text-muted-foreground">{t("wiki.manage.inviteUsed", "used")}</span>}
                  {!inv.used_at && new Date(inv.expires_at) < new Date() && <span className="ml-2 text-[10px] text-red-400">{t("wiki.manage.inviteExpired", "expired")}</span>}
                </div>
                <div className="text-[11px] text-muted-foreground">{t("wiki.manage.inviteExpiresAt", "Expires {{date}}", { date: new Date(inv.expires_at).toLocaleDateString() })}</div>
              </div>
              {!inv.used_at && (
                <button
                  type="button"
                  onClick={() => copyInviteLink(inv.token)}
                  className="flex-shrink-0 rounded-lg bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
                >
                  {copiedToken === inv.token ? t("wiki.manage.linkCopied", "Copied ✓") : t("wiki.manage.copyLink", "Copy link")}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
