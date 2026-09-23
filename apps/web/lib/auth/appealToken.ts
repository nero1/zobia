/**
 * lib/auth/appealToken.ts
 *
 * Short-lived, identity-verified "appeal token" for the account appeals
 * pipeline (PRD "Suspended and Banned Users").
 *
 * An appeal for a suspension/ban can only be filed by a user who has just
 * proven their identity via a real login attempt (Google/Telegram OAuth)
 * and was then blocked by the suspension/ban check — never via a public
 * "email us" form. When that happens, the login callback issues one of
 * these tokens (an opaque code, mirroring the `web_pre_auth:{code}` /
 * `mobile_pre_auth:{code}` pattern already used for the 2FA handoff) and
 * redirects the user to the appeal form with the code attached. The form
 * reads the code to identify the user and pre-fill their account email;
 * submitting the appeal consumes it.
 *
 * Redis key: `appeal_token:{code}` → JSON payload, TTL below.
 */

import { randomBytes } from "crypto";
import { redis } from "@/lib/redis";

/** How long an appeal token stays valid after a blocked login attempt. */
export const APPEAL_TOKEN_TTL_SECONDS = 30 * 60; // 30 minutes

export interface AppealTokenPayload {
  userId: string;
  /** Account email, used to pre-fill (and validate) the appeal's contact email. May be null for Telegram-only accounts. */
  email: string | null;
  appealType: "suspension" | "ban";
  reason: string | null;
  /** ISO timestamp the suspension lifts, or null for a ban / indefinite suspension. */
  suspendedUntil: string | null;
}

function redisKey(code: string): string {
  return `appeal_token:${code}`;
}

/** Issue a new appeal token for a user just blocked at login. Returns the opaque code. */
export async function issueAppealToken(payload: AppealTokenPayload): Promise<string> {
  const code = randomBytes(32).toString("hex");
  await redis.setex(redisKey(code), APPEAL_TOKEN_TTL_SECONDS, JSON.stringify(payload));
  return code;
}

/** Read the token's payload without consuming it (used to render/prefill the appeal form). */
export async function peekAppealToken(code: string): Promise<AppealTokenPayload | null> {
  if (!code) return null;
  try {
    const raw = await redis.get(redisKey(code));
    if (!raw) return null;
    return JSON.parse(raw) as AppealTokenPayload;
  } catch {
    return null;
  }
}

/** Read and immediately invalidate the token (used on appeal submission, to prevent replay/duplicate submissions from the same blocked-login attempt). */
export async function consumeAppealToken(code: string): Promise<AppealTokenPayload | null> {
  if (!code) return null;
  try {
    const raw = await redis.get(redisKey(code));
    if (!raw) return null;
    await redis.del(redisKey(code));
    return JSON.parse(raw) as AppealTokenPayload;
  } catch {
    return null;
  }
}
