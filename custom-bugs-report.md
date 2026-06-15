# Zobia Social — Comprehensive Bug & Code Quality Report

**Generated:** June 15, 2026 at 06:00 AM  
**Scope:** Full forensic analysis — `apps/web` (Next.js 14 App Router), `apps/expo` (React Native/Android), PWA service worker  
**Method:** Deep static analysis, three full sweeps across all files, schema cross-referenced against all callers  
**Branch:** `claude/codebase-bug-analysis-z1fnxx`

---

## Quick Summary — All Bugs Found (numbered list)

1. SSRF-DNS-01: DNS rebinding protection disabled — pinnedIp discarded, raw URL fetched twice
2. WEBHOOK-PAY-01: Paystack webhook silently drops events on Redis idempotency failure
3. WEBHOOK-DODO-01: DodoPayments webhook same Redis-drop issue; coin grant amount not validated against product catalogue
4. PAYOUT-NC-01: Payout failure recovery retries with gross_kobo instead of net_kobo
5. XP-MSG-01: Room message XP uses roomId as reference_id — unique constraint caps XP to 1 award per room ever
6. SCHEMA-UXT-01: CRON step 27 queries non-existent `user_xp_tracks` table
7. SCHEMA-BADGE-01: `user_badges` has no UNIQUE(user_id, badge_key) constraint and no `awarded_at` column — CRON step 30 fails
8. SCHEMA-ROOM-01: `rooms` table has no `status` or `drop_ends_at` column — CRON drop-room step fails
9. SCHEMA-STORE-01: `store_items` table has no `coins_granted` or `currency` columns — coin purchase route fails
10. IAP-ANNUAL-01: Annual subscription productIds excluded from IAP verify schema — all annual purchases rejected
11. QUEST-SRC-01: Quest deck pre-check uses wrong source string, bypassing idempotency guard
12. WAR-LIMIT-01: findWarOpponent LIMIT 20 + JS filter causes false-empty opponent results
13. CRON-LOGIN-01: Login streak uses `last_login_date` (date) but XP check uses `last_login_at` (timestamptz) — inconsistent date columns
14. DM-DEDUP-01: DM duplicate-message check only queries `room_messages`, misses true DM messages
15. EXPO-TOKEN-01: Expo auth restores stale/expired token from SecureStore without server validation
16. SUB-PLAN-01: Paystack subscription silently defaults unknown plan codes to "pro"
17. RL-GLOBAL-01: Global rate limiter INCR + EXPIRE are non-atomic — race condition allows burst bypass
18. COIN-PROV-01: Coin purchase ignores user-supplied `paymentProvider` — always uses manifest primary
19. PAYOUT-WEEKLY-01: Weekly auto-payout sets both `net_kobo` and `gross_kobo` to candidate's gross balance; `platform_fee_kobo` never populated
20. REFERRAL-RACE-01: Referral streak CRON processes rows without `SELECT FOR UPDATE` — concurrent runs double-award
21. REFERRAL-XP-01: Referral streak XP INSERT has no `reference_id` — duplicate XP if CRON retries
22. JWT-KID-01: JWT key ID (`kid`) rotation is an unimplemented stub — live key rotation would invalidate all sessions globally
23. CRON-WAR-TX-01: Alliance war XP ledger INSERT and user UPDATE are separate statements with no enclosing transaction
24. DEAD-CODE-01: `throw badRequest(...)` in 2FA verify route is unreachable dead code after a block that always returns or throws

---

## Detailed Bug Entries

---

### 1. SSRF-DNS-01: DNS Rebinding Protection Bypassed

**Description:** `validateOutboundUrl()` calls `await resolveAndValidateHostname(hostname)` but discards the returned `{ pinnedIp }` value. The function then returns `fetchUrl: rawUrl` (the original, un-pinned URL). When `safeFetch()` calls `fetch(fetchUrl)`, the Node.js runtime performs a second DNS lookup — creating an exact TOCTOU window for a DNS rebinding attack. The attacker returns a public IP on the first lookup (passes validation) then swaps to a private/metadata IP on the second lookup (actual fetch). The code comment even acknowledges this: "We resolve and validate the hostname but use the original URL for the actual fetch so that TLS SNI and certificate validation work correctly."

**FILES:**
- `apps/web/lib/security/ssrf.ts` — `validateOutboundUrl()` lines ~205–245, `safeFetch()` lines ~275–380

**FIX:** Return the pinned IP in `fetchUrl` (e.g., replace `parsed.hostname` with `pinnedIp` in the URL). Set the `Host` header to `originalHostname` in `safeFetch()` so TLS SNI still works. This is the standard DNS-rebinding-safe pattern. Alternatively, use Node.js `http.request` with the explicit `lookup` option pinned to the pre-validated IP.

---

### 2. WEBHOOK-PAY-01: Paystack Webhook Silently Drops Events on Redis Failure

**Description:** The Paystack webhook handler stores a Redis idempotency key before processing each event. If `redis.set(...)` throws (Redis unavailable), the error is caught with `.catch(() => null)`, the handler proceeds as if idempotency never ran, BUT the event is also not re-queued. More critically, if the Redis SET succeeds but the downstream DB write fails, the idempotency key is already written — the event can never be retried. There is no transactional link between the Redis key and the database operation.

**FILES:**
- `apps/web/app/api/economy/webhooks/paystack/route.ts`

**FIX:** Do not catch Redis errors silently. Either: (a) fail the webhook with a 500 so Paystack retries it (preferred — idempotency key is only written after successful processing), or (b) implement a two-phase approach: write idempotency key only after the DB transaction commits. Also log Redis failures as critical alerts.

---

### 3. WEBHOOK-DODO-01: DodoPayments Webhook Redis Drop + Coin Grant Tamper

**Description:** Same silent Redis `.catch(() => null)` pattern as WEBHOOK-PAY-01. Additionally, the coin grant amount is read from the webhook payload (`event.data.coins_granted`) rather than from the server-side product catalogue. An attacker who can replay or forge a webhook (e.g., during the window before HMAC verification) could supply an inflated `coins_granted` value.

**FILES:**
- `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

**FIX:** Same Redis fix as WEBHOOK-PAY-01. For coin amount: after verifying the HMAC signature, look up the `productId` in the server-side product catalogue (DB or env config) and use that server-authoritative `coins_granted` value — never trust the payload amount.

---

### 4. PAYOUT-NC-01: Payout Failure Recovery Uses Gross Instead of Net

**Description:** In `lib/payments/payouts.ts`, when a payout fails and is retried, the recovery path fetches `gross_kobo` from the failed payout record and uses that as the transfer amount. The `net_kobo` (after platform fee deduction) is what should actually be sent to the user. This means retried payouts over-transfer by the platform fee amount.

**FILES:**
- `apps/web/lib/payments/payouts.ts`

**FIX:** In the retry path, use `net_kobo` (not `gross_kobo`) as the transfer amount. Ensure the payout record always stores both fields correctly (see also PAYOUT-WEEKLY-01 below which causes `net_kobo` to be wrong in the first place).

---

### 5. XP-MSG-01: Room Message XP Capped at 1 Award Per Room Forever

**Description:** `maybeAwardMessageXP()` in the room messages route calls `safeAwardXP()` with `source = 'message'` and `referenceId = roomId`. The `xp_ledger` table has a partial unique index: `UNIQUE(user_id, source, reference_id) WHERE reference_id IS NOT NULL`. Since `roomId` is a UUID (never null), this index is active. After the very first message a user sends in a room, the `(userId, 'message', roomId)` triple is taken. Every subsequent message XP INSERT hits the `ON CONFLICT DO NOTHING` clause — the ledger row is silently skipped, the UPDATE never fires (CTE), and the user gets no XP. The bug silently caps message XP at exactly 1 award per room, per user, for the lifetime of the room.

**FILES:**
- `apps/web/app/api/rooms/[roomId]/messages/route.ts` — `maybeAwardMessageXP()` function
- `apps/web/lib/xp/safeAwardXP.ts`
- `apps/web/lib/db/schema.ts` — `xp_ledger` unique index definition

**FIX:** Pass the individual `messageId` (or a composite like `msg_${messageId}`) as the `referenceId`, not the `roomId`. This makes each message award idempotent per message, not per room. Also add the daily-cap check before the INSERT so the idempotency key only gets consumed for awards that actually intended to fire.

---

### 6. SCHEMA-UXT-01: CRON Step 27 Queries Non-Existent Table

**Description:** CRON step 27 (earnable sticker packs) queries `user_xp_tracks` with a JOIN on `users`. This table does not exist in the Drizzle schema (`schema.ts`). XP tracks are stored as columns directly on the `users` table (`xp_social`, `xp_creator`, etc.). This query always throws a PostgreSQL relation-not-found error, causing step 27 to fail silently every day.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — step 27
- `apps/web/lib/db/schema.ts` — `users` table (XP columns present here, no `user_xp_tracks` table)

**FIX:** Rewrite the step 27 query to read XP track values directly from the `users` table columns (`xp_social`, `xp_creator`, `xp_knowledge`, etc.) instead of joining `user_xp_tracks`.

---

### 7. SCHEMA-BADGE-01: user_badges Missing Unique Constraint and Column

**Description:** CRON step 30 (Master Teacher badge award) runs:
```sql
INSERT INTO user_badges (user_id, badge_key, ..., awarded_at)
VALUES (...)
ON CONFLICT (user_id, badge_key) DO NOTHING
```
The `user_badges` table in the Drizzle schema has no unique index on `(user_id, badge_key)` and no `awarded_at` column. The `ON CONFLICT` clause references a constraint that does not exist — PostgreSQL will throw an error. Every user who qualifies for this badge will cause the CRON step to error out.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — step 30
- `apps/web/lib/db/schema.ts` — `userBadges` table definition

**FIX:** Add a unique index on `(user_id, badge_key)` to `user_badges` in the schema and create the corresponding migration. Add the `awarded_at timestamptz` column. Alternatively, restructure the query to check for existence before inserting.

---

### 8. SCHEMA-ROOM-01: rooms Table Missing status and drop_ends_at Columns

**Description:** The CRON drop-room expiry step runs:
```sql
UPDATE rooms SET is_active = FALSE, status = 'closed' WHERE ...
```
The `rooms` table in the Drizzle schema has no `status` column and no `drop_ends_at` column. This UPDATE statement fails at runtime with a column-not-found PostgreSQL error every time the CRON tries to expire a drop room.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — drop room expiry step
- `apps/web/lib/db/schema.ts` — `rooms` table definition

**FIX:** Add `status varchar(20)` (or an enum) and `drop_ends_at timestamptz` columns to the `rooms` table schema and generate a migration. Update the CRON query to use these columns once they exist.

---

### 9. SCHEMA-STORE-01: store_items Missing coins_granted and currency Columns

**Description:** The coin purchase route queries:
```sql
SELECT id, name, item_type, price_kobo, currency, coins_granted, is_active FROM store_items
```
The `store_items` table in the Drizzle schema has neither a `currency` column nor a `coins_granted` column (it has `price_coins` and `price_kobo`). This SELECT fails at runtime with a column-not-found error, making the coin purchase endpoint completely broken.

**FILES:**
- `apps/web/app/api/economy/coins/purchase/route.ts` — line ~89
- `apps/web/lib/db/schema.ts` — `storeItems` table definition

**FIX:** Either (a) add `coins_granted integer` and `currency varchar(3)` columns to `store_items` and migrate, or (b) rewrite the query to use the existing columns (`price_coins` as coins_granted, derive currency from `price_kobo > 0`). Option (b) requires no migration but assumes the column semantics align.

---

### 10. IAP-ANNUAL-01: Annual Subscription Products Rejected by IAP Verify

**Description:** The Expo app defines annual subscription products (`sub_plus_annual`, `sub_pro_annual`, `sub_max_annual`) in `ANNUAL_SUBSCRIPTION_PRODUCTS`. However, the IAP verify API route's Zod schema enum only includes monthly products: `sub_plus_monthly`, `sub_pro_monthly`, `sub_max_monthly`. Any annual subscription purchase sent to `/api/economy/iap/verify` is rejected with a 400 "Unknown productId" error. Annual subscribers cannot activate their subscriptions.

**FILES:**
- `apps/web/app/api/economy/iap/verify/route.ts` — `verifyIapSchema` enum
- `apps/expo/lib/payments/googlePlay.ts` — `ANNUAL_SUBSCRIPTION_PRODUCTS`

**FIX:** Add the annual product IDs to the `verifyIapSchema` enum and to the `SUBSCRIPTION_PRODUCTS` server-side map in the verify route. Ensure the plan mapping for annual products correctly maps to the appropriate subscription tier.

---

### 11. QUEST-SRC-01: Quest Deck Pre-Check Wrong Source String

**Description:** The quest engine's deck pre-check (used before awarding a quest completion) queries the `xp_ledger` for an existing entry using a different `source` string than the one actually written during completion. If the pre-check source doesn't match the insert source, the idempotency guard never matches an existing row — the same quest can be completed and XP-awarded multiple times.

**FILES:**
- `apps/web/lib/quests/questEngine.ts`
- `apps/web/lib/xp/safeAwardXP.ts`

**FIX:** Audit the `source` string used in the pre-check query against the `source` value passed to `safeAwardXP()` at completion. Make them identical. Consider extracting quest source strings as named constants to prevent future drift.

---

### 12. WAR-LIMIT-01: findWarOpponent LIMIT 20 + JS Filter Yields False-Empty Results

**Description:** `findWarOpponent()` in `warEngine.ts` fetches `LIMIT 20` candidate guilds from the DB, then filters them in JavaScript (to exclude the requesting guild and already-warring guilds). If all 20 DB rows are filtered out in JS (e.g., in a cluster of active guilds), the function returns `null` (no opponent found) even though more eligible guilds exist beyond the LIMIT 20 window.

**FILES:**
- `apps/web/lib/guilds/warEngine.ts` — `findWarOpponent()` function

**FIX:** Move all exclusion conditions into the SQL query (`WHERE guild_id != $1 AND id NOT IN (SELECT ... FROM active_wars)`), so the DB returns only genuinely eligible candidates. The LIMIT then caps eligible results, not pre-filter candidates.

---

### 13. CRON-LOGIN-01: Login Streak and XP Check Use Different Date Columns

**Description:** The login streak logic in the daily CRON uses `last_login_date` (a `date` type column on `users`) to determine consecutive login days. The XP deduplication check in a different branch uses `last_login_at` (a `timestamptz` column). These two columns are updated independently — if they ever drift (e.g., one is updated but the other isn't due to a partial failure), users may receive duplicate streak XP or miss streak credits.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — login streak step
- `apps/web/lib/db/schema.ts` — `users` table (`lastLoginAt` timestamptz, `lastLoginDate` date)

**FIX:** Canonicalize on a single column. Derive "login date" from `last_login_at` (e.g., `DATE(last_login_at AT TIME ZONE 'UTC')`) rather than maintaining a separate `last_login_date` column. If the separate column is needed for performance, ensure both are updated atomically in the same UPDATE statement.

---

### 14. DM-DEDUP-01: DM Duplicate Check Only Queries Room Messages Table

**Description:** `detectDuplicateMessage()` in the anti-spam module checks for recent duplicate messages by querying `room_messages`. Direct messages (DMs) are stored in a separate `direct_messages` table. When called from a DM send handler, the duplicate check always scans the wrong table and never finds true DM duplicates, allowing spam floods in DM threads.

**FILES:**
- `apps/web/lib/messaging/antispam.ts` — `detectDuplicateMessage()`
- `apps/web/app/api/messages/dm/[userId]/route.ts` (or equivalent DM route)

**FIX:** Pass a `messageType` parameter (`'room' | 'dm'`) to `detectDuplicateMessage()` and branch to query either `room_messages` or `direct_messages` accordingly. Alternatively, implement a unified dedup check that queries both tables if needed.

---

### 15. EXPO-TOKEN-01: Expo Auth Restores Stale Token Without Validation

**Description:** On app launch, `AuthContext` in the Expo app reads the access token from `SecureStore` and sets it directly as the authenticated state without verifying it against the server. If the token is expired, revoked (server-side session invalidated), or from a different device session that was logged out, the app presents the user as authenticated until they make an API call and receive a 401. On a slow connection, this window can be significant — the user sees authenticated UI and may trigger actions before the 401 is caught.

**FILES:**
- `apps/expo/lib/auth/context.tsx` — token restore on launch

**FIX:** After restoring from SecureStore, decode the JWT client-side and check the `exp` claim. If expired (or within the last N seconds), immediately attempt a silent token refresh before setting authenticated state. If refresh fails, treat as unauthenticated. This prevents stale-session UI flicker and premature authenticated renders.

---

### 16. SUB-PLAN-01: Unknown Paystack Plan Code Defaults to "pro"

**Description:** When mapping a Paystack plan code to a subscription tier, the function falls back to `"pro"` if the plan code is unrecognized. This means a misconfigured or stale plan code silently grants "pro" tier access instead of failing loudly. This is a security/billing correctness issue — users whose webhook carries an unrecognized plan code get an unintended (potentially over-privileged or under-privileged) subscription level.

**FILES:**
- `apps/web/lib/payments/paystack.ts` — plan code to tier mapping

**FIX:** Remove the default fallback. If a plan code is not in the known mapping, throw or return an error so the webhook handler can log the discrepancy, alert, and not activate a subscription tier. The webhook should return 200 to Paystack (to prevent retries) but record the anomaly as a system alert.

---

### 17. RL-GLOBAL-01: Global Rate Limiter INCR + EXPIRE Not Atomic

**Description:** The global rate limiter in `lib/security/rateLimit.ts` uses two separate Redis commands: `INCR key` followed by `EXPIRE key window`. Between these two commands, another request could see a key without a TTL (if `INCR` created a new key and the `EXPIRE` hasn't run yet), or a Redis restart could leave a persistent counter. The per-user sliding window uses a Lua script (atomic), but the global counter uses the non-atomic two-command pattern.

**FILES:**
- `apps/web/lib/security/rateLimit.ts` — global rate limit section

**FIX:** Replace the `INCR` + `EXPIRE` pair with a Lua script (like the per-user sliding window already uses), or use `SET key 1 EX window NX` for initialization plus `INCR` only if key exists, or use Redis `SET ... GET` atomics. The simplest fix: a single Lua script that INCRs, sets TTL only on first creation, and returns the count.

---

### 18. COIN-PROV-01: Coin Purchase Ignores User-Supplied paymentProvider

**Description:** The coin purchase route accepts a `paymentProvider` field in the request body (it's in the Zod schema) but never uses it. The code always reads `manifest.payment.primaryProvider` to determine which payment gateway to use. A user who explicitly requests a secondary provider (e.g., DodoPayments when primary is Paystack) will always be routed to the primary — this can fail if the primary is down and a fallback is intended.

**FILES:**
- `apps/web/app/api/economy/coins/purchase/route.ts` — lines ~41–42, ~157

**FIX:** If `paymentProvider` is supplied in the request and is a valid/configured provider, use it. Fall back to `manifest.payment.primaryProvider` only when not supplied. Validate that the requested provider is active/configured before using it.

---

### 19. PAYOUT-WEEKLY-01: Weekly Payout Sets net_kobo = gross_kobo = balance

**Description:** CRON step 32 (weekly payouts) inserts a payout record with:
```sql
net_kobo = $2, gross_kobo = $2
```
where `$2 = candidate.balance_kobo` (the user's full gross balance). Both `net_kobo` and `gross_kobo` are set to the same gross value. The `platform_fee_kobo` column is never populated (defaults to 0 or null). The actual platform fee deduction presumably happens, but the payout record permanently misrepresents what was deducted. This also affects PAYOUT-NC-01's retry path which reads `net_kobo` — if net was never properly set, retries transfer the wrong amount.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — step 32 weekly payout INSERT
- `apps/web/lib/payments/payouts.ts`

**FIX:** Calculate the fee split before the INSERT:
- `gross_kobo = candidate.balance_kobo`
- `platform_fee_kobo = Math.round(gross_kobo * FEE_RATE)`
- `net_kobo = gross_kobo - platform_fee_kobo`

Insert all three correctly, then use `net_kobo` as the actual transfer amount.

---

### 20. REFERRAL-RACE-01: Referral Streak CRON Has No Row Locking

**Description:** CRON step 33 (referral streak qualifying) fetches referral rows and processes them sequentially without `SELECT FOR UPDATE` (or `SKIP LOCKED`). If two CRON instances overlap (e.g., the external CRON fires twice, or a slow run is still in-flight when the next one starts), both instances read the same qualifying rows, process them, and award XP/commissions twice.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — step 33 referral streak section

**FIX:** Add `FOR UPDATE SKIP LOCKED` to the SELECT query so concurrent instances each claim a disjoint set of rows. Alternatively, use a distributed lock (Redis `SET NX`) at the start of the CRON to ensure only one instance runs the referral step at a time.

---

### 21. REFERRAL-XP-01: Referral Streak XP Insert Has No reference_id

**Description:** The referral streak XP award in CRON step 33 calls `safeAwardXP()` without a `referenceId`. Without a `reference_id`, the `xp_ledger` partial unique index (`WHERE reference_id IS NOT NULL`) does not apply — there is no idempotency guard on these inserts. If the CRON retries or the step runs twice (see REFERRAL-RACE-01), users receive duplicate referral streak XP awards.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — step 33 referral streak XP award
- `apps/web/lib/xp/safeAwardXP.ts`

**FIX:** Generate a deterministic `referenceId` such as `referral_streak_${referralId}_${dateStr}` (where `dateStr` is the CRON run date). Pass this as `referenceId` to `safeAwardXP()`. This makes each daily referral streak award exactly-once-per-referral-per-day.

---

### 22. JWT-KID-01: JWT Key Rotation Is an Unimplemented Stub

**Description:** `lib/auth/jwt.ts` includes `kid` (key ID) in the JWT header via `getCurrentKeyId()`, but `verifyAccessToken()` has a TODO: "decode header first, read kid, select secret from registry. For now all tokens verified against current secret regardless of kid." This means the key rotation infrastructure is wired up on the signing side but completely absent on the verification side. If the `JWT_SECRET` environment variable is rotated (the only actual key change possible), all currently-issued tokens become immediately invalid — there is no grace period or dual-verification window. This causes a hard global logout of all users on any secret rotation.

**FILES:**
- `apps/web/lib/auth/jwt.ts`

**FIX:** Implement the key registry lookup on verification: decode the JWT header to extract `kid`, look up the corresponding secret from a key registry (DB or env-keyed object), and verify against that secret. Maintain at least N-1 and current key in the registry so rotation can be done without invalidating live sessions. Mark old keys as retired (not deleted) with an expiry tied to the max token TTL (15 minutes for access tokens).

---

### 23. CRON-WAR-TX-01: Alliance War XP Not in a Transaction

**Description:** CRON step 32b (alliance war resolution) awards XP to war participants by running an `INSERT INTO xp_ledger` and then a separate `UPDATE users SET xp_total = ...`. These are two separate database statements with no enclosing transaction. If the `INSERT` succeeds but the `UPDATE` fails (or vice versa), the ledger and the user's displayed XP total become permanently inconsistent — the ledger shows XP that was never applied to the user, or the user's total is incremented with no ledger audit trail.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — step 32b alliance war XP
- `apps/web/lib/xp/safeAwardXP.ts`

**FIX:** This was already addressed architecturally in `safeAwardXP.ts` via the CTE pattern (single atomic statement). The CRON step should call `safeAwardXP()` instead of issuing raw SQL for war XP, which will use the existing CTE-based atomic pattern.

---

### 24. DEAD-CODE-01: Unreachable throw in 2FA Verify Route

**Description:** In `apps/web/app/api/auth/2fa/verify/route.ts`, after a code block that handles the pre-auth token flow (which always either returns a response or throws an error), there is a `throw badRequest("preAuthToken is required", "MISSING_TOKEN")` statement that can never be reached. This is dead code that could mislead future developers into thinking the throw is a meaningful guard, causing incorrect assumptions about the control flow.

**FILES:**
- `apps/web/app/api/auth/2fa/verify/route.ts` — line ~123

**FIX:** Remove the unreachable `throw` statement. If the intent was to guard against a missing token, move the guard to before the block that handles the token (as the first check in the handler). Add a TypeScript exhaustive check or comment to make control flow explicit.

---

## Code Quality Rating

| Dimension | Before Fixes | After Fixes |
|---|---|---|
| **Security** | 6/10 — SSRF bypass, race conditions on XP/referrals, stale token auth | 8.5/10 — DNS pinning, atomic locks, token validation |
| **Data Integrity** | 5/10 — Schema/code mismatches break core flows (purchases, badges, rooms), duplicate XP possible | 8.5/10 — All schema columns added, idempotency keys correct |
| **Correctness** | 5.5/10 — Coin purchase broken, annual IAP broken, message XP capped, payout amounts wrong | 9/10 — All identified flows work as intended |
| **Resilience** | 7/10 — DLQ pattern good, circuit breaker good, but webhooks drop events on Redis failure | 8.5/10 — Webhooks fail-safe to 500, events retried by provider |
| **Architecture** | 7.5/10 — CTE XP pattern is elegant, session management is solid, SSRF module well-structured | 8.5/10 — JWT kid rotation closes the last major architectural gap |
| **Overall** | **6.2/10** | **8.6/10** |

**Review:** The Zobia codebase demonstrates strong architectural intent — the CTE-based XP idempotency pattern, the SSRF `safeFetch` wrapper, the JWT/Redis session model, and the DLQ for failed awards are all well-designed. The critical gap is a systemic disconnect between the Drizzle schema (source of truth) and the CRON route which references multiple non-existent columns and tables, making several core daily operations silently fail. The XP message bug is particularly impactful as it silently caps a key engagement mechanic. After applying all 24 fixes, the codebase would be production-grade with a strong security and data-integrity posture.

---

*Report generated: June 15, 2026 at 06:00 AM*  
*Analyst: Claude Code forensic analysis — branch `claude/codebase-bug-analysis-z1fnxx`*
