/**
 * lib/wiki/repo.ts
 *
 * Wikis — read queries (discovery, single wiki/page lookups, listings).
 * Mirrors lib/blogs/repo.ts's cursor-pagination and row-shape conventions.
 */

import { db } from "@/lib/db";
import type { SqlParam, TransactionClient } from "@/lib/db/interface";

export interface WikiSummaryRow {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  contribute_policy: string;
  status: string;
  page_count: number;
  contributor_count: number;
  view_count: number;
  created_at: string;
  owner_username: string | null;
}

export type WikiTab = "popular" | "trending" | "new" | "random";

const WIKI_SELECT = `
  SELECT w.id, w.owner_id, w.slug, w.name, w.description, w.avatar_url, w.cover_image_url,
         w.contribute_policy, w.status, w.page_count, w.contributor_count, w.view_count, w.created_at,
         u.username AS owner_username
  FROM wikis w
  JOIN users u ON u.id = w.owner_id
  WHERE w.status = 'active' AND w.deleted_at IS NULL
`;

export interface ListWikisResult {
  wikis: WikiSummaryRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function listWikis(
  tab: WikiTab,
  cursor: string | null,
  limit: number,
  search?: string
): Promise<ListWikisResult> {
  const params: SqlParam[] = [];
  let where = "";
  if (search?.trim()) {
    params.push(`%${search.trim()}%`);
    where += ` AND w.name ILIKE $${params.length}`;
  }

  let orderBy = "w.view_count DESC, w.page_count DESC";
  if (tab === "trending") orderBy = "w.edit_count DESC, w.updated_at DESC";
  else if (tab === "new") orderBy = "w.created_at DESC";
  else if (tab === "random") orderBy = "RANDOM()";

  let cursorClause = "";
  if (cursor && tab !== "random") {
    params.push(cursor);
    cursorClause = ` AND w.id < $${params.length}::uuid`;
  }

  params.push(limit + 1);
  const { rows } = await db.query<WikiSummaryRow>(
    `${WIKI_SELECT}${where}${cursorClause} ORDER BY ${orderBy} LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    wikis: page,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    hasMore,
  };
}

export interface WikiRow extends WikiSummaryRow {
  status_reason: string | null;
  edit_count: number;
  owner_display_name: string | null;
  owner_avatar_url: string | null;
}

export async function getWikiBySlug(slug: string): Promise<WikiRow | null> {
  const { rows } = await db.query<WikiRow>(
    `SELECT w.*, u.username AS owner_username, u.display_name AS owner_display_name, u.avatar_url AS owner_avatar_url
     FROM wikis w JOIN users u ON u.id = w.owner_id
     WHERE w.slug = $1 AND w.deleted_at IS NULL LIMIT 1`,
    [slug]
  );
  return rows[0] ?? null;
}

export async function getWikiById(id: string): Promise<WikiRow | null> {
  const { rows } = await db.query<WikiRow>(
    `SELECT w.*, u.username AS owner_username, u.display_name AS owner_display_name, u.avatar_url AS owner_avatar_url
     FROM wikis w JOIN users u ON u.id = w.owner_id
     WHERE w.id = $1 AND w.deleted_at IS NULL LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function getWikisOwnedBy(ownerId: string): Promise<WikiRow[]> {
  const { rows } = await db.query<WikiRow>(
    `SELECT w.*, u.username AS owner_username, u.display_name AS owner_display_name, u.avatar_url AS owner_avatar_url
     FROM wikis w JOIN users u ON u.id = w.owner_id
     WHERE w.owner_id = $1 AND w.deleted_at IS NULL
     ORDER BY w.created_at DESC`,
    [ownerId]
  );
  return rows;
}

/** Wikis a user actively collaborates on (any role), excluding ones they own. */
export async function getWikisContributedTo(userId: string): Promise<WikiRow[]> {
  const { rows } = await db.query<WikiRow>(
    `SELECT w.*, u.username AS owner_username, u.display_name AS owner_display_name, u.avatar_url AS owner_avatar_url
     FROM wikis w
     JOIN users u ON u.id = w.owner_id
     JOIN wiki_collaborators c ON c.wiki_id = w.id AND c.user_id = $1 AND c.status = 'active'
     WHERE w.deleted_at IS NULL AND w.owner_id != $1
     ORDER BY w.updated_at DESC`,
    [userId]
  );
  return rows;
}

export async function countOwnedWikis(ownerId: string, tx?: TransactionClient): Promise<number> {
  const client = tx ?? db;
  const { rows } = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM wikis WHERE owner_id = $1 AND deleted_at IS NULL AND status != 'deactivated'`,
    [ownerId]
  );
  return parseInt(rows[0]?.count ?? "0", 10);
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export interface WikiPageSummaryRow {
  id: string;
  wiki_id: string;
  slug: string;
  title: string;
  status: string;
  revision_count: number;
  view_count: number;
  created_by: string;
  last_edited_by: string | null;
  created_at: string;
  updated_at: string;
}

export async function listWikiPages(
  wikiId: string,
  opts: { cursor?: string | null; limit: number; search?: string }
): Promise<{ pages: WikiPageSummaryRow[]; nextCursor: string | null; hasMore: boolean }> {
  const params: SqlParam[] = [wikiId];
  let where = "WHERE p.wiki_id = $1 AND p.deleted_at IS NULL AND p.status = 'published'";

  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim()}%`);
    where += ` AND p.title ILIKE $${params.length}`;
  }
  if (opts.cursor) {
    params.push(opts.cursor);
    where += ` AND p.id < $${params.length}::uuid`;
  }

  params.push(opts.limit + 1);
  const { rows } = await db.query<WikiPageSummaryRow>(
    `SELECT p.id, p.wiki_id, p.slug, p.title, p.status, p.revision_count, p.view_count,
            p.created_by, p.last_edited_by, p.created_at, p.updated_at
     FROM wiki_pages p
     ${where}
     ORDER BY p.title ASC
     LIMIT $${params.length}`,
    params
  );

  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  return {
    pages: page,
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
    hasMore,
  };
}

export interface WikiPageRow extends WikiPageSummaryRow {
  content_markdown: string;
  content_html: string;
  content_format: string;
  creator_username: string | null;
  last_editor_username: string | null;
}

export async function getWikiPageBySlug(wikiId: string, pageSlug: string): Promise<WikiPageRow | null> {
  const { rows } = await db.query<WikiPageRow>(
    `SELECT p.*, cu.username AS creator_username, eu.username AS last_editor_username
     FROM wiki_pages p
     JOIN users cu ON cu.id = p.created_by
     LEFT JOIN users eu ON eu.id = p.last_edited_by
     WHERE p.wiki_id = $1 AND p.slug = $2 AND p.deleted_at IS NULL LIMIT 1`,
    [wikiId, pageSlug]
  );
  return rows[0] ?? null;
}

export async function getWikiPageById(pageId: string): Promise<WikiPageRow | null> {
  const { rows } = await db.query<WikiPageRow>(
    `SELECT p.*, cu.username AS creator_username, eu.username AS last_editor_username
     FROM wiki_pages p
     JOIN users cu ON cu.id = p.created_by
     LEFT JOIN users eu ON eu.id = p.last_edited_by
     WHERE p.id = $1 AND p.deleted_at IS NULL LIMIT 1`,
    [pageId]
  );
  return rows[0] ?? null;
}

export async function countActivePages(wikiId: string, tx?: TransactionClient): Promise<number> {
  const client = tx ?? db;
  const { rows } = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM wiki_pages WHERE wiki_id = $1 AND deleted_at IS NULL`,
    [wikiId]
  );
  return parseInt(rows[0]?.count ?? "0", 10);
}

// ---------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------

export interface WikiPageRevisionRow {
  id: string;
  page_id: string;
  revision_number: number;
  title: string;
  content_markdown: string;
  content_format: string;
  edit_summary: string | null;
  edited_by: string;
  editor_username: string | null;
  created_at: string;
}

export async function listPageRevisions(pageId: string, limit = 100): Promise<WikiPageRevisionRow[]> {
  const { rows } = await db.query<WikiPageRevisionRow>(
    `SELECT r.id, r.page_id, r.revision_number, r.title, r.content_markdown, r.content_format,
            r.edit_summary, r.edited_by, u.username AS editor_username, r.created_at
     FROM wiki_page_revisions r
     JOIN users u ON u.id = r.edited_by
     WHERE r.page_id = $1
     ORDER BY r.revision_number DESC
     LIMIT $2`,
    [pageId, limit]
  );
  return rows;
}

export async function getPageRevision(pageId: string, revisionNumber: number): Promise<WikiPageRevisionRow | null> {
  const { rows } = await db.query<WikiPageRevisionRow>(
    `SELECT r.id, r.page_id, r.revision_number, r.title, r.content_markdown, r.content_format,
            r.edit_summary, r.edited_by, u.username AS editor_username, r.created_at
     FROM wiki_page_revisions r
     JOIN users u ON u.id = r.edited_by
     WHERE r.page_id = $1 AND r.revision_number = $2 LIMIT 1`,
    [pageId, revisionNumber]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Collaborators / moderators
// ---------------------------------------------------------------------------

export interface WikiCollaboratorRow {
  id: string;
  wiki_id: string;
  user_id: string;
  role: string;
  is_moderator: boolean;
  moderator_granted_at: string | null;
  status: string;
  page_edit_count: number;
  created_at: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
}

export async function listCollaborators(wikiId: string): Promise<WikiCollaboratorRow[]> {
  const { rows } = await db.query<WikiCollaboratorRow>(
    `SELECT c.id, c.wiki_id, c.user_id, c.role, c.is_moderator, c.moderator_granted_at, c.status,
            c.page_edit_count, c.created_at, u.username, u.display_name, u.avatar_url
     FROM wiki_collaborators c
     JOIN users u ON u.id = c.user_id
     WHERE c.wiki_id = $1 AND c.status = 'active'
     ORDER BY c.is_moderator DESC, c.page_edit_count DESC, c.created_at ASC`,
    [wikiId]
  );
  return rows;
}

export async function getCollaborator(wikiId: string, userId: string): Promise<WikiCollaboratorRow | null> {
  const { rows } = await db.query<WikiCollaboratorRow>(
    `SELECT c.id, c.wiki_id, c.user_id, c.role, c.is_moderator, c.moderator_granted_at, c.status,
            c.page_edit_count, c.created_at, u.username, u.display_name, u.avatar_url
     FROM wiki_collaborators c
     JOIN users u ON u.id = c.user_id
     WHERE c.wiki_id = $1 AND c.user_id = $2 LIMIT 1`,
    [wikiId, userId]
  );
  return rows[0] ?? null;
}

export async function countSelectedCollaborators(wikiId: string, tx?: TransactionClient): Promise<number> {
  const client = tx ?? db;
  const { rows } = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM wiki_collaborators WHERE wiki_id = $1 AND status = 'active'`,
    [wikiId]
  );
  return parseInt(rows[0]?.count ?? "0", 10);
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export interface WikiInviteRow {
  id: string;
  wiki_id: string;
  token: string;
  invited_user_id: string | null;
  created_by: string;
  expires_at: string;
  used_at: string | null;
  used_by_user_id: string | null;
  created_at: string;
  invited_username: string | null;
}

export async function listWikiInvites(wikiId: string): Promise<WikiInviteRow[]> {
  const { rows } = await db.query<WikiInviteRow>(
    `SELECT i.*, u.username AS invited_username
     FROM wiki_invites i
     LEFT JOIN users u ON u.id = i.invited_user_id
     WHERE i.wiki_id = $1
     ORDER BY i.created_at DESC
     LIMIT 200`,
    [wikiId]
  );
  return rows;
}

export async function getInviteByToken(token: string): Promise<WikiInviteRow | null> {
  const { rows } = await db.query<WikiInviteRow>(
    `SELECT i.*, u.username AS invited_username
     FROM wiki_invites i
     LEFT JOIN users u ON u.id = i.invited_user_id
     WHERE i.token = $1 LIMIT 1`,
    [token]
  );
  return rows[0] ?? null;
}
