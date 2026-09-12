/**
 * lib/wiki/service.ts
 *
 * Wikis — collaborative wiki system. Mirrors lib/blogs/service.ts's
 * structure: feature flag -> eligibility/limits -> (optional charge) ->
 * atomic write. XP/Credits rewards are awarded best-effort AFTER the write
 * transaction commits so a reward failure never blocks the user's action.
 *
 * Reward pot funding/claims reuse lib/contentTreasury.ts (shared with
 * Polls/Quizzes) rather than a bespoke wiki_treasuries table.
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import type { SqlParam, TransactionClient } from "@/lib/db/interface";
import { requireFeatureEnabled, loadManifest } from "@/lib/manifest";
import { safeAwardXPFireAndForget } from "@/lib/xp/safeAwardXP";
import { creditCoins } from "@/lib/economy/coins";
import { sanitizeBlogPostHtml, plainTextToBlogPostHtml } from "@/lib/security/htmlSanitizer";
import { generateUniqueSlug, generateUniqueWikiPageSlug, recordSlugRedirect } from "@/lib/slug";
import { insertNotificationBatch, insertNotification } from "@/lib/notifications/insert";
import { ApiError, badRequest, forbidden, notFound } from "@/lib/api/errors";
import { logger } from "@/lib/logger";
import { getStaffRoles } from "@/lib/auth/roles";
import {
  fundContentTreasury,
  claimContentTreasuryReward,
  getContentTreasury,
  recordContentShare,
  type TreasuryState,
} from "@/lib/contentTreasury";
import {
  checkWikiCreationEligibility,
  getMaxOwnedWikis,
  getMaxWikiPages,
  getMaxSelectedCollaborators,
  getWikiInviteExpiryHours,
  getWikiCreateReward,
  getWikiContributeReward,
  getWikiDailyRewardCapCredits,
} from "@/lib/wiki/limits";
import { getWikiForPermissionCheck, canManageWiki, canContributeToWiki, type WikiRow as PermWikiRow } from "@/lib/wiki/permissions";
import {
  countOwnedWikis,
  countActivePages,
  countSelectedCollaborators,
  getWikiById,
  getWikiPageById,
  getInviteByToken,
} from "@/lib/wiki/repo";

export type WikiContentFormat = "markdown" | "plaintext";

function renderContentHtml(markdown: string, format: WikiContentFormat): string {
  return format === "plaintext" ? plainTextToBlogPostHtml(markdown) : sanitizeBlogPostHtml(markdown);
}

// ---------------------------------------------------------------------------
// Rewards — mirrors lib/polls/service.ts's awardCreditsCapped/awardPollRewards.
// ---------------------------------------------------------------------------

async function awardCreditsCapped(userId: string, amount: number, referenceId: string, description: string, dailyCapCredits: number): Promise<void> {
  if (amount <= 0) return;
  try {
    const { rows } = await db.query<{ earned: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS earned
       FROM coin_ledger
       WHERE user_id = $1 AND transaction_type LIKE 'wiki_%' AND amount > 0
         AND created_at >= NOW() - INTERVAL '24 hours'`,
      [userId]
    );
    const earnedToday = parseInt(rows[0]?.earned ?? "0", 10);
    const headroom = dailyCapCredits - earnedToday;
    if (headroom <= 0) return;
    const capped = Math.min(amount, headroom);
    await creditCoins(userId, capped, "wiki_contribute_reward", referenceId, description);
  } catch (err) {
    logger.error({ err, userId, amount }, "[wiki/service] reward credit award failed");
  }
}

async function awardWikiRewards(userId: string, xpAmount: number, creditAmount: number, xpSource: string, referenceId: string, description: string, dailyCapCredits: number): Promise<void> {
  if (xpAmount > 0) safeAwardXPFireAndForget(userId, xpAmount, "knowledge", xpSource, referenceId);
  if (creditAmount > 0) await awardCreditsCapped(userId, creditAmount, referenceId, description, dailyCapCredits);
}

// ---------------------------------------------------------------------------
// Create / update a wiki
// ---------------------------------------------------------------------------

export interface CreateWikiInput {
  userId: string;
  userPlan: string;
  userLevelCreator: number;
  isAdmin: boolean;
  isModerator: boolean;
  name: string;
  description?: string | null;
  contributePolicy?: "everyone" | "friends" | "selected";
}

export interface CreateWikiResult {
  id: string;
  slug: string;
}

export async function createWiki(input: CreateWikiInput): Promise<CreateWikiResult> {
  await requireFeatureEnabled("wiki");

  const eligibility = await checkWikiCreationEligibility({
    plan: input.userPlan,
    levelCreator: input.userLevelCreator,
    isAdmin: input.isAdmin,
    isModerator: input.isModerator,
  });
  if (!eligibility.eligible) {
    throw forbidden(eligibility.reason ?? "You're not eligible to create a wiki yet.", "WIKI_CREATE_NOT_ELIGIBLE", { requirements: eligibility.requirements });
  }

  const maxOwned = await getMaxOwnedWikis(input.userPlan);
  const wikiId = randomUUID();
  const slug = await generateUniqueSlug("wiki", input.name, wikiId);
  const policy = input.contributePolicy ?? "everyone";

  await db.transaction(async (tx: TransactionClient) => {
    await tx.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [input.userId]);
    const used = await countOwnedWikis(input.userId, tx);
    if (used >= maxOwned) {
      throw forbidden(`Your plan allows a maximum of ${maxOwned} wikis. Upgrade your plan to create more.`, "WIKI_OWNED_LIMIT_REACHED", { maxOwned });
    }

    await tx.query(
      `INSERT INTO wikis (id, owner_id, slug, name, description, contribute_policy, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
      [wikiId, input.userId, slug, input.name.trim(), input.description?.trim() || null, policy]
    );
    await tx.query(
      `INSERT INTO wiki_collaborators (wiki_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')`,
      [wikiId, input.userId]
    );
  });

  const reward = await getWikiCreateReward();
  const dailyCap = await getWikiDailyRewardCapCredits();
  await awardWikiRewards(input.userId, reward.xp, reward.credits, "wiki_created", `wiki_create_reward:${wikiId}`, "Created a wiki", dailyCap);

  return { id: wikiId, slug };
}

export interface UpdateWikiSettingsInput {
  name?: string;
  description?: string | null;
  avatarUrl?: string | null;
  coverImageUrl?: string | null;
  contributePolicy?: "everyone" | "friends" | "selected";
}

export async function updateWikiSettings(wikiId: string, callerId: string, input: UpdateWikiSettingsInput): Promise<void> {
  const { rows } = await db.query<{ owner_id: string; name: string; slug: string }>(
    `SELECT owner_id, name, slug FROM wikis WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [wikiId]
  );
  const wiki = rows[0];
  if (!wiki) throw notFound("Wiki not found");
  if (wiki.owner_id !== callerId) throw forbidden("Only the wiki owner can update these settings.");

  const fields: string[] = [];
  const params: SqlParam[] = [wikiId];
  const push = (col: string, value: SqlParam) => {
    params.push(value);
    fields.push(`${col} = $${params.length}`);
  };

  let newSlug: string | null = null;
  if (input.name !== undefined) {
    const trimmedName = input.name.trim();
    push("name", trimmedName);
    if (trimmedName && trimmedName !== wiki.name) {
      newSlug = await generateUniqueSlug("wiki", trimmedName, wikiId, db, wikiId);
      if (newSlug !== wiki.slug) push("slug", newSlug);
      else newSlug = null;
    }
  }
  if (input.description !== undefined) push("description", input.description?.trim() || null);
  if (input.avatarUrl !== undefined) push("avatar_url", input.avatarUrl || null);
  if (input.coverImageUrl !== undefined) push("cover_image_url", input.coverImageUrl || null);
  if (input.contributePolicy !== undefined) push("contribute_policy", input.contributePolicy);

  if (fields.length === 0) return;
  await db.query(`UPDATE wikis SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $1`, params);
  if (newSlug) await recordSlugRedirect("wiki", wiki.slug, wikiId, newSlug).catch(() => {});
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

async function requireContributorAccess(wikiId: string, userId: string): Promise<PermWikiRow> {
  const wiki = await getWikiForPermissionCheck(wikiId);
  if (!wiki) throw notFound("Wiki not found");
  if (wiki.status !== "active" && wiki.status !== "paused") {
    throw forbidden("This wiki has been restricted by an administrator.", "WIKI_RESTRICTED");
  }
  const allowed = await canContributeToWiki(wiki, userId);
  if (!allowed) throw forbidden("You don't have permission to contribute to this wiki.", "WIKI_CONTRIBUTE_FORBIDDEN");
  return wiki;
}

/** Ensures the contributor has an active wiki_collaborators row (creates one on first contribution). */
async function ensureCollaboratorRow(tx: TransactionClient, wikiId: string, userId: string): Promise<boolean> {
  const { rowCount } = await tx.query(
    `INSERT INTO wiki_collaborators (wiki_id, user_id, role, status)
     VALUES ($1, $2, 'contributor', 'active')
     ON CONFLICT (wiki_id, user_id) DO UPDATE SET status = 'active' WHERE wiki_collaborators.status != 'active'`,
    [wikiId, userId]
  );
  return !!rowCount && rowCount > 0;
}

export interface CreatePageInput {
  wikiId: string;
  authorId: string;
  title: string;
  contentMarkdown: string;
  contentFormat?: WikiContentFormat;
}

export async function createPage(input: CreatePageInput): Promise<{ id: string; slug: string }> {
  await requireFeatureEnabled("wiki");
  await requireContributorAccess(input.wikiId, input.authorId);

  const maxPages = await getMaxWikiPages(await getOwnerPlan(input.wikiId));
  const used = await countActivePages(input.wikiId);
  if (used >= maxPages) {
    throw forbidden(`This wiki allows a maximum of ${maxPages} pages.`, "WIKI_PAGE_LIMIT_REACHED", { maxPages });
  }

  const pageId = randomUUID();
  const slug = await generateUniqueWikiPageSlug(input.wikiId, input.title, pageId);
  const contentFormat: WikiContentFormat = input.contentFormat === "plaintext" ? "plaintext" : "markdown";
  const contentHtml = renderContentHtml(input.contentMarkdown, contentFormat);

  let becameContributor = false;
  await db.transaction(async (tx: TransactionClient) => {
    await tx.query(
      `INSERT INTO wiki_pages (id, wiki_id, slug, title, content_markdown, content_html, content_format, status, created_by, last_edited_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'published',$8,$8)`,
      [pageId, input.wikiId, slug, input.title.trim(), input.contentMarkdown, contentHtml, contentFormat, input.authorId]
    );
    await tx.query(
      `INSERT INTO wiki_page_revisions (page_id, revision_number, title, content_markdown, content_format, edit_summary, edited_by)
       VALUES ($1, 1, $2, $3, $4, 'Created the page', $5)`,
      [pageId, input.title.trim(), input.contentMarkdown, contentFormat, input.authorId]
    );
    await tx.query(`UPDATE wikis SET page_count = page_count + 1, edit_count = edit_count + 1, updated_at = NOW() WHERE id = $1`, [input.wikiId]);
    becameContributor = await ensureCollaboratorRow(tx, input.wikiId, input.authorId);
    await tx.query(`UPDATE wiki_collaborators SET page_edit_count = page_edit_count + 1, updated_at = NOW() WHERE wiki_id = $1 AND user_id = $2`, [input.wikiId, input.authorId]);
  });

  if (becameContributor) {
    await db.query(`UPDATE wikis SET contributor_count = contributor_count + 1 WHERE id = $1`, [input.wikiId]).catch(() => {});
  }

  await afterContribution(input.wikiId, input.authorId, pageId);

  return { id: pageId, slug };
}

export interface UpdatePageInput {
  title?: string;
  contentMarkdown?: string;
  contentFormat?: WikiContentFormat;
  editSummary?: string | null;
}

export async function updatePage(pageId: string, callerId: string, input: UpdatePageInput): Promise<void> {
  await requireFeatureEnabled("wiki");
  const page = await getWikiPageById(pageId);
  if (!page) throw notFound("Page not found");

  await requireContributorAccess(page.wiki_id, callerId);

  const title = input.title?.trim() || page.title;
  const contentFormat: WikiContentFormat = (input.contentFormat ?? (page.content_format as WikiContentFormat)) === "plaintext" ? "plaintext" : "markdown";
  const contentMarkdown = input.contentMarkdown ?? page.content_markdown;
  if (!contentMarkdown.trim()) throw badRequest("Page content cannot be empty.", "WIKI_PAGE_EMPTY_CONTENT");
  const contentHtml = renderContentHtml(contentMarkdown, contentFormat);

  let becameContributor = false;
  await db.transaction(async (tx: TransactionClient) => {
    const { rows: nextRevRows } = await tx.query<{ next: number }>(
      `SELECT COALESCE(MAX(revision_number), 0) + 1 AS next FROM wiki_page_revisions WHERE page_id = $1`,
      [pageId]
    );
    const nextRevision = nextRevRows[0]?.next ?? 2;

    await tx.query(
      `UPDATE wiki_pages
       SET title = $2, content_markdown = $3, content_html = $4, content_format = $5,
           revision_count = $6, last_edited_by = $7, updated_at = NOW()
       WHERE id = $1`,
      [pageId, title, contentMarkdown, contentHtml, contentFormat, nextRevision, callerId]
    );
    await tx.query(
      `INSERT INTO wiki_page_revisions (page_id, revision_number, title, content_markdown, content_format, edit_summary, edited_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [pageId, nextRevision, title, contentMarkdown, contentFormat, input.editSummary?.trim() || null, callerId]
    );
    await tx.query(`UPDATE wikis SET edit_count = edit_count + 1, updated_at = NOW() WHERE id = $1`, [page.wiki_id]);
    becameContributor = await ensureCollaboratorRow(tx, page.wiki_id, callerId);
    await tx.query(`UPDATE wiki_collaborators SET page_edit_count = page_edit_count + 1, updated_at = NOW() WHERE wiki_id = $1 AND user_id = $2`, [page.wiki_id, callerId]);
  });

  if (becameContributor) {
    await db.query(`UPDATE wikis SET contributor_count = contributor_count + 1 WHERE id = $1`, [page.wiki_id]).catch(() => {});
  }

  await afterContribution(page.wiki_id, callerId, pageId);
}

/** Best-effort XP/Credits + treasury claim after a page create/edit commits. Never blocks or throws into the caller. */
async function afterContribution(wikiId: string, userId: string, pageId: string): Promise<void> {
  try {
    const reward = await getWikiContributeReward();
    const dailyCap = await getWikiDailyRewardCapCredits();
    await awardWikiRewards(userId, reward.xp, reward.credits, "wiki_page_contributed", `wiki_contribute_reward:${pageId}:${userId}:${Date.now()}`, "Contributed to a wiki page", dailyCap);

    const manifest = await loadManifest();
    await claimContentTreasuryReward("wiki", wikiId, userId, "contribute", "wiki_treasury_claim", manifest.features.wikiMonetization).catch((err) => {
      logger.error({ err, wikiId, userId }, "[wiki/service] failed to claim treasury reward for contribution");
    });
  } catch (err) {
    logger.error({ err, wikiId, userId }, "[wiki/service] afterContribution reward step failed");
  }
}

export async function deletePage(pageId: string, callerId: string): Promise<void> {
  const page = await getWikiPageById(pageId);
  if (!page) throw notFound("Page not found");
  const wiki = await getWikiForPermissionCheck(page.wiki_id);
  if (!wiki) throw notFound("Wiki not found");
  const allowed = await canManageWiki(wiki, callerId);
  if (!allowed) throw forbidden("You can't delete this page.");

  await db.transaction(async (tx: TransactionClient) => {
    await tx.query(`UPDATE wiki_pages SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [pageId]);
    await tx.query(`UPDATE wikis SET page_count = GREATEST(page_count - 1, 0), updated_at = NOW() WHERE id = $1`, [page.wiki_id]);
  });
}

export async function restorePageRevision(pageId: string, callerId: string, revisionNumber: number): Promise<void> {
  const page = await getWikiPageById(pageId);
  if (!page) throw notFound("Page not found");
  const wiki = await getWikiForPermissionCheck(page.wiki_id);
  if (!wiki) throw notFound("Wiki not found");
  const allowed = await canContributeToWiki(wiki, callerId);
  if (!allowed) throw forbidden("You don't have permission to edit this page.");

  const { rows } = await db.query<{ title: string; content_markdown: string; content_format: string }>(
    `SELECT title, content_markdown, content_format FROM wiki_page_revisions WHERE page_id = $1 AND revision_number = $2 LIMIT 1`,
    [pageId, revisionNumber]
  );
  const revision = rows[0];
  if (!revision) throw notFound("Revision not found");

  await updatePage(pageId, callerId, {
    title: revision.title,
    contentMarkdown: revision.content_markdown,
    contentFormat: revision.content_format as WikiContentFormat,
    editSummary: `Restored revision #${revisionNumber}`,
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export async function recordWikiView(wikiId: string): Promise<void> {
  await db.query(`UPDATE wikis SET view_count = view_count + 1 WHERE id = $1 AND deleted_at IS NULL`, [wikiId]);
}

export async function recordPageView(pageId: string): Promise<void> {
  await db.query(`UPDATE wiki_pages SET view_count = view_count + 1 WHERE id = $1 AND deleted_at IS NULL`, [pageId]);
}

// ---------------------------------------------------------------------------
// Moderators
// ---------------------------------------------------------------------------

export async function grantModerator(wikiId: string, callerId: string, targetUserId: string): Promise<void> {
  const wiki = await getWikiForPermissionCheck(wikiId);
  if (!wiki) throw notFound("Wiki not found");
  if (wiki.owner_id !== callerId) {
    const staff = await getStaffRoles(callerId);
    if (!staff.isAdmin) throw forbidden("Only the wiki owner (or an admin) can assign moderators.");
  }
  if (targetUserId === wiki.owner_id) throw badRequest("The wiki owner is already a full manager.", "WIKI_OWNER_ALREADY_MANAGES");

  await db.query(
    `INSERT INTO wiki_collaborators (wiki_id, user_id, role, is_moderator, moderator_granted_by, moderator_granted_at, status)
     VALUES ($1, $2, 'moderator', true, $3, NOW(), 'active')
     ON CONFLICT (wiki_id, user_id) DO UPDATE SET
       role = 'moderator', is_moderator = true, moderator_granted_by = $3, moderator_granted_at = NOW(), status = 'active', updated_at = NOW()`,
    [wikiId, targetUserId, callerId]
  );

  await insertNotification(db, targetUserId, "wiki_moderator_granted", "You're now a wiki moderator", "You were made a moderator of a wiki.", { wikiId }).catch(() => {});
}

export async function revokeModerator(wikiId: string, callerId: string, targetUserId: string): Promise<void> {
  const wiki = await getWikiForPermissionCheck(wikiId);
  if (!wiki) throw notFound("Wiki not found");
  if (wiki.owner_id !== callerId) {
    const staff = await getStaffRoles(callerId);
    if (!staff.isAdmin) throw forbidden("Only the wiki owner (or an admin) can remove moderators.");
  }

  await db.query(
    `UPDATE wiki_collaborators SET is_moderator = false, role = 'contributor', updated_at = NOW()
     WHERE wiki_id = $1 AND user_id = $2`,
    [wikiId, targetUserId]
  );
}

// ---------------------------------------------------------------------------
// Selected collaborators (contribute_policy = 'selected')
// ---------------------------------------------------------------------------

export async function addSelectedCollaborator(wikiId: string, callerId: string, targetUserId: string): Promise<void> {
  const wiki = await getWikiForPermissionCheck(wikiId);
  if (!wiki) throw notFound("Wiki not found");
  const allowed = await canManageWiki(wiki, callerId);
  if (!allowed) throw forbidden("Only the wiki owner or a moderator can add collaborators.");

  const maxCollaborators = await getMaxSelectedCollaborators();
  const used = await countSelectedCollaborators(wikiId);
  if (used >= maxCollaborators) {
    throw forbidden(`This wiki allows a maximum of ${maxCollaborators} collaborators.`, "WIKI_COLLABORATOR_LIMIT_REACHED", { maxCollaborators });
  }

  await db.query(
    `INSERT INTO wiki_collaborators (wiki_id, user_id, role, status, invited_by)
     VALUES ($1, $2, 'contributor', 'active', $3)
     ON CONFLICT (wiki_id, user_id) DO UPDATE SET status = 'active', updated_at = NOW()`,
    [wikiId, targetUserId, callerId]
  );
}

export async function removeCollaborator(wikiId: string, callerId: string, targetUserId: string): Promise<void> {
  const wiki = await getWikiForPermissionCheck(wikiId);
  if (!wiki) throw notFound("Wiki not found");
  const allowed = await canManageWiki(wiki, callerId);
  if (!allowed) throw forbidden("Only the wiki owner or a moderator can remove collaborators.");
  if (targetUserId === wiki.owner_id) throw badRequest("Can't remove the wiki owner.", "WIKI_CANNOT_REMOVE_OWNER");

  await db.query(`UPDATE wiki_collaborators SET status = 'removed', is_moderator = false, updated_at = NOW() WHERE wiki_id = $1 AND user_id = $2`, [wikiId, targetUserId]);
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export interface CreateInviteInput {
  wikiId: string;
  callerId: string;
  invitedUsername?: string | null;
}

export async function createInvite(input: CreateInviteInput): Promise<{ token: string; expiresAt: string }> {
  const wiki = await getWikiForPermissionCheck(input.wikiId);
  if (!wiki) throw notFound("Wiki not found");
  const allowed = await canManageWiki(wiki, input.callerId);
  if (!allowed) throw forbidden("Only the wiki owner or a moderator can invite collaborators.");

  let invitedUserId: string | null = null;
  if (input.invitedUsername) {
    const { rows } = await db.query<{ id: string }>(`SELECT id FROM users WHERE username = $1 AND deleted_at IS NULL LIMIT 1`, [input.invitedUsername.trim()]);
    if (!rows[0]) throw notFound("User not found");
    invitedUserId = rows[0].id;
  }

  const expiryHours = await getWikiInviteExpiryHours();
  const token = randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

  await db.query(
    `INSERT INTO wiki_invites (wiki_id, token, invited_user_id, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.wikiId, token, invitedUserId, input.callerId, expiresAt]
  );

  if (invitedUserId) {
    const { rows: nameRows } = await db.query<{ name: string }>(`SELECT name FROM wikis WHERE id = $1 LIMIT 1`, [input.wikiId]);
    const wikiName = nameRows[0]?.name ?? "a wiki";
    await insertNotification(
      db,
      invitedUserId,
      "wiki_invite_received",
      "You've been invited to collaborate on a wiki",
      `You've been invited to join "${wikiName}" as a collaborator.`,
      { wikiId: input.wikiId, token }
    ).catch(() => {});
  }

  return { token, expiresAt };
}

export async function acceptInvite(token: string, userId: string): Promise<{ wikiId: string; wikiSlug: string }> {
  const invite = await getInviteByToken(token);
  if (!invite) throw notFound("Invite not found");
  if (invite.used_at) throw badRequest("This invite has already been used.", "WIKI_INVITE_USED");
  if (new Date(invite.expires_at) < new Date()) throw badRequest("This invite has expired.", "WIKI_INVITE_EXPIRED");
  if (invite.invited_user_id && invite.invited_user_id !== userId) {
    throw forbidden("This invite was sent to a different user.", "WIKI_INVITE_WRONG_USER");
  }

  const wiki = await getWikiById(invite.wiki_id);
  if (!wiki) throw notFound("Wiki not found");

  await db.transaction(async (tx: TransactionClient) => {
    await tx.query(`UPDATE wiki_invites SET used_at = NOW(), used_by_user_id = $2 WHERE id = $1`, [invite.id, userId]);
    const { rowCount } = await tx.query(
      `INSERT INTO wiki_collaborators (wiki_id, user_id, role, status, invited_by)
       VALUES ($1, $2, 'contributor', 'active', $3)
       ON CONFLICT (wiki_id, user_id) DO UPDATE SET status = 'active', updated_at = NOW() WHERE wiki_collaborators.status != 'active'`,
      [invite.wiki_id, userId, invite.created_by]
    );
    if (rowCount && rowCount > 0) {
      await tx.query(`UPDATE wikis SET contributor_count = contributor_count + 1, updated_at = NOW() WHERE id = $1`, [invite.wiki_id]);
    }
  });

  return { wikiId: wiki.id, wikiSlug: wiki.slug };
}

// ---------------------------------------------------------------------------
// Sharing + Reward pot
// ---------------------------------------------------------------------------

export async function shareWiki(wikiId: string, userId: string): Promise<{ rewardClaimed: number | null }> {
  await requireFeatureEnabled("wiki");
  const manifest = await loadManifest();
  return recordContentShare("wiki", wikiId, userId, "wiki_treasury_claim", manifest.features.wikiMonetization, async () => {});
}

export async function fundWikiTreasury(wikiId: string, callerId: string, amount: number, maxClaimants: number): Promise<TreasuryState> {
  await requireFeatureEnabled("wiki");
  await requireFeatureEnabled("wikiMonetization");
  const { rows } = await db.query<{ owner_id: string }>(`SELECT owner_id FROM wikis WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [wikiId]);
  const wiki = rows[0];
  if (!wiki) throw notFound("Wiki not found");
  if (wiki.owner_id !== callerId) throw forbidden("Only the wiki owner can fund its reward pot.");

  return fundContentTreasury(callerId, "wiki", wikiId, amount, maxClaimants, "wiki_treasury_fund");
}

export async function getWikiTreasury(wikiId: string): Promise<TreasuryState | null> {
  return getContentTreasury("wiki", wikiId);
}

// ---------------------------------------------------------------------------
// Admin moderation
// ---------------------------------------------------------------------------

export type WikiAdminAction = "suspend" | "ban" | "deactivate" | "pause" | "restore" | "delete" | "transfer_ownership";

export async function logWikiModeration(moderatorId: string, wikiId: string | null, pageId: string | null, targetUserId: string | null, action: string, reason?: string | null, metadata?: Record<string, unknown>): Promise<void> {
  await db.query(
    `INSERT INTO wiki_moderation_log (moderator_id, wiki_id, page_id, target_user_id, action, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [moderatorId, wikiId, pageId, targetUserId, action, reason ?? null, JSON.stringify(metadata ?? {})]
  );
}

const STATUS_FOR_ACTION: Partial<Record<WikiAdminAction, string>> = {
  suspend: "suspended",
  ban: "banned",
  deactivate: "deactivated",
  pause: "paused",
  restore: "active",
};

export async function setWikiStatus(wikiId: string, moderatorId: string, action: WikiAdminAction, reason?: string | null): Promise<void> {
  if (action === "delete") {
    const { rows } = await db.query<{ owner_id: string }>(`SELECT owner_id FROM wikis WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [wikiId]);
    if (!rows[0]) throw notFound("Wiki not found");
    await db.query(`UPDATE wikis SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [wikiId]);
    await logWikiModeration(moderatorId, wikiId, null, rows[0].owner_id, "delete", reason);
    return;
  }

  const status = STATUS_FOR_ACTION[action];
  if (!status) throw new ApiError(400, "WIKI_INVALID_ACTION", `Unsupported action: ${action}`);

  const { rows } = await db.query<{ owner_id: string }>(
    `UPDATE wikis SET status = $2, status_reason = $3, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING owner_id`,
    [wikiId, status, reason ?? null]
  );
  if (!rows[0]) throw notFound("Wiki not found");
  await logWikiModeration(moderatorId, wikiId, null, rows[0].owner_id, action, reason);
}

export async function transferWikiOwnership(wikiId: string, moderatorId: string, newOwnerId: string): Promise<void> {
  const { rows: userRows } = await db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [newOwnerId]);
  if (!userRows[0]) throw notFound("Target user not found");

  const { rows } = await db.query<{ owner_id: string }>(
    `UPDATE wikis SET owner_id = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING owner_id`,
    [wikiId, newOwnerId]
  );
  if (!rows[0]) throw notFound("Wiki not found");

  await db.query(
    `INSERT INTO wiki_collaborators (wiki_id, user_id, role, status)
     VALUES ($1, $2, 'owner', 'active')
     ON CONFLICT (wiki_id, user_id) DO UPDATE SET role = 'owner', status = 'active', updated_at = NOW()`,
    [wikiId, newOwnerId]
  );
  await logWikiModeration(moderatorId, wikiId, null, newOwnerId, "transfer_ownership", null, { newOwnerId });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getOwnerPlan(wikiId: string): Promise<string> {
  const { rows } = await db.query<{ plan: string }>(
    `SELECT u.plan FROM wikis w JOIN users u ON u.id = w.owner_id WHERE w.id = $1 LIMIT 1`,
    [wikiId]
  );
  return rows[0]?.plan ?? "free";
}
