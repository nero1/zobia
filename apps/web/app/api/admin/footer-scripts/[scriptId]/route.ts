export const dynamic = 'force-dynamic';

/**
 * app/api/admin/footer-scripts/[scriptId]/route.ts
 *
 * GET    /api/admin/footer-scripts/[scriptId]  — Get a single footer script.
 * PATCH  /api/admin/footer-scripts/[scriptId]  — Update a footer script.
 * DELETE /api/admin/footer-scripts/[scriptId]  — Delete a footer script.
 *
 * Admin only.
 *
 * SECURITY WARNING: Footer script content is intentionally raw <script> HTML
 * injected into the page via dangerouslySetInnerHTML. This endpoint is
 * protected by withAdminAuth (admin-level trust required). Footer scripts
 * intentionally bypass XSS protection — only trusted admins should have access.
 * Any compromise of admin credentials would allow arbitrary script injection.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { normalizeFooterScriptContent } from "@/lib/admin/footerScriptNormalize";

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

/** Adapts a Drizzle `footerScripts` select row to the legacy snake_case shape. */
function toFooterScriptRow(row: typeof schema.footerScripts.$inferSelect): FooterScriptRow {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    is_active: row.isActive ?? false,
    position: row.position ?? 0,
    created_at: row.createdAt ? row.createdAt.toISOString() : new Date().toISOString(),
    updated_at: row.updatedAt ? row.updatedAt.toISOString() : new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// GET /api/admin/footer-scripts/[scriptId]
// ---------------------------------------------------------------------------

export const GET = withAdminAuth<RouteParams>(
  async (_req: NextRequest, { params }) => {
    try {
      const { scriptId } = params;

      const orm = await getDb();
      const [row] = await orm
        .select()
        .from(schema.footerScripts)
        .where(eq(schema.footerScripts.id, scriptId));

      if (!row) throw notFound("Footer script not found");

      return NextResponse.json({
        success: true,
        data: { script: formatScript(toFooterScriptRow(row)) },
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

      const { name, content, isActive, position } = parsed.data;

      const updates: Partial<typeof schema.footerScripts.$inferInsert> = {};
      if (name !== undefined) updates.name = name;
      if (content !== undefined) {
        const normalizedContent = normalizeFooterScriptContent(content);
        if (!normalizedContent) throw badRequest("Script content is empty after normalization.");
        updates.content = normalizedContent;
      }
      if (isActive !== undefined) updates.isActive = isActive;
      if (position !== undefined) updates.position = position;

      if (Object.keys(updates).length === 0) {
        throw badRequest("No fields provided to update");
      }

      updates.updatedAt = new Date();

      const orm = await getDb();
      const [row] = await orm
        .update(schema.footerScripts)
        .set(updates)
        .where(eq(schema.footerScripts.id, scriptId))
        .returning();

      if (!row) throw notFound("Footer script not found");

      return NextResponse.json({
        success: true,
        data: { script: formatScript(toFooterScriptRow(row)) },
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

      const orm = await getDb();
      const deleted = await orm
        .delete(schema.footerScripts)
        .where(eq(schema.footerScripts.id, scriptId))
        .returning({ id: schema.footerScripts.id });

      if (deleted.length === 0) throw notFound("Footer script not found");

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
