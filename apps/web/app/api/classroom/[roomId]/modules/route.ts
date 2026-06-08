export const dynamic = 'force-dynamic';

/**
 * app/api/classroom/[roomId]/modules/route.ts
 *
 * Manage curriculum modules for a ClassRoom.
 *
 * Modules are stored as a JSONB array in rooms.curriculum.
 * Each module: { title: string; description?: string; resources?: string[] }
 *
 * GET    /api/classroom/[roomId]/modules → list modules
 * POST   /api/classroom/[roomId]/modules → add a module (creator only)
 * PATCH  /api/classroom/[roomId]/modules → update module by index (creator only)
 * DELETE /api/classroom/[roomId]/modules → remove module by index (creator only)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { withAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, notFound, forbidden, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CurriculumModule {
  title: string;
  description?: string;
  resources?: string[];
}

interface RoomRow {
  id: string;
  creator_id: string;
  type: string;
  curriculum: CurriculumModule[] | null;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const moduleSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  resources: z.array(z.string().url().max(500)).max(20).optional(),
});

const patchSchema = moduleSchema.extend({
  index: z.number().int().min(0),
});

const deleteSchema = z.object({
  index: z.number().int().min(0),
});

// ---------------------------------------------------------------------------
// Helper: fetch room and verify caller is creator
// ---------------------------------------------------------------------------

async function getClassroomAsCreator(
  roomId: string,
  userId: string
): Promise<RoomRow> {
  const { rows } = await db.query<RoomRow>(
    `SELECT id, creator_id, type,
            COALESCE(curriculum->'modules', '[]'::jsonb) AS curriculum
     FROM rooms WHERE id = $1 AND is_active = TRUE LIMIT 1`,
    [roomId]
  );
  const room = rows[0];
  if (!room) throw notFound("Classroom not found");
  if (room.type !== "classroom") {
    throw badRequest("This endpoint is only for classroom rooms");
  }
  if (room.creator_id !== userId) {
    throw forbidden("Only the room creator can manage modules");
  }
  return room;
}

// ---------------------------------------------------------------------------
// GET /api/classroom/[roomId]/modules
// ---------------------------------------------------------------------------

export const GET = withAuth(
  async (
    _req: NextRequest,
    { params }: { params: { roomId: string }; auth: unknown }
  ) => {
    try {
      const { roomId } = await params;

      const { rows } = await db.query<{ curriculum: unknown }>(
        `SELECT COALESCE(curriculum->'modules', '[]'::jsonb) AS curriculum
         FROM rooms WHERE id = $1 AND is_active = TRUE LIMIT 1`,
        [roomId]
      );

      if (!rows[0]) throw notFound("Classroom not found");

      const modules = Array.isArray(rows[0].curriculum)
        ? (rows[0].curriculum as CurriculumModule[])
        : [];

      return NextResponse.json({
        success: true,
        data: { modules },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/classroom/[roomId]/modules
// ---------------------------------------------------------------------------

export const POST = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: { params: { roomId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { roomId } = await params;
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

      const room = await getClassroomAsCreator(roomId, userId);
      const body = await validateBody(req, moduleSchema);

      const existing: CurriculumModule[] = Array.isArray(room.curriculum)
        ? room.curriculum
        : [];

      const newModule: CurriculumModule = {
        title: body.title,
        ...(body.description !== undefined && { description: body.description }),
        ...(body.resources !== undefined && { resources: body.resources }),
      };

      const updated = [...existing, newModule];

      await db.query(
        `UPDATE rooms
         SET curriculum = jsonb_set(
               COALESCE(curriculum, '{}'::jsonb),
               '{modules}',
               $1::jsonb
             ),
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(updated), roomId]
      );

      return NextResponse.json(
        {
          success: true,
          data: { modules: updated, addedIndex: updated.length - 1 },
          error: null,
        },
        { status: 201 }
      );
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/classroom/[roomId]/modules
// ---------------------------------------------------------------------------

export const PATCH = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: { params: { roomId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { roomId } = await params;
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

      const room = await getClassroomAsCreator(roomId, userId);
      const body = await validateBody(req, patchSchema);

      const existing: CurriculumModule[] = Array.isArray(room.curriculum)
        ? room.curriculum
        : [];

      if (body.index < 0 || body.index >= existing.length) {
        throw badRequest(`Module index ${body.index} is out of range`);
      }

      const updated = existing.map((m, i) => {
        if (i !== body.index) return m;
        return {
          title: body.title,
          ...(body.description !== undefined && { description: body.description }),
          ...(body.resources !== undefined && { resources: body.resources }),
        };
      });

      await db.query(
        `UPDATE rooms
         SET curriculum = jsonb_set(
               COALESCE(curriculum, '{}'::jsonb),
               '{modules}',
               $1::jsonb
             ),
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(updated), roomId]
      );

      return NextResponse.json({
        success: true,
        data: { modules: updated, updatedIndex: body.index },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/classroom/[roomId]/modules
// ---------------------------------------------------------------------------

export const DELETE = withAuth(
  async (
    req: NextRequest,
    {
      params,
      auth,
    }: { params: { roomId: string }; auth: { user: { sub: string } } }
  ) => {
    try {
      const { roomId } = await params;
      const userId = auth.user.sub;
      await enforceRateLimit(userId, "user", RATE_LIMITS.apiWrite);

      const room = await getClassroomAsCreator(roomId, userId);
      const body = await validateBody(req, deleteSchema);

      const existing: CurriculumModule[] = Array.isArray(room.curriculum)
        ? room.curriculum
        : [];

      if (body.index < 0 || body.index >= existing.length) {
        throw badRequest(`Module index ${body.index} is out of range`);
      }

      const updated = existing.filter((_, i) => i !== body.index);

      await db.query(
        `UPDATE rooms
         SET curriculum = jsonb_set(
               COALESCE(curriculum, '{}'::jsonb),
               '{modules}',
               $1::jsonb
             ),
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(updated), roomId]
      );

      return NextResponse.json({
        success: true,
        data: { modules: updated, deletedIndex: body.index },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
