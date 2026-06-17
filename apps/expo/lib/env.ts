/**
 * Zobia Social — typed environment variables.
 *
 * Values are sourced from `expo-constants` `expoConfig.extra` at runtime,
 * which in turn are populated by EAS Build environment variables or a
 * local `.env` file via `expo-env`.
 *
 * Add new variables here; never read `process.env` directly in app code.
 */

import Constants from 'expo-constants';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const EnvSchema = z.object({
  /** Base URL of the Zobia API (no trailing slash). */
  API_BASE_URL: z.string().url().default('https://api.zobia.app'),

  /** EAS / Expo project environment: development | preview | production */
  APP_ENV: z.enum(['development', 'preview', 'production']).default('development'),

  /** Google OAuth client ID (Android). */
  GOOGLE_CLIENT_ID: z.string().optional(),

  /**
   * Realtime provider for live chat delivery. Only "ably" is wired in the
   * mobile app today (its SDK is bundled); when unset, chat falls back to the
   * adaptive poll. Must match the server's REALTIME_PROVIDER.
   */
  REALTIME_PROVIDER: z.enum(["ably", "none"]).default("none"),
});

export type Env = z.infer<typeof EnvSchema>;

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

const raw = {
  API_BASE_URL: Constants.expoConfig?.extra?.API_BASE_URL as string | undefined,
  APP_ENV: Constants.expoConfig?.extra?.APP_ENV as string | undefined,
  GOOGLE_CLIENT_ID: Constants.expoConfig?.extra?.GOOGLE_CLIENT_ID as string | undefined,
  // EXPO_PUBLIC_* vars are inlined by Metro at build time.
  REALTIME_PROVIDER:
    (process.env.EXPO_PUBLIC_REALTIME_PROVIDER as string | undefined) ??
    (Constants.expoConfig?.extra?.REALTIME_PROVIDER as string | undefined),
};

const parsed = EnvSchema.safeParse(raw);

if (!parsed.success) {
  // Log in dev; in prod we still fall back to defaults via .default() calls above.
  if (__DEV__) {
    console.warn('[env] Invalid environment variables:', parsed.error.format());
  }
}

/**
 * Typed, validated environment configuration.
 *
 * All values have safe defaults so the app never crashes on a missing var.
 */
export const env: Env = parsed.success
  ? parsed.data
  : (EnvSchema.parse({}) as Env);

/** True when running in a local development build. */
export const isDev = env.APP_ENV === 'development';

/** True when running in the Play Store production build. */
export const isProd = env.APP_ENV === 'production';
