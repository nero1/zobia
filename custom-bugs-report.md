# Zobia Social — Custom Bug Report
**Generated:** June 20, 2026 06:42 PM
**Analyst:** Deep forensic review — web app, PWA, and Expo mobile (Android)
**Status:** Pre-fix report. DO NOT apply fixes until plan is reviewed.

---

## Quick Index (one-line summaries)

1. B01-EXPO-AUTH-LOGOUT — Expo signOut() doesn't call the server logout endpoint; Redis session persists
2. B02-WEBHOOK-DODO-401 — DodoPayments webhook route returns 401 on invalid signature, triggering infinite retries
3. B03-GAME-REWARD-TX — finalizeScore awards game rewards outside the scoring transaction (partial-failure race)
4. B04-EXPO-2FA-DEEPLINK — Expo login handleDeepLink only checks for `code` param and silently drops 2FA `pre_auth_code` redirects
5. B05-SEASON-STICKER-THROW — claimPassMilestone throws when a sticker pack slug/name isn't found, permanently blocking that milestone
6. B06-PUSH-DEDUP-DEVICES — sendPushNotification (single-user path) sends one push per device token with no deduplication
7. B07-DODO-COINS-ZERO — DodoPayments: if DB returns coins_granted=0, creditCoins throws after payment is already marked 'completed'
8. B08-CSP-BROAD-CONNECT — CSP connect-src directive allows any HTTPS/WSS origin (`https: wss:`), undermining exfiltration protection
9. B09-SAFEAWARD-PHANTOM-DLQ — safeAwardXP called inside caller transactions creates phantom DLQ entries when the outer transaction rolls back
10. B10-TELEGRAM-STALE-INTERVAL — Expo login Telegram poll uses setInterval without cancelling in-flight fetch requests on unmount
11. B11-PAYSTACK-SUB-SQL — Paystack subscription.disable handler uses conditional string-interpolated SQL when setting ends_at
12. B12-REFERRAL-TX-HOT — Referral commission logic runs inside payment webhook transactions, adding DB round-trips to the hot payment path
13. B13-RATE-LIMIT-L1-DRIFT — L1 in-process rate limit cache allows ~120% of intended per-user limit across distributed serverless instances
14. B14-WAR-DRAW-REMATCH — Guild war CRON incorrectly awards a rematch token to the challenger guild when the outcome is a draw
15. B15-TRUST-DOUBLE-PENALTY — Trust score query counts warnings twice (once in warningCount, once in moderationActionCount), over-penalizing users
16. B16-MONTHLY-BONUS-STALE-BALANCE — Monthly plan coin bonus coin_ledger records can capture stale balance_before/balance_after values
17. B17-PAYOUT-APPROVE-SILENT-PASS — Admin payout approve doesn't check deleted_at and silently passes the ban check if the user row is missing
18. B18-WAR-CONTRIB-LOCK — recordWarContribution holds a FOR UPDATE row lock on the guild_wars row for every message/gift during active wars
19. B19-IAP-SUB-ACK-FIRE-FORGET — Google Play subscription acknowledgment fetch is not awaited; unacknowledged subscriptions auto-cancel after 3 days

---

## Detailed Bug Entries

---

### 1. B01-EXPO-AUTH-LOGOUT
**Name:** Expo signOut() doesn't call server logout endpoint
**FILES:** `apps/expo/lib/auth/context.tsx`

**FIX:** The `signOut()` function in the Expo auth context clears the SecureStore tokens and updates local state, but never calls `POST /api/auth/logout`. The user's refresh token and session record remain live in Redis indefinitely (until natural TTL expiry, which can be days). An attacker who obtains the refresh token after signout can silently regain an access token. Before clearing SecureStore, issue an authenticated call to `/api/auth/logout` using the current access token. Make the call best-effort (don't block signout on network failure) so a dead session still clears local state, but always attempt it when a token is present.

---

### 2. B02-WEBHOOK-DODO-401
**Name:** DodoPayments webhook returns 401 on invalid HMAC signature
**FILES:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

**FIX:** When the HMAC-SHA256 signature check fails, this route returns HTTP 401. DodoPayments (like most payment processors) interprets non-200 responses as transient failures and retries the webhook indefinitely. This causes an infinite retry loop for any permanently malformed or tampered request. The Paystack webhook handler in the same codebase correctly returns 200 on invalid signature. Apply the same pattern here: log the signature mismatch, return HTTP 200 with `{ received: true }`, and do not process the payload. Reserve HTTP 500 for genuine processing failures that warrant a retry.

---

### 3. B03-GAME-REWARD-TX
**Name:** finalizeScore awards game rewards outside the scoring transaction
**FILES:** `apps/web/lib/games/sessions.ts`

**FIX:** `finalizeScore` marks the game_play row as counted inside a transaction (verifying nonce, min play time, score bounds), then calls `grantGamingReward` after the transaction commits. If the process crashes or a timeout fires between the commit and the reward grant, the play is permanently counted but the reward is never issued. Move the reward grant inside the same transaction (ensuring it is idempotent via a reference key on game_play id), or use the existing DLQ pattern: record the reward intent before the transaction commits and complete it after. Either approach eliminates the partial-failure window.

---

### 4. B04-EXPO-2FA-DEEPLINK
**Name:** Expo login handleDeepLink ignores pre_auth_code parameter
**FILES:** `apps/expo/app/auth/login.tsx`

**FIX:** The `handleDeepLink` function checks for a `code` query param (standard OAuth callback) but does not check for `pre_auth_code` (the param issued when the server requires 2FA). If a user with 2FA enabled logs in via Google on mobile, the server redirects with `pre_auth_code=...` instead of `code=...`. The mobile app's deep link handler ignores this, the login stalls silently, and the user is never prompted for their second factor. Add a branch in `handleDeepLink` that detects `pre_auth_code`, stores it, and navigates to the 2FA entry screen — mirroring the logic that already handles `code`.

---

### 5. B05-SEASON-STICKER-THROW
**Name:** claimPassMilestone throws on missing sticker pack, permanently blocking the milestone
**FILES:** `apps/web/lib/seasons/seasonEngine.ts`

**FIX:** When a milestone's `reward_type` is `sticker_pack`, the code queries for the pack by slug or name and throws an error if not found. Because the throw is inside the DB transaction that holds the FOR UPDATE claim lock, the transaction rolls back. On subsequent retries the same query fails identically — the milestone is permanently unclaimable for all users until the missing pack is manually inserted. Replace the throw with a graceful fallback: log a system_alert, skip the sticker grant, and commit the milestone as claimed so the user isn't blocked. A missing pack is an operator configuration error and should not punish the user.

---

### 6. B06-PUSH-DEDUP-DEVICES
**Name:** sendPushNotification (single-user path) sends duplicates to multi-device users
**FILES:** `apps/web/lib/notifications/push.ts`

**FIX:** The `sendPushNotification` function fetches all push tokens for a user and sends a notification to every token without deduplication. A user with three registered devices receives three identical pushes for the same event. The batch variant `sendPushNotificationBatch` already deduplicates by userId correctly. Apply the same deduplication in `sendPushNotification`: send to at most one token per device_id (preferring the most recently active), or adopt the user-level grouping from the batch function so only one push goes out per user regardless of device count.

---

### 7. B07-DODO-COINS-ZERO
**Name:** DodoPayments: zero coins_granted from DB causes creditCoins to throw after payment is already marked completed
**FILES:** `apps/web/lib/payments/dodoWebhookHandler.ts`

**FIX:** When `grantResolvedFromDb=true` and the store item row returns `coins_granted = 0` (misconfigured item, zero-coin pack, or deleted product), `creditCoins` is called with `amount=0`. The `creditCoins` implementation requires a positive integer and throws. By this point the payment record has already been updated to `status = 'completed'` in the same transaction. Check `coins_granted > 0` before calling `creditCoins`. If zero, write to `failed_webhooks` for admin review and return without throwing, allowing the payment status to commit cleanly rather than leaving the record in a partial state.

---

### 8. B08-CSP-BROAD-CONNECT
**Name:** CSP connect-src allows any HTTPS/WSS origin
**FILES:** `apps/web/middleware.ts`

**FIX:** The `buildCsp` function sets `connect-src 'self' https: wss:`. The wildcard `https:` allows any HTTPS fetch/XHR target, and `wss:` allows any WebSocket origin. This means any injected script or XSS vector can exfiltrate data to arbitrary external servers without violating the policy. Replace with explicit allowlists: the app's own origin, the Paystack API host, the DodoPayments API host, the Expo push endpoint, and your WebSocket server host. Use `wss://your-ws-domain.com` instead of `wss:` to restrict real-time connections to known endpoints.

---

### 9. B09-SAFEAWARD-PHANTOM-DLQ
**Name:** safeAwardXP inside caller transactions creates phantom DLQ entries on rollback
**FILES:** `apps/web/lib/xp/safeAwardXP.ts`, `apps/web/lib/quests/questEngine.ts`, `apps/web/lib/guilds/warEngine.ts`

**FIX:** When `safeAwardXP` is called with a caller's `TransactionClient` and the outer transaction subsequently rolls back, the XP award never happened. But `safeAwardXP`'s error handler writes to `failed_xp_awards` using `globalDb` (outside the rolled-back transaction), creating a DLQ entry for XP that was never owed. The CRON retries these phantom entries but valid `reference_id` guards prevent actual double-awards. Still, phantom rows accumulate and consume retry budget. The fix is stated in `safeAwardXP.ts`'s own JSDoc: only call `safeAwardXP` after the outer transaction has committed. In `questEngine` and `warEngine`, restructure so XP awards are issued post-commit using `globalDb` rather than a transaction client.

---

### 10. B10-TELEGRAM-STALE-INTERVAL
**Name:** Expo Telegram poll setInterval not cleaned up on unmount
**FILES:** `apps/expo/app/auth/login.tsx`

**FIX:** The Telegram login polling loop uses `setInterval` (30 × 2s) and stores the interval ID for cleanup. However, the in-flight API calls inside each tick are not cancelled. If the component unmounts while a tick is in progress (user navigates away), the response callback runs on a dead component, calling setState and potentially triggering a navigation side-effect. Add a cancellation flag (`let cancelled = false`) set in the cleanup, and guard all post-await state mutations and navigations with `if (cancelled) return`. This is a standard unmount-safety pattern and prevents the React "update on unmounted component" warning and silent stale navigations.

---

### 11. B11-PAYSTACK-SUB-SQL
**Name:** Paystack subscription.disable uses conditional string-interpolated SQL
**FILES:** `apps/web/lib/payments/paystackWebhookHandler.ts`

**FIX:** The `subscription.disable` event handler builds the UPDATE query using template literal string interpolation to conditionally include `ends_at = $2,` in the SET clause. This makes the parameter binding position-dependent on a runtime condition, which is fragile: a maintenance change that adds or reorders parameters in either branch risks silently binding the wrong value to the wrong column. Replace with a fixed-shape query that always includes `ends_at = $2` (passing `null` when no cancellation date is available). Fixed column order is far safer and easier to audit than conditional parameter lists.

---

### 12. B12-REFERRAL-TX-HOT
**Name:** Referral commissions run inside payment webhook transactions
**FILES:** `apps/web/lib/referrals/commissions.ts`

**FIX:** `awardReferralCommissions` is called from inside the payment webhook DB transaction in both `paystackWebhookHandler` and `dodoWebhookHandler`. It executes up to 4 additional DB queries (referral lookup, qualify update, tier-1 coin credit, tier-2 coin credit) within the hot-path webhook transaction. This extends the transaction hold time and increases lock contention on what should be a fast payment commit. Referral commissions are not part of the atomic payment event — they are a side-effect of the first purchase. Move the call to after the transaction commits, ideally using the existing DLQ/fire-and-forget pattern already in place for XP awards.

---

### 13. B13-RATE-LIMIT-L1-DRIFT
**Name:** L1 in-process rate limit cache allows ~120% of intended limit
**FILES:** `apps/web/lib/security/rateLimit.ts`

**FIX:** The sliding-window rate limiter uses an L1 in-process skip cache with a 2s TTL. When a key is near the limit (≥40% of the limit), the L1 cache marks it as blocked for 2s. However, across N concurrently active serverless instances, each instance independently maintains L1 state. A burst can be distributed across instances to bypass the per-instance block, reaching roughly 120% of the intended limit. This is a documented design trade-off in the code. For endpoints where the exact limit is a hard security boundary (coin withdrawals, gift sending), disable L1 caching by setting `bypassL1: true`. Lower-stakes endpoints can tolerate the 120% drift.

---

### 14. B14-WAR-DRAW-REMATCH
**Name:** Guild war CRON awards rematch token to challenger guild on draw
**FILES:** `apps/web/app/api/cron/guild-wars/route.ts`

**FIX:** In the war resolution step, after calling `resolveWar`, the CRON computes the "loser" for the rematch token:
```
const loserGuildId = result.winnerGuildId === war.challenger_guild_id
  ? war.defender_guild_id
  : war.challenger_guild_id;
```
When the outcome is a draw, `result.winnerGuildId` is `null`. The condition `null === war.challenger_guild_id` is false, so the else branch fires and `loserGuildId` becomes `war.challenger_guild_id`. The challenger gets a rematch token even though nobody lost. Check `result.outcome` before the rematch token logic: if `outcome === 'draw'`, skip the token or award one to both guilds per PRD preference.

---

### 15. B15-TRUST-DOUBLE-PENALTY
**Name:** Trust score double-penalizes users for warnings
**FILES:** `apps/web/lib/trust/trustScore.ts`

**FIX:** `calculateTrustScore` fetches `warning_count` (WHERE action_type = 'warn') and `moderation_action_count` (ALL moderation actions, no type filter). The `computeScore` function applies -10 pts per warning AND -5 pts per moderation action. Because warnings are a subset of all moderation actions, one warning causes a -15 pt penalty instead of the presumably intended -10 pts. The same bug exists in `batchCalculateTrustScores`. Fix by excluding `action_type = 'warn'` from the `moderation_action_count` subquery so that warnings are only counted once through the explicit warning penalty.

---

### 16. B16-MONTHLY-BONUS-STALE-BALANCE
**Name:** Monthly plan bonus coin_ledger records capture stale balances
**FILES:** `apps/web/app/api/cron/daily-economy/route.ts`

**FIX:** The monthly plan coin bonus CTE reads `coin_balance` from the `eligible` users CTE at SELECT time and uses it as `balance_before`/`balance_after` in the coin_ledger INSERT. If concurrent coin transactions modify a user's balance between when the CTE runs and when the INSERT executes, the ledger row captures stale balance values. The coin balance itself is updated correctly via `coin_balance + $2`, but the audit fields in the ledger are inaccurate. To fix, wrap the users SELECT and coin_ledger INSERT in a single transaction with `FOR UPDATE` on the user rows, so the balance read and write are atomic.

---

### 17. B17-PAYOUT-APPROVE-SILENT-PASS
**Name:** Admin payout approve silently passes ban check when user row is missing
**FILES:** `apps/web/app/api/admin/payouts/[payoutId]/approve/route.ts`

**FIX:** The route queries `SELECT is_banned FROM users WHERE id = $1` without `AND deleted_at IS NULL`. If the creator has been soft-deleted or the row is missing, `userRows[0]` is undefined. The check `userRows[0]?.is_banned` evaluates to `undefined` (falsy), so the guard is skipped and the payout is approved for a non-existent user. Add `AND deleted_at IS NULL` to the query and throw a `badRequest` if no row is returned, treating a missing user as a non-approvable state.

---

### 18. B18-WAR-CONTRIB-LOCK
**Name:** recordWarContribution FOR UPDATE lock on guild_wars causes contention under load
**FILES:** `apps/web/lib/guilds/recordWarContribution.ts`

**FIX:** Every message sent, gift given, or quest completed during an active war calls `recordWarContribution`, which takes a `FOR UPDATE OF gw` lock on the guild_wars row. All members of both guilds serialise through this lock for the duration of their contribution transaction. During peak war activity (many members sending messages simultaneously), this creates row-level lock contention and measurable latency spikes. Consider removing the `FOR UPDATE` lock and instead relying on the `UPDATE guild_wars SET challenger_points = challenger_points + $1` statement's inherent row lock at write time (which is very short). The `ON CONFLICT (war_id, user_id) DO UPDATE` on `war_contributions` already handles concurrent inserts safely without a read lock.

---

### 19. B19-IAP-SUB-ACK-FIRE-FORGET
**Name:** Google Play subscription acknowledgment is fire-and-forget; subscription auto-cancels after 3 days
**FILES:** `apps/web/app/api/economy/iap/verify/route.ts`

**FIX:** After verifying a subscription and activating the user's plan, the code fires the Google Play acknowledgment as `fetch(ackUrl, ...).catch(...).finally(...)` without `await`. On Vercel's serverless runtime, function execution terminates when the HTTP response is sent. If the runtime exits before the fire-and-forget fetch completes, Google never receives the ack. Per Google policy, unacknowledged subscriptions are auto-cancelled after 3 days, creating a subscription that is live in the DB but cancelled at Google's end. Change the acknowledgment call to `await fetch(ackUrl, ...)` so it completes before the response is returned to the client. Non-critical acknowledgment failures can be caught and logged without failing the subscription activation.

---

## Code Quality Assessment

### Current Rating: 7.5 / 10

**Strengths:**
The codebase has a solid security foundation: HMAC-SHA512/256 webhook verification, CSRF origin validation at edge middleware, CSP nonces with `strict-dynamic`, scrypt KDF for field encryption with key rotation, kid-based JWT multi-key rotation, and server-authoritative grant amounts preventing metadata tampering in payment handlers. Financial correctness is generally strong: append-only coin ledger with SELECT FOR UPDATE, idempotent CTE-based XP awards, DLQ for failed XP and payouts, and ON CONFLICT DO NOTHING throughout. The Redis-backed rate limiting with Lua atomic scripts, the distributed circuit breaker pattern, and the offline message queue with IndexedDB crash recovery are all well-implemented. Trust scoring, fraud detection, and leaderboard materialisation at write time are thoughtful features.

**Weaknesses that explain the 7.5:**
Several financial/correctness gaps sit on critical paths (B03 game reward race, B07 DodoPayments zero-coins, B19 IAP ack). The mobile platform is undertested with two meaningful auth issues (B01 session leak after signout, B04 2FA deeplink) and a Telegram poll lifecycle bug. The trust scoring algorithm has a double-penalty logic error (B15). The CSP connect-src is too permissive for a platform of this size (B08). DLQ phantom entries from B09 represent a design smell that will complicate future debugging.

### Projected Rating After All Fixes: 8.7 / 10

Resolving B01, B03, B04, B07, B08, B15, and B19 eliminates the highest-impact correctness and security gaps. Fixing B02, B05, B14, B17 closes correctness edge cases with low implementation effort. Addressing B09, B11, B12, and B18 improves structural quality and long-term maintainability. The remaining delta to a 10/10 reflects inherent distributed-system trade-offs (B13 rate limit drift is acceptable) and the architectural refactor required to fully solve B09.

---

*Report footer: June 20, 2026 06:42 PM*
*Zobia Social — Custom forensic analysis. Do not apply fixes without approval.*
