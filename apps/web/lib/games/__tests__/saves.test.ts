/**
 * Unit tests for the Save Slots reconciliation logic — the DB is mocked so
 * no connection is made. These guard the "keep the newest N, delete the
 * rest" behaviour used both by the interactive downgrade flow and the
 * non-interactive grace-period CRON purge.
 *
 * lib/games/saves.ts has been migrated to Drizzle ORM (getDb() and its raw
 * `sql\`...\`` escape hatch via `db.execute()`) instead of the raw
 * `@/lib/db` adapter. These tests back a *real* `drizzle-orm/node-postgres`
 * instance with a fake `pg`-shaped client whose `query()` is a jest.fn.
 * Every query saves.ts issues still goes through real Drizzle query
 * compilation — exactly like production — and lands on `mockQuery` as
 * plain SQL text + params, which tests dispatch on (see
 * lib/seasons/__tests__/seasonEngine.test.ts for the same pattern).
 *
 * Since saves.ts only ever uses the raw `sql\`...\`` template (never the
 * `.select()/.insert()` query builder), Drizzle passes the SQL through
 * verbatim — case and all — and `db.execute()` resolves to the same
 * `{ rows, rowCount }` shape the old raw adapter's `db.query()` did, so
 * these assertions are almost unchanged from before the migration.
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

const mockDb = drizzle(fakeClient as any, { schema }) as unknown as DbOrTx;

jest.mock("@/lib/db/drizzle", () => {
  const actual = jest.requireActual("@/lib/db/drizzle");
  return {
    ...actual,
    getDb: async () => mockDb,
  };
});

// saves.ts does not import `@/lib/db` (the raw adapter) directly, but keep
// this mocked defensively so no test accidentally opens a real connection.
jest.mock("@/lib/db", () => ({ db: {} }));

import { reconcileSavesForUser, purgeAllSavesForUser } from "@/lib/games/saves";

describe("reconcileSavesForUser", () => {
  beforeEach(() => mockQuery.mockReset());

  it("deletes exactly the given ids when deleteIds is provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "a" }, { id: "b" }] });
    const deleted = await reconcileSavesForUser("user-1", 3, ["a", "b"]);
    expect(deleted).toEqual(["a", "b"]);
    const [sql, params] = mockQuery.mock.calls[0];
    // Drizzle's `sql` template expands an interpolated array into one
    // placeholder per element (`($1, $2)`) rather than binding it as a
    // single array-typed parameter, so this reads a little differently
    // than the old raw-SQL adapter's `= ANY($1::uuid[])` form.
    expect(sql).toMatch(/ANY\(\(\$1, \$2\)::uuid\[\]\)/);
    expect(params).toEqual(["a", "b", "user-1"]);
  });

  it("keeps the newest `limit` saves and deletes the rest, ordered DESC with an OFFSET", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "old-1" }, { id: "old-2" }] });
    const deleted = await reconcileSavesForUser("user-1", 2);
    expect(deleted).toEqual(["old-1", "old-2"]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/ORDER BY updated_at DESC/);
    expect(sql).toMatch(/OFFSET \$2/);
    expect(params).toEqual(["user-1", 2]);
  });

  it("never passes a negative OFFSET (limit clamped to 0)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await reconcileSavesForUser("user-1", -5);
    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(["user-1", 0]);
  });
});

describe("purgeAllSavesForUser", () => {
  beforeEach(() => mockQuery.mockReset());

  it("deletes every save for the user and returns the count removed", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    const count = await purgeAllSavesForUser("user-1");
    expect(count).toBe(3);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/DELETE FROM game_saves WHERE user_id = \$1/);
    expect(params).toEqual(["user-1"]);
  });
});
