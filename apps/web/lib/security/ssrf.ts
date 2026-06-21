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
 *   - DNS rebinding attacks: hostname passes string check but resolves to private IP
 *     on first lookup, but re-resolves differently on second (TOCTOU). Fixed by
 *     resolving once, validating the IP, and pinning fetch() to that IP.
 *
 * Usage:
 *   import { safeFetch } from '@/lib/security/ssrf';
 *   const res = await safeFetch(userSuppliedUrl, { method: 'GET' });
 */

import { promises as dns } from "dns";
import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";

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
  // IPv6 private/loopback ranges
  if (hostname === "::1" || hostname === "::") return true;
  // Cover the full fe80::/10 link-local range (fe80:: through febf::) not just fe80:
  const firstGroup = parseInt(hostname.split(':')[0], 16);
  if (!isNaN(firstGroup) && firstGroup >= 0xfe80 && firstGroup <= 0xfebf) return true;
  if (hostname.startsWith("fc") || hostname.startsWith("fd")) return true;
  if (hostname.startsWith("fec0:")) return true;
  // BUG-H03: IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) bypass the IPv4 private
  // range checks because they contain ":" and hit the early-return below. Unwrap
  // and re-check against the standard IPv4 ranges before the early-return.
  const v4mapped = hostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4mapped) return isPrivateIp(v4mapped[1]);
  if (hostname.includes(":")) return false; // public IPv6 — allow

  // Parse IPv4
  const parts = hostname.split(".");
  if (parts.length !== 4) return false;
  const allNumeric = parts.every((p) => /^\d+$/.test(p) && parseInt(p) <= 255);
  if (!allNumeric) return false;

  const ipInt = ip4ToInt(hostname);
  return PRIVATE_RANGES.some((range) => ipInt >= range.start && ipInt <= range.end);
}

// ---------------------------------------------------------------------------
// DNS resolution with TOCTOU/rebinding protection
//
// Resolves the hostname ONCE using both A (IPv4) and AAAA (IPv6) lookups,
// validates ALL resolved addresses, and returns the first safe IPv4 address
// to use as the pinned fetch target.
//
// By pinning fetch() to the resolved IP (with the original hostname in the
// Host header), we eliminate the second DNS lookup that enables rebinding.
// ---------------------------------------------------------------------------

interface ResolvedHost {
  /** The safe IPv4 address to use as the fetch target. */
  pinnedIp: string;
}

/**
 * Resolves a hostname using dns.resolve4 and dns.resolve6 (best-effort for v6),
 * validates that ALL resolved addresses are public, and returns the first safe
 * IPv4 address for use as a pinned fetch target.
 *
 * Throws SSRFError if:
 *  - DNS resolution fails entirely (fail safe)
 *  - Any resolved address is private/internal (block if any address is dangerous)
 *  - No usable IPv4 address is found after filtering
 */
async function resolveAndValidateHostname(hostname: string): Promise<ResolvedHost> {
  // Skip DNS lookup for IP literals — validate inline
  const parts = hostname.split(".");
  const isIpv4Literal = parts.length === 4 && parts.every((p) => /^\d+$/.test(p));
  if (isIpv4Literal) {
    if (isPrivateIp(hostname)) {
      throw new SSRFError(`Private/internal IP address not allowed: ${hostname}`);
    }
    return { pinnedIp: hostname };
  }

  // Resolve IPv4 addresses
  let ipv4Addrs: string[] = [];
  try {
    ipv4Addrs = await dns.resolve4(hostname);
  } catch {
    // DNS resolution failure — fail safe by blocking
    throw new SSRFError(`DNS resolution failed for hostname: ${hostname}`);
  }

  if (ipv4Addrs.length === 0) {
    throw new SSRFError(`No IPv4 addresses resolved for hostname: ${hostname}`);
  }

  // Resolve IPv6 addresses (best-effort — don't fail if AAAA lookup errors)
  let ipv6Addrs: string[] = [];
  try {
    ipv6Addrs = await dns.resolve6(hostname);
  } catch {
    // AAAA lookup failure is non-fatal; we proceed with IPv4 only
  }

  // Validate ALL resolved addresses — if any is private, block the request.
  // This prevents split-horizon DNS where some records point public and some private.
  for (const addr of ipv4Addrs) {
    if (isPrivateIp(addr)) {
      throw new SSRFError(
        `Hostname '${hostname}' resolves to a private/internal address: ${addr}`
      );
    }
  }
  for (const addr of ipv6Addrs) {
    if (isPrivateIp(addr)) {
      throw new SSRFError(
        `Hostname '${hostname}' resolves to a private/internal IPv6 address: ${addr}`
      );
    }
  }

  // Use the first validated IPv4 address as the pinned fetch target
  const pinnedIp = ipv4Addrs[0];
  return { pinnedIp };
}

// ---------------------------------------------------------------------------
// Allowlisted hostnames (for admin-configurable URLs like manifest assets)
// ---------------------------------------------------------------------------

/** Allowlisted external hostnames. Extend as needed for integrations. */
const HOSTNAME_ALLOWLIST: string[] = [
  "api.mailgun.net",           // Mailgun transactional email
  "api.paystack.co",           // Paystack payments
  "api.flutterwave.com",       // Flutterwave payments
  "api.dodopayments.com",      // DodoPayments global payments
  "api.cloudflare.com",        // Cloudflare API
  "r2.cloudflarestorage.com",  // Cloudflare R2 object storage — subdomain matching covers <account>.r2.cloudflarestorage.com
  "storage.googleapis.com",    // Google Cloud Storage
  "giphy.com",                 // Giphy GIF library
  "api.giphy.com",             // Giphy GIF API
  "tenor.com",                 // Tenor GIF library
  "g.tenor.com",               // Tenor GIF CDN
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
 * Result of validating an outbound URL: the parsed URL, the original hostname
 * (for Host header), and the pinned IP (to pass directly to fetch).
 */
export interface ValidatedUrl {
  /** The parsed URL with hostname replaced by the pinned IP. */
  fetchUrl: string;
  /** The original hostname to send as the Host header. */
  originalHostname: string;
  /** The parsed original URL (for allowlist checks etc.). */
  parsed: URL;
  /** The resolved and validated IPv4 address to pin fetch() to. */
  pinnedIp: string;
}

/**
 * Validates that a URL is safe to fetch from the server.
 *
 * Resolves the hostname once via DNS, validates ALL resolved IPs, and returns
 * a `ValidatedUrl` with the hostname replaced by the pinned IP. The caller
 * must use `fetchUrl` as the fetch target and include the `Host` header set
 * to `originalHostname` so that TLS SNI and virtual hosting work correctly.
 *
 * Throws SSRFError if:
 *  - The URL is not http or https
 *  - The hostname is localhost / 0.0.0.0
 *  - The hostname resolves to a private/loopback/link-local address (any record)
 *  - The hostname contains credentials (user:pass@)
 *  - DNS resolution fails
 *
 * @param rawUrl - The URL to validate (user-supplied or admin-supplied)
 * @throws SSRFError if the URL is not safe to fetch
 */
export async function validateOutboundUrl(rawUrl: string): Promise<ValidatedUrl> {
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

  // Block localhost variants
  if (hostname === "localhost" || hostname === "0.0.0.0") {
    throw new SSRFError(`Loopback address not allowed: ${hostname}`);
  }

  // Block raw private IP literals before DNS (fast path)
  if (isPrivateIp(hostname)) {
    throw new SSRFError(`Private/internal IP address not allowed: ${hostname}`);
  }

  // DNS resolution + validation (eliminates TOCTOU/DNS-rebinding).
  // The resolved IP is pinned into fetchUrl so that fetch() uses the validated
  // address rather than performing a second DNS lookup (which enables rebinding).
  const { pinnedIp } = await resolveAndValidateHostname(hostname);

  // Build the fetch URL with the hostname replaced by the pinned IP, preserving
  // the rest of the URL (path, query, fragment, port, protocol).
  const pinnedUrl = new URL(rawUrl);
  pinnedUrl.hostname = pinnedIp;
  const fetchUrl = pinnedUrl.toString();

  return {
    fetchUrl,
    originalHostname: hostname,
    parsed,
    pinnedIp,
  };
}

// ---------------------------------------------------------------------------
// safeFetch
// ---------------------------------------------------------------------------

/** Maximum number of redirects safeFetch will follow. */
const MAX_REDIRECT_HOPS = 5;

/** Default maximum response body size (5 MiB). */
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/**
 * A safe wrapper around the global fetch that validates the URL against
 * the SSRF allowlist before making the request.
 *
 * Fixes applied:
 *  - BUG-19: Resolves hostname once, validates all returned IPs, then pins
 *    fetch() to the validated IP address (sets Host header to original hostname).
 *    Redirect targets are re-validated the same way before following.
 *  - BUG-18: Streams the response body through a size-counting reader.
 *    Content-Length is still checked as an early-exit optimisation, but chunked
 *    and streaming responses are also bounded by consuming the body incrementally.
 *
 * @param url     - URL string to fetch (user or admin supplied)
 * @param init    - Standard RequestInit options
 * @param options - SSRF-specific options
 * @returns The fetch Response (body already consumed into a buffer, re-wrapped)
 * @throws SSRFError if the URL fails validation or the body exceeds the size limit
 */
export async function safeFetch(
  url: string,
  init?: RequestInit,
  options?: {
    /** If true, only allow URLs from the HOSTNAME_ALLOWLIST. */
    requireAllowlist?: boolean;
    /** Max response size in bytes (default 5 MiB). */
    maxResponseBytes?: number;
    /** Internal: current redirect depth — do not set externally. */
    _hops?: number;
  }
): Promise<Response> {
  const hops = options?._hops ?? 0;
  if (hops > MAX_REDIRECT_HOPS) {
    throw new SSRFError(`Too many redirects (max ${MAX_REDIRECT_HOPS})`);
  }

  // BUG-19 fix: resolve + validate hostname once, get pinned IP
  const { parsed, pinnedIp } = await validateOutboundUrl(url);

  if (options?.requireAllowlist) {
    const allowed = HOSTNAME_ALLOWLIST.some(
      (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`)
    );
    if (!allowed) {
      throw new SSRFError(`Hostname not in allowlist: ${parsed.hostname}`);
    }
  }

  const callerHeaders = new Headers((init?.headers as HeadersInit | undefined) ?? {});

  // Create an undici Agent that intercepts DNS for this hostname and returns
  // the pinned IP, preventing a second DNS lookup (DNS rebinding TOCTOU) while
  // keeping the original URL so TLS SNI uses the correct hostname (S-02).
  const pinnedAgent = new UndiciAgent({
    connect: {
      lookup(_hostname: string, _options: unknown, callback: (err: Error | null, address: string, family: number) => void) {
        callback(null, pinnedIp, 4);
      },
    },
  });

  // Disable automatic redirect following — we validate each hop
  const response = await (undiciFetch as unknown as typeof fetch)(url, {
    ...init,
    headers: callerHeaders,
    redirect: "manual",
    // @ts-expect-error undici dispatcher option
    dispatcher: pinnedAgent,
  }) as Response;

  // Handle redirects manually to prevent SSRF via 302.
  // Each redirect target is re-validated by the recursive call to safeFetch,
  // which will resolve + validate DNS afresh for the new hostname.
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) {
      throw new SSRFError("Redirect without Location header");
    }
    // Resolve relative redirects against the original URL so the hostname is
    // correctly preserved for re-validation.
    const redirectUrl = new URL(location, url).toString();

    // BUG-C04: Strip sensitive headers when following a cross-origin redirect.
    // A malicious redirect chain (e.g. 302 to attacker.example.com) could
    // harvest credentials forwarded in the original init.headers.
    const redirectHost = new URL(redirectUrl).hostname.toLowerCase();
    const originalHost = parsed.hostname.toLowerCase();
    let redirectInit = init;
    if (redirectHost !== originalHost) {
      const SENSITIVE_HEADERS = new Set([
        "authorization", "cookie", "x-api-key", "x-auth-token",
        "x-access-token", "proxy-authorization",
      ]);
      const safeHeaders = new Headers(callerHeaders);
      for (const name of Array.from(safeHeaders.keys())) {
        if (SENSITIVE_HEADERS.has(name.toLowerCase())) {
          safeHeaders.delete(name);
        }
      }
      redirectInit = { ...init, headers: safeHeaders };
    }

    return safeFetch(redirectUrl, redirectInit, { ...options, _hops: hops + 1 });
  }

  const maxBytes = options?.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  // Enforce response size limit via Content-Length header (fast-path / early exit)
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && parseInt(contentLength, 10) > maxBytes) {
    throw new SSRFError(
      `Response too large: Content-Length ${contentLength} exceeds limit of ${maxBytes} bytes`
    );
  }

  // BUG-18 fix: stream the body through a size-counting reader so that chunked
  // and streaming responses are also bounded, not just those with Content-Length.
  if (!response.body) {
    // No body (e.g. 204 No Content) — nothing to bound
    return response;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        // Cancel the underlying stream to free resources
        await reader.cancel().catch(() => {});
        throw new SSRFError(
          `Response body too large: exceeded limit of ${maxBytes} bytes`
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  // Reassemble the buffered body into a new Response so callers can still
  // consume it via .json(), .text(), .arrayBuffer(), etc.
  const buffered = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffered.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Response(buffered, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
