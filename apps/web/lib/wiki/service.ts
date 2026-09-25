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
 *
 * DRIZZLE MIGRATION NOTES:
 *  - `lib/slug.ts` (generateUniqueSlug, generateUniqueWikiPageSlug,
 *    recordSlugRedirect) is out of this migration's file list and still
 *    takes the legacy raw `db` adapter for its own internal fallback
 *    queries — `db` is kept in scope solely to pass into it, never for
 *    direct raw-adapter calls here.
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getDb, schema, type DbOrTx } from "@/lib/db/drizzle";
import { and, eq, isNull, sql } from "drizzle-orm";
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
  editContentTreasury,
  closeContentTreasury,
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

// insertNotificationBatch/insertNotification below have been left using
// `void insertNotificationBatch;` avoidance — unused import guard removed
// since insertNotificationBatch is not called in this file post-conversion.

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
    const orm = await getDb();
    const rows = await orm
      .select({ earned: sql<string>`COALESCE(SUM(${schema.coinLedger.amount}), 0)::text` })
      .from(schema.coinLedger)
      .where(
        and(
          eq(schema.coinLedger.userId, userId),
          sql`${schema.coinLedger.transactionType} LIKE 'wiki_%'`,
          sql`${schema.coinLedger.amount} > 0`,
          sql`${schema.coinLedger.createdAt} >= NOW() - INTERVAL '24 hours'`
        )
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

  const orm = await getDb();
  await orm.transaction(async (tx) => {
    await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, input.userId)).for("update");
    const used = await countOwnedWikis(input.userId, tx);
    if (used >= maxOwned) {
      throw forbidden(`Your plan allows a maximum of ${maxOwned} wikis. Upgrade your plan to create more.`, "WIKI_OWNED_LIMIT_REACHED", { maxOwned });
    }

    await tx.insert(schema.wikis).values({
      id: wikiId,
      ownerId: input.userId,
      slug,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      contributePolicy: policy,
      status: "active",
    });
    await tx.insert(schema.wikiCollaborators).values({
      wikiId,
      userId: input.userId,
      role: "owner",
      status: "active",
    });
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
  const orm = await getDb();
  const rows = await orm
    .select({ ownerId: schema.wikis.ownerId, name: schema.wikis.name, slug: schema.wikis.slug })
    .from(schema.wikis)
    .where(and(eq(schema.wikis.id, wikiId), isNull(schema.wikis.deletedAt)))
    .limit(1);
  const wiki = rows[0];
  if (!wiki) throw notFound("Wiki not found");
  if (wiki.ownerId !== callerId) throw forbidden("Only the wiki owner can update these settings.");

  const patch: Partial<typeof schema.wikis.$inferInsert> = {};

  let newSlug: string | null = null;
  if (input.name !== undefined) {
    const trimmedName = input.name.trim();
    patch.name = trimmedName;
    if (trimmedName && trimmedName !== wiki.name) {
      // `db` (the legacy adapter) is passed through because generateUniqueSlug
      // (lib/slug.ts) is out of this migration's scope and still expects it.
      newSlug = await generateUniqueSlug("wiki", trimmedName, wikiId, db, wikiId);
      if (newSlug !== wiki.slug) patch.slug = newSlug;
      else newSlug = null;
    }
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.avatarUrl !== undefined) patch.avatarUrl = input.avatarUrl || null;
  if (input.coverImageUrl !== undefined) patch.coverImageUrl = input.coverImageUrl || null;
  if (input.contributePolicy !== undefined) patch.contributePolicy = input.contributePolicy;

  if (Object.keys(patch).length === 0) return;
  await orm.update(schema.wikis).set({ ...patch, updatedAt: sql`NOW()` }).where(eq(schema.wikis.id, wikiId));
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
async function ensureCollaboratorRow(tx: DbOrTx, wikiId: string, userId: string): Promise<boolean> {
  const inserted = await tx
    .insert(schema.wikiCollaborators)
    .values({ wikiId, userId, role: "contributor", status: "active" })
    .onConflictDoUpdate({
      target: [schema.wikiCollaborators.wikiId, schema.wikiCollaborators.userId],
      set: { status: "active" },
      setWhere: sql`${schema.wikiCollaborators.status} != 'active'`,
    })
    .returning({ userId: schema.wikiCollaborators.userId });
  return inserted.length > 0;
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

  const orm = await getDb();
  let becameContributor = false;
  await orm.transaction(async (tx) => {
    await tx.insert(schema.wikiPages).values({
      id: pageId,
      wikiId: input.wikiId,
      slug,
      title: input.title.trim(),
      contentMarkdown: input.contentMarkdown,
      contentHtml,
      contentFormat,
      status: "published",
      createdBy: input.authorId,
      lastEditedBy: input.authorId,
    });
    await tx.insert(schema.wikiPageRevisions).values({
      pageId,
      revisionNumber: 1,
      title: input.title.trim(),
      contentMarkdown: input.contentMarkdown,
      contentFormat,
      editSummary: "Created the page",
      editedBy: input.authorId,
    });
    await tx
      .update(schema.wikis)
      .set({ pageCount: sql`${schema.wikis.pageCount} + 1`, editCount: sql`${schema.wikis.editCount} + 1`, updatedAt: sql`NOW()` })
      .where(eq(schema.wikis.id, input.wikiId));
    becameContributor = await ensureCollaboratorRow(tx, input.wikiId, input.authorId);
    await tx
      .update(schema.wikiCollaborators)
      .set({ pageEditCount: sql`${schema.wikiCollaborators.pageEditCount} + 1`, updatedAt: sql`NOW()` })
      .where(and(eq(schema.wikiCollaborators.wikiId, input.wikiId), eq(schema.wikiCollaborators.userId, input.authorId)));
  });

  if (becameContributor) {
    await orm.update(schema.wikis).set({ contributorCount: sql`${schema.wikis.contributorCount} + 1` }).where(eq(schema.wikis.id, input.wikiId)).catch(() => {});
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

  const orm = await getDb();
  let becameContributor = false;
  await orm.transaction(async (tx) => {
    const nextRevRows = await tx
      .select({ next: sql<number>`COALESCE(MAX(${schema.wikiPageRevisions.revisionNumber}), 0) + 1` })
      .from(schema.wikiPageRevisions)
      .where(eq(schema.wikiPageRevisions.pageId, pageId));
    const nextRevision = nextRevRows[0]?.next ?? 2;

    await tx
      .update(schema.wikiPages)
      .set({
        title,
        contentMarkdown,
        contentHtml,
        contentFormat,
        revisionCount: nextRevision,
        lastEditedBy: callerId,
        updatedAt: sql`NOW()`,
      })
      .where(eq(schema.wikiPages.id, pageId));
    await tx.insert(schema.wikiPageRevisions).values({
      pageId,
      revisionNumber: nextRevision,
      title,
      contentMarkdown,
      contentFormat,
      editSummary: input.editSummary?.trim() || null,
      editedBy: callerId,
    });
    await tx.update(schema.wikis).set({ editCount: sql`${schema.wikis.editCount} + 1`, updatedAt: sql`NOW()` }).where(eq(schema.wikis.id, page.wiki_id));
    becameContributor = await ensureCollaboratorRow(tx, page.wiki_id, callerId);
    await tx
      .update(schema.wikiCollaborators)
      .set({ pageEditCount: sql`${schema.wikiCollaborators.pageEditCount} + 1`, updatedAt: sql`NOW()` })
      .where(and(eq(schema.wikiCollaborators.wikiId, page.wiki_id), eq(schema.wikiCollaborators.userId, callerId)));
  });

  if (becameContributor) {
    await orm.update(schema.wikis).set({ contributorCount: sql`${schema.wikis.contributorCount} + 1` }).where(eq(schema.wikis.id, page.wiki_id)).catch(() => {});
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

  const orm = await getDb();
  await orm.transaction(async (tx) => {
    await tx.update(schema.wikiPages).set({ deletedAt: sql`NOW()`, updatedAt: sql`NOW()` }).where(eq(schema.wikiPages.id, pageId));
    await tx
      .update(schema.wikis)
      .set({ pageCount: sql`GREATEST(${schema.wikis.pageCount} - 1, 0)`, updatedAt: sql`NOW()` })
      .where(eq(schema.wikis.id, page.wiki_id));
  });
}

export async function restorePageRevision(pageId: string, callerId: string, revisionNumber: number): Promise<void> {
  const page = await getWikiPageById(pageId);
  if (!page) throw notFound("Page not found");
  const wiki = await getWikiForPermissionCheck(page.wiki_id);
  if (!wiki) throw notFound("Wiki not found");
  const allowed = await canContributeToWiki(wiki, callerId);
  if (!allowed) throw forbidden("You don't have permission to edit this page.");

  const orm = await getDb();
  const rows = await orm
    .select({ title: schema.wikiPageRevisions.title, contentMarkdown: schema.wikiPageRevisions.contentMarkdown, contentFormat: schema.wikiPageRevisions.contentFormat })
    .from(schema.wikiPageRevisions)
    .where(and(eq(schema.wikiPageRevisions.pageId, pageId), eq(schema.wikiPageRevisions.revisionNumber, revisionNumber)))
    .limit(1);
  const revision = rows[0];
  if (!revision) throw notFound("Revision not found");

  await updatePage(pageId, callerId, {
    title: revision.title,
    contentMarkdown: revision.contentMarkdown,
    contentFormat: revision.contentFormat as WikiContentFormat,
    editSummary: `Restored revision #${revisionNumber}`,
  });
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export async function recordWikiView(wikiId: string): Promise<void> {
  const orm = await getDb();
  await orm.update(schema.wikis).set({ viewCount: sql`${schema.wikis.viewCount} + 1` }).where(and(eq(schema.wikis.id, wikiId), isNull(schema.wikis.deletedAt)));
}

export async function recordPageView(pageId: string): Promise<void> {
  const orm = await getDb();
  await orm.update(schema.wikiPages).set({ viewCount: sql`${schema.wikiPages.viewCount} + 1` }).where(and(eq(schema.wikiPages.id, pageId), isNull(schema.wikiPages.deletedAt)));
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

  const orm = await getDb();
  await orm
    .insert(schema.wikiCollaborators)
    .values({ wikiId, userId: targetUserId, role: "moderator", isModerator: true, moderatorGrantedBy: callerId, moderatorGrantedAt: sql`NOW()`, status: "active" })
    .onConflictDoUpdate({
      target: [schema.wikiCollaborators.wikiId, schema.wikiCollaborators.userId],
      set: { role: "moderator", isModerator: true, moderatorGrantedBy: callerId, moderatorGrantedAt: sql`NOW()`, status: "active", updatedAt: sql`NOW()` },
    });

  await insertNotification(orm, targetUserId, "wiki_moderator_granted", "You're now a wiki moderator", "You were made a moderator of a wiki.", { wikiId }).catch(() => {});
}

export async function revokeModerator(wikiId: string, callerId: string, targetUserId: string): Promise<void> {
  const wiki = await getWikiForPermissionCheck(wikiId);
  if (!wiki) throw notFound("Wiki not found");
  if (wiki.owner_id !== callerId) {
    const staff = await getStaffRoles(callerId);
    if (!staff.isAdmin) throw forbidden("Only the wiki owner (or an admin) can remove moderators.");
  }

  const orm = await getDb();
  await orm
    .update(schema.wikiCollaborators)
    .set({ isModerator: false, role: "contributor", updatedAt: sql`NOW()` })
    .where(and(eq(schema.wikiCollaborators.wikiId, wikiId), eq(schema.wikiCollaborators.userId, targetUserId)));
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

  const orm = await getDb();
  await orm
    .insert(schema.wikiCollaborators)
    .values({ wikiId, userId: targetUserId, role: "contributor", status: "active", invitedBy: callerId })
    .onConflictDoUpdate({
      target: [schema.wikiCollaborators.wikiId, schema.wikiCollaborators.userId],
      set: { status: "active", updatedAt: sql`NOW()` },
    });
}

export async function removeCollaborator(wikiId: string, callerId: string, targetUserId: string): Promise<void> {
  const wiki = await getWikiForPermissionCheck(wikiId);
  if (!wiki) throw notFound("Wiki not found");
  const allowed = await canManageWiki(wiki, callerId);
  if (!allowed) throw forbidden("Only the wiki owner or a moderator can remove collaborators.");
  if (targetUserId === wiki.owner_id) throw badRequest("Can't remove the wiki owner.", "WIKI_CANNOT_REMOVE_OWNER");

  const orm = await getDb();
  await orm
    .update(schema.wikiCollaborators)
    .set({ status: "removed", isModerator: false, updatedAt: sql`NOW()` })
    .where(and(eq(schema.wikiCollaborators.wikiId, wikiId), eq(schema.wikiCollaborators.userId, targetUserId)));
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

  const orm = await getDb();
  let invitedUserId: string | null = null;
  if (input.invitedUsername) {
    const rows = await orm.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.username, input.invitedUsername.trim()), isNull(schema.users.deletedAt))).limit(1);
    if (!rows[0]) throw notFound("User not found");
    invitedUserId = rows[0].id;
  }

  const expiryHours = await getWikiInviteExpiryHours();
  const token = randomUUID().replace(/-/g, "");
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

  await orm.insert(schema.wikiInvites).values({
    wikiId: input.wikiId,
    token,
    invitedUserId,
    createdBy: input.callerId,
    expiresAt,
  });

  if (invitedUserId) {
    const nameRows = await orm.select({ name: schema.wikis.name }).from(schema.wikis).where(eq(schema.wikis.id, input.wikiId)).limit(1);
    const wikiName = nameRows[0]?.name ?? "a wiki";
    await insertNotification(
      orm,
      invitedUserId,
      "wiki_invite_received",
      "You've been invited to collaborate on a wiki",
      `You've been invited to join "${wikiName}" as a collaborator.`,
      { wikiId: input.wikiId, token }
    ).catch(() => {});
  }

  return { token, expiresAt: expiresAt.toISOString() };
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

  const orm = await getDb();
  await orm.transaction(async (tx) => {
    await tx.update(schema.wikiInvites).set({ usedAt: sql`NOW()`, usedByUserId: userId }).where(eq(schema.wikiInvites.id, invite.id));
    const inserted = await tx
      .insert(schema.wikiCollaborators)
      .values({ wikiId: invite.wiki_id, userId, role: "contributor", status: "active", invitedBy: invite.created_by })
      .onConflictDoUpdate({
        target: [schema.wikiCollaborators.wikiId, schema.wikiCollaborators.userId],
        set: { status: "active", updatedAt: sql`NOW()` },
        setWhere: sql`${schema.wikiCollaborators.status} != 'active'`,
      })
      .returning({ userId: schema.wikiCollaborators.userId });
    if (inserted.length > 0) {
      await tx.update(schema.wikis).set({ contributorCount: sql`${schema.wikis.contributorCount} + 1`, updatedAt: sql`NOW()` }).where(eq(schema.wikis.id, invite.wiki_id));
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
  const orm = await getDb();
  const rows = await orm.select({ ownerId: schema.wikis.ownerId }).from(schema.wikis).where(and(eq(schema.wikis.id, wikiId), isNull(schema.wikis.deletedAt))).limit(1);
  const wiki = rows[0];
  if (!wiki) throw notFound("Wiki not found");
  if (wiki.ownerId !== callerId) throw forbidden("Only the wiki owner can fund its reward pot.");

  return fundContentTreasury(callerId, "wiki", wikiId, amount, maxClaimants, "wiki_treasury_fund");
}

/** Edit an already-funded pot's amount/max claimants — see editContentTreasury's docstring. */
export async function editWikiTreasury(wikiId: string, callerId: string, amount: number, maxClaimants: number): Promise<TreasuryState> {
  await requireFeatureEnabled("wiki");
  await requireFeatureEnabled("wikiMonetization");
  const orm = await getDb();
  const rows = await orm.select({ ownerId: schema.wikis.ownerId }).from(schema.wikis).where(and(eq(schema.wikis.id, wikiId), isNull(schema.wikis.deletedAt))).limit(1);
  const wiki = rows[0];
  if (!wiki) throw notFound("Wiki not found");
  if (wiki.ownerId !== callerId) throw forbidden("Only the wiki owner can edit its reward pot.");
  return editContentTreasury(callerId, "wiki", wikiId, amount, maxClaimants, "wiki_treasury_fund", "wiki_treasury_refund");
}

/** Turn off a wiki's reward pot, refunding unclaimed funds to the owner. */
export async function closeWikiTreasury(wikiId: string, callerId: string): Promise<TreasuryState> {
  await requireFeatureEnabled("wiki");
  const orm = await getDb();
  const rows = await orm.select({ ownerId: schema.wikis.ownerId }).from(schema.wikis).where(and(eq(schema.wikis.id, wikiId), isNull(schema.wikis.deletedAt))).limit(1);
  const wiki = rows[0];
  if (!wiki) throw notFound("Wiki not found");
  if (wiki.ownerId !== callerId) throw forbidden("Only the wiki owner can turn off its reward pot.");
  return closeContentTreasury(callerId, "wiki", wikiId, "wiki_treasury_refund");
}

export async function getWikiTreasury(wikiId: string): Promise<TreasuryState | null> {
  return getContentTreasury("wiki", wikiId);
}

// ---------------------------------------------------------------------------
// Admin moderation
// ---------------------------------------------------------------------------

export type WikiAdminAction = "suspend" | "ban" | "deactivate" | "pause" | "restore" | "delete" | "transfer_ownership";

export async function logWikiModeration(moderatorId: string, wikiId: string | null, pageId: string | null, targetUserId: string | null, action: string, reason?: string | null, metadata?: Record<string, unknown>): Promise<void> {
  const orm = await getDb();
  await orm.insert(schema.wikiModerationLog).values({
    moderatorId,
    wikiId,
    pageId,
    targetUserId,
    action,
    reason: reason ?? null,
    metadata: metadata ?? {},
  });
}

const STATUS_FOR_ACTION: Partial<Record<WikiAdminAction, string>> = {
  suspend: "suspended",
  ban: "banned",
  deactivate: "deactivated",
  pause: "paused",
  restore: "active",
};

export async function setWikiStatus(wikiId: string, moderatorId: string, action: WikiAdminAction, reason?: string | null): Promise<void> {
  const orm = await getDb();
  if (action === "delete") {
    const rows = await orm.select({ ownerId: schema.wikis.ownerId }).from(schema.wikis).where(and(eq(schema.wikis.id, wikiId), isNull(schema.wikis.deletedAt))).limit(1);
    if (!rows[0]) throw notFound("Wiki not found");
    await orm.update(schema.wikis).set({ deletedAt: sql`NOW()`, updatedAt: sql`NOW()` }).where(eq(schema.wikis.id, wikiId));
    await logWikiModeration(moderatorId, wikiId, null, rows[0].ownerId, "delete", reason);
    return;
  }

  const status = STATUS_FOR_ACTION[action];
  if (!status) throw new ApiError(400, "WIKI_INVALID_ACTION", `Unsupported action: ${action}`);

  const rows = await orm
    .update(schema.wikis)
    .set({ status, statusReason: reason ?? null, updatedAt: sql`NOW()` })
    .where(and(eq(schema.wikis.id, wikiId), isNull(schema.wikis.deletedAt)))
    .returning({ ownerId: schema.wikis.ownerId });
  if (!rows[0]) throw notFound("Wiki not found");
  await logWikiModeration(moderatorId, wikiId, null, rows[0].ownerId, action, reason);
}

export async function transferWikiOwnership(wikiId: string, moderatorId: string, newOwnerId: string): Promise<void> {
  const orm = await getDb();
  const userRows = await orm.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.id, newOwnerId), isNull(schema.users.deletedAt))).limit(1);
  if (!userRows[0]) throw notFound("Target user not found");

  const rows = await orm
    .update(schema.wikis)
    .set({ ownerId: newOwnerId, updatedAt: sql`NOW()` })
    .where(and(eq(schema.wikis.id, wikiId), isNull(schema.wikis.deletedAt)))
    .returning({ ownerId: schema.wikis.ownerId });
  if (!rows[0]) throw notFound("Wiki not found");

  await orm
    .insert(schema.wikiCollaborators)
    .values({ wikiId, userId: newOwnerId, role: "owner", status: "active" })
    .onConflictDoUpdate({
      target: [schema.wikiCollaborators.wikiId, schema.wikiCollaborators.userId],
      set: { role: "owner", status: "active", updatedAt: sql`NOW()` },
    });
  await logWikiModeration(moderatorId, wikiId, null, newOwnerId, "transfer_ownership", null, { newOwnerId });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getOwnerPlan(wikiId: string): Promise<string> {
  const orm = await getDb();
  const rows = await orm
    .select({ plan: schema.users.plan })
    .from(schema.wikis)
    .innerJoin(schema.users, eq(schema.users.id, schema.wikis.ownerId))
    .where(eq(schema.wikis.id, wikiId))
    .limit(1);
  return rows[0]?.plan ?? "free";
}
