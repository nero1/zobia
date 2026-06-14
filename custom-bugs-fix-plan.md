# Zobia Codebase — Bug Fix Plan

**Generated:** June 14, 2026, 12:00 PM UTC  
**Updated:** June 14, 2026, 10:30 AM UTC (added FIX-23–FIX-30 covering BUG-CR01/CR02/RL01 + systemic items)  
**Based on:** custom-bugs-report.md (same session)  
**Status:** Awaiting review — DO NOT IMPLEMENT until approved

---

## Priority Classification

| Priority | Criteria |
|---|---|
| **P0 — Critical** | Financial data loss, security breach, or user data corruption possible |
| **P1 — High** | Incorrect behavior affecting financial accuracy or core user flows |
| **P2 — Medium** | Functional bug visible to users or breaking admin workflows |
| **P3 — Low** | Code quality issue; no direct user-visible impact |

---

## Fix Plan — Ordered by Priority

---

### P0 — Critical (Fix Immediately)

---

#### FIX-01 — BUG-SE01: Add key versioning to `fieldEncryption.ts`

**Risk without fix:** Rotating `KYC_ENCRYPTION_KEY` (required by compliance) permanently breaks decryption of all KYC records in production.

**Steps:**
1. In `lib/security/fieldEncryption.ts`, change `encryptField` to prepend a version prefix to every ciphertext output: `"v1:" + base64(iv + tag + ciphertext)`.
2. Change `decryptField` to read the prefix, look up the matching key version from a key-store (`KYC_ENCRYPTION_KEY_V1`, `KYC_ENCRYPTION_KEY_V2`, etc.), and decrypt with that key.
3. Add `KYC_ENCRYPTION_KEY_V1` to `.env` schema (same value as current `KYC_ENCRYPTION_KEY`) and add `KYC_ENCRYPTION_KEY_V2` for future rotation.
4. Write a one-time migration script that re-reads all encrypted records, decrypts with v1, re-encrypts as v2, and writes back. Run before dropping v1 from the key-store.
5. Update `lib/env.ts` Zod schema to require at least one versioned key.

**Files to change:**
- `apps/web/lib/security/fieldEncryption.ts`
- `apps/web/lib/env.ts`
- New: `scripts/migrate-encryption-keys.ts`

---

#### FIX-02 — BUG-PY01: Add `FOR UPDATE SKIP LOCKED` to `reconcileStuckPayouts`

**Risk without fix:** Concurrent CRON runs can both select and attempt the same stuck payout, causing duplicate bank transfers to creators.

**Steps:**
1. In `lib/payments/payouts.ts`, find the `reconcileStuckPayouts` function's outer SELECT on `creator_payouts`.
2. Wrap it in a CTE identical to the Phase 1 pattern: `UPDATE creator_payouts SET status = 'retrying', updated_at = NOW() WHERE id IN (SELECT id FROM creator_payouts WHERE status = 'processing' AND ... FOR UPDATE SKIP LOCKED LIMIT $batchSize) RETURNING *`.
3. Remove the separate status-update step — the atomic CTE handles it.
4. Verify the existing dead-letter queue path (`moveToDeadLetterQueue`) still uses `FOR UPDATE` on the individual payout row (it does — no change needed there).

**Files to change:**
- `apps/web/lib/payments/payouts.ts`

---

#### FIX-03 — BUG-EC02: Make `first_time_gifted` XP award atomic with the gift transaction

**Risk without fix:** Concurrent gift sends to a new recipient each award the one-time 15 XP bonus, crediting XP multiple times for the same milestone.

**Steps:**
1. In `app/api/economy/gifts/send/route.ts`, move the `first_time_gifted` check and XP award into the main `db.transaction` block (alongside the coin debit/credit and gift record INSERT).
2. Replace the `COUNT(*) <= 1` pattern with a dedicated deduplication gate: add a `first_gift_received_xp_awarded BOOLEAN DEFAULT FALSE` column to `users` (migration), and use `UPDATE users SET first_gift_received_xp_awarded = TRUE WHERE id = $recipientId AND first_gift_received_xp_awarded IS NOT TRUE RETURNING id`. Only award XP if `RETURNING id` has a row.
3. Remove `first_time_gifted` logic from `awardGiftXP` (it no longer needs to be fire-and-forget).

**Files to change:**
- `apps/web/app/api/economy/gifts/send/route.ts`
- New migration: add `first_gift_received_xp_awarded` column to `users`

---

---

### P1 — High (Fix This Sprint)

---

#### FIX-04 — BUG-SW01: Reduce Service Worker cache TTL for financial and social API routes

**Risk without fix:** PWA users see stale coin balances and notification counts up to 24 hours old.

**Steps:**
1. In `apps/web/public/sw.js`, add explicit `NetworkOnly` routes BEFORE the catch-all API NetworkFirst rule for: `/api/economy/coins/balance`, `/api/economy/stars/balance`, `/api/notifications`, `/api/messages/dm`.
2. For `/api/users/me` and `/api/creator/wallet`, change to `StaleWhileRevalidate` with `maxAgeSeconds: 60`.
3. For the remaining catch-all API rule, reduce `maxAgeSeconds` from `86400` to `300` (5 minutes).
4. Rebuild and re-register the service worker (bump the cache version string in the SW to force cache invalidation on existing clients).

**Files to change:**
- `apps/web/public/sw.js`

---

#### FIX-05 — BUG-AU01: Pass refresh token in Telegram OAuth mobile polling

**Risk without fix:** All Telegram-authenticated Expo users are silently logged out ~15 minutes after login.

**Steps:**
1. In `app/api/auth/telegram/status/route.ts`, find the `approved` status response. Add the `refreshToken` to the response body alongside `token` and `user`.
2. In `apps/expo/app/auth/login.tsx`, in `startTelegramPoll`, destructure `data.refreshToken` from the API response and pass it as the third arg to `signIn`: `await signIn(data.token, data.user as AuthUser, data.refreshToken)`.
3. Verify the Telegram status route issues tokens the same way as the Google mobile-token route.

**Files to change:**
- `apps/web/app/api/auth/telegram/status/route.ts`
- `apps/expo/app/auth/login.tsx`

---

#### FIX-06 — BUG-WH01: Fix `system_alerts` INSERT column names in Paystack webhook error handler

**Risk without fix:** All Paystack webhook processing errors are silently swallowed — admins have no visibility into payment failures.

**Steps:**
1. In `app/api/economy/webhooks/paystack/route.ts`, find the error handler block (~line 601).
2. Change the INSERT column `alert_type` to `type`.
3. Add the `severity` column with value `'critical'`.
4. Search the entire codebase for other `system_alerts` INSERTs and verify column consistency: `grep -r "INSERT INTO system_alerts" apps/web/`.
5. Consider creating a shared `insertSystemAlert(type, severity, message, metadata)` helper to prevent future column-name drift.

**Files to change:**
- `apps/web/app/api/economy/webhooks/paystack/route.ts`
- Optionally: `apps/web/lib/alerts.ts` (new shared helper)

---

#### FIX-07 — BUG-GW01: Serialize `findWarOpponent` with a Redis distributed lock

**Risk without fix:** Two guilds can simultaneously select the same opponent, creating two active wars for one guild.

**Steps:**
1. In `lib/guilds/warEngine.ts`, after the top candidate is selected (`candidates[0].id`), acquire a Redis lock: `await redis.set(\`war_lock:opponent:${chosenId}\`, 1, 'NX', 'EX', 30)`. If it returns null, move to the next candidate.
2. The war declaration route (caller) must release the lock on success or failure: `await redis.del(\`war_lock:opponent:${chosenId}\`)`.
3. Alternatively, add a UNIQUE partial index: `CREATE UNIQUE INDEX ON guild_wars (defender_guild_id) WHERE status IN ('active', 'final_hour')` and let the DB enforce the constraint — the INSERT will fail if a duplicate is attempted, and the caller can retry with the next candidate.

**Files to change:**
- `apps/web/lib/guilds/warEngine.ts`
- `apps/web/app/api/guilds/[guildId]/wars/declare/route.ts` (or equivalent caller)
- Optional: DB migration for unique partial index

---

#### FIX-08 — BUG-RM01: Filter pending-approval messages from room message GET

**Risk without fix:** Unapproved messages are publicly visible, defeating moderation-approval rooms entirely.

**Steps:**
1. In `app/api/rooms/[roomId]/messages/route.ts`, add `AND (rm.is_pending_approval = FALSE OR rm.is_pending_approval IS NULL)` to the GET query WHERE clause.
2. Verify the room message approval endpoint sets `is_pending_approval = FALSE` on approval (not just a separate `approved` flag).
3. Add an index on `room_messages (room_id, is_pending_approval, created_at)` if not already present.

**Files to change:**
- `apps/web/app/api/rooms/[roomId]/messages/route.ts`

---

#### FIX-09 — BUG-DM01: Fix UUID ordering in `dm_conversations` upsert

**Risk without fix:** The same pair of users can end up with two separate `dm_conversations` rows instead of one, splitting their message history.

**Steps:**
1. In `app/api/messages/dm/route.ts`, change both occurrences of `LEAST($1::text, $2::text)` and `GREATEST($1::text, $2::text)` to `LEAST($1::uuid, $2::uuid)` and `GREATEST($1::uuid, $2::uuid)`.
2. Apply the same fix in `app/api/economy/gifts/send/route.ts` (DM gift path).
3. Audit all other files that upsert into `dm_conversations`: `grep -r "dm_conversations" apps/web/app/api/`.
4. Verify the `dm_conversations` table columns `user_id_1` and `user_id_2` are typed as `UUID` (not `TEXT`) in the schema.
5. Run a one-time deduplication query against production to merge any existing duplicate conversation rows.

**Files to change:**
- `apps/web/app/api/messages/dm/route.ts`
- `apps/web/app/api/economy/gifts/send/route.ts`

---

#### FIX-10 — BUG-EC01: Add transaction type parameters to `transferCoins`

**Risk without fix:** All non-gift coin transfers (war rewards, treasury distributions) are logged as `gift_sent`/`gift_received` in the ledger, corrupting financial audit trails.

**Steps:**
1. In `lib/economy/coins.ts`, add two new parameters to `transferCoins`: `senderType: string` and `recipientType: string`, with defaults of `'gift_sent'` and `'gift_received'` for backward compatibility.
2. Update the two ledger INSERT statements inside `transferCoins` to use these parameters.
3. Audit all callers of `transferCoins` and pass appropriate transaction types (e.g., `'war_reward'`, `'treasury_transfer'`).

**Files to change:**
- `apps/web/lib/economy/coins.ts`
- All callers of `transferCoins` (search with `grep -r "transferCoins" apps/web/`)

---

#### FIX-11 — BUG-RF01: Add `xp_social` update to referral qualifying XP award

**Risk without fix:** Referral-qualifying XP is invisible on the Social track leaderboard.

**Steps:**
1. In `lib/referrals/commissions.ts`, find the XP UPDATE after marking a referral as qualified.
2. Add `xp_social = COALESCE(xp_social, 0) + $1` to the UPDATE statement.
3. Verify the `xp_ledger` INSERT already has `track = 'social'` (it does).

**Files to change:**
- `apps/web/lib/referrals/commissions.ts`

---

#### FIX-12 — BUG-QS01: Fix `generateDailyDeck` plan filter hierarchy

**Risk without fix:** `pro` users cannot access `plus`-tier quests, reducing their daily deck quality below what their subscription entitles them to.

**Steps:**
1. In `lib/quests/questEngine.ts`, replace the `plan_required = $2 OR $2 = 'max'` SQL condition with a hierarchical condition:
   `(plan_required IS NULL OR plan_required = 'free' OR (plan_required = 'plus' AND $2 IN ('plus','pro','max')) OR (plan_required = 'pro' AND $2 IN ('pro','max')) OR (plan_required = 'max' AND $2 = 'max'))`
2. Test that `free` users see only NULL/free quests, `plus` sees NULL/free/plus, `pro` sees NULL/free/plus/pro, and `max` sees all.

**Files to change:**
- `apps/web/lib/quests/questEngine.ts`

---

### P2 — Medium (Fix Next Sprint)

---

#### FIX-23 — BUG-CR01: Fix leaderboard CRON rank-change detection (broken — never fires)

**Steps:**
1. In `app/api/cron/leaderboards/route.ts`, remove Step 2's `SELECT user_id, rank FROM leaderboard_snapshots` entirely (the `rank` column does not exist in this table).
2. Add a `last_notified_rank INTEGER` column to `leaderboard_snapshots` via migration (nullable, default NULL).
3. After Step 4 computes new ranks via the `RANK() OVER (...)` window function, compare each user's `new_rank` against `last_notified_rank` from the snapshot table (query it after Step 3 upserts).
4. For each rank change, insert the notification as before, then `UPDATE leaderboard_snapshots SET last_notified_rank = $newRank WHERE user_id = $id AND track = 'main' AND scope = 'global'`.
5. Verify notifications are now inserted by checking `notifications` table after a CRON run in staging.

**Files to change:**
- `apps/web/app/api/cron/leaderboards/route.ts`
- New migration: add `last_notified_rank INTEGER` to `leaderboard_snapshots`

---

#### FIX-24 — BUG-CR02: Update leaderboard CRON to materialize all 7 XP track snapshots

**Steps:**
1. In `app/api/cron/leaderboards/route.ts`, update the Step 1 user query to also `SELECT xp_social, xp_creator, xp_competitor, xp_generosity, xp_knowledge, xp_explorer` alongside `xp_total`.
2. In Step 3, replace the single `upsertLeaderboardSnapshot(user.user_id, "main", user.xp_total, db)` call with 7 parallel calls via `Promise.all`:

```
await Promise.all([
  upsertLeaderboardSnapshot(user.user_id, "main",       user.xp_total,       db),
  upsertLeaderboardSnapshot(user.user_id, "social",     user.xp_social,      db),
  upsertLeaderboardSnapshot(user.user_id, "creator",    user.xp_creator,     db),
  upsertLeaderboardSnapshot(user.user_id, "competitor", user.xp_competitor,  db),
  upsertLeaderboardSnapshot(user.user_id, "generosity", user.xp_generosity,  db),
  upsertLeaderboardSnapshot(user.user_id, "knowledge",  user.xp_knowledge,   db),
  upsertLeaderboardSnapshot(user.user_id, "explorer",   user.xp_explorer,    db),
]);
```

3. Update the `ActiveUserRow` interface to include the 6 new columns.
4. Verify Social/Creator/etc. leaderboard GET endpoints return fresh data after a CRON run.

**Files to change:**
- `apps/web/app/api/cron/leaderboards/route.ts`

---

#### FIX-25 — BUG-RL01: Add rate limiting to `/api/notifications` GET

**Steps:**
1. In `app/api/notifications/route.ts`, add `await enforceRateLimit(auth.user.sub, "user", RATE_LIMITS.apiRead)` as the first line inside the GET handler (after `const userId = auth.user.sub`).
2. Optionally add `Cache-Control: private, max-age=10` and an `ETag` based on the latest `created_at` timestamp to support conditional GETs and reduce load.

**Files to change:**
- `apps/web/app/api/notifications/route.ts`

---

### P1 — High (Fix This Sprint)

---

#### FIX-13 — BUG-WH02: Add zero-amount guard to DodoPayments `star_pack` handler

**Steps:**
1. In `app/api/economy/webhooks/dodopayments/route.ts`, immediately after parsing the `starAmount` from metadata in the `star_pack` branch, add: `if (starAmount <= 0) throw new Error(\`star_pack starAmount must be positive, got: ${starAmount}\`)`.

**Files to change:**
- `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

---

#### FIX-14 — BUG-LB01: Fix XP normalization denominator in `calculateWeightedScore`

**Steps:**
1. In `lib/leaderboards/engine.ts`, change the `calculateWeightedScore` normalization from `xpTotal / 10000` to `xpTotal / 100000` (100k XP = "Champion" rank), or make it a named constant (`XP_NORMALIZATION_CAP`) configurable via the manifest.
2. Review downstream consumers of `calculateWeightedScore` to ensure the new score range doesn't break any display logic.

**Files to change:**
- `apps/web/lib/leaderboards/engine.ts`

---

#### FIX-15 — BUG-LB02: Compute real rank for Hall of Fame injected users

**Steps:**
1. In `lib/leaderboards/engine.ts`, inside the Hall of Fame injection loop, replace `rank: entries.length + 1` with a call to `getUserRank(hof.user_id, 'main', 'global', db)`.
2. Since `getUserRank` is async and multiple HoF users may be injected, collect all calls in parallel with `Promise.all`.
3. Cap the result to not exceed the total leaderboard count.

**Files to change:**
- `apps/web/lib/leaderboards/engine.ts`

---

#### FIX-16 — BUG-MD01: Add TTL-based invalidation to the profanity wordlist cache

**Steps:**
1. In `lib/moderation/contentFilter.ts`, change the module-level wordlist variable from a plain array to `{ words: string[]; fetchedAt: number }`.
2. Add a `getWordlist()` async function that checks `Date.now() - fetchedAt > 5 * 60 * 1000` and re-fetches from the database if stale.
3. In the admin wordlist update endpoint, add a Redis pub/sub or flag (`redis.del('wordlist_cache')`) to signal a fresh fetch on next use.
4. Update all callers of the module-level constant to call `getWordlist()` instead.

**Files to change:**
- `apps/web/lib/moderation/contentFilter.ts`
- `apps/web/app/api/admin/moderation/route.ts` (or wherever the wordlist is updated)

---

#### FIX-17 — BUG-SS01: Add `updated_at = NOW()` to `claimPassMilestone` xp_bonus UPDATE

**Steps:**
1. In `lib/seasons/seasonEngine.ts`, in the `xp_bonus` reward branch of `claimPassMilestone`, change the UPDATE to include `updated_at = NOW()`.

**Files to change:**
- `apps/web/lib/seasons/seasonEngine.ts`

---

#### FIX-18 — BUG-AU02: Delete anti-replay key on `createSession` failure

**Steps:**
1. In `app/api/admin/auth/totp/route.ts`, wrap `createSession` in a try/catch. In the catch, call `await redis.del(usedKey).catch(() => {})` before re-throwing.
2. This allows the admin to retry with the same code after a transient server error without waiting for the 90s TTL.

**Files to change:**
- `apps/web/app/api/admin/auth/totp/route.ts`

---

### P3 — Low (Fix When Convenient)

---

### P1 — High (Systemic — Fix Next Sprint)

---

#### FIX-26 — SYS-01: XP dead-letter queue for failed fire-and-forget awards

**Steps:**
1. Create a `failed_xp_awards` table: `(id UUID PK, user_id UUID, amount INT, track TEXT, source TEXT, reference_id TEXT, error_message TEXT, failed_at TIMESTAMPTZ, retry_count INT DEFAULT 0, last_retried_at TIMESTAMPTZ, resolved_at TIMESTAMPTZ)`.
2. Write a shared `safeAwardXP(userId, amount, track, source, referenceId, db)` helper that wraps the XP ledger INSERT + users UPDATE. On failure, inserts into `failed_xp_awards` instead of swallowing the error.
3. Replace all `db.query(...XP...).catch(() => {})` patterns across the codebase with `safeAwardXP(...)`.
4. Add a step to the daily CRON that retries rows from `failed_xp_awards` with `retry_count < 5`, using exponential backoff (`last_retried_at < NOW() - INTERVAL '2^retry_count minutes'`). On success, set `resolved_at = NOW()`. After 5 failures, insert a `system_alert` and stop retrying.

**Files to change:**
- New: `apps/web/lib/xp/safeAwardXP.ts`
- `apps/web/app/api/cron/daily/route.ts` (add retry step)
- All route files that fire-and-forget XP (30+ files — use `grep -r "\.catch.*XP\|xp_ledger.*catch" apps/web/app/api/`)
- New migration: `failed_xp_awards` table

---

#### FIX-27 — SYS-02: Nightly coin and star ledger balance reconciliation

**Steps:**
1. Add a reconciliation step to the daily CRON that samples 500 users per run (or all users for small platforms) and checks:
   `SELECT user_id, coin_balance, (SELECT COALESCE(SUM(amount),0) FROM coin_ledger WHERE user_id = u.id) AS ledger_sum FROM users u WHERE ...`
2. For any user where `ABS(coin_balance - ledger_sum) > 0`, insert a row into a new `audit_discrepancies` table: `(user_id, column_name, stored_value, expected_value, delta, detected_at)` and insert a `system_alert`.
3. Never auto-correct silently — require a human to review and approve any balance adjustment.
4. Repeat for `star_balance` vs `star_ledger`.
5. Add a Grafana/monitoring dashboard metric for "open discrepancies count".

**Files to change:**
- `apps/web/app/api/cron/daily/route.ts`
- New migration: `audit_discrepancies` table

---

#### FIX-28 — SYS-03: Introduce structured logging with per-request tracing

**Steps:**
1. Add `pino` to `apps/web` dependencies.
2. Create `apps/web/lib/logger.ts` that exports a configured pino instance emitting JSON with fields: `level`, `timestamp`, `requestId`, `userId`, `route`, `durationMs`, `message`.
3. In `apps/web/lib/api/middleware.ts` (`withAuth` HOC), generate `requestId = crypto.randomUUID()` and add it to a request-scoped context (Next.js `AsyncLocalStorage` or pass it as a parameter to the handler).
4. Replace all `console.error(...)` and `console.log(...)` in route files with `logger.error(...)` / `logger.info(...)`, including `requestId` and `userId` in every log call.
5. Add `X-Request-Id: ${requestId}` to all API responses so client errors can be correlated with server logs.

**Files to change:**
- New: `apps/web/lib/logger.ts`
- `apps/web/lib/api/middleware.ts`
- All route files (systematic replacement of `console.*`)

---

### P2 — Medium (Systemic — Next Quarter)

---

#### FIX-29 — SYS-04: Add circuit breakers for external API calls

**Steps:**
1. Add `opossum` to dependencies.
2. Create circuit-breaker-wrapped client wrappers for: Paystack (`initiateTransfer`, `verifyTransfer`), Expo Push (`sendPushNotification`), and the active Realtime provider.
3. Configure each breaker: `timeout: 10000`, `errorThresholdPercentage: 50`, `resetTimeout: 30000` (30s half-open probe).
4. In `lib/payments/payouts.ts`, refactor `attemptTransfer` to call Paystack AFTER releasing the database transaction — not inside it. Current code holds a DB connection open during the HTTP call to Paystack.
5. Add circuit state metrics to the daily CRON health check response.

**Files to change:**
- New: `apps/web/lib/payments/circuit.ts`
- `apps/web/lib/payments/payouts.ts`
- `apps/web/lib/payments/paystack.ts`
- Push notification service file

---

### P2 — Medium (Systemic — Ongoing)

---

#### FIX-30 — SYS-05: Expand test coverage to financial engines and webhook handlers

**Prioritized test list (highest financial risk first):**

1. **Webhook idempotency tests** (`app/api/economy/webhooks/paystack/route.ts`, `dodopayments/route.ts`):
   - Duplicate event with same reference → must credit only once
   - Invalid signature → must return 401, no DB writes
   - Each payment event type (charge.success, transfer.success, transfer.failed)
   - Zero-amount pack → must throw

2. **Payout state machine tests** (`lib/payments/payouts.ts`):
   - Pending → processing → completed happy path
   - Retry exhaustion → DLQ
   - Concurrent CRON runs don't double-process (use real transaction + FOR UPDATE SKIP LOCKED with two concurrent test clients)

3. **Ledger integrity tests** (extend `lib/economy/__tests__/`):
   - `transferCoins` with custom transaction types records correct ledger entries
   - `creditCoins` + `debitCoins` under concurrency: balance never negative, sum of ledger = final balance

4. **Quest engine tests** (`lib/quests/questEngine.ts`):
   - `generateDailyDeck` per plan tier (free=3, plus=4, pro=5, max=6)
   - Plan hierarchy: pro sees plus-tier quests after BUG-QS01 fix
   - `checkDeckCompletion` idempotency: completing twice doesn't double-award

5. **War reward distribution tests** (`lib/guilds/warEngine.ts`):
   - `distributeWarRewards` coin splits sum to exactly `WAR_WIN_TREASURY_COINS`
   - `resolveWar` concurrent call: second call throws "already resolved"

**Files to add:**
- `apps/web/app/api/economy/webhooks/__tests__/paystack.test.ts`
- `apps/web/app/api/economy/webhooks/__tests__/dodopayments.test.ts`
- `apps/web/lib/payments/__tests__/payouts.test.ts`
- `apps/web/lib/quests/__tests__/questEngine.test.ts`
- `apps/web/lib/guilds/__tests__/warEngine.test.ts`

---

### P3 — Low (Fix When Convenient)

---

#### FIX-19 — BUG-NE01: Use proper parameterized UUID array in `compareNemesisProgress`

**Steps:**
1. In `lib/nemesis/nemesisEngine.ts`, change the query and params in `compareNemesisProgress`:
   - Query: `WHERE id = ANY(ARRAY[$1::uuid, $2::uuid])`
   - Params: `[userId, nemesisId]` (two separate string params, not a `{a,b}` literal)

**Files to change:**
- `apps/web/lib/nemesis/nemesisEngine.ts`

---

#### FIX-20 — BUG-FD01: Replace string-concatenated INTERVAL in fraud detection

**Steps:**
1. In `lib/fraud/payouts.ts`, in `checkNewAccountGiftInflow`, change `($2 || ' days')::INTERVAL` to `INTERVAL '7 days'` (hardcoded) and remove the `$2` parameter from this specific query, since `NEW_ACCOUNT_AGE_DAYS` is a module constant.

**Files to change:**
- `apps/web/lib/fraud/payouts.ts`

---

#### FIX-21 — BUG-GE01: Improve IP anomaly detection from /8 to /24 prefix comparison

**Steps:**
1. In `lib/security/geoAnomaly.ts`, change the IP comparison logic from `ip.split('.')[0]` to `ip.split('.').slice(0, 3).join('.')` (compare /24 prefix).
2. Update the Redis key format accordingly so existing /8-keyed entries don't interfere.
3. Optionally, integrate MaxMind GeoLite2 city database for country-level detection on a future sprint.

**Files to change:**
- `apps/web/lib/security/geoAnomaly.ts`

---

#### FIX-22 — BUG-MD02: Apply Unicode normalization to `detectDuplicateMessage`

**Steps:**
1. In `lib/moderation/contentFilter.ts`, in the `detectDuplicateMessage` normalization function, prepend `text.normalize('NFKD')` before the `.replace(/[^a-z0-9 ]/gi, '')` step.
2. Add a transliteration step for common Cyrillic/Greek homoglyphs (map е→e, а→a, о→o, с→c, р→r, etc.) before normalization.
3. Run existing tests against the updated normalization to verify no regressions.

**Files to change:**
- `apps/web/lib/moderation/contentFilter.ts`

---

## Implementation Order Summary

| Order | Fix ID | Item | Priority | Est. Effort |
|---|---|---|---|---|
| 1 | FIX-01 | BUG-SE01: Field encryption key versioning | P0 | Large |
| 2 | FIX-02 | BUG-PY01: Payout reconciliation locking | P0 | Small |
| 3 | FIX-03 | BUG-EC02: first_time_gifted atomicity | P0 | Medium |
| 4 | FIX-23 | BUG-CR01: Leaderboard CRON rank detection | P0 | Small |
| 5 | FIX-04 | BUG-SW01: SW cache TTL | P1 | Small |
| 6 | FIX-05 | BUG-AU01: Telegram refresh token | P1 | Small |
| 7 | FIX-06 | BUG-WH01: system_alerts column names | P1 | Small |
| 8 | FIX-24 | BUG-CR02: Leaderboard CRON all 7 tracks | P1 | Small |
| 9 | FIX-25 | BUG-RL01: Notifications rate limiting | P1 | XSmall |
| 10 | FIX-07 | BUG-GW01: War opponent locking | P1 | Medium |
| 11 | FIX-08 | BUG-RM01: Filter pending messages | P1 | Small |
| 12 | FIX-09 | BUG-DM01: UUID cast in DM upsert | P1 | Small |
| 13 | FIX-10 | BUG-EC01: transferCoins type params | P1 | Medium |
| 14 | FIX-11 | BUG-RF01: Referral xp_social column | P1 | Small |
| 15 | FIX-12 | BUG-QS01: Quest plan hierarchy | P1 | Small |
| 16 | FIX-26 | SYS-01: XP dead-letter queue | P1 | Large |
| 17 | FIX-27 | SYS-02: Ledger reconciliation CRON | P1 | Medium |
| 18 | FIX-28 | SYS-03: Structured logging + request IDs | P1 | Medium |
| 19 | FIX-13 | BUG-WH02: star_pack zero guard | P2 | XSmall |
| 20 | FIX-14 | BUG-LB01: XP normalization cap | P2 | Small |
| 21 | FIX-15 | BUG-LB02: HoF real rank | P2 | Small |
| 22 | FIX-16 | BUG-MD01: Wordlist TTL | P2 | Medium |
| 23 | FIX-17 | BUG-SS01: updated_at in milestone | P2 | XSmall |
| 24 | FIX-18 | BUG-AU02: TOTP replay key cleanup | P2 | XSmall |
| 25 | FIX-29 | SYS-04: Circuit breakers for external APIs | P2 | Large |
| 26 | FIX-30 | SYS-05: Test coverage expansion | P2 | XLarge |
| 27 | FIX-19 | BUG-NE01: UUID array param | P3 | XSmall |
| 28 | FIX-20 | BUG-FD01: Hardcode INTERVAL | P3 | XSmall |
| 29 | FIX-21 | BUG-GE01: /24 IP comparison | P3 | Small |
| 30 | FIX-22 | BUG-MD02: Unicode normalization | P3 | Small |

---

*Plan generated: June 14, 2026, 12:00 PM UTC*  
*Updated: June 14, 2026, 10:30 AM UTC*  
*Analyst: Claude Code — Repository: nero1/zobia*
