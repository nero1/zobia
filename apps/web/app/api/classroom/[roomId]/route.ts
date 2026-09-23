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
import { db } from "@/lib/db";
import type { SqlParam } from "@/lib/db/interface";
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
      const eligible = await meetsMinimumTrust(auth.user.sub, "classroom_creation", db);
      if (!eligible) {
        throw forbidden(
          "Paid ClassRooms require a 30-day account history and a minimum trust score.",
          "CLASSROOM_PAID_NOT_ELIGIBLE"
        );
      }
    }

    const sets: string[] = [];
    const args: SqlParam[] = [classroom.id];
    const set = (col: string, value: SqlParam) => {
      args.push(value);
      sets.push(`${col} = $${args.length}`);
    };
    if (body.name !== undefined) set("name", body.name);
    if (body.description !== undefined) set("description", body.description || null);
    if (body.category !== undefined) set("category", body.category);
    if (body.coverEmoji !== undefined) set("cover_emoji", body.coverEmoji || "📚");
    if (body.coverImageUrl !== undefined) set("cover_image_url", body.coverImageUrl);
    if (body.isPublic !== undefined) {
      if (body.isPublic && !classroom.slug) throw badRequest("Set a URL for this classroom before making it public.");
      set("is_public", body.isPublic);
      if (body.isPublic && !classroom.publishedAt) set("published_at", new Date().toISOString());
    }
    if (body.isActive !== undefined) set("is_active", body.isActive);
    if (body.enrolmentFeeNgn !== undefined) set("enrolment_fee_ngn", body.enrolmentFeeNgn);
    if (body.classStartDate !== undefined) set("class_start_date", body.classStartDate);
    if (body.classEndDate !== undefined) set("class_end_date", body.classEndDate);
    if (body.showInCreatorListing !== undefined) set("show_in_creator_listing", body.showInCreatorListing);
    if (body.settings !== undefined) {
      if (body.settings.chatRoomEnabled === true && !classroom.settings.chatRoomEnabled) {
        const { rows: planRows } = await db.query<{ plan: string; has_business: boolean }>(
          `SELECT u.plan, EXISTS(
             SELECT 1 FROM business_accounts ba WHERE ba.user_id = u.id AND ba.status = 'active'
           ) AS has_business
           FROM users u WHERE u.id = $1`,
          [classroom.creatorId]
        );
        const { eligible, reason } = canEnableClassroomChatRoom(
          planRows[0]?.plan ?? "free",
          planRows[0]?.has_business ?? false
        );
        if (!eligible) throw forbidden(reason ?? "Not eligible for the chat Room", "CHAT_ROOM_NOT_ELIGIBLE");
        set("max_members", await getChatRoomMaxTotal());
      }
      set("classroom_settings", JSON.stringify(mergeClassroomSettings(classroom.settings, body.settings)));
      sets[sets.length - 1] += "::jsonb";
    }
    if (sets.length === 0) throw badRequest("Nothing to update");

    await db.query(`UPDATE rooms SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1`, args);
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

    await db.transaction(async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM classroom_enrolments WHERE room_id = $1 AND paid = TRUE`,
        [classroom.id]
      );
      if (Number(rows[0]?.n ?? 0) > 0) {
        throw conflict(
          "This classroom has paying members, so it can't be deleted. Archive it instead to stop new enrolments.",
          "CLASSROOM_HAS_PAID_MEMBERS"
        );
      }
      await tx.query(
        `UPDATE rooms SET deleted_at = NOW(), is_active = FALSE, updated_at = NOW() WHERE id = $1`,
        [classroom.id]
      );
    });
    logger.info({ roomId: classroom.id, actorId: auth.user.sub }, "[classroom] classroom deleted");
    return ok({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
});
