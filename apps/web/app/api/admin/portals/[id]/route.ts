export const dynamic = 'force-dynamic';

/**
 * app/api/admin/portals/[id]/route.ts
 *
 * GET    /api/admin/portals/<id>   portal + 30-day analytics + merged aliases
 * PATCH  /api/admin/portals/<id>   edit copy/cover/sections/boost/sponsor, or
 *                                  change status (promote auto->official,
 *                                  suppress, archive, restore)
 * DELETE /api/admin/portals/<id>   delete the portal (the hashtag stays)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest, notFound } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";
import { deletePortal, getPortalById, getPortalStats, listAliasesFor, updatePortal } from "@/lib/portals/repo";
import { patchPortalSchema } from "@/lib/portals/schemas";
import { invalidatePortalCache } from "@/lib/portals/cache";
import { invalidateSuggestionCache } from "@/lib/portals/suggestions";

const idSchema = z.string().uuid();

export const GET = withAdminAuth<{ id: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const id = idSchema.safeParse(params.id);
    if (!id.success) throw badRequest("Invalid portal id");
    const row = await getPortalById(id.data);
    if (!row) throw notFound("Portal not found");
    const [stats, aliases] = await Promise.all([getPortalStats(row.id, 30), listAliasesFor(row.hashtagId)]);
    return NextResponse.json({ success: true, data: { portal: row, stats, aliases }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const PATCH = withAdminAuth<{ id: string }>(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const id = idSchema.safeParse(params.id);
    if (!id.success) throw badRequest("Invalid portal id");
    const body = await validateBody(req, patchPortalSchema);
    const row = await updatePortal(id.data, { ...body, sections: body.sections as never });
    await Promise.all([invalidatePortalCache(row.id), invalidateSuggestionCache()]);
    writeAuditLog({ actorId: auth.user.sub, action: "admin_portal_update", targetType: "portal", targetId: row.id, metadata: { slug: row.slug, fields: Object.keys(body) } });
    return NextResponse.json({ success: true, data: { portal: row }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const DELETE = withAdminAuth<{ id: string }>(async (_req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const id = idSchema.safeParse(params.id);
    if (!id.success) throw badRequest("Invalid portal id");
    const row = await getPortalById(id.data);
    if (!row) throw notFound("Portal not found");
    await deletePortal(row.id);
    await Promise.all([invalidatePortalCache(row.id), invalidateSuggestionCache()]);
    writeAuditLog({ actorId: auth.user.sub, action: "admin_portal_delete", targetType: "portal", targetId: row.id, metadata: { slug: row.slug } });
    return NextResponse.json({ success: true, data: { deleted: true }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});
