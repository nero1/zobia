import { GET as reviewApplications } from "../app/api/admin/sponsored-quests/[questId]/applications/route";
import { POST as fundBusiness } from "../app/api/business/sponsored-quests/[questId]/fund/route";
import { PATCH as manageOwned } from "../app/api/quests/owned/[questId]/route";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { NextRequest } from "next/server";
import { createSession, invalidateAllSessions } from "../lib/auth/session";
import { getDb } from "../lib/db/drizzle";
import { GET as listCampaigns, POST as createCampaign } from "../app/api/admin/sponsored-quests/route";
import { POST as apply } from "../app/api/creator/sponsored-quests/[questId]/apply/route";
import { POST as complete } from "../app/api/creator/sponsored-quests/[questId]/complete/route";
import { POST as approve } from "../app/api/creator/sponsored-quests/[questId]/approve/route";
import { POST as fundLegacy } from "../app/api/admin/sponsored-quests/[questId]/fund/route";
import {
  recordSponsoredQuestImpression,
  syncSponsoredQuestTemplate,
  getEligibleSponsoredQuestTemplates,
} from "../lib/quests/sponsoredQuestPacing";
import {
  updateFundedSponsoredQuest,
  sweepSponsoredFunding,
} from "../lib/quests/sponsoredFunding";
import { updateQuestProgress } from "../lib/quests/questEngine";
import { processTask } from "../lib/tasks/outbox";
async function main() {
  if (
    !/^\/zobia_remediation_[a-f0-9]+$/.test(
      new URL(process.env.DATABASE_URL!).pathname,
    )
  )
    throw Error("Isolated fixture only");
  globalThis.fetch = async () => {
    throw Error("Provider calls disabled in sponsored funding fixture");
  };
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const users: string[] = [];
  const request = (path: string, token: string, body: unknown) =>
    new NextRequest("http://localhost:3000" + path, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  const ctx = (questId: string) => ({ params: Promise.resolve({ questId }) });
  async function account(admin = false, balance = 10000) {
    const name = "sponsor_" + randomUUID().replaceAll("-", "");
    const user = (
      await db.query(
        "INSERT INTO users(username,email,display_name,is_admin,is_creator,creator_tier,trust_score,coin_balance,onboarding_completed) VALUES($1,$2,$1,$3,true,'verified',80,$4,true) RETURNING id,email,username,is_admin",
        [name, name + "@fixture.invalid", admin, balance],
      )
    ).rows[0];
    users.push(user.id);
    const tokens = await createSession(user, { adminSession: admin });
    return { ...user, ...tokens };
  }
  const balance = async (user: string) =>
    BigInt(
      (
        await db.query(
          "SELECT coin_balance::text value FROM users WHERE id=$1",
          [user],
        )
      ).rows[0].value,
    );
  const body = (extra: Record<string, unknown> = {}) => ({
    idempotencyKey: randomUUID(),
    brandName: "Fixture brand",
    title: "Funded " + randomUUID(),
    description: "A safe sponsored campaign fixture",
    requirements: "Complete this safe fixture activity",
    rewardCoins: 5,
    maxApplications: 2,
    deadline: new Date(Date.now() + 86400000).toISOString(),
    isDailyQuestEligible: true,
    totalBudgetCredits: 30,
    dailyBudgetCredits: 11,
    cpmCredits: 500,
    targetAction: "messages",
    targetValue: 1,
    startsAt: new Date(Date.now() - 1000).toISOString(),
    endsAt: new Date(Date.now() + 3600000).toISOString(),
    ...extra,
  });
  try {
    const payer = await account(true),
      one = await account(),
      two = await account(),
      three = await account(),
      empty = await account(true, 0),
      orm = await getDb();
    const input = body({ ownerUsername: payer.username });
    const created = await Promise.all(
      [1, 2].map(() =>
        createCampaign(
          request("/api/admin/sponsored-quests", payer.accessToken, input),
          { params: Promise.resolve({}) },
        ),
      ),
    );
    for (const response of created)
      assert.equal(
        response.status,
        201,
        JSON.stringify(await response.clone().json()),
      );
    const id = (await created[0].json()).data.questId;
    assert.equal((await created[1].json()).data.questId, id);
    assert.equal(await balance(payer.id), 9960n);
    const insufficient = body();
    assert(
      (
        await createCampaign(
          request(
            "/api/admin/sponsored-quests",
            empty.accessToken,
            insufficient,
          ),
          { params: Promise.resolve({}) },
        )
      ).status >= 400,
    );
    assert.equal(
      (
        await db.query(
          "SELECT COUNT(*)::int n FROM sponsored_quests WHERE title=$1",
          [insufficient.title],
        )
      ).rows[0].n,
      0,
    );
    const invalidAction=await createCampaign(request('/api/admin/sponsored-quests',payer.accessToken,body({targetAction:'unwired_action'})),{params:Promise.resolve({})});assert.equal(invalidAction.status,400);assert.equal(await balance(payer.id),9960n);
    const mismatch = await createCampaign(
      request("/api/admin/sponsored-quests", payer.accessToken, {
        ...input,
        title: "Changed intent",
      }),
      { params: Promise.resolve({}) },
    );
    assert.equal(mismatch.status, 409);
    assert.equal(await balance(payer.id), 9960n);
    await assert.rejects(
      updateFundedSponsoredQuest(orm, id, { rewardCoins: 6 }, payer.id),
    );
    await assert.rejects(
      updateFundedSponsoredQuest(orm, id, { totalBudgetCredits: "40" }, one.id),
    );
    await updateFundedSponsoredQuest(
      orm,
      id,
      { totalBudgetCredits: "40" },
      payer.id,
    );
    assert.equal(await balance(payer.id), 9950n);
    await assert.rejects(
      updateFundedSponsoredQuest(
        orm,
        id,
        { totalBudgetCredits: "30" },
        payer.id,
      ),
    );
    const manageRequest = () =>
      new NextRequest("http://localhost:3000/api/quests/owned/" + id, {
        method: "PATCH",
        headers: {
          Authorization: "Bearer " + payer.accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "add_budget", addBudgetCredits: 1 }),
      });
    const managed = await Promise.all(
      [1, 2].map(() => manageOwned(manageRequest(), ctx(id))),
    );
    assert(managed.every((response) => response.status === 200));
    assert.equal(await balance(payer.id), 9948n);
    assert.equal(
      (
        await db.query(
          "SELECT total_budget_credits::text budget FROM sponsored_quests WHERE id=$1",
          [id],
        )
      ).rows[0].budget,
      "42.000000",
    );
    console.log(
      "PASS campaign creation atomically reserves real funds once per request key, insufficient funding rolls back, monetary terms stay immutable and only the payer can fund a budget increase",
    );
    assert.equal(
      await recordSponsoredQuestImpression(orm, id, one.id, 0.5),
      true,
    );
    assert.equal(
      await recordSponsoredQuestImpression(orm, id, one.id, 0.5),
      true,
    );
    const last = await Promise.all(
      [two.id, three.id].map((user) =>
        recordSponsoredQuestImpression(orm, id, user, 0.5),
      ),
    );
    assert.equal(last.filter(Boolean).length, 1);
    const reservedUser = last[0] ? two : three;
    assert.equal(
      (
        await db.query(
          "SELECT COUNT(*)::int n FROM sponsored_daily_reservations WHERE quest_id=$1",
          [id],
        )
      ).rows[0].n,
      2,
    );
    const template = (
      await db.query(
        "SELECT id FROM quest_templates WHERE sponsored_quest_id=$1",
        [id],
      )
    ).rows[0].id;
    const day = new Date().toISOString().slice(0, 10);
    await db.query(
      "INSERT INTO user_quest_decks(user_id,quest_id,assigned_date) VALUES($1,$2,$3)",
      [one.id, template, day],
    );
    await updateFundedSponsoredQuest(orm, id, { isActive: false }, payer.id);
    await syncSponsoredQuestTemplate(orm, id);
    const paid = await Promise.all(
      [1, 2].map(() => updateQuestProgress(one.id, template, 1, orm)),
    );
    assert.equal(paid.filter((item) => item.newly_completed).length, 1);
    assert.equal(await balance(one.id), 10005n);
    assert.equal(
      (
        await db.query(
          "SELECT COUNT(*)::int n FROM coin_ledger WHERE user_id=$1 AND transaction_type='quest_reward'",
          [one.id],
        )
      ).rows[0].n,
      1,
    );
    await db.query(
      "UPDATE sponsored_daily_reservations SET assigned_date=assigned_date-1 WHERE quest_id=$1 AND user_id=$2",
      [id, reservedUser.id],
    );
    await sweepSponsoredFunding("fixture-release");
    assert.equal(
      (
        await db.query(
          "SELECT spent_credits::text spent FROM sponsored_quests WHERE id=$1",
          [id],
        )
      ).rows[0].spent,
      "6.000000",
    );
    assert.equal(
      (
        await db.query(
          "SELECT state FROM sponsored_daily_reservations WHERE quest_id=$1 AND user_id=$2",
          [id, reservedUser.id],
        )
      ).rows[0].state,
      "released",
    );
    console.log(
      "PASS concurrent deck admission respects funded daily caps, retries reserve once, a paused campaign honors an already-reserved reward once and expired unused rewards return to escrow",
    );
    const futureInput = body({
      targetAction:null,
      startsAt: new Date(Date.now() + 60000).toISOString(),
      endsAt: new Date(Date.now() + 120000).toISOString(),
      isDailyQuestEligible: true,
      dailyBudgetCredits: null,
    });
    const futureResponse = await createCampaign(
      request("/api/admin/sponsored-quests", payer.accessToken, futureInput),
      { params: Promise.resolve({}) },
    );
    assert.equal(futureResponse.status, 201);
    const future = (await futureResponse.json()).data.questId;
    assert.equal((await db.query('SELECT action_type FROM quest_templates WHERE sponsored_quest_id=$1',[future])).rows[0].action_type,'messages');
    assert.equal(
      (await getEligibleSponsoredQuestTemplates(orm)).some(
        (q) => q.sponsored_quest_id === future,
      ),
      false,
    );
    await db.query(
      "UPDATE sponsored_quests SET starts_at=NOW()-INTERVAL '1 minute' WHERE id=$1",
      [future],
    );
    assert.equal(
      (await getEligibleSponsoredQuestTemplates(orm)).some(
        (q) => q.sponsored_quest_id === future,
      ),
      true,
    );
    console.log(
      "PASS future funded campaigns enter daily selection when their window opens without another mutation or cron",
    );
    const applicationInput = body({
      isDailyQuestEligible: false,
      totalBudgetCredits: 0,
      dailyBudgetCredits: null,
      maxApplications: 1,
    });
    const appResponse = await createCampaign(
      request(
        "/api/admin/sponsored-quests",
        payer.accessToken,
        applicationInput,
      ),
      { params: Promise.resolve({}) },
    );
    assert.equal(appResponse.status, 201);
    const appQuest = (await appResponse.json()).data.questId;
    const rooms: string[] = [];
    for (const user of [two, three])
      rooms.push(
        (
          await db.query(
            "INSERT INTO rooms(creator_id,name,type,is_public) VALUES($1,'Application fixture','free_open',false) RETURNING id",
            [user.id],
          )
        ).rows[0].id,
      );
    const admissions = await Promise.all(
      [two, three].map((user, index) =>
        apply(
          request(
            "/api/creator/sponsored-quests/" + appQuest + "/apply",
            user.accessToken,
            { roomId: rooms[index] },
          ),
          ctx(appQuest),
        ),
      ),
    );
    assert.equal(admissions.filter((r) => r.status === 201).length, 1);
    assert.equal(
      (
        await db.query(
          "SELECT COUNT(*)::int n FROM sponsored_quest_applications WHERE quest_id=$1",
          [appQuest],
        )
      ).rows[0].n,
      1,
    );
    const winner = admissions[0].status === 201 ? two : three,
      admitted = (
        await db.query(
          "SELECT id FROM sponsored_quest_applications WHERE quest_id=$1",
          [appQuest],
        )
      ).rows[0].id;
    const completed = await complete(
      request(
        "/api/creator/sponsored-quests/" + appQuest + "/complete",
        winner.accessToken,
        {
          completionProof:
            "This is a complete fixture proof for administrator review.",
        },
      ),
      ctx(appQuest),
    );
    assert.equal(
      completed.status,
      200,
      JSON.stringify(await completed.clone().json()),
    );
    const review = (token: string, query = "") =>
      reviewApplications(
        new NextRequest(
          "http://localhost:3000/api/admin/sponsored-quests/" +
            appQuest +
            "/applications" +
            query,
          { headers: { Authorization: "Bearer " + token } },
        ),
        ctx(appQuest),
      );
    assert.equal((await review(one.accessToken)).status, 403);
    const ordinary = await createSession({
      id: payer.id,
      email: payer.email,
      username: payer.username,
      is_admin: true,
    });
    assert.equal((await review(ordinary.accessToken)).status, 403);
    const reviewed = await review(payer.accessToken);
    assert.equal(reviewed.status, 200);
    const reviewPage = (await reviewed.json()).data;
    assert.equal(reviewPage.items.length, 1);
    assert.equal(reviewPage.items[0].id, admitted);
    assert(reviewPage.items[0].proof.includes("fixture proof"));
    assert.equal(
      (await review(payer.accessToken, "?cursor=invalid")).status,
      400,
    );
    const wrong = await approve(
      request(
        "/api/creator/sponsored-quests/" + id + "/approve",
        payer.accessToken,
        { applicationId: admitted, action: "approve" },
      ),
      ctx(id),
    );
    assert.equal(wrong.status, 404);
    const before = await balance(winner.id),
      decisions = await Promise.all(
        [1, 2].map(() =>
          approve(
            request(
              "/api/creator/sponsored-quests/" + appQuest + "/approve",
              payer.accessToken,
              { applicationId: admitted, action: "approve" },
            ),
            ctx(appQuest),
          ),
        ),
      );
    assert.equal(decisions.filter((r) => r.status === 200).length, 1);
    assert.equal(await balance(winner.id), before + 3n);
    const listed=await listCampaigns(new NextRequest('http://localhost:3000/api/admin/sponsored-quests?active=false',{headers:{Authorization:'Bearer '+payer.accessToken}}),{params:Promise.resolve({})});assert.equal(listed.status,200);assert.equal((await listed.json()).data.quests.find((row:{id:string})=>row.id===appQuest).approved_count,1);
    assert.equal(
      (
        await complete(
          request(
            "/api/creator/sponsored-quests/" + appQuest + "/complete",
            winner.accessToken,
            {
              completionProof:
                "A stale completion retry must not reopen a paid application.",
            },
          ),
          ctx(appQuest),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await db.query(
          "SELECT application_balance_coins::text amount FROM sponsored_quest_funding WHERE quest_id=$1",
          [appQuest],
        )
      ).rows[0].amount,
      "0",
    );
    console.log(
      "PASS application capacity and payout decisions serialize; one funded creator share is credited, cross-campaign decisions fail and a stale completion cannot reopen paid work",
    );
    // Close all fixture campaigns and deliver the main campaign's durable refunds.
    await db.query(
      "UPDATE sponsored_quests SET deleted_at=NOW(),is_active=false WHERE id=$1",
      [id],
    );
    await sweepSponsoredFunding("fixture-close");
    const refunds = (
      await db.query(
        "SELECT id,payload FROM transactional_tasks WHERE kind='sponsored_refund' AND payload->>'questId'=$1",
        [id],
      )
    ).rows;
    assert.equal(refunds.length, 2);
    const refundBefore = await balance(payer.id);
    for (const task of refunds) {
      assert.equal(await processTask(task.id), true);
      assert.equal(await processTask(task.id), false);
    }
    assert.equal(await balance(payer.id), refundBefore + 46n);
    await db.query(
      "UPDATE transactional_tasks SET status='pending',attempts=0,available_at=NOW(),completed_at=NULL,payload=$2::jsonb WHERE id=$1",
      [refunds[0].id, JSON.stringify(refunds[0].payload)],
    );
    await processTask(refunds[0].id);
    assert.equal(await balance(payer.id), refundBefore + 46n);
    const final = (
      await db.query(
        "SELECT reserved_coins::text reserved,refunded_coins::text refunded,marketing_balance_micros::text marketing,application_balance_coins::text applications FROM sponsored_quest_funding WHERE quest_id=$1",
        [id],
      )
    ).rows[0];
    assert.deepEqual(final, {
      reserved: "52",
      refunded: "46",
      marketing: "0",
      applications: "0",
    });
    console.log(
      "PASS cancellation preserves exact funding conservation and durable refunds survive replay without double credit",
    );
    const legacy = (
      await db.query(
        "INSERT INTO sponsored_quests(brand_name,title,description,requirements,reward_coins,max_applications,deadline,is_active,pause_reason,auto_paused) VALUES('Legacy','Legacy fixture','Legacy fixture description','Legacy requirement',5,1,NOW()+INTERVAL '1 day',false,'funding_required',true) RETURNING id",
      )
    ).rows[0].id;
    assert.equal(
      await recordSponsoredQuestImpression(orm, legacy, one.id, 0.5),
      false,
    );
    const legacyBefore = await balance(payer.id);
    const funded = await fundLegacy(
      request(
        "/api/admin/sponsored-quests/" + legacy + "/fund",
        payer.accessToken,
        { maxReserveCoins: 5 },
      ),
      ctx(legacy),
    );
    assert.equal(
      funded.status,
      200,
      JSON.stringify(await funded.clone().json()),
    );
    assert.equal(await balance(payer.id), legacyBefore - 5n);
    assert.equal(
      (
        await fundLegacy(
          request(
            "/api/admin/sponsored-quests/" + legacy + "/fund",
            payer.accessToken,
            { maxReserveCoins: 5 },
          ),
          ctx(legacy),
        )
      ).status,
      200,
    );
    assert.equal(await balance(payer.id), legacyBefore - 5n);
    const business = (
      await db.query(
        "INSERT INTO business_accounts(user_id,business_name,tier,status) VALUES($1,'Funding fixture','growth','active') RETURNING id",
        [one.id],
      )
    ).rows[0].id;
    const businessQuest = (
      await db.query(
        "INSERT INTO sponsored_quests(brand_name,title,description,reward_coins,max_applications,deadline,is_active,business_account_id,pause_reason,auto_paused) VALUES('Fixture','Business funding fixture','Business funding fixture',5,1,NOW()+INTERVAL '1 day',false,$1,'funding_required',true) RETURNING id",
        [business],
      )
    ).rows[0].id;
    const ownerBefore = await balance(one.id);
    assert.equal(
      (
        await fundBusiness(
          request(
            "/api/business/sponsored-quests/" + businessQuest + "/fund",
            two.accessToken,
            { maxReserveCoins: 5 },
          ),
          ctx(businessQuest),
        )
      ).status,
      404,
    );
    assert.equal(await balance(one.id), ownerBefore);
    const ownerFund = await fundBusiness(
      request(
        "/api/business/sponsored-quests/" + businessQuest + "/fund",
        one.accessToken,
        { maxReserveCoins: 5 },
      ),
      ctx(businessQuest),
    );
    assert.equal(
      ownerFund.status,
      200,
      JSON.stringify(await ownerFund.clone().json()),
    );
    assert.equal(await balance(one.id), ownerBefore - 5n);
    console.log(
      "PASS legacy campaign activation requires explicit bounded wallet funding and retrying funding cannot reserve twice",
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
