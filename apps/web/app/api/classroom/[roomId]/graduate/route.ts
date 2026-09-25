export const dynamic = 'force-dynamic';

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
import { randomUUID } from "crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { generateUniqueSlug } from "@/lib/slug";
import { insertNotificationBatch } from "@/lib/notifications/insert";
import { safeAwardXPFireAndForget } from "@/lib/xp/safeAwardXP";
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
    const orm = await getDb();

    // -----------------------------------------------------------------------
    // 1. Verify room exists, is a classroom, and caller is the creator
    // -----------------------------------------------------------------------
    // rooms has no `end_date` column (this used to SELECT it, so every
    // graduation request 500'd) — a classroom ends at ends_at, or at the end
    // of its class_end_date.
    const [room] = await orm
      .select({
        id: schema.rooms.id,
        name: schema.rooms.name,
        type: schema.rooms.type,
        creator_id: schema.rooms.creatorId,
        is_active: schema.rooms.isActive,
        end_date: sql<string | null>`COALESCE(${schema.rooms.endsAt}, (${schema.rooms.classEndDate} + 1)::timestamptz)`,
      })
      .from(schema.rooms)
      .where(and(eq(schema.rooms.id, roomId), isNull(schema.rooms.deletedAt)))
      .limit(1);

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

    const hasEnded = new Date(room.end_date).getTime() <= Date.now();
    if (!hasEnded) {
      throw badRequest("This classroom has not ended yet — graduation cannot be triggered before the end date");
    }

    // -----------------------------------------------------------------------
    // 3. Guard against duplicate ceremonies
    // -----------------------------------------------------------------------
    const [existingCeremony] = await orm
      .select({ id: schema.rooms.id })
      .from(schema.rooms)
      .where(
        and(
          eq(schema.rooms.type, "drop"),
          isNull(schema.rooms.deletedAt),
          sql`${schema.rooms.metadata}->>'graduation_for' = ${roomId}`
        )
      )
      .limit(1);
    if (existingCeremony) {
      return NextResponse.json(
        {
          ceremonyRoomId: existingCeremony.id,
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
    const enrolRows = await orm
      .select({ user_id: schema.classroomEnrolments.userId })
      .from(schema.classroomEnrolments)
      .where(eq(schema.classroomEnrolments.roomId, roomId));
    const enrolledUserIds = enrolRows.map((r) => r.user_id);
    const studentCount = enrolledUserIds.length;

    // -----------------------------------------------------------------------
    // 5. Find students who passed at least one quiz (eligible for XP)
    // -----------------------------------------------------------------------
    let xpEligibleUserIds: string[] = [];
    if (enrolledUserIds.length > 0) {
      const quizRows = await orm
        .selectDistinct({ user_id: schema.classroomQuizAttempts.userId })
        .from(schema.classroomQuizAttempts)
        .innerJoin(schema.classroomQuizzes, eq(schema.classroomQuizzes.id, schema.classroomQuizAttempts.quizId))
        .where(
          and(
            eq(schema.classroomQuizzes.roomId, roomId),
            eq(schema.classroomQuizAttempts.passed, true),
            inArray(schema.classroomQuizAttempts.userId, enrolledUserIds)
          )
        );
      xpEligibleUserIds = quizRows.map((r) => r.user_id);
    }

    const xpAwarded = xpEligibleUserIds.length > 0 ? GRADUATION_XP : 0;

    // -----------------------------------------------------------------------
    // 6. Transactionally create ceremony room, notifications, and award XP
    // -----------------------------------------------------------------------
    // Public rooms must carry a slug (rooms_public_requires_slug) — the
    // ceremony room previously had none, so this INSERT always failed.
    const ceremonySlug = await generateUniqueSlug("room", `graduation ${room.name}`, randomUUID());

    const ceremonyRoomId = await orm.transaction(async (tx) => {
      // Create the graduation Drop Room
      const dropEndsAt = new Date(
        Date.now() + CEREMONY_DURATION_HOURS * 60 * 60 * 1000
      );

      const [newRoom] = await tx
        .insert(schema.rooms)
        .values({
          name: `Graduation: ${room.name}`,
          type: "drop",
          creatorId: room.creator_id,
          isActive: true,
          metadata: { graduation_for: roomId, ceremony: true },
          dropStartsAt: new Date(),
          dropEndsAt,
          slug: ceremonySlug,
          isPublic: true,
          category: "Education",
          coverEmoji: "🎓",
        })
        .returning({ id: schema.rooms.id });
      if (!newRoom) throw new Error("Failed to create graduation Drop Room");

      const newCeremonyRoomId = newRoom.id;

      // Notify every enrolled student (the previous hand-built VALUES list
      // numbered its placeholders 4 apart for 3 params per row, which
      // Postgres rejected).
      await insertNotificationBatch(
        tx,
        enrolledUserIds,
        "graduation_ceremony",
        "🎓 Graduation ceremony",
        `Your graduation ceremony for "${room.name}" is ready! Join now.`,
        { ceremonyRoomId: newCeremonyRoomId, classroomRoomId: roomId, roomId: newCeremonyRoomId }
      );

      return newCeremonyRoomId;
    });

    // Graduation XP through the canonical XP path, after the commit
    // (idempotent per student + classroom).
    for (const uid of xpEligibleUserIds) {
      safeAwardXPFireAndForget(uid, GRADUATION_XP, "knowledge", "classroom_graduation", roomId);
    }

    return NextResponse.json(
      { ceremonyRoomId, studentCount, xpAwarded },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
