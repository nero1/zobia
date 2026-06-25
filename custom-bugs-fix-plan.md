# Zobia Bug Fix Plan
**Generated:** June 25, 2026 07:02 AM UTC
**Branch:** claude/codebase-bug-analysis-79eghw
**Status:** AWAITING REVIEW — do not begin implementation until approved

---

## Execution Order

Fixes are grouped by priority and dependency. Complete each group before starting the next. Groups within the same phase can be worked in parallel if multiple engineers are available.

---

## Phase 1 — Critical: Schema & Auth (Fix First, Everything Else Depends on These)

### Task 1 — BUG-SCHEMA-02: Add missing `subscriptions` table
**Priority:** P0 — all Paystack subscription webhooks crash without this
**Files to edit:**
- `apps/web/lib/db/schema.ts` — add table definition
- Create new Drizzle migration

**Steps:**
1. Add `subscriptions` table to schema with columns: `id` (uuid pk), `user_id` (uuid fk → users), `paystack_subscription_code` (text unique), `paystack_customer_code` (text), `plan` (text), `status` (text), `starts_at` (timestamp), `ends_at` (timestamp nullable), `next_payment_date` (timestamp nullable), `created_at` (timestamp defaultNow), `updated_at` (timestamp)
2. Run `drizzle-kit generate` to produce migration SQL
3. Apply migration to dev DB
4. Confirm `paystackWebhookHandler.ts` subscription insert no longer throws

---

### Task 2 — BUG-SCHEMA-01: Add `slug` column to `sticker_packs` table
**Priority:** P0 — `claimPassMilestone` crashes for sticker pack reward type
**Files to edit:**
- `apps/web/lib/db/schema.ts`
- Create new Drizzle migration

**Steps:**
1. Add `slug: text('slug').notNull().unique()` to the `sticker_packs` table definition
2. Generate and apply migration
3. Back-fill slug values for any existing rows (use name-based slug generation e.g. `lower(replace(name, ' ', '-'))`)
4. Confirm `seasonEngine.ts` sticker pack query works

---

### Task 3 — BUG-AUTH-02: Block `pre_auth` tokens in edge middleware
**Priority:** P0 — security bypass; 2FA can be circumvented entirely
**Files to edit:**
- `apps/web/middleware.ts`

**Steps:**
1. Locate the app/protected-route branch (the block that checks `payload?.sub`)
2. Immediately after the `payload` is decoded and `sub` is verified, add: `if (payload.type === 'pre_auth') { return redirectToLogin(request) }` (or return a 401 response)
3. Confirm that a `pre_auth` token cannot access `/app/*` routes
4. Confirm that a `pre_auth` token still works at the 2FA endpoint (that path should remain unaffected)

---

### Task 4 — BUG-SCHEMA-04: Add `created_at` column to `conversationScores` table
**Priority:** P1 — any insert or query referencing this column throws
**Files to edit:**
- `apps/web/lib/db/schema.ts`
- Create new Drizzle migration

**Steps:**
1. Add `createdAt: timestamp('created_at').defaultNow().notNull()` to `conversationScores`
2. Generate and apply migration
3. Search codebase for all references to `conversation_scores.created_at` and verify they are compatible

---

### Task 5 — BUG-SCHEMA-05: Verify/fix functional expression index on `rooms` table
**Priority:** P1 — `createSeasonCeremonyRoom` ON CONFLICT may silently insert duplicates
**Files to edit:**
- `apps/web/lib/db/schema.ts`
- Possibly a raw SQL migration file

**Steps:**
1. Inspect the generated Drizzle migration SQL for the `rooms` table functional index
2. If the index SQL is `CREATE UNIQUE INDEX ... ON rooms (metadata->>'season_ceremony_id')` without the extra parentheses, it is incorrect PostgreSQL syntax for a functional index and must be `((metadata->>'season_ceremony_id'))`
3. If incorrect: remove the inline Drizzle index definition, add a raw SQL migration: `CREATE UNIQUE INDEX IF NOT EXISTS rooms_season_ceremony_id_unique ON rooms ((metadata->>'season_ceremony_id')) WHERE metadata->>'season_ceremony_id' IS NOT NULL;`
4. Confirm the index is created by querying `pg_indexes` in dev DB

---

## Phase 2 — High: Data Integrity Bugs

### Task 6 — BUG-WEBHOOK-02: Fix `subscription.disable` setting `ends_at = NULL`
**Priority:** P1 — users retain premium access indefinitely
**Files to edit:**
- `apps/web/lib/payments/paystackWebhookHandler.ts`

**Steps:**
1. Locate `processSubscriptionEvent` case for `subscription.disable`
2. Replace `ends_at = data.next_payment_date ?? NULL` with: if `next_payment_date` is present use it; if absent set `ends_at = NOW()` (immediately deactivate)
3. Add a `logger.warn` when the fallback is triggered so ops can investigate missing date cases
4. Test with a mock `subscription.disable` payload that omits `next_payment_date`

---

### Task 7 — BUG-SEASON-01: Fix `resetSeasonRankings` corrupting concurrent active season
**Priority:** P1 — zeroes `season_xp` for users who may be active in another season
**Files to edit:**
- `apps/web/lib/seasons/seasonEngine.ts`
- `apps/web/lib/db/schema.ts` (potentially)

**Steps:**
Option A (recommended long-term): Add a `user_season_stats` table with `(user_id, season_id, season_xp)` and move per-season XP tracking there. Modify `resetSeasonRankings` to archive stats then zero only in this table.
Option B (quick fix): Before zeroing `users.season_xp`, query for any currently active season. If one exists, do NOT zero `season_xp` — log a warning and abort the reset, requiring a manual process when no concurrent season is active.
Implement Option A if time allows; Option B as an immediate safeguard.

---

### Task 8 — BUG-QUEST-01: Fix `checkDeckCompletion` false-positive on unstarted quests
**Priority:** P1 — incorrect deck-complete bonuses awarded
**Files to edit:**
- `apps/web/lib/quests/questEngine.ts`

**Steps:**
1. Rewrite the `checkDeckCompletion` query so `total` = the count of all quests in `user_quest_decks` for the given user and date (regardless of whether a progress row exists)
2. `completed` = count of quests where `user_quest_progress.progress >= quest.target` (via LEFT JOIN)
3. Simplest approach: two separate queries — `SELECT COUNT(*) FROM user_quest_decks WHERE user_id=$1 AND date=$2` for total, and the existing joined query for completed
4. Test: create a deck with 3 quests, complete 2, leave 1 unstarted — confirm deck is NOT considered complete

---

### Task 9 — BUG-PAYOUT-01: Fix over-credit in `moveToDeadLetterQueue` earnings restoration
**Priority:** P1 — creators over-credited by platform fee amount on failed payouts
**Files to edit:**
- `apps/web/lib/payments/payouts.ts`

**Steps:**
1. Locate `moveToDeadLetterQueue` earnings restoration logic
2. Remove the `?? gross_kobo` fallback — `net_kobo` must always be present for a restoration to proceed
3. If `net_kobo` is null: log `logger.error`, write to a `payout_audit_alerts` table (or equivalent), and do NOT restore earnings — require manual review
4. Add a migration or data fix to back-fill any existing `failed_payout` rows that have null `net_kobo`

---

### Task 10 — BUG-COMMISSIONS-01: Pass transaction client to `safeAwardXP` in commission awards
**Priority:** P1 — XP award escapes transaction, phantom DLQ entries on rollback
**Files to edit:**
- `apps/web/lib/referrals/commissions.ts`

**Steps:**
1. `awardReferralCommissions(db, buyerId, ...)` — when this function is called with a transaction `db` client, the `safeAwardXP` calls for tier-1 and tier-2 XP must also receive that same client
2. Pass `db` as the last argument to both `safeAwardXP(tier1Id, xpBonus, ..., db)` calls
3. Confirm that `safeAwardXP`'s function signature accepts and uses an optional `dbClient` parameter (it already does per the existing implementation)
4. Test: trigger a referral commission that rolls back mid-transaction — confirm no orphaned XP or DLQ records

---

### Task 11 — BUG-SEASON-02: Fix subscription stars dedup key using wall-clock month
**Priority:** P2 — duplicate stars possible on webhook retry near month boundary
**Files to edit:**
- `apps/web/lib/seasons/seasonEngine.ts`

**Steps:**
1. Locate subscription star award logic and the dedup key construction
2. Replace `new Date().toISOString().slice(0, 7)` with the event's own `paid_at` or `created_at` timestamp (available in the Paystack webhook payload)
3. Ensure the event timestamp is passed through to the function that constructs the dedup key
4. Test: simulate a webhook arriving December 1 for a November 30 payment — confirm no double-credit

---

### Task 12 — BUG-MANIFEST-01: Fix war cooldown manifest key name and type parsing
**Priority:** P2 — war cooldown admin configuration permanently ignored
**Files to edit:**
- `apps/web/lib/guilds/warEngine.ts`

**Steps:**
1. Change `getManifestValue('warCooldownHours')` to `getManifestValue('war_event_cooldown_hours')`
2. Replace `typeof manifestCooldown === 'number'` check with: `const parsed = manifestCooldown ? parseInt(manifestCooldown, 10) : NaN; if (!isNaN(parsed) && parsed > 0) { cooldownHours = parsed; }`
3. Both changes must be applied together
4. Test: set `war_event_cooldown_hours = 48` in the manifest DB and confirm war matching respects the 48-hour window

---

## Phase 3 — Medium: Security Hardening

### Task 13 — BUG-AUTH-03: Add TOTP replay protection
**Priority:** P2 — same OTP code reusable for 90 seconds
**Files to edit:**
- `apps/web/lib/auth/totp.ts`
- `apps/web/lib/auth/` (wherever `verifyTotp` is called — add Redis client access)

**Steps:**
1. On successful TOTP verification, store a Redis key: `totp_used:{userId}:{counter}` with TTL of 90 seconds
2. At the start of each `verifyTotp` call, check Redis for each counter in the delta window before accepting it
3. If any matching `totp_used` key exists, reject with an error indicating code was already used
4. Requires `redis` client to be passed into (or imported by) `verifyTotp` — update the function signature accordingly
5. Confirm: using the same OTP twice within 90 seconds returns an error on the second attempt

---

### Task 14 — BUG-WEBHOOK-01: Log missing payment record in `processChargeSuccess`
**Priority:** P2 — silent data inconsistency, invisible in production
**Files to edit:**
- `apps/web/lib/payments/paystackWebhookHandler.ts`

**Steps:**
1. Locate the early-return path in `processChargeSuccess` where no payment record matches the reference
2. Replace the silent return with: `logger.error({ reference, amount, channel }, '[paystack] charge.success received but no matching payment record found')`
3. Consider also writing a record to a `webhook_anomalies` table for reconciliation
4. For charges above a configurable threshold (e.g. 10,000 kobo), also trigger a system alert

---

## Phase 4 — Medium: Financial Precision

### Task 15 — BUG-SCHEMA-03: Fix bigint mode on financial columns
**Priority:** P2 — IEEE 754 precision loss on coin values above 2^53
**Files to edit:**
- `apps/web/lib/db/schema.ts`
- All files that read from these columns (audit required)

**Steps:**
1. Change the following columns to `{ mode: "bigint" }`:
   - `brandedRooms.sponsorBudgetCoins`
   - `giftItems.coinCost`
   - `gifts.coinValue`
   - `gifts.coinCost`
   - `failedCommissions.coinAmount`
   - `failedCommissions.amountKobo`
2. Grep for all TypeScript files that read these columns and update types from `number` to `bigint`
3. Verify arithmetic on these values uses BigInt-safe operations (no `+`, `-`, `*` with mixed types)
4. No migration SQL needed — only the TypeScript type mode changes

---

## Phase 5 — Low: Observability & Code Quality

### Task 16 — BUG-PAYOUT-02: Add logging to weekly payout error handler
**Priority:** P3
**Files to edit:**
- `apps/web/app/api/cron/daily-economy/route.ts`

**Steps:**
1. Find `} catch { /* Non-fatal per-creator */ }` in the Friday payout loop
2. Replace with: `} catch (err) { logger.error({ err, creatorId }, '[payout] Weekly automated payout failed') }`
3. Optionally increment a failure counter and emit an alert if total failures exceed 10% of processed creators

---

### Task 17 — BUG-CRON-01: Replace `console.error` with `logger` in referral streak block
**Priority:** P3
**Files to edit:**
- `apps/web/app/api/cron/daily-economy/route.ts`

**Steps:**
1. Find `console.error(...)` in the referral streak-qualification block
2. Replace with `logger.error({ err, userId, referralId }, '[cron] Referral streak qualification failed')`
3. Confirm no other `console.log/error/warn` calls exist in this file (audit for consistency)

---

### Task 18 — BUG-PUSH-01: Fix `pollPushReceipts` early return skipping DB cleanup
**Priority:** P3
**Files to edit:**
- `apps/web/lib/notifications/push.ts`

**Steps:**
1. Locate the `return 0` inside the `try` block for the empty-tickets case
2. Move the DB cleanup query (deletes old resolved ticket rows) to before the `return 0`
3. Alternatively, extract cleanup into its own `finally` block so it always runs regardless of ticket count
4. Test: run `pollPushReceipts` when ticket table is empty — confirm old resolved rows are still purged

---

### Task 19 — BUG-SESSION-01: Wire manifest session TTLs into JWT signing
**Priority:** P3
**Files to edit:**
- `apps/web/lib/auth/jwt.ts`
- The auth flow that calls signing functions (likely in the login/refresh route handlers)

**Steps:**
1. In the login/refresh handlers, after fetching the user's role, call `getManifestValue('session_ttl_{role}')` (or the equivalent structured manifest lookup)
2. Parse the returned string to a number and pass it as the `ttlSeconds` argument to `signAccessToken` / `signRefreshToken`
3. Keep the hardcoded constants in `jwt.ts` as fallback defaults (they are appropriate defaults if the manifest is unavailable)
4. Test: set a custom TTL in the manifest for the admin role and confirm issued tokens have the configured lifetime

---

### Task 20 — BUG-GEO-01: Remove dead parameters from `runGeoAnomalyCheck`
**Priority:** P3
**Files to edit:**
- `apps/web/lib/api/middleware.ts`

**Steps:**
1. If geo anomaly checking is meant to use DB/Redis: implement the intended lookup (read prior IPs from DB, flag anomaly in Redis) and rename parameters from `_db`/`_redis` to `db`/`redis`
2. If geo anomaly checking will NOT use DB/Redis: remove the parameters from the function signature and update all call sites
3. Do not leave dead parameters in place — they confuse callers about the function's actual dependencies

---

### Task 21 — BUG-TYPE-01: Add proper types to `withAuth` and `withAdminAuth`
**Priority:** P3
**Files to edit:**
- `apps/web/lib/api/middleware.ts`

**Steps:**
1. Define `AuthContext` interface (e.g. `{ userId: string; sessionId: string; role: string; isAdmin: boolean }`)
2. Define handler type: `type AuthedHandler<C = AuthContext> = (req: NextRequest, ctx: C) => Promise<Response>`
3. Replace all `any` annotations in `withAuth` and `withAdminAuth` with these typed forms
4. Fix any TypeScript errors that surface in route handlers — these represent real type mismatches previously hidden by `any`

---

### Task 22 — BUG-PRIV-01: Encrypt offline SQLite message queue
**Priority:** P3 (compliance risk — implement before public launch if handling sensitive messages)
**Files to edit:**
- `apps/expo/lib/offline/sqlite.ts`
- `apps/expo/package.json` (add encryption library)

**Steps:**
1. Evaluate `expo-sqlite` encrypted mode or `react-native-sqlcipher-storage` as the encryption backend
2. Derive an encryption key from Android Keystore (use `expo-secure-store` to store the key, or use device-bound Android Keystore directly)
3. If full DB encryption is not feasible immediately: encrypt only the `content` column using AES-256-GCM with a key from secure storage; store `content` as base64-encoded ciphertext
4. Ensure the key is never stored in plaintext alongside the database file
5. Migration path: on first app open after the update, re-encrypt existing rows or delete and require re-send

---

## Verification Checklist (after all phases complete)

- [ ] All Paystack subscription webhook events process without DB errors
- [ ] `claimPassMilestone` works for sticker pack reward type
- [ ] `pre_auth` JWT tokens cannot access protected app routes
- [ ] Subscribing, then disabling subscription sets a concrete `ends_at` date
- [ ] `resetSeasonRankings` does not corrupt active concurrent season data
- [ ] `checkDeckCompletion` requires all deck quests to have progress rows before triggering bonus
- [ ] War cooldown reflects manifest config value, not only hardcoded constant
- [ ] All 6 financial columns return `bigint` type from Drizzle queries
- [ ] Referral commission XP award is rolled back together with commission on transaction failure
- [ ] Failed payouts restore exactly `net_kobo`, not `gross_kobo`
- [ ] Same TOTP code rejected on second use within 90 seconds
- [ ] Missing Paystack payment reference logs an error and does not silently succeed
- [ ] `roomPinLimit` functional index confirmed in `pg_indexes`
- [ ] Weekly payout failures appear in structured logs
- [ ] `pollPushReceipts` runs cleanup even with empty ticket batch
- [ ] Manifest session TTL changes take effect on next token issue

---

*Fix plan generated by forensic codebase analysis.*
*June 25, 2026 07:02 AM UTC*
