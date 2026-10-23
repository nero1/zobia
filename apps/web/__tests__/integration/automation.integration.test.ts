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
  requireFeatureEnabled: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/ai/client", () => ({ aiClient: { chat: jest.fn() } }));
jest.mock("@/lib/security/htmlSanitizer", () => ({
  sanitizeBlogPostHtml: (text: string) => text,
}));
jest.mock("@/lib/hashtags/service", () => ({
  syncContentHashtags: jest.fn().mockResolvedValue(undefined),
}));
import { getDb } from "@/lib/db/drizzle";
import { aiClient } from "@/lib/ai/client";
import { syncContentHashtags } from "@/lib/hashtags/service";
import {
  generationFingerprint,
  normalizeGeneratedText,
} from "@/lib/automation/quality";
import {
  createAutomationAccount,
  saveAutomationJob,
  runAutomation,
  reviewAutomationGeneration,
} from "@/lib/automation/service";
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration("official automated publishing", () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const accounts: string[] = [];
  let board: string;
  let staff: string;
  beforeAll(async () => {
    if (!(await integrationSetup()))
      throw new Error("Integration database unavailable");
    (getDb as jest.Mock).mockResolvedValue(drizzle(pool, { schema }));
    board = (
      await pool.query(
        "INSERT INTO bb_boards(name,slug,is_active) VALUES('Automation tests',$1,true) RETURNING id",
        [randomUUID()],
      )
    ).rows[0].id;
    const client = await pool.connect();
    try {
      staff = (await createUser(client)).id;
    } finally {
      client.release();
    }
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    if (accounts.length)
      await pool.query(
        "UPDATE automation_jobs SET enabled=false WHERE account_id=ANY($1::uuid[])",
        [accounts],
      );
  });
  afterAll(async () => {
    await pool.query(
      "DELETE FROM bb_posts WHERE thread_id IN (SELECT id FROM bb_threads WHERE board_id=$1)",
      [board],
    );
    await pool.query("DELETE FROM bb_threads WHERE board_id=$1", [board]);
    await pool.query("DELETE FROM bb_boards WHERE id=$1", [board]);
    await pool.query("DELETE FROM rooms WHERE creator_id=ANY($1::uuid[])", [
      accounts,
    ]);
    await pool.query("DELETE FROM wikis WHERE owner_id=ANY($1::uuid[])", [
      accounts,
    ]);
    await pool.query("DELETE FROM blogs WHERE owner_id=ANY($1::uuid[])", [
      accounts,
    ]);
    await pool.query(
      "DELETE FROM automation_jobs WHERE account_id=ANY($1::uuid[])",
      [accounts],
    );
    for (const id of [...accounts, staff])
      await pool.query("DELETE FROM users WHERE id=$1", [id]);
    await pool.end();
    await closeTestPool();
  });
  async function account() {
    const a = await createAutomationAccount({
      username: `official_${randomUUID().slice(0, 8)}`,
      displayName: "Official stories",
    });
    accounts.push(a.id);
    return a.id;
  }
  async function job(mode: "review" | "auto" = "auto") {
    const id = await account();
    return saveAutomationJob({
      accountId: id,
      name: "Forum evergreen",
      targetType: "forum",
      targetId: board,
      instructions: "Write a practical evergreen contribution.",
      providers: ["deepseek"],
      intervalHours: 24,
      publicationMode: mode,
      enabled: true,
    });
  }
  function generate(body: string) {
    (aiClient.chat as jest.Mock)
      .mockResolvedValueOnce({
        content: JSON.stringify({ title: "A practical guide", body }),
        provider: "deepseek",
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          approved: true,
          confidence: 0.99,
          reason: "Useful and appropriate.",
        }),
        provider: "deepseek",
      });
  }
  const text = (prefix: string) =>
    Array.from({ length: 240 }, (_, n) => `${prefix}${n}`).join(" ");
  it("marks official account names and keeps the marker on profile edits", async () => {
    const id = await account();
    await pool.query("UPDATE users SET display_name='Renamed' WHERE id=$1", [
      id,
    ]);
    expect(
      (
        await pool.query(
          "SELECT display_name,is_seed,password_hash,google_id FROM users WHERE id=$1",
          [id],
        )
      ).rows[0],
    ).toMatchObject({
      display_name: "Renamed Ⓩ",
      is_seed: true,
      password_hash: null,
      google_id: null,
    });
  });
  it("publishes atomically and rejects duplicates across accounts", async () => {
    const first = await job();
    generate(text("guide"));
    const published = await runAutomation();
    expect(published).toMatchObject({ processed: 1, status: "published" });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM bb_threads WHERE author_id=$1",
          [first.accountId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM coin_ledger WHERE user_id=$1",
          [first.accountId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(aiClient.chat).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ providers: ["deepseek"] }),
    );
    await job();
    generate(text("guide").replace("guide239", "revised239"));
    expect(await runAutomation()).toMatchObject({ status: "failed" });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM automation_generations WHERE account_id=ANY($1::uuid[])",
          [accounts],
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it("keeps review drafts private and publishes approval only once concurrently", async () => {
    const task = await job("review");
    generate(text("editor"));
    const draft = await runAutomation();
    expect(draft).toMatchObject({ status: "review" });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM bb_threads WHERE author_id=$1",
          [task.accountId],
        )
      ).rows[0].n,
    ).toBe(0);
    const id = (draft as { generationId: string }).generationId;
    await Promise.all([
      reviewAutomationGeneration(id, true, staff),
      reviewAutomationGeneration(id, true, staff),
    ]);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM bb_threads WHERE author_id=$1",
          [task.accountId],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          "SELECT reviewed_by FROM automation_generations WHERE id=$1",
          [id],
        )
      ).rows[0].reviewed_by,
    ).toBe(staff);
  });
  it("rolls back content and generation state together when publication fails", async () => {
    const task = await job();
    generate(text("rollback"));
    (syncContentHashtags as jest.Mock).mockRejectedValueOnce(
      new Error("Simulated publication failure"),
    );
    expect(await runAutomation()).toMatchObject({ status: "failed" });
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM bb_threads WHERE author_id=$1",
          [task.accountId],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM automation_generations WHERE account_id=$1",
          [task.accountId],
        )
      ).rows[0].n,
    ).toBe(0);
  });
  it("does not call a provider for a disabled account", async () => {
    const task = await job();
    await pool.query(
      "UPDATE automation_accounts SET enabled=false WHERE user_id=$1",
      [task.accountId],
    );
    expect(await runAutomation()).toMatchObject({ status: "failed" });
    expect(aiClient.chat).not.toHaveBeenCalled();
  });
  it("keeps private generation and Tales tables inaccessible to Data API roles", async () => {
    const { rows } = await pool.query(
      "SELECT has_table_privilege('anon','automation_generations','SELECT') anon,has_table_privilege('authenticated','tale_chapters','SELECT') authenticated,has_table_privilege('service_role','automation_generations','SELECT') service",
    );
    expect(rows[0]).toEqual({
      anon: false,
      authenticated: false,
      service: true,
    });
  });
  it.each(["blog", "wiki", "room"])(
    "publishes a reviewed %s using the correct public destination and counters",
    async (kind) => {
      const author = await account();
      let target: string;
      if (kind === "blog")
        target = (
          await pool.query(
            "INSERT INTO blogs(owner_id,title,slug) VALUES($1,$2,$3) RETURNING id",
            [author, "Official blog", randomUUID()],
          )
        ).rows[0].id;
      else if (kind === "wiki")
        target = (
          await pool.query(
            "INSERT INTO wikis(owner_id,name,slug) VALUES($1,$2,$3) RETURNING id",
            [author, "Official wiki", randomUUID()],
          )
        ).rows[0].id;
      else
        target = (
          await pool.query(
            "INSERT INTO rooms(creator_id,name,type,is_public,slug) VALUES($1,'Official room','free_open',true,$2) RETURNING id",
            [author, `official-${randomUUID()}`],
          )
        ).rows[0].id;
      const body =
        kind === "wiki"
          ? "# Introduction\n" +
            Array.from({ length: 280 }, (_, i) => `encyclopedia${i}`).join(
              " ",
            ) +
            "\n## Examples\n" +
            Array.from({ length: 280 }, (_, i) => `example${i}`).join(" ") +
            "\n## Limitations\n" +
            Array.from({ length: 280 }, (_, i) => `limitation${i}`).join(" ")
          : Array.from(
              { length: kind === "blog" ? 450 : 30 },
              (_, i) => `${kind}topic${i}`,
            ).join(" ");
      const id = (
        await pool.query(
          "INSERT INTO automation_generations(account_id,target_type,target_id,title,body,normalized,fingerprint,provider,review_reason) VALUES($1,$2,$3,'Reviewed contribution',$4,$5,$6,'deepseek','Editor review') RETURNING id",
          [
            author,
            kind,
            target,
            body,
            normalizeGeneratedText(body),
            generationFingerprint(body),
          ],
        )
      ).rows[0].id;
      const saved = await reviewAutomationGeneration(id, true, staff);
      expect(saved.status).toBe("published");
      expect(saved.publishedUrl).toBeTruthy();
      const table =
        kind === "blog"
          ? "blog_posts"
          : kind === "wiki"
            ? "wiki_pages"
            : "room_messages";
      expect(
        (
          await pool.query(`SELECT count(*)::int n FROM ${table} WHERE id=$1`, [
            id,
          ])
        ).rows[0].n,
      ).toBe(1);
      if (kind === "wiki")
        expect(
          (
            await pool.query(
              "SELECT count(*)::int n FROM wiki_page_revisions WHERE page_id=$1",
              [id],
            )
          ).rows[0].n,
        ).toBe(1);
    },
  );
  it("leases one job across simultaneous cron invocations", async () => {
    const task = await job();
    generate(text("leased"));
    const results = await Promise.all([runAutomation(), runAutomation()]);
    expect(results.filter((r) => r.processed === 1)).toHaveLength(1);
    expect(aiClient.chat).toHaveBeenCalledTimes(2);
    expect(
      (
        await pool.query(
          "SELECT count(*)::int n FROM bb_threads WHERE author_id=$1",
          [task.accountId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});
