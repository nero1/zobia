export const dynamic = 'force-dynamic';

/**
 * /api/economy/crypto/wallets
 *
 * Manage the authenticated user's own saved wallet addresses (BSC/Solana).
 * Used both to *send* crypto payments and as the destination for a JAGA/BNB/
 * SOL crypto payout withdrawal (POST /api/economy/crypto/withdraw) — the
 * user's own wallet either way. Distinct from /api/creator/wallet-address,
 * which is the legacy Tron/USDT address for manually-processed payouts.
 *
 * GET    — List saved wallets, address masked (first 4 + … + last 4).
 * POST   — Add or update the wallet for a chain.
 * DELETE — Remove the wallet for a chain (?chain=bsc|solana).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, handleApiError, notFound } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getChainAdapter } from "@/lib/payments/crypto/chains";
import { writeAuditLog } from "@/lib/audit/auditLog";

function maskAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

const PostSchema = z.object({
  chain: z.enum(["bsc", "solana"]),
  address: z.string().min(20).max(64),
  label: z.string().max(60).optional(),
});

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const orm = await getDb();
    const rows = await orm
      .select({
        id: schema.userCryptoWallets.id,
        chain: schema.userCryptoWallets.chain,
        address: schema.userCryptoWallets.address,
        label: schema.userCryptoWallets.label,
        createdAt: schema.userCryptoWallets.createdAt,
      })
      .from(schema.userCryptoWallets)
      .where(eq(schema.userCryptoWallets.userId, auth.user.sub))
      .orderBy(asc(schema.userCryptoWallets.chain));
    return NextResponse.json({
      success: true,
      data: rows.map((w) => ({
        id: w.id,
        chain: w.chain,
        addressMasked: maskAddress(w.address),
        label: w.label,
        createdAt: w.createdAt,
      })),
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const body = await validateBody(req, PostSchema);

    const adapter = getChainAdapter(body.chain);
    if (!adapter.isValidAddress(body.address)) {
      throw badRequest(`Invalid ${body.chain === "bsc" ? "BNB Smart Chain" : "Solana"} address format`, "INVALID_ADDRESS");
    }

    const orm = await getDb();
    await orm
      .insert(schema.userCryptoWallets)
      .values({
        userId: auth.user.sub,
        chain: body.chain,
        address: body.address,
        label: body.label ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.userCryptoWallets.userId, schema.userCryptoWallets.chain],
        set: {
          address: body.address,
          label: body.label ?? null,
          updatedAt: new Date(),
        },
      });

    writeAuditLog({
      actorId: auth.user.sub,
      action: "user_crypto_wallet_saved",
      targetType: "user_crypto_wallet",
      targetId: auth.user.sub,
      metadata: { chain: body.chain },
    });

    return NextResponse.json({
      success: true,
      data: { chain: body.chain, addressMasked: maskAddress(body.address) },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const chain = new URL(req.url).searchParams.get("chain");
    if (chain !== "bsc" && chain !== "solana") {
      throw badRequest("Query param 'chain' must be 'bsc' or 'solana'");
    }

    const orm = await getDb();
    const deleted = await orm
      .delete(schema.userCryptoWallets)
      .where(and(eq(schema.userCryptoWallets.userId, auth.user.sub), eq(schema.userCryptoWallets.chain, chain)))
      .returning({ id: schema.userCryptoWallets.id });
    if (deleted.length === 0) throw notFound("No saved wallet for this chain");

    writeAuditLog({
      actorId: auth.user.sub,
      action: "user_crypto_wallet_deleted",
      targetType: "user_crypto_wallet",
      targetId: auth.user.sub,
      metadata: { chain },
    });

    return NextResponse.json({ success: true, data: null, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
