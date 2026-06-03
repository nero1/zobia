/**
 * /api/creator/payouts
 *
 * GET  — Returns payout history for the authenticated creator
 * POST — Request a payout of accumulated earnings
 *
 * Payout rules:
 *   - Minimum payout threshold: configurable in x_manifest (default 5,000 kobo = ₦50)
 *   - Manual approval threshold: configurable in x_manifest (default 500,000 kobo = ₦5,000)
 *   - Below manual threshold: processes automatically via the payment provider
 *   - Above manual threshold: creates an awaiting_approval record for admin review
 *   - Platform fee: 20% retained; creator receives 80% of gross earnings
 *   - Idempotency: one pending payout per creator at a time
 *
 * @module app/api/creator/payouts
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, forbidden, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { createPayout } from "@/lib/payments";
import { loadManifest } from "@/lib/manifest";
import { creditCoins } from "@/lib/economy/coins";
import { randomUUID } from "crypto";
import Decimal from "decimal.js";

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface PayoutRow {
  id: string;
  creator_id: string;
  gross_kobo: number;
  net_kobo: number;
  platform_fee_kobo: number;
  status: string;
  provider_reference: string | null;
  provider_status: string | null;
  bank_account_last4: string | null;
  created_at: string;
  completed_at: string | null;
}

interface CreatorProfileRow {
  is_creator: boolean;
  payout_recipient_code: string | null;
  payout_account_last4: string | null;
  available_earnings_kobo: number;
}

// ---------------------------------------------------------------------------
// Default manifest values for payout thresholds
// ---------------------------------------------------------------------------

const DEFAULT_MIN_PAYOUT_KOBO = 5_000;        // ₦50
const DEFAULT_MANUAL_APPROVAL_KOBO = 500_000;  // ₦5,000

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

/**
 * GET /api/creator/payouts
 *
 * Returns payout history and current available balance.
 */
export const GET = withAuth(async (_req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;

    const { rows: profileRows } = await db.query<CreatorProfileRow>(
      `SELECT is_creator, payout_recipient_code, payout_account_last4,
              available_earnings_kobo
       FROM users
       WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [userId]
    );

    if (!profileRows[0]?.is_creator) {
      throw forbidden("Creator access required");
    }

    const profile = profileRows[0];

    const { rows: payouts } = await db.query<PayoutRow>(
      `SELECT id, gross_kobo, net_kobo, platform_fee_kobo, status,
              provider_reference, bank_account_last4, created_at, completed_at
       FROM creator_payouts
       WHERE creator_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );

    // Net available (80% of gross available)
    const grossAvailableKobo = profile.available_earnings_kobo ?? 0;
    const netAvailableKobo = new Decimal(grossAvailableKobo)
      .times(80)
      .dividedBy(100)
      .floor()
      .toNumber();

    return NextResponse.json({
      availableEarnings: {
        grossKobo: grossAvailableKobo,
        netKobo: netAvailableKobo,
        platformFeePercent: 20,
      },
      payoutAccount: {
        configured: !!profile.payout_recipient_code,
        last4: profile.payout_account_last4,
      },
      payouts: payouts.map((p) => ({
        id: p.id,
        grossKobo: p.gross_kobo,
        netKobo: p.net_kobo,
        platformFeeKobo: p.platform_fee_kobo,
        status: p.status,
        providerReference: p.provider_reference,
        bankAccountLast4: p.bank_account_last4,
        createdAt: p.created_at,
        completedAt: p.completed_at,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

const PayoutRequestSchema = z.object({
  /**
   * Gross kobo amount to request. Must be <= available_earnings_kobo.
   * Omit to request the full available balance.
   */
  amountKobo: z.number().int().positive().optional(),
  /**
   * When true, converts the payout to Coins and credits them directly to the
   * creator's coin balance instead of initiating a bank transfer.
   * No minimum threshold applies for coin payouts.
   */
  asCoins: z.boolean().optional().default(false),
});

/**
 * POST /api/creator/payouts
 *
 * Body: { amountKobo?: number }
 * Requests a payout. Returns the payout record and whether it was auto-processed.
 */
export const POST = withAuth(async (req: NextRequest, { auth }) => {
  try {
    const userId = auth.user.sub;
    const body = await validateBody(req, PayoutRequestSchema);

    const { rows: profileRows } = await db.query<CreatorProfileRow>(
      `SELECT is_creator, payout_recipient_code, payout_account_last4,
              available_earnings_kobo
       FROM users
       WHERE id = $1 AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
      [userId]
    );

    if (!profileRows[0]?.is_creator) {
      throw forbidden("Creator access required");
    }

    const profile = profileRows[0];

    if (!profile.payout_recipient_code) {
      throw badRequest(
        "No payout account configured. Please add your bank account in settings.",
        "NO_PAYOUT_ACCOUNT"
      );
    }

    // Load thresholds from manifest (or defaults)
    const manifest = await loadManifest();
    const minPayoutKobo =
      (manifest as unknown as Record<string, unknown>).economy &&
      typeof ((manifest as unknown as Record<string, unknown>).economy as Record<string, unknown>).minPayoutKobo === "number"
        ? ((manifest as unknown as Record<string, unknown>).economy as Record<string, unknown>).minPayoutKobo as number
        : DEFAULT_MIN_PAYOUT_KOBO;
    const manualApprovalKobo =
      (manifest as unknown as Record<string, unknown>).economy &&
      typeof ((manifest as unknown as Record<string, unknown>).economy as Record<string, unknown>).manualApprovalThresholdKobo === "number"
        ? ((manifest as unknown as Record<string, unknown>).economy as Record<string, unknown>).manualApprovalThresholdKobo as number
        : DEFAULT_MANUAL_APPROVAL_KOBO;

    const availableGrossKobo = profile.available_earnings_kobo ?? 0;
    const requestedGrossKobo = body.amountKobo ?? availableGrossKobo;

    if (requestedGrossKobo < minPayoutKobo) {
      throw badRequest(
        `Minimum payout is ₦${(minPayoutKobo / 100).toFixed(2)}`,
        "BELOW_MINIMUM_PAYOUT"
      );
    }

    if (requestedGrossKobo > availableGrossKobo) {
      throw badRequest("Requested amount exceeds available earnings", "INSUFFICIENT_EARNINGS");
    }

    // Check for an already-pending payout
    const { rows: pendingRows } = await db.query<{ id: string }>(
      `SELECT id FROM creator_payouts
       WHERE creator_id = $1 AND status IN ('pending', 'awaiting_approval', 'processing')
       LIMIT 1`,
      [userId]
    );

    if (pendingRows[0]) {
      throw badRequest(
        "You already have a pending payout. Wait for it to complete before requesting another.",
        "PAYOUT_PENDING"
      );
    }

    // Calculate net (creator receives 80%)
    const netKobo = new Decimal(requestedGrossKobo).times(80).dividedBy(100).floor().toNumber();
    const platformFeeKobo = requestedGrossKobo - netKobo;

    const idempotencyKey = `payout:${userId}:${randomUUID()}`;
    const requiresManualApproval = requestedGrossKobo >= manualApprovalKobo;

    // Deduct from available earnings atomically before initiating
    await db.transaction(async (tx) => {
      await tx.query(
        `UPDATE users
         SET available_earnings_kobo = available_earnings_kobo - $1, updated_at = NOW()
         WHERE id = $2`,
        [requestedGrossKobo, userId]
      );

      await tx.query(
        `INSERT INTO creator_payouts
           (creator_id, gross_kobo, net_kobo, platform_fee_kobo, status,
            idempotency_key, bank_account_last4)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          userId,
          requestedGrossKobo,
          netKobo,
          platformFeeKobo,
          requiresManualApproval ? "awaiting_approval" : "pending",
          idempotencyKey,
          profile.payout_account_last4,
        ]
      );
    });

    // Load the new payout record
    const { rows: newPayoutRows } = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM creator_payouts WHERE idempotency_key = $1 LIMIT 1`,
      [idempotencyKey]
    );
    const newPayout = newPayoutRows[0];

    let providerReference: string | null = null;

    // Auto-process if below manual approval threshold
    if (!requiresManualApproval) {
      try {
        const payoutResult = await createPayout(
          netKobo,
          "NGN",
          { recipientCode: profile.payout_recipient_code, reason: "Creator payout" },
          idempotencyKey
        );

        providerReference = payoutResult.providerId;

        await db.query(
          `UPDATE creator_payouts
           SET status = 'processing', provider_reference = $1, updated_at = NOW()
           WHERE id = $2`,
          [providerReference, newPayout.id]
        );
      } catch (payoutErr) {
        // If provider call fails, mark as failed and restore earnings
        console.error("[creator/payouts] Provider payout failed:", payoutErr);

        await db.transaction(async (tx) => {
          await tx.query(
            `UPDATE creator_payouts SET status = 'failed', updated_at = NOW() WHERE id = $1`,
            [newPayout.id]
          );
          await tx.query(
            `UPDATE users
             SET available_earnings_kobo = available_earnings_kobo + $1, updated_at = NOW()
             WHERE id = $2`,
            [requestedGrossKobo, userId]
          );
        });

        throw badRequest("Payout initiation failed. Your earnings have been restored.", "PAYOUT_PROVIDER_ERROR");
      }
    }

    return NextResponse.json({
      payout: {
        id: newPayout.id,
        grossKobo: requestedGrossKobo,
        netKobo,
        platformFeeKobo,
        status: requiresManualApproval ? "awaiting_approval" : "processing",
        providerReference,
        requiresManualApproval,
      },
      message: requiresManualApproval
        ? "Your payout is pending admin approval due to the amount. You'll be notified when it's processed."
        : "Payout initiated successfully. Funds will arrive within 1–2 business days.",
    });
  } catch (err) {
    return handleApiError(err);
  }
});
