/**
 * lib/privacy/leaderboardAnonymity.ts
 *
 * "Hide my name from public leaderboards" (paid privacy feature).
 *
 * Model
 *   - users.hide_from_leaderboards (default false = visible) holds the user's
 *     CHOICE. It only takes EFFECT while the user is still eligible, so a
 *     downgrade silently makes them visible again without a data migration.
 *   - Eligibility = feature enabled AND (plan/role list match OR level >=
 *     unlock level). All three knobs are admin-editable x_manifest keys, see
 *     manifest.leaderboardAnonymity and /gate44/config ("Privacy").
 *   - Reads apply the rule in SQL via {@link hiddenOnLeaderboardSql} so a
 *     leaderboard query never needs a second round trip, and mask identity per
 *     viewer with {@link maskLeaderboardRow} AFTER any cache, so cached data is
 *     viewer-independent.
 *
 * Viewer rules (mirrors the PRD "Privacy" section)
 *   - Public leaderboards: an anonymous entry shows "Anonymous" to everyone
 *     except the entry's own user (who sees themselves, flagged).
 *   - Sub-leaderboards (a classroom, a guild): the same, except the
 *     leaderboard's own admins get `revealed` identity behind a
 *     "Reveal" control (`canReveal`).
 */

import { sql, type SQL } from "drizzle-orm";
import { loadManifest } from "@/lib/manifest";
import { getRankForXP, xpForRankNumber } from "@/lib/xp/engine";
import { isPlanEligible, ELIGIBILITY_PLANS } from "@/lib/plans/eligibility";

export interface AnonymityConfig {
  enabled: boolean;
  /** 0 = level unlock disabled. */
  minLevel: number;
  eligible: string[];
}

export interface AnonymityUser {
  plan: string | null;
  prestigeCount: number | null;
  isAdmin: boolean | null;
  isModerator: boolean | null;
  businessTier: string | null;
  xpTotal: number | null;
}

/** Label shown in place of a hidden identity (also the `display_name` sent to clients). */
export const ANONYMOUS_DISPLAY_NAME = "Anonymous";
export const ANONYMOUS_USERNAME = "anonymous";
export const ANONYMOUS_AVATAR_EMOJI = "🕶️";

export async function getAnonymityConfig(): Promise<AnonymityConfig> {
  const m = await loadManifest();
  return m.leaderboardAnonymity;
}

/** JS twin of {@link eligibleSql}: may this user use the hide-from-leaderboards setting? */
export function isAnonymityEligible(user: AnonymityUser, cfg: AnonymityConfig): boolean {
  if (!cfg.enabled) return false;
  if (cfg.minLevel > 0 && getRankForXP(Number(user.xpTotal ?? 0)).rankNumber >= cfg.minLevel) return true;
  return isPlanEligible(user.plan ?? "free", user.prestigeCount ?? 0, cfg.eligible, {
    businessTier: user.businessTier,
    isAdmin: Boolean(user.isAdmin),
    isModerator: Boolean(user.isModerator),
  });
}

/**
 * SQL predicate: "the row's user is eligible to be anonymous" (alias `u` =
 * users). Mirrors {@link isAnonymityEligible} for every eligibility-list entry
 * type: plan slugs, prestige_N, business_<tier>, role_admin/role_moderator.
 */
export function eligibleSql(cfg: AnonymityConfig, alias = "u"): SQL {
  if (!cfg.enabled) return sql`FALSE`;
  const u = sql.raw(alias);
  const clauses: SQL[] = [];

  const plans = cfg.eligible.filter((e) => (ELIGIBILITY_PLANS as readonly string[]).includes(e));
  if (plans.length > 0) clauses.push(sql`LOWER(COALESCE(${u}.plan, 'free')) = ANY(${plans}::text[])`);

  const prestigeMins = cfg.eligible
    .map((e) => /^prestige_(\d+)$/.exec(e))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => parseInt(m[1], 10));
  if (prestigeMins.length > 0) {
    clauses.push(sql`COALESCE(${u}.prestige_count, 0) >= ${Math.min(...prestigeMins)}`);
  }

  const tiers = cfg.eligible
    .map((e) => /^business_(\w+)$/.exec(e))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1].toLowerCase());
  if (tiers.length > 0) {
    clauses.push(sql`EXISTS (
      SELECT 1 FROM business_accounts ba
      WHERE ba.user_id = ${u}.id AND ba.status = 'active' AND LOWER(ba.tier) = ANY(${tiers}::text[])
    )`);
  }

  if (cfg.eligible.includes("role_admin")) clauses.push(sql`COALESCE(${u}.is_admin, FALSE)`);
  if (cfg.eligible.includes("role_moderator")) clauses.push(sql`COALESCE(${u}.is_moderator, FALSE)`);

  if (cfg.minLevel > 0) clauses.push(sql`COALESCE(${u}.xp_total, 0) >= ${xpForRankNumber(cfg.minLevel)}`);

  return clauses.length > 0 ? sql`(${sql.join(clauses, sql` OR `)})` : sql`FALSE`;
}

/**
 * SQL predicate: "this user is EFFECTIVELY hidden from leaderboards" — their
 * stored choice AND current eligibility. Select it as a column
 * (`... AS is_anonymous`) in leaderboard queries.
 */
export function hiddenOnLeaderboardSql(cfg: AnonymityConfig, alias = "u"): SQL {
  if (!cfg.enabled) return sql`FALSE`;
  return sql`(COALESCE(${sql.raw(alias)}.hide_from_leaderboards, FALSE) AND ${eligibleSql(cfg, alias)})`;
}

export interface MaskOptions<T> {
  /** The row's user is effectively hidden (see hiddenOnLeaderboardSql). */
  anonymous: boolean;
  /** The row belongs to the requester. */
  isSelf: boolean;
  /** The requester administers this (sub-)leaderboard and may reveal hidden names. */
  canReveal: boolean;
  /** Field holding the user's id (replaced with an opaque value when masked). */
  idKey: keyof T & string;
  /** Identity fields to blank, with the value to show instead. */
  masked: Partial<T>;
  /** Opaque, stable-per-row id (e.g. `anon-<rank>`) used as the masked id / React key. */
  anonId: string;
}

export type MaskedRow<T> = T & {
  /** True when the row's user is hidden. */
  anonymous?: true;
  /** Real identity, present ONLY for viewers allowed to reveal it. */
  revealed?: Partial<T>;
};

/**
 * Apply anonymity to one leaderboard row for a specific viewer. Non-anonymous
 * rows are returned untouched. Never leaks the real identity to a viewer who
 * may not see it: the masked copy carries neither the original id nor names.
 */
export function maskLeaderboardRow<T extends object>(row: T, o: MaskOptions<T>): MaskedRow<T> {
  if (!o.anonymous) return row;
  if (o.isSelf) return { ...row, anonymous: true };

  const identityKeys = Object.keys(o.masked) as Array<keyof T & string>;
  const masked = { ...row, ...o.masked, [o.idKey]: o.anonId, anonymous: true } as MaskedRow<T>;
  if (o.canReveal) {
    const revealed = { [o.idKey]: row[o.idKey] } as Partial<T>;
    for (const k of identityKeys) revealed[k] = row[k];
    masked.revealed = revealed;
  }
  return masked;
}

/** Standard masked identity for snake_case leaderboard rows. */
export const ANONYMOUS_SNAKE_IDENTITY = {
  username: ANONYMOUS_USERNAME,
  display_name: ANONYMOUS_DISPLAY_NAME,
  avatar_emoji: ANONYMOUS_AVATAR_EMOJI,
} as const;

/** Standard masked identity for camelCase leaderboard rows. */
export const ANONYMOUS_CAMEL_IDENTITY = {
  username: ANONYMOUS_USERNAME,
  displayName: ANONYMOUS_DISPLAY_NAME,
  avatarEmoji: ANONYMOUS_AVATAR_EMOJI,
} as const;
