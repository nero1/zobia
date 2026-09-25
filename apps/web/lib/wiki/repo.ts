/**
 * lib/wiki/repo.ts
 *
 * Wikis — read queries (discovery, single wiki/page lookups, listings).
 * Mirrors lib/blogs/repo.ts's cursor-pagination and row-shape conventions.
 */

import { and, asc, desc, eq, ilike, lt, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";

const lastEditorUsers = alias(schema.users, "wiki_repo_last_editor");

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

function toSummary(row: {
  id: string;
  ownerId: string;
  slug: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  coverImageUrl: string | null;
  contributePolicy: string;
  status: string;
  pageCount: number;
  contributorCount: number;
  viewCount: number;
  createdAt: Date;
  ownerUsername: string | null;
}): WikiSummaryRow {
  return {
    id: row.id,
    owner_id: row.ownerId,
    slug: row.slug,
    name: row.name,
    description: row.description,
    avatar_url: row.avatarUrl,
    cover_image_url: row.coverImageUrl,
    contribute_policy: row.contributePolicy,
    status: row.status,
    page_count: row.pageCount,
    contributor_count: row.contributorCount,
    view_count: row.viewCount,
    created_at: row.createdAt.toISOString(),
    owner_username: row.ownerUsername,
  };
}

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
  const orm = await getDb();

  const conditions: SQL[] = [eq(schema.wikis.status, "active"), sql`${schema.wikis.deletedAt} IS NULL`];
  if (search?.trim()) conditions.push(ilike(schema.wikis.name, `%${search.trim()}%`));
  if (cursor && tab !== "random") conditions.push(lt(schema.wikis.id, cursor));

  let orderBy: SQL[];
  if (tab === "trending") orderBy = [desc(schema.wikis.editCount), desc(schema.wikis.updatedAt)];
  else if (tab === "new") orderBy = [desc(schema.wikis.createdAt)];
  else if (tab === "random") orderBy = [sql`RANDOM()`];
  else orderBy = [desc(schema.wikis.viewCount), desc(schema.wikis.pageCount)];

  const rows = await orm
    .select({
      id: schema.wikis.id,
      ownerId: schema.wikis.ownerId,
      slug: schema.wikis.slug,
      name: schema.wikis.name,
      description: schema.wikis.description,
      avatarUrl: schema.wikis.avatarUrl,
      coverImageUrl: schema.wikis.coverImageUrl,
      contributePolicy: schema.wikis.contributePolicy,
      status: schema.wikis.status,
      pageCount: schema.wikis.pageCount,
      contributorCount: schema.wikis.contributorCount,
      viewCount: schema.wikis.viewCount,
      createdAt: schema.wikis.createdAt,
      ownerUsername: schema.users.username,
    })
    .from(schema.wikis)
    .innerJoin(schema.users, eq(schema.users.id, schema.wikis.ownerId))
    .where(and(...conditions))
    .orderBy(...orderBy)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const wikis = page.map(toSummary);
  return {
    wikis,
    nextCursor: hasMore ? wikis[wikis.length - 1]?.id ?? null : null,
    hasMore,
  };
}

export interface WikiRow extends WikiSummaryRow {
  status_reason: string | null;
  edit_count: number;
  owner_display_name: string | null;
  owner_avatar_url: string | null;
}

function wikiFullSelection() {
  return {
    id: schema.wikis.id,
    ownerId: schema.wikis.ownerId,
    slug: schema.wikis.slug,
    name: schema.wikis.name,
    description: schema.wikis.description,
    avatarUrl: schema.wikis.avatarUrl,
    coverImageUrl: schema.wikis.coverImageUrl,
    contributePolicy: schema.wikis.contributePolicy,
    status: schema.wikis.status,
    statusReason: schema.wikis.statusReason,
    pageCount: schema.wikis.pageCount,
    contributorCount: schema.wikis.contributorCount,
    viewCount: schema.wikis.viewCount,
    editCount: schema.wikis.editCount,
    createdAt: schema.wikis.createdAt,
    ownerUsername: schema.users.username,
    ownerDisplayName: schema.users.displayName,
    ownerAvatarUrl: schema.users.avatarUrl,
  };
}

interface WikiFullSelectionRow {
  id: string;
  ownerId: string;
  slug: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  coverImageUrl: string | null;
  contributePolicy: string;
  status: string;
  statusReason: string | null;
  pageCount: number;
  contributorCount: number;
  viewCount: number;
  editCount: number;
  createdAt: Date;
  ownerUsername: string | null;
  ownerDisplayName: string | null;
  ownerAvatarUrl: string | null;
}

function toFullRow(row: WikiFullSelectionRow): WikiRow {
  return {
    ...toSummary(row),
    status_reason: row.statusReason,
    edit_count: row.editCount,
    owner_display_name: row.ownerDisplayName,
    owner_avatar_url: row.ownerAvatarUrl,
  };
}

export async function getWikiBySlug(slug: string): Promise<WikiRow | null> {
  const orm = await getDb();
  const [row] = await orm
    .select(wikiFullSelection())
    .from(schema.wikis)
    .innerJoin(schema.users, eq(schema.users.id, schema.wikis.ownerId))
    .where(and(eq(schema.wikis.slug, slug), sql`${schema.wikis.deletedAt} IS NULL`))
    .limit(1);
  return row ? toFullRow(row) : null;
}

export async function getWikiById(id: string): Promise<WikiRow | null> {
  const orm = await getDb();
  const [row] = await orm
    .select(wikiFullSelection())
    .from(schema.wikis)
    .innerJoin(schema.users, eq(schema.users.id, schema.wikis.ownerId))
    .where(and(eq(schema.wikis.id, id), sql`${schema.wikis.deletedAt} IS NULL`))
    .limit(1);
  return row ? toFullRow(row) : null;
}

export async function getWikisOwnedBy(ownerId: string): Promise<WikiRow[]> {
  const orm = await getDb();
  const rows = await orm
    .select(wikiFullSelection())
    .from(schema.wikis)
    .innerJoin(schema.users, eq(schema.users.id, schema.wikis.ownerId))
    .where(and(eq(schema.wikis.ownerId, ownerId), sql`${schema.wikis.deletedAt} IS NULL`))
    .orderBy(desc(schema.wikis.createdAt));
  return rows.map(toFullRow);
}

/** Wikis a user actively collaborates on (any role), excluding ones they own. */
export async function getWikisContributedTo(userId: string): Promise<WikiRow[]> {
  const orm = await getDb();
  const rows = await orm
    .select(wikiFullSelection())
    .from(schema.wikis)
    .innerJoin(schema.users, eq(schema.users.id, schema.wikis.ownerId))
    .innerJoin(
      schema.wikiCollaborators,
      and(
        eq(schema.wikiCollaborators.wikiId, schema.wikis.id),
        eq(schema.wikiCollaborators.userId, userId),
        eq(schema.wikiCollaborators.status, "active")
      )
    )
    .where(and(sql`${schema.wikis.deletedAt} IS NULL`, ne(schema.wikis.ownerId, userId)))
    .orderBy(desc(schema.wikis.updatedAt));
  return rows.map(toFullRow);
}

export async function countOwnedWikis(ownerId: string, tx?: DbOrTx): Promise<number> {
  const orm = tx ?? (await getDb());
  const [row] = await orm
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.wikis)
    .where(
      and(
        eq(schema.wikis.ownerId, ownerId),
        sql`${schema.wikis.deletedAt} IS NULL`,
        ne(schema.wikis.status, "deactivated")
      )
    );
  return row?.count ?? 0;
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

function toPageSummary(row: typeof schema.wikiPages.$inferSelect): WikiPageSummaryRow {
  return {
    id: row.id,
    wiki_id: row.wikiId,
    slug: row.slug,
    title: row.title,
    status: row.status,
    revision_count: row.revisionCount,
    view_count: row.viewCount,
    created_by: row.createdBy,
    last_edited_by: row.lastEditedBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function listWikiPages(
  wikiId: string,
  opts: { cursor?: string | null; limit: number; search?: string }
): Promise<{ pages: WikiPageSummaryRow[]; nextCursor: string | null; hasMore: boolean }> {
  const orm = await getDb();

  const conditions: SQL[] = [
    eq(schema.wikiPages.wikiId, wikiId),
    sql`${schema.wikiPages.deletedAt} IS NULL`,
    eq(schema.wikiPages.status, "published"),
  ];
  if (opts.search?.trim()) conditions.push(ilike(schema.wikiPages.title, `%${opts.search.trim()}%`));
  if (opts.cursor) conditions.push(lt(schema.wikiPages.id, opts.cursor));

  const rows = await orm
    .select()
    .from(schema.wikiPages)
    .where(and(...conditions))
    .orderBy(asc(schema.wikiPages.title))
    .limit(opts.limit + 1);

  const hasMore = rows.length > opts.limit;
  const page = hasMore ? rows.slice(0, opts.limit) : rows;
  const pages = page.map(toPageSummary);
  return {
    pages,
    nextCursor: hasMore ? pages[pages.length - 1]?.id ?? null : null,
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
  const orm = await getDb();
  const [row] = await orm
    .select({
      page: schema.wikiPages,
      creatorUsername: schema.users.username,
      lastEditorUsername: lastEditorUsers.username,
    })
    .from(schema.wikiPages)
    .innerJoin(schema.users, eq(schema.users.id, schema.wikiPages.createdBy))
    .leftJoin(lastEditorUsers, eq(lastEditorUsers.id, schema.wikiPages.lastEditedBy))
    .where(
      and(eq(schema.wikiPages.wikiId, wikiId), eq(schema.wikiPages.slug, pageSlug), sql`${schema.wikiPages.deletedAt} IS NULL`)
    )
    .limit(1);
  if (!row) return null;
  return {
    ...toPageSummary(row.page),
    content_markdown: row.page.contentMarkdown,
    content_html: row.page.contentHtml,
    content_format: row.page.contentFormat,
    creator_username: row.creatorUsername,
    last_editor_username: row.lastEditorUsername,
  };
}

export async function getWikiPageById(pageId: string): Promise<WikiPageRow | null> {
  const orm = await getDb();
  const [row] = await orm
    .select({
      page: schema.wikiPages,
      creatorUsername: schema.users.username,
      lastEditorUsername: lastEditorUsers.username,
    })
    .from(schema.wikiPages)
    .innerJoin(schema.users, eq(schema.users.id, schema.wikiPages.createdBy))
    .leftJoin(lastEditorUsers, eq(lastEditorUsers.id, schema.wikiPages.lastEditedBy))
    .where(and(eq(schema.wikiPages.id, pageId), sql`${schema.wikiPages.deletedAt} IS NULL`))
    .limit(1);
  if (!row) return null;
  return {
    ...toPageSummary(row.page),
    content_markdown: row.page.contentMarkdown,
    content_html: row.page.contentHtml,
    content_format: row.page.contentFormat,
    creator_username: row.creatorUsername,
    last_editor_username: row.lastEditorUsername,
  };
}

export async function countActivePages(wikiId: string, tx?: DbOrTx): Promise<number> {
  const orm = tx ?? (await getDb());
  const [row] = await orm
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.wikiPages)
    .where(and(eq(schema.wikiPages.wikiId, wikiId), sql`${schema.wikiPages.deletedAt} IS NULL`));
  return row?.count ?? 0;
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
  const orm = await getDb();
  const rows = await orm
    .select({
      id: schema.wikiPageRevisions.id,
      pageId: schema.wikiPageRevisions.pageId,
      revisionNumber: schema.wikiPageRevisions.revisionNumber,
      title: schema.wikiPageRevisions.title,
      contentMarkdown: schema.wikiPageRevisions.contentMarkdown,
      contentFormat: schema.wikiPageRevisions.contentFormat,
      editSummary: schema.wikiPageRevisions.editSummary,
      editedBy: schema.wikiPageRevisions.editedBy,
      editorUsername: schema.users.username,
      createdAt: schema.wikiPageRevisions.createdAt,
    })
    .from(schema.wikiPageRevisions)
    .innerJoin(schema.users, eq(schema.users.id, schema.wikiPageRevisions.editedBy))
    .where(eq(schema.wikiPageRevisions.pageId, pageId))
    .orderBy(desc(schema.wikiPageRevisions.revisionNumber))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    page_id: r.pageId,
    revision_number: r.revisionNumber,
    title: r.title,
    content_markdown: r.contentMarkdown,
    content_format: r.contentFormat,
    edit_summary: r.editSummary,
    edited_by: r.editedBy,
    editor_username: r.editorUsername,
    created_at: r.createdAt.toISOString(),
  }));
}

export async function getPageRevision(pageId: string, revisionNumber: number): Promise<WikiPageRevisionRow | null> {
  const orm = await getDb();
  const [r] = await orm
    .select({
      id: schema.wikiPageRevisions.id,
      pageId: schema.wikiPageRevisions.pageId,
      revisionNumber: schema.wikiPageRevisions.revisionNumber,
      title: schema.wikiPageRevisions.title,
      contentMarkdown: schema.wikiPageRevisions.contentMarkdown,
      contentFormat: schema.wikiPageRevisions.contentFormat,
      editSummary: schema.wikiPageRevisions.editSummary,
      editedBy: schema.wikiPageRevisions.editedBy,
      editorUsername: schema.users.username,
      createdAt: schema.wikiPageRevisions.createdAt,
    })
    .from(schema.wikiPageRevisions)
    .innerJoin(schema.users, eq(schema.users.id, schema.wikiPageRevisions.editedBy))
    .where(and(eq(schema.wikiPageRevisions.pageId, pageId), eq(schema.wikiPageRevisions.revisionNumber, revisionNumber)))
    .limit(1);
  if (!r) return null;
  return {
    id: r.id,
    page_id: r.pageId,
    revision_number: r.revisionNumber,
    title: r.title,
    content_markdown: r.contentMarkdown,
    content_format: r.contentFormat,
    edit_summary: r.editSummary,
    edited_by: r.editedBy,
    editor_username: r.editorUsername,
    created_at: r.createdAt.toISOString(),
  };
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

function collaboratorSelection() {
  return {
    id: schema.wikiCollaborators.id,
    wikiId: schema.wikiCollaborators.wikiId,
    userId: schema.wikiCollaborators.userId,
    role: schema.wikiCollaborators.role,
    isModerator: schema.wikiCollaborators.isModerator,
    moderatorGrantedAt: schema.wikiCollaborators.moderatorGrantedAt,
    status: schema.wikiCollaborators.status,
    pageEditCount: schema.wikiCollaborators.pageEditCount,
    createdAt: schema.wikiCollaborators.createdAt,
    username: schema.users.username,
    displayName: schema.users.displayName,
    avatarUrl: schema.users.avatarUrl,
  };
}

function toCollaboratorRow(row: {
  id: string;
  wikiId: string;
  userId: string;
  role: string;
  isModerator: boolean;
  moderatorGrantedAt: Date | null;
  status: string;
  pageEditCount: number;
  createdAt: Date;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}): WikiCollaboratorRow {
  return {
    id: row.id,
    wiki_id: row.wikiId,
    user_id: row.userId,
    role: row.role,
    is_moderator: row.isModerator,
    moderator_granted_at: row.moderatorGrantedAt ? row.moderatorGrantedAt.toISOString() : null,
    status: row.status,
    page_edit_count: row.pageEditCount,
    created_at: row.createdAt.toISOString(),
    username: row.username,
    display_name: row.displayName,
    avatar_url: row.avatarUrl,
  };
}

export async function listCollaborators(wikiId: string): Promise<WikiCollaboratorRow[]> {
  const orm = await getDb();
  const rows = await orm
    .select(collaboratorSelection())
    .from(schema.wikiCollaborators)
    .innerJoin(schema.users, eq(schema.users.id, schema.wikiCollaborators.userId))
    .where(and(eq(schema.wikiCollaborators.wikiId, wikiId), eq(schema.wikiCollaborators.status, "active")))
    .orderBy(desc(schema.wikiCollaborators.isModerator), desc(schema.wikiCollaborators.pageEditCount), asc(schema.wikiCollaborators.createdAt));
  return rows.map(toCollaboratorRow);
}

export async function getCollaborator(wikiId: string, userId: string): Promise<WikiCollaboratorRow | null> {
  const orm = await getDb();
  const [row] = await orm
    .select(collaboratorSelection())
    .from(schema.wikiCollaborators)
    .innerJoin(schema.users, eq(schema.users.id, schema.wikiCollaborators.userId))
    .where(and(eq(schema.wikiCollaborators.wikiId, wikiId), eq(schema.wikiCollaborators.userId, userId)))
    .limit(1);
  return row ? toCollaboratorRow(row) : null;
}

export async function countSelectedCollaborators(wikiId: string, tx?: DbOrTx): Promise<number> {
  const orm = tx ?? (await getDb());
  const [row] = await orm
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.wikiCollaborators)
    .where(and(eq(schema.wikiCollaborators.wikiId, wikiId), eq(schema.wikiCollaborators.status, "active")));
  return row?.count ?? 0;
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

function toInviteRow(row: typeof schema.wikiInvites.$inferSelect, invitedUsername: string | null): WikiInviteRow {
  return {
    id: row.id,
    wiki_id: row.wikiId,
    token: row.token,
    invited_user_id: row.invitedUserId,
    created_by: row.createdBy,
    expires_at: row.expiresAt.toISOString(),
    used_at: row.usedAt ? row.usedAt.toISOString() : null,
    used_by_user_id: row.usedByUserId,
    created_at: row.createdAt.toISOString(),
    invited_username: invitedUsername,
  };
}

export async function listWikiInvites(wikiId: string): Promise<WikiInviteRow[]> {
  const orm = await getDb();
  const rows = await orm
    .select({ invite: schema.wikiInvites, invitedUsername: schema.users.username })
    .from(schema.wikiInvites)
    .leftJoin(schema.users, eq(schema.users.id, schema.wikiInvites.invitedUserId))
    .where(eq(schema.wikiInvites.wikiId, wikiId))
    .orderBy(desc(schema.wikiInvites.createdAt))
    .limit(200);
  return rows.map((r) => toInviteRow(r.invite, r.invitedUsername));
}

export async function getInviteByToken(token: string): Promise<WikiInviteRow | null> {
  const orm = await getDb();
  const [row] = await orm
    .select({ invite: schema.wikiInvites, invitedUsername: schema.users.username })
    .from(schema.wikiInvites)
    .leftJoin(schema.users, eq(schema.users.id, schema.wikiInvites.invitedUserId))
    .where(eq(schema.wikiInvites.token, token))
    .limit(1);
  return row ? toInviteRow(row.invite, row.invitedUsername) : null;
}
