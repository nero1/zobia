export const dynamic = 'force-dynamic';

/**
 * app/api/admin/footer-scripts/route.ts
 *
 * GET  /api/admin/footer-scripts  — List all footer scripts ordered by position.
 * POST /api/admin/footer-scripts  — Create a new footer script.
 *
 * Admin only. SECURITY: this endpoint is restricted to admin-authenticated
 * users and all write operations are audit-logged to system_alerts.
 *
 * SECURITY WARNING: Footer script content is intentionally raw <script> HTML
 * injected into the page via dangerouslySetInnerHTML. This endpoint is
 * protected by withAdminAuth (admin-level trust required). Footer scripts
 * intentionally bypass XSS protection — only trusted admins should have access.
 * Any compromise of admin credentials would allow arbitrary script injection.
 * All mutations are audit-logged so any unauthorized use can be detected.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { asc } from "drizzle-orm";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { getDb, schema } from "@/lib/db/drizzle";
import { normalizeFooterScriptContent } from "@/lib/admin/footerScriptNormalize";
import { raiseAlert } from "@/lib/alerts/dispatch";

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

type FooterScriptRow = typeof schema.footerScripts.$inferSelect;

function formatScript(row: FooterScriptRow) {
  return {
    id: row.id,
    name: row.name,
    content: row.content,
    isActive: row.isActive,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
    const orm = await getDb();
    const rows = await orm
      .select()
      .from(schema.footerScripts)
      .orderBy(asc(schema.footerScripts.position), asc(schema.footerScripts.createdAt));

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
export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
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
    const normalizedContent = normalizeFooterScriptContent(content);
    if (!normalizedContent) {
      throw badRequest("Script content is empty after normalization.");
    }

    const orm = await getDb();
    const [row] = await orm
      .insert(schema.footerScripts)
      .values({ name, content: normalizedContent, isActive, position })
      .returning();

    // BUG-020: Audit-log all footer script writes — raw script injection is
    // high-risk and must be attributable to a specific admin user.
    await raiseAlert(orm, {
      type: "footer_script_created",
      category: "security",
      priorityLevel: 6,
      title: "Footer script created",
      message: `Footer script "${name}" created by admin ${auth.user.sub}`,
      metadata: { scriptId: row.id, name, adminId: auth.user.sub },
    }).catch(() => {});

    return NextResponse.json(
      {
        success: true,
        data: { script: formatScript(row) },
        error: null,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleApiError(err);
  }
});
