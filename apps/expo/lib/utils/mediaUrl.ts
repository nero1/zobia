/**
 * lib/utils/mediaUrl.ts
 *
 * Utilities for validating media URLs before rendering or sending them.
 * Prevents open-redirect / content-injection attacks by ensuring GIF URLs
 * originate from a curated CDN allowlist.
 */

// ---------------------------------------------------------------------------
// GIF CDN allowlist
// ---------------------------------------------------------------------------

/**
 * Trusted GIF CDN hostnames. Only URLs whose hostname matches one of these
 * (or is a subdomain of one of these) are allowed as inline GIF messages.
 */
const TRUSTED_GIF_HOSTS = new Set([
  'giphy.com',
  'media.giphy.com',
  'tenor.com',
  'media.tenor.com',
  'c.tenor.com',
]);

/**
 * Returns true when `url` is a valid https:// URL whose hostname is either
 * an exact match or a subdomain of one of the trusted GIF CDN hosts.
 *
 * Examples that return true:
 *   https://media.giphy.com/media/abc123/giphy.gif
 *   https://media.tenor.com/abc/tenor.gif
 *   https://c.tenor.com/abc/c.gif
 *
 * Examples that return false:
 *   http://media.giphy.com/...   (non-https)
 *   https://evil.com/...         (unknown host)
 *   https://notgiphy.com/...     (suffix match only, not a subdomain)
 */
export function isTrustedGifUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (TRUSTED_GIF_HOSTS.has(host)) return true;
    // Allow subdomains: e.g. "foo.giphy.com"
    for (const trusted of TRUSTED_GIF_HOSTS) {
      if (host.endsWith(`.${trusted}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
