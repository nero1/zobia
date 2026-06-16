# Zobia Codebase — Forensic Bug Report

**Date:** June 16, 2026  
**Time:** 02:26 AM UTC  
**Scope:** Full forensic analysis — web app (`apps/web`), PWA (`apps/web/public/sw.js`), and Expo mobile Android app (`apps/expo`)  
**Analyst:** Claude Code — direct file-by-file review, no agents, no sub-agents

---

## Code Quality Rating — Current State

**Overall: 6.5 / 10**

The architecture is genuinely strong in all the places that matter for a production social platform. The team has done the right things: atomic Lua sliding-window rate limiting, `kid`-based JWT key rotation, HMAC-SHA512/256 webhook verification on both providers, `SELECT FOR UPDATE` locking on the coin ledger, CTE-based atomic XP awards with a DLQ, SSRF DNS pinning, per-request CSP nonces in Edge Middleware, AES-256-GCM field-level encryption with a scrypt KDF, Decimal.js for all financial arithmetic, two-stage Expo push delivery with receipt polling, and thorough Zod validation at every boundary. None of these are beginner decisions.

What brings the score down is a cluster of critical and high bugs concentrated in two layers: the payment webhook integration and the DM messaging route. Two of them — the CSRF block on all payment webhooks and the group-chat XP unique constraint violation — would cause silent production failures that are extremely difficult to diagnose from logs alone. Several others in the DM route create real financial risk (double-spend on gift retry, stale coin balances in the audit ledger, non-atomic XP writes). The medium and low issues are real but cosmetic or performance-only by comparison.

**Projected rating after all fixes: 8.5 / 10**

The underlying architecture needs no structural rework. Every fix listed below is a targeted change to existing logic. Applying them brings an already solid codebase up to consistent production-grade quality across all layers.

---

## Complete Bug List (One-Line Summaries)

**CRITICAL**
1. BUG-01: CSRF middleware blocks all payment provider webhooks — Paystack and DodoPayments receive 403 on every event
2. BUG-02: TypeScript compile error — required parameter `idempotencyRef` follows optional `txClient` in `transferCoins`

**HIGH**
3. BUG-03: DodoPayments webhook catch-all returns HTTP 200 for transient errors, permanently suppressing provider retries
4. BUG-04: DM gift coin transfer bypasses idempotency check, enabling double-spend on network retry
5. BUG-05: Group chat XP uses static `groupId` as `reference_id`, unique constraint violation blocks all XP after the first message
6. BUG-06: DM text message XP uses non-atomic two-query pattern instead of `safeAwardXP`, losing XP on any partial failure
7. BUG-07: DM gift XP uses non-atomic two-query pattern instead of `safeAwardXP`, losing XP on any partial failure
8. BUG-08: DM coin ledger `balance_before` captured before the transaction opens, recording a stale pre-debit snapshot

**MEDIUM**
9. BUG-09: Push-receipt `DeviceNotRegistered` handler purges all device tokens for a user, not just the failing one
10. BUG-10: Service worker `NetworkFirst` caches an opaque 302 redirect for root `/` as a fake HTTP 200
11. BUG-11: Nemesis engine refresh issues one DB transaction per user pair (O(n) sequential), not a single batched upsert
12. BUG-12: Paystack webhook `subscription.not_renew` event falls through the handler with no action taken
13. BUG-13: `insertNotification` / `insertNotificationBatch` have no `ON CONFLICT DO NOTHING`, producing duplicates on retry
14. BUG-14: Leaderboard snapshot `ON CONFLICT` expression in raw SQL may not exactly match the Drizzle-generated index DDL

**LOW**
15. BUG-15: `CRON_SECRET` is optional in Zod env validation — absence silently returns 401 on every cron endpoint invocation
16. BUG-16: Creator fund tier-slice math leaks up to 70% of the pool when the eligible creator count is very small
17. BUG-17: `blockLinks` moderation flag is computed from room rules but never forwarded to `filterPublicContent`
18. BUG-18: `parseCookies` does not URL-decode values, silently rejecting CSRF state tokens containing encoded characters
19. BUG-19: Reengagement variant selection uses an ASCII char-code sum modulo, producing an uneven message distribution

---

## Detailed Bug Entries

---

### BUG-01 — CSRF Middleware Blocks All Payment Webhooks (CRITICAL)

**Severity:** CRITICAL — all Paystack and DodoPayments payment events are permanently dropped; no coins are credited, no plans activated, no payouts confirmed.

The middleware's `isCsrfSafe()` function returns `false` for any state-mutating request that arrives without an `Origin` header, with the only exception being `/api/cron/` paths that also carry the correct `x-cron-secret` value. Payment provider webhooks are server-to-server POST requests and never include an `Origin` header. Neither `/api/economy/webhooks/paystack` nor `/api/economy/webhooks/dodopayments` appears in `PUBLIC_PREFIXES`. The CSRF guard fires before any route handler is reached, and every incoming webhook receives a `403 CSRF_ORIGIN_MISMATCH` response. This is a complete payment processing outage that is invisible without watching for 403s on webhook paths.

FILES:
- `apps/web/middleware.ts`

FIX: Add `/api/economy/webhooks/paystack` and `/api/economy/webhooks/dodopayments` to the `PUBLIC_PREFIXES` array. These routes perform their own authentication via HMAC-SHA512/256 signature verification inside the handler, so skipping JWT/CSRF at the middleware layer is correct and safe. No other changes are required — the route handlers already reject requests with invalid or missing signatures.

---

### BUG-02 — TypeScript Compile Error in `transferCoins` Signature (CRITICAL)

**Severity:** CRITICAL — TypeScript TS2016 error; the function signature is invalid. All callers either fail type checking or work around it incorrectly, which undermines idempotency.

The `transferCoins` function places `txClient?: TransactionClient` (optional) before `idempotencyRef: string` (required). TypeScript prohibits required parameters from following optional ones and emits TS2016. In practice every call site must either always provide a `txClient` (even when one is not needed) or must cast/ignore types to supply `idempotencyRef` at all. Either workaround means `idempotencyRef` is likely being passed incorrectly or omitted, which removes the partial-unique-constraint protection from the coin ledger for gift transfers.

FILES:
- `apps/web/lib/economy/coins.ts`

FIX: Reorder the parameters so `idempotencyRef: string` comes before `txClient?: TransactionClient`. Audit every call site to confirm arguments are passed in the corrected order. If any call site legitimately needs `txClient` but not a unique ref, make `idempotencyRef` optional too (defaulting to `null`), consistent with `debitCoins` and `creditCoins`.

---

### BUG-03 — DodoPayments Webhook Returns 200 for All Errors (HIGH)

**Severity:** HIGH — any processing failure on a DodoPayments event is silently acknowledged as success; the event is never retried and its effects are permanently lost.

The DodoPayments webhook route wraps all processing in a try/catch that returns `NextResponse.json({ received: true }, { status: 200 })` from the catch branch regardless of what threw. HTTP 200 tells DodoPayments the event was processed successfully and no retry is needed. A transient DB error, Redis timeout, or unexpected exception causes the event to be swallowed: the coin credit, plan activation, or purchase confirmation never happens, and no DLQ entry is created. The Paystack webhook handler correctly returns 500 for unexpected errors; DodoPayments does not.

FILES:
- `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

FIX: In the catch block, distinguish known idempotency conflicts (which should return 200 to prevent infinite retries on already-processed events) from unexpected processing failures (which must return 500 or 503 so DodoPayments retries delivery). Add structured logging with the full error and event type. A known-idempotency catch should be explicit — check for Postgres unique-violation error code `23505` specifically, and return 200 only for that case.

---

### BUG-04 — DM Gift Bypasses Idempotency Key (HIGH)

**Severity:** HIGH — a network retry on a DM gift send can debit the sender twice and credit the recipient twice with no constraint to prevent it.

The DM route handler calls `handleDMGift()` and returns its result before reaching the idempotency Redis check that guards the rest of the handler. The gift flow calls both `debitCoins` and `creditCoins` with `null` as the `referenceId`, meaning neither ledger entry has a constraint key. The partial unique index on `coin_ledger (transactionType, referenceId) WHERE referenceId IS NOT NULL` provides no protection when `referenceId` is null. If a client retries after a 5xx response or network timeout, the full gift is duplicated: coins deducted again from the sender, added again to the recipient.

FILES:
- `apps/web/app/api/messages/dm/route.ts`

FIX: Generate a stable idempotency key per gift attempt (e.g., `dm_gift:${conversationId}:${senderId}:${clientMessageId}`) and pass it as `referenceId` to both `debitCoins` and `creditCoins`. Move the `handleDMGift()` call to after the idempotency Redis check, not before it, so the key prevents duplicate execution on retry.

---

### BUG-05 — Group Chat XP Constraint Violation Blocks All XP After First Message (HIGH)

**Severity:** HIGH — after a user's first message in any group room, every subsequent message they send in that room silently fails to award XP.

The group message route inserts an `xp_ledger` row with `source = 'group_message'` and `reference_id = groupId`. The `xp_ledger` partial unique index covers `(user_id, source, reference_id) WHERE reference_id IS NOT NULL`. On the user's second message in the same group, the INSERT hits the constraint on `(userId, 'group_message', groupId)` — already inserted — and the entire XP transaction rolls back. The route does not catch this specific error code, so the failure is swallowed silently. This affects every user in every group room on every message after their first, and creates no DLQ entry.

FILES:
- `apps/web/app/api/messages/group/[groupId]/route.ts`
- `apps/web/lib/db/schema.ts`

FIX: Use a per-message unique reference instead of the group ID. Replace `reference_id = groupId` with a per-message key such as `group_msg:${messageId}` or simply the `messageId` UUID. This preserves idempotency (retry-safe per message) while allowing each new message to earn XP. Migrate the XP insert to use `safeAwardXP` with the per-message reference so any failure falls to the DLQ instead of rolling back silently.

---

### BUG-06 — DM Text XP Award Non-Atomic (HIGH)

**Severity:** HIGH — a failure between the two XP queries permanently loses the XP and prevents any future retry via the DLQ.

The DM route awards XP for text messages with two separate raw SQL queries: `INSERT INTO xp_ledger` then `UPDATE users SET xp_total = xp_total + $amount`. These are not inside a transaction and do not use `safeAwardXP`. If the second query fails, the ledger row exists (blocking re-insertion via the unique constraint) but the user's total is never incremented. The orphaned ledger row prevents the correct retry, the XP is permanently lost, and no DLQ record is created.

FILES:
- `apps/web/app/api/messages/dm/route.ts`

FIX: Replace the two raw queries with a single `safeAwardXP(userId, amount, 'social', 'dm_text', referenceId)` call, where `referenceId` is a per-message key (e.g., `dm_text:${messageId}`). `safeAwardXP` uses a single CTE to atomically insert the ledger row and update the user total, and writes to `failed_xp_awards` on failure for cron-based retry.

---

### BUG-07 — DM Gift XP Award Non-Atomic (HIGH)

**Severity:** HIGH — same non-atomic two-query pattern as BUG-06 applied to both the sender and recipient XP legs of a DM gift.

`handleDMGift` awards XP to the sender and recipient using raw separate `INSERT INTO xp_ledger` + `UPDATE users` queries outside any transaction. A failure between these queries on either leg leaves the ledger and user table inconsistent with no DLQ fallback. Because the ledger row already exists after the INSERT, a retry cannot re-insert, so the XP award is lost permanently on the leg that failed the UPDATE.

FILES:
- `apps/web/app/api/messages/dm/route.ts`

FIX: Replace all raw two-query XP patterns inside `handleDMGift` with `safeAwardXP` calls. Use per-gift reference IDs to distinguish sender from recipient (e.g., `dm_gift_sent:${giftId}` and `dm_gift_received:${giftId}`).

---

### BUG-08 — DM Coin Ledger `balance_before` TOCTOU (HIGH)

**Severity:** HIGH — the audit ledger records an incorrect pre-debit balance, corrupting the financial audit trail.

The DM route reads `sender.coin_balance` from an initial outer SELECT at the start of the handler, before the transaction that performs the debit is opened. `balance_before` in the `coin_ledger` INSERT is populated from this outer read. Between the outer SELECT and the inner `SELECT FOR UPDATE` inside the transaction, another concurrent operation may change the user's balance (a gift received, a purchase completed). The ledger records a balance that was never the actual balance at the moment of the debit. While `creditCoins`/`debitCoins` use `SELECT FOR UPDATE` to prevent double-spend, the recorded `balance_before` is stale and incorrect.

FILES:
- `apps/web/app/api/messages/dm/route.ts`
- `apps/web/lib/economy/coins.ts`

FIX: Read `balance_before` from the locked row inside the transaction, not from the pre-transaction outer query. The `debitCoins` helper already holds the lock; expose the locked `coin_balance` as a return value so the caller can pass it to the ledger INSERT. Alternatively, compute it inside the CTE as part of the single atomic operation: `balance_before = (SELECT coin_balance FROM users WHERE id = $1 FOR UPDATE)`.

---

### BUG-09 — Push Token Mass-Deletion on Single `DeviceNotRegistered` Failure (MEDIUM)

**Severity:** MEDIUM — a single expired device token causes all of a user's registered devices to lose push notifications.

When the push-receipt polling job processes Expo receipts and encounters `DeviceNotRegistered`, it queries all push tokens for the associated `user_id` and adds every token to the `staleTokens` deletion set. A user with a phone and a tablet loses both push registrations when only the phone's Expo token has expired. The query is `SELECT token FROM user_push_tokens WHERE user_id = $1` — fetching all tokens for the user, not just the one that produced the failing ticket.

FILES:
- `apps/web/lib/notifications/push.ts`

FIX: Store the specific token alongside `user_id` in the `push_tickets` table row at ticket creation time, or JOIN `push_tickets` to a token-level table at receipt processing time. When `DeviceNotRegistered` arrives, add only the token associated with that specific ticket to `staleTokens`, not all tokens belonging to the user.

---

### BUG-10 — Service Worker Caches Opaque Redirect for Root "/" as Fake HTTP 200 (MEDIUM)

**Severity:** MEDIUM — unauthenticated PWA users can get stuck seeing a blank cached page instead of being redirected to login; the cached fake-200 also masks future authentication redirects.

The service worker uses `NetworkFirst` for the root `/` route. When the Next.js middleware returns a 302 redirect for unauthenticated users (sending them to `/auth/login`), the service worker's fetch event receives an `opaqueredirect` response. Workbox may store this in the cache. On subsequent visits the opaque response is served as a fake HTTP 200, bypassing the auth redirect entirely and rendering a blank shell. This is a well-documented Workbox footgun with `NetworkFirst` on navigations that have server-side auth redirects.

FILES:
- `apps/web/public/sw.js`

FIX: For the root `/` and all top-level navigation routes, either use `NetworkOnly` (so redirect responses are never cached), or add a response filter that explicitly refuses to cache any response where `response.type === 'opaqueredirect'`. The recommended Workbox pattern for SPA/PWA navigation is `NavigationRoute` with `createHandlerBoundToURL` pointing to the app shell HTML, combined with a client-side auth check after hydration.

---

### BUG-11 — Nemesis Refresh Runs O(n) Sequential Transactions (MEDIUM)

**Severity:** MEDIUM — the nemesis pair refresh function issues one database transaction per user pair, creating linear DB load that degrades severely at scale.

The nemesis engine iterates over active users and for each pair issues a separate round-trip transaction containing individual SELECTs and INSERT/UPDATEs. At 10,000 active users this creates 10,000 sequential round-trips holding connection pool slots serially. The cron job runs for many minutes and starves other DB operations. This is a performance bug that becomes a reliability bug at moderate user counts.

FILES:
- `apps/web/lib/nemesis/nemesisEngine.ts`

FIX: Rewrite the refresh as a single batched SQL operation. Collect all intended nemesis assignments into an array, then issue a single `INSERT INTO nemesis_assignments (...) VALUES (unnest($1::uuid[]), ...) ON CONFLICT DO UPDATE` call. The XP comparison and ranking that drives nemesis selection can be expressed as a CTE or subquery, so the entire refresh runs in one or two round-trips instead of one per user.

---

### BUG-12 — Paystack Webhook `subscription.not_renew` Falls Through Unhandled (MEDIUM)

**Severity:** MEDIUM — Paystack subscription cancellation-intent notices are silently ignored; no user record is updated, leaving cancelled subscribers appearing active until natural expiry.

The Paystack webhook handler covers the main subscription event types but the `subscription.not_renew` event (sent when a customer disables auto-renewal) falls through the handler logic with no matching branch. No user subscription flag is set, no notification is sent, and no forthcoming-cancellation record is created. The user appears active until the next billing cycle fails, at which point the app has no prior record of the user's intent to cancel.

FILES:
- `apps/web/app/api/economy/webhooks/paystack/route.ts`

FIX: Add an explicit handler for `subscription.not_renew` that sets a `cancel_at_period_end = true` flag (or equivalent column) on the user's subscription record. This allows the frontend to display a cancellation banner and downstream logic to correctly handle the upcoming non-renewal without treating it as an unexpected payment failure.

---

### BUG-13 — `insertNotification` Has No Idempotency Guard (MEDIUM)

**Severity:** MEDIUM — duplicate notifications are created whenever the same event fires more than once (cron re-run, concurrent worker, transient error retry).

Both `insertNotification` and `insertNotificationBatch` perform plain `INSERT INTO notifications` with no `reference_id` or `ON CONFLICT DO NOTHING` clause. Any scenario that triggers the same notification twice — a cron retry, a double-fired event webhook, or a race between two concurrent workers — inserts duplicate rows. Users see the same notification appear twice in their feed with no deduplication.

FILES:
- `apps/web/lib/notifications/insert.ts`
- `apps/web/lib/db/schema.ts`

FIX: Add a `reference_id` (or `idempotency_key`) column to the `notifications` table with a unique constraint, or a composite unique constraint on `(user_id, type, entity_id)` with a time-window partial index. Change the INSERT statement to `ON CONFLICT (reference_id) DO NOTHING`. All callers must generate a deterministic reference key (e.g., `xp_award:${userId}:${source}:${dateKey}`, `gift_received:${giftId}`).

---

### BUG-14 — Leaderboard `ON CONFLICT` Expression May Not Match Drizzle Index DDL (MEDIUM)

**Severity:** MEDIUM — if the raw SQL `ON CONFLICT` expression does not exactly match the expression Drizzle generates for the unique index, Postgres cannot resolve the conflict target and the upsert will error or insert duplicates.

The leaderboard engine upsert uses `ON CONFLICT (user_id, leaderboard_type, COALESCE(city, ''), COALESCE(season_id::text, ''))` in a raw query. The Drizzle schema defines the index using the same `COALESCE` expressions. Postgres requires the `ON CONFLICT` expression to match the index definition character-for-character (including type cast syntax and whitespace-normalised form). If Drizzle generates `COALESCE(season_id :: text, '')` with different spacing or a different cast syntax, Postgres will not match the conflict target and will raise `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification`.

FILES:
- `apps/web/lib/leaderboards/engine.ts`
- `apps/web/lib/db/schema.ts`

FIX: Run `\d leaderboard_snapshots` against the live database and compare the actual index expression to the `ON CONFLICT` clause in the application SQL. If they differ, align them exactly. The most robust long-term fix is to add a generated or deterministic surrogate column (e.g., a stable `snapshot_key` VARCHAR populated on insert) and use `ON CONFLICT (snapshot_key)` instead, eliminating fragile expression matching.

---

### BUG-15 — `CRON_SECRET` Optional Silently Blocks All Cron Endpoints (LOW)

**Severity:** LOW — if `CRON_SECRET` is absent from the environment, every cron job returns 401 on every invocation, and no alerting distinguishes this from normal 401s.

The Zod env schema marks `CRON_SECRET` as optional. The `validateCronSecret` helper short-circuits on `process.env.CRON_SECRET && ...` — when the var is undefined, this evaluates to `false` immediately. All cron route handlers then return 401 with a generic unauthorised response. The daily cron silently fails with no error message indicating the root cause, and no monitoring alarm is triggered by a 401 on a cron path.

FILES:
- `apps/web/lib/env.ts`
- `apps/web/app/api/cron/daily/route.ts`

FIX: Change `CRON_SECRET` to `z.string().min(32)` (required, minimum entropy) in the Zod env schema so the app fails to start at boot with a clear validation error when the var is missing or too short. Add a boot-time assertion in `validateCronSecret` that throws descriptively when the env var is absent, rather than silently returning false.

---

### BUG-16 — Creator Fund Leaks Pool for Small Creator Cohorts (LOW)

**Severity:** LOW — for very small creator pools (fewer than approximately 10 eligible creators), most of the fund's tier allocations are computed as zero-width slices and never distributed, silently wasting a significant portion of the pool.

The tier-slice calculation uses `Math.floor(percentage * totalCreators)` clamped to `Math.max(1, result)`. For 2 creators and the third tier (20%): `Math.floor(0.20 * 2) = 0`, clamped to 1. All five tiers then resolve to cutoff index 1, producing empty slices for tiers 3, 4, and 5. Their combined 45% of the pool is never distributed. The remainder redistribution step at the end recovers rounding leftovers but not entirely-empty tier slices, so a substantial fraction of the pool is silently discarded in small cohorts.

FILES:
- `apps/web/lib/creator/fund.ts`

FIX: When `totalCreators` is below a minimum threshold (e.g., fewer than 5), skip the tier structure entirely and distribute the full pool equally among all creators. Alternatively, after computing tier cutoffs, detect empty slices and fold their allocation into adjacent non-empty tiers. Add unit tests with 1, 2, 3, 5, and 10 creators asserting that 100% of the pool is always paid out.

---

### BUG-17 — `blockLinks` Moderation Flag Unused (LOW)

**Severity:** LOW — rooms configured to block link-sharing have no actual enforcement; links pass through the content filter unfiltered.

In the room message POST handler, `blockLinks` is read from the room's moderation rules and assigned to a boolean variable, but the variable is never passed to the `filterPublicContent()` call. The content filter executes without the flag and links are not stripped or rejected even in rooms where the room owner has enabled link blocking.

FILES:
- `apps/web/app/api/rooms/[roomId]/messages/route.ts`

FIX: Pass `blockLinks` as an options parameter to `filterPublicContent(content, { blockLinks })`. Verify that `filterPublicContent` in the content filter module actually implements a URL-blocking code path when this flag is true; if not, implement that branch in the content filter.

---

### BUG-18 — `parseCookies` Does Not URL-Decode Values (LOW)

**Severity:** LOW — CSRF state tokens containing URL-encoded characters are silently rejected, causing OAuth login failures for a subset of users.

`parseCookies` in `csrf.ts` splits the raw `Cookie` header on `;` and `=` and returns values without applying `decodeURIComponent`. RFC 6265 does not mandate URL-encoding, but many HTTP clients and browsers do encode cookie values containing characters like `+`, `=`, `/`, and `%`. If the CSRF state value is ever transmitted with encoded characters, `validateCsrfState`'s timing-safe comparison will always fail for those users, blocking their OAuth login flow.

FILES:
- `apps/web/lib/security/csrf.ts`

FIX: Apply `decodeURIComponent` (wrapped in a try/catch for malformed percent sequences) to each cookie value in `parseCookies`. This brings the parser in line with standard cookie handling and prevents encoding-related CSRF validation failures without weakening the timing-safe comparison.

---

### BUG-19 — Reengagement Variant Selector Has Uneven Distribution (LOW)

**Severity:** LOW — some re-engagement message variants are significantly over-represented, and the personalised context variants (guild war, nemesis, season) may rarely appear for large portions of the user population.

The variant index is `userId.split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % messages.length`. UUID characters are hex digits (ASCII 48–57 for `0-9`, ASCII 97–102 for `a-f`) and dashes (ASCII 45). The sum of these values across 36 characters is a value typically in the range 1,600–3,700, which is not uniformly distributed modulo 2, 3, or 4. Certain residues are more probable than others, causing the first variant in each bucket to appear far more frequently than the personalised context variants at higher indices.

FILES:
- `apps/web/lib/notifications/reengagement.ts`

FIX: Replace the char-code sum with a uniformly distributed hash. The simplest approach is to take the last 4 hex characters of the UUID (which are randomly distributed in v4 UUIDs) and compute `parseInt(userId.slice(-4), 16) % messages.length`. A proper FNV-1a 32-bit hash of the userId string is also correct and gives near-perfect uniformity regardless of UUID version.

---

## Summary

| # | Severity | Short Name |
|---|----------|------------|
| 1 | CRITICAL | CSRF blocks payment webhooks |
| 2 | CRITICAL | TypeScript required-after-optional in `transferCoins` |
| 3 | HIGH | DodoPayments returns 200 on error |
| 4 | HIGH | DM gift bypasses idempotency |
| 5 | HIGH | Group XP `reference_id` constraint violation |
| 6 | HIGH | DM text XP non-atomic |
| 7 | HIGH | DM gift XP non-atomic |
| 8 | HIGH | DM `balance_before` TOCTOU |
| 9 | MEDIUM | Push token mass-deletion on one failure |
| 10 | MEDIUM | Service worker caches opaque redirect for "/" |
| 11 | MEDIUM | Nemesis refresh O(n) transactions |
| 12 | MEDIUM | Paystack `subscription.not_renew` unhandled |
| 13 | MEDIUM | `insertNotification` no dedup guard |
| 14 | MEDIUM | Leaderboard `ON CONFLICT` expression mismatch risk |
| 15 | LOW | `CRON_SECRET` optional silently blocks crons |
| 16 | LOW | Creator fund pool leak for small cohorts |
| 17 | LOW | `blockLinks` flag computed but unused |
| 18 | LOW | `parseCookies` no URL-decode |
| 19 | LOW | Reengagement uneven variant distribution |

---

*Report generated: June 16, 2026 — 02:26 AM UTC*  
*Analyst: Claude Code*  
*Repository: nero1/zobia*
