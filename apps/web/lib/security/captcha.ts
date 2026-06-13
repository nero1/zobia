/**
 * lib/security/captcha.ts
 *
 * CAPTCHA validation utilities.
 *
 * Supports two providers:
 *   - Google reCAPTCHA v3 (token from client-side grecaptcha.execute())
 *   - Cloudflare Turnstile (token from client-side turnstile.render())
 *
 * The active provider is read from the x_manifest at runtime so it can be
 * switched via the admin panel without a deployment.
 *
 * @example
 * ```ts
 * const ok = await verifyCaptcha(token, request.headers.get('x-forwarded-for') ?? '');
 * if (!ok) throw forbidden('CAPTCHA verification failed');
 * ```
 */

import { env } from "@/lib/env";
import { getManifestValue } from "@/lib/manifest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported CAPTCHA provider identifiers. */
export type CaptchaProvider = "recaptcha" | "turnstile" | "none";

/** Result from Google's reCAPTCHA verification endpoint. */
interface RecaptchaVerifyResponse {
  success: boolean;
  score?: number;             // reCAPTCHA v3 only (0.0–1.0)
  action?: string;
  challenge_ts?: string;
  hostname?: string;
  "error-codes"?: string[];
}

/** Result from Cloudflare Turnstile's verification endpoint. */
interface TurnstileVerifyResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  "error-codes"?: string[];
  action?: string;
  cdata?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RECAPTCHA_VERIFY_URL =
  "https://www.google.com/recaptcha/api/siteverify";
const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Minimum reCAPTCHA v3 score to consider a request human (0.0–1.0). */
const RECAPTCHA_MIN_SCORE = 0.5;

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

/**
 * Determine which CAPTCHA provider to use by reading the x_manifest.
 * The manifest value is the single source of truth — env keys are never
 * used to infer the active provider. Defaults to "none" when the key is
 * absent or the DB is unavailable.
 *
 * @returns Active provider identifier
 */
async function resolveProvider(): Promise<CaptchaProvider> {
  try {
    const manifestValue = await getManifestValue("captcha_provider");
    if (
      manifestValue === "recaptcha" ||
      manifestValue === "turnstile" ||
      manifestValue === "none"
    ) {
      return manifestValue;
    }
  } catch {
    // DB unavailable — fail safe
  }
  return "none";
}

// ---------------------------------------------------------------------------
// Verification implementations
// ---------------------------------------------------------------------------

/**
 * Verify a token with Google reCAPTCHA v3.
 *
 * @param token  - Client-side token from grecaptcha.execute()
 * @param userIp - Client IP address (optional but recommended)
 * @returns true if the score exceeds the minimum threshold
 */
async function verifyRecaptcha(
  token: string,
  userIp?: string
): Promise<boolean> {
  if (!env.RECAPTCHA_SECRET_KEY) {
    console.warn("[captcha] RECAPTCHA_SECRET_KEY not configured");
    return false;
  }

  const body = new URLSearchParams({
    secret: env.RECAPTCHA_SECRET_KEY,
    response: token,
  });
  if (userIp) body.set("remoteip", userIp);

  const res = await fetch(RECAPTCHA_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    console.error("[captcha:recaptcha] HTTP error", res.status);
    return false;
  }

  const data = (await res.json()) as RecaptchaVerifyResponse;

  if (!data.success) {
    console.warn("[captcha:recaptcha] Verification failed", data["error-codes"]);
    return false;
  }

  // For v3, enforce minimum score
  if (data.score !== undefined && data.score < RECAPTCHA_MIN_SCORE) {
    console.warn("[captcha:recaptcha] Score too low", data.score);
    return false;
  }

  return true;
}

/**
 * Verify a token with Cloudflare Turnstile.
 *
 * @param token  - Client-side token from turnstile.render() / challenge
 * @param userIp - Client IP address (optional but recommended)
 * @returns true if the challenge was solved successfully
 */
async function verifyTurnstile(
  token: string,
  userIp?: string
): Promise<boolean> {
  if (!env.CLOUDFLARE_TURNSTILE_SECRET_KEY) {
    console.warn("[captcha] CLOUDFLARE_TURNSTILE_SECRET_KEY not configured");
    return false;
  }

  const body = new URLSearchParams({
    secret: env.CLOUDFLARE_TURNSTILE_SECRET_KEY,
    response: token,
  });
  if (userIp) body.set("remoteip", userIp);

  const res = await fetch(TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    console.error("[captcha:turnstile] HTTP error", res.status);
    return false;
  }

  const data = (await res.json()) as TurnstileVerifyResponse;

  if (!data.success) {
    console.warn("[captcha:turnstile] Verification failed", data["error-codes"]);
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify a CAPTCHA token using the currently configured provider.
 *
 * The active provider is determined at runtime from the x_manifest / env,
 * so it can be changed without redeployment.
 *
 * If no provider is configured (provider = "none"), this function returns
 * `true` to allow development / testing without CAPTCHA.
 *
 * @param token  - CAPTCHA token from the client
 * @param userIp - Client IP address for additional fraud signals
 * @returns true if the CAPTCHA was verified successfully
 */
export async function verifyCaptcha(
  token: string,
  userIp?: string
): Promise<boolean> {
  if (!token) return false;

  const provider = await resolveProvider();

  switch (provider) {
    case "recaptcha":
      return verifyRecaptcha(token, userIp);
    case "turnstile":
      return verifyTurnstile(token, userIp);
    case "none":
      if (process.env.NODE_ENV === "production") {
        console.warn("[captcha] No CAPTCHA provider configured in production — blocking request");
        return false;
      }
      return true;
    default: {
      const _exhaustive: never = provider;
      console.error("[captcha] Unknown provider:", _exhaustive);
      return false;
    }
  }
}

/**
 * Get the currently configured CAPTCHA provider.
 * Useful for exposing the provider name to the client so it can load the
 * correct widget library.
 *
 * @returns Active provider identifier
 */
export async function getCaptchaProvider(): Promise<CaptchaProvider> {
  return resolveProvider();
}
