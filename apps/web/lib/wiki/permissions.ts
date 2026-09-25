/**
 * lib/wiki/permissions.ts
 *
 * Per-wiki authorization checks. Always re-reads the database — never
 * trusts a cached/JWT claim, same discipline as lib/auth/roles.ts.
 */

import { and, eq, isNull, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/drizzle";
import { getStaffRoles } from "@/lib/auth/roles";

export interface WikiRow {
  id: string;
  owner_id: string;
  contribute_policy: string;
  status: string;
}

export async function getWikiForPermissionCheck(wikiId: string): Promise<WikiRow | null> {
  const orm = await getDb();
  const [row] = await orm
    .select({
      id: schema.wikis.id,
      ownerId: schema.wikis.ownerId,
      contributePolicy: schema.wikis.contributePolicy,
      status: schema.wikis.status,
    })
    .from(schema.wikis)
    .where(and(eq(schema.wikis.id, wikiId), isNull(schema.wikis.deletedAt)))
    .limit(1);
  if (!row) return null;
  return { id: row.id, owner_id: row.ownerId, contribute_policy: row.contributePolicy, status: row.status };
}

/** True when the user is an active collaborator (any role) on the wiki. */
export async function isActiveCollaborator(wikiId: string, userId: string): Promise<boolean> {
  const orm = await getDb();
  const [row] = await orm
    .select({ id: schema.wikiCollaborators.id })
    .from(schema.wikiCollaborators)
    .where(
      and(
        eq(schema.wikiCollaborators.wikiId, wikiId),
        eq(schema.wikiCollaborators.userId, userId),
        eq(schema.wikiCollaborators.status, "active")
      )
    )
    .limit(1);
  return !!row;
}

/** True when the user holds is_moderator on this wiki (does NOT check platform staff or ownership). */
export async function isWikiModerator(wikiId: string, userId: string): Promise<boolean> {
  const orm = await getDb();
  const [row] = await orm
    .select({ id: schema.wikiCollaborators.id })
    .from(schema.wikiCollaborators)
    .where(
      and(
        eq(schema.wikiCollaborators.wikiId, wikiId),
        eq(schema.wikiCollaborators.userId, userId),
        eq(schema.wikiCollaborators.status, "active"),
        eq(schema.wikiCollaborators.isModerator, true)
      )
    )
    .limit(1);
  return !!row;
}

async function areFriends(userA: string, userB: string): Promise<boolean> {
  const orm = await getDb();
  const [row] = await orm
    .select({ id: schema.friendships.id })
    .from(schema.friendships)
    .where(
      and(
        eq(schema.friendships.status, "accepted"),
        or(
          and(eq(schema.friendships.requesterId, userA), eq(schema.friendships.addresseeId, userB)),
          and(eq(schema.friendships.requesterId, userB), eq(schema.friendships.addresseeId, userA))
        )
      )
    )
    .limit(1);
  return !!row;
}

/**
 * Owner, wiki moderators, and platform staff (mods/admins) can always
 * manage/moderate a wiki (settings, moderators, invites, deleting any page),
 * regardless of contribute_policy. Never trust a cached role — always
 * re-reads the database.
 */
export async function canManageWiki(wiki: WikiRow, userId: string): Promise<boolean> {
  if (wiki.owner_id === userId) return true;
  const [isMod, staff] = await Promise.all([isWikiModerator(wiki.id, userId), getStaffRoles(userId)]);
  return isMod || staff.isAdmin || staff.isModerator;
}

/**
 * Can this user create/edit pages on this wiki? Owner, wiki moderators, and
 * platform staff always can. Otherwise gated by the wiki's contribute_policy:
 * 'everyone' — any signed-in user; 'friends' — the owner's accepted
 * friendships; 'selected' — only users with an active wiki_collaborators row.
 */
export async function canContributeToWiki(wiki: WikiRow, userId: string): Promise<boolean> {
  if (await canManageWiki(wiki, userId)) return true;
  if (wiki.status !== "active" && wiki.status !== "paused") return false;

  switch (wiki.contribute_policy) {
    case "everyone":
      return true;
    case "friends":
      return areFriends(wiki.owner_id, userId);
    case "selected":
      return isActiveCollaborator(wiki.id, userId);
    default:
      return false;
  }
}
