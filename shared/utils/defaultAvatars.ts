/**
 * shared/utils/defaultAvatars.ts
 *
 * The single source of truth for the "default profile icon" emoji set,
 * shared between the web app (onboarding Step 1 and the Profile Pictures
 * "use a default icon" picker in Settings) and the Android app (its own
 * Settings "use a default icon" picker) — both editing the same
 * `users.avatar_emoji` column via the same backend route, so both surfaces
 * must offer the exact same options.
 */

export const DEFAULT_AVATAR_EMOJIS: readonly string[] = [
  "😎", "🔥", "👑", "💎", "🦁", "🐯", "⚡", "🚀", "🎯", "💪",
  "🌟", "🎭", "🏆", "🎪", "🌊", "🦅", "🐉", "🌙", "☀️", "🎸",
];

/** True if `emoji` is one of the recognised default avatar icons. */
export function isDefaultAvatarEmoji(emoji: string): boolean {
  return DEFAULT_AVATAR_EMOJIS.includes(emoji);
}
