/**
 * Unit tests for game play-session score validation (anti-cheat guards that
 * run before any DB write). The DB is mocked so no connection is made.
 */

const mockQuery = jest.fn();
const mockTransaction = jest.fn();

jest.mock("@/lib/db", () => ({
  db: {
    query: (...a: unknown[]) => mockQuery(...a),
    transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

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
    mockTransaction.mockReset();
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
    // Passes validation, then the play lookup returns no rows → not found.
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await expect(
      finalizeScore("user-1", "11111111-1111-1111-1111-111111111111", 500, makeGame())
    ).rejects.toThrow(/not found/i);
  });
});
