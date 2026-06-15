# Zobia Codebase Bug Report
**Date:** 2026-06-15 | **Time:** 10:24 PM UTC  
**Scope:** Full forensic analysis — Next.js web app, PWA, Expo mobile Android, shared libs, DB schema/migrations  
**Analyst:** Claude (claude-sonnet-4-6) — independent self-conducted analysis, no sub-agents  
**Branch:** `claude/codebase-bug-analysis-6qz2q4`

---

## Code Quality Assessment (Before Fixes)

**Current Rating: 6.5 / 10**

The codebase demonstrates solid architectural thinking in most areas: the coin economy is well-guarded with `SELECT FOR UPDATE`, JWT rotation with `kid`-based key registry is correctly implemented, AES-256-GCM field encryption with scrypt KDF shows security awareness, the sliding-window rate limiter uses atomic Lua scripts, and the XP dead-letter queue pattern is thoughtful. The problem is that a cluster of foundational bugs — schema drift between raw migrations and the Drizzle ORM schema, missing database constraints, and a critical race condition in the payout pipeline — can cause silent data corruption and runtime crashes in production. Some high-severity issues (the flashXP notification crash, the XP ledger double-award window) are invisible in development because PostgreSQL raises the error and the app swallows it. The codebase rates higher-than-average for a startup because the architecture is sound; the bugs are implementation gaps, not design flaws.

**Projected Rating After All Fixes: 8.5 / 10**

Applying all recommended fixes closes every identified data-integrity hole, hardens the security surface (session eviction, CSP reporting, CSRF edge case, rate-limit bypass), and brings the migration file in sync with the ORM schema. The remaining 1.5-point gap from a perfect 10 reflects the inherent complexity of managing concurrent serverless functions without a dedicated task queue.

---

## Summary — All Bugs (one-line descriptions)

1. BUG-C01: `guild_members` table missing `left_at` column — `IS NULL` guard always passes for departed members
2. BUG-C02: `payout_dead_letter_queue.payout_id` has no UNIQUE constraint — `ON CONFLICT (payout_id)` crashes at runtime
3. BUG-C03: `flashXP.ts` notification INSERT references non-existent `reference_id` column on `notifications` table — crash swallowed, flash XP notifications never delivered
4. BUG-C04: Schema drift — raw SQL migration creates a **non-UNIQUE** index on `xp_ledger(user_id, source, reference_id)` but Drizzle schema and application code both require a **UNIQUE** index — `ON CONFLICT` silently never deduplicates, enabling double-awards
5. BUG-C05: `xpDrop.ts` uses `ON CONFLICT (source, reference_id)` with no matching unique index — runtime PostgreSQL error, mystery XP drops never insert
6. BUG-H01: `awardGiftXP` fires unconditional `UPDATE users SET xp_total = xp_total + $2` after a conditional INSERT — on duplicate gift retry the XP UPDATE runs even when no row was inserted, double-awarding XP
7. BUG-H02: `being_tipped_in_room` ledger INSERT in `gifts/send` route has no `ON CONFLICT` — duplicate gifts create duplicate room-tip ledger entries
8. BUG-H03: Idempotency key is deleted on `INSUFFICIENT_BALANCE` in `gifts/send` — retrying the failed request can proceed as a fresh request and double-charge if balance is briefly replenished
9. BUG-H04: `seedSeasonPassMilestones` assigns overlapping `sort_order` values 1–5 to both free **and** paid milestone sets, violating any unique constraint and scrambling milestone ordering
10. BUG-H05: Session eviction removes SIDs from the Redis sorted set but never deletes the `session:{sid}` hash keys — evicted sessions remain valid for up to 30 days
11. BUG-H06: `creator/payouts` route calls `SELECT FOR UPDATE` on `users.available_earnings_kobo` **outside** any transaction — the row lock is released immediately in autocommit mode; concurrent requests can overdraft and create multiple simultaneous payouts
12. BUG-H07: `guild_tier_history` INSERT uses `ON CONFLICT (guild_id, season_id)` in `warEngine.ts` but no such unique constraint exists in the table definition — runtime error on every war-tier save
13. BUG-H08: `aiClassifier.ts` calls `parseFloat()` on an LLM response string without checking for `NaN` — a malformed AI response silently passes moderation with a 0.0 score
14. BUG-M01: `rateLimit.ts` skips rate-limiting entirely for requests with an unresolvable or unknown IP — requests that reach the edge with no `x-forwarded-for` bypass all rate limits
15. BUG-M02: `middleware.ts` emits `report-to csp-endpoint` in the CSP header but never sets the `Report-To` HTTP header defining the endpoint — CSP violation reports are never actually delivered
16. BUG-M03: `referrals/commissions.ts` uses `ON CONFLICT DO NOTHING` without specifying a conflict target — PostgreSQL rejects the statement if no UNIQUE constraint is unambiguous
17. BUG-M04: `distributeCreatorFund` in `creator/fund.ts` performs its idempotency read (`SELECT` counting existing distributions) inside a transaction but **without** an advisory lock — two concurrent CRON runs can both read 0 rows and both distribute, doubling payouts
18. BUG-M05: `advanceMysteryXPDropLifecycle` in `xpDrop.ts` checks eligibility and then awards XP in separate steps without an atomic lock — concurrent CRON invocations can both pass the eligibility check and both award XP for the same drop

---

## Detailed Bug Descriptions

---

### 1. BUG-C01: `guild_members` missing `left_at` column

**FILES:**
- `apps/web/lib/guilds/warEngine.ts`
- `apps/web/lib/guilds/recordWarContribution.ts`
- `apps/web/db/migrations/0001_consolidated_schema.sql` (guild_members table definition)
- `apps/web/lib/db/schema.ts` (guildMembers Drizzle table)

**FIX:** The `guild_members` table has no `left_at` column anywhere — not in the Drizzle schema, not in the raw migration. Both `warEngine.ts` and `recordWarContribution.ts` query `WHERE gm.left_at IS NULL` to filter active members, but since the column does not exist PostgreSQL will throw "column gm.left_at does not exist" at runtime and the entire query fails. Add a nullable `left_at TIMESTAMPTZ` column to the `guild_members` table (both in a new migration and in the Drizzle schema). Also add a `deletedAt`/`leftAt` field to the Drizzle `guildMembers` table definition. Update all guild-member queries to set `left_at = NOW()` when a user leaves a guild (soft-delete pattern) rather than hard-deleting the row. Until then, replace `gm.left_at IS NULL` with a check on active membership via a flag column or by removing departed members via hard delete and removing the filter.

---

### 2. BUG-C02: `payout_dead_letter_queue.payout_id` no UNIQUE constraint

**FILES:**
- `apps/web/lib/payments/payouts.ts` (`moveToDeadLetterQueue` function)
- `apps/web/db/migrations/0001_consolidated_schema.sql` (payout_dead_letter_queue table, line ~1440)
- `apps/web/lib/db/schema.ts` (payoutDeadLetterQueue table definition)

**FIX:** `moveToDeadLetterQueue` calls `INSERT INTO payout_dead_letter_queue ... ON CONFLICT (payout_id) DO UPDATE ...`. PostgreSQL requires the conflict target column to be covered by a unique index or unique constraint — without one the statement throws "there is no unique or exclusion constraint matching the ON CONFLICT specification". Add `UNIQUE (payout_id)` to the `payout_dead_letter_queue` table in a new migration and add the corresponding `unique()` call to the Drizzle schema. This also prevents multiple DLQ entries for the same original payout.

---

### 3. BUG-C03: `flashXP.ts` notification INSERT references non-existent `reference_id` column

**FILES:**
- `apps/web/lib/events/flashXP.ts` (lines ~97 and ~146)
- `apps/web/db/migrations/0001_consolidated_schema.sql` (notifications table, line ~376)
- `apps/web/lib/db/schema.ts` (notifications table definition)

**FIX:** Two notification INSERTs in `advanceFlashXPLifecycle` use `ON CONFLICT (user_id, type, reference_id) DO NOTHING`. The `notifications` table has no `reference_id` column in either the Drizzle schema or the raw migration — the conflict target is invalid and PostgreSQL throws a runtime error. The error is caught by the surrounding `try/catch` and logged but swallowed, meaning flash XP event notifications are **never delivered**. Fix by either: (a) adding a `reference_id TEXT` column to the notifications table (in a new migration and Drizzle schema) and adding a unique index on `(user_id, type, reference_id)`, or (b) switching the conflict target to an existing unique constraint on notifications. Option (a) is preferred for idempotency. Also consider using the shared `insertNotification` helper from `lib/notifications/insert.ts` rather than raw SQL for all notification inserts to avoid future drift.

---

### 4. BUG-C04: Schema drift — `xp_ledger` unique index is NON-UNIQUE in the raw migration

**FILES:**
- `apps/web/db/migrations/0001_consolidated_schema.sql` (lines ~2901–2908, `idx_xp_ledger_user_source_ref`)
- `apps/web/lib/db/schema.ts` (`xpLedger` table, `sourceRefIdx` index)
- `apps/web/lib/xp/safeAwardXP.ts`
- `apps/web/lib/xp/safeAwardXP.ts` (`retryFailedXPAwards`)

**FIX:** The Drizzle schema defines `sourceRefIdx` as `uniqueIndex("uidx_xp_ledger_source_ref").on(...).where(sql\`reference_id IS NOT NULL\`)` — a partial UNIQUE index. The raw migration file instead creates `idx_xp_ledger_user_source_ref` as a plain non-unique index on the same columns. Both `safeAwardXP` and `retryFailedXPAwards` rely on `ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING` to prevent double-awards; without the UNIQUE index, PostgreSQL will silently ignore the conflict clause and insert every row unconditionally, making XP idempotency completely inoperative. Fix by adding a new migration that: (1) drops `idx_xp_ledger_user_source_ref`, and (2) creates `CREATE UNIQUE INDEX uidx_xp_ledger_source_ref ON xp_ledger(user_id, source, reference_id) WHERE reference_id IS NOT NULL`. Verify the migration is idempotent (it may fail if duplicate rows already exist — deduplicate first if needed).

---

### 5. BUG-C05: `xpDrop.ts` `ON CONFLICT (source, reference_id)` — no matching unique index

**FILES:**
- `apps/web/lib/mystery/xpDrop.ts`
- `apps/web/db/migrations/0001_consolidated_schema.sql` (mystery_xp_drop_grants table, if it exists)
- `apps/web/lib/db/schema.ts` (corresponding Drizzle table)

**FIX:** `advanceMysteryXPDropLifecycle` inserts into a grants/audit table using `ON CONFLICT (source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`. There is no unique index on `(source, reference_id)` for that table anywhere in the schema — PostgreSQL throws "there is no unique or exclusion constraint matching the ON CONFLICT specification" and the INSERT fails (error is swallowed). Add `CREATE UNIQUE INDEX` on `(source, reference_id) WHERE reference_id IS NOT NULL` to the relevant grants table in a new migration and reflect it in the Drizzle schema.

---

### 6. BUG-H01: `awardGiftXP` unconditional XP UPDATE after conditional INSERT

**FILES:**
- `apps/web/app/api/economy/gifts/send/route.ts` (`awardGiftXP` logic)

**FIX:** The gift-send route inserts an `xp_ledger` row with `ON CONFLICT ... DO NOTHING` (conditional), then **always** runs `UPDATE users SET xp_total = xp_total + $2` regardless of whether the INSERT produced a row. On a duplicate request the INSERT is skipped but the UPDATE still fires, incrementing `xp_total` again. Fix by using the same CTE pattern already used in `safeAwardXP`: wrap both the INSERT and UPDATE in a single CTE so the UPDATE only executes `WHERE EXISTS (SELECT 1 FROM ins)`. This makes the entire XP award atomic and idempotent in a single round-trip.

---

### 7. BUG-H02: `being_tipped_in_room` INSERT has no `ON CONFLICT` clause

**FILES:**
- `apps/web/app/api/economy/gifts/send/route.ts`

**FIX:** The gift-send route records room-tip events with a plain INSERT into a `being_tipped_in_room` (or equivalent) ledger table, with no idempotency guard. On a client retry or network duplicate, the same tip is recorded twice. Add `ON CONFLICT (gift_transaction_id) DO NOTHING` (or equivalent unique key for the tip event) to this INSERT, and ensure the underlying table has the corresponding unique constraint/index.

---

### 8. BUG-H03: Idempotency key deleted on `INSUFFICIENT_BALANCE`

**FILES:**
- `apps/web/app/api/economy/gifts/send/route.ts`

**FIX:** The route writes an idempotency key to Redis before processing, then deletes it in the `INSUFFICIENT_BALANCE` error branch. The intent is presumably to allow the user to retry after topping up, but the side-effect is that a race condition window exists: if two identical requests arrive simultaneously, both pass the idempotency check, the first one hits `INSUFFICIENT_BALANCE` and deletes the key, and the second one can now re-enter. Fix by either (a) keeping the idempotency key on `INSUFFICIENT_BALANCE` and returning a specific error code for the client to handle differently, or (b) use a short TTL on the key (e.g. 60 seconds) rather than explicit deletion so concurrent retries are still blocked, and let the client treat `INSUFFICIENT_BALANCE` as terminal without re-attempting with the same idempotency key.

---

### 9. BUG-H04: `seedSeasonPassMilestones` overlapping `sort_order` values

**FILES:**
- `apps/web/lib/seasons/seasonEngine.ts` (`seedSeasonPassMilestones` function)

**FIX:** The function seeds both free-tier milestones and paid-tier milestones, assigning `sort_order` values 1 through 5 to each set independently. If there is a unique constraint on `(season_id, tier, sort_order)` the second batch will conflict; if not, milestone ordering will be ambiguous when both tiers are queried together. Fix by ensuring the two milestone sets use non-overlapping sort orders (e.g. free: 1–5, paid: 6–10), or by scoping sort_order to be unique within `(season_id, tier)` only, with appropriate unique index reflecting that scope.

---

### 10. BUG-H05: Session eviction leaks `session:{sid}` Redis keys

**FILES:**
- `apps/web/lib/auth/session.ts` (eviction logic, `createSession` function)

**FIX:** When the session count exceeds `MAX_SESSIONS`, the code calls `redis.zremrangebyrank(userSessionsKey(userId), 0, -(MAX_SESSIONS + 1))` to remove the oldest SIDs from the sorted set. However, it never calls `redis.del(sessionKey(sid))` for each evicted SID. `getSession()` looks up sessions via `redis.get(sessionKey(sid))` — not the sorted set — so evicted sessions remain fully valid until their 30-day TTL expires. An attacker who captured an old session token can continue using it indefinitely past the session limit. Fix by fetching the SIDs that will be evicted with `zrange` **before** calling `zremrangebyrank`, then deleting those `session:{sid}` keys with `redis.del(...evictedSids.map(sessionKey))` in the same operation (or as a pipeline for efficiency).

---

### 11. BUG-H06: Creator payout `SELECT FOR UPDATE` outside any transaction

**FILES:**
- `apps/web/app/api/creator/payouts/route.ts`

**FIX:** The route locks `users.available_earnings_kobo` with `SELECT ... FOR UPDATE`, checks if the balance is sufficient, and checks for an existing pending payout — all **outside** any database transaction. In PostgreSQL's autocommit mode, the row lock from `FOR UPDATE` is released the moment the query completes, not when an explicit `COMMIT` occurs. By the time the subsequent INSERT (which initiates the payout) runs, the lock is gone. Two concurrent HTTP requests can both read a sufficient balance, both see no pending payout, and both proceed to create a payout and deduct the balance — resulting in overdraft and duplicate payout requests. Fix by wrapping the entire sequence (balance SELECT FOR UPDATE → pending-payout check → payout INSERT → balance deduction) inside a single `db.transaction(async (tx) => { ... })` block so the row lock is held for the duration.

---

### 12. BUG-H07: `guild_tier_history` ON CONFLICT without matching unique constraint

**FILES:**
- `apps/web/lib/guilds/warEngine.ts` (guild tier history upsert)
- `apps/web/db/migrations/0001_consolidated_schema.sql` (guild_tier_history table)
- `apps/web/lib/db/schema.ts` (guildTierHistory Drizzle table)

**FIX:** The war engine inserts into `guild_tier_history` with `ON CONFLICT (guild_id, season_id) DO UPDATE ...`. The `guild_tier_history` table has no unique constraint or unique index on `(guild_id, season_id)` in either the migration or the Drizzle schema. PostgreSQL throws "there is no unique or exclusion constraint matching the ON CONFLICT specification" at runtime — every war-tier save fails. Add `UNIQUE (guild_id, season_id)` to the `guild_tier_history` table (new migration + Drizzle schema) so the upsert can resolve conflicts correctly.

---

### 13. BUG-H08: `aiClassifier.ts` `parseFloat()` without NaN guard

**FILES:**
- `apps/web/lib/moderation/aiClassifier.ts`

**FIX:** The classifier calls `parseFloat(responseText)` on the raw string returned by the LLM (DeepSeek or Gemini). If the model returns a non-numeric response (explanation text, an error string, an empty string), `parseFloat` returns `NaN`. Downstream comparisons like `score > THRESHOLD` evaluate to `false` when `score` is `NaN`, causing the content to silently pass moderation with an apparent score of 0.0 rather than being flagged or escalated. Fix by adding a NaN check immediately after parsing: `if (isNaN(score)) throw new Error(\`Non-numeric moderation score: "${responseText}"\`)`. The existing circuit breaker will then correctly count this as a failure and activate the fallback provider, which is the right behavior.

---

### 14. BUG-M01: Unknown IP bypasses rate limiting

**FILES:**
- `apps/web/lib/security/rateLimit.ts`

**FIX:** When the client IP cannot be determined (no `x-forwarded-for`, no `request.ip`), `rateLimit.ts` logs a warning and returns `{ allowed: true, remaining: limit }` — effectively skipping rate limiting entirely for that request. On platforms like Vercel Edge, a missing `x-forwarded-for` is uncommon but possible (e.g. internal health checks, misconfigured proxies, or attackers crafting requests). Fix by: (a) configuring Vercel to always inject the client IP header (check `x-real-ip` as a fallback), and (b) returning `{ allowed: false }` — or using a shared sentinel key like `"unknown"` that has its own strict quota — when no IP can be resolved, rather than allowing the request unconditionally.

---

### 15. BUG-M02: CSP `report-to` directive missing `Report-To` HTTP header

**FILES:**
- `apps/web/middleware.ts` (`buildCsp` function)

**FIX:** The CSP string includes `report-to csp-endpoint` and `report-uri /api/security/csp-report`. The `report-to` directive requires a corresponding `Report-To` HTTP response header that defines the named endpoint group (`csp-endpoint`) with the collector URL. Without it, browsers that support the newer Reporting API silently drop violation reports (browsers fall back to `report-uri` only if `Report-To` is absent but `report-uri` is present). Fix by adding to the `withCsp` helper: `res.headers.set("Report-To", JSON.stringify({ group: "csp-endpoint", max_age: 86400, endpoints: [{ url: "/api/security/csp-report" }] }))`. This activates the Reporting API for modern browsers while the legacy `report-uri` directive continues to serve older browsers.

---

### 16. BUG-M03: `referrals/commissions.ts` `ON CONFLICT DO NOTHING` without explicit target

**FILES:**
- `apps/web/lib/referrals/commissions.ts`

**FIX:** The commissions INSERT uses `ON CONFLICT DO NOTHING` with no conflict target (no `ON CONFLICT (column_list) DO NOTHING`). PostgreSQL accepts this syntax only when there is exactly one unique constraint on the table, and it uses that constraint implicitly. If the `referral_commissions` table has more than one unique constraint (e.g. a primary key plus a business-logic unique index), PostgreSQL throws an error. More importantly, the intent is ambiguous — it's unclear which uniqueness property the deduplication is supposed to enforce. Fix by specifying the explicit conflict target column(s), e.g. `ON CONFLICT (referrer_id, referred_user_id, source) DO NOTHING`, and ensuring the matching unique index exists in the schema.

---

### 17. BUG-M04: `distributeCreatorFund` has no advisory lock — double-distribution on concurrent CRON runs

**FILES:**
- `apps/web/lib/creator/fund.ts` (`distributeCreatorFund` function)

**FIX:** The function checks whether distributions already exist for the current period inside a transaction, and only distributes if the count is zero. However, two concurrent CRON invocations can both start their transactions, both read a count of zero (the snapshot is taken before either commits), and both proceed to distribute — effectively doubling the payout for every eligible creator. Fix by acquiring a PostgreSQL advisory lock at the start of the function using `SELECT pg_try_advisory_lock($1)` with a stable integer key (e.g. `hashtext('distributeCreatorFund')`). If the lock cannot be acquired, return early (another instance is running). Release with `pg_advisory_unlock` in a `finally` block. This is the same pattern used elsewhere in the codebase for concurrency-sensitive CRON steps.

---

### 18. BUG-M05: Mystery XP drop concurrent CRON TOCTOU

**FILES:**
- `apps/web/lib/mystery/xpDrop.ts` (`advanceMysteryXPDropLifecycle` function)

**FIX:** The function reads the current drop state (eligibility, whether already awarded), then awards XP and updates state in a separate step. Between these two steps, a second concurrent invocation can also pass the eligibility check. Both invocations then call `safeAwardXP`, which has its own `ON CONFLICT DO NOTHING` guard — but only if `reference_id` is populated and the unique index exists (see BUG-C04/C05). Until those schema bugs are fixed, the XP CTE guard is inoperative and double-award is possible. Even after those fixes, the drop status update (`UPDATE mystery_xp_drops SET awarded_at = NOW()`) should be inside an atomic CTE or the same transaction as the XP ledger INSERT to eliminate the race window. Fix by wrapping the eligibility check UPDATE and the XP award in a single CTE: `UPDATE mystery_xp_drops SET awarded_at = NOW() WHERE id = $1 AND awarded_at IS NULL RETURNING id`, then check the RETURNING count before proceeding with the XP award. No separate eligibility SELECT is needed.

---

## Final Counts

| Severity | Count |
|---|---|
| Critical (C) — runtime crash or data loss | 5 |
| High (H) — security or integrity issue | 8 |
| Medium (M) — robustness / edge-case gap | 5 |
| **Total** | **18** |

---

*Report generated: 2026-06-15 10:24 PM UTC*  
*Analyst: Claude (claude-sonnet-4-6) — Zobia Forensic Code Review*
