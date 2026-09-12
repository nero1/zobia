/**
 * lib/username/eligibility.ts
 *
 * Admin-configurable eligibility, cost and cooldown rules for the Username
 * Change feature (x_manifest keys seeded in
 * db/migrations/0037_username_change.sql). Mirrors the
 * lib/ads/limits.ts / lib/business/limits.ts convention: thin helpers over
 * getManifestValue, re-checked server-side inside the change transaction —
 * never trust a client-side eligibility gate alone.
 */

import { db } from "@/lib/db";
import { getManifestValue } from "@/lib/manifest";

interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface UsernameChangeConfig {
  minLevel: number;
  eligiblePlans: string[];
  eligibleBusinessTiers: string[];
  costCredits: number;
  costStars: number;
  cooldownDays: number;
}

async function readJsonArray(key: string, fallback: string[]): Promise<string[]> {
  try {
    const raw = await getManifestValue(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]).map((v) => String(v).toLowerCase()) : fallback;
  } catch {
    return fallback;
  }
}

async function readInt(key: string, fallback: number): Promise<number> {
  const raw = await getManifestValue(key);
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function getUsernameChangeConfig(): Promise<UsernameChangeConfig> {
  const [minLevel, eligiblePlans, eligibleBusinessTiers, costCredits, costStars, cooldownDays] = await Promise.all([
    readInt("username_change_min_level", 5),
    readJsonArray("username_change_plans", ["max"]),
    readJsonArray("username_change_business_tiers", ["growth", "enterprise"]),
    readInt("username_change_cost_credits", 5000),
    readInt("username_change_cost_stars", 50),
    readInt("username_change_cooldown_days", 90),
  ]);
  return { minLevel, eligiblePlans, eligibleBusinessTiers, costCredits, costStars, cooldownDays };
}

export interface UsernameChangeUserRow {
  id: string;
  username: string;
  plan: string;
  rank_level: number;
  business_tier: string | null;
  business_status: string | null;
}

async function loadUserRow(userId: string, client: Queryable): Promise<UsernameChangeUserRow | null> {
  const { rows } = await client.query<UsernameChangeUserRow>(
    `SELECT u.id, u.username, COALESCE(u.plan, 'free') AS plan,
            COALESCE(u.rank_level, 1) AS rank_level,
            ba.tier AS business_tier, ba.status AS business_status
     FROM users u
     LEFT JOIN business_accounts ba ON ba.user_id = u.id
     WHERE u.id = $1 AND u.deleted_at IS NULL
     LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

export interface UsernameChangeEligibility {
  eligible: boolean;
  reason?: string;
  config: UsernameChangeConfig;
  /** Null when the user has never changed their username (no cooldown to wait out). */
  nextEligibleAt: string | null;
  cooldownActive: boolean;
}

/**
 * Checks BOTH the tier/level/plan/business eligibility AND the cooldown
 * (once every `cooldownDays`, tracked off username_change_history.changed_at)
 * for a user. Callers MUST call this again inside the change transaction
 * (with the tx client) right before charging/writing — the client-side gate
 * and any earlier read are advisory only.
 */
export async function checkUsernameChangeEligibility(
  userId: string,
  client: Queryable = db
): Promise<UsernameChangeEligibility> {
  const config = await getUsernameChangeConfig();
  const user = await loadUserRow(userId, client);

  if (!user) {
    return { eligible: false, reason: "Account not found.", config, nextEligibleAt: null, cooldownActive: false };
  }

  const businessTierActive = user.business_status === "active" ? user.business_tier?.toLowerCase() ?? null : null;

  const meetsLevel = user.rank_level >= config.minLevel;
  const meetsPlan = config.eligiblePlans.includes(user.plan.toLowerCase());
  const meetsBusinessTier = !!businessTierActive && config.eligibleBusinessTiers.includes(businessTierActive);

  if (!meetsLevel && !meetsPlan && !meetsBusinessTier) {
    return {
      eligible: false,
      reason: `Changing your username requires account level ${config.minLevel}+, the Max plan, or a Business Growth/Enterprise account.`,
      config,
      nextEligibleAt: null,
      cooldownActive: false,
    };
  }

  const { rows } = await client.query<{ changed_at: string }>(
    `SELECT changed_at FROM username_change_history
     WHERE user_id = $1 ORDER BY changed_at DESC LIMIT 1`,
    [userId]
  );
  const lastChange = rows[0]?.changed_at ?? null;
  if (lastChange) {
    const nextEligibleAt = new Date(new Date(lastChange).getTime() + config.cooldownDays * 24 * 60 * 60 * 1000);
    if (nextEligibleAt.getTime() > Date.now()) {
      return {
        eligible: false,
        reason: `You can change your username again on ${nextEligibleAt.toISOString().slice(0, 10)}.`,
        config,
        nextEligibleAt: nextEligibleAt.toISOString(),
        cooldownActive: true,
      };
    }
  }

  return { eligible: true, config, nextEligibleAt: null, cooldownActive: false };
}
