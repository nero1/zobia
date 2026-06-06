/**
 * app/api/classroom/[roomId]/enroll/route.ts
 *
 * POST /api/classroom/:roomId/enroll
 *
 * Enrol in a classroom room.
 *
 * Flow:
 *  1. Validate room is type=classroom and active.
 *  2. Check for existing enrolment (idempotent).
 *  3. If enrolmentFeeNgn > 0: deduct coins or initiate card payment.
 *  4. Create classroom_enrolments record.
 *  5. Create room_members record.
 *  6. Award Knowledge Track XP (50 XP for enrolling in a paid class, 20 for free).
 *  7. Credit creator earnings (80% net) for paid enrolments.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import {
  handleApiError,
  notFound,
  forbidden,
  conflict,
  badRequest,
} from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireFeatureEnabled } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CREATOR_SHARE_PERCENT = 80;
const XP_PAID_ENROLMENT = 50;
const XP_FREE_ENROLMENT = 20;

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const enrolSchema = z.object({
  paymentMethod: z.enum(["balance", "card"]).default("balance"),
});

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface ClassroomRoomRow {
  id: string;
  type: string;
  creator_id: string;
  is_active: boolean;
  enrolment_fee_ngn: number | null;
  class_start_date: string | null;
  class_end_date: string | null;
}

// ---------------------------------------------------------------------------
// POST /api/classroom/[roomId]/enroll
// ---------------------------------------------------------------------------

/**
 * Enrol the authenticated user in a classroom room.
 *
 * @param req    - Incoming request with paymentMethod
 * @param params - Route params containing roomId
 * @returns Enrolment record with status 201, or payment redirect on card
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    await requireFeatureEnabled("classrooms");

    const { roomId } = await params as { roomId: string };
    const userId = auth.user.sub;
    const body = await validateBody(req, enrolSchema);

    // Fetch room
    const { rows: roomRows } = await db.query<ClassroomRoomRow>(
      `SELECT id, type, creator_id, is_active, enrolment_fee_ngn,
              class_start_date, class_end_date
       FROM rooms WHERE id = $1`,
      [roomId]
    );
    const room = roomRows[0];
    if (!room || !room.is_active) throw notFound("Classroom room not found");
    if (room.type !== "classroom") {
      throw badRequest("This endpoint is only for classroom rooms");
    }

    // Idempotency
    const { rows: existingRows } = await db.query<{ id: string }>(
      `SELECT id FROM classroom_enrolments WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
      [roomId, userId]
    );
    if (existingRows.length > 0) {
      throw conflict("You are already enrolled in this classroom");
    }

    const feeNgn = room.enrolment_fee_ngn ?? 0;
    const feeKobo = feeNgn * 100;
    const isPaid = feeNgn > 0;

    // Handle card payment redirect
    if (isPaid && body.paymentMethod === "card") {
      const { rows: payRows } = await db.query<{ id: string }>(
        `INSERT INTO payments
           (user_id, payment_type, amount_kobo, currency, provider, status,
            reference_id, idempotency_key)
         VALUES ($1, 'room_entry', $2, 'NGN', 'paystack', 'pending', $3, $4)
         RETURNING id`,
        [userId, feeKobo, roomId, `enrol:${userId}:${roomId}:${Date.now()}`]
      );
      return NextResponse.json(
        {
          requiresCardPayment: true,
          paymentUrl: `/api/payments/initiate?paymentId=${payRows[0]?.id}`,
        },
        { status: 200 }
      );
    }

    // Balance payment
    if (isPaid) {
      const requiredCoins = feeNgn; // 1 NGN = 1 coin

      const { rows: userRows } = await db.query<{ coin_balance: number }>(
        `SELECT coin_balance FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [userId]
      );
      const user = userRows[0];
      if (!user) throw notFound("User not found");
      if (user.coin_balance < requiredCoins) {
        throw forbidden(
          `Insufficient balance. You need ${requiredCoins} coins to enrol in this classroom.`
        );
      }
    }

    const xpReward = isPaid ? XP_PAID_ENROLMENT : XP_FREE_ENROLMENT;

    const enrolment = await db.transaction(async (tx) => {
      // Deduct coins for paid enrolment
      if (isPaid) {
        const requiredCoins = feeNgn;
        const { rows: balRows } = await tx.query<{ coin_balance: number }>(
          `SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE`,
          [userId]
        );
        const balanceBefore = balRows[0]?.coin_balance ?? 0;

        await tx.query(
          `UPDATE users SET coin_balance = coin_balance - $1, updated_at = NOW()
           WHERE id = $2`,
          [requiredCoins, userId]
        );
        await tx.query(
          `INSERT INTO coin_ledger
             (user_id, amount, balance_before, balance_after, transaction_type,
              reference_id, description)
           VALUES ($1, $2, $3, $4, 'subscription', $5, $6)`,
          [
            userId,
            -requiredCoins,
            balanceBefore,
            balanceBefore - requiredCoins,
            roomId,
            `Classroom enrolment: ${roomId}`,
          ]
        );
      }

      // Create enrolment record
      const { rows: enrolRows } = await tx.query<{ id: string }>(
        `INSERT INTO classroom_enrolments
           (room_id, user_id, paid, fee_kobo, enrolled_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING *`,
        [roomId, userId, isPaid, feeKobo]
      );
      const enrolRecord = enrolRows[0];
      if (!enrolRecord) throw new Error("Enrolment creation failed");

      // Add room member
      await tx.query(
        `INSERT INTO room_members (room_id, user_id, role, joined_at)
         VALUES ($1, $2, 'member', NOW())
         ON CONFLICT (room_id, user_id) DO NOTHING`,
        [roomId, userId]
      );

      await tx.query(
        `UPDATE rooms
         SET member_count = member_count + 1, updated_at = NOW()
         WHERE id = $1
           AND NOT EXISTS (
             SELECT 1 FROM room_members
             WHERE room_id = $1 AND user_id = $2
           )`,
        [roomId, userId]
      );

      // Creator earnings (80% net) for paid enrolment
      if (isPaid) {
        const platformFeeKobo = Math.floor((feeKobo * (100 - CREATOR_SHARE_PERCENT)) / 100);
        const netKobo = feeKobo - platformFeeKobo;

        await tx.query(
          `INSERT INTO creator_earnings
             (creator_id, source_type, gross_amount_kobo, platform_fee_kobo, net_amount_kobo, reference_id)
           VALUES ($1, 'classroom_enrolment', $2, $3, $4, $5)`,
          [room.creator_id, feeKobo, platformFeeKobo, netKobo, enrolRecord.id]
        );
        // Increment available balance for manual payout
        await tx.query(
          `UPDATE users SET available_earnings_kobo = COALESCE(available_earnings_kobo, 0) + $1,
                            updated_at = NOW() WHERE id = $2`,
          [netKobo, room.creator_id]
        );
      }

      // Award Knowledge Track XP
      await tx.query(
        `UPDATE users
         SET xp_total = xp_total + $1,
             xp_knowledge = xp_knowledge + $1,
             updated_at = NOW()
         WHERE id = $2`,
        [xpReward, userId]
      );

      await tx.query(
        `INSERT INTO xp_ledger
           (user_id, amount, track, source, reference_id, multiplier, base_amount)
         VALUES ($1, $2, 'knowledge', 'room', $3, 100, $2)`,
        [userId, xpReward, roomId]
      );

      return enrolRecord;
    });

    return NextResponse.json(
      { enrolment, xpAwarded: xpReward },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
