# Zobia Codebase Bug Report
**Generated:** June 25, 2026 07:02 AM UTC
**Branch:** claude/codebase-bug-analysis-79eghw
**Scope:** Full forensic analysis — web app (Next.js 14+), PWA, Expo Android app

---

## Summary: All Bugs Found (Quick Reference)

1. BUG-SCHEMA-01: `sticker_packs` table missing `slug` column — `claimPassMilestone` crashes on sticker pack rewards
2. BUG-SCHEMA-02: `subscriptions` table entirely absent from Drizzle schema — Paystack subscription webhook events crash on insert
3. BUG-AUTH-02: Edge middleware does not block `pre_auth` JWT tokens from accessing protected app routes — security bypass
4. BUG-WEBHOOK-02: `subscription.disable` event sets `ends_at = NULL` when `next_payment_date` is absent — users retain premium indefinitely
5. BUG-SEASON-01: `resetSeasonRankings` zeros `users.season_xp` for all season participants — corrupts any concurrently active season
6. BUG-QUEST-01: `checkDeckCompletion` only counts quests that have a progress row; unstarted quests are excluded from `total` — deck marked complete prematurely, bonus awarded early
7. BUG-MANIFEST-01: `warEngine.ts` reads manifest key `'warCooldownHours'` (camelCase) but key is stored as `'war_event_cooldown_hours'`; type guard also always false — war cooldown config permanently ignored
8. BUG-SCHEMA-03: Multiple financial bigint columns use `{ mode: "number" }` instead of `{ mode: "bigint" }` — IEEE 754 precision loss risk on large coin values
9. BUG-COMMISSIONS-01: `awardReferralCommissions` calls `safeAwardXP` without passing the transaction client — XP award runs outside caller's transaction; phantom DLQ entries possible on rollback
10. BUG-PAYOUT-01: `moveToDeadLetterQueue` restores earnings using `net_kobo ?? gross_kobo` — null `net_kobo` over-credits creator by gross amount before platform fee
11. BUG-SEASON-02: Subscription stars dedup key uses wall-clock month slice not event timestamp — webhook retry near month-end can double-credit stars
12. BUG-WEBHOOK-01: `processChargeSuccess` silently returns with no log or alert when no payment record matches the Paystack reference
13. BUG-AUTH-03: `verifyTotp` has no replay prevention — same TOTP code is valid for the full 90-second window
14. BUG-SCHEMA-04: `conversationScores` table is missing a `created_at` column in schema — crashes on any insert that expects this column
15. BUG-GEO-01: `runGeoAnomalyCheck` declares `_db` and `_redis` parameters but never uses them — dead/misleading function signature
16. BUG-PUSH-01: `pollPushReceipts` early-exit `return 0` inside `try` block skips DB cleanup of resolved tickets entirely
17. BUG-CRON-01: Referral streak block in `daily-economy` CRON uses `console.error` instead of `logger` — errors silently dropped from structured log pipeline
18. BUG-TYPE-01: `withAuth` and `withAdminAuth` use `any` type annotations — weakens compile-time type safety across all API routes
19. BUG-PAYOUT-02: Weekly automated payout loop catches errors with zero logging — individual creator payout failures completely invisible
20. BUG-SESSION-01: Manifest defines per-role session TTLs but `jwt.ts` signing functions use hardcoded constants — admin config for session lifetimes never takes effect
21. BUG-PRIV-01: Offline SQLite queue stores message content in plaintext — acknowledged in code comments as unimplemented TODO
22. BUG-SCHEMA-05: Functional expression index on `rooms(metadata->>'season_ceremony_id')` defined inline in Drizzle schema — Drizzle may not emit this correctly; ON CONFLICT in `createSeasonCeremonyRoom` may silently fail

---

## Detailed Bug Entries

---

### 1
**BUG-SCHEMA-01:** `sticker_packs` table missing `slug` column — season pass milestone claim crashes

**FILES:**
- `apps/web/lib/db/schema.ts`
- `apps/web/lib/seasons/seasonEngine.ts`

**FIX:**
Add a `slug` column to the `sticker_packs` table definition in `schema.ts` (e.g. `slug: text('slug').notNull().unique()`). Create a migration to add the column. Ensure existing rows are back-filled with a slug value. The `claimPassMilestone` function queries `WHERE slug = $1` and will throw a column-not-found error on any sticker-pack reward until this is resolved.

---

### 2
**BUG-SCHEMA-02:** `subscriptions` table entirely absent from Drizzle schema — Paystack subscription webhook handler crashes on insert

**FILES:**
- `apps/web/lib/db/schema.ts`
- `apps/web/lib/payments/paystackWebhookHandler.ts`

**FIX:**
Define the `subscriptions` table in `schema.ts` with at minimum: `id`, `user_id`, `paystack_subscription_code`, `paystack_customer_code`, `plan`, `status`, `starts_at`, `ends_at`, `next_payment_date`, `created_at`, `updated_at`. Create and run the corresponding Drizzle migration. Until this table exists, all Paystack `subscription.create`, `subscription.enable`, `subscription.disable`, and `charge.success` events that trigger subscription inserts will crash.

---

### 3
**BUG-AUTH-02:** Edge middleware does not reject `pre_auth` JWT tokens on protected app routes — authentication bypass

**FILES:**
- `apps/web/middleware.ts`

**FIX:**
In the app/protected-route branch of the middleware (the block that currently only checks `payload?.sub`), add an explicit check: if `payload?.type === 'pre_auth'` return a 401 or redirect to login. Currently only the login-redirect path checks for `pre_auth` type. A `pre_auth` token is only meant to be valid at the 2FA verification endpoint, but as-is, any user who can obtain a `pre_auth` token can bypass 2FA entirely and access all authenticated routes. This is a high-severity security vulnerability.

---

### 4
**BUG-WEBHOOK-02:** Paystack `subscription.disable` sets `ends_at = NULL` when `next_payment_date` is absent — user retains premium indefinitely

**FILES:**
- `apps/web/lib/payments/paystackWebhookHandler.ts`

**FIX:**
In `processSubscriptionEvent` for the `subscription.disable` case, replace the `ends_at = data.next_payment_date ?? NULL` logic with a concrete fallback. If `next_payment_date` is absent, set `ends_at` to `NOW()` (immediately expire) or to the end of the current billing period derived from the subscription's `starts_at` + plan duration. Never set `ends_at` to NULL on a disable event, as NULL is typically interpreted as "no expiry" (active forever).

---

### 5
**BUG-SEASON-01:** `resetSeasonRankings` zeroes `season_xp` on the `users` table for all participants of the ended season — destroys concurrent active season data

**FILES:**
- `apps/web/lib/seasons/seasonEngine.ts`

**FIX:**
The `users.season_xp` column is a single flat column shared across all seasons. Zeroing it by looking up participants of season N destroys any XP those users may have earned in a concurrently running season. The fix is to either: (a) track `season_xp` per-season in a `user_season_stats` table (preferred, more correct), or (b) only zero `season_xp` if no other active season exists at the moment of reset. Option (a) is the correct long-term solution and avoids future recurrence of this class of bug.

---

### 6
**BUG-QUEST-01:** `checkDeckCompletion` incorrectly counts quests — deck flagged complete when unstarted quests are absent from progress table

**FILES:**
- `apps/web/lib/quests/questEngine.ts`

**FIX:**
The current query joins `user_quest_decks` with `user_quest_progress` and only counts rows that exist in both tables. If a quest was never started, there is no progress row, and it is excluded from both `total` and `completed`. This means a user who completes 2 of 3 quests (with the 3rd never touched) gets a `total=2, completed=2` result, which triggers the deck-complete bonus incorrectly. Fix: derive `total` from `COUNT(*)` on `user_quest_decks` alone (all assigned quests regardless of whether progress started), and derive `completed` from the progress join with `progress >= target`. A LEFT JOIN approach or a subquery that counts deck size separately will resolve this.

---

### 7
**BUG-MANIFEST-01:** `warEngine.ts` reads manifest with wrong key name and wrong type check — war cooldown is permanently hardcoded, admin config has no effect

**FILES:**
- `apps/web/lib/guilds/warEngine.ts`
- `apps/web/lib/manifest/index.ts`

**FIX:**
Two problems in `findWarOpponent` at the manifest lookup:
(a) The key passed to `getManifestValue` is `'warCooldownHours'` but the manifest stores it as `'war_event_cooldown_hours'` (snake_case per the rest of the manifest). Change the key to `'war_event_cooldown_hours'`.
(b) `getManifestValue` returns `string | null`, so `typeof manifestCooldown === 'number'` is always `false`. Change to parse the string: `const parsed = manifestCooldown ? parseInt(manifestCooldown, 10) : NaN; if (!isNaN(parsed)) cooldownHours = parsed;`.
Both issues must be fixed together or the manifest config will continue to be ignored.

---

### 8
**BUG-SCHEMA-03:** Multiple financial columns use `{ mode: "number" }` instead of `{ mode: "bigint" }` — IEEE 754 precision loss on large values

**FILES:**
- `apps/web/lib/db/schema.ts`

**FIX:**
The following bigint columns in the schema use `{ mode: "number" }` which routes through JavaScript's 64-bit float and loses precision above 2^53 (≈9 quadrillion), well within reach for coin economy totals:
- `brandedRooms.sponsorBudgetCoins`
- `giftItems.coinCost`
- `gifts.coinValue`
- `gifts.coinCost`
- `failedCommissions.coinAmount`
- `failedCommissions.amountKobo`

Change each of these to `{ mode: "bigint" }` (or use Decimal.js for currency-critical values) and update all call sites to handle BigInt values. Run a Drizzle migration (no DDL change needed since the underlying SQL type does not change). Audit all arithmetic touching these values to ensure BigInt-safe operations.

---

### 9
**BUG-COMMISSIONS-01:** `awardReferralCommissions` calls `safeAwardXP` without the transaction client — XP award escapes caller's transaction boundary

**FILES:**
- `apps/web/lib/referrals/commissions.ts`
- `apps/web/lib/xp/safeAwardXP.ts`

**FIX:**
When `awardReferralCommissions` is invoked inside a transaction (e.g. from `retryFailedCommissions`), the `safeAwardXP` calls for tier-1 and tier-2 XP bonuses should receive the transaction `db` client so they participate in the same transaction. If not passed, XP is written with a separate connection outside the transaction. If the transaction rolls back (e.g. coin credit fails), the XP award is already committed — the referrer gains XP but gets no commission, and/or a phantom DLQ entry is created. Pass the transaction client as the final argument to `safeAwardXP` in both tier-1 and tier-2 calls.

---

### 10
**BUG-PAYOUT-01:** `moveToDeadLetterQueue` restores earnings using `net_kobo ?? gross_kobo` — over-credits creator when `net_kobo` is null

**FILES:**
- `apps/web/lib/payments/payouts.ts`

**FIX:**
The intent is to restore the creator's earnings when a payout fails. `net_kobo` is the amount after platform fee; `gross_kobo` is the full amount before deduction. Using `net_kobo ?? gross_kobo` means that when `net_kobo` is null (e.g. record was created before the column existed or fee wasn't computed), the gross amount is restored — giving the creator the platform's fee share as well. The fix: always use `net_kobo` for restoration, and treat a null `net_kobo` as an error condition requiring manual review (log a warning and write to a separate audit table) rather than silently falling back to gross.

---

### 11
**BUG-SEASON-02:** Subscription stars dedup key uses wall-clock `new Date()` instead of event timestamp — duplicate stars on webhook retry near month boundary

**FILES:**
- `apps/web/lib/seasons/seasonEngine.ts`

**FIX:**
The idempotency key for subscription star awards uses `new Date().toISOString().slice(0, 7)` (the current month as `YYYY-MM`). If a webhook is retried and the retry lands in a different month (e.g. original event was November 30 at 23:59, retry processes December 1 at 00:01), the dedup key changes and the stars are awarded again. Fix: derive the month from the event's own `created_at` or `paid_at` timestamp rather than wall-clock time. Pass the event timestamp into the dedup key computation.

---

### 12
**BUG-WEBHOOK-01:** `processChargeSuccess` silently returns when no payment record matches the Paystack reference

**FILES:**
- `apps/web/lib/payments/paystackWebhookHandler.ts`

**FIX:**
When `processChargeSuccess` looks up the payment by Paystack reference and finds no match, it currently returns without any log entry or alert. This silently swallows an important data inconsistency — a charge succeeded on Paystack's side but the local DB has no record of it, which may indicate a race condition, a webhook replay, or a DB write failure. At minimum, log a `logger.error` or `logger.warn` with the full reference and amount. For high-value charges, consider writing a `failed_reconciliation` record or raising a system alert.

---

### 13
**BUG-AUTH-03:** `verifyTotp` has no replay protection — same OTP code accepted multiple times within 90 seconds

**FILES:**
- `apps/web/lib/auth/totp.ts`

**FIX:**
The TOTP verifier checks a window of delta [-1, 0, +1] (90-second window) but does not record or reject reuse of a code within that window. An attacker who intercepts a valid OTP (e.g. via phishing, shoulder-surfing, or MitM) can replay it multiple times before the time step advances. Fix: after a successful verification, store the used `counter` value (or `counter:userId` key) in Redis with a TTL of 90 seconds. On each verification attempt, check Redis first and reject if the counter was already used. This is a standard TOTP hardening requirement (RFC 6238 §5.2).

---

### 14
**BUG-SCHEMA-04:** `conversationScores` table is missing a `created_at` column in schema

**FILES:**
- `apps/web/lib/db/schema.ts`

**FIX:**
The `conversationScores` Drizzle table definition does not include a `created_at` column. Any code that inserts into this table with a `created_at` value will receive a column-not-found error, and any queries that order or filter by `created_at` will fail. Add `createdAt: timestamp('created_at').defaultNow().notNull()` to the table definition and create a migration. Audit all call sites that reference `conversation_scores.created_at` to ensure compatibility.

---

### 15
**BUG-GEO-01:** `runGeoAnomalyCheck` has dead `_db` and `_redis` parameters that are declared but never used

**FILES:**
- `apps/web/lib/api/middleware.ts`

**FIX:**
The function signature `runGeoAnomalyCheck(userId, ip, _db, _redis)` accepts database and Redis adapter parameters but the function body never references them. This is misleading — callers believe they are passing live connections needed for the check, but the check operates on entirely different state (or does nothing with those connections). Either remove the unused parameters from the signature and all call sites, or implement the intended DB/Redis usage (e.g. reading prior IPs from DB, storing anomalies in Redis). The leading underscore convention suggests this was always intended but never implemented.

---

### 16
**BUG-PUSH-01:** `pollPushReceipts` skips DB cleanup of resolved tickets on empty-batch runs

**FILES:**
- `apps/web/lib/notifications/push.ts`

**FIX:**
When the function finds zero pending tickets, it hits `return 0` inside the `try` block. The `finally` block runs (releasing the Redis lock), but the DB cleanup query that deletes old resolved tickets is placed after the entire try/catch/finally structure and is therefore skipped. Over time, the `push_receipt_tickets` table will accumulate stale resolved rows indefinitely. Fix: move the cleanup query inside the `try` block before the early `return 0`, or restructure the function so cleanup always runs regardless of the pending-ticket count.

---

### 17
**BUG-CRON-01:** Referral streak block in `daily-economy` CRON uses `console.error` instead of structured `logger`

**FILES:**
- `apps/web/app/api/cron/daily-economy/route.ts`

**FIX:**
Individual referral errors in the streak-qualification block are logged with `console.error(...)`. All other error paths in this file and the rest of the codebase use `logger.error(...)` or `logger.warn(...)` from the structured logger. `console.error` output may not be captured by the logging pipeline (e.g. Datadog, Papertrail, Logtail), making these errors invisible in production monitoring. Replace `console.error` with `logger.error` passing a structured context object including `userId`, `referralId`, and the error.

---

### 18
**BUG-TYPE-01:** `withAuth` and `withAdminAuth` middleware helpers use `any` type annotations

**FILES:**
- `apps/web/lib/api/middleware.ts`

**FIX:**
The handler types passed to `withAuth` and `withAdminAuth` are typed as `any` for both the request parameter and the return value. This defeats TypeScript's ability to catch type mismatches in any API route handler that uses these wrappers — the entire route handler signature is effectively untyped. Define a proper handler type (e.g. `type AuthedHandler = (req: NextRequest, ctx: AuthContext) => Promise<Response>`) and replace all `any` annotations. This will surface any existing type errors at compile time rather than at runtime.

---

### 19
**BUG-PAYOUT-02:** Weekly automated payout loop silently swallows all per-creator errors with no logging

**FILES:**
- `apps/web/app/api/cron/daily-economy/route.ts`

**FIX:**
The Friday automated payout loop wraps each creator payout in `try { ... } catch { /* Non-fatal per-creator */ }` with a completely empty catch block. No error is logged, no alert is raised, no counter is incremented. In production this means an entire weekly payout run can fail for dozens of creators with zero operational visibility. Replace the empty catch block with at minimum `logger.error({ err, creatorId }, '[payout] Weekly payout failed for creator')`. Consider also writing a `failed_payout_audit` record and sending a system alert if the failure rate exceeds a threshold.

---

### 20
**BUG-SESSION-01:** Manifest `sessionTtls` configuration is never read by JWT signing functions — admin configuration for token lifetimes has no effect

**FILES:**
- `apps/web/lib/manifest/index.ts`
- `apps/web/lib/auth/jwt.ts`

**FIX:**
`manifest/index.ts` defines `sessionTtls` with per-role TTL values (default, creator, moderator, admin) and `buildManifest` populates them from the DB. However, `jwt.ts` exports and uses hardcoded constants (`ACCESS_TOKEN_TTL_SECONDS = 900`, `ADMIN_ACCESS_TOKEN_TTL_SECONDS = 1800`, etc.) as defaults, and the signing functions never read from the manifest. Any admin attempt to change session durations via the manifest config will silently have no effect. Fix: in the signing functions (or in the auth flow that calls them), fetch the manifest TTL for the relevant role and pass it explicitly as the `ttlSeconds` argument instead of relying on hardcoded defaults.

---

### 21
**BUG-PRIV-01:** Offline SQLite message queue stores message content in plaintext on device

**FILES:**
- `apps/expo/lib/offline/sqlite.ts`

**FIX:**
The SQLite offline queue stores full message `content` as plaintext in a local database file on the Android device. The code contains an acknowledged `// TODO: encrypt` comment (referenced as TASK-31/BUG-PRIV-01 in the source). An attacker with local file access (rooted device, backup extraction, forensic analysis) can read all unsent messages. Implement SQLCipher or Expo's SQLite encryption extension to encrypt the database at rest. At minimum, encrypt the `content` column using a key derived from the user's auth material (e.g. HKDF from the refresh token or a device-bound key in Android Keystore).

---

### 22
**BUG-SCHEMA-05:** Functional expression index on `rooms` table defined inline in Drizzle schema — may not be emitted correctly, causing silent ON CONFLICT failures

**FILES:**
- `apps/web/lib/db/schema.ts`
- `apps/web/lib/seasons/seasonEngine.ts`

**FIX:**
The index `(metadata->>'season_ceremony_id')` is a functional expression index. Drizzle ORM's inline index API may not correctly emit `CREATE UNIQUE INDEX ... ON rooms ((metadata->>'season_ceremony_id'))` with the parenthesised expression syntax PostgreSQL requires for functional indexes. If the index is not created correctly, the `ON CONFLICT (metadata->>'season_ceremony_id')` clause in `createSeasonCeremonyRoom` will throw a runtime error or silently insert duplicates. Verify the generated SQL in your migration history. If the index is not correct, define it as a raw SQL expression in a separate migration file using `CREATE UNIQUE INDEX` directly, and remove the inline Drizzle definition.

---

## Code Quality Rating

### Current State: 6.2 / 10

The codebase demonstrates strong architectural intent — append-only ledgers, SELECT FOR UPDATE, distributed locks via Redis, idempotency keys, DLQ/retry patterns, sliding-window rate limiting, and structured logging throughout. The domain model is sophisticated and well-thought-out. However, the analysis found two schema-level crashes (missing table, missing column), a high-severity auth bypass, three data integrity bugs, and pervasive type safety gaps. Several critical financial paths have precision risks or silent failure modes.

**Strengths:**
- Excellent use of FOR UPDATE SKIP LOCKED for concurrent-safe queue processing
- Consistent idempotency key patterns across payment, XP, and notification paths
- DLQ + retry infrastructure for XP awards, commissions, and payouts
- Coin arithmetic uses BigInt and Decimal.js in most (not all) places
- Structured logging is used almost everywhere (two notable gaps found)
- Edge middleware provides solid CSRF, nonce-based CSP, and header-stripping

**Weaknesses:**
- Schema and application code are out of sync in at least three places
- Auth middleware has a security gap that makes 2FA bypassable
- Financial precision is inconsistent (6 columns using wrong bigint mode)
- Admin configuration surfaces (manifest TTLs, war cooldown) are wired up but silently disconnected from the code they should govern
- TOTP replay protection absent

### Projected Rating After All Fixes Applied: 8.5 / 10

Addressing the 22 issues — particularly the schema gaps, auth bypass, TOTP replay, financial precision, and quest completion logic — would bring the codebase to a solid production standard. The foundational patterns are already correct; these are largely cases of incomplete wiring or schema drift rather than fundamental design flaws.

---

*Report generated by forensic codebase analysis.*
*June 25, 2026 07:02 AM UTC*
