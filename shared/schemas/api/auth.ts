/**
 * shared/schemas/api/auth.ts
 *
 * Shared Zod schemas for auth-related API endpoints.
 * Consumed by both apps/web route handlers and apps/expo API clients.
 *
 * ARCH-CONTRACT-01: Single source of truth prevents request/response type drift.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Refresh token
// ---------------------------------------------------------------------------

export const RefreshResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresIn: z.number().int().positive(),
});

export type RefreshResponse = z.infer<typeof RefreshResponseSchema>;

// ---------------------------------------------------------------------------
// Login / Register
// ---------------------------------------------------------------------------

export const LoginRequestSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RegisterRequestSchema = z.object({
  email: z.string().email("Must be a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username may only contain letters, numbers, and underscores"),
});

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email().nullable(),
  username: z.string(),
  plan: z.enum(["free", "plus", "pro", "max"]),
  is_admin: z.boolean(),
  is_creator: z.boolean(),
  avatar_url: z.string().nullable().optional(),
});

export type AuthUser = z.infer<typeof AuthUserSchema>;

export const AuthResponseSchema = z.object({
  user: AuthUserSchema,
  accessToken: z.string().optional(),
  expiresIn: z.number().int().positive().optional(),
});

export type AuthResponse = z.infer<typeof AuthResponseSchema>;

// ---------------------------------------------------------------------------
// PIN verification
// ---------------------------------------------------------------------------

export const PinVerifyRequestSchema = z.object({
  pin: z
    .string()
    .length(4, "PIN must be exactly 4 digits")
    .regex(/^\d{4}$/, "PIN must be numeric"),
});

export type PinVerifyRequest = z.infer<typeof PinVerifyRequestSchema>;

export const PinSetupRequestSchema = z.object({
  pin: z
    .string()
    .length(4, "PIN must be exactly 4 digits")
    .regex(/^\d{4}$/, "PIN must be numeric"),
  confirmPin: z
    .string()
    .length(4, "PIN must be exactly 4 digits")
    .regex(/^\d{4}$/, "PIN must be numeric"),
}).refine((data) => data.pin === data.confirmPin, {
  message: "PINs do not match",
  path: ["confirmPin"],
});

export type PinSetupRequest = z.infer<typeof PinSetupRequestSchema>;
