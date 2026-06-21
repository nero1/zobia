# Zobia Codebase Bug Fix Plan

**Date:** 2026-06-21  
**Time:** 06:45 AM UTC  
**Branch:** `claude/codebase-bug-analysis-dg2cph`  
**Total Bugs:** 40  
**Reference:** `custom-bugs-report.md`

---

## Execution Strategy

Fix in four phases ordered by risk profile: **security/data-integrity first**, then **correctness bugs**, then **performance**, then **maintenance/cleanup**. Within each phase, fix schema-level changes before application-level changes that depend on them. Run the full test suite between phases.

---

## Phase 1 — Critical: Security & Data Integrity (Fix First)

### Task 1.1 — SCHEMA-01: Add login_streak_days to Drizzle schema
**Bug:** `login_streak_days` column exists in the DB but is missing from `schema.ts`, causing Drizzle to silently ignore it.  
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/lib/db/migrations/` (new migration)  
**Steps:**
1. Add `loginStreakDays: integer("login_streak_days").notNull().default(0)` to the `users` table in `schema.ts`.
2. Remove or alias the redundant `loginStreak: integer("login_streak")` field — decide whether both columns should exist or if one should be deprecated. If `login_streak` is the old column and `login_streak_days` is the canonical one, mark `login_streak` deprecated in the schema and generate a migration to drop it after verifying no code reads from it.
3. Generate migration: `pnpm drizzle-kit generate`.
4. Update all callers (`daily-core/route.ts`, `daily-economy/route.ts`, `daily-notify/route.ts`, `login/daily/route.ts`) to use the Drizzle field name consistently.

---

### Task 1.2 — SEC-01: Replace timing-unsafe CSRF cron bypass with timingSafeEqual
**Bug:** `middleware.ts` compares `CRON_SECRET` via `===` string comparison (timing-unsafe), bypassing the canonical `timingSafeEqual` in `lib/cron/auth.ts`.  
**Files:** `apps/web/middleware.ts`, `apps/web/lib/cron/auth.ts`  
**Steps:**
1. In `isCsrfSafe()` inside `middleware.ts`, replace the `authHeader === \`Bearer ${process.env.CRON_SECRET}\`` check with `validateCronSecret(request)` imported from `@/lib/cron/auth`.
2. Import the canonical module at the top of `middleware.ts`.
3. Verify the CRON auth path is covered by an integration test that proves timing-safe comparison is used.

---

### Task 1.3 — NULLABLE-01: Guard is_banned NULL in all SQL WHERE clauses
**Bug:** `is_banned` column lacks `.notNull()` constraint, so `is_banned = FALSE` can return wrong results for NULL rows; only some files use `COALESCE(is_banned, false)`.  
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/app/api/economy/gifts/send/route.ts`, `apps/web/app/api/cron/leaderboards/route.ts`, all other files using `is_banned = FALSE` in raw SQL  
**Steps:**
1. Add `.notNull().default(false)` to `isBanned` in `schema.ts` and generate a migration that sets `UPDATE users SET is_banned = false WHERE is_banned IS NULL` before adding the NOT NULL constraint.
2. Search codebase for `is_banned = FALSE` and `is_banned = false` in raw SQL strings; replace each with `COALESCE(is_banned, false) = false` (or just `is_banned IS NOT TRUE`) until the migration runs.
3. After migration lands in production, the COALESCE guards become no-ops but keep them for safety.

---

### Task 1.4 — RACE-01: Fix duplicate gifts row on concurrent send
**Bug:** Redis idempotency key is set AFTER the transaction commits, creating a window where two concurrent requests both pass the key check and create duplicate `gifts` rows.  
**Files:** `apps/web/app/api/economy/gifts/send/route.ts`  
**Steps:**
1. Add `ON CONFLICT (sender_id, recipient_id, reference_id) DO NOTHING` to the `gifts` INSERT (requires a unique composite index on `(sender_id, recipient_id, reference_id)`; generate a migration for this index).
2. Move the Redis idempotency key `SET NX` to BEFORE the database transaction begins, and delete the key if the transaction rolls back (wrap in try/finally).
3. Alternatively, use `SET NX EX 60` on the idempotency key before the transaction so it acts as a distributed mutex.

---

### Task 1.5 — PAY-01: Fix Paystack transfer_code vs reference lookup mismatch
**Bug:** Paystack webhook handler uses `transfer_code` to look up pending payouts, but the payout row stores `reference` — causing every payout webhook to "not find" the payout and fall through.  
**Files:** `apps/web/lib/payments/paystackWebhookHandler.ts`  
**Steps:**
1. Read the full handler and confirm whether the payout row stores `reference` or `transfer_code` (check schema `payouts` table in `schema.ts`).
2. Change the WHERE clause to match on the correct column (likely `reference = data.reference` for `transfer.success` / `transfer.failed` events).
3. Add a test for each Paystack transfer webhook event type that verifies the correct column is used.

---

### Task 1.6 — IAP-01: Validate packageName against expected bundle ID in IAP verify
**Bug:** `body.packageName` passed directly into the Google Play API URL without checking it matches the app's actual bundle ID; attacker can probe other apps' subscriptions.  
**Files:** `apps/web/app/api/economy/iap/verify/route.ts`  
**Steps:**
1. Add `const EXPECTED_PACKAGE_NAME = process.env.GOOGLE_PLAY_PACKAGE_NAME ?? 'com.zobia.app';` at the top of the handler.
2. Before constructing the API URL, assert `if (body.packageName !== EXPECTED_PACKAGE_NAME) return 400 Bad Request`.
3. Set `GOOGLE_PLAY_PACKAGE_NAME` in all environment configs and Vercel environment variables.

---

### Task 1.7 — AUDIT-01: Log and alert before auto-correcting balances; require ops approval for large deltas
**Bug:** `reconcile-balances` cron silently decreases user balances up to `AUTO_CORRECT_THRESHOLD` (50 coins) without logging or alerting; legitimate balances can be quietly erased.  
**Files:** `apps/web/app/api/cron/reconcile-balances/route.ts`  
**Steps:**
1. Before any auto-correction, write a `system_alerts` row with type `'balance_auto_correction'`, severity `'warning'`, including `userId`, `expected`, `actual`, `delta`.
2. Add an OPS-01 alert (separate task, see Task 2.3) for discrepancies that exceed a configurable high-water mark (e.g., 1000 coins or 1% of ledger total).
3. Consider splitting auto-correct into two regimes: small deltas (≤ threshold, auto-correct + log) and large deltas (> threshold, alert + hold for manual review).

---

### Task 1.8 — PAY-02: Make creator_earnings INSERT idempotent in DodoPay room_subscription handler
**Bug:** `dodoWebhookHandler.ts` room_subscription path INSERTs into `creator_earnings` without `ON CONFLICT DO NOTHING`; webhook replays create duplicate earnings rows.  
**Files:** `apps/web/lib/payments/dodoWebhookHandler.ts`  
**Steps:**
1. Add `ON CONFLICT (reference_id) DO NOTHING` to the `creator_earnings` INSERT in the `room_subscription` event handler (the unique index on `reference_id` already exists per SCHEMA-07 analysis).
2. While adding the ON CONFLICT guard, also address SCHEMA-07 (see Task 3.5) by replacing the lone `reference_id` unique index with a `(creator_id, reference_id)` composite unique index first, then update the ON CONFLICT clause to match.

---

## Phase 2 — High: Correctness Bugs

### Task 2.1 — AUTH-01: Fix session refresh race within 30s grace window
**Bug:** Two concurrent requests during the 30s refresh grace window can both read the same refresh token as valid, race to create two new session rows, and issue two new token pairs.  
**Files:** `apps/web/app/api/auth/refresh/route.ts`, `apps/web/lib/auth/session.ts`  
**Steps:**
1. Wrap the refresh logic in a Redis distributed lock keyed on the refresh token (`SET refresh_lock:<tokenHash> NX EX 5`).
2. The first request acquires the lock, rotates the token, and releases the lock. Concurrent requests that fail to acquire the lock return 429 or retry-after to the client.
3. Alternatively, perform the session lookup with a DB-level `SELECT ... FOR UPDATE` on the session row so only one transaction can proceed through the rotation.

---

### Task 2.2 — AUTH-02: Reduce banned-user Redis cache TTL
**Bug:** Banned users are cached in Redis for 30s; they can continue making requests for up to 30 seconds after being banned.  
**Files:** `apps/web/lib/auth/session.ts`  
**Steps:**
1. Reduce the cache TTL for user profile lookups (especially the `is_banned` field) from 30s to 5s, or invalidate the Redis key immediately when `is_banned` is set to `true` via the admin ban endpoint.
2. The ban endpoint (`app/api/admin/users/[userId]/ban/route.ts`) should call `redis.del(\`user:\${userId}:profile\`)` (or equivalent key) immediately after updating the DB.

---

### Task 2.3 — OPS-01: Alert on large balance discrepancies in reconcile-balances
**Bug:** `reconcile-balances` cron logs all discrepancies but never raises a `system_alert`; large discrepancies (potential fraud or ledger corruption) go unnoticed.  
**Files:** `apps/web/app/api/cron/reconcile-balances/route.ts`  
**Steps:**
1. After computing `delta` for each user, if `Math.abs(delta) > ALERT_THRESHOLD` (e.g., 500 coins), INSERT a `system_alerts` row with type `'balance_discrepancy_large'` and severity `'critical'`.
2. Add a counter to the cron response payload: `{ checked, corrected, alerts_raised }`.

---

### Task 2.4 — LB-01: Fix Hall of Fame injection condition (off-by-one)
**Bug:** `injectHofEntries` in `seasonEngine.ts` checks `if (result.length >= 10)` BEFORE injecting, so HoF entries are only injected when the live top-10 is already full — the opposite of the intended "fill the bottom" behavior.  
**Files:** `apps/web/lib/seasons/seasonEngine.ts`  
**Steps:**
1. Change the guard condition to `if (result.length < 10)` so HoF entries are injected when there are fewer than 10 live entries on the leaderboard.
2. Re-read the surrounding logic to confirm the injection respects `hofLimit` and doesn't duplicate existing users (users already in the live list should not appear again via HoF injection).

---

### Task 2.5 — LB-02: Fix season top-100 badge exclusion of ranks 1-10
**Bug:** Season-end badge logic awards the "top-100" badge only to ranks 11-100, explicitly excluding ranks 1-10 (which already get a "top-10" badge); but ranks 1-10 should also receive the top-100 badge since they satisfy the top-100 criterion.  
**Files:** `apps/web/lib/seasons/seasonEngine.ts`  
**Steps:**
1. Change the badge condition from `rank > 10 && rank <= 100` to `rank >= 1 && rank <= 100` (or simply `rank <= 100`).
2. Verify top-10 badge logic separately awards the "top-10" badge for `rank <= 10` and that both badges can coexist.

---

### Task 2.6 — LB-03: Fix getLeaderboard total count excluding HoF-injected entries
**Bug:** The total count returned from `getLeaderboard` comes from a COUNT query that does not include HoF-injected rows; pagination metadata is incorrect when HoF entries are present.  
**Files:** `apps/web/lib/leaderboards/engine.ts`  
**Steps:**
1. After HoF injection, recalculate `total` as `liveCount + hofEntriesInjected` rather than using the pre-injection COUNT.
2. Update the return type to make the distinction between `liveCount` and `total` clear.

---

### Task 2.7 — RACE-02: Add FOR UPDATE to alliance war resolution query
**Bug:** Alliance war resolution reads both guilds' XP totals without locking, so concurrent score updates during the final resolution window can corrupt war outcomes.  
**Files:** `apps/web/lib/guilds/warEngine.ts`  
**Steps:**
1. Wrap the alliance war score resolution in a transaction.
2. Use `SELECT ... FOR UPDATE` on both guild_wars rows (or both guild rows) to serialize concurrent resolution attempts.
3. Check whether the war resolution is already guarded by a distributed lock elsewhere; if so, rely on that lock instead of FOR UPDATE.

---

### Task 2.8 — GUILD-01: Consolidate guild tier enforcement into a single authoritative column
**Bug:** Guild tier demotion logic writes to two different columns in two different cron jobs (`tier_level` in `daily-guilds` and `tier` in `guild-wars`); they can diverge and produce conflicting tier states.  
**Files:** `apps/web/app/api/cron/daily-guilds/route.ts`, `apps/web/app/api/cron/guild-wars/route.ts`, `apps/web/lib/db/schema.ts`  
**Steps:**
1. Decide which column is canonical (`tier_level` integer or `tier` string). Check all read sites to understand which one UI/API uses.
2. Generate a migration to drop the non-canonical column after backfilling it.
3. Update both cron jobs to write only to the canonical column.
4. Add a DB-level check constraint that only valid tier values are stored.

---

### Task 2.9 — GUILD-02: Include departed members' XP in alliance war scoring
**Bug:** Alliance war XP aggregation filters on `gm.status = 'active'`, excluding members who left the guild mid-war; their earned war-period XP is lost from the guild's score.  
**Files:** `apps/web/lib/guilds/warEngine.ts`  
**Steps:**
1. Change the war XP query to aggregate XP earned between `war.started_at` and `war.ended_at` (or NOW()) for ALL members who were part of the guild at any point during the war, not just currently active members.
2. This requires either: (a) snapshotting member rosters at war start, or (b) joining against guild membership audit rows to include historical members.
3. The simplest fix: join `guild_members` without the `status = 'active'` filter, but add a condition `gm.joined_at <= war.ended_at` and either no `left_at` or `gm.left_at >= war.started_at`.

---

### Task 2.10 — QUEST-01: Include date in quest deck shuffle seed
**Bug:** Quest deck shuffle in `questEngine.ts` seeds with `MD5(CONCAT(userId, questId))` — date is excluded, so users see the same deck order every day.  
**Files:** `apps/web/lib/quests/questEngine.ts`  
**Steps:**
1. Change the shuffle seed query to `MD5(CONCAT(userId, questId, CURRENT_DATE::text))` so the shuffle changes each day.
2. Verify the daily quest reset (`resetDailyQuests`) runs before the deck generation call so the new day's seed applies to a freshly reset deck.

---

### Task 2.11 — NOTIF-01: Write guild war notifications to new format columns
**Bug:** Guild war CRON inserts notifications using only the legacy `payload` jsonb column; the frontend reads `title`/`body`/`metadata` columns and will not display these notifications.  
**Files:** `apps/web/app/api/cron/guild-wars/route.ts`  
**Steps:**
1. Update the notification INSERT to populate `title`, `body`, and `metadata` columns (in addition to or instead of `payload`).
2. Use the same pattern as other notification writers in the codebase (check `daily-notify/route.ts` or wherever the newer format is written correctly).
3. After the SCHEMA-06 migration (Task 3.4) is complete, remove the `payload` column writes.

---

### Task 2.12 — NOTIF-02: Fix re-engagement mark-as-sent UPDATE silently failing
**Bug:** In `daily-notify/route.ts`, after sending a re-engagement notification, the UPDATE to mark the user as notified can silently fail (the row doesn't exist or the WHERE clause is wrong); the next CRON run will re-notify the same users.  
**Files:** `apps/web/app/api/cron/daily-notify/route.ts`  
**Steps:**
1. Check the rowcount returned by the UPDATE. If `rowsAffected === 0`, log a warning with `userId` and skip incrementing the success counter.
2. Consider using an INSERT INTO a `notification_send_log` table instead of an UPDATE on the user row, so send history is append-only and can be queried.
3. Add a unique index on `(user_id, notification_type, sent_at::date)` to the notification log to prevent same-day duplicates even if the UPDATE fails.

---

### Task 2.13 — AUTH-03: Fix Expo signOut CSRF Origin mismatch
**Bug:** Expo app sends `Origin: <API_BASE_URL>` on all requests (including logout), but the CSRF middleware compares Origin against the web app URL; native app logouts are rejected with 403.  
**Files:** `apps/expo/lib/api/client.ts`, `apps/web/middleware.ts`  
**Steps:**
1. Add the Expo app's expected origin (`NEXT_PUBLIC_EXPO_ORIGIN` env var, e.g., `exp://`) to the CSRF allowlist in `isCsrfSafe()`.
2. Alternatively, for native app requests that carry a valid `Authorization: Bearer <token>` header, skip Origin CSRF check (Bearer tokens are not forgeable via cross-site form POSTs).
3. Document that the Origin header from Expo is `API_BASE_URL`, not the web app URL.

---

### Task 2.14 — DLQ-01: Guard DLQ entry creation with outer transaction state
**Bug:** `safeAwardXP` writes to `failed_xp_awards` using `globalDb` even when called inside a caller's transaction; if the caller rolls back, the DLQ entry describes XP that was never lost, causing phantom retry attempts.  
**Files:** `apps/web/lib/xp/safeAwardXP.ts`  
**Steps:**
1. Add an optional `skipDlq?: boolean` parameter for callers who pass their own `dbClient` (transaction).
2. Callers using their own transaction should pass `skipDlq: true` and handle DLQ writes themselves after committing.
3. Document the contract clearly: `safeAwardXP` with a transaction client should only be called post-commit, or the DLQ entry must be conditional on the transaction's outcome.

---

### Task 2.15 — OPS-02: Rate-limit geoAnomaly system_alert inserts
**Bug:** `geoAnomaly.ts` inserts a `system_alerts` row on EVERY anomaly detection, including repeated events from the same user; this can flood the alerts table.  
**Files:** `apps/web/lib/security/geoAnomaly.ts`  
**Steps:**
1. Before inserting a `system_alerts` row, check whether an alert for the same `(user_id, type)` was inserted within the last 24 hours (add a WHERE NOT EXISTS sub-query or use ON CONFLICT DO NOTHING with a partial unique index).
2. Alternatively, maintain a Redis key `geo_alert:<userId>` with 24h TTL; only INSERT into `system_alerts` if the key did not exist.

---

### Task 2.16 — SCHEMA-05: Fix referral_commissions.tier wrong default
**Bug:** `referral_commissions.tier` defaults to `'standard'` but no code path ever sets tier to 'standard'; valid values are `'tier1'` and `'tier2'`. Query filters using `tier = 'tier1'` will miss rows that were inserted with the wrong default.  
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/lib/referrals/commissions.ts`  
**Steps:**
1. Change the default to `'tier1'` in the schema (or remove the default entirely and require callers to always specify tier).
2. Generate a migration: `UPDATE referral_commissions SET tier = 'tier1' WHERE tier = 'standard'`.
3. Add a CHECK constraint `tier IN ('tier1', 'tier2')` in a follow-up migration.

---

### Task 2.17 — TYPE-01: Fix XP bigint/int[] type mismatch in leaderboards CRON
**Bug:** `leaderboards/route.ts` uses `unnest($3::int[])` for XP values but `leaderboard_snapshots.xp_value` is `bigint`; casting to `int[]` silently truncates scores above 2.1B.  
**Files:** `apps/web/app/api/cron/leaderboards/route.ts`  
**Steps:**
1. Change `$3::int[]` to `$3::bigint[]` in the bulk upsert query.
2. Verify the TypeScript types in the query builder also use `bigint` (not `number`) for XP arrays to prevent future regression.
3. Check all other places in the codebase where XP values are cast to int or int[] and update to bigint.

---

## Phase 3 — Medium: Schema, Schema Maintenance & Design Issues

### Task 3.1 — SCHEMA-02: Add session pruning to keep sessions table bounded
**Bug:** The `sessions` table accumulates expired rows indefinitely with no cleanup mechanism.  
**Files:** `apps/web/lib/auth/session.ts`, `apps/web/app/api/cron/daily-users/route.ts`  
**Steps:**
1. Add a cleanup step to `daily-users/route.ts` (or a dedicated CRON step): `DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '7 days'`.
2. Add a partial index `ON sessions (expires_at) WHERE expires_at IS NOT NULL` to make the delete efficient.
3. Consider using PostgreSQL `pg_partman` for automatic partition pruning on high-volume deployments.

---

### Task 3.2 — SCHEMA-03: Plan removal of deprecated userQuests table
**Bug:** The old `user_quests` table is retained in `schema.ts` alongside the newer `user_quest_progress` and `user_quest_decks` tables; no migration drops it.  
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/lib/db/migrations/`  
**Steps:**
1. Audit all API routes and service files for any remaining reads/writes to `user_quests`.
2. If no code references it, generate a migration: `DROP TABLE IF EXISTS user_quests`.
3. Remove the `userQuests` export from `schema.ts`.

---

### Task 3.3 — SCHEMA-04: Add DB-level sort order guarantee for DM conversations
**Bug:** `dm_conversations` message ordering depends on application-level ordering which can be inconsistent across queries.  
**Files:** `apps/web/lib/db/schema.ts`, relevant DM API routes  
**Steps:**
1. Add a `sequence_number bigserial` column to `dm_messages` and a composite index `(conversation_id, sequence_number)`.
2. All message list queries should `ORDER BY sequence_number ASC` instead of `created_at ASC` (sequence numbers are monotonic even under clock skew).
3. Alternatively, if `created_at` is sufficient, add a composite index `(conversation_id, created_at)` and enforce `ORDER BY created_at ASC, id ASC` in all queries.

---

### Task 3.4 — SCHEMA-06: Migrate notifications table to single format
**Bug:** `notifications` table has both a legacy `payload` jsonb column and newer `title`/`body`/`metadata` columns; the frontend reads only the new columns, silently dropping legacy notifications.  
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/app/api/cron/guild-wars/route.ts`, all notification writers  
**Steps:**
1. Write a one-time migration that copies data from `payload` into `title`/`body`/`metadata` for all rows where `title IS NULL`.
2. Add a check constraint or NOT NULL to `title` and `body` after the migration.
3. Update all writers to use the new columns (Task 2.11 covers guild-wars specifically; audit all other notification INSERT sites).
4. After verifying no code reads `payload`, generate a migration to drop the column.

---

### Task 3.5 — SCHEMA-07: Replace creator_earnings unique index to be (creator_id, reference_id)
**Bug:** `creator_earnings` has a unique index on `reference_id` alone; two different creators can never share a `reference_id` string, which is unnecessarily restrictive and can cause false conflict failures.  
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/lib/db/migrations/`  
**Steps:**
1. Generate a migration that: (a) drops the existing `creator_earnings_reference_id_unique` index, (b) creates a new `UNIQUE (creator_id, reference_id)` index.
2. Update any ON CONFLICT clause that references the old index to use the new column pair.
3. Verify idempotency guards in `dodoWebhookHandler.ts` use the new composite key (Task 1.8 handles this).

---

### Task 3.6 — DATA-01: Delete expired quest_progress rows
**Bug:** `resetDailyQuests` marks `user_quest_progress` rows as expired but never deletes them; the table grows indefinitely.  
**Files:** `apps/web/lib/quests/questEngine.ts`, `apps/web/app/api/cron/daily-core/route.ts`  
**Steps:**
1. Add a DELETE step after marking rows expired: `DELETE FROM user_quest_progress WHERE expires_at < NOW() - INTERVAL '30 days'` to retain recent history but prune stale rows.
2. Alternatively, archive to a `user_quest_progress_archive` table before deletion for analytics.
3. Add a partial index `ON user_quest_progress (expires_at) WHERE expires_at IS NOT NULL`.

---

## Phase 4 — Low: Performance & Maintenance

### Task 4.1 — MAINT-01: Centralize CRON secret validation across all cron files
**Bug:** 4+ cron files each have a local `isValidSecret` / `validateCronSecret` function instead of importing the canonical version from `lib/cron/auth.ts`.  
**Files:** `apps/web/app/api/cron/guild-wars/route.ts`, `apps/web/app/api/cron/leaderboards/route.ts`, `apps/web/app/api/cron/reconcile-balances/route.ts`, `apps/web/app/api/cron/games/route.ts`  
**Steps:**
1. In each of the four (or more) cron files, delete the local `isValidSecret` / `validateCronSecret` implementation.
2. Add `import { validateCronSecret } from "@/lib/cron/auth";` and replace each local call site.
3. Run a grep for `timingSafeEqual\|isValidSecret\|validateCronSecret` across `app/api/cron/` to catch any additional files.

---

### Task 4.2 — PERF-01: Bound monthly plan bonus bulk CTE
**Bug:** Monthly plan bonus processing uses an unbounded CTE that could timeout when large numbers of users are processed in one shot.  
**Files:** `apps/web/app/api/cron/daily-economy/route.ts` (or related monthly bonus file)  
**Steps:**
1. Add `LIMIT 500` to the bulk SELECT inside the CTE (or the driving query).
2. Record the last-processed user ID in a Redis key and paginate in a loop (`WHERE id > :lastId ORDER BY id LIMIT 500`) until no rows are returned.
3. Consider moving the monthly bonus to a background job queue instead of a single CRON transaction.

---

### Task 4.3 — PERF-02: Fix N+1 guild tier update loop in daily-guilds
**Bug:** `daily-guilds/route.ts` fetches all guilds and then runs one UPDATE per guild in a loop instead of a single bulk UPDATE.  
**Files:** `apps/web/app/api/cron/daily-guilds/route.ts`  
**Steps:**
1. Replace the loop with a single `UPDATE guilds SET tier_level = CASE id WHEN ... END WHERE id = ANY($1::uuid[])` (or an `UNNEST` + CTE pattern).
2. Alternatively, compute the new tier in a derived table and do a single `UPDATE guilds SET tier_level = derived.new_tier FROM (SELECT ...) AS derived WHERE guilds.id = derived.id`.

---

### Task 4.4 — PERF-03: Replace full-scan leaderboard reconciliation in daily-platform
**Bug:** `daily-platform/route.ts` leaderboard reconciliation queries all users unconditionally; this is a full table scan on the `users` table.  
**Files:** `apps/web/app/api/cron/daily-platform/route.ts`  
**Steps:**
1. Add a `WHERE updated_at > NOW() - INTERVAL '25 hours'` filter to catch only users whose XP changed since the last daily run (with a 1-hour buffer for clock drift).
2. Index `users(updated_at)` if not already present.
3. For a daily reconciliation cron, this incremental approach is correct; full scans should be reserved for weekly/monthly audit runs.

---

### Task 4.5 — PERF-04: Bulk comeback bonus expiry in daily-users
**Bug:** `daily-users/route.ts` expires comeback bonuses one per user in sequential transactions.  
**Files:** `apps/web/app/api/cron/daily-users/route.ts`  
**Steps:**
1. Replace the per-user loop with a single `UPDATE user_bonuses SET expired_at = NOW() WHERE type = 'comeback' AND expires_at < NOW() AND expired_at IS NULL RETURNING user_id`.
2. If per-user notifications are required after expiry, collect the returned `user_id` list and batch-insert notifications.

---

### Task 4.6 — PERF-05: Batch nemesis assignments instead of N+1 serial loop
**Bug:** `refreshNemesisAssignments` calls `assignNemesis` for each user in a serial loop; with 1000+ users this causes thousands of sequential DB queries.  
**Files:** `apps/web/lib/nemesis/nemesisEngine.ts`  
**Steps:**
1. Refactor `refreshNemesisAssignments` to: (a) fetch all candidate users and their nemesis-relevant stats in one query, (b) compute optimal nemesis pairings in application code, (c) bulk-upsert the `nemesis_assignments` rows in a single query using `UNNEST`.
2. The algorithm for nemesis matching (closest XP, same tier, etc.) can run in memory after a single DB fetch.

---

### Task 4.7 — PERF-06: Replace OFFSET pagination in reconcile-balances with keyset
**Bug:** `reconcile-balances` uses `OFFSET` pagination, which degrades to O(N²) as the table grows; row 50,000 requires the DB to skip 49,999 rows.  
**Files:** `apps/web/app/api/cron/reconcile-balances/route.ts`  
**Steps:**
1. Add a `WHERE id > $lastId ORDER BY id ASC LIMIT 1000` keyset pagination pattern.
2. Store `lastId` in a Redis key between paginated batches within the same CRON run.
3. Reset `lastId` to `null` at the start of each CRON invocation so each run starts from the beginning.

---

### Task 4.8 — PERF-07: Throttle concurrent comeback coin credits
**Bug:** `daily-notify/route.ts` fires comeback coin credit transactions for all eligible users concurrently (`Promise.all`), causing a thundering herd of DB transactions.  
**Files:** `apps/web/app/api/cron/daily-notify/route.ts`  
**Steps:**
1. Replace `Promise.all(users.map(...))` with a concurrency-limited batch (e.g., process 10 users at a time using a loop with `Promise.all` over a slice, or use `p-limit`).
2. Cap concurrency at 10-20 concurrent transactions to avoid overwhelming the DB connection pool.

---

### Task 4.9 — HDRDUP-01: Remove duplicate Permissions-Policy from next.config.js
**Bug:** `next.config.js` sets `Permissions-Policy` in the static `securityHeaders` array, and `middleware.ts` sets it again (with different allowed features) on every request; browsers receive two conflicting headers and apply the intersection.  
**Files:** `apps/web/next.config.js`, `apps/web/middleware.ts`  
**Steps:**
1. Remove `Permissions-Policy` from the `securityHeaders` array in `next.config.js`; the middleware value is more restrictive and should win.
2. Verify the final header value in `middleware.ts` includes all necessary permissions (compare `camera=(), microphone=(), geolocation=(), browsing-topics=()` vs `camera=(), microphone=(), geolocation=(), payment=(), usb=()`).
3. Decide on a single canonical value and keep it only in `middleware.ts`.

---

### Task 4.10 — SCHEMA-AUDIT: Verify SCHEMA-07 and other schema-level uniqueness corrections
**Note:** This task covers final schema audit and is intentionally last so all preceding fixes inform the final migration.  
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/lib/db/migrations/`  
**Steps:**
1. After all Phase 1-4 changes, run `pnpm drizzle-kit check` to validate the schema against the live DB.
2. Generate a final consolidated migration if any schema diffs remain.
3. Update `schema.ts` to reflect all constraint additions (NOT NULL, CHECK, new unique indexes).

---

## Execution Checklist

| # | Task | Phase | Bug(s) | Effort |
|---|------|-------|--------|--------|
| 1.1 | Add login_streak_days to schema | 1 | SCHEMA-01 | S |
| 1.2 | Timing-safe CRON bypass | 1 | SEC-01 | XS |
| 1.3 | is_banned NOT NULL + COALESCE guards | 1 | NULLABLE-01 | S |
| 1.4 | Gifts duplicate row idempotency | 1 | RACE-01 | M |
| 1.5 | Paystack transfer_code vs reference | 1 | PAY-01 | S |
| 1.6 | IAP packageName validation | 1 | IAP-01 | XS |
| 1.7 | Balance auto-correct audit trail | 1 | AUDIT-01 | S |
| 1.8 | DodoPay creator_earnings idempotent | 1 | PAY-02 | XS |
| 2.1 | Session refresh race (Redis lock) | 2 | AUTH-01 | M |
| 2.2 | Ban cache TTL reduction | 2 | AUTH-02 | XS |
| 2.3 | Large balance discrepancy alert | 2 | OPS-01 | XS |
| 2.4 | HoF injection condition | 2 | LB-01 | XS |
| 2.5 | Season badge top-100 range | 2 | LB-02 | XS |
| 2.6 | getLeaderboard total with HoF | 2 | LB-03 | XS |
| 2.7 | War resolution FOR UPDATE | 2 | RACE-02 | S |
| 2.8 | Consolidate guild tier columns | 2 | GUILD-01 | M |
| 2.9 | Include departed members in war XP | 2 | GUILD-02 | M |
| 2.10 | Quest shuffle date seed | 2 | QUEST-01 | XS |
| 2.11 | Guild war notifications new format | 2 | NOTIF-01 | XS |
| 2.12 | Re-engagement mark-sent fix | 2 | NOTIF-02 | S |
| 2.13 | Expo signOut CSRF fix | 2 | AUTH-03 | S |
| 2.14 | DLQ phantom entry guard | 2 | DLQ-01 | S |
| 2.15 | geoAnomaly alert rate-limit | 2 | OPS-02 | S |
| 2.16 | referral_commissions tier default | 2 | SCHEMA-05 | XS |
| 2.17 | XP bigint cast in leaderboards | 2 | TYPE-01 | XS |
| 3.1 | Session table pruning | 3 | SCHEMA-02 | S |
| 3.2 | Drop deprecated userQuests table | 3 | SCHEMA-03 | S |
| 3.3 | DM conversation sort order | 3 | SCHEMA-04 | S |
| 3.4 | Notifications single format migration | 3 | SCHEMA-06 | M |
| 3.5 | creator_earnings composite unique index | 3 | SCHEMA-07 | S |
| 3.6 | Delete expired quest_progress rows | 3 | DATA-01 | XS |
| 4.1 | Centralize CRON secret validation | 4 | MAINT-01 | S |
| 4.2 | Bound monthly plan bonus CTE | 4 | PERF-01 | M |
| 4.3 | Bulk guild tier update | 4 | PERF-02 | S |
| 4.4 | Incremental leaderboard reconciliation | 4 | PERF-03 | S |
| 4.5 | Bulk comeback bonus expiry | 4 | PERF-04 | S |
| 4.6 | Batch nemesis assignments | 4 | PERF-05 | L |
| 4.7 | Keyset pagination in reconcile-balances | 4 | PERF-06 | S |
| 4.8 | Throttle comeback coin thundering herd | 4 | PERF-07 | XS |
| 4.9 | Remove duplicate Permissions-Policy | 4 | HDRDUP-01 | XS |
| 4.10 | Final schema audit + migration | 4 | SCHEMA-07 | S |

**Effort key:** XS = < 30 min, S = 30–90 min, M = 2–4 hrs, L = half day

---

## Pre-Deployment Checklist

- [ ] All Phase 1 tasks complete and tested
- [ ] DB migrations tested on a staging database before production
- [ ] `pnpm drizzle-kit check` passes with no drift
- [ ] CRON endpoints verified with the updated `validateCronSecret` import
- [ ] Expo app tested for signOut flow (AUTH-03)
- [ ] Leaderboard integration test confirms HoF injection and total count
- [ ] Guild war resolution tested with concurrent score update simulation
- [ ] IAP verify endpoint tested with mismatched packageName (must return 400)
- [ ] Balance reconciliation run on staging with intentional discrepancy
- [ ] Notifications confirmed to display in frontend after SCHEMA-06 migration

---

*Zobia Codebase Bug Fix Plan*  
*Date: 2026-06-21 | Time: 06:45 AM UTC*
