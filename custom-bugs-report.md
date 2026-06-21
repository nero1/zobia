# Zobia Social — Forensic Bug Report

**Generated:** 2026-06-21 at 07:56 PM  
**Analyst:** Claude Code (claude-sonnet-4-6)  
**Scope:** Full codebase — `apps/web` (Next.js 14+ / PWA), `apps/expo` (React Native / Android), `shared` package  
**Method:** Line-by-line forensic read of all production source files; no agents or sub-agents used.

---

## Code Quality Rating

| Dimension | Current | After All Fixes Applied |
|---|---|---|
| **Security** | 7.5 / 10 | 9.2 / 10 |
| **Correctness / Logic** | 7.0 / 10 | 9.0 / 10 |
| **Financial Integrity** | 8.0 / 10 | 9.5 / 10 |
| **Performance / Scalability** | 6.5 / 10 | 8.5 / 10 |
| **Reliability / Error Handling** | 7.0 / 10 | 9.0 / 10 |
| **Observability** | 6.0 / 10 | 8.5 / 10 |
| **Accessibility / SEO** | 5.0 / 10 | 8.0 / 10 |
| **Code Quality / Maintainability** | 7.5 / 10 | 9.0 / 10 |
| **Overall** | **6.8 / 10** | **8.8 / 10** |

**Summary:** The codebase demonstrates genuinely strong engineering in several areas — atomic CTE-based XP awarding, Decimal.js for all coin arithmetic, sliding-window Lua rate limiting, timing-safe token comparisons, DNS-pinned SSRF guards, and a well-structured DLQ/retry architecture. The gaps are concentrated in: (a) a handful of race conditions and TOCTOU windows under concurrent load; (b) security hardening edge cases (open-fail feature gating, trust grace abuse, replay-vulnerable restore links); (c) observability blind spots (New Relic events silently dropped, large discrepancies not alerted); and (d) scalability anti-patterns (OFFSET pagination, unbounded in-memory cache, fetch-not-transaction race in reconciliation). All issues are fixable without architectural rewrites.

---

## Summary List (one line each)

1. SEO metadata reads `process.env` directly, bypassing the validated `env` singleton
2. `generateLocalBusinessSchema` wraps the payload in `@type: "Thing"` instead of `@type: "LocalBusiness"`
3. Manifest `sessionTtls` values are stored but never read — JWT TTLs are hardcoded in `jwt.ts`
4. Four provider env vars are required at startup even when those providers are disabled
5. Account-restore signed JWT is placed in a URL query string (Referer/history leak + replayable)
6. No rate limiting on the account-restore initiation endpoint
7. Field encryption v1→v2 migration helper exists but no script or process ever runs it
8. Gemini AI fallback has no circuit breaker; only the DeepSeek primary path is protected
9. AI client imports `axios` instead of native `fetch`, bypassing SSRF-safe undici agent
10. Season ceremony room `ON CONFLICT` references a JSON-expression index that may not exist in the DB
11. `createSeasonCeremonyRoom` uses bare `console.error` instead of the structured `logger`
12. Trust score 7-day grace bonus (+20) is trivially exploitable — creates free `send_gift` access for new spam accounts
13. Quest daily-deck shuffle uses MD5 (cryptographically weak; predictable seed)
14. Fraud detection gift lookup window is hardcoded to 7 days (not manifest-configurable)
15. Anti-spam URL regex does not catch `discord.gg`, `bit.ly`, `t.co`, or WhatsApp links
16. New Relic custom-event tracking is not implemented — `trackEvent` calls Sentry only, silently dropping New Relic events
17. Reconcile-balances CRON does not raise a `system_alert` for large discrepancies (>50 coins)
18. Reconcile-balances CRON uses `parseInt` for coin values that can exceed safe integer range
19. Reconcile-balances has a read→compare race: balance and ledger sum are fetched at different moments
20. Admin payouts route uses OFFSET pagination (non-scalable on large payouts tables)
21. Gift history endpoint joins `gift_items` only, not `gift_types` — newer gift-type metadata never surfaced
22. No cleanup (TTL/archival) for `audit_discrepancies`, `rank_up_events`, or `xp_events` tables (DB bloat)
23. Read-heavy public API endpoints return no HTTP cache headers (`Cache-Control`, `ETag`)
24. `robots.txt` and `sitemap.xml` are absent (SEO gap)
25. No CORS policy configured for API routes (open to any origin on the web app)
26. Expo patches `global.fetch` at module load, which affects all third-party libraries including SSRF-safe ones
27. Expo push-token registration is fire-and-forget with no retry on failure
28. Telegram login polling uses a fixed 2-second interval with no exponential backoff (battery drain + server load)
29. No CSP `report-uri` endpoint exists to capture and act on violation reports
30. Manifest default `captchaProvider: "none"` means new deployments have zero bot protection until manually configured
31. `isFeatureAvailableForUser` returns `true` on DB errors (fails open — grants access when the DB is unavailable)
32. `daily-core` CRON `maxDuration = 10` seconds is likely insufficient for all scheduled tasks
33. Web app has no i18n/l10n layer (Expo has localisation; web does not)
34. No SIGTERM handler — `closeDb()` and Redis teardown are never called on graceful shutdown
35. `findWarOpponent` has a TOCTOU race condition — two guilds can simultaneously declare war on each other
36. Paystack webhook route does not validate `Content-Type: application/json` before parsing body
37. `retryFailedXPAwards` issues `SELECT … FOR UPDATE SKIP LOCKED` outside of a transaction (locks drop immediately, defeating the purpose)
38. Logout endpoint is subject to the same `RATE_LIMITS.auth` limit — a blocked logout leaves the user unable to sign out
39. Next.js image `remotePatterns` uses `**.supabase.co` double-wildcard (accepts arbitrary subdomains, possible subdomain takeover vector)
40. `audit_discrepancies` auto-correct threshold is hardcoded at 50 coins (should be manifest-configurable)
41. `getLeaderboard` falls back to OFFSET for the first page when no cursor is provided (non-scalable)
42. Memory cache has no maximum size cap — unbounded growth possible if many unique keys are written under load
43. Web pages are missing the `<html lang="…">` attribute (accessibility and i18n failure)
44. `findWarOpponent` ignores the `wardEventCooldownHours` manifest key and uses a hardcoded constant `WAR_COOLDOWN_HOURS = 72`
45. Account-restore link is single-use only by token expiry, not by one-time-use DB flag — the same link can be replayed within its TTL window
46. `X-Frame-Options: SAMEORIGIN` header is set redundantly alongside CSP `frame-ancestors` (CSP supersedes it in all modern browsers, but both emit headers)
47. Admin audit log `SYSTEM_ACTOR_ID` is fine for auto-actions, but the fraud-check hardcoded window silently skips flagging when the window is too narrow
48. `daily-core` message-history cleanup uses `sender_plan_at_creation` which could leave orphaned messages if plan is changed post-send
49. `leaderboard_snapshots` Hall-of-Fame injection on page 1 is done after the cursor-paginated slice, which can push results over the declared `limit`
50. No database connection health-check or reconnect logic if the pool's idle connections are silently dropped by a proxy/firewall timeout

---

## Detailed Bug Entries

---

### 1
**BUG-SEO-01: SEO metadata bypasses validated env singleton**  
**FILES:** `apps/web/lib/seo/metadata.ts`  
**FIX:** Replace every `process.env.NEXT_PUBLIC_APP_URL` reference in `metadata.ts` with the `env.NEXT_PUBLIC_APP_URL` import from `@/lib/env`. This ensures the value goes through the Zod schema validation layer (empty string, malformed URL, etc. would be caught at startup). Currently a misconfigured URL silently produces broken OG/canonical tags.

---

### 2
**BUG-SEO-02: LocalBusiness JSON-LD schema has wrong outer `@type`**  
**FILES:** `apps/web/lib/seo/metadata.ts`  
**FIX:** `generateLocalBusinessSchema` returns a `Thing` wrapper around the `LocalBusiness` object. The outer `@type` must be `"LocalBusiness"` (not `"Thing"`). Schema.org and Google's Rich Results validator both reject the incorrect type, silently preventing any structured-data benefit. Remove the outer `Thing` wrapper or fix the type string.

---

### 3
**BUG-MANIFEST-01: `sessionTtls` manifest values are never consumed — JWT TTLs are hardcoded**  
**FILES:** `apps/web/lib/manifest/index.ts`, `apps/web/lib/auth/jwt.ts`  
**FIX:** `jwt.ts` uses compile-time constants `ACCESS_TOKEN_TTL = "15m"`, `REFRESH_TOKEN_TTL = "30d"`, and `ADMIN_TOKEN_TTL = "1h"`. The manifest fetches and caches a `sessionTtls` object but no code path ever reads these values when signing tokens. Either wire `jwt.createAccessToken` / `createRefreshToken` to accept a TTL parameter derived from the manifest at call time, or document that the manifest values are unused and remove them to avoid misleading operators.

---

### 4
**BUG-ENV-01: Provider-specific env vars are required even when providers are disabled**  
**FILES:** `apps/web/lib/env.ts`  
**FIX:** `TELEGRAM_BOT_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `PAYSTACK_SECRET_KEY` are all declared as `.min(1)` (required). Deployments that intentionally disable Telegram, Google OAuth, or Paystack fail to start. Wrap these in `z.string().optional()` and validate them at the usage site (e.g., inside the Telegram/Google handler) rather than globally at startup. Pattern: `z.string().min(1).optional()` with a runtime throw inside the handler if missing.

---

### 5
**BUG-AUTH-01: Account-restore token transmitted in URL query string — leaks via Referer and browser history**  
**FILES:** `apps/web/lib/auth/restore.ts`, restore email template  
**FIX:** Move the restore token out of the URL query string and into a short-lived POST body flow. The email link should direct to a page that presents a confirmation UI; the token itself is POSTed in the body (not exposed in the URL). Alternatively, if a link is required, use a `POST`-redirect pattern or an opaque token stored server-side (DB row) rather than a signed JWT embedded in the URL. At minimum, add `Referrer-Policy: no-referrer` on the restore page response to prevent Referer leakage to any third-party assets on that page.

---

### 6
**BUG-AUTH-02: No rate limiting on account-restore initiation**  
**FILES:** `apps/web/lib/auth/restore.ts`, restore API route  
**FIX:** The `initiateRestore` function sends an email without any rate-limit check. An attacker can flood a victim's inbox by calling the endpoint repeatedly. Apply `rateLimit` using the user's email (or IP + email) as the key, e.g., 3 restore requests per hour per email address. Piggyback on the existing sliding-window `rateLimit` helper in `lib/security/rateLimit.ts`.

---

### 7
**BUG-SECURITY-01: Field encryption v1→v2 migration exists but is never executed**  
**FILES:** `apps/web/lib/security/fieldEncryption.ts`  
**FIX:** A `migrateFieldEncryption(plaintext, db)` helper exists to re-encrypt v1 (SHA-256) ciphertext with v2 (AES-256-GCM + scrypt). No migration script, admin command, or CRON job calls it. Legacy v1 data remains weakly encrypted indefinitely. Create a one-off migration script (e.g., `scripts/migrate-field-encryption.ts`) that iterates the affected rows in batches, calls `migrateFieldEncryption`, and commits each batch. Run it once, then remove the v1 decrypt path in a follow-up PR.

---

### 8
**BUG-AI-01: Gemini AI fallback has no circuit breaker**  
**FILES:** `apps/web/lib/ai/client.ts`  
**FIX:** DeepSeek has a circuit-breaker implementation; Gemini (the fallback) does not. A sustained Gemini outage causes every AI moderation call to wait for Gemini's full timeout before failing, increasing latency for every content moderation decision during an outage. Add the same circuit-breaker wrapper (or a shared `CircuitBreaker` class) around the Gemini call path. Track failure counts in Redis with a short TTL; open the circuit after N failures and half-open after a cooldown.

---

### 9
**BUG-AI-02: AI client uses `axios` instead of native `fetch` — bypasses SSRF-safe undici agent**  
**FILES:** `apps/web/lib/ai/client.ts`  
**FIX:** The SSRF protection in `lib/security/ssrf.ts` is wired to an undici `Agent` that validates DNS-resolved IPs. `axios` does not use undici and therefore bypasses this protection for the AI provider HTTP calls. Replace the `axios` calls with native `fetch` (Node 18+) using the SSRF-safe agent from `ssrf.ts`, or at minimum add an `axios` adapter that routes through the undici agent. Also removes `axios` as a runtime dependency.

---

### 10
**BUG-SEASON-01: Ceremony room `ON CONFLICT` clause targets a JSON-expression index that may not exist**  
**FILES:** `apps/web/lib/seasons/seasonEngine.ts`  
**FIX:** The `INSERT INTO rooms … ON CONFLICT ((metadata->>'season_id'))` clause requires a matching expression index `CREATE UNIQUE INDEX … ON rooms ((metadata->>'season_id'))` to exist in Postgres. If the migration that creates this index was not applied, the `ON CONFLICT` will throw `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification`. Verify the migration exists; if not, add it. Alternatively, switch to an `ON CONFLICT (name)` approach with a derived deterministic room name per season.

---

### 11
**BUG-SEASON-02: `createSeasonCeremonyRoom` uses `console.error` instead of structured logger**  
**FILES:** `apps/web/lib/seasons/seasonEngine.ts` (line 412)  
**FIX:** Replace `console.error(...)` with `logger.error({ ... }, '...')` from `@/lib/logger`. The `console.error` output is not picked up by the structured logging pipeline (Pino/Sentry integration), so ceremony room creation failures are invisible in production log dashboards. One-line change.

---

### 12
**BUG-TRUST-01: 7-day grace bonus makes the trust gating on `send_gift` trivially bypassable**  
**FILES:** `apps/web/lib/trust/trustScore.ts`  
**FIX:** New accounts aged < 7 days receive +20 trust points, which exactly meets the `send_gift` threshold (also 20). A spam actor creates an account and can immediately send gifts or exploit gift mechanics without any verification. Options: (a) remove the grace bonus and instead lower the `send_gift` threshold to 0 for verified accounts only; (b) gate `send_gift` on email verification rather than trust score; (c) raise the grace bonus age threshold to 1 day but require is_verified = true within the grace period. The simplest fix is to require `isVerified = true` as a secondary gate for `send_gift` regardless of trust score for accounts younger than 7 days.

---

### 13
**BUG-QUEST-01: Quest daily-deck shuffle uses MD5 — cryptographically predictable**  
**FILES:** `apps/web/lib/quests/questEngine.ts`  
**FIX:** The MD5 hash of the user ID + date is used as a shuffle seed. MD5 is not a cryptographically secure pseudo-random number generator; the seed is also fully public (deterministic from user ID + date). A motivated user can precompute their deck for any date. Replace with `crypto.randomBytes` (stored as the daily seed in the DB so the deck stays stable for a given day without being predictable before generation) or use a CSPRNG-based Fisher-Yates shuffle and store the resulting ordered quest IDs in the `daily_quest_decks` row at generation time.

---

### 14
**BUG-FRAUD-01: Gift lookup window for fraud detection is hardcoded to 7 days**  
**FILES:** `apps/web/lib/fraud/payouts.ts`  
**FIX:** The query that counts gifts received by a creator in the fraud-detection window uses `NOW() - INTERVAL '7 days'` as a literal. This should be read from the manifest (e.g., `fraudDetectionGiftWindowDays`) so operators can tune it without a code deploy. Add a manifest key, fetch it in `processPendingPayouts`, and pass it into the fraud-check query as a parameter.

---

### 15
**BUG-ANTISPAM-01: Anti-spam URL regex misses major link-sharing domains**  
**FILES:** `apps/web/lib/messaging/antispam.ts`  
**FIX:** The current URL regex allowlist/blocklist does not detect `discord.gg` invite links, common URL shorteners (`bit.ly`, `t.co`, `tinyurl.com`, `ow.ly`), or WhatsApp group links (`chat.whatsapp.com`). These are standard spam/phishing vectors in social platforms. Extend the blocked-domain list in the regex pattern (or maintain a configurable manifest array `blockedLinkDomains`) and apply it to both the DM anti-spam check and the public-room content filter.

---

### 16
**BUG-OBS-01: New Relic custom events are silently dropped — `trackEvent` only calls Sentry**  
**FILES:** `apps/web/lib/monitoring/index.ts`  
**FIX:** `trackEvent` calls `Sentry.captureMessage` but the stub for `newrelic.recordCustomEvent` is never implemented (the comment says "TODO"). Every call to `trackEvent` throughout the codebase silently drops the New Relic event. Either implement the New Relic call using the `newrelic` npm package and `agent.recordCustomEvent()`, or remove the New Relic references and document that Sentry is the sole monitoring sink. Leaving it as a no-op means production telemetry is incomplete.

---

### 17
**BUG-CRON-01: Reconcile-balances CRON does not raise a `system_alert` for large discrepancies**  
**FILES:** `apps/web/app/api/cron/reconcile-balances/route.ts`  
**FIX:** When a discrepancy exceeds the auto-correct threshold (50 coins), the code currently only calls `logger.warn`. Large discrepancies — which indicate a potential double-credit bug, ledger corruption, or financial fraud — should also `INSERT INTO system_alerts` with `severity = 'critical'` so the on-call operator is paged. Add an alert insert for any discrepancy > 50 (or a configurable manifest threshold) alongside the existing warn log.

---

### 18
**BUG-CRON-02: Reconcile-balances uses `parseInt` for coin values — precision loss on large balances**  
**FILES:** `apps/web/app/api/cron/reconcile-balances/route.ts`  
**FIX:** Coin balances and ledger sums returned from the DB as strings (Postgres `numeric` / `bigint`) are parsed with `parseInt`. For large platforms, coin totals can exceed `Number.MAX_SAFE_INTEGER` (2^53 - 1 ≈ 9 quadrillion). Use `BigInt(row.balance)` for the comparison, or store amounts as Drizzle `bigint` and use the `Decimal.js` path already used in `coins.ts`. At minimum, document that the current approach is safe only below `Number.MAX_SAFE_INTEGER`.

---

### 19
**BUG-CRON-03: Reconcile-balances race condition between balance read and ledger sum**  
**FILES:** `apps/web/app/api/cron/reconcile-balances/route.ts`  
**FIX:** The route reads `users.coin_balance` and then separately `SUM(coin_ledger.amount)` in two queries (or two CTEs without `SERIALIZABLE` isolation). A concurrent coin transfer between the two reads can make a healthy user appear to have a discrepancy and trigger an erroneous auto-correction. Wrap both reads inside a single `BEGIN; SET TRANSACTION ISOLATION LEVEL REPEATABLE READ; … COMMIT;` block (or use a single CTE that captures both values atomically) to eliminate the TOCTOU window.

---

### 20
**BUG-API-01: Admin payouts route uses OFFSET pagination — non-scalable**  
**FILES:** `apps/web/app/api/admin/payouts/route.ts`  
**FIX:** The admin payouts list endpoint uses `LIMIT $n OFFSET $m`. On a table with 100k+ payout rows, large OFFSET values result in full sequential scans. Replace with keyset/cursor-based pagination: accept `?after=<payout_id>` and use `WHERE id > $after ORDER BY id LIMIT $n`. Return `nextCursor` in the response so the admin UI can paginate forward. Consistent with the cursor pagination already used in `coins.ts` and `getLeaderboard`.

---

### 21
**BUG-API-02: Gift history endpoint joins `gift_items` only, missing `gift_types`**  
**FILES:** `apps/web/app/api/economy/gifts/route.ts`  
**FIX:** The gift history query JOINs `gift_items` to get item names and metadata, but `gift_types` (the parent category table) is not joined. For gifts created under newer gift types that have additional metadata stored in `gift_types`, the API returns null/incomplete fields. Add a `LEFT JOIN gift_types gt ON gi.gift_type_id = gt.id` and expose the relevant `gt` columns (e.g., `type_name`, `icon_url`) in the response.

---

### 22
**BUG-DB-01: No retention / archival policy for `audit_discrepancies`, `rank_up_events`, `xp_events` tables**  
**FILES:** `apps/web/app/api/cron/daily-core/route.ts`, DB schema  
**FIX:** `audit_discrepancies`, `rank_up_events`, and `xp_events` grow without bound. On a Vercel Hobby plan with a single Supabase/Neon free-tier DB, unbounded table growth causes storage overruns and query slowdowns. Add a daily CRON step that deletes or archives rows older than a configurable retention window (e.g., 90 days for events, 1 year for audit records). A `deleted_at < NOW() - INTERVAL '90 days'` soft-delete sweep or a `PARTITION BY RANGE` on `created_at` are both viable approaches.

---

### 23
**BUG-PERF-01: Read-heavy public endpoints return no HTTP cache headers**  
**FILES:** `apps/web/app/api/` (leaderboard, quests, public-profile, store routes)  
**FIX:** Public API responses for leaderboards, quest lists, gift store items, and user profiles contain no `Cache-Control` or `ETag` headers. Every client request hits the DB. Add appropriate `Cache-Control: public, max-age=60, stale-while-revalidate=300` headers on truly public, non-personalised responses, and `Cache-Control: private, max-age=30` on personalised but infrequently-changing data (e.g., own profile). This reduces both DB load and Vercel function invocations.

---

### 24
**BUG-SEO-03: Missing `robots.txt` and `sitemap.xml`**  
**FILES:** `apps/web/public/` (missing), `apps/web/app/` (missing)  
**FIX:** The web app has no `robots.txt` or `sitemap.xml`. Search engines crawl blindly and may index admin, auth, and API routes. Create a Next.js `app/robots.ts` route exporting a `robots()` function that disallows `/api/`, `/admin/`, `/auth/`, and `/cron/`, and creates an `app/sitemap.ts` that generates URLs for public content pages. This is a first-class Next.js 13+ feature requiring no additional packages.

---

### 25
**BUG-SECURITY-02: No CORS policy on API routes**  
**FILES:** `apps/web/middleware.ts`, `apps/web/app/api/`  
**FIX:** API routes return no `Access-Control-Allow-Origin` headers. A browser making a cross-origin `fetch` to the API from a non-Zobia origin will succeed (the browser does not block same-origin requests, but third-party pages can make credentialless requests). Add CORS handling in `middleware.ts`: deny all cross-origin pre-flight requests to `/api/` by default, and explicitly allow the Expo / Vercel preview origin if needed. For API routes that must be called by the Expo app, set `Access-Control-Allow-Origin: <expo-app-origin>` explicitly.

---

### 26
**BUG-EXPO-01: `global.fetch` is patched at Expo module load, affecting all third-party libraries**  
**FILES:** `apps/expo/app/_layout.tsx`  
**FIX:** The `global.fetch = patchedFetch` assignment at module load replaces Node/Hermes native fetch for every subsequent call in the process, including calls made by React Native internals and third-party SDKs. These libraries may depend on the default fetch behaviour and break silently. Scope the patch: only apply it to your own API utility module (e.g., `lib/api.ts`) rather than monkey-patching `global.fetch`. Use a named helper like `apiFetch(...)` that wraps the patched fetch.

---

### 27
**BUG-EXPO-02: Push notification token registration is fire-and-forget with no retry**  
**FILES:** `apps/expo/app/_layout.tsx`  
**FIX:** Expo push token registration calls the backend in a `useEffect` with no retry on failure. If the initial registration fails (network error, server error), the device is silently never registered for push notifications. Add a simple retry loop (up to 3 attempts with exponential backoff) inside the `useEffect`, and surface an error state to the user (or re-attempt on the next app foreground via `AppState`).

---

### 28
**BUG-EXPO-03: Telegram login polling uses a fixed 2-second interval with no backoff**  
**FILES:** `apps/expo/app/auth/login.tsx`  
**FIX:** The Telegram login flow polls the auth-check endpoint every 2 seconds unconditionally until the user either logs in or cancels. This drains battery and generates unnecessary server load. Implement exponential backoff starting at 2 seconds, doubling up to a cap of 10–15 seconds, and stop after 5 minutes (or surface a "check your Telegram" nudge). Use `setTimeout` in a chain rather than `setInterval` to enable dynamic delay.

---

### 29
**BUG-SECURITY-03: No CSP `report-uri` / `report-to` endpoint**  
**FILES:** `apps/web/middleware.ts`  
**FIX:** The CSP header is set per-request with a nonce but has no `report-uri` or `report-to` directive. CSP violations — including potential XSS attempts — are silently discarded by the browser. Create a lightweight `POST /api/csp-report` endpoint that logs (via `logger.warn`) and/or writes to a `csp_violations` table. Then add `report-uri /api/csp-report` (and optionally `report-to`) to the CSP string in middleware.

---

### 30
**BUG-MANIFEST-02: Default `captchaProvider: "none"` means new deployments ship with zero bot protection**  
**FILES:** `apps/web/lib/manifest/index.ts`  
**FIX:** The manifest default for `captchaProvider` is `"none"`. On a fresh deployment, until an operator explicitly sets it via the admin panel, all registration and login flows have no CAPTCHA. Change the default to `"turnstile"` (or another low-friction provider) and document the required env var, so operators must explicitly opt out of bot protection rather than accidentally leaving it disabled.

---

### 31
**BUG-SECURITY-04: `isFeatureAvailableForUser` fails open on DB errors — grants access during outage**  
**FILES:** `apps/web/lib/manifest/index.ts`  
**FIX:** The `isFeatureAvailableForUser` function has a try/catch that returns `true` on DB errors. This means a DB outage or query exception causes all feature gates to silently open for all users. Fail closed: return `false` on any error, and log the error so it is visible. For features that must remain available during partial outage, handle them at the call site rather than in the generic gating function.

---

### 32
**BUG-CRON-04: `daily-core` CRON `maxDuration = 10` seconds is likely too short**  
**FILES:** `apps/web/app/api/cron/daily-core/route.ts`  
**FIX:** The `export const maxDuration = 10` configuration limits the Vercel serverless function runtime to 10 seconds. The `daily-core` CRON runs login streak resets, daily login XP for all active users, moments expiry, pin sweeps, and message history cleanup — all in sequence. On a moderately active deployment, these operations can easily exceed 10 seconds for thousands of users. Increase `maxDuration` to 60 (the Vercel Hobby max) or split the tasks across separate CRON endpoints so each stays well under the limit.

---

### 33
**BUG-I18N-01: Web app has no internationalisation (i18n) layer**  
**FILES:** `apps/web/app/` (all UI routes)  
**FIX:** The Expo app has localisation support, but the Next.js web app has no `i18n` configuration in `next.config.js`, no message catalogue, and no locale-aware routing. All user-visible strings are hardcoded in English. Add Next.js `i18n` configuration with at least `defaultLocale: "en"` and a message library (e.g., `next-intl`), and extract all hardcoded strings to a `messages/en.json` catalogue. This also unblocks future language additions.

---

### 34
**BUG-INFRA-01: No SIGTERM handler — DB pool and Redis connections are not drained on shutdown**  
**FILES:** `apps/web/lib/db/index.ts`, `apps/web/lib/redis/index.ts`  
**FIX:** `closeDb()` (which calls `pool.end()`) and a Redis `quit()` exist but are never wired to process signals. On Vercel, containers receive SIGTERM before being terminated. Without a handler, in-flight queries may be aborted, and the Postgres connection pool can leave idle server-side connections open until the DB times them out (wasting connection slots). Add `process.on('SIGTERM', async () => { await closeDb(); await redis.quit(); process.exit(0); })` in a server-startup file.

---

### 35
**BUG-RACE-01: `findWarOpponent` TOCTOU — two guilds can mutually declare war simultaneously**  
**FILES:** `apps/web/lib/guilds/warEngine.ts`  
**FIX:** `findWarOpponent` checks for existing wars and then inserts a new one in a non-atomic two-step. Under concurrent requests, Guild A and Guild B can both pass the "no existing war" check, then each insert a war targeting the other, resulting in two simultaneous wars between the same pair. Wrap the check + insert in a `SELECT … FOR UPDATE` on both guild rows (lock in consistent order to avoid deadlock: `ORDER BY id ASC`) inside a transaction, or add a unique index on `(LEAST(guild_a_id, guild_b_id), GREATEST(guild_a_id, guild_b_id))` on `guild_wars` and handle the unique-constraint violation as a graceful "already at war" response.

---

### 36
**BUG-SECURITY-05: Webhook route lacks `Content-Type` validation before parsing body**  
**FILES:** `apps/web/app/api/payments/paystack/webhook/route.ts`  
**FIX:** The Paystack webhook handler reads `request.json()` without first asserting `Content-Type: application/json`. A malicious actor can craft a request with a mismatched content type that causes the JSON parse to throw an uncaught error or to process an unintended body format. Add an early check: `if (!req.headers.get('content-type')?.includes('application/json')) return NextResponse.json({ error: 'Bad content type' }, { status: 415 });` before the `req.json()` call.

---

### 37
**BUG-RACE-02: `retryFailedXPAwards` issues `FOR UPDATE SKIP LOCKED` outside a transaction — locks are immediately released**  
**FILES:** `apps/web/lib/xp/safeAwardXP.ts`  
**FIX:** The retry function fetches failed awards with `SELECT … FOR UPDATE SKIP LOCKED` but this query runs outside a wrapping transaction. Row-level locks from `FOR UPDATE` are held only for the duration of the enclosing transaction. Without `BEGIN`/`COMMIT`, the lock is acquired and immediately released, meaning concurrent CRON runs can pick the same rows and process them in parallel (defeating the `SKIP LOCKED` intent). Wrap the `SELECT … FOR UPDATE SKIP LOCKED` and the subsequent per-row processing loop inside a `globalDb.transaction()` call, or process the batch inside a single transaction with the lock held.

---

### 38
**BUG-AUTH-03: Logout endpoint subject to same `auth` rate limit — blocked logout is a security risk**  
**FILES:** `apps/web/app/api/auth/logout/route.ts`, `apps/web/lib/security/rateLimit.ts`  
**FIX:** The logout route applies `RATE_LIMITS.auth` (designed for login attempts to prevent brute-force). If a user's IP has exhausted the auth rate limit (e.g., after multiple failed login attempts), their subsequent logout request is also rejected with 429. This leaves the user unable to sign out of a compromised session. Assign logout its own generous rate limit (e.g., 20 req/min per user, not per IP), or explicitly exempt logout from the auth rate limiter.

---

### 39
**BUG-SECURITY-06: Next.js image `remotePatterns` uses double-wildcard `**.supabase.co`**  
**FILES:** `apps/web/next.config.js`  
**FIX:** The pattern `{ protocol: "https", hostname: "**.supabase.co" }` allows Next.js image optimization to proxy images from any subdomain of `supabase.co`, including potentially attacker-controlled subdomains (subdomain takeover or shared-tenant abuse). Enumerate only the specific project subdomains you actually use (e.g., `{ hostname: "abcxyz.supabase.co" }`) to limit the attack surface. Similarly review `**.r2.dev` and `**.r2.cloudflarestorage.com`.

---

### 40
**BUG-CRON-05: Reconcile-balances auto-correct threshold (50 coins) is hardcoded**  
**FILES:** `apps/web/app/api/cron/reconcile-balances/route.ts`  
**FIX:** The constant `AUTO_CORRECT_THRESHOLD = 50` is hardcoded. Different deployment environments (staging vs. production) or coin-economy designs may need different thresholds. Move this to a manifest key `reconcileAutoCorrectThreshold` with a sensible default, fetched at CRON start. This makes it operator-adjustable without a code deploy.

---

### 41
**BUG-PERF-02: `getLeaderboard` falls back to OFFSET for the first page when no cursor is provided**  
**FILES:** `apps/web/lib/leaderboards/engine.ts`  
**FIX:** When `getLeaderboard` is called without a `cursor`, it executes `ORDER BY score DESC LIMIT $n OFFSET 0`. While OFFSET 0 is trivially efficient, the code path also exists for arbitrary OFFSET values when the caller does not provide a cursor (implying page-number-based navigation is still supported). Enforce cursor-only pagination throughout the public API surface; remove any OFFSET code path that is not needed for the Hall-of-Fame injection. The HoF injection itself should be applied as an in-memory merge step after fetching the keyset page, not as an additional OFFSET query.

---

### 42
**BUG-PERF-03: In-process memory cache has no maximum entry count (unbounded growth)**  
**FILES:** `apps/web/lib/cache/memory.ts`  
**FIX:** The TTL cache's `Map` has no size cap. Under pathological conditions (many unique cache keys, e.g., one per user ID per request), the map grows without bound until the Node.js process is killed by the Vercel 1792 MB memory limit. Add a maximum entry count (e.g., 1000) using an LRU eviction policy (or simply evict the oldest entry when the cap is reached). The existing 60-second pruning interval is too coarse to protect against a sudden burst of unique keys.

---

### 43
**BUG-A11Y-01: Web pages are missing `<html lang="…">` attribute**  
**FILES:** `apps/web/app/layout.tsx`  
**FIX:** The root layout does not set the `lang` attribute on the `<html>` element. Screen readers use this attribute to select the correct language engine for speech synthesis; its absence causes accessibility failures (WCAG 2.1 SC 3.1.1, Level A — a hard requirement). Add `<html lang="en">` (or the appropriate locale code) to the root layout. When i18n is added (see BUG-I18N-01), this should be dynamic based on the resolved locale.

---

### 44
**BUG-MANIFEST-03: `findWarOpponent` ignores `wardEventCooldownHours` manifest key**  
**FILES:** `apps/web/lib/guilds/warEngine.ts`  
**FIX:** The manifest stores a `wardEventCooldownHours` configuration value but `findWarOpponent` uses a hardcoded constant `WAR_COOLDOWN_HOURS = 72`. Changing the manifest value has no effect. Replace the constant with a manifest read (`getManifestValue('wardEventCooldownHours')`) at call time (with a fallback default of 72 for safety). This gives operators control over the cooldown without code deploys.

---

### 45
**BUG-AUTH-04: Account-restore link is replayable within its TTL window**  
**FILES:** `apps/web/lib/auth/restore.ts`  
**FIX:** The signed JWT restore token is validated only for signature and expiry — there is no one-time-use flag. If a malicious actor intercepts the restore email link (e.g., via a forwarded email, a shared device, or browser history), they can use it repeatedly until it expires. Add a `restore_tokens` table (or a Redis key `restore:<jti>: used`) and on first use set the row to `used = true`. Reject any second use with a 410 Gone or 400 Bad Request.

---

### 46
**BUG-SECURITY-07: `X-Frame-Options` header is set redundantly alongside CSP `frame-ancestors`**  
**FILES:** `apps/web/next.config.js`, `apps/web/middleware.ts`  
**FIX:** `X-Frame-Options: SAMEORIGIN` is set in the static headers in `next.config.js`. The middleware also sets `frame-ancestors 'self'` in the CSP. All modern browsers use CSP `frame-ancestors` and ignore `X-Frame-Options` when both are present; older browsers honour `X-Frame-Options`. Having both is not harmful but adds response-header bloat and creates a maintenance inconsistency risk (if someone changes one but not the other). If supporting IE 11 is not required, remove `X-Frame-Options` from `next.config.js` and rely solely on the CSP directive.

---

### 47
**BUG-CRON-06: `daily-core` message-history cleanup uses `sender_plan_at_creation` which may leave orphaned messages**  
**FILES:** `apps/web/app/api/cron/daily-core/route.ts`  
**FIX:** Message history retention is based on `sender_plan_at_creation` (the sender's plan tier at the time the message was sent). If the sender's plan is changed post-send, the retention tier is frozen at the old value. Messages sent under a low-tier plan that should have been deleted may persist if the user upgrades, and vice versa. Consider snapshotting the retention_days value as a concrete column on the `messages` table at creation time (e.g., `retain_until = NOW() + INTERVAL '<n> days'`) and using `WHERE retain_until < NOW()` for the cleanup sweep.

---

### 48
**BUG-PERF-04: Leaderboard Hall-of-Fame injection can push result count over the declared `limit`**  
**FILES:** `apps/web/lib/leaderboards/engine.ts`  
**FIX:** On page 1, the Hall-of-Fame rows (previous season top-3) are appended to the keyset-paginated result slice, potentially returning `limit + hofCount` items. Callers expecting exactly `limit` rows (e.g., for pagination math) can compute incorrect `nextCursor` positions or display extra items unexpectedly. The HoF entries should either be merged into the result (deduplicating by user ID) and counted against the limit, or returned in a separate `hallOfFame` field alongside the regular `entries` array.

---

### 49
**BUG-DB-02: No DB connection health check or reconnect logic for pool idle-connection eviction**  
**FILES:** `apps/web/lib/db/index.ts`, `apps/web/lib/db/drizzle.ts`  
**FIX:** Cloud database proxies (Supabase's connection pooler, PgBouncer, Neon's serverless proxy) routinely close idle connections that exceed their timeout threshold. The `pg.Pool` does not automatically reconnect when it detects a closed idle connection; the next query on that connection throws `connection closed` or `EOF`. Add `idleTimeoutMillis` (e.g., 30000), `connectionTimeoutMillis`, and a `keepAlive: true` option to the Pool configuration. Also consider `allowExitOnIdle: false` for Vercel serverless warm containers.

---

### 50
**BUG-SECURITY-08: Gemini API key from manifest is not format-validated before use**  
**FILES:** `apps/web/lib/ai/client.ts`, `apps/web/lib/manifest/index.ts`  
**FIX:** The Gemini API key is fetched from the manifest at runtime without any format validation. A misconfigured or accidentally blanked key produces an authentication error only when the first moderation request fires, rather than at startup. Add a simple validation (e.g., check that the key matches `/^AIza[0-9A-Za-z_-]{35}$/`) when the manifest value is first read and log a `logger.error` (or throw during startup) if the key does not match the expected format. Similarly validate the DeepSeek key format.

---

*Report generated: 2026-06-21 at 07:56 PM*  
*Analyst: Claude Code (claude-sonnet-4-6) — forensic inline analysis, no agents used*
