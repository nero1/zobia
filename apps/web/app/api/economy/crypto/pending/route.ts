import { NextResponse } from "next/server";
import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { storedCryptoQuote } from "@/lib/payments/crypto/storedQuote";
export const dynamic = "force-dynamic";
export const GET = withAuth(async (_req, { auth }) => {
  try {
    const orm = await getDb();
    const rows = await orm.select({ reference: schema.payments.idempotencyKey, tokenSymbol: schema.payments.tokenSymbol, chain: schema.payments.chain, walletAddress: schema.payments.walletAddress, expectedTokenAmount: schema.payments.expectedTokenAmount, createdAt: schema.payments.createdAt }).from(schema.payments).where(and(eq(schema.payments.userId, auth.user.sub), eq(schema.payments.provider, "crypto"), eq(schema.payments.status, "pending"), gt(schema.payments.createdAt, sql`NOW() - INTERVAL '48 hours'`), isNotNull(schema.payments.expectedTokenAmount), isNotNull(schema.payments.walletAddress))).orderBy(desc(schema.payments.createdAt)).limit(20);
    const data = rows.flatMap(row => {
      const quote = storedCryptoQuote(row);
      return quote ? [{ reference: row.reference, createdAt: row.createdAt, quote }] : [];
    });
    return NextResponse.json({ success: true, data }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return handleApiError(error); }
});
