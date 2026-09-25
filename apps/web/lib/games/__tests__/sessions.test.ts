/**
 * Unit tests for game play-session score validation (anti-cheat guards that
 * run before any DB write).
 *
 * lib/games/sessions.ts has been migrated to Drizzle ORM (getDb() / the
 * query builder / raw `sql` escape hatches) instead of the raw `@/lib/db`
 * adapter. Rather than hand-mock every query shape, these tests back a
 * *real* `drizzle-orm/node-postgres` instance with a fake `pg`-shaped
 * client whose `query()` is a jest.fn. Every query the module issues still
 * goes through real Drizzle query compilation — exactly like production —
 * and lands on `mockQuery` as plain SQL text + params (see
 * lib/seasons/__tests__/seasonEngine.test.ts for the same pattern).
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/drizzle";

const mockQuery = jest.fn();

const fakeClient = {
  query: (queryConfig: unknown, params?: unknown[]) => {
    const text = typeof queryConfig === "string" ? queryConfig : (queryConfig as { text: string }).text;
    return mockQuery(text, params);
  },
};

// `as any` on the client sidesteps drizzle-orm's `$client: Pool` typing
// (a real Pool isn't needed at runtime — drizzle only ever calls
// `client.query()` for a non-Pool client, including inside transactions).
const mockDb = drizzle(fakeClient as any, { schema }) as unknown as DbOrTx;

jest.mock("@/lib/db/drizzle", () => {
  const actual = jest.requireActual("@/lib/db/drizzle");
  return {
    ...actual,
    getDb: async () => mockDb,
  };
});

// sessions.ts does not import `@/lib/db` (the raw adapter) directly, but
// other modules in the require graph may — keep this mocked defensively so
// no test accidentally opens a real connection.
jest.mock("@/lib/db", () => ({ db: {} }));

// Stub modules that would otherwise pull in env/redis at import time.
jest.mock("@/lib/env", () => ({ env: { NODE_ENV: "test" } }));
jest.mock("@/lib/redis", () => ({
  redis: { get: jest.fn(), setex: jest.fn(), getdel: jest.fn() },
}));
jest.mock("@/lib/manifest", () => ({ loadManifest: jest.fn() }));

import { finalizeScore } from "@/lib/games/sessions";
import type { GameConfigRow } from "@/lib/games/repo";

function makeGame(overrides: Partial<GameConfigRow> = {}): GameConfigRow {
  return {
    id: "game-1",
    slug: "tetris",
    name: "Tetris",
    tagline: null,
    description: null,
    long_description: null,
    cover_emoji: "🧩",
    cover_image_url: null,
    category: "Puzzle",
    engine_key: "tetris",
    reward_credits_per_win: 50,
    reward_xp_per_win: 40,
    reward_stars_per_win: 0,
    play_cost_credits: 0,
    play_cost_stars: 0,
    max_score: 1000,
    min_play_seconds: 0,
    play_count: 0,
    avg_rating: 0,
    rating_count: 0,
    favorite_count: 0,
    is_active: true,
    is_public: true,
    created_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("finalizeScore validation", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("rejects a negative score before touching the DB", async () => {
    await expect(
      finalizeScore("user-1", "11111111-1111-1111-1111-111111111111", -5, makeGame())
    ).rejects.toThrow();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects a score above the game's max_score cap", async () => {
    await expect(
      finalizeScore("user-1", "11111111-1111-1111-1111-111111111111", 9999, makeGame({ max_score: 1000 }))
    ).rejects.toThrow(/maximum/i);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("rejects when the play session nonce is unknown", async () => {
    // Passes validation, then the play lookup (raw `sql` SELECT against
    // game_plays) returns no rows → not found. The default mockQuery
    // resolution above already returns an empty result set for every query,
    // so no extra dispatch is needed here.
    await expect(
      finalizeScore("user-1", "11111111-1111-1111-1111-111111111111", 500, makeGame())
    ).rejects.toThrow(/not found/i);
  });
});
