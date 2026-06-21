# Zobia Codebase — Forensic Bug Report
**Date:** 2026-06-21  |  **Time:** 10:42 AM  |  **Analyst:** Claude Code (claude-sonnet-4-6)

---

## Code Quality Rating — BEFORE fixes

| Dimension | Score | Notes |
|---|---|---|
| Correctness | 5 / 10 | 3 routes always return 500; payment race conditions; quota-burning on retry |
| Security | 5 / 10 | Prompt injection, missing session invalidation on ban, no rate-limit on phone enum |
| Data Integrity | 5 / 10 | IDB queue data loss, FOR UPDATE race, ledger/balance divergence from missing xp_ledger entries |
| Resilience | 6 / 10 | Good DLQ pattern in most places but fire-and-forget gaps on Vercel |
| Code Structure | 7 / 10 | Solid abstractions; schema-validated columns; issues are concentrated in specific routes |
| **Overall** | **5.5 / 10** | Production-usable but several financial and security bugs require urgent attention |

---

## Summary — One-line list

```
1:  BUG-IDB-01: IDB offline queue — transaction auto-commits before retry put() calls
2:  BUG-XP-01:  safeAwardXP — system_alert INSERT missing await (fire-and-forget)
3:  BUG-PAY-01: paystackWebhookHandler.processTransferEvent — nested transaction deadlock
4:  BUG-CSP-01: middleware.ts — mobile CSRF blocked when EXPO_ORIGIN env var not set
5:  BUG-QST-01: questEngine.resetDailyQuests — user_quest_decks DELETE has no .catch()
6:  BUG-LB-01:  leaderboard getUserRank — 'national' scope not translated to 'global'
7:  BUG-PIN-01: pin/verify — extended lockout durations never applied (early return before redis.expire)
8:  BUG-ADM-01: withAdminAuth — missing is_banned / is_suspended check
9:  BUG-PAY-02: reconcileStuckPayouts — FOR UPDATE executed outside a transaction
10: BUG-PAY-03: dodopayments — HMAC key uses wrong env var (API_KEY instead of WEBHOOK_SECRET)
11: BUG-XP-02:  commissions.ts — safeAwardXP called outside caller's transaction
12: BUG-XP-03:  coins/transfer — fire-and-forget XP on Vercel serverless (no DLQ fallback)
13: BUG-SQL-01: coins/purchase/verify — wrong column alias cl.type (should be cl.transaction_type)
14: BUG-SEC-01: admin moderation action — prompt injection via user-supplied report.content
15: BUG-SEC-02: admin moderation action — ban/suspend skip invalidateAllSessions()
16: BUG-MSG-01: messages/dm — daily quota counter incremented before idempotency check
17: BUG-ECO-01: daily-economy CRON — monthly coin bonus LIMIT 1000 permanently drops users
18: BUG-ROM-01: rooms/subscribe — member_count never incremented after balance payment
19: BUG-SQL-02: users/me/export — GDPR export queries non-existent coin_ledger.reason column
20: BUG-SQL-03: daily-platform CRON — DELETE FROM sessions ... LIMIT invalid PostgreSQL syntax
21: BUG-SEC-03: contacts/cross-reference — no rate limit; allows phone number enumeration
22: BUG-ECO-02: creator fund — tier cutoff math skips lower tiers on small creator counts
23: BUG-ECO-03: ad-reward — Redis counter incremented before DB transaction; DB failure loses daily slot
24: BUG-XP-04:  reaction-sets/use — unhandled 23505 when same message reacted to from second set
25: BUG-XP-05:  quest deck_bonus — TOCTOU: concurrent last-quest completions double-award 500 XP
26: BUG-AUTH-01: 2FA verify — no is_banned / is_suspended check before creating full session
27: BUG-XP-06:  room reactions — milestone and custom XP update users table without xp_ledger entry; reconciliation CRON reverses the award
```

---

## Detailed Analysis

---

### 1: BUG-IDB-01 — IDB offline queue transaction auto-commits before retry put() calls

**FILES:** `apps/web/lib/offline/messageQueue.ts`

**Description:** `resetSendingMessages()` and `retryFailed()` both open an IndexedDB transaction, call `index.getAll()` (or `store.getAll()`), then `await` the result. In the IDB spec, a transaction auto-commits once all its microtasks complete and no further requests are pending. After `await index.getAll()` resolves, the IDB transaction is already in the committing state; subsequent `store.put()` calls on the now-stale transaction throw `"transaction has finished"`. This means every queued message that needs a status reset silently fails — the message stays stuck in `sending` or `failed` state forever.

**FIX:** Collect all update operations inside a single IDB transaction without interleaving `await` calls. Use the IDB request callback pattern (onsuccess/onerror) or a Promise wrapper that keeps the transaction alive across the update loop, e.g., open the transaction → `getAll` → in the result handler (synchronously) iterate and call `put()` for each → resolve/reject the outer Promise only after all puts are queued.

---

### 2: BUG-XP-01 — safeAwardXP system_alert INSERT missing await

**FILES:** `apps/web/lib/xp/safeAwardXP.ts` (line 282)

**Description:** Inside `retryFailedXPAwards()`, when a DLQ entry reaches `MAX_RETRIES`, a `system_alert` is inserted to notify operators. The call is `globalDb.query(...).catch(() => {})` without `await`. The returned Promise is detached. On Vercel Edge/Serverless, the runtime does not wait for floating Promises after the handler returns a response. The system alert will silently be dropped in most cases, leaving operators unaware of permanently failed XP awards.

**FIX:** Add `await` before `globalDb.query(...)` to ensure the alert insert completes before the loop iteration ends. The existing `.catch(() => {})` already makes it non-blocking on error.

---

### 3: BUG-PAY-01 — paystackWebhookHandler nested transaction deadlock

**FILES:** `apps/web/lib/payments/paystackWebhookHandler.ts`

**Description:** `processTransferEvent()` is called inside a `db.transaction()` callback. Within that same callback, when a transfer event fails, it calls `moveToDeadLetterQueue(payoutId)`. That function opens its own `db.transaction()` which issues `SELECT … FOR UPDATE` on the same `payouts` row. PostgreSQL detects a deadlock: the outer transaction holds a lock on the `payouts` row; the inner transaction (on a different connection from the pool) waits for the same lock. Both transactions are killed with `ERROR: deadlock detected`. The payout event is permanently lost (not retried), and the CRON job fails silently.

**FIX:** Refactor `processTransferEvent` to not call `moveToDeadLetterQueue` inside the caller's transaction. Instead, receive the transaction client as a parameter and execute the DLQ INSERT directly within it, or collect DLQ data and call `moveToDeadLetterQueue` after the outer transaction commits.

---

### 4: BUG-CSP-01 — Mobile CSRF blocked when EXPO_ORIGIN not set

**FILES:** `apps/web/middleware.ts`

**Description:** The CSRF origin-validation middleware checks `request.headers.get('origin')` against `allowedOrigins`, which includes `process.env.EXPO_ORIGIN`. If `EXPO_ORIGIN` is not set in the environment, the array entry is `undefined`. All requests from the Expo mobile app are rejected with 403 `CSRF_ORIGIN_MISMATCH` because `undefined` never matches any actual Origin header value. This is an environment misconfiguration that silently breaks all authenticated mobile API calls.

**FIX:** Filter out falsy entries when building `allowedOrigins`: `[appUrl, process.env.EXPO_ORIGIN].filter(Boolean)`. Also add a startup warning if `EXPO_ORIGIN` is undefined in production.

---

### 5: BUG-QST-01 — questEngine resetDailyQuests DELETE missing .catch()

**FILES:** `apps/web/lib/quests/questEngine.ts` (around line 493)

**Description:** `resetDailyQuests()` runs two DELETE statements. The first (`DELETE FROM user_quest_progress WHERE …`) has a `.catch()` handler. The second (`DELETE FROM user_quest_decks WHERE assigned_date < CURRENT_DATE - INTERVAL '30 days'`) has no `.catch()`. If the second DELETE throws (e.g., DB timeout, deadlock), the uncaught rejection propagates up through `resetDailyQuests`, causing the daily-core CRON to log an error and skip subsequent steps. This is asymmetric error handling that breaks the CRON on an otherwise non-critical cleanup task.

**FIX:** Add `.catch((err) => logger.warn({ err }, '[questEngine] deck cleanup failed'))` to the second DELETE, matching the pattern used for the first DELETE.

---

### 6: BUG-LB-01 — leaderboard getUserRank 'national' scope not translated

**FILES:** `apps/web/lib/leaderboards/engine.ts`

**Description:** `getUserRank()` accepts a `scope` parameter of type `'global' | 'national' | 'city'`. However, `leaderboard_snapshots` stores rows with `scope = 'global'` (not `'national'`). `getLeaderboard()` correctly translates `national → global` before querying, but `getUserRank()` passes the raw scope value `'national'` directly to the SQL `WHERE scope = $n` clause. The query returns zero rows; national rank always returns `null`. Any feature that reads a user's national rank (profile page, notification text) always shows nothing.

**FIX:** At the top of `getUserRank()`, add: `const dbScope = scope === 'national' ? 'global' : scope;` and use `dbScope` in the SQL query.

---

### 7: BUG-PIN-01 — PIN verify extended lockout durations never applied

**FILES:** `apps/web/app/api/auth/pin/verify/route.ts`

**Description:** The route computes an extended `lockoutTtl` (1800 s at ≥ 10 attempts, 86400 s at ≥ 20 attempts) but requests with `tentativeFailures > 10` already hit an early `return NextResponse.json(429)` before reaching the `redis.expire(failKey, lockoutTtl)` call. As a result, lockouts never extend beyond the base window regardless of how many failed attempts accumulate. An attacker who reaches the extended-lockout threshold faces the same short lockout as on their first violation.

**FIX:** Move the `redis.expire(failKey, lockoutTtl)` call before the early-return guard, or fold the lockout TTL extension into the same Redis pipeline that sets the failure counter, so it executes regardless of the early return path.

---

### 8: BUG-ADM-01 — withAdminAuth missing is_banned / is_suspended check

**FILES:** `apps/web/lib/api/middleware.ts`

**Description:** `withAdminAuth` validates only that `users.is_admin = true AND deleted_at IS NULL`. It does not check `is_banned` or `is_suspended`. A banned or suspended admin with a valid JWT (up to 30-minute TTL) retains full access to every admin route: moderation actions, user management, data exports, payout processing, etc. By contrast, the `withAuth` HOC correctly checks session status; only the admin variant has this gap.

**FIX:** Add `AND COALESCE(is_banned, false) = false AND COALESCE(is_suspended, false) = false` to the admin user SELECT query inside `withAdminAuth`.

---

### 9: BUG-PAY-02 — reconcileStuckPayouts FOR UPDATE outside transaction

**FILES:** `apps/web/lib/payments/payouts.ts`

**Description:** `reconcileStuckPayouts()` issues `SELECT … FROM payouts WHERE … FOR UPDATE SKIP LOCKED` as a standalone `db.query()` call (not inside `db.transaction()`). In PostgreSQL, row-level locks acquired by `FOR UPDATE` outside a transaction are held only for the duration of that single statement, then released immediately. Two concurrent CRON invocations (external CRON service + manual trigger) can both pass the `FOR UPDATE SKIP LOCKED` check simultaneously and both process the same stuck payout, potentially double-crediting the user or sending duplicate Paystack transfer requests.

**FIX:** Wrap the entire reconcile loop (SELECT FOR UPDATE + UPDATE status + trigger transfer) in a `db.transaction()` call so the row lock is held until the transaction commits.

---

### 10: BUG-PAY-03 — DodoPayments HMAC key uses wrong environment variable

**FILES:** `apps/web/lib/payments/dodopayments.ts`

**Description:** `verifyWebhookSignature()` computes the HMAC-SHA256 signature using `process.env.DODOPAYMENTS_API_KEY` as the secret key. DodoPayments webhook signature verification must use a separate `DODO_WEBHOOK_SECRET` (a distinct secret issued in the DodoPayments dashboard). Using the API key as the HMAC key means: (a) all legitimate webhooks fail verification and are rejected, or (b) if the key happens to match (unlikely), the validation provides no security because the API key may be exposed in other contexts.

**FIX:** Replace `process.env.DODOPAYMENTS_API_KEY` with `process.env.DODO_WEBHOOK_SECRET` in the HMAC instantiation. Add a startup assertion that `DODO_WEBHOOK_SECRET` is set.

---

### 11: BUG-XP-02 — Referral commissions XP awarded outside caller's transaction

**FILES:** `apps/web/lib/referrals/commissions.ts`

**Description:** `awardReferralCommissions()` receives a transaction client from its caller but calls `safeAwardXP(referrerId, xpAmount, …)` without passing the transaction client. `safeAwardXP` defaults to `globalDb`, so the XP INSERT executes on a separate connection outside the caller's transaction. If the outer transaction rolls back (e.g., `creditCoins` fails), the XP award is not rolled back. The referrer permanently gains XP without the corresponding coin bonus, creating a ledger inconsistency that the reconciliation CRON will eventually flag.

**FIX:** Pass the transaction client as the last argument to `safeAwardXP(referrerId, xpAmount, track, source, referenceId, tx)` so the XP INSERT participates in the same transaction as the coin credit.

---

### 12: BUG-XP-03 — Coin transfer XP uses fire-and-forget without DLQ

**FILES:** `apps/web/app/api/economy/coins/transfer/route.ts`

**Description:** After a successful coin transfer, the route calls `void awardTransferXP(senderId, receiverId, amount)`. This detached Promise is not awaited and has no fallback. On Vercel Serverless, the runtime terminates the function context immediately after `NextResponse.json()` is returned, before the detached Promise resolves. Unlike `safeAwardXP`, `awardTransferXP` does not write a DLQ entry on failure. XP for coin transfers is silently dropped on every serverless cold-start termination.

**FIX:** Either `await awardTransferXP(…)` before the response, or replace the internal calls with `safeAwardXP(…)` which has DLQ backing. The simplest fix is to move XP awarding inside the transaction or `await` it before the return statement.

---

### 13: BUG-SQL-01 — Coin purchase verify route wrong column alias

**FILES:** `apps/web/app/api/economy/coins/purchase/verify/route.ts`

**Description:** The idempotency check query contains `LEFT JOIN coin_ledger cl ON cl.user_id = u.id AND cl.type = 'purchase'`. The `coin_ledger` table has no column named `type`; the column is `transaction_type`. PostgreSQL throws `ERROR: column cl.type does not exist` on every call, returning a 500 to all clients. The coin purchase verify route is completely broken.

**FIX:** Change `cl.type = 'purchase'` to `cl.transaction_type = 'iap_purchase'` (or whichever transaction_type value is used for coin purchases). Verify the exact value by checking the `creditCoins` call in the purchase flow.

---

### 14: BUG-SEC-01 — AI moderation prompt injection via report.content

**FILES:** `apps/web/app/api/admin/moderation/[reportId]/action/route.ts`

**Description:** `triggerAiEscalation()` builds an AI moderation prompt by directly interpolating `report.content` — a field written by users when filing a report — into the prompt string: `` `Content: ${report.content ?? "(no content attached)"}` ``. A malicious user can craft a report message that overrides the AI's instructions, forges a "Respond with JSON" block, and manipulates the verdict returned. This could cause the AI to output `{"verdict": "safe", "confidence": 0.99}` for genuinely harmful content, bypassing moderation.

**FIX:** Sanitize `report.content` before interpolation: strip control characters, escape backticks, and impose a character limit. Better: pass the content as a clearly-delimited data block using XML-style tags (e.g., `<reported_content>…</reported_content>`) and instruct the model explicitly that text inside those tags is untrusted user input and must not be treated as instructions.

---

### 15: BUG-SEC-02 — Moderation action ban/suspend skips session invalidation

**FILES:** `apps/web/app/api/admin/moderation/[reportId]/action/route.ts`

**Description:** When a moderator takes a `ban_user` or `suspend_user` action via the report moderation route, the DB is updated but `invalidateAllSessions(report.reported_user_id)` is never called. The user's existing JWT sessions remain valid in Redis until they expire naturally (up to 30 minutes for access tokens; sessions can be refreshed until the refresh token expires). By contrast, the admin user-actions route (`/api/admin/users/[userId]/actions`) correctly calls `invalidateAllSessions()` after every status change.

**FIX:** Add `await invalidateAllSessions(report.reported_user_id)` after the ban/suspend DB update completes, outside the transaction (same pattern used in the admin user actions route). Wrap in try/catch and log; do not let a Redis failure prevent the moderation action from completing.

---

### 16: BUG-MSG-01 — DM daily quota counter incremented before idempotency check

**FILES:** `apps/web/app/api/messages/dm/route.ts`

**Description:** The DM send handler increments the user's daily message counter via `checkAndIncrementDailyCount()` at step 5, then performs the idempotency check (duplicate message key lookup) at step 8. When a client retries a failed DM with the same `idempotencyKey`, the idempotency check correctly returns the existing message — but the daily quota has already been burned again for that retry. A client that retries 5 times with the same key consumes 5 daily message slots while delivering only 1 message.

**FIX:** Move the idempotency check before the `checkAndIncrementDailyCount()` call. If the idempotency key matches an existing message, return it immediately without touching the quota counter.

---

### 17: BUG-ECO-01 — Monthly plan coin bonus permanently misses users beyond LIMIT 1000

**FILES:** `apps/web/app/api/cron/daily-economy/route.ts`

**Description:** The monthly coin bonus CTE uses `SELECT … FROM users WHERE plan = $1 … FOR UPDATE LIMIT 1000`. The idempotency key is `'plan:' || users.id::text || ':' || monthKey` (unique per user per month). On the first run, 1000 users are processed and marked as receiving the bonus. On every subsequent run that month, those 1000 users are excluded by the `NOT EXISTS (…reference_id = monthKey)` filter, but the `LIMIT 1000` means the 1001st and beyond are also never selected. Users outside the first 1000 processed per plan never receive their monthly bonus for that period.

**FIX:** Remove the `LIMIT 1000` from the FOR UPDATE CTE. If row count needs to be bounded to prevent long-running queries, use keyset pagination across multiple CRON invocations: record the last-processed user ID in `cron_state` and advance the cursor each run. This correctly processes all users across runs within the same month.

---

### 18: BUG-ROM-01 — VIP room subscribe: member_count never incremented

**FILES:** `apps/web/app/api/rooms/[roomId]/subscribe/route.ts`

**Description:** Inside the subscription transaction, the route first inserts the user into `room_members` (`ON CONFLICT DO NOTHING`), then runs `UPDATE rooms SET member_count = member_count + 1 WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM room_members WHERE room_id=$1 AND user_id=$2)`. Because the INSERT already placed the user in `room_members` earlier in the same transaction, the `NOT EXISTS` sub-select always finds the row — the intent was to avoid double-counting already-members, but the check runs after the insert so it always evaluates to false. `member_count` is never incremented for new balance-payment subscribers.

**FIX:** Either restructure to check membership before inserting, or (cleaner) change the INSERT to `RETURNING xmax` (or use `INSERT … ON CONFLICT DO NOTHING RETURNING id`) to detect if a new row was actually inserted, and only increment `member_count` when a new row was created.

---

### 19: BUG-SQL-02 — GDPR export queries non-existent coin_ledger.reason column

**FILES:** `apps/web/app/api/users/me/export/route.ts`

**Description:** The GDPR data export route queries `SELECT id, amount, reason, created_at FROM coin_ledger`. The `coin_ledger` table has no `reason` column — the relevant columns are `transaction_type` and `description`. PostgreSQL throws `ERROR: column "reason" does not exist` on every call. The entire `POST /api/users/me/export` endpoint always returns a 500, making the GDPR export feature completely non-functional.

**FIX:** Replace `reason` with `transaction_type, description` in the SELECT. Update the `CoinLedgerRow` interface accordingly.

---

### 20: BUG-SQL-03 — Daily-platform CRON DELETE with LIMIT not valid PostgreSQL syntax

**FILES:** `apps/web/app/api/cron/daily-platform/route.ts`

**Description:** The session pruning step executes `DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '1 day' LIMIT 10000`. PostgreSQL's DELETE statement does not support a `LIMIT` clause (this is MySQL syntax). Every CRON run throws a PostgreSQL syntax error. The error is caught and logged as a warning, so the CRON continues, but expired sessions are never pruned. Over time the `sessions` table grows unbounded, degrading lookup performance and consuming storage.

**FIX:** Rewrite as a CTE-based delete: `DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE expires_at < NOW() - INTERVAL '1 day' LIMIT 10000)`.

---

### 21: BUG-SEC-03 — Contacts cross-reference endpoint has no rate limiting

**FILES:** `apps/web/app/api/users/contacts/cross-reference/route.ts`

**Description:** The endpoint accepts up to 500 phone numbers per request and returns matched Zobia users. No `enforceRateLimit()` call exists in the route handler. Any authenticated user can repeatedly call this endpoint with batches of 500 numbers to enumerate which phone numbers are registered on the platform. With no throttle, an attacker can enumerate millions of phone numbers per hour, compromising the privacy of all users who registered with a phone number.

**FIX:** Add `await enforceRateLimit(auth.user.sub, 'user', { windowMs: 60_000, limit: 5, name: 'contacts:cross-reference' })` at the top of the handler. Also consider limiting the endpoint to at most 100 numbers per request.

---

### 22: BUG-ECO-02 — Creator fund tier math skips lower tiers with small creator pools

**FILES:** `apps/web/lib/creator/fund.ts`

**Description:** `calculateFundDistributions()` computes tier cutoffs as `Math.max(1, Math.floor((tier.topPercent / 100) * total))`. With a small number of creators (e.g., 5), multiple tiers resolve to the same cutoff of 1 (top 1%, 5%, 10%, 25% all → cutoff=1). `scored.slice(prevCutoff, cutoff)` then returns empty slices for tiers 2-4. Those tiers' `poolShare` values (25% + 20% + 15% = 60%) are never distributed, and the remainder redistribution only goes to creators already in the distributed tiers — not the skipped ones. The fund's intended distribution is significantly distorted at small pool sizes.

**FIX:** Ensure each tier's cutoff is strictly greater than the previous: `const cutoff = Math.max(prevCutoff + 1, Math.floor((tier.topPercent / 100) * total))`. Also consider distributing unallocated pool shares to all eligible creators proportionally rather than only to the top tiers.

---

### 23: BUG-ECO-03 — Ad-reward Redis counter incremented before DB transaction

**FILES:** `apps/web/app/api/economy/rewards/ad-reward/route.ts`

**Description:** The route calls `redis.incr(redisKey)` (step 2) before the DB transaction (step 3). If the DB transaction fails (connectivity error, deadlock, etc.), the Redis counter has already been incremented — reducing the user's remaining daily ad quota by 1. The route only calls `redis.decr(redisKey)` when the count exceeds the cap, not on DB failure. A user who experiences DB-level errors loses daily ad slots without receiving coins.

**FIX:** Move the Redis increment inside the DB transaction's success path (after the transaction commits), or implement a try/catch around the DB transaction that calls `redis.decr(redisKey)` on failure to compensate.

---

### 24: BUG-XP-04 — Reaction set use throws unhandled 23505 on second reaction to same message

**FILES:** `apps/web/app/api/economy/reaction-sets/[setId]/use/route.ts`

**Description:** The XP ledger INSERT uses `reference_id = body.messageId`. If a user reacts to the same message with a second (different) reaction set on the same day, the second XP award INSERT fails with a PostgreSQL unique violation (23505) on `(user_id, source, reference_id)`. The transaction aborts and the error propagates to `handleApiError`, which returns a 500 to the client. The reaction itself was legitimate but the endpoint breaks, confusing the user.

**FIX:** Catch the 23505 error from the XP INSERT and treat it as a no-op (the user already earned XP for this message). Either use `ON CONFLICT DO NOTHING` in the XP INSERT, or catch the pgCode `'23505'` and continue normally without awarding XP.

---

### 25: BUG-XP-05 — Quest deck_bonus TOCTOU allows double-award on concurrent completions

**FILES:** `apps/web/app/api/quests/daily/[questId]/progress/route.ts`

**Description:** The deck bonus (500 XP) is awarded by first checking `SELECT id FROM xp_ledger WHERE user_id=$1 AND source='deck_bonus' AND created_at::date=$2` and then, if no row is found, inserting the bonus. Two concurrent requests completing the last quest in the deck simultaneously can both pass the SELECT check (under READ COMMITTED isolation, neither sees the other's uncommitted INSERT) and both insert the deck bonus, awarding 1000 XP instead of 500. There is no `ON CONFLICT DO NOTHING` guard on the deck bonus INSERT.

**FIX:** Add a `reference_id` to the deck bonus INSERT (e.g., `deck_bonus:{userId}:{today}`) and add `ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING` to make it idempotent, exactly as is already done for the quest completion XP INSERT.

---

### 26: BUG-AUTH-01 — 2FA verify creates session without checking ban/suspend status

**FILES:** `apps/web/app/api/auth/2fa/verify/route.ts`

**Description:** After verifying the TOTP code and consuming the pre-auth token, `createSession()` is called immediately. The user SELECT query fetches `is_admin, totp_secret, totp_enabled` etc. but does not include `is_banned` or `is_suspended`. A user who is banned or suspended after their pre-auth token is issued (90-second window) can still complete 2FA and receive a valid access + refresh token pair. The ban is only checked on subsequent API calls via `withAuth`, so the user has a valid session for up to 15 minutes post-ban.

**FIX:** Add `is_banned, is_suspended` to the SELECT query in the 2FA verify handler. After fetching the user, check: `if (!user || user.is_banned || user.is_suspended) throw unauthorized('Account is not active');` before proceeding to session creation.

---

### 27: BUG-XP-06 — Room reaction milestone XP bypasses xp_ledger; reconciliation reverses the award

**FILES:** `apps/web/app/api/rooms/[roomId]/messages/[messageId]/reactions/route.ts`

**Description:** The 5-reactor milestone (10 XP to message sender) and the custom reaction XP (1 XP to reactor) both update `users.xp_total` directly via `UPDATE users SET xp_total = xp_total + N` without inserting a corresponding row in `xp_ledger`. The reconciliation CRON (`reconcile-balances`) computes the correct XP total from `xp_ledger` and auto-corrects discrepancies of ≤ 50 XP (the `AUTO_CORRECT_THRESHOLD`). Since both XP awards are below 50, the reconciliation CRON will silently reverse both every time it runs, effectively resetting these bonuses to zero.

**FIX:** Replace the direct `UPDATE users SET xp_total + N` calls with `safeAwardXP(userId, amount, 'social', source, referenceId)`. Use the message ID as part of the reference key for idempotency. This ensures both awards are reflected in `xp_ledger` and survive reconciliation.

---

## Code Quality Rating — AFTER all recommended fixes

| Dimension | Score (projected) | Notes |
|---|---|---|
| Correctness | 9 / 10 | All 3 broken routes fixed; quota/idempotency logic corrected |
| Security | 9 / 10 | Prompt injection hardened; session invalidation complete; phone enum rate-limited |
| Data Integrity | 9 / 10 | IDB queue, ledger consistency, XP reconciliation all repaired |
| Resilience | 9 / 10 | DLQ gaps closed; fire-and-forget XP properly backed |
| Code Structure | 8 / 10 | Minor cleanup (scope translation, LIMIT on DELETE) improves maintainability |
| **Overall** | **8.8 / 10** | Production-grade after fixes; monitoring and load testing recommended |

---

## Priority / Severity Matrix

| Priority | Bugs |
|---|---|
| P0 — Broken in production | BUG-SQL-01 (#13), BUG-SQL-02 (#19), BUG-SQL-03 (#20) |
| P1 — Critical security/financial | BUG-SEC-01 (#14), BUG-SEC-02 (#15), BUG-PAY-01 (#3), BUG-PAY-03 (#10), BUG-PAY-02 (#9) |
| P1 — Critical security | BUG-ADM-01 (#8), BUG-AUTH-01 (#26), BUG-SEC-03 (#21) |
| P2 — Financial integrity | BUG-ECO-01 (#17), BUG-XP-02 (#11), BUG-XP-03 (#12), BUG-XP-06 (#27) |
| P2 — Functional breakage | BUG-IDB-01 (#1), BUG-CSP-01 (#4), BUG-PIN-01 (#7), BUG-MSG-01 (#16) |
| P3 — Data quality / correctness | BUG-LB-01 (#6), BUG-ROM-01 (#18), BUG-XP-05 (#25), BUG-XP-04 (#24), BUG-QST-01 (#5) |
| P4 — Low/cosmetic impact | BUG-XP-01 (#2), BUG-ECO-02 (#22), BUG-ECO-03 (#23), BUG-XP-04 (#24) |

---

*Report generated: 2026-06-21 — 10:42 AM*  
*Analyst: Claude Code (claude-sonnet-4-6) — Zobia Forensic Bug Analysis*
