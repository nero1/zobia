export const dynamic = 'force-dynamic';

/**
 * app/api/admin/announcements/[id]/route.ts
 *
 * PUT   /api/admin/announcements/[id] — Update modal or banner by id.
 * PATCH /api/admin/announcements/[id] — Partial update (e.g. toggle status).
 * DELETE /api/admin/announcements/[id] — Soft-delete.
 *
 * The endpoint tries modals first, then banners, so it works with a unified id.
 * Field names mirror app/api/admin/announcements/route.ts (audience{plans,roles},
 * startAt/endAt, status) — see that file's doc comment for the bug history.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { sanitizeAnnouncementContent } from "@/lib/security/htmlSanitizer";
import { db, SqlParam } from "@/lib/db";

const UpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(50_000).optional(),
  contentType: z.enum(["html", "markdown", "plain"]).optional(),
  linkUrl: z.string().url().nullable().optional(),
  status: z.enum(["active", "inactive", "scheduled"]).optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  audience: z
    .object({
      plans: z.array(z.string()).optional(),
      roles: z.array(z.string()).optional(),
    })
    .optional(),
  displayOrder: z.number().int().min(0).optional(),
});

type RowType = "modal" | "banner" | null;

interface DbRow {
  id: string;
  title: string | null;
  content: string;
  content_type: string;
  link_url?: string | null;
  is_active: boolean;
  target_plans: string[] | null;
  target_roles: string[] | null;
  display_order: number;
  starts_at: string | null;
  ends_at: string | null;
}

function computeStatus(row: DbRow): "active" | "inactive" | "scheduled" {
  if (!row.is_active) return "inactive";
  if (row.starts_at && new Date(row.starts_at).getTime() > Date.now()) return "scheduled";
  return "active";
}

function toApiAnnouncement(type: "modal" | "banner", row: DbRow) {
  return {
    id: row.id,
    type,
    title: row.title ?? undefined,
    content: row.content,
    status: computeStatus(row),
    audience: { plans: row.target_plans ?? [], roles: row.target_roles ?? [] },
    startAt: row.starts_at,
    endAt: row.ends_at,
    displayOrder: row.display_order,
  };
}

async function detectRowType(id: string): Promise<RowType> {
  const { rows: mRows } = await db.query(
    `SELECT id FROM announcement_modals WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  if (mRows[0]) return "modal";
  const { rows: bRows } = await db.query(
    `SELECT id FROM announcement_banners WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [id]
  );
  if (bRows[0]) return "banner";
  return null;
}

const RETURNING_COLUMNS = `id, title, content, content_type, is_active,
                   COALESCE(target_plans, '{}')::text[] AS target_plans,
                   COALESCE(target_roles, '{}')::text[] AS target_roles,
                   display_order, starts_at, ends_at`;

async function applyUpdate(
  type: RowType,
  id: string,
  updates: z.infer<typeof UpdateSchema>
): Promise<{ type: "modal" | "banner"; row: DbRow }> {
  if (!type) throw notFound("Announcement not found");

  const table = type === "modal" ? "announcement_modals" : "announcement_banners";
  const setClauses: string[] = ["updated_at = NOW()"];
  const values: SqlParam[] = [];
  let idx = 1;

  if (updates.title !== undefined) { setClauses.push(`title = $${idx++}`); values.push(updates.title); }
  if (updates.content !== undefined) {
    const ct = updates.contentType ?? "plain";
    setClauses.push(`content = $${idx++}`);
    values.push(sanitizeAnnouncementContent(updates.content, ct));
  }
  if (updates.contentType !== undefined) { setClauses.push(`content_type = $${idx++}`); values.push(updates.contentType); }
  if (updates.status !== undefined) { setClauses.push(`is_active = $${idx++}`); values.push(updates.status !== "inactive"); }
  if (updates.startAt !== undefined) { setClauses.push(`starts_at = $${idx++}`); values.push(updates.startAt); }
  if (updates.endAt !== undefined) { setClauses.push(`ends_at = $${idx++}`); values.push(updates.endAt); }
  // Native Postgres text[] columns — pass real JS arrays, never JSON.stringify
  // (that produced a malformed array literal and a 500 on every save).
  if (updates.audience?.plans !== undefined) { setClauses.push(`target_plans = $${idx++}`); values.push(updates.audience.plans); }
  if (updates.audience?.roles !== undefined) { setClauses.push(`target_roles = $${idx++}`); values.push(updates.audience.roles); }
  if (updates.displayOrder !== undefined) { setClauses.push(`display_order = $${idx++}`); values.push(updates.displayOrder); }
  if (type === "banner" && updates.linkUrl !== undefined) { setClauses.push(`link_url = $${idx++}`); values.push(updates.linkUrl); }

  values.push(id);
  const { rows } = await db.query<DbRow>(
    `UPDATE ${table} SET ${setClauses.join(", ")} WHERE id = $${idx} AND deleted_at IS NULL RETURNING ${RETURNING_COLUMNS}`,
    values
  );
  if (!rows[0]) throw notFound("Announcement not found");
  return { type, row: rows[0] };
}

// ---------------------------------------------------------------------------
// PUT /api/admin/announcements/[id]
// ---------------------------------------------------------------------------

export const PUT = withAdminAuth(
  async (req: NextRequest, { params, auth }: { auth: { user: { sub: string } }; params: { id: string } }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
      const { id } = await params;

      const body = await req.json().catch(() => ({}));
      const parsed = UpdateSchema.safeParse(body);
      if (!parsed.success) throw badRequest("Invalid update payload", parsed.error.flatten());
      if (Object.keys(parsed.data).length === 0) throw badRequest("No fields to update");

      const type = await detectRowType(id);
      const { type: resolvedType, row } = await applyUpdate(type, id, parsed.data);
      return NextResponse.json({ announcement: toApiAnnouncement(resolvedType, row) });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /api/admin/announcements/[id]
// ---------------------------------------------------------------------------

export const PATCH = withAdminAuth(
  async (req: NextRequest, { params, auth }: { auth: { user: { sub: string } }; params: { id: string } }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
      const { id } = await params;

      const body = await req.json().catch(() => ({}));
      const parsed = UpdateSchema.safeParse(body);
      if (!parsed.success) throw badRequest("Invalid update payload", parsed.error.flatten());
      if (Object.keys(parsed.data).length === 0) throw badRequest("No fields to update");

      const type = await detectRowType(id);
      const { type: resolvedType, row } = await applyUpdate(type, id, parsed.data);
      return NextResponse.json({ announcement: toApiAnnouncement(resolvedType, row) });
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/admin/announcements/[id]
// ---------------------------------------------------------------------------

export const DELETE = withAdminAuth(
  async (req: NextRequest, { params, auth }: { auth: { user: { sub: string } }; params: { id: string } }) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
      const { id } = await params;

      const type = await detectRowType(id);
      if (!type) throw notFound("Announcement not found");

      const table = type === "modal" ? "announcement_modals" : "announcement_banners";
      const { rows } = await db.query(
        `UPDATE ${table} SET deleted_at = NOW(), is_active = false, updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
        [id]
      );
      if (!rows[0]) throw notFound("Announcement not found");

      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
