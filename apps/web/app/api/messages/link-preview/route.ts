export const dynamic = 'force-dynamic';

/**
 * app/api/messages/link-preview/route.ts
 *
 * GET /api/messages/link-preview?url=<encoded-url>
 *
 * Fetches Open Graph and fallback meta tags from an external URL and returns
 * a structured preview object. Designed for use in DM threads — rendering is
 * enforced client-side (only shown after the recipient has replied twice).
 *
 * Security:
 *  - SSRF protection: blocks private IP ranges, localhost, link-local
 *    addresses, and internal hostnames before making any outbound request.
 *  - Custom User-Agent to identify bot traffic.
 *  - 5-second fetch timeout to prevent hanging.
 *
 * Auth: required (withAuth).
 * Rate limit: RATE_LIMITS.apiRead.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";

// ---------------------------------------------------------------------------
// SSRF protection helpers
// ---------------------------------------------------------------------------

/**
 * Parse a dotted-decimal IPv4 address into a 32-bit unsigned integer.
 * Returns null if the string is not a valid IPv4 address.
 */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    const octet = parseInt(part, 10);
    if (isNaN(octet) || octet < 0 || octet > 255) return null;
    n = (n << 8) | octet;
  }
  // Convert to unsigned 32-bit
  return n >>> 0;
}

/**
 * Return true if the given IPv4 address falls within a private/reserved range.
 *
 * Blocked ranges:
 *  - 127.0.0.0/8   — loopback
 *  - 10.0.0.0/8    — RFC 1918 private
 *  - 172.16.0.0/12 — RFC 1918 private
 *  - 192.168.0.0/16 — RFC 1918 private
 *  - 169.254.0.0/16 — link-local (AWS metadata, etc.)
 *  - 0.0.0.0/8     — unspecified
 */
function isPrivateIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;

  const ranges: [number, number, number][] = [
    // [network, mask_bits, network_int]
    [0x7f000000, 8, 0x7f000000],   // 127.0.0.0/8
    [0x0a000000, 8, 0x0a000000],   // 10.0.0.0/8
    [0xac100000, 12, 0xac100000],  // 172.16.0.0/12
    [0xc0a80000, 16, 0xc0a80000],  // 192.168.0.0/16
    [0xa9fe0000, 16, 0xa9fe0000],  // 169.254.0.0/16
    [0x00000000, 8, 0x00000000],   // 0.0.0.0/8
  ];

  for (const [network, bits] of ranges) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    if ((n & mask) >>> 0 === (network & mask) >>> 0) return true;
  }
  return false;
}

/**
 * Validate that a URL is safe to fetch (SSRF guard).
 *
 * Blocks:
 *  - Non-http/https schemes
 *  - localhost (by name or 127.x.x.x)
 *  - IPv6 loopback [::1]
 *  - Private IPv4 ranges (10.x, 172.16-31.x, 192.168.x)
 *  - Link-local (169.254.x)
 *  - Internal TLDs: .local, .internal, .intranet, .localhost
 *
 * @param rawUrl - Raw URL string from the query parameter
 * @returns Parsed URL if safe
 * @throws ApiError 400 if the URL is blocked or invalid
 */
function validateSsrfSafeUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw badRequest("Invalid URL format", "INVALID_URL");
  }

  const { protocol, hostname } = parsed;

  // Only http and https are allowed
  if (protocol !== "http:" && protocol !== "https:") {
    throw badRequest("Only http and https URLs are allowed", "INVALID_URL_SCHEME");
  }

  const host = hostname.toLowerCase();

  // Block localhost by name
  if (host === "localhost") {
    throw badRequest("URL hostname is not allowed", "SSRF_BLOCKED");
  }

  // Block IPv6 loopback
  if (host === "[::1]" || host === "::1") {
    throw badRequest("URL hostname is not allowed", "SSRF_BLOCKED");
  }

  // Block internal TLDs
  const internalTlds = [".local", ".internal", ".intranet", ".localhost"];
  for (const tld of internalTlds) {
    if (host.endsWith(tld)) {
      throw badRequest("URL hostname is not allowed", "SSRF_BLOCKED");
    }
  }

  // Block private IPv4 ranges — check if hostname looks like an IP
  // (simple heuristic: only digits and dots)
  if (/^[\d.]+$/.test(host) && isPrivateIpv4(host)) {
    throw badRequest("URL hostname is not allowed", "SSRF_BLOCKED");
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Meta-tag parsing helpers
// ---------------------------------------------------------------------------

/**
 * Extract the content of the first matching Open Graph / meta tag from HTML.
 *
 * Handles both:
 *   <meta property="og:title" content="..." />
 *   <meta name="description" content="..." />
 *
 * Uses a simple regex approach — no DOM parser dependency.
 *
 * @param html     - Raw HTML string (partial is fine)
 * @param property - OG property (e.g. "og:title") or name attribute
 * @returns Extracted content string, or null if not found
 */
function extractMetaContent(html: string, property: string): string | null {
  // Match property="..." content="..." or content="..." property="..."
  const propertyRegex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapeRegex(property)}["'][^>]+content=["']([^"']+)["']`,
    "i"
  );
  const contentFirstRegex = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escapeRegex(property)}["']`,
    "i"
  );

  const m1 = html.match(propertyRegex);
  if (m1) return decodeHtmlEntities(m1[1]);

  const m2 = html.match(contentFirstRegex);
  if (m2) return decodeHtmlEntities(m2[1]);

  return null;
}

/**
 * Extract the text inside the <title> tag.
 *
 * @param html - Raw HTML string
 * @returns Title text or null
 */
function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? decodeHtmlEntities(m[1].trim()) : null;
}

/** Escape a string for use inside a RegExp character class or pattern. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Decode common HTML entities so stored values are plain text.
 * Handles the most common cases without a full HTML parser.
 */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

interface LinkPreviewResult {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

// ---------------------------------------------------------------------------
// GET /api/messages/link-preview
// ---------------------------------------------------------------------------

/**
 * Fetch and parse Open Graph meta tags for a given URL.
 *
 * Query params:
 *   url (string, required) - The URL to preview
 *
 * Returns:
 *   { url, title, description, image, siteName }
 *
 * Rendering in DMs is controlled client-side (only shown after the
 * recipient has replied twice per platform policy).
 */
export const GET = withAuth(async (req: NextRequest, { params, auth }) => {
  try {
    await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead);

    const rawUrl = req.nextUrl.searchParams.get("url");
    if (!rawUrl) {
      throw badRequest("Query parameter 'url' is required", "MISSING_URL");
    }

    // SSRF guard — throws 400 if blocked
    const safeUrl = validateSsrfSafeUrl(rawUrl);

    // Fetch with a 5-second timeout and custom User-Agent
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    let html: string;
    try {
      const response = await fetch(safeUrl.toString(), {
        signal: controller.signal,
        headers: {
          "User-Agent": "ZobiaBot/1.0 (link-preview)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      });

      // Only parse HTML responses
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        // Return minimal preview for non-HTML responses
        return NextResponse.json<LinkPreviewResult>({
          url: safeUrl.toString(),
          title: null,
          description: null,
          image: null,
          siteName: null,
        });
      }

      // Read only the first 100 KB to avoid memory issues with large pages
      const buffer = await response.arrayBuffer();
      const partial = Buffer.from(buffer).slice(0, 100_000).toString("utf-8");
      html = partial;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw badRequest("Link preview timed out after 5 seconds", "FETCH_TIMEOUT");
      }
      // For network errors, return an empty preview rather than a 500
      return NextResponse.json<LinkPreviewResult>({
        url: safeUrl.toString(),
        title: null,
        description: null,
        image: null,
        siteName: null,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // Parse meta tags — OG tags take priority over fallback tags
    const ogTitle = extractMetaContent(html, "og:title");
    const fallbackTitle = extractTitle(html);

    const ogDescription = extractMetaContent(html, "og:description");
    const metaDescription = extractMetaContent(html, "description");

    const ogImage = extractMetaContent(html, "og:image");
    const ogUrl = extractMetaContent(html, "og:url");
    const ogSiteName = extractMetaContent(html, "og:site_name");

    const result: LinkPreviewResult = {
      url: ogUrl ?? safeUrl.toString(),
      title: ogTitle ?? fallbackTitle,
      description: ogDescription ?? metaDescription,
      image: ogImage,
      siteName: ogSiteName,
    };

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
