# Zobia Codebase Forensic Bug Report

**Date:** 2026-06-20 | **Time:** 11:33 PM  
**Scope:** Full forensic analysis — web (Next.js 14 App Router), PWA, Expo Android app  
**Methodology:** Three-pass deep analysis, all source files, no reliance on existing bug annotations  
**Analyst:** Independent AI forensic review  

---

## Code Quality Assessment

### Current Rating: **7.6 / 10**

The Zobia codebase demonstrates strong architectural foundations: idempotent ledger operations with `ON CONFLICT DO NOTHING`, multi-key JWT rotation, XP dead-letter queue with retry, atomic CSRF/CSP hardening, and a well-structured CRON separation. The economy engine (coins, XP, payouts) is particularly robust. However, the codebase carries a cluster of business-logic bugs in the alliance war system, a critical replay-attack gap in the DodoPay webhook, and several silently swallowed errors that make production incidents hard to diagnose.

### Post-Fix Projected Rating: **8.9 / 10**

Fixing the identified bugs would bring the platform to a high-quality production standard. The remaining gap from perfect reflects the inherent complexity of a live social/economy platform with external payment providers and real-time features.

---

## Complete Bug Index (One-Line Summary)

1. BUG-C01: DodoPayments webhook replay dedup bypassed entirely when `eventId` is null
2. BUG-C02: DodoPayments handler silently falls back to `'pro'` plan for unrecognised plan names
3. BUG-C03: `uniqueUsername` builds a SQL regex from an unsanitised email prefix (ReDoS risk + wrong matches)
4. BUG-C04: `safeFetch` forwards all original request headers (including auth) to redirect destination hosts
5. BUG-H01: Alliance wars always immediately re-pair the same two alliances after resolution (infinite rematch loop)
6. BUG-H02: Alliance war: losing alliance's `wars_lost` counter is never incremented
7. BUG-H03: SSRF protection does not block IPv4-mapped IPv6 addresses (`::ffff:192.168.x.x`)
8. BUG-H04: `claimPassMilestone` xp_bonus updates `user_season_passes.season_xp` even when the user row is deleted
9. BUG-M01: Leaderboard snapshot failures are silently swallowed with empty `.catch(() => {})` everywhere
10. BUG-M02: Expo API client maps unrecognised rank tier to `'iron'`, which is not a valid `RankName`
11. BUG-M03: `useOfflineSync` — `resetSendingMessages` called outside `isRunning` guard, causing potential concurrent flush
12. BUG-M04: `getUserRank` performs two separate queries without a transaction, producing stale rank on concurrent XP updates
13. BUG-M05: `reconcile-balances` CRON has an unbounded `while(true)` loop with no time guard, risking timeout on large datasets
14. BUG-M06: `sanitizeAnnouncementContent` passes raw markdown directly to `sanitizeHtml` without prior HTML conversion
15. BUG-L01: `validateCsrfState` performs a non-timing-safe length check before `timingSafeEqual`
16. BUG-L02: PHONE_REGEX in `antispam.ts` can partially match ISO date strings (e.g. `2023-01-01`)
17. BUG-L03: Expo `signIn` persists received JWT to `SecureStore` without any structural validation
18. BUG-L04: PIN verify lockout check is non-atomic — two concurrent wrong attempts can both slip past the threshold check
19. BUG-L05: `checkAndApplyFlashXP` issues a DB query on every single XP award call (no caching)
20. BUG-L06: Monthly plan bonus uses `LIKE` instead of `=` for exact `reference_id` match, preventing index use
21. BUG-L07: `upsertGoogleUser` retry loop only handles username uniqueness violations, not email uniqueness races
22. BUG-L08: `getUserRank` is missing a `season_id IS NULL` filter in its rank-count query for non-season scopes
23. BUG-L09: `pollPushReceipts` holds a session-level advisory lock that may persist across connection-pool reuse
24. BUG-L10: scrypt KDF cold-start on each new serverless instance adds ~100 ms latency to first field decryption

---

## Detailed Bug Entries

---

### BUG-C01 — DodoPayments webhook replay dedup bypassed when `eventId` is null

**Severity:** Critical  

When DodoPayments sends a webhook whose event object has neither `data.id` nor `data.reference`, the route assigns `replayKey = null` and then gates the Redis `SET NX EX` idempotency check with `if (replayKey)`. When `replayKey` is null that entire block is skipped, meaning the same webhook payload can be processed an unlimited number of times. On a `charge.success` event this would credit a user's coins/stars/subscription multiple times.

**FILES:**  
`apps/web/app/api/economy/webhooks/dodopayments/route.ts`

**FIX:**  
If neither `data.id` nor `data.reference` is present, reject the webhook immediately with a `400` (or log and return `200` to stop retries). Never proceed to business logic without a deduplication key. Alternatively, derive a synthetic key from a hash of the raw payload body if DodoPay guarantees deterministic payloads; but rejection is safer.

---

### BUG-C02 — DodoPayments silent `'pro'` plan fallback for unrecognised plan names

**Severity:** Critical  

In the DodoPayments webhook handler's subscription processing, when the incoming `planName` string does not match any entry in `VALID_PLANS`, the code silently falls back to `"pro"` as the activated plan tier. A malformed or unexpected plan name from the provider would therefore incorrectly activate a Pro subscription — an over-entitlement — rather than failing safe. This also masks upstream data changes (e.g. DodoPay renames a plan) that should trigger an alert.

**FILES:**  
`apps/web/lib/payments/dodoWebhookHandler.ts`

**FIX:**  
Remove the silent fallback. If `resolvedPlan` is undefined (no match), throw an error or return early and log a structured alert to `system_alerts`. The webhook route should return `500` on this error so DodoPay retries; an ops alert lets the team identify and map the new plan name.

---

### BUG-C03 — `uniqueUsername` builds SQL regex from unsanitised email prefix

**Severity:** Critical  

`uniqueUsername(base)` executes:
```sql
WHERE (username = $1 OR username ~ ('^' || $1 || '[0-9]+$'))
```
The `$1` parameter is the `base` derived from the user's email address (`email.split("@")[0]`). Postgres's `~` operator evaluates this as a regex. If the email prefix contains special regex characters (e.g. `.`, `(`, `)`, `+`, `*`, `[`, `^`, `$`) those are interpolated directly into the pattern. This has two consequences:

1. **Wrong matches**: an email like `user.name@...` would produce `'^user.name[0-9]+$'` where `.` matches any character, yielding incorrect username uniqueness checks.  
2. **ReDoS potential**: a crafted prefix with pathological regex patterns (e.g. `(a+)+@evil.com`) could cause catastrophic backtracking in the Postgres regex engine, blocking the DB connection.

**FILES:**  
`apps/web/app/api/auth/google/callback/route.ts`

**FIX:**  
Escape regex special characters in `base` before embedding it in the pattern, or change the query to use `username LIKE ($1 || '%')` and filter the returned set in application code. Alternatively, use a parameterised prefix match: `WHERE username = $1 OR (username LIKE ($1 || '%') AND username ~ '^' || quote_literal(base) || '[0-9]+$')`. The simplest safe fix is to escape `base` with a helper: `base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` before embedding in the regex string.

---

### BUG-C04 — `safeFetch` forwards original headers (including `Authorization`) to redirect destinations

**Severity:** Critical (Security)  

When `safeFetch` follows an HTTP redirect, it calls itself recursively with `(redirectUrl, init, ...)` passing the original `init` object unchanged. This means any `Authorization`, `Cookie`, or other sensitive request headers set by the original caller are forwarded to the redirect destination, which may be on an entirely different hostname. A malicious redirect chain could use this to steal credentials sent in the original fetch call.

**FILES:**  
`apps/web/lib/security/ssrf.ts` — `safeFetch` function, redirect handling block (lines ~340–349)

**FIX:**  
When the redirect destination hostname differs from the original, strip sensitive headers before the recursive call. Create a sanitised copy of `init` with `Authorization`, `Cookie`, `X-Api-Key`, and similar headers removed for cross-origin redirects. This mirrors what browsers do when following cross-origin 302 redirects.

---

### BUG-H01 — Alliance wars always immediately re-pair the same two alliances after resolution

**Severity:** High  

In the daily-platform CRON's alliance war resolution (Step 8, "Create next week's pairing"), after resolving a war between `alliance_1_id` and `alliance_2_id`, the code immediately inserts a new active war pairing the identical two alliances:
```sql
INSERT INTO alliance_wars (alliance_1_id, alliance_2_id, status, started_at)
VALUES ($1, $2, 'active', NOW())
ON CONFLICT ... DO NOTHING
```
where `$1` and `$2` are the IDs from the just-resolved war. This means every resolved war immediately spawns a new war between the same pair, creating a permanent 1-vs-1 loop. Alliances never encounter different opponents, undermining the matchmaking step earlier in the same CRON (Step A) which randomly pairs unpaired alliances.

**FILES:**  
`apps/web/app/api/cron/daily-platform/route.ts` — Step 8, the "Create next week's pairing" block (near line 461)

**FIX:**  
Remove the "create next week's pairing" block entirely from within the resolution loop. The unpaired-alliance query at the top of Step 8 (Step A) already pairs unpaired alliances. After resolving a war, both alliances simply become unpaired again and will be matched by Step A on the next Sunday's CRON run, potentially against different opponents.

---

### BUG-H02 — Alliance war: losing alliance's `wars_lost` never updated

**Severity:** High  

When an alliance war is won, the CRON correctly increments `wars_won` for the winner:
```sql
UPDATE guild_alliances SET wars_won = wars_won + 1 ... WHERE id = $1 [winnerId]
```
But there is no corresponding `UPDATE guild_alliances SET wars_lost = wars_lost + 1 WHERE id = $1 [loserId]`. The losing alliance's `wars_lost` stat is permanently stuck at zero regardless of how many wars it has lost. This corrupts league tables, ranking logic, and any UI that displays win/loss ratios.

**FILES:**  
`apps/web/app/api/cron/daily-platform/route.ts` — Step 8 win-path, after the `wars_won` update (around line 416)

**FIX:**  
Add the missing update:
```sql
UPDATE guild_alliances SET wars_lost = wars_lost + 1, updated_at = NOW() WHERE id = $1
```
passing `loserId`. Mirror the same pattern used in `warEngine.ts` for guild-level wars, which correctly updates both `wars_won` and `wars_lost`.

---

### BUG-H03 — SSRF: IPv4-mapped IPv6 addresses bypass private IP check

**Severity:** High  

`isPrivateIp()` in `ssrf.ts` handles IPv6 by checking known private prefixes (`::1`, `fe80:`, `fc`, `fd`, `fec0:`). When none of those match and the hostname contains `:`, it returns `false` (allowed). IPv4-mapped IPv6 addresses like `::ffff:192.168.1.1` or `::ffff:10.0.0.1` contain `:` and do not start with any of those prefixes, so they pass through as "public IPv6 — allow" even though they map to private IPv4 ranges. An attacker who can cause DNS to return such an address (or supplies it directly in some edge case) could reach internal services.

**FILES:**  
`apps/web/lib/security/ssrf.ts` — `isPrivateIp` function

**FIX:**  
Add a check for IPv4-mapped IPv6 addresses before the `includes(":")` early-return:
```typescript
// IPv4-mapped: ::ffff:a.b.c.d
const v4mapped = hostname.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
if (v4mapped) return isPrivateIp(v4mapped[1]);
```
Also add `::` (unspecified address) and `0:0:0:0:0:0:` prefix checks.

---

### BUG-H04 — `claimPassMilestone` xp_bonus updates `user_season_passes.season_xp` for deleted users

**Severity:** High  

In `claimPassMilestone`, when the milestone `reward_type` is `'xp_bonus'`, the flow runs an UPDATE on `users` gated by `WHERE id = $1 AND deleted_at IS NULL`, then unconditionally runs a second UPDATE on `user_season_passes`. If the user has been soft-deleted between season pass creation and milestone claim (or `deleted_at IS NOT NULL` for any other reason), the `users` UPDATE returns zero rows (XP is correctly not awarded), but the `user_season_passes.season_xp` column is still incremented. This causes a persistent discrepancy between the pass's recorded `season_xp` and the user's actual `season_xp` on the `users` table, potentially triggering false audit alerts and corrupting season leaderboard data.

**FILES:**  
`apps/web/lib/seasons/seasonEngine.ts` — `claimPassMilestone`, `xp_bonus` branch

**FIX:**  
Make the `user_season_passes` UPDATE conditional on the `users` UPDATE having succeeded. This can be done with a CTE:
```sql
WITH user_updated AS (
  UPDATE users SET season_xp = season_xp + $2 WHERE id = $1 AND deleted_at IS NULL RETURNING id
)
UPDATE user_season_passes SET season_xp = season_xp + $2 WHERE id = $3 AND EXISTS (SELECT 1 FROM user_updated)
```
This ties both updates to the same gate condition atomically.

---

### BUG-M01 — Leaderboard snapshot failures silently swallowed

**Severity:** Medium  

Throughout `safeAwardXP.ts`, `seasonEngine.ts`, `daily-core/route.ts`, and other callers, calls to `upsertLeaderboardSnapshot` are followed by `.catch(() => {})` — an empty catch that discards all errors with no logging. If the `leaderboard_snapshots` upsert fails (connection error, constraint violation, schema mismatch), the XP is awarded to the user but their leaderboard position becomes stale or absent. There is no alert, no retry, and no way for ops to detect this silent drift. Over time this produces leaderboard data that diverges from actual user XP.

**FILES:**  
`apps/web/lib/xp/safeAwardXP.ts` (lines ~113, ~122)  
`apps/web/lib/seasons/seasonEngine.ts` (multiple `.catch(() => {})` on snapshot calls)  
`apps/web/app/api/cron/daily-core/route.ts` (leaderboard upsert `.catch` blocks)

**FIX:**  
Replace all empty `.catch(() => {})` on snapshot calls with `.catch((err) => logger.warn({ err, userId, track }, '[leaderboard] snapshot upsert failed'))`. For the most critical paths (XP award in `safeAwardXP`), enqueue the failed snapshot update to a lightweight Redis list for the leaderboard CRON to pick up, rather than silently dropping it.

---

### BUG-M02 — Expo API client maps unrecognised rank tier to invalid `'iron'`

**Severity:** Medium  

In `apps/expo/lib/api/client.ts`, when mapping the `/api/users/me` response to the local profile shape, unrecognised `rank_name` values fall back to `'iron'` as the `rankTier`:
```typescript
rankTier: data.rank_name ?? 'iron',
```
However, `'iron'` is not a value in the `RankName` union type (the system ranks begin at `'Beginner'`). This creates a type-level lie that propagates through all rank-display components in the Expo app. Any component that maps `rankTier` to a colour, icon, or label will either crash (if it's exhaustively typed) or display nothing/incorrect UI for a user whose `rank_name` is null.

**FILES:**  
`apps/expo/lib/api/client.ts` — profile mapping, `rankTier` fallback

**FIX:**  
Change the fallback to `'Beginner'`, which is the valid lowest rank: `rankTier: data.rank_name ?? 'Beginner'`. Also consider adding a Zod/type guard so that if the server returns an unexpected rank name the app logs it rather than silently accepting bad data.

---

### BUG-M03 — `useOfflineSync` `resetSendingMessages` called outside the `isRunning` guard

**Severity:** Medium  

`useOfflineSync` in the web app protects `flushQueue()` with an `isRunning` ref to prevent concurrent execution. However, the setup pattern is:
```typescript
resetSendingMessages().then(() => flushQueue())
```
`resetSendingMessages` itself is called outside the `isRunning` guard. If two competing paths both trigger this (e.g., `handleOnline` event and the mount `useEffect` both fire around the same time), `resetSendingMessages` runs twice concurrently. The second call could reset messages that the first `flushQueue` is already processing, causing messages to appear as stuck and be flushed twice or dropped.

**FILES:**  
`apps/web/lib/offline/useOfflineSync.ts` — `handleOnline` and mount `useEffect`

**FIX:**  
Wrap the entire sequence `resetSendingMessages().then(() => flushQueue())` inside the `isRunning` guard:
```typescript
if (!isRunning.current) {
  isRunning.current = true;
  resetSendingMessages()
    .then(() => flushQueue())
    .finally(() => { isRunning.current = false; });
}
```
This ensures exactly one concurrent execution path at all times.

---

### BUG-M04 — `getUserRank` TOCTOU: rank changes between the two queries

**Severity:** Medium  

`getUserRank` in `lib/leaderboards/engine.ts` operates in two steps: (1) fetch the user's current XP from `leaderboard_snapshots`, (2) count the number of users with strictly higher XP. These are two independent `SELECT` queries without a transaction or snapshot isolation. Between them, other users' XP values can change. A user receiving a large XP award between query 1 and query 2 could cause the returned rank to be wrong by one or more positions. On high-traffic platforms this produces flickers in the rank display.

**FILES:**  
`apps/web/lib/leaderboards/engine.ts` — `getUserRank` function

**FIX:**  
Combine both queries into a single CTE that reads the user's XP and computes the rank atomically:
```sql
WITH my_xp AS (
  SELECT xp_value FROM leaderboard_snapshots
  WHERE user_id = $1 AND track = $2 AND scope = $3 ... LIMIT 1
)
SELECT COUNT(*) + 1 AS rank
FROM leaderboard_snapshots ls JOIN users u ON u.id = ls.user_id
WHERE ls.xp_value > (SELECT xp_value FROM my_xp)
  AND ls.track = $2 AND ls.scope = $3 ... AND u.deleted_at IS NULL
```
This eliminates the TOCTOU window.

---

### BUG-M05 — `reconcile-balances` CRON has unbounded `while(true)` loop

**Severity:** Medium  

`/api/cron/reconcile-balances/route.ts` iterates over all non-deleted users in batches of 500 with a `while(true)` loop that only exits when a batch returns zero rows. With `maxDuration` not set (the file has no explicit limit), and no time-based exit condition, this will timeout silently on datasets with many thousands of users. A Vercel function that exceeds its execution limit is killed mid-loop, leaving the reconciliation partially complete with no indication of where it stopped. Repeated partial runs can also cause `autoCorrected` tallies to be inaccurate.

**FILES:**  
`apps/web/app/api/cron/reconcile-balances/route.ts`

**FIX:**  
Add `export const maxDuration = 300;` to allow up to 5-minute runs on Pro plans. Add a row-count ceiling: track total rows processed and break out of the loop after N (e.g. 100 000) rows, returning the `offset` in the response body so the next CRON invocation can resume from that point. Alternatively, implement cursor-based pagination using `WHERE id > $lastId ORDER BY id` for deterministic resumability.

---

### BUG-M06 — `sanitizeAnnouncementContent` markdown path passes raw markdown to HTML sanitizer

**Severity:** Medium  

When `contentType === 'markdown'`, `sanitizeAnnouncementContent` patches link targets in the raw markdown string and then passes the raw markdown text directly to `sanitizeHtml`. The `sanitize-html` library expects HTML input, not Markdown. Raw Markdown syntax (e.g. `**bold**`, `_italic_`, `# heading`) passes through unchanged — `sanitize-html` does not strip it because it sees no HTML tags. Malicious markdown that injects raw HTML fragments (e.g. `<script>alert(1)</script>` embedded in a markdown string) may partially survive because `sanitize-html` strips HTML tags but the surrounding markdown-formatted text remains unprocessed. This does not guarantee full XSS prevention for markdown content.

**FILES:**  
`apps/web/lib/security/htmlSanitizer.ts` — `sanitizeAnnouncementContent`

**FIX:**  
Before calling `sanitizeHtml`, convert the markdown to HTML using a library like `marked` or `remark`. Only then pass the HTML to `sanitizeHtml`. The pipeline should be: `markdown → HTML (marked/remark) → sanitizeHtml(HTML, SANITIZE_OPTIONS)`. The link-target patching regex can then be applied to the HTML output instead of the raw markdown source.

---

### BUG-L01 — `validateCsrfState` non-timing-safe length check before `timingSafeEqual`

**Severity:** Low  

In `lib/security/csrf.ts`, `validateCsrfState` checks `a.length !== b.length` before calling `timingSafeEqual`. This length comparison is a conventional if-statement that returns immediately for mismatched lengths, leaking whether the attacker has the correct token length via a timing difference. For CSRF tokens of a fixed known length (64 hex chars = 32 bytes) this is low risk since the length is public knowledge. However it violates the constant-time guarantee and is a defence-in-depth gap.

**FILES:**  
`apps/web/lib/security/csrf.ts` — `validateCsrfState`

**FIX:**  
For constant-time comparison of strings that may differ in length, pad both to the same length before comparing, or use a constant-time string comparison that handles different lengths without branching. Since CSRF tokens have a fixed known length, assert both are exactly 64 chars (throw if not) before `timingSafeEqual`.

---

### BUG-L02 — PHONE_REGEX in `antispam.ts` can partially match ISO date strings

**Severity:** Low  

The PHONE_REGEX pattern in `antispam.ts` is designed to strip phone numbers from messages but can also match substrings of ISO date strings like `2023-01-01` or `+234-811-123-4567` in text that contains a date alongside a valid phone pattern. While the 7-digit minimum filter mitigates most false positives, a date-heavy message (e.g. "Call before 2023-01-01 for info") could have date fragments stripped, garbling the message. `lastIndex` is correctly reset before each use so the issue is in the pattern breadth, not stateful regex bugs.

**FILES:**  
`apps/web/lib/messaging/antispam.ts` — `PHONE_REGEX`

**FIX:**  
Add negative lookahead/lookbehind to exclude digit sequences that are preceded/followed by `-` in a date-like context. Alternatively, require that phone digits include a country code prefix (`+`) or match the full international pattern without date-like separators. Adding a word-boundary anchor (`\b`) at the start of the pattern would prevent partial-string matches from triggering.

---

### BUG-L03 — Expo `signIn` stores JWT to `SecureStore` without structural validation

**Severity:** Low  

In `apps/expo/lib/auth/context.tsx`, `signIn` receives `accessToken` and `refreshToken` from the server response and stores them directly via `SecureStore.setItemAsync` without validating JWT structure. If the server returns a malformed response (e.g. due to a network glitch, proxy error, or future API version mismatch), an invalid string gets persisted. On the next app launch, `restoreSession` would attempt to parse and use this invalid token, potentially causing a cryptic crash in `jose`'s `decodeJwt` rather than a clean "session expired" flow.

**FILES:**  
`apps/expo/lib/auth/context.tsx` — `signIn` function

**FIX:**  
Before storing, validate that both tokens are non-empty strings matching the JWT 3-segment format (`/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/`). If validation fails, throw an error so `signIn` rejects cleanly rather than persisting garbage.

---

### BUG-L04 — PIN verify lockout check is non-atomic (TOCTOU)

**Severity:** Low  

In `/api/auth/pin/verify`, the failure count is read from Redis, checked against the threshold, and then the bcrypt comparison runs (~100 ms). If two concurrent wrong-PIN requests both read the failure count below the threshold (e.g. both see `failures = 9`), both proceed to the bcrypt comparison and both increment the counter to 10 and 11 respectively. The lockout triggers on the THIRD concurrent request, not the second as intended. Given the rate limiter (`RATE_LIMITS.pinVerify: 5/15min`) also applies, the practical impact is minimal, but the lockout threshold is not guaranteed to be exact.

**FILES:**  
`apps/web/app/api/auth/pin/verify/route.ts`

**FIX:**  
Use a Lua script or Redis `INCR` + `GET` in a single atomic op to check-and-increment, or rely solely on the sliding-window rate limiter (`RATE_LIMITS.pinVerify`) for enforcement and remove the bespoke failure-count lock. The rate limiter is already atomic via its Lua script. If the bespoke counter is kept, add a comment explaining the deliberate race tolerance.

---

### BUG-L05 — `checkAndApplyFlashXP` issues a DB query on every XP award call

**Severity:** Low (Performance)  

`checkAndApplyFlashXP` in `lib/events/flashXP.ts` is called for every XP award to check for an active Flash XP event. It performs a `SELECT` from `flash_xp_events` on each call. Flash XP events are relatively rare and change infrequently (transitions happen at most hourly via the guild-wars CRON). On a platform with high XP activity (message sends, quest completions, gift sends all triggering XP), this is N DB queries per second where N is the XP event throughput rate, creating unnecessary DB load even when no flash event is active.

**FILES:**  
`apps/web/lib/events/flashXP.ts` — `checkAndApplyFlashXP`

**FIX:**  
Cache the active flash event state in Redis with a short TTL (e.g. 60 seconds). `checkAndApplyFlashXP` reads from the Redis cache first; only on a cache miss does it query the DB. The guild-wars / platform CRON should invalidate the cache when transitioning flash event states (`fired=TRUE` or `is_active=FALSE`). This reduces flash-event DB load by orders of magnitude.

---

### BUG-L06 — Monthly plan bonus uses `LIKE` instead of `=` for exact `reference_id` match

**Severity:** Low (Performance)  

In `daily-economy/route.ts`, the monthly plan coin bonus CTE checks whether a bonus was already awarded with:
```sql
WHERE ... AND reference_id LIKE 'plan:' || users.id::text || ':' || $4
```
Since the pattern contains no `%` or `_` wildcards, this is logically equivalent to an equality check (`=`), but Postgres cannot use a B-tree index on `reference_id` for a `LIKE` comparison (even without wildcards) as efficiently as an equality scan. On a large `coin_ledger` table with many rows, this subquery runs a sequential scan instead of an index seek for every eligible user.

**FILES:**  
`apps/web/app/api/cron/daily-economy/route.ts` — monthly plan bonus CTE, the `NOT EXISTS` subquery

**FIX:**  
Replace `LIKE` with `=`:
```sql
AND reference_id = 'plan:' || users.id::text || ':' || $4
```
This allows the index on `coin_ledger(user_id, transaction_type, reference_id)` to be used as an index scan.

---

### BUG-L07 — `upsertGoogleUser` retry loop only handles username uniqueness, not email races

**Severity:** Low  

The `upsertGoogleUser` function retries up to 3 times if the `INSERT INTO users` fails with PG error `23505` (unique violation), but only in the username uniqueness path. If two concurrent sign-ups with the same Google email occur simultaneously (e.g. rapid double-tap on the sign-in button in the mobile app), the second request might hit the `email` unique constraint violation — not the `username` constraint — and the retry loop would still re-throw the error (since it only continues on `23505` for username-related conflicts). This surfaces as an unhandled internal server error to the second concurrent user.

**FILES:**  
`apps/web/app/api/auth/google/callback/route.ts` — `upsertGoogleUser`, new-user creation loop

**FIX:**  
After the `23505` catch, check whether the constraint name or message indicates a `users_email_key` (email uniqueness) violation. If so, re-query for the newly-inserted user (a concurrent insert just beat us to it) and return that existing row rather than retrying the insert. This is the "read your own writes via exception" pattern for concurrent upsert safety.

---

### BUG-L08 — `getUserRank` missing `season_id IS NULL` filter in rank-count query for global scope

**Severity:** Low  

In `getUserRank`, when computing the rank count, a `ls.city IS NULL` condition is added for non-city scopes. However, no equivalent `ls.season_id IS NULL` condition is added for non-season scopes. If any code path ever upserts a row into `leaderboard_snapshots` with `scope='global'` but a non-null `season_id` (a defensive scenario that could arise from future code changes or data migration), those rows would be incorrectly included in the global rank count, inflating the rank numbers for all other users.

**FILES:**  
`apps/web/lib/leaderboards/engine.ts` — `getUserRank`, rank-count query conditions builder

**FIX:**  
Add a symmetric filter alongside the city filter:
```typescript
if (!options?.seasonId) {
  conditions.push(`ls.season_id IS NULL`);
}
```
This mirrors the `ls.city IS NULL` guard and ensures global scope queries only count rows without a season anchor.

---

### BUG-L09 — `pollPushReceipts` holds a session-level PostgreSQL advisory lock with connection pool risk

**Severity:** Low  

`pollPushReceipts` acquires a session-level advisory lock via `pg_try_advisory_lock(1, hashtext('pollPushReceipts'))` and releases it in a `finally` block. Session-level advisory locks are tied to the database connection, not the query. In connection-pooled environments (e.g. PgBouncer in transaction mode, or Neon's serverless driver), the pool may return the connection to another caller between queries, carrying the advisory lock with it. If the serverless function is killed before the `finally` block executes, the lock is released only when the underlying TCP connection is closed — which in pooled setups could be delayed indefinitely, blocking all future CRON runs.

**FILES:**  
`apps/web/lib/notifications/push.ts` — `pollPushReceipts`

**FIX:**  
Use a transaction-level advisory lock (`pg_try_advisory_xact_lock`) inside a transaction instead of a session-level lock. Transaction-level locks are released automatically when the transaction commits or rolls back, making them safe in connection-pooled environments. Alternatively, use a Redis `SET NX EX` lock with a TTL as the CRON mutex, which does not depend on DB connection lifecycle.

---

### BUG-L10 — scrypt KDF cold-start adds ~100 ms latency on each new serverless instance

**Severity:** Low (Performance)  

`fieldEncryption.ts` derives the AES-256 key using `scryptSync(raw, salt, 32, { N: 16384, r: 8, p: 1 })` on first call per version. The `keyCache` Map is module-level but is lost on each new serverless instance cold start. In high-churn environments (e.g. spike traffic after a marketing push), many concurrent cold starts each pay this ~100 ms blocking cost synchronously, delaying all routes that touch encrypted fields (KYC data, TOTP secrets, PINs) during the scrypt invocation. On Vercel's Hobby plan with low max-duration functions, this can consume a meaningful fraction of the budget.

**FILES:**  
`apps/web/lib/security/fieldEncryption.ts` — `getKeyForVersion`

**FIX:**  
There is no way to fully avoid the scrypt cost on true cold start since it needs to run before keys are usable. However, you can reduce the impact by: (a) calling `getKeyForVersion('v2')` during module initialization (top-level `await` or `init` export) so the cost is paid at startup rather than on the first real request; (b) considering a pre-computed key stored as a KMS-encrypted secret, retrieved at startup — this replaces scrypt with a fast symmetric unwrap; or (c) reducing `N` to 8192 which halves the time at acceptable security cost for a server-side key that never leaves the application.

---

## Summary Table

| ID | Severity | Area | Impact |
|----|----------|------|--------|
| BUG-C01 | Critical | Payments | Double-credit users via replay attack |
| BUG-C02 | Critical | Payments | Over-entitlement (wrong plan tier) |
| BUG-C03 | Critical | Auth | ReDoS / incorrect username matching |
| BUG-C04 | Critical | Security | Credential leakage to redirect destinations |
| BUG-H01 | High | Guilds | Alliance war matchmaking broken permanently |
| BUG-H02 | High | Guilds | Alliance war stats corrupted |
| BUG-H03 | High | Security | SSRF bypass via IPv4-mapped IPv6 |
| BUG-H04 | High | Seasons | Season pass XP discrepancy for deleted users |
| BUG-M01 | Medium | Leaderboard | Silent snapshot drift, invisible in logs |
| BUG-M02 | Medium | Expo | Invalid rank type, UI display failures |
| BUG-M03 | Medium | Offline | Race condition in message sync |
| BUG-M04 | Medium | Leaderboard | Stale rank reads under concurrency |
| BUG-M05 | Medium | CRON | Partial reconciliation on large datasets |
| BUG-M06 | Medium | Security | Incomplete markdown sanitization |
| BUG-L01 | Low | Security | Timing side-channel in CSRF |
| BUG-L02 | Low | Messaging | False positives stripping dates as phone numbers |
| BUG-L03 | Low | Expo Auth | Bad token persisted to secure storage |
| BUG-L04 | Low | Auth | PIN lockout threshold not exact |
| BUG-L05 | Low | Performance | DB hit on every XP award |
| BUG-L06 | Low | Performance | Index not used for coin dedup check |
| BUG-L07 | Low | Auth | Email race on concurrent Google sign-ins |
| BUG-L08 | Low | Leaderboard | Possible rank inflation from missing filter |
| BUG-L09 | Low | Push | Advisory lock pool compatibility risk |
| BUG-L10 | Low | Performance | 100ms cold-start hit per new serverless instance |

---

*Report generated: 2026-06-20 | 11:33 PM*  
*Analyst: Forensic AI Code Review | zobia codebase — web + PWA + Expo Android*
