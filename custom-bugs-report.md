# Zobia Social — Forensic Bug Report

**Generated:** June 15, 2026 · 12:00 PM  
**Analyst:** Independent full-codebase forensic analysis  
**Scope:** `apps/web` (Next.js 14 App Router + API routes + CRON), `apps/expo` (Android), PWA — all layers  
**Branch:** `claude/codebase-bug-analysis-5g8o54`

---

## Current Code Rating

**Overall: 6.5 / 10**

The architecture is ambitious and shows strong engineering intent in many areas: Redis-backed sessions with token rotation and reuse detection, HMAC-SHA512 webhook signature verification, Lua atomic sliding-window rate limiting, Redis-backed circuit breakers with Lua read-modify-write, CTE-based XP awarding to avoid phantom updates, Decimal.js for monetary arithmetic, proper DLQ pattern (`failed_xp_awards`) for XP retry, SELECT FOR UPDATE SKIP LOCKED for safe concurrent ledger operations, and solid security fundamentals (JWT kid rotation, CSRF origin check, per-request CSP nonce, identity header stripping, pre-auth token gating for 2FA). These are genuinely well-implemented.

The main problems fall into three clusters: (1) a cluster of critical runtime SQL errors from column name mismatches and non-existent columns; (2) financial integrity issues including one over-credit on payment reversal; (3) a pervasive Drizzle schema / SQL migration drift that is a time-bomb for any future schema operation.

**Projected rating after all fixes applied: 8.5 / 10**

---

## Complete Bug Index (one-line summaries)

1. BUG-FIN-01 — `transfer.reversed` webhook restores `gross_kobo` instead of `net_kobo` — overcredits creator by 10-20% on payout reversal
2. BUG-SQL-01 — Cron step 19 re-engagement query uses `na.nemesis_id` (nullable column) instead of `na.nemesis_user_id` — nemesis notifications are never sent
3. BUG-SQL-02 — `user_sticker_packs` INSERT uses non-existent columns `pack_name`/`granted_at` in two call sites — DM-streak and conversation-score sticker grants crash at runtime
4. BUG-SQL-03 — Cron uses `users.is_active` which does not exist in the users table — SQL errors crash council invitation and monthly plan bonus cron steps
5. BUG-XP-01 — Daily login XP (cron step 4) has no `reference_id` — susceptible to double-award on concurrent CRON fires with no dedup or DLQ protection
6. BUG-XP-02 — Comeback coin `reference_id` `comeback:{userId}` is reused across multiple 90-day inactivity cycles — double-coins on repeated long absences
7. BUG-XP-03 — `maybeAwardMessageXP` (room messages route) uses a raw transaction with no DLQ fallback — XP is silently lost on any DB error
8. BUG-XP-04 — DLQ retry of XP awards with `reference_id = NULL` can double-award XP: the ON CONFLICT guard is not effective for null reference_id entries
9. BUG-EMAIL-01 — Re-engagement emails (cron step 11) call `sendEmail` without `userId`/`notificationType` — bypasses per-user opt-out preferences entirely
10. BUG-TG-01 — Cron step 19 calls `sendTelegramMessage` without `await` — users falsely marked as notified even when Telegram delivery fails
11. BUG-LB-01 — `getUserRank` for global scope is missing `ls.city IS NULL` — count includes city-scoped snapshot rows, inflating everyone's rank number
12. BUG-PAY-01 — Paystack subscription plan derived via `String.includes()` — "pro" matches "professional", "max" matches "maximum", wrong tier can activate
13. BUG-COIN-01 — `transferCoins` default idempotency key `transfer:{from}:{to}:{amount}` is non-unique for repeated same-amount transfers between same users
14. BUG-SSE-01 — SSE stream endpoint (`/api/rooms/[roomId]/stream`) has no rate limiting — open to connection exhaustion / DB query amplification
15. BUG-DB-01 — `getTypedDb()` creates a second `pg.Pool` independent of the Railway adapter pool — doubles active DB connections, exhausts Railway's connection limit
16. BUG-DRIZZLE-01 — Drizzle schema (`lib/db/schema.ts`) critically out of sync with SQL migrations — running `drizzle-kit push` would corrupt the database
17. BUG-REF-01 — Referral streak-qualifying step 33: `FOR UPDATE SKIP LOCKED` issued outside per-row transactions — lock released before processing, allowing double-award by concurrent CRONs
18. BUG-FUND-01 — Creator fund quest metric only queries `sponsored_quest_applications`, not `user_quest_progress` — platform quest completions are excluded from fund scoring
19. BUG-TIER-01 — `tierForCount` in cron step 28 never assigns the "elite" tier — creator fund eligibility check for `IN ('elite', 'icon')` makes "elite" a permanently unreachable dead value
20. BUG-MIG-01 — Migration 009 redefines `system_alerts` and `creator_earnings` with wrong column schemas — breaks fresh database setups that rely on migration 009 alone

---

## Detailed Bug Descriptions

---

### 1. BUG-FIN-01 — Payout Reversal Overcredits Creator (CRITICAL)

When Paystack fires a `transfer.reversed` webhook, the handler restores the reversed amount to the creator's `available_earnings_kobo`. The SELECT fetches `gross_kobo` from `creator_payouts`. The UPDATE then credits `payout.gross_kobo` back to the creator — the full pre-platform-fee amount. The correct restoration is `net_kobo` (what the creator was actually sent after the 10% platform fee). A reversed ₦10,000 payout should restore ₦9,000 to the creator; instead it restores ₦10,000, silently gifting the platform's 10% fee (₦1,000) to the creator on every reversal event.

**FILES:**
- `apps/web/app/api/economy/webhooks/paystack/route.ts` — `processTransferEvent` function, `transfer.reversed` branch (~line 362–374)

**FIX:** In the `processTransferEvent` function's SELECT statement, also retrieve `net_kobo` from `creator_payouts`. Replace `payout.gross_kobo` in the `UPDATE users SET available_earnings_kobo = available_earnings_kobo + $1` parameter with `payout.net_kobo`. Both values are available in the schema; `net_kobo` is the correct amount to restore.

---

### 2. BUG-SQL-01 — Nemesis Re-Engagement Notifications Never Sent (HIGH)

Cron step 19 builds a re-engagement notification query for users whose nemesis has surpassed them. The query JOINs `nemesis_assignments na` and references `na.nemesis_id`. The `nemesis_assignments` table has two UUID columns: `nemesis_user_id` (NOT NULL — the actual assigned rival) and `nemesis_id` (nullable — a secondary optional reference not reliably populated). Using `na.nemesis_id` reads the nullable column, which is NULL for essentially all active assignments. The query returns zero rows silently; no nemesis re-engagement notifications are ever sent. The cron step "succeeds" with 0 notifications and logs no error.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 19, re-engagement query block
- `apps/web/db/migrations/001_complete_schema.sql` — `nemesis_assignments` table definition (lines ~1036-1048)

**FIX:** Replace every occurrence of `na.nemesis_id` in the step 19 re-engagement query with `na.nemesis_user_id`. Confirm by checking the nemesis engine's own queries which correctly alias `nemesis_user_id AS nemesis_id` in SELECT outputs — the raw table column is `nemesis_user_id`.

---

### 3. BUG-SQL-02 — DM-Streak Sticker Grants Crash at Runtime (CRITICAL)

Two call sites INSERT into `user_sticker_packs` specifying columns `(user_id, pack_name, granted_at)`. The actual `user_sticker_packs` table schema (migration 001, line 1314) defines only `(id, user_id, pack_id, acquired_at, unlocked_at)`. Neither `pack_name` nor `granted_at` exist. Every DM-streak milestone sticker grant (cron step 18) and conversation-score sticker unlock (`conversationScore.ts`) throws a PostgreSQL `column "pack_name" does not exist` error at runtime. The `.catch(() => {})` in the calling code swallows the error silently — sticker packs are never granted and no one is alerted.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 18, DM streak sticker INSERT (~line 1188)
- `apps/web/lib/messaging/conversationScore.ts` — conversation score sticker unlock INSERT (~line 212)

**FIX:** Both INSERT statements must use the correct column set. Follow the pattern in `lib/stickers/milestoneStickers.ts` (the correct implementation): first look up the sticker pack by name — `SELECT id FROM sticker_packs WHERE name = $1` — then INSERT `(user_id, pack_id, acquired_at)` using the resolved UUID. Remove the `pack_name` and `granted_at` references entirely.

---

### 4. BUG-SQL-03 — `users.is_active` Column Does Not Exist (HIGH)

Multiple cron steps use `u.is_active = true` as a filter on the `users` table. The users table (migration 001, lines 37-200+) has no `is_active` column. Active users are distinguished by `deleted_at IS NULL AND is_banned = false`. The affected steps fail with `column "is_active" does not exist` at runtime, caught silently by their `try/catch` blocks, meaning those entire cron steps are skipped without any visible failure.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 26 council invitation (~line 799), monthly plan bonus step (~line 1358)

**FIX:** Replace all occurrences of `u.is_active = true` on the `users` table with `u.deleted_at IS NULL AND u.is_banned = false`. Audit the entire cron file and all API routes for other instances. Consider adding a `CHECK` view or generated column called `is_active` to the DB as an alias to prevent recurrence.

---

### 5. BUG-XP-01 — Daily Login XP Has No Idempotency Key (HIGH)

Cron step 4 awards daily login XP via `safeAwardXP(userId, xp, 'main', 'daily_login', null)` — with `referenceId = null`. The xp_ledger unique partial index `uidx_xp_ledger_source_ref` only deduplicates entries where `reference_id IS NOT NULL`. With null references, the `WHERE NOT EXISTS` guard in the CTE is the only protection against double-award — and this guard has a race condition: two concurrent CRON executions can both read "no existing entry" before either commits. Neither has DLQ-level protection. If the external CRON service retries a failed invocation, login XP is double-awarded.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 4 daily login XP block

**FIX:** Add a deterministic `reference_id` of `daily_login:${userId}:${new Date().toISOString().slice(0, 10)}` to every `safeAwardXP` call in cron step 4. The existing xp_ledger unique partial index will then correctly deduplicate concurrent or retry CRON fires.

---

### 6. BUG-XP-02 — Comeback Coin Reference ID Reused Across Inactivity Cycles (MEDIUM)

When a user returns after 90 days of inactivity (cron step 11a), comeback coins are credited with `reference_id = 'comeback:${userId}'`. The coin ledger has no unique constraint on `reference_id`. A user who goes inactive a second (or third) time and returns again will be credited with the same reference_id. Since there's no unique constraint to block it, comeback coins are credited again for every 90-day absence. This is an unbounded double-credit vulnerability for repeat long-absent users.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 11a comeback coins block

**FIX:** Include the date or an inactivity-event ID in the reference_id: `comeback:${userId}:${new Date().toISOString().slice(0, 7)}` (monthly granularity). Alternatively, add a `comeback_credited` boolean column to the `user_inactivity_events` table and gate the credit on that flag. For structural safety, add a unique index on `coin_ledger(user_id, reference_id) WHERE reference_id IS NOT NULL`.

---

### 7. BUG-XP-03 — Message XP Has No DLQ Fallback (MEDIUM)

The `maybeAwardMessageXP` helper in the room messages POST route awards XP via a manually-crafted raw transaction (a CTE-style INSERT + UPDATE), bypassing `safeAwardXP` entirely. If the transaction fails for any reason (transient DB error, connection drop, timeout), the error is caught and logged as non-fatal, but no entry is written to `failed_xp_awards`. The XP is permanently lost — there is no retry, no DLQ recovery, and no operator alert.

**FILES:**
- `apps/web/app/api/rooms/[roomId]/messages/route.ts` — `maybeAwardMessageXP` function (~lines 130-205)

**FIX:** Replace the entire inline transaction with a call to `safeAwardXP(userId, xpAmount, track, 'send_message', `msg_${messageId}`)`. The `safeAwardXP` function already implements the CTE pattern correctly and falls back to the DLQ on failure. This eliminates the code duplication and closes the DLQ gap.

---

### 8. BUG-XP-04 — DLQ XP Retry Can Double-Award When reference_id Is NULL (MEDIUM)

In `retryFailedXPAwards`, the xp_ledger INSERT uses `ON CONFLICT DO NOTHING`. The deduplication partial index `uidx_xp_ledger_source_ref` only applies `WHERE reference_id IS NOT NULL`. DLQ entries that originally had no `reference_id` (e.g., from BUG-XP-01) will have `reference_id = NULL` in `failed_xp_awards`. Each retry attempt inserts a new ledger row with no conflict detected. If the `resolved_at` UPDATE that follows fails (network hiccup between the two queries), the same entry is retried again on the next CRON run, resulting in double XP.

**FILES:**
- `apps/web/lib/xp/safeAwardXP.ts` — `retryFailedXPAwards` function (~lines 141-167)

**FIX:** Wrap each retry's INSERT + `resolved_at` UPDATE in a single transaction so they are atomic. For DLQ entries with `reference_id = NULL`, generate a synthetic stable key when writing the DLQ entry (e.g., `dlq:${userId}:${source}:${failedAt.toISOString()}`) and store it as `reference_id` in `failed_xp_awards`. The xp_ledger index can then protect against double-award on retry.

---

### 9. BUG-EMAIL-01 — Re-Engagement Emails Bypass User Opt-Out (HIGH)

Cron step 11 sends re-engagement emails by calling `sendEmail(toAddress, subject, text, html)`. The `sendEmail` function signature accepts optional `userId` and `notificationType` parameters that trigger a check of `user_email_preferences` and the platform-wide `email_all_enabled` manifest flag. By omitting these, the cron call bypasses all opt-out checks. Users who have explicitly opted out of non-security emails still receive re-engagement messages — a potential CAN-SPAM / GDPR compliance violation in addition to a UX violation.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 11 re-engagement email block
- `apps/web/lib/notifications/email.ts` — `sendEmail` function (reference for correct parameter usage)

**FIX:** Pass `userId` and `notificationType: 're_engagement'` to every `sendEmail` call in cron step 11. The function already has the opt-out check logic; the calling code just needs to supply the required parameters.

---

### 10. BUG-TG-01 — Telegram Notifications Mark Users as Delivered Without Confirmation (HIGH)

In cron step 19, `sendTelegramMessage(chatId, message)` is called without `await` — it's fire-and-forget. The DB update that sets `telegram_notified = true` on the inactivity event row runs immediately after the call, before the Telegram API has responded. Any Telegram delivery failure (invalid bot token, rate limit, blocked user) is silently discarded. The user is permanently marked as notified and will never receive the message on any subsequent retry.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 19, Telegram send block

**FIX:** Add `await` before `sendTelegramMessage(...)` and move the `telegram_notified = true` DB update into the `try` block after the awaited call. In the `catch` block, log the error but do NOT set `telegram_notified`, so the user is retried on the next CRON run.

---

### 11. BUG-LB-01 — Global Leaderboard Rank Count Includes City-Scoped Rows (MEDIUM)

`getUserRank` counts how many users have a higher xp_value to compute the 1-based rank position. For the global scope, the query does not filter `ls.city IS NULL`. The `leaderboard_snapshots` table stores both global rows (`city = NULL`) and city-scoped rows (`city = 'Lagos'`, etc.) for each user. Without the city filter, city-scoped rows belonging to other users are included in the "ahead of you" count, producing an inflated rank number. The companion function `getLeaderboard` correctly adds `ls.city IS NULL` for all non-city scopes but `getUserRank` does not replicate this logic.

**FILES:**
- `apps/web/lib/leaderboards/engine.ts` — `getUserRank` function, conditions array (~lines 93-118)

**FIX:** In `getUserRank`, add `ls.city IS NULL` to the `conditions` array for all scopes except `"city"`. This mirrors the logic already present in `getLeaderboard` on line ~196.

---

### 12. BUG-PAY-01 — Subscription Plan Matching via `String.includes()` Is Fragile (HIGH)

When a `subscription.create` Paystack event arrives, the plan tier is derived via `planNameLower.includes("max")`, `planNameLower.includes("plus")`, `planNameLower.includes("pro")`. The checks are done in order: "max" first, then "plus", then "pro". A plan named "Pro Plus" would match "pro" only (falling into the first match), activating "pro" instead of "plus". A plan named "Max Professional" would match "max" correctly but this is coincidental. Any future Paystack plan whose name contains one of these substrings would activate the wrong tier silently.

**FILES:**
- `apps/web/app/api/economy/webhooks/paystack/route.ts` — `processSubscriptionEvent`, plan derivation block (~lines 433-455)

**FIX:** Use exact string equality (`=== "pro"`, `=== "plus"`, `=== "max"`) against a controlled list of canonical plan names, OR use Paystack's `plan_code` field (a stable, operator-controlled identifier like `PLN_abc123`) which is immune to display name changes. Store the mapping of plan_code → tier in config or the manifest, and validate new plan codes at webhook time.

---

### 13. BUG-COIN-01 — `transferCoins` Default Idempotency Key Is Non-Unique (MEDIUM)

When `transferCoins` is called without an explicit `idempotencyKey`, it generates `transfer:${fromUserId}:${toUserId}:${amount}`. Two different business events between the same users for the same amount (e.g., user A gifts 100 coins to user B twice in a day) would produce the same key. If the coin_ledger ever gains a unique constraint on `reference_id`, the second transfer is silently blocked. If there is no such constraint (current state), the key provides zero idempotency protection and duplicate transfers are possible on retry.

**FILES:**
- `apps/web/lib/economy/coins.ts` — `transferCoins` function, default idempotency key (~line 125)

**FIX:** Make `idempotencyKey` a required non-optional parameter with no default. Every caller must supply an event-scoped key (e.g., the gift ID, purchase reference, or a UUID generated at request time). This forces callers to think about idempotency and prevents the silent collision problem.

---

### 14. BUG-SSE-01 — SSE Stream Endpoint Has No Rate Limiting (MEDIUM)

The SSE endpoint at `/api/rooms/[roomId]/stream` authenticates the user and immediately sends an initial message batch plus a `realtime_ready` event before closing. It has no `enforceRateLimit` call. A malicious or buggy client can reconnect at arbitrary frequency, generating one DB query (recent messages SELECT) per connection with no throttle. This is a low-cost denial-of-service vector against the database connection pool and query throughput.

**FILES:**
- `apps/web/app/api/rooms/[roomId]/stream/route.ts`

**FIX:** Add `await enforceRateLimit(auth.user.sub, "user", { maxRequests: 30, windowSeconds: 60 })` immediately after authentication, matching the pattern in other route handlers.

---

### 15. BUG-DB-01 — `getTypedDb()` Creates a Duplicate Database Connection Pool (MEDIUM)

`lib/db/drizzle.ts` exports `getTypedDb()` which initialises a new `pg.Pool` (default 10 connections) on module load. The Railway provider in `lib/db/providers/railway.ts` also maintains its own pool. Any code path that uses both `db` (the Railway adapter) and `getTypedDb()` (Drizzle) opens two separate connection pools to the same PostgreSQL instance. Railway's hobby tier has a 25-connection limit; the dual pool can exhaust it under normal load, causing `connection refused` or `too many clients` errors for all users.

**FILES:**
- `apps/web/lib/db/drizzle.ts` — `getTypedDb` function
- `apps/web/lib/db/providers/railway.ts` — pool definition

**FIX:** Expose the underlying `pg.Pool` instance from the Railway provider (or from whichever adapter is active) and pass it to Drizzle's `drizzle(pool)` constructor instead of creating a new pool. Drizzle's query builder only needs the pool reference — it does not require ownership of the pool.

---

### 16. BUG-DRIZZLE-01 — Drizzle Schema Critically Out of Sync with SQL Migrations (HIGH)

`lib/db/schema.ts` (the Drizzle ORM schema) diverges significantly from the actual authoritative SQL schema in `db/migrations/001_complete_schema.sql`. Running `drizzle-kit push` would attempt to reconcile these differences, destructively ALTERing or dropping columns from the live database.

Key divergences:
- **`user_subscriptions`**: Drizzle defines `currentPeriodStart`, `currentPeriodEnd` (not in the DB) and is missing `next_renewal_at` (in the DB and used by the Paystack webhook). Drizzle also lacks the `UNIQUE` constraint on `user_id` required by `ON CONFLICT (user_id)` in the webhook.
- **`room_subscriptions`**: Drizzle is missing `amount_kobo` (used by the Paystack webhook correctly). Drizzle has `startsAt` (`starts_at`) but the DB column is `started_at` (used correctly by the webhook).
- **`sponsored_quest_applications`**: Drizzle defines `sponsorUserId` (`sponsor_user_id`) but the DB column is `creator_id` (used correctly by `creator/fund.ts`).
- **`user_badges`**: Drizzle defines `awardedAt` which migration 009 drops from the DB.
- **Migration 009 `system_alerts`**: Defines columns `(alert_type, payload)` instead of the correct `(type, severity, message, metadata)` from migration 001. Since migration 001 creates the table first, `IF NOT EXISTS` makes this a no-op in production, but a fresh setup using only migration 009 creates a broken table.
- **Migration 009 `creator_earnings`**: Same issue — wrong column names (`gross_kobo`, `net_kobo`, missing `reference_id`, `paid_out`, `payout_id`) vs migration 001.

**FILES:**
- `apps/web/lib/db/schema.ts`
- `apps/web/lib/db/migrations/009_bug_fixes.sql`
- `apps/web/db/migrations/001_complete_schema.sql`

**FIX:** Perform a column-by-column audit of the Drizzle schema against migration 001. Update the Drizzle schema to match the actual DB columns exactly. Fix migration 009's `CREATE TABLE` blocks to use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` instead, since the tables already exist from migration 001. Add a CI step that runs `drizzle-kit check` against a shadow database to catch future drift before it reaches production.

---

### 17. BUG-REF-01 — Referral Streak Lock Released Before Processing (HIGH)

Cron step 33 issues `SELECT ... FOR UPDATE SKIP LOCKED` on the `referrals` table as a standalone `db.query` call, outside any transaction. PostgreSQL releases row-level locks at transaction commit — since there is no enclosing transaction, the lock is released immediately after the SELECT returns. By the time each `db.transaction(async (tx) => { ... })` runs to process a referral, the locks are gone. A second concurrent CRON invocation can select the same rows (they still have `qualified = false`) and process them in parallel, double-awarding XP and coin bonuses to the referrer.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 33, referral streak qualifying block

**FIX:** The cleanest fix is a global advisory lock at the top of the daily CRON handler: `SELECT pg_try_advisory_xact_lock(hash('zobia_daily_cron'))`. If the lock is unavailable, return 200 immediately (another instance is running). This protects all idempotency-sensitive steps, not just step 33. Alternatively, move the `FOR UPDATE SKIP LOCKED` SELECT inside the per-referral transaction.

---

### 18. BUG-FUND-01 — Creator Fund Excludes Platform Quest Completions (MEDIUM)

`calculateFundDistributions` in `creator/fund.ts` computes the "quest completion" dimension of the creator score using only the `sponsored_quest_applications` table (`status IN ('paid', 'approved')`). The PRD specifies this metric should include both sponsored quests and daily platform quests. Platform quest completions are stored in `user_quest_progress` (`completed = true`). Creators who primarily complete daily platform quests (which is most non-monetised creators) receive a quest score of 0, systematically disadvantaging them in fund distribution.

**FILES:**
- `apps/web/lib/creator/fund.ts` — `calculateFundDistributions`, `qst` CTE (~lines 113-120)

**FIX:** Extend the `qst` CTE to UNION results from `user_quest_progress` (completed = true, quest_date >= NOW() - INTERVAL '30 days'). Group by user and count distinct quests to avoid double-counting. Ensure the weighting (currently 20%) still makes sense after including platform quests; the broader data set may warrant adjusting the scoring formula.

---

### 19. BUG-TIER-01 — "Elite" Creator Tier Is Never Auto-Assigned (MEDIUM)

The `tierForCount` function in cron step 28 maps member counts to four tier strings: `>= 2000 → "icon"`, `>= 500 → "verified"`, `>= 100 → "rising"`, `else → "rookie"`. The "elite" tier is never assigned by automatic progression. The creator fund eligibility check in `creator/fund.ts` requires `creator_tier IN ('elite', 'icon')`, making "elite" a dead value — no creator can ever reach it via the automatic tier system. Any creator who was meant to be in an "elite" tier (e.g., 2000–4999 members if "icon" is 5000+) is either excluded from the fund entirely or incorrectly classified as "icon".

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 28, `tierForCount` function (~lines 1875-1879)
- `apps/web/lib/creator/fund.ts` — `calculateFundDistributions`, WHERE clause (~line 133)

**FIX:** Decide the canonical tier boundaries in line with the PRD. If five tiers are intended, add `>= 5000 → "icon"` and change the `>= 2000` branch to `→ "elite"`. If four tiers are intended, remove "elite" from the creator fund eligibility check and change it to `creator_tier IN ('icon')` or whichever tiers should be eligible. Update the users table `creator_tier` CHECK constraint to reflect the canonical set.

---

### 20. BUG-MIG-01 — Migration 009 Contains Wrong Table Definitions (MEDIUM)

`apps/web/lib/db/migrations/009_bug_fixes.sql` contains `CREATE TABLE IF NOT EXISTS` blocks for `system_alerts` and `creator_earnings` with incorrect column schemas:

- `system_alerts`: Uses `(alert_type TEXT, payload JSONB)` but the code and migration 001 both expect `(type TEXT, severity TEXT, message TEXT, metadata JSONB, resolved BOOLEAN)`.
- `creator_earnings`: Uses `(gross_kobo BIGINT, net_kobo BIGINT)` and omits `reference_id`, `paid_out`, `payout_id` — all of which exist in migration 001 and are used by the code.

In production, migration 001 runs first and `IF NOT EXISTS` makes migration 009's definitions harmless no-ops. However, any fresh database setup (CI pipeline, developer environment, disaster recovery) that applies only migration 009 without migration 001 will create broken tables. This will cause immediate SQL `column does not exist` errors for the core payout, alert, and creator fund flows.

**FILES:**
- `apps/web/lib/db/migrations/009_bug_fixes.sql`
- `apps/web/db/migrations/001_complete_schema.sql`

**FIX:** Remove the `CREATE TABLE IF NOT EXISTS system_alerts` and `CREATE TABLE IF NOT EXISTS creator_earnings` blocks from migration 009 entirely. If those tables need additional columns for the bug fixes, use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements. Ensure all migrations are runnable independently and in sequence by documenting dependencies.

---

## Additional Code Quality Observations

- **Alliance wars `ON CONFLICT DO NOTHING` without target** (cron step 32b, ~line 2182): The next-week war INSERT uses `ON CONFLICT DO NOTHING` with no explicit conflict target and no unique constraint on `(alliance_1_id, alliance_2_id, status)`. On a CRON retry, a duplicate active war can be created. Add `UNIQUE (alliance_1_id, alliance_2_id, status)` to `alliance_wars` and specify it as the ON CONFLICT target.

- **Advisory lock absent from daily CRON**: The entire daily CRON handler has no global concurrency guard. Many steps depend on sequential state. `SELECT pg_try_advisory_xact_lock(...)` at the handler entry point would cheaply prevent concurrent runs for all 30+ steps.

- **Creator fund small-pool distribution**: With fewer than ~10 eligible creators, percentage-based tier cutoffs collapse (cutoffs become identical), causing tiers 2–4 to receive nothing in the loop and only partially recovering via the remainder redistribution. The remainder logic helps but can still result in heavily skewed distributions. Consider a minimum creator threshold below which funds are held over to next month.

- **`safeAwardXP` always increments `xp_total` regardless of track**: This is by design (the main total always accumulates) but the SQL string concatenation approach `${col === "xp_total" ? "" : `${col} = COALESCE(${col}, 0) + $2,`}` leaves a trailing comma when `col === "xp_total"`. PostgreSQL actually accepts this, but it is fragile — a trailing comma after the last SET item is invalid SQL in the general case and could break if the UPDATE is restructured.

---

## Summary Table

| # | Bug ID | Severity | Category |
|---|--------|----------|----------|
| 1 | BUG-FIN-01 | Critical | Financial over-credit |
| 2 | BUG-SQL-01 | High | Silent logic failure |
| 3 | BUG-SQL-02 | Critical | Runtime SQL error |
| 4 | BUG-SQL-03 | High | Runtime SQL error |
| 5 | BUG-XP-01 | High | Reward integrity |
| 6 | BUG-XP-02 | Medium | Reward integrity |
| 7 | BUG-XP-03 | Medium | Data loss |
| 8 | BUG-XP-04 | Medium | Reward integrity |
| 9 | BUG-EMAIL-01 | High | Compliance / Privacy |
| 10 | BUG-TG-01 | High | Notification reliability |
| 11 | BUG-LB-01 | Medium | Data correctness |
| 12 | BUG-PAY-01 | High | Wrong plan activation |
| 13 | BUG-COIN-01 | Medium | Idempotency |
| 14 | BUG-SSE-01 | Medium | Security / DoS |
| 15 | BUG-DB-01 | Medium | Infrastructure |
| 16 | BUG-DRIZZLE-01 | High | Schema integrity |
| 17 | BUG-REF-01 | High | Reward double-credit |
| 18 | BUG-FUND-01 | Medium | Business logic |
| 19 | BUG-TIER-01 | Medium | Business logic |
| 20 | BUG-MIG-01 | Medium | Database migration |

**Critical: 2 · High: 9 · Medium: 9 · Total: 20**

---

*Report generated: June 15, 2026 · 12:00 PM*  
*Codebase: nero1/zobia — Branch: claude/codebase-bug-analysis-5g8o54*
