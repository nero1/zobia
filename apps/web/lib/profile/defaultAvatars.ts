/**
 * lib/profile/defaultAvatars.ts
 *
 * Re-exports the single source of truth for the "default profile icon"
 * emoji set from shared/utils/defaultAvatars.ts, so both the web app and
 * the Android app (its own Settings avatar picker) offer the exact same
 * options — both edit the same `users.avatar_emoji` column via the same
 * backend route (app/api/users/me/route.ts's PUT, going through
 * lib/profile/avatarService.ts).
 *
 * This is the exact list onboarding Step 1 (app/onboarding/page.tsx) offers
 * new users when picking an avatar.
 */

export { DEFAULT_AVATAR_EMOJIS, isDefaultAvatarEmoji } from "@zobia/shared/utils";
