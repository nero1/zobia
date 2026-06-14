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
 * Parse the first octet of an IPv4 address string.
 * Returns null for IPv6 or unparseable addresses.
 */
function getFirstOctet(ip: string): number | null {
  if (!ip || ip === "unknown" || ip.includes(":")) {
    return null; // IPv6 — skip comparison
  }
  const parts = ip.split(".");
  if (parts.length < 1) return null;
  const octet = parseInt(parts[0], 10);
  return isNaN(octet) ? null : octet;
}

/**
 * Determine whether two IP addresses represent a "drastic" network change.
 *
 * Conservative definition: the first octet (Class A network) differs AND
 * both IPs are public (non-loopback, non-private). This avoids false positives
 * for mobile users roaming between ISP subnets in the same region.
 *
 * @param loginIp   - IP stored in the session at login time
 * @param currentIp - IP of the current request
 * @returns true if the change is suspicious
 */
export function isIpAnomalous(loginIp: string | undefined, currentIp: string): boolean {
  if (!loginIp || loginIp === "unknown" || currentIp === "unknown") {
    return false; // Cannot compare — assume safe
  }

  const loginOctet = getFirstOctet(loginIp);
  const currentOctet = getFirstOctet(currentIp);

  if (loginOctet === null || currentOctet === null) {
    return false; // IPv6 or unparseable — skip
  }

  // Use full CIDR ranges for private IP detection (BUG-33)
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

  // Flag only if the Class A network (first octet) changed completely
  return loginOctet !== currentOctet;
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

    // Log admin alert (fire-and-forget, non-blocking)
    db.query(
      `INSERT INTO system_alerts
         (type, severity, message, metadata, created_at)
       VALUES
         ('geo_anomaly', $1, $2, $3::jsonb, NOW())`,
      [
        count >= ANOMALY_THRESHOLD ? "warning" : "info",
        `User ${userId} session IP changed from ${loginIp} to ${currentIp} (anomaly #${count} in the last hour).`,
        JSON.stringify({ userId, sessionId, loginIp, currentIp, anomalyCount: count }),
      ]
    ).catch(() => {}); // Non-fatal — logging must not block requests

    return count >= ANOMALY_THRESHOLD;
  } catch {
    // Redis error — fail open (do not block the user)
    return false;
  }
}
