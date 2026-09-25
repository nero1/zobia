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
 *
 * NOTE (migration): converted off the raw adapter alongside lib/economy/coins.ts —
 * `enrolWithBalance` calls `debitCoins`, which now requires a Drizzle `DbOrTx`.
 */

import Decimal from "decimal.js";
import { randomUUID } from "crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
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

export async function loadEnrolmentRoom(roomId: string, client?: DbOrTx): Promise<EnrolmentRoom> {
  const db = client ?? (await getDb());
  const rows = await db
    .select({
      id: schema.rooms.id,
      name: schema.rooms.name,
      type: schema.rooms.type,
      creatorId: schema.rooms.creatorId,
      creatorTier: schema.users.creatorTier,
      enrolmentFeeNgn: schema.rooms.enrolmentFeeNgn,
      isActive: schema.rooms.isActive,
      maxMembers: schema.rooms.maxMembers,
    })
    .from(schema.rooms)
    .innerJoin(schema.users, eq(schema.users.id, schema.rooms.creatorId))
    .where(and(eq(schema.rooms.id, roomId), isNull(schema.rooms.deletedAt)))
    .limit(1);
  const r = rows[0];
  if (!r) throw notFound("Classroom not found");
  if (r.type !== "classroom") throw badRequest("This endpoint is only for classroom rooms");
  return {
    id: r.id,
    name: r.name,
    creatorId: r.creatorId,
    creatorTier: r.creatorTier,
    feeNgn: Number(r.enrolmentFeeNgn ?? 0),
    isActive: r.isActive !== false,
    maxMembers: r.maxMembers,
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
export async function finalizeEnrolment(tx: DbOrTx, input: FinalizeInput): Promise<string | null> {
  const enrolRows = await tx
    .insert(schema.classroomEnrolments)
    .values({
      roomId: input.room.id,
      userId: input.userId,
      paid: input.paid,
      feeKobo: BigInt(input.feeKobo),
      enrolledAt: sql`NOW()`,
      lastActiveAt: sql`NOW()`,
    })
    .onConflictDoNothing({
      target: [schema.classroomEnrolments.roomId, schema.classroomEnrolments.userId],
    })
    .returning({ id: schema.classroomEnrolments.id });
  const enrolmentId = enrolRows[0]?.id ?? null;
  if (!enrolmentId) return null;

  // Room membership. member_count is re-synced from the actual active-member
  // count (same approach as POST /api/rooms/[roomId]/join) — the previous
  // "increment only if NOT EXISTS" guard ran after the insert, so it never
  // incremented at all.
  await tx
    .insert(schema.roomMembers)
    .values({ roomId: input.room.id, userId: input.userId, role: "member", joinedAt: sql`NOW()` })
    .onConflictDoUpdate({
      target: [schema.roomMembers.roomId, schema.roomMembers.userId],
      set: { leftAt: null, joinedAt: sql`NOW()` },
      setWhere: sql`${schema.roomMembers.leftAt} IS NOT NULL`,
    });
  await tx
    .update(schema.rooms)
    .set({
      memberCount: sql`(SELECT COUNT(*) FROM room_members WHERE room_id = ${input.room.id} AND left_at IS NULL)`,
      updatedAt: sql`NOW()`,
    })
    .where(eq(schema.rooms.id, input.room.id));

  if (input.paid && input.feeKobo > 0) {
    const feeRate = getCreatorFeeRate(input.room.creatorTier);
    const netKobo = new Decimal(input.feeKobo).mul(new Decimal(1).minus(feeRate)).floor().toNumber();
    const platformFeeKobo = input.feeKobo - netKobo;
    const earnRows = await tx
      .insert(schema.creatorEarnings)
      .values({
        creatorId: input.room.creatorId,
        sourceType: "classroom_enrolment",
        grossAmountKobo: BigInt(input.feeKobo),
        platformFeeKobo: BigInt(platformFeeKobo),
        netAmountKobo: BigInt(netKobo),
        referenceId: enrolmentId,
      })
      .onConflictDoNothing({
        target: [schema.creatorEarnings.creatorId, schema.creatorEarnings.referenceId],
        where: sql`${schema.creatorEarnings.referenceId} IS NOT NULL`,
      })
      .returning({ id: schema.creatorEarnings.id });
    if (earnRows[0]) {
      await tx
        .update(schema.users)
        .set({ availableEarningsKobo: sql`COALESCE(${schema.users.availableEarningsKobo}, 0) + ${netKobo}`, updatedAt: sql`NOW()` })
        .where(eq(schema.users.id, input.room.creatorId));
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
  const orm = await getDb();
  const enrolmentId = await orm.transaction(async (tx) => {
    // Lock the classroom so the fee can't change mid-enrolment.
    await tx.select({ id: schema.rooms.id }).from(schema.rooms).where(eq(schema.rooms.id, roomId)).for("share");
    const room = await loadEnrolmentRoom(roomId, tx);
    if (!room.isActive) throw badRequest("This classroom isn't accepting new members right now.", "CLASSROOM_ARCHIVED");
    if (room.creatorId === userId) throw badRequest("You can't enrol in your own classroom.");

    const existing = await tx
      .select({ id: schema.classroomEnrolments.id })
      .from(schema.classroomEnrolments)
      .where(and(eq(schema.classroomEnrolments.roomId, roomId), eq(schema.classroomEnrolments.userId, userId)));
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
