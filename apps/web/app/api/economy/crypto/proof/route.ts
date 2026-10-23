import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api/middleware";
import { getDb, schema } from "@/lib/db/drizzle";
import { badRequest, notFound } from "@/lib/api/errors";
import { paymentOwnershipMessage } from "@/lib/payments/crypto/ownership";
export const dynamic = "force-dynamic";
export const GET = withAuth(async (req, { auth }) => {
  const ref = req.nextUrl.searchParams.get("ref");
  if (!ref || ref.length > 200) throw badRequest("Invalid payment reference");
  const db = await getDb();
  const [payment] = await db.select({ id: schema.payments.id }).from(schema.payments).where(and(eq(schema.payments.userId, auth.user.sub), eq(schema.payments.provider, "crypto"), eq(schema.payments.idempotencyKey, ref))).limit(1);
  if (!payment) throw notFound("Payment not found");
  return NextResponse.json({ success: true, data: { message: paymentOwnershipMessage(ref, auth.user.sub) } }, { headers: { "Cache-Control": "private, no-store" } });
});
