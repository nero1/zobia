import assert from "node:assert/strict";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { POST as disable2fa } from "../app/api/auth/2fa/disable/route";
import { generateTotpSecret, computeTotp } from "../lib/auth/totp";
import { encryptField } from "../lib/security/fieldEncryption";
import { GET as rooms } from "../app/api/admin/rooms/route";
import { GET as guilds } from "../app/api/admin/guilds/route";
import { GET as support } from "../app/api/admin/support/tickets/route";
import { createSession, invalidateAllSessions } from "../lib/auth/session";
import {
  getTale,
  readTaleChapter,
  listTales,
  taleComments,
  unlockTaleChapter,
  runTalePublishing,
} from "../lib/tales/service";
import { processTask } from "../lib/tasks/outbox";
import { getStaffRoles } from "../lib/auth/roles";
import { requestContext } from "../lib/logger";
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (!/^\/zobia_v3_[a-f0-9]+$/.test(url.pathname))
    throw Error("Isolated fixture only");
  const db = new Client({ connectionString: url.href });
  await db.connect();
  const users: string[] = [],
    tag = randomUUID().slice(0, 8);
  async function user(role = "reader") {
    const name = `v3_${tag}_${users.length}`;
    const row = (
      await db.query(
        "INSERT INTO users(username,email,display_name,is_admin,is_moderator,coin_balance) VALUES($1,$2,$1,$3,$4,1000) RETURNING id,email,username,is_admin,is_moderator",
        [
          name,
          name + "@fixture.invalid",
          role === "admin",
          role === "moderator",
        ],
      )
    ).rows[0];
    users.push(row.id);
    return row;
  }
  const req = (path: string, token: string) =>
      new NextRequest("http://localhost:3000" + path, {
        headers: { authorization: "Bearer " + token },
      }),
    ctx = { params: Promise.resolve({}) };
  try {
    const admin = await user("admin"),
      mod = await user("moderator"),
      reader = await user(),
      author = await user();
    const plain = await createSession(admin),
      elevated = await createSession(admin, { adminSession: true }),
      moderator = await createSession(mod);
    for (const [handler, path] of [
      [rooms, "/api/admin/rooms"],
      [guilds, "/api/admin/guilds"],
      [support, "/api/admin/support/tickets"],
    ] as const) {
      const r = await handler(req(path, plain.accessToken), ctx);
      assert.equal(r.status, 403);
      assert.equal((await r.json()).error.code, "ADMIN_REAUTH_REQUIRED");
    }
    assert.equal(
      (await rooms(req("/api/admin/rooms", elevated.accessToken), ctx)).status,
      200,
    );
    assert.equal(
      (await rooms(req("/api/admin/rooms", moderator.accessToken), ctx)).status,
      200,
    );
    assert.equal(
      (
        await support(
          req("/api/admin/support/tickets?limit=-1", elevated.accessToken),
          ctx,
        )
      ).status,
      400,
    );
    for (const verified of [false, true])
      await requestContext.run(
        {
          requestId: "fixture",
          userId: admin.id,
          route: "/api/kyc/documents/x",
          adminSessionVerified: verified,
        },
        async () =>
          assert.equal(
            (await getStaffRoles(admin.id, { requireAdminSession: true }))
              .isAdmin,
            verified,
          ),
      );
    await requestContext.run(
      {
        requestId: "fixture",
        userId: admin.id,
        route: "/api/auth/2fa/disable",
        adminSessionVerified: false,
      },
      async () => assert.equal((await getStaffRoles(admin.id)).isAdmin, true),
    );
    const promoted = await user(),
      promotionSession = await createSession(promoted),
      secret = generateTotpSecret();
    await db.query(
      "UPDATE users SET totp_enabled=true,totp_secret=$2 WHERE id=$1",
      [promoted.id, encryptField(secret)],
    );
    const blocker = new Client({ connectionString: url.href });
    await blocker.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
      promoted.id,
    ]);
    let blocked = false;
    const pendingDisable = disable2fa(
      new NextRequest("http://localhost:3000/api/auth/2fa/disable", {
        method: "POST",
        headers: {
          authorization: "Bearer " + promotionSession.accessToken,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          code: computeTotp(secret, Math.floor(Date.now() / 30000)),
        }),
      }),
      ctx,
    );
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        const waiting = await db.query(
          "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%UPDATE%users%totp_enabled%' AND pid<>pg_backend_pid()",
        );
        if (waiting.rowCount) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert(blocked, "Disable operation must reach the concurrent UPDATE");
      await blocker.query("UPDATE users SET is_admin=true WHERE id=$1", [
        promoted.id,
      ]);
      await blocker.query("COMMIT");
      const rejected = await pendingDisable;
      assert.equal(rejected.status, 409);
      assert.equal(
        (await rejected.json()).error.code,
        "SECURITY_SETTINGS_CHANGED",
      );
      assert.equal(
        (
          await db.query("SELECT totp_enabled FROM users WHERE id=$1", [
            promoted.id,
          ])
        ).rows[0].totp_enabled,
        true,
      );
    } finally {
      await blocker.query("ROLLBACK");
      await blocker.end();
    }
    console.log(
      "PASS promotion racing two-factor disable preserves mandatory admin 2FA and returns a conflict",
    );
    console.log(
      "PASS custom admin endpoints and conditional staff views require assurance; ordinary moderators remain authorized and invalid page sizes return 400",
    );
    const story = (
      await db.query(
        "INSERT INTO tales(author_id,slug,title,synopsis,status,moderation,moderation_reason) VALUES($1,$2,'V3 story','Synopsis','published','approved','PRIVATE_STORY_REVIEW') RETURNING id,slug",
        [author.id, "v3-story-" + tag],
      )
    ).rows[0];
    const chapters = (
      await db.query(
        "INSERT INTO tale_chapters(tale_id,ordinal,title,body,status,moderation,price,moderation_reason) SELECT $1,n,'Chapter '||n,'BODY_SECRET_'||n,CASE WHEN n=3 THEN 'draft' ELSE 'published' END,'approved',CASE WHEN n=2 THEN 10 ELSE 0 END,'PRIVATE_CHAPTER_REVIEW' FROM generate_series(1,3)n RETURNING id,ordinal",
        [story.id],
      )
    ).rows;
    for (const c of chapters)
      await db.query(
        "INSERT INTO tale_comments(tale_id,chapter_id,user_id,body) VALUES($1,$2,$3,$4)",
        [story.id, c.id, reader.id, "CHAPTER_COMMENT_" + c.ordinal],
      );
    assert(!JSON.stringify(await getTale(story.slug)).includes("PRIVATE_"));
    assert(
      JSON.stringify(await getTale(story.slug, author.id)).includes(
        "PRIVATE_STORY_REVIEW",
      ),
    );
    const paid = await readTaleChapter(story.slug, 2, reader.id);
    assert(paid.locked);
    assert(!JSON.stringify(paid).includes("PRIVATE_"));
    assert.equal(paid.chapter.body, null);
    assert.deepEqual(
      (await taleComments(story.slug)).comments.map((c) => c.body),
      ["CHAPTER_COMMENT_1"],
    );
    assert.equal(
      (await taleComments(story.slug, author.id)).comments.length,
      3,
    );
    await unlockTaleChapter(reader.id, story.slug, 2, 10);
    await unlockTaleChapter(reader.id, story.slug, 2, 10);
    assert.equal(
      (await taleComments(story.slug, reader.id)).comments.length,
      2,
    );
    assert.equal(
      Number(
        (
          await db.query("SELECT coin_balance FROM users WHERE id=$1", [
            reader.id,
          ])
        ).rows[0].coin_balance,
      ),
      990,
    );
    console.log(
      "PASS public Tales omit private reviews, chapter comments honor visibility/unlocks, and repeated purchases debit once",
    );
    await db.query(
      "INSERT INTO tales(author_id,slug,title,synopsis,status,moderation,created_at) SELECT $1,'v3-page-'||$2||'-'||n,'Scope fixture '||n,'Synopsis','published','approved','2026-10-25 10:00:00.123400+00'::timestamptz+n*interval '1 microsecond' FROM generate_series(1,65)n",
      [author.id, tag],
    );
    await db.query("SET enable_seqscan=off");
    const discoveryPlan=await db.query("EXPLAIN (FORMAT JSON) SELECT id FROM tales WHERE status='published' AND moderation='approved' ORDER BY created_at DESC,id DESC LIMIT 21");
    assert(JSON.stringify(discoveryPlan.rows).includes('tales_discovery_idx'));
    const subscriberPlan=await db.query("EXPLAIN (FORMAT JSON) SELECT user_id FROM tale_author_subscriptions WHERE author_id=$1 ORDER BY user_id LIMIT 501",[author.id]);
    assert(JSON.stringify(subscriberPlan.rows).includes('tale_author_subscriptions_author_page_idx'));
    await db.query("RESET enable_seqscan");
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const p = await listTales(reader.id, "new", cursor, "Scope fixture");
      ids.push(...p.tales.map((t) => t.id));
      cursor = p.nextCursor ?? undefined;
    } while (cursor);
    assert.equal(ids.length, 65);
    assert.equal(new Set(ids).size, 65);
    const first = await listTales(reader.id, "new", undefined, "Scope fixture");
    for (const [owner, search] of [
      [reader.id, "different"],
      [author.id, "Scope fixture"],
    ])
      await assert.rejects(
        () => listTales(owner, "new", first.nextCursor!, search),
        (e) => (e as { status: number }).status === 400,
      );
    console.log(
      "PASS discovery paginates exact timestamps without loss and rejects cursors from other searches/accounts",
    );
    await db.query("UPDATE tales SET notify_subscribers=true WHERE id=$1", [
      story.id,
    ]);
    await db.query(
      "UPDATE tale_chapters SET notified=true WHERE tale_id=$1 AND ordinal<>1",
      [story.id],
    );
    await db.query(
      "WITH inserted AS (INSERT INTO users(username,display_name) SELECT 'v3_sub_'||$1||'_'||n,'Subscriber' FROM generate_series(1,1001)n RETURNING id) INSERT INTO tale_author_subscriptions(user_id,author_id) SELECT id,$2 FROM inserted",
      [tag, author.id],
    );
    assert.equal((await runTalePublishing()).notified, 1);
    let task = (
      await db.query(
        "SELECT id FROM transactional_tasks WHERE kind='tale_notifications' AND status='pending' LIMIT 1",
      )
    ).rows[0];
    await processTask(task.id);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM notifications WHERE type='tale_new_chapter'",
        )
      ).rows[0].n,
      500,
    );
    assert.equal(await processTask(task.id), false);
    for (let i = 0; i < 5; i++) {
      task = (
        await db.query(
          "SELECT id FROM transactional_tasks WHERE kind='tale_notifications' AND status='pending' LIMIT 1",
        )
      ).rows[0];
      if (!task) break;
      await processTask(task.id);
    }
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int n FROM notifications WHERE type='tale_new_chapter'",
        )
      ).rows[0].n,
      1001,
    );
    console.log(
      "PASS durable notification pages send at most 500, drain 1001 subscribers and reject completed task replay",
    );
  } finally {
    for (const id of users) await invalidateAllSessions(id);
    await db.end();
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
