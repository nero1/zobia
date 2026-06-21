/**
 * lib/security/geoAnomaly.ts
 *
 * Geolocation anomaly detection for session security.
 *
 * Compares the IP address at login time (stored in the session record)
 * against the current request IP. Drastic IP changes (e.g. different
 * continent or country) are treated as suspicious and tracked in Redis.
 *
 * After a configurable threshold of anomalies within a time window,
 * the session is forcibly invalidated and the user must re-authenticate.
 *
 * PRD §19: "IP-based rate limiting + geolocation anomaly detection"
 * PRD §23: "Geolocation anomaly → forced re-auth"
 */

import { redis } from "@/lib/redis";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Number of IP anomalies within the window that triggers forced re-auth. */
const ANOMALY_THRESHOLD = 5;

/** Sliding window duration in seconds for anomaly counting. */
const ANOMALY_WINDOW_SECONDS = 3600; // 1 hour

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the first three octets (/24 prefix) of an IPv4 address string.
 * Returns null for IPv6 or unparseable addresses.
 */
function getFirstThreeOctets(ip: string): string | null {
  if (!ip || ip === "unknown" || ip.includes(":")) {
    return null; // IPv6 — skip comparison
  }
  const parts = ip.split(".");
  if (parts.length < 3) return null;
  return parts.slice(0, 3).join(".");
}

/**
 * Determine whether two IP addresses represent a "drastic" network change.
 *
 * Conservative definition: the /24 prefix (first three octets) differs AND
 * both IPs are public (non-loopback, non-private). Comparing /24 rather than
 * just the Class A reduces false positives for users with dynamic IPs within
 * the same ISP while still catching cross-city/country relocations.
 *
 * @param loginIp   - IP stored in the session at login time
 * @param currentIp - IP of the current request
 * @returns true if the change is suspicious
 */
export function isIpAnomalous(loginIp: string | undefined, currentIp: string): boolean {
  if (!loginIp || loginIp === "unknown" || currentIp === "unknown") {
    return false; // Cannot compare — assume safe
  }

  const loginPrefix = getFirstThreeOctets(loginIp);
  const currentPrefix = getFirstThreeOctets(currentIp);

  if (loginPrefix === null || currentPrefix === null) {
    return false; // IPv6 or unparseable — skip
  }

  const loginParts = loginIp.split('.').map(Number);
  const currentParts = currentIp.split('.').map(Number);

  const isPrivateFull = (parts: number[]): boolean => {
    const [a, b] = parts;
    return (
      a === 10 ||                          // 10.0.0.0/8
      a === 127 ||                         // 127.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) ||          // 192.168.0.0/16
      (a === 169 && b === 254)             // 169.254.0.0/16 (link-local)
    );
  };

  if (isPrivateFull(loginParts) || isPrivateFull(currentParts)) {
    return false;
  }

  // Flag if the /24 network prefix changed completely
  return loginPrefix !== currentPrefix;
}

// ---------------------------------------------------------------------------
// Anomaly tracking
// ---------------------------------------------------------------------------

/**
 * Record a geolocation anomaly for a session.
 *
 * Increments a per-session Redis counter. If the counter exceeds the
 * threshold within the window, returns true to signal that the session
 * should be force-invalidated.
 *
 * Also logs an admin alert to the database (fire-and-forget).
 *
 * @param sessionId - Session ID (sid from the JWT)
 * @param userId    - User UUID
 * @param loginIp   - IP stored at login
 * @param currentIp - Current request IP
 * @returns true if the anomaly threshold has been exceeded
 */
export async function recordAndCheckAnomaly(
  sessionId: string,
  userId: string,
  loginIp: string,
  currentIp: string
): Promise<boolean> {
  const zsetKey = `geo_anomaly:${sessionId}`;

  try {
    const now = Date.now();
    const windowStart = now - ANOMALY_WINDOW_SECONDS * 1000;
    const member = `${now}-${Math.random().toString(36).slice(2)}`;

    // Sliding window using sorted set — same approach as rateLimit.ts
    const count = await redis.eval(
      `redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
       redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
       redis.call('PEXPIRE', KEYS[1], ARGV[4])
       return redis.call('ZCARD', KEYS[1])`,
      1,
      zsetKey,
      String(windowStart),
      String(now),
      member,
      String(ANOMALY_WINDOW_SECONDS * 1000)
    ) as number;

    // Log admin alert only when the threshold is reached — inserting on every
    // anomaly floods the table for mobile users with dynamic IPs (OPS-02).
    if (count >= ANOMALY_THRESHOLD) {
      await db.query(
        `INSERT INTO system_alerts
           (type, severity, message, metadata, created_at)
         VALUES
           ('geo_anomaly', 'warning', $1, $2::jsonb, NOW())`,
        [
          `User ${userId} session IP changed from ${loginIp} to ${currentIp} — anomaly threshold reached (${count} in the last hour). Session will be invalidated.`,
          JSON.stringify({ userId, sessionId, loginIp, currentIp, anomalyCount: count }),
        ]
      ).catch(() => {}); // Non-fatal — logging must not block requests
    }

    return count >= ANOMALY_THRESHOLD;
  } catch {
    // Redis error — fail open (do not block the user)
    return false;
  }
}
