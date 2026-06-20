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
 *  - SSRF protection via safeFetch: blocks private IPs, link-local ranges,
 *    and validates redirects. Also performs DNS rebinding checks.
 *  - Custom User-Agent to identify bot traffic.
 *  - 5-second fetch timeout to prevent hanging.
 *
 * Auth: required (withAuth).
 * Rate limit: RATE_LIMITS.apiRead.
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { withAuth } from "@/lib/api/middleware";
import { handleApiError, badRequest } from "@/lib/api/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { safeFetch, SSRFError } from "@/lib/security/ssrf";
import { redis } from "@/lib/redis";
import { memGet, memSet } from "@/lib/cache/memory";

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

    // Check cache — memory (120s) first, then Redis (3600s)
    const cacheKey = `link-preview:${createHash("sha256").update(rawUrl).digest("hex")}`;
    const memCached = memGet<LinkPreviewResult>(cacheKey);
    if (memCached) return NextResponse.json(memCached, { status: 200 });
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as LinkPreviewResult;
        memSet(cacheKey, parsed, 120_000);
        return NextResponse.json(parsed, { status: 200 });
      }
    } catch {
      // Cache failure is non-fatal — proceed to fetch
    }

    // Fetch with a 5-second timeout and custom User-Agent.
    // safeFetch validates the URL (private IPs, DNS rebinding, redirect chains)
    // so no separate SSRF pre-check is needed.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    let html: string;
    try {
      const response = await safeFetch(rawUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "ZobiaBot/1.0 (link-preview)",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      // Only parse HTML responses
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
        // Return minimal preview for non-HTML responses
        return NextResponse.json<LinkPreviewResult>({
          url: rawUrl,
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
      if (err instanceof SSRFError) {
        throw badRequest("URL hostname is not allowed", "SSRF_BLOCKED");
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw badRequest("Link preview timed out after 5 seconds", "FETCH_TIMEOUT");
      }
      // For network errors, return an empty preview rather than a 500
      return NextResponse.json<LinkPreviewResult>({
        url: rawUrl,
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
      url: ogUrl ?? rawUrl,
      title: ogTitle ?? fallbackTitle,
      description: ogDescription ?? metaDescription,
      image: ogImage,
      siteName: ogSiteName,
    };

    // Store in memory (120s) + Redis (3600s) — best-effort
    memSet(cacheKey, result, 120_000);
    try {
      await redis.setex(cacheKey, 3600, JSON.stringify(result));
    } catch {
      // Cache write failure is non-fatal
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return handleApiError(err);
  }
});
