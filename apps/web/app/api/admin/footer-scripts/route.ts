export const dynamic = 'force-dynamic';

/**
 * app/api/admin/footer-scripts/route.ts
 *
 * GET  /api/admin/footer-scripts  — List all footer scripts ordered by position.
 * POST /api/admin/footer-scripts  — Create a new footer script.
 *
 * Admin only.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const CreateScriptSchema = z.object({
  name: z.string().min(1).max(200),
  content: z.string().min(1).max(100_000),
  isActive: z.boolean().optional().default(true),
  position: z.number().int().min(0).optional().default(0),
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
// GET /api/admin/footer-scripts
// ---------------------------------------------------------------------------

/**
 * List all footer scripts ordered by position.
 *
 * @returns Array of all footer scripts
 */
export const GET = withAdminAuth(async (_req: NextRequest) => {
  try {
    const { rows } = await db.query<FooterScriptRow>(
      `SELECT id, name, content, is_active, position, created_at, updated_at
       FROM footer_scripts
       ORDER BY position ASC, created_at ASC`
    );

    return NextResponse.json({
      success: true,
      data: { scripts: rows.map(formatScript) },
      error: null,
    });
  } catch (err) {
    return handleApiError(err);
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/footer-scripts
// ---------------------------------------------------------------------------

/**
 * Create a new footer script.
 *
 * @returns Created footer script record
 */
export const POST = withAdminAuth(async (req: NextRequest) => {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw badRequest("Invalid JSON body");
    }

    const parsed = CreateScriptSchema.safeParse(body);
    if (!parsed.success) {
      throw badRequest(parsed.error.errors.map((e) => e.message).join(", "));
    }

    const { name, content, isActive, position } = parsed.data;

    const { rows } = await db.query<FooterScriptRow>(
      `INSERT INTO footer_scripts (name, content, is_active, position, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, name, content, is_active, position, created_at, updated_at`,
      [name, content, isActive, position]
    );

    return NextResponse.json(
      {
        success: true,
        data: { script: formatScript(rows[0]) },
        error: null,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
