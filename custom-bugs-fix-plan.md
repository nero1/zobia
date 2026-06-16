# Zobia Codebase — Bug Fix Plan

**Generated:** Monday, June 15, 2026 11:31 PM UTC  
**Based on:** custom-bugs-report.md (same date)  
**Note:** Do NOT begin any fix until the report has been reviewed and confirmed.

---

## Fix Priority Tiers

- **P0 — Critical (fix before next deploy)**
- **P1 — High (fix within current sprint)**
- **P2 — Medium (fix this quarter)**
- **P3 — Low / Maintainability (batch with other cleanup)**

---

## P0 — Critical: Fix Before Next Deploy

### Fix 1 · CRON-PAYOUT-01 — Add missing NOT NULL columns to weekly payout INSERT

**Files to change:** `apps/web/app/api/cron/daily/route.ts` (step 32)

**Steps:**
1. In the INSERT into `creator_payouts`, add `amount_kobo` and `provider` to the column list.
2. Set `amount_kobo = grossKobo` (the gross amount before fee deduction).
3. Set `provider = 'paystack'` (or read the active payment provider from the manifest: `await getManifestValue('payment_primary_provider') ?? 'paystack'`).
4. Also add `amount_kobo` column to the VALUES clause in the corresponding position.
5. Verify against the schema definition to ensure all other NOT NULL columns are covered.

---

### Fix 2 · EXPO-AUTH-01 — Add Origin header to cold-start token refresh fetch()

**Files to change:** `apps/expo/lib/auth/context.tsx` (lines 122–128)

**Steps:**
1. Import `env` at the top of the file (already dynamically imported inside the block — hoist it or use the dynamic import result).
2. Add `'Origin': env.API_BASE_URL` to the `headers` object in the `fetch()` call.
3. Alternatively, extract the cold-start refresh into the `refreshAccessToken` function in `apps/expo/lib/api/client.ts` (which already sets the correct Origin) and call it from the AuthProvider effect.
4. Test by simulating an expired access token on app open — verify the user is silently refreshed rather than redirected to login.

---

### Fix 3 · CRON-PAYOUT-02 — Deduct available_earnings_kobo when creating weekly payout row

**Files to change:** `apps/web/app/api/cron/daily/route.ts` (step 32, inside the transaction)

**Steps:**
1. Inside the transaction that inserts the `creator_payouts` row, add:
   `UPDATE users SET available_earnings_kobo = available_earnings_kobo - $gross, updated_at = NOW() WHERE id = $creator_id`
2. Use a WHERE clause with a floor check to prevent going negative:
   `WHERE id = $creator_id AND available_earnings_kobo >= $gross`
3. If the UPDATE returns 0 rows (balance changed since the eligibility query), roll back and skip this creator.
4. In `processPendingPayouts()` (payouts.ts), when a payout permanently fails and earnings are restored via `moveToDeadLetterQueue()`, ensure `available_earnings_kobo` is credited back — verify `earningsRestored` flag logic covers this.

---

## P1 — High Priority

### Fix 4 · DODO-PLAN-01 — Validate planName in DodoPayments webhook

**Files to change:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

**Steps:**
1. After reading `metadata.planName`, validate it against the known plan keywords (`['pro', 'plus', 'max']`).
2. Apply the same keyword-matching logic used in the Paystack webhook handler.
3. If the value doesn't match any known plan, log a warning and default to `'pro'` (or reject the event and write to `failed_webhooks` for manual review).

---

### Fix 5 · CRON-IDEMPOTENCY-01 — Add daily CRON run-guard using cronState table

**Files to change:** `apps/web/app/api/cron/daily/route.ts`

**Steps:**
1. At the very start of the POST handler (after auth check), attempt:
   ```sql
   INSERT INTO cron_state (key, last_run_at)
   VALUES ('daily', NOW())
   ON CONFLICT (key) DO UPDATE
     SET last_run_at = NOW()
     WHERE cron_state.last_run_at < NOW()::date
   RETURNING key
   ```
2. If `rows.length === 0` (already ran today), return `200 { skipped: true, reason: 'already_ran_today' }` immediately.
3. Confirm `cron_state` has a primary key on `key` — add migration if missing.

---

### Fix 6 · SCHEMA-XP-01 — Change x_manifest.value from jsonb to text

**Files to change:**
- `apps/web/lib/db/schema.ts`
- Migration file (new migration needed)

**Steps:**
1. Change `value: jsonb("value")` to `value: text("value")` in the `xManifest` table definition.
2. Generate a migration: `ALTER TABLE x_manifest ALTER COLUMN value TYPE TEXT`.
3. Verify that existing rows store plain scalar strings (they should — manifest values are booleans, numbers, and short strings stored as text in JSON format, which would need to be unquoted). Run a pre-migration check: `SELECT key, value FROM x_manifest WHERE value !~ '^[a-zA-Z0-9_. /-]+$'` to identify any values that need transformation.
4. No code changes needed — the manifest loader already treats values as plain strings.

---

### Fix 7 · ECONOMY-TRANSFER-01 — Make idempotencyRef required in transferCoins

**Files to change:** `apps/web/lib/economy/coins.ts`

**Steps:**
1. Change the function signature to make `idempotencyRef` a required parameter (remove the `?` and `null` default).
2. Find all callers with `grep -r "transferCoins"` and supply a stable key at each call site (typically the gift/transaction/request UUID).
3. For any caller that genuinely cannot provide a stable key, generate a UUID at request entry time and thread it through to the call.

---

### Fix 8 · CRON-MONTHLY-01 — Fix ON CONFLICT clause in monthly plan bonus CTE

**Files to change:** `apps/web/app/api/cron/daily/route.ts` (monthly plan coin-bonus step)

**Steps:**
1. Add a partial unique index to `coin_ledger`: `CREATE UNIQUE INDEX IF NOT EXISTS uidx_coin_ledger_source_ref ON coin_ledger (user_id, source, reference_id) WHERE reference_id IS NOT NULL`.
2. Update the ON CONFLICT clause to: `ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`.
3. Ensure the `reference_id` value used in the INSERT is stable and unique per user per month (e.g. `monthly_plan_bonus:${userId}:${yearMonth}`).
4. Add the matching Drizzle schema index definition for the new index.

---

### Fix 9 · SCHEMA-BANK-01 — Reconcile creator_bank_accounts schema with multi-account design

**Files to change:**
- `apps/web/lib/db/schema.ts`
- Migration file (new migration)
- `apps/web/app/api/cron/daily/route.ts` (step 32 bank account query)
- `apps/web/lib/payments/payouts.ts`

**Steps:**
1. Decide on the model (multiple accounts supported based on `is_primary` usage in CRON).
2. Drop the `unique()` constraint on `creator_id` in `creatorBankAccounts`.
3. Add a partial unique index: `CREATE UNIQUE INDEX ... ON creator_bank_accounts (creator_id) WHERE is_primary = TRUE AND deleted_at IS NULL`.
4. Update the Drizzle schema to remove `.unique()` and add the partial index definition.
5. Verify all queries that look up bank accounts use the correct `is_primary = TRUE AND deleted_at IS NULL` filter.

---

### Fix 10 · REDIS-RL-01 — Fix global rate limit window TTL

**Files to change:** `apps/web/lib/security/rateLimit.ts`

**Steps:**
1. In `enforceRateLimit`, change the Lua eval call from:
   `redis.eval(GLOBAL_RATE_LUA, 1, globalKey, "60")`
   to:
   `redis.eval(GLOBAL_RATE_LUA, 1, globalKey, Math.round(options.windowMs / 1000).toString())`
2. Verify all endpoints with `globalLimit` use the correct `windowMs` for their intended global window.

---

### Fix 11 · SESSION-EVICT-01 — Atomicise session eviction in Redis

**Files to change:** `apps/web/lib/auth/session.ts` (createSession)

**Steps:**
1. Replace the separate `redis.del(evictedKeys)` + `redis.zremrangebyrank(...)` calls with a single `redis.multi()` pipeline:
   ```ts
   const pipeline = redis.multi();
   pipeline.del(...evictedKeys);
   pipeline.zremrangebyrank(userSessionsKey, 0, -(MAX_SESSIONS + 1));
   await pipeline.exec();
   ```
2. Ensure the pipeline is only executed when there are actually sessions to evict (avoid empty multi() calls).

---

### Fix 12 · CRON-COIN-01 — Handle INSUFFICIENT_BALANCE in comeback-coin expiry

**Files to change:** `apps/web/app/api/cron/daily/route.ts` (step 22)

**Steps:**
1. In the catch block for `debitCoins()`, check `if (err?.code === 'INSUFFICIENT_BALANCE')`.
2. If so, log the event at info level ("User already spent comeback coins — skipping reversal") and mark the expiry as processed (update a `processed_at` column or remove the expiry record).
3. For all other errors, insert a `system_alerts` row with severity 'warning' so the ops team is informed.

---

## P2 — Medium Priority

### Fix 13 · SW-API-01 and SW-ADMIN-01 — Fix service worker precache exclusions

**Files to change:** `next.config.js` or `workbox-config.js` (whichever drives sw.js generation), `apps/web/public/sw.js`

**Steps:**
1. In the Workbox build configuration, add glob exclusions for server-side chunks:
   - Exclude `**/_next/static/chunks/app/api/**`
   - Exclude `**/_next/static/chunks/app/admin/**`
2. Rebuild the service worker: `next build`.
3. Bump the service worker version/cache name so clients with the old sw.js invalidate and re-download.

---

### Fix 14 · XP-STREAK-01 — Fix tier formula in getDailyMessageStreakXP

**Files to change:** `apps/web/lib/xp/engine.ts`

**Steps:**
1. Verify intended tier breakpoints from PRD.
2. If day 7 should be first day of tier 1: change formula from `Math.floor((day - 1) / 7)` to `Math.floor(day / 7)`.
3. Update the corresponding unit tests in `apps/web/lib/xp/__tests__/engine.test.ts` to match the corrected behaviour.

---

### Fix 15 · CRON-STREAK-01 + SCHEMA-STREAK-01 — Fix streak column sync and longest_streak update

**Files to change:** `apps/web/app/api/cron/daily/route.ts` (step 2)

**Steps:**
1. In the streak-increment UPDATE, add `login_streak = login_streak_days + 1` (or consolidate on one column and remove the other with a migration).
2. In the streak-reset UPDATE, add: `longest_streak = GREATEST(COALESCE(longest_streak, 0), login_streak_days)` before zeroing `login_streak_days`.
3. Ensure both the increment and reset branches update `login_streak` consistently.

---

### Fix 16 · CRON-STREAK-02 — Use indexed last_login_date in streak query

**Files to change:** `apps/web/app/api/cron/daily/route.ts` (step 2)

**Steps:**
1. Replace `last_login_at::date = CURRENT_DATE - 1` with `last_login_date = CURRENT_DATE - 1` in the streak eligibility query.
2. Confirm a B-tree index exists on `last_login_date` (add one via migration if not).
3. Ensure the application updates `last_login_date` in addition to `last_login_at` on every login.

---

### Fix 17 · SCHEMA-DM-01 — Enforce canonical pair ordering in dm_conversations

**Files to change:**
- `apps/web/lib/db/schema.ts`
- Migration file
- All code paths that INSERT into `dm_conversations`

**Steps:**
1. Add a CHECK constraint via migration: `ALTER TABLE dm_conversations ADD CHECK (user_id_1 < user_id_2)`.
2. Update the Drizzle schema to add the check expression.
3. Find all INSERT paths with `grep -r "dm_conversations"` and ensure both user IDs are sorted before insert: `const [id1, id2] = [userA, userB].sort()`.

---

### Fix 18 · SW-STALE-01 — Switch authenticated endpoints to NetworkOnly in service worker

**Files to change:** `apps/web/public/sw.js` (or the Workbox config that generates it)

**Steps:**
1. Change the `/api/users/me` and `/api/creator/wallet` route strategy from `StaleWhileRevalidate` to `NetworkOnly`.
2. Alternatively, add a cache key plugin that varies on the `Authorization` header or a session-specific cookie value.
3. Rebuild the service worker.

---

### Fix 19 · CRON-NEMESIS-01 — Fix nemesis overtake notification filter

**Files to change:**
- `apps/web/lib/db/schema.ts` (nemesisAssignments — add last_notified_at column)
- Migration file
- `apps/web/app/api/cron/daily/route.ts` (step 31)

**Steps:**
1. Add `last_notified_at TIMESTAMPTZ` column to `nemesis_assignments`.
2. Change the overtake query WHERE clause from `na.created_at >= NOW() - INTERVAL '24 hours'` to `n.xp_total > u.xp_total AND (na.last_notified_at IS NULL OR na.last_notified_at < NOW() - INTERVAL '6 days')`.
3. After sending notifications for a pair, UPDATE the `last_notified_at` to NOW() for those nemesis_assignments rows.

---

### Fix 20 · CRON-ALLIANCE-01 — Add unique constraint to prevent duplicate alliance war rows

**Files to change:**
- `apps/web/lib/db/schema.ts` (allianceWars)
- Migration file
- `apps/web/app/api/cron/daily/route.ts` (step 32b)

**Steps:**
1. Add a partial unique index: `CREATE UNIQUE INDEX uidx_alliance_wars_active ON alliance_wars (alliance_1_id, alliance_2_id) WHERE status = 'active'`.
2. Update the Drizzle schema definition.
3. Update the ON CONFLICT clause in the CRON INSERT to reference this constraint explicitly.

---

### Fix 21 · CRON-DIGEST-01 — Fix moderation digest open/escalated counts

**Files to change:** `apps/web/app/api/cron/daily/route.ts` (step 29)

**Steps:**
1. Separate the new-reports count (filtered by `created_at >= NOW() - INTERVAL '7 days'`) from the total-open/escalated count (unfiltered).
2. Update the query to return both: `new_this_week`, `total_open`, `total_escalated`, `actions_taken`.
3. Update the email body template to use the correct metrics for each statistic.

---

### Fix 22 · REDIS-RL-01 (already in P1 above) — covered

---

### Fix 23 · CRON-TIER-01 — Fix creator tier counter to only count actual changes

**Files to change:** `apps/web/app/api/cron/daily/route.ts` (step 28)

**Steps:**
1. Add `RETURNING id` to the `UPDATE users SET creator_tier = $1` query.
2. Move `tierUpdates++` inside a check on `rows.length > 0`.
3. Optionally also track `tierUnchanged` for observability.

---

### Fix 24 · SCHEMA-SEASON-01 — Audit and consolidate season-pass tables ✅ DONE

**Files changed:**
- `apps/web/lib/db/schema.ts` — removed `seasonPasses` and `userSeasonPassClaims` table definitions and their type exports
- `apps/web/lib/seasons/seasonEngine.ts` — `getPassMilestones()` now LEFT JOINs `user_season_milestone_claims`; `claimPassMilestone()` now INSERTs into `user_season_milestone_claims` with correct `ON CONFLICT (user_id, season_id, milestone_id)`
- `apps/web/lib/seasons/__tests__/seasonEngine.test.ts` — fixed test assertions that checked for `UPDATE season_passes` (wrong table) → `UPDATE user_season_passes`
- `apps/web/app/(app)/seasons/page.tsx` — fixed `handleClaimMilestone` to call the correct endpoint `/api/seasons/${seasonId}/pass/milestones/${milestoneId}/claim` (was calling non-existent `/api/seasons/${seasonId}/pass/claim`)
- `apps/web/app/api/seasons/[seasonId]/pass/gift/route.ts` — fixed stale comment
- `apps/web/db/migrations/0005_schema_season_01.sql` — migrates orphaned `user_season_pass_claims` rows into `user_season_milestone_claims`, then drops `user_season_pass_claims` and `season_passes`
- `apps/web/lib/i18n/locales/*.json` + `apps/expo/lib/i18n/locales/*.json` — added missing claim-flow i18n keys (`seasons.claimSuccess`, `seasons.alreadyClaimed`, `seasons.paidPassRequired`, `seasons.insufficientXp`, `seasons.claimError`) across all 8 locales for both apps
- `docs/HOW-IT-WORKS.md` — documented canonical tables and why the legacy ones were dropped

**Canonical tables post-fix:**
- `user_season_passes` — pass ownership, XP, rank
- `user_season_milestone_claims` — milestone claim records (unique on user_id + season_id + milestone_id)

---

## P3 — Low / Maintainability

### Fix 25 · CRON-ORDER-01 — Renumber CRON steps sequentially

**Files to change:** `apps/web/app/api/cron/daily/route.ts`

**Steps:**
1. List all steps in execution order.
2. Renumber comment headers sequentially (// 1., // 2., etc.).
3. Optionally extract each step into a named async function: `async function stepStreakUpdate(db, results, errors)` etc., and have the main handler call them in order.

---

### Fix 26 · CRON-GUILD-01 — Consolidate guild tier maps

**Files to change:** `apps/web/app/api/cron/daily/route.ts`

**Steps:**
1. Define a single constant: `const GUILD_TIERS = [{ name: 'bronze', min: 0, max: 999 }, { name: 'silver', min: 1000, max: 4999 }, ...]`.
2. Write helper functions `getTierForXP(xp)` and `getNextTier(current)` / `getPrevTier(current)` that read from this single source.
3. Replace the two separate promotion/demotion map objects with calls to these helpers.

---

### Fix 27 · EXPO-AUTH-02 — Fix packageName parameter in Google Play purchase flow

**Files to change:** `apps/expo/lib/payments/googlePlay.ts`

**Steps:**
1. Define `const APP_PACKAGE_NAME = 'com.zobia.app'` as a module-level constant.
2. Remove the `packageName` parameter from `purchaseCoins` and `purchaseSubscription` (breaking change — update all call sites).
3. Use `APP_PACKAGE_NAME` in `setupGlobalPurchaseListener`'s `verifyPurchaseServerSide` call.
4. If white-label support is needed, read from an env variable instead: `const APP_PACKAGE_NAME = env.APP_PACKAGE_NAME ?? 'com.zobia.app'`.

---

---

## P1 — High Priority (continued: architectural improvements)

### Fix 28 · WEB-AUTH-01 — Add concurrent-refresh deduplication lock to web auth client

**Files to change:** `apps/web/lib/auth/` (web-side refresh logic or fetch wrapper)

**Steps:**
1. Identify where the web client calls `/api/auth/refresh` on 401 (likely in a fetch wrapper or React Query error handler).
2. Introduce a module-level `let webRefreshPromise: Promise<string> | null = null`.
3. Wrap the refresh call: if `webRefreshPromise` is already set, await it and skip the redundant request; otherwise start the refresh, store the promise, await it, then null the variable in a `finally` block.
4. Model the implementation directly on `apps/expo/lib/api/client.ts` lines that implement `refreshPromise`.

---

### Fix 29 · PUSH-RECEIPT-01 — Implement Expo push notification receipt polling

**Files to change:**
- `apps/web/lib/notifications/push.ts`
- `apps/web/lib/db/schema.ts` (add `push_tickets` table)
- `apps/web/app/api/cron/daily/route.ts` (add receipt-poll step)
- Migration file

**Steps:**
1. Add a `push_tickets` table: `(id UUID PK, ticket_id TEXT, user_id UUID, created_at TIMESTAMPTZ, polled_at TIMESTAMPTZ NULL, status TEXT DEFAULT 'pending')`.
2. After each batch `sendPushNotificationsAsync` call, INSERT the returned ticket IDs into `push_tickets`.
3. Add a CRON step that runs after notifications are sent: SELECT push_tickets WHERE `status = 'pending' AND created_at <= NOW() - INTERVAL '15 minutes'`, batch-call Expo's `/v2/push/getReceipts`, handle `DeviceNotRegistered` by deleting the token, log other errors.
4. Mark polled rows `status = 'processed'` or `status = 'failed'` accordingly.

---

### Fix 30 · SEC-HSTS-01 — Add Strict-Transport-Security header in middleware

**Files to change:** `apps/web/middleware.ts`

**Steps:**
1. In the response header builder (alongside the CSP header), add:
   `response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')`
2. Guard with `if (process.env.NODE_ENV === 'production')` to avoid HSTS issues in local dev.
3. After deploying, submit the domain to the HSTS preload list (hstspreload.org) if not already done.

---

### Fix 31 · SEC-CSP-01 — Add worker-src directive to Content-Security-Policy

**Files to change:** `apps/web/middleware.ts` (CSP string construction)

**Steps:**
1. Add `worker-src 'self'` to the CSP header value.
2. If the service worker imports any external scripts (Workbox CDN builds), add those origins to `worker-src` as well.
3. Test the service worker installation in a browser with a strict CSP reporter to confirm no violations are emitted.

---

### Fix 32 · WEBHOOK-RETRY-01 — Add failed_webhooks retry step to daily CRON

**Files to change:** `apps/web/app/api/cron/daily/route.ts`

**Steps:**
1. Add a new CRON step that SELECTs `failed_webhooks WHERE status = 'pending' AND next_retry_at <= NOW() AND retry_count < max_retries`.
2. For each row, re-invoke the appropriate handler function (Paystack or DodoPayments) based on `provider` column.
3. On success: UPDATE `status = 'processed', processed_at = NOW()`.
4. On failure: UPDATE `retry_count = retry_count + 1, next_retry_at = NOW() + (INTERVAL '1 minute' * POWER(2, retry_count)), last_error = $error_message`.
5. When `retry_count >= max_retries`, move to a permanent-failure state: `status = 'dead'`, emit a `system_alerts` row.

---

### Fix 33 · API-HEADERS-01 — Add Retry-After and X-RateLimit-* headers to 429 responses

**Files to change:** `apps/web/lib/security/rateLimit.ts`

**Steps:**
1. The Lua script already returns the current count and the key TTL (or compute `windowMs - elapsed`).
2. On rate-limit breach, set response headers before returning 429:
   - `Retry-After: <seconds until window resets>`
   - `X-RateLimit-Limit: <limit>`
   - `X-RateLimit-Remaining: 0`
   - `X-RateLimit-Reset: <unix epoch of window reset>`
3. Confirm Expo client and any web fetch wrappers read `Retry-After` and honour it before retrying.

---

## P2 — Medium Priority (continued: architectural improvements)

### Fix 34 · DB-TIMEOUT-01 — Set statement_timeout on database connections

**Files to change:** `apps/web/lib/db/index.ts`

**Steps:**
1. In the connection config, add `options: '--statement-timeout=30000'` (30 s) to the connection string, or execute `SET statement_timeout = 30000` immediately after acquiring a connection.
2. For the CRON route handler (which legitimately runs longer operations), create a separate DB client instance with a higher timeout (e.g. 120 s) or run each step with `SET LOCAL statement_timeout = 120000` inside a transaction.
3. Add error handling for `57014 query_canceled` errors so they surface as clean log entries rather than unhandled promise rejections.

---

### Fix 35 · SCHEMA-STAR-01 — Change star_ledger.amount from integer to bigint

**Files to change:**
- `apps/web/lib/db/schema.ts` (starLedger)
- Migration file

**Steps:**
1. Change `amount: integer("amount")` to `amount: bigint("amount", { mode: "number" })` in the `starLedger` schema definition.
2. Generate migration: `ALTER TABLE star_ledger ALTER COLUMN amount TYPE BIGINT`.
3. Verify no application code casts the column to int32 after reading (JavaScript numbers handle up to 2^53 safely).

---

### Fix 36 · DB-INDEX-01 — Add index on creator_payouts(status, next_retry_at)

**Files to change:**
- `apps/web/lib/db/schema.ts` (creatorPayouts)
- Migration file

**Steps:**
1. Add Drizzle index definition:
   `index('idx_creator_payouts_retry').on(t.nextRetryAt).where(sql\`status IN ('pending', 'processing')\`)`
2. Generate migration: `CREATE INDEX idx_creator_payouts_retry ON creator_payouts (next_retry_at) WHERE status IN ('pending', 'processing')`.
3. Confirm query in `processPendingPayouts` can use the index (run EXPLAIN ANALYZE in staging).

---

### Fix 37 · ARCH-CONTRACT-01 — Define shared Zod API schemas in shared/

**Files to change:**
- `shared/schemas/api/` (new directory and files — one schema file per API domain)
- `apps/web/app/api/**` (import shared schemas for input validation)
- `apps/expo/lib/api/client.ts` and type definitions (import shared schemas for response parsing)

**Steps:**
1. Create `shared/schemas/api/auth.ts`, `coins.ts`, `creator.ts`, `notifications.ts`, etc., each exporting Zod request and response schemas.
2. In web route handlers, replace inline type assertions with `schema.safeParse(req.body)` at request entry.
3. In Expo API calls, wrap responses with `schema.safeParse(data)` and surface validation errors rather than casting.
4. Add `tsc --noEmit` check in CI that validates both apps can import the shared schemas without errors.

---

### Fix 38 · OBS-TRACE-01 — Add request/correlation ID threading

**Files to change:**
- `apps/web/middleware.ts`
- `apps/web/lib/` (service layer functions — add optional `requestId` parameter or use AsyncLocalStorage)

**Steps:**
1. In middleware, generate `const requestId = crypto.randomUUID()` and set `X-Request-ID: ${requestId}` on the response and as a forwarded request header.
2. In each API route handler, read `request.headers.get('x-request-id')` and pass it to service layer calls.
3. Include `requestId` in every `console.error` / logging call at the service layer.
4. For full observability, use Node.js `AsyncLocalStorage` to store the request ID context so it's accessible without threading the parameter manually through every function.

---

## P3 — Low / Maintainability (continued)

### Fix 39 · PERF-CRON-01 — Parallelise independent CRON steps with Promise.allSettled

**Files to change:** `apps/web/app/api/cron/daily/route.ts`

**Steps:**
1. After extracting each step into a named async function (Fix 25), categorise steps by dependency.
2. Group truly independent steps (e.g. streak update, leaderboard recalc, moderation digest, sticker unlock) into `Promise.allSettled` batches.
3. Steps that write to shared tables (users, coin_ledger) must stay sequential unless each operates on a disjoint set of rows.
4. Measure wall-clock time before and after to confirm improvement; add timing metrics to the CRON response object.

---

## Execution Order Recommendation

Work in this sequence to minimise risk:

1. **P0 fixes first** (Fixes 1–3) — these are production-critical financial bugs.
2. **Fix 2 (EXPO-AUTH-01)** in parallel with Fix 1 — independent change.
3. **Fix 5 (CRON idempotency)** before any CRON is next run.
4. **Fix 30 + Fix 31 (HSTS + CSP)** — zero-risk header additions, deploy in next release.
5. **Fixes 4, 6, 7, 8, 9, 10, 11, 12** — P1 batch, can be done in a single PR.
6. **Fixes 28, 29, 32, 33** — P1 architectural batch (auth dedup, push receipts, webhook retry, rate-limit headers).
7. **Fixes 13–24** — P2 bug batch, schedule for next sprint.
8. **Fixes 34–38** — P2 architectural batch (DB timeouts, star ledger type, DB index, Zod contracts, tracing).
9. **Fixes 25–27, 39** — P3 cleanup, merge with next cleanup PR.

Each fix should be accompanied by at minimum a unit test covering the corrected behaviour and a regression test for the previously broken case.

---

*Plan generated: Monday, June 15, 2026 11:31 PM UTC*  
*Updated: Monday, June 16, 2026 (Fixes 28–39 added for 9.5+ quality target)*
