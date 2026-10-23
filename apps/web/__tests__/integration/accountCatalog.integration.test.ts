import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "crypto";
import { schema } from "@/lib/db/schema";
import { createUser } from "./helpers";
import { integrationSetup, closeTestPool } from "./setup";
jest.mock("@/lib/db/drizzle", () => ({ ...jest.requireActual("@/lib/db/drizzle"), getDb: jest.fn() }));
jest.mock("@/lib/manifest", () => ({ invalidateManifestCache: jest.fn().mockResolvedValue(undefined) }));
import { getDb } from "@/lib/db/drizzle";
import { accountTypeInput, findPlayAccountType, listAccountTypes, requireAccountType, saveAccountType } from "@/lib/plans/catalog";
const integration = process.env.TEST_DATABASE_URL ? describe : describe.skip;
integration("account product catalog", () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const slugs: string[] = []; let admin: string;
  beforeAll(async () => { if (!await integrationSetup()) throw new Error("Integration database unavailable"); (getDb as jest.Mock).mockResolvedValue(drizzle(pool, { schema })); const c = await pool.connect(); try { admin = (await createUser(c)).id; } finally { c.release(); } });
  afterAll(async () => { await pool.query("DELETE FROM admin_audit_log WHERE admin_id=$1", [admin]); for (const slug of slugs) { await pool.query("DELETE FROM subscription_plans WHERE plan=$1", [slug]); await pool.query("DELETE FROM account_type_play_products WHERE account_type_slug=$1", [slug]); await pool.query("DELETE FROM account_types WHERE slug=$1", [slug]); } await pool.query("DELETE FROM users WHERE id=$1", [admin]); await pool.end(); await closeTestPool(); });
  function input(kind: "personal" | "business" = "personal") { const slug = `test_${randomUUID().replace(/-/g, "")}`; slugs.push(slug); return { slug, name: "Test account", description: "Test product", kind, basePlan: kind === "personal" ? "plus" as const : "growth" as const, monthlyPriceKobo: 12345, annualPriceKobo: 123450, playMonthlyProductId: `test.${randomUUID().replace(/-/g, "")}`, playAnnualProductId: null, isActive: true }; }
  it("creates a priced personal product, maps checkout rows and inherits a known tier", async () => {
    const item = input(); const saved = await saveAccountType(admin, item);
    expect(saved.basePlan).toBe("plus"); expect(saved.revision).toBe(1);
    const rows = (await pool.query("SELECT interval,price_kobo FROM subscription_plans WHERE plan=$1 ORDER BY price_kobo", [item.slug])).rows;
    expect(rows.map(r => Number(r.price_kobo))).toEqual([12345,123450]);
    expect((await findPlayAccountType(item.playMonthlyProductId!, "personal"))?.slug).toBe(item.slug);
    expect(await findPlayAccountType(item.playMonthlyProductId!, "business")).toBeNull();
    const products = await listAccountTypes(); expect(products.map(p => p.monthlyPriceKobo)).toEqual(products.map(p => p.monthlyPriceKobo).sort((a,b) => a-b));
  });
  it("allows regular Free and business variants but rejects a mismatched entitlement kind", async () => {
    const free = { ...input(), basePlan: "free" as const, monthlyPriceKobo: 0, annualPriceKobo: 0, playMonthlyProductId: null };
    expect((await saveAccountType(admin, free)).basePlan).toBe("free");
    expect((await saveAccountType(admin, input("business"))).basePlan).toBe("growth");
    expect(accountTypeInput.safeParse({ ...input("business"), basePlan: "max" }).success).toBe(false);
    expect(accountTypeInput.safeParse({ ...free, monthlyPriceKobo: 1 }).success).toBe(false);
  });
  it("serializes competing edits and rejects a stale revision", async () => {
    const created = await saveAccountType(admin, input());
    const { builtIn: _b, createdAt: _c, updatedAt: _u, ...editable } = created;
    const results = await Promise.allSettled([saveAccountType(admin, { ...editable, name: "First" }), saveAccountType(admin, { ...editable, name: "Second" })]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(r => r.status === "rejected")).toHaveLength(1);
    expect((await requireAccountType(created.slug,"personal")).revision).toBe(2);
  });
  it("retires sales while keeping historical store purchases restorable and SKUs reserved", async () => {
    const original = input(); const created = await saveAccountType(admin, original);
    const updated = await saveAccountType(admin, { ...original, revision: created.revision, isActive: false, playMonthlyProductId: null });
    await expect(requireAccountType(original.slug,"personal")).rejects.toMatchObject({ status: 404 });
    expect((await findPlayAccountType(original.playMonthlyProductId!,"personal"))?.slug).toBe(original.slug);
    await expect(saveAccountType(admin, { ...input(), playMonthlyProductId: original.playMonthlyProductId })).rejects.toMatchObject({ code: "DUPLICATE_PLAY_PRODUCT" });
    expect(updated.isActive).toBe(false);
  });
  it("keeps custom product identity separate from the database's entitlement constraints", async () => {
    const product = await saveAccountType(admin, input());
    await pool.query("UPDATE users SET plan='plus',account_type_slug=$1 WHERE id=$2", [product.slug,admin]);
    expect((await pool.query("SELECT plan,account_type_slug FROM users WHERE id=$1", [admin])).rows[0]).toEqual({ plan: "plus", account_type_slug: product.slug });
    await pool.query("UPDATE users SET plan='free' WHERE id=$1", [admin]);
    expect((await pool.query("SELECT account_type_slug FROM users WHERE id=$1",[admin])).rows[0].account_type_slug).toBeNull();
  });
});
