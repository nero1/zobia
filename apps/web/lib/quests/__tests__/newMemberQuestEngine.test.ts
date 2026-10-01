/**
 * Unit tests for lib/quests/newMemberQuestEngine.ts
 *
 * Uses a real drizzle instance over a fake pg client (same approach as
 * questEngine.test.ts). Verifies the lazy-create path that fixes "quest
 * progress never recorded" for users with no new_member_quests row.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "@/lib/db/schema";
import type { DbOrTx } from "@/lib/db/drizzle";
import {
  advanceNewMemberQuestStep,
  advanceNewMemberQuestFriendRequestStep,
  buildNewMemberQuestProgress,
  ensureNewMemberQuest,
} from "../newMemberQuestEngine";

const mockQuery = jest.fn();
const fakeClient = {
  query: (cfg: unknown, params?: unknown[]) => {
    const text = typeof cfg === "string" ? cfg : (cfg as { text: string }).text;
    return mockQuery(text, params);
  },
};
const db = drizzle(fakeClient as any, { schema }) as unknown as DbOrTx;

const isInsert = (t: string) => /insert into new_member_quests/i.test(t);
const isUpdate = (t: string) => /update "new_member_quests"/i.test(t);

beforeEach(() => mockQuery.mockReset());

describe("buildNewMemberQuestProgress", () => {
  it("has the six canonical steps, friend_request counting to 3", () => {
    const { steps } = buildNewMemberQuestProgress();
    expect(steps.map((s) => s.id)).toEqual([
      "send_message", "join_room", "gift_someone", "add_friend", "friend_request", "daily_login",
    ]);
    expect(steps.find((s) => s.id === "friend_request")).toMatchObject({ count: 0, target: 3 });
  });
});

describe("advanceNewMemberQuestStep", () => {
  it("updates once when the row exists", async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    await advanceNewMemberQuestStep(db, "u1", "send_message");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(isUpdate(mockQuery.mock.calls[0][0])).toBe(true);
  });

  it("creates a backfilled row then retries when none exists", async () => {
    mockQuery.mockImplementation(async (text: string) =>
      isInsert(text) ? { rows: [], rowCount: 1 } : { rows: [], rowCount: isUpdate(text) && mockQuery.mock.calls.length > 2 ? 1 : 0 }
    );
    await advanceNewMemberQuestStep(db, "u1", "join_room");
    const kinds = mockQuery.mock.calls.map(([t]) => (isInsert(t) ? "insert" : isUpdate(t) ? "update" : "other"));
    expect(kinds).toEqual(["update", "insert", "update"]);
  });

  it("does not retry when the quest already completed (row exists)", async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await advanceNewMemberQuestStep(db, "u1", "join_room");
    expect(mockQuery).toHaveBeenCalledTimes(2); // update, insert-conflict no-op
  });

  it("never throws", async () => {
    mockQuery.mockRejectedValue(new Error("db down"));
    await expect(advanceNewMemberQuestStep(db, "u1", "daily_login")).resolves.toBeUndefined();
  });
});

describe("advanceNewMemberQuestFriendRequestStep", () => {
  it("only ensures the row (no double count) when the update touched nothing", async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    await advanceNewMemberQuestFriendRequestStep(db, "u1");
    const kinds = mockQuery.mock.calls.map(([t]) => (isInsert(t) ? "insert" : "update"));
    expect(kinds).toEqual(["update", "insert"]);
  });
});

describe("ensureNewMemberQuest", () => {
  it("reports whether it created a row", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await ensureNewMemberQuest(db, "u1")).toBe(true);
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await ensureNewMemberQuest(db, "u1")).toBe(false);
  });
});
