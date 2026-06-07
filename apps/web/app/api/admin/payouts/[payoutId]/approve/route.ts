/**
 * POST /api/admin/payouts/[payoutId]/approve
 *
 * Admin: approve an awaiting_approval payout.
 *
 * For bank_transfer payouts (Nigeria):
 *   - Sets status to 'pending' so the CRON batch processor picks it up.
 *   - Uses recipient_code from bank_account_snapshot (not current account).
 *
 * For crypto payouts:
 *   - Sets status to 'processing' (admin manually sends USDT externally).
 *   - Wallet address is available in the response for admin reference.
 *
 * For coins payouts:
 *   - Should not reach awaiting_approval; handled at request time. Reject if seen.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAdminAuth } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { db } from "@/lib/db";
import { decryptField } from "@/lib/security/fieldEncryption";

interface PayoutRow {
  id: string;
  creator_id: string;
  net_kobo: number;
  gross_kobo: number;
  status: string;
  payout_method: string;
  idempotency_key: string;
  bank_account_snapshot: Record<string, string> | null;
  wallet_address_snapshot: string | null;
}

export const POST = withAdminAuth(
  async (
    _req: NextRequest,
    { params, auth }: { params: { payoutId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { payoutId } = params;
      const adminId = auth.user.sub;

      const { rows } = await db.query<PayoutRow>(
        `SELECT id, creator_id, net_kobo, gross_kobo, status, payout_method,
                idempotency_key, bank_account_snapshot, wallet_address_snapshot
         FROM creator_payouts WHERE id = $1 LIMIT 1`,
        [payoutId]
      );

      if (!rows[0]) throw notFound("Payout not found");

      const payout = rows[0];

      if (payout.status !== "awaiting_approval") {
        throw badRequest(`Cannot approve a payout in status: ${payout.status}`);
      }

      // Block for banned users
      const { rows: userRows } = await db.query<{ is_banned: boolean }>(
        `SELECT COALESCE(is_banned, false) AS is_banned FROM users WHERE id = $1`,
        [payout.creator_id]
      );
      if (userRows[0]?.is_banned) {
        throw badRequest("Cannot approve payout for a banned user");
      }

      let newStatus: string;
      let walletAddressMasked: string | undefined;

      if (payout.payout_method === "bank_transfer") {
        const snapshot = payout.bank_account_snapshot;
        if (!snapshot?.recipient_code) {
          throw badRequest(
            "Payout has no bank account snapshot. Cannot process.",
            "MISSING_SNAPSHOT"
          );
        }
        // Set to 'pending' — CRON will pick up and send via Paystack
        newStatus = "pending";
      } else if (payout.payout_method === "crypto") {
        // Admin sends USDT manually — provide wallet address for reference
        if (payout.wallet_address_snapshot) {
          try {
            const addr = decryptField(payout.wallet_address_snapshot);
            walletAddressMasked = addr; // full address shown to admin for sending
          } catch {
            walletAddressMasked = "Could not decrypt address";
          }
        }
        newStatus = "processing";
      } else {
        throw badRequest("Unexpected payout method for manual approval");
      }

      await db.query(
        `UPDATE creator_payouts
         SET status = $1,
             approved_at = NOW(),
             updated_at = NOW()
         WHERE id = $2`,
        [newStatus, payoutId]
      );

      // Audit log
      await db
        .query(
          `INSERT INTO admin_audit_log
             (admin_id, action, resource, resource_id, after_val, created_at)
           VALUES ($1, 'payout_approved', 'creator_payouts', $2, $3::jsonb, NOW())`,
          [
            adminId,
            payoutId,
            JSON.stringify({ newStatus, method: payout.payout_method, grossKobo: payout.gross_kobo }),
          ]
        )
        .catch(() => {});

      // Notify creator
      await db
        .query(
          `INSERT INTO notifications
             (user_id, type, title, body, metadata, created_at)
           VALUES ($1, 'payout_approved', 'Payout Approved',
             'Your payout request has been approved and is being processed.',
             $2::jsonb, NOW())`,
          [payout.creator_id, JSON.stringify({ payoutId })]
        )
        .catch(() => {});

      return NextResponse.json({
        success: true,
        payoutId,
        status: newStatus,
        method: payout.payout_method,
        ...(walletAddressMasked ? { walletAddress: walletAddressMasked } : {}),
        message:
          payout.payout_method === "crypto"
            ? `Please send ₦${(payout.net_kobo / 100).toFixed(2)} equivalent in USDT to the wallet address above, then mark as completed.`
            : "Payout queued for next batch run.",
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
