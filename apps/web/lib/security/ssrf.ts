import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import type {LookupFunction} from 'node:net';
import type {LookupAddress} from 'node:dns';
import ipaddr from "ipaddr.js";
import { Agent, fetch as request } from "undici";

export class SSRFError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFError";
  }
}
function buildSupabaseAllowlistEntries(): string[] {
  try {
    return [
      new URL(
        process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      ).hostname,
    ];
  } catch {
    return [];
  }
}
const HOSTNAME_ALLOWLIST: string[] = [
  "api.mailgun.net", // Mailgun transactional email
  "api.paystack.co", // Paystack payments
  "api.flutterwave.com", // Flutterwave payments
  "bsc-dataseed.binance.org", // Public BSC RPC (crypto payments — chain adapter)
  "api.mainnet-beta.solana.com", // Public Solana RPC (crypto payments — chain adapter)
  "api.coingecko.com", // Crypto price feed (BNB/SOL USD price)
  "api.dexscreener.com", // Crypto price feed (JAGA USD price via PancakeSwap pool)
  "api.cloudflare.com", // Cloudflare API
  "r2.cloudflarestorage.com", // Cloudflare R2 object storage — subdomain matching covers <account>.r2.cloudflarestorage.com
  "storage.googleapis.com", // Google Cloud Storage
  "oauth2.googleapis.com", // Google OAuth 2.0 token endpoint (OAUTH-01)
  "www.googleapis.com", // Google UserInfo endpoint (OAUTH-01)
  "giphy.com", // Giphy GIF library
  "api.giphy.com", // Giphy GIF API
  "tenor.com", // Tenor GIF library
  "g.tenor.com", // Tenor GIF CDN
  // BUG-018 FIX: add CAPTCHA verification endpoints so captcha.ts can use
  // safeFetch() instead of bare fetch() for server-side token verification.
  "www.google.com", // Google reCAPTCHA v3 siteverify
  "challenges.cloudflare.com", // Cloudflare Turnstile siteverify
  // BUG-012 FIX: Supabase REST/Auth/Realtime endpoints — project-specific host
  // is derived from NEXT_PUBLIC_SUPABASE_URL and preferred over the wildcards.
  ...buildSupabaseAllowlistEntries(),
];
export interface ValidatedUrl {
  fetchUrl: string;
  originalHostname: string;
  parsed: URL;
  pinnedIp: string;
}
export function isPublicAddress(raw: string): boolean {
  try {
    const address = ipaddr.process(raw);
    return address.range() === "unicast";
  } catch {
    return false;
  }
}
/** Node's automatic IPv4/IPv6 selection requests lookup({all:true}). */
export function createPinnedLookup(pinnedIp:string):LookupFunction{
 const family=isIP(pinnedIp);
 if(family!==4&&family!==6)throw new SSRFError('Invalid pinned address');
 return (_hostname,options,callback)=>{
  if(options.all){
   const allCallback=callback as unknown as (error:null,addresses:LookupAddress[])=>void;
   allCallback(null,[{address:pinnedIp,family}]);
  }else callback(null,pinnedIp,family);
 };
}
async function resolveHost(hostname: string): Promise<string> {
  const literal = hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal)) {
    if (!isPublicAddress(literal)) throw new SSRFError("Nonpublic destination");
    return literal;
  }
  const records = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname),
  ]);
  const addresses = records.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  if (!addresses.length || addresses.some((ip) => !isPublicAddress(ip)))
    throw new SSRFError("Hostname has no exclusively public addresses");
  return addresses[0];
}
export async function validateOutboundUrl(
  rawUrl: string,
): Promise<ValidatedUrl> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SSRFError("Invalid outbound URL");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new SSRFError("Unsupported URL or credentials");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pinnedIp: string;
  try {
    pinnedIp = await Promise.race([
      resolveHost(parsed.hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new SSRFError("DNS lookup timed out")),
          3000,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  const pinned = new URL(parsed);
  pinned.hostname = isIP(pinnedIp) === 6 ? `[${pinnedIp}]` : pinnedIp;
  return {
    parsed,
    pinnedIp,
    originalHostname: parsed.hostname,
    fetchUrl: pinned.href,
  };
}
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: {
    requireAllowlist?: boolean;
    maxResponseBytes?: number;
    _hops?: number;
  } = {},
): Promise<Response> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(10_000),
    ...(init.signal ? [init.signal] : []),
  ]);
  let url = rawUrl;
  for (let hop = 0; hop <= 5; hop++) {
    signal.throwIfAborted();
    const { parsed, pinnedIp } = await validateOutboundUrl(url);
    if (
      options.requireAllowlist &&
      !HOSTNAME_ALLOWLIST.includes(parsed.hostname)
    )
      throw new SSRFError("Host is not allowlisted");
    const dispatcher = new Agent({
      connect: {
        lookup:createPinnedLookup(pinnedIp),
      },
    });
    let response: Awaited<ReturnType<typeof request>> | undefined;
    try {
      response = await request(parsed, {
        ...init,
        signal,
        redirect: "manual",
        dispatcher,
      } as Parameters<typeof request>[1]);
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.status !== 304
      ) {
        const location = response.headers.get("location");
        if (!location) throw new SSRFError("Redirect has no location");
        const next = new URL(location, parsed);
        // Provider credentials and secret POST bodies must never be redirected.
        if (
          options.requireAllowlist ||
          !["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase()) ||
          next.origin !== parsed.origin
        )
          throw new SSRFError("Unsafe outbound redirect");
        url = next.href;
        continue;
      }
      const max = options.maxResponseBytes ?? 5 * 1024 * 1024;
      if (Number(response.headers.get("content-length")) > max)
        throw new SSRFError("Response too large");
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (response.body) {
        for await (const chunk of response.body) {
          length += chunk.byteLength;
          if (length > max) throw new SSRFError("Response too large");
          chunks.push(chunk);
        }
      }
      const headers = new Headers(Array.from(response.headers.entries()));
      headers.delete("content-encoding");
      headers.delete("content-length");
      const empty =
        [204, 205, 304].includes(response.status) || init.method === "HEAD";
      return new Response(empty ? null : Buffer.concat(chunks), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } finally {
      if (response?.body && !response.body.locked)
        await response.body.cancel().catch(() => {});
      await dispatcher.destroy();
    }
  }
  throw new SSRFError("Too many redirects");
}
