export const dynamic = 'force-dynamic';

/**
 * app/api/classroom/[roomId]/modules/route.ts
 *
 * Curriculum modules (lessons) for a ClassRoom, stored in
 * rooms.curriculum.modules — each with a stable `id` (see
 * lib/classroom/curriculum.ts).
 *
 * GET    → modules shaped for the caller (outline for visitors, full lessons
 *          for members unless level-locked, everything for creator/mods/staff)
 * POST   → add a module                        (creator/staff)
 * PATCH  → { id, ...fields } update a module   (creator/staff)
 * PUT    → { order: string[] } reorder modules (creator/staff)
 * DELETE → { id } remove a module              (creator/staff)
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest, forbidden } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { requireCapability, type ClassroomContext } from "@/lib/classroom/access";
import { classroomContextFromParams, ok } from "@/lib/classroom/http";
import {
  buildModule,
  getCompletedModuleIds,
  moduleInputSchema,
  parseModules,
  saveModules,
  viewModules,
  MAX_MODULES,
  type CurriculumModule,
} from "@/lib/classroom/curriculum";
import { getMemberStanding } from "@/lib/classroom/gamification";

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const patchSchema = moduleInputSchema.partial().extend({ id: idSchema });
const deleteSchema = z.object({ id: idSchema });
const reorderSchema = z.object({ order: z.array(idSchema).max(MAX_MODULES) });

/** Re-read the curriculum under a row lock so concurrent edits never clobber each other. */
async function mutateModules(
  roomId: string,
  fn: (modules: CurriculumModule[]) => CurriculumModule[]
): Promise<CurriculumModule[]> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ curriculum: unknown }>(
      `SELECT curriculum FROM rooms WHERE id = $1 FOR UPDATE`,
      [roomId]
    );
    const next = fn(parseModules(rows[0]?.curriculum));
    await saveModules(roomId, next, tx);
    return next;
  });
}

async function viewFor(ctx: ClassroomContext, modules: CurriculumModule[]) {
  const { classroom, viewer } = ctx;
  const insider = viewer.can.viewMemberContent;
  const [standing, completed] = await Promise.all([
    viewer.userId && insider ? getMemberStanding(classroom.id, viewer.userId) : Promise.resolve(null),
    viewer.userId && insider ? getCompletedModuleIds(classroom.id, viewer.userId) : Promise.resolve(new Set<string>()),
  ]);
  return viewModules(modules, {
    fullAccess: viewer.isCreator || viewer.isModerator || viewer.isStaff,
    memberLevel: insider ? (standing?.level ?? 1) : null,
    completedIds: completed,
  });
}

export const GET = withAuth<{ roomId: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);
    const ctx = await classroomContextFromParams(params, auth.user.sub);
    if ((!ctx.classroom.isPublic || !ctx.classroom.isActive) && !ctx.viewer.can.viewMemberContent) {
      throw forbidden("This classroom is private.", "CLASSROOM_PRIVATE");
    }
    return ok({ modules: await viewFor(ctx, parseModules(ctx.classroom.curriculum)) });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const ctx = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(ctx.viewer, "manageClassroom");
    const body = await validateBody(req, moduleInputSchema);
    const created = buildModule(body);
    const modules = await mutateModules(ctx.classroom.id, (list) => {
      if (list.length >= MAX_MODULES) throw badRequest(`A classroom can have at most ${MAX_MODULES} modules`);
      return [...list, created];
    });
    return ok({ modules: await viewFor(ctx, modules), addedId: created.id }, 201);
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const ctx = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(ctx.viewer, "manageClassroom");
    const body = await validateBody(req, patchSchema);
    const modules = await mutateModules(ctx.classroom.id, (list) => {
      const idx = list.findIndex((m) => m.id === body.id);
      if (idx === -1) throw notFound("Module not found");
      const current = list[idx]!;
      const merged = buildModule(
        {
          title: body.title ?? current.title,
          description: body.description !== undefined ? body.description : current.description,
          content: body.content !== undefined ? body.content : current.content,
          videoUrl: body.videoUrl !== undefined ? body.videoUrl : current.videoUrl,
          resources: body.resources !== undefined ? body.resources : current.resources,
          unlockLevel: body.unlockLevel !== undefined ? body.unlockLevel : current.unlockLevel,
        },
        current.id
      );
      return list.map((m, i) => (i === idx ? merged : m));
    });
    return ok({ modules: await viewFor(ctx, modules), updatedId: body.id });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PUT = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const ctx = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(ctx.viewer, "manageClassroom");
    const body = await validateBody(req, reorderSchema);
    const modules = await mutateModules(ctx.classroom.id, (list) => {
      const byId = new Map(list.map((m) => [m.id, m]));
      if (body.order.length !== list.length || new Set(body.order).size !== list.length || !body.order.every((id) => byId.has(id))) {
        throw badRequest("The new order must list every module exactly once.");
      }
      return body.order.map((id) => byId.get(id)!);
    });
    return ok({ modules: await viewFor(ctx, modules) });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAuth<{ roomId: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiWrite);
    const ctx = await classroomContextFromParams(params, auth.user.sub);
    requireCapability(ctx.viewer, "manageClassroom");
    const body = await validateBody(req, deleteSchema);
    const modules = await mutateModules(ctx.classroom.id, (list) => {
      if (!list.some((m) => m.id === body.id)) throw notFound("Module not found");
      return list.filter((m) => m.id !== body.id);
    });
    return ok({ modules: await viewFor(ctx, modules), deletedId: body.id });
  } catch (err) {
    return handleApiError(err);
  }
});
