import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { requireAccountType } from "@/lib/plans/catalog";
export const dynamic = "force-dynamic";
export const POST = withAuth(async (req, { auth }) => {
  try {
    const body = await validateBody(req, z.object({ slug: z.string().min(2).max(48) }).strict());
    const orm = await getDb();
    await orm.transaction(async tx => {
      const product = await requireAccountType(body.slug, "personal", tx);
      if (product.basePlan !== "free") throw badRequest("Paid account types require checkout");
      const [user] = await tx.select({ plan: schema.users.plan }).from(schema.users).where(eq(schema.users.id, auth.user.sub)).for("no key update");
      if (!user || user.plan !== "free") throw badRequest("Cancel your paid subscription first; benefits remain until the billing period ends");
      await tx.update(schema.users).set({ accountTypeSlug: product.slug, updatedAt: new Date() }).where(eq(schema.users.id, auth.user.sub));
    });
    return NextResponse.json({ success: true });
  } catch (error) { return handleApiError(error); }
});
