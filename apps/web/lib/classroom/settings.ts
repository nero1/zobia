/**
 * lib/classroom/settings.ts
 *
 * Typed view over `rooms.classroom_settings` (jsonb, migration 0003). The
 * column is always read through `parseClassroomSettings()` so a partially
 * populated (or legacy `{}`) value resolves to complete, validated defaults,
 * and always written through `classroomSettingsPatchSchema` so nothing
 * unvalidated ever reaches the database.
 *
 * Kept free of DB/Next imports so it can be unit-tested and shared by both
 * API routes and server components.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Slug-change policy
// ---------------------------------------------------------------------------

/**
 * How often, and at what Credit cost, the creator allows this classroom's
 * public /c/<slug> URL to change.
 *
 *   mode 'paid' (platform default): the first `freeChanges` renames are free,
 *     every rename after that costs `costCredits`; renames are additionally
 *     rate-limited by `cooldown` (none | every N days | every N months).
 *   mode 'free': renames are always free and uncapped.
 */
export const slugPolicySchema = z.object({
  mode: z.enum(["paid", "free"]),
  freeChanges: z.number().int().min(0).max(100),
  costCredits: z.number().int().min(0).max(1_000_000),
  cooldownUnit: z.enum(["none", "days", "months"]),
  cooldownValue: z.number().int().min(1).max(365),
});
export type SlugPolicy = z.infer<typeof slugPolicySchema>;

export const DEFAULT_SLUG_POLICY: SlugPolicy = {
  mode: "paid",
  freeChanges: 1,
  costCredits: 500,
  cooldownUnit: "none",
  cooldownValue: 30,
};

// ---------------------------------------------------------------------------
// Moderator permissions
// ---------------------------------------------------------------------------

export const moderatorPermissionsSchema = z.object({
  /** Pin/lock/hide/delete any post or comment. */
  managePosts: z.boolean(),
  /** Mute members from the community feed. */
  manageMembers: z.boolean(),
  /** Schedule/edit live sessions and attach recordings. */
  manageEvents: z.boolean(),
  /** Work the classroom report queue. */
  handleReports: z.boolean(),
});
export type ModeratorPermissions = z.infer<typeof moderatorPermissionsSchema>;

export const DEFAULT_MODERATOR_PERMISSIONS: ModeratorPermissions = {
  managePosts: true,
  manageMembers: true,
  manageEvents: true,
  handleReports: true,
};

// ---------------------------------------------------------------------------
// Full settings object
// ---------------------------------------------------------------------------

export const CLASSROOM_LEVEL_COUNT = 9;

/** Default level names (Skool-style 9 levels) — creators can rename any of them. */
export const DEFAULT_LEVEL_NAMES = [
  "Newcomer",
  "Learner",
  "Contributor",
  "Regular",
  "Achiever",
  "Expert",
  "Mentor",
  "Master",
  "Legend",
] as const;

export const DEFAULT_POST_CATEGORIES = ["General", "Announcements", "Questions", "Wins"];

export const classroomSettingsSchema = z.object({
  slugPolicy: slugPolicySchema,
  /** Custom level names; an empty string falls back to the default name for that level. */
  levelNames: z.array(z.string().max(40)).length(CLASSROOM_LEVEL_COUNT),
  /** Post categories members can pick from. The first entry is the default. */
  postCategories: z.array(z.string().trim().min(1).max(30)).min(1).max(12),
  /** Who may start a new community post: every member, or moderators/creator only. */
  postingPolicy: z.enum(["members", "moderators"]),
  moderatorPermissions: moderatorPermissionsSchema,
});
export type ClassroomSettings = z.infer<typeof classroomSettingsSchema>;

export const DEFAULT_CLASSROOM_SETTINGS: ClassroomSettings = {
  slugPolicy: DEFAULT_SLUG_POLICY,
  levelNames: DEFAULT_LEVEL_NAMES.map(() => ""),
  postCategories: DEFAULT_POST_CATEGORIES,
  postingPolicy: "members",
  moderatorPermissions: DEFAULT_MODERATOR_PERMISSIONS,
};

/** Partial update accepted from the creator's settings page. */
export const classroomSettingsPatchSchema = z
  .object({
    slugPolicy: slugPolicySchema.partial(),
    levelNames: z.array(z.string().max(40)).length(CLASSROOM_LEVEL_COUNT),
    postCategories: z.array(z.string().trim().min(1).max(30)).min(1).max(12),
    postingPolicy: z.enum(["members", "moderators"]),
    moderatorPermissions: moderatorPermissionsSchema.partial(),
  })
  .partial();
export type ClassroomSettingsPatch = z.infer<typeof classroomSettingsPatchSchema>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Resolve a raw jsonb value into a complete settings object. Each section is
 * validated independently so one malformed section never wipes the rest.
 */
export function parseClassroomSettings(raw: unknown): ClassroomSettings {
  const src = isRecord(raw) ? raw : {};

  const slug = slugPolicySchema.safeParse({
    ...DEFAULT_SLUG_POLICY,
    ...(isRecord(src.slugPolicy) ? src.slugPolicy : {}),
  });
  const perms = moderatorPermissionsSchema.safeParse({
    ...DEFAULT_MODERATOR_PERMISSIONS,
    ...(isRecord(src.moderatorPermissions) ? src.moderatorPermissions : {}),
  });
  const levels = z.array(z.string().max(40)).length(CLASSROOM_LEVEL_COUNT).safeParse(src.levelNames);
  const cats = classroomSettingsSchema.shape.postCategories.safeParse(src.postCategories);
  const posting = classroomSettingsSchema.shape.postingPolicy.safeParse(src.postingPolicy);

  return {
    slugPolicy: slug.success ? slug.data : DEFAULT_SLUG_POLICY,
    levelNames: levels.success ? levels.data : DEFAULT_CLASSROOM_SETTINGS.levelNames,
    postCategories: cats.success ? dedupeCategories(cats.data) : DEFAULT_POST_CATEGORIES,
    postingPolicy: posting.success ? posting.data : "members",
    moderatorPermissions: perms.success ? perms.data : DEFAULT_MODERATOR_PERMISSIONS,
  };
}

function dedupeCategories(categories: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of categories) {
    const key = c.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c.trim());
  }
  return out.length > 0 ? out : DEFAULT_POST_CATEGORIES;
}

/** Merge a validated patch onto the current settings. */
export function mergeClassroomSettings(
  current: ClassroomSettings,
  patch: ClassroomSettingsPatch
): ClassroomSettings {
  return parseClassroomSettings({
    ...current,
    ...(patch.levelNames ? { levelNames: patch.levelNames } : {}),
    ...(patch.postCategories ? { postCategories: patch.postCategories } : {}),
    ...(patch.postingPolicy ? { postingPolicy: patch.postingPolicy } : {}),
    slugPolicy: { ...current.slugPolicy, ...(patch.slugPolicy ?? {}) },
    moderatorPermissions: { ...current.moderatorPermissions, ...(patch.moderatorPermissions ?? {}) },
  });
}

/** Resolved display name for a level (1-based), honouring creator overrides. */
export function levelName(settings: ClassroomSettings, level: number): string {
  const idx = Math.min(Math.max(level, 1), CLASSROOM_LEVEL_COUNT) - 1;
  const custom = settings.levelNames[idx]?.trim();
  return custom || DEFAULT_LEVEL_NAMES[idx];
}
