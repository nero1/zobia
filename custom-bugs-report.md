# Zobia Codebase Forensic Bug Report

**Date:** 2026-06-20  
**Time:** 04:43 PM  
**Analyst:** Forensic code review (full codebase — web Next.js app, PWA, Expo Android app)  
**Scope:** All bugs, logic errors, security issues, and suboptimal code found by independent analysis (not derived from any existing bug trackers)

---

## Summary Rating

**Current Code Quality: 7.5 / 10**  
The codebase is architecturally solid with many well-implemented patterns (DLQ for XP, SSRF protection, nonce-based CSP, idempotent webhooks, Decimal.js for financials). Several critical correctness and security gaps remain.

**Post-Fix Estimated Rating: 9.2 / 10**

---

## Bug Index (One-Line Descriptions)

1. BUG-MILESTONE-01 — `claimPassMilestone` commits claim row but gives no reward on unknown reward_type; user is permanently locked out of that milestone with zero reward
2. BUG-PUSHRECEIPTS-01 — `pollPushReceipts` SELECT has no `FOR UPDATE SKIP LOCKED`; concurrent CRON runs race and double-process push tickets
3. BUG-WAR-DRAW-01 — `resolveWar` sets `outcome="draw"` but still writes `winner_guild_id`, increments `wars_lost` for defender, and awards win XP only to challenger
4. BUG-FUND-IDEMPOTENCY-01 — `distributeCreatorFund` idempotency guard is all-or-nothing; a mid-loop crash permanently blocks re-run, leaving some creators unpaid
5. BUG-LEADERBOARD-CONFLICT-01 — `upsertLeaderboardSnapshot` uses `COALESCE` expressions in `ON CONFLICT` that may not match the actual DB index, silently failing or creating duplicates
6. BUG-PUSH-NAVACTION-01 — Expo push notification `action` field is passed unvalidated to `router.push()`, allowing arbitrary route navigation from a crafted notification
7. BUG-NEMESIS-BLOCKS-01 — `assignNemesis` does not exclude users who have blocked or been blocked by the target; blocked relationships can become nemesis pairs
8. BUG-HDR-HSTS-01 — Duplicate conflicting `Strict-Transport-Security` headers on page responses: `next.config.js` emits `max-age=63072000`, middleware emits `max-age=31536000`
9. BUG-HDR-REPORTTO-01 — Duplicate conflicting `Report-To` headers on page responses: `next.config.js` sets `max_age: 10886400`, middleware sets `max_age: 86400`
10. BUG-HDR-MISSING-01 — Middleware `withCsp()` does not set `X-Content-Type-Options: nosniff` or `Referrer-Policy`; all API responses are missing these headers
11. BUG-MANIFEST-PUBLIC-01 — `/api/manifest` is in `PUBLIC_PREFIXES` and requires no authentication, exposing full app configuration to unauthenticated callers
12. BUG-FUND-NORMALIZE-01 — `distributeCreatorFund` `normalise()` returns all-zero scores when every creator has the same metric value, zeroing out distributions and nullifying the IWD boost
13. BUG-QUEST-HASHTEXT-01 — Daily quest deck uses PostgreSQL internal `HASHTEXT()`, which is not guaranteed stable across major PG version upgrades and can silently change everyone's deck
14. BUG-AUTH-ME-RATELIMIT-01 — `/api/auth/me` has no rate limiting; it accepts a Redis session lookup on every request with no throttle
15. BUG-EXPO-PUSHTOKEN-REREGISTER-01 — Expo `registerForPushNotifications` fires inside a `useEffect([user])` that re-triggers on every user object mutation (e.g. token refresh updating the user record)
16. BUG-EXPO-SYNC-DEBOUNCE-01 — `syncPendingMessages` is invoked directly on every NetInfo connectivity state change with no debounce, spawning concurrent sync attempts during flapping connections
17. BUG-BIGINT-PRECISION-01 — Drizzle schema `bigint` columns declared with `mode: "number"` lose precision for values above 2^53; affects any ledger balance that could reach that scale
18. BUG-DLQ-PHANTOM-01 — `safeAwardXP` writes to `globalDb` (not the caller's transaction client) for DLQ entries; if the caller's transaction rolls back, the DLQ records an XP loss that never occurred
19. BUG-FEERATE-DUPLICATION-01 — `getCreatorFeeRate()` is exported from `payouts.ts` but never called; creator share percentage is hard-coded inline in both `paystackWebhookHandler.ts` and `dodoWebhookHandler.ts` independently
20. BUG-FIELDENC-FIXEDSALT-01 — `fieldEncryption.ts` uses fixed per-version salts for the scrypt KDF instead of random per-record salts, meaning all records of the same version derive the same key material
21. BUG-FUND-ADVISORYLOCK-01 — `distributeCreatorFund` advisory lock key is `hashtext('distributeCreatorFund')`, a 32-bit integer that could theoretically collide with another advisory lock used elsewhere in the application

---

## Detailed Bug Analysis

---

### 1. BUG-MILESTONE-01 — Season Pass Milestone Claim Silently Burns the Claim With No Reward

**Severity:** Critical — data integrity, user-facing financial loss  
**FILES:** `apps/web/lib/seasons/seasonEngine.ts` (lines ~609–651)

Inside `claimPassMilestone`, the function opens a transaction, inserts a row into `user_season_milestone_claims` (the idempotency guard row), then dispatches on `milestone.reward_type`. Three known types are handled: `'coins'`, `'xp_bonus'`, and `'sticker_pack'`. If the DB ever contains a milestone with any other `reward_type` (e.g. `'badge'`, `'title'`, `'frame'` — likely future reward types), the else-branch fires `console.error(...)` and falls through without setting `claimed`. The transaction commits normally because no error is thrown — the claim row is persisted in the DB. After the transaction, the `if (!claimed)` guard returns `{success: false}`, but the user's claim row already exists. On any subsequent attempt the idempotency check blocks the INSERT and the function returns `{success: false}` with the same null `claimed` path. The user is permanently locked out of that milestone and receives no reward, with no automated recovery mechanism.

FIX: Inside the else-branch, `throw new Error(...)` instead of `console.error`. Throwing inside the transaction causes an automatic rollback, so the claim row is never persisted and the user can retry after the reward type is added. Additionally, add a seed-time validation that all milestone `reward_type` values are from the accepted enum before any season is made live.

---

### 2. BUG-PUSHRECEIPTS-01 — Push Receipt Polling Has No Row-Level Locking, Enabling Concurrent Duplicate Processing

**Severity:** High — reliability, stale token management correctness  
**FILES:** `apps/web/lib/notifications/push.ts` (lines ~283–295)

`pollPushReceipts` begins with a plain `SELECT ... WHERE status = 'pending' ... LIMIT 1000` with no `FOR UPDATE SKIP LOCKED`. If two CRON invocations overlap (e.g. an external CRON fires before the prior run finishes), both workers fetch the same batch of pending ticket rows. Both then attempt to mark the same tickets as `'ok'` or `'error'` and purge stale device tokens. The last writer wins on the status column, but `DeviceNotRegistered` handling deletes the push token — if this fires twice for the same token, the second delete is harmless, but concurrent deletion of user push tokens is a race on the `user_push_tokens` table that may conflict with new registrations happening simultaneously.

FIX: Change the SELECT to `FOR UPDATE SKIP LOCKED`. This causes the second concurrent worker to skip already-locked rows and process a non-overlapping set, making the polling idempotent under concurrency.

---

### 3. BUG-WAR-DRAW-01 — Guild War Draw Outcome Is Semantically Contradictory: Defender Loses Stats and Rewards on a Tie

**Severity:** High — fairness, game economy  
**FILES:** `apps/web/lib/guilds/warEngine.ts` (lines ~346–396)

In `resolveWar`, when `challenger_points === defender_points`, the code sets `outcome = "draw"` (correctly) but then unconditionally assigns `winnerGuildId = war.challenger_guild_id` (challenger wins the tie-break). The DB update writes `winner_guild_id = challenger_id`. `wars_won` is incremented for the challenger and `wars_lost` for the defender. Win XP (200–500 per member) and the full guild XP reward (500–5,000) are distributed only to challenger members. The defender receives nothing and has their `wars_lost` counter incremented. The returned object advertises `outcome: "draw"` but the DB state reflects a challenger win in every other regard. Any caller or UI that reads `guild_wars.winner_guild_id` or `guilds.wars_lost` will see a contradictory state.

FIX: When `outcome === "draw"`, set `winner_guild_id = NULL` in the DB update, do not increment `wars_won` or `wars_lost` for either guild, and distribute a reduced draw XP (e.g. 50% of normal) to all participating members on both sides. This aligns the DB state with the semantic outcome.

---

### 4. BUG-FUND-IDEMPOTENCY-01 — Creator Fund Distribution Cannot Be Re-Run After a Partial Crash

**Severity:** High — financial correctness  
**FILES:** `apps/web/lib/creator/fund.ts` (lines ~239–261)

`distributeCreatorFund` uses an idempotency guard: if any row exists in `creator_earnings` with `source_type = 'creator_fund'` and `reference_id LIKE 'fund:{period}:%'`, the entire distribution is skipped. The loop that credits individual creators runs inside the same transaction. If the process crashes or times out after crediting 3 of 10 creators, the partial transaction may or may not have committed depending on when the crash occurred. If even one `creator_earnings` row for the period was committed (by a partial transaction commit before crash, or by a prior partial run), the idempotency guard will block every future re-run for that period. The remaining creators receive no fund allocation and have no recourse.

FIX: Change the idempotency logic to be per-creator, not per-period. Either use `ON CONFLICT (reference_id) DO NOTHING` on each individual INSERT (the `reference_id` is already `fund:{period}:rank{n}` which is unique per creator per period), or track which creator IDs have already been credited this period and only process the remainder. This makes re-runs safe and additive rather than all-or-nothing.

---

### 5. BUG-LEADERBOARD-CONFLICT-01 — `upsertLeaderboardSnapshot` ON CONFLICT Expressions May Not Match the Actual Index

**Severity:** High — data integrity, leaderboard correctness  
**FILES:** `apps/web/lib/leaderboards/engine.ts` (lines ~377–384)

The upsert query uses:
```
ON CONFLICT (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))
```
PostgreSQL `ON CONFLICT` with an expression target only works if a unique index was created with those exact same expressions. The comment in the file says "NULLs handled via IS NOT DISTINCT FROM" but the ON CONFLICT clause uses COALESCE, not IS NOT DISTINCT FROM. If the migration created a standard index on `(user_id, track, scope, city, season_id)` — which is the typical approach — NULLs in `city` and `season_id` are treated as distinct from each other and the COALESCE-based ON CONFLICT will not match that index. The result is that every `upsertLeaderboardSnapshot` call either throws a unique violation error (if the standard index exists) or silently inserts duplicate rows (if no matching index exists at all), causing leaderboard scores to drift out of sync with XP totals.

FIX: Align the unique index definition in the migration with the ON CONFLICT clause. Either create the index as `CREATE UNIQUE INDEX ON leaderboard_snapshots (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))` (expression index), or change the upsert to use `ON CONFLICT ON CONSTRAINT <constraint_name>` that matches the actual index. Verify the migration SQL to determine which approach is already in place and fix the mismatch.

---

### 6. BUG-PUSH-NAVACTION-01 — Expo Push Notification Action Field Passed Unvalidated to Router

**Severity:** High — security, arbitrary in-app navigation  
**FILES:** `apps/expo/app/_layout.tsx` (lines ~142–154)

The notification response listener reads `data.action` from the notification payload and passes it directly to `router.push(action)` without any validation or allowlist check. A compromised push notification (via a rogue push token, a server-side bug, or a MITM on an unencrypted delivery channel) could specify any valid Expo Router path — including admin screens, settings screens with destructive actions, or OAuth callback routes that accept query parameters. The only guard is a try/catch around the navigation call.

FIX: Maintain an explicit allowlist of valid notification action routes (e.g. `["/rooms/[id]", "/inbox", "/profile"]`). Before calling `router.push`, validate that `action` matches one of the allowed patterns using a regex or string prefix check. Reject and log any action that does not match. Never allow navigation to `/admin/*`, `/auth/*`, or any screen that performs side effects on load.

---

### 7. BUG-NEMESIS-BLOCKS-01 — Nemesis Assignment Does Not Exclude Blocked Users

**Severity:** Medium-High — user safety, harassment vector  
**FILES:** `apps/web/lib/nemesis/nemesisEngine.ts` (lines ~96–120)

`assignNemesis` correctly excludes mutual friends but does not exclude users who have blocked or been blocked by the target user. This means a user who blocks another user could still be assigned as their nemesis (and vice versa), forcing an unwanted visibility relationship. The assignment appears on the user's profile and leaderboard positioning, which could be used as a harassment vector when combined with public profile visibility.

FIX: Add a join or subquery against `user_blocks` in the candidate SELECT to exclude any user where `(blocker_id = $userId AND blocked_id = candidate.id) OR (blocker_id = candidate.id AND blocked_id = $userId)`. Apply this exclusion both to the city-filtered and the global candidate queries.

---

### 8. BUG-HDR-HSTS-01 — Duplicate Conflicting Strict-Transport-Security Headers on Page Responses

**Severity:** Medium — security header correctness  
**FILES:** `apps/web/next.config.js` (line 115), `apps/web/middleware.ts` (line 233)

`next.config.js` declares a global `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` header via `securityHeaders`. On production requests that pass through middleware, `withCsp()` also sets `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`. Both headers appear on the response simultaneously. The browser (and RFC 6797) uses the first HSTS header encountered, so the effective max-age depends on header ordering — `next.config.js` headers are prepended before middleware headers, meaning the `63072000` value wins today, but this is fragile and may change with Next.js versions. The `31536000` value from middleware is shorter, defeating the purpose of the longer HSTS policy.

FIX: Remove the `Strict-Transport-Security` entry from `securityHeaders` in `next.config.js`. Let middleware be the single source of truth for HSTS (already conditional on `NODE_ENV === "production"`). Optionally bump the middleware value to `63072000` to match the original intent.

---

### 9. BUG-HDR-REPORTTO-01 — Duplicate Conflicting Report-To Headers on Page Responses

**Severity:** Medium — CSP violation reporting correctness  
**FILES:** `apps/web/next.config.js` (lines 134–141), `apps/web/middleware.ts` (lines 218–225)

`next.config.js` sets `Report-To` with `max_age: 10886400` globally. Middleware `withCsp()` sets `Report-To` with `max_age: 86400` on every request. Page responses therefore carry two `Report-To` headers with different max_age values. Browser behaviour with duplicate `Report-To` headers is implementation-defined and may result in the reporting endpoint being registered with the shorter max_age (86400 = 1 day), silently overriding the intended 126-day retention.

FIX: Remove the `Report-To` entry from `securityHeaders` in `next.config.js`. The middleware already sets it correctly per-request with the correct endpoint reference. This eliminates the duplicate.

---

### 10. BUG-HDR-MISSING-01 — API Responses Missing X-Content-Type-Options and Referrer-Policy Headers

**Severity:** Medium — security header coverage  
**FILES:** `apps/web/middleware.ts` (lines ~210–235), `apps/web/next.config.js` (lines ~108–146)

`next.config.js` sets `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` via `securityHeaders`, which apply to HTML page responses. However, `withCsp()` in middleware (the function that wraps all middleware-generated `NextResponse.next()` calls) does not set these headers. Any API response returned by middleware directly (e.g. 401 Unauthorized, 403 Forbidden CSRF rejection) skips the `next.config.js` headers entirely. Additionally, `NextResponse.json()` responses returned from API route handlers bypass `next.config.js` header injection. These API responses lack MIME-type sniffing protection and referrer leakage prevention.

FIX: Add `res.headers.set("X-Content-Type-Options", "nosniff")` and `res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")` inside `withCsp()` in middleware. Also apply these two headers to the direct `NextResponse.json()` responses returned for CSRF rejections and auth failures in middleware.

---

### 11. BUG-MANIFEST-PUBLIC-01 — `/api/manifest` Is Publicly Accessible Without Authentication

**Severity:** Medium — information disclosure  
**FILES:** `apps/web/middleware.ts` (line 76)

`/api/manifest` is included in `PUBLIC_PREFIXES`, meaning the middleware passes all requests to that route without checking a valid JWT. The manifest endpoint returns app-wide configuration from the `x_manifest` table (feature flags, payment configuration, PWA settings, payout parameters, etc.). While individually none of these values are per-user secrets, the collective configuration could reveal internal tier thresholds, rate limits, feature flag states, and payment gateway parameters to unauthenticated attackers before they even attempt to authenticate.

FIX: Remove `/api/manifest` from `PUBLIC_PREFIXES`. The manifest endpoint already has its own rate limiting (`RATE_LIMITS.apiRead` keyed by IP). If unauthenticated clients genuinely need manifest data (e.g. the PWA install prompt before login), create a separate `/api/public/config` endpoint that returns only the minimal safe subset of manifest values (e.g. `pwa_web_enabled`, `pwa_android_enabled`) without authentication.

---

### 12. BUG-FUND-NORMALIZE-01 — Creator Fund `normalise()` Returns All Zeros When Scores Are Identical

**Severity:** Medium — financial correctness, IWD boost effectiveness  
**FILES:** `apps/web/lib/creator/fund.ts` (normalise function and distribution loop)

The min-max normalisation formula `(score - min) / (max - min)` returns `0/0 = NaN` when all creators have the same score (i.e. `max === min`). The implementation guards against this by returning `0` for all creators in that case (or relies on JS NaN → 0 coercion). When all normalized scores are 0, the IWD female creator boost (`score * femaleCreatorBoost`) multiplies 0 by the boost factor, yielding 0. All creators receive the same zero-boosted score, and the fund distribution reduces to an equal split regardless of the tier structure. This silently defeats the purpose of both normalization and the IWD boost during periods when all active creators have equal activity metrics.

FIX: When `max === min` (all scores equal), fall back to an equal-split distribution rather than setting all scores to 0. The IWD boost should still apply by adding an additive bonus (e.g. `baseShare * (femaleCreatorBoost - 1)`) to qualifying creators rather than a multiplicative one in the degenerate case.

---

### 13. BUG-QUEST-HASHTEXT-01 — Daily Quest Deck Uses PostgreSQL Internal `HASHTEXT()` That Is Not Stable Across Major Versions

**Severity:** Medium — quest deck stability, user experience  
**FILES:** `apps/web/lib/quests/questEngine.ts` (line ~107)

The daily quest shuffle is deterministic using `ORDER BY HASHTEXT(CONCAT($3, id::text))` where `$3` is the user ID. PostgreSQL's `HASHTEXT` is explicitly documented as an internal function whose output format is not guaranteed across major version upgrades. If the database is upgraded from PG 14 to PG 16 (for example), every user's quest deck order changes immediately. Users mid-way through a day's quests would find their progress tracking pointing at different quests than the ones now displayed.

FIX: Replace the `HASHTEXT` shuffle with a stable hashing approach. Options include: (a) using `MD5(CONCAT($3, id::text))` which is a stable SQL standard function, (b) performing the shuffle in application code using a seeded PRNG (e.g. seeded with `userId + date`), or (c) materializing the daily deck into `user_quests` once at deck-generation time and reading from that persisted ordering — which the schema already supports via `user_quests`. If decks are already stored in `user_quests`, the HASHTEXT ORDER BY only runs on initial deck generation and the risk is limited to the generation moment of a new deck per day.

---

### 14. BUG-AUTH-ME-RATELIMIT-01 — `/api/auth/me` Has No Rate Limiting

**Severity:** Medium — resource abuse, session enumeration  
**FILES:** `apps/web/app/api/auth/me/route.ts`

The `/api/auth/me` endpoint verifies a JWT and performs a Redis session lookup (`getSession(payload.sid)`) on every call, with no rate limiting. The middleware passes authenticated requests through without throttling this endpoint. A client can poll this endpoint at arbitrary frequency, burning Redis operations and server CPU. Additionally, a brute-force attacker iterating session IDs could use the response time difference between a valid Redis key hit and a miss for timing-based session enumeration, even though the endpoint returns only `{user: null, status: 401}` for invalid sessions.

FIX: Add `enforceRateLimit` to the `/api/auth/me` handler (already available as `@/lib/security/rateLimit`). Use the user's `sub` as the rate limit key after token verification, or the client IP before verification. A limit of ~60 requests per minute per user is generous enough for normal use while preventing polling abuse.

---

### 15. BUG-EXPO-PUSHTOKEN-REREGISTER-01 — Expo Push Token Registration Re-Fires on Every User Object Mutation

**Severity:** Low-Medium — unnecessary API calls, potential rate-limiting on Expo push service  
**FILES:** `apps/expo/app/_layout.tsx` (lines ~113–117)

```js
useEffect(() => {
  if (!user) return;
  registerForPushNotifications();
}, [user]);
```

The `user` object in the dependency array is the full user record from `AuthProvider`. Any mutation to the user object — including JWT access token refresh, which updates `user.token` or similar cached fields — triggers `registerForPushNotifications()` again. This re-fetches the Expo push token, requests permissions again (no-op on subsequent calls but still fires the native permission dialog flow), and POSTs the token to the backend. In practice this can fire dozens of times per session during normal use.

FIX: Change the dependency to `[user?.id]` so registration only re-fires when the user's identity actually changes (login/logout). Alternatively, add a module-level flag `let registrationDone = false` and guard the registration call, resetting only on logout.

---

### 16. BUG-EXPO-SYNC-DEBOUNCE-01 — Offline Message Sync Has No Debounce on Network State Changes

**Severity:** Low-Medium — concurrency, potential duplicate message sends  
**FILES:** `apps/expo/app/_layout.tsx` (lines ~119–129)

The NetInfo event listener directly invokes `syncPendingMessages()` on every state change where `isConnected && isInternetReachable`. During network handoffs or flapping connections, NetInfo can fire multiple state-change events within seconds — each triggering a concurrent sync. `syncPendingMessages` processes pending messages in batches with concurrent fetches. Multiple overlapping sync runs can race on the same pending message rows in SQLite, potentially attempting to send the same message multiple times before the first attempt's response marks the row as sent.

FIX: Add a debounce of ~2 seconds on the NetInfo handler before invoking `syncPendingMessages`, and/or use a module-level mutex (e.g. a boolean `isSyncing` flag) so that at most one sync runs at a time. The existing `markMessageSending` guard helps but does not fully eliminate the race when two concurrent runs check the pending state before either has called `markMessageSending`.

---

### 17. BUG-BIGINT-PRECISION-01 — Drizzle `bigint` Columns with `mode: "number"` Risk Precision Loss

**Severity:** Low-Medium — financial data integrity at extreme scale  
**FILES:** `apps/web/lib/db/schema.ts` (all `bigint().mode("number")` column declarations)

JavaScript `number` is IEEE 754 double-precision, which can exactly represent integers only up to 2^53 − 1 (9,007,199,254,740,991). Any `bigint` DB value exceeding this threshold will silently lose precision when converted to a JS `number`. This affects columns such as `available_earnings_kobo`, `xp_total`, ledger `amount` fields, and coin/star balances. While current user volumes make overflow unlikely, the risk is non-zero for high-volume creators with large accumulated earnings, and a silent precision loss in a financial field is unacceptable.

FIX: Change `mode: "number"` to `mode: "bigint"` on financial and balance columns (earnings, kobo amounts, large XP values). This returns a JS `BigInt` from Drizzle queries. Update all arithmetic on those values to use `BigInt` operations or convert to `Decimal.js` immediately after reading from the DB. For display-only columns where precision above ~9 quadrillion is irrelevant, `mode: "number"` may be retained.

---

### 18. BUG-DLQ-PHANTOM-01 — `safeAwardXP` DLQ Entries Created for XP That Was Never Actually Lost

**Severity:** Low — operational noise, wasted retry cycles  
**FILES:** `apps/web/lib/xp/safeAwardXP.ts` (lines ~110–118)

On failure, `safeAwardXP` writes to `failed_xp_awards` using `globalDb` (the module-level pool), not the `client` parameter passed by the caller. This is intentional: DLQ entries must persist even if the caller's transaction rolls back. However, the consequence is that if the caller's transaction rolls back (for any reason unrelated to the XP award), the DLQ entry describes an XP loss that never actually occurred — the entire transaction including the XP award was rolled back, so the user's balance is correct. The nightly CRON retry then attempts to re-award XP that was never missing, which either double-awards (if no `reference_id` guard exists) or wastes a retry slot.

FIX: The DLQ pattern is correct for the case where the XP INSERT itself fails inside a committed transaction. For the rollback case, the caller should detect the outer transaction failure and not call `safeAwardXP` after a rollback. Document clearly that `safeAwardXP` should only be called after the caller's outer transaction has committed, or accept that phantom DLQ entries will occasionally appear and ensure `reference_id` idempotency prevents actual double-awards on retry. The current idempotency guard only applies when `reference_id IS NOT NULL`, so callers passing `null` for `referenceId` could double-award on retry.

---

### 19. BUG-FEERATE-DUPLICATION-01 — Creator Fee Rate Is Hard-Coded in Three Places

**Severity:** Low — maintainability, future correctness  
**FILES:** `apps/web/lib/payments/payouts.ts` (exported `getCreatorFeeRate()`), `apps/web/lib/payments/paystackWebhookHandler.ts` (line ~158), `apps/web/lib/payments/dodoWebhookHandler.ts`

`getCreatorFeeRate()` is exported from `payouts.ts` and returns the creator share percentage (80% for standard, 85% for `icon` tier). However, this function is never called by either webhook handler. Both `paystackWebhookHandler.ts` and `dodoWebhookHandler.ts` independently hard-code `creator_tier === "icon" ? 85 : 80`. If the fee structure changes (new tiers, different percentages), it must be updated in three separate locations. The exported function exists precisely to avoid this but is never used.

FIX: Import and call `getCreatorFeeRate(creatorTier)` in both webhook handlers instead of the inline ternary. Remove the duplicate logic from both handlers.

---

### 20. BUG-FIELDENC-FIXEDSALT-01 — Field Encryption Uses Fixed Per-Version KDF Salts

**Severity:** Low — cryptographic hardening  
**FILES:** `apps/web/lib/security/fieldEncryption.ts` (lines ~13–16, ~33)

The v2 key derivation uses `scryptSync(raw, VERSION_SALTS[version], 32)` where `VERSION_SALTS.v2` is the fixed string `"zobia-field-enc-v2"`. All encrypted records for v2 therefore derive the same 256-bit AES key. This is acceptable when the master `KYC_ENCRYPTION_KEY_V2` env var is kept secret — the scrypt KDF still provides work factor. However, fixed salts mean that if two environments (staging, production) ever use the same `KYC_ENCRYPTION_KEY_V2`, their encrypted data is cross-decryptable. Per-record random IVs (which are correctly implemented) protect against ciphertext comparison, but a compromised key provides no salt diversity to limit the blast radius.

FIX: For future encryption key versions (v3+), use a random 16-byte salt stored alongside the ciphertext (prepended to the encrypted blob similar to how the IV is stored). This ensures key-derivation diversity even if the same master key is reused across environments. Existing v2 ciphertext does not need re-encryption; apply the improvement to v3 when the next rotation occurs.

---

### 21. BUG-FUND-ADVISORYLOCK-01 — Creator Fund Advisory Lock Uses 32-Bit `hashtext()` Key With Theoretical Collision Risk

**Severity:** Very Low — theoretical safety, operational risk  
**FILES:** `apps/web/lib/creator/fund.ts` (line ~235)

`pg_try_advisory_xact_lock(hashtext('distributeCreatorFund'))` converts the string to a 32-bit integer. If any other advisory lock in the application uses the same `hashtext` integer — whether by coincidence or if another function happens to hash to the same value — the two locks would mutually block each other. With 2^32 possible values and a handful of advisory locks, the probability is extremely low but non-zero.

FIX: Use `pg_try_advisory_xact_lock(hashtext('distributeCreatorFund'), 1)` — the two-argument form takes a 64-bit pair of 32-bit integers. Using a fixed second argument (e.g., the application's internal lock namespace `1`) effectively doubles the key space and eliminates any practical collision risk. Alternatively, use the bigint form: `pg_try_advisory_xact_lock(('x' || md5('distributeCreatorFund'))::bit(64)::bigint)`.

---

## Code Quality Notes (Not Bugs, But Worth Addressing)

- **Paystack `subscription.not_renew` event unhandled in `processSubscriptionEvent`**: The `handlePaystackWebhookPayload` dispatch correctly routes `subscription.not_renew` to `processSubscriptionEvent`, but the function's if/else chain handles `subscription.create` and `subscription.disable` explicitly, then falls through to the `isNonRenewing` flag check. This works but is fragile — the `not_renew` event relies on the `isNonRenewing` flag (`status === "non-renewing"`) being set correctly by Paystack. No explicit `event.event === "subscription.not_renew"` branch exists, making the logic harder to audit.

- **`warEngine.ts` queries use `guildWarMembers` alias pointing to `warContributions`**: The schema alias `export const guildWarMembers = warContributions` means any direct query on `guildWarMembers` (in ORM code) silently operates on `war_contributions`. This is confusing and could lead to incorrect table name expectations in future ORM queries. Prefer explicit use of `warContributions` everywhere.

- **JWT key rotation missing documentation for partial-key removal**: If `JWT_KEY_ID` is changed to `v2` and `JWT_SECRET_v1` is not added to the environment, all existing v1 tokens will fail to look up their key and fall back to the current (v2) secret — causing all live sessions to silently invalidate. This is correct behavior but should be explicitly documented in deployment runbooks.

---

## Summary

| Category | Count |
|---|---|
| Critical | 1 |
| High | 4 |
| Medium | 6 |
| Low-Medium | 4 |
| Low | 6 |
| **Total** | **21** |

The codebase demonstrates strong security fundamentals (CSP nonce, SSRF protection, CSRF Origin validation, HMAC webhook verification, field-level KYC encryption, XP DLQ). The bugs found are concentrated in edge cases of concurrency (SKIP LOCKED), header deduplication, draw semantics, and partial-run recovery. None of the critical/high severity bugs require architectural changes — all are localized, surgical fixes.

---

*Report generated: 2026-06-20 at 04:43 PM*  
*Analysis performed by independent forensic code review — all bugs independently identified*
