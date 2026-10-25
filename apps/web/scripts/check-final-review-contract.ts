import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { NextRequest } from "next/server";
import { GET as adminList } from "../app/api/admin/sponsored-quests/route";
import { GET as businessList } from "../app/api/business/sponsored-quests/route";
import { createSession, invalidateAllSessions } from "../lib/auth/session";
import { invalidateManifestCache } from "../lib/manifest";
async function main() {
  if (
    !/^\/zobia_remediation_[a-f0-9]+$/.test(
      new URL(process.env.DATABASE_URL!).pathname,
    )
  )
    throw Error("Isolated fixture only");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const users: string[] = [];
  async function account(admin = false) {
    const name = "paging_" + randomUUID().replaceAll("-", "");
    const user = (
      await db.query(
        "INSERT INTO users(username,email,display_name,is_admin,onboarding_completed) VALUES($1,$2,$1,$3,true) RETURNING id,email,username,is_admin",
        [name, name + "@fixture.invalid", admin],
      )
    ).rows[0];
    users.push(user.id);
    return { ...user, ...(await createSession(user, { adminSession: admin })) };
  }
  const request = (path: string, token: string) =>
      new NextRequest("http://localhost:3000" + path, {
        headers: { Authorization: "Bearer " + token },
      }),
    context = { params: Promise.resolve({}) };
  try {
    await db.query(
      "INSERT INTO x_manifest(key,value) VALUES('feature_business_accounts','true') ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
    );
    await invalidateManifestCache();
    const admin = await account(true),
      owner = await account(),
      foreign = await account();
    const business = (
      await db.query(
        "INSERT INTO business_accounts(user_id,business_name,tier,status) VALUES($1,'Pagination fixture','growth','active') RETURNING id",
        [owner.id],
      )
    ).rows[0].id;
    await db.query(
      "INSERT INTO business_accounts(user_id,business_name,tier,status) VALUES($1,'Foreign fixture','growth','active')",
      [foreign.id],
    );
    await db.query(
      "INSERT INTO sponsored_quests(brand_name,title,description,reward_coins,max_applications,deadline,business_account_id,is_active,moderation_status,created_at) SELECT 'Fixture','Paged fixture '||g,'A bounded list fixture',1,1,NOW()+INTERVAL '1 day',$1,false,CASE WHEN g%3=0 THEN 'pending' ELSE 'approved' END,CASE WHEN g<=2 THEN NULL WHEN g%2=0 THEN '2026-10-25 04:00:00.123456+00'::timestamptz ELSE '2026-10-25 04:00:00.123457+00'::timestamptz END FROM generate_series(1,127) g",
      [business],
    );
    const expectedAdmin = (
      await db.query(
        "SELECT id FROM sponsored_quests WHERE deleted_at IS NULL ORDER BY (moderation_status='pending') DESC,COALESCE(created_at,'1970-01-01'::timestamptz) DESC,id DESC",
      )
    ).rows.map((row) => row.id);
    const ids: string[] = [];
    let cursor: string | null = null,
      adminCursor: string | null = null;
    do {
      const response = await adminList(
        request(
          "/api/admin/sponsored-quests?active=false" +
            (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
          admin.accessToken,
        ),
        context,
      );
      assert.equal(response.status, 200);
      const data = (await response.json()).data;
      assert(data.quests.length <= 50);
      ids.push(...data.quests.map((q: { id: string }) => q.id));
      cursor = data.nextCursor;
      adminCursor ??= cursor;
      assert.equal(data.hasMore, !!cursor);
    } while (cursor);
    assert.deepEqual(ids, expectedAdmin);
    assert.equal(new Set(ids).size, ids.length);
    const expectedBusiness = (
      await db.query(
        "SELECT id FROM sponsored_quests WHERE business_account_id=$1 AND deleted_at IS NULL ORDER BY COALESCE(created_at,'1970-01-01'::timestamptz) DESC,id DESC",
        [business],
      )
    ).rows.map((row) => row.id);
    const owned: string[] = [];
    let businessCursor: string | null = null;
    do {
      const response = await businessList(
        request(
          "/api/business/sponsored-quests" +
            (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
          owner.accessToken,
        ),
        context,
      );
      assert.equal(
        response.status,
        200,
        JSON.stringify(await response.clone().json()),
      );
      const data = (await response.json()).data;
      assert(data.quests.length <= 50);
      owned.push(...data.quests.map((q: { id: string }) => q.id));
      cursor = data.nextCursor;
      businessCursor ??= cursor;
    } while (cursor);
    assert.deepEqual(owned, expectedBusiness);
    assert.equal(owned.length, 127);
    assert.equal(
      (
        await businessList(
          request(
            "/api/business/sponsored-quests?cursor=" +
              encodeURIComponent(businessCursor!),
            foreign.accessToken,
          ),
          context,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await businessList(
          request(
            "/api/business/sponsored-quests?cursor=" +
              encodeURIComponent(adminCursor!),
            owner.accessToken,
          ),
          context,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await adminList(
          request(
            "/api/admin/sponsored-quests?active=false&cursor=invalid",
            admin.accessToken,
          ),
          context,
        )
      ).status,
      400,
    );
    // Cursor stores the actual sort tuple, so deleting its anchor cannot skip the next page.
    const first = await adminList(
      request("/api/admin/sponsored-quests?active=false", admin.accessToken),
      context,
    );
    const firstData = (await first.json()).data;
    await db.query("UPDATE sponsored_quests SET deleted_at=NOW() WHERE id=$1", [
      firstData.quests.at(-1).id,
    ]);
    const after = await adminList(
      request(
        "/api/admin/sponsored-quests?active=false&cursor=" +
          encodeURIComponent(firstData.nextCursor),
        admin.accessToken,
      ),
      context,
    );
    assert.equal(after.status, 200);
    assert.equal((await after.json()).data.quests[0].id, expectedAdmin[50]);
    await db.query("SET enable_seqscan=off");
    const adminPlan = await db.query(
      "EXPLAIN SELECT id FROM sponsored_quests WHERE deleted_at IS NULL ORDER BY (moderation_status='pending') DESC,COALESCE(created_at,'1970-01-01'::timestamptz) DESC,id DESC LIMIT 50",
    );
    assert(
      JSON.stringify(adminPlan.rows).includes(
        "sponsored_quests_admin_page_idx",
      ),
    );
    const ownerPlan = await db.query(
      "EXPLAIN SELECT id FROM sponsored_quests WHERE business_account_id=$1 AND deleted_at IS NULL ORDER BY COALESCE(created_at,'1970-01-01'::timestamptz) DESC,id DESC LIMIT 50",
      [business],
    );
    assert(
      JSON.stringify(ownerPlan.rows).includes(
        "sponsored_quests_business_page_idx",
      ),
    );
    await db.query("RESET enable_seqscan");
    console.log(
      "PASS bounded administrator/business keysets cover 127 tied/microsecond/null timestamps without loss, preserve pending priority, reject cross-owner/filter cursors and survive deletion of the anchor",
    );
  } finally {
    for (const user of users) await invalidateAllSessions(user);
    await db.end();
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.stack);
    process.exit(1);
  });
