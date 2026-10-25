import {verifyNativePayoutTransfer,cryptoPayoutFingerprint} from "@/lib/payments/crypto/payoutProof";
import {restorePayoutReservation} from "@/lib/payments/payoutAccounting";
export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/payouts/[payoutId]/status
 *
 * Admin: manually update the status of a payout.
 *
 * Used for:
 *   - Manual Nigeria mode: marking bank_transfer payouts as processing/completed/failed
 *   - All global (non-Nigeria) payouts: admin manually sends funds and marks complete
 *   - Crypto payouts: admin manually sends USDT and marks complete
 *
 * Allowed transitions from current status:
 *   awaiting_approval → processing, cancelled
 *   processing        → completed, failed
 *   failed            → processing (re-attempt after fixing)
 *
 * On 'completed': creator receives in-app notification.
 * On 'failed':    earnings restored to creator; notification sent.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, notFound, handleApiError } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";

const StatusSchema = z.object({
  status: z.enum(["processing", "completed", "failed", "cancelled"]),
  note: z.string().max(500).optional(),
  txHash:z.string().max(100).optional(),
});

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  awaiting_approval: ["processing", "cancelled"],
  processing: ["completed", "failed"],
  failed: [],
  pending: ["processing", "completed", "failed", "cancelled"],
};

export const PATCH = withAdminAuth(
  async (
    req: NextRequest,
    { params, auth }: { params: { payoutId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { payoutId } = params;
      const adminId = auth.user.sub;
      const body = await validateBody(req, StatusSchema);

      const orm = await getDb();

      const proof=body.status==="completed" ? await verifyNativePayoutTransfer(payoutId,body.txHash??"") : null;
      const payout = await orm.transaction(async(tx)=>{
      const [payout] = await tx
        .select({
          id: schema.creatorPayouts.id,
          creator_id: schema.creatorPayouts.creatorId,
          gross_kobo: schema.creatorPayouts.grossKobo,
          net_kobo: schema.creatorPayouts.netKobo,
          status: schema.creatorPayouts.status,
          payout_method: schema.creatorPayouts.payoutMethod,
          earnings_restored: schema.creatorPayouts.earningsRestored,
          cryptoCurrency:schema.creatorPayouts.cryptoCurrency,cryptoChain:schema.creatorPayouts.cryptoChain,
          cryptoAmountBaseUnits:schema.creatorPayouts.cryptoAmountBaseUnits,walletAddressSnapshot:schema.creatorPayouts.walletAddressSnapshot,createdAt:schema.creatorPayouts.createdAt,
        })
        .from(schema.creatorPayouts)
        .where(eq(schema.creatorPayouts.id, payoutId))
        .limit(1).for("update");

      if (!payout) throw notFound("Payout not found");
      if(payout.payout_method==="coins" && body.status!=="cancelled")throw badRequest("Use approval or rejection to resolve a reviewed coin conversion", "PAYOUT_REVIEW_REQUIRED");
      if(payout.earnings_restored)throw badRequest("This payout has already been refunded. Create a newly funded payout to retry.","PAYOUT_ALREADY_REFUNDED");

      const grossKobo = payout.gross_kobo ?? BigInt(0);
      const netKobo = payout.net_kobo ?? BigInt(0);
      const allowed = ALLOWED_TRANSITIONS[payout.status] ?? [];

      if (!allowed.includes(body.status)) {
        throw badRequest(
          `Cannot transition from '${payout.status}' to '${body.status}'.`,
          "INVALID_TRANSITION"
        );
      }

      {
        if(body.status==="completed" && payout.cryptoAmountBaseUnits!==null){
          const fingerprint=cryptoPayoutFingerprint({id:payout.id,cryptoCurrency:payout.cryptoCurrency,cryptoChain:payout.cryptoChain,cryptoAmountBaseUnits:payout.cryptoAmountBaseUnits,walletAddressSnapshot:payout.walletAddressSnapshot,createdAt:payout.createdAt});
          if(!proof || proof.fingerprint!==fingerprint)throw badRequest("Payout details changed; verify the transaction again","PAYOUT_CHANGED");
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${proof.chain}:${proof.hash}`},13))`);
          const used=await tx.execute(sql`SELECT id FROM creator_payouts WHERE crypto_chain=${proof.chain} AND crypto_tx_hash=${proof.hash} AND id<>${payoutId}::uuid LIMIT 1`);
          if(used.rows.length)throw badRequest("This transaction already settled another payout","PAYOUT_PROOF_REPLAY");
        }
        const setValues: Partial<typeof schema.creatorPayouts.$inferInsert> = {
          status: body.status,
          updatedAt: new Date(),
        };
        if (body.status === "completed") {
          setValues.completedAt = new Date();
          if(proof)setValues.cryptoTxHash=proof.hash;
        }
        if (body.note) {
          setValues.rejectionReason = body.note;
        }

        await tx.update(schema.creatorPayouts).set(setValues).where(eq(schema.creatorPayouts.id, payoutId));

        // Restore earnings on failure or cancellation
        if (body.status === "failed" || body.status === "cancelled") {
          await restorePayoutReservation(tx,payoutId);
        }
      }
      return payout;
      });
      const grossKobo=payout.gross_kobo??BigInt(0);
      const netKobo=payout.net_kobo??BigInt(0);

      // Audit log
      await orm
        .insert(schema.adminAuditLog)
        .values({
          adminId,
          action: "payout_status_updated",
          resource: "creator_payouts",
          resourceId: payoutId,
          afterVal: {
            fromStatus: payout.status,
            toStatus: body.status,
            method: payout.payout_method,
            note: body.note,
          },
        })
        .catch(() => {});

      // Notify creator
      const notifTitle =
        body.status === "completed"
          ? "Payout Completed"
          : body.status === "failed"
          ? "Payout Failed"
          : body.status === "cancelled"
          ? "Payout Cancelled"
          : "Payout Update";

      const notifBody =
        body.status === "completed"
          ? payout.cryptoAmountBaseUnits!==null ? `Your payout of ${payout.cryptoAmountBaseUnits} base units of ${payout.cryptoCurrency} on ${payout.cryptoChain} has been completed.` : `Your payout of ₦${(Number(netKobo) / 100).toFixed(2)} has been completed.`
          : body.status === "failed"
          ? "Your payout could not be completed. Your earnings have been restored to your balance."
          : body.status === "cancelled"
          ? "Your payout was cancelled. Your earnings have been restored to your balance."
          : `Your payout status has been updated to: ${body.status}.`;

      await orm
        .insert(schema.notifications)
        .values({
          userId: payout.creator_id,
          type: `payout_${body.status}`,
          title: notifTitle,
          body: notifBody,
          metadata: { payoutId, status: body.status },
        })
        .catch(() => {});

      return NextResponse.json({
        success: true,
        payoutId,
        previousStatus: payout.status,
        ...(payout.cryptoAmountBaseUnits!==null ? {asset:payout.cryptoCurrency,chain:payout.cryptoChain,amountBaseUnits:payout.cryptoAmountBaseUnits,reservationRestored:["failed","cancelled"].includes(body.status)} : {}),
        newStatus: body.status,
        earningsRestored:
          body.status === "failed" || body.status === "cancelled"
            ? payout.cryptoAmountBaseUnits!==null ? undefined : Number(grossKobo)
            : undefined,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
