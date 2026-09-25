export const dynamic = "force-dynamic";

/**
 * app/api/classroom/[roomId]/route.ts
 *
 * GET    /api/classroom/:roomId — classroom homepage payload (role-filtered)
 * PATCH  /api/classroom/:roomId — update details, access cost, visibility,
 *                                 listing toggle and classroom settings (creator/staff)
 * DELETE /api/classroom/:roomId — delete a classroom with no paid members (creator/staff);
 *                                 classrooms with paying members must be archived instead
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getDb, schema } from "@/lib/db/drizzle";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { badRequest, conflict, forbidden, handleApiError } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { meetsMinimumTrust } from "@/lib/trust/trustScore";
import { logger } from "@/lib/logger";
import { memDelPrefix } from "@/lib/cache/memory";
import { requireCapability } from "@/lib/classroom/access";
import { classroomContextFromParams, ok } from "@/lib/classroom/http";
import { buildClassroomHome } from "@/lib/classroom/home";
import { classroomSettingsPatchSchema, mergeClassroomSettings } from "@/lib/classroom/settings";
import { canEnableClassroomChatRoom, getChatRoomMaxTotal } from "@/lib/classroom/chatRoom";

/** Upper bound on a classroom's enrolment fee (₦10m) — well under the DB cap. */
const MAX_ENROLMENT_FEE_NGN = 10_000_000;

const patchSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(2000).nullable(),
    category: z.string().trim().min(1).max(50),
    coverEmoji: z.string().max(10),
    coverImageUrl: z.string().url().max(1000).nullable(),
    isPublic: z.boolean(),
    isActive: z.boolean(),
    enrolmentFeeNgn: z.number().int().min(0).max(MAX_ENROLMENT_FEE_NGN),
    classStartDate: z.string().date().nullable(),
    classEndDate: z.string().date().nullable(),
    showInCreatorListing: z.boolean(),
    settings: classroomSettingsPatchSchema,
  })
  .partial();

export const GET = withAuth<{ roomId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const ctx = await classroomContextFromParams(params, auth.user.sub);
    // Private or archived classrooms are only visible to insiders.
    if ((!ctx.classroom.isPublic || !ctx.classroom.isActive) && !ctx.viewer.can.viewMemberContent) {
      throw forbidden("This classroom is private.", "CLASSROOM_PRIVATE");
    }
    return ok(await buildClassroomHome(ctx));
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "manageClassroom");
    const body = await validateBody(req, patchSchema);

    const start = body.classStartDate !== undefined ? body.classStartDate : classroom.classStartDate;
    const end = body.classEndDate !== undefined ? body.classEndDate : classroom.classEndDate;
    if (start && end && end < start) throw badRequest("The end date must be on or after the start date.");

    // Going from free to paid (or raising a paid fee) re-runs the PRD §19 trust
    // gate that POST /api/rooms applies at creation. Staff bypass, as there.
    if (body.enrolmentFeeNgn !== undefined && body.enrolmentFeeNgn > 0 && !viewer.isStaff) {
      const eligible = await meetsMinimumTrust(auth.user.sub, "classroom_creation", await getDb());
      if (!eligible) {
        throw forbidden(
          "Paid ClassRooms require a 30-day account history and a minimum trust score.",
          "CLASSROOM_PAID_NOT_ELIGIBLE"
        );
      }
    }

    const orm = await getDb();
    const updates: Partial<typeof schema.rooms.$inferInsert> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description || null;
    if (body.category !== undefined) updates.category = body.category;
    if (body.coverEmoji !== undefined) updates.coverEmoji = body.coverEmoji || "📚";
    if (body.coverImageUrl !== undefined) updates.coverImageUrl = body.coverImageUrl;
    if (body.isPublic !== undefined) {
      if (body.isPublic && !classroom.slug) throw badRequest("Set a URL for this classroom before making it public.");
      updates.isPublic = body.isPublic;
      if (body.isPublic && !classroom.publishedAt) updates.publishedAt = new Date();
    }
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.enrolmentFeeNgn !== undefined) updates.enrolmentFeeNgn = BigInt(body.enrolmentFeeNgn);
    if (body.classStartDate !== undefined) updates.classStartDate = body.classStartDate;
    if (body.classEndDate !== undefined) updates.classEndDate = body.classEndDate;
    if (body.showInCreatorListing !== undefined) updates.showInCreatorListing = body.showInCreatorListing;
    if (body.settings !== undefined) {
      if (body.settings.chatRoomEnabled === true && !classroom.settings.chatRoomEnabled) {
        const [planRow] = await orm
          .select({
            plan: schema.users.plan,
            has_business: sql<boolean>`EXISTS(
             SELECT 1 FROM business_accounts ba WHERE ba.user_id = ${schema.users.id} AND ba.status = 'active'
           )`,
          })
          .from(schema.users)
          .where(eq(schema.users.id, classroom.creatorId))
          .limit(1);
        const { eligible, reason } = canEnableClassroomChatRoom(
          planRow?.plan ?? "free",
          planRow?.has_business ?? false
        );
        if (!eligible) throw forbidden(reason ?? "Not eligible for the chat Room", "CHAT_ROOM_NOT_ELIGIBLE");
        updates.maxMembers = await getChatRoomMaxTotal();
      }
      updates.classroomSettings = mergeClassroomSettings(classroom.settings, body.settings);
    }
    if (Object.keys(updates).length === 0) throw badRequest("Nothing to update");

    updates.updatedAt = new Date();
    await orm.update(schema.rooms).set(updates).where(eq(schema.rooms.id, classroom.id));
    memDelPrefix(`classroom:stats:${classroom.id}:`);
    logger.info({ roomId: classroom.id, actorId: auth.user.sub, fields: Object.keys(body) }, "[classroom] classroom updated");

    const fresh = await classroomContextFromParams(params, auth.user.sub);
    return ok(await buildClassroomHome(fresh));
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ roomId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const { classroom, viewer } = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(viewer, "manageClassroom");

    const orm = await getDb();
    await orm.transaction(async (tx) => {
      const [{ n }] = await tx
        .select({ n: count() })
        .from(schema.classroomEnrolments)
        .where(and(eq(schema.classroomEnrolments.roomId, classroom.id), eq(schema.classroomEnrolments.paid, true)));
      if (Number(n ?? 0) > 0) {
        throw conflict(
          "This classroom has paying members, so it can't be deleted. Archive it instead to stop new enrolments.",
          "CLASSROOM_HAS_PAID_MEMBERS"
        );
      }
      await tx
        .update(schema.rooms)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(eq(schema.rooms.id, classroom.id));
    });
    logger.info({ roomId: classroom.id, actorId: auth.user.sub }, "[classroom] classroom deleted");
    return ok({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
});
