# Zobia Social — Bug Fix Plan

**Generated:** June 18, 2026 — 06:54 PM
**Based on:** custom-bugs-report.md (23 bugs identified)
**Instruction:** DO NOT begin any fix until this plan has been reviewed and approved.

---

## Priority Tiers

| Tier | Label | Criteria |
|------|-------|----------|
| P0 | CRITICAL | Financial integrity, security exploit, or complete feature breakage |
| P1 | HIGH | Data loss, significant UX breakage, or security hardening |
| P2 | MEDIUM | Reliability, correctness, audit quality |
| P3 | LOW | Performance, minor observability gaps |

---

## Execution Order (recommended)

Fix P0 bugs first in a single focused release. Deploy and verify on staging before touching P1. P2 and P3 can be batched.

---

## P0 — CRITICAL (Fix First)

---

### Fix #1 — BUG-FIN-13: DM coin deduction race condition

**Risk:** Users can reach negative coin balances through concurrent DM tip requests.

**Files to change:**
- `apps/web/app/api/messages/dm/[conversationId]/route.ts`

**Steps:**
1. Wrap the coin deduction section in a `db.transaction(async (tx) => { ... })` block.
2. Replace the raw `UPDATE users SET coin_balance = coin_balance - $amount` with a call to `debitCoins(userId, amount, 'dm_tip', messageId, tx)`.
3. Pass `messageId` (the UUID of the just-inserted message) as the `referenceId` parameter — this ensures the coin_ledger partial unique index prevents double-debit on client retry.
4. Move the recipient credit (`creditCoins`) into the same transaction block so the debit and credit are atomic.
5. Remove the raw balance query that checks the balance pre-deduction — `debitCoins` handles insufficient-balance errors internally by throwing, which will roll back the transaction.

---

### Fix #2 — BUG-FIN-17: IAP subscription activation non-atomic

**Risk:** Crash between plan upgrade and coin credit leaves user in inconsistent state.

**Files to change:**
- `apps/web/app/api/economy/iap/verify/route.ts`

**Steps:**
1. Locate the `verifyAndActivateSubscription` function (lines ~335-349).
2. Wrap the `UPDATE users SET plan = ...` and `creditCoins(...)` calls in a single `db.transaction(async (tx) => { ... })` block.
3. Pass `tx` as the `dbClient` argument to `creditCoins`.
4. Use the Google Play `purchaseToken` as the `referenceId` for `creditCoins` so the coin credit is idempotent on retry.
5. Ensure the transaction is committed before returning the success response to the client.

---

### Fix #3 — BUG-CSRF-01: CSRF guard blocks mobile clients

**Risk:** All Expo mobile app auth mutations (login, token refresh, logout) receive HTTP 403.

**Files to change:**
- `apps/web/middleware.ts`

**Steps:**
1. In `isCsrfSafe`, add an exemption for requests that carry a valid `X-Refresh-Token` header (used by the mobile client on the refresh endpoint) — these are already authenticated and CSRF-safe.
2. Alternatively (cleaner approach): in the Expo app, add `Origin: https://<NEXT_PUBLIC_APP_URL>` as a default header to all outbound API requests. Then add `NEXT_PUBLIC_APP_URL` to the allowed origins in `isCsrfSafe` (it's already checked: `origin === appUrl`). This requires no middleware change and correctly classifies mobile requests as same-origin.
3. Recommended: use option 2. In `apps/expo/lib/api/client.ts` (or equivalent Axios/fetch wrapper), set `headers: { Origin: process.env.EXPO_PUBLIC_APP_URL }` on all requests.
4. Test by running the mobile app against staging and verifying login, refresh, and logout all succeed.

---

## P1 — HIGH (Fix in Next Release)

---

### Fix #4 — BUG-XP-11: DM message XP bypasses safeAwardXP

**Files to change:**
- `apps/web/app/api/messages/dm/[conversationId]/route.ts`

**Steps:**
1. Remove the raw `db.query(INSERT INTO xp_ledger ...)` call.
2. Replace with `await safeAwardXP(userId, XP_AMOUNT, 'social', 'dm_message', messageId)`.
3. Import `safeAwardXP` from `@/lib/xp/safeAwardXP` at the top of the file.
4. The `messageId` must be the UUID of the inserted message (available from the INSERT RETURNING clause).
5. Verify `XP_AMOUNT` matches the value defined in `XP_VALUES` in `lib/xp/engine.ts` for the `dm_message` source.

---

### Fix #5 — BUG-XP-20: Coin transfer XP bypasses safeAwardXP

**Files to change:**
- `apps/web/app/api/economy/coins/transfer/route.ts`

**Steps:**
1. Remove the raw XP `db.query` with `.catch(() => {})`.
2. Replace with `await safeAwardXP(userId, XP_AMOUNT, 'social', 'coin_transfer', transferId)`.
3. Use the `transferId` (the ledger transaction UUID from `debitCoins`/`creditCoins` RETURNING) as `referenceId`.
4. Import `safeAwardXP` at the top of the file.

---

### Fix #6 — BUG-PAY-02: Paystack webhook swallows non-23505 errors

**Files to change:**
- `apps/web/lib/payments/paystackWebhookHandler.ts`

**Steps:**
1. In `processSubscriptionEvent`, locate the catch block that checks `err.code === '23505'`.
2. For any error where `err.code !== '23505'`, instead of silently returning, insert a row into `failedWebhooks` with the raw event payload, error message, and timestamp. Then throw (or return 500) so Paystack knows to retry.
3. For `23505` (duplicate key = already processed), continue returning 200 — this is correct idempotent behavior.

---

### Fix #7 — BUG-PAY-04: Dodo star-pack undefined starGrant throws in transaction

**Files to change:**
- `apps/web/lib/payments/dodoWebhookHandler.ts`

**Steps:**
1. At the top of the `star_pack` branch, add: `const starGrant = STAR_PACK_CATALOGUE[packId]?.starGrant; if (!starGrant || starGrant <= 0) { /* log to failedWebhooks, return 200 */ return; }`.
2. Only proceed to `creditStars` when `starGrant` is a positive number.
3. Emit a `system_alert` when the product ID is unrecognized (missing catalogue entry) so it's visible in the admin panel.

---

### Fix #8 — BUG-PAY-05: No room validation in Dodo room_subscription webhook

**Files to change:**
- `apps/web/lib/payments/dodoWebhookHandler.ts`

**Steps:**
1. Before the `room_subscriptions` INSERT, validate `metadata.roomId` is a well-formed UUID using `z.string().uuid().safeParse(metadata.roomId)`.
2. Query `SELECT id FROM rooms WHERE id = $1 AND deleted_at IS NULL` with the parsed UUID.
3. If the room is not found, insert into `failedWebhooks` with the event payload and return 200 (no retry needed — the room genuinely doesn't exist).
4. Only proceed to the INSERT when the room is confirmed to exist.

---

### Fix #9 — BUG-PAY-09: subscription.disable immediately cancels plan

**Files to change:**
- `apps/web/lib/payments/paystackWebhookHandler.ts`

**Steps:**
1. In the `subscription.disable` handler, read `data.next_payment_date` from the Paystack event payload (this is the end of the current billing period).
2. Set `plan_expires_at = data.next_payment_date` and `cancel_at_period_end = TRUE` on the users row. Do NOT set `plan = 'free'` yet.
3. Add a column `cancel_at_period_end boolean DEFAULT FALSE` to the `users` table if it doesn't exist.
4. In the daily CRON (or the auth middleware plan check), add a step that downgrades users where `cancel_at_period_end = TRUE AND plan_expires_at < NOW()` to `plan = 'free'`.
5. Test by simulating a cancellation and confirming the user retains plan access until `plan_expires_at`.

---

### Fix #10 — BUG-RT-06: Realtime provider creates new instance per event

**Files to change:**
- `apps/web/lib/realtime/index.ts`

**Steps:**
1. Move the provider instantiation outside `publishRealtimeEvent` to module scope.
2. Use a lazy singleton: declare `let _provider: RealtimeProvider | null = null` at module scope.
3. In `getRealtimeProvider()`, check `if (!_provider) _provider = createRealtimeProvider(env)` before returning.
4. Remove any provider instantiation from inside `publishRealtimeEvent`.
5. If the provider has a health check or reconnect API, call it in `publishRealtimeEvent` before publishing to handle stale connections gracefully.

---

### Fix #11 — BUG-SEC-08: PHONE_REGEX /g flag stateful lastIndex

**Files to change:**
- `apps/web/lib/messaging/antispam.ts`

**Steps:**
1. Find the `PHONE_REGEX` constant definition.
2. Remove the `g` flag from the regex literal. Change `/pattern/gi` to `/pattern/i` (keep `i` for case-insensitivity if present; remove only `g`).
3. Audit all other module-scope regex constants in `antispam.ts` for the same `/g` flag misuse with `.test()`.
4. If any regex genuinely needs `g` for `matchAll` iteration, document it with a comment and ensure it is NOT called with `.test()`.
5. Add a regression test: call `PHONE_REGEX.test(phoneString)` twice in a row and assert both return `true`.

---

### Fix #12 — BUG-XP-15: Stars gift XP reference_id collides per recipient

**Files to change:**
- `apps/web/app/api/economy/stars/gift/route.ts`

**Steps:**
1. Find the `safeAwardXP` call that passes `recipientId` as the `referenceId`.
2. Change `referenceId` to `giftTransactionId` — the UUID of the newly inserted gift transaction row (available from the gift INSERT RETURNING clause).
3. Confirm `giftTransactionId` is unique per gift (it should be the primary key of the transaction row).
4. Test by sending two gifts from the same sender to the same recipient and verifying both earn XP.

---

### Fix #13 — BUG-XP-16: Stars gift daily XP cap is non-atomic

**Files to change:**
- `apps/web/app/api/economy/stars/gift/route.ts`

**Steps:**
1. Replace the current read-then-check pattern with a Redis counter approach.
2. Use a Redis key `xp_daily:star_gift:<userId>:<YYYYMMDD>` with `INCR` + `EXPIRE` (set to end of day).
3. Before calling `safeAwardXP`, atomically increment the counter and check if the returned value exceeds the daily cap.
4. If over cap, skip the `safeAwardXP` call and return a user-facing message indicating the daily XP cap has been reached.
5. If Redis is unavailable (circuit breaker open), default to allowing the XP (fail open) to avoid blocking gifts.

---

### Fix #14 — BUG-SEASON-10: Season ceremony room missing parameter binding

**Files to change:**
- `apps/web/lib/seasons/seasonEngine.ts`

**Steps:**
1. Find the ceremony room INSERT query.
2. Count all `$1`, `$2`, ... `$N` placeholders in the query string.
3. Count the elements in the values array passed as the second argument to `db.query`.
4. If they don't match, identify the missing value (likely a room title, type, or metadata field derived from the season config) and add it to the values array at the correct position.
5. Add a dev-mode assertion or unit test that verifies placeholder count matches values count for all critical queries.

---

### Fix #15 — BUG-LB-14: Leaderboard upsert ON CONFLICT mismatch

**Files to change:**
- `apps/web/lib/leaderboards/engine.ts`
- `apps/web/lib/db/schema.ts`

**Steps:**
1. Open `schema.ts` and read the exact column list and WHERE predicate of the unique index on `leaderboard_snapshots`.
2. Update the `ON CONFLICT (...)` clause in `upsertLeaderboardSnapshot` to exactly match — including any partial index WHERE predicate.
3. If no unique index exists on `leaderboard_snapshots`, add one in a new migration: `CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_snapshots_user_scope_period_uidx ON leaderboard_snapshots (user_id, scope, period)` (adjust columns to match actual usage).
4. Verify by running the upsert twice with the same inputs and confirming only one row exists afterwards.

---

### Fix #16 — BUG-OBS-21: Monitoring captureException is a no-op stub

**Files to change:**
- `apps/web/lib/monitoring/index.ts`
- `apps/web/sentry.client.config.ts` (new)
- `apps/web/sentry.server.config.ts` (new)
- `apps/web/sentry.edge.config.ts` (new)
- `apps/web/next.config.ts` (Sentry webpack plugin)

**Steps:**
1. Install `@sentry/nextjs`: `pnpm add @sentry/nextjs`.
2. Run `npx @sentry/wizard@latest -i nextjs` to generate the Sentry config files.
3. In `lib/monitoring/index.ts`, replace the stub:
   ```ts
   import * as Sentry from '@sentry/nextjs';
   export function captureException(err: unknown, context?: Record<string, unknown>) {
     Sentry.captureException(err, { extra: context });
   }
   ```
4. Set environment variables: `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `MONITORING_PROVIDER=sentry`.
5. Test by deliberately throwing in a route handler and verifying the event appears in the Sentry dashboard.

---

### Fix #17 — BUG-MOB-22: useRealtimeChannel stale closure on onEvent

**Files to change:**
- `apps/expo/lib/realtime/useRealtimeChannel.ts`

**Steps:**
1. Add `const onEventRef = useRef(onEvent)` inside the hook.
2. Add `useEffect(() => { onEventRef.current = onEvent; });` (no dependency array — updates the ref on every render).
3. In the channel subscription effect, replace `onEvent(msg)` with `onEventRef.current(msg)`.
4. Remove the `// eslint-disable-next-line react-hooks/exhaustive-deps` comment suppressing the deps warning (the underlying issue is now fixed correctly).
5. Test by updating a handler that closes over state (e.g., a message list) and verifying the latest state is always used.

---

## P2 — MEDIUM

---

### Fix #18 — BUG-PAY-07: Dodo coin-pack zero/undefined coinGrant

**Files to change:**
- `apps/web/lib/payments/dodoWebhookHandler.ts`

**Steps:**
1. Add an explicit guard: `if (coinGrant === undefined || coinGrant <= 0)` emit `system_alert`, insert `failedWebhooks`, return 200.
2. Never pass `undefined` or `0` to `creditCoins`.

---

### Fix #19 — BUG-FIN-18: Stars purchase records wrong payment_type

**Files to change:**
- `apps/web/app/api/economy/stars/purchase/route.ts`

**Steps:**
1. Find the `payment_records` INSERT.
2. Change `payment_type = 'coin_purchase'` to `payment_type = 'star_purchase'`.
3. If `payment_type` is a DB enum, add `'star_purchase'` to the enum in a migration.
4. Write a data migration to backfill existing star purchase records with the correct type.

---

### Fix #20 — BUG-AI-19: AI classifier mislabels Gemini responses as deepseek

**Files to change:**
- `apps/web/lib/moderation/aiClassifier.ts`

**Steps:**
1. Find the Gemini fallback branch.
2. After receiving a successful Gemini response, set `result.model = 'gemini'` (or the specific model ID, e.g. `'gemini-1.5-flash'`).
3. Add a `logger.warn('aiClassifier: DeepSeek failed, fell back to Gemini')` log at the start of the fallback branch.
4. Confirm the model field is persisted in the moderation action record so it's visible in the admin audit log.

---

### Fix #21 — BUG-MOB-23: AdMob listener leak on non-reward close

**Files to change:**
- `apps/expo/lib/ads/admob.ts`

**Steps:**
1. In `showRewardedAd`, add `unsubscribeReward?.()` inside the CLOSED handler before resolving/rejecting the promise.
2. In `showInterstitialAd`, apply the same pattern — call all unsubscribers in the CLOSED and ERROR handlers.
3. Structure the unsubscriber declarations before the first `addAdEventListener` call so all are in scope for cross-cleanup.

---

## P3 — LOW / PERFORMANCE

---

### Fix #22 — BUG-PERF-03: Dynamic imports in hot request handlers

**Files to change:**
- `apps/web/app/api/admin/auth/login/route.ts`
- `apps/web/app/api/admin/auth/totp/route.ts`
- `apps/web/app/api/rooms/[roomId]/messages/route.ts`

**Steps:**
1. Move `await import("bcryptjs")` to a static top-level import in each affected file.
2. Move `await import("@/lib/xp/engine")` (or equivalent) to a static import in the room messages route.
3. Verify no circular dependency is introduced by the promotion to static import.

---

### Fix #23 — BUG-PERF-12: Room message XP dynamic import

**Covered by Fix #22 above.** No separate steps needed.

---

## Summary Table

| # | Bug ID | Priority | Affected File(s) | Effort |
|---|--------|----------|-----------------|--------|
| 1 | BUG-FIN-13 | P0 | dm/route.ts | Medium |
| 2 | BUG-FIN-17 | P0 | iap/verify/route.ts | Small |
| 3 | BUG-CSRF-01 | P0 | middleware.ts / expo client | Small |
| 4 | BUG-XP-11 | P1 | dm/route.ts | Small |
| 5 | BUG-XP-20 | P1 | coins/transfer/route.ts | Small |
| 6 | BUG-PAY-02 | P1 | paystackWebhookHandler.ts | Small |
| 7 | BUG-PAY-04 | P1 | dodoWebhookHandler.ts | Small |
| 8 | BUG-PAY-05 | P1 | dodoWebhookHandler.ts | Small |
| 9 | BUG-PAY-09 | P1 | paystackWebhookHandler.ts | Medium |
| 10 | BUG-RT-06 | P1 | realtime/index.ts | Small |
| 11 | BUG-SEC-08 | P1 | messaging/antispam.ts | Trivial |
| 12 | BUG-XP-15 | P1 | stars/gift/route.ts | Trivial |
| 13 | BUG-XP-16 | P1 | stars/gift/route.ts | Medium |
| 14 | BUG-SEASON-10 | P1 | seasonEngine.ts | Small |
| 15 | BUG-LB-14 | P1 | leaderboards/engine.ts | Small |
| 16 | BUG-OBS-21 | P1 | monitoring/index.ts | Large |
| 17 | BUG-MOB-22 | P1 | useRealtimeChannel.ts | Small |
| 18 | BUG-PAY-07 | P2 | dodoWebhookHandler.ts | Small |
| 19 | BUG-FIN-18 | P2 | stars/purchase/route.ts | Trivial |
| 20 | BUG-AI-19 | P2 | aiClassifier.ts | Trivial |
| 21 | BUG-MOB-23 | P2 | admob.ts | Small |
| 22 | BUG-PERF-03 | P3 | admin/auth routes, rooms/messages | Trivial |
| 23 | BUG-PERF-12 | P3 | rooms/messages/route.ts | Trivial |

**Effort key:** Trivial = < 15 min · Small = 15–60 min · Medium = 1–3 hrs · Large = 3–8 hrs

---

**Plan completed:** June 18, 2026 — 06:54 PM
*Zobia Social — Bug Fix Plan — claude-sonnet-4-6*
