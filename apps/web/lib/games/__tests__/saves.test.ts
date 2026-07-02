/**
 * Unit tests for the Save Slots reconciliation logic — the DB is mocked so
 * no connection is made. These guard the "keep the newest N, delete the
 * rest" behaviour used both by the interactive downgrade flow and the
 * non-interactive grace-period CRON purge.
 */

const mockQuery = jest.fn();
const mockTransaction = jest.fn();

jest.mock("@/lib/db", () => ({
  db: {
    query: (...a: unknown[]) => mockQuery(...a),
    transaction: (...a: unknown[]) => mockTransaction(...a),
  },
}));

import { reconcileSavesForUser, purgeAllSavesForUser } from "@/lib/games/saves";

describe("reconcileSavesForUser", () => {
  beforeEach(() => mockQuery.mockReset());

  it("deletes exactly the given ids when deleteIds is provided", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: "a" }, { id: "b" }] });
    const deleted = await reconcileSavesForUser("user-1", 3, ["a", "b"]);
    expect(deleted).toEqual(["a", "b"]);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/ANY\(\$1::uuid\[\]\)/);
    expect(params).toEqual([["a", "b"], "user-1"]);
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
