/**
 * app/api/classroom/[roomId]/graduate/route.ts
 *
 * POST /api/classroom/:roomId/graduate
 *
 * Trigger a graduation ceremony for a ClassRoom that has ended.
 * Only the room creator can call this endpoint.
 *
 * Flow:
 *  1. Verify the room exists, is type 'classroom', and the caller is the creator.
 *  2. Verify the classroom's end_date has passed (end_date <= NOW()).
 *  3. Guard against duplicate ceremonies (idempotent check).
 *  4. Create a new Drop Room for the graduation ceremony.
 *  5. Notify all enrolled students with a graduation_ceremony notification.
 *  6. Award Knowledge Track XP (50 XP) to students with at least one passed quiz.
 *  7. Return { ceremonyRoomId, studentCount, xpAwarded }.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import {
  handleApiError,
  notFound,
  forbidden,
  badRequest,
} from "@/lib/api/errors";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** XP awarded on graduation to students who passed at least one quiz. */
const GRADUATION_XP = 50;

/** Duration the graduation Drop Room remains active (in hours). */
const CEREMONY_DURATION_HOURS = 2;

// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

interface ClassroomRoomRow {
  id: string;
  name: string;
  type: string;
  creator_id: string;
  is_active: boolean;
  end_date: string | null;
}

interface EnrolledStudentRow {
  user_id: string;
}

interface PassedQuizStudentRow {
  user_id: string;
}

interface NewRoomRow {
  id: string;
}

// ---------------------------------------------------------------------------
// POST /api/classroom/[roomId]/graduate
// ---------------------------------------------------------------------------

/**
 * Trigger a graduation ceremony for a completed ClassRoom.
 *
 * @param req    - Incoming request (no body required)
 * @param params - Route params containing roomId
 * @returns { ceremonyRoomId, studentCount, xpAwarded } on success
 */
export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    const { roomId } = await params as { roomId: string };
    const callerId = auth.user.sub;

    // -----------------------------------------------------------------------
    // 1. Verify room exists, is a classroom, and caller is the creator
    // -----------------------------------------------------------------------
    const { rows: roomRows } = await db.query<ClassroomRoomRow>(
      `SELECT id, name, type, creator_id, is_active, end_date
       FROM rooms
       WHERE id = $1 AND deleted_at IS NULL`,
      [roomId]
    );

    const room = roomRows[0];
    if (!room) throw notFound("Classroom room not found");
    if (room.type !== "classroom") {
      throw badRequest("This endpoint is only for classroom rooms");
    }
    if (room.creator_id !== callerId) {
      throw forbidden("Only the room creator can trigger graduation");
    }

    // -----------------------------------------------------------------------
    // 2. Verify the classroom's end_date has passed
    // -----------------------------------------------------------------------
    if (!room.end_date) {
      throw badRequest("This classroom has no end date — graduation cannot be triggered");
    }

    const { rows: timeRows } = await db.query<{ has_ended: boolean }>(
      `SELECT ($1::timestamptz <= NOW()) AS has_ended`,
      [room.end_date]
    );
    if (!timeRows[0]?.has_ended) {
      throw badRequest("This classroom has not ended yet — graduation cannot be triggered before the end date");
    }

    // -----------------------------------------------------------------------
    // 3. Guard against duplicate ceremonies
    // -----------------------------------------------------------------------
    const { rows: existingRows } = await db.query<{ id: string }>(
      `SELECT id
       FROM rooms
       WHERE room_type = 'drop'
         AND deleted_at IS NULL
         AND metadata->>'graduation_for' = $1
       LIMIT 1`,
      [roomId]
    );
    if (existingRows.length > 0) {
      return NextResponse.json(
        {
          ceremonyRoomId: existingRows[0]!.id,
          studentCount: 0,
          xpAwarded: 0,
          alreadyCreated: true,
        },
        { status: 200 }
      );
    }

    // -----------------------------------------------------------------------
    // 4. Fetch enrolled students
    // -----------------------------------------------------------------------
    const { rows: enrolRows } = await db.query<EnrolledStudentRow>(
      `SELECT user_id FROM classroom_enrolments WHERE room_id = $1`,
      [roomId]
    );
    const enrolledUserIds = enrolRows.map((r) => r.user_id);
    const studentCount = enrolledUserIds.length;

    // -----------------------------------------------------------------------
    // 5. Find students who passed at least one quiz (eligible for XP)
    // -----------------------------------------------------------------------
    let xpEligibleUserIds: string[] = [];
    if (enrolledUserIds.length > 0) {
      const { rows: quizRows } = await db.query<PassedQuizStudentRow>(
        `SELECT DISTINCT user_id
         FROM quiz_attempts
         WHERE room_id = $1
           AND passed = TRUE
           AND user_id = ANY($2::uuid[])`,
        [roomId, enrolledUserIds]
      );
      xpEligibleUserIds = quizRows.map((r) => r.user_id);
    }

    const xpAwarded = xpEligibleUserIds.length > 0 ? GRADUATION_XP : 0;

    // -----------------------------------------------------------------------
    // 6. Transactionally create ceremony room, notifications, and award XP
    // -----------------------------------------------------------------------
    const ceremonyRoomId = await db.transaction(async (tx) => {
      // Create the graduation Drop Room
      const dropEndsAt = new Date(
        Date.now() + CEREMONY_DURATION_HOURS * 60 * 60 * 1000
      ).toISOString();

      const { rows: newRoomRows } = await tx.query<NewRoomRow>(
        `INSERT INTO rooms
           (name, room_type, creator_id, is_active, metadata, drop_ends_at)
         VALUES ($1, 'drop', $2, TRUE, $3::jsonb, $4::timestamptz)
         RETURNING id`,
        [
          `Graduation: ${room.name}`,
          room.creator_id,
          JSON.stringify({ graduation_for: roomId, ceremony: true }),
          dropEndsAt,
        ]
      );
      const newRoom = newRoomRows[0];
      if (!newRoom) throw new Error("Failed to create graduation Drop Room");

      const newCeremonyRoomId = newRoom.id;

      // Insert notifications for all enrolled students
      if (enrolledUserIds.length > 0) {
        // Build a VALUES list for batch insert
        const notifValues: unknown[] = [];
        const placeholders: string[] = [];
        enrolledUserIds.forEach((uid, idx) => {
          const base = idx * 4;
          placeholders.push(
            `($${base + 1}, $${base + 2}, 'graduation_ceremony', $${base + 3}::jsonb, NOW())`
          );
          notifValues.push(
            uid,
            `Your graduation ceremony is ready! Join now.`,
            JSON.stringify({ ceremonyRoomId: newCeremonyRoomId, classroomRoomId: roomId })
          );
        });

        await tx.query(
          `INSERT INTO notifications
             (user_id, body, type, metadata, created_at)
           VALUES ${placeholders.join(", ")}`,
          notifValues
        );
      }

      // Award XP to quiz-passing students
      if (xpEligibleUserIds.length > 0) {
        await tx.query(
          `UPDATE users
           SET xp_total      = xp_total      + $1,
               xp_knowledge  = xp_knowledge  + $1,
               updated_at    = NOW()
           WHERE id = ANY($2::uuid[])`,
          [GRADUATION_XP, xpEligibleUserIds]
        );

        // Insert XP ledger entries
        const xpValues: unknown[] = [];
        const xpPlaceholders: string[] = [];
        xpEligibleUserIds.forEach((uid, idx) => {
          const base = idx * 5;
          xpPlaceholders.push(
            `($${base + 1}, $${base + 2}, 'knowledge', 'graduation', $${base + 3}, 100, $${base + 4}, $${base + 5})`
          );
          xpValues.push(uid, GRADUATION_XP, roomId, GRADUATION_XP, newCeremonyRoomId);
        });

        await tx.query(
          `INSERT INTO xp_ledger
             (user_id, amount, track, source, reference_id, multiplier, base_amount, ceremony_room_id)
           VALUES ${xpPlaceholders.join(", ")}`,
          xpValues
        );
      }

      return newCeremonyRoomId;
    });

    return NextResponse.json(
      { ceremonyRoomId, studentCount, xpAwarded },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
