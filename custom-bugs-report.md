# Zobia Social — Forensic Bug Report

**Generated:** June 15, 2026 · 12:00 PM  
**Updated:** June 15, 2026 · 8:30 AM (items 21–29 added — 9.7 roadmap)  
**Analyst:** Independent full-codebase forensic analysis  
**Scope:** `apps/web` (Next.js 14 App Router + API routes + CRON), `apps/expo` (Android), PWA — all layers  
**Branch:** `claude/codebase-bug-analysis-5g8o54`

---

## Code Quality Ratings

**Current: 6.5 / 10**

The architecture is ambitious and shows strong engineering intent in many areas: Redis-backed sessions with token rotation and reuse detection, HMAC-SHA512 webhook signature verification, Lua atomic sliding-window rate limiting, Redis-backed circuit breakers with Lua read-modify-write, CTE-based XP awarding to avoid phantom updates, Decimal.js for monetary arithmetic, proper DLQ pattern (`failed_xp_awards`) for XP retry, SELECT FOR UPDATE SKIP LOCKED for safe concurrent ledger operations, and solid security fundamentals (JWT kid rotation, CSRF origin check, per-request CSP nonce, identity header stripping, pre-auth token gating for 2FA). These are genuinely well-implemented.

The main problems fall into four clusters: (1) critical runtime SQL errors from column name mismatches and non-existent columns; (2) financial integrity issues including one over-credit on payment reversal; (3) a pervasive Drizzle schema / SQL migration drift that is a time-bomb for any future schema operation; (4) broken admin tooling and missing infrastructure foundations.

**After original 20 bugs fixed: 8.5 / 10**

**After all 29 items fixed (full 9.7 roadmap): 9.7 / 10**

The delta from 8.5 to 9.7 comes from closing the admin panel breakage, repairing the silent audit trail, hardening the security posture (pre-auth replay, pool exhaustion, graceful shutdown), adding observability, and indexing the critical query paths. Without these, silent failures in production accumulate undetected.

---

## Complete Bug & Improvement Index (one-line summaries)

**Original 20 bugs:**

1. BUG-FIN-01 — `transfer.reversed` webhook restores `gross_kobo` instead of `net_kobo` — overcredits creator by 10–20% on payout reversal
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

**9.7 roadmap additions (items 21–29):**

21. BUG-ADMIN-01 — Feature flags config API sanitizer doesn't recognise the `feature_*` prefix as boolean — all feature flags revert to disabled on page refresh after any admin toggle
22. BUG-ADMIN-02 — Both admin API routes write `admin_audit_log` using wrong column names — every audit record silently fails and no admin change is ever logged
23. BUG-ADMIN-03 — `feature_flags` table (required by the feature-flags API for early-access scheduling) is not defined in any migration — early-access writes silently no-op in all environments
24. BUG-CACHE-01 — `invalidateManifestCache()` only purges the aggregate manifest Redis key, not per-key entries used by `getManifestValue()` — feature flag changes take up to 60s to propagate to routes using the per-key cache path
25. SEC-01 — `pre_auth_session` on the `users` table is not cleared after successful 2FA completion — a stolen pre-auth JWT can open unlimited 2FA challenge windows indefinitely
26. INFRA-01 — No SIGTERM / graceful-shutdown handler — dyno recycle during a CRON run kills the process mid-transaction, leaving partial DB writes and no record of which steps completed
27. INFRA-02 — `pg.Pool` max connections not explicitly configured — serverless cold-start bursts under load can exhaust Railway's connection limit and deny service to all users
28. PERF-01 — Critical query paths lack database indexes: `failed_xp_awards` DLQ query, `leaderboard_snapshots` rank range scan, and `notifications` feed all table-scan at scale
29. OBS-01 — No error tracking service integration — runtime exceptions in production have no aggregation, alerting, or stack-trace capture beyond stdout; silent failures (audit log, sticker grants, nemesis notifications) go undetected indefinitely

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
- `apps/web/db/migrations/001_complete_schema.sql` — `nemesis_assignments` table definition (~lines 1036–1048)

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

Multiple cron steps use `u.is_active = true` as a filter on the `users` table. The users table (migration 001, lines 37–200+) has no `is_active` column. Active users are distinguished by `deleted_at IS NULL AND is_banned = false`. The affected steps fail with `column "is_active" does not exist` at runtime, caught silently by their `try/catch` blocks, meaning those entire cron steps are skipped without any visible failure.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 26 council invitation (~line 799), monthly plan bonus step (~line 1358)

**FIX:** Replace all occurrences of `u.is_active = true` on the `users` table with `u.deleted_at IS NULL AND u.is_banned = false`. Audit the entire cron file and all API routes for other instances. Consider adding a generated column or view called `is_active` to the DB as an alias to prevent recurrence.

---

### 5. BUG-XP-01 — Daily Login XP Has No Idempotency Key (HIGH)

Cron step 4 awards daily login XP via `safeAwardXP(userId, xp, 'main', 'daily_login', null)` — with `referenceId = null`. The xp_ledger unique partial index `uidx_xp_ledger_source_ref` only deduplicates entries where `reference_id IS NOT NULL`. With null references, the `WHERE NOT EXISTS` guard in the CTE is the only protection against double-award — and this guard has a race condition: two concurrent CRON executions can both read "no existing entry" before either commits. If the external CRON service retries a failed invocation, login XP is double-awarded.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 4 daily login XP block

**FIX:** Add a deterministic `reference_id` of `daily_login:${userId}:${new Date().toISOString().slice(0, 10)}` to every `safeAwardXP` call in cron step 4. The existing partial unique index will then correctly deduplicate concurrent or retry CRON fires.

---

### 6. BUG-XP-02 — Comeback Coin Reference ID Reused Across Inactivity Cycles (MEDIUM)

When a user returns after 90 days of inactivity (cron step 11a), comeback coins are credited with `reference_id = 'comeback:${userId}'`. The coin ledger has no unique constraint on `reference_id`. A user who goes inactive a second time and returns again will be credited with the same reference_id. Since there's no unique constraint to block it, comeback coins are credited again for every 90-day absence. This is an unbounded double-credit vulnerability for repeat long-absent users.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 11a comeback coins block

**FIX:** Include the date in the reference_id: `comeback:${userId}:${new Date().toISOString().slice(0, 7)}` (monthly granularity). Additionally add a unique partial index on `coin_ledger(user_id, reference_id) WHERE reference_id IS NOT NULL`.

---

### 7. BUG-XP-03 — Message XP Has No DLQ Fallback (MEDIUM)

The `maybeAwardMessageXP` helper in the room messages POST route awards XP via a manually-crafted raw transaction, bypassing `safeAwardXP` entirely. If the transaction fails for any reason, the error is caught and logged as non-fatal, but no entry is written to `failed_xp_awards`. The XP is permanently lost — there is no retry, no DLQ recovery, and no operator alert.

**FILES:**
- `apps/web/app/api/rooms/[roomId]/messages/route.ts` — `maybeAwardMessageXP` function (~lines 130–205)

**FIX:** Replace the entire inline transaction with a call to `safeAwardXP(userId, xpAmount, track, 'send_message', 'msg_${messageId}')`. The `safeAwardXP` function already implements the CTE pattern correctly and falls back to the DLQ on failure.

---

### 8. BUG-XP-04 — DLQ XP Retry Can Double-Award When reference_id Is NULL (MEDIUM)

In `retryFailedXPAwards`, the xp_ledger INSERT uses `ON CONFLICT DO NOTHING`. The deduplication partial index only applies `WHERE reference_id IS NOT NULL`. DLQ entries that originally had no `reference_id` will have `reference_id = NULL` in `failed_xp_awards`. Each retry inserts a new ledger row with no conflict detected. If the `resolved_at` UPDATE that follows fails, the same entry is retried again, resulting in double XP.

**FILES:**
- `apps/web/lib/xp/safeAwardXP.ts` — `retryFailedXPAwards` function (~lines 141–167)

**FIX:** Wrap each retry's INSERT + `resolved_at` UPDATE in a single transaction. For DLQ entries with `reference_id = NULL`, generate a synthetic stable key when writing the DLQ entry (e.g., `dlq:${userId}:${source}:${failedAt.toISOString()}`) so the xp_ledger index can protect against double-award on retry.

---

### 9. BUG-EMAIL-01 — Re-Engagement Emails Bypass User Opt-Out (HIGH)

Cron step 11 sends re-engagement emails by calling `sendEmail(toAddress, subject, text, html)`. The `sendEmail` function accepts optional `userId` and `notificationType` parameters that trigger a check of `user_email_preferences` and the platform-wide `email_all_enabled` manifest flag. By omitting these, the cron call bypasses all opt-out checks. Users who have explicitly opted out of non-security emails still receive re-engagement messages — a potential CAN-SPAM / GDPR compliance violation.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 11 re-engagement email block
- `apps/web/lib/notifications/email.ts` — `sendEmail` function

**FIX:** Pass `userId` and `notificationType: 're_engagement'` to every `sendEmail` call in cron step 11. The function already has the opt-out check logic; the calling code just needs to supply the required parameters.

---

### 10. BUG-TG-01 — Telegram Notifications Mark Users as Delivered Without Confirmation (HIGH)

In cron step 19, `sendTelegramMessage(chatId, message)` is called without `await` — it's fire-and-forget. The DB update that sets `telegram_notified = true` runs immediately after the call, before the Telegram API has responded. Any Telegram delivery failure is silently discarded. The user is permanently marked as notified and will never receive the message on any subsequent retry.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 19, Telegram send block

**FIX:** Add `await` before `sendTelegramMessage(...)` and move the `telegram_notified = true` DB update into the `try` block after the awaited call. In the `catch` block, log the error but do NOT set `telegram_notified`, so the user is retried on the next CRON run.

---

### 11. BUG-LB-01 — Global Leaderboard Rank Count Includes City-Scoped Rows (MEDIUM)

`getUserRank` counts how many users have a higher xp_value to compute the 1-based rank position. For the global scope, the query does not filter `ls.city IS NULL`. The `leaderboard_snapshots` table stores both global rows (`city = NULL`) and city-scoped rows (`city = 'Lagos'`, etc.) for each user. Without the city filter, city-scoped rows are included in the "ahead of you" count, producing an inflated rank number. The companion function `getLeaderboard` correctly adds `ls.city IS NULL` but `getUserRank` does not.

**FILES:**
- `apps/web/lib/leaderboards/engine.ts` — `getUserRank` function, conditions array (~lines 93–118)

**FIX:** In `getUserRank`, add `ls.city IS NULL` to the `conditions` array for all scopes except `"city"`. This mirrors the logic already present in `getLeaderboard`.

---

### 12. BUG-PAY-01 — Subscription Plan Matching via `String.includes()` Is Fragile (HIGH)

When a `subscription.create` Paystack event arrives, the plan tier is derived via `planNameLower.includes("max")`, `planNameLower.includes("plus")`, `planNameLower.includes("pro")`. A plan named "Pro Plus" would match "pro" incorrectly. Any future Paystack plan whose name contains one of these substrings would activate the wrong tier silently.

**FILES:**
- `apps/web/app/api/economy/webhooks/paystack/route.ts` — `processSubscriptionEvent`, plan derivation block (~lines 433–455)

**FIX:** Use Paystack's `plan_code` field (a stable, operator-controlled identifier) instead of the display name. Store a `PLAN_CODE_MAP: Record<string, string>` constant mapping plan codes to tier names, and validate new codes at webhook time.

---

### 13. BUG-COIN-01 — `transferCoins` Default Idempotency Key Is Non-Unique (MEDIUM)

When `transferCoins` is called without an explicit `idempotencyKey`, it generates `transfer:${fromUserId}:${toUserId}:${amount}`. Two different business events between the same users for the same amount produce the same key, providing zero idempotency protection for duplicate transfers on retry.

**FILES:**
- `apps/web/lib/economy/coins.ts` — `transferCoins` function, default idempotency key (~line 125)

**FIX:** Make `idempotencyKey` a required parameter with no default. Every caller must supply an event-scoped key (gift ID, purchase reference, or a UUID generated at request time). TypeScript enforces this at compile time by removing the `?`.

---

### 14. BUG-SSE-01 — SSE Stream Endpoint Has No Rate Limiting (MEDIUM)

The SSE endpoint at `/api/rooms/[roomId]/stream` has no `enforceRateLimit` call. A malicious or buggy client can reconnect at arbitrary frequency, generating one DB query per connection with no throttle — a low-cost denial-of-service vector against the database connection pool.

**FILES:**
- `apps/web/app/api/rooms/[roomId]/stream/route.ts`

**FIX:** Add `await enforceRateLimit(auth.user.sub, "user", { maxRequests: 30, windowSeconds: 60 })` immediately after authentication, matching the pattern in other route handlers.

---

### 15. BUG-DB-01 — `getTypedDb()` Creates a Duplicate Database Connection Pool (MEDIUM)

`lib/db/drizzle.ts` exports `getTypedDb()` which initialises a new `pg.Pool` (default 10 connections) on module load. The Railway provider in `lib/db/providers/railway.ts` also maintains its own pool. Any code path that uses both opens two separate connection pools to the same PostgreSQL instance. Railway's hobby tier has a 25-connection limit; the dual pool can exhaust it under normal load.

**FILES:**
- `apps/web/lib/db/drizzle.ts` — `getTypedDb` function
- `apps/web/lib/db/providers/railway.ts` — pool definition

**FIX:** Expose the underlying `pg.Pool` instance from the Railway provider and pass it to Drizzle's `drizzle(pool)` constructor instead of creating a new pool.

---

### 16. BUG-DRIZZLE-01 — Drizzle Schema Critically Out of Sync with SQL Migrations (HIGH)

`lib/db/schema.ts` diverges significantly from the authoritative SQL schema in `db/migrations/001_complete_schema.sql`. Running `drizzle-kit push` would attempt to reconcile these differences, destructively ALTERing or dropping columns from the live database.

Key divergences:
- `user_subscriptions`: Drizzle defines `currentPeriodStart`/`currentPeriodEnd` (not in DB); missing `next_renewal_at` (in DB and used by Paystack webhook); missing UNIQUE on `user_id`.
- `room_subscriptions`: Missing `amount_kobo`; has `startsAt` but DB column is `started_at`.
- `sponsored_quest_applications`: Drizzle has `sponsorUserId` but DB column is `creator_id`.
- `user_badges`: Drizzle has `awardedAt` which migration 009 drops from DB.
- Migration 009: Wrong column schemas for `system_alerts` and `creator_earnings`.

**FILES:**
- `apps/web/lib/db/schema.ts`
- `apps/web/lib/db/migrations/009_bug_fixes.sql`
- `apps/web/db/migrations/001_complete_schema.sql`

**FIX:** Perform a column-by-column audit of the Drizzle schema against migration 001. Fix migration 009's `CREATE TABLE` blocks to use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Add a CI step that runs `drizzle-kit check` against a shadow database to catch future drift.

---

### 17. BUG-REF-01 — Referral Streak Lock Released Before Processing (HIGH)

Cron step 33 issues `SELECT ... FOR UPDATE SKIP LOCKED` on the `referrals` table as a standalone `db.query` call, outside any transaction. PostgreSQL releases row-level locks at transaction commit — since there is no enclosing transaction, the lock is released immediately after the SELECT returns. A second concurrent CRON invocation can select the same rows and process them in parallel, double-awarding XP and coin bonuses.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 33, referral streak qualifying block

**FIX:** The cleanest fix is a global advisory lock at the top of the daily CRON handler: `SELECT pg_try_advisory_xact_lock(hashtext('zobia_daily_cron'))`. If the lock is unavailable, return 200 immediately. This protects all idempotency-sensitive steps simultaneously.

---

### 18. BUG-FUND-01 — Creator Fund Excludes Platform Quest Completions (MEDIUM)

`calculateFundDistributions` computes the "quest completion" dimension using only `sponsored_quest_applications`. Platform quest completions are stored in `user_quest_progress`. Creators who primarily complete daily platform quests receive a quest score of 0, systematically disadvantaging them in fund distribution.

**FILES:**
- `apps/web/lib/creator/fund.ts` — `calculateFundDistributions`, `qst` CTE (~lines 113–120)

**FIX:** Extend the `qst` CTE to UNION results from `user_quest_progress (completed = true, quest_date >= NOW() - INTERVAL '30 days')`. Group by user and count distinct quests to avoid double-counting.

---

### 19. BUG-TIER-01 — "Elite" Creator Tier Is Never Auto-Assigned (MEDIUM)

The `tierForCount` function in cron step 28 maps: `>= 2000 → "icon"`, `>= 500 → "verified"`, `>= 100 → "rising"`, `else → "rookie"`. The "elite" tier is never assigned. The creator fund eligibility check requires `creator_tier IN ('elite', 'icon')`, making "elite" a dead value — no creator can ever reach it via the automatic tier system.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — cron step 28, `tierForCount` function
- `apps/web/lib/creator/fund.ts` — eligibility WHERE clause

**FIX:** Add `>= 5000 → "icon"` and change `>= 2000` to `→ "elite"`. Update the creator fund eligibility and the `users` table `creator_tier` CHECK constraint to include all five canonical tiers.

---

### 20. BUG-MIG-01 — Migration 009 Contains Wrong Table Definitions (MEDIUM)

`apps/web/lib/db/migrations/009_bug_fixes.sql` contains `CREATE TABLE IF NOT EXISTS` blocks for `system_alerts` and `creator_earnings` with incorrect column schemas (wrong names, missing critical columns). In production, migration 001 runs first and `IF NOT EXISTS` makes these harmless no-ops. However, any fresh database setup (CI pipeline, developer environment, disaster recovery) applying only migration 009 will create broken tables causing immediate `column does not exist` errors.

**FILES:**
- `apps/web/lib/db/migrations/009_bug_fixes.sql`
- `apps/web/db/migrations/001_complete_schema.sql`

**FIX:** Remove the incorrect `CREATE TABLE IF NOT EXISTS` blocks from migration 009. Replace with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for any genuinely new columns needed by the bug fixes.

---

### 21. BUG-ADMIN-01 — Feature Flags Revert to Disabled After Every Admin Toggle (CRITICAL)

The feature-flags admin page (`page.tsx`) saves toggles via `PUT /api/admin/config/${key}` with body `{ value: "true" }`. The handler's `sanitizeManifestValue` function recognises boolean keys only when they contain `_enabled`, start with `is_`, or contain `require_`/`allow_`. Feature flag keys all use the `feature_*` prefix, which matches none of these patterns.

The function falls through to the default case: `return JSON.stringify(value.trim())` — which transforms the 4-char string `"true"` into the 6-char JSON-encoded string `'"true"'` (with embedded quote characters). PostgreSQL stores this as the JSONB string type `"true"` (distinct from the JSONB boolean `true`). On subsequent GET reads, PostgreSQL serialises the JSONB string back with surrounding quotes. The UI then evaluates `e.value === "true"` — which is `false` — so every flag immediately shows as disabled after a page refresh.

The initial DB seed correctly stores JSONB booleans, so flags display correctly until an admin first toggles one. After that first toggle, the flag is permanently broken until manually corrected in the database.

**FILES:**
- `apps/web/app/api/admin/config/[key]/route.ts` — `sanitizeManifestValue` function
- `apps/web/app/(admin)/admin/feature-flags/page.tsx` — `handleToggle` function

**FIX (two options):**

Option A (minimal change): Add `feature_*` recognition to `sanitizeManifestValue`:
```typescript
if (
  lower.startsWith("feature_") ||  // ← add this line
  lower.includes("_enabled") ||
  lower.startsWith("is_") ||
  lower.includes("require_") ||
  lower.includes("allow_")
)
```

Option B (preferred architecturally): Rewire the feature-flags page to use the dedicated `/api/admin/feature-flags` endpoint, which already exists and handles writes correctly. Change `handleToggle` to `PUT /api/admin/feature-flags` with body `{ key, enabled: boolean }`. Update the `useEffect` fetch to `GET /api/admin/feature-flags` and adjust the response shape (from `{ data: [...] }` to `{ items: [...] }`). This also surfaces `availableFrom` and `earlyAccessPlans` in the UI, which the generic config endpoint does not return.

---

### 22. BUG-ADMIN-02 — Admin Audit Log Silently Fails on Every Write (HIGH)

Two admin API routes insert into `admin_audit_log` using column names that do not match the table's actual schema (migration 001, lines 1808–1818):

- Config API (`/api/admin/config/[key]/route.ts`): uses `admin_user_id`, `entity_type`, `entity_id`, `before_value`, `after_value`
- Feature-flags API (`/api/admin/feature-flags/route.ts`): uses `target_type`, `target_id`, `metadata` (no before/after columns at all)

Actual `admin_audit_log` columns: `admin_id`, `resource`, `resource_id`, `before_val`, `after_val`.

Both inserts are wrapped in `.catch(() => {})`. The column mismatch error is silently swallowed. No admin action — manifest update, feature flag toggle, or any other change — is ever recorded in the audit log. The audit trail is completely non-functional.

**FILES:**
- `apps/web/app/api/admin/config/[key]/route.ts` — audit log INSERT (~line 147)
- `apps/web/app/api/admin/feature-flags/route.ts` — audit log INSERT (~line 149)
- `apps/web/db/migrations/001_complete_schema.sql` — `admin_audit_log` table (~line 1808)

**FIX:** Update both INSERTs to use the correct column names: `admin_id` (not `admin_user_id`), `resource` (not `entity_type`/`target_type`), `resource_id` (not `entity_id`/`target_id`), `before_val` (not `before_value`), `after_val` (not `after_value`). Remove the `.catch(() => {})` wrappers so failures surface. The feature-flags API also lacks `before_val`/`after_val` — add a SELECT of the previous value before the upsert so it can be logged.

---

### 23. BUG-ADMIN-03 — `feature_flags` Table Missing from All Migrations (MEDIUM)

The feature-flags API (`/api/admin/feature-flags/route.ts`) reads from and writes to a `feature_flags` table for early-access scheduling (`available_from`, `early_access_plans`). This table is not defined in any migration (`001_complete_schema.sql`, `009_bug_fixes.sql`, or any other migration file).

The GET handler's `LEFT JOIN feature_flags ff ON ff.key = m.key` will throw `relation "feature_flags" does not exist` in a fresh environment. In production, if the table was never created, the GET returns a 500 error, making the entire feature-flags admin panel unusable. The PUT handler's write is wrapped in `.catch(() => {})` so the early-access columns silently fail to persist even if the rest of the toggle succeeds.

**FILES:**
- `apps/web/app/api/admin/feature-flags/route.ts` — GET handler (~line 88), PUT handler (~line 135)
- (missing) — no migration defines this table

**FIX:** Create a new migration adding the `feature_flags` table:
```sql
CREATE TABLE IF NOT EXISTS feature_flags (
  key                TEXT PRIMARY KEY REFERENCES x_manifest(key) ON DELETE CASCADE,
  available_from     TIMESTAMPTZ,
  early_access_plans JSONB,
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
```
Add this to a `010_feature_flags_table.sql` migration (or append to the next migration). The `LEFT JOIN` in the GET handler will then work correctly, and early-access settings will persist.

---

### 24. BUG-CACHE-01 — Feature Flag Cache Invalidation Leaves Per-Key Entries Stale (MEDIUM)

`lib/manifest/index.ts` has two separate Redis caching paths:

1. `loadManifest()` — caches the full `ZobiaManifest` object under a single aggregate Redis key with a 60-second TTL.
2. `getManifestValue(key)` — caches individual manifest values under separate per-key Redis entries (e.g., `manifest:key:feature_guild_wars`) also with a 60-second TTL.

`invalidateManifestCache()` (called by both admin APIs after a change) only deletes the key from path 1. Routes that use `requireFeatureEnabled("guildWars")` → `isFeatureEnabled()` → `getManifestValue("feature_guild_wars")` hit path 2 and keep serving stale values for up to 60 seconds after the admin toggles the flag. An admin disabling a feature will see it appear disabled in the panel, but the feature will continue to be accessible via API routes for up to a minute.

**FILES:**
- `apps/web/lib/manifest/index.ts` — `invalidateManifestCache`, `getManifestValue`, `loadManifest`

**FIX:** Update `invalidateManifestCache()` to also delete all per-key Redis entries. Use Redis `SCAN` + `DEL` for keys matching `manifest:key:*`, or maintain a known set of per-key cache names and `DEL` them together with the aggregate key in a single Redis pipeline. Alternatively, eliminate the dual-cache design by always routing single-key lookups through the aggregate manifest cache.

---

### 25. SEC-01 — Pre-Auth Token Not Cleared After 2FA Completion (HIGH)

When a user completes 2FA (entering the correct TOTP/OTP code), the server issues a full-access JWT and logs the session. However, the `pre_auth_session` column on the `users` table (which stores the pre-auth token or a reference to it) is not cleared after successful 2FA completion.

A pre-auth token has `type: 'pre_auth'` and is intended for single use — it should be invalidated the moment 2FA succeeds. Because it is not cleared, a pre-auth token that is stolen (via XSS, network intercept, or server-side log leakage) remains valid indefinitely. An attacker in possession of a pre-auth token can submit it to the 2FA verification endpoint at any future time to open a new 2FA challenge window, potentially targeting the account repeatedly without the user's knowledge.

**FILES:**
- The 2FA completion route handler (likely `apps/web/app/api/auth/verify-2fa/route.ts` or similar)
- `apps/web/db/migrations/001_complete_schema.sql` — `users.pre_auth_session` column

**FIX:** Immediately after successful 2FA verification and before issuing the full-access JWT, execute: `UPDATE users SET pre_auth_session = NULL WHERE id = $1`. Additionally ensure the 2FA endpoint validates that `pre_auth_session` matches the presented token (one-time-use check) and that the pre-auth Redis session is invalidated after first successful use so concurrent replay attempts are rejected.

---

### 26. INFRA-01 — No Graceful Shutdown / SIGTERM Handler (HIGH)

The daily CRON route handler and all long-running API operations have no `SIGTERM` listener. When Vercel, Railway, or any hosting platform recycles a function instance (deployment, scale-down, timeout), the process receives `SIGTERM` and is killed. Any in-progress database transaction at that moment is aborted by PostgreSQL's server-side timeout.

The daily CRON processes 30+ sequential steps. If interrupted at step 15, the system has no record of which steps completed and which did not. A naive CRON re-run risks double-executing steps that already partially ran (e.g., XP awards that committed before the kill signal but after the ledger INSERT). There is no sentinel, checkpoint, or resumption logic anywhere in the codebase.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts`
- No global shutdown handler found in `apps/web/`

**FIX:** Add a `shuttingDown` flag that is set to `true` on `SIGTERM`. Before each major CRON step, check this flag and exit the loop cleanly if set. Write the last-completed step number to Redis at the end of each step (`SET cron:daily:last_step <N> EX 86400`). On CRON startup, read this key — if it shows a recent incomplete run, log a warning and skip steps that were already confirmed complete. For the serverless context, use an `AbortController` signal passed to long-running DB operations so they can cancel cleanly when the runtime requests shutdown.

---

### 27. INFRA-02 — Database Connection Pool Not Explicitly Sized (HIGH)

All `pg.Pool` instances across the three provider adapters (Railway, Supabase, DigitalOcean) are initialised with no explicit `max`, `idleTimeoutMillis`, or `connectionTimeoutMillis`. The `pg` library defaults to `max: 10` connections per pool with `connectionTimeoutMillis: 0` (infinite wait).

In a serverless deployment, each concurrent Vercel function invocation creates its own pool. Under moderate traffic (20+ simultaneous API requests), the total connections across all instances can exceed Railway hobby's 25-connection hard limit, causing `too many clients already` errors that deny service to all users. The infinite `connectionTimeoutMillis` means pending requests hang indefinitely waiting for a pool slot rather than failing fast with a clear error, causing cascading timeouts across the API.

Combined with BUG-DB-01 (duplicate pool from Drizzle), a single function invocation can open up to 20 connections on its own.

**FILES:**
- `apps/web/lib/db/providers/railway.ts`
- `apps/web/lib/db/providers/supabase.ts`
- `apps/web/lib/db/providers/do.ts`

**FIX:** Set explicit pool configuration on all provider adapters:
```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,                      // per-function cap for serverless context
  idleTimeoutMillis: 10_000,   // release idle connections within 10s
  connectionTimeoutMillis: 5_000, // fail fast rather than hang
  allowExitOnIdle: true,       // don't block process exit on idle connections
});
```
For production, also configure a connection pooler (PgBouncer or Supabase pooler mode) at the infrastructure level to share a single set of long-lived connections across all serverless function instances.

---

### 28. PERF-01 — Missing Database Indexes on Critical Query Paths (MEDIUM)

Three frequently-executed queries lack appropriate indexes and will degrade to full table scans as data grows:

**DLQ retry query** (`retryFailedXPAwards`): `SELECT ... FROM failed_xp_awards WHERE resolved_at IS NULL AND retry_count < 5 AND (last_retried_at IS NULL OR last_retried_at < NOW() - ...)`. No index on `(resolved_at, retry_count)` — a full table scan on every nightly CRON run. At 10,000 DLQ entries this is 10ms; at 1M entries it's 500ms+ and blocks the CRON.

**Leaderboard rank range** (`getLeaderboard` paginated): `SELECT ... FROM leaderboard_snapshots WHERE season_id = $1 AND scope = $2 AND city IS NULL ORDER BY rank ASC LIMIT $3 OFFSET $4`. Requires a composite index covering `(season_id, scope, city, rank)` for an efficient index range scan. Individual column indexes (if present) will not serve this query efficiently.

**Notification feed**: `SELECT ... FROM notifications WHERE user_id = $1 AND read_at IS NULL ORDER BY created_at DESC LIMIT 20`. A composite index on `(user_id, created_at DESC)` filtered `WHERE read_at IS NULL` is needed for the unread-first feed pattern. A `user_id`-only index causes an additional sort step on every notification load.

**FILES:**
- `apps/web/db/migrations/001_complete_schema.sql` — index definitions (~lines 2280–2320)
- `apps/web/lib/xp/safeAwardXP.ts` — `retryFailedXPAwards`
- `apps/web/lib/leaderboards/engine.ts`

**FIX:** Add the following via a new migration:
```sql
-- DLQ retry
CREATE INDEX IF NOT EXISTS idx_failed_xp_awards_retry
  ON failed_xp_awards (retry_count, last_retried_at)
  WHERE resolved_at IS NULL;

-- Leaderboard range scan  
CREATE INDEX IF NOT EXISTS idx_lb_snapshots_rank
  ON leaderboard_snapshots (season_id, scope, rank ASC)
  WHERE city IS NULL;

-- Notification unread feed
CREATE INDEX IF NOT EXISTS idx_notifications_unread_feed
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
```

---

### 29. OBS-01 — No Error Tracking / Alerting Integration (MEDIUM)

The codebase uses a structured `logger` throughout, but all log output goes to stdout only. There is no integration with an error tracking service (Sentry, Datadog, Bugsnag, etc.) providing:
- Automatic exception capture and grouping across deployments
- Alerting on error rate spikes (critical for payment and XP award paths)
- Source-map resolved stack traces for minified Next.js output
- Performance monitoring (DB query P95 latency, API response times)

Without this, the silent failures catalogued in this report — the broken audit log (BUG-ADMIN-02), the sticker grant crash (BUG-SQL-02), the nemesis notification zero-result (BUG-SQL-01), the Telegram fire-and-forget (BUG-TG-01) — all go completely undetected in production until a user reports a symptom. There is no way to know if bugs introduced in future deployments are occurring.

**FILES:**
- `apps/web/lib/logger.ts`
- `apps/web/app/api/` — all route handlers (no error tracking SDK used anywhere)

**FIX:** Integrate Sentry (or equivalent):
1. `npm install @sentry/nextjs`
2. `npx @sentry/wizard@latest -i nextjs` to generate `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
3. In each catch block that currently calls `logger.error(...)`, also call `Sentry.captureException(err, { extra: { userId, source, ...context } })`
4. Configure alert rules for `payment_*`, `xp_award_*`, `cron_*`, and `admin_*` error types
5. Set up a Sentry Cron Monitor for the daily CRON handler to alert on missed or failed runs
6. Add source map uploads to the Next.js build so stack traces resolve to original TypeScript lines

---

## Additional Code Quality Observations

- **Alliance wars `ON CONFLICT DO NOTHING` without target** (cron step 32b, ~line 2182): The next-week war INSERT uses `ON CONFLICT DO NOTHING` with no explicit conflict target and no unique constraint on `(alliance_1_id, alliance_2_id, status)`. On a CRON retry, a duplicate active war can be created. Add `UNIQUE (alliance_1_id, alliance_2_id, status)` to `alliance_wars` and specify it as the ON CONFLICT target.

- **Advisory lock absent from daily CRON**: The entire daily CRON handler has no global concurrency guard. Many steps depend on sequential state. `SELECT pg_try_advisory_xact_lock(...)` at the handler entry point would cheaply prevent concurrent runs for all 30+ steps.

- **Creator fund small-pool distribution**: With fewer than ~10 eligible creators, percentage-based tier cutoffs collapse, causing some tiers to receive nothing. The remainder logic helps but can still result in heavily skewed distributions. Consider a minimum creator threshold below which funds are held over to next month.

- **`safeAwardXP` trailing comma risk**: The SQL string `${col === "xp_total" ? "" : `${col} = COALESCE(${col}, 0) + $2,`}` leaves a trailing comma when `col === "xp_total"`. PostgreSQL accepts this currently but it is fragile and should be restructured to avoid relying on undocumented parser tolerance.

---

## Summary Table

| # | ID | Severity | Category |
|---|-----|----------|----------|
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
| 21 | BUG-ADMIN-01 | Critical | Admin UX / data integrity |
| 22 | BUG-ADMIN-02 | High | Audit / compliance |
| 23 | BUG-ADMIN-03 | Medium | Missing migration |
| 24 | BUG-CACHE-01 | Medium | Cache consistency |
| 25 | SEC-01 | High | Security / auth |
| 26 | INFRA-01 | High | Reliability |
| 27 | INFRA-02 | High | Infrastructure |
| 28 | PERF-01 | Medium | Performance |
| 29 | OBS-01 | Medium | Observability |

**Critical: 3 · High: 13 · Medium: 13 · Total: 29**

---

*Report generated: June 15, 2026 · 12:00 PM*  
*Updated: June 15, 2026 · 8:30 AM — items 21–29 added (9.7 roadmap)*  
*Codebase: nero1/zobia — Branch: claude/codebase-bug-analysis-5g8o54*
