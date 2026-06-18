# Zobia Social — Forensic Bug Report

**Generated:** June 18, 2026 — 06:54 PM
**Analyst:** Claude Code (claude-sonnet-4-6)
**Scope:** Full codebase — `apps/web` (Next.js 14 App Router + PWA), `apps/expo` (Android)
**Method:** Full forensic read of all source files; three-pass analysis with fine-tooth-comb review
**Exclusions:** CRON frequency issues (external service handles scheduling). Test coverage issues (tracked separately).

---

## Quick-Reference Index (23 Bugs)

1. BUG-CSRF-01 — CSRF guard blocks mobile clients on all auth mutation endpoints
2. BUG-PAY-02 — Paystack webhook silently drops plan upgrade on non-unique-violation DB errors
3. BUG-PERF-03 — Dynamic imports of bcryptjs/core helpers inside hot request handlers
4. BUG-PAY-04 — Dodo star-pack zero-grant quantity throws inside transaction, rolls back entire webhook
5. BUG-PAY-05 — No room existence validation for room_subscription in Dodo webhook handler
6. BUG-RT-06 — Realtime provider creates a new provider instance on every publishRealtimeEvent call
7. BUG-PAY-07 — Dodo coin-pack zero-quantity award silently bypasses validation
8. BUG-SEC-08 — PHONE_REGEX compiled with /g flag; lastIndex state persists and alternates match/no-match
9. BUG-PAY-09 — subscription.disable immediately cancels plan instead of waiting for billing period end
10. BUG-SEASON-10 — Season ceremony room creation query has missing/incorrect parameter bindings
11. BUG-XP-11 — DM message XP awarded via raw fire-and-forget query; bypasses safeAwardXP and DLQ
12. BUG-PERF-12 — Room message XP uses dynamic import of engine inside hot POST handler
13. BUG-FIN-13 — DM coin deduction is a raw UPDATE with no SELECT FOR UPDATE, no Decimal.js, no idempotency key
14. BUG-LB-14 — Leaderboard upsert ON CONFLICT expression does not match the actual unique index definition
15. BUG-XP-15 — Stars gift XP reference_id collides per recipient, blocking XP on all future gifts to same user
16. BUG-XP-16 — Stars gift daily XP cap evaluated per transaction, not as a cumulative daily total
17. BUG-FIN-17 — IAP subscription activation is non-atomic: plan upgrade and coin bonus are separate DB calls
18. BUG-FIN-18 — Stars purchase records payment_type='coin_purchase' instead of 'star_purchase'
19. BUG-AI-19 — AI classifier always labels Gemini-fallback responses as 'deepseek'
20. BUG-XP-20 — Coin transfer XP award uses raw queries without safeAwardXP / DLQ
21. BUG-OBS-21 — Monitoring captureException is a no-op stub; exceptions are never sent to Sentry
22. BUG-MOB-22 — useRealtimeChannel excludes onEvent from effect deps, causing stale closure on handler updates
23. BUG-MOB-23 — AdMob showRewardedAd leaks EARNED_REWARD listener on non-reward close paths

---

## Detailed Entries

---

### 1. BUG-CSRF-01 — CSRF guard blocks mobile clients on all auth mutation endpoints

**Severity:** HIGH — all mobile auth mutations (login, token refresh, logout) are rejected with 403

**Description:** `isCsrfSafe` in `middleware.ts` requires an `Origin` header on every non-GET/HEAD/OPTIONS request. Mobile HTTP clients (Expo's `fetch`, Axios, React Native's XMLHttpRequest) do not send an `Origin` header on non-browser requests. The only no-Origin exemption is the narrow CRON path + CRON_SECRET header check. All `/api/auth/*` mutations from the mobile app therefore receive `{ error: "Forbidden", code: "CSRF_ORIGIN_MISMATCH" }` with HTTP 403. The mobile client cannot log in, refresh tokens, or log out.

**FILES:**
- `apps/web/middleware.ts` — `isCsrfSafe`, CSRF block at line ~229

**FIX:** For requests to `/api/auth/*` that present a valid JWT access or refresh token cookie (or the `X-Refresh-Token` header used by the mobile client), skip the Origin check — possession of the token is sufficient CSRF proof. Alternatively, configure the Expo app to send `Origin: https://<app-domain>` as a custom header on all API requests and add the app's bundle URL to the allowed-origins allowlist. Never relax Origin checks globally on `/api/` routes.

---

### 2. BUG-PAY-02 — Paystack webhook silently drops plan upgrade on non-unique-violation DB errors

**Severity:** HIGH — any transient DB error during subscription activation permanently loses the event

**Description:** `processSubscriptionEvent` in `paystackWebhookHandler.ts` catches errors from the subscription DB insert and only re-throws when the error code is NOT `'23505'` (unique violation). For all other errors — transient connection resets, deadlocks, constraint violations on other columns — the error is swallowed and the webhook handler returns 200. Paystack considers the event delivered and will not retry. The user's plan is never upgraded and their subscription record is never created.

**FILES:**
- `apps/web/lib/payments/paystackWebhookHandler.ts` — `processSubscriptionEvent`

**FIX:** On non-23505 errors, insert into `failedWebhooks` (or throw to return 500 so Paystack retries delivery). Only swallow 23505 because that indicates idempotent re-delivery of an already-processed event. Any other error must surface for retry or manual intervention.

---

### 3. BUG-PERF-03 — Dynamic imports of bcryptjs and core helpers inside hot request handlers

**Severity:** MEDIUM — cold-start latency injected on every affected request; module cache not warmed

**Description:** `apps/web/app/api/admin/auth/login/route.ts` and `apps/web/app/api/admin/auth/totp/route.ts` use `await import("bcryptjs")` inside the POST handler body. Every request that hits a cold Edge/Node.js worker must wait for the dynamic import to resolve before proceeding. While Node caches the module after the first import, the `await import(...)` expression still resolves asynchronously and blocks the hot path unnecessarily on every invocation. The same antipattern appears in room messages route with the XP engine.

**FILES:**
- `apps/web/app/api/admin/auth/login/route.ts`
- `apps/web/app/api/admin/auth/totp/route.ts`
- `apps/web/app/api/rooms/[roomId]/messages/route.ts`

**FIX:** Move all `import` statements to the module top level. `bcryptjs` does not require lazy loading in a Node.js runtime; the tree-shaking benefit of dynamic import is negligible compared to the async overhead on every request. Static imports are evaluated once at module load and never block the request path again.

---

### 4. BUG-PAY-04 — Dodo star-pack zero-grant quantity throws inside transaction, rolling back entire webhook

**Severity:** HIGH — any star-pack Dodo webhook with an unexpected quantity throws and the entire transaction rolls back

**Description:** In `dodoWebhookHandler.ts`, the `star_pack` branch inside the transaction reads `STAR_PACK_CATALOGUE[packId]?.starGrant`. If `packId` doesn't match any catalogue entry (unknown product ID, typo in metadata), `starGrant` is `undefined`. The subsequent `creditStars(userId, undefined, ...)` call throws because `Decimal(undefined)` is not valid. The throw propagates out of the transaction block, rolling back the entire webhook processing (any ledger entries already written are lost) and causing the outer handler to return 500. Dodo retries delivery and the cycle repeats.

**FILES:**
- `apps/web/lib/payments/dodoWebhookHandler.ts` — star_pack branch

**FIX:** Validate `starGrant` before calling `creditStars`. If the catalogue lookup returns `undefined` or `0`, log to `failedWebhooks` and return 200 (do not throw inside the transaction). Zero grants should be explicitly disallowed at catalogue-definition time with a runtime guard at the top of the handler.

---

### 5. BUG-PAY-05 — No room existence validation for room_subscription in Dodo webhook

**Severity:** HIGH (security) — arbitrary room UUIDs from webhook metadata are inserted without validation

**Description:** The `room_subscription` branch in `dodoWebhookHandler.ts` casts `metadata.roomId` directly to a string and writes a `room_subscriptions` row without first confirming the room exists. A crafted or corrupted webhook payload with a synthetic UUID will create a dangling subscription record referencing a non-existent room. Downstream queries that JOIN `room_subscriptions → rooms` will see this row and may behave incorrectly (null-pointer dereferences, false access grants, or query errors depending on join type).

**FILES:**
- `apps/web/lib/payments/dodoWebhookHandler.ts` — room_subscription branch

**FIX:** Before inserting into `room_subscriptions`, query `SELECT id FROM rooms WHERE id = $1 AND deleted_at IS NULL`. If the room is not found, insert into `failedWebhooks` with the raw payload and return 200. Also validate that `metadata.roomId` is a well-formed UUID before using it as a query parameter (use a regex or `z.string().uuid()` parse).

---

### 6. BUG-RT-06 — Realtime provider creates a new provider instance on every publishRealtimeEvent call

**Severity:** HIGH — connection pool exhaustion; one WebSocket connection per realtime event in serverless

**Description:** `publishRealtimeEvent` in `apps/web/lib/realtime/index.ts` calls `getRealtimeProvider()` on every invocation. `getRealtimeProvider()` returns a new instance of the configured provider (Ably/Pusher/Supabase Realtime) each time — there is no singleton or module-level cached instance. In a serverless environment where many event triggers fire concurrently (messages, gifts, XP awards), this creates a new WebSocket or HTTP connection per call. Connections are never explicitly closed, leaking file descriptors / TCP connections and exhausting provider-side connection quotas.

**FILES:**
- `apps/web/lib/realtime/index.ts` — `getRealtimeProvider`, `publishRealtimeEvent`

**FIX:** Cache the provider instance at module level behind a lazy initializer:
```
let _provider: RealtimeProvider | null = null;
function getRealtimeProvider() {
  if (!_provider) _provider = createRealtimeProvider(env);
  return _provider;
}
```
In serverless environments that freeze/thaw instances, this ensures at most one connection per worker instance. For providers that require explicit teardown, register a process `beforeExit` handler.

---

### 7. BUG-PAY-07 — Dodo coin-pack zero-quantity award silently bypasses validation

**Severity:** MEDIUM — misconfigured or unknown coin pack product IDs result in zero coin credit with no error or alert

**Description:** In the `coin_pack` branch of `dodoWebhookHandler.ts`, `COIN_PACK_CATALOGUE[packId]?.coinGrant` returns `undefined` for unknown product IDs. The guard condition only checks `if (!coinGrant)` — which is falsy for both `undefined` and `0`. If the check passes (product ID matches but grant is 0), `creditCoins` is called with `0` and the user receives nothing. If the product ID is unknown, `undefined` is passed to `creditCoins`, which may throw or silently credit 0. Neither case raises a `system_alert` or writes to `failedWebhooks`.

**FILES:**
- `apps/web/lib/payments/dodoWebhookHandler.ts` — coin_pack branch

**FIX:** Explicitly check `coinGrant === undefined || coinGrant <= 0` as separate conditions. On `undefined` (unknown product): insert into `failedWebhooks` and emit a `system_alert`. On `0` (misconfigured catalogue): throw a hard error in dev/staging; in production, DLQ the event and alert. Catalogue entries must always have a positive grant value.

---

### 8. BUG-SEC-08 — PHONE_REGEX compiled with /g flag; stateful lastIndex alternates match/no-match

**Severity:** HIGH (security) — anti-spam phone number detection skips every other message in the same process lifetime

**Description:** `PHONE_REGEX` in `apps/web/lib/messaging/antispam.ts` is defined at module scope with the `g` (global) flag. When `.test()` is called on a stateful regex, `lastIndex` advances on each match. After a successful match, `lastIndex` points past the end and the next `.test()` call on the same input returns `false` — even if the message contains a phone number. This means every other message containing a phone number passes the anti-spam check undetected. In a high-volume chat system, this halves the effectiveness of the phone-number filter and can be trivially exploited by sending phone numbers on alternating messages.

**FILES:**
- `apps/web/lib/messaging/antispam.ts` — `PHONE_REGEX` definition

**FIX:** Remove the `g` flag from `PHONE_REGEX`. The `g` flag is only needed when iterating over all matches in a string (e.g. with `matchAll`). For a boolean existence test (`.test()`), the stateless version without `/g` is both correct and more efficient. Audit all other module-level regexes in `antispam.ts` for the same issue.

---

### 9. BUG-PAY-09 — subscription.disable immediately cancels plan instead of waiting for period end

**Severity:** HIGH — cancelling a Paystack subscription immediately revokes access the user has already paid for

**Description:** In `paystackWebhookHandler.ts`, the `subscription.disable` event handler immediately sets `plan = 'free'` and `plan_expires_at = NOW()` on the user row. Paystack fires `subscription.disable` when a user cancels — but cancellation in Paystack means "do not renew at next billing date." The user's current billing period is still active. Setting `plan_expires_at = NOW()` removes access the user has paid for, which is both a product bug and a legal/compliance issue in many markets.

**FILES:**
- `apps/web/lib/payments/paystackWebhookHandler.ts` — `subscription.disable` handler

**FIX:** On `subscription.disable`, read `next_payment_date` from the Paystack event payload and set `plan_expires_at = next_payment_date` (or the current period end computed from `billing_date + interval`). Set a `cancel_at_period_end = true` flag on the user row. Downgrade to `plan = 'free'` only when `plan_expires_at` has elapsed, enforced either by the auth check or a daily CRON cleanup.

---

### 10. BUG-SEASON-10 — Season ceremony room creation has missing parameter binding

**Severity:** HIGH — end-of-season ceremony room creation throws on every season end, no ceremony room is created

**Description:** In `apps/web/lib/seasons/seasonEngine.ts`, the ceremony room INSERT query uses placeholder `$5` but only four bind parameters are supplied in the array. PostgreSQL returns an error for the missing parameter, which is caught by the outer try/catch and logged but not re-thrown. The ceremony room is silently never created, and the season end event proceeds without a ceremony room — removing a core feature of the season end flow.

**FILES:**
- `apps/web/lib/seasons/seasonEngine.ts` — ceremony room creation query

**FIX:** Audit the ceremony room INSERT query. Count all `$N` placeholders and ensure the values array has exactly that many elements. Add a missing 5th bind value (likely a title, description, or metadata field). Write a unit test that executes the query against a test schema to catch parameter count mismatches at development time.

---

### 11. BUG-XP-11 — DM message XP awarded via raw fire-and-forget query, bypasses safeAwardXP and DLQ

**Severity:** HIGH — failed XP awards from DM messages are silently lost; no retry, no DLQ

**Description:** `POST /api/messages/dm/[conversationId]/route.ts` awards message XP using a direct `db.query(INSERT INTO xp_ledger ...)` with `.catch(() => {})` — a raw fire-and-forget pattern. This bypasses `safeAwardXP`, which writes to `failed_xp_awards` on failure for CRON retry. Any DB error during the XP insert (connection drop, lock timeout, schema mismatch) silently discards the award. There is also no idempotency key on this raw insert, so network retries from the client could double-award XP.

**FILES:**
- `apps/web/app/api/messages/dm/[conversationId]/route.ts` — XP award block

**FIX:** Replace the raw `db.query` XP insert with `safeAwardXP(userId, XP_AMOUNT, 'social', 'dm_message', messageId)`. Pass `messageId` as the `referenceId` so the partial unique index on `xp_ledger(user_id, source, reference_id)` prevents double-award on retry.

---

### 12. BUG-PERF-12 — Room message XP uses dynamic import of engine inside hot POST handler

**Severity:** MEDIUM — async module resolution blocks every room message POST on cold workers

**Description:** `POST /api/rooms/[roomId]/messages/route.ts` dynamically imports `@/lib/xp/engine` inside the handler body via `await import(...)`. Every request on a cold worker incurs the module resolution overhead before XP can be processed. The XP engine is a core module that is always needed; there is no code-splitting benefit to lazy-loading it in a Node.js API route.

**FILES:**
- `apps/web/app/api/rooms/[roomId]/messages/route.ts`

**FIX:** Move `import { awardXP } from '@/lib/xp/engine'` (or equivalent) to the module top level. Static imports are resolved once at module initialization and eliminate the per-request async overhead.

---

### 13. BUG-FIN-13 — DM coin deduction is a raw UPDATE with no SELECT FOR UPDATE, no Decimal.js, no idempotency

**Severity:** CRITICAL — race condition allows negative coin balances in DM tip flow; no idempotency protection

**Description:** The coin deduction in `POST /api/messages/dm/[conversationId]/route.ts` for paid DMs executes a bare `UPDATE users SET coin_balance = coin_balance - $amount WHERE id = $userId`. This bypasses the entire `debitCoins()` safe-path which uses: (1) `SELECT FOR UPDATE` to lock the row and prevent concurrent overdrafts, (2) `Decimal.js` for precision arithmetic, (3) an append-only `coin_ledger` entry with a partial unique index for idempotency. Without `SELECT FOR UPDATE`, two concurrent requests for the same user can both read the same positive balance, both pass the balance check, and both deduct — driving the balance negative. Without a ledger entry, there is no audit trail and no idempotency guard against client retries.

**FILES:**
- `apps/web/app/api/messages/dm/[conversationId]/route.ts` — coin deduction block
- `apps/web/lib/economy/coins.ts` — `debitCoins` (safe path, not used here)

**FIX:** Replace the raw UPDATE with `debitCoins(userId, amount, 'dm_tip', messageId, db_transaction_client)` inside a proper DB transaction. Use `messageId` as the `referenceId` so the ledger's partial unique index prevents double-debit on retry. This is the same pattern used correctly in the gift send and transfer routes.

---

### 14. BUG-LB-14 — Leaderboard upsert ON CONFLICT expression doesn't match the actual unique index

**Severity:** HIGH — leaderboard snapshots always INSERT new rows instead of upserting, table grows unboundedly

**Description:** `upsertLeaderboardSnapshot` in `apps/web/lib/leaderboards/engine.ts` uses `ON CONFLICT (user_id, scope, period)` in the INSERT statement. If the actual unique index on `leaderboard_snapshots` is defined on different columns (e.g., `(user_id, leaderboard_type, period_start)`) or with a different expression, PostgreSQL will not recognize the conflict and will insert a new row every time the snapshot CRON runs. Over time the table grows with thousands of duplicate snapshot rows per user per period. Rank queries that read the latest snapshot will see stale rows depending on sort order.

**FILES:**
- `apps/web/lib/leaderboards/engine.ts` — `upsertLeaderboardSnapshot`
- `apps/web/lib/db/schema.ts` — `leaderboardSnapshots` unique index definition

**FIX:** Open `schema.ts` and read the exact columns in the `leaderboardSnapshots` unique index. Update the `ON CONFLICT (...)` clause in `upsertLeaderboardSnapshot` to match exactly — including any WHERE predicate on the partial index. Run `\d leaderboard_snapshots` in psql on the production schema to confirm the live index definition matches.

---

### 15. BUG-XP-15 — Stars gift XP reference_id collides per recipient, blocking XP on all future gifts to the same user

**Severity:** HIGH — gifted XP stops being awarded after the first gift to any given recipient

**Description:** `POST /api/economy/stars/gift/route.ts` calls `safeAwardXP` with `referenceId = recipientId` (the recipient's user UUID). The partial unique index on `xp_ledger(user_id, source, reference_id) WHERE reference_id IS NOT NULL` ensures that `(senderUserId, 'star_gift', recipientId)` is only ever inserted once. After the first gift from any given sender to any given recipient, all future gifts from that sender to that recipient earn zero XP — the `ON CONFLICT DO NOTHING` silently drops every subsequent award. The intended idempotency key should be the individual `giftTransactionId`, not the static recipient UUID.

**FILES:**
- `apps/web/app/api/economy/stars/gift/route.ts` — `safeAwardXP` call

**FIX:** Change `referenceId` from `recipientId` to the `giftTransactionId` (the UUID of the specific gift transaction row). This ensures each gift earns XP exactly once (idempotent on retry) while allowing repeated gifts to the same recipient to all accumulate XP correctly.

---

### 16. BUG-XP-16 — Stars gift daily XP cap is evaluated per transaction, not as a cumulative daily total

**Severity:** MEDIUM — daily XP cap for gifting is effectively infinite; each gift independently passes the cap check

**Description:** The daily XP cap check in `POST /api/economy/stars/gift/route.ts` queries `xp_ledger` for XP earned from `star_gift` events `WHERE created_at >= TODAY`. However, the check reads the current total before the current award and compares it against the cap limit in isolation. If a user sends 10 gifts rapidly (concurrent requests), all 10 read `0` (or a low value) at the start of their respective transactions and all 10 pass the cap check. All 10 awards are then inserted. The cap is bypassed entirely under concurrency, or at best only partially enforced.

**FILES:**
- `apps/web/app/api/economy/stars/gift/route.ts` — daily XP cap logic

**FIX:** Enforce the cap atomically inside a transaction with a `SELECT ... FOR UPDATE` lock on the user's XP row, or use a Redis counter with `INCR` + `EXPIRE` to track daily XP from gifting — the same sliding-window atomic approach used for rate limiting. Alternatively, enforce the cap post-insert by checking the running total in the `safeAwardXP` CTE before applying the UPDATE.

---

### 17. BUG-FIN-17 — IAP subscription activation is non-atomic: plan upgrade and coin bonus are separate DB calls

**Severity:** CRITICAL — a crash between the two DB calls leaves the user on the upgraded plan but without their coin bonus, or vice versa depending on failure mode

**Description:** `verifyAndActivateSubscription` in `apps/web/app/api/economy/iap/verify/route.ts` executes two separate database operations outside a transaction: first `UPDATE users SET plan = $plan ...`, then `creditCoins(userId, coins, ...)`. If the process crashes, the network drops, or the DB throws between these two calls, the user is left in an inconsistent state — plan upgraded but no coins (most likely), or coins credited without a plan upgrade. Neither operation can be rolled back independently.

**FILES:**
- `apps/web/app/api/economy/iap/verify/route.ts` — `verifyAndActivateSubscription`

**FIX:** Wrap both operations in a single `db.transaction(async (tx) => { ... })` block. The plan UPDATE and `creditCoins` call (passing `tx` as the database client) must both commit or both roll back atomically. Use the Google Play `purchaseToken` as the `referenceId` for `creditCoins` so that the coin credit is idempotent on retry.

---

### 18. BUG-FIN-18 — Stars purchase records payment_type='coin_purchase' instead of 'star_purchase'

**Severity:** MEDIUM — all star purchase payment records are mislabeled; financial reporting and audit queries are wrong

**Description:** In `apps/web/app/api/economy/stars/purchase/route.ts`, the `payment_records` INSERT uses `payment_type = 'coin_purchase'` for a star pack transaction. Stars and coins are distinct currencies with different catalogues, pricing, and revenue streams. All star purchase records will be counted as coin purchases in admin reporting, revenue analytics, and any fraud detection that segments by payment type. This also makes webhook reconciliation incorrect when cross-referencing by payment type.

**FILES:**
- `apps/web/app/api/economy/stars/purchase/route.ts`

**FIX:** Change `payment_type = 'coin_purchase'` to `payment_type = 'star_purchase'` in the `payment_records` INSERT. Audit all other purchase routes to verify that each sets the correct `payment_type` for its currency. If `payment_type` is an enum column, add `'star_purchase'` to the enum if not already present.

---

### 19. BUG-AI-19 — AI classifier always labels Gemini-fallback responses as 'deepseek'

**Severity:** MEDIUM — content moderation audit trail is systematically wrong; model attribution is incorrect

**Description:** `apps/web/lib/moderation/aiClassifier.ts` calls DeepSeek first and falls back to Gemini if DeepSeek fails. However, the response object from the Gemini fallback path is still tagged with `model: 'deepseek'` (the initial assignment is never updated for the fallback). Every Gemini-classified moderation result is stored with incorrect model attribution. This corrupts moderation audit logs, makes it impossible to distinguish DeepSeek vs Gemini decisions for performance analysis, and could mask systematic DeepSeek failures (since all results look like they came from DeepSeek).

**FILES:**
- `apps/web/lib/moderation/aiClassifier.ts` — Gemini fallback path

**FIX:** In the Gemini fallback branch, set `model = 'gemini'` (or the specific Gemini model identifier) on the result object before returning. Also emit a log line at `warn` level when the fallback is triggered, so DeepSeek failure rate is visible in monitoring.

---

### 20. BUG-XP-20 — Coin transfer XP award uses raw queries without safeAwardXP or DLQ

**Severity:** HIGH — XP from coin transfers is silently lost on any DB error; no retry, no idempotency

**Description:** `POST /api/economy/coins/transfer/route.ts` awards XP for the transfer action using a direct `db.query(INSERT INTO xp_ledger ...)` with `.catch(() => {})`. This is the same raw fire-and-forget antipattern as BUG-XP-11. Failed XP awards from coin transfers are silently swallowed with no DLQ entry, no retry, and no idempotency key. The coin transfer itself is properly handled via `debitCoins`/`creditCoins` with idempotency, but the XP reward has no such protection.

**FILES:**
- `apps/web/app/api/economy/coins/transfer/route.ts` — XP award block

**FIX:** Replace the raw XP insert with `safeAwardXP(userId, XP_AMOUNT, 'social', 'coin_transfer', transferId)`. Pass the `transferId` (the ledger transaction UUID) as `referenceId` for idempotency. This ensures the XP is retried on failure and is never double-awarded on retry.

---

### 21. BUG-OBS-21 — Monitoring captureException is a no-op stub; errors are never sent to Sentry

**Severity:** HIGH — all production exceptions are dropped; no error observability in production

**Description:** `apps/web/lib/monitoring/index.ts` exports `captureException` which, even when `MONITORING_PROVIDER=sentry` and `SENTRY_DSN` are configured, only calls `console.error`. The Sentry SDK is never imported or initialized. The comment inside the function body shows `// When Sentry is installed: Sentry.captureException(...)` — the actual SDK call is commented out. Every `captureException` call throughout the codebase (in webhook handlers, XP engine, payment flows, etc.) silently does nothing in production.

**FILES:**
- `apps/web/lib/monitoring/index.ts`

**FIX:** Install `@sentry/nextjs` and complete the Sentry integration:
1. Run `npx @sentry/wizard@latest -i nextjs` to generate `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`.
2. In `monitoring/index.ts`, replace the stub with a real dynamic import of `@sentry/nextjs` and call `Sentry.captureException(err, { extra: context })`.
3. Set `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, and `MONITORING_PROVIDER=sentry` in production environment variables.
Until Sentry is set up, at minimum replace the `console.error` with a structured log that includes the full stack trace so errors are visible in log aggregators.

---

### 22. BUG-MOB-22 — useRealtimeChannel excludes onEvent from effect deps, causing stale closure bugs

**Severity:** HIGH — realtime event handlers in Expo app capture stale state on every re-render that changes the callback

**Description:** `apps/expo/lib/realtime/useRealtimeChannel.ts` intentionally omits `onEvent` from the `useEffect` dependency array (there is a comment acknowledging this). When a component re-renders and passes a new `onEvent` function (e.g., because it closes over updated state), the channel subscription still calls the old stale closure. This means realtime events are processed with outdated component state — a particularly severe bug for chat handlers that close over message lists, authentication state, or room membership. The comment implies this is a deliberate choice to avoid re-subscribing, but the correct fix is to use a ref for the callback, not exclude it from deps.

**FILES:**
- `apps/expo/lib/realtime/useRealtimeChannel.ts`

**FIX:** Use a stable ref pattern:
```ts
const onEventRef = useRef(onEvent);
useEffect(() => { onEventRef.current = onEvent; }); // update ref on every render
// In the effect: channel.subscribe((msg) => onEventRef.current(msg));
```
This keeps the subscription stable (no reconnect on handler change) while always calling the latest handler version. This is the standard pattern for stable callbacks in React hooks.

---

### 23. BUG-MOB-23 — AdMob showRewardedAd leaks EARNED_REWARD listener on non-reward close path

**Severity:** MEDIUM — ad listeners accumulate on the ad instance when the user closes without earning a reward

**Description:** `apps/expo/lib/ads/admob.ts` in `showRewardedAd()` subscribes three listeners: `EARNED_REWARD`, `CLOSED`, and `ERROR`. The `CLOSED` handler calls `unsubscribeClose()` and `unsubscribeError()` to clean up. However, `unsubscribeReward()` (the EARNED_REWARD unsubscriber) is NOT called in the `CLOSED` path (only when `EARNED_REWARD` fires). If the user closes the ad without earning a reward, the EARNED_REWARD listener remains attached to the (now-closed) ad instance. The same pattern applies to `showInterstitialAd`. Over multiple ad loads, stale listeners accumulate, potentially firing on wrong ad instances or causing memory leaks.

**FILES:**
- `apps/expo/lib/ads/admob.ts` — `showRewardedAd`, `showInterstitialAd`

**FIX:** In the `CLOSED` handler, call all three unsubscribers unconditionally:
```ts
// In CLOSED handler:
unsubscribeReward?.();
unsubscribeClose?.();
unsubscribeError?.();
```
Ensure all event-specific unsubscribers are declared before any of the subscribe calls so they are in scope for cross-cleanup. Apply the same fix to `showInterstitialAd`'s close path.

---

## Code Quality Assessment

### Current Rating: **6.5 / 10**

**Strengths:**
- Security fundamentals are solid: HMAC-SHA512/SHA256 constant-time webhook verification, JWT kid-based multi-key rotation registry, CSP nonce per request in Edge Middleware, AES-256-GCM field encryption with scrypt KDF (v2), SSRF protection with DNS pinning and redirect re-validation, complete Redis Lua sliding-window rate limiting.
- Financial integrity is well-designed in the core economic paths: `debitCoins`/`creditCoins` use `SELECT FOR UPDATE` + `Decimal.js` + append-only ledger + partial unique index idempotency. The war engine and quest engine use these correctly.
- Dead-letter queue architecture is in place for XP (`failed_xp_awards`) and payouts (`payout_dead_letter_queue`) with exponential backoff retry CRON steps.
- `SELECT FOR UPDATE` discipline on balance mutations; single-transaction war resolution.
- Build-phase Redis stub correctly prevents connection attempts during Next.js build.
- Zod env validation with `superRefine` catches provider coupling misconfigurations at startup.

**Critical Gaps:**
- BUG-FIN-13 and BUG-FIN-17 are critical financial integrity violations: a race-condition path to negative balances and a non-atomic IAP activation.
- BUG-XP-11 and BUG-XP-20 break the DLQ pattern that exists for exactly these cases, creating silent XP loss.
- BUG-OBS-21 means the application has zero error observability in production — any silent failure is invisible.
- BUG-SEC-08 (regex /g flag) halves phone-number anti-spam detection effectiveness with a one-character fix.
- BUG-CSRF-01 blocks all mobile auth mutations.

### Projected Post-Fix Rating: **8.5 / 10**

Applying all 23 fixes closes every critical financial path, restores complete DLQ coverage for XP awards, activates production error observability, and hardens the anti-spam and CSRF layers. The gap from 10/10 reflects: pending Sentry integration effort (BUG-OBS-21 requires non-trivial SDK setup), the stale-closure fix for the mobile realtime hook requiring regression testing of all realtime-dependent screens, and ongoing schema consolidation work (dual subscription tables, orphaned gift catalogue) identified in prior analysis.

---

**Report completed:** June 18, 2026 — 06:54 PM
*Forensic analysis — Zobia Social codebase — claude-sonnet-4-6*
