export const dynamic = 'force-dynamic';

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
import { and, eq, isNull, sql } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { decryptField } from "@/lib/security/fieldEncryption";

export const POST = withAdminAuth(
  async (
    _req: NextRequest,
    { params, auth }: { params: { payoutId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { payoutId } = params;
      const adminId = auth.user.sub;

      const orm = await getDb();

      const [payout] = await orm
        .select({
          id: schema.creatorPayouts.id,
          creator_id: schema.creatorPayouts.creatorId,
          net_kobo: schema.creatorPayouts.netKobo,
          gross_kobo: schema.creatorPayouts.grossKobo,
          status: schema.creatorPayouts.status,
          payout_method: schema.creatorPayouts.payoutMethod,
          idempotency_key: schema.creatorPayouts.idempotencyKey,
          bank_account_snapshot: schema.creatorPayouts.bankAccountSnapshot,
          wallet_address_snapshot: schema.creatorPayouts.walletAddressSnapshot,
        })
        .from(schema.creatorPayouts)
        .where(eq(schema.creatorPayouts.id, payoutId))
        .limit(1);

      if (!payout) throw notFound("Payout not found");

      if (payout.status !== "awaiting_approval") {
        throw badRequest(`Cannot approve a payout in status: ${payout.status}`);
      }

      // Block for banned or deleted users
      const [userRow] = await orm
        .select({ is_banned: sql<boolean>`COALESCE(${schema.users.isBanned}, false)` })
        .from(schema.users)
        .where(and(eq(schema.users.id, payout.creator_id), isNull(schema.users.deletedAt)))
        .limit(1);
      if (!userRow) {
        throw badRequest("Cannot approve payout: creator account not found or deleted", "USER_NOT_FOUND");
      }
      if (userRow.is_banned) {
        throw badRequest("Cannot approve payout for a banned user");
      }

      let newStatus: string;
      let walletAddressMasked: string | undefined;

      if (payout.payout_method === "bank_transfer") {
        const snapshot = payout.bank_account_snapshot as Record<string, string> | null;
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
            walletAddressMasked = addr ?? "Could not decrypt address"; // full address shown to admin for sending
          } catch {
            walletAddressMasked = "Could not decrypt address";
          }
        }
        newStatus = "processing";
      } else {
        throw badRequest("Unexpected payout method for manual approval");
      }

      await orm
        .update(schema.creatorPayouts)
        .set({ status: newStatus, approvedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.creatorPayouts.id, payoutId));

      // Audit log
      await orm
        .insert(schema.adminAuditLog)
        .values({
          adminId,
          action: "payout_approved",
          resource: "creator_payouts",
          resourceId: payoutId,
          afterVal: { newStatus, method: payout.payout_method, grossKobo: payout.gross_kobo?.toString() ?? null },
        })
        .catch(() => {});

      // Notify creator
      await orm
        .insert(schema.notifications)
        .values({
          userId: payout.creator_id,
          type: "payout_approved",
          title: "Payout Approved",
          body: "Your payout request has been approved and is being processed.",
          metadata: { payoutId },
        })
        .catch(() => {});

      return NextResponse.json({
        success: true,
        payoutId,
        status: newStatus,
        method: payout.payout_method,
        ...(walletAddressMasked ? { walletAddress: walletAddressMasked } : {}),
        message:
          payout.payout_method === "crypto"
            ? `Please send ₦${(Number(payout.net_kobo ?? BigInt(0)) / 100).toFixed(2)} equivalent in USDT to the wallet address above, then mark as completed.`
            : "Payout queued for next batch run.",
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
