/**
 * apps/android/src/lib/env.ts
 *
 * Adapted from apps/expo/lib/env.ts.
 * Uses Vite import.meta.env instead of expo-constants.
 * Same Zod validation approach — fail fast with clear error if required vars missing.
 */

import { z } from 'zod';

const EnvSchema = z.object({
  VITE_API_BASE_URL: z.string().url().default('https://zobia.vercel.app'),
  VITE_WEB_BASE_URL: z.string().url().default('https://zobia.vercel.app'),
  VITE_APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  VITE_ABLY_API_KEY: z.string().optional(),
  VITE_REALTIME_PROVIDER: z.enum(['ably', 'none']).default('none'),
});

export type Env = z.infer<typeof EnvSchema>;

const raw = {
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL as string | undefined,
  VITE_WEB_BASE_URL: import.meta.env.VITE_WEB_BASE_URL as string | undefined,
  VITE_APP_ENV: import.meta.env.VITE_APP_ENV as string | undefined,
  VITE_ABLY_API_KEY: import.meta.env.VITE_ABLY_API_KEY as string | undefined,
  VITE_REALTIME_PROVIDER: import.meta.env.VITE_REALTIME_PROVIDER as string | undefined,
};

const parsed = EnvSchema.safeParse(raw);

if (!parsed.success) {
  if (import.meta.env.DEV) {
    console.warn('[env] Invalid environment variables:', parsed.error.format());
  }
}

export const env: Env = parsed.success ? parsed.data : (EnvSchema.parse({}) as Env);

export const isDev = env.VITE_APP_ENV === 'development';
export const isProd = env.VITE_APP_ENV === 'production';
