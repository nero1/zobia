# Zobia Social — Bug Fix Plan

**Generated:** June 15, 2026 · 12:00 PM  
**Updated:** June 15, 2026 · 8:30 AM (fixes 21–29 added — 9.7 roadmap)  
**Source:** custom-bugs-report.md (29 confirmed bugs / improvements)  
**Branch:** `claude/codebase-bug-analysis-5g8o54`

---

## Fix Priority Order

Fixes are grouped into four waves. Apply them in wave order — later waves may depend on schema or structural changes introduced in earlier waves.

**Wave 1** — Critical & High-Risk: Fix before any new deployment  
**Wave 2** — High Severity: Fix before next feature release  
**Wave 3** — Medium Severity: Fix in the next planned sprint  
**Wave 4** — Infrastructure & Observability: Fix to reach 9.7 rating

---

## Wave 1 — Critical & High-Risk (Fix Immediately)

These bugs either cause financial over-credit, runtime SQL crashes that silently disable cron steps, visible admin panel breakage, or compliance/security violations.

---

### Fix 1 — BUG-FIN-01: Correct Payout Reversal Amount

**File:** `apps/web/app/api/economy/webhooks/paystack/route.ts`

In the `processTransferEvent` function, extend the SELECT to also retrieve `net_kobo`:

```sql
SELECT id, creator_id, gross_kobo, net_kobo, retry_count
FROM creator_payouts
WHERE provider_reference = $1
LIMIT 1
```

In the `transfer.reversed` branch, change the UPDATE parameter from `payout.gross_kobo` to `payout.net_kobo`:

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

Both call sites must resolve the sticker pack UUID before inserting. Follow the pattern in `lib/stickers/milestoneStickers.ts`:

1. `SELECT id FROM sticker_packs WHERE name = $1 LIMIT 1`
2. If no row: `INSERT INTO sticker_packs (name, ...) VALUES (...) ON CONFLICT (name) DO NOTHING RETURNING id`
3. `INSERT INTO user_sticker_packs (user_id, pack_id, acquired_at) VALUES ($1, $2, NOW()) ON CONFLICT (user_id, pack_id) DO NOTHING`

In cron step 18, this logic applies to both users in the streak pair. In `conversationScore.ts`, it applies to both conversation participants.

**Test:** Trigger a DM streak milestone (or mock the cron with a test user). Verify a row appears in `user_sticker_packs` with a valid `pack_id` UUID.

---

### Fix 3 — BUG-SQL-03: Remove `users.is_active` References

**File:** `apps/web/app/api/cron/daily/route.ts`

Search the entire file for `is_active` on the `users` table. Replace each occurrence with:

```sql
u.deleted_at IS NULL AND u.is_banned = false AND (u.is_suspended = false OR u.suspended_until <= NOW())
```

Also run `grep -rn "u\.is_active\|users\.is_active" apps/web/app/api/` to find any instances in other routes.

**Test:** Run the daily CRON in staging. Verify cron step 26 (council invitation) and the monthly plan bonus step complete without SQL errors.

---

### Fix 4 — BUG-SQL-01: Fix Nemesis Re-Engagement Column Name

**File:** `apps/web/app/api/cron/daily/route.ts` (cron step 19)

In the re-engagement query that JOINs `nemesis_assignments na`, replace every `na.nemesis_id` with `na.nemesis_user_id`. Alias it if needed:

```sql
-- WRONG:
SELECT na.user_id, na.nemesis_id, ...
-- CORRECT:
SELECT na.user_id, na.nemesis_user_id AS nemesis_id, ...
```

**Test:** In staging with test users who have active nemesis assignments and have been inactive for the trigger threshold, run the CRON and verify nemesis re-engagement notifications are inserted into `notifications`.

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
  user.id,          // userId — required for opt-out check
  're_engagement'   // notificationType — checked against user_email_preferences
).catch(() => {});
```

**Test:** Create a test user with re-engagement email opted out. Trigger the cron. Verify no email is sent to that user.

---

### Fix 6 — BUG-PAY-01: Use Exact Plan Code Matching for Subscriptions

**File:** `apps/web/app/api/economy/webhooks/paystack/route.ts`

Replace the fragile `includes()` matching with exact plan code mapping:

```typescript
const PLAN_CODE_MAP: Record<string, string> = {
  "PLN_your_plus_code": "plus",
  "PLN_your_pro_code":  "pro",
  "PLN_your_max_code":  "max",
};
const derivedPlan = PLAN_CODE_MAP[event.data.plan?.plan_code ?? ""] ?? null;
```

The plan code is available in `event.data.plan.plan_code` from Paystack's webhook payload and never changes when the display name changes.

**Test:** Send a test `subscription.create` webhook with each plan code and verify the correct `users.plan` value is set.

---

### Fix 7 — BUG-REF-01: Add Global CRON Advisory Lock

**File:** `apps/web/app/api/cron/daily/route.ts` (top of the POST handler)

Add a PostgreSQL advisory lock before any CRON processing begins:

```typescript
const { rows: lockRows } = await db.query<{ acquired: boolean }>(
  `SELECT pg_try_advisory_xact_lock(hashtext('zobia_daily_cron')) AS acquired`
);
if (!lockRows[0]?.acquired) {
  return NextResponse.json({ success: false, reason: 'LOCK_NOT_ACQUIRED' }, { status: 200 });
}
```

This is a transaction-scoped lock released automatically when the request ends. It protects all 30+ CRON steps simultaneously at zero write cost.

**Test:** Trigger two simultaneous CRON requests. Verify one returns `LOCK_NOT_ACQUIRED` and the other runs to completion.

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
  logger.warn({ eventId }, `Telegram delivery failed: ${err}`);
  // Do NOT mark as notified — retry on next CRON run
}
```

**Test:** Mock `sendTelegramMessage` to throw. Verify `telegram_notified` is NOT set and the event is retried on the next CRON run.

---

### Fix 21 — BUG-ADMIN-01: Fix Feature Flag Sanitizer / Rewire to Dedicated API

**Files:** `apps/web/app/api/admin/config/[key]/route.ts`, `apps/web/app/(admin)/admin/feature-flags/page.tsx`

**Option A (minimal):** Add `feature_*` recognition to `sanitizeManifestValue` in the config route:

```typescript
function sanitizeManifestValue(key: string, value: string): string {
  const lower = key.toLowerCase();

  if (
    lower.startsWith("feature_") ||   // ← add this line
    lower.includes("_enabled") ||
    lower.startsWith("is_") ||
    lower.includes("require_") ||
    lower.includes("allow_")
  ) {
    if (value !== "true" && value !== "false") {
      throw badRequest(`Value for '${key}' must be 'true' or 'false'.`, "INVALID_BOOLEAN_VALUE");
    }
    return value;
  }
  // ...
}
```

**Option B (preferred):** Rewire the feature-flags page to use the dedicated endpoint:

In `page.tsx`, change `handleToggle`:
```typescript
async function handleToggle(key: string, enabled: boolean) {
  const res = await fetch("/api/admin/feature-flags", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, enabled }),
  });
  if (!res.ok) throw new Error("Failed to save");
  showToast(`${key} ${enabled ? "enabled" : "disabled"}`);
}
```

Change the `useEffect` to fetch from `GET /api/admin/feature-flags` and adjust the response shape from `{ data: [...] }` to `{ items: [...] }`.

**Test:** Toggle any feature flag in the admin panel. Refresh the page. Verify the flag retains its new state.

---

### Fix 25 — SEC-01: Clear Pre-Auth Session After 2FA Completion

**File:** The 2FA completion handler (`apps/web/app/api/auth/verify-2fa/route.ts` or equivalent)

Immediately after successful 2FA verification, before issuing the full-access JWT:

```typescript
// Clear the pre-auth session to invalidate the one-time token
await db.query(`UPDATE users SET pre_auth_session = NULL WHERE id = $1`, [userId]);

// Also invalidate the pre-auth Redis session
await redis.del(`pre_auth_session:${preAuthSessionId}`);

// Only then issue the full-access JWT
const accessToken = await signAccessToken({ sub: userId, ... });
```

**Test:** Complete 2FA successfully. Attempt to reuse the same pre-auth token. Verify the second attempt is rejected with a 401 and does not issue a new access token.

---

## Wave 2 — High Severity (Fix Before Next Feature Deployment)

---

### Fix 9 — BUG-XP-01: Add Reference ID to Daily Login XP

**File:** `apps/web/app/api/cron/daily/route.ts` (cron step 4)

```typescript
const loginDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const referenceId = `daily_login:${user.id}:${loginDate}`;
await safeAwardXP(user.id, xpAmount, 'main', 'daily_login', referenceId);
```

The existing partial unique index `uidx_xp_ledger_source_ref` will deduplicate concurrent CRON fires at the database level.

**Test:** Call the CRON twice within the same day for the same user. Verify `xp_ledger` contains exactly one `daily_login` row for that user on that date.

---

### Fix 10 — BUG-XP-03: Replace `maybeAwardMessageXP` with `safeAwardXP`

**File:** `apps/web/app/api/rooms/[roomId]/messages/route.ts`

Delete the entire custom CTE inside `maybeAwardMessageXP`. Replace with:

```typescript
import { safeAwardXP } from '@/lib/xp/safeAwardXP';

await safeAwardXP(userId, calculatedXP, track, 'send_message', `msg_${messageId}`);
```

**Test:** Temporarily mock the DB to throw on the first XP call. Verify a row appears in `failed_xp_awards` rather than the XP being silently lost.

---

### Fix 11 — BUG-XP-04: Make DLQ Retries Atomic and Assign Synthetic Reference IDs

**File:** `apps/web/lib/xp/safeAwardXP.ts` (`retryFailedXPAwards`)

1. **Atomic retry**: Wrap the xp_ledger INSERT and `resolved_at` UPDATE in a single transaction:
```typescript
await globalDb.transaction(async (tx) => {
  await tx.query(`INSERT INTO xp_ledger ... ON CONFLICT DO NOTHING`, params);
  await tx.query(`UPDATE failed_xp_awards SET resolved_at = NOW() WHERE id = $1`, [row.id]);
});
```

2. **Synthetic reference ID for null entries**: In `safeAwardXP`'s catch block, generate a reference ID when none was provided:
```typescript
const effectiveRef = referenceId ?? `dlq:${userId}:${source}:${Date.now()}`;
```
Store `effectiveRef` in `failed_xp_awards.reference_id` so ON CONFLICT can deduplicate retries.

**Test:** Insert a `failed_xp_awards` row with `reference_id = NULL`. Run `retryFailedXPAwards` twice back-to-back. Verify `xp_ledger` has exactly one row for that award.

---

### Fix 12 — BUG-LB-01: Add `city IS NULL` to Global Rank Count Query

**File:** `apps/web/lib/leaderboards/engine.ts` (`getUserRank`)

In the `conditions` array, add city scope filtering for all non-city scopes:

```typescript
if (scope !== "city") {
  conditions.push(`ls.city IS NULL`);
}
```

**Test:** Insert leaderboard_snapshots rows for the same user with both global (`city = NULL`) and city-scoped (`city = 'Lagos'`) entries. Call `getUserRank` for global scope and verify the count excludes city-scoped rows.

---

### Fix 13 — BUG-DRIZZLE-01: Reconcile Drizzle Schema with SQL Migrations

**File:** `apps/web/lib/db/schema.ts`

Perform a column-by-column comparison of the Drizzle schema against `db/migrations/001_complete_schema.sql` and correct all divergences:

1. `userSubscriptions`: Add `nextRenewalAt: timestamp("next_renewal_at")`. Remove `currentPeriodStart`/`currentPeriodEnd` if absent from migration 001. Add `.unique()` to the `userId` column definition.

2. `roomSubscriptions`: Add `amountKobo: bigint("amount_kobo")`. Change column reference from `startsAt`/`starts_at` to `startedAt`/`started_at`.

3. `sponsoredQuestApplications`: Change `sponsorUserId` → `creatorId: uuid("creator_id")`.

4. `userBadges`: Remove `awardedAt` column (already dropped by migration 009).

5. Fix `migration 009` `CREATE TABLE` blocks for `system_alerts` and `creator_earnings` — see Fix 20.

After reconciliation, run `drizzle-kit check` against a local shadow database. Do not use `drizzle-kit push` on production until the schema is verified clean.

**Test:** After reconciling, run `drizzle-kit generate` and verify the generated SQL is an empty diff.

---

### Fix 14 — BUG-DB-01: Share Connection Pool Between Railway Adapter and Drizzle

**Files:** `apps/web/lib/db/providers/railway.ts`, `apps/web/lib/db/drizzle.ts`

1. In `railway.ts`, export the pool instance:
```typescript
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

2. In `drizzle.ts`, import and reuse it instead of creating a new pool:
```typescript
import { pool } from '@/lib/db/providers/railway';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';

export function getTypedDb() {
  return drizzle(pool, { schema });
}
```

**Test:** Monitor `SELECT count(*) FROM pg_stat_activity` before and after. Verify active connection count does not increase when `getTypedDb()` is called.

---

### Fix 15 — BUG-COIN-01: Make `transferCoins` idempotencyKey Required

**File:** `apps/web/lib/economy/coins.ts`

Remove the default value:
```typescript
// Before:
async function transferCoins(from, to, amount, type, idempotencyKey?: string, ...) {
  const key = idempotencyKey ?? `transfer:${from}:${to}:${amount}`;
// After:
async function transferCoins(from, to, amount, type, idempotencyKey: string, ...) {
  const key = idempotencyKey;
```

Update all callers to supply explicit idempotency keys scoped to the triggering event (gift ID, payment reference, or a UUID generated at request time). TypeScript enforces this at compile time.

---

### Fix 22 — BUG-ADMIN-02: Fix Admin Audit Log Column Names

**Files:** `apps/web/app/api/admin/config/[key]/route.ts`, `apps/web/app/api/admin/feature-flags/route.ts`

Update the audit log INSERT in the config API to use the correct column names:

```typescript
await client.query(
  `INSERT INTO admin_audit_log
     (admin_id, action, resource, resource_id, before_val, after_val, created_at)
   VALUES ($1, 'update_manifest', 'x_manifest', $2, $3::jsonb, $4::jsonb, NOW())`,
  [auth.user.sub, key, JSON.stringify(previousValue), JSON.stringify(sanitizedValue)]
);
// Remove the .catch(() => {}) wrapper
```

Update the feature-flags API to:
1. SELECT the previous value from `x_manifest` before the upsert
2. Use correct column names: `admin_id`, `resource`, `resource_id`, `before_val`, `after_val`
3. Remove `.catch(() => {})` wrappers on both INSERT attempts

---

### Fix 23 — BUG-ADMIN-03: Create `feature_flags` Migration

Create `apps/web/lib/db/migrations/010_feature_flags_table.sql` (or append to the next migration file):

```sql
CREATE TABLE IF NOT EXISTS feature_flags (
  key                TEXT PRIMARY KEY REFERENCES x_manifest(key) ON DELETE CASCADE,
  available_from     TIMESTAMPTZ,
  early_access_plans JSONB,
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feature_flags_available_from
  ON feature_flags (available_from)
  WHERE available_from IS NOT NULL;
```

**Test:** Deploy the migration. Call `GET /api/admin/feature-flags`. Verify it returns 200 and the `availableFrom`/`earlyAccessPlans` fields are present (null initially, settable via PUT).

---

### Fix 24 — BUG-CACHE-01: Fix `invalidateManifestCache` to Clear Per-Key Entries

**File:** `apps/web/lib/manifest/index.ts`

Update `invalidateManifestCache()` to also delete per-key Redis cache entries:

```typescript
export async function invalidateManifestCache(): Promise<void> {
  const pipeline = redis.pipeline();
  
  // Delete aggregate manifest cache
  pipeline.del(MANIFEST_CACHE_KEY);
  
  // Delete all per-key manifest entries
  const perKeyPattern = 'manifest:key:*';
  const keys = await redis.keys(perKeyPattern);
  if (keys.length > 0) {
    pipeline.del(...keys);
  }
  
  await pipeline.exec();
}
```

If `redis.keys()` is too slow at scale, maintain a `Set<string>` of known per-key cache names (add to it in `getManifestValue`, clear in `invalidateManifestCache`).

**Test:** Call `getManifestValue("feature_guild_wars")` to populate the per-key cache. Toggle the flag via the admin panel. Immediately call the API route that reads this flag. Verify it sees the updated value without waiting 60s.

---

## Wave 3 — Medium Severity (Fix in Next Planned Sprint)

---

### Fix 16 — BUG-XP-02: Scope Comeback Coin Reference ID to Date

**File:** `apps/web/app/api/cron/daily/route.ts` (cron step 11a)

Change the reference_id:
```typescript
// Before:
const referenceId = `comeback:${userId}`;
// After:
const referenceId = `comeback:${userId}:${new Date().toISOString().slice(0, 7)}`; // YYYY-MM
```

Additionally add a unique partial index to the coin_ledger via migration:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uidx_coin_ledger_user_ref
  ON coin_ledger (user_id, reference_id)
  WHERE reference_id IS NOT NULL;
```

---

### Fix 17 — BUG-SSE-01: Add Rate Limiting to SSE Stream Endpoint

**File:** `apps/web/app/api/rooms/[roomId]/stream/route.ts`

Add immediately after authentication is established:

```typescript
await enforceRateLimit(auth.user.sub, "user", {
  maxRequests: 30,
  windowSeconds: 60,
});
```

---

### Fix 18 — BUG-FUND-01: Include Platform Quests in Creator Fund Scoring

**File:** `apps/web/lib/creator/fund.ts` (`calculateFundDistributions`)

Replace the `qst` CTE:

```sql
qst AS (
  SELECT user_id, COUNT(*)::INTEGER AS quests_completed_30d
  FROM (
    SELECT creator_id AS user_id
    FROM sponsored_quest_applications
    WHERE updated_at >= NOW() - INTERVAL '30 days'
      AND status IN ('paid', 'approved')
    UNION ALL
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

Update the creator fund eligibility clause to reflect which tiers should participate (team decision — recommendation: `IN ('verified', 'elite', 'icon')` to include verified creators). Add a CHECK constraint:
```sql
ALTER TABLE users ADD CONSTRAINT users_creator_tier_check
  CHECK (creator_tier IN ('rookie', 'rising', 'verified', 'elite', 'icon'));
```

---

### Fix 20 — BUG-MIG-01: Fix Migration 009 Table Definitions

**File:** `apps/web/lib/db/migrations/009_bug_fixes.sql`

Remove the incorrect `CREATE TABLE IF NOT EXISTS system_alerts` and `CREATE TABLE IF NOT EXISTS creator_earnings` blocks. Replace with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for any genuinely new columns the migration was trying to add:

```sql
-- Only add columns that are genuinely new, not the entire table
ALTER TABLE system_alerts ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES users(id);
ALTER TABLE creator_earnings ADD COLUMN IF NOT EXISTS payout_id UUID REFERENCES creator_payouts(id);
```

Check `001_complete_schema.sql` to confirm what already exists before adding any `ADD COLUMN` statements.

---

## Wave 4 — Infrastructure & Observability (Required for 9.7 Rating)

These items are not runtime bugs but their absence is a ceiling on the overall quality score. Each one addresses a class of silent failure, performance degradation, or operational blindness that will manifest under production load.

---

### Fix 26 — INFRA-01: Add Graceful Shutdown / CRON Checkpoint Logic

**File:** `apps/web/app/api/cron/daily/route.ts`

Add a SIGTERM-aware shutdown flag and per-step checkpointing:

```typescript
// At module level
let shuttingDown = false;
if (typeof process !== 'undefined') {
  process.once('SIGTERM', () => { shuttingDown = true; });
}

// In the POST handler, before each major CRON step:
if (shuttingDown) {
  logger.warn('[CRON] Shutdown signal received — stopping after step %d', lastCompletedStep);
  break;
}

// After each step completes successfully:
await redis.set('cron:daily:last_completed_step', stepNumber, 'EX', 86400);

// At CRON startup:
const lastStep = await redis.get('cron:daily:last_completed_step');
if (lastStep) {
  logger.warn('[CRON] Previous run may have been interrupted at step %s', lastStep);
}
```

This gives operators visibility into interrupted runs and lets the codebase be extended with resumption logic in the future.

---

### Fix 27 — INFRA-02: Configure Explicit Connection Pool Limits

**Files:** `apps/web/lib/db/providers/railway.ts`, `apps/web/lib/db/providers/supabase.ts`, `apps/web/lib/db/providers/do.ts`

Update all pool instantiations:

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX ?? "3", 10),
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  allowExitOnIdle: true,
});
```

Set `DB_POOL_MAX=3` in environment config for serverless deployments (Vercel). Set `DB_POOL_MAX=10` for long-running server deployments (Railway web service). Document this in the environment variable README.

Additionally, evaluate moving to Supabase pooler mode (Transaction pooling) or a PgBouncer sidecar so that connections are shared across all serverless instances rather than per-process pools.

**Test:** Under load (20 concurrent API requests), monitor `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()`. Verify total connections stay below the Railway limit.

---

### Fix 28 — PERF-01: Add Missing Database Indexes

Create a new migration `apps/web/lib/db/migrations/011_performance_indexes.sql`:

```sql
-- DLQ retry query — currently table-scans failed_xp_awards on every CRON run
CREATE INDEX IF NOT EXISTS idx_failed_xp_awards_retry
  ON failed_xp_awards (retry_count, last_retried_at)
  WHERE resolved_at IS NULL;

-- Leaderboard range scan — supports ORDER BY rank ASC LIMIT/OFFSET for paginated leaderboards
CREATE INDEX IF NOT EXISTS idx_lb_snapshots_rank_global
  ON leaderboard_snapshots (season_id, scope, rank ASC)
  WHERE city IS NULL;

-- City leaderboard range scan
CREATE INDEX IF NOT EXISTS idx_lb_snapshots_rank_city
  ON leaderboard_snapshots (season_id, scope, city, rank ASC)
  WHERE city IS NOT NULL;

-- Notification unread feed — supports WHERE user_id = $1 AND read_at IS NULL ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_notifications_unread_feed
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;
```

These indexes are safe to add online with `CREATE INDEX CONCURRENTLY` in production to avoid table locks.

---

### Fix 29 — OBS-01: Integrate Sentry Error Tracking

**Files:** `apps/web/lib/logger.ts`, all route handlers in `apps/web/app/api/`

1. Install the SDK:
```bash
npm install @sentry/nextjs
npx @sentry/wizard@latest -i nextjs
```

2. In each API route catch block that currently calls `logger.error(...)`, also call:
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.captureException(err, {
  extra: { userId, source, operation },
  tags: { route: "cron/daily", step: "xp_award" },
});
```

3. Configure Sentry alert rules for the following critical paths:
   - `payment_*` — any exception in payment webhook handlers
   - `xp_award_*` — any exception causing DLQ write
   - `cron_*` — any CRON step failure
   - `admin_*` — any admin API error

4. Add a Sentry Cron Monitor to the daily CRON handler:
```typescript
const checkInId = Sentry.captureCheckIn({ monitorSlug: 'daily-cron', status: 'in_progress' });
// ... run CRON steps ...
Sentry.captureCheckIn({ checkInId, monitorSlug: 'daily-cron', status: 'ok' });
```
This alerts if the CRON fails to run or times out.

5. Add source map uploads to the Next.js build config so production stack traces resolve to original TypeScript lines rather than minified output.

---

## Additional Recommendations

### Alliance Wars Unique Constraint
Add a unique constraint to prevent duplicate active wars between the same alliance pair:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uidx_alliance_wars_active_pair
  ON alliance_wars (
    LEAST(alliance_1_id::text, alliance_2_id::text),
    GREATEST(alliance_1_id::text, alliance_2_id::text)
  ) WHERE status = 'active';
```
Update the `ON CONFLICT DO NOTHING` in cron step 32b to specify this index.

### Coin Ledger Unique Index on Reference ID
Already covered in Fix 16 but worth calling out as a standalone safety measure:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS uidx_coin_ledger_user_ref
  ON coin_ledger (user_id, reference_id)
  WHERE reference_id IS NOT NULL;
```

### CI Schema Drift Check
Add a GitHub Actions step that:
1. Spins up a test PostgreSQL instance
2. Applies all migrations from `db/migrations/` in order
3. Runs `drizzle-kit check` to compare the Drizzle schema against the migrated DB
4. Fails the build if any drift is detected

This prevents BUG-DRIZZLE-01 class of issues from accumulating again.

### `safeAwardXP` Trailing Comma
Restructure the UPDATE SET clause to avoid the trailing comma when `col === "xp_total"`:
```typescript
const extraSet = col === "xp_total" ? "" : `${col} = COALESCE(${col}, 0) + $2, `;
// SET xp_total = xp_total + $2, ${extraSet} updated_at = NOW()
```

---

## Fix Implementation Order Summary

| Wave | Fix # | Bug ID | Effort | Impact |
|------|-------|--------|--------|--------|
| 1 | Fix 1 | BUG-FIN-01 | 15 min | Critical financial |
| 1 | Fix 2 | BUG-SQL-02 | 1 hr | Critical runtime |
| 1 | Fix 3 | BUG-SQL-03 | 30 min | Critical runtime |
| 1 | Fix 4 | BUG-SQL-01 | 15 min | High — silent failure |
| 1 | Fix 5 | BUG-EMAIL-01 | 15 min | High — compliance |
| 1 | Fix 6 | BUG-PAY-01 | 30 min | High — wrong plan |
| 1 | Fix 7 | BUG-REF-01 | 30 min | High — double award |
| 1 | Fix 8 | BUG-TG-01 | 15 min | High — false confirm |
| 1 | Fix 21 | BUG-ADMIN-01 | 30 min | Critical — admin broken |
| 1 | Fix 25 | SEC-01 | 30 min | High — security |
| 2 | Fix 9 | BUG-XP-01 | 15 min | High — XP dedup |
| 2 | Fix 10 | BUG-XP-03 | 30 min | Medium — XP loss |
| 2 | Fix 11 | BUG-XP-04 | 45 min | Medium — XP dedup |
| 2 | Fix 12 | BUG-LB-01 | 15 min | Medium — rank accuracy |
| 2 | Fix 13 | BUG-DRIZZLE-01 | 2–3 hr | High — schema safety |
| 2 | Fix 14 | BUG-DB-01 | 45 min | Medium — connections |
| 2 | Fix 15 | BUG-COIN-01 | 30 min | Medium — idempotency |
| 2 | Fix 22 | BUG-ADMIN-02 | 45 min | High — audit trail |
| 2 | Fix 23 | BUG-ADMIN-03 | 20 min | Medium — missing table |
| 2 | Fix 24 | BUG-CACHE-01 | 30 min | Medium — cache stale |
| 3 | Fix 16 | BUG-XP-02 | 20 min | Medium — coin dedup |
| 3 | Fix 17 | BUG-SSE-01 | 15 min | Medium — rate limit |
| 3 | Fix 18 | BUG-FUND-01 | 45 min | Medium — fund accuracy |
| 3 | Fix 19 | BUG-TIER-01 | 30 min | Medium — tier logic |
| 3 | Fix 20 | BUG-MIG-01 | 30 min | Medium — migration safety |
| 4 | Fix 26 | INFRA-01 | 1.5 hr | High — reliability |
| 4 | Fix 27 | INFRA-02 | 45 min | High — pool exhaustion |
| 4 | Fix 28 | PERF-01 | 30 min | Medium — query perf |
| 4 | Fix 29 | OBS-01 | 2 hr | Medium — observability |

**Total estimated effort: ~17 hours of focused engineering time**

**Rating milestones:**
- After Wave 1 (10 fixes): ~7.5 / 10 — critical crashes and admin panel resolved
- After Wave 2 (10 more fixes): ~8.5 / 10 — core reliability and schema safety restored
- After Wave 3 (5 more fixes): ~9.0 / 10 — business logic correctness complete
- After Wave 4 (4 more fixes): **9.7 / 10** — infrastructure hardened, observability in place

---

*Plan generated: June 15, 2026 · 12:00 PM*  
*Updated: June 15, 2026 · 8:30 AM — fixes 21–29 added (9.7 roadmap); total effort ~17 hours*  
*Codebase: nero1/zobia — Branch: claude/codebase-bug-analysis-5g8o54*
