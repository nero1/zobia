export const dynamic = 'force-dynamic';

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
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, forbidden, notFound, handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { encryptField, decryptField } from "@/lib/security/fieldEncryption";
import { verifyTotp } from "@/lib/auth/totp";
import { redis } from "@/lib/redis";
import { resolveAccount, createTransferRecipient } from "@/lib/payments/paystack";
import { getBankByCode } from "@/lib/payments/supported-banks";
import { loadManifest } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------


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
      verified = await bcrypt.compare(pinOrCode, row!.pinHash!);
    }

    if (!verified && hasTotp && /^\d{6}$/.test(pinOrCode)) {
      // Decrypt the stored AES-256-GCM secret before TOTP verification (B-02)
      const plainSecret = decryptField(row!.totpSecret!);
      if (plainSecret && verifyTotp(plainSecret, pinOrCode)) {
        // Anti-replay: atomically mark this TOTP code as used for 90 seconds (BUG-AUTH-03)
        const replayKey = `totp:used:${userId}:${pinOrCode}`;
        const marked = await redis.set(replayKey, "1", "EX", 90, "NX");
        if (marked === null) {
          throw forbidden("Authenticator code already used. Please wait for a new code.", "TOTP_REPLAY");
        }
        verified = true;
      }
    }

    if (!verified && hasPassword) {
      verified = await bcrypt.compare(pinOrCode, row!.passwordHash!);
    }

    if (!verified) {
      throw forbidden("Incorrect PIN, authenticator code, or password", "AUTH_INVALID");
    }
  }

  return hasAnyAuth;
}

// ---------------------------------------------------------------------------
// GET /api/creator/bank-account
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const orm = await getDb();
    const rows = await orm
      .select({
        id: schema.creatorBankAccounts.id,
        bankName: schema.creatorBankAccounts.bankName,
        bankCode: schema.creatorBankAccounts.bankCode,
        accountName: schema.creatorBankAccounts.accountName,
        accountNumberLast4: schema.creatorBankAccounts.accountNumberLast4,
        recipientCode: schema.creatorBankAccounts.recipientCode,
        xpAwarded: schema.creatorBankAccounts.xpAwarded,
        createdAt: schema.creatorBankAccounts.createdAt,
      })
      .from(schema.creatorBankAccounts)
      .where(eq(schema.creatorBankAccounts.creatorId, userId))
      .limit(1);

    if (!rows[0]) {
      return NextResponse.json({ hasAccount: false });
    }

    const acc = rows[0];
    return NextResponse.json({
      hasAccount: true,
      bankName: acc.bankName,
      bankCode: acc.bankCode,
      accountName: acc.accountName,
      accountNumberLast4: acc.accountNumberLast4,
      createdAt: acc.createdAt,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/creator/bank-account
// ---------------------------------------------------------------------------

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const userId = auth.user.sub;
    const orm = await getDb();

    // Must be a creator
    const creatorRows = await orm
      .select({ isCreator: schema.users.isCreator })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!creatorRows[0]?.isCreator) {
      throw forbidden("Creator access required");
    }

    const body = await validateBody(req, PostSchema);

    // Validate bank code is in our supported list
    const supportedBank = getBankByCode(body.bankCode);
    if (!supportedBank) {
      throw badRequest("Unsupported bank. Please select a bank from the supported list.", "UNSUPPORTED_BANK");
    }

    // Check if user already has a bank account (determines auth gate)
    const existingRows = await orm
      .select({ id: schema.creatorBankAccounts.id, xpAwarded: schema.creatorBankAccounts.xpAwarded })
      .from(schema.creatorBankAccounts)
      .where(eq(schema.creatorBankAccounts.creatorId, userId))
      .limit(1);
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

    // NOTE (schema mismatch): `is_encrypted` exists on the real
    // creator_bank_accounts table (db/migrations/0001_consolidated_schema.sql)
    // but is missing from the Drizzle table definition in lib/db/schema.ts —
    // it is written here via a raw `sql` template until that's added
    // upstream. Also: the original `ON CONFLICT (creator_id) DO UPDATE` here
    // referenced a unique constraint that no longer exists on this table
    // (SCHEMA-BANK-01 replaced it with a *partial* unique index on
    // (creator_id) WHERE is_primary = TRUE AND deleted_at IS NULL) — that
    // statement would raise "no unique or exclusion constraint matching the
    // ON CONFLICT specification" at runtime. Replaced with an explicit
    // check-then-write (using the `existingRows` lookup above) instead.
    if (isExistingAccount) {
      await orm.execute(sql`
        UPDATE creator_bank_accounts
        SET bank_name = ${body.bankName},
            bank_code = ${body.bankCode},
            account_number = ${encryptedAccountNumber},
            is_encrypted = TRUE,
            account_name = ${body.accountName},
            account_number_last4 = ${last4},
            recipient_code = ${recipientCode},
            updated_at = NOW()
        WHERE creator_id = ${userId}
      `);
    } else {
      await orm.execute(sql`
        INSERT INTO creator_bank_accounts
          (creator_id, bank_name, bank_code, account_number, is_encrypted, account_name,
           account_number_last4, recipient_code, xp_awarded)
        VALUES (${userId}, ${body.bankName}, ${body.bankCode}, ${encryptedAccountNumber}, TRUE,
                ${body.accountName}, ${last4}, ${recipientCode}, FALSE)
      `);
    }

    // Award XP on first bank account addition
    if (isFirstAdd) {
      const manifest = await loadManifest();
      const mainXp = manifest.payouts.bankAccountFirstAddXp;
      const creatorXp = manifest.payouts.bankAccountFirstAddCreatorXp;
      const xpReferenceId = `bank_account:${userId}`;

      await orm
        .insert(schema.xpLedger)
        .values([
          { userId, amount: mainXp, baseAmount: mainXp, track: "main", source: "bank_account_added", referenceId: xpReferenceId },
          { userId, amount: creatorXp, baseAmount: creatorXp, track: "creator", source: "bank_account_added", referenceId: xpReferenceId },
        ])
        .catch(() => {});

      await orm
        .update(schema.users)
        .set({ xpTotal: sql`${schema.users.xpTotal} + ${mainXp}`, updatedAt: new Date() })
        .where(eq(schema.users.id, userId))
        .catch(() => {});

      await orm
        .update(schema.creatorBankAccounts)
        .set({ xpAwarded: true })
        .where(eq(schema.creatorBankAccounts.creatorId, userId));
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

export const DELETE = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);

    const userId = auth.user.sub;
    const body = await req.json().catch(() => ({})) as { pinOrCode?: string };
    const orm = await getDb();

    // Auth gate always required for delete
    const existingRows = await orm
      .select({ id: schema.creatorBankAccounts.id })
      .from(schema.creatorBankAccounts)
      .where(eq(schema.creatorBankAccounts.creatorId, userId))
      .limit(1);
    if (!existingRows[0]) {
      throw notFound("No bank account configured");
    }

    await verifySecurityGate(userId, body.pinOrCode, true);

    // Block if a payout is in-flight using this account
    const pendingRows = await orm
      .select({ id: schema.creatorPayouts.id })
      .from(schema.creatorPayouts)
      .where(
        and(
          eq(schema.creatorPayouts.creatorId, userId),
          inArray(schema.creatorPayouts.status, ["pending", "awaiting_approval", "processing"])
        )
      )
      .limit(1);
    if (pendingRows[0]) {
      throw badRequest(
        "You cannot remove your bank account while a payout is in progress. Wait for it to complete first.",
        "PAYOUT_IN_PROGRESS"
      );
    }

    await orm.delete(schema.creatorBankAccounts).where(eq(schema.creatorBankAccounts.creatorId, userId));

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError(err);
  }
});
