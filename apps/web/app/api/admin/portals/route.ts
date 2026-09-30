export const dynamic = 'force-dynamic';

/**
 * app/api/admin/portals/route.ts
 *
 * GET  /api/admin/portals?status=official,auto&q=&sort=&limit=&offset=
 *   Admin table: every portal (any status) with window activity, boost state
 *   and follower counts.
 *
 * POST /api/admin/portals
 *   Create an official, admin-curated portal for a hashtag slug (creating the
 *   hashtag if it has never been used), or promote the existing auto portal
 *   for that tag in place.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withAdminAuth, validateBody } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { writeAuditLog } from "@/lib/audit/auditLog";
import { loadManifest } from "@/lib/manifest";
import { listPortals, upsertOfficialPortal } from "@/lib/portals/repo";
import { createPortalSchema } from "@/lib/portals/schemas";
import { invalidateSuggestionCache } from "@/lib/portals/suggestions";
import type { PortalStatus } from "@zobia/shared/types";

const querySchema = z.object({
  status: z.string().optional(),
  q: z.string().trim().max(60).optional(),
  sort: z.enum(["trending", "followers", "new", "boost"]).default("new"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

const STATUSES: PortalStatus[] = ["official", "auto", "archived", "suppressed"];

export const GET = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) throw badRequest("Invalid query", { issues: parsed.error.issues });
    const statuses = (parsed.data.status?.split(",") ?? STATUSES).filter((s): s is PortalStatus => STATUSES.includes(s as PortalStatus));

    const manifest = await loadManifest();
    const { rows, cards, total } = await listPortals(
      { statuses: statuses.length > 0 ? statuses : STATUSES, q: parsed.data.q, sort: parsed.data.sort, limit: parsed.data.limit, offset: parsed.data.offset },
      manifest.portals.trendingWindowHours
    );
    const portals = rows.map((row, i) => ({
      ...cards[i],
      description: row.description,
      city: row.city,
      bbBoardId: row.bbBoardId,
      sections: row.sections,
      isPinned: row.isPinned,
      boostWeight: row.boostWeight,
      boostStartsAt: row.boostStartsAt,
      boostEndsAt: row.boostEndsAt,
      sponsoredUntil: row.sponsoredUntil,
      lastActivityAt: row.lastActivityAt,
      createdAt: row.createdAt,
    }));
    return NextResponse.json({ success: true, data: { portals, total }, error: null });
  } catch (err) {
    return handleApiError(err);
  }
});

export const POST = withAdminAuth(async (req: NextRequest, { auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.admin);
    const body = await validateBody(req, createPortalSchema);
    const row = await upsertOfficialPortal({ ...body, sections: body.sections as never }, auth.user.sub);
    await invalidateSuggestionCache();
    writeAuditLog({ actorId: auth.user.sub, action: "admin_portal_upsert", targetType: "portal", targetId: row.id, metadata: { slug: row.slug } });
    return NextResponse.json({ success: true, data: { portal: row }, error: null }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
});
