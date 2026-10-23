import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "@/lib/db/schema";
import { createUser } from "./helpers";
import { integrationSetup, closeTestPool } from "./setup";
jest.mock("@/lib/db/drizzle", () => ({ ...jest.requireActual("@/lib/db/drizzle"), getDb: jest.fn() }));
jest.mock("@/lib/manifest", () => ({ getManifestValue: jest.fn().mockResolvedValue(null), loadManifest: jest.fn().mockResolvedValue({}) }));
jest.mock("@/lib/alerts/dispatch", () => ({ raiseAlert: jest.fn() }));
import { getDb } from "@/lib/db/drizzle";
import { processSubscriptionEvent, type PaystackSubscriptionEvent } from "@/lib/payments/paystackWebhookHandler";
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration("Paystack subscription lifecycle", () => {
 const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL }); let id: string;
 const end = new Date(Date.now() + 86400_000);
 function event(kind: PaystackSubscriptionEvent["event"], status: PaystackSubscriptionEvent["data"]["status"]): PaystackSubscriptionEvent {
  return { event: kind, data: { subscription_code: "test-subscription", status, plan: { plan_code: "zobia-plus-monthly", name: "Plus" }, customer: { email: "test@example.com", customer_code: "test", metadata: { userId: id } }, next_payment_date: end.toISOString() } };
 }
 beforeAll(async () => { if (!await integrationSetup()) throw new Error("Integration database unavailable"); (getDb as jest.Mock).mockResolvedValue(drizzle(pool, { schema })); const c = await pool.connect(); try { id = (await createUser(c, { plan: "plus", coinBalance: 0 })).id; } finally { c.release(); } });
 beforeEach(async () => { await pool.query("DELETE FROM subscriptions WHERE user_id=$1", [id]); await pool.query("INSERT INTO subscriptions(user_id,plan,status,provider,provider_subscription_id,ends_at) VALUES($1,'plus','active','paystack','test-subscription',$2)", [id, end]); await pool.query("UPDATE users SET plan='plus' WHERE id=$1", [id]); });
 afterAll(async () => { await pool.query("DELETE FROM users WHERE id=$1", [id]); await pool.end(); await closeTestPool(); });
 it("records a disabled renewal as cancelled while retaining paid access to period end", async () => {
  await processSubscriptionEvent(event("subscription.disable", "cancelled"));
  const sub = (await pool.query("SELECT * FROM subscriptions WHERE user_id=$1", [id])).rows[0];
  expect(sub.status).toBe("cancelled"); expect(sub.auto_renew).toBe(false); expect(sub.ends_at.getTime()).toBe(end.getTime());
  expect((await pool.query("SELECT plan FROM users WHERE id=$1", [id])).rows[0].plan).toBe("plus");
 });
 it("ignores an older cancellation after a new provider subscription replaces it", async () => {
  await pool.query("UPDATE subscriptions SET provider='google_play',provider_subscription_id='new-play-token' WHERE user_id=$1", [id]);
  await processSubscriptionEvent(event("subscription.disable", "cancelled"));
  expect((await pool.query("SELECT status,provider FROM subscriptions WHERE user_id=$1", [id])).rows[0]).toEqual({ status: "active", provider: "google_play" });
  expect((await pool.query("SELECT plan FROM users WHERE id=$1", [id])).rows[0].plan).toBe("plus");
 });
 it("does not grant paid access for an inactive subscription creation", async () => {
  await pool.query("UPDATE users SET plan='free' WHERE id=$1", [id]);
  await pool.query("DELETE FROM subscriptions WHERE user_id=$1", [id]);
  await processSubscriptionEvent(event("subscription.create", "attention"));
  expect((await pool.query("SELECT plan FROM users WHERE id=$1", [id])).rows[0].plan).toBe("free");
  expect((await pool.query("SELECT count(*)::int n FROM subscriptions WHERE user_id=$1", [id])).rows[0].n).toBe(0);
 });
});
