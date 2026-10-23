import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "crypto";
import { schema } from "@/lib/db/schema";
import { createUser } from "./helpers";
import { integrationSetup, closeTestPool } from "./setup";
jest.mock("@/lib/db/drizzle", () => ({
  ...jest.requireActual("@/lib/db/drizzle"),
  getDb: jest.fn(),
}));
jest.mock("@/lib/manifest", () => ({
  getManifestValue: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/tales/moderation", () => ({
  reviewTale: jest
    .fn()
    .mockResolvedValue({
      moderation: "approved",
      moderationReason: "Approved by test classifier.",
    }),
}));
import { getDb } from "@/lib/db/drizzle";
import {
  saveTale,
  saveTaleChapter,
  getTale,
  readTaleChapter,
  unlockTaleChapter,
  runTalePublishing,
  appealTale,
} from "@/lib/tales/service";
import { moderateTale } from "@/lib/tales/admin";
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration("Tales access, quotas and publication", () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const users: string[] = [];
  let owner: string;
  let reader: string;
  let staff: string;
  beforeAll(async () => {
    if (!(await integrationSetup()))
      throw new Error("Integration database unavailable");
    (getDb as jest.Mock).mockResolvedValue(drizzle(pool, { schema }));
    const client = await pool.connect();
    try {
      for (let n = 0; n < 3; n++)
        users.push(
          (await createUser(client, { xpTotal: 2000, coinBalance: 1000 })).id,
        );
      [owner, reader, staff] = users;
    } finally {
      client.release();
    }
  });
  afterAll(async () => {
    await pool.query(
      "DELETE FROM tale_moderation_log WHERE staff_id=ANY($1::uuid[])",
      [users],
    );
    for (const id of users)
      await pool.query("DELETE FROM users WHERE id=$1", [id]);
    await pool.end();
    await closeTestPool();
  });
  const input = {
    title: "A clean adventure",
    synopsis: "A story about friendship.",
    defaultPrice: 100,
    commentsEnabled: true,
    notifySubscribers: false,
    status: "draft" as const,
  };
  async function story() {
    const book = await saveTale(owner, input);
    await saveTaleChapter(owner, book.slug, {
      ordinal: 1,
      title: "The beginning",
      body: "Public first chapter",
      price: 0,
      status: "published",
    });
    await saveTaleChapter(owner, book.slug, {
      ordinal: 2,
      title: "The secret",
      body: "PAID CHAPTER SECRET",
      price: null,
      status: "published",
    });
    return saveTale(
      owner,
      { ...input, status: "published", version: book.version },
      book.id,
    );
  }
  it("requires Level 2 and an approved first chapter before publication", async () => {
    await pool.query("UPDATE users SET xp_total=0 WHERE id=$1", [reader]);
    await expect(saveTale(reader, input)).rejects.toMatchObject({
      code: "TALES_LEVEL_REQUIRED",
    });
    await pool.query("UPDATE users SET xp_total=2000 WHERE id=$1", [reader]);
    await expect(
      saveTale(owner, { ...input, status: "published" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("exposes chapter one publicly while withholding subsequent chapters and unpaid bodies", async () => {
    const book = await story();
    expect((await readTaleChapter(book.slug, 1)).chapter.body).toBe(
      "Public first chapter",
    );
    const guest = await readTaleChapter(book.slug, 2);
    expect(guest.loginRequired).toBe(true);
    expect(guest.chapter.body).toBeNull();
    const locked = await readTaleChapter(book.slug, 2, reader);
    expect(locked.locked).toBe(true);
    expect(locked.chapter.body).toBeNull();
    await expect(
      unlockTaleChapter(reader, book.slug, 2, 50),
    ).rejects.toMatchObject({ code: "PRICE_CONFIRMATION_REQUIRED" });
    const before = Number(
      (await pool.query("SELECT coin_balance FROM users WHERE id=$1", [reader]))
        .rows[0].coin_balance,
    );
    const results = await Promise.all([
      unlockTaleChapter(reader, book.slug, 2, 100),
      unlockTaleChapter(reader, book.slug, 2, 100),
    ]);
    expect(results.filter((r) => !r.alreadyUnlocked)).toHaveLength(1);
    expect(
      Number(
        (
          await pool.query("SELECT coin_balance FROM users WHERE id=$1", [
            reader,
          ])
        ).rows[0].coin_balance,
      ),
    ).toBe(before - 100);
    expect((await readTaleChapter(book.slug, 2, reader)).chapter.body).toBe(
      "PAID CHAPTER SECRET",
    );
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM coin_ledger WHERE user_id=$1 AND transaction_type='tale_sale'",
          [owner],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("keeps scheduled chapters private and pauses drip after a plan downgrade", async () => {
    const book = await story();
    await expect(
      saveTaleChapter(owner, book.slug, {
        ordinal: 3,
        title: "Tomorrow",
        body: "Not yet public",
        price: 0,
        status: "scheduled",
        publishAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await pool.query("UPDATE users SET plan='plus' WHERE id=$1", [owner]);
    const chapter = await saveTaleChapter(owner, book.slug, {
      ordinal: 3,
      title: "Tomorrow",
      body: "Not yet public",
      price: 0,
      status: "scheduled",
      publishAt: new Date(Date.now() + 86400000).toISOString(),
    });
    await pool.query(
      "UPDATE tale_chapters SET publish_at=now()-interval '1 minute' WHERE id=$1",
      [chapter.id],
    );
    await pool.query("UPDATE users SET plan='free' WHERE id=$1", [owner]);
    await runTalePublishing();
    await expect(readTaleChapter(book.slug, 3, reader)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await pool.query("UPDATE users SET plan='plus' WHERE id=$1", [owner]);
    await runTalePublishing();
    expect((await readTaleChapter(book.slug, 3, reader)).chapter.body).toBe(
      "Not yet public",
    );
    await pool.query("UPDATE users SET plan='free' WHERE id=$1", [owner]);
  });
  it("rejects stale edits and stale staff decisions", async () => {
    const book = await story();
    await expect(
      saveTale(owner, { ...input, version: book.version - 1 }, book.id),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      moderateTale(staff, {
        targetType: "story",
        targetId: book.id,
        version: book.version - 1,
        decision: "rejected",
        reason: "This decision refers to an outdated revision.",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("hides stories by banned authors, including already purchased chapters", async () => {
    const book = await story();
    await pool.query("UPDATE users SET is_banned=true WHERE id=$1", [owner]);
    await expect(getTale(book.slug, reader)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(readTaleChapter(book.slug, 1)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await pool.query("UPDATE users SET is_banned=false WHERE id=$1", [owner]);
  });
  it("limits appeals to three per target and preserves content-version checks", async () => {
    const book = await story();
    await moderateTale(staff, {
      targetType: "story",
      targetId: book.id,
      version: book.version,
      decision: "rejected",
      reason: "A moderation decision requiring author review.",
    });
    for (let n = 0; n < 3; n++) {
      const appeal = await appealTale(owner, {
        targetType: "story",
        targetId: book.id,
        reason: "Please review this clean story again.",
      });
      await expect(
        appealTale(owner, {
          targetType: "story",
          targetId: book.id,
          reason: "A second pending appeal is not allowed.",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await moderateTale(staff, {
        targetType: "story",
        targetId: book.id,
        version: book.version,
        decision: "rejected",
        reason: "The appeal does not resolve the stated issue.",
        appealId: appeal.id,
      });
    }
    await expect(
      appealTale(owner, {
        targetType: "story",
        targetId: book.id,
        reason: "This exceeds the configured appeal limit.",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("serializes free draft quotas and enforces chapter-one pricing", async () => {
    const client = await pool.connect();
    let author: string;
    try {
      author = (await createUser(client, { xpTotal: 2000 })).id;
      users.push(author);
    } finally {
      client.release();
    }
    for (let n = 0; n < 19; n++)
      await pool.query(
        "INSERT INTO tales(author_id,slug,title) VALUES($1,$2,'Draft')",
        [author, randomUUID()],
      );
    const results = await Promise.allSettled([
      saveTale(author, input),
      saveTale(author, input),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const created = results.find(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<Awaited<ReturnType<typeof saveTale>>>;
    await expect(
      saveTaleChapter(author, created.value.slug, {
        ordinal: 1,
        title: "First",
        body: "Must be free",
        price: 100,
        status: "published",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
