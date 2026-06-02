/**
 * lib/auth/google.ts
 *
 * Google OAuth 2.0 flow helpers.
 *
 * Implements the server-side OAuth code exchange.
 * No @supabase/supabase-js or next-auth – pure OAuth using fetch.
 */

import axios from "axios";
import { env } from "@/lib/env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw token response from Google's token endpoint. */
interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  id_token: string;
  refresh_token?: string;
}

/** Normalised Google user profile. */
export interface GoogleUserProfile {
  /** Google's stable subject identifier. */
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  /** Full-resolution avatar URL. */
  picture: string;
  givenName: string;
  familyName: string;
}

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

const SCOPES = ["openid", "email", "profile"];

/**
 * Build the Google OAuth authorisation URL to redirect the user to.
 *
 * @param state - CSRF state token (should be stored in a signed cookie)
 * @returns Full OAuth redirect URL
 */
export function buildGoogleAuthUrl(state: string): string {
  const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/auth/callback/google`;

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "select_account",
    state,
  });

  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Code exchange
// ---------------------------------------------------------------------------

/**
 * Exchange the OAuth authorisation code for tokens.
 *
 * @param code - Authorisation code from the callback query param
 * @returns Google token response including `id_token`
 */
export async function exchangeGoogleCode(
  code: string
): Promise<GoogleTokenResponse> {
  const redirectUri = `${env.NEXT_PUBLIC_APP_URL}/auth/callback/google`;

  const { data } = await axios.post<GoogleTokenResponse>(
    GOOGLE_TOKEN_ENDPOINT,
    new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }
  );

  return data;
}

// ---------------------------------------------------------------------------
// User info
// ---------------------------------------------------------------------------

/**
 * Fetch the authenticated user's profile from Google's UserInfo endpoint.
 *
 * @param accessToken - Google access token
 * @returns Normalised user profile
 */
export async function fetchGoogleUserProfile(
  accessToken: string
): Promise<GoogleUserProfile> {
  const { data } = await axios.get<{
    sub: string;
    email: string;
    email_verified: boolean;
    name: string;
    picture: string;
    given_name: string;
    family_name: string;
  }>(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return {
    googleId: data.sub,
    email: data.email,
    emailVerified: data.email_verified,
    name: data.name,
    picture: data.picture,
    givenName: data.given_name,
    familyName: data.family_name,
  };
}

// ---------------------------------------------------------------------------
// CSRF state helpers
// ---------------------------------------------------------------------------

import { randomBytes } from "crypto";

/**
 * Generate a cryptographically random CSRF state token.
 * Store this in a short-lived signed cookie before redirecting to Google.
 */
export function generateOAuthState(): string {
  return randomBytes(32).toString("hex");
}
