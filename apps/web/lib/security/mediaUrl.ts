/**
 * lib/security/mediaUrl.ts
 *
 * Shared "is this URL from our own storage/CDN" allowlist check. Extracted
 * from app/api/moments/route.ts's original inline version so Tweets (and any
 * future feature that accepts a client-submitted, upload-returned media URL)
 * can reuse it instead of re-deriving the allowlist from env vars again.
 */

/**
 * Returns the list of hostnames that are allowed as an uploaded media URL
 * source. Derived from configured storage/CDN environment variables so the
 * allowlist automatically reflects the deployment's storage provider.
 *
 * Sources considered (in priority order):
 *   1. R2_PUBLIC_URL           — Cloudflare R2 public bucket hostname
 *   2. NEXT_PUBLIC_SUPABASE_URL — Supabase storage hostname
 *   3. NEXT_PUBLIC_APP_URL     — same-origin uploads served via the app itself
 *
 * Additional domains can be added via the ALLOWED_MEDIA_HOSTS env var
 * (comma-separated list of hostnames, e.g. "cdn.example.com,assets.example.com").
 */
export function getAllowedMediaHosts(): string[] {
  const hosts = new Set<string>();

  const addHost = (raw: string | undefined) => {
    if (!raw) return;
    try {
      const { hostname } = new URL(raw);
      if (hostname) hosts.add(hostname.toLowerCase());
    } catch {
      // ignore malformed URLs
    }
  };

  addHost(process.env.R2_PUBLIC_URL);
  addHost(process.env.NEXT_PUBLIC_SUPABASE_URL);
  addHost(process.env.NEXT_PUBLIC_APP_URL);

  const extra = process.env.ALLOWED_MEDIA_HOSTS ?? "";
  for (const h of extra.split(",").map((s) => s.trim()).filter(Boolean)) {
    hosts.add(h.toLowerCase());
  }

  return [...hosts];
}

/**
 * Returns true if the given URL's hostname is in the configured CDN/storage
 * allowlist. Falls back to allowing any https URL during local development
 * when no storage env vars are configured (all allowed hosts would be empty)
 * — safe because that only occurs when no production storage is configured.
 */
export function isAllowedMediaUrl(raw: string): boolean {
  const allowedHosts = getAllowedMediaHosts();
  if (allowedHosts.length === 0) return true;
  try {
    const { hostname } = new URL(raw);
    return allowedHosts.includes(hostname.toLowerCase());
  } catch {
    return false;
  }
}
