export const dynamic = 'force-dynamic';

/**
 * app/api/admin/announcements/modals/[modalId]/route.ts
 *
 * PUT    /api/admin/announcements/modals/[modalId] — Update a modal.
 * DELETE /api/admin/announcements/modals/[modalId] — Soft-delete a modal.
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

const UpdateModalSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).max(50_000).optional(),
  contentType: z.enum(["html", "markdown", "plain"]).optional(),
  isActive: z.boolean().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  targetPlans: z.array(z.string()).optional(),
  targetRoles: z.array(z.string()).optional(),
  displayOrder: z.number().int().min(0).optional(),
});

// ---------------------------------------------------------------------------
// PUT /api/admin/announcements/modals/[modalId]
// ---------------------------------------------------------------------------

/**
 * Update an announcement modal's content, schedule, targeting, or status.
 *
 * Only provided fields are updated (partial update / PATCH semantics
 * implemented via explicit SET object construction).
 *
 * @returns Updated modal record
 */
export const PUT = withAdminAuth(
  async (
    req: NextRequest,
    {
      auth,
      params,
    }: { auth: { user: { sub: string } }; params: { modalId: string } }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

      const { modalId } = params;

      const body = await req.json().catch(() => ({}));
      const parsed = UpdateModalSchema.safeParse(body);
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
      if (updates.isActive !== undefined) setValues.isActive = updates.isActive;
      if (updates.startsAt !== undefined) setValues.startsAt = updates.startsAt ? new Date(updates.startsAt) : null;
      if (updates.endsAt !== undefined) setValues.endsAt = updates.endsAt ? new Date(updates.endsAt) : null;
      if (updates.targetPlans !== undefined) setValues.targetPlans = updates.targetPlans;
      if (updates.targetRoles !== undefined) setValues.targetRoles = updates.targetRoles;
      if (updates.displayOrder !== undefined) setValues.displayOrder = updates.displayOrder;

      const orm = await getDb();
      const [row] = await orm
        .update(schema.announcementModals)
        .set(setValues)
        .where(and(eq(schema.announcementModals.id, modalId), isNull(schema.announcementModals.deletedAt)))
        .returning();

      if (!row) {
        throw notFound("Modal not found");
      }

      return NextResponse.json(row);
    } catch (err) {
      return handleApiError(err);
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /api/admin/announcements/modals/[modalId]
// ---------------------------------------------------------------------------

/**
 * Soft-delete an announcement modal.
 *
 * Sets deleted_at and deactivates the modal. Existing user_modal_views
 * are preserved for analytics.
 *
 * @returns 204 No Content on success
 */
export const DELETE = withAdminAuth(
  async (
    req: NextRequest,
    {
      auth,
      params,
    }: { auth: { user: { sub: string } }; params: { modalId: string } }
  ) => {
    try {
      await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);

      const { modalId } = params;

      const orm = await getDb();
      const [row] = await orm
        .update(schema.announcementModals)
        .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
        .where(and(eq(schema.announcementModals.id, modalId), isNull(schema.announcementModals.deletedAt)))
        .returning({ id: schema.announcementModals.id });

      if (!row) {
        throw notFound("Modal not found");
      }

      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return handleApiError(err);
    }
  }
);
