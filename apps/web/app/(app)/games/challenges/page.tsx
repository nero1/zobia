"use client";

/**
 * app/(app)/games/challenges/page.tsx
 *
 * Challenge inbox + creation. Lists challenges the user sent/received with
 * accept / decline / cancel / delete / archive actions, a search bar to
 * filter the list, and a form to challenge another user (found via a
 * debounced username search-as-you-type, same pattern as the gifts page) to
 * a game (best of 1 or 3) with an optional credit wager.
 *
 * Challenges expire after 30 days (manifest `challengeExpiryHours`, default
 * 720) if the opponent never responds — expiry/refund is swept by
 * /api/cron/games (run externally; see docs/HOW-IT-WORKS.md).
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";

interface GameSummary { slug: string; name: string; }
interface Challenge {
  id: string;
  gameSlug: string;
  gameName: string;
  challengerId: string;
  challengerUsername: string;
  opponentId: string;
  opponentUsername: string;
  status: string;
  rounds: number;
  wagerCredits: number;
  winnerId: string | null;
  expiresAt: string;
  archivedAt: string | null;
}

interface UserSuggestion {
  id: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
}

/** Countdown to a challenge's expires_at (mirrors the Drop Room countdown on the rooms page). */
function useCountdown(isoTarget: string): { label: string; urgent: boolean } {
  const [secs, setSecs] = useState(() => Math.max(0, Math.floor((new Date(isoTarget).getTime() - Date.now()) / 1000)));
  useEffect(() => {
    const t = setInterval(() => setSecs(Math.max(0, Math.floor((new Date(isoTarget).getTime() - Date.now()) / 1000))), 60_000);
    return () => clearInterval(t);
  }, [isoTarget]);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  const label = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  return { label, urgent: secs < 86400 }; // under 1 day left
}

function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const { t } = useTranslation();
  const { label, urgent } = useCountdown(expiresAt);
  return (
    <span className={`text-xs font-medium ${urgent ? "text-red-400" : "text-muted-foreground"}`}>
      ⏳ {t("games.challenges.expiresIn", "Expires in {{time}}", { time: label })}
    </span>
  );
}

export default function ChallengesPage() {
  const { t } = useTranslation();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [form, setForm] = useState({ gameSlug: "", opponentUsername: "", rounds: 1, wagerCredits: 0 });
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Opponent search-as-you-type — reuses GET /api/users/search (same
  // debounced-fetch pattern as the gifts page) instead of requiring the
  // opponent's exact username, which is the main cause of the
  // "Opponent not found" 404 users were seeing on POST /api/games/challenges.
  const [opponentQuery, setOpponentQuery] = useState("");
  const [opponentSuggestions, setOpponentSuggestions] = useState<UserSuggestion[]>([]);
  const [opponentSelected, setOpponentSelected] = useState<UserSuggestion | null>(null);

  const reload = () => {
    fetch("/api/games/challenges", { credentials: "include" })
      .then((r) => r.json())
      .then((b) => setChallenges(b?.data?.challenges ?? []))
      .catch(() => {});
  };

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" }).then((r) => r.json()).then((b) => setMe(b?.user?.id ?? null)).catch(() => {});
    fetch("/api/games", { credentials: "include" })
      .then((r) => r.json())
      .then((b) => {
        const list: GameSummary[] = b?.data?.games ?? [];
        setGames(list);
        if (list[0]) setForm((f) => ({ ...f, gameSlug: list[0].slug }));
      })
      .catch(() => {});
    reload();
  }, []);

  // Debounced opponent search (300ms, same as gifts.tsx).
  useEffect(() => {
    if (opponentSelected && opponentQuery === opponentSelected.username) return;
    setOpponentSelected(null);
    if (opponentQuery.trim().length < 2) { setOpponentSuggestions([]); return; }
    const id = setTimeout(() => {
      fetch(`/api/users/search?q=${encodeURIComponent(opponentQuery.trim())}&limit=6`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((b) => setOpponentSuggestions(b?.data?.users ?? []))
        .catch(() => setOpponentSuggestions([]));
    }, 300);
    return () => clearTimeout(id);
  }, [opponentQuery, opponentSelected]);

  function pickOpponent(u: UserSuggestion) {
    setOpponentSelected(u);
    setOpponentQuery(u.username);
    setOpponentSuggestions([]);
    setForm((f) => ({ ...f, opponentUsername: u.username }));
  }

  async function act(id: string, action: "accept" | "decline" | "cancel") {
    setMsg(null);
    setBusyId(id);
    const res = await fetch(`/api/games/challenges/${id}/${action}`, { method: "POST", credentials: "include" });
    const b = await res.json();
    if (!res.ok) setMsg(b?.error?.message ?? "Action failed.");
    setBusyId(null);
    reload();
  }

  async function remove(id: string) {
    setMsg(null);
    setBusyId(id);
    const res = await fetch(`/api/games/challenges/${id}`, { method: "DELETE", credentials: "include" });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) setMsg(b?.error?.message ?? "Could not delete challenge.");
    else setChallenges((prev) => prev.filter((c) => c.id !== id));
    setBusyId(null);
  }

  async function archive(id: string) {
    setMsg(null);
    setBusyId(id);
    const res = await fetch(`/api/games/challenges/${id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) setMsg(b?.error?.message ?? "Could not archive challenge.");
    else setChallenges((prev) => prev.filter((c) => c.id !== id));
    setBusyId(null);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!opponentSelected) {
      setMsg(t("games.challenges.pickOpponent", "Pick an opponent from the suggestions."));
      return;
    }
    const res = await fetch("/api/games/challenges", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const b = await res.json();
    if (!res.ok) setMsg(b?.error?.message ?? "Could not create challenge.");
    else {
      setMsg(t("games.challengeSent"));
      setOpponentQuery("");
      setOpponentSelected(null);
      setForm((f) => ({ ...f, opponentUsername: "" }));
      reload();
    }
  }

  const filteredChallenges = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return challenges;
    return challenges.filter((c) =>
      c.gameName.toLowerCase().includes(q) ||
      c.challengerUsername.toLowerCase().includes(q) ||
      c.opponentUsername.toLowerCase().includes(q)
    );
  }, [challenges, search]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("games.challenges")}</h1>
        <Link href="/games" className="text-sm text-neutral-400 hover:text-neutral-200">← {t("games.title")}</Link>
      </div>

      <form onSubmit={create} className="mb-6 space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold text-foreground">{t("games.newChallenge")}</h2>
        <select
          value={form.gameSlug}
          onChange={(e) => setForm({ ...form, gameSlug: e.target.value })}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
        >
          {games.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
        </select>

        {/* Opponent search-as-you-type */}
        <div className="relative">
          <input
            value={opponentQuery}
            onChange={(e) => setOpponentQuery(e.target.value)}
            placeholder={t("games.opponentUsername")}
            autoComplete="off"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
          />
          {opponentSelected && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-emerald-400">✓ {opponentSelected.displayName}</span>
          )}
          {!opponentSelected && opponentSuggestions.length > 0 && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-card shadow-modal overflow-hidden">
              {opponentSuggestions.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => pickOpponent(u)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <span className="text-lg">{u.avatarEmoji}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium text-foreground">{u.displayName}</span>
                    <span className="block truncate text-xs text-muted-foreground">@{u.username}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <select
            value={form.rounds}
            onChange={(e) => setForm({ ...form, rounds: Number(e.target.value) })}
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
          >
            <option value={1}>{t("games.bestOf1")}</option>
            <option value={3}>{t("games.bestOf3")}</option>
          </select>
          <input
            type="number"
            min={0}
            value={form.wagerCredits}
            onChange={(e) => setForm({ ...form, wagerCredits: Number(e.target.value) })}
            placeholder={t("games.wager")}
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
          />
        </div>
        <button type="submit" className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90">
          {t("games.sendChallenge")}
        </button>
        {msg && <p className="text-sm text-amber-400">{msg}</p>}
      </form>

      {/* Search bar to filter the challenge list, in addition to the game dropdown above */}
      <div className="relative mb-3">
        <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
        </svg>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("games.challenges.search.placeholder", "Search by game or player…")}
          className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        />
      </div>

      <div className="space-y-3">
        {filteredChallenges.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {challenges.length === 0 ? t("games.noChallenges") : t("games.challenges.noResults", "No challenges match your search.")}
          </p>
        )}
        {filteredChallenges.map((c) => {
          const incoming = c.opponentId === me;
          const isChallenger = c.challengerId === me;
          const canDelete = isChallenger && c.status === "pending";
          const canArchive = c.status === "completed";
          const busy = busyId === c.id;
          return (
            <div key={c.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-foreground">{c.gameName}</div>
                  <div className="text-xs text-muted-foreground">
                    {incoming ? `${t("games.from")} @${c.challengerUsername}` : `${t("games.to")} @${c.opponentUsername}`}
                    {" · "}{c.rounds === 1 ? t("games.bestOf1") : t("games.bestOf3")}
                    {c.wagerCredits > 0 ? ` · ${c.wagerCredits} ${t("games.credits")}` : ""}
                  </div>
                </div>
                <span className="rounded-full bg-neutral-800 px-2 py-1 text-xs text-neutral-300">{t(`games.status.${c.status}`)}</span>
              </div>

              {(c.status === "pending" || c.status === "active") && (
                <div className="mt-2"><ExpiryCountdown expiresAt={c.expiresAt} /></div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {incoming && c.status === "pending" && (
                  <>
                    <button disabled={busy} onClick={() => act(c.id, "accept")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{t("games.accept")}</button>
                    <button disabled={busy} onClick={() => act(c.id, "decline")} className="rounded-lg bg-neutral-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{t("games.decline")}</button>
                  </>
                )}
                {!incoming && (c.status === "pending" || c.status === "active") && (
                  <button disabled={busy} onClick={() => act(c.id, "cancel")} className="rounded-lg bg-neutral-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{t("games.cancel")}</button>
                )}
                {c.status === "active" && (
                  <Link href={`/games/challenges/${c.id}`} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">{t("games.playRound")}</Link>
                )}
                {c.status === "completed" && (
                  <span className="text-xs font-medium text-emerald-400">
                    {c.winnerId === me ? t("games.youWon") : c.winnerId ? t("games.youLost") : t("games.draw")}
                  </span>
                )}
                {canDelete && (
                  <button
                    disabled={busy}
                    onClick={() => remove(c.id)}
                    className="rounded-lg border border-red-800 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-950/40 disabled:opacity-50"
                    title={t("games.challenges.deleteHint", "The opponent hasn't accepted yet — this challenge can be deleted.")}
                  >
                    🗑 {t("games.challenges.delete", "Delete")}
                  </button>
                )}
                {canArchive && (
                  <button
                    disabled={busy}
                    onClick={() => archive(c.id)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-accent disabled:opacity-50"
                  >
                    🗄 {t("games.challenges.archive", "Archive")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
