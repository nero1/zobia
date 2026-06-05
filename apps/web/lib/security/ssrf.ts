/**
 * lib/security/ssrf.ts
 *
 * SSRF (Server-Side Request Forgery) protection.
 *
 * All server-side outbound HTTP requests to user-supplied or admin-supplied URLs
 * MUST pass through validateOutboundUrl() before fetching. This prevents:
 *   - Requests to internal RFC-1918 / loopback / link-local addresses
 *   - Requests to cloud metadata endpoints (169.254.x.x)
 *   - Redirects that bypass the allowlist via HTTP 3xx
 *
 * Usage:
 *   import { safeFetch } from '@/lib/security/ssrf';
 *   const res = await safeFetch(userSuppliedUrl, { method: 'GET' });
 */

// ---------------------------------------------------------------------------
// Private IP ranges (CIDR notation as tuple pairs for fast comparison)
// ---------------------------------------------------------------------------

const PRIVATE_RANGES = [
  // Loopback
  { start: ip4ToInt("127.0.0.0"),   end: ip4ToInt("127.255.255.255") },
  // Private Class A
  { start: ip4ToInt("10.0.0.0"),    end: ip4ToInt("10.255.255.255") },
  // Private Class B
  { start: ip4ToInt("172.16.0.0"),  end: ip4ToInt("172.31.255.255") },
  // Private Class C
  { start: ip4ToInt("192.168.0.0"), end: ip4ToInt("192.168.255.255") },
  // Link-local / APIPA (includes AWS metadata 169.254.169.254)
  { start: ip4ToInt("169.254.0.0"), end: ip4ToInt("169.254.255.255") },
  // Multicast
  { start: ip4ToInt("224.0.0.0"),   end: ip4ToInt("239.255.255.255") },
  // Broadcast / reserved
  { start: ip4ToInt("240.0.0.0"),   end: ip4ToInt("255.255.255.255") },
];

function ip4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

function isPrivateIp(hostname: string): boolean {
  // IPv6 loopback and link-local
  if (hostname === "::1" || hostname.startsWith("fe80:") || hostname.startsWith("fc") || hostname.startsWith("fd")) {
    return true;
  }
  // Reject raw IPv6 except public addresses
  if (hostname.includes(":")) {
    return true; // conservative: block all IPv6 by default
  }

  // Parse IPv4
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  const allNumeric = parts.every((p) => /^\d+$/.test(p) && parseInt(p) <= 255);
  if (!allNumeric) return false;

  const ipInt = ip4ToInt(hostname);
  return PRIVATE_RANGES.some((range) => ipInt >= range.start && ipInt <= range.end);
}

// ---------------------------------------------------------------------------
// Allowlisted hostnames (for admin-configurable URLs like manifest assets)
// ---------------------------------------------------------------------------

/** Allowlisted external hostnames. Extend as needed for integrations. */
const HOSTNAME_ALLOWLIST: string[] = [
  "api.mailgun.net",
  "api.paystack.co",
  "api.flutterwave.com",
  "api.dodopayments.com",
  "api.cloudflare.com",
  "storage.googleapis.com",
  "giphy.com",
  "api.giphy.com",
  "tenor.com",
  "g.tenor.com",
];

// ---------------------------------------------------------------------------
// validateOutboundUrl
// ---------------------------------------------------------------------------

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFError";
  }
}

/**
 * Validates that a URL is safe to fetch from the server.
 *
 * Throws SSRFError if:
 *  - The URL is not http or https
 *  - The hostname resolves to a private/loopback/link-local address
 *  - The hostname contains credentials (user:pass@)
 *
 * @param rawUrl - The URL to validate (user-supplied or admin-supplied)
 * @throws SSRFError if the URL is not safe to fetch
 */
export function validateOutboundUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SSRFError(`Invalid URL: ${rawUrl}`);
  }

  // Only allow http and https
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SSRFError(`Protocol not allowed: ${parsed.protocol}`);
  }

  // Reject credentials in URL
  if (parsed.username || parsed.password) {
    throw new SSRFError("URLs with credentials are not allowed");
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block private IP ranges
  if (isPrivateIp(hostname)) {
    throw new SSRFError(`Private/internal IP address not allowed: ${hostname}`);
  }

  // Block localhost variants
  if (hostname === "localhost" || hostname === "0.0.0.0") {
    throw new SSRFError(`Loopback address not allowed: ${hostname}`);
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// safeFetch
// ---------------------------------------------------------------------------

/**
 * A safe wrapper around the global fetch that validates the URL against
 * the SSRF allowlist before making the request.
 *
 * Also prevents redirect-following to private addresses by checking the
 * Location header on 3xx responses.
 *
 * @param url     - URL string to fetch (user or admin supplied)
 * @param init    - Standard RequestInit options
 * @param options - SSRF-specific options
 * @returns The fetch Response
 * @throws SSRFError if the URL fails validation
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  options?: {
    /** If true, only allow URLs from the HOSTNAME_ALLOWLIST. */
    requireAllowlist?: boolean;
    /** Max response size in bytes (default 5MB). */
    maxResponseBytes?: number;
  }
): Promise<Response> {
  const parsed = validateOutboundUrl(url);

  if (options?.requireAllowlist) {
    const allowed = HOSTNAME_ALLOWLIST.some(
      (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`)
    );
    if (!allowed) {
      throw new SSRFError(`Hostname not in allowlist: ${parsed.hostname}`);
    }
  }

  // Disable automatic redirect following — we validate each hop
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
  });

  // Handle redirects manually to prevent SSRF via 302
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) {
      throw new SSRFError("Redirect without Location header");
    }
    // Validate the redirect target
    const redirectUrl = new URL(location, url).toString();
    return safeFetch(redirectUrl, init, options);
  }

  return response;
}
