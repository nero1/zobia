/**
 * shared/schemas/api/user.ts
 *
 * Shared Zod schemas for user profile API endpoints.
 *
 * ARCH-CONTRACT-01: Single source of truth prevents type drift between
 * web route handlers and Expo API client.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// User profile
// ---------------------------------------------------------------------------

export const UserProfileSchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  display_name: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  plan: z.enum(["free", "plus", "pro", "max"]),
  xp_total: z.number().int().nonnegative(),
  coin_balance: z.number().int().nonnegative(),
  star_balance: z.number().int().nonnegative(),
  login_streak_days: z.number().int().nonnegative(),
  longest_streak: z.number().int().nonnegative(),
  is_creator: z.boolean(),
  creator_tier: z
    .enum(["rookie", "rising", "verified", "elite", "icon"])
    .nullable()
    .optional(),
  is_banned: z.boolean().optional(),
  deleted_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

export const MeResponseSchema = z.object({
  user: UserProfileSchema,
});

export type MeResponse = z.infer<typeof MeResponseSchema>;

// ---------------------------------------------------------------------------
// Update profile
// ---------------------------------------------------------------------------

export const UpdateProfileRequestSchema = z.object({
  display_name: z
    .string()
    .max(50, "Display name must be at most 50 characters")
    .optional(),
  bio: z.string().max(500, "Bio must be at most 500 characters").optional(),
  avatar_url: z.string().url("avatar_url must be a valid URL").optional(),
});

export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

// ---------------------------------------------------------------------------
// Push token registration
// ---------------------------------------------------------------------------

export const PushTokenRequestSchema = z.object({
  token: z
    .string()
    .regex(
      /^ExponentPushToken\[.+\]$/,
      "Token must be a valid Expo push token"
    ),
  platform: z.enum(["ios", "android", "web"]).optional(),
});

export type PushTokenRequest = z.infer<typeof PushTokenRequestSchema>;

// ---------------------------------------------------------------------------
// User search
// ---------------------------------------------------------------------------

export const UserSearchResponseSchema = z.object({
  users: z.array(
    z.object({
      id: z.string().uuid(),
      username: z.string(),
      display_name: z.string().nullable().optional(),
      avatar_url: z.string().nullable().optional(),
      plan: z.enum(["free", "plus", "pro", "max"]),
    })
  ),
  total: z.number().int().nonnegative(),
});

export type UserSearchResponse = z.infer<typeof UserSearchResponseSchema>;
