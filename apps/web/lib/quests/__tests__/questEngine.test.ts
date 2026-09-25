/**
 * Unit tests for lib/quests/questEngine.ts
 *
 * lib/quests/questEngine.ts has been migrated to Drizzle ORM (getDb() /
 * orm.transaction() / the query builder) instead of the raw `@/lib/db`
 * adapter. Rather than hand-mock every `.select()/.insert()/.update()`
 * chain shape (which would silently drift from what Drizzle actually
 * compiles), these tests back a *real* `drizzle-orm/node-postgres`
 * instance with a fake `pg`-shaped client whose `query()` is a jest.fn.
 * Every query the engine issues still goes through real Drizzle query
 * compilation — exactly like production — and lands on `mockQuery` as
 * plain SQL text + params, which tests dispatch on the same way the old
 * raw-adapter tests dispatched on `db.query`'s SQL string.
 *
 * Note: `client.query()` for a "fields" (select) query is invoked in
 * pg's positional ("array") row mode, so mocked rows must be arrays of
 * values in the same order as the `.select({...})` object passed to the
 * real query — not keyed objects.
 *
 * Tests verify:
 *  - generateDailyDeck returns correct deck sizes per plan
 *  - generateDailyDeck filters quests by plan hierarchy (BUG-QS01 fix)
 *  - updateQuestProgress increments counter and marks completed
 *  - updateQuestProgress is idempotent — no double awards
 *  - resetDailyQuests bulk-resets user_quest_progress rows
 */

// ---------------------------------------------------------------------------
// Build a real Drizzle instance backed by a mock client, then mock
// @/lib/db/drizzle's getDb() to return it (questEngine.ts calls getDb()
// directly for its transactional operations, ignoring the `db` param it
// also accepts — so tests pass `mockDb` as both).
// ---------------------------------------------------------------------------

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

jest.mock("@/lib/economy/coins", () => ({
  creditCoins: jest.fn().mockResolvedValue(undefined),
}));

// generateDailyDeck acquires (and releases) a per-user+date Redis lock
// (BUG-006 fix) around the deck insert — mock it the same way @/lib/db/drizzle
// is mocked above so tests don't need a live REDIS_PROVIDER. `get`/`del` are
// used to release the lock only if this call still owns it, so `get` must
// echo back whatever value `set` "stored" for that lock-release check to
// behave correctly.
const mockRedisStore = new Map<string, string>();
jest.mock("@/lib/redis", () => ({
  redis: {
    set: jest.fn((key: string, value: string) => {
      mockRedisStore.set(key, value);
      return Promise.resolve("OK");
    }),
    get: jest.fn((key: string) => Promise.resolve(mockRedisStore.get(key) ?? null)),
    del: jest.fn((key: string) => {
      mockRedisStore.delete(key);
      return Promise.resolve(1);
    }),
    // REDIS-COST-01: the deck lock is released with a compare-and-delete Lua
    // script (atomic, and one round-trip instead of GET-then-DEL). The script
    // body is fixed, so the mock just reproduces its semantics against the
    // in-memory store rather than interpreting Lua.
    eval: jest.fn((_script: string, _numKeys: number, key: string, expected: string) => {
      if (mockRedisStore.get(key) === expected) {
        mockRedisStore.delete(key);
        return Promise.resolve(1);
      }
      return Promise.resolve(0);
    }),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  generateDailyDeck,
  updateQuestProgress,
  resetDailyQuests,
} from "@/lib/quests/questEngine";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockRedisStore.clear();
});

// ---------------------------------------------------------------------------
// Row builders — positional arrays matching each query's `.select({...})`
// column order (see file-header note on pg's array row mode).
// ---------------------------------------------------------------------------

/** Matches the `allTemplatesRaw` select in generateDailyDeck. */
function allTemplatesRow(f: {
  id: string;
  title?: string;
  description?: string;
  actionType?: string;
  targetCount?: number;
  xpReward?: number;
  coinReward?: number;
  category?: string;
  icon?: string | null;
  planRequired?: string | null;
  track?: string | null;
  featureKey?: string | null;
}) {
  return [
    f.id,
    f.title ?? `Quest ${f.id}`,
    f.description ?? "Do something",
    f.actionType ?? "send_message",
    f.targetCount ?? 5,
    f.xpReward ?? 50,
    f.coinReward ?? 10,
    f.category ?? "social",
    f.icon ?? null,
    f.planRequired ?? null,
    f.track ?? "main",
    f.featureKey ?? null,
  ];
}

/** Matches the final `assignedRows` (joined) select in generateDailyDeck. */
function assignedRow(f: {
  id: string;
  title?: string;
  description?: string;
  actionType?: string;
  targetCount?: number;
  xpReward?: number;
  coinReward?: number;
  category?: string;
  icon?: string | null;
  planRequired?: string | null;
  track?: string | null;
  progressCount?: number;
  completed?: boolean;
  completedAt?: Date | string | null;
}) {
  return [
    f.id,
    f.title ?? `Quest ${f.id}`,
    f.description ?? "Do something",
    f.actionType ?? "send_message",
    f.targetCount ?? 5,
    f.xpReward ?? 50,
    f.coinReward ?? 10,
    f.category ?? "social",
    f.icon ?? null,
    f.planRequired ?? null,
    f.track ?? "main",
    f.progressCount ?? 0,
    f.completed ?? false,
    f.completedAt ?? null,
  ];
}

/** Matches the `quest` select in updateQuestProgress's transaction. */
function questRow(f: {
  id: string;
  targetCount: number;
  xpReward: number;
  coinReward: number;
  actionType?: string;
  category?: string;
  icon?: string | null;
  planRequired?: string | null;
  track?: string | null;
  sponsoredQuestId?: string | null;
}) {
  return [
    f.id,
    f.targetCount,
    f.xpReward,
    f.coinReward,
    f.actionType ?? "send_message",
    f.category ?? "social",
    f.icon ?? null,
    f.planRequired ?? null,
    f.track ?? "main",
    f.sponsoredQuestId ?? null,
  ];
}

// ---------------------------------------------------------------------------
// generateDailyDeck
// ---------------------------------------------------------------------------

describe("generateDailyDeck", () => {
  it("returns empty array when no templates are available", async () => {
    // All queries fall back to the default empty-rows mock — no existing
    // deck, no templates, nothing to insert, nothing assigned.
    const deck = await generateDailyDeck("user-1", "free", mockDb);
    expect(deck).toEqual([]);
  });

  it("returns deck with progress merged in", async () => {
    const templates = [
      allTemplatesRow({ id: "q1" }),
      allTemplatesRow({ id: "q2" }),
      allTemplatesRow({ id: "q3" }),
    ];

    // Final query joins user_quest_decks with quest_templates + user_quest_progress —
    // merge the template rows with per-quest progress the same way that JOIN would.
    const joined = [
      assignedRow({ id: "q1", progressCount: 3, completed: false, completedAt: null }),
      assignedRow({ id: "q2", progressCount: 0, completed: false, completedAt: null }),
      assignedRow({ id: "q3", progressCount: 0, completed: false, completedAt: null }),
    ];

    // Dispatch on the compiled SQL text rather than on call ordinal: the
    // engine's query sequence is an implementation detail that legitimately
    // changes (REDIS-COST-01 added a pre-lock existence check, so the "does a
    // deck already exist" read now happens twice on a cold day), and a
    // positional mock turns any such change into a spurious failure.
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('from "user_quest_decks"') && !text.includes("inner join") && !text.includes('"quest_id" =')) {
        // no existing deck (both the pre-check and the re-check inside the lock)
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (text.includes('"quest_templates"."sponsored_quest_id" is null')) {
        // the all-eligible-templates fetch
        return Promise.resolve({ rows: templates, rowCount: templates.length });
      }
      if (text.startsWith('insert into "user_quest_decks"')) {
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      if (text.includes('inner join "quest_templates"')) {
        // final re-read: user_quest_decks JOIN quest_templates LEFT JOIN user_quest_progress
        return Promise.resolve({ rows: joined, rowCount: joined.length });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const deck = await generateDailyDeck("user-1", "free", mockDb);

    expect(deck).toHaveLength(3);
    const q1 = deck.find((d) => d.id === "q1");
    expect(q1?.progress_count).toBe(3);
    const q2 = deck.find((d) => d.id === "q2");
    expect(q2?.progress_count).toBe(0);
  });

  it("passes correct plan filter SQL (BUG-QS01 fix)", async () => {
    await generateDailyDeck("user-1", "pro", mockDb);

    // Find the template fetch by its table rather than by call ordinal — the
    // surrounding call sequence is an implementation detail (REDIS-COST-01
    // added a pre-lock deck-existence check ahead of it).
    const templateCall = mockQuery.mock.calls.find(
      ([text]: [string]) => typeof text === "string" && text.includes('"quest_templates"."sponsored_quest_id" is null')
    );
    expect(templateCall).toBeDefined();
    const [sql, params] = templateCall as [string, unknown[]];

    // After the fix, the plan filter must use hierarchical plan_required
    // logic: NULL (always eligible) OR plan_required IN <allowed tiers>.
    expect(sql).toMatch(/"plan_required" is null or \(.*"plan_required" in|"plan_required" is null or "quest_templates"\."plan_required" in/);
    // 'pro' unlocks its own tier and every tier below it (free, plus, pro) —
    // but never 'max', which sits above it in the hierarchy.
    expect(params).toEqual(expect.arrayContaining(["free", "plus", "pro"]));
    expect(params).not.toEqual(expect.arrayContaining(["max"]));
  });
});

// ---------------------------------------------------------------------------
// updateQuestProgress
// ---------------------------------------------------------------------------

describe("updateQuestProgress", () => {
  it("returns no-op when quest is already completed", async () => {
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('from "quest_templates"') && text.includes('"quest_templates"."id" =')) {
        return Promise.resolve({ rows: [questRow({ id: "q1", targetCount: 5, xpReward: 50, coinReward: 10 })], rowCount: 1 });
      }
      if (text.includes('from "user_quest_decks"') && text.includes('"quest_id" =')) {
        return Promise.resolve({ rows: [["q1"]], rowCount: 1 });
      }
      if (text.includes('from "user_quest_progress"') && text.includes("for update")) {
        return Promise.resolve({ rows: [[5, true]], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await updateQuestProgress("user-1", "q1", 1, mockDb);

    expect(result.newly_completed).toBe(false);
    expect(result.xp_awarded).toBe(0);
  });

  it("throws when quest is not found", async () => {
    // Default mock returns no rows for every query — the quest_templates
    // lookup comes back empty, so the quest genuinely doesn't exist.
    await expect(updateQuestProgress("user-1", "nonexistent", 1, mockDb)).rejects.toThrow(
      /Quest not found/
    );
  });

  it("marks quest complete and awards XP when target reached", async () => {
    mockQuery.mockImplementation((text: string) => {
      if (text.includes('from "quest_templates"') && text.includes('"quest_templates"."id" =')) {
        return Promise.resolve({
          rows: [questRow({ id: "q1", targetCount: 3, xpReward: 100, coinReward: 20 })],
          rowCount: 1,
        });
      }
      if (text.includes('from "user_quest_decks"') && text.includes('"quest_id" =')) {
        return Promise.resolve({ rows: [["q1"]], rowCount: 1 });
      }
      if (text.includes('from "user_quest_progress"') && text.includes("for update")) {
        return Promise.resolve({ rows: [[2, false]], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await updateQuestProgress("user-1", "q1", 1, mockDb);

    expect(result.newly_completed).toBe(true);
    expect(result.xp_awarded).toBe(100);
    expect(result.coins_awarded).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// resetDailyQuests
// ---------------------------------------------------------------------------

describe("resetDailyQuests", () => {
  it("resets user_quest_progress rows", async () => {
    mockQuery.mockImplementation((text: string) => {
      if (text.startsWith('update "user_quest_progress"')) {
        return Promise.resolve({ rows: [["row-1"], ["row-2"]], rowCount: 2 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });

    const result = await resetDailyQuests(mockDb);

    expect(mockQuery).toHaveBeenCalled();
    const updateCall = mockQuery.mock.calls.find(
      ([text]: [string]) => typeof text === "string" && text.includes("user_quest_progress")
    );
    expect(updateCall).toBeDefined();
    expect(result.clearedRows).toBe(2);
  });
});
