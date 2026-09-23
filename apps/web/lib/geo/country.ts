/**
 * lib/geo/country.ts
 *
 * Best-effort ISO-3166 country detection from the incoming request, used to
 * self-heal `users.country` (which otherwise silently defaults to "NG" for
 * every signup — see lib/currency/index.ts for why that matters) and to
 * pick a sensible currency for anonymous/pre-auth surfaces.
 *
 * Vercel sets `x-vercel-ip-country` on every request at the edge. Cloudflare
 * (if ever fronting the app) sets `cf-ipcountry`. Neither is available in
 * local dev, where this returns null and callers fall back to a stored/
 * default value.
 *
 * @module lib/geo/country
 */

export function getRequestCountry(req: Request): string | null {
  const vercel = req.headers.get("x-vercel-ip-country");
  if (vercel && /^[A-Z]{2}$/.test(vercel)) return vercel;
  const cloudflare = req.headers.get("cf-ipcountry");
  if (cloudflare && /^[A-Z]{2}$/.test(cloudflare)) return cloudflare;
  return null;
}
