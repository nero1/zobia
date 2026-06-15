# Zobia Codebase Bug Fix Plan
**Date:** 2026-06-15 | **Time:** 10:24 PM UTC  
**Scope:** Fix plan for all 18 bugs identified in `custom-bugs-report.md`  
**Branch:** `claude/codebase-bug-analysis-6qz2q4`

> **IMPORTANT:** Do not begin any fix until the bug report has been reviewed and this plan approved. Fixes are ordered by severity (Critical first), then by dependency (schema migrations before application code).

---

## Execution Order

Fix critical bugs before high and medium ones. Schema migrations must always precede application-code fixes that depend on the new columns/indexes. Several bugs share a root cause (missing schema constraints) so grouping migrations is efficient.

---

## Phase 1 — Database Schema Migrations (do these first, in a single migration file)

These fixes require new SQL migrations (`apps/web/db/migrations/`). All corresponding Drizzle schema changes must be made in `apps/web/lib/db/schema.ts` in the same PR so the ORM definition and the live database stay in sync.

---

### FIX-C01: Add `left_at` column to `guild_members`

**Bugs fixed:** BUG-C01

**Migration steps:**
1. Add `ALTER TABLE guild_members ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ DEFAULT NULL;`
2. Add index: `CREATE INDEX IF NOT EXISTS idx_guild_members_left_at ON guild_members(left_at) WHERE left_at IS NULL;`
3. Populate historical rows: `UPDATE guild_members SET left_at = NULL WHERE left_at IS NULL;` (no-op, just to confirm column exists)
4. In `apps/web/lib/db/schema.ts`, add `leftAt: timestamp("left_at")` to the `guildMembers` table object.

**Application code changes (after migration):**
- `apps/web/lib/guilds/warEngine.ts`: The `WHERE gm.left_at IS NULL` filter is now valid; no code change needed.
- `apps/web/lib/guilds/recordWarContribution.ts`: Same — filter is now valid.
- Add logic in the guild-leave endpoint/function to set `left_at = NOW()` instead of hard-deleting the `guild_members` row (soft-delete pattern). If the current code hard-deletes, the `WHERE left_at IS NULL` filter will return all rows anyway — still correct, but soft-delete is preferred for audit trails.

---

### FIX-C02: Add UNIQUE constraint to `payout_dead_letter_queue.payout_id`

**Bugs fixed:** BUG-C02

**Migration steps:**
1. Deduplicate first (in case duplicates exist): `DELETE FROM payout_dead_letter_queue WHERE id NOT IN (SELECT MIN(id) FROM payout_dead_letter_queue GROUP BY payout_id);`
2. `ALTER TABLE payout_dead_letter_queue ADD CONSTRAINT uq_pdlq_payout_id UNIQUE (payout_id);`
3. In `apps/web/lib/db/schema.ts`, add `.unique()` to the `payoutId` column or add `uniqueIndex('uq_pdlq_payout_id').on(t.payoutId)` to `payoutDeadLetterQueue`.

**No application code changes required** — `payouts.ts` already uses the correct `ON CONFLICT (payout_id) DO UPDATE` syntax; it just needs the constraint to exist.

---

### FIX-C03: Add `reference_id` column to `notifications` table

**Bugs fixed:** BUG-C03

**Migration steps:**
1. `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_id TEXT DEFAULT NULL;`
2. `CREATE UNIQUE INDEX IF NOT EXISTS uidx_notifications_user_type_ref ON notifications(user_id, type, reference_id) WHERE reference_id IS NOT NULL;`
3. In `apps/web/lib/db/schema.ts`, add `referenceId: text("reference_id")` to the `notifications` table and add the corresponding `uniqueIndex` with the partial `WHERE` clause.

**No application code changes required for flashXP** — `apps/web/lib/events/flashXP.ts` already uses the correct `ON CONFLICT (user_id, type, reference_id) DO NOTHING` syntax; it just needs the column and index to exist.

---

### FIX-C04: Replace non-unique `xp_ledger` index with UNIQUE partial index

**Bugs fixed:** BUG-C04

**Migration steps:**
1. Check for and remove duplicate rows first (if any): `DELETE FROM xp_ledger WHERE id NOT IN (SELECT MIN(id) FROM xp_ledger WHERE reference_id IS NOT NULL GROUP BY user_id, source, reference_id) AND reference_id IS NOT NULL;`
2. Drop old index: `DROP INDEX IF EXISTS idx_xp_ledger_user_source_ref;`
3. Create UNIQUE partial index: `CREATE UNIQUE INDEX uidx_xp_ledger_source_ref ON xp_ledger(user_id, source, reference_id) WHERE reference_id IS NOT NULL;`
4. In `apps/web/lib/db/schema.ts`, confirm the Drizzle `sourceRefIdx` definition is already `uniqueIndex("uidx_xp_ledger_source_ref")...` — no change needed to schema.ts if the Drizzle definition already uses the correct index name. Verify names match.

**No application code changes required** — `safeAwardXP.ts` and `retryFailedXPAwards` already use the correct `ON CONFLICT` clause; they just need the UNIQUE index to exist.

---

### FIX-C05: Add UNIQUE partial index for mystery XP drop grants table

**Bugs fixed:** BUG-C05

**Migration steps:**
1. Identify the exact table name used in `apps/web/lib/mystery/xpDrop.ts` for the grants INSERT.
2. `CREATE UNIQUE INDEX IF NOT EXISTS uidx_mystery_xp_grants_source_ref ON <grants_table>(source, reference_id) WHERE reference_id IS NOT NULL;`
3. Update Drizzle schema to add the matching `uniqueIndex` with partial WHERE clause.

---

### FIX-H07: Add UNIQUE constraint to `guild_tier_history(guild_id, season_id)`

**Bugs fixed:** BUG-H07

**Migration steps:**
1. Deduplicate: `DELETE FROM guild_tier_history WHERE id NOT IN (SELECT MIN(id) FROM guild_tier_history GROUP BY guild_id, season_id);`
2. `ALTER TABLE guild_tier_history ADD CONSTRAINT uq_guild_tier_history_guild_season UNIQUE (guild_id, season_id);`
3. In `apps/web/lib/db/schema.ts`, add `uniqueIndex('uq_guild_tier_history_guild_season').on(t.guildId, t.seasonId)` to `guildTierHistory`.

**No application code changes required** — `warEngine.ts` already uses the correct `ON CONFLICT (guild_id, season_id) DO UPDATE` syntax.

---

### FIX-M03: Add explicit UNIQUE constraint for `referral_commissions` dedup

**Bugs fixed:** BUG-M03

**Migration steps:**
1. Determine the intended unique key for referral commission deduplication (likely `(referrer_id, referred_user_id, source)` or `(referrer_id, transaction_id)`).
2. Add the appropriate unique index.
3. Update `apps/web/lib/referrals/commissions.ts` to change `ON CONFLICT DO NOTHING` to `ON CONFLICT (referrer_id, referred_user_id, source) DO NOTHING` (or whichever columns constitute the business key).
4. Update Drizzle schema accordingly.

---

## Phase 2 — Application Code Fixes (after Phase 1 migrations are applied)

---

### FIX-H01 + FIX-H02: Fix `awardGiftXP` double-award and missing `ON CONFLICT` in gift-send route

**Bugs fixed:** BUG-H01, BUG-H02

**File:** `apps/web/app/api/economy/gifts/send/route.ts`

**Steps:**
1. For BUG-H01: Rewrite `awardGiftXP` to use the same CTE pattern as `safeAwardXP`. Combine the `xp_ledger` INSERT and the `users` UPDATE into a single SQL statement:
   ```sql
   WITH ins AS (
     INSERT INTO xp_ledger (...) VALUES (...)
     ON CONFLICT ... DO NOTHING
     RETURNING id
   )
   UPDATE users SET xp_total = xp_total + $2
   WHERE id = $1 AND EXISTS (SELECT 1 FROM ins)
   ```
   Alternatively, call `safeAwardXP()` directly rather than duplicating the XP award logic.

2. For BUG-H02: Add `ON CONFLICT (gift_transaction_id) DO NOTHING` (or the appropriate unique column) to the `being_tipped_in_room` INSERT. Confirm the unique column/index exists on that table; if not, add it in Phase 1.

---

### FIX-H03: Do not delete idempotency key on `INSUFFICIENT_BALANCE`

**Bugs fixed:** BUG-H03

**File:** `apps/web/app/api/economy/gifts/send/route.ts`

**Steps:**
1. Remove the `redis.del(idempotencyKey)` call from the `INSUFFICIENT_BALANCE` error branch.
2. Let the idempotency key expire naturally via its TTL.
3. Ensure the error response to the client includes a distinct error code (`INSUFFICIENT_BALANCE`) so the client can present appropriate UI without retrying with the same key.

---

### FIX-H04: Fix overlapping `sort_order` in `seedSeasonPassMilestones`

**Bugs fixed:** BUG-H04

**File:** `apps/web/lib/seasons/seasonEngine.ts`

**Steps:**
1. Change the paid-tier milestone seed to use `sort_order` values 6–10 (or any non-overlapping range).
2. Alternatively, if the unique constraint on `season_pass_milestones` is scoped to `(season_id, tier, sort_order)`, then overlapping is fine as long as the unique index reflects that scope. Verify the constraint and adjust accordingly.
3. Review any queries that sort milestones to ensure they filter by `tier` before applying `ORDER BY sort_order` if sort_order is tier-scoped.

---

### FIX-H05: Delete evicted `session:{sid}` Redis keys on eviction

**Bugs fixed:** BUG-H05

**File:** `apps/web/lib/auth/session.ts`

**Steps:**
1. Before calling `zremrangebyrank`, fetch the SIDs that will be removed using `redis.zrange(userSessionsKey(userId), 0, -(MAX_SESSIONS + 1))`.
2. After `zremrangebyrank`, delete those session keys: `await redis.del(...evictedSids.map(sid => sessionKey(sid)))`. Use a pipeline for atomic efficiency: `const pipe = redis.pipeline(); evictedSids.forEach(sid => pipe.del(sessionKey(sid))); await pipe.exec()`.
3. Add a unit test for the eviction path that verifies `session:{sid}` keys no longer exist in Redis after eviction.

---

### FIX-H06: Wrap creator payout balance check and deduction in a transaction

**Bugs fixed:** BUG-H06

**File:** `apps/web/app/api/creator/payouts/route.ts`

**Steps:**
1. Wrap the entire payout initiation sequence in `db.transaction(async (tx) => { ... })`:
   - Move `SELECT ... FOR UPDATE` on `users.available_earnings_kobo` inside the transaction.
   - Move the "existing pending payout" check inside the transaction.
   - Move the payout INSERT and balance deduction UPDATE inside the transaction.
2. The `FOR UPDATE` lock is now held until `COMMIT`, preventing concurrent requests from passing both checks simultaneously.
3. Return appropriate error responses (`INSUFFICIENT_BALANCE`, `PAYOUT_ALREADY_PENDING`) from inside the transaction based on the locked reads.

---

### FIX-H08: Add NaN guard to `aiClassifier.ts` score parsing

**Bugs fixed:** BUG-H08

**File:** `apps/web/lib/moderation/aiClassifier.ts`

**Steps:**
1. After `const score = parseFloat(responseText)`, add: `if (!Number.isFinite(score)) throw new Error(\`Non-numeric moderation score: "${responseText.slice(0, 100)}"\`);`
2. The circuit breaker will record the failure and activate the fallback provider (Gemini/DeepSeek), which is the correct escalation path.
3. Optionally add a regex pre-check on `responseText` to extract a float if the LLM wraps the number in explanation text (e.g. `responseText.match(/\d+\.?\d*/)?.[0]`), but throwing on non-numeric is the safe default.

---

### FIX-M01: Reject or restrict requests with unknown IP in rate limiter

**Bugs fixed:** BUG-M01

**File:** `apps/web/lib/security/rateLimit.ts`

**Steps:**
1. Change the unknown-IP fallback from `return { allowed: true }` to either:
   - `return { allowed: false, remaining: 0, error: 'UNRESOLVABLE_IP' }` (safest — blocks the request), or
   - Use a shared sentinel key `"ip:unknown"` with a very low quota (e.g. 5 req/min) so any requests without a resolvable IP share a single strict bucket.
2. In the middleware or request handler, check `x-real-ip` as a fallback before `x-forwarded-for`.
3. Ensure Vercel's edge config always injects the real client IP header.

---

### FIX-M02: Add `Report-To` HTTP header for CSP endpoint

**Bugs fixed:** BUG-M02

**File:** `apps/web/middleware.ts` (`withCsp` helper function)

**Steps:**
1. In the `withCsp` function, after setting the `Content-Security-Policy` header, add:
   ```
   res.headers.set("Report-To", JSON.stringify({
     group: "csp-endpoint",
     max_age: 86400,
     endpoints: [{ url: "/api/security/csp-report" }]
   }));
   ```
2. This activates the Reporting API for Chrome/Firefox and modern Safari, while the existing `report-uri` directive continues to cover older browsers.

---

### FIX-M04: Add advisory lock to `distributeCreatorFund`

**Bugs fixed:** BUG-M04

**File:** `apps/web/lib/creator/fund.ts`

**Steps:**
1. At the top of `distributeCreatorFund`, acquire a PostgreSQL advisory lock:
   ```sql
   SELECT pg_try_advisory_lock(hashtext('distributeCreatorFund'))
   ```
2. If the result is `false`, log and return early (another instance is running).
3. Wrap the entire distribution logic in a `try/finally` block, releasing the lock in `finally`:
   ```sql
   SELECT pg_advisory_unlock(hashtext('distributeCreatorFund'))
   ```
4. This is the same pattern used in other CRON-sensitive operations in the codebase.

---

### FIX-M05: Eliminate TOCTOU in mystery XP drop lifecycle

**Bugs fixed:** BUG-M05

**File:** `apps/web/lib/mystery/xpDrop.ts`

**Steps:**
1. Replace the two-step "check eligibility → award XP" pattern with a single atomic CTE:
   ```sql
   WITH claim AS (
     UPDATE mystery_xp_drops
     SET awarded_at = NOW()
     WHERE id = $1 AND awarded_at IS NULL
     RETURNING id, user_id, amount
   )
   INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, ...)
   SELECT user_id, amount, 'main', 'mystery_drop', id::text, ...
   FROM claim
   ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING
   ```
2. This makes the eligibility check (the `WHERE awarded_at IS NULL` UPDATE) and the XP ledger INSERT atomic. Only one concurrent caller will get a row back from the CTE; the other sees 0 rows and inserts nothing.
3. Requires BUG-C04 and BUG-C05 schema fixes to be in place first so the `ON CONFLICT` index exists.

---

## Phase 3 — Verification Checklist

After all fixes are applied:

- [ ] Run the full Drizzle migration set on a staging database and verify no errors
- [ ] Confirm `xp_ledger` UNIQUE partial index exists in staging DB via `\d xp_ledger`
- [ ] Confirm `notifications.reference_id` column exists and unique index is active
- [ ] Confirm `guild_members.left_at` column exists
- [ ] Confirm `payout_dead_letter_queue` unique constraint on `payout_id` exists
- [ ] Confirm `guild_tier_history` unique constraint on `(guild_id, season_id)` exists
- [ ] Send a duplicate gift request and verify XP is awarded exactly once
- [ ] Trigger a flash XP event and verify the notification is delivered
- [ ] Simulate concurrent payout requests and verify only one succeeds
- [ ] Check Redis after session eviction to confirm old `session:{sid}` keys are gone
- [ ] Send a request with no `x-forwarded-for` header and verify rate limiter blocks it
- [ ] Inspect response headers for CSP-protected routes and confirm `Report-To` header is present
- [ ] Send a non-numeric string to the AI classifier test endpoint and confirm it is rejected (not silently passed)

---

*Plan generated: 2026-06-15 10:24 PM UTC*  
*Analyst: Claude (claude-sonnet-4-6) — Zobia Forensic Code Review*
