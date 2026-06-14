/**
 * __tests__/integration/helpers.ts
 *
 * Seed data factories and query helpers for integration tests.
 * All helpers accept a PoolClient so they participate in the test transaction.
 */

import { PoolClient } from "pg";
import * as bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

export { randomUUID as uuid };

// ---------------------------------------------------------------------------
// User factory
// ---------------------------------------------------------------------------

export interface SeedUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  plan: "free" | "plus" | "pro" | "max";
  coinBalance: number;
  starBalance: number;
  xpTotal: number;
  availableEarningsKobo: number;
  referredBy: string | null;
  referralCode: string;
  payoutRecipientCode: string | null;
  payoutAccountLast4: string | null;
}

let _userCounter = 0;

export async function createUser(
  client: PoolClient,
  overrides: Partial<{
    username: string;
    email: string;
    displayName: string;
    plan: string;
    coinBalance: number;
    starBalance: number;
    xpTotal: number;
    availableEarningsKobo: number;
    referredBy: string | null;
    payoutRecipientCode: string | null;
    payoutAccountLast4: string | null;
    isCreator: boolean;
    isVerified: boolean;
    isBanned: boolean;
  }> = {}
): Promise<SeedUser> {
  const n = ++_userCounter;
  const id = randomUUID();
  const referralCode = `REF${id.slice(0, 8).toUpperCase()}`;

  const username = overrides.username ?? `testuser${n}_${id.slice(0, 6)}`;
  const email = overrides.email ?? `testuser${n}@integration.test`;
  const displayName = overrides.displayName ?? `Test User ${n}`;
  const plan = overrides.plan ?? "free";
  const coinBalance = overrides.coinBalance ?? 0;
  const starBalance = overrides.starBalance ?? 0;
  const xpTotal = overrides.xpTotal ?? 0;
  const availableEarningsKobo = overrides.availableEarningsKobo ?? 0;
  const referredBy = overrides.referredBy ?? null;
  const payoutRecipientCode = overrides.payoutRecipientCode ?? null;
  const payoutAccountLast4 = overrides.payoutAccountLast4 ?? null;

  await client.query(
    `INSERT INTO users (
       id, username, display_name, email, password_hash,
       plan, coin_balance, star_balance, xp_total,
       available_earnings_kobo, referred_by, referral_code,
       is_creator, is_verified, is_banned,
       payout_recipient_code, payout_account_last4,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9,
       $10, $11, $12,
       $13, $14, $15,
       $16, $17,
       NOW(), NOW()
     )`,
    [
      id,
      username,
      displayName,
      email,
      await bcrypt.hash("TestPassword123!", 10),
      plan,
      coinBalance,
      starBalance,
      xpTotal,
      availableEarningsKobo,
      referredBy,
      referralCode,
      overrides.isCreator ?? false,
      overrides.isVerified ?? false,
      overrides.isBanned ?? false,
      payoutRecipientCode,
      payoutAccountLast4,
    ]
  );

  return {
    id,
    username,
    email,
    displayName,
    plan: plan as SeedUser["plan"],
    coinBalance,
    starBalance,
    xpTotal,
    availableEarningsKobo,
    referredBy,
    referralCode,
    payoutRecipientCode,
    payoutAccountLast4,
  };
}

// ---------------------------------------------------------------------------
// Quest template factory
// ---------------------------------------------------------------------------

export async function createQuestTemplate(
  client: PoolClient,
  overrides: Partial<{
    title: string;
    actionType: string;
    targetCount: number;
    xpReward: number;
    coinReward: number;
  }> = {}
): Promise<{ id: string; title: string }> {
  const id = randomUUID();
  const title = overrides.title ?? `Test Quest ${id.slice(0, 8)}`;
  const actionType = overrides.actionType ?? "send_text_message";
  const targetCount = overrides.targetCount ?? 5;
  const xpReward = overrides.xpReward ?? 50;
  const coinReward = overrides.coinReward ?? 10;

  await client.query(
    `INSERT INTO quest_templates (id, title, description, action_type, target_count, xp_reward, coin_reward)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, title, `Description for ${title}`, actionType, targetCount, xpReward, coinReward]
  );

  return { id, title };
}

// ---------------------------------------------------------------------------
// Report factory
// ---------------------------------------------------------------------------

export async function createReport(
  client: PoolClient,
  reporterUserId: string,
  reportedUserId: string,
  reason = "spam"
): Promise<{ id: string }> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO reports (id, reporter_user_id, reported_user_id, reason, status, created_at)
     VALUES ($1, $2, $3, $4, 'pending', NOW())`,
    [id, reporterUserId, reportedUserId, reason]
  );
  return { id };
}

// ---------------------------------------------------------------------------
// Moderation action factory
// ---------------------------------------------------------------------------

export async function createModerationAction(
  client: PoolClient,
  targetUserId: string,
  actionType: string,
  moderatorId?: string
): Promise<{ id: string }> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO moderation_actions (id, target_user_id, moderator_id, action_type, reason, created_at)
     VALUES ($1, $2, $3, $4, 'Integration test action', NOW())`,
    [id, targetUserId, moderatorId ?? null, actionType]
  );
  return { id };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export async function getUserById(
  client: PoolClient,
  userId: string
): Promise<{
  id: string;
  coin_balance: string;
  star_balance: number;
  xp_total: number;
  trust_score: number | null;
  available_earnings_kobo: string;
} | null> {
  const { rows } = await client.query(
    `SELECT id, coin_balance, star_balance, xp_total, trust_score, available_earnings_kobo
     FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function getXpLedgerEntries(
  client: PoolClient,
  userId: string
): Promise<Array<{ user_id: string; amount: number; source: string; reference_id: string | null }>> {
  const { rows } = await client.query(
    `SELECT user_id, amount, source, reference_id FROM xp_ledger WHERE user_id = $1 ORDER BY created_at`,
    [userId]
  );
  return rows;
}

export async function getCoinLedgerEntries(
  client: PoolClient,
  userId: string
): Promise<Array<{ user_id: string; amount: string; transaction_type: string }>> {
  const { rows } = await client.query(
    `SELECT user_id, amount, transaction_type FROM coin_ledger WHERE user_id = $1 ORDER BY created_at`,
    [userId]
  );
  return rows;
}

export async function getPayoutById(
  client: PoolClient,
  payoutId: string
): Promise<{
  id: string;
  status: string;
  bank_account_snapshot: Record<string, string> | null;
  amount_kobo: string;
} | null> {
  const { rows } = await client.query(
    `SELECT id, status, bank_account_snapshot, amount_kobo FROM creator_payouts WHERE id = $1`,
    [payoutId]
  );
  return rows[0] ?? null;
}
