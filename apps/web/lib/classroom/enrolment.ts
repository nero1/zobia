/**
 * lib/classroom/enrolment.ts
 *
 * The one place a classroom enrolment is written, shared by:
 *   - POST /api/classroom/[roomId]/enroll (balance/Credits payment, free classrooms)
 *   - the Paystack webhook (card payment, itemType 'classroom_enrolment')
 *
 * Creator revenue flows into the EXISTING creator payout pipeline: a
 * creator_earnings row (source_type 'classroom_enrolment', reference_id =
 * the enrolment id) plus users.available_earnings_kobo — exactly what
 * GET/POST /api/creator/payouts reads and withdraws from. No separate ledger.
 */

import Decimal from "decimal.js";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import type { TransactionClient } from "@/lib/db/interface";
import { badRequest, conflict, notFound } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { debitCoins } from "@/lib/economy/coins";
import { getCreatorFeeRate } from "@/lib/payments/payouts";
import { safeAwardXPFireAndForget } from "@/lib/xp/safeAwardXP";

/** Knowledge-track XP for enrolling (PRD §7). */
export const XP_PAID_ENROLMENT = 50;
export const XP_FREE_ENROLMENT = 20;

export interface EnrolmentRoom {
  id: string;
  name: string;
  creatorId: string;
  creatorTier: string | null;
  feeNgn: number;
  isActive: boolean;
  maxMembers: number | null;
}

export async function loadEnrolmentRoom(roomId: string, client: Pick<TransactionClient, "query"> = db): Promise<EnrolmentRoom> {
  const { rows } = await client.query<{
    id: string;
    name: string;
    type: string;
    creator_id: string;
    creator_tier: string | null;
    enrolment_fee_ngn: string | number | null;
    is_active: boolean | null;
    max_members: number | null;
  }>(
    `SELECT r.id, r.name, r.type, r.creator_id, u.creator_tier, r.enrolment_fee_ngn, r.is_active, r.max_members
       FROM rooms r JOIN users u ON u.id = r.creator_id
      WHERE r.id = $1 AND r.deleted_at IS NULL`,
    [roomId]
  );
  const r = rows[0];
  if (!r) throw notFound("Classroom not found");
  if (r.type !== "classroom") throw badRequest("This endpoint is only for classroom rooms");
  return {
    id: r.id,
    name: r.name,
    creatorId: r.creator_id,
    creatorTier: r.creator_tier,
    feeNgn: Number(r.enrolment_fee_ngn ?? 0),
    isActive: r.is_active !== false,
    maxMembers: r.max_members,
  };
}

export interface FinalizeInput {
  room: EnrolmentRoom;
  userId: string;
  paid: boolean;
  feeKobo: number;
}

/**
 * Insert the enrolment + room membership + creator earnings inside `tx`.
 * Returns the new enrolment id, or null when the user was already enrolled
 * (idempotent — safe for webhook retries and double-clicks).
 */
export async function finalizeEnrolment(tx: TransactionClient, input: FinalizeInput): Promise<string | null> {
  const { rows: enrolRows } = await tx.query<{ id: string }>(
    `INSERT INTO classroom_enrolments (room_id, user_id, paid, fee_kobo, enrolled_at, last_active_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (room_id, user_id) DO NOTHING
     RETURNING id`,
    [input.room.id, input.userId, input.paid, input.feeKobo]
  );
  const enrolmentId = enrolRows[0]?.id ?? null;
  if (!enrolmentId) return null;

  // Room membership. member_count is re-synced from the actual active-member
  // count (same approach as POST /api/rooms/[roomId]/join) — the previous
  // "increment only if NOT EXISTS" guard ran after the insert, so it never
  // incremented at all.
  await tx.query(
    `INSERT INTO room_members (room_id, user_id, role, joined_at)
     VALUES ($1, $2, 'member', NOW())
     ON CONFLICT (room_id, user_id) DO UPDATE
       SET left_at = NULL, joined_at = NOW()
       WHERE room_members.left_at IS NOT NULL`,
    [input.room.id, input.userId]
  );
  await tx.query(
    `UPDATE rooms
        SET member_count = (SELECT COUNT(*) FROM room_members WHERE room_id = $1 AND left_at IS NULL),
            updated_at = NOW()
      WHERE id = $1`,
    [input.room.id]
  );

  if (input.paid && input.feeKobo > 0) {
    const feeRate = getCreatorFeeRate(input.room.creatorTier);
    const netKobo = new Decimal(input.feeKobo).mul(new Decimal(1).minus(feeRate)).floor().toNumber();
    const platformFeeKobo = input.feeKobo - netKobo;
    const { rows: earnRows } = await tx.query<{ id: string }>(
      `INSERT INTO creator_earnings
         (creator_id, source_type, gross_amount_kobo, platform_fee_kobo, net_amount_kobo, reference_id)
       VALUES ($1, 'classroom_enrolment', $2, $3, $4, $5)
       ON CONFLICT (creator_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [input.room.creatorId, input.feeKobo, platformFeeKobo, netKobo, enrolmentId]
    );
    if (earnRows[0]) {
      await tx.query(
        `UPDATE users SET available_earnings_kobo = COALESCE(available_earnings_kobo, 0) + $1, updated_at = NOW()
          WHERE id = $2`,
        [netKobo, input.room.creatorId]
      );
    }
  }

  return enrolmentId;
}

/** Fire the enrolment XP after the enrolment transaction has committed. */
export function awardEnrolmentXp(roomId: string, userId: string, paid: boolean): number {
  const xp = paid ? XP_PAID_ENROLMENT : XP_FREE_ENROLMENT;
  safeAwardXPFireAndForget(userId, xp, "knowledge", "classroom_enrolment", roomId);
  return xp;
}

/**
 * Enrol paying with the user's Credits balance (1 Credit = ₦1), or for free
 * when the classroom has no fee. Everything — debit, enrolment, membership,
 * creator earnings — commits atomically.
 */
export async function enrolWithBalance(roomId: string, userId: string): Promise<{ enrolmentId: string; xpAwarded: number; paid: boolean }> {
  let paid = false;
  const enrolmentId = await db.transaction(async (tx) => {
    // Lock the classroom so the fee can't change mid-enrolment.
    await tx.query(`SELECT id FROM rooms WHERE id = $1 FOR SHARE`, [roomId]);
    const room = await loadEnrolmentRoom(roomId, tx);
    if (!room.isActive) throw badRequest("This classroom isn't accepting new members right now.", "CLASSROOM_ARCHIVED");
    if (room.creatorId === userId) throw badRequest("You can't enrol in your own classroom.");

    const { rows: existing } = await tx.query<{ id: string }>(
      `SELECT id FROM classroom_enrolments WHERE room_id = $1 AND user_id = $2`,
      [roomId, userId]
    );
    if (existing[0]) throw conflict("You are already enrolled in this classroom");

    paid = room.feeNgn > 0;
    if (paid) {
      await debitCoins(
        userId,
        room.feeNgn,
        "classroom_enrolment",
        // Unique per attempt: a concurrent duplicate enrolment rolls this whole
        // transaction back (unique enrolment index), so it can never double-charge.
        `classroom_enrolment:${roomId}:${userId}:${randomUUID()}`,
        `Classroom enrolment: ${room.name}`,
        { roomId },
        tx
      );
    }

    const id = await finalizeEnrolment(tx, { room, userId, paid, feeKobo: room.feeNgn * 100 });
    if (!id) throw conflict("You are already enrolled in this classroom");
    return id;
  });

  const xpAwarded = awardEnrolmentXp(roomId, userId, paid);
  logger.info({ roomId, userId, paid }, "[classroom:enrol] enrolled via balance");
  return { enrolmentId, xpAwarded, paid };
}

/** Paystack card-payment reference for a classroom enrolment. */
export function classroomPaymentReference(roomId: string, userId: string): string {
  return `clsenrol-${roomId.replace(/-/g, "").slice(0, 12)}-${userId.replace(/-/g, "").slice(0, 8)}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}
