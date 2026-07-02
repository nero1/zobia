/**
 * lib/guilds/tiers.ts
 *
 * Guild Tier System constants (ZobiaSocial-PRD.md "Guild Tier System").
 *
 * `guilds.tier` is stored as either a simple name ("bronze", "legend", ...)
 * or a roman-numeral sub-tier ("bronze_1", "platinum_3", ...) depending on
 * which code path wrote it (guild creation always writes "bronze_1"; war
 * resolution / discovery code elsewhere assumes the simple name). Tier
 * auto-progression by guild_xp does not exist yet — guilds never move off
 * their created tier automatically. Until that's built, this module only
 * normalizes whatever string is stored so the UI can render something
 * sensible; it does not recompute or persist a "correct" tier.
 */

export type GuildTierName = "bronze" | "silver" | "gold" | "platinum" | "legend";

export const GUILD_TIER_XP_RANGE: Record<GuildTierName, { min: number; max: number | null }> = {
  bronze: { min: 0, max: 30_000 },
  silver: { min: 30_000, max: 80_000 },
  gold: { min: 80_000, max: 200_000 },
  platinum: { min: 200_000, max: 500_000 },
  legend: { min: 500_000, max: null },
};

/** Rough per-tier member cap for display — PRD gives minimums, not caps. */
export const GUILD_TIER_MAX_MEMBERS: Record<GuildTierName, number> = {
  bronze: 15,
  silver: 20,
  gold: 25,
  platinum: 30,
  legend: 50,
};

/** Strips a "_1"/"_2"/"_3" sub-tier suffix, e.g. "platinum_3" -> "platinum". */
export function normalizeGuildTier(tier: string): GuildTierName {
  const base = tier.split("_")[0];
  return (["bronze", "silver", "gold", "platinum", "legend"] as const).includes(base as GuildTierName)
    ? (base as GuildTierName)
    : "bronze";
}

/** Guild XP needed to reach the next tier boundary (or current XP if already at Legend, uncapped). */
export function guildTierXpRequired(tier: string, guildXp: number): number {
  const range = GUILD_TIER_XP_RANGE[normalizeGuildTier(tier)];
  return range.max ?? Math.max(guildXp, range.min);
}

export function guildTierMaxMembers(tier: string): number {
  return GUILD_TIER_MAX_MEMBERS[normalizeGuildTier(tier)];
}
