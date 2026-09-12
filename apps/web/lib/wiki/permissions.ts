/**
 * lib/wiki/permissions.ts
 *
 * Per-wiki authorization checks. Always re-reads the database — never
 * trusts a cached/JWT claim, same discipline as lib/auth/roles.ts.
 */

import { db } from "@/lib/db";
import { getStaffRoles } from "@/lib/auth/roles";

export interface WikiRow {
  id: string;
  owner_id: string;
  contribute_policy: string;
  status: string;
}

export async function getWikiForPermissionCheck(wikiId: string): Promise<WikiRow | null> {
  const { rows } = await db.query<WikiRow>(
    `SELECT id, owner_id, contribute_policy, status FROM wikis WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [wikiId]
  );
  return rows[0] ?? null;
}

/** True when the user is an active collaborator (any role) on the wiki. */
export async function isActiveCollaborator(wikiId: string, userId: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM wiki_collaborators WHERE wiki_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1`,
    [wikiId, userId]
  );
  return !!rows[0];
}

/** True when the user holds is_moderator on this wiki (does NOT check platform staff or ownership). */
export async function isWikiModerator(wikiId: string, userId: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM wiki_collaborators WHERE wiki_id = $1 AND user_id = $2 AND status = 'active' AND is_moderator = true LIMIT 1`,
    [wikiId, userId]
  );
  return !!rows[0];
}

async function areFriends(userA: string, userB: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM friendships
     WHERE status = 'accepted'
       AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
     LIMIT 1`,
    [userA, userB]
  );
  return !!rows[0];
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
