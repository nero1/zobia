import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { handleApiError } from "@/lib/api/errors";
import { memGet, memSet } from "@/lib/cache/memory";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    let products = memGet<unknown[]>("account-store-products:v1");
    if (!products) {
      const orm = await getDb();
      products = await orm.select({ id: schema.accountTypePlayProducts.productId, interval: schema.accountTypePlayProducts.interval, accountTypeSlug: schema.accountTypes.slug, kind: schema.accountTypes.kind, basePlan: schema.accountTypes.basePlan }).from(schema.accountTypePlayProducts).innerJoin(schema.accountTypes, eq(schema.accountTypes.slug, schema.accountTypePlayProducts.accountTypeSlug));
      memSet("account-store-products:v1", products, 15_000);
    }
    return NextResponse.json({ success: true, data: products }, { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=30" } });
  } catch (error) { return handleApiError(error); }
}
