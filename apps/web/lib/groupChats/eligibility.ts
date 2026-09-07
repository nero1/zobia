/**
 * lib/groupChats/eligibility.ts
 *
 * How many *concurrently active* group chats a user's plan/business tier/
 * guild ownership allows them to create — shared between group creation
 * (app/api/messages/group/route.ts) and reactivation
 * (app/api/messages/group/[groupId]/reactivate/route.ts), which re-checks
 * the same limit since a reactivated group counts against it again.
 */

import { db } from "@/lib/db";
import { loadManifest } from "@/lib/manifest";

interface CreatorEligibilityRow {
  plan: string;
  business_tier: string | null;
  business_status: string | null;
}

export interface GroupCreationEligibility {
  allowed: boolean;
  limit: number;
  active: number;
  isGuildOwner: boolean;
}

/**
 * Resolve how many *concurrently active* group chats a user is allowed to
 * create, and how many they already have. Guild owners (captain_id) may
 * always create at least one group regardless of personal plan — the
 * business/plan limit is used as a floor beneath that when it is higher.
 */
export async function resolveGroupCreationEligibility(
  userId: string
): Promise<GroupCreationEligibility> {
  const manifest = await loadManifest();
  const limits = manifest.groupChatCreationLimits;

  const { rows: userRows } = await db.query<CreatorEligibilityRow>(
    `SELECT COALESCE(u.plan, 'free') AS plan, ba.tier AS business_tier, ba.status AS business_status
     FROM users u
     LEFT JOIN business_accounts ba ON ba.user_id = u.id AND ba.status = 'active'
     WHERE u.id = $1 AND u.deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  const user = userRows[0];
  if (!user) return { allowed: false, limit: 0, active: 0, isGuildOwner: false };

  const { rows: guildRows } = await db.query<{ id: string }>(
    `SELECT id FROM guilds WHERE captain_id = $1 AND is_active = TRUE AND deleted_at IS NULL LIMIT 1`,
    [userId]
  );
  const isGuildOwner = guildRows.length > 0;

  let limit: number;
  if (user.business_tier === "starter") limit = limits.businessStarter;
  else if (user.business_tier === "growth") limit = limits.businessGrowth;
  else if (user.business_tier === "enterprise") limit = limits.businessEnterprise;
  else {
    limit = limits[user.plan as keyof typeof limits] ?? limits.free;
  }
  if (isGuildOwner) limit = Math.max(limit, 1);

  const { rows: countRows } = await db.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM group_chats
     WHERE creator_id = $1 AND is_active = TRUE AND is_deactivated = FALSE`,
    [userId]
  );
  const active = parseInt(countRows[0]?.cnt ?? "0", 10);

  return { allowed: active < limit, limit, active, isGuildOwner };
}
