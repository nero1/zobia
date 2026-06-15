# Zobia Codebase Bug Report
**Date:** 2026-06-15 | **Time:** 11:35 AM (updated — second pass complete)
**Scope:** Full forensic analysis — web app, PWA, Expo mobile, shared types, SQL migrations, CRON route
**Branch:** claude/codebase-bug-analysis-ulrfvp
**Analyst:** Claude (claude-sonnet-4-6) — independent self-conducted analysis

---

## Summary Index (One-line descriptions)

1. **B-01** — `2fa/disable/route.ts`: TOTP verification passes AES-encrypted secret to verifier without decryption — 2FA can never be disabled
2. **B-02** — `creator/bank-account/route.ts`: Same encrypted-secret TOTP bug in `verifySecurityGate()` — bank account TOTP gate always rejects valid codes
3. **B-03** — `creator/payouts/route.ts`: Both coin-path and bank/crypto-path INSERTs omit NOT NULL columns `provider` and `amount_kobo` — all payout requests crash at DB level
4. **B-04** — `creator/bank-account/route.ts`: XP ledger INSERT uses non-existent column `action` (NOT NULL `source` is omitted); users UPDATE uses non-existent column `xp` (correct: `xp_total`)
5. **B-05** — `admin/overview/route.ts`: Queries non-existent table `user_reports` (correct: `reports`) and wrong column `last_seen_at` (correct: `last_active_at`) — admin overview always returns 500
6. **B-06** — `admin/users/route.ts`: Same `user_reports` → `reports` wrong table name — pending report count always errors
7. **B-07** — `lib/announcements/engine.ts` + all `admin/announcements/banners/` routes: `announcement_banners` queried/written with non-existent columns `title` and `link_url` — entire banner subsystem (user-facing and admin) throws at runtime
8. **B-08** — `lib/announcements/engine.ts` + `admin/announcements/banners/` routes: `deleted_at` column referenced on `announcement_banners` and `announcement_modals` — doesn't exist; every query/update errors
9. **B-09** — `api/economy/webhooks/dodopayments/route.ts`: References non-existent `failed_webhooks` table (absent from all migrations) — DodoPay webhook handler crashes on any error path
10. **B-10** — `lib/fraud/payouts.ts`: Gift fraud check uses `g.coin_value` instead of correct column `g.coin_cost` — fraud scoring always reads wrong gift value
11. **B-11** — `api/economy/webhooks/paystack/route.ts`: `room_subscriptions` INSERT uses wrong column names; code also references `user_subscriptions` but actual table is `subscriptions`
12. **B-12** — `api/economy/webhooks/dodopayments/route.ts`: Same `user_subscriptions` table name mismatch and column mismatches vs actual `subscriptions` table
13. **S-01** — `middleware.ts` / `lib/api/middleware.ts`: `verifyToken()` uses only `JWT_SECRET`, ignoring the multi-key rotation registry in `lib/auth/jwt.ts` — tokens signed with rotated-out keys silently fail
14. **S-02** — `lib/security/ssrf.ts`: `safeFetch()` replaces URL hostname with resolved IP, destroying TLS certificate validation for all HTTPS SSRF-guarded requests
15. **S-03** — `api/auth/telegram/bot/route.ts`: `verifyBotSecret()` uses non-timing-safe `===` string comparison — vulnerable to timing side-channel attacks
16. **S-04** — `api/auth/2fa/setup/route.ts`: Inline TOTP verifier during setup has no Redis-based replay protection — captured code can be reused within one TOTP window
17. **S-05** — `api/auth/2fa/disable/route.ts`: No replay protection for the TOTP code used to disable 2FA
18. **S-06** — `api/auth/telegram/bot/route.ts`: Telegram bot flow creates users with `email: ""` (empty string) — violates data integrity and may cause unique-constraint collisions
19. **S-07** — `lib/payments/dodopayments.ts`: No circuit breaker for DodoPay API calls — unlike Paystack, cascading failures will not be contained
20. **L-01** — TOTP implementation duplicated inline in 4+ routes instead of importing shared `lib/auth/totp.ts` — divergent implementations create maintenance hazards
21. **L-02** — `lib/referrals/commissions.ts`: Both `commission_kobo` and `purchase_amount_kobo` always inserted as `0` — all referral commissions are recorded as zero kobo
22. **L-03** — `lib/mystery/xpDrop.ts`: `safeAwardXP()` called with `reference_id = null` — no idempotency key means mystery drops can double-award XP on CRON retries
23. **L-04** — `lib/mystery/xpDrop.ts`: `randomInt()` uses `getRandomValues() % N` — modulo bias produces non-uniform distribution
24. **L-05** — `lib/events/flashXP.ts`: Notifications INSERT uses `ON CONFLICT DO NOTHING` with no explicit conflict target — fragile and potentially silences unintended conflicts
25. **L-06** — `api/auth/google/callback/route.ts`: `uniqueUsername()` uses `LIKE '${base}%'` which over-matches unrelated usernames — generates unnecessary numeric suffixes
26. **L-07** — `lib/offline/messageQueue.ts`: `getQueueCounts()` always returns 0 for every status other than pending
27. **L-08** — `lib/notifications/reengagement.ts`: 90-day re-engagement bucket has two entries with identical body text — one is dead
28. **L-09** — `lib/leaderboards/engine.ts`: `calculateWeightedScore()` and `getUserMetricsForWeighting()` are defined but never called — weighted scoring is dead code
29. **L-10** — `lib/manifest/index.ts`: `feat()` helper exported but never called anywhere — dead code
30. **L-11** — `lib/moderation/aiClassifier.ts`: `fallbackResult("gemini")` mislabels a circuit-breaker total failure as a Gemini provider result
31. **L-12** — `shared/types/index.ts`: `CoinTransactionType` union has duplicate `'gift_received'` entry
32. **A-01** — `lib/db/schema.ts`: Drizzle TypeScript schema is massively out of sync with the SQL migrations — missing dozens of tables and hundreds of columns
33. **A-02** — `lib/auth/totp.ts`: `computeTotp()` declared `async` despite being entirely synchronous — unnecessary microtask overhead
34. **N-01** — `api/cron/daily/route.ts` step 13 (Patron badge): Same `coin_value` vs `coin_cost` column error on the `gifts` table as B-10 — patron badge recipients are always computed wrong
35. **N-02** — `api/cron/daily/route.ts` step 21 (Monthly plan bonus): `ON CONFLICT (reference_id) DO NOTHING` doesn't match the actual unique index `(transaction_type, reference_id) WHERE reference_id IS NOT NULL` — Postgres rejects the entire INSERT; monthly coin bonuses are never distributed
36. **N-03** — `apps/expo/app/auth/login.tsx`: Telegram login state token uses `Math.random()` as entropy source — not cryptographically secure; state token can be predicted
37. **N-04** — `admin/announcements/banners/route.ts` POST + `[bannerId]/route.ts` PUT/DELETE: INSERT/UPDATE/soft-delete all fail because they write `title`, `link_url`, `deleted_at` columns that don't exist on `announcement_banners` — entire admin banner CRUD is broken at the DB level

---

## Detailed Bug Analysis

---

### B-01 — 2FA Disable: TOTP Verification Against Encrypted Secret

**FILES:**
- `apps/web/app/api/auth/2fa/disable/route.ts`

**FIX:**
The route fetches `row.totp_secret` from the database and passes it directly to the inline `verifyTOTP(row.totp_secret, code)`. However, `totp_secret` is stored AES-256-GCM encrypted (written via `encryptField()` in the 2FA setup route). The verifier receives a base64 ciphertext string instead of the raw TOTP seed, so the HMAC computation produces garbage and the code never matches. Every attempt to disable 2FA will fail with an "invalid code" error regardless of what the user enters. Fix: call `await decryptField(row.totp_secret)` before passing the secret to the verifier. Additionally, remove the inline TOTP implementation and import `verifyTOTP` from `lib/auth/totp.ts`.

---

### B-02 — Bank Account TOTP Gate: Encrypted Secret Not Decrypted

**FILES:**
- `apps/web/app/api/creator/bank-account/route.ts`

**FIX:**
`verifySecurityGate()` inside this route fetches `row.totp_secret` from the database and passes it directly to an inline `verifyTOTP(row.totp_secret, code)`. The secret is AES-encrypted at rest (same pattern as 2FA setup), so the raw ciphertext is fed to the TOTP HMAC — producing an incorrect result every time. Users with 2FA enabled can never add or update a bank account because the TOTP gate permanently rejects every valid code. Fix: call `await decryptField(row.totp_secret)` before passing it to the verifier. Also remove the inline TOTP code and import from `lib/auth/totp.ts`.

---

### B-03 — Creator Payouts: Missing NOT NULL Columns in INSERT

**FILES:**
- `apps/web/app/api/creator/payouts/route.ts`

**FIX:**
Both INSERTs into the `creator_payouts` table (the coins-payout path and the bank-transfer/crypto path) omit two NOT NULL columns: `provider` (the payment provider used, e.g. "paystack") and `amount_kobo` (the gross payout amount in kobo). PostgreSQL will reject these INSERTs with a NOT NULL constraint violation at runtime, meaning every payout request — regardless of method — will fail with a 500 error and no payout will ever be recorded. Fix: include the correct `provider` string (derived from the user's country or wallet method) and the computed `amount_kobo` value in both INSERT statements.

---

### B-04 — Bank Account Route: Wrong XP Ledger and Users Column Names

**FILES:**
- `apps/web/app/api/creator/bank-account/route.ts`

**FIX:**
Two separate column name errors exist in this route. First, the XP ledger INSERT omits the `source` column (which is NOT NULL in the `xp_ledger` table) and instead provides only an `action` value — Postgres will reject this with a NOT NULL violation, meaning no XP is ever awarded for adding a bank account. Second, the subsequent `UPDATE users SET xp = xp + $1` references a column named `xp` which does not exist; the actual column is `xp_total`. Fix: rename `action` to `source` in the xp_ledger INSERT, and rename `xp` to `xp_total` in the users UPDATE.

---

### B-05 — Admin Overview: Wrong Table Name and Wrong Column Names

**FILES:**
- `apps/web/app/api/admin/overview/route.ts`

**FIX:**
Two distinct errors exist in this route. First, it queries `FROM user_reports WHERE status = 'pending'` — the correct table name is `reports`. This causes a "relation does not exist" error making the entire admin overview endpoint return 500. Second, the DAU/WAU/MAU activity queries use `last_seen_at` as the activity timestamp column, but the actual column is `last_active_at` (confirmed throughout the SQL migration and CRON route). Note: `guilds.deleted_at` DOES exist in the migration and is not a bug. Fix: rename `user_reports` to `reports` and rename `last_seen_at` to `last_active_at` in the activity queries.

---

### B-06 — Admin Users: Wrong Table Name `user_reports`

**FILES:**
- `apps/web/app/api/admin/users/route.ts`

**FIX:**
The admin users endpoint queries `FROM user_reports WHERE status = 'pending'` to count pending reports per user. Same root cause as B-05 — the table is named `reports`. Fix: rename to `reports` throughout this route.

---

### B-07 — Announcement Banners: Missing `title` and `link_url` Columns Across All Banner Routes

**FILES:**
- `apps/web/lib/announcements/engine.ts`
- `apps/web/app/api/admin/announcements/banners/route.ts`
- `apps/web/app/api/admin/announcements/banners/[bannerId]/route.ts`

**FIX:**
The banner-related code — both the user-facing engine and the admin CRUD routes — all operate on two columns that don't exist in `announcement_banners`: `title` and `link_url`. The table has `target_url` (not `link_url`) and no `title` at all. This means: (1) the user-facing `getActiveBanner()` throws on every call; (2) the admin GET list SELECT fails; (3) the admin POST INSERT includes these columns (runtime Postgres error); (4) the admin PUT UPDATE tries to set `title` and `link_url` dynamically (fails if either is in the request). The entire banner subsystem — user-facing and admin — is broken at the database level. Fix: add `title VARCHAR(200)` and `link_url TEXT` (or alias `target_url` as `link_url`) to `announcement_banners` via a new migration so the schema aligns with what all callers uniformly expect.

---

### B-08 — Announcement Tables: `deleted_at` Column Referenced But Never Defined

**FILES:**
- `apps/web/lib/announcements/engine.ts`
- `apps/web/app/api/admin/announcements/banners/route.ts`
- `apps/web/app/api/admin/announcements/banners/[bannerId]/route.ts`

**FIX:**
Multiple places reference `deleted_at` on `announcement_modals` and `announcement_banners`: the user-facing engine filters `WHERE deleted_at IS NULL`; the admin GET, PUT, and DELETE all use `deleted_at IS NULL` as an existence check; the admin DELETE soft-deletes via `SET deleted_at = NOW()`. Neither table has this column. Results: the user-facing engine errors on every call; admin list, update, and delete all fail at the DB layer. Fix: add `deleted_at TIMESTAMPTZ` to both tables via a new migration. Every caller consistently expects soft-delete semantics; the column just needs to be created.

---

### B-09 — DodoPay Webhook: Non-Existent `failed_webhooks` Table

**FILES:**
- `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

**FIX:**
The error-handling path of the DodoPay webhook handler executes `INSERT INTO failed_webhooks (...)`. No `failed_webhooks` table exists in any migration file (001 through 014) — it is completely absent from the database schema. Every time the webhook encounters an error (e.g. invalid payload, processing failure), this secondary INSERT also fails, causing an unhandled exception and a misleading error response to DodoPay's servers, which will trigger indefinite retries. Fix: either create a `failed_webhooks` table via a new migration (columns: id, provider, payload, error, created_at), or write to the existing `audit_log` table instead.

---

### B-10 — Fraud Payouts: Wrong Gift Column Name `coin_value`

**FILES:**
- `apps/web/lib/fraud/payouts.ts`

**FIX:**
The gift fraud scoring query joins against `gift_items` and reads `g.coin_value` to compute total gift value sent by the user. The `gift_items` table in the SQL migration has a column named `coin_cost`, not `coin_value`. Postgres will throw "undefined column", causing the entire fraud check to fail at runtime. This means fraud detection on payouts is effectively disabled — any payout that triggers a fraud score computation will error out. Fix: rename `g.coin_value` to `g.coin_cost`.

---

### B-11 — Paystack Webhook: `room_subscriptions` Wrong Columns / `user_subscriptions` Table Mismatch

**FILES:**
- `apps/web/app/api/economy/webhooks/paystack/route.ts`

**FIX:**
The Paystack webhook handler references `user_subscriptions` in its subscription upsert logic with `ON CONFLICT (user_id)`. The actual subscriptions table in the migration is `subscriptions`, not `user_subscriptions`. Additionally, the `room_subscriptions` INSERT references column names that do not match the migration definition (`amount_kobo`, `started_at`, `expires_at` are the correct column names). Any mismatch causes Postgres relation or column errors on every Paystack payment event. Fix: rename `user_subscriptions` to `subscriptions` and audit the `room_subscriptions` INSERT columns against the migration definition for exact alignment.

---

### B-12 — DodoPay Webhook: `user_subscriptions` Column Mismatches

**FILES:**
- `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

**FIX:**
The DodoPay webhook upserts into `user_subscriptions` with column names that don't match the actual `subscriptions` table. The correct table is `subscriptions` with columns: `user_id`, `plan`, `status`, `provider`, `provider_subscription_id`, `started_at`, `expires_at`, `cancelled_at`, `next_renewal_at`. Fix: rename all `user_subscriptions` references to `subscriptions` and align every column name to the migration definition.

---

### S-01 — Middleware JWT Multi-Key Mismatch

**FILES:**
- `apps/web/middleware.ts`
- `apps/web/lib/api/middleware.ts`
- `apps/web/lib/auth/jwt.ts`

**FIX:**
`lib/auth/jwt.ts` implements a multi-key rotation registry using a `kid` (key ID) JWT header, allowing rolling of JWT secrets without invalidating all active sessions. However, both `middleware.ts` and `lib/api/middleware.ts` implement their own `verifyToken()` functions that only read a single `JWT_SECRET` environment variable, ignoring the `kid` header and the key registry entirely. When a JWT signing key is rotated, all tokens signed with the previous key will fail validation in middleware and generate phantom logouts for all active users. Fix: replace the local `verifyToken()` implementations in both middleware files with the shared `verifyJWT()` function from `lib/auth/jwt.ts` that performs multi-key lookup via the `kid` header.

---

### S-02 — SSRF `safeFetch()` Breaks TLS Certificate Validation

**FILES:**
- `apps/web/lib/security/ssrf.ts`

**FIX:**
`safeFetch()` resolves the hostname via DNS, validates the resolved IP is not in a private/loopback range, then replaces the request URL's hostname with the raw IP address before making the fetch. For HTTPS URLs, this destroys TLS validation: the TLS handshake presents the IP as SNI instead of the original hostname, so the server's certificate (issued to the domain) does not match and the connection either fails or proceeds with an invalid certificate silently. Fix: instead of rewriting the URL hostname, intercept DNS resolution at the Node.js `http.Agent` level using a custom `lookup` function that validates the resolved IP before the connection is established while preserving the original hostname for TLS SNI.

---

### S-03 — Telegram Bot: Non-Timing-Safe Secret Comparison

**FILES:**
- `apps/web/app/api/auth/telegram/bot/route.ts`

**FIX:**
The `verifyBotSecret()` function compares the incoming `x-bot-secret` header against `process.env.TELEGRAM_BOT_SECRET` using the `===` operator. JavaScript string comparison is not constant-time — it short-circuits on the first differing character, leaking timing information that could be exploited to brute-force the secret one character at a time. Fix: replace `===` with `crypto.timingSafeEqual()` by encoding both strings to `Buffer` first, matching the pattern already used in `lib/security/csrf.ts`.

---

### S-04 — 2FA Setup: No TOTP Replay Protection

**FILES:**
- `apps/web/app/api/auth/2fa/setup/route.ts`

**FIX:**
During 2FA setup, the route verifies a TOTP code to confirm the user has successfully enrolled. Unlike `app/api/auth/2fa/verify/route.ts` (which stores `totp:used:${userId}:${code}` in Redis to prevent code reuse), the setup route has no replay protection. A TOTP code submitted during setup remains valid for the full 30-second TOTP window and could be captured and replayed. Fix: after successful verification during setup, write the code to Redis with a 90-second TTL using the same `totp:used:${userId}:${code}` key pattern used in the verify route.

---

### S-05 — 2FA Disable: No TOTP Replay Protection

**FILES:**
- `apps/web/app/api/auth/2fa/disable/route.ts`

**FIX:**
The TOTP disable endpoint does not mark the submitted code as used in Redis. Once B-01 is fixed (so disable can actually succeed), a captured code could be replayed to disable 2FA on a user's account within the 30-second TOTP window. Fix: apply the same `totp:used:${userId}:${code}` Redis check used in the verify and admin TOTP routes.

---

### S-06 — Telegram Bot: Empty String Email on User Creation

**FILES:**
- `apps/web/app/api/auth/telegram/bot/route.ts`

**FIX:**
When a new user is created via the Telegram bot auth flow, the INSERT includes `email: ""` (an empty string literal). The Telegram protocol does not provide an email address. The `users` table has a partial unique index `ON users(email) WHERE email IS NOT NULL` — an empty string bypasses the `IS NOT NULL` filter and would collide if two Telegram-only users are created. Additionally, the `username` field may not be set in the bot auth path. Fix: pass `null` (not `""`) for email when creating Telegram-auth users so the partial unique index is correctly skipped; ensure `username` is set to the Telegram username or a generated unique handle.

---

### S-07 — DodoPay: No Circuit Breaker

**FILES:**
- `apps/web/lib/payments/dodopayments.ts`
- `apps/web/lib/payments/paystack.ts` (reference implementation)

**FIX:**
`lib/payments/paystack.ts` wraps all external Paystack API calls in a Redis-backed circuit breaker that opens after consecutive failures, preventing cascading load on a degraded payment provider. `lib/payments/dodopayments.ts` has no equivalent — every call is a direct HTTP fetch with no failure tracking. If DodoPay's API becomes slow or unavailable, all international payment flows will hang for the full request timeout. Fix: extract the circuit breaker logic from `paystack.ts` into a shared utility (e.g. `lib/payments/circuitBreaker.ts`) and apply it to the DodoPay client with the same open/half-open/closed state machine.

---

### L-01 — TOTP Implementation Duplicated Across 4+ Routes

**FILES:**
- `apps/web/app/api/auth/2fa/setup/route.ts`
- `apps/web/app/api/auth/2fa/disable/route.ts`
- `apps/web/app/api/creator/bank-account/route.ts`
- `apps/web/app/api/admin/auth/totp/route.ts`
- `apps/web/lib/auth/totp.ts` (canonical source that should be used)

**FIX:**
The `base32Decode`, `computeTotp`, `generateTOTP`, and `verifyTOTP` functions from `lib/auth/totp.ts` are copy-pasted inline into at least four separate route files. Each copy can drift independently — as demonstrated by B-01 and B-02 where the copies omit the `decryptField()` call that the canonical version implicitly requires. Fix: delete all inline TOTP implementations and import `{ verifyTOTP, generateTOTP }` from `lib/auth/totp.ts` in every route that needs TOTP functionality.

---

### L-02 — Referral Commissions Always Recorded as Zero

**FILES:**
- `apps/web/lib/referrals/commissions.ts`

**FIX:**
The `recordReferralCommission()` function inserts with `commission_kobo` and `purchase_amount_kobo` both set to `0` (or bound to the wrong parameter position). The 5% Tier-1 and 2% Tier-2 commission amounts are correctly computed in variables before the INSERT, but the values are never passed into the query. The entire referral commission ledger is therefore a table of zero-value rows. Fix: pass the computed `commissionKobo` and `purchaseAmountKobo` values as explicit query parameters in the INSERT statement at the correct positional indices.

---

### L-03 — Mystery XP Drop: No Idempotency Key

**FILES:**
- `apps/web/lib/mystery/xpDrop.ts`

**FIX:**
`triggerMysteryDrop()` calls `safeAwardXP(userId, amount, 'main', 'mystery_drop', null)`. With `reference_id = null`, the XP ledger's partial unique index (`ON CONFLICT ... WHERE reference_id IS NOT NULL`) does not fire — there is no deduplication at the database level. If the CRON runs twice due to a transient failure and retry, or if two CRON instances overlap, the same user receives double XP. Fix: generate a deterministic `reference_id` per drop batch, e.g. `mystery_drop:${batchId}:${userId}`, and pass it to `safeAwardXP` as `referenceId`.

---

### L-04 — Mystery XP Drop: Modulo Bias in `randomInt()`

**FILES:**
- `apps/web/lib/mystery/xpDrop.ts`

**FIX:**
`randomInt(min, max)` computes `min + (crypto.getRandomValues(new Uint32Array(1))[0] % range)`. When `range` does not evenly divide `2^32`, lower values in the range appear slightly more often — the classic modulo bias. Fix: replace with Node's built-in `crypto.randomInt(min, max + 1)` which uses rejection sampling internally to produce a uniform distribution.

---

### L-05 — Flash XP Notifications: `ON CONFLICT DO NOTHING` Without Conflict Target

**FILES:**
- `apps/web/lib/events/flashXP.ts`

**FIX:**
The bulk notification INSERT for flash XP event announcements uses `ON CONFLICT DO NOTHING` without specifying an explicit conflict target. In PostgreSQL this suppresses violations on any unique constraint on the table, which is fragile — if the `notifications` table's unique constraint changes, the behaviour of this INSERT changes silently. More importantly, it provides no guarantee about which conflicts are being tolerated. Fix: if flash XP notifications need deduplication, add a unique constraint on `(user_id, reference_id)` in the notifications table and use an explicit `ON CONFLICT (user_id, reference_id) DO NOTHING` target.

---

### L-06 — Google Auth: Username Generator Over-Matches with LIKE

**FILES:**
- `apps/web/app/api/auth/google/callback/route.ts`

**FIX:**
`uniqueUsername()` queries `WHERE username LIKE '${base}%'` to find all taken usernames starting with the base name. This correctly identifies `john123` when base is `john`, but also matches `johnwick`, `johndoe`, and `johnnybravo` — inflating the collision count and causing unnecessary numeric suffix generation (e.g. a user named "John" might get `john2` even though `john` is available). Fix: change the query to match only the exact base or numerically suffixed variants, e.g. `WHERE username = $1 OR username ~ '^' || quote_literal(base) || '[0-9]+$'`.

---

### L-07 — Offline Message Queue: `getQueueCounts()` Always Returns 0

**FILES:**
- `apps/web/lib/offline/messageQueue.ts`

**FIX:**
`getQueueCounts()` enumerates all messages from IndexedDB but only increments counters for messages with `status === 'pending'`. For all other statuses (`'failed'`, `'sent'`, etc.) no counter is incremented, so the function always returns `{ pending: N, failed: 0, sent: 0 }`. The UI will never surface failed message counts. Fix: ensure every expected status branch increments the corresponding counter in the accumulation logic.

---

### L-08 — Re-engagement: Duplicate 90-Day Bucket Messages

**FILES:**
- `apps/web/lib/notifications/reengagement.ts`

**FIX:**
The 90-day inactive user re-engagement message array contains two entries with identical body text. The second entry is dead — only the first matching message is used from each bucket. Fix: replace the duplicate body with a distinct, meaningfully different message to give the re-engagement sequence variation at the 90-day mark.

---

### L-09 — Leaderboard Weighted Scoring: Dead Code Functions

**FILES:**
- `apps/web/lib/leaderboards/engine.ts`

**FIX:**
`calculateWeightedScore()` and `getUserMetricsForWeighting()` compute a composite score from message volume, gift sending, room activity, and guild wars. Neither function is called anywhere — the snapshot CRON uses raw `xp_value` ordering. The functions add misleading complexity about how rankings actually work. Fix: either wire these functions into the snapshot materialization step (so weighted scoring is actually applied) or remove them and add a comment that leaderboards are sorted by raw XP.

---

### L-10 — Manifest: Dead Code `feat()` Function

**FILES:**
- `apps/web/lib/manifest/index.ts`

**FIX:**
The `feat()` helper is exported but never imported or called anywhere in the codebase. Fix: either start using `feat()` throughout the codebase to replace direct `getManifest()` key lookups, or remove it to avoid unmaintained dead code.

---

### L-11 — AI Classifier: Misleading `fallbackResult("gemini")` Label

**FILES:**
- `apps/web/lib/moderation/aiClassifier.ts`

**FIX:**
When both the primary (DeepSeek) and secondary (Gemini) AI moderation providers fail, `fallbackResult("gemini")` is called. This logs and returns a result indicating `provider: "gemini"` even though Gemini itself also failed — it was not the provider that generated the result. Audit logs will incorrectly attribute moderation decisions to Gemini for what is actually a graceful-degradation default. Fix: call `fallbackResult("none")` or `fallbackResult("fallback")` in this case to accurately reflect that neither provider produced the result.

---

### L-12 — Shared Types: Duplicate `'gift_received'` in CoinTransactionType

**FILES:**
- `shared/types/index.ts`

**FIX:**
The `CoinTransactionType` union type lists `'gift_received'` twice. TypeScript silently deduplicates union members so there is no compile error, but the duplicate creates confusion when reading the type and makes future maintenance harder. Fix: remove the duplicate entry.

---

### A-01 — Drizzle Schema Massively Out of Sync With SQL Migrations

**FILES:**
- `apps/web/lib/db/schema.ts`
- `apps/web/db/migrations/001_complete_schema.sql` (authoritative)
- `apps/web/db/migrations/002` through `014` (additive changes)

**FIX:**
`lib/db/schema.ts` is the Drizzle ORM TypeScript representation of the database, but it is severely incomplete relative to the SQL migrations. Dozens of tables and hundreds of columns present in the migrations are absent from the Drizzle schema: `user_pins`, `telegram_login_states`, `star_ledger`, `nemesis_assignments`, `season_rank_archives`, `sticker_packs`, `user_sticker_packs`, `flash_xp_events`, `platform_events`, `monthly_gift_drops`, `elder_requests`, `elder_mentorships`, `announcement_modals`, `announcement_banners`, `admin_messages`, `telegram_delivery_queue`, `admin_audit_log`, `community_notes`, `platform_council_members`, `platform_council_ideas`, `creator_bank_accounts`, `creator_wallet_addresses`, `payout_dead_letter_queue`, `guild_alliances`, `guild_alliance_members`, `hall_of_fame`, `failed_xp_awards`, `audit_log`, and more. Even for tables present in both (e.g. `guilds`, `guild_members`), the Drizzle schema is missing many columns (`captain_id`, `member_count`, `contribution_score`, `war_points_total`, `below_min_since`, etc.). Because all raw SQL queries in the codebase use the `db.query()` adapter directly (bypassing Drizzle's query builder), this out-of-sync schema does not currently cause runtime failures. However, any future Drizzle query builder usage will have incorrect types, and Drizzle migration tooling cannot be used reliably. Fix: run `drizzle-kit introspect` against the live database (or script a schema re-generation from the SQL migration files) to bring `schema.ts` into full alignment with the actual database state.

---

### A-02 — `computeTotp()` Unnecessarily Async

**FILES:**
- `apps/web/lib/auth/totp.ts`

**FIX:**
`computeTotp()` is declared `async` and returns a `Promise<string>` despite containing no `await` expressions or asynchronous I/O. Every call creates an unnecessary microtask and requires all callers to `await` it, adding overhead on the hot path of every TOTP verification. Fix: change the function signature to synchronous (`function computeTotp(secret: string, counter: number): string`) and update all call sites.

---

---

### N-01 — CRON Patron Badge: Wrong Column `coin_value` on `gifts` Table

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` (step 13)

**FIX:**
The patron badge CRON step queries `SUM(coin_value) AS total_coins FROM gifts` to identify the top gifter per room. The `gifts` table (created in migration 011) has a column `coin_cost`, not `coin_value`. Postgres will throw "undefined column", the entire step fails silently (swallowed by the try/catch), and no patron badges are ever awarded. This is the same pattern as B-10. Fix: replace `coin_value` with `coin_cost` in the patron badge query.

---

### N-02 — CRON Monthly Plan Bonus: `ON CONFLICT` Target Mismatch on `coin_ledger`

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` (step 21)

**FIX:**
The monthly plan bonus INSERT uses `ON CONFLICT (reference_id) DO NOTHING`, targeting a single-column conflict on `reference_id`. The actual unique index on `coin_ledger` is `uidx_coin_ledger_type_ref` defined as `(transaction_type, reference_id) WHERE reference_id IS NOT NULL` — a composite partial index, not a single-column index. In PostgreSQL, `ON CONFLICT (reference_id)` fails with "there is no unique or exclusion constraint matching the ON CONFLICT specification" because no index exists on `reference_id` alone. This error is caught by the transaction's try/catch, but it is not a `23505` (unique violation) code, so it falls into the `else` branch, which appends it to `errors`. The result: monthly coin bonuses for all plan tiers are never distributed. Fix: replace `ON CONFLICT (reference_id) DO NOTHING` with `ON CONFLICT (transaction_type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING` to match the actual partial unique index.

---

### N-03 — Expo Mobile: Telegram Login State Token Uses `Math.random()`

**FILES:**
- `apps/expo/app/auth/login.tsx`

**FIX:**
The Telegram login flow generates a state token by computing `SHA-256(Date.now() + '-' + Math.random())` then truncating to 16 hex characters. `Math.random()` is not cryptographically secure — in V8 (the JS engine used by React Native/Hermes), it uses a seeded PRNG that can be predicted given knowledge of prior output or initial seed. Combined with `Date.now()` as the only other entropy source, the state token may be predictable by an attacker who can observe timing. A predicted state token could be used to forge a Telegram login callback. Fix: replace `Math.random()` with `Crypto.getRandomValues()` from `expo-crypto` (or use `Crypto.getRandomBytesAsync(16)`) to generate the state directly from a CSPRNG, then hex-encode. Remove the unnecessary SHA-256 step.

---

### N-04 — Admin Banner CRUD: POST, PUT, DELETE All Write Non-Existent Columns

**FILES:**
- `apps/web/app/api/admin/announcements/banners/route.ts`
- `apps/web/app/api/admin/announcements/banners/[bannerId]/route.ts`

**FIX:**
Beyond the GET read issue (B-07), the write operations are also broken at the DB level. The POST INSERT includes `title` and `link_url` in the column list and parameterises their values — Postgres rejects the INSERT with "column does not exist". The PUT UPDATE's dynamic SET clause builder adds `title = $N` and `link_url = $N` when those fields are in the request body — same error. The DELETE soft-deletes via `SET deleted_at = NOW()` — Postgres rejects this because `deleted_at` doesn't exist (B-08). All admin banner management operations fail. Fix: apply the migration from B-07 (add `title`, `link_url`) and B-08 (add `deleted_at`) so all CRUD operations have the columns they expect.

---

## Code Quality Rating

### Current State (37 total bugs found)

| Dimension | Rating | Notes |
|---|---|---|
| **Performance** | 7/10 | Solid Redis caching, atomic SQL CTEs, connection pooling. Gaps: unnecessary async in TOTP hot path; mystery drop has no idempotency causing potential retry double-awards; CRON guild loops run N×M DB queries per guild instead of batch SQL; re-engagement context fetches fire N concurrent DB queries per inactive user. |
| **Structure / Architecture** | 6/10 | Good lib/ vs app/api/ separation in most areas. Undermined by 4+ copies of TOTP code, several dead-code functions, a Drizzle schema that falsely implies type safety, and the announcement banner subsystem with multiple callers all expecting the same missing columns. |
| **Implementation Correctness** | 4.5/10 | Multiple core features are entirely non-functional at runtime: payout crashes (B-03), 2FA disable always fails (B-01), bank account gate always rejects (B-02), admin overview always 500s (B-05), entire announcement subsystem broken (B-07, B-08, N-04), DodoPay webhook crashes on error path (B-09), fraud scoring errors (B-10, N-01), commissions always zero (L-02), monthly plan bonuses never distributed (N-02). |
| **Security** | 7/10 | Strong foundations: JWT key rotation design, CSRF state tokens, Redis anti-replay, SSRF guard, CSP nonces, timing-safe comparisons in most places. Gaps: middleware bypasses JWT rotation (S-01), safeFetch breaks TLS (S-02), Telegram bot timing-unsafe (S-03), 2FA setup/disable lack replay protection (S-04, S-05), Expo state token weak randomness (N-03). |

### Projected Rating After All Bug Fixes Applied

| Dimension | Rating | Notes |
|---|---|---|
| **Performance** | 8/10 | Mystery drop idempotency, synchronous TOTP, DodoPay circuit breaker, correct randomInt — removes failure amplification and redundant microtasks. CRON batching remains a future improvement. |
| **Structure / Architecture** | 8.5/10 | Single shared TOTP module, weighted scoring wired or removed, dead code cleared, schema.ts regenerated. The announcement subsystem fully operational with correct schema. |
| **Implementation Correctness** | 9/10 | All runtime-breaking bugs resolved: payouts work, 2FA disable works, bank account security gate works, admin dashboard works, full announcement system works, DodoPay webhook stable, fraud detection fires correctly, commissions and monthly bonuses recorded accurately. |
| **Security** | 9/10 | JWT multi-key rotation wired through middleware, TLS-preserving SSRF, timing-safe everywhere, replay protection on all TOTP endpoints, CSPRNG for Expo state tokens. Near production-hardened. |

---

## What Would Get to 9.5+

Fixing all 37 bugs reaches approximately 8.5–9/10. The remaining gap to 9.5+ requires the following improvements beyond bug fixes:

**Performance (to reach 8.5+ on that dimension):**
- CRON guild tier demotion/promotion loops run N sequential DB queries per guild (one for demotion check, one for notification, one for tier_history INSERT). With 500+ guilds this becomes thousands of sequential round-trips. Refactor into batch-capable set SQL using `UPDATE ... FROM (VALUES ...) WHERE` patterns or temporary tables.
- The re-engagement CRON step fires `Promise.all(inactiveUsers.map(async (user) => db.query(...)))` — N concurrent DB connections for potentially hundreds of inactive users simultaneously. Cap concurrency with a semaphore or batch into a single SQL query using `unnest`.
- `sendEmail()` in the re-engagement loop is called individually per user rather than batched. Batch email sends to the email provider.

**Correctness / Completeness (to reach 9.5+ on that dimension):**
- Add a unique constraint on `dm_conversation_score_milestones(user_id_a, user_id_b, milestone_score)` so the ON CONFLICT guard in the CRON actually provides dedup protection rather than relying solely on the SELECT check.
- `coin_ledger`'s unique index is `(transaction_type, reference_id)` but `ON CONFLICT (reference_id)` appears in multiple places — audit all coin_ledger INSERTs for correct ON CONFLICT target usage.
- Regenerate Drizzle `schema.ts` from the live database (A-01) so TypeScript type safety covers all tables.

**Security (to reach 9.5+ on that dimension):**
- Add `JWT_SECRET_<kid>` environment variables to `lib/env.ts` so key rotation variables are validated at startup (currently the env schema only declares `JWT_SECRET`).
- Add rate limiting to the Telegram login state polling endpoint in the Expo app to prevent enumeration of short state tokens.
- Review and enforce `Content-Security-Policy` nonce propagation to the Expo mobile WebView if used.

**Testing (to reach 9.5+ overall):**
- Integration tests for the critical payment flows (Paystack webhook → coin credit → subscription activation) and XP award paths (`safeAwardXP` + DLQ retry).
- Unit tests for `verifyToken` multi-key path, `safeFetch` SSRF guard, and `enforceRateLimit` Lua script correctness.
- End-to-end tests for auth flows: Google OAuth, Telegram bot login, 2FA setup/verify/disable cycle, PIN setup/verify.

---

*Report updated: 2026-06-15 at 11:35 AM*
*Analyst: Claude (claude-sonnet-4-6) — Zobia Codebase Forensic Analysis (second pass complete)*
*Branch: claude/codebase-bug-analysis-ulrfvp*
