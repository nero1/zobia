export const dynamic = 'force-dynamic';

/**
 * app/api/admin/announcements/banners/[bannerId]/route.ts
 *
 * PUT    /api/admin/announcements/banners/[bannerId] — Update a banner.
 * DELETE /api/admin/announcements/banners/[bannerId] — Soft-delete a banner.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { sanitizeAnnouncementContent } from "@/lib/security/htmlSanitizer";
import { getDb, schema } from "@/lib/db/drizzle";
import { and, eq, isNull } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const UpdateBannerSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(5_000).optional(),
  contentType: z.enum(["html", "markdown", "plain"]).optional(),
  linkUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  targetPlans: z.array(z.string()).optional(),
  targetRoles: z.array(z.string()).optional(),
  displayOrder: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// PUT /api/admin/announcements/banners/[bannerId]
// ---------------------------------------------------------------------------

/**
 * Update an announcement banner's content, schedule, targeting, or status.
 *
 * @returns Updated banner record
 */
export const PUT = withAdminAuth(
  async (
    req: NextRequest,
    {
      auth,
      params,
    }: { auth: { user: { sub: string } }; params: { bannerId: string } }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

      const { bannerId } = params;

      const body = await req.json().catch(() => ({}));
      const parsed = UpdateBannerSchema.safeParse(body);
      if (!parsed.success) {
        throw badRequest("Invalid update payload", parsed.error.flatten());
      }

      const updates = parsed.data;
      if (Object.keys(updates).length === 0) {
        throw badRequest("No fields to update");
      }

      const setValues: Record<string, unknown> = { updatedAt: new Date() };

      if (updates.title !== undefined) setValues.title = updates.title;
      if (updates.content !== undefined) {
        // Sanitize using the new contentType if being updated, otherwise fall back to 'html' for safety
        const effectiveContentType = updates.contentType ?? "html";
        setValues.content = sanitizeAnnouncementContent(updates.content, effectiveContentType);
      }
      if (updates.contentType !== undefined) setValues.contentType = updates.contentType;
      if (updates.linkUrl !== undefined) setValues.linkUrl = updates.linkUrl;
      if (updates.isActive !== undefined) setValues.isActive = updates.isActive;
      if (updates.startsAt !== undefined) setValues.startsAt = updates.startsAt ? new Date(updates.startsAt) : null;
      if (updates.endsAt !== undefined) setValues.endsAt = updates.endsAt ? new Date(updates.endsAt) : null;
      if (updates.targetPlans !== undefined) setValues.targetPlans = updates.targetPlans;
      if (updates.targetRoles !== undefined) setValues.targetRoles = updates.targetRoles;
      if (updates.displayOrder !== undefined) setValues.displayOrder = updates.displayOrder;

      const orm = await getDb();
      const [row] = await orm
        .update(schema.announcementBanners)
        .set(setValues)
        .where(and(eq(schema.announcementBanners.id, bannerId), isNull(schema.announcementBanners.deletedAt)))
        .returning();

      if (!row) {
        throw notFound("Banner not found");
      }

      return NextResponse.json(row);
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/admin/announcements/banners/[bannerId]
// ---------------------------------------------------------------------------

/**
 * Soft-delete an announcement banner.
 *
 * @returns 204 No Content on success
 */
export const DELETE = withAdminAuth(
  async (
    req: NextRequest,
    {
      auth,
      params,
    }: { auth: { user: { sub: string } }; params: { bannerId: string } }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

      const { bannerId } = params;

      const orm = await getDb();
      const [row] = await orm
        .update(schema.announcementBanners)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(and(eq(schema.announcementBanners.id, bannerId), isNull(schema.announcementBanners.deletedAt)))
        .returning({ id: schema.announcementBanners.id });

      if (!row) {
        throw notFound("Banner not found");
      }

      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
