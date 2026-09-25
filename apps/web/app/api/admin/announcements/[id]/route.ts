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
import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq, isNull } from "drizzle-orm";

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
      genders: z.array(z.enum(["male", "female", "non_binary", "prefer_not_to_say"])).optional(),
    })
    .optional(),
  displayOrder: z.number().int().min(0).optional(),
});

type RowType = "modal" | "banner" | null;

interface DbRow {
  id: string;
  title: string | null;
  content: string;
  contentType: string;
  linkUrl?: string | null;
  isActive: boolean | null;
  targetPlans: string[] | null;
  targetRoles: string[] | null;
  targetGenders: string[] | null;
  displayOrder: number;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
}

function computeStatus(row: DbRow): "active" | "inactive" | "scheduled" {
  if (!row.isActive) return "inactive";
  if (row.startsAt && new Date(row.startsAt).getTime() > Date.now()) return "scheduled";
  return "active";
}

function toApiAnnouncement(type: "modal" | "banner", row: DbRow) {
  return {
    id: row.id,
    type,
    title: row.title ?? undefined,
    content: row.content,
    status: computeStatus(row),
    audience: { plans: row.targetPlans ?? [], roles: row.targetRoles ?? [], genders: row.targetGenders ?? [] },
    startAt: row.startsAt,
    endAt: row.endsAt,
    displayOrder: row.displayOrder,
  };
}

async function detectRowType(id: string): Promise<RowType> {
  const orm = await getDb();
  const [mRow] = await orm
    .select({ id: schema.announcementModals.id })
    .from(schema.announcementModals)
    .where(and(eq(schema.announcementModals.id, id), isNull(schema.announcementModals.deletedAt)))
    .limit(1);
  if (mRow) return "modal";
  const [bRow] = await orm
    .select({ id: schema.announcementBanners.id })
    .from(schema.announcementBanners)
    .where(and(eq(schema.announcementBanners.id, id), isNull(schema.announcementBanners.deletedAt)))
    .limit(1);
  if (bRow) return "banner";
  return null;
}

async function applyUpdate(
  type: RowType,
  id: string,
  updates: z.infer<typeof UpdateSchema>
): Promise<{ type: "modal" | "banner"; row: DbRow }> {
  if (!type) throw notFound("Announcement not found");

  const orm = await getDb();

  const common: Record<string, unknown> = {};
  if (updates.title !== undefined) common.title = updates.title;
  if (updates.content !== undefined) {
    const ct = updates.contentType ?? "plain";
    common.content = sanitizeAnnouncementContent(updates.content, ct);
  }
  if (updates.contentType !== undefined) common.contentType = updates.contentType;
  if (updates.status !== undefined) common.isActive = updates.status !== "inactive";
  if (updates.startAt !== undefined) common.startsAt = updates.startAt ? new Date(updates.startAt) : null;
  if (updates.endAt !== undefined) common.endsAt = updates.endAt ? new Date(updates.endAt) : null;
  // Native Postgres text[] columns — pass real JS arrays, never JSON.stringify
  // (that produced a malformed array literal and a 500 on every save).
  if (updates.audience?.plans !== undefined) common.targetPlans = updates.audience.plans;
  if (updates.audience?.roles !== undefined) common.targetRoles = updates.audience.roles;
  if (updates.audience?.genders !== undefined) common.targetGenders = updates.audience.genders;
  if (updates.displayOrder !== undefined) common.displayOrder = updates.displayOrder;

  if (type === "modal") {
    const [row] = await orm
      .update(schema.announcementModals)
      .set({ ...common, updatedAt: new Date() })
      .where(and(eq(schema.announcementModals.id, id), isNull(schema.announcementModals.deletedAt)))
      .returning();
    if (!row) throw notFound("Announcement not found");
    return { type, row: row as unknown as DbRow };
  }

  const bannerSet: Record<string, unknown> = { ...common };
  if (updates.linkUrl !== undefined) bannerSet.linkUrl = updates.linkUrl;
  const [row] = await orm
    .update(schema.announcementBanners)
    .set({ ...bannerSet, updatedAt: new Date() })
    .where(and(eq(schema.announcementBanners.id, id), isNull(schema.announcementBanners.deletedAt)))
    .returning();
  if (!row) throw notFound("Announcement not found");
  return { type, row: row as unknown as DbRow };
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

      const orm = await getDb();
      const table = type === "modal" ? schema.announcementModals : schema.announcementBanners;
      const [row] = await orm
        .update(table)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(and(eq(table.id, id), isNull(table.deletedAt)))
        .returning({ id: table.id });
      if (!row) throw notFound("Announcement not found");

      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
