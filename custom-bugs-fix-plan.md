# Zobia Social — Bug Fix Plan

**Generated:** June 15, 2026 · 12:00 PM  
**Source:** custom-bugs-report.md (20 confirmed bugs)  
**Branch:** `claude/codebase-bug-analysis-5g8o54`

---

## Fix Priority Order

Fixes are grouped into three waves. Apply them in wave order — later waves may depend on schema or structural changes introduced in earlier waves.

---

## Wave 1 — Critical & High-Risk (Fix Immediately)

These bugs either cause financial over-credit, runtime SQL crashes that silently disable cron steps, or compliance violations. Fix before any other deployment.

---

### Fix 1 — BUG-FIN-01: Correct Payout Reversal Amount

**File:** `apps/web/app/api/economy/webhooks/paystack/route.ts`

In the `processTransferEvent` function, the SELECT query that fetches payout data already retrieves `gross_kobo`. Extend that SELECT to also retrieve `net_kobo`:

```sql
SELECT id, creator_id, gross_kobo, net_kobo, retry_count
FROM creator_payouts
WHERE provider_reference = $1
LIMIT 1
```

Then in the `transfer.reversed` branch, change the UPDATE parameter from `payout.gross_kobo` to `payout.net_kobo`:

```sql
UPDATE users
SET available_earnings_kobo = available_earnings_kobo + $1, updated_at = NOW()
WHERE id = $2
```

with `[payout.net_kobo, payout.creator_id]` as parameters.

**Test:** Create a payout of gross ₦10,000 (net ₦9,000 after 10% fee). Simulate a `transfer.reversed` webhook. Verify `available_earnings_kobo` increases by 9,000 not 10,000.

---

### Fix 2 — BUG-SQL-02: Fix Sticker Pack INSERT Column Names

**Files:** `apps/web/app/api/cron/daily/route.ts` (cron step 18), `apps/web/lib/messaging/conversationScore.ts`

Both call sites must be changed to resolve the sticker pack UUID before inserting. The pattern from `lib/stickers/milestoneStickers.ts` is the reference implementation:

1. `SELECT id FROM sticker_packs WHERE name = $1 LIMIT 1`
2. If no row: `INSERT INTO sticker_packs (name, description, pack_type, sticker_count, is_earnable, price_coins) VALUES (...) ON CONFLICT (name) DO NOTHING RETURNING id`
3. `INSERT INTO user_sticker_packs (user_id, pack_id, acquired_at) VALUES ($1, $2, NOW()) ON CONFLICT (user_id, pack_id) DO NOTHING`

In cron step 18, this logic applies to both users in the streak pair (u1 and u2). In `conversationScore.ts`, it applies to both participants in the conversation.

**Test:** Trigger a DM streak milestone (or mock the cron with a test user). Verify a row appears in `user_sticker_packs` with a valid `pack_id` UUID.

---

### Fix 3 — BUG-SQL-03: Remove `users.is_active` References

**File:** `apps/web/app/api/cron/daily/route.ts`

Search the entire file for `is_active` references that target the `users` table (look for `u.is_active` or `users.is_active` without a table alias that points to another table). Replace each with:

```sql
u.deleted_at IS NULL AND u.is_banned = false AND (u.is_suspended = false OR u.suspended_until <= NOW())
```

Audit other API routes for the same pattern using `grep -rn "u\.is_active\|users\.is_active" apps/web/app/api/`.

**Test:** Run the daily CRON in a staging environment and verify that cron step 26 (council invitation) and the monthly plan bonus step complete without SQL errors in the error array.

---

### Fix 4 — BUG-SQL-01: Fix Nemesis Re-Engagement Column Name

**File:** `apps/web/app/api/cron/daily/route.ts` (cron step 19)

In the re-engagement query that JOINs `nemesis_assignments na`, replace every reference to `na.nemesis_id` with `na.nemesis_user_id`. Both columns exist in the DB; `nemesis_user_id` is the NOT NULL column holding the actual assigned rival.

```sql
-- WRONG:
SELECT na.user_id, na.nemesis_id, ...
-- CORRECT:
SELECT na.user_id, na.nemesis_user_id AS nemesis_id, ...
```

**Test:** In staging with test users who have active nemesis assignments and have been inactive for the trigger threshold, run the CRON and verify nemesis re-engagement notifications are inserted into the `notifications` table.

---

### Fix 5 — BUG-EMAIL-01: Pass User ID to Re-Engagement Email Calls

**File:** `apps/web/app/api/cron/daily/route.ts` (cron step 11)

All `sendEmail` calls in the re-engagement block must include the user's ID and notification type:

```typescript
await sendEmail(
  user.email,
  subjectLine,
  textBody,
  htmlBody,
  user.id,            // userId — required for opt-out check
  're_engagement'     // notificationType — checked against user_email_preferences
).catch(() => {});
```

Verify the `sendEmail` function signature in `lib/notifications/email.ts` and confirm these are the correct parameter positions.

**Test:** Create a test user with re-engagement email opted out (`user_email_preferences` row with `re_engagement = false`). Trigger the cron. Verify no email is sent to that user.

---

### Fix 6 — BUG-PAY-01: Use Exact Plan Code Matching for Subscriptions

**File:** `apps/web/app/api/economy/webhooks/paystack/route.ts`

Replace the fragile `includes()` matching:

```typescript
const derivedPlan: string | null = planNameLower.includes("max") ? "max"
  : planNameLower.includes("plus") ? "plus"
  : planNameLower.includes("pro") ? "pro"
  : null;
```

With exact code matching. Add a mapping from Paystack plan codes to internal tier names, either in the manifest or a config constant:

```typescript
const PLAN_CODE_MAP: Record<string, string> = {
  "PLN_your_plus_code": "plus",
  "PLN_your_pro_code": "pro",
  "PLN_your_max_code": "max",
};
const derivedPlan = PLAN_CODE_MAP[event.data.plan?.plan_code ?? ""] ?? null;
```

The plan code is available in `event.data.plan.plan_code` from Paystack's webhook payload.

**Test:** Send a test `subscription.create` webhook with each plan code and verify the correct `users.plan` value is set.

---

### Fix 7 — BUG-REF-01: Add Global CRON Advisory Lock

**File:** `apps/web/app/api/cron/daily/route.ts` (top of the POST handler)

Add a PostgreSQL advisory lock at the very start of the handler to prevent concurrent CRON invocations:

```typescript
const { rows: lockRows } = await db.query<{ acquired: boolean }>(
  `SELECT pg_try_advisory_xact_lock(hashtext('zobia_daily_cron')) AS acquired`
);
if (!lockRows[0]?.acquired) {
  return NextResponse.json({ success: false, reason: 'LOCK_NOT_ACQUIRED' }, { status: 200 });
}
```

This is a transaction-scoped lock that is automatically released when the request ends. It is cheap (no writes to any table) and protects all 30+ cron steps simultaneously.

**Test:** Trigger two simultaneous CRON requests (e.g., via curl with `&` in bash). Verify one returns `LOCK_NOT_ACQUIRED` and the other runs to completion.

---

### Fix 8 — BUG-TG-01: Await Telegram Delivery Before Marking as Notified

**File:** `apps/web/app/api/cron/daily/route.ts` (cron step 19)

```typescript
// BEFORE (fire-and-forget, wrong):
sendTelegramMessage(chatId, message);
await db.query(`UPDATE user_inactivity_events SET telegram_notified = true WHERE id = $1`, [eventId]);

// AFTER (await delivery first):
try {
  await sendTelegramMessage(chatId, message);
  await db.query(`UPDATE user_inactivity_events SET telegram_notified = true WHERE id = $1`, [eventId]);
} catch (err) {
  // Delivery failed — do NOT mark as notified; retry on next CRON run
  logger.warn({ eventId }, `Telegram delivery failed: ${err}`);
}
```

**Test:** Mock `sendTelegramMessage` to throw. Verify the `telegram_notified` flag is NOT set and the event is retried on the next CRON run.

---

## Wave 2 — High Severity (Fix Before Next Feature Deployment)

---

### Fix 9 — BUG-XP-01: Add Reference ID to Daily Login XP

**File:** `apps/web/app/api/cron/daily/route.ts` (cron step 4)

In the loop that awards daily login XP, compute a deterministic reference ID before the `safeAwardXP` call:

```typescript
const loginDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const referenceId = `daily_login:${user.id}:${loginDate}`;
await safeAwardXP(user.id, xpAmount, 'main', 'daily_login', referenceId);
```

The existing partial unique index `uidx_xp_ledger_source_ref ON xp_ledger(user_id, source, reference_id) WHERE reference_id IS NOT NULL` will deduplicate concurrent CRON fires at the database level.

**Test:** Call the cron twice within the same day for the same user. Verify `xp_ledger` contains exactly one `daily_login` row for that user on that date.

---

### Fix 10 — BUG-XP-03: Replace `maybeAwardMessageXP` with `safeAwardXP`

**File:** `apps/web/app/api/rooms/[roomId]/messages/route.ts`

Delete the entire custom CTE inside `maybeAwardMessageXP`. Replace with:

```typescript
import { safeAwardXP } from '@/lib/xp/safeAwardXP';

// Inside maybeAwardMessageXP:
await safeAwardXP(
  userId,
  calculatedXP,
  track,
  'send_message',
  `msg_${messageId}`
);
```

The `safeAwardXP` function already implements the correct CTE pattern (INSERT ledger + UPDATE user XP atomically) and provides DLQ fallback. The `msg_${messageId}` reference ensures deduplication if the route handler retries.

**Test:** Temporarily mock the DB to throw on the first XP call. Verify a row appears in `failed_xp_awards` rather than the XP being silently lost.

---

### Fix 11 — BUG-XP-04: Make DLQ Retries Atomic and Assign Synthetic Reference IDs

**File:** `apps/web/lib/xp/safeAwardXP.ts` (`retryFailedXPAwards`)

Two changes:

1. **Atomic retry**: Wrap the xp_ledger INSERT and the `resolved_at` UPDATE in a single `db.transaction`:
```typescript
await globalDb.transaction(async (tx) => {
  await tx.query(`INSERT INTO xp_ledger ... ON CONFLICT DO NOTHING`, params);
  await tx.query(`UPDATE failed_xp_awards SET resolved_at = NOW() WHERE id = $1`, [row.id]);
});
```

2. **Synthetic reference ID for null entries**: When writing to `failed_xp_awards` in `safeAwardXP` (the catch block), generate a reference ID if none was provided:
```typescript
const effectiveRef = referenceId ?? `dlq:${userId}:${source}:${Date.now()}`;
// Store effectiveRef in failed_xp_awards.reference_id
```
Then use this stored reference_id during retry to benefit from ON CONFLICT deduplication.

**Test:** Insert a `failed_xp_awards` row with `reference_id = NULL`. Run `retryFailedXPAwards` twice back-to-back (simulating a retry after partial failure). Verify `xp_ledger` has exactly one row for that award.

---

### Fix 12 — BUG-LB-01: Add `city IS NULL` to Global Rank Count Query

**File:** `apps/web/lib/leaderboards/engine.ts` (`getUserRank`)

In the `conditions` array, add city scope filtering to match `getLeaderboard`:

```typescript
// After the seasonal condition block:
if (scope !== "city") {
  conditions.push(`ls.city IS NULL`);
}
```

This should be placed adjacent to the existing scope-specific conditions (national, city, guild) in the conditions array, not after the params array is built.

**Test:** Insert leaderboard_snapshots rows for the same user with both global (`city = NULL`) and city (`city = 'Lagos'`) scope. Call `getUserRank` for global scope and verify the count excludes city-scoped rows.

---

### Fix 13 — BUG-DRIZZLE-01: Reconcile Drizzle Schema with SQL Migrations

**File:** `apps/web/lib/db/schema.ts`

This is the most extensive fix. Perform a column-by-column comparison of the Drizzle schema against `db/migrations/001_complete_schema.sql` and correct all divergences:

1. `userSubscriptions`: Add `nextRenewalAt: timestamp("next_renewal_at")` column. Remove `currentPeriodStart`/`currentPeriodEnd` if they don't exist in migration 001. Add `.unique()` to the `userId` column definition.

2. `roomSubscriptions`: Add `amountKobo: bigint("amount_kobo")` column. Change `startsAt` to reference column `started_at` (rename in schema: `startedAt: timestamp("started_at")`).

3. `sponsoredQuestApplications`: Change `sponsorUserId` → `creatorId: uuid("creator_id")`. Check for all other column differences.

4. `userBadges`: Remove `awardedAt` column (already dropped by migration 009).

5. Fix `migration 009` `CREATE TABLE` blocks for `system_alerts` and `creator_earnings` — see Fix 20.

After reconciliation, run `drizzle-kit check` against a local shadow database as a CI step to prevent future drift. Do not use `drizzle-kit push` on production until the schema is verified clean.

**Test:** After reconciling, run `drizzle-kit generate` and verify the generated SQL is an empty diff (no changes to apply).

---

### Fix 14 — BUG-DB-01: Share Connection Pool Between Railway Adapter and Drizzle

**Files:** `apps/web/lib/db/providers/railway.ts`, `apps/web/lib/db/drizzle.ts`

1. In `railway.ts`, export the underlying `pg.Pool` instance:
```typescript
export const pool = new Pool({ ... }); // the existing pool
```

2. In `drizzle.ts`, import and reuse it:
```typescript
import { pool } from '@/lib/db/providers/railway';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export function getTypedDb() {
  return drizzle(pool, { schema });
}
```

This gives Drizzle the same pool reference, eliminating the duplicate pool.

**Test:** Monitor `SELECT count(*) FROM pg_stat_activity` before and after the change. Verify the active connection count does not increase when `getTypedDb()` is called.

---

### Fix 15 — BUG-COIN-01: Make `transferCoins` idempotencyKey Required

**File:** `apps/web/lib/economy/coins.ts`

Remove the default value from `idempotencyKey`:
```typescript
// Before:
async function transferCoins(from, to, amount, type, idempotencyKey?: string, ...) {
  const key = idempotencyKey ?? `transfer:${from}:${to}:${amount}`;
// After:
async function transferCoins(from, to, amount, type, idempotencyKey: string, ...) {
  const key = idempotencyKey;
```

Update all callers to supply explicit idempotency keys scoped to the triggering event (gift ID, payment reference, etc.). Use TypeScript to enforce this — remove the `?` makes it a compile-time error to omit it.

---

## Wave 3 — Medium Severity (Fix in Next Planned Sprint)

---

### Fix 16 — BUG-XP-02: Scope Comeback Coin Reference ID to Date

**File:** `apps/web/app/api/cron/daily/route.ts` (cron step 11a)

Change the comeback coin reference_id from `comeback:${userId}` to `comeback:${userId}:${new Date().toISOString().slice(0, 7)}` (YYYY-MM granularity). Additionally, add a unique partial index to the coin_ledger table:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_coin_ledger_ref ON coin_ledger(user_id, reference_id) WHERE reference_id IS NOT NULL;
```

This prevents any duplicate-reference credit at the database level.

---

### Fix 17 — BUG-SSE-01: Add Rate Limiting to SSE Stream Endpoint

**File:** `apps/web/app/api/rooms/[roomId]/stream/route.ts`

Add at the top of the GET handler, immediately after auth context is established:

```typescript
await enforceRateLimit(auth.user.sub, "user", {
  maxRequests: 30,
  windowSeconds: 60,
});
```

Import `enforceRateLimit` and `RATE_LIMITS` from `@/lib/security/rateLimit` following the pattern in other route handlers.

---

### Fix 18 — BUG-FUND-01: Include Platform Quests in Creator Fund Scoring

**File:** `apps/web/lib/creator/fund.ts` (`calculateFundDistributions`)

Replace the `qst` CTE:

```sql
qst AS (
  SELECT user_id, COUNT(*)::INTEGER AS quests_completed_30d
  FROM (
    -- Sponsored quests
    SELECT creator_id AS user_id
    FROM sponsored_quest_applications
    WHERE updated_at >= NOW() - INTERVAL '30 days'
      AND status IN ('paid', 'approved')
    UNION ALL
    -- Platform quests
    SELECT user_id
    FROM user_quest_progress
    WHERE quest_date >= CURRENT_DATE - INTERVAL '30 days'
      AND completed = true
  ) q
  GROUP BY user_id
)
```

---

### Fix 19 — BUG-TIER-01: Define Canonical Creator Tier Boundaries

**Files:** `apps/web/app/api/cron/daily/route.ts`, `apps/web/lib/creator/fund.ts`

Decision required: choose between four or five tiers. Recommendation based on the PRD's "Elite/Icon" description suggesting they were meant as two distinct tiers:

- 0–99 members → "rookie"
- 100–499 → "rising"
- 500–1999 → "verified"
- 2000–4999 → "elite"
- 5000+ → "icon"

Update `tierForCount` in cron step 28:
```typescript
const tierForCount = (count: number): string => {
  if (count >= 5000) return "icon";
  if (count >= 2000) return "elite";
  if (count >= 500)  return "verified";
  if (count >= 100)  return "rising";
  return "rookie";
};
```

Update the creator fund eligibility to reflect which tiers should receive fund distributions (e.g., `IN ('verified', 'elite', 'icon')` or keep `IN ('elite', 'icon')` — team decision).

Add a `CHECK` constraint on the `users` table:
```sql
ALTER TABLE users ADD CONSTRAINT users_creator_tier_check
  CHECK (creator_tier IN ('rookie', 'rising', 'verified', 'elite', 'icon'));
```

---

### Fix 20 — BUG-MIG-01: Fix Migration 009 Table Definitions

**File:** `apps/web/lib/db/migrations/009_bug_fixes.sql`

Remove the incorrect `CREATE TABLE IF NOT EXISTS system_alerts` and `CREATE TABLE IF NOT EXISTS creator_earnings` blocks. If migration 009 needs to add specific columns to these tables, use:

```sql
-- For system_alerts (if a new column is needed):
ALTER TABLE system_alerts ADD COLUMN IF NOT EXISTS some_new_col TEXT;

-- For creator_earnings (if the payout_id column was missing):
ALTER TABLE creator_earnings ADD COLUMN IF NOT EXISTS payout_id UUID REFERENCES creator_payouts(id);
```

Check `001_complete_schema.sql` to confirm what columns already exist before adding any `ADD COLUMN` statements.

---

## Additional Recommendations

### Alliance Wars Unique Constraint
Add a unique constraint to prevent duplicate active wars between the same alliance pair:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uidx_alliance_wars_active_pair
  ON alliance_wars (
    LEAST(alliance_1_id::text, alliance_2_id::text),
    GREATEST(alliance_1_id::text, alliance_2_id::text),
    status
  ) WHERE status = 'active';
```
Update the `ON CONFLICT DO NOTHING` in cron step 32b to specify this index.

### Coin Ledger Unique Index on Reference ID
Add a partial unique index to prevent all classes of duplicate credit:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uidx_coin_ledger_user_ref
  ON coin_ledger(user_id, reference_id)
  WHERE reference_id IS NOT NULL;
```

### CI Schema Drift Check
Add a GitHub Actions step that:
1. Spins up a test PostgreSQL instance
2. Applies all migrations from `db/migrations/`
3. Runs `drizzle-kit check` to compare the Drizzle schema against the migrated DB
4. Fails the build if any drift is detected

This prevents BUG-DRIZZLE-01 class of issues from accumulating again.

---

## Fix Implementation Order Summary

| Wave | Fix | Bug ID | Effort | Impact |
|------|-----|--------|--------|--------|
| 1 | Fix 1 | BUG-FIN-01 | 15 min | Critical financial |
| 1 | Fix 2 | BUG-SQL-02 | 1 hr | Critical runtime |
| 1 | Fix 3 | BUG-SQL-03 | 30 min | Critical runtime |
| 1 | Fix 4 | BUG-SQL-01 | 15 min | High — silent failure |
| 1 | Fix 5 | BUG-EMAIL-01 | 15 min | High — compliance |
| 1 | Fix 6 | BUG-PAY-01 | 30 min | High — wrong plan |
| 1 | Fix 7 | BUG-REF-01 | 30 min | High — double award |
| 1 | Fix 8 | BUG-TG-01 | 15 min | High — false confirm |
| 2 | Fix 9 | BUG-XP-01 | 15 min | High — XP dedup |
| 2 | Fix 10 | BUG-XP-03 | 30 min | Medium — XP loss |
| 2 | Fix 11 | BUG-XP-04 | 45 min | Medium — XP dedup |
| 2 | Fix 12 | BUG-LB-01 | 15 min | Medium — rank accuracy |
| 2 | Fix 13 | BUG-DRIZZLE-01 | 2–3 hr | High — schema safety |
| 2 | Fix 14 | BUG-DB-01 | 45 min | Medium — connections |
| 2 | Fix 15 | BUG-COIN-01 | 30 min | Medium — idempotency |
| 3 | Fix 16 | BUG-XP-02 | 20 min | Medium — coin dedup |
| 3 | Fix 17 | BUG-SSE-01 | 15 min | Medium — rate limit |
| 3 | Fix 18 | BUG-FUND-01 | 45 min | Medium — fund accuracy |
| 3 | Fix 19 | BUG-TIER-01 | 30 min | Medium — tier logic |
| 3 | Fix 20 | BUG-MIG-01 | 30 min | Medium — migration safety |

**Total estimated effort: ~11 hours of focused engineering time**

---

*Plan generated: June 15, 2026 · 12:00 PM*  
*Codebase: nero1/zobia — Branch: claude/codebase-bug-analysis-5g8o54*
