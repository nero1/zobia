export const dynamic = 'force-dynamic';

/**
 * /api/creator/wallet-address
 *
 * Manage a creator's USDT/Tron wallet address for global crypto payouts.
 *
 * GET    — Return masked wallet address (network, currency, first6…last6)
 * POST   — Add or update wallet address (auth gate if existing)
 * DELETE — Remove wallet address (blocked if payout in-flight)
 *
 * Security:
 *   - Editing or deleting an existing address requires PIN/2FA/password if set.
 *   - Address is AES-256-GCM encrypted at rest.
 *   - Tron address validation: 34 characters, starts with 'T'.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, forbidden, notFound, handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { encryptField, decryptField } from "@/lib/security/fieldEncryption";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const PostSchema = z.object({
  address: z
    .string()
    .length(34, "Tron wallet addresses must be exactly 34 characters")
    .regex(/^T/, "Tron wallet addresses must start with the letter T"),
  pinOrCode: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Auth gate helper (same logic as bank-account route)
// ---------------------------------------------------------------------------

async function verifySecurityGate(
  userId: string,
  pinOrCode: string | undefined,
  isExistingRecord: boolean
): Promise<boolean> {
  const orm = await getDb();
  const rows = await orm
    .select({
      pinHash: schema.userPins.pinHash,
      passwordHash: schema.users.passwordHash,
      totpSecret: schema.users.totpSecret,
      totpEnabled: schema.users.totpEnabled,
    })
    .from(schema.users)
    .leftJoin(schema.userPins, eq(schema.userPins.userId, schema.users.id))
    .where(eq(schema.users.id, userId))
    .limit(1);

  const row = rows[0];
  const hasPinHash = !!row?.pinHash;
  const hasPassword = !!row?.passwordHash;
  const hasTotp = !!row?.totpEnabled && !!row?.totpSecret;
  const hasAnyAuth = hasPinHash || hasPassword || hasTotp;

  if (isExistingRecord && hasAnyAuth) {
    if (!pinOrCode) {
      throw forbidden(
        hasPinHash ? "PIN required to update wallet address"
          : hasTotp ? "Authenticator code required to update wallet address"
          : "Password required to update wallet address",
        "AUTH_REQUIRED"
      );
    }

    let verified = false;

    if (hasPinHash && /^\d{4}$/.test(pinOrCode)) {
      verified = await bcrypt.compare(pinOrCode, row!.pinHash!);
    }

    if (!verified && hasPassword) {
      verified = await bcrypt.compare(pinOrCode, row!.passwordHash!);
    }

    if (!verified) {
      throw forbidden("Incorrect PIN or password", "AUTH_INVALID");
    }
  }

  return hasAnyAuth;
}

/** Mask a wallet address to show only first 6 and last 6 characters. */
function maskAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

// ---------------------------------------------------------------------------
// GET /api/creator/wallet-address
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const orm = await getDb();
    const rows = await orm
      .select({
        id: schema.creatorWalletAddresses.id,
        network: schema.creatorWalletAddresses.network,
        currency: schema.creatorWalletAddresses.currency,
        address: schema.creatorWalletAddresses.address,
        createdAt: schema.creatorWalletAddresses.createdAt,
      })
      .from(schema.creatorWalletAddresses)
      .where(eq(schema.creatorWalletAddresses.creatorId, userId))
      .limit(1);

    if (!rows[0]) {
      return NextResponse.json({ hasWallet: false });
    }

    const wallet = rows[0];
    let decryptedAddress = "";
    try {
      decryptedAddress = decryptField(wallet.address) ?? "****";
    } catch {
      decryptedAddress = "****";
    }

    return NextResponse.json({
      hasWallet: true,
      network: wallet.network,
      currency: wallet.currency,
      addressMasked: maskAddress(decryptedAddress),
      createdAt: wallet.createdAt,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/creator/wallet-address
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const userId = auth.user.sub;
    const orm = await getDb();

    const creatorRows = await orm
      .select({ isCreator: schema.users.isCreator })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!creatorRows[0]?.isCreator) {
      throw forbidden("Creator access required");
    }

    const body = await validateBody(req, PostSchema);

    const existingRows = await orm
      .select({ id: schema.creatorWalletAddresses.id })
      .from(schema.creatorWalletAddresses)
      .where(
        and(
          eq(schema.creatorWalletAddresses.creatorId, userId),
          eq(schema.creatorWalletAddresses.network, "tron")
        )
      )
      .limit(1);
    const isExisting = !!existingRows[0];

    const hasAnyAuth = await verifySecurityGate(userId, body.pinOrCode, isExisting);

    const encryptedAddress = encryptField(body.address);

    // Conflict target matches the real unique index
    // (uidx_creator_wallet_addresses_creator_network on (creator_id, network))
    // — the original raw SQL's `ON CONFLICT (creator_id)` alone did not
    // match any unique constraint on this table (Migration 0006 changed it
    // to per-(creator, network)) and would have raised "no unique or
    // exclusion constraint matching the ON CONFLICT specification".
    await orm
      .insert(schema.creatorWalletAddresses)
      .values({ creatorId: userId, network: "tron", currency: "USDT", address: encryptedAddress })
      .onConflictDoUpdate({
        target: [schema.creatorWalletAddresses.creatorId, schema.creatorWalletAddresses.network],
        set: { address: encryptedAddress, updatedAt: new Date() },
      });

    return NextResponse.json({
      success: true,
      addressMasked: maskAddress(body.address),
      network: "tron",
      currency: "USDT",
      showPinModal: !hasAnyAuth,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/creator/wallet-address
// ---------------------------------------------------------------------------

export const DELETE = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const userId = auth.user.sub;
    const body = await req.json().catch(() => ({})) as { pinOrCode?: string };
    const orm = await getDb();

    const existingRows = await orm
      .select({ id: schema.creatorWalletAddresses.id })
      .from(schema.creatorWalletAddresses)
      .where(eq(schema.creatorWalletAddresses.creatorId, userId))
      .limit(1);
    if (!existingRows[0]) {
      throw notFound("No wallet address configured");
    }

    await verifySecurityGate(userId, body.pinOrCode, true);

    const pendingRows = await orm
      .select({ id: schema.creatorPayouts.id })
      .from(schema.creatorPayouts)
      .where(
        and(
          eq(schema.creatorPayouts.creatorId, userId),
          eq(schema.creatorPayouts.payoutMethod, "crypto"),
          inArray(schema.creatorPayouts.status, ["pending", "awaiting_approval", "processing"])
        )
      )
      .limit(1);
    if (pendingRows[0]) {
      throw badRequest(
        "You cannot remove your wallet address while a crypto payout is in progress.",
        "PAYOUT_IN_PROGRESS"
      );
    }

    await orm.delete(schema.creatorWalletAddresses).where(eq(schema.creatorWalletAddresses.creatorId, userId));

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
});
