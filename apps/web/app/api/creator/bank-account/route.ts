/**
 * /api/creator/bank-account
 *
 * Manage a creator's Nigerian bank account for Paystack payouts.
 *
 * GET    — Return current bank account details (account name, last4, bank name)
 * POST   — Add or update bank account (two-phase: resolve then confirm)
 * DELETE — Remove bank account (blocked if a payout is in-flight)
 *
 * Two-phase add flow:
 *   Phase 1: POST { accountNumber, bankCode, bankName }
 *     → calls Paystack Resolve Account API
 *     → returns { requiresConfirmation: true, accountName, bankName }
 *   Phase 2: POST { accountNumber, bankCode, bankName, confirmed: true, pinOrCode? }
 *     → calls Paystack Create Transfer Recipient
 *     → upserts creator_bank_accounts
 *     → awards XP on first add (if xp_awarded = false)
 *     → returns { success: true, showPinModal: boolean }
 *
 * Security:
 *   - Editing or deleting an existing account requires PIN/2FA/password if set.
 *   - The PIN is verified inline (bcrypt compare against user_pins table).
 *   - Rate-limited to RATE_LIMITS.apiWrite.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, forbidden, notFound, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { encryptField, decryptField } from "@/lib/security/fieldEncryption";
import { resolveAccount, createTransferRecipient } from "@/lib/payments/paystack";
import { getBankByCode } from "@/lib/payments/supported-banks";
import { loadManifest } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface BankAccountRow {
  id: string;
  bank_name: string;
  bank_code: string;
  account_name: string;
  account_number_last4: string;
  recipient_code: string | null;
  xp_awarded: boolean;
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

const PhaseOneSchema = z.object({
  accountNumber: z.string().regex(/^\d{10}$/, "Account number must be exactly 10 digits"),
  bankCode: z.string().min(1, "Bank code is required"),
  bankName: z.string().min(1, "Bank name is required"),
  confirmed: z.literal(false).optional(),
  pinOrCode: z.string().optional(),
});

const PhaseTwoSchema = z.object({
  accountNumber: z.string().regex(/^\d{10}$/, "Account number must be exactly 10 digits"),
  bankCode: z.string().min(1, "Bank code is required"),
  bankName: z.string().min(1, "Bank name is required"),
  confirmed: z.literal(true),
  accountName: z.string().min(1, "Account name is required"),
  pinOrCode: z.string().optional(),
});

const PostSchema = z.union([PhaseOneSchema, PhaseTwoSchema]);

// ---------------------------------------------------------------------------
// Auth gate helper
// ---------------------------------------------------------------------------

/**
 * If the user has any security method (PIN, TOTP, password), verify the
 * provided pinOrCode before proceeding. Returns whether any auth is configured
 * (used to decide if the PIN-encouragement modal should show).
 */
async function verifySecurityGate(
  userId: string,
  pinOrCode: string | undefined,
  isExistingAccount: boolean
): Promise<boolean> {
  const { rows } = await db.query<UserPinRow>(
    `SELECT
       up.pin_hash,
       u.password_hash,
       up.totp_secret,
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

  // Only gate if the user is editing/deleting an existing account
  if (isExistingAccount && hasAnyAuth) {
    if (!pinOrCode) {
      throw forbidden(
        hasPinHash ? "PIN required to update bank account"
          : hasTotp ? "Authenticator code required to update bank account"
          : "Password required to update bank account",
        "AUTH_REQUIRED"
      );
    }

    // Try PIN first (4 digits), then TOTP (6 digits), then password
    let verified = false;

    if (hasPinHash && /^\d{4}$/.test(pinOrCode)) {
      verified = await bcrypt.compare(pinOrCode, row!.pin_hash!);
    }

    if (!verified && hasTotp && /^\d{6}$/.test(pinOrCode)) {
      verified = verifyTotp(row!.totp_secret!, pinOrCode);
    }

    if (!verified && hasPassword) {
      verified = await bcrypt.compare(pinOrCode, row!.password_hash!);
    }

    if (!verified) {
      throw forbidden("Incorrect PIN, authenticator code, or password", "AUTH_INVALID");
    }
  }

  return hasAnyAuth;
}

/** Simple TOTP verification (±1 window). */
function verifyTotp(secret: string, code: string): boolean {
  try {
    const { createHmac } = require("crypto");
    const base32Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = 0;
    let bitsLen = 0;
    const bytes: number[] = [];
    for (const c of secret.toUpperCase().replace(/=+$/, "")) {
      const val = base32Chars.indexOf(c);
      if (val === -1) continue;
      bits = (bits << 5) | val;
      bitsLen += 5;
      if (bitsLen >= 8) {
        bytes.push((bits >> (bitsLen - 8)) & 0xff);
        bitsLen -= 8;
      }
    }
    const keyBuf = Buffer.from(bytes);
    const now = Math.floor(Date.now() / 1000 / 30);
    for (const offset of [-1, 0, 1]) {
      const counter = now + offset;
      const buf = Buffer.alloc(8);
      buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
      buf.writeUInt32BE(counter >>> 0, 4);
      const hmac = createHmac("sha1", keyBuf).update(buf).digest();
      const offset2 = hmac[hmac.length - 1] & 0x0f;
      const hotp =
        (((hmac[offset2] & 0x7f) << 24) |
          ((hmac[offset2 + 1] & 0xff) << 16) |
          ((hmac[offset2 + 2] & 0xff) << 8) |
          (hmac[offset2 + 3] & 0xff)) %
        1_000_000;
      if (hotp.toString().padStart(6, "0") === code) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// GET /api/creator/bank-account
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows } = await db.query<BankAccountRow>(
      `SELECT id, bank_name, bank_code, account_name, account_number_last4,
              recipient_code, xp_awarded, created_at
       FROM creator_bank_accounts
       WHERE creator_id = $1 LIMIT 1`,
      [userId]
    );

    if (!rows[0]) {
      return NextResponse.json({ hasAccount: false });
    }

    const acc = rows[0];
    return NextResponse.json({
      hasAccount: true,
      bankName: acc.bank_name,
      bankCode: acc.bank_code,
      accountName: acc.account_name,
      accountNumberLast4: acc.account_number_last4,
      createdAt: acc.created_at,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/creator/bank-account
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const userId = auth.user.sub;

    // Must be a creator
    const { rows: creatorRows } = await db.query<{ is_creator: boolean }>(
      `SELECT is_creator FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );
    if (!creatorRows[0]?.is_creator) {
      throw forbidden("Creator access required");
    }

    const body = await validateBody(req, PostSchema);

    // Validate bank code is in our supported list
    const supportedBank = getBankByCode(body.bankCode);
    if (!supportedBank) {
      throw badRequest("Unsupported bank. Please select a bank from the supported list.", "UNSUPPORTED_BANK");
    }

    // Check if user already has a bank account (determines auth gate)
    const { rows: existingRows } = await db.query<{ id: string; xp_awarded: boolean }>(
      `SELECT id, xp_awarded FROM creator_bank_accounts WHERE creator_id = $1 LIMIT 1`,
      [userId]
    );
    const isExistingAccount = !!existingRows[0];

    // ── Phase 1: Resolve account (no auth gate yet) ──────────────────────────
    if (!body.confirmed) {
      let resolvedName: string;
      try {
        const resolved = await resolveAccount(body.accountNumber, body.bankCode);
        resolvedName = resolved.account_name;
      } catch (err) {
        throw badRequest(
          "Could not verify account. Please check the account number and try again.",
          "ACCOUNT_RESOLUTION_FAILED"
        );
      }

      return NextResponse.json({
        requiresConfirmation: true,
        accountName: resolvedName,
        bankName: body.bankName,
        accountNumberLast4: body.accountNumber.slice(-4),
      });
    }

    // ── Phase 2: Confirmed — auth gate then create recipient ─────────────────
    const hasAnyAuth = await verifySecurityGate(
      userId,
      body.pinOrCode,
      isExistingAccount
    );

    // Create Paystack Transfer Recipient
    let recipientCode: string;
    try {
      const recipient = await createTransferRecipient(
        body.accountNumber,
        body.bankCode,
        body.accountName
      );
      recipientCode = recipient.recipient_code;
    } catch {
      throw badRequest(
        "Failed to register payout account with our payment provider. Please try again.",
        "RECIPIENT_CREATION_FAILED"
      );
    }

    const encryptedAccountNumber = encryptField(body.accountNumber);
    const last4 = body.accountNumber.slice(-4);
    const isFirstAdd = !isExistingAccount;

    await db.query(
      `INSERT INTO creator_bank_accounts
         (creator_id, bank_name, bank_code, account_number, account_name,
          account_number_last4, recipient_code, xp_awarded)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)
       ON CONFLICT (creator_id) DO UPDATE
         SET bank_name = EXCLUDED.bank_name,
             bank_code = EXCLUDED.bank_code,
             account_number = EXCLUDED.account_number,
             account_name = EXCLUDED.account_name,
             account_number_last4 = EXCLUDED.account_number_last4,
             recipient_code = EXCLUDED.recipient_code,
             updated_at = NOW()`,
      [userId, body.bankName, body.bankCode, encryptedAccountNumber, body.accountName, last4, recipientCode]
    );

    // Award XP on first bank account addition
    if (isFirstAdd) {
      const manifest = await loadManifest();
      const mainXp = manifest.payouts.bankAccountFirstAddXp;
      const creatorXp = manifest.payouts.bankAccountFirstAddCreatorXp;

      await db
        .query(
          `INSERT INTO xp_ledger
             (user_id, amount, track, action, reference_id, created_at)
           VALUES ($1, $2, 'main', 'bank_account_added', $3, NOW()),
                  ($1, $4, 'creator', 'bank_account_added', $3, NOW())`,
          [userId, mainXp, `bank_account:${userId}`, creatorXp]
        )
        .catch(() => {});

      await db
        .query(
          `UPDATE users
           SET xp = xp + $1, updated_at = NOW()
           WHERE id = $2`,
          [mainXp, userId]
        )
        .catch(() => {});

      await db.query(
        `UPDATE creator_bank_accounts SET xp_awarded = TRUE WHERE creator_id = $1`,
        [userId]
      );
    }

    return NextResponse.json({
      success: true,
      bankName: body.bankName,
      accountName: body.accountName,
      accountNumberLast4: last4,
      showPinModal: !hasAnyAuth,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/creator/bank-account
// ---------------------------------------------------------------------------

export const DELETE = withAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const userId = auth.user.sub;
    const body = await req.json().catch(() => ({})) as { pinOrCode?: string };

    // Auth gate always required for delete
    const { rows: existingRows } = await db.query<{ id: string }>(
      `SELECT id FROM creator_bank_accounts WHERE creator_id = $1 LIMIT 1`,
      [userId]
    );
    if (!existingRows[0]) {
      throw notFound("No bank account configured");
    }

    await verifySecurityGate(userId, body.pinOrCode, true);

    // Block if a payout is in-flight using this account
    const { rows: pendingRows } = await db.query<{ id: string }>(
      `SELECT id FROM creator_payouts
       WHERE creator_id = $1
         AND status IN ('pending', 'awaiting_approval', 'processing')
       LIMIT 1`,
      [userId]
    );
    if (pendingRows[0]) {
      throw badRequest(
        "You cannot remove your bank account while a payout is in progress. Wait for it to complete first.",
        "PAYOUT_IN_PROGRESS"
      );
    }

    await db.query(
      `DELETE FROM creator_bank_accounts WHERE creator_id = $1`,
      [userId]
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
});
