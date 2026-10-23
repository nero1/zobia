import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "crypto";
import { schema } from "@/lib/db/schema";
import { createUser } from "./helpers";
import { integrationSetup, closeTestPool } from "./setup";
import * as notifications from "@/lib/notifications/insert";
jest.mock("@/lib/db/drizzle", () => ({ ...jest.requireActual("@/lib/db/drizzle"), getDb: jest.fn() }));
jest.mock("@/lib/payments/googlePlayVerify", () => ({ verifyGooglePlaySubscriptionPurchase: jest.fn(), verifyGooglePlayProductPurchase: jest.fn(), acknowledgeGooglePlaySubscription: jest.fn().mockResolvedValue(undefined), cancelGooglePlaySubscription: jest.fn().mockResolvedValue(undefined), consumeGooglePlayPurchase: jest.fn().mockResolvedValue(undefined) }));
import { getDb } from "@/lib/db/drizzle";
import { verifyGooglePlaySubscriptionPurchase, verifyGooglePlayProductPurchase } from "@/lib/payments/googlePlayVerify";
import { activatePlayBusiness, activatePlayConsumable, activatePlaySubscription } from "@/lib/plans/playSubscription";
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration("Google Play entitlement and wallet accounting", () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL }); const users: string[] = []; const products: string[] = [];
  const start = Date.now()-60_000; let expiry = Date.now()+30*86400_000;
  beforeAll(async () => { if (!await integrationSetup()) throw new Error("Integration database unavailable"); (getDb as jest.Mock).mockResolvedValue(drizzle(pool, { schema })); });
  beforeEach(() => {
    expiry = Date.now()+30*86400_000;
    (verifyGooglePlaySubscriptionPurchase as jest.Mock).mockImplementation(async () => ({ paymentState: 1, startTimeMillis: String(start), expiryTimeMillis: String(expiry), autoRenewing: true }));
    (verifyGooglePlayProductPurchase as jest.Mock).mockResolvedValue({ purchaseState: 0, consumptionState: 0, orderId: randomUUID() });
  });
  afterAll(async () => { for (const id of users) await pool.query("DELETE FROM users WHERE id=$1",[id]); for (const slug of products) { await pool.query("DELETE FROM account_type_play_products WHERE account_type_slug=$1",[slug]); await pool.query("DELETE FROM account_types WHERE slug=$1",[slug]); } await pool.end(); await closeTestPool(); });
  async function user() { const c = await pool.connect(); try { const u = await createUser(c,{coinBalance:0}); users.push(u.id);return u.id; } finally { c.release(); } }
  it("stores Google's exact expiry, grants one bonus under concurrency and restores without re-crediting", async () => {
    const id=await user(),token=randomUUID();
    const results = await Promise.all([activatePlaySubscription(id,"pkg","sub_plus_monthly",token),activatePlaySubscription(id,"pkg","sub_plus_monthly",token)]);
    expect(results.reduce((n,r)=>n+r.coinsGranted,0)).toBe(50);
    const sub=(await pool.query("SELECT * FROM subscriptions WHERE user_id=$1",[id])).rows[0];
    expect(sub.provider).toBe("google_play"); expect(sub.ends_at.getTime()).toBe(expiry);
    expect(Number((await pool.query("SELECT coin_balance FROM users WHERE id=$1",[id])).rows[0].coin_balance)).toBe(50);
    expect((await activatePlaySubscription(id,"pkg","sub_plus_monthly",token)).coinsGranted).toBe(0);
  });
  it("rejects replay of a subscription token into another account", async () => {
    const first=await user(),second=await user(),token=randomUUID();
    await activatePlaySubscription(first,"pkg","sub_plus_monthly",token);
    await expect(activatePlaySubscription(second,"pkg","sub_plus_monthly",token)).rejects.toMatchObject({ code:"PURCHASE_ALREADY_CLAIMED" });
    expect((await pool.query("SELECT plan FROM users WHERE id=$1",[second])).rows[0].plan).toBe("free");
  });
  it("rejects expired and unconfirmed purchases before writing any entitlement", async () => {
    const id=await user();
    (verifyGooglePlaySubscriptionPurchase as jest.Mock).mockResolvedValue({paymentState:1,startTimeMillis:String(start),expiryTimeMillis:String(Date.now()-1000)});
    await expect(activatePlaySubscription(id,"pkg","sub_plus_monthly",randomUUID())).rejects.toMatchObject({code:"SUBSCRIPTION_NOT_PAID"});
    expect((await pool.query("SELECT count(*)::int n FROM subscriptions WHERE user_id=$1",[id])).rows[0].n).toBe(0);
  });
  it("updates renewal expiry without issuing a second bonus in the same calendar month", async () => {
    const id=await user(),token=randomUUID(); await activatePlaySubscription(id,"pkg","sub_plus_monthly",token);
    expiry += 30*86400_000;
    expect((await activatePlaySubscription(id,"pkg","sub_plus_monthly",token)).coinsGranted).toBe(0);
    expect((await pool.query("SELECT ends_at FROM subscriptions WHERE user_id=$1",[id])).rows[0].ends_at.getTime()).toBe(expiry);
  });
  it("binds consumables globally and credits only one wallet when two users race", async () => {
    const first=await user(),second=await user(),token=randomUUID();
    const results = await Promise.allSettled([activatePlayConsumable(first,"pkg","coins_starter",token,100,0),activatePlayConsumable(second,"pkg","coins_starter",token,100,0)]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(Number((await pool.query("SELECT sum(coin_balance) n FROM users WHERE id=ANY($1::uuid[])",[[first,second]])).rows[0].n)).toBe(100);
    const winner=results[0].status==="fulfilled"?first:second;
    expect((await activatePlayConsumable(winner,"pkg","coins_starter",token,100,0)).coinsGranted).toBe(0);
  });
  it("retains a claimed-token tombstone after permanent account deletion", async () => {
    const id=await user(),token=randomUUID();await activatePlayConsumable(id,"pkg","coins_starter",token,100,0);
    await pool.query("DELETE FROM users WHERE id=$1",[id]);
    await expect(activatePlayConsumable(await user(),"pkg","coins_starter",token,100,0)).rejects.toMatchObject({code:"PURCHASE_ALREADY_CLAIMED"});
  });
  it("creates a business account, expiry, payment and notification atomically and restores once", async () => {
    const id=await user(),token=randomUUID();
    await activatePlayBusiness(id,"pkg","biz_growth_monthly",token,{business_name:"Example shop"});
    const account=(await pool.query("SELECT * FROM business_accounts WHERE user_id=$1",[id])).rows[0];
    expect(account.tier).toBe("growth");expect(account.current_period_ends_at.getTime()).toBe(expiry);
    await activatePlayBusiness(id,"pkg","biz_growth_monthly",token,{});
    expect((await pool.query("SELECT count(*)::int n FROM payments WHERE user_id=$1",[id])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int n FROM notifications WHERE user_id=$1",[id])).rows[0].n).toBe(1);
    await expect(activatePlayBusiness(await user(),"pkg","biz_growth_monthly",token,{business_name:"Other shop"})).rejects.toMatchObject({code:"PURCHASE_ALREADY_CLAIMED"});
  });
  it("rolls back the business, receipt and payment if notification storage fails", async () => {
    const id=await user(),token=randomUUID();
    const spy=jest.spyOn(notifications,"insertNotification").mockRejectedValueOnce(new Error("Notification unavailable"));
    try { await expect(activatePlayBusiness(id,"pkg","biz_growth_monthly",token,{business_name:"Rollback shop"})).rejects.toThrow("Notification unavailable"); }
    finally { spy.mockRestore(); }
    for (const table of ["business_accounts","payments","play_purchase_receipts"]) expect((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE user_id=$1`,[id])).rows[0].n).toBe(0);
    await expect(activatePlayBusiness(id,"pkg","biz_growth_monthly",token,{business_name:"Retry shop"})).resolves.toEqual({tier:"growth"});
  });
  it("activates a custom product with its inherited tier and separate product identity", async () => {
    const id=await user(),slug=`test_${randomUUID().replace(/-/g,"")}`,sku=`custom.${randomUUID().replace(/-/g,"")}`;products.push(slug);
    await pool.query("INSERT INTO account_types(slug,name,kind,base_plan,monthly_price_kobo,annual_price_kobo) VALUES($1,'Custom Pro','personal','pro',100000,1000000)",[slug]);
    await pool.query("INSERT INTO account_type_play_products(product_id,account_type_slug,interval) VALUES($1,$2,'monthly')",[sku,slug]);
    await activatePlaySubscription(id,"pkg",sku,randomUUID());
    expect((await pool.query("SELECT plan,account_type_slug FROM users WHERE id=$1",[id])).rows[0]).toEqual({plan:"pro",account_type_slug:slug});
    expect((await pool.query("SELECT plan,account_type_slug FROM subscriptions WHERE user_id=$1",[id])).rows[0]).toEqual({plan:"pro",account_type_slug:slug});
  });
});
