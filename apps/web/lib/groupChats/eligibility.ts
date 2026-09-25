/**
 * lib/groupChats/eligibility.ts
 *
 * How many *concurrently active* group chats a user's plan/business tier/
 * guild ownership allows them to create — shared between group creation
 * (app/api/messages/group/route.ts) and reactivation
 * (app/api/messages/group/[groupId]/reactivate/route.ts), which re-checks
 * the same limit since a reactivated group counts against it again.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { loadManifest } from "@/lib/manifest";

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
  const orm = await getDb();

  const [user] = await orm
    .select({
      plan: schema.users.plan,
      businessTier: schema.businessAccounts.tier,
      businessStatus: schema.businessAccounts.status,
    })
    .from(schema.users)
    .leftJoin(
      schema.businessAccounts,
      and(eq(schema.businessAccounts.userId, schema.users.id), eq(schema.businessAccounts.status, "active"))
    )
    .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
    .limit(1);
  if (!user) return { allowed: false, limit: 0, active: 0, isGuildOwner: false };

  const [guildRow] = await orm
    .select({ id: schema.guilds.id })
    .from(schema.guilds)
    .where(and(eq(schema.guilds.captainId, userId), eq(schema.guilds.isActive, true), isNull(schema.guilds.deletedAt)))
    .limit(1);
  const isGuildOwner = !!guildRow;

  let limit: number;
  if (user.businessTier === "starter") limit = limits.businessStarter;
  else if (user.businessTier === "growth") limit = limits.businessGrowth;
  else if (user.businessTier === "enterprise") limit = limits.businessEnterprise;
  else {
    limit = limits[(user.plan ?? "free") as keyof typeof limits] ?? limits.free;
  }
  if (isGuildOwner) limit = Math.max(limit, 1);

  // NOTE: `group_chats.is_deactivated` is not present on `schema.groupChats`
  // in lib/db/schema.ts (schema/DB mismatch — reported upstream, see
  // lib/plans/groupChatSweep.ts), so this uses Drizzle's `sql` tag directly
  // rather than the query builder for that one predicate.
  const result = await orm.execute<{ cnt: string }>(sql`
    SELECT COUNT(*)::text AS cnt FROM group_chats
    WHERE creator_id = ${userId} AND is_active = TRUE AND is_deactivated = FALSE
  `);
  const active = parseInt(result.rows[0]?.cnt ?? "0", 10);

  return { allowed: active < limit, limit, active, isGuildOwner };
}
