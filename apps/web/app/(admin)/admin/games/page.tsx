"use client";

/**
 * app/(admin)/admin/games/page.tsx
 *
 * Admin Games management:
 *  - List every game with summary stats (players, wins, challenges, plays).
 *  - Create / edit a game's cover page (name, slug, descriptions, emoji, cover
 *    image url, category), rewards (credits/xp/stars per win), play cost
 *    (free / credits / stars), score cap, min play time, sort order.
 *  - Activate / deactivate and delete games.
 *  - View per-game stats.
 *  - Manage global games-played milestones.
 *
 * Mirrors the existing admin CRUD pattern (e.g. branded-rooms). Admin only.
 */

import { useEffect, useState } from "react";

const CATEGORIES = [
  "Tap", "Arcade", "Puzzle", "Card", "Board", "Idle", "Word", "Action", "Casual",
  "Trivia", "Strategy", "Sports", "Music",
];
const ENGINE_KEYS = [
  // Original 26
  "tetris", "g2048", "carRacing", "spaceShooter", "snake", "breakout",
  "tapFrenzy", "bubbleBurst", "reactionRush", "colorTap",
  "flappyDuck", "stackTower",
  "cookieKingdom", "galaxyMiner",
  "memoryMatch", "slidePuzzle", "minesweeper", "colorSort",
  "blackjack", "whot", "higherOrLower",
  "chess", "ludo",
  "wordScramble", "simonSays",
  "rockPaperScissors",
  // Expansion: 30 new
  "sudoku", "wordSearch", "lightsOut", "numberMatch", "nonogram",
  "pipeConnect", "slidingBlocks", "mahjongSolitaire",
  "whackAMole", "fruitSlicer",
  "ayo",
  "platformJumper", "pixelRunner", "asteroidDodge",
  "speedTap", "colorRain",
  "quickQuiz", "trueOrFalse", "emojiQuiz", "flagQuiz",
  "wordGuess", "hangman", "anagramRush",
  "ticTacToe", "connectFour",
  "gemSwap", "dotsAndBoxes",
  "penaltyKick", "basketballShot",
  "beatTap",
];

interface GameRow {
  id: string;
  slug: string;
  name: string;
  category: string | null;
  engine_key: string | null;
  cover_emoji: string;
  cover_image_url: string | null;
  tagline: string | null;
  is_active: boolean;
  sort_order: number;
  reward_credits_per_win: number;
  reward_xp_per_win: number;
  reward_stars_per_win: number;
  play_cost_credits: number;
  play_cost_stars: number;
  max_score: number | null;
  min_play_seconds: number;
  play_count: number;
  players: number;
  total_wins: number;
  challenges: number;
}

type FormState = Partial<GameRow> & {
  longDescription?: string;
  description?: string;
};

const EMPTY: FormState = {
  name: "",
  slug: "",
  category: "Puzzle",
  engine_key: "tetris",
  cover_emoji: "🎮",
  tagline: "",
  reward_credits_per_win: 50,
  reward_xp_per_win: 40,
  reward_stars_per_win: 0,
  play_cost_credits: 0,
  play_cost_stars: 0,
  min_play_seconds: 5,
  sort_order: 0,
  is_active: true,
};

type AdminViewMode = "list" | "card";

export default function AdminGamesPage() {
  const [games, setGames] = useState<GameRow[]>([]);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<AdminViewMode>("list");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");

  const load = () => {
    fetch("/api/admin/games", { credentials: "include" })
      .then((r) => r.json())
      .then((b) => setGames(b?.data?.games ?? []))
      .catch(() => {});
  };
  useEffect(load, []);

  const filtered = games.filter((g) => {
    const matchesSearch = !search || g.name.toLowerCase().includes(search.toLowerCase()) || g.slug.includes(search.toLowerCase());
    const matchesCat = !categoryFilter || g.category === categoryFilter;
    return matchesSearch && matchesCat;
  });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setMsg(null);
    const isEdit = !!editing.id;
    const payload = {
      name: editing.name,
      slug: editing.slug || undefined,
      category: editing.category,
      engineKey: editing.engine_key,
      tagline: editing.tagline ?? null,
      description: editing.description ?? null,
      longDescription: editing.longDescription ?? null,
      coverEmoji: editing.cover_emoji,
      coverImageUrl: editing.cover_image_url || null,
      rewardCreditsPerWin: Number(editing.reward_credits_per_win ?? 0),
      rewardXpPerWin: Number(editing.reward_xp_per_win ?? 0),
      rewardStarsPerWin: Number(editing.reward_stars_per_win ?? 0),
      playCostCredits: Number(editing.play_cost_credits ?? 0),
      playCostStars: Number(editing.play_cost_stars ?? 0),
      maxScore: editing.max_score ?? null,
      minPlaySeconds: Number(editing.min_play_seconds ?? 0),
      sortOrder: Number(editing.sort_order ?? 0),
      isActive: editing.is_active ?? true,
    };
    const res = await fetch(isEdit ? `/api/admin/games/${editing.id}` : "/api/admin/games", {
      method: isEdit ? "PUT" : "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const b = await res.json();
    if (!res.ok) setMsg(b?.error?.message ?? "Save failed.");
    else { setEditing(null); load(); }
  }

  async function toggleActive(g: GameRow) {
    await fetch(`/api/admin/games/${g.id}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !g.is_active }),
    });
    load();
  }

  async function del(g: GameRow) {
    if (!confirm(`Delete "${g.name}"? It will disappear from the directory.`)) return;
    await fetch(`/api/admin/games/${g.id}`, { method: "DELETE", credentials: "include" });
    load();
  }

  async function viewStats(g: GameRow) {
    const res = await fetch(`/api/admin/games/${g.id}/stats`, { credentials: "include" });
    const b = await res.json();
    setStats({ name: g.name, ...b?.data });
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Games <span className="text-sm font-normal text-neutral-500">({games.length} total)</span></h1>
        <button onClick={() => setEditing({ ...EMPTY })} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          + New game
        </button>
      </div>

      {/* Search + filter row */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search games…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm flex-1 min-w-40"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border px-2 py-1.5 text-sm"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>

        {/* View toggle — list default for admin */}
        <div className="flex rounded-lg border overflow-hidden">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
          >
            ☰ List
          </button>
          <button
            type="button"
            onClick={() => setViewMode("card")}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "card" ? "bg-primary text-primary-foreground" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}
          >
            ⊞ Cards
          </button>
        </div>
      </div>

      {msg && <p className="mb-3 text-sm text-amber-600">{msg}</p>}

      {/* List view (table) */}
      {viewMode === "list" && (
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-neutral-500">
              <th className="py-2">Game</th>
              <th>Category</th>
              <th>Plays</th>
              <th>Players</th>
              <th>Reward</th>
              <th>Cost</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g) => (
              <tr key={g.id} className="border-b hover:bg-neutral-50">
                <td className="py-2">{g.cover_emoji} {g.name} <span className="text-xs text-neutral-400">/{g.slug}</span></td>
                <td><span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs">{g.category}</span></td>
                <td>{g.play_count}</td>
                <td>{g.players}</td>
                <td className="text-xs text-neutral-600">{g.reward_credits_per_win}c/{g.reward_xp_per_win}xp{g.reward_stars_per_win ? `/${g.reward_stars_per_win}⭐` : ""}</td>
                <td className="text-xs">{g.play_cost_credits || g.play_cost_stars ? `${g.play_cost_credits}c${g.play_cost_stars ? `/${g.play_cost_stars}⭐` : ""}` : <span className="text-emerald-600">Free</span>}</td>
                <td>
                  <button onClick={() => toggleActive(g)} className={`rounded px-2 py-0.5 text-xs ${g.is_active ? "bg-emerald-100 text-emerald-700" : "bg-neutral-200 text-neutral-600"}`}>
                    {g.is_active ? "On" : "Off"}
                  </button>
                </td>
                <td className="space-x-2 whitespace-nowrap text-right">
                  <button onClick={() => viewStats(g)} className="text-xs text-blue-600">Stats</button>
                  <button onClick={() => setEditing({ ...g })} className="text-xs text-neutral-600">Edit</button>
                  <button onClick={() => del(g)} className="text-xs text-red-600">Del</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="py-8 text-center text-neutral-400">No games match your search.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      )}

      {/* Card view */}
      {viewMode === "card" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {filtered.map((g) => (
            <div key={g.id} className="rounded-xl border bg-white p-3 flex flex-col gap-2 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2">
                <span className="text-3xl">{g.cover_emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{g.name}</div>
                  <div className="text-[10px] text-neutral-500 truncate">/{g.slug}</div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium">{g.category}</span>
                <button onClick={() => toggleActive(g)} className={`rounded px-1.5 py-0.5 text-[10px] ${g.is_active ? "bg-emerald-100 text-emerald-700" : "bg-neutral-200 text-neutral-500"}`}>
                  {g.is_active ? "Active" : "Off"}
                </button>
              </div>
              <div className="text-[10px] text-neutral-500">{g.play_count} plays · {g.players} players</div>
              <div className="text-[10px]">
                {g.play_cost_credits || g.play_cost_stars ? (
                  <span className="text-amber-600">{g.play_cost_credits}c cost</span>
                ) : (
                  <span className="text-emerald-600">Free</span>
                )}
              </div>
              <div className="flex gap-1.5 text-[11px] mt-auto">
                <button onClick={() => viewStats(g)} className="text-blue-600 hover:underline">Stats</button>
                <button onClick={() => setEditing({ ...g })} className="text-neutral-600 hover:underline">Edit</button>
                <button onClick={() => del(g)} className="text-red-500 hover:underline">Del</button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full py-8 text-center text-neutral-400">No games match your search.</div>
          )}
        </div>
      )}

      {stats && (
        <div className="mt-4 rounded-xl border bg-neutral-50 p-4 text-sm">
          <div className="mb-2 flex justify-between">
            <strong>{String(stats.name)} — stats</strong>
            <button onClick={() => setStats(null)} className="text-neutral-500">✕</button>
          </div>
          <pre className="overflow-auto text-xs">{JSON.stringify(stats, null, 2)}</pre>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
          <form onSubmit={save} className="mt-8 w-full max-w-lg space-y-3 rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold">{editing.id ? "Edit game" : "New game"}</h2>
            <Field label="Name"><input className="inp" value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required /></Field>
            <Field label="Slug (optional)"><input className="inp" value={editing.slug ?? ""} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder="auto from name" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <select className="inp" value={editing.category ?? "Puzzle"} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Engine">
                <select className="inp" value={editing.engine_key ?? "tetris"} onChange={(e) => setEditing({ ...editing, engine_key: e.target.value })}>
                  {ENGINE_KEYS.map((k) => <option key={k}>{k}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Emoji"><input className="inp" value={editing.cover_emoji ?? ""} onChange={(e) => setEditing({ ...editing, cover_emoji: e.target.value })} /></Field>
            <Field label="Cover image URL"><input className="inp" value={editing.cover_image_url ?? ""} onChange={(e) => setEditing({ ...editing, cover_image_url: e.target.value })} placeholder="https://…" /></Field>
            <Field label="Tagline (listing)"><input className="inp" value={editing.tagline ?? ""} onChange={(e) => setEditing({ ...editing, tagline: e.target.value })} /></Field>
            <Field label="Short description (listing)"><textarea className="inp" value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
            <Field label="Long description (cover page)"><textarea className="inp" rows={3} value={editing.longDescription ?? ""} onChange={(e) => setEditing({ ...editing, longDescription: e.target.value })} /></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Win credits"><input className="inp" type="number" value={editing.reward_credits_per_win ?? 0} onChange={(e) => setEditing({ ...editing, reward_credits_per_win: Number(e.target.value) })} /></Field>
              <Field label="Win XP"><input className="inp" type="number" value={editing.reward_xp_per_win ?? 0} onChange={(e) => setEditing({ ...editing, reward_xp_per_win: Number(e.target.value) })} /></Field>
              <Field label="Win stars"><input className="inp" type="number" value={editing.reward_stars_per_win ?? 0} onChange={(e) => setEditing({ ...editing, reward_stars_per_win: Number(e.target.value) })} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Play cost (credits)"><input className="inp" type="number" value={editing.play_cost_credits ?? 0} onChange={(e) => setEditing({ ...editing, play_cost_credits: Number(e.target.value) })} /></Field>
              <Field label="Play cost (stars)"><input className="inp" type="number" value={editing.play_cost_stars ?? 0} onChange={(e) => setEditing({ ...editing, play_cost_stars: Number(e.target.value) })} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Max score"><input className="inp" type="number" value={editing.max_score ?? ""} onChange={(e) => setEditing({ ...editing, max_score: e.target.value === "" ? null : Number(e.target.value) })} /></Field>
              <Field label="Min play secs"><input className="inp" type="number" value={editing.min_play_seconds ?? 0} onChange={(e) => setEditing({ ...editing, min_play_seconds: Number(e.target.value) })} /></Field>
              <Field label="Sort order"><input className="inp" type="number" value={editing.sort_order ?? 0} onChange={(e) => setEditing({ ...editing, sort_order: Number(e.target.value) })} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.is_active ?? true} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> Active
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
              <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Save</button>
            </div>
            {msg && <p className="text-sm text-red-600">{msg}</p>}
          </form>
        </div>
      )}

      <MilestonesManager />

      <style jsx>{`
        .inp {
          width: 100%;
          border: 1px solid #d4d4d4;
          border-radius: 0.5rem;
          padding: 0.4rem 0.6rem;
          font-size: 0.875rem;
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

interface Milestone {
  id: string;
  games_played_threshold: number;
  reward_credits: number;
  reward_xp: number;
  reward_stars: number;
  is_active: boolean;
}

function MilestonesManager() {
  const [items, setItems] = useState<Milestone[]>([]);
  const [draft, setDraft] = useState({ gamesPlayedThreshold: 0, rewardCredits: 0, rewardXp: 0, rewardStars: 0 });

  const load = () => {
    fetch("/api/admin/game-milestones", { credentials: "include" })
      .then((r) => r.json())
      .then((b) => setItems(b?.data?.milestones ?? []))
      .catch(() => {});
  };
  useEffect(load, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    await fetch("/api/admin/game-milestones", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setDraft({ gamesPlayedThreshold: 0, rewardCredits: 0, rewardXp: 0, rewardStars: 0 });
    load();
  }
  async function remove(id: string) {
    await fetch(`/api/admin/game-milestones/${id}`, { method: "DELETE", credentials: "include" });
    load();
  }

  return (
    <div className="mt-10">
      <h2 className="mb-3 text-lg font-bold">Games-played milestones (gaming track)</h2>
      <ul className="mb-3 space-y-1 text-sm">
        {items.map((m) => (
          <li key={m.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
            <span>{m.games_played_threshold} plays → +{m.reward_credits}c +{m.reward_xp}xp{m.reward_stars ? ` +${m.reward_stars}⭐` : ""}</span>
            <button onClick={() => remove(m.id)} className="text-xs text-red-600">Delete</button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 text-sm">
        <input className="w-24 rounded border px-2 py-1" type="number" placeholder="plays" value={draft.gamesPlayedThreshold || ""} onChange={(e) => setDraft({ ...draft, gamesPlayedThreshold: Number(e.target.value) })} />
        <input className="w-24 rounded border px-2 py-1" type="number" placeholder="credits" value={draft.rewardCredits || ""} onChange={(e) => setDraft({ ...draft, rewardCredits: Number(e.target.value) })} />
        <input className="w-24 rounded border px-2 py-1" type="number" placeholder="xp" value={draft.rewardXp || ""} onChange={(e) => setDraft({ ...draft, rewardXp: Number(e.target.value) })} />
        <input className="w-24 rounded border px-2 py-1" type="number" placeholder="stars" value={draft.rewardStars || ""} onChange={(e) => setDraft({ ...draft, rewardStars: Number(e.target.value) })} />
        <button type="submit" className="rounded bg-primary px-3 py-1 font-semibold text-primary-foreground">Add</button>
      </form>
    </div>
  );
}
