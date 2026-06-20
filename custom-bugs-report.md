# Zobia Codebase — Forensic Bug Report

**Generated:** June 20, 2026 · 10:45 AM  
**Updated:** June 20, 2026 · 12:30 PM (second-pass deep review — additional 5 bugs found)  
**Analyst:** Independent forensic analysis — manual review of 100+ files, no automated scanners, no sub-agents  
**Scope:** `apps/web` (Next.js 14 App Router, PWA), `apps/expo` (React Native / Expo Android)  
**Status:** PENDING USER REVIEW — NO CODE HAS BEEN MODIFIED

---

## Bug Quick-Reference (one line each)

1: BUG-PLAY-01: Google Play IAP consumable coin purchases never consumed — `finishTransactionAsync(purchase, false)` for ALL types, should be `!isSubscription`.
2: BUG-COIN-01: Paystack payment initialised before the DB record is inserted — orphan provider payment on any DB failure after the call.
3: BUG-XP-01: `safeAwardXP` calls `upsertLeaderboardSnapshot(globalDb)` outside the caller's transaction — leaderboard drifts if the outer transaction rolls back.
4: BUG-LB-01: `upsertLeaderboardSnapshot` ON CONFLICT expression targets may not match the actual DB index — runtime error on every XP award.
5: BUG-AUTH-01: Expo JWT decode uses `atob()` without base64url character substitution — JWTs with `-` or `_` in the payload are misread or throw.
6: BUG-AUTH-02: `AuthUser.rankTier` enum values (`"bronze"/"silver"`) do not match server rank names (`"Beginner"/"Rookie"`); Google OAuth callback hardcodes `rankTier: "bronze"` for all mobile users.
7: BUG-GAME-01: Challenge cancellation refunds full escrow regardless of rounds played — exploitable; losing challenger can always cancel for full refund.
8: BUG-GIFT-01: Gift-send Redis idempotency key is written before the DB transaction commits — a rollback permanently poisons that idempotency slot.
9: BUG-LOCK-01: `distributeCreatorFund` uses a session-level PostgreSQL advisory lock with connection pooling — lock may be acquired on connection A and released (or fail to release) on connection B, risking double payout.
10: BUG-PAY-01: ~~Paystack `subscription.not_renew` sends incorrect notification type~~ — **ALREADY FIXED** in current code (notification now correctly uses `subscription_non_renewing` type). TASK-12 can be skipped.
11: BUG-MOB-01: Expo SQLite migration catch-all error handler silently swallows ALL failures, leaving the local database in a partially migrated state with no visible error.
12: BUG-SEASON-01: `distributeSeasonRewards` uses `Math.floor()` on every user's coin share with no remainder redistribution — coins are silently discarded into rounding.
13: BUG-SPAM-01: `filterDMContent`/`filterPublicContent` returns an empty string when the entire message is a URL — callers that do not guard for this persist or display a blank message.
14: BUG-LB-02: Leaderboard `getLeaderboard` ORDER BY has no tiebreaker — pagination produces duplicates or gaps for users with equal XP values.
15: BUG-NOTIF-01: `challenges.ts` notification INSERTs do not include `title` or `body` fields — challenge notification rows are persisted with null display content.
16: BUG-TRUST-01: `meetsMinimumTrust` reads the cached `users.trust_score` column without recomputing — recent bans or warnings are not reflected until the next explicit recalculation.
17: BUG-WAR-01: `recordWarContribution` active-war status check runs outside the write transaction — war can be resolved between the check and the contribution upsert (TOCTOU).
18: BUG-SPAM-02: Antispam `URL_REGEX` does not match Punycode/IDN domains (`xn--` prefix) — trivially bypassed by encoding a domain in Punycode.
19: BUG-DM-01: `handleDMGift()` in the DM route awards XP via three raw fire-and-forget SQL queries instead of `safeAwardXP` — no DLQ fallback, non-atomic; INSERT can succeed while the two UPDATE users queries fail silently.
20: BUG-XP-02: Room message XP daily cap has an off-by-one error — `countTodayMessages()` is called after the INSERT, so the 50th message returns count = 50, triggers `>= 50` cap, and earns no XP. Only 49 of the intended 50 daily messages earn XP.
21: BUG-AUTH-03: `buildCookieHeaders` ignores `tokens.refreshTtl` — the `refreshTtl` parameter defaults to the global `REFRESH_TOKEN_TTL_SECONDS` constant; callers in `telegram/callback`, `google/callback`, and `2fa/verify` pass only `authTokens` so creator/moderator sessions receive a cookie with the wrong `Max-Age`.
22: BUG-IAP-01: Server-side IAP verification acknowledges consumable coin packs via the `:acknowledge` endpoint instead of `:consume` — coin pack SKUs remain acknowledged but unconsumed; users cannot repurchase the same SKU (Google Play auto-voids after ~3 days).
23: BUG-LOGIN-01: Daily login Redis NX idempotency key is written before the DB transaction — if the transaction fails after the key is set, the user permanently loses their daily XP for that calendar day (all retries see "already claimed today").

---

## Detailed Analysis

---

### 1: BUG-PLAY-01 — Google Play IAP consumable coin purchases never consumed

**FILES:** `apps/expo/lib/payments/googlePlay.ts`

`setupGlobalPurchaseListener` calls `await InAppPurchases.finishTransactionAsync(purchase, false)` for every purchase unconditionally. The second argument is `consume` — it must be `true` for consumable products (coin packs) so Google Play marks the purchase as consumed and allows re-purchase of the same SKU. With `false`, the purchase is only acknowledged, not consumed. Google Play auto-voids acknowledged-but-unconsumed in-app products after 3 days and blocks re-purchase of the same SKU in the meantime. The variable `isSubscription` is correctly computed in the same function but is never used for the consume argument.

**FIX:** Change the call to `finishTransactionAsync(purchase, !isSubscription)`. Subscriptions pass `false` (do not consume); consumable coin packs pass `true`.

---

### 2: BUG-COIN-01 — Paystack payment initialised before the DB record is created

**FILES:** `apps/web/app/api/economy/coins/purchase/route.ts`

Step 5 calls `initializePayment` (Paystack API) to create the provider session, then Step 6 inserts the local payment record. If the DB INSERT at Step 6 fails (connection error, constraint violation), a real Paystack payment session exists with no corresponding local record. The user is redirected to Paystack, may complete payment, and the webhook handler will find no matching payment row — silently dropping the credit.

**FIX:** Insert the DB record first (in a `pending` state with a locally generated reference ID), then call Paystack with that reference ID. On Paystack failure, mark the local record as `failed` — the user never gets a redirect. This ensures a local record always pre-exists before any provider state is created.

---

### 3: BUG-XP-01 — safeAwardXP leaderboard snapshot update runs outside the caller's transaction

**FILES:** `apps/web/lib/xp/safeAwardXP.ts`

After a successful XP INSERT + users UPDATE (which correctly runs inside the caller's transaction when one is passed), `safeAwardXP` calls `upsertLeaderboardSnapshot(userId, …, globalDb)` — explicitly using the global DB pool, not the transaction client. If the caller's transaction is later rolled back, the XP credit is rolled back but the leaderboard snapshot update has already committed on `globalDb`. The leaderboard shows XP the user does not actually have.

**FIX:** Pass the `client` (same connection used for the XP award) to `upsertLeaderboardSnapshot` instead of `globalDb`. Since `upsertLeaderboardSnapshot` accepts a `DatabaseAdapter`, this is a one-argument change. The snapshot will then roll back together with the XP award if the outer transaction fails.

---

### 4: BUG-LB-01 — upsertLeaderboardSnapshot ON CONFLICT expression may not match the actual DB index

**FILES:** `apps/web/lib/leaderboards/engine.ts`

The upsert uses `ON CONFLICT (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))`. PostgreSQL ON CONFLICT requires the conflict target to exactly match an existing index definition. If the actual DB index is a standard column-based UNIQUE constraint on `(user_id, track, scope, city, season_id)` (with NULLs distinct), the COALESCE expression target will not match and the upsert will throw `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification` on every single XP award.

**FIX:** Check the actual index definition with `\d leaderboard_snapshots` in psql. If the index is column-based, replace the COALESCE expression targets with a named constraint reference (`ON CONFLICT ON CONSTRAINT leaderboard_snapshots_unique_idx`) or create an expression index that exactly matches the COALESCE syntax. Align the migration, index definition, and upsert clause so all three agree.

---

### 5: BUG-AUTH-01 — Expo JWT decode uses atob() without base64url character substitution

**FILES:** `apps/expo/lib/auth/context.tsx`

The JWT payload decode uses `atob(payload)` on the raw base64url-encoded JWT segment. The JWT standard (RFC 7515/7519) uses base64url encoding which replaces `+` with `-`, `/` with `_`, and omits `=` padding. `atob()` expects standard base64 — it will throw or silently misparse any JWT whose payload segment contains `-` or `_` characters (common in UUIDs and large numeric claims encoded into the payload).

**FIX:** Before calling `atob()`, apply: `payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(payload.length + (4 - payload.length % 4) % 4, '=')`. Or use the `jose` library's built-in decode utilities (already a dependency on the web side) which handle this correctly.

---

### 6: BUG-AUTH-02 — AuthUser.rankTier enum mismatches server rank names; OAuth callback hardcodes "bronze"

**FILES:** `apps/expo/lib/auth/context.tsx`, `apps/web/app/api/auth/google/callback/route.ts`

The Expo `AuthUser` type defines `rankTier` with values like `"bronze"`, `"silver"`, `"gold"`. The server rank system (confirmed in `lib/db/schema.ts` and `lib/xp/engine.ts`) uses `"Beginner"`, `"Rookie"`, `"Rising Star"`, etc. All mobile UI that branches on `rankTier` compares against values that the server never sends — rank-gated features and rank display on mobile are permanently broken. Additionally, the Google OAuth callback hardcodes `rankTier: "bronze"` in the mobile pre-auth payload for all users regardless of their actual rank, so every mobile sign-in receives rank "bronze" in the decoded auth object.

**FIX:** (1) Update the `AuthUser` type's `rankTier` enum values to match the server's actual rank name strings from `lib/xp/engine.ts`. (2) In the Google OAuth callback, replace the hardcoded `rankTier: "bronze"` with the user's actual `rank_name` from the DB (query `users.rank_name` during the OAuth upsert and include it in the pre-auth code payload).

---

### 7: BUG-GAME-01 — Challenge cancellation refunds full escrow regardless of rounds played

**FILES:** `apps/web/lib/games/challenges.ts`

When a challenge is cancelled, the code refunds the full escrowed amount to both players regardless of how many rounds have been completed. A challenger who is losing after several rounds can cancel to recover their full stake — a monetarily exploitable escape hatch. The cancellation is restricted to the challenger (not the opponent), meaning only the challenger can exploit this: if they are behind (opponent winning 2–0 in a best-of-5), they cancel and get a full refund, denying the winning opponent their payout. Rounds-played count and per-round outcome are tracked in the DB but are not consulted during cancellation.

**FIX:** Add a partial-payout path: if at least one round has been completed, award escrowed coins proportionally based on rounds-won ratio, rather than a full refund to both parties. Alternatively, forfeit the cancelling player's stake entirely (simpler, harder to exploit). The policy decision is the product owner's, but the current full-refund-always behaviour is clearly exploitable.

---

### 8: BUG-GIFT-01 — Gift-send Redis idempotency key written before DB transaction commits

**FILES:** `apps/web/app/api/economy/gifts/send/route.ts`

The handler writes the Redis idempotency key (`gift:${senderId}:${idempotencyKey}`) before the DB transaction containing the coin debit and credit commits. If the subsequent DB commit fails, the Redis key is already set and the transaction cannot be retried — the idempotency slot is permanently poisoned. The user's coins are not deducted (DB rolled back) but they also cannot re-attempt the gift with the same key. The error handler attempts a Redis key delete on non-balance errors, but there is a race window between the error and the cleanup.

**FIX:** Move the Redis key write to AFTER the DB transaction successfully commits. The safe pattern: (1) check key exists → return cached response; (2) execute and commit DB transaction; (3) write Redis key with the successful response body. A Redis TTL slightly shorter than the client retry timeout covers the small commit-to-Redis window.

---

### 9: BUG-LOCK-01 — distributeCreatorFund advisory lock not safe with connection pooling

**FILES:** `apps/web/lib/creator/fund.ts`

`distributeCreatorFund` acquires a PostgreSQL session-level advisory lock via `pg_try_advisory_lock` and releases it in a `finally` block via `pg_advisory_unlock`. With a connection pool, the lock is acquired on whichever pool connection handles the initial `query()`, but subsequent queries — including the `finally` unlock — may execute on a different connection/session. `pg_advisory_unlock` on the wrong session is a no-op. The lock may stay held indefinitely (blocking all future CRON runs until the holding connection is recycled) or release on the wrong session (allowing a concurrent CRON to also acquire and run a double payout).

**FIX:** Replace the session-level advisory lock pair with `pg_try_advisory_xact_lock`, which is automatically released when the transaction ends regardless of which pool connection handles the unlock. Wrap the entire distribution in a single `db.transaction()` call and acquire the transaction-level lock as the first statement inside that transaction.

---

### 10: BUG-PAY-01 — ~~Paystack subscription.not_renew sends incorrect notification type~~ [ALREADY FIXED]

**FILES:** `apps/web/lib/payments/paystackWebhookHandler.ts`

**Note:** On second-pass review, the current codebase already correctly handles this case. The notification block at lines 635–638 of `paystackWebhookHandler.ts` checks `else if (isNonRenewing)` and sets `notifType = "subscription_non_renewing"` with title `"Subscription Ending"`. The bug described (sending `subscription_cancelled` instead) is not present in the current code. TASK-12 in the fix plan can be skipped or removed.

---

### 11: BUG-MOB-01 — Expo SQLite migration catch-all silently swallows schema failures

**FILES:** `apps/expo/lib/offline/sqlite.ts`

The SQLite migration runner wraps each migration step in a `try/catch` that logs a `console.warn` and continues to the next migration. If a `CREATE TABLE` or `ALTER TABLE` fails (table already exists with an incompatible schema, disk full, corruption), the migration is marked complete and the loop continues. Subsequent migrations that depend on the failed one will also fail silently. The app proceeds to operate on a partially migrated database with no visible indication that anything is wrong — offline data may be silently discarded or cause crashes far from the actual failure point.

**FIX:** Change the catch block to re-throw for structural migration failures. Only swallow genuinely idempotent errors (e.g., `error.message.includes('already exists')`) as a narrow guard. Bubble real failures up to the app init path so the user sees a clear "database error, please reinstall" message rather than silent data loss.

---

### 12: BUG-SEASON-01 — Season reward distribution uses Math.floor() with no remainder redistribution

**FILES:** `apps/web/lib/seasons/seasonEngine.ts`

`distributeSeasonRewards` applies `Math.floor()` to each user's computed coin share. For 100 users and a prize pool of 997 coins, up to 99 coins are silently discarded (fractional part per user × user count). These coins are neither recorded as unspent nor redistributed — they vanish.

**FIX:** Compute total actually distributed (sum of all floored amounts) then add the remainder (`pool − distributed`) to the top-ranked user's award. This is the standard "largest remainder" method and accounts for every coin in the pool. At minimum, log the discarded amount as an accounting entry.

---

### 13: BUG-SPAM-01 — filterDMContent/filterPublicContent can return an empty string

**FILES:** `apps/web/lib/messaging/antispam.ts`

Both filter functions strip URLs, emails, and phone numbers from message text. If the entire message is a URL (e.g., a user sharing a link with no other text), the return value is `""`. Callers that do not explicitly check for an empty result will persist a blank message row or render a blank chat bubble with no indication that content was stripped.

**FIX:** Document in JSDoc that the return can be `""`. Callers should check: either reject the message with "Message cannot contain links" or substitute a configurable placeholder (e.g., `"[link removed]"`). The filter function itself is working as designed — it is the callers that need to guard for the empty case.

---

### 14: BUG-LB-02 — Leaderboard getLeaderboard has no tiebreaker — pagination is non-deterministic for equal XP

**FILES:** `apps/web/lib/leaderboards/engine.ts`

`getLeaderboard` uses `ORDER BY ls.xp_value DESC NULLS LAST` with no secondary sort column. When multiple users share identical XP values, the database may return them in any order, and that order can change between queries. A client requesting page 1 and page 2 can receive the same user on both pages or miss a user entirely.

**FIX:** Add a stable tiebreaker: `ORDER BY ls.xp_value DESC NULLS LAST, ls.user_id ASC`. This guarantees a total order across all rows and produces correct, consistent cursor-based pagination.

---

### 15: BUG-NOTIF-01 — challenges.ts notification INSERTs do not include title or body

**FILES:** `apps/web/lib/games/challenges.ts`

The `notify()` helper function at line 418 uses a raw INSERT with only `(user_id, type, metadata, is_read, created_at)` — no `title` or `body` columns. Across the rest of the codebase (per `lib/notifications/insert.ts`), every notification INSERT provides these fields so the push/in-app renderer can display the notification. Challenge notifications would be persisted as rows with null titles and bodies, rendering as blank notifications in the mobile app.

**FIX:** Add `title` and `body` values to each notification INSERT in `challenges.ts`. Use descriptive strings appropriate to the notification type (e.g., `"Game Challenge"` as title, `"You received a challenge from {username}"` as body). Refer to `lib/notifications/insert.ts` for the expected field set and any existing type-to-message mappings.

---

### 16: BUG-TRUST-01 — meetsMinimumTrust reads the stale cached trust_score without recomputing

**FILES:** `apps/web/lib/trust/trustScore.ts`

`meetsMinimumTrust` reads `users.trust_score` (a cached denormalized column) without calling `calculateTrustScore`. If a user has just received a ban, warning, or moderation action, the `trust_score` column reflects the pre-action state until the next explicit recalculation is triggered. During this window, a user whose actual score is now below a feature threshold can still pass the gate and use the gated feature.

**FIX:** On any event that reduces trust (ban, warning issued, report received, content removed), call `calculateTrustScore` synchronously before any subsequent `meetsMinimumTrust` check in the same request. Alternatively, add a `forceRecalculate?: boolean` parameter to `meetsMinimumTrust` and set it to `true` in all moderation action handlers.

---

### 17: BUG-WAR-01 — recordWarContribution active-war check runs outside the write transaction (TOCTOU)

**FILES:** `apps/web/lib/guilds/recordWarContribution.ts`

Lines 33–54 query for an active war (checking status) outside the transaction that then writes the contribution upsert. A concurrent `resolveWar` call can mark the war as resolved between the status check and the contribution write. The write succeeds (no re-check inside the transaction), recording points for a war that has already ended. Post-resolution leaderboard calculations include these phantom points.

**FIX:** Move the active-war status check inside the same transaction as the contribution upsert. Use `SELECT … FOR UPDATE` on the war row to hold the lock. This serialises the check and write atomically, eliminating the TOCTOU window.

---

### 18: BUG-SPAM-02 — Antispam URL_REGEX does not match Punycode/IDN domains

**FILES:** `apps/web/lib/messaging/antispam.ts`

`URL_REGEX` matches domains by looking for standard ASCII hostname patterns. Internationalized domain names encoded in Punycode (e.g., `https://xn--n3h.example.com`) pass through the filter undetected because the `xn--` prefix is not in the pattern. A malicious actor can bypass the link filter trivially by encoding their domain in Punycode.

**FIX:** Add `xn--` as a matched hostname prefix pattern in `URL_REGEX`, or replace the regex approach with WHATWG URL API parsing (`new URL(token)`) to detect valid URLs regardless of encoding. The URL API approach is more robust and future-proof than extending the regex.

---

### 19: BUG-DM-01 — handleDMGift() awards XP via raw SQL, bypassing safeAwardXP and its DLQ

**FILES:** `apps/web/app/api/messages/dm/route.ts`

The `handleDMGift()` function awards XP for gift transactions using three separate fire-and-forget raw SQL queries: one `INSERT INTO xp_ledger` for both sender and recipient in a multi-row INSERT, then two separate `UPDATE users SET xp_total = …` queries. All three are called with `.catch(() => {})` — any failure is silently swallowed. This bypasses `safeAwardXP` entirely, meaning there is no dead-letter queue fallback, no retry on failure, and the three queries are non-atomic: if the `xp_ledger` INSERT succeeds but one of the `UPDATE users` queries fails, the ledger shows XP the user's `xp_total` does not reflect. This is inconsistent with how every other XP award in the codebase (normal DM flow, gift send route, gaming rewards, etc.) uses `safeAwardXP`.

**FIX:** Refactor `handleDMGift()` to call `safeAwardXP` separately for the sender (generosity track) and recipient (social track) instead of the raw multi-row INSERT + UPDATE pattern. Use distinct `reference_id` values per award (e.g., `gift_xp_sent:${giftId}` and `gift_xp_recv:${giftId}`) to maintain idempotency. This ensures DLQ fallback, atomic ledger+balance updates, and consistency with the rest of the XP engine.

---

### 20: BUG-XP-02 — Room message XP daily cap off-by-one; only 49 of 50 intended messages earn XP

**FILES:** `apps/web/app/api/rooms/[roomId]/messages/route.ts`

`countTodayMessages()` is called AFTER the message INSERT has committed. When the user sends their 50th message of the day, the count returns 50. The cap check `if (todayMsgCount >= ROOM_MESSAGE_XP_DAILY_CAP) return 0` (where `ROOM_MESSAGE_XP_DAILY_CAP = 50`) evaluates `50 >= 50 = true` and suppresses XP for the 50th message. Only 49 messages per day earn XP instead of the intended 50.

**FIX:** Change the condition from `>= ROOM_MESSAGE_XP_DAILY_CAP` to `> ROOM_MESSAGE_XP_DAILY_CAP` (strictly greater than). With the count computed post-insert, this correctly allows the 50th message (count = 50, `50 > 50 = false`) to earn XP and only suppresses message 51 onward (count = 51, `51 > 50 = true`).

---

### 21: BUG-AUTH-03 — buildCookieHeaders ignores tokens.refreshTtl; callers get wrong cookie Max-Age for non-default roles

**FILES:** `apps/web/lib/auth/session.ts`, `apps/web/app/api/auth/telegram/callback/route.ts`, `apps/web/app/api/auth/google/callback/route.ts`, `apps/web/app/api/auth/2fa/verify/route.ts`

`buildCookieHeaders(tokens, secure, refreshTtl)` has a `refreshTtl` parameter that defaults to `REFRESH_TOKEN_TTL_SECONDS`. The function uses this parameter for the refresh cookie's `Max-Age` and ignores `tokens.refreshTtl` (which carries the actual role-specific TTL from `createSession`). Three callers — `telegram/callback` (line 186), `google/callback` (line 426), and `2fa/verify` (line 131) — call `buildCookieHeaders(authTokens)` without passing the TTL. When a creator or moderator logs in via any of these paths, `createSession` correctly sets their role-specific TTL in `authTokens.refreshTtl`, but the cookie `Max-Age` is set to the default user TTL. The `refresh/route.ts` and `admin/auth/totp/route.ts` callers are both correct (they pass `refreshTtl` explicitly).

**FIX:** Either (a) change `buildCookieHeaders` to use `tokens.refreshTtl` instead of the separate `refreshTtl` parameter (simplest — the parameter becomes redundant and can be removed), or (b) update all three incorrect callers to pass `authTokens.refreshTtl` as the third argument: `buildCookieHeaders(authTokens, undefined, authTokens.refreshTtl)`.

---

### 22: BUG-IAP-01 — Server-side IAP calls :acknowledge instead of :consume for consumable coin packs

**FILES:** `apps/web/app/api/economy/iap/verify/route.ts`

The `acknowledgeGooglePlayPurchase()` function at line 249 calls the Google Play API at `purchases/products/${productId}/tokens/${purchaseToken}:acknowledge` for all one-time products. For consumable products (all coin packs: `coins_starter`, `coins_regular`, etc.), Google Play requires the `:consume` endpoint, not `:acknowledge`. Acknowledging a consumable only marks it as acknowledged — it remains in a "not consumed" state. The result: (1) users cannot repurchase the same coin pack SKU because Google Play will not allow re-purchase of an acknowledged-but-not-consumed product; (2) Google Play auto-voids acknowledged-but-unconsumed purchases after approximately 3 days, potentially causing confusion. This is distinct from BUG-PLAY-01 (client-side) but related; between them, no path currently consumes coin pack purchases.

**FIX:** Change `acknowledgeGooglePlayPurchase` to call `:consume` for consumable products. Since all products in `COIN_PRODUCTS` are consumable, the simplest fix is to always use the `:consume` endpoint for one-time products: change the URL suffix from `:acknowledge` to `:consume`. Subscription acknowledgements (which use a different function path via `verifyAndActivateSubscription`) are already correct and unaffected.

---

### 23: BUG-LOGIN-01 — Daily login Redis NX key written before DB transaction; failure permanently blocks daily XP

**FILES:** `apps/web/app/api/login/daily/route.ts`

At line 99, the handler calls `redis.set(redisKey, "1", "EX", DAILY_LOGIN_KEY_TTL_SECONDS, "NX")` to acquire the daily idempotency slot before the DB transaction at line 121. If the DB transaction fails for any reason (connection error, constraint, timeout), the Redis key is already set with a 48-hour TTL. The error handler at line 239 calls `handleApiError(err)` but does NOT delete the Redis key. On all subsequent retry attempts that same calendar day, the Redis check at line 100 sees the key already set and returns `alreadyClaimedToday: true` with `xpAwarded: 0` — the user's streak is not updated and daily XP is permanently lost for that day. This is the same anti-pattern as BUG-GIFT-01.

**FIX:** In the DB transaction catch block (before returning the error response), delete the Redis key: `await redis.del(redisKey).catch(() => {})`. This unblocks retries. Alternatively and more robustly, move the Redis NX set to AFTER the DB transaction commits successfully — since the DB transaction itself is protected by `FOR UPDATE` and the same-day `lastLogin === today` guard, concurrent requests that race through would be idempotent on the DB side, and the Redis key then acts only as a caching optimization rather than an ordering gate.

---

## Code Quality Assessment

### Current Rating: 7.0 / 10

The codebase reflects genuine engineering maturity in most subsystems:

**Strengths observed:**
- CSP nonces with `strict-dynamic` and no `unsafe-inline`; per-request nonce generation in edge middleware.
- CSRF validation via Origin header for all API mutations; OAuth CSRF state token with Redis.
- SSRF protection with DNS-pinned `undici` Agent, single DNS resolution, TOCTOU prevention via IP pinning, streaming body size cap.
- AES-256-GCM field encryption with scrypt KDF v2; v1 key migration path.
- Coin and star economies use SELECT FOR UPDATE throughout; append-only ledgers; Decimal.js for all arithmetic.
- `safeAwardXP()` with dead-letter queue, exponential backoff retry, and leaderboard snapshot updates — correct everywhere except the three callers identified in BUG-XP-01 and BUG-DM-01.
- Atomic Lua scripts for rate limiting (sliding window), DM coin daily limits, and room presence cap — no TOCTOU races.
- JWT multi-key rotation with kid-based registry; TOTP with `timingSafeEqual` anti-timing.
- Structured logging, per-request trace IDs, audit log, system alerts for permanently failed operations.
- Webhook replay protection via Redis with `NX` and TTL; HMAC-SHA512 (Paystack) verification.
- Geo-anomaly detection, rate-limiting, and PIN guard are all correctly implemented with Redis atomic ops.

**Areas of concern:**
- BUG-PLAY-01 and BUG-IAP-01 together mean coin pack purchases are never consumed at any level — neither client nor server calls the consume API. Android users experience blocked re-purchases immediately.
- BUG-LB-01 is a latent runtime error on every XP award if the DB index doesn't match the upsert expression — needs immediate verification.
- BUG-LOCK-01 (creator fund advisory lock) is a latent double-payout risk that only triggers under specific connection-pool conditions — easy to miss in testing, impactful in production.
- BUG-AUTH-02 (rankTier mismatch) means rank-gated mobile UI has never worked correctly — every feature guarded by rank on mobile evaluates the wrong strings.
- BUG-GAME-01 (challenge cancellation exploit) is immediately exploitable by any user who understands the refund behaviour.
- BUG-LOGIN-01 and BUG-GIFT-01 represent a repeated structural anti-pattern: Redis NX key written before the DB transaction. Any transient DB failure permanently blocks the user's action for the key's TTL window.

### Projected Rating After All 22 Fixes (excluding TASK-12 already resolved): 8.8 / 10

Applying all fixes closes the Google Play consumable defect on both client and server, fixes the leaderboard runtime risk, eliminates the advisory lock double-payout hazard, corrects all rank-gated mobile UI, removes the challenge escape-hatch exploit, ensures gift send, daily login, and coin purchase flows are properly ordered and idempotent, aligns cookie TTLs for all role-based sessions, fixes the room XP cap so all 50 daily messages earn XP, restores DLQ coverage for DM gift XP awards, and hardens the anti-spam filter against Punycode bypass. The gap from 8.8 to 10 reflects the absence of a visible integration/E2E test suite and the leaderboard tiebreaker which is a non-trivial pagination redesign.

---

*Report generated: June 20, 2026 · 10:45 AM*  
*Updated: June 20, 2026 · 12:30 PM*  
*Scope: 100+ files manually reviewed across apps/web and apps/expo*  
*Bugs found: 23 total (18 from first pass + 5 from second pass; BUG-PAY-01 confirmed already fixed) | No code modified during this analysis*
