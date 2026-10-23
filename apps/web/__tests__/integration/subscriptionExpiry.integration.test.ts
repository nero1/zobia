import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "@/lib/db/schema";
import { createUser } from "./helpers";
import { integrationSetup, closeTestPool } from "./setup";
jest.mock("@/lib/db/drizzle", () => ({ ...jest.requireActual("@/lib/db/drizzle"), getDb: jest.fn() }));
jest.mock("@/lib/plans/gracePeriod", () => ({ PERSONAL_GRACE_PLANS: ["plus","pro","max"], BUSINESS_GRACE_TIERS: ["starter","growth","enterprise"], getGracePeriodDays: jest.fn().mockResolvedValue(5), isFeaturePreservedDuringGrace: jest.fn().mockResolvedValue(false) }));
jest.mock("@/lib/games/saves", () => ({ reconcileSavesForUser: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/plans/saveSlots", () => ({ getSaveSlotLimit: jest.fn().mockResolvedValue(0) }));
jest.mock("@/lib/plans/groupChatSweep", () => ({ deactivateGroupsForUser: jest.fn().mockResolvedValue(0) }));
jest.mock("@/lib/quests/sponsoredQuestPacing", () => ({ syncSponsoredQuestTemplate: jest.fn() }));
import { getDb } from "@/lib/db/drizzle";
import { reconcileSavesForUser } from "@/lib/games/saves";
import { sweepSubscriptions } from "@/lib/plans/subscriptionSweep";
const integration=process.env.TEST_DATABASE_URL?describe:describe.skip;
integration("cancelled subscription expiry",()=>{
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL});let id:string;
 beforeAll(async()=>{if(!await integrationSetup())throw new Error("Integration database unavailable");(getDb as jest.Mock).mockResolvedValue(drizzle(pool,{schema}));const c=await pool.connect();try{id=(await createUser(c,{plan:"plus"})).id;}finally{c.release();}});
 afterAll(async()=>{await pool.query("DELETE FROM users WHERE id=$1",[id]);await pool.end();await closeTestPool();});
 it("keeps cancellation benefits only until the paid period ends and sweeps idempotently",async()=>{
  await pool.query("INSERT INTO subscriptions(user_id,plan,status,ends_at) VALUES($1,'plus','cancelled',now()-interval '1 hour')",[id]);
  await sweepSubscriptions();
  expect((await pool.query("SELECT plan FROM users WHERE id=$1",[id])).rows[0].plan).toBe("free");
  expect((await pool.query("SELECT status FROM subscriptions WHERE user_id=$1",[id])).rows[0].status).toBe("grace");
  await sweepSubscriptions();
  expect((await pool.query("SELECT status FROM subscriptions WHERE user_id=$1",[id])).rows[0].status).toBe("grace");
  await pool.query("UPDATE subscriptions SET grace_period_ends_at=now()-interval '1 hour' WHERE user_id=$1",[id]);
  await sweepSubscriptions();
  expect((await pool.query("SELECT status FROM subscriptions WHERE user_id=$1",[id])).rows[0].status).toBe("lapsed");
 });
 it("rechecks expiry after a concurrent renewal owns the account lock", async () => {
  await pool.query("UPDATE users SET plan='plus' WHERE id=$1", [id]);
  await pool.query("UPDATE subscriptions SET plan='plus',status='active',ends_at=now()-interval '1 hour' WHERE user_id=$1", [id]);
  const renewal = await pool.connect();
  let sweep: Promise<unknown> | undefined;
  try {
   await renewal.query("BEGIN");
   await renewal.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [id]);
   await renewal.query("UPDATE subscriptions SET ends_at=now()+interval '30 days' WHERE user_id=$1", [id]);
   (reconcileSavesForUser as jest.Mock).mockClear();
   sweep = sweepSubscriptions();
   let blocked = false;
   for (let i = 0; i < 100; i++) {
    const waits = await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%users%for update%'");
    if (waits.rowCount) { blocked = true; break; }
    await new Promise(resolve => setTimeout(resolve, 20));
   }
   expect(blocked).toBe(true);
   await renewal.query("COMMIT");
   await sweep;
   expect((await pool.query("SELECT plan FROM users WHERE id=$1", [id])).rows[0].plan).toBe("plus");
   expect((await pool.query("SELECT status FROM subscriptions WHERE user_id=$1", [id])).rows[0].status).toBe("active");
   expect(reconcileSavesForUser).not.toHaveBeenCalled();
  } finally { await renewal.query("ROLLBACK"); renewal.release(); if (sweep) await sweep; }
 });
 it("rolls expiry and account downgrade back when cleanup fails", async () => {
  await pool.query("UPDATE subscriptions SET ends_at=now()-interval '1 hour' WHERE user_id=$1", [id]);
  (reconcileSavesForUser as jest.Mock).mockRejectedValueOnce(new Error("cleanup failed"));
  await expect(sweepSubscriptions()).rejects.toThrow("cleanup failed");
  expect((await pool.query("SELECT plan FROM users WHERE id=$1", [id])).rows[0].plan).toBe("plus");
  expect((await pool.query("SELECT status FROM subscriptions WHERE user_id=$1", [id])).rows[0].status).toBe("active");
 });

});
