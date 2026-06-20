# Zobia Codebase — Bug Fix Plan

**Generated:** June 20, 2026 · 10:45 AM
**Updated:** June 20, 2026 · 12:30 PM
**Scope:** 23 confirmed bugs from independent forensic analysis (see `custom-bugs-report.md`)
**Status:** PENDING USER REVIEW — DO NOT EXECUTE UNTIL APPROVED

---

## Execution Strategy

Fixes are ordered by risk and dependency. Phase 1 covers bugs that cause active financial harm, exploitable behavior, or broken core features in production right now. Phase 2 covers data integrity and correctness issues with lower immediate financial impact. Phase 3 covers mobile, code quality, and edge-case hardening.

Each task is self-contained and can be executed independently unless a dependency is noted.

**Estimated effort:** ~3–4 engineering days for all 23 fixes with smoke testing.

---

## Phase 1 — Critical: Active Financial Risk, Exploits & Runtime Errors

---

### TASK-01 — Fix BUG-PLAY-01: Google Play IAP coin purchases must be consumed

**Priority:** CRITICAL — Android coin pack purchases auto-void after 3 days; users cannot repurchase
**File:** `apps/expo/lib/payments/googlePlay.ts`

1. Locate `setupGlobalPurchaseListener` and find the `finishTransactionAsync(purchase, false)` call.
2. Change it to `finishTransactionAsync(purchase, !isSubscription)`.
   - `isSubscription` is already computed in scope — no new logic needed.
   - This passes `true` (consume) for coin packs and `false` (acknowledge only) for subscriptions.
3. Test on a real Android device or emulator using Google Play sandbox: purchase a coin pack and verify it does not show as "pending" in the Play Console after finalization.

---

### TASK-02 — Fix BUG-GAME-01: Challenge cancellation must not give full refund after rounds played

**Priority:** CRITICAL — monetarily exploitable by any user
**File:** `apps/web/lib/games/challenges.ts`

1. Locate the cancellation/forfeit path in `challenges.ts`.
2. Before issuing any refund, query the number of completed rounds and the per-round winner breakdown for this challenge.
3. If zero rounds have been completed: full refund to both players (current behavior is correct for this case).
4. If one or more rounds have been completed: distribute the escrowed amount proportionally to the rounds-won ratio. The player who triggered the cancellation should not receive a higher share than their win ratio warrants. (Alternatively, product decision: forfeit the cancelling player's full stake — simpler to reason about, zero exploit surface.)
5. Update any cancellation notifications to reflect the actual payout received, not a "full refund" message.

---

### TASK-03 — Fix BUG-LB-01: Verify and fix upsertLeaderboardSnapshot ON CONFLICT target

**Priority:** CRITICAL — potential runtime error on every XP award if index doesn't match
**File:** `apps/web/lib/leaderboards/engine.ts`

1. Run `\d leaderboard_snapshots` in psql against the production/staging database.
2. **If the index is an expression index** matching `COALESCE(city, ''), COALESCE(season_id::text, '')`: the upsert is correct — no change needed. Move to TASK-04 only.
3. **If the index is a column-based UNIQUE constraint** on `(user_id, track, scope, city, season_id)`:
   - Option A (preferred): rename the constraint to a known name (e.g., `leaderboard_snapshots_unique`) via a migration, then change the upsert to `ON CONFLICT ON CONSTRAINT leaderboard_snapshots_unique DO UPDATE SET …`.
   - Option B: drop the column-based index and create a matching expression index: `CREATE UNIQUE INDEX leaderboard_snapshots_unique ON leaderboard_snapshots (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))`.
4. After aligning index and upsert, also address BUG-LB-02 in the same edit (see TASK-08).

---

### TASK-04 — Fix BUG-COIN-01: Insert DB payment record before calling Paystack

**Priority:** HIGH — orphan Paystack payment if DB fails after provider call
**File:** `apps/web/app/api/economy/coins/purchase/route.ts`

1. Generate a local `reference_id` (UUID or deterministic string) before any external call.
2. Insert a `payments` row in `pending` status with the local `reference_id`.
3. Call `initializePayment(reference_id, amount, …)` passing the local reference ID to Paystack.
4. On Paystack failure: catch the error, mark the local record as `failed`, return the error to the client. No redirect is issued.
5. On Paystack success: update the local record with the provider's payment URL/reference and return the redirect URL.
6. The webhook handler already looks up by `reference_id` — this change makes the local record always pre-exist.

---

### TASK-05 — Fix BUG-GIFT-01: Move Redis key write to after DB commit

**Priority:** HIGH — rollback permanently poisons idempotency slot
**File:** `apps/web/app/api/economy/gifts/send/route.ts`

1. Find the Redis `SET gift:${senderId}:${idempotencyKey} …` call in the handler.
2. Move it to after `tx.commit()` (or after the `db.transaction()` call resolves successfully).
3. Pattern:
   - Check Redis key at the top (return cached response if present — existing behavior, correct).
   - Execute and commit DB transaction.
   - On success: write Redis key with the successful response payload and desired TTL.
4. Confirm that submitting the same gift twice (simulating a retry) results in exactly one debit and one credit and returns the cached response on the second attempt.

---

### TASK-06 — Fix BUG-LOCK-01: Replace session-level advisory lock with transaction-level lock

**Priority:** HIGH — double payout risk under connection pool; lock can stay held indefinitely
**File:** `apps/web/lib/creator/fund.ts`

1. Locate `pg_try_advisory_lock` and the matching `pg_advisory_unlock` in `distributeCreatorFund`.
2. Remove both calls and the `finally` block that holds the unlock.
3. Wrap the entire distribution in `await globalDb.transaction(async (tx) => { … })`.
4. Inside the transaction, as the very first statement, call `SELECT pg_try_advisory_xact_lock($1)` where `$1` is the same lock key previously used.
5. Check the return value — if `false` (another instance holds the lock), throw a specific error (or return early) to signal the CRON should skip this run.
6. The transaction-level lock is automatically released when the transaction commits or rolls back, regardless of which pool connection handles it.

---

## Phase 2 — Data Integrity and Correctness

---

### TASK-07 — Fix BUG-XP-01: safeAwardXP must pass transaction client to upsertLeaderboardSnapshot

**Priority:** HIGH — leaderboard shows XP that doesn't exist if outer transaction rolls back
**File:** `apps/web/lib/xp/safeAwardXP.ts`

1. Find the two `upsertLeaderboardSnapshot(userId, …, globalDb)` calls in `safeAwardXP` (one for `main`, one for the track).
2. Change both to pass `client` (the `DatabaseAdapter | TransactionClient` argument) instead of `globalDb`.
3. `upsertLeaderboardSnapshot` accepts `DatabaseAdapter` — `TransactionClient` satisfies this interface — no signature change needed.
4. The leaderboard snapshot now rolls back with the XP award if the outer transaction fails.

---

### TASK-08 — Fix BUG-LB-02: Replace COALESCE with explicit score update logic in upsertLeaderboardSnapshot

**Priority:** MEDIUM — can silently overwrite a higher score with a lower one
**File:** `apps/web/lib/leaderboards/engine.ts`

1. Find `SET score = COALESCE(excluded.score, leaderboard_snapshots.score)` in the ON CONFLICT DO UPDATE clause.
2. Determine the intended semantic:
   - **Current total XP** (most common): replace with `SET score = excluded.score`.
   - **All-time peak score**: replace with `SET score = GREATEST(excluded.score, leaderboard_snapshots.score)`.
3. Remove the COALESCE wrapper — it provides no null safety (excluded.score is never null) and misleads readers.
4. This task can be done in the same edit as TASK-03.

---

### TASK-09 — Fix BUG-LB-03: Add stable tiebreaker to getLeaderboard ORDER BY

**Priority:** MEDIUM — non-deterministic pagination for equal XP values
**File:** `apps/web/lib/leaderboards/engine.ts`

1. Find the `ORDER BY ls.xp_value DESC NULLS LAST` clause in `getLeaderboard`.
2. Append `, ls.user_id ASC` as a tiebreaker (or any other stable column present on every row).
3. If cursor-based pagination uses `xp_value` as the cursor, update the WHERE clause to also carry the `user_id` for the tie-break: `AND (xp_value < $cursorXp OR (xp_value = $cursorXp AND user_id > $cursorUserId))`.
4. Confirm that fetching page 1 and page 2 of a leaderboard with many tied users produces no duplicates and no gaps.

---

### TASK-10 — Fix BUG-WAR-01: Move war-status check inside the write transaction

**Priority:** MEDIUM — TOCTOU allows contributions to be recorded for already-resolved wars
**File:** `apps/web/lib/guilds/recordWarContribution.ts`

1. Identify the `db.transaction()` call that wraps the contribution upsert.
2. Move the active-war status query (currently on lines 33–54, outside the transaction) inside the transaction as its first statement.
3. Change the status query to `SELECT id, status FROM guild_wars WHERE id = $warId FOR UPDATE`. The `FOR UPDATE` lock prevents `resolveWar` from updating the same row until this transaction commits.
4. Re-check `status === 'active'` inside the transaction. If not active, rollback and return an appropriate error to the caller.

---

### TASK-11 — Fix BUG-TRUST-01: Ensure trust score is fresh before gating access

**Priority:** MEDIUM — stale score allows recently-actioned users to pass feature gates
**File:** `apps/web/lib/trust/trustScore.ts`

1. Add a `forceRecalculate?: boolean` parameter to `meetsMinimumTrust`.
2. When `forceRecalculate` is true, call `await calculateTrustScore(userId, db)` at the start of the function and use the returned value instead of the column.
3. In all moderation action handlers (ban, warn, content-remove, report processing), pass `forceRecalculate: true` when calling `meetsMinimumTrust` in the same request context.
4. Alternatively (simpler but more expensive): have the moderation action handlers explicitly call `calculateTrustScore` to update the cached column, ensuring the column is fresh before any subsequent gate check.

---

### TASK-12 — ~~Fix BUG-PAY-01~~ — ALREADY RESOLVED (no action needed)

**Status:** CONFIRMED FALSE POSITIVE — code already handles this correctly
**File:** `apps/web/lib/payments/paystackWebhookHandler.ts`

On second-pass analysis, lines 635–638 of `paystackWebhookHandler.ts` already correctly branch on `isNonRenewing` (where `isNonRenewing = status === "non-renewing"`) to set `notifType = "subscription_non_renewing"`. The `subscription.disable` event is handled separately at lines 574–591. This task can be **skipped entirely** — no code change is required.

---

### TASK-13 — Fix BUG-SEASON-01: Redistribute rounding remainder in distributeSeasonRewards

**Priority:** MEDIUM — coins silently lost to Math.floor() rounding
**File:** `apps/web/lib/seasons/seasonEngine.ts`

1. After computing all user coin shares with `Math.floor()`, sum the total distributed amount.
2. Compute remainder = `prizePool - totalDistributed`.
3. Add the remainder to the top-ranked user's award (the user with `rank = 1` in the sorted results).
4. Log the remainder amount as an accounting note for auditability.
5. Verify that the sum of all distributed amounts equals the original prize pool exactly.

---

### TASK-14 — Fix BUG-NOTIF-01: Add title and body to challenges.ts notification INSERTs

**Priority:** MEDIUM — challenge notification rows have null display content
**File:** `apps/web/lib/games/challenges.ts`

1. Locate all notification INSERT statements in `challenges.ts`.
2. Add `title` and `body` values appropriate to each notification type (challenge invitation, result announcement, series resolution, etc.). Reference `lib/notifications/insert.ts` for existing type-to-content mappings.
3. If there is a shared helper function `lib/notifications/insert.ts` that abstracts the INSERT, refactor the challenge notify calls to use it rather than raw SQL — this prevents the field set from drifting again.
4. Smoke-test by triggering a game challenge invitation and verifying the notification row has non-null `title` and `body`.

---

### TASK-19 — Fix BUG-DM-01: handleDMGift must use safeAwardXP instead of raw SQL

**Priority:** HIGH — XP awards bypass DLQ fallback; non-atomic; silent data loss on DB errors
**File:** `apps/web/app/api/messages/dm/route.ts`

1. Locate `handleDMGift()` in `dm/route.ts`.
2. Remove the three raw SQL statements that write XP: the multi-row `INSERT INTO xp_ledger` and the two `UPDATE users SET xp_total` statements.
3. Replace with two separate `safeAwardXP` calls, made outside the main gift transaction (safeAwardXP manages its own transaction internally):
   - Sender (generosity XP): `await safeAwardXP({ userId: senderId, amount: GIFT_XP_SENDER, track: 'generosity', source: 'dm_gift', referenceId: \`gift_xp_sent:${giftId}\` }, db)`
   - Recipient (social XP): `await safeAwardXP({ userId: recipientId, amount: GIFT_XP_RECIPIENT, track: 'social', source: 'dm_gift', referenceId: \`gift_xp_recv:${giftId}\` }, db)`
4. `giftId` should be the UUID of the persisted gift record — generate it before the transaction and pass it down, or read it from the RETURNING clause after INSERT.
5. The `referenceId` ensures idempotency: if the route is retried after a partial failure, the XP awards are deduped and the DLQ handles any transient DB error.

---

### TASK-20 — Fix BUG-XP-02: Room message XP daily cap off-by-one

**Priority:** MEDIUM — 49 messages earn XP instead of the intended 50
**File:** `apps/web/app/api/rooms/[roomId]/messages/route.ts`

1. Locate the `countTodayMessages()` call and the `>= ROOM_MESSAGE_XP_DAILY_CAP` comparison.
2. Confirm that `countTodayMessages()` is called **after** the message INSERT (making the count inclusive of the just-inserted message).
3. Change the guard condition from `>= ROOM_MESSAGE_XP_DAILY_CAP` to `> ROOM_MESSAGE_XP_DAILY_CAP`. This means the 50th message (count = 50) still earns XP; the 51st (count = 51) is the first to be skipped.
4. Alternatively, move `countTodayMessages()` to **before** the INSERT and keep `>= ROOM_MESSAGE_XP_DAILY_CAP` — both approaches are equivalent, but changing the condition is the simpler one-character fix.

---

### TASK-21 — Fix BUG-AUTH-03: buildCookieHeaders must honour role-based refresh TTL

**Priority:** HIGH — creator/moderator/admin sessions get default 30-day cookie regardless of role TTL
**File:** `apps/web/lib/auth/session.ts`
**Also affects:** `apps/web/app/api/auth/telegram/callback/route.ts`, `apps/web/app/api/auth/google/callback/route.ts`, `apps/web/app/api/auth/2fa/verify/route.ts`

Two equivalent approaches — pick one:

**Option A (fix the function signature):**
1. In `buildCookieHeaders`, change the default value of the `refreshTtl` parameter from `REFRESH_TOKEN_TTL_SECONDS` to `tokens.refreshTtl ?? REFRESH_TOKEN_TTL_SECONDS`.
2. This makes callers that omit `refreshTtl` automatically use whatever TTL the session creation computed — no caller changes needed.

**Option B (fix the callers):**
1. In `telegram/callback/route.ts` line 186, change `buildCookieHeaders(authTokens)` to `buildCookieHeaders(authTokens, undefined, authTokens.refreshTtl)`.
2. In `google/callback/route.ts` at the equivalent call site, apply the same change.
3. In `2fa/verify/route.ts` line 131, apply the same change.
4. Verify `apps/web/app/api/admin/auth/totp/route.ts` — it already correctly passes `ADMIN_REFRESH_TOKEN_TTL_SECONDS` and needs no change.

After either fix, test with a creator-role login and confirm the `refresh_token` cookie `Max-Age` matches the creator session TTL from `manifest.sessionTtls["creator"]`, not the default 30-day value.

---

### TASK-22 — Fix BUG-IAP-01: Server-side IAP verification must consume one-time products

**Priority:** CRITICAL — consumable coin pack purchases cannot be re-purchased after first use
**File:** `apps/web/app/api/economy/iap/verify/route.ts`

1. Locate `acknowledgeGooglePlayPurchase()` (around line 249).
2. The current URL suffix is `:acknowledge` — this is correct only for subscriptions and non-consumable entitlements.
3. Change the URL to use `:consume` instead: `purchases/products/${productId}/tokens/${purchaseToken}:consume`.
   - The `:consume` endpoint acknowledges AND marks the purchase as consumed in a single call — no separate acknowledge step is needed.
4. Verify that `COIN_PACK_PRODUCT_IDS` (or however one-time products are identified) only includes consumable products. If the same code path handles both consumable and non-consumable one-time purchases, add a product-type check:
   - Consumable (coin packs): use `:consume`
   - Non-consumable (permanent unlocks, if any): use `:acknowledge`
5. Test using Google Play sandbox: purchase a coin pack, receive coins, then attempt to purchase the same pack again — it should be available for purchase immediately.

---

### TASK-23 — Fix BUG-LOGIN-01: Daily login Redis key must be written after DB commit

**Priority:** HIGH — failed DB transaction permanently blocks user's daily XP for 48 hours
**File:** `apps/web/app/api/login/daily/route.ts`

Same anti-pattern as BUG-GIFT-01 (TASK-05). Two equivalent approaches:

**Option A (preferred — delete key on failure):**
1. Keep the Redis NX SET where it is (line 99, before the transaction).
2. In the catch block (currently at line 239 returning `handleApiError(err)`), add `await redis.del(redisKey).catch(() => {})` before returning the error.
3. This releases the slot so the user can retry after the transient DB failure, without permanently blocking their daily award.

**Option B (move key write after commit):**
1. Remove the Redis NX SET from line 99.
2. After `db.transaction()` resolves successfully, perform the Redis SET with the same key, TTL, and NX flag.
3. On Redis failure here, log the error but return success to the user (XP was already committed) — the user may receive a second XP award on a rare double-request, which is an acceptable trade-off vs. silently blocking legitimate daily awards.

In either case, confirm the fix by simulating a DB error mid-transaction and verifying the user can successfully claim their daily XP on the next request.

---

## Phase 3 — Mobile, Auth and Code Quality

---

### TASK-15 — Fix BUG-AUTH-01: Expo JWT decode must handle base64url encoding

**Priority:** MEDIUM — JWTs with standard base64url characters silently misdecode
**File:** `apps/expo/lib/auth/context.tsx`

1. Find the `atob(payload)` call used to decode the JWT payload segment.
2. Before calling `atob`, substitute base64url characters back to standard base64:
   ```
   const b64 = payload
     .replace(/-/g, '+')
     .replace(/_/g, '/')
     .padEnd(payload.length + (4 - payload.length % 4) % 4, '=');
   const decoded = atob(b64);
   ```
3. Alternatively, import and use a base64url library (e.g., `base64-js` or the `jose` decode utilities) for a cleaner solution.
4. Test with a user whose UUID or other claim values produce `-` or `_` in the base64url-encoded payload.

---

### TASK-16 — Fix BUG-AUTH-02: Align Expo rankTier enum and fix hardcoded "bronze" in OAuth

**Priority:** MEDIUM — rank-gated mobile UI has never worked; all users show as "bronze"
**Files:** `apps/expo/lib/auth/context.tsx`, `apps/web/app/api/auth/google/callback/route.ts`

1. Open `lib/xp/engine.ts` and list all rank name strings (e.g., `"Beginner"`, `"Rookie"`, `"Rising Star"`, etc.).
2. In `apps/expo/lib/auth/context.tsx`, update the `AuthUser` type's `rankTier` field type to match these server-side strings exactly.
3. Update all mobile rank-comparison logic (e.g., `if (rankTier === "bronze")`) to use the correct server strings.
4. In `apps/web/app/api/auth/google/callback/route.ts`, find the line that sets `rankTier: "bronze"` in the mobile pre-auth payload.
5. Replace the hardcoded value with the user's actual `rank_name` from the DB. This value should already be available from the user upsert RETURNING clause — if not, add `rank_name` to the returned columns.

---

### TASK-17 — Fix BUG-MOB-01: Expo SQLite migration must not swallow structural errors

**Priority:** MEDIUM — partial schema migrations silently corrupt the offline database
**File:** `apps/expo/lib/offline/sqlite.ts`

1. Find the `try/catch` in the migration runner loop.
2. In the catch block, distinguish between idempotent and structural failures:
   - If `error.message.includes('already exists')`: log a `console.warn` and continue (idempotent, safe to skip).
   - For all other errors: re-throw, letting the migration fail loudly.
3. In the app initialization that calls the migration runner, catch this re-thrown error and present the user with a clear error state ("Database setup failed. Please reinstall the app or contact support.") rather than letting them proceed silently.

---

### TASK-18 — Fix BUG-SPAM-01 and BUG-SPAM-02: Strengthen antispam filter

**Priority:** MEDIUM — empty-string return causes blank messages; Punycode bypass is trivial
**File:** `apps/web/lib/messaging/antispam.ts`

**BUG-SPAM-01 (empty string return):**
1. In every caller of `filterDMContent` and `filterPublicContent`, add an explicit check: if the returned string is `""` after filtering, reject the message with an appropriate validation error ("Message cannot consist solely of filtered content") rather than persisting an empty string.
2. Alternatively, add a `placeholder` option to the filter functions themselves so they return `"[link removed]"` instead of `""` — but caller-side handling is cleaner and more explicit.

**BUG-SPAM-02 (Punycode bypass):**
1. Add `xn--` to the hostname matching pattern in `URL_REGEX` so Punycode-encoded domains are caught.
2. Alternatively, replace the regex URL detection with WHATWG URL API parsing: iterate tokens/substrings and attempt `new URL(token)` — if it parses without error, it's a URL. This handles all encoding schemes including Punycode and percent-encoding automatically.

---

## Fix Sequencing Summary

| Phase | Task | Bug | Priority |
|---|---|---|---|
| 1 | TASK-01 | BUG-PLAY-01 | CRITICAL |
| 1 | TASK-02 | BUG-GAME-01 | CRITICAL |
| 1 | TASK-03 | BUG-LB-01 | CRITICAL |
| 1 | TASK-04 | BUG-COIN-01 | HIGH |
| 1 | TASK-05 | BUG-GIFT-01 | HIGH |
| 1 | TASK-06 | BUG-LOCK-01 | HIGH |
| 2 | TASK-07 | BUG-XP-01 | HIGH |
| 2 | TASK-08 | BUG-LB-02 | MEDIUM |
| 2 | TASK-09 | BUG-LB-03 | MEDIUM |
| 2 | TASK-10 | BUG-WAR-01 | MEDIUM |
| 2 | TASK-11 | BUG-TRUST-01 | MEDIUM |
| 2 | TASK-12 | BUG-PAY-01 | ~~MEDIUM~~ SKIP — ALREADY RESOLVED |
| 2 | TASK-13 | BUG-SEASON-01 | MEDIUM |
| 2 | TASK-14 | BUG-NOTIF-01 | MEDIUM |
| 2 | TASK-19 | BUG-DM-01 | HIGH |
| 2 | TASK-20 | BUG-XP-02 | MEDIUM |
| 2 | TASK-21 | BUG-AUTH-03 | HIGH |
| 1 | TASK-22 | BUG-IAP-01 | CRITICAL |
| 2 | TASK-23 | BUG-LOGIN-01 | HIGH |
| 3 | TASK-15 | BUG-AUTH-01 | MEDIUM |
| 3 | TASK-16 | BUG-AUTH-02 | MEDIUM |
| 3 | TASK-17 | BUG-MOB-01 | MEDIUM |
| 3 | TASK-18 | BUG-SPAM-01 + BUG-SPAM-02 | MEDIUM |

---

*Fix plan generated: June 20, 2026 · 10:45 AM*
*Updated: June 20, 2026 · 12:30 PM*
*Total tasks: 23 (22 actionable + 1 already resolved) | Estimated effort: 3–4 engineering days*
*DO NOT BEGIN IMPLEMENTATION UNTIL THE USER APPROVES THIS PLAN*
