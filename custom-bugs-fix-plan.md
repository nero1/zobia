# Zobia Social — Bug Fix Plan
**Date: 2026-06-20 | Time: 11:33 PM**

This plan covers all 24 bugs identified in `custom-bugs-report.md`. Tasks are ordered by severity (Critical → High → Medium → Low). Each task is self-contained and can be handed to a developer independently. No bug is skipped.

---

## CRITICAL — Fix Immediately (4 tasks)

---

### ✅ TASK-C01 · BUG-C01: DodoPayments webhook replay dedup bypass
**Files:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`, `apps/web/lib/payments/dodoWebhookHandler.ts`

**Steps:**
1. In the DodoPay webhook route handler, check if `eventId` (or the equivalent unique field from the Dodo payload) is `null` or `undefined` before processing.
2. If the event has no unique identifier, reject it early with a `400 Bad Request` and a log line explaining the reason (do not silently skip).
3. Alternatively, generate a deterministic fallback key from stable payload fields (e.g. `${type}:${provider_reference}:${amount}`) and use that as the Redis NX dedup key so the idempotency guard never has a null path.
4. Ensure the Redis `SET NX EX` call is placed before any DB writes, matching the same guard pattern used in the Paystack handler.
5. Add a unit test: send two identical DodoPay payloads with `eventId: null`; assert only one DB write occurs.

---

### ✅ TASK-C02 · BUG-C02: DodoPayments silent 'pro' plan fallback
**Files:** `apps/web/lib/payments/dodoWebhookHandler.ts`

**Steps:**
1. Locate the switch/if-else block that maps incoming Dodo plan names to internal plan identifiers.
2. Remove the silent fallback that maps unrecognised plan names to `'pro'`.
3. Replace it with an explicit rejection: log a `ERROR` level entry with the unrecognised plan name and the full event payload, then return without applying any subscription change.
4. Optionally, insert a row into `system_alerts` (severity `warning`) so the admin panel surfaces the event for manual review.
5. Test: send a Dodo event with `plan: "mystery_plan"` and assert the user's subscription tier is NOT changed and a system alert row is created.

---

### ✅ TASK-C03 · BUG-C03: `uniqueUsername` SQL regex from unsanitised email prefix (ReDoS)
**Files:** `apps/web/app/api/auth/google/callback/route.ts`

**Steps:**
1. Find the `uniqueUsername` helper (or inline block) that derives a candidate username from the Google OAuth email address.
2. Replace the raw string interpolation into the SQL `~` regex operator with a fixed parameterised approach: run `SELECT username FROM users WHERE username = $1` against each candidate (base, base1, base2, …) rather than a single regex query.
3. If a loop-based approach is undesirable for performance, sanitise the email prefix with a strict `replace(/[^a-z0-9_]/gi, '')` before interpolating it, then set a hard cap of 32 characters. Reject any prefix that is empty after stripping.
4. Document the chosen approach with a one-line comment explaining why regex interpolation was replaced.
5. Verify with a test: pass an email like `a++++b@example.com` and assert the code terminates in < 50 ms and produces a valid username.

---

### ✅ TASK-C04 · BUG-C04: `safeFetch` forwards all headers to redirect destinations
**Files:** `apps/web/lib/security/ssrf.ts`

**Steps:**
1. In the `safeFetch` redirect handler, strip all headers before following a redirect to a different origin.
2. Keep only a safe allowlist (e.g. `Accept`, `Content-Type`, `User-Agent`) for cross-origin redirects. Headers like `Authorization`, `Cookie`, `X-Api-Key`, and any internal `x-*` headers must be removed.
3. For same-origin redirects (where the destination host equals the original host) the full header set may be preserved.
4. After filtering, validate the redirect destination with `isPrivateIp` (see also TASK-H03) before following.
5. Write a test: issue `safeFetch` against a URL that 302-redirects to `https://evil.example.com`; assert that no `Authorization` header arrives at the destination.

---

## HIGH — Fix Within the Sprint (4 tasks)

---

### ✅ TASK-H01 · BUG-H01: Alliance wars immediate re-pair after resolution
**Files:** `apps/web/app/api/cron/daily-platform/route.ts`, `apps/web/lib/guilds/warEngine.ts` (if `findWarOpponent` is called there)

**Steps:**
1. After a war resolves, record both alliance IDs and the resolution timestamp in a `recent_war_opponents` table (or a `last_opponent_id` + `last_war_resolved_at` column on the `alliances` table).
2. In `findWarOpponent` / the pairing query, add a `WHERE id != $lastOpponentId OR last_war_resolved_at < NOW() - INTERVAL '7 days'` clause (adjust the cooldown period to match game design).
3. If no eligible opponent exists outside the cooldown window, skip pairing for this cycle instead of re-pairing.
4. Test: create two alliances, resolve a war between them, run the pairing CRON immediately, assert they are NOT re-paired.

---

### ✅ TASK-H02 · BUG-H02: Alliance war loser's `wars_lost` never incremented
**Files:** `apps/web/app/api/cron/daily-platform/route.ts`, `apps/web/lib/guilds/warEngine.ts`

**Steps:**
1. Locate the war resolution block that increments `wars_won` for the winning alliance.
2. Add a matching `UPDATE alliances SET wars_lost = wars_lost + 1 WHERE id = $loserAllianceId` in the same transaction (or the same CTE if the update is SQL-based).
3. Ensure draw handling either increments both or neither (match game design intent).
4. Test: run a war resolution with a clear winner; assert `wars_lost = 1` on the losing alliance row.

---

### ✅ TASK-H03 · BUG-H03: SSRF — IPv4-mapped IPv6 addresses bypass private IP check
**Files:** `apps/web/lib/security/ssrf.ts`

**Steps:**
1. In `isPrivateIp`, before running the existing IPv4 range checks, detect and unwrap IPv4-mapped IPv6 addresses: if the input matches `::ffff:<ipv4>` (regex `^::ffff:(\d+\.\d+\.\d+\.\d+)$`) extract the IPv4 part and run the range checks against it.
2. Also block `::1` (IPv6 loopback) and `fc00::/7` (ULA private range) explicitly.
3. Add the following test cases: `::ffff:127.0.0.1`, `::ffff:192.168.1.1`, `::ffff:10.0.0.1`, `::1` — all must return `true` (private/blocked).

---

### ✅ TASK-H04 · BUG-H04: `claimPassMilestone` awards XP bonus to deleted users
**Files:** `apps/web/lib/seasons/seasonEngine.ts`

**Steps:**
1. In the `claimPassMilestone` function, before or inside the `UPDATE season_pass` CTE/query, add `AND u.deleted_at IS NULL` (join or EXISTS subquery against `users`) so the update only fires for non-deleted users.
2. The XP award call (`safeAwardXP`) that follows should already be guarded by the RETURNING check — confirm that if the UPDATE returns no rows, `safeAwardXP` is NOT called.
3. Test: soft-delete a user, call `claimPassMilestone` for that user, assert the `season_pass` row is not updated and XP is not awarded.

---

## MEDIUM — Fix Before Next Release (6 tasks)

---

### ✅ TASK-M01 · BUG-M01: Leaderboard snapshot errors silently swallowed
**Files:** `apps/web/lib/xp/safeAwardXP.ts`, `apps/web/lib/leaderboards/engine.ts` (call sites)

**Steps:**
1. Replace bare `.catch(() => {})` on all `upsertLeaderboardSnapshot` calls with `.catch((err) => logger.warn({ err, userId }, '[leaderboard] snapshot upsert failed'))`.
2. Do NOT rethrow — the XP award itself succeeded; snapshot failure should not roll back XP. Logging at `warn` level is sufficient.
3. Search for all `upsertLeaderboardSnapshot` call sites with a global grep and apply the same change uniformly.
4. If a DLQ or monitoring alert for repeated snapshot failures is desired in future, that is a separate task; for now, logging is the minimum fix.

---

### ✅ TASK-M02 · BUG-M02: Expo API client maps unknown rank tier to invalid `'iron'`
**Files:** `apps/expo/lib/api/client.ts`

**Steps:**
1. Find the rank tier mapping/fallback logic in the Expo API client.
2. Replace the hardcoded `'iron'` fallback with the correct lowest valid tier value (e.g. `'bronze'` or whatever the backend's canonical minimum tier is — check `apps/web/lib/xp/engine.ts` rank thresholds for the authoritative list).
3. If the server returns a tier string that is not in the known enum, log a warning and use the canonical minimum rather than a non-existent tier.
4. Test: mock an API response with `rank_tier: "unknown_future_tier"` and assert the Expo client's displayed tier falls back to the minimum valid tier, not `'iron'`.

---

### ✅ TASK-M03 · BUG-M03: `useOfflineSync` calls `resetSendingMessages` outside `isRunning` guard
**Files:** `apps/web/lib/offline/useOfflineSync.ts`

**Steps:**
1. Locate the call to `resetSendingMessages` (or equivalent state-reset helper) that sits outside the `isRunning` mutex guard.
2. Move it inside the guard, or add a separate `isRunning` check wrapping it, so concurrent flush invocations cannot both reset the queue simultaneously.
3. Verify the guard is released (set back to `false`) in a `finally` block to avoid a permanent lock if an exception is thrown.
4. Test: simulate two rapid calls to the flush function; assert `resetSendingMessages` is called exactly once.

---

### ✅ TASK-M04 · BUG-M04: `getUserRank` TOCTOU (two-query rank fetch)
**Files:** `apps/web/lib/leaderboards/engine.ts`

**Steps:**
1. Replace the current two-step approach (1. fetch user's score, 2. count users with higher score) with a single window-function query:
   ```sql
   SELECT RANK() OVER (ORDER BY score DESC) AS rank, score
   FROM leaderboard_snapshots
   WHERE track = $1 AND season_id IS NOT DISTINCT FROM $2
   AND user_id = $3
   ```
   Or equivalently, use a CTE that computes all ranks atomically and filters for the target user.
2. This ensures the rank and score are drawn from the same snapshot of the table.
3. Remove the now-redundant second query.

---

### ✅ TASK-M05 · BUG-M05: `reconcile-balances` unbounded `while(true)` loop
**Files:** `apps/web/app/api/cron/reconcile-balances/route.ts`

**Steps:**
1. Add a hard iteration cap to the `while(true)` loop (e.g. `const MAX_ITERATIONS = 1000; let iter = 0;`).
2. At the top of each loop body, check `if (++iter > MAX_ITERATIONS) { logger.error('reconcile-balances: hit iteration cap'); break; }`.
3. After the loop, log if the cap was hit, emit a `system_alert`, and return a `500` or a partial-success response with a descriptive body so operators know reconciliation is incomplete.
4. Separately, verify the loop's exit condition (e.g. `rows.length === 0`) is reachable and not accidentally defeated by a bug in the query.

---

### ✅ TASK-M06 · BUG-M06: `sanitizeAnnouncementContent` passes raw markdown to HTML sanitizer
**Files:** `apps/web/lib/security/htmlSanitizer.ts`

**Steps:**
1. In `sanitizeAnnouncementContent` (or the caller), when the content type is `'markdown'`, convert the markdown to HTML first (using the project's existing markdown renderer) and THEN pass the resulting HTML string to `sanitizeHtml`.
2. If no markdown renderer is yet wired in, use a lightweight library (`marked` or `micromark`) for the conversion step.
3. Never pass raw markdown directly to `sanitizeHtml` — the sanitizer operates on HTML tokens and will either strip or misparse markdown syntax.
4. Add a test: pass `**<script>alert(1)</script>**` as markdown content; assert the output is `<strong></strong>` (or similar safe HTML) and contains no `<script>` tags.

---

## LOW — Fix When Convenient (10 tasks)

---

### ✅ TASK-L01 · BUG-L01: `validateCsrfState` non-timing-safe length check
**Files:** `apps/web/lib/security/csrf.ts`

**Steps:**
1. Remove the early-return `if (a.length !== b.length) return false` line that leaks length information before `timingSafeEqual` is called.
2. Instead, pad the shorter buffer to match the longer one, or simply call `timingSafeEqual` directly after converting both strings to `Buffer` — `timingSafeEqual` already returns `false` for buffers of different lengths without a timing side-channel.
3. Confirm both arguments to `timingSafeEqual` are `Buffer` or `TypedArray` instances (not raw strings) to avoid the Node.js type-check throw.

---

### ✅ TASK-L02 · BUG-L02: PHONE_REGEX partial-matches ISO date strings
**Files:** `apps/web/lib/messaging/antispam.ts`

**Steps:**
1. Add word-boundary or start/end anchors to the phone regex pattern so it does not partially match within a longer string that happens to contain digit runs (e.g. ISO timestamps like `2026-06-20T11:33:00`).
2. The simplest fix is adding `\b` anchors around the digit groups, or adding a negative lookbehind/lookahead for `-` or `:` to exclude date/time contexts.
3. Test: pass `"Meeting at 2026-06-20T11:33:00Z"` — assert no phone number is detected. Also test a real phone number `"+2348012345678"` — assert it IS detected.

---

### ✅ TASK-L03 · BUG-L03: Expo `signIn` persists JWT without structural validation
**Files:** `apps/expo/lib/auth/context.tsx`

**Steps:**
1. After receiving the token pair from the server, decode (not verify — signature verification belongs on the server) the access token's payload using a lightweight JWT decode (e.g. `jose`'s `decodeJwt`) and assert that the required claims (`sub`, `exp`, `type`) are present before calling `SecureStore.setItemAsync`.
2. If the payload is malformed, throw an authentication error and do not persist the token.
3. This is a belt-and-suspenders guard only — it is not a security control (the server already signed and validated the token), but it prevents corrupted storage from leaving the app in a broken state.

---

### ✅ TASK-L04 · BUG-L04: PIN verify lockout TOCTOU
**Files:** `apps/web/app/api/auth/pin/verify/route.ts`

**Steps:**
1. Replace the current read-then-write lockout pattern with an atomic `UPDATE … SET failed_attempts = failed_attempts + 1 … RETURNING failed_attempts, locked_until` query that both increments the counter and checks the threshold in one round-trip.
2. Only read the lockout status from the RETURNING clause, not from a prior SELECT.
3. For the "is locked?" pre-check, a SELECT is fine (it's a read-only guard and the worst case is a slightly stale read that lets one extra attempt through — the atomic increment below catches it).
4. Ensure the lockout timestamp is set in the same UPDATE that crosses the threshold, not in a subsequent UPDATE.

---

### ✅ TASK-L05 · BUG-L05: `checkAndApplyFlashXP` issues a DB query on every XP award
**Files:** `apps/web/lib/events/flashXP.ts`

**Steps:**
1. Cache the active flash XP event in Redis (or an in-process module-level variable with a short TTL, e.g. 60 seconds) so the DB is not queried on every call.
2. On cache miss, fetch from DB and populate the cache with a `SET EX 60` (60-second TTL) so that when no event is active the negative result is also cached.
3. On event activation/deactivation (from the admin panel), invalidate the cache key.
4. This is a performance fix; correctness is not materially affected by a 60-second staleness window for flash XP events.

---

### ✅ TASK-L06 · BUG-L06: Monthly plan bonus uses `LIKE` instead of `=`
**Files:** `apps/web/app/api/cron/daily-economy/route.ts`

**Steps:**
1. Find the query that checks for the monthly bonus using `reference_id LIKE $1`.
2. Change `LIKE` to `=` for the exact match.
3. Ensure `$1` is the full `reference_id` string (not a pattern with `%` wildcards).
4. Confirm there is no place in the codebase that legitimately generates `reference_id` values that need a prefix/wildcard match for this query.

---

### ✅ TASK-L07 · BUG-L07: `upsertGoogleUser` retry loop ignores email uniqueness races
**Files:** `apps/web/app/api/auth/google/callback/route.ts`

**Steps:**
1. The retry loop currently only retries on username-uniqueness constraint violations. Identify the specific Postgres error code for the email unique constraint violation (same `23505` but on a different column/index).
2. In the catch block, also handle the email uniqueness conflict: if the email is already taken, look up the existing user by email and return that user record (this is a re-authentication by an existing user, not a registration conflict).
3. Ensure the retry loop has a hard cap (e.g. 5 attempts) and re-throws after exhausting retries.

---

### 🔵 TASK-L08 · BUG-L08: `getUserRank` missing `season_id IS NULL` filter — FALSE POSITIVE (already fixed in codebase)
**Files:** `apps/web/lib/leaderboards/engine.ts`

**Steps:**
1. In the `getUserRank` function, locate the query that fetches rank for the non-season (all-time) scope.
2. Add `AND season_id IS NULL` to the WHERE clause so it does not accidentally aggregate across all season rows.
3. Confirm that the season-scoped path correctly uses `AND season_id = $seasonId`.
4. If `season_id` uses `IS NOT DISTINCT FROM` semantics elsewhere, apply the same pattern here for consistency.

---

### ✅ TASK-L09 · BUG-L09: `pollPushReceipts` holds session-level advisory lock with pooled connections
**Files:** `apps/web/lib/notifications/push.ts`

**Steps:**
1. Replace `pg_advisory_lock` (session-level) with `pg_try_advisory_lock` so the call is non-blocking: if the lock is already held, skip this invocation rather than queuing behind it.
2. Wrap the entire receipt-polling block in: acquire lock → do work → release lock (`pg_advisory_unlock`) in a `finally` block.
3. Because this runs inside a connection pool, ensure the lock acquisition and release happen on the SAME connection object. Use a dedicated single connection (`.connect()`) for this operation rather than a pool query, or run it inside a `client.query` sequence where the client is held for the full duration.
4. Test: invoke `pollPushReceipts` concurrently twice; assert only one run proceeds and the other skips immediately.

---

### ✅ TASK-L10 · BUG-L10: scrypt KDF cold-start latency per serverless instance
**Files:** `apps/web/lib/security/fieldEncryption.ts`

**Steps:**
1. Add a module-level warm-up call to the scrypt-based KDF when the module is first imported (not inside the encrypt/decrypt functions). This amortises the ~100 ms cold-start cost across the first request rather than blocking it.
2. Alternatively, pre-derive and cache the encryption key at module load time (if the key material is static/env-driven) so subsequent calls return the cached key immediately.
3. If key rotation is in progress (multiple key versions), warm all active key versions at startup.
4. Document with a one-line comment that the warm-up is intentional to avoid cold-start latency on the first encrypted field access.

---

## Fix Order Summary

| Priority | Task | Bug Code | Effort |
|----------|------|----------|--------|
| 1 | TASK-C01 | BUG-C01 | Medium |
| 2 | TASK-C02 | BUG-C02 | Small |
| 3 | TASK-C03 | BUG-C03 | Small |
| 4 | TASK-C04 | BUG-C04 | Small |
| 5 | TASK-H01 | BUG-H01 | Medium |
| 6 | TASK-H02 | BUG-H02 | Small |
| 7 | TASK-H03 | BUG-H03 | Small |
| 8 | TASK-H04 | BUG-H04 | Small |
| 9 | TASK-M01 | BUG-M01 | Small |
| 10 | TASK-M02 | BUG-M02 | Small |
| 11 | TASK-M03 | BUG-M03 | Small |
| 12 | TASK-M04 | BUG-M04 | Medium |
| 13 | TASK-M05 | BUG-M05 | Small |
| 14 | TASK-M06 | BUG-M06 | Small |
| 15 | TASK-L01 | BUG-L01 | Small |
| 16 | TASK-L02 | BUG-L02 | Small |
| 17 | TASK-L03 | BUG-L03 | Small |
| 18 | TASK-L04 | BUG-L04 | Medium |
| 19 | TASK-L05 | BUG-L05 | Small |
| 20 | TASK-L06 | BUG-L06 | Small |
| 21 | TASK-L07 | BUG-L07 | Small |
| 22 | TASK-L08 | BUG-L08 | Small |
| 23 | TASK-L09 | BUG-L09 | Medium |
| 24 | TASK-L10 | BUG-L10 | Small |

---

*Fix plan generated: 2026-06-20 | 11:33 PM*
