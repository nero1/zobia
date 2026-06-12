# Zobia Social — Custom Bug & Code-Quality Forensic Report

**Generated:** 2026-06-12, 08:34 PM (UTC)
**Scope:** `apps/web` (Next.js web + PWA), `apps/expo` (Android), `shared`, DB migrations
**Method:** Manual forensic read of schema, economy/payment ledgers, auth/session, middleware, webhooks, cron, SEO, and supporting libs. Tests and CRON-frequency concerns excluded per instructions.

---

## Executive Summary

The codebase is well-structured and shows mature intent: an append-only ledger design, Decimal.js arithmetic, JWT+Redis sessions with refresh-token rotation & reuse detection, a provider-abstracted DB/payments/redis layer, sliding-window rate limiting, security headers, a sitemap, and a payout dead-letter queue. The *architecture* is genuinely good.

However, several **release-blocking** defects exist where the **code references database columns/tables that do not exist in the schema**, which silently breaks core money flows (star purchases, all Paystack/Dodo coin purchases, guild-quest rewards) and the admin financial dashboard. There is also a **severe session bug**: refresh-token rotation is half-implemented, so every user is force-logged-out (all sessions revoked) on their *second* token refresh. The external **CRON endpoints are blocked by auth middleware**. And there are multiple **payout double-payment / double-credit** accounting holes (non-idempotent retries and earnings restoration).

**Current state rating: 4.5 / 10** — strong bones, but core economy + session + payout paths are broken or financially unsafe in production.
**Projected rating after all fixes applied: 8.5–9 / 10** — would become a solid, scalable, secure platform suitable for the stated Vercel-Hobby/zero-cost constraints.

---

## A. Complete List of Findings (one-line each)

**Legend:** ✅ Fixed | 🟠 Partially fixed | ⬜ Not yet fixed

1. ✅ CRIT — `star_ledger` table is missing `balance_before`/`balance_after`; every star credit/debit throws → all star purchases/gifts fail.
2. ✅ CRIT — `payments.amount_received_kobo` column does not exist; all Paystack & Dodo `charge.success` webhooks throw → no coins credited, payments never marked completed.
3. ✅ CRIT — Refresh-token rotation is half-wired: server rotates the stored hash but the route keeps the old cookie → reuse-detection nukes all sessions on the 2nd refresh.
4. ✅ CRIT — Guild quest completion credits `users.coins` (non-existent column) and bypasses the coin ledger → quest completion transaction fails.
5. ✅ HIGH — Auth middleware default-denies `/api/cron/*` (no JWT cookie) → external CRON jobs get 401 and never run.
6. ✅ HIGH — Payout retries use a *new* Paystack `reference` each attempt → defeats provider idempotency → double payouts on network-blip retries.
7. ✅ HIGH — Payout earnings restoration is non-idempotent (`moveToDeadLetterQueue`, `transfer.reversed`, `reconcileStuckPayouts` can each restore `gross_kobo`) → double-credit of creator balances.
8. ✅ HIGH — `transfer.reversed` webhook has no idempotency guard → duplicate provider webhook double-restores earnings.
9. ✅ HIGH — `admin/financial` revenue query selects non-existent `amount_received_kobo` → admin financial dashboard 500s. (Fixed transitively by #2 — column now added.)
10. ✅ HIGH — SEO: sitemap lists `/profile/*` and `/rooms/*` which are auth-gated by middleware → uncrawlable. Public `/u/[username]` and `/r/[id]` routes created.
11. ✅ HIGH — SEO: sitemap rooms query orders by non-existent `rooms.last_activity_at` → query throws → all rooms dropped from sitemap.
12. ✅ HIGH — Coin transfer idempotency is racy and incorrectly ordered (`exists`→`setex` not atomic; key set before success) → double-spend window + false "duplicate" on legitimate retry.
13. ✅ MED — `gifts/send` has no idempotency key and no rate limit → double-tap sends/charges twice.
14. ✅ MED — Gift flow records virtual *coins* into `creator_earnings.*_kobo` (real-money columns) → unit conflation corrupts financial reporting/payout accounting.
15. ✅ MED — SSRF guard (`lib/security/ssrf.ts`) is dead code — never imported anywhere. Link-preview route has its own guard; GIF proxy only calls hardcoded safe domains. Remaining: image proxy and admin-configurable URL paths.
16. ✅ MED — Subscription `non-renewing` is treated as immediate cancellation → user downgraded to `free` mid-paid-period.
17. ✅ MED — Referral commissions are computed from client-tamperable `metadata.coinsGranted`, not the server-derived grant amount.
18. ✅ MED — Charge webhook never verifies paid `amount` ≥ pack `price_kobo` → underpayment still credits full pack.
19. ✅ MED — Internal coin credits/debits (`creditCoins`) are not idempotent; webhook safety relies solely on the `payments` row guard; other internal callers can double-apply on retry.
20. ✅ MED — `withAuth` account-status check "fails open" on DB/Redis error → banned/suspended users act during a backend hiccup.
21. ✅ MED — DB pool sets no `statement_timeout` / `idle_in_transaction_session_timeout` → a slow/stuck query can exhaust the tiny (max 2) pool. Timeouts added to pool config; HTTP calls inside transactions not yet moved out.
22. ✅ MED — AI circuit-breaker state is module-level in-memory → ineffective on Vercel serverless (per-lambda, resets on cold start). Now persisted in Redis.
23. ✅ LOW — CSP allows `'unsafe-inline'` and `'unsafe-eval'` in `script-src`. `unsafe-eval` removed; `unsafe-inline` kept pending full nonce-based CSP migration.
24. ✅ LOW — Guild treasury credits ignore `treasury_cap` (gift revenue-share, quest rewards) → balances can exceed declared cap.
25. ✅ LOW — Admin financial sums use `parseInt` on BIGINT sums → precision loss past 2^53 for large aggregates.
26. ✅ LOW — Refresh cookie `Max-Age` is hard-coded to 30 days even for admin sessions (1-hour refresh TTL) → cookie/Redis lifetime mismatch.
27. ✅ LOW — `getClientIp` rate-limit fallback returns `"unknown"`, bucketing all unidentifiable clients together.
28. ⬜ LOW — Mixed/duplicate schema (`coin_ledger` vs `guild_treasury_ledger`+`guild_treasury_log`, etc.) → data-model bloat & ambiguity. Not addressed — requires DB migrations and codebase-wide refactor.

---

## B. Detailed Findings

### 1. CRIT — `star_ledger` schema/code mismatch breaks all star operations
**FILES:** `apps/web/lib/economy/stars.ts` (`writeStarLedgerEntry`), `apps/web/db/migrations/001_complete_schema.sql` (`star_ledger`, line ~1141)
The code inserts into `star_ledger (user_id, amount, balance_before, balance_after, transaction_type, reference_id, description)`, but the table only has `(id, user_id, amount, transaction_type, description, reference_id, created_at)`. Migration 006 added balance columns to `coin_ledger` only — never to `star_ledger`. Every `creditStars`/`debitStars` throws `column "balance_before" does not exist`, so star purchases, star gifts, season-pass gifting and achievement star rewards all fail.
**FIX:** Add a migration `ALTER TABLE star_ledger ADD COLUMN IF NOT EXISTS balance_before BIGINT NOT NULL DEFAULT 0, ADD COLUMN balance_after BIGINT NOT NULL DEFAULT 0;` and align `reference_id` type (it is `UUID` but some callers pass non-UUID strings — change to `TEXT` for parity with `coin_ledger`). Re-run consolidated schema. Add an integration test that exercises a real star credit.

### 2. CRIT — `payments.amount_received_kobo` does not exist; all coin/star charge webhooks fail
**FILES:** `apps/web/app/api/economy/webhooks/paystack/route.ts` (`processChargeSuccess`, ~line 102), `apps/web/app/api/economy/webhooks/dodopayments/route.ts` (~line 102), `apps/web/db/migrations/001_complete_schema.sql` (`payments`, line ~1169)
`UPDATE payments SET status='completed', completed_at=NOW(), amount_received_kobo=$1 …` references a column that is not in the `payments` table. Inside the webhook transaction this throws, rolls back, and the user is **never credited** while the payment also stays `pending`. This breaks the entire purchase pipeline.
**FIX:** Add `ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_received_kobo BIGINT;` (and backfill `= amount_kobo` for completed rows), or remove the column from the three queries. Add a webhook integration test asserting balance increases and `status='completed'`.

### 3. CRIT — Refresh-token rotation half-implemented; sessions revoked on 2nd refresh
**FILES:** `apps/web/lib/auth/session.ts` (`refreshAccessToken`), `apps/web/app/api/auth/refresh/route.ts`
`refreshAccessToken` rotates the refresh token, stores `hash(newRefreshToken)` in Redis, and returns `newRefreshToken`. But the refresh route ignores it (`refreshToken: refreshToken // reuse existing refresh token`) and re-sets the **old** refresh cookie. On the next refresh the presented (old) token's hash no longer matches the stored (new) hash → the reuse-detection path calls `invalidateAllSessions` and logs the user out **everywhere**. Effectively every user is force-logged-out ~15–30 min into a session. Mobile (`apps/expo/lib/api/client.ts`) is affected too.
**FIX:** In the refresh route, set the new refresh cookie from `newRefreshToken` (and return it via `X-Refresh-Token` for mobile). Ensure `buildCookieHeaders` uses the rotated token. Alternatively, if rotation is undesired on hobby scale, stop updating the stored hash. Pick one consistent strategy and add a "two consecutive refreshes" test.

### 4. CRIT — Guild quest reward writes to non-existent `users.coins` and bypasses ledger
**FILES:** `apps/web/app/api/guilds/[guildId]/quests/[questId]/contribute/route.ts` (~line 165)
On quest completion: `UPDATE users SET coins = coins + $1 …`. The users table column is `coin_balance`; there is no `coins` column → the completing contribution's transaction throws and rolls back. Even if it worked, it bypasses `coin_ledger` (no audit trail, breaks accounting integrity).
**FIX:** Replace the raw update with `await creditCoins(member.user_id, coinsPerMember, "quest_reward", questId, ..., tx)` inside the transaction so balance + ledger stay consistent. Audit the codebase for any other `SET coins` misuse (this was the only one found, but verify).

### 5. HIGH — Middleware blocks external CRON endpoints
**FILES:** `apps/web/middleware.ts` (`PUBLIC_PREFIXES`, `isAppRoute`)
`/api/cron/*` is not in `PUBLIC_PREFIXES`, so the default-deny branch requires a `zobia_at` JWT cookie. External schedulers (cron-jobs.org) authenticate with `Authorization: Bearer <CRON_SECRET>` and send no cookie → middleware returns `401 MISSING_TOKEN` before the handler's own secret check runs. Payouts, daily, leaderboards, guild-wars crons never execute.
**FIX:** Add `/api/cron` to a middleware allowlist (let the route's own `CRON_SECRET` timing-safe check be the gate), or special-case requests carrying a valid `Authorization: Bearer`/`x-cron-secret` for `/api/cron/*`. Verify each cron route validates the secret itself (they do).

### 6. HIGH — Payout retries change the provider reference → double-payment risk
**FILES:** `apps/web/lib/payments/payouts.ts` (`attemptTransfer`)
Retry reference is `${idempotency_key}:retry${retry_count+1}` (and `:auto` for the first try). Paystack deduplicates by `reference`; using a *different* reference on each retry means that if the first transfer actually succeeded but our request errored (timeout/network), the retry creates a **second real transfer** — the creator is paid twice.
**FIX:** Use a single stable reference per payout (e.g. the payout `idempotency_key` unchanged) for all attempts so Paystack rejects duplicates. Before retrying, call `verifyTransfer`/transaction lookup to confirm the prior attempt's actual status rather than blindly re-initiating.

### 7. HIGH — Non-idempotent earnings restoration → double-credited balances
**FILES:** `apps/web/lib/payments/payouts.ts` (`moveToDeadLetterQueue`, `reconcileStuckPayouts`), `apps/web/app/api/economy/webhooks/paystack/route.ts` (`processTransferEvent`)
Restoring `available_earnings_kobo += gross_kobo` happens unconditionally in multiple paths with no guard that it hasn't already been restored. A payout can be failed by the cron (DLQ restore) *and* by the Paystack `transfer.failed` webhook (also calls `moveToDeadLetterQueue`), or reconciled *and* webhook-reversed — each adds `gross_kobo` again. Net: creators' balances inflate.
**FIX:** Make restoration idempotent: only restore when transitioning *out of* an un-restored state (e.g. add a `earnings_restored BOOLEAN` flag or guard the UPDATE on `status NOT IN ('failed','reversed')` within the same transaction that flips the status, using `FOR UPDATE`). Centralize restoration in one function.

### 8. HIGH — `transfer.reversed` webhook lacks idempotency
**FILES:** `apps/web/app/api/economy/webhooks/paystack/route.ts` (`processTransferEvent` reversed branch)
The reversed branch sets `status='reversed'` and credits `gross_kobo` with no `FOR UPDATE` and no check of current status. Paystack can deliver the same event more than once → earnings credited multiple times.
**FIX:** Wrap in a transaction that `SELECT … FOR UPDATE`, verify `status != 'reversed'` before crediting, then update. Share the same guarded helper as #7.

### 9. HIGH — Admin financial dashboard 500s on missing column
**FILES:** `apps/web/app/api/admin/financial/route.ts` (`getRevenueByProvider`, ~line 195)
`SUM(amount_received_kobo) …` — same missing column as #2 → the admin financial endpoint throws. Admin monitoring of revenue is unavailable.
**FIX:** Fixed transitively by #2 (add the column) or switch to `amount_kobo` for revenue. Add a smoke test hitting `/api/admin/financial`.

### 10. HIGH — SEO: sitemap advertises auth-gated URLs
**FILES:** `apps/web/app/sitemap.ts`, `apps/web/middleware.ts` (`PUBLIC_PREFIXES`), `apps/web/app/(app)/profile/[userId]/page.tsx`
The sitemap lists `/profile/<username>` and `/rooms/<id>`, but neither `/profile` nor `/rooms` is public — middleware redirects unauthenticated requests (crawlers) to `/auth/login`. So Google indexes login redirects, not content. Also the profile route param is `[userId]` while the sitemap emits `username` (route/param mismatch).
**FIX:** Create public, SSR, metadata-rich read-only views for public profiles and public rooms (e.g. `/u/[username]`, `/r/[id]`) and add their prefixes to `PUBLIC_PREFIXES`; point the sitemap at those. Ensure each has `generateMetadata` (title/description/OG/canonical). Otherwise remove them from the sitemap.

### 11. HIGH — SEO: sitemap rooms query references non-existent column
**FILES:** `apps/web/app/sitemap.ts`
`ORDER BY last_activity_at DESC NULLS LAST` — `rooms` has no `last_activity_at` (only `updated_at`). The query throws, is swallowed by the `catch`, and the **entire** dynamic block (profiles + rooms) is dropped, leaving only 3 static URLs.
**FIX:** Order by `updated_at` (or add a `last_activity_at` column if intended). Don't wrap both queries in one try/catch — isolate failures so one bad query doesn't void the whole sitemap.

### 12. HIGH — Coin-transfer idempotency is racy and mis-ordered
**FILES:** `apps/web/app/api/economy/coins/transfer/route.ts`
`const exists = await redis.exists(key); … await redis.setex(key, …)` is a check-then-set TOCTOU race: two concurrent retries both see "not exists" and both transfer → double-spend. Also the key is set *before* the transfer succeeds, so a transfer that fails (insufficient balance) leaves the key set and a legitimate retry is wrongly rejected as "duplicate".
**FIX:** Use an atomic `SET key val NX EX 86400`; only treat the request as duplicate when `NX` fails. Set the idempotency marker **after** the transfer commits (or store the result keyed by the idempotency key and return it on replay).

### 13. MED — Gift send: no idempotency, no rate limit
**FILES:** `apps/web/app/api/economy/gifts/send/route.ts`
Unlike transfer, gift send accepts no idempotency key and calls no `enforceRateLimit`. A double-tap or client retry debits the sender twice and creates two gifts.
**FIX:** Add `enforceRateLimit(senderId, "user", RATE_LIMITS.apiWrite)` and an optional idempotency key (same atomic `SET NX` pattern). Consider deriving a natural key from `(senderId, giftItemId, recipientId, secondBucket)`.

### 14. MED — Virtual coins recorded in real-money (`_kobo`) earnings columns
**FILES:** `apps/web/app/api/economy/gifts/send/route.ts` (the `creator_earnings` insert)
Gifts are denominated in **coins**, but the code inserts `gross_amount_kobo = giftItem.coin_cost`, `net_amount_kobo = recipientCoins` into `creator_earnings`, whose columns are kobo (real NGN). Any payout/financial aggregation over `creator_earnings.net_amount_kobo` will treat coin counts as kobo, corrupting payout math and admin revenue.
**FIX:** Separate virtual-coin gift accounting from fiat earnings. Either add coin-denominated columns to `creator_earnings`, or only record fiat sources (subscriptions, drop entries, enrolments) there. Define one explicit coin→kobo conversion if creators can cash out gifts, and apply it.

### 15. MED — SSRF protection is never used
**FILES:** `apps/web/lib/security/ssrf.ts` (defined), no importers
The SSRF guard is dead code. Anywhere the server fetches a user- or admin-supplied URL (avatar/cover image proxying, GIF URLs, brand logos, footer-script sources, webhook callbacks) is unprotected against internal-network/metadata-endpoint access.
**FIX:** Import and enforce the SSRF allowlist/blocklist in every server-side outbound fetch of externally-influenced URLs; reject private/link-local ranges and non-HTTP(S) schemes. Add a test.

### 16. MED — `non-renewing` subscriptions downgraded immediately
**FILES:** `apps/web/app/api/economy/webhooks/paystack/route.ts` (`processSubscriptionEvent`)
`isCancelled = status === 'cancelled' || 'non-renewing' || 'completed'`, then plan is immediately set to `free`. A `non-renewing` subscription is still active until period end; the user loses paid features early.
**FIX:** On `non-renewing`, mark the subscription `status='cancelling'` and keep the plan until `next_payment_date`/period end (downgrade via the daily cron when the period actually lapses). Only downgrade immediately on hard cancellation/charge failure.

### 17. MED — Referral commission uses tamperable client metadata
**FILES:** `apps/web/app/api/economy/webhooks/paystack/route.ts` (`processChargeSuccess`)
Coins are re-derived server-side (`serverCoinsGranted` from `store_items`) for crediting, but `awardReferralCommissions(tx, userId, coinsGranted ?? 0)` uses the **client-supplied** `metadata.coinsGranted`. A crafted purchase metadata could inflate referral payouts.
**FIX:** Pass `serverCoinsGranted` (the DB-derived value) to `awardReferralCommissions`.

### 18. MED — No amount/price validation in charge webhook
**FILES:** `apps/web/app/api/economy/webhooks/paystack/route.ts`, `dodopayments` webhook
The handler credits the full pack regardless of whether the verified `amount` matches the pack's `price_kobo`. Combined with provider-side partial payments or metadata edge cases, this allows under-payment for full value.
**FIX:** Load `price_kobo` from `store_items` and assert `amount >= price_kobo` (and currency match) before crediting; otherwise flag for manual review.

### 19. MED — Internal coin credit/debit is not idempotent
**FILES:** `apps/web/lib/economy/coins.ts` (`creditCoins`/`debitCoins`), `apps/web/db/migrations/001_complete_schema.sql` (`coin_ledger`)
There is no unique constraint tying a ledger entry to a `(reference_id, transaction_type)` and no idempotency check inside `creditCoins`. Webhook safety currently rests entirely on the `payments` row guard (which is itself broken by #2). Any internal caller that retries (quest rewards, bonuses, referral commissions) can double-apply.
**FIX:** Add an optional `idempotencyKey`/unique `(transaction_type, reference_id)` partial index to `coin_ledger`; have `creditCoins`/`debitCoins` short-circuit if an entry with that key already exists (insert-on-conflict-do-nothing inside the locked transaction).

### 20. MED — Account-status check fails open
**FILES:** `apps/web/lib/api/middleware.ts` (`withAuth`)
On any error reading the status cache/DB, the catch block leaves `accountBlocked=false` and the request proceeds. During a Redis/DB blip a banned/suspended/deleted user can keep acting.
**FIX:** For sensitive mutations (payments, payouts, transfers, gifts), fail closed (deny) when status cannot be confirmed; for read paths, failing open is acceptable. At minimum log and meter these events.

### 21. MED — DB pool has no statement/idle timeouts (connection starvation)
**FILES:** `apps/web/lib/db/providers/supabase.ts` (and `railway.ts`, `digitalocean.ts`)
Pool `max` is 2 with no `statement_timeout` or `idle_in_transaction_session_timeout`. One stuck query or a transaction that awaits a slow external call (e.g. Paystack inside `db.transaction`) holds a connection; under load the pool starves and requests queue → thundering herd. Note also that several webhook handlers perform **external HTTP calls inside a DB transaction**, holding pooled connections across network latency.
**FIX:** Set `options: '-c statement_timeout=10000 -c idle_in_transaction_session_timeout=15000'` (or per-query `SET LOCAL statement_timeout`). Move all external HTTP calls *outside* DB transactions. Consider a slightly larger `max` per the pooler limits.

### 22. MED — AI circuit breaker is per-lambda in-memory (ineffective on serverless)
**FILES:** `apps/web/lib/ai/client.ts`
`deepseekCircuit` is module-level state. On Vercel each invocation may be a fresh instance, so failure counts rarely accumulate and reset on every cold start — the breaker won't trip fleet-wide.
**FIX:** Persist breaker state in Redis (shared counter + `openedAt` with TTL) so the breaker is global and survives cold starts. Keep the in-memory copy as an L1 cache.

### 23. LOW — CSP weakened by `unsafe-inline`/`unsafe-eval`; stored-XSS surface
**FILES:** `apps/web/next.config.js` (CSP), `app/layout.tsx` + `components/announcements/*` + `app/(app)/leaderboards/page.tsx` (`dangerouslySetInnerHTML`), admin footer-scripts feature
`script-src 'unsafe-inline' 'unsafe-eval'` largely negates CSP's XSS value. Admin-injected footer scripts and several `dangerouslySetInnerHTML` sinks (announcement banner/modal, leaderboard banner) are stored-HTML surfaces.
**FIX:** Move to nonce-based CSP (Next supports per-request nonces) and drop `unsafe-inline`/`unsafe-eval`. Ensure every `dangerouslySetInnerHTML` value passes through `htmlSanitizer` (verify the banner/leaderboard paths do — admin config routes already import it). Restrict footer-script injection to a tightly-audited admin role with 2FA.

### 24. LOW — Guild treasury cap not enforced on credits
**FILES:** `apps/web/app/api/economy/gifts/send/route.ts` (legend revenue share), `…/quests/.../contribute/route.ts`
`treasury_balance += share` updates ignore `guilds.treasury_cap`, so treasuries can exceed the declared cap.
**FIX:** `SET treasury_balance = LEAST(treasury_cap, treasury_balance + $1)` (and optionally log the clipped overflow), or validate against cap before crediting.

### 25. LOW — `parseInt` on BIGINT aggregates loses precision
**FILES:** `apps/web/app/api/admin/financial/route.ts`
Totals like `SUM(coin_balance)` are returned as text then `parseInt(...,10)` — fine until aggregates exceed 2^53, after which admin stats silently lose precision.
**FIX:** Keep large monetary/coin aggregates as strings or use `BigInt`/Decimal for display; avoid `parseInt` on summed BIGINTs.

### 26. LOW — Refresh cookie lifetime mismatch for admin sessions
**FILES:** `apps/web/lib/auth/session.ts` (`buildCookieHeaders`)
The refresh cookie `Max-Age` is hard-coded to `REFRESH_TOKEN_TTL_SECONDS` (30 days) even for admin sessions whose refresh JWT/Redis TTL is 1 hour. Harmless (Redis is authoritative) but misleading and leaves a stale cookie.
**FIX:** Pass the actual refresh TTL into `buildCookieHeaders` and set `Max-Age` accordingly.

### 27. LOW — Rate-limit keying edge cases
**FILES:** `apps/web/lib/security/rateLimit.ts` (`getClientIp`, sliding window)
Unidentifiable clients all key on `"unknown"`, sharing one bucket (collateral throttling). The sorted-set sliding window also stores one member per request; a hot key under a burst can grow large before TTL cleanup.
**FIX:** Fall back to a per-session/per-token identifier when IP is unknown; consider a fixed-window or token-bucket counter for very hot endpoints to bound memory.

### 28. LOW — Schema/data-model duplication & bloat
**FILES:** `apps/web/db/migrations/001_complete_schema.sql`
Overlapping tables increase bloat and ambiguity: `coin_ledger` vs `guild_treasury_ledger` *and* `guild_treasury_log`; `messages` vs `room_messages` vs `user_messages`; `notifications` vs `user_notifications`; `message_reactions` vs `room_message_reactions`; `friendships` vs `follows`. Multiple writers can drift.
**FIX:** Consolidate to one canonical table per concept (or document why each exists), add the missing covering indexes, and add a scheduled purge/partition for high-churn append-only tables (moments, room_messages, xp_events, *_ledger) to control long-term DB bloat on the hobby tier.

---

## C. Cross-Cutting Observations (by requested theme)

- **Accounting integrity / double-spend / idempotency:** Strong ledger intent undermined by #1, #2, #4 (broken writes), #6, #7, #8 (payout double-pay/credit), #12, #13, #19 (missing idempotency), #14 (unit conflation). These are the highest-priority cluster.
- **Sessions:** Rotation bug (#3) is release-blocking; otherwise design (Redis + reuse detection + per-user set) is good.
- **SEO:** #10/#11 mean the dynamic sitemap is effectively non-functional and points at uncrawlable routes. `robots.txt`, security headers, and `generateMetadata` are present and good.
- **Security / OWASP:** Good — DB-backed `is_admin`, origin-based CSRF, HttpOnly cookies, rate limiting, HMAC webhook verification with constant-time compare, identity-header stripping. Gaps: SSRF unused (#15), CSP weakened (#23), fail-open status (#20), no amount validation (#18).
- **Scalability / cheap hosting:** Pool timeouts + external calls inside transactions (#21) and per-lambda breaker (#22) are the main risks under thousands of concurrent users; otherwise Redis rate limiting and small pools fit the Hobby constraint well.
- **Decimal.js / financial math:** Correctly used in coin/star libs; conflation (#14) and `parseInt` precision (#25) are the exceptions.
- **Privacy / data portability:** `data_export_requests`, `dm_privacy`, soft-delete (`deleted_at`) and account-status gating exist — good foundation.

---

## D. Ratings

| Dimension | Now | After Fixes |
|---|---|---|
| Architecture & modularity | 8/10 | 9/10 |
| Correctness (does it run the money paths) | 3/10 | 9/10 |
| Security (OWASP/defense-in-depth) | 6/10 | 8.5/10 |
| Accounting integrity / idempotency | 3/10 | 9/10 |
| Scalability on Hobby tier | 6/10 | 8/10 |
| SEO | 4/10 | 8.5/10 |
| **Overall** | **4.5/10** | **8.5–9/10** |

**Verdict:** The platform is architecturally sound but currently ships with broken core money/session flows due to schema/code drift and a half-finished refresh rotation. None of the blockers are deep design flaws — they are concrete, fixable defects. Once the CRIT/HIGH cluster is resolved (columns added, rotation completed, cron unblocked, payout idempotency enforced, sitemap/public routes fixed), this becomes a strong, secure, scalable, zero-cost-friendly product.

---

*Report generated 2026-06-12 at 08:34 PM (UTC) by automated forensic code review. No code was modified — see `custom-bugs-fix-plan.md` for the remediation plan. Awaiting your review before any fixes are applied.*
