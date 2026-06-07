/**
 * app/api/admin/footer-scripts/[scriptId]/route.ts
 *
 * GET    /api/admin/footer-scripts/[scriptId]  — Get a single footer script.
 * PATCH  /api/admin/footer-scripts/[scriptId]  — Update a footer script.
 * DELETE /api/admin/footer-scripts/[scriptId]  — Delete a footer script.
 *
 * Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { db, SqlParam } from "@/lib/db";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PatchScriptSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(100_000).optional(),
  isActive: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FooterScriptRow {
  id: string;
  name: string;
  content: string;
  is_active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

interface RouteParams {
  scriptId: string;
}

function formatScript(row: FooterScriptRow) {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    isActive: row.is_active,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// GET /api/admin/footer-scripts/[scriptId]
// ---------------------------------------------------------------------------

export const GET = withAdminAuth<RouteParams>(
  async (_req: NextRequest, { params }) => {
    try {
      const { scriptId } = params;

      const { rows } = await db.query<FooterScriptRow>(
        `SELECT id, name, content, is_active, position, created_at, updated_at
         FROM footer_scripts
         WHERE id = $1`,
        [scriptId]
      );

      if (!rows[0]) throw notFound("Footer script not found");

      return NextResponse.json({
        success: true,
        data: { script: formatScript(rows[0]) },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/admin/footer-scripts/[scriptId]
// ---------------------------------------------------------------------------

export const PATCH = withAdminAuth<RouteParams>(
  async (req: NextRequest, { params }) => {
    try {
      const { scriptId } = params;

      let body: unknown;
      try {
        body = await req.json();
      } catch {
        throw badRequest("Invalid JSON body");
      }

      const parsed = PatchScriptSchema.safeParse(body);
      if (!parsed.success) {
        throw badRequest(parsed.error.errors.map((e) => e.message).join(", "));
      }

      const updates: string[] = [];
      const values: SqlParam[] = [scriptId];
      let idx = 2;

      const { name, content, isActive, position } = parsed.data;

      if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
      if (content !== undefined) { updates.push(`content = $${idx++}`); values.push(content); }
      if (isActive !== undefined) { updates.push(`is_active = $${idx++}`); values.push(isActive); }
      if (position !== undefined) { updates.push(`position = $${idx++}`); values.push(position); }

      if (updates.length === 0) {
        throw badRequest("No fields provided to update");
      }

      updates.push(`updated_at = NOW()`);

      const { rows } = await db.query<FooterScriptRow>(
        `UPDATE footer_scripts
         SET ${updates.join(", ")}
         WHERE id = $1
         RETURNING id, name, content, is_active, position, created_at, updated_at`,
        values
      );

      if (!rows[0]) throw notFound("Footer script not found");

      return NextResponse.json({
        success: true,
        data: { script: formatScript(rows[0]) },
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/admin/footer-scripts/[scriptId]
// ---------------------------------------------------------------------------

export const DELETE = withAdminAuth<RouteParams>(
  async (_req: NextRequest, { params }) => {
    try {
      const { scriptId } = params;

      const { rowCount } = await db.query(
        `DELETE FROM footer_scripts WHERE id = $1`,
        [scriptId]
      );

      if (!rowCount) throw notFound("Footer script not found");

      return NextResponse.json({
        success: true,
        data: null,
        error: null,
      });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
