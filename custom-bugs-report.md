# Zobia Social — Custom Bug & Security Audit Report

**Generated:** 2026-06-12 12:51 PM UTC
**Branch:** `claude/codebase-bug-security-audit-x7qexk`
**Scope:** Full forensic review of `apps/web` (Next.js 15 App Router, Postgres/`pg`, Redis, payments, economy, auth, realtime). 476 TS/TSX files reviewed with emphasis on auth, money flows, concurrency, scalability and the constraints in the brief (Vercel Hobby zero-cost, thousands of concurrent users, defense-in-depth).

> **NOTE:** No bugs have been fixed. This is analysis only, pending your review of the plan in `custom-bugs-fix-plan.md`.

---

## Summary — All Findings (one line each)

1. **ZB-01 (Critical/Scaling):** Long-lived SSE endpoint polls the DB every 2s for 60s per connection — unviable on Vercel serverless, exhausts function-hours and the DB pool.
2. **ZB-02 (Critical/Scaling):** `pg` pool `max: 10` per serverless instance multiplies into hundreds of DB connections under load → connection exhaustion.
3. **ZB-03 (High/Concurrency):** Rate limiter is not atomic (get-then-incr TOCTOU) and is a fixed window, not the sliding window it claims — limits leak under bursts.
4. **ZB-04 (High/Cost):** Rate limiter issues ~4 Redis commands per request → blows the Upstash free-tier command budget and adds latency at scale.
5. **ZB-05 (High/Security):** `getClientIp` trusts the spoofable left-most `X-Forwarded-For` value → IP rate-limit and IP-ban bypass.
6. **ZB-06 (High/Financial):** Coin/Star ledger reads the just-inserted row via `ORDER BY created_at DESC LIMIT 1`; `NOW()` is constant within a transaction so the wrong row is returned. Use `RETURNING`.
7. **ZB-07 (Medium/Financial):** `Decimal` values are written with `.toNumber()` into `BIGINT` columns, defeating Decimal precision and risking loss above 2^53.
8. **ZB-08 (Critical/Accounting):** Gifts to creators credit BOTH `coin_balance` AND `available_earnings_kobo` for the same gift → creators can double-cash the same value.
9. **ZB-09 (High/Integrity):** `.catch(() => {})` wrapped around queries *inside* a transaction poisons the aborted Postgres transaction and silently corrupts/rolls back the whole operation.
10. **ZB-10 (Critical/Re-entrancy):** Batch payout processor selects rows without `FOR UPDATE SKIP LOCKED` and isn't claim-atomic → overlapping cron runs can pay the same creator twice.
11. **ZB-11 (Medium/Resilience):** Payout retry backoff has no jitter → synchronized retry thundering herd.
12. **ZB-12 (Medium/Financial):** Payouts set to `processing` are never reconciled if the provider webhook never arrives → funds stuck indefinitely.
13. **ZB-13 (Critical/Auth):** `withAuth` validates only the Redis session, never re-checking `is_banned`/`is_suspended`/`deleted_at` in the DB → status changes don't take effect until token/session expiry.
14. **ZB-14 (Critical/Auth):** Login (Google/Telegram) does not check `is_banned`/`is_suspended` → a banned user simply logs in again and gets a fresh valid session.
15. **ZB-15 (High/Account recovery):** Account self-deletion nulls `email`, `google_id`, `telegram_id`, `password_hash` with no grace period → impossible to restore/reactivate after lost access.
16. **ZB-16 (High/Auth):** Account self-deletion does not invalidate sessions → a "deleted" user retains access and can keep refreshing tokens.
17. **ZB-17 (High/Payment integrity):** `coins/transfer` and `gifts/send` have no idempotency key and no rate limit → double-submit/double-click double-spends.
18. **ZB-18 (High/SSRF):** SSRF guard validates only the hostname string, never the resolved IP → DNS-rebinding / domain-to-internal-IP bypass.
19. **ZB-19 (High/XSS):** Announcement banners/modals and footer scripts render admin content via `dangerouslySetInnerHTML` with no sanitization and no CSP → stored XSS blast radius.
20. **ZB-20 (Medium/Hardening):** Missing `Content-Security-Policy`, `Strict-Transport-Security`, and `Permissions-Policy` headers.
21. **ZB-21 (High/Payment):** Payment webhooks return HTTP 200 even when processing throws → provider never retries → user paid but never credited.
22. **ZB-22 (Medium/Payment):** Webhook credits `metadata.coinsGranted` from the provider payload instead of re-deriving the grant from `packId` server-side.
23. **ZB-23 (Medium/Scaling):** Edge middleware performs a full HTTP `fetch` to `/api/auth/refresh` on every token-less request → latency + self-inflicted thundering herd.
24. **ZB-24 (Medium/Security):** Refresh tokens are never rotated and have no reuse detection — a stolen refresh token is valid for the full 30 days.
25. **ZB-25 (Low/Auth):** Token refresh always mints a 15-min (non-admin) access token and pulls `is_admin` from the possibly-stale Redis session, ignoring admin TTLs.
26. **ZB-26 (Medium/SEO):** `sitemap.ts` lists `(app)` routes that require auth and points `/profile/<username>` at a `[userId]` route → crawlers hit login redirects / 404s.
27. **ZB-27 (Medium/Scaling):** User-facing lists use `LIMIT/OFFSET` pagination → deep-page scans and row skips/dupes under churn; brief requires cursor-based.
28. **ZB-28 (Medium/Thundering herd):** Manifest cache has no single-flight; every 60s expiry stampedes the DB, and `getManifestValue` bypasses the cache entirely on hot paths.
29. **ZB-29 (Medium/Scaling):** `redis.keys(pattern)` is exposed and used — O(N) scan that blocks Redis / is throttled & costly on Upstash.
30. **ZB-30 (Low/Security):** `CRON_SECRET` is compared with `!==` (non-constant-time) — minor timing oracle.
31. **ZB-31 (Medium/Financial — verify):** DLQ restores `gross_kobo` to the creator; confirm this matches what was originally debited (net vs gross) or balances drift.
32. **ZB-32 (Medium/Data loss):** SSE cursor uses `created_at > $cursor` (strict) — messages sharing a millisecond timestamp are silently skipped.
33. **ZB-33 (Medium/Privacy):** The PWA service worker caches `GET /api/*` responses → stale or previously-authenticated API data served from cache.
34. **ZB-34 (Medium/Financial):** Referral commissions bypass the locked `creditCoins` path (dual ledger-write code paths, non-locked balance math) and have only shallow self/circular-referral protection.
35. **ZB-35 (Low/Robustness):** Transaction `ROLLBACK` inside the `catch` can throw and mask the original error.
36. **ZB-36 (Low/Dead code):** Middleware forwards `x-user-id`/`x-is-admin`/`x-session-id` request headers that no handler consumes (and does not strip inbound spoofed copies on public routes).
37. **ZB-37 (Low/i18n):** Verify the 8 locale bundles are complete and that RTL (Arabic) layout is actually applied app-wide, not just defined.

---

## Detailed Findings

### 1: ZB-01 — Long-lived SSE DB-polling stream is unviable on serverless
**FILES:** `app/api/rooms/[roomId]/stream/route.ts`, `app/api/sse/rooms/[roomId]/route.ts`
**FIX:** Each connection holds a function open 60s and runs `db.query` every 2s (≈30 queries/conn/min) plus a 15s ping. On Vercel Hobby this consumes the execution-time budget instantly and, with the `max:10` pool, a handful of concurrent viewers exhaust DB connections. Replace server-side polling with the existing realtime abstraction (Ably/Pusher/Supabase Realtime in `lib/realtime`) and push messages on write; if SSE must stay, drive it from Redis pub/sub (not DB polling) and cap concurrency. This is the single biggest scalability/cost risk.

### 2: ZB-02 — Postgres pool sized for a long-lived server, not serverless
**FILES:** `lib/db/providers/supabase.ts`, `lib/db/providers/railway.ts`, `lib/db/providers/digitalocean.ts`
**FIX:** `max: 10` per pool × N concurrent lambda instances = potentially hundreds/thousands of backend connections even through PgBouncer. Set `max: 1`–`2` for serverless, lower `idleTimeoutMillis`, and ensure the pooler (PgBouncer transaction mode, port 6543) is used. Document an env-driven pool size so non-serverless deployments can raise it.

### 3: ZB-03 — Rate limiter is racy and not actually a sliding window
**FILES:** `lib/security/rateLimit.ts`
**FIX:** `slidingWindowCheck` does `GET count` then `INCR` non-atomically; concurrent requests all read a sub-limit count and pass (TOCTOU). It is also a fixed window keyed on first-write TTL, allowing ~2× the limit across a boundary. Replace with a single atomic Lua script (or `INCR` first then compare, using the returned value) and a true sliding-window or sorted-set implementation. Critical for "thousands of concurrent users".

### 4: ZB-04 — Rate limiting cost explosion on Upstash free tier
**FILES:** `lib/security/rateLimit.ts`, `lib/redis/index.ts`
**FIX:** Each check runs `get` + `incr` + `expire` + `ttl` = ~4 HTTP commands per request on Upstash. At thousands of req/min this blows the free command quota and adds per-command latency. Collapse to one Lua/`eval` round-trip and only compute `ttl` on the deny path.

### 5: ZB-05 — Spoofable client IP enables rate-limit & ban evasion
**FILES:** `lib/security/rateLimit.ts` (`getClientIp`), all IP-keyed limiters
**FIX:** `forwarded.split(",")[0]` is fully attacker-controlled (a client can send its own `X-Forwarded-For`). On Vercel, use the platform-trusted header (`x-vercel-forwarded-for` / `request.ip`) or take the right-most trusted hop. Otherwise IP rate limits, IP bans, and geo-anomaly detection are trivially bypassed.

### 6: ZB-06 — Ledger returns the wrong inserted row (transaction-time collision)
**FILES:** `lib/economy/coins.ts`, `lib/economy/stars.ts`
**FIX:** After `INSERT`, the code re-selects with `ORDER BY created_at DESC LIMIT 1`. Postgres `NOW()`/`created_at DEFAULT now()` returns the **transaction start time**, identical for every row written in the same transaction (e.g. `transferCoins` writes a debit then a credit). The follow-up SELECT can return the *other* user's row, so the API reports wrong `balance_after`. Replace the INSERT + SELECT with `INSERT ... RETURNING *`.

### 7: ZB-07 — `Decimal.toNumber()` written to BIGINT defeats Decimal.js
**FILES:** `lib/economy/coins.ts`, `lib/economy/stars.ts`
**FIX:** `amount.toNumber()` / `balanceAfter.toNumber()` converts to float64 before the DB write; `coin_balance`/`available_earnings_kobo` are `BIGINT`, so values above `Number.MAX_SAFE_INTEGER` silently lose precision and the whole point of Decimal is lost. Pass `.toFixed(0)` strings to `pg` (which accepts strings for integer/numeric columns).

### 8: ZB-08 — Creators double-credited for the same gift
**FILES:** `app/api/economy/gifts/send/route.ts`
**FIX:** For creator recipients the handler both `creditCoins(recipientCoins)` (spendable wallet balance) **and** `available_earnings_kobo += recipientCoins` (withdrawable cash). The same gift value is granted twice — once as coins, once as cash. Decide one model (coins-only wallet, or earnings-only) and remove the duplicate credit, or split clearly so value is conserved. This is a direct revenue-leak / accounting-integrity defect.

### 9: ZB-09 — `.catch(()=>{})` inside transactions poisons the transaction
**FILES:** `app/api/economy/gifts/send/route.ts`, `app/api/economy/webhooks/paystack/route.ts` (referral call), and other `tx.query(...).catch(...)` sites
**FIX:** Once any statement errors inside a Postgres transaction, the transaction is aborted and every subsequent statement fails with "current transaction is aborted". Swallowing that error with `.catch(()=>{})` hides the failure while the rest of the transaction silently rolls back (or throws later). Remove in-transaction `.catch` swallowing; let errors propagate to the transaction wrapper, or move best-effort writes outside the transaction.

### 10: ZB-10 — Batch payouts can double-pay (no row claim / locking)
**FILES:** `lib/payments/payouts.ts`, `app/api/cron/payouts/route.ts`
**FIX:** `processPendingPayouts` selects `status='pending'` rows with no `FOR UPDATE SKIP LOCKED` and only marks `processing` *after* calling Paystack. Two overlapping cron invocations (cron-jobs.org retries, manual + scheduled) select the same row and both initiate a transfer. Claim rows atomically first: `UPDATE ... SET status='processing' WHERE id IN (SELECT id ... FOR UPDATE SKIP LOCKED) RETURNING ...`, then call the provider. Treat the idempotency reference as authoritative on the provider side too.

### 11: ZB-11 — Retry backoff lacks jitter
**FILES:** `lib/payments/payouts.ts` (`RETRY_DELAYS_MINUTES`), `lib/redis/index.ts` (ioredis `retryStrategy`)
**FIX:** Fixed `[5,15,45]` minute delays cause many failed payouts to retry at the same instant (thundering herd against Paystack and the DB). Add randomized jitter (e.g. ±20%) to each computed `next_retry_at`.

### 12: ZB-12 — No reconciliation for stuck `processing` payouts
**FILES:** `lib/payments/payouts.ts`
**FIX:** On success the payout is set to `processing` awaiting the transfer webhook. If that webhook is lost, the payout never completes and never retries. Add a reconciliation pass that re-queries Paystack transfer status for `processing` rows older than N minutes and resolves them.

### 13: ZB-13 — Session validity not tied to account status
**FILES:** `lib/api/middleware.ts` (`withAuth`), `lib/auth/session.ts`
**FIX:** `withAuth` checks only that the Redis session exists; it never re-checks `is_banned`/`is_suspended`/`deleted_at`. Bans/suspensions only take effect if `invalidateAllSessions` is explicitly called, and self-deletion never calls it (see ZB-16). Add a lightweight DB status check (cached briefly) in `withAuth`, or store a status/version stamp in the session and compare. The admin HOC already hits the DB for `is_admin`; mirror that for account status.

### 14: ZB-14 — Banned users can re-login
**FILES:** `app/api/auth/google/callback/route.ts`, `app/api/auth/telegram/callback/route.ts`, `lib/auth/session.ts`
**FIX:** The OAuth upsert/select never reads `is_banned`/`is_suspended`, and `createSession` is issued unconditionally. A banned user just re-authenticates and is handed a fresh valid session. Block session creation (and surface a clear message) when the resolved user is banned or actively suspended.

### 15: ZB-15 — No account restore/reactivation path
**FILES:** `app/api/users/me/route.ts` (`DELETE`)
**FIX:** Deletion immediately nulls `email`, `google_id`, `telegram_id`, `password_hash`, `pin_hash` and hard-deletes bank/wallet PII, so the user has no identifier to log back in with — directly contradicting the brief's "robust account restore/reactivation after lost access". Introduce a soft-delete grace window: set `deleted_at`/`pending_deletion_at`, keep identifiers (or a hashed recovery handle) for e.g. 30 days, allow reactivation on next login, then purge PII via a scheduled job.

### 16: ZB-16 — Self-deletion doesn't revoke sessions
**FILES:** `app/api/users/me/route.ts` (`DELETE`)
**FIX:** The DELETE handler never calls `invalidateAllSessions(userId)`, so existing access tokens keep working for up to 15 min and the refresh token (backed by the still-present Redis session) keeps minting new access tokens. Call `invalidateAllSessions` inside the deletion flow.

### 17: ZB-17 — Coin transfer / gift send not idempotent and unthrottled
**FILES:** `app/api/economy/coins/transfer/route.ts`, `app/api/economy/gifts/send/route.ts`
**FIX:** Neither accepts an idempotency key nor is wrapped in `withRateLimit`. A double-click or retry double-debits/double-gifts. Require a client-supplied idempotency key persisted with a unique constraint (short-circuit duplicates), and apply per-user rate limits.

### 18: ZB-18 — SSRF guard is hostname-string only (DNS rebinding)
**FILES:** `lib/security/ssrf.ts`
**FIX:** `validateOutboundUrl`/`safeFetch` only checks whether the literal hostname is a private IP. A domain that resolves to `127.0.0.1`/`169.254.169.254` passes, and `fetch` resolves DNS independently (TOCTOU/rebinding). Resolve the hostname and validate every resolved address against the private ranges before connecting (or pin the connection to the validated IP), and re-validate on each redirect hop.

### 19: ZB-19 — Stored XSS via unsanitized admin HTML
**FILES:** `components/announcements/AnnouncementBanner.tsx`, `components/announcements/AnnouncementModal.tsx`, `app/(admin)/admin/announcements/page.tsx`, `app/layout.tsx` (footer scripts), `app/api/admin/announcements/*`, `app/api/admin/footer-scripts/*`
**FIX:** Content is injected with `dangerouslySetInnerHTML` and only "expected to be pre-sanitized" — nothing sanitizes it on write or render. A compromised/abused admin or moderator account yields persistent XSS against every user. Sanitize on the server at write time (allow-list HTML, e.g. DOMPurify/sanitize-html) and add a CSP (ZB-20) to contain footer-script injection.

### 20: ZB-20 — Missing hardening headers
**FILES:** `vercel.json`, `next.config.js`
**FIX:** Only `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy` are set. Add `Content-Security-Policy` (script-src allow-list — important given ZB-19), `Strict-Transport-Security` (HSTS preload), and `Permissions-Policy`.

### 21: ZB-21 — Webhooks swallow processing errors and ack 200
**FILES:** `app/api/economy/webhooks/paystack/route.ts`, `app/api/economy/webhooks/dodopayments/route.ts`, `app/api/webhooks/paystack/route.ts`, `app/api/webhooks/dodopayments/route.ts`
**FIX:** After signature validation, processing errors are caught and the handler returns `{ received: true }` 200, so Paystack never retries and the user's coins/stars are lost despite payment. Because the flow is idempotent (guarded by `payments.status`), return a 5xx on transient/processing failure so the provider retries; only 200 on success or a confirmed duplicate.

### 22: ZB-22 — Webhook trusts client-influenced grant amounts
**FILES:** `app/api/economy/webhooks/paystack/route.ts`, `app/api/economy/coins/purchase/route.ts`
**FIX:** The credit uses `metadata.coinsGranted`/`starsGranted` echoed by the provider rather than re-reading `coins_granted` from `store_items` by `packId` at credit time. Re-derive the grant server-side from the persisted `payments`/`store_items` row keyed by `provider_reference`, so a tampered initiation can never inflate the grant. Also validate `amount` matches the pack's `price_kobo`.

### 23: ZB-23 — Edge middleware does an HTTP refresh round-trip per request
**FILES:** `middleware.ts` (`tryRefreshToken`)
**FIX:** On any request lacking/with an expired access token, the middleware `fetch`es `/api/auth/refresh` and scrapes `Set-Cookie`. This adds a full extra request (and DB/Redis work) at the edge for every such hit and amplifies load during token-expiry waves. Refresh inside the route layer/client instead, or verify+reissue using shared crypto without a self-HTTP call.

### 24: ZB-24 — No refresh-token rotation or reuse detection
**FILES:** `lib/auth/session.ts` (`refreshAccessToken`), `app/api/auth/refresh/route.ts`
**FIX:** The same refresh token is reused for 30 days; a leaked refresh token is fully usable until expiry with no detection. Rotate the refresh token on every use, bind it to the session, and revoke the whole session chain if an already-used token is presented (reuse detection).

### 25: ZB-25 — Refresh ignores admin TTL and uses stale session claims
**FILES:** `lib/auth/session.ts` (`refreshAccessToken`)
**FIX:** `refreshAccessToken` calls `signAccessToken` with the default 15-min TTL and copies `is_admin` from the Redis session, so admin sessions silently get non-admin TTLs and stale privilege claims. Carry an `adminSession` flag in the session record and re-issue with the correct TTL; (admin APIs still re-check the DB, so this is low severity but inconsistent).

### 26: ZB-26 — Sitemap advertises auth-gated and mismatched URLs
**FILES:** `app/sitemap.ts`, `app/(app)/profile/[userId]/page.tsx`, `app/(app)/rooms/[roomId]/page.tsx`
**FIX:** Profiles/rooms live under the `(app)` group, which middleware default-denies to unauthenticated users, so crawlers get redirected to `/auth/login` — the "public" SEO surface isn't indexable. The sitemap also emits `/profile/<username>` while the route param is `[userId]`. Provide genuinely public, server-rendered profile/room pages (or an SSR public variant) and make the sitemap URLs match the real route params. Cache the sitemap output.

### 27: ZB-27 — Offset pagination across list endpoints
**FILES:** `app/api/economy/gifts/route.ts`, `app/api/guilds/route.ts`, `app/api/seasons/[seasonId]/leaderboard/route.ts`, `app/api/inbox/route.ts`, and other `LIMIT/OFFSET` endpoints (admin lists included)
**FIX:** `OFFSET` scans and discards rows (slow deep pages) and can skip/duplicate rows when the underlying set shifts between pages. Move user-facing/high-volume feeds to keyset/cursor pagination (`WHERE (created_at,id) < ($cursor) ORDER BY created_at DESC, id DESC LIMIT n`), keeping offset only for bounded admin tables.

### 28: ZB-28 — Manifest cache stampede + uncached hot-path reads
**FILES:** `lib/manifest/index.ts`
**FIX:** On the 60s cache expiry, concurrent requests all miss and run the full `SELECT * FROM x_manifest` simultaneously (no single-flight/lock). Separately, `getManifestValue` always hits the DB and is called on hot paths (captcha, referral commissions). Add a single-flight/lock-and-refresh (or stale-while-revalidate) for `loadManifest`, and have `getManifestValue` read from the cached manifest map.

### 29: ZB-29 — `redis.keys()` pattern scans
**FILES:** `lib/redis/index.ts` (exposes `keys`), any caller using glob scans (e.g. presence/leaderboard cleanups)
**FIX:** `KEYS pattern` is O(N) and blocks Redis; Upstash rate-limits/charges it. Remove `keys` from the hot path — maintain explicit index sets (`SADD`) and iterate those, or use `SCAN` with cursors for maintenance only.

### 30: ZB-30 — Non-constant-time CRON secret comparison
**FILES:** `app/api/cron/payouts/route.ts`, other `cron/*` and webhook secret checks
**FIX:** `token !== env.CRON_SECRET` is a timing-variable compare. Use `crypto.timingSafeEqual` on equal-length buffers for all shared-secret checks.

### 31: ZB-31 — DLQ earnings restoration may not match what was debited
**FILES:** `lib/payments/payouts.ts` (`moveToDeadLetterQueue`), creator payout creation route (`app/api/creator/payouts/route.ts`)
**FIX:** DLQ restores `gross_kobo` to `available_earnings_kobo`. Verify the payout creation debited exactly `gross_kobo` (not net, and not gross+fee). If they differ, every dead-lettered payout drifts the creator's balance. Add a test asserting debit-at-creation == restore-on-DLQ.

### 32: ZB-32 — SSE/feed cursor can skip same-timestamp messages
**FILES:** `app/api/rooms/[roomId]/stream/route.ts`
**FIX:** `m.created_at > $cursor` (strict) drops any message whose `created_at` equals the cursor — common when several messages land in the same millisecond. Use a composite `(created_at, id)` cursor with tuple comparison so ties are ordered deterministically and never skipped.

### 33: ZB-33 — Service worker caches authenticated API responses
**FILES:** `next.config.js` (`runtimeCaching` `api-cache` NetworkFirst on `/api/*`)
**FIX:** Caching `GET /api/*` in the SW can serve stale or previously-authenticated JSON (e.g. balances, profile) — a privacy/correctness risk, especially after logout. Exclude authenticated/personalized endpoints from SW caching (NetworkOnly for `/api/*` except explicitly public, cacheable resources).

### 34: ZB-34 — Referral commissions use a parallel, unlocked ledger path
**FILES:** `lib/referrals/commissions.ts`
**FIX:** Commissions credit coins via raw `UPDATE coin_balance = coin_balance + $1 RETURNING` and a hand-built `coin_ledger` insert instead of the locked `creditCoins` helper, creating a second write path with non-`FOR UPDATE` balance math (interleaving can produce non-monotonic `balance_before/after`). Self/circular-referral protection is only the shallow `tier2Id === buyerId` check. Route all credits through `creditCoins`, and validate the referral graph (no self, no cycles, qualification rules) to resist referral fraud.

### 35: ZB-35 — Rollback can mask the original error
**FILES:** `lib/db/providers/supabase.ts`, `railway.ts`, `digitalocean.ts`
**FIX:** In the transaction wrapper, if `client.query("ROLLBACK")` throws (dead connection), the original error is lost. Wrap the ROLLBACK in its own try/catch and always re-throw the original error.

### 36: ZB-36 — Forwarded identity headers are unused / not stripped
**FILES:** `middleware.ts`
**FIX:** The middleware sets `x-user-id`/`x-is-admin`/`x-session-id` for downstream handlers, but no handler reads them (handlers re-verify the JWT). On public routes the inbound (client-supplied) copies aren't overwritten. Remove the dead header forwarding, or if kept, explicitly strip inbound `x-user-id`/`x-is-admin` on every path so a future handler can't be tricked into trusting a spoofed header.

### 37: ZB-37 — Verify i18n completeness and RTL application
**FILES:** `lib/i18n/index.ts`, `lib/i18n/locales/*.json`, `lib/i18n/rtl.ts`
**FIX:** Eight locales exist (am, ar, fr, ha, pt, sw, zu, en). Confirm key parity across bundles (missing keys should fall back, not render raw keys) and that `dir="rtl"` from `rtl.ts` is actually applied at the layout/`<html>` level for Arabic, not merely defined.

---

## Rating & Review

**Current state — 6.0 / 10.** The architecture is genuinely strong: clean provider abstractions (db/redis/realtime/storage), centralized env validation, an append-only ledger with `SELECT FOR UPDATE`, Decimal.js, HMAC-verified webhooks with idempotency guards, DB-backed `is_admin` checks, AES-256-GCM field encryption, and CSRF/SSRF/captcha scaffolding. But several **correctness and money-safety defects** undercut it: creator gift double-crediting (ZB-08), the transaction-time ledger read returning the wrong row (ZB-06), `.catch` inside transactions (ZB-09), non-atomic payouts that can double-pay (ZB-10), and weak ban/deletion enforcement (ZB-13/14/15/16). Layered on top are **serverless-fit problems** that conflict with the zero-cost Vercel Hobby + "thousands of concurrent users" goal: DB-polling SSE (ZB-01), oversized pools (ZB-02), and an expensive, racy rate limiter (ZB-03/04).

**Projected after fixes — 8.5–9.0 / 10.** None of the issues are architectural dead-ends; they are concentrated, fixable defects. Closing the financial-integrity and re-entrancy items (ZB-06/08/09/10/17/34), tying sessions to account status with a real restore path (ZB-13–16), and re-platforming realtime/rate-limiting/pooling for serverless (ZB-01/02/03/04) would yield a secure, scalable, cost-appropriate system. Prioritize money and auth correctness first, then serverless scaling, then SEO/i18n/hardening polish.

---

*Report generated 2026-06-12 12:51 PM UTC — Zobia Social forensic audit. No code was modified; awaiting plan approval.*
