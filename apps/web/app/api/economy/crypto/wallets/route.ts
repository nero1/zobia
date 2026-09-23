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
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, handleApiError, notFound } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getChainAdapter } from "@/lib/payments/crypto/chains";
import { writeAuditLog } from "@/lib/audit/auditLog";

interface WalletRow {
  id: string;
  chain: string;
  address: string;
  label: string | null;
  created_at: string;
}

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
    const { rows } = await db.query<WalletRow>(
      `SELECT id, chain, address, label, created_at FROM user_crypto_wallets WHERE user_id = $1 ORDER BY chain ASC`,
      [auth.user.sub]
    );
    return NextResponse.json({
      success: true,
      data: rows.map((w) => ({
        id: w.id,
        chain: w.chain,
        addressMasked: maskAddress(w.address),
        label: w.label,
        createdAt: w.created_at,
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

    await db.query(
      `INSERT INTO user_crypto_wallets (user_id, chain, address, label, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id, chain) DO UPDATE SET address = EXCLUDED.address, label = EXCLUDED.label, updated_at = NOW()`,
      [auth.user.sub, body.chain, body.address, body.label ?? null]
    );

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

    const { rowCount } = await db.query(
      `DELETE FROM user_crypto_wallets WHERE user_id = $1 AND chain = $2`,
      [auth.user.sub, chain]
    );
    if (!rowCount) throw notFound("No saved wallet for this chain");

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
