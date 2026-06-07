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
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, forbidden, notFound, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { encryptField, decryptField } from "@/lib/security/fieldEncryption";

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface WalletRow {
  id: string;
  network: string;
  currency: string;
  address: string; // encrypted
  created_at: string;
}

interface UserPinRow {
  pin_hash: string | null;
  password_hash: string | null;
  totp_secret: string | null;
  totp_enabled: boolean;
}

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
  const { rows } = await db.query<UserPinRow>(
    `SELECT up.pin_hash, u.password_hash, up.totp_secret,
            COALESCE(up.totp_enabled, false) AS totp_enabled
     FROM users u
     LEFT JOIN user_pins up ON up.user_id = u.id
     WHERE u.id = $1 LIMIT 1`,
    [userId]
  );

  const row = rows[0];
  const hasPinHash = !!row?.pin_hash;
  const hasPassword = !!row?.password_hash;
  const hasTotp = !!row?.totp_enabled && !!row?.totp_secret;
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
      verified = await bcrypt.compare(pinOrCode, row!.pin_hash!);
    }

    if (!verified && hasPassword) {
      verified = await bcrypt.compare(pinOrCode, row!.password_hash!);
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

    const { rows } = await db.query<WalletRow>(
      `SELECT id, network, currency, address, created_at
       FROM creator_wallet_addresses
       WHERE creator_id = $1 LIMIT 1`,
      [userId]
    );

    if (!rows[0]) {
      return NextResponse.json({ hasWallet: false });
    }

    const wallet = rows[0];
    let decryptedAddress = "";
    try {
      decryptedAddress = decryptField(wallet.address);
    } catch {
      decryptedAddress = "****";
    }

    return NextResponse.json({
      hasWallet: true,
      network: wallet.network,
      currency: wallet.currency,
      addressMasked: maskAddress(decryptedAddress),
      createdAt: wallet.created_at,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/creator/wallet-address
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const userId = auth.user.sub;

    const { rows: creatorRows } = await db.query<{ is_creator: boolean }>(
      `SELECT is_creator FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    if (!creatorRows[0]?.is_creator) {
      throw forbidden("Creator access required");
    }

    const body = await validateBody(req, PostSchema);

    const { rows: existingRows } = await db.query<{ id: string }>(
      `SELECT id FROM creator_wallet_addresses WHERE creator_id = $1 LIMIT 1`,
      [userId]
    );
    const isExisting = !!existingRows[0];

    const hasAnyAuth = await verifySecurityGate(userId, body.pinOrCode, isExisting);

    const encryptedAddress = encryptField(body.address);

    await db.query(
      `INSERT INTO creator_wallet_addresses (creator_id, network, currency, address)
       VALUES ($1, 'tron', 'USDT', $2)
       ON CONFLICT (creator_id) DO UPDATE
         SET address = EXCLUDED.address,
             updated_at = NOW()`,
      [userId, encryptedAddress]
    );

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

export const DELETE = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const userId = auth.user.sub;
    const body = await req.json().catch(() => ({})) as { pinOrCode?: string };

    const { rows: existingRows } = await db.query<{ id: string }>(
      `SELECT id FROM creator_wallet_addresses WHERE creator_id = $1 LIMIT 1`,
      [userId]
    );
    if (!existingRows[0]) {
      throw notFound("No wallet address configured");
    }

    await verifySecurityGate(userId, body.pinOrCode, true);

    const { rows: pendingRows } = await db.query<{ id: string }>(
      `SELECT id FROM creator_payouts
       WHERE creator_id = $1
         AND payout_method = 'crypto'
         AND status IN ('pending', 'awaiting_approval', 'processing')
       LIMIT 1`,
      [userId]
    );
    if (pendingRows[0]) {
      throw badRequest(
        "You cannot remove your wallet address while a crypto payout is in progress.",
        "PAYOUT_IN_PROGRESS"
      );
    }

    await db.query(
      `DELETE FROM creator_wallet_addresses WHERE creator_id = $1`,
      [userId]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
});
