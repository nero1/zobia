# Zobia Codebase — Bug Fix Plan (New Findings)

**Generated:** June 20, 2026 · 10:41 AM
**Scope:** 24 bugs from the current forensic analysis pass (see `custom-bugs-report.md`)
**Status:** PENDING USER REVIEW — DO NOT EXECUTE UNTIL APPROVED
**Note:** All 23 bugs from the prior report are confirmed fixed. These tasks address only the new findings.

---

## Execution Strategy

Fixes are sequenced by risk. Phase 1 covers security vulnerabilities and active exploit surface. Phase 2 covers financial and data-integrity bugs that cause silent data loss or incorrect state. Phase 3 covers functional and reliability gaps. Phase 4 covers code quality and minor issues.

Each task is self-contained and can be executed independently unless a dependency is noted.

**Estimated effort:** ~2–3 engineering days for all 24 fixes with smoke testing.

---

## Phase 1 — Critical Security

---

### TASK-01 — Fix BUG-A-01: Replace malformed admin bcrypt dummy hash

**Priority:** CRITICAL — timing oracle enables admin account enumeration
**File:** `apps/web/app/api/admin/auth/login/route.ts`

1. Locate the dummy hash string `"$2b$12$invalidhashfortimingatack000000000"` in the admin login route.
2. Replace it with a module-level pre-generated valid bcrypt hash. The simplest approach: at the top of the file (outside the route handler), add `const DUMMY_HASH = bcrypt.hashSync("timing-equalization-sentinel", 12)`. This runs once at module load, not per request.
3. Use `DUMMY_HASH` in the `bcrypt.compare()` call for the unknown-email branch.
4. Verify the hash string is exactly 60 characters and starts with `$2b$12$` — bcrypt will perform full work-factor computation on it, equalising timing between existing and non-existing admin emails.

---

### TASK-02 — Fix BUG-S-01: Return 200 (not 401) on Paystack webhook signature mismatch

**Priority:** CRITICAL — non-2xx causes Paystack to retry indefinitely
**File:** `apps/web/app/api/economy/webhooks/paystack/route.ts`

1. Find the signature validation block that returns `{ status: 401 }` on mismatch.
2. Change it to return `NextResponse.json({ received: true }, { status: 200 })` (or `new NextResponse(null, { status: 204 })`).
3. Keep the existing `logger.warn` / `logger.error` call on mismatch — observability is still required.
4. Do not include any information in the response body that reveals why the request was rejected.
5. Test by sending a request with a deliberately wrong signature and confirming the response is 200 and Paystack's delivery log shows "delivered."

---

### TASK-03 — Fix BUG-S-02: Move admin 2FA setupToken from JSON body to HttpOnly cookie

**Priority:** CRITICAL — JSON body token is XSS-exfiltrable
**File:** `apps/web/app/api/admin/auth/login/route.ts`, `apps/web/app/api/admin/auth/totp/route.ts`

1. In the step-1 login route, remove `setupToken` from the JSON response body.
2. Instead, set it as a `Set-Cookie` response header: `HttpOnly; Secure; SameSite=Strict; Path=/api/admin/auth/totp; Max-Age=300` (5-minute TTL matches the TOTP window).
3. In the step-2 TOTP route, read the `setupToken` from the request cookie (via `request.cookies.get('admin_setup_token')`) instead of from the POST body.
4. The JSON response from step 1 should only contain `{ requiresTotp: true }` or similar UI-direction state — no token.
5. After successful TOTP verification, clear the setup-token cookie in the step-2 response.

---

## Phase 2 — Financial and Data Integrity

---

### TASK-04 — Fix BUG-P-01: Check consumptionState before crediting coins for consumable IAP

**Priority:** HIGH — same purchase token can be redeemed multiple times
**File:** `apps/web/app/api/economy/iap/verify/route.ts`

1. In `verifyGooglePlayPurchase`, after the `purchaseState === 0` check, add: `if (purchaseData.consumptionState !== 0) { return existing idempotent success or 409 }`.
2. `consumptionState === 1` means already consumed — return the same idempotent success response as the existing `reference_id` deduplication (do not error, as the user already received their coins).
3. Only credit coins when both `purchaseState === 0` AND `consumptionState === 0`.
4. This check must apply only to one-time consumable products (coin packs). Subscriptions use a different verification path and `consumptionState` is not relevant.

---

### TASK-05 — Fix BUG-P-02: Validate plan.monthlyCoins before processing subscription activation

**Priority:** HIGH — misconfigured plan silently activates subscription with no coins
**File:** `apps/web/app/api/economy/iap/verify/route.ts`

1. Find the `if (plan.monthlyCoins)` guard in `verifyAndActivateSubscription`.
2. Replace with an explicit validation: `if (typeof plan.monthlyCoins !== 'number' || plan.monthlyCoins <= 0)`.
3. On failure, throw an error (or `logger.error`) with the full plan details so the misconfiguration is immediately visible in logs. Do not silently proceed.
4. Decide whether a 0-coin subscription is a valid product (a free-tier subscription with no coin perk) or always a config error — document this decision in a code comment.

---

### TASK-06 — Fix BUG-P-03: Add rate limiting to IAP verify endpoint

**Priority:** HIGH — unthrottled endpoint enables rapid purchase token replay
**File:** `apps/web/app/api/economy/iap/verify/route.ts`

1. Import `rateLimit` from `lib/security/rateLimit.ts`.
2. At the start of the handler (after auth is resolved but before any DB/Google Play work), call `await rateLimit(userId, 'iap_verify', 10, 60)` (10 requests per minute per user).
3. Return 429 with `{ error: "Too many requests" }` if the limit is exceeded, consistent with how other rate-limited endpoints respond.
4. The key should be per-user, not per-IP, since IAP requests require authentication.

---

### TASK-07 — Fix BUG-P-04: Add fetch timeout to Google Play API calls

**Priority:** HIGH — no timeout causes function to hang until platform timeout, losing purchase state
**File:** `apps/web/app/api/economy/iap/verify/route.ts`

1. Create an `AbortController` with a 5-second timeout before each Google Play `fetch` call:
   ```
   const ac = new AbortController();
   const t = setTimeout(() => ac.abort(), 5000);
   try {
     const res = await fetchWithSsrf(url, { signal: ac.signal, ... });
   } finally {
     clearTimeout(t);
   }
   ```
2. In the catch block, check `err.name === 'AbortError'` and return a `503` or `504` response with `{ error: "Google Play API timed out, please retry your purchase" }`.
3. Apply this pattern to both the OAuth token exchange call and the purchase verification call.

---

### TASK-08 — Fix BUG-P-05: Cache the Google Play service-account OAuth token

**Priority:** MEDIUM — redundant RSA signing on every purchase verification
**File:** `apps/web/app/api/economy/iap/verify/route.ts`

1. Add a module-level cache object: `let cachedOAuthToken: { token: string; expiresAt: number } | null = null`.
2. In `createServiceAccountJwt` (or the function that exchanges the JWT for an access token), before signing a new JWT, check: `if (cachedOAuthToken && cachedOAuthToken.expiresAt > Date.now() + 60_000) return cachedOAuthToken.token`.
3. After a successful token exchange, store: `cachedOAuthToken = { token: accessToken, expiresAt: Date.now() + 3600_000 }`.
4. Google service account tokens are valid for 3600 seconds — re-use them for up to 3540 seconds (1 minute safety margin).

---

### TASK-09 — Fix BUG-E-01: Set `initialised = true` before `await connectAsync()` in initGooglePlayBilling

**Priority:** HIGH — concurrent init calls double-connect the billing client
**File:** `apps/expo/lib/payments/googlePlay.ts`

1. Move `initialised = true` to immediately before the `await connectAsync()` call.
2. In the catch block, set `initialised = false` before re-throwing so future calls can retry.
3. The result: the first caller sets the flag and begins connecting; all subsequent concurrent callers see `initialised = true` and return early without calling `connectAsync` again.

---

### TASK-10 — Fix BUG-E-02: Replay pending purchases on app startup in initGooglePlayBilling

**Priority:** HIGH — coins permanently lost after mid-flow crash
**File:** `apps/expo/lib/payments/googlePlay.ts`

1. After `await connectAsync()` succeeds in `initGooglePlayBilling`, call the available-purchases API: `const { results } = await InAppPurchases.getPurchaseHistoryAsync()` (or the equivalent for the billing library version in use).
2. Filter for purchases where `acknowledged === false` (or `consumptionState === 0` for consumables) — these are the ones that need server-side processing.
3. For each such purchase, invoke the same server-verification flow used for fresh purchases (call `/api/economy/iap/verify` with the `purchaseToken` and `productId`).
4. The server's existing `reference_id`-based deduplication ensures that purchases already credited are harmlessly no-ops on replay.
5. Wrap in a try/catch so startup failures here do not block billing initialisation for new purchases.

---

### TASK-11 — Fix BUG-G-01: Make findWarOpponent atomic with SELECT FOR UPDATE SKIP LOCKED

**Priority:** HIGH — concurrent CRON calls can pair the same guild into two wars
**File:** `apps/web/lib/guilds/warEngine.ts`

1. Wrap the entire `findWarOpponent` + war INSERT in a single `db.transaction()`.
2. Inside the transaction, use `SELECT id, ... FROM guilds WHERE <eligibility conditions> FOR UPDATE SKIP LOCKED LIMIT 1` to lock one eligible guild row for this transaction.
3. Check for an eligible opponent using the same `FOR UPDATE SKIP LOCKED` pattern.
4. Insert the war row within this transaction.
5. `SKIP LOCKED` means a concurrent call will skip any guild already locked by this transaction and pair a different one, eliminating the double-pairing race entirely.

---

### TASK-12 — Fix BUG-SE-01: Insert room_members row in createSeasonCeremonyRoom

**Priority:** HIGH — ceremony room creator cannot access or manage the room
**File:** `apps/web/lib/seasons/seasonEngine.ts`

1. Find the `INSERT INTO rooms` call in `createSeasonCeremonyRoom`.
2. Within the same transaction (or immediately after if no transaction wraps this), add:
   `INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES ($roomId, $adminUserId, 'admin', NOW())`
3. Use the same admin/system user ID that is set as `created_by` on the room row.
4. Reference any other room-creation path (e.g., the normal room creation route) to ensure the `room_members` schema matches exactly (required fields, default values, etc.).

---

### TASK-13 — Fix BUG-M-01: Move room message XP award to after moderation approval

**Priority:** HIGH — XP earnable on rejected messages
**File:** `apps/web/app/api/rooms/[roomId]/messages/route.ts`, moderation approval endpoint

1. In the message-creation handler, add a guard before the `safeAwardXP` call: `if (room.requires_approval) { /* skip XP here */ return; }`.
2. Find the endpoint or service function where a moderator approves a pending message (likely a PATCH or POST to `/api/rooms/[roomId]/messages/[messageId]/approve` or similar).
3. In that approval handler, after updating `messages.status = 'approved'`, call `safeAwardXP` for the original message sender with the same XP amount and source that would have been awarded at creation time.
4. Use a `referenceId` of `room_message:${messageId}` to make the approval-time XP award idempotent (consistent with the pattern used elsewhere in the XP engine).

---

### TASK-14 — Fix BUG-M-02: Require idempotency key for paid DMs or generate server-side fallback

**Priority:** HIGH — coin double-debit on client retry without idempotency key
**File:** `apps/web/app/api/messages/dm/[conversationId]/route.ts`

Two acceptable approaches — pick one:

**Option A (preferred — require the header):**
1. At the start of the paid DM handler, check for the `X-Idempotency-Key` header.
2. If the DM has a coin cost and the header is absent, return `400 { error: "X-Idempotency-Key header required for paid messages" }`.
3. Update mobile and web DM clients to always include this header for paid sends.

**Option B (server-generated fallback):**
1. If `idempotencyKey` is absent, generate a deterministic fallback: `sha256(senderId + recipientId + truncate(messageContent, 64) + Math.floor(Date.now() / 60000))` (minute-bucketed to allow retries within the same minute).
2. Use this as `coinRefId` so the deduplication index fires on retry.

---

### TASK-15 — Fix BUG-M-03: Increment DM daily message count after DB transaction commits

**Priority:** HIGH — Redis count leaks on DB transaction failure
**File:** `apps/web/app/api/messages/dm/[conversationId]/route.ts`

1. Move the `checkAndIncrementDailyCount` call to after the DB transaction (message INSERT + coin debit) has committed successfully.
2. If the Redis increment fails after a successful DB commit, log the error but return success to the client — the message was delivered, the Redis count is a soft limit and can tolerate a single miss.
3. Confirm there are no control-flow paths where the Redis increment is reached before the DB commit.

---

## Phase 3 — Functional Gaps and Reliability

---

### TASK-16 — Fix BUG-M-04: Fix DM reactions aggregation to return [] instead of null

**Priority:** MEDIUM — null reactions crash client .map() calls
**File:** `apps/web/app/api/messages/dm/[conversationId]/route.ts`

1. Find the `json_agg(...)` expression for reactions in the DM GET query.
2. Replace with:
   `COALESCE(json_agg(r.* ORDER BY r.created_at) FILTER (WHERE r.id IS NOT NULL), '[]'::json) AS reactions`
3. The `FILTER (WHERE r.id IS NOT NULL)` prevents aggregating the null join row from the LEFT JOIN when no reactions exist. The `COALESCE` ensures the result is `[]` not `NULL`.
4. This is the same pattern used in the room messages query — match it exactly.

---

### TASK-17 — Fix BUG-M-05: Return 422 (not 200 with fake id) for spam-blocked DM sends

**Priority:** MEDIUM — fake message id stored by clients causes FK errors later
**File:** `apps/web/app/api/messages/dm/[conversationId]/route.ts`

1. Find the block where a spam-filtered DM returns a 200 response with a fabricated `id`.
2. Change to: `return NextResponse.json({ error: "Message blocked by content filter", code: "CONTENT_FILTERED" }, { status: 422 })`.
3. Update the DM client (mobile and web) to handle 422/CONTENT_FILTERED by displaying a "Message blocked" notice and NOT persisting the response as a sent message.
4. Remove the fake id entirely from the codebase — it should never have existed as a pattern.

---

### TASK-18 — Fix BUG-Q-01: Add observability and retry path for quest progress failures

**Priority:** MEDIUM — silent quest progress loss is invisible and unrecoverable
**File:** `apps/web/lib/quests/questEngine.ts` and all callers

1. Replace every `.catch(() => {})` on `triggerActivityQuestProgress` calls with `.catch((err) => logger.error({ err, userId, activity }, '[questEngine] triggerActivityQuestProgress failed — quest progress may be lost'))`.
2. For quest progress directly tied to rewards (milestone unlocks, daily quest completion bonuses), consider inserting a row into a `failed_quest_progress` table on failure — similar to `failed_xp_awards` — so the daily CRON can retry.
3. If the quest progress update is genuinely best-effort (no reward consequence), document this in a code comment so future developers understand the `.catch(() => {})` was intentional and the logger call is sufficient.

---

### TASK-19 — Fix BUG-C-02: Clarify or fix streak CRON grace period behaviour

**Priority:** MEDIUM — implicit 1-day grace period is unintended and undocumented
**File:** `apps/web/app/api/cron/daily-core/route.ts`

1. Identify the two streak UPDATE statements and the gap for `last_login_date = CURRENT_DATE - 1`.
2. Make a product decision: Is there an intentional grace period?
   - **If no grace period intended:** Change the reset condition from `last_login_date < CURRENT_DATE - 1` to `last_login_date < CURRENT_DATE`. Users who did not log in today get their streak reset at the CRON run.
   - **If grace period is intentional:** Add an explicit code comment: `/* 1-day grace period is intentional — users have until end of the next day to maintain their streak */`. Also update any user-facing streak UI to communicate this (e.g., "Streak safe until midnight tomorrow").
3. Either way, the current undocumented state is a bug — the correct fix is clarity.

---

### TASK-20 — Fix BUG-N-01: Deduplicate userIds at the start of sendPushNotificationBatch

**Priority:** MEDIUM — duplicate userIds in input send duplicate push notifications
**File:** `apps/web/lib/notifications/push.ts`

1. At the very start of `sendPushNotificationBatch`, before any processing, add:
   `const uniqueUserIds = [...new Set(userIds)]`
2. Replace all subsequent uses of `userIds` within the function with `uniqueUserIds`.
3. This ensures both the DB token lookup and the message-build loop operate on the same deduplicated set.
4. Callers do not need to deduplicate their own inputs, but it remains good practice for them to do so.

---

### TASK-21 — Fix BUG-E-03: Process offline sync queue with concurrency instead of strict sequentiality

**Priority:** LOW — sequential processing causes a slow/stuck message to block all queued sends
**File:** `apps/expo/lib/offline/syncQueue.ts`

1. Replace the `for...of` sequential loop with a concurrency-limited parallel approach. A simple approach using a chunk size of 3:
   ```
   const chunks = chunk(messages, 3);
   for (const batch of chunks) {
     await Promise.allSettled(batch.map(msg => sendQueuedMessage(msg)));
   }
   ```
2. `Promise.allSettled` (not `Promise.all`) ensures a failure in one message does not abort the rest of the batch.
3. The existing per-message error handling (`4xx = permanent fail`, `5xx = retry`) is correct and should be kept inside the per-message send function.
4. Alternatively as a minimal fix: skip messages with `retry_count >= 3` (permanently failed) before the loop so they do not block later messages, even if processing remains sequential.

---

## Phase 4 — Code Quality

---

### TASK-22 — Fix BUG-C-01: Remove or use guild_a_id / guild_b_id in guild-wars CRON query

**Priority:** LOW — dead SELECT columns add unnecessary data transfer
**File:** `apps/web/app/api/cron/guild-wars/route.ts`

1. Find the SELECT query that fetches wars to resolve.
2. Choose one:
   - **Minimal fix:** Remove `guild_a_id` and `guild_b_id` from the SELECT list.
   - **Intent-completing fix:** Pass `row.guild_a_id` and `row.guild_b_id` as additional arguments to `resolveWar`, update its signature to accept them, and remove the re-lookup of guild IDs inside `resolveWar` (if any). This is the likely original intent of selecting these columns.

---

### TASK-23 — Fix BUG-L-03: Update leaderboards CRON track count comment

**Priority:** LOW — stale comment causes off-by-one confusion when adding tracks
**File:** `apps/web/app/api/cron/leaderboards/route.ts`

1. Find the comment above the `TRACKS` array.
2. Update the count from 7 to 8 (or whatever the current actual count is — count the array entries).
3. If any test asserts `TRACKS.length === 7`, update that assertion too.

---

### TASK-24 — Fix BUG-L-04: Send distinct notification copy for rank promotions vs. demotions

**Priority:** LOW — demotions and promotions receive identical message copy
**File:** `apps/web/app/api/cron/leaderboards/route.ts`

1. Before sending the rank-change notification, compare `newRank` and `previousRank`:
   - `newRank < previousRank` → promotion (climbed up)
   - `newRank > previousRank` → demotion (dropped)
2. Send distinct notification types/titles/bodies:
   - Promotion: `type: "rank_promotion"`, `title: "You climbed the leaderboard!"`, `body: "You're now #${newRank} on the ${track} leaderboard."`
   - Demotion: `type: "rank_drop"`, `title: "Your rank dropped"`, `body: "You fell to #${newRank}. Keep going to climb back up."`
3. Use distinct `notification_type` values so the mobile app can render them with different icons or colours if desired.

---

## Fix Sequencing Summary

| Phase | Task    | Bug Code    | Priority |
|-------|---------|-------------|----------|
| 1     | TASK-01 | BUG-A-01    | CRITICAL |
| 1     | TASK-02 | BUG-S-01    | CRITICAL |
| 1     | TASK-03 | BUG-S-02    | CRITICAL |
| 2     | TASK-04 | BUG-P-01    | HIGH     |
| 2     | TASK-05 | BUG-P-02    | HIGH     |
| 2     | TASK-06 | BUG-P-03    | HIGH     |
| 2     | TASK-07 | BUG-P-04    | HIGH     |
| 2     | TASK-08 | BUG-P-05    | MEDIUM   |
| 2     | TASK-09 | BUG-E-01    | HIGH     |
| 2     | TASK-10 | BUG-E-02    | HIGH     |
| 2     | TASK-11 | BUG-G-01    | HIGH     |
| 2     | TASK-12 | BUG-SE-01   | HIGH     |
| 2     | TASK-13 | BUG-M-01    | HIGH     |
| 2     | TASK-14 | BUG-M-02    | HIGH     |
| 2     | TASK-15 | BUG-M-03    | HIGH     |
| 3     | TASK-16 | BUG-M-04    | MEDIUM   |
| 3     | TASK-17 | BUG-M-05    | MEDIUM   |
| 3     | TASK-18 | BUG-Q-01    | MEDIUM   |
| 3     | TASK-19 | BUG-C-02    | MEDIUM   |
| 3     | TASK-20 | BUG-N-01    | MEDIUM   |
| 3     | TASK-21 | BUG-E-03    | LOW      |
| 4     | TASK-22 | BUG-C-01    | LOW      |
| 4     | TASK-23 | BUG-L-03    | LOW      |
| 4     | TASK-24 | BUG-L-04    | LOW      |

---

*Fix plan generated: June 20, 2026 · 10:41 AM*
*Total tasks: 24 (3 Critical · 11 High · 6 Medium · 4 Low) | Estimated effort: 2–3 engineering days*
*DO NOT BEGIN IMPLEMENTATION UNTIL THE USER APPROVES THIS PLAN*
