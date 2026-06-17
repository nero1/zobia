/**
 * lib/auth/session-settings.ts
 *
 * Per-role session TTL configuration.
 *
 * TTLs are stored in the `app_settings` DB table and Redis-cached for 60 s.
 * Falls back to the hardcoded defaults when no DB override exists.
 *
 * Cache key: cache:session_ttl_settings (60 s TTL)
 * DB key pattern: session_ttl_<access|refresh>_<role>
 *   e.g. session_ttl_access_default, session_ttl_refresh_admin
 */

import { db } from "@/lib/db";
import { redis } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export interface SessionTtls {
  accessTtl: number;
  refreshTtl: number;
}

/** Fallback TTLs when no DB row exists for a given role. */
export const DEFAULT_SESSION_TTLS: Record<string, SessionTtls> = {
  default:   { accessTtl: 3600, refreshTtl: 2592000 }, // 1h access, 30d refresh
  creator:   { accessTtl: 3600, refreshTtl: 2592000 },
  moderator: { accessTtl: 3600, refreshTtl: 2592000 },
  admin:     { accessTtl: 3600, refreshTtl: 3600 },     // tighter for admins: 1h refresh
};

// ---------------------------------------------------------------------------
// Metadata — used by the admin UI and PUT endpoint validation
// ---------------------------------------------------------------------------

export interface SessionTtlSetting {
  key: string;        // e.g. "session_ttl_access_default"
  role: string;       // e.g. "default"
  type: "access" | "refresh";
}

export const SESSION_TTL_SETTINGS: SessionTtlSetting[] = [
  { key: "session_ttl_access_default",   role: "default",   type: "access" },
  { key: "session_ttl_refresh_default",  role: "default",   type: "refresh" },
  { key: "session_ttl_access_creator",   role: "creator",   type: "access" },
  { key: "session_ttl_refresh_creator",  role: "creator",   type: "refresh" },
  { key: "session_ttl_access_moderator", role: "moderator", type: "access" },
  { key: "session_ttl_refresh_moderator",role: "moderator", type: "refresh" },
  { key: "session_ttl_access_admin",     role: "admin",     type: "access" },
  { key: "session_ttl_refresh_admin",    role: "admin",     type: "refresh" },
];

const CACHE_KEY = "cache:session_ttl_settings";
const CACHE_TTL_SECONDS = 60;

// ---------------------------------------------------------------------------
// Internal: load all TTL settings from DB (or cache)
// ---------------------------------------------------------------------------

/** Raw map of key → numeric seconds value from the DB (or cache). */
async function loadSettings(): Promise<Record<string, number>> {
  // Try cache first
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      return JSON.parse(cached as string) as Record<string, number>;
    }
  } catch {
    // Cache miss or error — fall through to DB
  }

  // Load from DB
  const keys = SESSION_TTL_SETTINGS.map((s) => s.key);
  let result: Record<string, number> = {};

  try {
    const { rows } = await db.query<{ key: string; value: string }>(
      `SELECT key, value FROM app_settings WHERE key = ANY($1)`,
      [keys]
    );
    for (const row of rows) {
      const parsed = parseInt(row.value, 10);
      if (!isNaN(parsed) && parsed > 0) {
        result[row.key] = parsed;
      }
    }

    // Populate cache
    await redis.setex(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify(result)).catch(() => {});
  } catch {
    // DB unavailable — return empty map (defaults will be used)
  }

  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the effective session TTLs for a user based on their role.
 * Admin takes precedence, then moderator, then creator, then default.
 */
export async function getSessionTtls(opts: {
  isAdmin?: boolean;
  isModerator?: boolean;
  isCreator?: boolean;
} = {}): Promise<SessionTtls> {
  const settings = await loadSettings();

  // Determine which role's TTLs to use (highest privilege wins)
  let role = "default";
  if (opts.isAdmin)     role = "admin";
  else if (opts.isModerator) role = "moderator";
  else if (opts.isCreator)   role = "creator";

  const defaults = DEFAULT_SESSION_TTLS[role] ?? DEFAULT_SESSION_TTLS["default"];

  const accessKey  = `session_ttl_access_${role}`;
  const refreshKey = `session_ttl_refresh_${role}`;

  return {
    accessTtl:  settings[accessKey]  ?? defaults.accessTtl,
    refreshTtl: settings[refreshKey] ?? defaults.refreshTtl,
  };
}

/**
 * Invalidate the Redis cache for session TTL settings.
 * Call this after an admin updates a setting so the new value takes effect
 * within one cache cycle (≤ 60 s) or immediately for subsequent requests.
 */
export async function invalidateSessionSettingsCache(): Promise<void> {
  await redis.del(CACHE_KEY).catch(() => {});
}
