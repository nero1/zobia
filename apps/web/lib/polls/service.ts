/**
 * lib/polls/service.ts
 *
 * Polls — user-created polls other users vote on, at /poll/<slug>.
 * Mirrors lib/forum/service.ts's structure: feature flag -> eligibility ->
 * level gate -> atomic write -> best-effort reward. Reward pots (treasuries)
 * reuse lib/contentTreasury.ts (shared with Quizzes) rather than a bespoke
 * poll_treasuries table.
 *
 * @module lib/polls/service
 */

import { randomUUID } from "crypto";
import { getDb } from "@/lib/db/drizzle";
import { sql } from "drizzle-orm";
import { loadManifest, requireFeatureEnabled, type ZobiaManifest } from "@/lib/manifest";
import { getRankForXP } from "@/lib/xp/engine";
import { safeAwardXPFireAndForget } from "@/lib/xp/safeAwardXP";
import { creditCoins } from "@/lib/economy/coins";
import { generateUniqueSlug } from "@/lib/slug";
import {
  fundContentTreasury,
  editContentTreasury,
  closeContentTreasury,
  claimContentTreasuryReward,
  getContentTreasury,
  recordContentShare,
  type TreasuryState,
} from "@/lib/contentTreasury";
import { badRequest, forbidden, notFound } from "@/lib/api/errors";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export interface PollEligibility {
  rankNumber: number;
  config: ZobiaManifest["polls"];
}

export async function getPollEligibility(userId: string): Promise<PollEligibility> {
  const orm = await getDb();
  const [manifest, userRows] = await Promise.all([
    loadManifest(),
    orm.execute<{ xp_total: number }>(sql`SELECT COALESCE(xp_total, 0) AS xp_total FROM users WHERE id = ${userId} AND deleted_at IS NULL LIMIT 1`),
  ]);
  const row = userRows.rows[0];
  if (!row) throw forbidden("User account not found");
  return { rankNumber: getRankForXP(row.xp_total).rankNumber, config: manifest.polls };
}

function assertCanCreate(eligibility: PollEligibility): void {
  if (eligibility.rankNumber < eligibility.config.minLevelToCreate) {
    throw forbidden(
      `You must reach Level ${eligibility.config.minLevelToCreate} to create a poll. Your current level is ${eligibility.rankNumber}.`,
      "POLL_LEVEL_TOO_LOW",
      { minLevel: eligibility.config.minLevelToCreate, currentLevel: eligibility.rankNumber }
    );
  }
}

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

async function awardCreditsCapped(userId: string, amount: number, referenceId: string, description: string, dailyCapCredits: number): Promise<void> {
  if (amount <= 0) return;
  try {
    const orm = await getDb();
    const { rows } = await orm.execute<{ earned: string }>(sql`
      SELECT COALESCE(SUM(amount), 0)::text AS earned
      FROM coin_ledger
      WHERE user_id = ${userId} AND transaction_type LIKE 'poll_%' AND amount > 0
        AND created_at >= NOW() - INTERVAL '24 hours'
    `);
    const earnedToday = parseInt(rows[0]?.earned ?? "0", 10);
    const headroom = dailyCapCredits - earnedToday;
    if (headroom <= 0) return;
    const capped = Math.min(amount, headroom);
    await creditCoins(userId, capped, "poll_create_reward", referenceId, description);
  } catch (err) {
    logger.error({ err, userId, amount }, "[polls/service] reward credit award failed");
  }
}

function awardPollRewards(userId: string, xpAmount: number, creditAmount: number, xpSource: string, referenceId: string, description: string, dailyCapCredits: number): void {
  if (xpAmount > 0) safeAwardXPFireAndForget(userId, xpAmount, "social", xpSource, referenceId);
  if (creditAmount > 0) awardCreditsCapped(userId, creditAmount, referenceId, description, dailyCapCredits).catch(() => {});
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreatePollInput {
  userId: string;
  title: string;
  description?: string | null;
  options: string[];
  allowMultiple?: boolean;
  closesAt?: string | null;
}

export interface PollSummary {
  id: string;
  slug: string;
}

export async function createPoll(input: CreatePollInput): Promise<PollSummary> {
  await requireFeatureEnabled("polls");
  const eligibility = await getPollEligibility(input.userId);
  assertCanCreate(eligibility);

  const options = input.options.map((o) => o.trim()).filter(Boolean);
  if (options.length < 2) throw badRequest("A poll needs at least 2 options.", "POLL_NOT_ENOUGH_OPTIONS");
  if (options.length > eligibility.config.maxOptions) {
    throw badRequest(`A poll may have at most ${eligibility.config.maxOptions} options.`, "POLL_TOO_MANY_OPTIONS");
  }

  const pollId = randomUUID();
  const slug = await generateUniqueSlug("poll", input.title, pollId);

  const orm = await getDb();
  await orm.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO polls (id, creator_id, slug, title, description, allow_multiple, closes_at)
      VALUES (${pollId}, ${input.userId}, ${slug}, ${input.title.trim()}, ${input.description?.trim() || null}, ${!!input.allowMultiple}, ${input.closesAt || null})
    `);
    for (let i = 0; i < options.length; i++) {
      await tx.execute(sql`INSERT INTO poll_options (poll_id, label, position) VALUES (${pollId}, ${options[i]}, ${i})`);
    }
  });

  awardPollRewards(
    input.userId,
    eligibility.config.rewardXpCreator,
    eligibility.config.rewardCreditsCreator,
    "poll_created",
    `poll_create_reward:${pollId}`,
    "Created a poll",
    eligibility.config.dailyRewardCapCredits
  );

  return { id: pollId, slug };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface PollOptionView {
  id: string;
  label: string;
  voteCount: number;
}

export interface PollDetail {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  allowMultiple: boolean;
  status: string;
  closesAt: string | null;
  viewCount: number;
  voterCount: number;
  shareCount: number;
  createdAt: string;
  creatorId: string;
  creatorUsername: string | null;
  creatorAvatarUrl: string | null;
  options: PollOptionView[];
  myVoteOptionIds: string[];
  isOwner: boolean;
}

interface PollRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  allow_multiple: boolean;
  status: string;
  closes_at: string | null;
  view_count: number;
  voter_count: number;
  share_count: number;
  created_at: string;
  creator_id: string;
  creator_username: string | null;
  creator_avatar_url: string | null;
}

export async function getPollBySlug(slug: string, viewerId?: string | null): Promise<PollDetail | null> {
  const orm = await getDb();
  const { rows } = await orm.execute<PollRow & Record<string, unknown>>(sql`
    SELECT p.id, p.slug, p.title, p.description, p.allow_multiple, p.status, p.closes_at, p.view_count,
           p.voter_count, p.share_count, p.created_at, p.creator_id, u.username AS creator_username, u.avatar_url AS creator_avatar_url
    FROM polls p
    JOIN users u ON u.id = p.creator_id
    WHERE p.slug = ${slug} AND p.deleted_at IS NULL LIMIT 1
  `);
  const poll = rows[0];
  if (!poll) return null;

  const { rows: optionRows } = await orm.execute<{ id: string; label: string; vote_count: number }>(
    sql`SELECT id, label, vote_count FROM poll_options WHERE poll_id = ${poll.id} ORDER BY position ASC`
  );

  let myVoteOptionIds: string[] = [];
  if (viewerId) {
    const { rows: voteRows } = await orm.execute<{ option_id: string }>(sql`SELECT option_id FROM poll_votes WHERE poll_id = ${poll.id} AND user_id = ${viewerId}`);
    myVoteOptionIds = voteRows.map((r) => r.option_id);
  }

  return {
    id: poll.id,
    slug: poll.slug,
    title: poll.title,
    description: poll.description,
    allowMultiple: poll.allow_multiple,
    status: poll.status,
    closesAt: poll.closes_at,
    viewCount: poll.view_count,
    voterCount: poll.voter_count,
    shareCount: poll.share_count,
    createdAt: poll.created_at,
    creatorId: poll.creator_id,
    creatorUsername: poll.creator_username,
    creatorAvatarUrl: poll.creator_avatar_url,
    options: optionRows.map((o) => ({ id: o.id, label: o.label, voteCount: o.vote_count })),
    myVoteOptionIds,
    isOwner: viewerId === poll.creator_id,
  };
}

export async function recordPollView(pollId: string): Promise<void> {
  const orm = await getDb();
  await orm.execute(sql`UPDATE polls SET view_count = view_count + 1 WHERE id = ${pollId}`).catch(() => {});
}

export interface ListPollsResult {
  polls: Array<{ id: string; slug: string; title: string; voterCount: number; createdAt: string; creatorUsername: string | null }>;
  nextCursor: string | null;
}

export async function listPolls(tab: "new" | "popular" | "mine", cursor: string | undefined, limit: number, viewerId?: string | null): Promise<ListPollsResult> {
  let where = sql`p.status = 'active' AND p.deleted_at IS NULL`;
  if (tab === "mine") {
    if (!viewerId) throw forbidden("Sign in to view your polls.");
    where = sql`p.creator_id = ${viewerId} AND p.deleted_at IS NULL`;
  }
  if (cursor) {
    where = sql`${where} AND p.created_at < (SELECT created_at FROM polls WHERE id = ${cursor})`;
  }
  const orderBy = tab === "popular" ? sql`p.voter_count DESC, p.created_at DESC` : sql`p.created_at DESC`;

  const orm = await getDb();
  const { rows } = await orm.execute<{ id: string; slug: string; title: string; voter_count: number; created_at: string; creator_username: string | null }>(sql`
    SELECT p.id, p.slug, p.title, p.voter_count, p.created_at, u.username AS creator_username
    FROM polls p JOIN users u ON u.id = p.creator_id
    WHERE ${where}
    ORDER BY ${orderBy}
    LIMIT ${limit}
  `);

  return {
    polls: rows.map((r) => ({ id: r.id, slug: r.slug, title: r.title, voterCount: r.voter_count, createdAt: r.created_at, creatorUsername: r.creator_username })),
    nextCursor: rows.length === limit ? rows[rows.length - 1].id : null,
  };
}

// ---------------------------------------------------------------------------
// Vote
// ---------------------------------------------------------------------------

export interface VoteResult {
  options: PollOptionView[];
  voterCount: number;
  rewardClaimed: number | null;
}

export async function votePoll(userId: string, pollId: string, optionIds: string[]): Promise<VoteResult> {
  await requireFeatureEnabled("polls");
  if (optionIds.length === 0) throw badRequest("Select at least one option.", "POLL_NO_OPTION_SELECTED");

  const orm = await getDb();
  const { rows: pollRows } = await orm.execute<{ id: string; allow_multiple: boolean; status: string; closes_at: string | null }>(
    sql`SELECT id, allow_multiple, status, closes_at FROM polls WHERE id = ${pollId} AND deleted_at IS NULL LIMIT 1`
  );
  const poll = pollRows[0];
  if (!poll) throw notFound("Poll not found");
  if (poll.status !== "active") throw badRequest("This poll is no longer accepting votes.", "POLL_NOT_ACTIVE");
  if (poll.closes_at && new Date(poll.closes_at) < new Date()) throw badRequest("This poll has closed.", "POLL_CLOSED");
  if (!poll.allow_multiple && optionIds.length > 1) throw badRequest("This poll only allows one selection.", "POLL_SINGLE_CHOICE");

  const { rows: existingVotes } = await orm.execute<{ option_id: string }>(sql`SELECT option_id FROM poll_votes WHERE poll_id = ${pollId} AND user_id = ${userId}`);
  if (existingVotes.length > 0) throw badRequest("You already voted on this poll.", "POLL_ALREADY_VOTED");

  const { rows: optionRows } = await orm.execute<{ id: string }>(sql`SELECT id FROM poll_options WHERE poll_id = ${pollId} AND id = ANY(${optionIds}::uuid[])`);
  if (optionRows.length !== optionIds.length) throw badRequest("Unknown poll option.", "POLL_UNKNOWN_OPTION");

  await orm.transaction(async (tx) => {
    for (const optionId of optionIds) {
      await tx.execute(sql`INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES (${pollId}, ${optionId}, ${userId})`);
      await tx.execute(sql`UPDATE poll_options SET vote_count = vote_count + 1 WHERE id = ${optionId}`);
    }
    await tx.execute(sql`UPDATE polls SET voter_count = voter_count + 1 WHERE id = ${pollId}`);
  });

  const manifest = await loadManifest();
  awardPollRewards(
    userId,
    manifest.polls.rewardXpVoter,
    manifest.polls.rewardCreditsVoter,
    "poll_voted",
    `poll_vote_reward:${pollId}:${userId}`,
    "Voted on a poll",
    manifest.polls.dailyRewardCapCredits
  );

  const claim = await claimContentTreasuryReward("poll", pollId, userId, "vote", "poll_treasury_claim", manifest.features.pollMonetization).catch((err) => {
    logger.error({ err, pollId, userId }, "[polls/service] failed to claim treasury reward for vote");
    return null;
  });

  const { rows: finalOptions } = await orm.execute<{ id: string; label: string; vote_count: number }>(sql`SELECT id, label, vote_count FROM poll_options WHERE poll_id = ${pollId} ORDER BY position ASC`);
  const { rows: countRows } = await orm.execute<{ voter_count: number }>(sql`SELECT voter_count FROM polls WHERE id = ${pollId}`);

  return {
    options: finalOptions.map((o) => ({ id: o.id, label: o.label, voteCount: o.vote_count })),
    voterCount: countRows[0]?.voter_count ?? 0,
    rewardClaimed: claim?.amount ?? null,
  };
}

// ---------------------------------------------------------------------------
// Share + Treasury
// ---------------------------------------------------------------------------

export async function sharePoll(userId: string, pollId: string): Promise<{ shareCount: number; rewardClaimed: number | null }> {
  await requireFeatureEnabled("polls");
  const orm = await getDb();
  const { rows } = await orm.execute<{ id: string }>(sql`SELECT id FROM polls WHERE id = ${pollId} AND deleted_at IS NULL LIMIT 1`);
  if (!rows[0]) throw notFound("Poll not found");

  const manifest = await loadManifest();
  const { rewardClaimed } = await recordContentShare("poll", pollId, userId, "poll_treasury_claim", manifest.features.pollMonetization, async (tx) => {
    await tx.execute(sql`UPDATE polls SET share_count = share_count + 1 WHERE id = ${pollId}`);
  });

  const { rows: countRows } = await orm.execute<{ share_count: number }>(sql`SELECT share_count FROM polls WHERE id = ${pollId}`);
  return { shareCount: countRows[0]?.share_count ?? 0, rewardClaimed };
}

export async function getPollTreasury(pollId: string): Promise<TreasuryState | null> {
  return getContentTreasury("poll", pollId);
}

/**
 * Only the poll's own creator may fund its reward pot — the funding amount
 * is always debited from the caller's own Credits balance (never anyone
 * else's), matching blogs' fundPostTreasury (only the post's author can
 * fund it, full stop). There is deliberately no "admin funds on a
 * creator's behalf" bypass: that would either silently debit the
 * creator's balance without their consent (if funded in their name) or
 * require a separate admin-grant flow this feature doesn't need for v1.
 * An admin who wants to sponsor a poll's pot can do so by being the
 * poll's own creator.
 */
export async function fundPollTreasury(userId: string, pollId: string, amount: number, maxClaimants: number): Promise<TreasuryState> {
  await requireFeatureEnabled("polls");
  await requireFeatureEnabled("pollMonetization");
  const orm = await getDb();
  const { rows } = await orm.execute<{ creator_id: string }>(sql`SELECT creator_id FROM polls WHERE id = ${pollId} AND deleted_at IS NULL LIMIT 1`);
  const poll = rows[0];
  if (!poll) throw notFound("Poll not found");
  if (poll.creator_id !== userId) throw forbidden("Only the poll's creator can fund its reward pot.");
  return fundContentTreasury(userId, "poll", pollId, amount, maxClaimants, "poll_treasury_fund");
}

/** Edit an already-funded pot's amount/max claimants — see editContentTreasury's docstring. */
export async function editPollTreasury(userId: string, pollId: string, amount: number, maxClaimants: number): Promise<TreasuryState> {
  await requireFeatureEnabled("polls");
  await requireFeatureEnabled("pollMonetization");
  const orm = await getDb();
  const { rows } = await orm.execute<{ creator_id: string }>(sql`SELECT creator_id FROM polls WHERE id = ${pollId} AND deleted_at IS NULL LIMIT 1`);
  const poll = rows[0];
  if (!poll) throw notFound("Poll not found");
  if (poll.creator_id !== userId) throw forbidden("Only the poll's creator can edit its reward pot.");
  return editContentTreasury(userId, "poll", pollId, amount, maxClaimants, "poll_treasury_fund", "poll_treasury_refund");
}

/** Turn off a poll's reward pot, refunding unclaimed funds to the creator. */
export async function closePollTreasury(userId: string, pollId: string): Promise<TreasuryState> {
  await requireFeatureEnabled("polls");
  const orm = await getDb();
  const { rows } = await orm.execute<{ creator_id: string }>(sql`SELECT creator_id FROM polls WHERE id = ${pollId} AND deleted_at IS NULL LIMIT 1`);
  const poll = rows[0];
  if (!poll) throw notFound("Poll not found");
  if (poll.creator_id !== userId) throw forbidden("Only the poll's creator can turn off its reward pot.");
  return closeContentTreasury(userId, "poll", pollId, "poll_treasury_refund");
}

// ---------------------------------------------------------------------------
// Ownership / moderation helpers
// ---------------------------------------------------------------------------

export async function getPollIdBySlug(slug: string): Promise<string | null> {
  const orm = await getDb();
  const { rows } = await orm.execute<{ id: string }>(sql`SELECT id FROM polls WHERE slug = ${slug} AND deleted_at IS NULL LIMIT 1`);
  return rows[0]?.id ?? null;
}

export async function assertPollOwnerOrAdmin(pollId: string, userId: string, isAdmin: boolean): Promise<{ creatorId: string }> {
  const orm = await getDb();
  const { rows } = await orm.execute<{ creator_id: string }>(sql`SELECT creator_id FROM polls WHERE id = ${pollId} AND deleted_at IS NULL LIMIT 1`);
  const poll = rows[0];
  if (!poll) throw notFound("Poll not found");
  if (poll.creator_id !== userId && !isAdmin) throw forbidden("Only the poll's creator or an admin can do this.");
  return { creatorId: poll.creator_id };
}

export async function setPollStatus(pollId: string, status: "active" | "closed" | "disabled"): Promise<void> {
  const orm = await getDb();
  const result = await orm.execute(sql`UPDATE polls SET status = ${status}, updated_at = NOW() WHERE id = ${pollId} AND deleted_at IS NULL`);
  if (!result.rowCount) throw notFound("Poll not found");
}

export async function deletePoll(pollId: string): Promise<void> {
  const orm = await getDb();
  const result = await orm.execute(sql`UPDATE polls SET deleted_at = NOW() WHERE id = ${pollId} AND deleted_at IS NULL`);
  if (!result.rowCount) throw notFound("Poll not found");
}
