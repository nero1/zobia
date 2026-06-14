export const dynamic = 'force-dynamic';

/**
 * /api/creator/payouts
 *
 * GET  — Returns payout history, available balance, payout config and account status
 * POST — Request a payout (bank_transfer | coins | crypto)
 *
 * Payout methods:
 *   bank_transfer — Nigeria only. Uses Paystack. Auto-processed by CRON (or manual
 *                   if nigeria_payout_auto_approve is false).
 *   coins         — All regions. Immediately converts earnings to platform coins.
 *                   No minimum threshold.
 *   crypto        — USDT/Tron. All regions. Always requires manual admin approval.
 *
 * Financial integrity:
 *   - All balance changes happen inside a single DB transaction.
 *   - One active payout per creator at a time.
 *   - Bank account snapshot stored at request time — changes to the bank account
 *     after submission do not affect in-flight payouts.
 *
 * Fraud monitoring:
 *   - New-account gift inflow check
 *   - Payout velocity check
 *   - Trust score gate
 *   → Any flag forces awaiting_approval (never blocks the creator outright).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, forbidden, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { meetsMinimumTrust } from "@/lib/trust/trustScore";
import { loadManifest } from "@/lib/manifest";
import { creditCoins } from "@/lib/economy/coins";
import { checkPayoutFraud } from "@/lib/fraud/payouts";
import { encryptField, decryptField } from "@/lib/security/fieldEncryption";
import { randomUUID } from "crypto";
import Decimal from "decimal.js";
import { requirePinVerified } from "@/lib/auth/pinGuard";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface PayoutRow {
  id: string;
  gross_kobo: number;
  net_kobo: number;
  platform_fee_kobo: number;
  status: string;
  payout_method: string;
  region: string;
  provider_reference: string | null;
  bank_account_snapshot: Record<string, string> | null;
  retry_count: number;
  appeal_status: string | null;
  created_at: string;
  completed_at: string | null;
  rejection_reason: string | null;
}

interface BankAccountRow {
  bank_name: string;
  bank_code: string;
  account_name: string;
  account_number_last4: string;
  recipient_code: string;
}

interface WalletRow {
  address: string; // encrypted
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MIN_PAYOUT_KOBO = 100_000;        // ₦1,000
const DEFAULT_MANUAL_APPROVAL_KOBO = 5_000_000; // ₦50,000

// ---------------------------------------------------------------------------
// GET /api/creator/payouts
// ---------------------------------------------------------------------------

export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows: profileRows } = await db.query<{
      is_creator: boolean;
      available_earnings_kobo: number;
      country: string | null;
    }>(
      `SELECT is_creator, available_earnings_kobo, country
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    if (!profileRows[0]?.is_creator) {
      throw forbidden("Creator access required");
    }

    const profile = profileRows[0];
    const isNigeria = (profile.country ?? "NG") === "NG";

    // Load payout config
    const manifest = await loadManifest();
    const pc = manifest.payouts;

    const payoutConfig = isNigeria
      ? {
          bankTransferEnabled: pc.enabled && pc.nigeria.cashEnabled,
          coinsEnabled: pc.enabled && pc.nigeria.coinsEnabled,
          cryptoEnabled: pc.enabled && pc.nigeria.cryptoEnabled,
          isManualMode: !pc.nigeria.autoApprove,
          region: "nigeria" as const,
        }
      : {
          bankTransferEnabled: false,
          coinsEnabled: pc.enabled && pc.global.coinsEnabled,
          cryptoEnabled: pc.enabled && pc.global.cryptoEnabled,
          isManualMode: true, // global crypto is always manual
          region: "global" as const,
        };

    // Bank account status
    const { rows: bankRows } = await db.query<{
      bank_name: string;
      account_name: string;
      account_number_last4: string;
    }>(
      `SELECT bank_name, account_name, account_number_last4
       FROM creator_bank_accounts WHERE creator_id = $1 LIMIT 1`,
      [userId]
    );

    // Wallet status
    const { rows: walletRows } = await db.query<{ has_wallet: string }>(
      `SELECT '1' AS has_wallet FROM creator_wallet_addresses WHERE creator_id = $1 LIMIT 1`,
      [userId]
    );

    // Pending payout check
    const { rows: pendingRows } = await db.query<{ id: string; payout_method: string }>(
      `SELECT id, payout_method FROM creator_payouts
       WHERE creator_id = $1 AND status IN ('pending','awaiting_approval','processing')
       LIMIT 1`,
      [userId]
    );

    // Payout history
    const { rows: payouts } = await db.query<PayoutRow>(
      `SELECT id, gross_kobo, net_kobo, platform_fee_kobo, status,
              payout_method, region, provider_reference, bank_account_snapshot,
              retry_count, appeal_status, rejection_reason, created_at, completed_at
       FROM creator_payouts
       WHERE creator_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    return NextResponse.json({
      availableEarningsKobo: profile.available_earnings_kobo ?? 0,
      payoutConfig,
      bankAccount: bankRows[0]
        ? {
            configured: true,
            bankName: bankRows[0].bank_name,
            accountName: bankRows[0].account_name,
            accountNumberLast4: bankRows[0].account_number_last4,
          }
        : { configured: false },
      walletAddress: { configured: !!walletRows[0] },
      pendingPayout: pendingRows[0]
        ? { id: pendingRows[0].id, method: pendingRows[0].payout_method }
        : null,
      payouts: payouts.map((p) => ({
        id: p.id,
        grossKobo: p.gross_kobo,
        netKobo: p.net_kobo,
        platformFeeKobo: p.platform_fee_kobo,
        status: p.status,
        method: p.payout_method,
        region: p.region,
        bankAccountLast4: p.bank_account_snapshot?.last4 ?? null,
        retryCount: p.retry_count,
        appealStatus: p.appeal_status,
        rejectionReason: p.rejection_reason,
        createdAt: p.created_at,
        completedAt: p.completed_at,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/creator/payouts
// ---------------------------------------------------------------------------

const PayoutRequestSchema = z.object({
  method: z.enum(["bank_transfer", "coins", "crypto"]),
  amountKobo: z.number().int().positive().optional(),
});

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const userId = auth.user.sub;

    // Daily rate limit to prevent payout request abuse (STRUC-09)
    await enforceRateLimit(userId, "user", RATE_LIMITS.payoutRequest);

    // Require a recent PIN verification before allowing payout initiation
    const pinOk = await requirePinVerified(userId, auth.user.sid);
    if (!pinOk) {
      return NextResponse.json(
        { error: "PIN verification required", code: "PIN_REQUIRED" },
        { status: 403 }
      );
    }

    const body = await validateBody(req, PayoutRequestSchema);

    const manifest = await loadManifest();
    const pc = manifest.payouts;

    if (!pc.enabled) {
      return NextResponse.json(
        { error: { code: "PAYOUTS_DISABLED", message: "Creator payouts are currently disabled." } },
        { status: 503 }
      );
    }

    // Load creator profile
    const { rows: profileRows } = await db.query<{
      is_creator: boolean;
      available_earnings_kobo: number;
      country: string | null;
    }>(
      `SELECT is_creator, available_earnings_kobo, country
       FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [userId]
    );

    if (!profileRows[0]?.is_creator) {
      throw forbidden("Creator access required");
    }

    const profile = profileRows[0];
    const isNigeria = (profile.country ?? "NG") === "NG";
    const region: "nigeria" | "global" = isNigeria ? "nigeria" : "global";

    // Validate method is enabled for this region
    if (body.method === "bank_transfer") {
      if (!isNigeria) throw badRequest("Bank transfers are only available for Nigerian creators.", "METHOD_NOT_AVAILABLE");
      if (!pc.nigeria.cashEnabled) throw badRequest("Bank transfer payouts are currently disabled.", "METHOD_DISABLED");
    } else if (body.method === "coins") {
      if (isNigeria && !pc.nigeria.coinsEnabled) throw badRequest("Coin payouts are currently disabled.", "METHOD_DISABLED");
      if (!isNigeria && !pc.global.coinsEnabled) throw badRequest("Coin payouts are currently disabled.", "METHOD_DISABLED");
    } else if (body.method === "crypto") {
      if (isNigeria && !pc.nigeria.cryptoEnabled) throw badRequest("Crypto payouts are currently disabled.", "METHOD_DISABLED");
      if (!isNigeria && !pc.global.cryptoEnabled) throw badRequest("Crypto payouts are currently disabled.", "METHOD_DISABLED");
    }

    // Trust gate
    const trusted = await meetsMinimumTrust(userId, "withdraw_coins", db);
    if (!trusted) {
      throw forbidden(
        "Your account trust score is too low to request a payout.",
        "TRUST_SCORE_TOO_LOW"
      );
    }

    const minPayoutKobo = pc.enabled ? manifest.payoutThresholdKobo : DEFAULT_MIN_PAYOUT_KOBO;
    const manualApprovalKobo = manifest.payoutLargeApprovalKobo ?? DEFAULT_MANUAL_APPROVAL_KOBO;

    const availableKobo = profile.available_earnings_kobo ?? 0;
    const requestedKobo = body.amountKobo ?? availableKobo;

    if (requestedKobo > availableKobo) {
      throw badRequest("Requested amount exceeds available earnings.", "INSUFFICIENT_EARNINGS");
    }

    // Coins path has no minimum
    if (body.method !== "coins" && requestedKobo < minPayoutKobo) {
      throw badRequest(
        `Minimum payout is ₦${(minPayoutKobo / 100).toFixed(2)}.`,
        "BELOW_MINIMUM_PAYOUT"
      );
    }

    // One pending payout at a time
    const { rows: pendingRows } = await db.query<{ id: string }>(
      `SELECT id FROM creator_payouts
       WHERE creator_id = $1 AND status IN ('pending','awaiting_approval','processing')
       LIMIT 1`,
      [userId]
    );
    if (pendingRows[0]) {
      throw badRequest(
        "You already have a pending payout. Wait for it to complete before requesting another.",
        "PAYOUT_PENDING"
      );
    }

    // ── Bank transfer: load and snapshot bank account ────────────────────────
    let bankAccountSnapshot: Record<string, string> | null = null;

    if (body.method === "bank_transfer") {
      const { rows: bankRows } = await db.query<BankAccountRow>(
        `SELECT bank_name, bank_code, account_name, account_number_last4, recipient_code
         FROM creator_bank_accounts WHERE creator_id = $1 LIMIT 1`,
        [userId]
      );
      if (!bankRows[0] || !bankRows[0].recipient_code) {
        throw badRequest(
          "No verified bank account found. Please add your bank account before requesting a payout.",
          "NO_BANK_ACCOUNT"
        );
      }
      bankAccountSnapshot = {
        bank_name: bankRows[0].bank_name,
        account_name: bankRows[0].account_name,
        last4: bankRows[0].account_number_last4,
        recipient_code: bankRows[0].recipient_code,
      };
    }

    // ── Crypto: snapshot wallet address ─────────────────────────────────────
    let walletAddressSnapshot: string | null = null;

    if (body.method === "crypto") {
      const { rows: walletRows } = await db.query<WalletRow>(
        `SELECT address FROM creator_wallet_addresses WHERE creator_id = $1 LIMIT 1`,
        [userId]
      );
      if (!walletRows[0]) {
        throw badRequest(
          "No USDT wallet address configured. Please add your Tron wallet address first.",
          "NO_WALLET_ADDRESS"
        );
      }
      // Store already-encrypted address as the snapshot
      walletAddressSnapshot = walletRows[0].address;
    }

    // ── Fraud check ──────────────────────────────────────────────────────────
    const fraudResult = await checkPayoutFraud(userId, requestedKobo, db);
    let requiresManualApproval =
      fraudResult.forceManual ||
      body.method === "crypto" || // crypto always manual
      (!isNigeria && body.method !== "coins") || // global non-coin always manual
      (!pc.nigeria.autoApprove && body.method === "bank_transfer") || // manual mode
      requestedKobo >= manualApprovalKobo;

    const idempotencyKey = `payout:${userId}:${randomUUID()}`;

    // ── Coins path — immediate conversion ────────────────────────────────────
    if (body.method === "coins") {
      const koboPerCoin = manifest.coinToCashRate || 100;
      const coinsToCredit = Math.floor(requestedKobo / koboPerCoin);

      if (coinsToCredit <= 0) {
        throw badRequest(
          "Earnings are too small to convert to Coins at the current rate.",
          "BELOW_MINIMUM_COIN_CONVERSION"
        );
      }

      await db.transaction(async (tx) => {
        await tx.query(
          `UPDATE users SET available_earnings_kobo = available_earnings_kobo - $1, updated_at = NOW() WHERE id = $2`,
          [requestedKobo, userId]
        );
        await tx.query(
          `INSERT INTO creator_payouts
             (creator_id, gross_kobo, net_kobo, platform_fee_kobo, payout_method, region,
              status, idempotency_key)
           VALUES ($1, $2, $2, 0, 'coins', $3, 'completed', $4)`,
          [userId, requestedKobo, region, idempotencyKey]
        );
        await creditCoins(
          userId, coinsToCredit, "creator_coin_conversion", idempotencyKey,
          `Earnings converted to ${coinsToCredit} Coins`,
          { grossKobo: requestedKobo },
          tx
        );
      });

      return NextResponse.json({
        payout: {
          idempotencyKey,
          method: "coins",
          grossKobo: requestedKobo,
          status: "completed",
          coinsAwarded: coinsToCredit,
        },
        message: `${coinsToCredit.toLocaleString()} Coins have been added to your wallet.`,
      });
    }

    // ── Bank transfer / Crypto path ──────────────────────────────────────────
    const status = requiresManualApproval ? "awaiting_approval" : "pending";

    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE users
         SET available_earnings_kobo = available_earnings_kobo - $1, updated_at = NOW()
         WHERE id = $2`,
        [requestedKobo, userId]
      );

      await tx.query(
        `INSERT INTO creator_payouts
           (creator_id, gross_kobo, net_kobo, platform_fee_kobo, payout_method, region,
            status, idempotency_key, bank_account_snapshot, wallet_address_snapshot)
         VALUES ($1, $2, $2, 0, $3, $4, $5, $6, $7::jsonb, $8)`,
        [
          userId,
          requestedKobo,
          body.method,
          region,
          status,
          idempotencyKey,
          bankAccountSnapshot ? JSON.stringify(bankAccountSnapshot) : null,
          walletAddressSnapshot,
        ]
      );
    });

    const { rows: newRows } = await db.query<{ id: string }>(
      `SELECT id FROM creator_payouts WHERE idempotency_key = $1 LIMIT 1`,
      [idempotencyKey]
    );

    return NextResponse.json({
      payout: {
        id: newRows[0]?.id,
        method: body.method,
        grossKobo: requestedKobo,
        status,
        requiresManualApproval,
        fraudFlagged: fraudResult.isSuspicious,
      },
      message: requiresManualApproval
        ? body.method === "crypto"
          ? "Your crypto payout request has been submitted. Admin will process it manually."
          : fraudResult.isSuspicious
            ? "Your payout has been flagged for review and will be processed after admin approval."
            : "Your payout is pending admin approval. You'll be notified when it's processed."
        : "Payout queued. Funds will be processed in the next batch (within 30 minutes).",
    });
  } catch (err) {
    return handleApiError(err);
  }
});
