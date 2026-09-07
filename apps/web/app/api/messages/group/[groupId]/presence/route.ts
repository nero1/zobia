export const dynamic = "force-dynamic";

/**
 * app/api/messages/group/[groupId]/presence/route.ts
 *
 * POST /api/messages/group/:groupId/presence
 *
 * Live-presence heartbeat + soft concurrent-cap admission. Clients call this
 * on entering a group chat and then every ~45s while viewing it. Mirrors
 * app/api/rooms/[roomId]/presence/route.ts exactly.
 *
 * Soft cap: the group creator and admins always get in; everyone else is
 * admitted only while the live count is below the group's effective
 * concurrent cap (per-group `concurrent_cap` override, else the manifest
 * default). This is separate from `max_members` (total membership).
 *
 * Response (always 200 so heartbeats never error):
 *   { admitted: boolean, full: boolean, presentCount: number, cap: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, notFound, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { loadManifest } from "@/lib/manifest";
import { resolveGroupConcurrentCap } from "@/lib/groupChats/capacity";
import { admitGroupPresence } from "@/lib/presence/group";

interface GroupRow {
  creator_id: string;
  concurrent_cap: number | null;
  is_active: boolean;
  is_deactivated: boolean;
}

export const POST = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const { groupId } = (await params) as { groupId: string };
    if (!groupId || groupId === "undefined") throw badRequest("groupId is required");

    const userId = auth.user.sub;

    const { rows } = await db.query<GroupRow>(
      `SELECT creator_id, concurrent_cap, is_active, is_deactivated FROM group_chats WHERE id = $1`,
      [groupId],
    );
    const group = rows[0];
    if (!group || !group.is_active || group.is_deactivated) throw notFound("Group not found");

    // Privileged = creator or an admin member — these always bypass the cap.
    let privileged = group.creator_id === userId;
    if (!privileged) {
      const { rows: memberRows } = await db.query<{ role: string }>(
        `SELECT role FROM group_chat_members WHERE group_chat_id = $1 AND user_id = $2 LIMIT 1`,
        [groupId, userId],
      );
      privileged = memberRows[0]?.role === "admin";
    }

    const manifest = await loadManifest();
    const cap = resolveGroupConcurrentCap(group.concurrent_cap, manifest);

    const { admitted, count } = await admitGroupPresence(groupId, userId, cap, privileged);

    return NextResponse.json(
      { admitted, full: !admitted, presentCount: count, cap },
      { status: 200 },
    );
  } catch (err) {
    return handleApiError(err);
  }
});
