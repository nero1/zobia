import { and, asc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { memDel, memGet, memSet } from "@/lib/cache/memory";
import { invalidateManifestCache } from "@/lib/manifest";

const money = z.number().int().min(0).max(100_000_000_000);
const productId = z.string().trim().regex(/^[a-z0-9][a-z0-9._]{0,147}$/).nullable().default(null);
export const accountTypeInput = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9_]{1,47}$/),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).default(""),
  kind: z.enum(["personal", "business"]),
  basePlan: z.enum(["free", "plus", "pro", "max", "starter", "growth", "enterprise"]),
  monthlyPriceKobo: money,
  annualPriceKobo: money.max(1_200_000_000_000),
  playMonthlyProductId: productId,
  playAnnualProductId: productId,
  isActive: z.boolean(),
  revision: z.number().int().positive().optional(),
}).strict().superRefine((value, ctx) => {
  const allowed = value.kind === "personal" ? ["free", "plus", "pro", "max"] : ["starter", "growth", "enterprise"];
  if (!allowed.includes(value.basePlan)) ctx.addIssue({ code: "custom", path: ["basePlan"], message: "Choose an entitlement tier for this account kind" });
  if (value.basePlan === "free" ? value.monthlyPriceKobo !== 0 || value.annualPriceKobo !== 0 : value.monthlyPriceKobo <= 0 || value.annualPriceKobo <= 0) {
    ctx.addIssue({ code: "custom", path: ["monthlyPriceKobo"], message: "Free products must cost zero; paid products need positive monthly and annual prices" });
  }
  if (value.slug === "free" && !value.isActive) ctx.addIssue({ code: "custom", path: ["isActive"], message: "The default Free account must stay available" });
  if (value.playMonthlyProductId && value.playMonthlyProductId === value.playAnnualProductId) ctx.addIssue({ code: "custom", path: ["playAnnualProductId"], message: "Use a distinct product identifier for each billing period" });
  if (value.basePlan === "free" && (value.playMonthlyProductId || value.playAnnualProductId)) ctx.addIssue({ code: "custom", path: ["playMonthlyProductId"], message: "Free products do not use Play Billing" });
  if (value.kind === "business" && value.playAnnualProductId) ctx.addIssue({ code: "custom", path: ["playAnnualProductId"], message: "Business billing currently uses monthly products" });
});
export type AccountTypeInput = z.infer<typeof accountTypeInput>;
type ProductRow = typeof schema.accountTypes.$inferSelect;
export function serializeAccountType(row: ProductRow) {
  return { ...row, monthlyPriceKobo: Number(row.monthlyPriceKobo), annualPriceKobo: Number(row.annualPriceKobo) };
}
export type AccountType = ReturnType<typeof serializeAccountType>;
const CACHE = "account-type-catalog:v1";

/** Small process cache only: no Redis command per account/settings render. */
export async function listAccountTypes(includeInactive = false): Promise<AccountType[]> {
  let rows = memGet<AccountType[]>(CACHE);
  if (!rows) {
    const orm = await getDb();
    rows = (await orm.select().from(schema.accountTypes).orderBy(asc(schema.accountTypes.monthlyPriceKobo), asc(schema.accountTypes.slug))).map(serializeAccountType);
    const prices = new Map((await orm.select().from(schema.xManifest).where(inArray(schema.xManifest.key, ["business_starter_price_kobo", "business_growth_price_kobo", "business_enterprise_price_kobo"]))).map(r => [r.key, Number(r.value)]));
    rows = rows.map(row => {
      const price = prices.get(`business_${row.basePlan}_price_kobo`);
      return row.builtIn && row.kind === "business" && Number.isSafeInteger(price) && price! > 0 ? { ...row, monthlyPriceKobo: price! } : row;
    }).sort((a,b) => a.monthlyPriceKobo - b.monthlyPriceKobo || a.slug.localeCompare(b.slug));
    memSet(CACHE, rows, 15_000);
  }
  return includeInactive ? rows : rows.filter(row => row.isActive);
}

/** Critical purchase paths read current state, never the display cache. */
export async function requireAccountType(slug: string, kind: "personal" | "business", tx?: DbOrTx, active = true) {
  const orm = tx ?? await getDb();
  const [row] = await orm.select().from(schema.accountTypes).where(eq(schema.accountTypes.slug, slug)).limit(1);
  if (!row || row.kind !== kind || (active && !row.isActive)) throw notFound("Account type is not available");
  const product = serializeAccountType(row);
  if (row.builtIn && row.kind === "business") {
    const [setting] = await orm.select({ value: schema.xManifest.value }).from(schema.xManifest).where(eq(schema.xManifest.key, `business_${row.basePlan}_price_kobo`)).limit(1);
    const price = Number(setting?.value);
    if (Number.isSafeInteger(price) && price > 0) product.monthlyPriceKobo = price;
  }
  return product;
}

export async function findPlayAccountType(product: string, kind: "personal" | "business") {
  const orm = await getDb();
  const [match] = await orm.select({ product: schema.accountTypes, interval: schema.accountTypePlayProducts.interval }).from(schema.accountTypePlayProducts).innerJoin(schema.accountTypes, eq(schema.accountTypes.slug, schema.accountTypePlayProducts.accountTypeSlug)).where(and(eq(schema.accountTypes.kind, kind), eq(schema.accountTypePlayProducts.productId, product))).limit(1);
  // Existing purchases remain restorable when a product is removed from sale.
  return match ? { ...serializeAccountType(match.product), interval: match.interval as "monthly" | "annual" } : null;
}

export async function saveAccountType(adminId: string, raw: unknown) {
  const input = accountTypeInput.parse(raw);
  const orm = await getDb();
  const saved = await orm.transaction(async tx => {
    // Serialize create/update for the same slug, including the absent-row case.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`account-type:${input.slug}`}, 0))`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('account-type-store-products', 0))`);
    const [old] = await tx.select().from(schema.accountTypes).where(eq(schema.accountTypes.slug, input.slug)).for("update");
    if (old && input.revision !== old.revision) throw conflict("This account type changed. Refresh before saving.", "STALE_ACCOUNT_TYPE");
    if (!old && input.revision) throw notFound("Account type no longer exists");
    if (old && (old.kind !== input.kind || old.basePlan !== input.basePlan)) throw badRequest("Create a new account type to use a different entitlement tier");
    for (const id of [input.playMonthlyProductId, input.playAnnualProductId].filter((id): id is string => !!id)) {
      const [historical] = await tx.select().from(schema.accountTypePlayProducts).where(eq(schema.accountTypePlayProducts.productId, id)).limit(1);
      const interval = input.playMonthlyProductId === id ? "monthly" : "annual";
      if (historical && (historical.accountTypeSlug !== input.slug || historical.interval !== interval)) throw conflict("This Play product already belongs to another account type or billing period", "DUPLICATE_PLAY_PRODUCT");
      const [collision] = await tx.select({ slug: schema.accountTypes.slug }).from(schema.accountTypes).where(and(ne(schema.accountTypes.slug, input.slug), or(eq(schema.accountTypes.playMonthlyProductId, id), eq(schema.accountTypes.playAnnualProductId, id)))).limit(1);
      if (collision) throw conflict("This Play product already belongs to another account type", "DUPLICATE_PLAY_PRODUCT");
      if (/^(coins_|stars_)/.test(id)) throw badRequest("A consumable product cannot be used for an account type");
    }
    if (!old && (["free", "plus", "pro", "max"].includes(input.slug) || input.slug.startsWith("business_"))) {
      throw badRequest("This account type identifier is reserved");
    }
    const values = { name: input.name, description: input.description, kind: input.kind, basePlan: input.basePlan, monthlyPriceKobo: BigInt(input.monthlyPriceKobo), annualPriceKobo: BigInt(input.annualPriceKobo), playMonthlyProductId: input.playMonthlyProductId, playAnnualProductId: input.playAnnualProductId, isActive: input.isActive, updatedAt: new Date() };
    const [row] = old
      ? await tx.update(schema.accountTypes).set({ ...values, revision: old.revision + 1 }).where(and(eq(schema.accountTypes.slug, input.slug), eq(schema.accountTypes.revision, input.revision!))).returning()
      : await tx.insert(schema.accountTypes).values({ slug: input.slug, ...values }).returning();
    if (!row) throw conflict("Account type changed", "STALE_ACCOUNT_TYPE");
    for (const [interval, id] of [["monthly", row.playMonthlyProductId], ["annual", row.playAnnualProductId]] as const) {
      if (id) await tx.insert(schema.accountTypePlayProducts).values({ productId: id, accountTypeSlug: row.slug, interval }).onConflictDoNothing();
    }
    if (input.kind === "personal" && input.basePlan !== "free") {
      for (const interval of ["monthly", "annual"] as const) {
        const priceKobo = interval === "monthly" ? row.monthlyPriceKobo : row.annualPriceKobo;
        await tx.insert(schema.subscriptionPlans).values({ plan: row.slug, name: row.name, interval, priceKobo, currency: "NGN", isActive: row.isActive }).onConflictDoUpdate({ target: [schema.subscriptionPlans.plan, schema.subscriptionPlans.interval], set: { name: row.name, priceKobo, isActive: row.isActive, updatedAt: new Date() } });
      }
    }
    if (row.builtIn && row.kind === "business") {
      await tx.insert(schema.xManifest).values({ key: `business_${row.basePlan}_price_kobo`, value: row.monthlyPriceKobo.toString() }).onConflictDoUpdate({ target: schema.xManifest.key, set: { value: row.monthlyPriceKobo.toString(), updatedAt: new Date() } });
    }
    await tx.insert(schema.adminAuditLog).values({ adminId, action: old ? "account_type.updated" : "account_type.created", resource: "account_types", resourceId: row.slug, beforeVal: old ? serializeAccountType(old) : null, afterVal: serializeAccountType(row) });
    return serializeAccountType(row);
  });
  memDel(CACHE);
  memDel("account-store-products:v1");
  if (saved.kind === "business" && saved.builtIn) await invalidateManifestCache();
  return saved;
}
