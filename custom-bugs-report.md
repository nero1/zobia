# Zobia Social — Forensic Bug Report
**Date:** 2026-06-21 | **Time:** 03:04 PM
**Analyst:** Deep codebase analysis (web + Expo Android + shared packages)
**Scope:** Security, financial integrity, race conditions, performance, SEO, privacy, UX, i18n, accessibility, data integrity

---

## Summary Index (one-line per bug)

1. BUG-SEC-01: Footer scripts XSS — admin-panel scripts receive page CSP nonce, enabling stored XSS from any compromised admin account
2. BUG-SEC-02: No database-level RLS — raw pg driver bypasses Supabase Row Level Security; app-level auth is the only protection with no defence-in-depth
3. BUG-SEC-03: CAPTCHA implementation absent — manifest has `captchaProvider` config but no CAPTCHA challenge is enforced on login / register / password-reset routes
4. BUG-SEC-04: DodoPayments webhook manual timing-safe compare — char-code XOR loop instead of Node's `crypto.timingSafeEqual`, risking timing side-channel on signature verification
5. BUG-FIN-01: Referral commissions post-transaction with no retry / DLQ — coins are silently lost on network errors after payment commit
6. BUG-FIN-02: Creator Fund distribution amounts computed outside advisory lock — stale scoring possible if a concurrent run distributes between calculation and lock acquisition
7. BUG-FIN-03: Creator Fund idempotency key tied to rank, not creator ID — a re-run within the same period with different rankings can credit the wrong creator
8. BUG-RACE-01: consumeRematchToken TOCTOU — token ID selected in subquery but UPDATE is not atomic; concurrent calls can both consume the same token
9. BUG-RACE-02: DLQ retry (retryFailedXPAwards) lacks FOR UPDATE SKIP LOCKED — concurrent CRON instances retry the same failed XP rows
10. BUG-RACE-03: leaderboard_snapshots CONFLICT target uses COALESCE expressions — any drift between the index definition in migration and the ON CONFLICT clause silently inserts duplicates instead of updating
11. BUG-PERF-01: Leaderboard engine uses OFFSET-based pagination — O(N) sequential scans grow with dataset; deep pages scan millions of rows
12. BUG-PERF-02: getLedgerEntries / getStarLedgerEntries lack cursor pagination — simple LIMIT without cursor causes full-table scans for deep history
13. BUG-PERF-03: Push receipt polling: O(N) individual per-ticket DB updates — each receipt update is a separate query; should batch with ANY($1::uuid[])
14. BUG-PERF-04: Announcement modal fetches ALL active modals without LIMIT — heavy if hundreds exist; should LIMIT to first N then filter in-memory
15. BUG-PERF-05: ioredis reconnect lacks jitter — linear backoff `times * 200ms` causes thundering herd when Redis restarts
16. BUG-PERF-06: next-pwa 5.6.0 is incompatible with Next.js 15 — v5 targets webpack 4; causes build warnings and broken precache manifests with Next.js 15
17. BUG-CONF-01: PAYSTACK_SECRET_KEY and CRON_SECRET are optional in env.ts — missing keys cause silent failures instead of startup errors
18. BUG-CONF-02: parseBool in manifest uses case-sensitive `=== "true"` — DB values saved as "TRUE" or "True" silently disable features
19. BUG-CONF-03: DLQ alert threshold hardcoded at 100 — not configurable from x_manifest; cannot tune alerting without redeployment
20. BUG-ERR-01: External fetch calls (Expo push, Google OAuth) have no request timeout — a slow Expo API or Google endpoint hangs serverless invocations indefinitely
21. BUG-ERR-02: pinGuard requirePinVerified has no alerting on Redis failure — fails closed silently; ops have no visibility when Redis outages block all PIN-protected operations
22. BUG-PRIV-01: Public profile page exposes subscription plan — premium tier (plus/pro/max) is public financial information; should be hidden
23. BUG-PRIV-02: Push notifications lack per-user rate limit — a bug elsewhere can flood users with unlimited push notifications with no back-pressure
24. BUG-PRIV-03: xp_ledger / coin_ledger / star_ledger and xp_events grow unbounded — no archiving strategy; indefinite growth inflates storage costs and slows index scans
25. BUG-SEO-01: No sitemap.xml generation — public profiles (/u/[username]), rooms, and events are not discoverable by search engine crawlers
26. BUG-SEO-02: No robots.txt visible — without it, crawlers may index admin, auth, and API routes
27. BUG-SEO-03: No schema.org JSON-LD structured data on public profiles — reduces rich-snippet eligibility and social sharing quality
28. BUG-SEO-04: Missing hreflang tags for 8 supported locales — search engines cannot serve the correct locale variant of any page
29. BUG-SEO-05: Public profile avatar uses `<img>` not Next.js `<Image>` — misses LCP optimisation, WebP conversion, lazy loading, and blur placeholders; impacts Core Web Vitals
30. BUG-I18N-01: Announcement modal reads manifest via raw SQL, bypassing cache — double DB hit per modal/banner request; should use `loadManifest()` or `getManifestValue()`
31. BUG-I18N-02: Announcement views serial-mode reset deletes ALL views for a user — when all modals are exhausted the DELETE removes every dismissed modal, not just the current eligible set
32. BUG-I18N-03: user_modal_views select has no LIMIT — a user who dismisses thousands of announcements triggers an unbounded query per session
33. BUG-A11Y-01: No user help / FAQ section — PRD requires a user help section; none found in app routes or API
34. BUG-A11Y-02: No account reactivation / restore flow — soft-deleted accounts cannot be restored; no documented or implemented path
35. BUG-LOG-01: dlqMonitor and trackMilestones use `console.*` instead of structured pino logger — alerts will be missed by log aggregators filtering on pino JSON format
36. BUG-LOG-02: Upstash pipeline adapter only supports `del` and `zremrangebyrank` — any future pipeline call for a different command silently becomes a no-op
37. BUG-LOG-03: leaderboard Hall of Fame total count inflated on page 1 diverges from page 2+ — `total += missingHof.length` only on page 1 makes `hasMore` inconsistent for consumers
38. BUG-MOB-01: Google Play IAP purchaseItemAsync not cancelled on 5-minute timeout — the timeout resolves the promise but the underlying purchase flow continues; a late delivery is recovered by the listener but the UX shows a failure
39. BUG-MOB-02: syncQueue.ts uses `/messages/dm/${conversationId}` endpoint — Expo's offline sync routes DMs through a conversationId-parameterised path that may not match the actual API endpoint signature

---

## Detailed Bug Descriptions

---

### BUG-SEC-01: Footer scripts stored XSS via admin panel
**FILES:** `apps/web/app/layout.tsx` (lines 184–196)

Admin-injected footer scripts are rendered via `dangerouslySetInnerHTML`. The CSP nonce is injected into each `<script>` tag found in the content using a regex replace (`script.content.replace(/<script(\s|>)/gi, ...)`). Because the nonce is injected from the server-side and is valid for the current request, any admin-level user who can save a footer script can execute arbitrary JavaScript in every visitor's browser session. Although this is gated behind admin access, the blast radius if an admin account is compromised (via credential stuffing, session theft, or a vulnerable admin route) is total: the attacker gains persistent XSS on all page loads, enabling cookie theft (including httpOnly bypass via fetch), keylogging, and credential harvesting.

**FIX:** Serve admin-injected scripts from a separate, sandboxed `<iframe>` with `sandbox` attribute, or enforce a strict Content Security Policy `script-src` directive that does NOT include nonces for admin-injected content. Alternatively, require admin-injected scripts to be pre-approved, hash-validated at save time, and served with a static hash CSP directive rather than the dynamic per-request nonce.

---

### BUG-SEC-02: No database-level Row Level Security (RLS)
**FILES:** `apps/web/lib/db/providers/railway.ts`, `apps/web/lib/db/providers/digitalocean.ts`, `apps/web/lib/db/providers/supabase.ts`

The app uses a raw `pg` Pool connection to PostgreSQL (Railway, DigitalOcean, and Supabase providers). This bypasses Supabase's Row Level Security entirely — even on the Supabase provider. All data access control depends exclusively on application-layer WHERE clauses. A SQL injection vulnerability, a misconfigured query, or a Drizzle ORM bug would expose all data with no database-level backstop.

**FIX:** Enable RLS policies in PostgreSQL on all user-facing tables (`users`, `coin_ledger`, `star_ledger`, `payments`, `room_messages`, `dm_conversations`, etc.) even when using raw pg. The policies can be a simple `current_setting('app.user_id')` check, set per-connection via `SET LOCAL`. The SupabaseDatabaseAdapter should set `app.user_id` on the Supabase service role connection using `SET` to activate RLS policies as a second line of defence.

---

### BUG-SEC-03: CAPTCHA integration absent
**FILES:** `apps/web/lib/manifest/index.ts` (line 69), `apps/web/app/api/auth/*/route.ts`

The manifest defines `captchaProvider: "recaptcha" | "turnstile" | "none"` and the admin panel can set it. However, no auth route (login, register, password-reset, pin-verify) checks the captcha provider, calls any CAPTCHA verification endpoint, or accepts a captcha token from clients. The manifest key is read but never acted upon. Bot-driven credential stuffing, account creation spam, and password-reset abuse are completely undefended.

**FIX:** Implement a `verifyCaptcha(token: string): Promise<boolean>` helper that calls reCAPTCHA v3 or Cloudflare Turnstile depending on the manifest value. Call it at the top of the register, login, and password-reset route handlers when `captchaProvider !== "none"`. Pass the CAPTCHA token from clients in the request body.

---

### BUG-SEC-04: DodoPayments webhook manual timing-safe comparison
**FILES:** `apps/web/lib/payments/dodopayments.ts` (lines 150–166)

`verifyWebhookSignature` computes the expected HMAC-SHA256 and compares against the received signature using a manual char-code XOR loop:
```js
for (let i = 0; i < expected.length; i++) {
  diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
}
```
This is a correct constant-time implementation for equal-length strings, but it operates on the HEX-encoded strings (not the raw bytes), doubling the comparison length unnecessarily. More importantly, the comparison uses JavaScript string `charCodeAt` in the V8 JIT which may be inlined or re-ordered in ways that deviate from constant-time guarantees on hot paths. The Paystack webhook handler correctly uses `crypto.timingSafeEqual` on Buffer objects.

**FIX:** Use `crypto.timingSafeEqual` on Buffer-decoded hex values, identical to the Paystack webhook handler:
```ts
const expectedBuf = Buffer.from(expected, 'hex');
const receivedBuf = Buffer.from(signature, 'hex');
if (expectedBuf.length !== receivedBuf.length) return false;
return crypto.timingSafeEqual(expectedBuf, receivedBuf);
```

---

### BUG-FIN-01: Referral commissions post-transaction with no retry / DLQ
**FILES:** `apps/web/lib/payments/paystackWebhookHandler.ts`, `apps/web/lib/payments/dodoWebhookHandler.ts`

Both webhook handlers call `awardReferralCommissions(...)` after the outer payment transaction commits, using `.catch((err) => console.error(...))`. If the function throws (DB connection error, Redis timeout, etc.) the coins are never credited to the referrer and there is no dead-letter queue or retry mechanism. The payment is marked `completed` but the commission is silently dropped.

**FIX:** Insert a `referral_commission_queue` row (or use the existing `failed_xp_awards` table pattern) inside the payment transaction before it commits. The CRON job retries any unprocessed rows from this queue. Alternatively, wrap `awardReferralCommissions` in the same `safeAwardXP`-style DLQ pattern: on failure, write to a `failed_commissions` table for CRON retry with idempotency via the `paymentId` reference.

---

### BUG-FIN-02: Creator Fund distribution amounts computed outside advisory lock
**FILES:** `apps/web/lib/creator/fund.ts` (lines 225–268)

`distributeCreatorFund(poolKobo)` first calls `calculateFundDistributions(poolKobo)` to score all creators, then opens a transaction and acquires `pg_try_advisory_xact_lock`. If two processes run concurrently (two CRON invocations, or a manual trigger during a CRON window), both can complete `calculateFundDistributions` before either acquires the lock. The process that loses the lock skips the distribution entirely (correct), but the process that wins will use a potentially stale `distributions` list (computed before it locked). In practice the window is narrow, but the `ON CONFLICT (reference_id) DO NOTHING` guard ties deduplication to rank position, not the creator's score — see BUG-FIN-03.

**FIX:** Move `calculateFundDistributions` inside the transaction, after the advisory lock is acquired. This ensures only one process calculates and distributes.

---

### BUG-FIN-03: Creator Fund idempotency key ties to rank, not creator ID
**FILES:** `apps/web/lib/creator/fund.ts` (line 249)

The idempotency reference for each `creator_earnings` insert is `fund:${period}:rank${dist.rank}`. This key is stable per (period, rank), not per (period, creator). If rankings change between two runs in the same period (e.g. due to BUG-FIN-02's race, or a CRON retry after a partial failure that changes scores), creator A could be "rank 1" in the first run and creator B in the second. The second run for creator B (rank 1) is suppressed by the ON CONFLICT, but creator A never receives their share for the re-run. Creator B also doesn't receive it. The net result is a missed distribution.

**FIX:** Change the reference key to `fund:${period}:creator:${dist.creatorId}`. This ensures each creator can only receive one distribution per period regardless of rank changes between runs.

---

### BUG-RACE-01: consumeRematchToken TOCTOU race condition
**FILES:** `apps/web/lib/guilds/warEngine.ts`

`consumeRematchToken` reads the token ID using a subquery and then issues a separate UPDATE. Two concurrent calls from the same user (double-tap) both pass the subquery check and both try to issue the UPDATE. The second UPDATE may operate on the same token if the first has not yet committed. The operation should be a single atomic CTE: `WITH t AS (DELETE FROM ... RETURNING id) SELECT id FROM t`.

**FIX:** Use a single atomic CTE: `WITH consumed AS (UPDATE guild_rematch_tokens SET used_at = NOW() WHERE guild_id = $1 AND used_at IS NULL RETURNING id) SELECT id FROM consumed`. This is atomic and cannot be double-consumed.

---

### BUG-RACE-02: DLQ retryFailedXPAwards lacks FOR UPDATE SKIP LOCKED
**FILES:** `apps/web/lib/xp/safeAwardXP.ts` (lines 179–196)

The retry query selects eligible `failed_xp_awards` rows without `FOR UPDATE SKIP LOCKED`. If two CRON instances run concurrently (e.g. due to external CRON service retrying a timed-out invocation), both select the same rows and both attempt to retry the same XP awards. The XP ledger's ON CONFLICT DO NOTHING prevents double-crediting, but retry_count is incremented twice per row, prematurely exhausting retries.

**FIX:** Add `FOR UPDATE SKIP LOCKED` to the SELECT query. Each CRON instance will then lock its own batch, preventing duplicate processing.

---

### BUG-RACE-03: leaderboard_snapshots ON CONFLICT COALESCE fragility
**FILES:** `apps/web/lib/leaderboards/engine.ts` (lines 415–422)

`upsertLeaderboardSnapshot` uses:
```sql
ON CONFLICT (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))
DO UPDATE SET xp_value = EXCLUDED.xp_value
```
For this to work, the migration must define the unique index with the EXACT same expression columns. If the index was created with `NULLS NOT DISTINCT` or with plain `city` and `season_id` columns, this ON CONFLICT target will never match and every call silently inserts a duplicate row rather than updating. PostgreSQL requires the conflict target to reference an index or a constraint; an expression that doesn't exactly match any index causes a runtime error or is silently ignored.

**FIX:** Verify the migration creates an expression index using the same COALESCE expressions, or use `ON CONFLICT ON CONSTRAINT` if a named constraint exists. Alternatively, migrate to a `UNIQUE NULLS NOT DISTINCT` constraint on `(user_id, track, scope, city, season_id)` available in PostgreSQL 15+, and remove the COALESCE.

---

### BUG-PERF-01: Leaderboard engine uses OFFSET-based pagination
**FILES:** `apps/web/lib/leaderboards/engine.ts` (lines 235–252)

`getLeaderboard` uses `LIMIT $n OFFSET $m`. For page 100 with pageSize 100, PostgreSQL scans 10,000 rows before returning results. On a leaderboard with 100,000+ users this causes full-index-scan latency of hundreds of milliseconds and wastes I/O. This will worsen linearly with user growth.

**FIX:** Implement cursor-based pagination using (xp_value, user_id) as a composite cursor. The WHERE clause becomes `WHERE (ls.xp_value, ls.user_id) < ($cursor_xp, $cursor_user_id)` using the index covering ORDER BY. Return the last (xp_value, user_id) pair as the next-page cursor. This gives O(1) per-page cost regardless of page number.

---

### BUG-PERF-02: getLedgerEntries / getStarLedgerEntries lack cursor pagination
**FILES:** `apps/web/lib/economy/coins.ts`, `apps/web/lib/economy/stars.ts`

Both `getLedgerEntries` and `getStarLedgerEntries` accept a `limit` parameter but use `ORDER BY created_at DESC LIMIT $n` with no offset or cursor. Callers cannot page through ledger history. For wallets with large transaction histories this prevents full history access without server-side data loss.

**FIX:** Add an optional `cursor: { createdAt: string; id: string } | null` parameter. When provided, append `AND (created_at, id) < ($cursor_createdAt, $cursor_id)` to the WHERE clause. Return the last row's `(created_at, id)` as the next cursor.

---

### BUG-PERF-03: Push receipt polling: O(N) individual per-ticket DB updates
**FILES:** `apps/web/lib/notifications/push.ts` (lines 343–390)

Inside `pollPushReceipts`, each Expo receipt result triggers a separate `UPDATE push_tickets SET status=... WHERE id=$1` query. For 1,000 pending tickets per CRON run this is 1,000 round-trips. This holds the CRON execution open longer than necessary and creates DB connection contention.

**FIX:** Accumulate results by status into batched lists (`okIds`, `errorIds`, `staleTokenIds`). After processing all receipts in a batch, issue a single `UPDATE push_tickets SET status='ok', resolved_at=NOW() WHERE id = ANY($1::uuid[])` for each status. Similarly batch-delete stale tokens with `DELETE FROM user_push_tokens WHERE token = ANY($1)`.

---

### BUG-PERF-04: Announcement modal fetches all active modals without LIMIT
**FILES:** `apps/web/lib/announcements/engine.ts` (lines 109–131), (lines 237–258)

`getActiveModalForUser` and `getActiveBannerForUser` select all active, in-schedule announcements with no LIMIT clause. If an admin creates hundreds of announcements, every API call fetches all of them into memory. Only the first one after filtering by targeting is actually needed.

**FIX:** Add `LIMIT 50` (or a reasonable constant) to the query. In serial mode, filter the user's viewed modal IDs server-side by pushing the NOT EXISTS check into the SQL query itself rather than loading all modals and filtering in JavaScript.

---

### BUG-PERF-05: ioredis reconnect strategy lacks jitter
**FILES:** `apps/web/lib/redis/index.ts`

The ioredis retry strategy uses linear backoff: `retryStrategy: (times) => Math.min(times * 200, 10000)`. When Redis restarts, all serverless instances start their retry at t=0 and attempt reconnection at t=200ms, t=400ms, etc., in lockstep. This creates a thundering herd of reconnection attempts.

**FIX:** Add randomised jitter: `retryStrategy: (times) => Math.min(times * 200, 10000) + Math.random() * 200`. This spreads reconnection attempts across a 200ms window, preventing simultaneous burst reconnections.

---

### BUG-PERF-06: next-pwa 5.6.0 incompatible with Next.js 15
**FILES:** `apps/web/package.json` (line 44), `apps/web/next.config.js`

`next-pwa` v5.6.0 was designed for Next.js 12/13 with webpack 4. Next.js 15 uses webpack 5 and has changed the internal build pipeline. Known issues include: incorrect chunk hashing in the precache manifest, `buildExcludes` patterns that don't match the new chunk paths, and service worker registration failures in production. The package has not had a release since 2022 and is effectively abandoned.

**FIX:** Migrate to `@ducanh2912/next-pwa` (actively maintained fork) or `serwist` which is the modern successor to workbox-based PWA plugins and supports Next.js 15 and webpack 5. The runtime caching configuration in `next.config.js` is compatible and can be ported directly.

---

### BUG-CONF-01: PAYSTACK_SECRET_KEY and CRON_SECRET are optional in env.ts
**FILES:** `apps/web/lib/env.ts`

Both `PAYSTACK_SECRET_KEY` and `CRON_SECRET` are declared as `z.string().optional()` in the Zod env schema. If either is missing at runtime, payment webhooks silently return false from `verifyWebhookSignature` (any webhook accepted as valid) and CRON routes pass the secret check vacuously. This is a misconfiguration trap.

**FIX:** Mark both as `z.string().min(1)` (required). Provide clear validation error messages: `"PAYSTACK_SECRET_KEY is required for payment webhook verification"`. Add a startup check in the payment module that throws on missing secrets.

---

### BUG-CONF-02: parseBool case-sensitive "true" check
**FILES:** `apps/web/lib/manifest/index.ts` (lines 318–321)

`parseBool` returns `true` only when `value === "true"`. If an admin saves a manifest value via a SQL GUI or scripts and the value is stored as `"TRUE"`, `"True"`, or `"1"`, the feature is silently disabled. PostgreSQL boolean columns often return `"t"` or `"true"` depending on the driver.

**FIX:** Normalise the comparison: `return value.toLowerCase() === "true" || value === "1"`. This is resilient to case variations from different DB clients.

---

### BUG-CONF-03: DLQ alert threshold hardcoded at 100
**FILES:** `apps/web/lib/xp/dlqMonitor.ts` (line 9)

`DLQ_ALERT_THRESHOLD = 100` is a module constant. On a high-traffic platform this threshold may be too low (false alerts) or too high (alerts arrive too late). It cannot be tuned from the admin panel without a redeployment.

**FIX:** Read the threshold from `x_manifest` key `dlq_alert_threshold` with a fallback of 100. This allows ops to tune the alerting threshold from the admin panel without a deployment.

---

### BUG-ERR-01: External fetch calls have no request timeout
**FILES:** `apps/web/lib/notifications/push.ts` (lines 179, 323), `apps/web/lib/auth/google.ts` (lines 86, 114)

`sendExpoBatch`, `pollPushReceipts`, `exchangeGoogleCode`, and `fetchGoogleUserProfile` all call `fetch(...)` without an `AbortSignal.timeout`. A slow or unresponsive Expo API or Google OAuth endpoint can hold the serverless function open indefinitely, exhausting the execution time limit and causing cascading timeouts.

**FIX:** Pass `signal: AbortSignal.timeout(10_000)` to every external `fetch` call. For the Expo push send use a 15-second timeout (larger batches need more time). Log and handle `AbortError` specifically so it is distinguished from network errors in monitoring.

---

### BUG-ERR-02: pinGuard requirePinVerified silently fails closed with no alerting
**FILES:** `apps/web/lib/auth/pinGuard.ts` (lines 54–62)

When Redis is unavailable, `requirePinVerified` catches the error and returns `false` (correct fail-closed behaviour). However, no alert or log is emitted. A sustained Redis outage blocks all payout, transfer, and gift operations with no ops visibility. Users will see opaque "PIN verification required" errors without explanation.

**FIX:** Log the Redis error with structured context (`logger.error({ err, userId, sessionId }, "[pinGuard] Redis unavailable")`). Insert a `system_alerts` row for the outage. Optionally, if a fallback DB-backed pin check is acceptable for the business, implement a failover to a database token check.

---

### BUG-PRIV-01: Public profile exposes subscription plan
**FILES:** `apps/web/app/u/[username]/page.tsx` (lines 37–44, 149–151)

The public profile query selects `plan` from the `users` table and renders it in the "Plan" stats card. A user's subscription tier (plus/pro/max) is private financial information that should not be publicly visible without user consent.

**FIX:** Remove `plan` from the public profile query and UI. If a creator badge is desired (indicating a verified/creator status), expose only the `is_creator` boolean and `creator_tier` (which the user has agreed to display by becoming a creator). Alternatively, add a user setting `show_plan_publicly` defaulting to false.

---

### BUG-PRIV-02: Push notifications lack per-user rate limiting
**FILES:** `apps/web/lib/notifications/push.ts`, `apps/web/lib/notifications/chatPush.ts`, `apps/web/lib/notifications/insert.ts`

`sendPushNotification` and `sendPushNotificationBatch` can be called an unlimited number of times per user per minute. A bug in the realtime event pipeline (e.g. an infinite reconnect loop triggering chat push events) could flood a user's device with hundreds of notifications. There is no rate limiter guard.

**FIX:** Add a Redis-backed rate limiter in `sendPushNotification`: `SET user:push:rate:{userId} {count} EX 60 NX` / `INCR` and reject sends when count exceeds a configurable cap (e.g. 10 per minute per user). Use the existing sliding-window rate limiter pattern from `lib/security/rateLimit.ts`.

---

### BUG-PRIV-03: Append-only ledgers and event tables grow unbounded
**FILES:** `apps/web/lib/db/schema.ts` — `coinLedger`, `starLedger`, `xpLedger`, `xpEvents`

The coin, star, and XP ledger tables are append-only with no archival or retention policy. The `xp_events` table similarly has no cleanup. Over time these tables will grow to hundreds of millions of rows, increasing index bloat, slowing `SELECT ... WHERE user_id = $1` scans even with indexes, and raising storage costs.

**FIX:** Implement a rolling archive: after N days (e.g. 180 days), move older rows to `coin_ledger_archive`, `star_ledger_archive`, etc. (same schema, no foreign key constraints). The archive tables can be on cheaper storage. All active queries read only from the hot table. Add a CRON step to archive rows older than the retention window.

---

### BUG-SEO-01: No sitemap.xml generation
**FILES:** `apps/web/app/` — no sitemap.ts found

Public user profiles (`/u/[username]`), public room landing pages, and platform event pages exist and are crawlable (included in `PUBLIC_PREFIXES` in middleware), but there is no `sitemap.ts` / `sitemap.xml.ts` route generating a dynamic sitemap. Without a sitemap, Google/Bing must discover pages only through links, drastically slowing indexing.

**FIX:** Add `apps/web/app/sitemap.ts` using Next.js 15's Metadata API. Generate entries for all public profiles (batch-select usernames from DB, paginate with `lastmod = updated_at`), public rooms, and static pages. Submit the sitemap URL to Google Search Console.

---

### BUG-SEO-02: No robots.txt
**FILES:** `apps/web/public/` — no robots.txt found

Without a `robots.txt`, web crawlers follow their own default rules. Admin routes (`/admin/*`), auth routes (`/auth/*`), and API routes may be crawled and indexed, wasting crawl budget and potentially leaking route structure.

**FIX:** Add `apps/web/public/robots.txt` or `apps/web/app/robots.ts` (Next.js Metadata API). Disallow `/admin/*`, `/api/*`, `/auth/*`, `/pwa-start`, and allow `/u/*`, `/c/*`. Include `Sitemap:` directive pointing to the sitemap URL.

---

### BUG-SEO-03: No schema.org structured data on public profiles
**FILES:** `apps/web/app/u/[username]/page.tsx`

The public profile page has good OpenGraph / Twitter metadata but no JSON-LD `Person` or `ProfilePage` structured data. Without it, Google cannot generate rich snippets (follower counts, sitelinks, profile highlights) for profile pages in search results.

**FIX:** Add a `<script type="application/ld+json">` block in the page's `<head>` with `Person` schema: `name`, `url`, `description` (bio), `image` (avatar_url), `interactionStatistic` (follower count). Generate this in `generateMetadata()` or as a server component.

---

### BUG-SEO-04: Missing hreflang tags for 8 supported locales
**FILES:** `apps/web/lib/i18n/locales.ts`, `apps/web/app/layout.tsx`

The app supports 8 locales (en, fr, ar, sw, ha, pt, am, zu) and sets the HTML `lang` attribute from the cookie. However, no `hreflang` alternate link tags are rendered in the `<head>`. Search engines treat each locale's version as a separate page, causing duplicate content penalties and failing to serve users the correct locale in search results.

**FIX:** In `generateMetadata()` for public pages (`/u/[username]`, `/c/[slug]`, landing page), add `alternates: { languages: { en: '/u/[username]', fr: '/fr/u/[username]', ar: '/ar/u/[username]', ... } }` using the Next.js Metadata API's `alternates.languages` field. Prefix locale paths as appropriate for the URL structure chosen.

---

### BUG-SEO-05: Public profile avatar uses `<img>` not Next.js `<Image>`
**FILES:** `apps/web/app/u/[username]/page.tsx` (lines 113–120)

The avatar is rendered as a plain `<img>` element. This misses automatic WebP/AVIF conversion, lazy loading (`loading="lazy"` is not applied), responsive `srcset` generation, blur placeholder, and explicit priority for LCP optimisation. The comment `// eslint-disable-next-line @next/next/no-img-element` acknowledges the violation.

**FIX:** Replace with `<Image>` from `next/image`. The avatar_url domain is already allowlisted in `next.config.js` `remotePatterns`. Set `priority` on the hero avatar for LCP.

---

### BUG-I18N-01: Announcement engine reads manifest via raw SQL bypassing cache
**FILES:** `apps/web/lib/announcements/engine.ts` (lines 102–106, 269–273)

Both `getActiveModalForUser` and `getActiveBannerForUser` query `x_manifest` directly:
```sql
SELECT value FROM x_manifest WHERE key = 'announcement_modal_mode'
```
This bypasses the multi-tier manifest cache (`memGet` → Redis → DB) implemented in `lib/manifest/index.ts`. On every modal/banner API call, an extra uncached DB query is issued.

**FIX:** Replace both raw queries with `getManifestValue('announcement_modal_mode')` / `getManifestValue('announcement_banner_mode')` from `lib/manifest/index.ts`. This reads from the in-process cache (zero DB hit on warm instances) and falls back correctly.

---

### BUG-I18N-02: Serial-mode announcement view reset deletes unrelated dismissed modals
**FILES:** `apps/web/lib/announcements/engine.ts` (lines 151–156)

When a user has viewed all eligible modals in serial mode, the code deletes all of the user's modal views: `DELETE FROM user_modal_views WHERE user_id = $1`. If an admin later adds new modals targeting different user groups, this reset causes old (unrelated) modals to re-appear for users who already dismissed them.

**FIX:** Restrict the reset to only the currently eligible modal IDs: `DELETE FROM user_modal_views WHERE user_id = $1 AND modal_id = ANY($2::uuid[])` where `$2` is the array of eligible modal IDs. This preserves views of modals the user is not currently eligible for.

---

### BUG-I18N-03: user_modal_views / user_banner_views fetched without LIMIT
**FILES:** `apps/web/lib/announcements/engine.ts` (lines 144–148, 279–283)

Both serial-mode view checks fetch ALL modal/banner IDs a user has ever dismissed:
```sql
SELECT modal_id FROM user_modal_views WHERE user_id = $1
```
A power user who has been on the platform for years and dismissed hundreds of announcements triggers an unbounded query on every page load. Over time this inflates both DB I/O and in-memory Set construction.

**FIX:** Pass the eligible modal/banner IDs as a filter: `SELECT modal_id FROM user_modal_views WHERE user_id = $1 AND modal_id = ANY($2::uuid[])`. This bounds the result to only the currently eligible modals (typically 1–20 rows), regardless of total dismissal history.

---

### BUG-A11Y-01: No user help / FAQ section
**FILES:** `apps/web/app/` (no help/FAQ route found)

The PRD references a user help section but no implementation is found in the app routes, API, or navigation. Users encountering issues have no in-app documentation path and must contact support externally.

**FIX:** Add an `/help` route with a static FAQ page covering common topics: account verification, payout eligibility, coin/star usage, room creation, and how to report abuse. Link it from the settings page and from relevant error messages.

---

### BUG-A11Y-02: No account reactivation / restore flow
**FILES:** `apps/web/lib/db/schema.ts` (`users.deletedAt`), all middleware

Accounts are soft-deleted via `deleted_at` timestamp. All queries filter `AND deleted_at IS NULL`. There is no API endpoint, admin panel action, or documented procedure to restore a soft-deleted account. A user who accidentally deletes their account (or an admin who mistakenly suspends) cannot be recovered without a direct SQL UPDATE.

**FIX:** Add `POST /api/auth/account/restore` (authenticated with a recovery token emailed to the original email address) and an admin panel "Restore Account" action in the users management page. Log all restore operations to `admin_audit_log`.

---

### BUG-LOG-01: dlqMonitor and trackMilestones use console.* instead of pino logger
**FILES:** `apps/web/lib/xp/dlqMonitor.ts` (line 32), `apps/web/lib/xp/trackMilestones.ts` (lines 298–303)

`dlqMonitor.ts` uses `console.error` and `trackMilestones.ts` uses `console.info` / `console.warn`. The rest of the codebase uses the structured `pino` logger from `lib/logger.ts`. Aggregation tools (Datadog, Logflare, Axiom) filter on pino's JSON format; console output is treated as unstructured text and will be missed by alert rules.

**FIX:** Import and use `{ logger }` from `@/lib/logger` in both files. Replace all `console.*` calls with the equivalent `logger.error`, `logger.info`, `logger.warn`. Include context objects (`{ userId, depth, track }`).

---

### BUG-LOG-02: Upstash pipeline adapter limited to del and zremrangebyrank
**FILES:** `apps/web/lib/redis/index.ts` — UpstashAdapter pipeline implementation

The `UpstashAdapter.pipeline()` method only implements two commands: `del` and `zremrangebyrank`. Any caller that chains other pipeline operations (e.g. `setex`, `hset`, `zadd`) receives a pipeline object where those methods are no-ops, silently failing without throwing. This is a hidden API mismatch between the ioredis and Upstash adapters.

**FIX:** Implement the full pipeline command set used across the codebase, or add a runtime check that throws `UnsupportedOperationError` for unimplemented commands. Document in the adapter's JSDoc which commands are supported. Add a test in `lib/db/__tests__/providerLeakage.test.ts` that exercises pipeline commands on both adapters.

---

### BUG-LOG-03: Hall of Fame leaderboard inflates total count only on page 1
**FILES:** `apps/web/lib/leaderboards/engine.ts` (lines 269–375)

When HoF users are injected on page 1, `total += missingHof.length` is added to the total count. This inflated total is returned in the `LeaderboardPage` response and used to compute `hasMore`. On page 2+ HoF injection does not happen, so the original (non-inflated) total is returned. The result: page 1 shows a `total` of 1050 but page 2 shows `total` of 1000, creating inconsistent pagination state for clients.

**FIX:** Include HoF users in the base count query by adding them to the `leaderboard_snapshots` seed via the upsert. Alternatively, use a separate HoF total and return it as a separate field (`hofCount`) so the client can manage HoF pinning independently of rank-ordered pagination.

---

### BUG-MOB-01: Google Play IAP: purchaseItemAsync not cancelled on client-side timeout
**FILES:** `apps/expo/lib/payments/googlePlay.ts` (lines 352–359)

The 5-minute client-side timeout resolves with `{ success: false, error: 'Purchase timed out' }` and removes the resolver from the map. However, `purchaseItemAsync` continues executing in the background. If Google Play later delivers a result after the timeout, `setupGlobalPurchaseListener` handles it via the orphaned-purchase recovery path (correct). But the user has already seen an error and may attempt a second purchase, resulting in two simultaneous pending purchases for the same product.

**FIX:** When the timeout fires, call `InAppPurchases.finishTransactionAsync` if a pending purchase token exists, or set a flag indicating "recovering after timeout" so the listener knows to de-duplicate. Document this race in a code comment and surface a UX message: "Your purchase is still processing — please wait before trying again."

---

### BUG-MOB-02: Expo offline syncQueue uses `/messages/dm/${conversationId}` endpoint path
**FILES:** `apps/expo/lib/offline/syncQueue.ts` (line 63)

DM messages are routed to `/messages/dm/${msg.conversationId}`. If `conversationId` is a UUID of the conversation record (not the recipient's user ID), this does not match the web API endpoint `POST /api/messages/dm` which accepts `recipientId` in the body. The endpoint paths are inconsistent between the web PWA offline queue (`/api/messages/dm` with `recipientId`) and the Expo sync queue (`/messages/dm/${conversationId}`).

**FIX:** Verify the Expo API base includes `/api` prefix (it does via `apiClient.baseURL`). Confirm whether the DM send route is `/api/messages/dm` (body: `{ recipientId }`) or `/api/messages/dm/:conversationId` (path: conversationId). Align the offline sync queue with the actual route signature and add integration tests for the offline replay path.

---

## Code Quality Rating

### Current State: **6.5 / 10**

**Strengths:**
- Excellent financial integrity patterns: Decimal.js throughout, SELECT FOR UPDATE, idempotency partial indexes, append-only ledgers
- Well-implemented circuit breakers (Redis-backed, Lua atomic scripts)
- Comprehensive multi-provider abstraction (DB, Redis, storage, realtime, payments)
- Good auth security: kid-based JWT rotation, session fixation prevention, distributed refresh lock, timingSafeEqual in most places
- Sliding-window rate limiter with Lua atomic script
- Solid XP dead-letter queue and CRON retry pattern
- Good CSRF and CSP implementation
- Thorough JSDoc on most public APIs

**Weaknesses:**
- Critical XSS vector via admin footer scripts
- No RLS defence-in-depth
- Missing CAPTCHA, sitemap, robots.txt, schema.org
- Offset pagination will not scale
- Post-transaction fire-and-forget operations with no DLQ (referral commissions)
- Several race conditions in high-value paths (rematch token, DLQ)
- Privacy gap (public plan exposure)
- Logging inconsistency (console.* vs pino)

### Projected Rating After All Fixes: **8.8 / 10**

Applying all 39 fixes would close the critical XSS and RLS gaps, add CAPTCHA bot defence, switch to cursor pagination, add proper DLQ for financial operations, fix all race conditions, and dramatically improve SEO discoverability. The remaining gap to 10/10 would require formal penetration testing, browser-level accessibility audit, and production load testing at scale.

---

*Report generated: 2026-06-21 at 03:04 PM*
*Analyst: Forensic codebase review — web (Next.js 15 + TypeScript), Expo Android, shared packages*
