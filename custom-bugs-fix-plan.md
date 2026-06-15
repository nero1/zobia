# Zobia Codebase Bug Fix Plan
**Date:** 2026-06-15 | **Time:** 11:13 AM
**Scope:** Fix plan for all 33 bugs identified in `custom-bugs-report.md`
**Branch:** claude/codebase-bug-analysis-ulrfvp
**Do not implement until this plan is reviewed and approved.**

---

## Fix Priority Groups

Bugs are grouped by dependency order. Fix critical runtime bugs first (Group 1), then security hardening (Group 2), then logic/data bugs (Group 3), then architectural cleanup (Group 4).

---

## GROUP 1 — Critical Runtime Bugs (App-Breaking)

These bugs cause 500 errors or silent data corruption at runtime. Fix these first.

---

### TASK 1.1 — Fix 2FA Disable: Decrypt TOTP Secret Before Verification
**Fixes:** B-01, S-05
**Files:** `apps/web/app/api/auth/2fa/disable/route.ts`

Steps:
1. Import `decryptField` from `lib/security/fieldEncryption.ts`.
2. After fetching `row.totp_secret` from the DB, add: `const secret = await decryptField(row.totp_secret);`
3. Replace `verifyTOTP(row.totp_secret, code)` with `verifyTOTP(secret, code)`.
4. Remove all inline TOTP code (`base32Decode`, `computeTotp`, `generateTOTP`, `verifyTOTP`) from this file.
5. Import `verifyTOTP` from `lib/auth/totp.ts`.
6. Add Redis replay protection: before returning success, set `totp:used:${userId}:${code}` in Redis with 90s TTL. Reject if the key already exists.

---

### TASK 1.2 — Fix Bank Account TOTP Gate: Decrypt TOTP Secret, Fix Column Names
**Fixes:** B-02, B-04
**Files:** `apps/web/app/api/creator/bank-account/route.ts`

Steps:
1. In `verifySecurityGate()`, import and call `await decryptField(row.totp_secret)` before passing the secret to the TOTP verifier.
2. Remove all inline TOTP code from this file and import `verifyTOTP` from `lib/auth/totp.ts`.
3. In the xp_ledger INSERT, rename the `action` column parameter to `source` (which is the correct NOT NULL column). Ensure `source` is passed a value (e.g. `'bank_account_added'`).
4. In the `UPDATE users` statement, rename `SET xp = xp + $1` to `SET xp_total = xp_total + $1`.

---

### TASK 1.3 — Fix Creator Payouts: Add Missing NOT NULL Columns
**Fixes:** B-03
**Files:** `apps/web/app/api/creator/payouts/route.ts`

Steps:
1. In the coins-payout path INSERT into `creator_payouts`, add the `provider` column (value: the payment provider string appropriate to the user's context, e.g. `'paystack'` for Nigeria, `'dodopayments'` for international) and `amount_kobo` (the computed gross payout amount in kobo).
2. In the bank-transfer/crypto path INSERT, add the same two columns with appropriate values.
3. Verify all other NOT NULL columns in `creator_payouts` are supplied in both INSERTs: `creator_id`, `amount`, `payout_method`, `status`, `provider`, `amount_kobo`.

---

### TASK 1.4 — Fix Admin Overview: Wrong Table Name and Wrong Column Names
**Fixes:** B-05
**Files:** `apps/web/app/api/admin/overview/route.ts`

Steps:
1. Replace all references to `user_reports` with `reports`.
2. Remove `AND deleted_at IS NULL` from the guilds query (the column doesn't exist). If filtering inactive guilds is needed, use `WHERE is_active = true` (which does exist on the guilds table).
3. Replace `last_seen_at` with `last_active_at` in all DAU/WAU/MAU activity timestamp queries.

---

### TASK 1.5 — Fix Admin Users: Wrong Table Name
**Fixes:** B-06
**Files:** `apps/web/app/api/admin/users/route.ts`

Steps:
1. Replace all references to `user_reports` with `reports`.

---

### TASK 1.6 — Fix Announcement Engine: Missing Columns and Missing `deleted_at`
**Fixes:** B-07, B-08
**Files:** `apps/web/lib/announcements/engine.ts`

Steps:
1. In the `getActiveBanner()` query, remove `title` from the SELECT list (or add the column via migration if it is genuinely needed). Replace `link_url` with `target_url`.
2. Remove `AND deleted_at IS NULL` from both the modal query and the banner query.
3. If soft-delete is required for announcements, create a new migration that adds `deleted_at TIMESTAMPTZ` to both `announcement_modals` and `announcement_banners`, then re-add the filter.

---

### TASK 1.7 — Fix DodoPay Webhook: Non-Existent `failed_webhooks` Table
**Fixes:** B-09, B-12
**Files:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`
**New file:** `apps/web/db/migrations/015_failed_webhooks.sql`

Steps:
1. Create migration `015_failed_webhooks.sql` with: `CREATE TABLE IF NOT EXISTS failed_webhooks (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), provider TEXT NOT NULL, event_type TEXT, payload JSONB, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`
2. In the webhook route error path, update the INSERT to use the column names from that migration.
3. Fix `user_subscriptions` table name references: replace with `subscriptions`.
4. Audit all column names in the subscriptions upsert against the `subscriptions` table definition in `001_complete_schema.sql` and align them exactly.

---

### TASK 1.8 — Fix Fraud Payouts: Wrong Column Name
**Fixes:** B-10
**Files:** `apps/web/lib/fraud/payouts.ts`

Steps:
1. In the gift fraud scoring query, replace `g.coin_value` with `g.coin_cost`.

---

### TASK 1.9 — Fix Paystack Webhook: Table and Column Mismatches
**Fixes:** B-11
**Files:** `apps/web/app/api/economy/webhooks/paystack/route.ts`

Steps:
1. Replace `user_subscriptions` with `subscriptions` everywhere in this route.
2. In the `room_subscriptions` INSERT, confirm the column names against `001_complete_schema.sql`. The correct columns are `room_id`, `user_id`, `status`, `amount_kobo`, `started_at`, `expires_at`. Update the INSERT to use these exact names.
3. Ensure the ON CONFLICT target references the `room_subscriptions_room_user_idx` unique index (added in migration 012).

---

## GROUP 2 — Security Bugs

Fix these immediately after Group 1.

---

### TASK 2.1 — Fix Middleware JWT Multi-Key Support
**Fixes:** S-01
**Files:** `apps/web/middleware.ts`, `apps/web/lib/api/middleware.ts`, `apps/web/lib/auth/jwt.ts`

Steps:
1. Export a `verifyJWT(token: string): Promise<TokenPayload | null>` function from `lib/auth/jwt.ts` that reads the `kid` header from the token, looks up the matching key from the key registry (environment variables or key store), and verifies with jose's `jwtVerify`.
2. In `apps/web/middleware.ts`, remove the local `verifyToken()` function and replace all calls with the imported `verifyJWT()`.
3. In `apps/web/lib/api/middleware.ts`, do the same replacement.
4. Ensure the env schema in `lib/env.ts` includes any additional JWT_SECRET_* rotation key variables needed by the key registry.

---

### TASK 2.2 — Fix SSRF `safeFetch()`: Preserve TLS Hostname
**Fixes:** S-02
**Files:** `apps/web/lib/security/ssrf.ts`

Steps:
1. Remove the logic that rewrites `requestUrl.hostname` to the resolved IP address.
2. Instead, create a custom Node.js `http.Agent` / `https.Agent` with a `lookup` override function. In the `lookup` callback, resolve the hostname, validate the resolved IP is not in a private/loopback CIDR range (reuse the existing `isPrivateIP()` helper), and if it is safe, pass the IP to the callback. If it is private/loopback, call the callback with an error to abort the connection.
3. Pass this custom agent to the `fetch()` call so DNS is intercepted but the original hostname is preserved for TLS SNI.
4. Note: Node.js's built-in `fetch` may not support custom agents — use `undici`'s `fetch` with a custom dispatcher, or use `node-fetch` with the agent option.

---

### TASK 2.3 — Fix Telegram Bot: Timing-Safe Secret Comparison
**Fixes:** S-03
**Files:** `apps/web/app/api/auth/telegram/bot/route.ts`

Steps:
1. Import `timingSafeEqual` from `node:crypto`.
2. In `verifyBotSecret()`, convert both the incoming header value and `process.env.TELEGRAM_BOT_SECRET` to `Buffer` using `Buffer.from(str, 'utf8')`.
3. If lengths differ, return `false` immediately (length mismatch is not secret, but avoids crashing `timingSafeEqual` which requires equal-length buffers).
4. Use `timingSafeEqual(headerBuf, secretBuf)` for the comparison.

---

### TASK 2.4 — Fix 2FA Setup: Add TOTP Replay Protection, Remove Inline TOTP
**Fixes:** S-04, L-01 (partial)
**Files:** `apps/web/app/api/auth/2fa/setup/route.ts`

Steps:
1. Remove all inline TOTP code (`base32Decode`, `computeTotp`, `generateTOTP`, `verifyTOTP`).
2. Import `verifyTOTP`, `generateTOTP` from `lib/auth/totp.ts`.
3. After successful TOTP verification during setup confirmation, write `totp:used:${userId}:${code}` to Redis with 90s TTL.
4. At the start of the verification step, check if `totp:used:${userId}:${code}` exists in Redis and reject if so.

---

### TASK 2.5 — Fix Telegram Bot: Empty Email and Missing Username
**Fixes:** S-06
**Files:** `apps/web/app/api/auth/telegram/bot/route.ts`

Steps:
1. In the user creation INSERT, change `email: ""` to `email: null`.
2. Ensure `username` is set for new Telegram-bot users. Use the Telegram `username` field if provided by the bot payload; if absent, generate a unique handle (e.g. `tg_${telegram_id}` or call the `uniqueUsername()` helper with the Telegram first name as base).

---

### TASK 2.6 — Add DodoPay Circuit Breaker
**Fixes:** S-07
**Files:** `apps/web/lib/payments/dodopayments.ts`, `apps/web/lib/payments/paystack.ts`
**New file:** `apps/web/lib/payments/circuitBreaker.ts`

Steps:
1. Extract the circuit breaker logic from `paystack.ts` into a standalone `circuitBreaker.ts` module with a generic `withCircuitBreaker<T>(key: string, fn: () => Promise<T>): Promise<T>` wrapper.
2. Apply `withCircuitBreaker` to all external API calls in `dodopayments.ts`.
3. Replace the existing inline circuit breaker in `paystack.ts` with calls to the shared module.
4. Ensure the Redis keys used for DodoPay and Paystack circuit breakers are distinct (e.g. `cb:dodopay` vs `cb:paystack`).

---

## GROUP 3 — Logic and Data Bugs

---

### TASK 3.1 — Fix Referral Commissions: Pass Actual Amount Values
**Fixes:** L-02
**Files:** `apps/web/lib/referrals/commissions.ts`

Steps:
1. Identify the computed `commissionKobo` and `purchaseAmountKobo` variables in `recordReferralCommission()`.
2. Verify these are bound to the correct positional parameters (`$N`) in the INSERT statement. Currently both are set to `0` or bound to the wrong parameter slot.
3. Fix the parameter binding so `commission_kobo = $N` receives the computed commission amount and `purchase_amount_kobo = $M` receives the actual purchase amount.

---

### TASK 3.2 — Fix Mystery XP Drop: Add Idempotency Key
**Fixes:** L-03
**Files:** `apps/web/lib/mystery/xpDrop.ts`

Steps:
1. Add a `batchId` parameter to `triggerMysteryDrop()` (or generate one at the start of the function using `crypto.randomUUID()`).
2. For each user in the batch, pass `reference_id = \`mystery_drop:${batchId}:${userId}\`` to `safeAwardXP()`.
3. This ensures the partial unique index on `xp_ledger` deduplicates retry awards for the same drop batch.

---

### TASK 3.3 — Fix Mystery XP Drop: Unbiased Random Integer
**Fixes:** L-04
**Files:** `apps/web/lib/mystery/xpDrop.ts`

Steps:
1. Replace the custom `randomInt(min, max)` implementation that uses `% N` modulo with Node.js's built-in: `const { randomInt } = await import('node:crypto'); return randomInt(min, max + 1);`
2. Since `randomInt` is synchronous in Node.js, the import can be hoisted to the top of the file or imported statically.

---

### TASK 3.4 — Fix Flash XP Notifications: Explicit ON CONFLICT Target
**Fixes:** L-05
**Files:** `apps/web/lib/events/flashXP.ts`

Steps:
1. Determine the correct unique constraint for deduplicating flash XP notifications — if notifications have a `(user_id, reference_id)` unique constraint, use that.
2. Change `ON CONFLICT DO NOTHING` to `ON CONFLICT (user_id, reference_id) DO NOTHING` with the explicit target.
3. If no suitable unique constraint exists, add one via a migration before making this change.

---

### TASK 3.5 — Fix Google Auth Username Generator
**Fixes:** L-06
**Files:** `apps/web/app/api/auth/google/callback/route.ts`

Steps:
1. In `uniqueUsername()`, change the lookup query from `WHERE username LIKE '${base}%'` to a parameterised query that matches only the exact base name and numerically suffixed variants: `WHERE username = $1 OR username ~ ('^' || $1 || '[0-9]+$')`.
2. Pass `base` as the parameterised value `$1` to prevent SQL injection.

---

### TASK 3.6 — Fix Offline Message Queue: `getQueueCounts()` Non-Pending Statuses
**Fixes:** L-07
**Files:** `apps/web/lib/offline/messageQueue.ts`

Steps:
1. In `getQueueCounts()`, audit the status accumulation logic.
2. Ensure there is an explicit counter increment for `'failed'` status, `'sent'` status, and any other expected statuses.
3. Return an object with all status buckets correctly populated.

---

### TASK 3.7 — Fix Re-engagement: Remove Duplicate 90-Day Message
**Fixes:** L-08
**Files:** `apps/web/lib/notifications/reengagement.ts`

Steps:
1. In the 90-day bucket message array, identify the two entries with identical body text.
2. Replace the second (duplicate) entry with a new, distinct message that is meaningfully different from the first.

---

### TASK 3.8 — Fix Leaderboard: Wire or Remove Dead Weighted Scoring
**Fixes:** L-09
**Files:** `apps/web/lib/leaderboards/engine.ts`

Steps:
1. Decide: should leaderboards use weighted scoring (combining XP with gift sends, messages, room time) or plain XP ordering?
2. If weighted scoring: call `calculateWeightedScore()` during the snapshot materialization step and store the result as the `xp_value` used for ranking.
3. If plain XP: delete `calculateWeightedScore()` and `getUserMetricsForWeighting()` entirely, and add a comment explaining that rankings are based on raw XP.

---

### TASK 3.9 — Fix Manifest: Remove or Wire `feat()` Dead Code
**Fixes:** L-10
**Files:** `apps/web/lib/manifest/index.ts`

Steps:
1. If `feat()` is meant to be a convenience wrapper for feature flag lookups: replace direct `getManifest()` key checks throughout the codebase with `await feat('feature_key_name')` calls.
2. If `feat()` is not needed: delete the function and its export.

---

### TASK 3.10 — Fix AI Classifier: Correct Fallback Label
**Fixes:** L-11
**Files:** `apps/web/lib/moderation/aiClassifier.ts`

Steps:
1. Find the call to `fallbackResult("gemini")` that is made when both DeepSeek and Gemini have failed.
2. Change `fallbackResult("gemini")` to `fallbackResult("none")` (or introduce a `"fallback"` provider label if that is more descriptive).

---

### TASK 3.11 — Fix Shared Types: Remove Duplicate CoinTransactionType Entry
**Fixes:** L-12
**Files:** `shared/types/index.ts`

Steps:
1. In the `CoinTransactionType` union, find and remove the second `'gift_received'` entry (keep only one occurrence).

---

## GROUP 4 — Architectural Cleanup

These improve maintainability and type safety.

---

### TASK 4.1 — Consolidate TOTP: Single Shared Implementation
**Fixes:** L-01
**Files:** `apps/web/lib/auth/totp.ts`, all route files with inline TOTP

Steps:
1. Ensure `lib/auth/totp.ts` exports: `verifyTOTP(secret: string, code: string): Promise<boolean>` and `generateTOTP(secret: string): Promise<{ code: string, expiresIn: number }>`.
2. Remove all inline TOTP implementations from: `api/auth/2fa/setup/route.ts` (already done in TASK 2.4), `api/auth/2fa/disable/route.ts` (already done in TASK 1.1), `api/creator/bank-account/route.ts` (already done in TASK 1.2).
3. Verify `api/admin/auth/totp/route.ts` already correctly imports from `lib/auth/totp.ts`; if it has its own copy, consolidate it too.
4. Search the codebase for any other inline `base32Decode` or `computeTotp` functions and consolidate.

---

### TASK 4.2 — Fix `computeTotp()`: Remove Unnecessary Async
**Fixes:** A-02
**Files:** `apps/web/lib/auth/totp.ts`

Steps:
1. Change `async function computeTotp(...)` to `function computeTotp(...)`.
2. Change the return type from `Promise<string>` to `string`.
3. Update all callers: remove any `await` before `computeTotp(...)` calls. (Since it's called internally within `lib/auth/totp.ts`, this should be straightforward.)
4. Adjust `verifyTOTP` and `generateTOTP` signatures if they also became unnecessarily async as a result.

---

### TASK 4.3 — Regenerate Drizzle Schema from SQL Migrations
**Fixes:** A-01
**Files:** `apps/web/lib/db/schema.ts`

Steps:
1. Run `drizzle-kit introspect --config drizzle.config.ts` against the live database to generate a fresh `schema.ts` that reflects all tables and columns from the applied migrations.
2. Alternatively, run all migrations (`001` through the latest) in a clean Postgres instance and introspect that.
3. Replace the contents of `apps/web/lib/db/schema.ts` with the generated output.
4. If the codebase uses Drizzle query builder anywhere, re-run TypeScript compilation (`tsc --noEmit`) to surface any type mismatches that the regenerated schema reveals.
5. Ensure the Drizzle config file (`drizzle.config.ts`) is set to track the canonical migrations directory so future `drizzle-kit generate` commands do not create conflicting migrations.

---

## Implementation Order Summary

| Priority | Task | Bug(s) Fixed |
|---|---|---|
| 1 | TASK 1.1 | B-01, S-05 |
| 2 | TASK 1.2 | B-02, B-04 |
| 3 | TASK 1.3 | B-03 |
| 4 | TASK 1.4 | B-05 |
| 5 | TASK 1.5 | B-06 |
| 6 | TASK 1.6 | B-07, B-08 |
| 7 | TASK 1.7 | B-09, B-12 |
| 8 | TASK 1.8 | B-10 |
| 9 | TASK 1.9 | B-11 |
| 10 | TASK 2.1 | S-01 |
| 11 | TASK 2.2 | S-02 |
| 12 | TASK 2.3 | S-03 |
| 13 | TASK 2.4 | S-04, L-01 (partial) |
| 14 | TASK 2.5 | S-06 |
| 15 | TASK 2.6 | S-07 |
| 16 | TASK 3.1 | L-02 |
| 17 | TASK 3.2 | L-03 |
| 18 | TASK 3.3 | L-04 |
| 19 | TASK 3.4 | L-05 |
| 20 | TASK 3.5 | L-06 |
| 21 | TASK 3.6 | L-07 |
| 22 | TASK 3.7 | L-08 |
| 23 | TASK 3.8 | L-09 |
| 24 | TASK 3.9 | L-10 |
| 25 | TASK 3.10 | L-11 |
| 26 | TASK 3.11 | L-12 |
| 27 | TASK 4.1 | L-01 (complete) |
| 28 | TASK 4.2 | A-02 |
| 29 | TASK 4.3 | A-01 |

Total: 33 bugs across 29 fix tasks (some tasks fix multiple bugs).

---

*Fix plan generated: 2026-06-15 at 11:13 AM*
*Analyst: Claude (claude-sonnet-4-6) — Zobia Codebase Forensic Analysis*
*Branch: claude/codebase-bug-analysis-ulrfvp*
