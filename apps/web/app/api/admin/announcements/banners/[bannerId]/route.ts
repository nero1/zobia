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
import { db, SqlParam } from "@/lib/db";

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

      const setClauses: string[] = ["updated_at = NOW()"];
      const values: SqlParam[] = [];
      let idx = 1;

      if (updates.title !== undefined) {
        setClauses.push(`title = $${idx++}`);
        values.push(updates.title);
      }
      if (updates.content !== undefined) {
        // Sanitize using the new contentType if being updated, otherwise fall back to 'html' for safety
        const effectiveContentType = updates.contentType ?? "html";
        setClauses.push(`content = $${idx++}`);
        values.push(sanitizeAnnouncementContent(updates.content, effectiveContentType));
      }
      if (updates.contentType !== undefined) {
        setClauses.push(`content_type = $${idx++}`);
        values.push(updates.contentType);
      }
      if (updates.linkUrl !== undefined) {
        setClauses.push(`link_url = $${idx++}`);
        values.push(updates.linkUrl);
      }
      if (updates.isActive !== undefined) {
        setClauses.push(`is_active = $${idx++}`);
        values.push(updates.isActive);
      }
      if (updates.startsAt !== undefined) {
        setClauses.push(`starts_at = $${idx++}`);
        values.push(updates.startsAt);
      }
      if (updates.endsAt !== undefined) {
        setClauses.push(`ends_at = $${idx++}`);
        values.push(updates.endsAt);
      }
      if (updates.targetPlans !== undefined) {
        setClauses.push(`target_plans = $${idx++}`);
        values.push(JSON.stringify(updates.targetPlans));
      }
      if (updates.targetRoles !== undefined) {
        setClauses.push(`target_roles = $${idx++}`);
        values.push(JSON.stringify(updates.targetRoles));
      }
      if (updates.displayOrder !== undefined) {
        setClauses.push(`display_order = $${idx++}`);
        values.push(updates.displayOrder);
      }

      values.push(bannerId);

      const { rows } = await db.query(
        `UPDATE announcement_banners
         SET ${setClauses.join(", ")}
         WHERE id = $${idx} AND deleted_at IS NULL
         RETURNING *`,
        values
      );

      if (!rows[0]) {
        throw notFound("Banner not found");
      }

      return NextResponse.json(rows[0]);
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

      const { rows } = await db.query(
        `UPDATE announcement_banners
         SET deleted_at = NOW(), is_active = false, updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING id`,
        [bannerId]
      );

      if (!rows[0]) {
        throw notFound("Banner not found");
      }

      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
