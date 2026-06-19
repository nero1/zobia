"use client";

/**
 * app/(app)/games/challenges/page.tsx
 *
 * Challenge inbox + creation. Lists challenges the user sent/received with
 * accept / decline / cancel actions, and a form to challenge another user to a
 * game (best of 1 or 3) with an optional credit wager.
 */

import { useEffect, useState } from "react";
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
}

export default function ChallengesPage() {
  const { t } = useTranslation();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [form, setForm] = useState({ gameSlug: "", opponentUsername: "", rounds: 1, wagerCredits: 0 });
  const [msg, setMsg] = useState<string | null>(null);

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

  async function act(id: string, action: "accept" | "decline" | "cancel") {
    setMsg(null);
    const res = await fetch(`/api/games/challenges/${id}/${action}`, { method: "POST", credentials: "include" });
    const b = await res.json();
    if (!res.ok) setMsg(b?.error?.message ?? "Action failed.");
    reload();
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch("/api/games/challenges", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const b = await res.json();
    if (!res.ok) setMsg(b?.error?.message ?? "Could not create challenge.");
    else { setMsg(t("games.challengeSent")); reload(); }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("games.challenges")}</h1>
        <Link href="/games" className="text-sm text-neutral-400 hover:text-neutral-200">← {t("games.title")}</Link>
      </div>

      <form onSubmit={create} className="mb-6 space-y-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="font-semibold text-neutral-100">{t("games.newChallenge")}</h2>
        <select
          value={form.gameSlug}
          onChange={(e) => setForm({ ...form, gameSlug: e.target.value })}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
        >
          {games.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
        </select>
        <input
          value={form.opponentUsername}
          onChange={(e) => setForm({ ...form, opponentUsername: e.target.value })}
          placeholder={t("games.opponentUsername")}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100"
        />
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

      <div className="space-y-3">
        {challenges.length === 0 && <p className="text-sm text-muted-foreground">{t("games.noChallenges")}</p>}
        {challenges.map((c) => {
          const incoming = c.opponentId === me;
          return (
            <div key={c.id} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-neutral-100">{c.gameName}</div>
                  <div className="text-xs text-neutral-400">
                    {incoming ? `${t("games.from")} @${c.challengerUsername}` : `${t("games.to")} @${c.opponentUsername}`}
                    {" · "}{c.rounds === 1 ? t("games.bestOf1") : t("games.bestOf3")}
                    {c.wagerCredits > 0 ? ` · ${c.wagerCredits} ${t("games.credits")}` : ""}
                  </div>
                </div>
                <span className="rounded-full bg-neutral-800 px-2 py-1 text-xs text-neutral-300">{t(`games.status.${c.status}`)}</span>
              </div>
              <div className="mt-3 flex gap-2">
                {incoming && c.status === "pending" && (
                  <>
                    <button onClick={() => act(c.id, "accept")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">{t("games.accept")}</button>
                    <button onClick={() => act(c.id, "decline")} className="rounded-lg bg-neutral-700 px-3 py-1.5 text-xs font-semibold text-white">{t("games.decline")}</button>
                  </>
                )}
                {!incoming && (c.status === "pending" || c.status === "active") && (
                  <button onClick={() => act(c.id, "cancel")} className="rounded-lg bg-neutral-700 px-3 py-1.5 text-xs font-semibold text-white">{t("games.cancel")}</button>
                )}
                {c.status === "active" && (
                  <Link href={`/games/challenges/${c.id}`} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">{t("games.playRound")}</Link>
                )}
                {c.status === "completed" && (
                  <span className="text-xs font-medium text-emerald-400">
                    {c.winnerId === me ? t("games.youWon") : c.winnerId ? t("games.youLost") : t("games.draw")}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
