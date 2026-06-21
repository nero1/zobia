/**
 * lib/env.ts
 *
 * Centralised, type-safe environment variable validation using Zod.
 * Import `env` from this module everywhere – never read process.env directly.
 *
 * Throws at module load time so misconfigured deployments fail fast.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const envSchema = z.object({
  // ---- Database -----------------------------------------------------------
  DATABASE_PROVIDER: z.enum(["supabase", "railway", "digitalocean"]),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),
  /** Max connections per serverless instance for the pooled connection. Default: 2. */
  DB_POOL_SIZE: z.string().optional(),
  /** Max connections per serverless instance for the direct (non-pooled) connection. Default: 2. */
  DB_DIRECT_POOL_SIZE: z.string().optional(),

  // ---- Storage ------------------------------------------------------------
  STORAGE_PROVIDER: z.enum(["supabase-storage", "r2", "s3"]),

  // R2 (optional – validated at adapter init when STORAGE_PROVIDER=r2)
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_PUBLIC_URL: z.string().url().optional(),

  // ---- Realtime -----------------------------------------------------------
  REALTIME_PROVIDER: z.enum(["supabase-realtime", "ably", "pusher"]),

  // Supabase Realtime (required when REALTIME_PROVIDER=supabase-realtime)
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  // Ably (required when REALTIME_PROVIDER=ably)
  ABLY_API_KEY: z.string().optional(),

  // Pusher (all four required when REALTIME_PROVIDER=pusher)
  PUSHER_APP_ID: z.string().optional(),
  PUSHER_KEY: z.string().optional(),
  PUSHER_SECRET: z.string().optional(),
  PUSHER_CLUSTER: z.string().optional(),

  // ---- Redis --------------------------------------------------------------
  // REDIS_URL is required for ioredis; Upstash uses UPSTASH_REDIS_REST_URL + TOKEN instead.
  REDIS_URL: z.string().optional(),
  REDIS_PROVIDER: z.enum(["ioredis", "upstash"]),
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // ---- Auth / JWT ---------------------------------------------------------
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),

  // ---- Google OAuth -------------------------------------------------------
  // Optional — Google OAuth login is only enabled when both are set.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // ---- Telegram -----------------------------------------------------------
  // Optional — Telegram login is only enabled when set.
  TELEGRAM_BOT_TOKEN: z.string().optional(),

  // ---- AI providers -------------------------------------------------------
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_API_ENDPOINT: z
    .string()
    .url()
    .default("https://api.deepseek.com/v1"),
  GEMINI_API_KEY: z.string().optional(),

  // ---- Email --------------------------------------------------------------
  MAILGUN_API_KEY: z.string().optional(),
  MAILGUN_DOMAIN: z.string().optional(),

  // ---- Payments -----------------------------------------------------------
  // Optional — required only when Paystack is the active payment provider.
  PAYSTACK_SECRET_KEY: z.string().optional(),
  PAYSTACK_PUBLIC_KEY: z.string().optional(),
  DODOPAYMENTS_API_KEY: z.string().optional(),
  DODO_WEBHOOK_SECRET: z.string().optional(),

  // ---- Advertising --------------------------------------------------------
  ADMOB_APP_ID: z.string().optional(),

  // ---- Bot protection -----------------------------------------------------
  RECAPTCHA_SITE_KEY: z.string().optional(),
  RECAPTCHA_SECRET_KEY: z.string().optional(),
  CLOUDFLARE_TURNSTILE_SITE_KEY: z.string().optional(),
  CLOUDFLARE_TURNSTILE_SECRET_KEY: z.string().optional(),

  // ---- KYC field encryption -----------------------------------------------
  // Required at runtime for KYC operations; validated in fieldEncryption.ts when used.
  KYC_ENCRYPTION_KEY_V1: z.string().optional(),
  KYC_ENCRYPTION_KEY_V2: z.string().optional(),

  // ---- Cron jobs ----------------------------------------------------------
  CRON_SECRET: z.string().min(1, "CRON_SECRET is required to secure CRON endpoints"),

  // ---- Public client-side vars --------------------------------------------
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_API_URL: z
    .string()
    .url()
    .default("http://localhost:3000/api"),

  // Client-side realtime provider selection (must match REALTIME_PROVIDER)
  NEXT_PUBLIC_REALTIME_PROVIDER: z
    .enum(["supabase-realtime", "ably", "pusher"])
    .optional(),
  // Supabase Realtime — client-side vars
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  // Pusher — client-side public vars
  NEXT_PUBLIC_PUSHER_KEY: z.string().optional(),
  NEXT_PUBLIC_PUSHER_CLUSTER: z.string().optional(),

  // ---- Monitoring ---------------------------------------------------------
  MONITORING_PROVIDER: z.enum(["sentry", "newrelic", "none"]).default("none"),
  SENTRY_DSN: z.string().optional(),
  NEW_RELIC_LICENSE_KEY: z.string().optional(),

  // ---- JWT key rotation ---------------------------------------------------
  JWT_KEY_ID: z.string().default("v1"),

  // ---- Runtime ------------------------------------------------------------
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
})
  // Provider key coupling — fail fast if a realtime provider is selected without
  // its credentials, instead of silently never connecting (which would make the
  // client fall back to the fast baseline poll and quietly burn serverless
  // invocations). Each provider's keys are otherwise optional so unrelated
  // providers (e.g. DigitalOcean Postgres + Ably, with no Supabase) stay valid.
  .superRefine((val, ctx) => {
    const need = (cond: boolean, path: string, message: string) => {
      if (cond) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
      }
    };

    // Server-side publish credentials.
    if (val.REALTIME_PROVIDER === "ably") {
      need(!val.ABLY_API_KEY, "ABLY_API_KEY", "ABLY_API_KEY is required when REALTIME_PROVIDER=ably");
    } else if (val.REALTIME_PROVIDER === "pusher") {
      need(!val.PUSHER_APP_ID, "PUSHER_APP_ID", "PUSHER_APP_ID is required when REALTIME_PROVIDER=pusher");
      need(!val.PUSHER_KEY, "PUSHER_KEY", "PUSHER_KEY is required when REALTIME_PROVIDER=pusher");
      need(!val.PUSHER_SECRET, "PUSHER_SECRET", "PUSHER_SECRET is required when REALTIME_PROVIDER=pusher");
      need(!val.PUSHER_CLUSTER, "PUSHER_CLUSTER", "PUSHER_CLUSTER is required when REALTIME_PROVIDER=pusher");
    } else if (val.REALTIME_PROVIDER === "supabase-realtime") {
      need(!val.SUPABASE_URL, "SUPABASE_URL", "SUPABASE_URL is required when REALTIME_PROVIDER=supabase-realtime");
      need(!val.SUPABASE_SERVICE_ROLE_KEY, "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY is required when REALTIME_PROVIDER=supabase-realtime");
    }

    // Client-side subscription config (must match the server provider).
    if (val.NEXT_PUBLIC_REALTIME_PROVIDER) {
      need(
        val.NEXT_PUBLIC_REALTIME_PROVIDER !== val.REALTIME_PROVIDER,
        "NEXT_PUBLIC_REALTIME_PROVIDER",
        "NEXT_PUBLIC_REALTIME_PROVIDER must match REALTIME_PROVIDER",
      );
      if (val.NEXT_PUBLIC_REALTIME_PROVIDER === "pusher") {
        need(!val.NEXT_PUBLIC_PUSHER_KEY, "NEXT_PUBLIC_PUSHER_KEY", "NEXT_PUBLIC_PUSHER_KEY is required when NEXT_PUBLIC_REALTIME_PROVIDER=pusher");
      } else if (val.NEXT_PUBLIC_REALTIME_PROVIDER === "supabase-realtime") {
        need(!val.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL is required when NEXT_PUBLIC_REALTIME_PROVIDER=supabase-realtime");
        need(!val.NEXT_PUBLIC_SUPABASE_ANON_KEY, "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY is required when NEXT_PUBLIC_REALTIME_PROVIDER=supabase-realtime");
      }
      // Ably needs no public key client-side — it authenticates via /api/realtime/ably-token.
    }
  });

export type Env = z.infer<typeof envSchema>;

// ---------------------------------------------------------------------------
// Parse & export
// ---------------------------------------------------------------------------

/**
 * Validated environment variables.
 * Throws a descriptive ZodError at startup if any required variable is missing.
 */
const _parsed = envSchema.safeParse(process.env);

if (!_parsed.success && process.env.SKIP_ENV_VALIDATION !== "1") {
  const formatted = _parsed.error.issues
    .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Environment validation failed:\n${formatted}`);
}

if (!_parsed.success && process.env.SKIP_ENV_VALIDATION === "1") {
  console.warn(
    "[env] SKIP_ENV_VALIDATION=1: environment validation was skipped. " +
    "All env accesses return undefined. Do not use this in production."
  );
}

export const env: Env = _parsed.success
  ? _parsed.data
  : (new Proxy({} as Env, {
      get(_target, _prop) {
        return undefined as any;
      },
    }));
