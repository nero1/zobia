# Zobia Codebase — Forensic Bug Report

**Generated:** 2026-06-14 at 02:58 PM  
**Scope:** Web app (Next.js 14), PWA, Expo Android  
**Analyst:** Independent forensic pass — three full sweeps, no prior bug reports consulted  

---

## Pre-Fix Code Quality Rating

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | 7/10 | Well-structured monorepo, good separation of concerns, DLQ pattern is thoughtful |
| Security | 5/10 | KDF flaw is serious; CSRF bypass, spoofable IP header, and pre-auth type cast are significant |
| Data Integrity | 4/10 | Double XP credit (three locations), referral INSERT column mismatch, leaderboard NULL upsert are critical |
| Performance | 6/10 | N+1 HoF injection, non-atomic circuit breaker are notable; most paths are otherwise well-optimized |
| Code Quality | 6/10 | Generally clean; incomplete Drizzle schema, dead states, and inconsistent patterns drag it down |
| **Overall** | **5.5/10** | Solid foundation undermined by several critical runtime and data-integrity failures |

---

## All Bugs — Quick Reference List

1. **BUG-01 [CRITICAL]:** `safeAwardXP` double-credits XP — `ON CONFLICT DO NOTHING` silently skips the ledger INSERT but the `UPDATE users` balance increment always runs
2. **BUG-02 [CRITICAL]:** Same double-credit bug in `retryFailedXPAwards` — identical independent query pair, same structural flaw
3. **BUG-03 [CRITICAL]:** Same double-credit bug in `claimPassMilestone` for `xp_bonus` reward type in the season engine
4. **BUG-04 [CRITICAL]:** `referral_commissions` INSERT uses completely wrong column names — will throw a PostgreSQL column-not-found error at runtime, silently breaking the entire referral payout system
5. **BUG-05 [CRITICAL]:** `leaderboard_snapshots` upsert is broken for NULL `city`/`season_id` — PostgreSQL treats NULLs as distinct in unique constraints so `ON CONFLICT` never fires, causing duplicate rows to accumulate
6. **BUG-06 [CRITICAL]:** AES-256-GCM key derivation uses a bare SHA-256 hash instead of a proper KDF — no salt, no iteration count, low-entropy keys are brute-forceable
7. **BUG-07 [MODERATE]:** Duplicate 2FA columns in `users` schema — both `twoFaSecret`/`twoFaEnabled` and `totpSecret`/`totpEnabled` exist; ambiguous which is authoritative
8. **BUG-08 [MODERATE]:** `userQuestDecks.questId` has no foreign key reference — referential integrity is not enforced at the database level
9. **BUG-09 [MODERATE]:** `RedisCircuitBreaker.onSuccess()` and `onFailure()` are non-atomic — concurrent serverless invocations can clobber each other's state updates
10. **BUG-10 [MODERATE]:** `withAuth` middleware checks `is_suspended` boolean but ignores `suspended_until` timestamp — expired suspensions are enforced for up to 30s beyond their end time due to Redis cache
11. **BUG-11 [MODERATE]:** Hall of Fame leaderboard injection triggers an N+1 query pattern — each missing HoF user costs 2 additional DB round-trips on a hot read path
12. **BUG-12 [MODERATE]:** Many core tables are absent from `schema.ts` (gifts, rooms, guild_wars, user_push_tokens, etc.) — Drizzle schema is structurally incomplete, undermining type safety and migration tooling
13. **BUG-13 [MODERATE]:** CSRF middleware CRON bypass checks only for the presence of `x-cron-secret` header, not its value — any request to a CRON path with that header name set skips CSRF validation
14. **BUG-14 [MODERATE]:** `warEngine.ts` member XP awards on war resolution use raw SQL without `safeAwardXP` or any DLQ fallback — XP failures are silently dropped
15. **BUG-15 [MODERATE]:** `questEngine.updateQuestProgress` awards XP via raw SQL without `safeAwardXP`, no DLQ fallback, and no `referenceId` on the ledger entry — XP can be lost or double-awarded
16. **BUG-16 [MINOR]:** `calculateXPForAction` has no `case` for `'bank_account_added'` despite `XP_VALUES.bank_account_added` being defined — this action always awards 0 XP
17. **BUG-17 [MINOR]:** `push.ts` queries `user_push_tokens` table that does not exist in `schema.ts` — Drizzle type safety and schema tooling are blind to this table
18. **BUG-18 [MINOR]:** Room message XP daily cap check fetches `todayMsgCount` before the message is inserted — the cap is off by one, allowing one extra message beyond the configured limit
19. **BUG-19 [MINOR]:** Google OAuth callback emits a `pre_auth` JWT with a `type` field not declared in `AccessTokenPayload`, bypassed with an unsafe TypeScript cast — undocumented token type leaks into the system
20. **BUG-20 [MINOR]:** Expo SQLite offline queue defines `'sending'` as a valid status in its CHECK constraint but no code path ever sets this status — dead state creates schema/code mismatch and leaves a real double-send race unaddressed
21. **BUG-21 [MINOR]:** `commissions.ts` dynamically imports `creditCoins` inside the function body on every call rather than as a static top-level import — unnecessary per-invocation overhead
22. **BUG-22 [MINOR]:** `reconcileStuckPayouts` declares `gross_kobo` as TypeScript `string` but uses it in arithmetic SQL expressions — misleading type, potential silent JS concatenation if ever used in-process
23. **BUG-23 [MINOR]:** `filterProfanity` caches `RegExp` objects with the `/g` flag globally — shared mutable `lastIndex` state is fragile and will cause intermittent false negatives if the function is ever made async or called concurrently
24. **BUG-24 [MINOR]:** `getClientIp` trusts `x-vercel-forwarded-for` unconditionally — when not deployed on Vercel, clients can spoof this header and bypass IP-based rate limiting entirely
25. **BUG-25 [MINOR]:** `withAdminAuth` does not attach `X-Request-Id` to error responses, unlike `withAuth` — inconsistency breaks request tracing for admin endpoints

---

## Detailed Bug Entries

---

### BUG-01 [CRITICAL] — `safeAwardXP` Double XP Credit on Idempotency Collision

**FILES:**
`apps/web/lib/xp/safeAwardXP.ts`

**FIX:**
The INSERT into `xp_ledger` uses `ON CONFLICT DO NOTHING`, which silently skips the insert when a duplicate `reference_id` exists (idempotency retry scenario). However, the immediately following `UPDATE users SET xp_total = xp_total + $1` is a completely independent query that runs unconditionally regardless of whether the INSERT fired. Every call with a previously-seen `reference_id` increments the user's balance while the ledger stays correct — classic double-credit.

Fix by merging both queries into a single CTE: `WITH ins AS (INSERT INTO xp_ledger ... ON CONFLICT DO NOTHING RETURNING id) UPDATE users SET xp_total = xp_total + $1 WHERE id = $2 AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM ins)`. This is atomic in one round-trip and the UPDATE only runs when the INSERT actually inserted a row. Apply the same fix to the `xp_total` update and the per-track column update if they are separate statements.

---

### BUG-02 [CRITICAL] — `retryFailedXPAwards` Double XP Credit on Idempotency Collision

**FILES:**
`apps/web/lib/xp/safeAwardXP.ts`

**FIX:**
The retry path in `retryFailedXPAwards` has the identical structural flaw as BUG-01. The INSERT uses `ON CONFLICT DO NOTHING` followed by an unconditional `UPDATE users SET xp_total = xp_total + $1`. If the ledger entry already exists from a prior partial-success run, the balance is incremented again on retry. Apply the same CTE-based fix: make the UPDATE conditional on the INSERT having returned a row, so retries that encounter a pre-existing ledger entry are truly no-ops.

---

### BUG-03 [CRITICAL] — `claimPassMilestone` Double XP Credit for `xp_bonus` Rewards

**FILES:**
`apps/web/lib/seasons/seasonEngine.ts`

**FIX:**
The season pass milestone claim for `reward_type === 'xp_bonus'` follows the same pattern: INSERT into `xp_ledger` with `ON CONFLICT DO NOTHING`, then unconditionally UPDATE `users.xp_total`. A user who claims the same milestone twice (network retry, duplicate request) gets double-credited on their balance while the ledger correctly deduplicates. Apply the same CTE fix as BUG-01 — gate the UPDATE on the INSERT having returned a row.

---

### BUG-04 [CRITICAL] — `referral_commissions` INSERT Uses Wrong Column Names

**FILES:**
`apps/web/lib/referrals/commissions.ts`
`apps/web/lib/db/schema.ts`

**FIX:**
The INSERT statement specifies columns `(referrer_id, referee_id, tier, coin_amount, purchase_coin_amount, created_at)`. The actual schema defines `referred_user_id`, `trigger_event_id` (NOT NULL, no default), `purchase_amount_kobo`, `commission_kobo` (NOT NULL), and `commission_coins`. None of the column names in the INSERT match the schema. PostgreSQL will throw a column-not-found error at runtime, meaning every referral commission attempt fails — and if that error is caught silently upstream, no commission is ever paid and no alert fires.

Fix by rewriting the INSERT to use the correct column names from `schema.ts` and supplying values for the NOT NULL columns (`trigger_event_id`, `commission_kobo`). Clarify what `trigger_event_id` should reference (a purchase event ID or similar) and ensure that value is threaded through the call chain.

---

### BUG-05 [CRITICAL] — Leaderboard Upsert Broken for NULL `city`/`season_id`

**FILES:**
`apps/web/lib/leaderboards/engine.ts`
`apps/web/lib/db/schema.ts`

**FIX:**
`upsertLeaderboardSnapshot` uses `ON CONFLICT (user_id, track, scope, city, season_id) DO UPDATE`. Standard PostgreSQL unique constraints treat each NULL as distinct from every other NULL, so two rows with `(userId='X', track='main', scope='global', city=NULL, season_id=NULL)` are not considered conflicting — the `ON CONFLICT` clause never fires, and instead of updating, a new row is inserted every time. Global and all-time leaderboards accumulate unbounded duplicate rows.

Fix by replacing the regular unique constraint with a partial or expression unique index that handles NULLs correctly. The most portable approach: `CREATE UNIQUE INDEX leaderboard_snapshots_upsert_idx ON leaderboard_snapshots (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))`. Change the Drizzle `ON CONFLICT` target to reference this index name. The schema.ts unique index definition must be updated to use the same expression so Drizzle migration generates it correctly.

---

### BUG-06 [CRITICAL] — AES Key Derivation Uses Bare SHA-256 (No KDF)

**FILES:**
`apps/web/lib/security/fieldEncryption.ts`

**FIX:**
`getKeyForVersion` derives the 32-byte AES-256-GCM key with `createHash("sha256").update(rawKey).digest()`. This is not a key derivation function — it applies no salt, no iteration count, and no memory hardness. An attacker who captures any ciphertext can brute-force a short or predictable raw key offline in seconds with commodity hardware.

Replace with `crypto.scrypt(rawKey, versionSalt, 32, { N: 16384, r: 8, p: 1 })` where `versionSalt` is a per-key-version constant (e.g., derived from the version number, stored in code). Cache the derived key after first computation so the KDF cost is only paid once per process lifetime. This fix requires a one-time re-encryption migration for all existing KYC field ciphertext — plan and execute this carefully as a separate, coordinated deployment step.

---

### BUG-07 [MODERATE] — Duplicate 2FA Columns in `users` Schema

**FILES:**
`apps/web/lib/db/schema.ts`

**FIX:**
The `users` table has two parallel TOTP column pairs: `twoFaSecret`/`twoFaEnabled` and `totpSecret`/`totpEnabled`. Code that writes to one pair and reads from the other silently produces incorrect 2FA behavior (users appearing to have 2FA disabled even after enabling it, or vice versa). Audit all 2FA code paths across auth routes, settings handlers, and middleware to determine which pair is actually read for verification and which is written during setup. Drop the unused pair via migration, copy any live data from the deprecated columns to the canonical ones first, and add a `NOT NULL DEFAULT false` constraint to the surviving boolean column once the schema is normalized.

---

### BUG-08 [MODERATE] — `userQuestDecks.questId` Has No Foreign Key

**FILES:**
`apps/web/lib/db/schema.ts`

**FIX:**
The `questId` column in `userQuestDecks` is defined without a `.references()` call, so PostgreSQL enforces no referential integrity. Quest deck rows can reference non-existent quest IDs, and deleting a quest (if that path ever exists) will leave orphan deck rows that cause silent query failures downstream. Add `.references(() => quests.id, { onDelete: 'cascade' })` (or `restrict` depending on the desired behavior) to `questId`. This also requires ensuring the `quests` table is defined in `schema.ts` (related to BUG-12).

---

### BUG-09 [MODERATE] — `RedisCircuitBreaker` Non-Atomic State Updates (Race Condition)

**FILES:**
`apps/web/lib/payments/circuit.ts`

**FIX:**
Both `onSuccess()` and `onFailure()` read the current circuit state from Redis, modify it in-process, and write it back — a read-modify-write race. In a serverless environment, two concurrent instances can read the same stale state, each increment their local copy, and each write back `failureCount=3` instead of `4`. The circuit breaker may never open when it should, or may oscillate incorrectly.

Replace both methods with atomic Lua scripts (one per transition type) that perform the full state read, modify, and write in a single Redis eval round-trip — the same technique already used in the sliding-window rate limiter. The failure Lua script should atomically increment the failure count and transition to `OPEN` if the threshold is reached; the success script should atomically reset the count and transition to `CLOSED`.

---

### BUG-10 [MODERATE] — `withAuth` Ignores `suspended_until` Expiry Timestamp

**FILES:**
`apps/web/lib/api/middleware.ts`

**FIX:**
`withAuth` checks `user.is_suspended` (a boolean) to block suspended users, but does not evaluate `suspended_until`. If a user's suspension has expired but the boolean flag hasn't been cleared yet (e.g., by a scheduled job), the user is incorrectly blocked for up to 30 seconds (the Redis user-cache TTL). Meanwhile, the room messages route correctly evaluates `suspended_until < NOW()` at the handler level — so the behavior is inconsistent across routes.

Fix by adding a check in `withAuth`: if `user.suspended_until` is non-null and `new Date(user.suspended_until) <= new Date()`, treat the suspension as expired and allow the request through. Optionally fire a background `UPDATE users SET is_suspended = false WHERE id = $1 AND suspended_until <= NOW()` to clear the stale flag asynchronously.

---

### BUG-11 [MODERATE] — N+1 Queries in Hall of Fame Leaderboard Injection

**FILES:**
`apps/web/lib/leaderboards/engine.ts`

**FIX:**
When building the leaderboard response, HoF pinned users not already present in the paginated result set each trigger a separate `getUserRank(hof.user_id, ...)` call. Each such call makes 2 DB round-trips (one for the user's XP/rank data, one for their position count). For N missing HoF users, this is 2N extra queries on what should be a fast, cached read path.

Fix by collecting the IDs of all missing HoF users first, then fetching all of them in a single `WHERE user_id = ANY($1)` query, and merging the results in-process. This reduces the cost from 2N queries to 1 query regardless of HoF size. The combined leaderboard result (main page + HoF injections) should also be cached at the full-page level so the HoF injection cost is paid at most once per cache TTL.

---

### BUG-12 [MODERATE] — Core Tables Missing from Drizzle `schema.ts`

**FILES:**
`apps/web/lib/db/schema.ts`
`apps/web/lib/notifications/push.ts`
`apps/web/lib/guilds/warEngine.ts`
(and other files that query tables only defined in SQL migrations)

**FIX:**
Multiple critical tables exist only in SQL migration files and are absent from `schema.ts`: gifts, gift_types, rooms, room_members, guild_wars, guild_war_members, user_push_tokens, and likely others. Raw SQL strings must be used everywhere these tables are referenced, bypassing all Drizzle type safety. Foreign key references from schema-defined tables (e.g., `userQuestDecks.questId` from BUG-08) cannot resolve because the target table is not in schema.

Add Drizzle `pgTable` definitions for all missing tables to `schema.ts`, matching column names and types exactly as in the migration SQL. This is a large but mechanical task. Once done, migrate raw SQL queries in the affected files to Drizzle query builder calls. As a minimum first step, add the table definitions (even as stubs) so that FK references and Drizzle introspection tools work correctly.

---

### BUG-13 [MODERATE] — CSRF Middleware CRON Bypass Checks Header Presence, Not Value

**FILES:**
`apps/web/middleware.ts`

**FIX:**
In `isCsrfSafe`, when there is no Origin header and the path starts with `/api/cron/`, the CSRF check is bypassed if the request has an `x-cron-secret` header present — regardless of its value. `request.headers.has("x-cron-secret")` is the check, not `request.headers.get("x-cron-secret") === process.env.CRON_SECRET`. A server-side or same-network attacker can append `x-cron-secret: anything` to bypass CSRF at the middleware layer, then only face the actual secret check in the route handler. While the route handler is the real gate, CSRF middleware should provide defense-in-depth.

Fix by changing the bypass condition to check the actual value: `request.headers.get("x-cron-secret") === process.env.CRON_SECRET`. `process.env` is available in Edge middleware, so this requires no additional infrastructure.

---

### BUG-14 [MODERATE] — Guild War XP Awards Have No DLQ Fallback

**FILES:**
`apps/web/lib/guilds/warEngine.ts`

**FIX:**
When a guild war resolves, member XP is awarded with raw `INSERT INTO xp_ledger` + `UPDATE users` queries, not through `safeAwardXP`. If the database is temporarily unavailable or any query fails mid-loop, some members silently lose their earned XP with no recovery path — no DLQ entry, no retry, no alert. Replace all raw XP queries in `resolveWar` with `safeAwardXP` calls, using `warId` as the `referenceId` suffix so that idempotency and DLQ fallback are handled automatically.

---

### BUG-15 [MODERATE] — Quest Progress XP Awards Have No DLQ Fallback and No `referenceId`

**FILES:**
`apps/web/lib/quests/questEngine.ts`

**FIX:**
XP awarded on quest completion is inserted directly via raw SQL in `updateQuestProgress` without calling `safeAwardXP` and without a `referenceId` on the ledger entry. Two consequences: (1) if the XP insert fails, the XP is silently lost with no retry path; (2) if `updateQuestProgress` is called twice for the same completion event (duplicate request, retry), the XP is double-awarded because there is no idempotency key. Replace with `safeAwardXP(userId, amount, 'main', 'quest_completion', questCompletionId)` where `questCompletionId` is a stable identifier for this specific quest-user completion instance (e.g., `${questId}:${userId}:${deckDate}`).

---

### BUG-16 [MINOR] — `calculateXPForAction` Missing Case for `bank_account_added`

**FILES:**
`apps/web/lib/xp/engine.ts`

**FIX:**
`XP_VALUES.bank_account_added` is defined in the constants map but the `switch` statement in `calculateXPForAction` has no corresponding `case 'bank_account_added':`. When this action is passed, the function falls through to the `default` case and returns `0`, silently denying users their XP reward for adding a bank account. Add the missing case. Also audit the full set of keys in `XP_VALUES` against the switch cases to check for any other missing entries.

---

### BUG-17 [MINOR] — `push.ts` References `user_push_tokens` Table Not in Schema

**FILES:**
`apps/web/lib/notifications/push.ts`
`apps/web/lib/db/schema.ts`

**FIX:**
`push.ts` queries `user_push_tokens` using raw SQL, but the table has no Drizzle definition in `schema.ts`. This is a specific critical instance of BUG-12. If the schema is ever regenerated from `schema.ts`, this table will be dropped. Add the `user_push_tokens` table definition to `schema.ts` with the correct columns (at minimum: `id`, `user_id`, `token`, `platform`, `created_at`, `last_seen_at`), then migrate the raw queries in `push.ts` to Drizzle query builder calls.

---

### BUG-18 [MINOR] — Room Message XP Daily Cap Off-by-One

**FILES:**
`apps/web/app/api/rooms/[roomId]/messages/route.ts`

**FIX:**
The daily message XP cap reads `todayMsgCount` from the database before the current message is inserted into the messages table. The count therefore reflects all prior messages but not the one being sent right now. If the cap is 50 and the user has sent exactly 50 messages, `todayMsgCount` reads 50 before insert — the check fires correctly. But if `todayMsgCount` is 49, the check allows the 50th message through. The actual off-by-one occurs when the count is already at the limit but was read pre-insert: conceptually the count should include the current message. Fix by fetching `todayMsgCount` after the insert within the same transaction, or by using an atomic increment-and-check pattern so the count always includes the current request.

---

### BUG-19 [MINOR] — Google OAuth Pre-Auth JWT Uses Undeclared `type` Field with Unsafe Cast

**FILES:**
`apps/web/app/api/auth/google/callback/route.ts`

**FIX:**
The Google OAuth callback creates a short-lived pre-auth token for 2FA challenges by injecting `type: "pre_auth"` into the JWT payload. This field is not declared in the `AccessTokenPayload` TypeScript interface, so it is bypassed with an unsafe cast. Risks: (1) if `signAccessToken` is refactored to validate its input type strictly, this cast silently fails; (2) route handlers that check for a valid access token will incorrectly accept a pre-auth token as a full access credential, since nothing verifies `payload.type !== 'pre_auth'` before granting access. Fix by adding `type?: 'pre_auth' | 'access'` to `AccessTokenPayload`, removing the cast, and ensuring `withAuth` (and any other auth check) explicitly rejects tokens where `type === 'pre_auth'`.

---

### BUG-20 [MINOR] — Expo SQLite Offline Queue Has Dead `'sending'` Status State

**FILES:**
`apps/expo/lib/offline/sqlite.ts`
`apps/expo/lib/offline/syncQueue.ts`

**FIX:**
The SQLite schema defines a CHECK constraint allowing `status` values of `'pending'`, `'sending'`, and `'failed'`. However, no code path in either `sqlite.ts` or `syncQueue.ts` ever sets a message to `'sending'`. Messages go directly from `'pending'` to deleted (on success) or `'failed'`. The intended purpose was clearly to mark in-flight messages to prevent double-sends on app restart — but this was never implemented, leaving a real race condition open (app crashes mid-send, restarts, re-sends the same message).

Either implement `'sending'` properly — set the status before making the API call, clear it (delete the row) on success, set it to `'failed'` on terminal error, and on startup treat any `'sending'` rows as `'pending'` (they were interrupted) — or remove `'sending'` from the CHECK constraint entirely to keep the schema honest. The full implementation of `'sending'` is preferred as it closes a genuine UX bug.

---

### BUG-21 [MINOR] — `commissions.ts` Dynamic Import of `creditCoins` on Every Call

**FILES:**
`apps/web/lib/referrals/commissions.ts`

**FIX:**
`commissions.ts` uses `await import("@/lib/economy/coins")` inside the function body to load `creditCoins`. While Node.js caches module imports, the dynamic import syntax adds per-call overhead, obscures the module dependency graph, and confuses tree-shaking tools. Replace with a static top-level `import { creditCoins } from "@/lib/economy/coins"`. Note: this is secondary to BUG-04 — fix the column mismatch first, since without that fix `creditCoins` is never reached anyway.

---

### BUG-22 [MINOR] — `reconcileStuckPayouts` Types `gross_kobo` as `string` in TypeScript

**FILES:**
`apps/web/lib/payments/payouts.ts`

**FIX:**
The query result row type in `reconcileStuckPayouts` declares `gross_kobo` as TypeScript `string`. Downstream SQL uses it arithmetically (`SET net_kobo = gross_kobo - fee_kobo`) which works at the DB level, but any in-process arithmetic on `row.gross_kobo` would produce string concatenation instead of numeric addition, causing silent bugs. Change the TypeScript type declaration to `number` and add a `Number(row.gross_kobo)` coercion at the point of use if the `pg` driver returns numeric columns as strings in this context, to make intent explicit and guard against JS arithmetic bugs.

---

### BUG-23 [MINOR] — `filterProfanity` Global Regex Cache with `/g` Flag Has Shared Mutable State

**FILES:**
`apps/web/lib/moderation/contentFilter.ts`

**FIX:**
RegExp objects with the `/g` flag maintain a `lastIndex` property that advances with each successful match. Cached globally and reused across calls, a call that ends mid-string leaves `lastIndex` non-zero, causing the next call to start matching from that offset and miss profanity at the start of the string. The current synchronous code resets `lastIndex = 0` before each use, which is correct but fragile — one future async refactor or missing reset will introduce intermittent false negatives. Fix by either constructing fresh RegExp objects per call (safe, marginal performance cost), using `String.prototype.replace` with a non-global regex and the `/gi` flags in a way that doesn't mutate shared state, or converting the cache to store pattern strings and compiling fresh RegExp on each call.

---

### BUG-24 [MINOR] — `getClientIp` Trusts Spoofable `x-vercel-forwarded-for` Header Off-Platform

**FILES:**
`apps/web/lib/security/rateLimit.ts`

**FIX:**
`getClientIp` checks `x-vercel-forwarded-for` first and returns it unconditionally. On Vercel's infrastructure this header is set by Vercel's edge network and is non-spoofable. In any other deployment (staging, Docker, bare VPS), a client can inject `x-vercel-forwarded-for: 1.2.3.4` and bypass IP-based rate limiting by rotating fake source IPs.

Fix by only trusting this header when `process.env.VERCEL === '1'` (an environment variable Vercel sets automatically on its platform). When that flag is absent, skip `x-vercel-forwarded-for` and fall through to `x-real-ip` and `x-forwarded-for` with the TRUSTED_PROXY_COUNT logic.

---

### BUG-25 [MINOR] — `withAdminAuth` Missing `X-Request-Id` on Error Responses

**FILES:**
`apps/web/lib/api/middleware.ts`

**FIX:**
`withAuth` generates a `requestId` and attaches it to all error responses (401, 403) so that client-side error handlers and support tooling can correlate frontend error messages with backend logs. `withAdminAuth` omits this — its 401 and 403 responses carry no request identifier. This makes admin API errors harder to trace. Fix by adding the same `requestId` generation and header attachment pattern to `withAdminAuth`, mirroring the existing pattern in `withAuth`.

---

## Post-Fix Code Quality Rating (Projected)

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | 8/10 | DLQ pattern extended consistently; schema fully defined in one place |
| Security | 8/10 | Proper KDF, CSRF depth restored, IP header trust scoped correctly to platform |
| Data Integrity | 9/10 | Idempotent XP awards, correct leaderboard upserts, referral INSERT fixed |
| Performance | 8/10 | N+1 HoF resolved, circuit breaker atomic, RegExp cache hardened |
| Code Quality | 8/10 | Dead states removed, type annotations correct, unsafe casts eliminated |
| **Overall** | **8.2/10** | Significantly safer, more reliable, and easier to maintain |

---

*Report generated: 2026-06-14 at 02:58 PM*
*All findings are based on static code analysis only. No bugs have been fixed — fixes are planned in `custom-bugs-fix-plan.md`.*
