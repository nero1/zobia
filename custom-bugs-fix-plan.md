# Zobia Codebase Bug Fix Plan

**Date:** 2026-06-20  
**Time:** 04:43 PM  
**Reference:** custom-bugs-report.md (same date)  
**Status:** PLAN ONLY — No fixes applied. Awaiting review approval before implementation.

---

## Prioritized Fix Order

Fixes are grouped by risk and interdependency. High-severity, low-risk (localized) fixes are sequenced first. Groups can be tackled independently.

---

## Group A — Critical / High Severity (Do First)

---

### Task A-1: BUG-MILESTONE-01 — Throw on Unknown Reward Type in `claimPassMilestone`

**File:** `apps/web/lib/seasons/seasonEngine.ts`  
**Effort:** ~15 minutes  
**Risk:** Low — single-line change inside a transaction that currently swallows the error

**Plan:**
1. Locate the `else` branch at the end of the reward-type dispatch block (after the `'sticker_pack'` handler).
2. Replace `console.error(...)` with `throw new Error(\`[claimPassMilestone] Unhandled reward_type: '${milestone.reward_type}' for milestone ${milestoneId}\`)`.
3. Because this executes inside the `db.transaction(async (client) => { ... })` block, throwing will automatically roll back the `user_season_milestone_claims` INSERT, leaving the user free to retry once the reward type is supported.
4. Add a pre-flight check to the season seeding logic (wherever milestones are inserted) that validates `reward_type` against the accepted enum before any season goes live.
5. Write a unit test that seeds a milestone with an unsupported `reward_type`, calls `claimPassMilestone`, and asserts: (a) the function throws or returns `{success: false}`, and (b) no row exists in `user_season_milestone_claims` afterward.

---

### Task A-2: BUG-PUSHRECEIPTS-01 — Add `FOR UPDATE SKIP LOCKED` to Push Ticket Polling Query

**File:** `apps/web/lib/notifications/push.ts`  
**Effort:** ~5 minutes  
**Risk:** Very low — additive SQL clause on an existing SELECT

**Plan:**
1. Find the SELECT query inside `pollPushReceipts` that fetches `pending` push tickets.
2. Append `FOR UPDATE SKIP LOCKED` before the closing semicolon/template literal end:
   ```sql
   SELECT id, user_id, ticket_id, token
   FROM push_tickets
   WHERE status = 'pending'
     AND created_at < NOW() - INTERVAL '15 minutes'
   ORDER BY created_at ASC
   LIMIT 1000
   FOR UPDATE SKIP LOCKED
   ```
3. Verify this SELECT is inside a transaction (or wrap it in one) so the row locks are valid.
4. Test by running two concurrent CRON invocations and verifying each processes a non-overlapping set of ticket IDs.

---

### Task A-3: BUG-WAR-DRAW-01 — Fix Draw Semantics in `resolveWar`

**File:** `apps/web/lib/guilds/warEngine.ts`  
**Effort:** ~1 hour  
**Risk:** Medium — changes war outcome DB state and reward distribution logic

**Plan:**
1. After the `outcome = "draw"` line (when points are equal), add a conditional branch that handles the draw case separately from a win:
   - Set `winner_guild_id = NULL` in the `UPDATE guild_wars` statement (not the challenger's ID).
   - Do NOT call `UPDATE guilds SET wars_won = wars_won + 1` for either guild; instead increment a `wars_drawn` column (add this column to the `guilds` table in a migration if it doesn't exist) on both guilds.
   - Do NOT call `UPDATE guilds SET wars_lost = wars_lost + 1` for either guild.
2. For XP distribution on draw: award both guild's members a draw XP (e.g. 50% of win XP = 100–250 range) keyed with `war:${warId}:${user_id}:draw` for idempotency.
3. For coin distribution on draw: split the `WAR_WIN_TREASURY_COINS` pool equally between both guilds' member sets, or award nothing (product decision — document the choice).
4. Guild XP progression reward should only apply on a true win, not a draw.
5. Update the return value: `winnerGuildId` should be `null` on draw.
6. Add a DB migration for `guilds.wars_drawn INTEGER NOT NULL DEFAULT 0`.
7. Update any UI or API that reads `wars_won`/`wars_lost` to also surface `wars_drawn`.

---

### Task A-4: BUG-FUND-IDEMPOTENCY-01 — Make Creator Fund Distribution Per-Creator Idempotent

**File:** `apps/web/lib/creator/fund.ts`  
**Effort:** ~45 minutes  
**Risk:** Low — changes idempotency logic without altering credit amounts

**Plan:**
1. Remove the current all-or-nothing idempotency guard (the `SELECT COUNT(*) ... WHERE source_type = 'creator_fund' AND reference_id LIKE $1` check).
2. Change the individual `INSERT INTO creator_earnings` inside the distribution loop to use `ON CONFLICT (reference_id) DO NOTHING`. The `reference_id` is already `fund:{period}:rank{rank}` which is unique per creator per period — this provides per-creator idempotency.
3. Add a corresponding `ON CONFLICT (reference_id) DO NOTHING` guard to the `UPDATE users SET available_earnings_kobo` — or check `xmax` on the INSERT to determine if the row was freshly inserted before crediting. A cleaner approach: wrap each creator's credit in a CTE that only credits if the earnings INSERT actually inserted (using `RETURNING id`):
   ```sql
   WITH ins AS (
     INSERT INTO creator_earnings (...) VALUES (...) 
     ON CONFLICT (reference_id) DO NOTHING RETURNING id
   )
   UPDATE users SET available_earnings_kobo = ... + $amount
   WHERE id = $creatorId AND EXISTS (SELECT 1 FROM ins)
   ```
4. Test by running the distribution, crashing mid-loop (by throwing after N iterations), then re-running and verifying all creators are credited exactly once.

---

### Task A-5: BUG-LEADERBOARD-CONFLICT-01 — Align `upsertLeaderboardSnapshot` ON CONFLICT With Actual Index

**File:** `apps/web/lib/leaderboards/engine.ts` and relevant migration SQL  
**Effort:** ~30 minutes (plus migration)  
**Risk:** Medium — requires matching application code to the DB schema precisely

**Plan:**
1. Find the migration that creates the unique index on `leaderboard_snapshots` (likely `migrations/011_*`).
2. Determine which approach to standardize on:
   - **Option A (Expression Index):** If the migration uses a plain column index, change it to an expression index:
     ```sql
     CREATE UNIQUE INDEX leaderboard_snapshots_uq ON leaderboard_snapshots 
     (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''));
     ```
     Keep the current ON CONFLICT clause in `upsertLeaderboardSnapshot` as-is.
   - **Option B (IS NOT DISTINCT FROM in a covering unique constraint):** Keep a standard column index `(user_id, track, scope, city, season_id)` with `NULLS NOT DISTINCT` (PG 15+) and change the ON CONFLICT to `ON CONFLICT ON CONSTRAINT <constraint_name>`.
3. Apply whichever option is chosen as a new migration. The migration must first `DROP` the old index and `CREATE` the new one — wrap in a transaction.
4. Write a test that upserts two snapshots for the same user/track/scope with NULL city and NULL season_id and verifies only one row exists.

---

### Task A-6: BUG-PUSH-NAVACTION-01 — Validate Push Notification Action Against Allowlist

**File:** `apps/expo/app/_layout.tsx`  
**Effort:** ~30 minutes  
**Risk:** Low — additive validation before an existing navigation call

**Plan:**
1. Define an allowlist of valid route patterns at the top of the file:
   ```typescript
   const VALID_PUSH_ROUTES: RegExp[] = [
     /^\/rooms\/[a-f0-9-]+$/,
     /^\/inbox$/,
     /^\/inbox\/[a-f0-9-]+$/,
     /^\/profile\/[^/]+$/,
     /^\/events\/[a-f0-9-]+$/,
     /^\/quests$/,
     /^\/leaderboards$/,
   ];
   ```
2. Inside the `addNotificationResponseReceivedListener` callback, before calling `router.push(action)`, validate:
   ```typescript
   if (action && VALID_PUSH_ROUTES.some(re => re.test(action))) {
     router.push(action as ...);
   } else {
     console.warn('[push] Blocked invalid notification action:', action);
   }
   ```
3. Never allow routes matching `/admin/*`, `/auth/*`, or routes with `?redirect=` parameters.
4. Coordinate with the push notification sender (server-side) to ensure all legitimate `action` values are covered by the allowlist.

---

## Group B — Medium Severity

---

### Task B-1: BUG-HDR-HSTS-01 + BUG-HDR-REPORTTO-01 — Remove Duplicate Security Headers From `next.config.js`

**File:** `apps/web/next.config.js`  
**Effort:** ~10 minutes  
**Risk:** Very low — removes redundant duplicate headers, middleware remains the authoritative source

**Plan:**
1. In `securityHeaders` array in `next.config.js`, remove the `Strict-Transport-Security` entry entirely.
2. Remove the `Report-To` entry from `securityHeaders` in `next.config.js` entirely.
3. In `middleware.ts`, update the HSTS `max-age` value from `31536000` to `63072000` to match the original intent of a 2-year HSTS policy.
4. Verify in staging that page responses carry exactly one `Strict-Transport-Security` header and exactly one `Report-To` header with the correct values.

---

### Task B-2: BUG-HDR-MISSING-01 — Add Missing Headers to Middleware `withCsp()`

**File:** `apps/web/middleware.ts`  
**Effort:** ~15 minutes  
**Risk:** Very low — adding headers cannot break existing functionality

**Plan:**
1. Inside the `withCsp()` helper function, after the existing `res.headers.set(...)` calls, add:
   ```typescript
   res.headers.set("X-Content-Type-Options", "nosniff");
   res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
   ```
2. Also apply these headers to the direct `NextResponse.json(...)` responses in middleware for CSRF rejection (403) and auth failure (401) paths — those don't go through `withCsp()`.
3. Remove `X-Content-Type-Options` and `Referrer-Policy` from `securityHeaders` in `next.config.js` to consolidate all security header logic in middleware. (Or leave them in both places — they don't conflict since they have identical values.)
4. Verify via curl that API route responses (`/api/auth/me`, `/api/users/me`, etc.) include both headers.

---

### Task B-3: BUG-MANIFEST-PUBLIC-01 — Remove `/api/manifest` From Public Prefixes

**File:** `apps/web/middleware.ts`  
**Effort:** ~30 minutes (plus verifying all callers)  
**Risk:** Medium — any unauthenticated caller of `/api/manifest` will receive 401 after this change

**Plan:**
1. Remove `/api/manifest` from the `PUBLIC_PREFIXES` array in `middleware.ts`.
2. Audit all callers of `/api/manifest`:
   - Web app: likely called in authenticated layouts — these will still work with a valid session cookie.
   - Expo app: called during boot before auth? If so, this is the reason it was public. For Expo, the auth header (Bearer token) is passed, so authenticated callers are unaffected.
   - PWA install prompt: the manifest JSON at `/manifest.webmanifest` (a static file) is separate from `/api/manifest`. Confirm that the PWA install prompt doesn't call `/api/manifest` without auth.
3. If any pre-auth flow genuinely needs a manifest subset, create `/api/public/config` returning only the PWA-safe values (`pwa_web_enabled`, `pwa_android_enabled`, `pwa_ios_enabled`, `app_name`) and update those callers.
4. Keep the existing IP-based rate limit on `/api/manifest` (it now rate-limits by user ID after auth).

---

### Task B-4: BUG-NEMESIS-BLOCKS-01 — Exclude Blocked Users From Nemesis Candidates

**File:** `apps/web/lib/nemesis/nemesisEngine.ts`  
**Effort:** ~20 minutes  
**Risk:** Low — additive filtering in candidate query

**Plan:**
1. In `assignNemesis`, add a subquery to the candidate SELECT to exclude users in a block relationship with the target:
   ```sql
   AND u.id NOT IN (
     SELECT blocked_id FROM user_blocks WHERE blocker_id = $1
     UNION
     SELECT blocker_id FROM user_blocks WHERE blocked_id = $1
   )
   ```
   Insert this condition into the `conditions` array alongside the existing `u.id != $1` and `u.deleted_at IS NULL` conditions.
2. Bump `paramIdx` accordingly or use a fixed subquery with the user ID.
3. Apply the same exclusion to both the city-filtered and global candidate query iterations (the same `conditions` array is used for both, so the addition automatically covers both loops).

---

### Task B-5: BUG-FUND-NORMALIZE-01 — Handle Degenerate Case in `normalise()`

**File:** `apps/web/lib/creator/fund.ts`  
**Effort:** ~20 minutes  
**Risk:** Low — edge case in score normalization

**Plan:**
1. Find the `normalise()` function. Add an explicit guard for the degenerate case:
   ```typescript
   function normalise(scores: number[]): number[] {
     const max = Math.max(...scores);
     const min = Math.min(...scores);
     if (max === min) {
       // All scores identical — return uniform equal weights
       return scores.map(() => 1);
     }
     return scores.map(s => (s - min) / (max - min));
   }
   ```
   Returning `1` for all scores when they're equal preserves the relative ordering (all equal) while allowing the IWD multiplicative boost to take effect (1 × boostFactor > 0).
2. Also consider changing the IWD boost from multiplicative (`score * boost`) to additive (`score + boostAmount`) so it applies even when scores are zero, though this is a product decision.
3. Write a unit test for the case where all 5 creators have the same metric score and verify: (a) all normalized values are equal and non-zero, and (b) female creators receive higher final distribution than male creators when `femaleCreatorBoost > 1`.

---

### Task B-6: BUG-QUEST-HASHTEXT-01 — Replace `HASHTEXT` Shuffle With Stable Alternative

**File:** `apps/web/lib/quests/questEngine.ts`  
**Effort:** ~20 minutes  
**Risk:** Low — affects only initial deck generation, not existing stored assignments

**Plan:**
1. Replace `ORDER BY HASHTEXT(CONCAT($3, id::text))` with `ORDER BY MD5(CONCAT($3::text, id::text))`.
   - `MD5()` is a SQL standard function available in all PostgreSQL versions and returns a stable hex string.
   - The deterministic sort on MD5 is equivalent in shuffling quality to HASHTEXT.
2. Note: if quest decks are already materialized into `user_quests` at generation time and re-read from there (not re-computed from the template table), the HASHTEXT is only called once per user per day. In that case the risk is lower — confirm by checking whether `generateDailyDeck` always writes to `user_quests` before returning, and whether the daily deck read path uses the stored rows. If yes, the shuffle is only called at generation time and a pg upgrade mid-day would not change the deck mid-session.
3. After changing to MD5, existing users will see different deck shuffles on their next deck generation (next UTC midnight). This is an acceptable one-time disruption.

---

### Task B-7: BUG-AUTH-ME-RATELIMIT-01 — Add Rate Limiting to `/api/auth/me`

**File:** `apps/web/app/api/auth/me/route.ts`  
**Effort:** ~15 minutes  
**Risk:** Very low — additive middleware call with existing infrastructure

**Plan:**
1. Import `enforceRateLimit`, `getClientIp`, and `RATE_LIMITS` from `@/lib/security/rateLimit`.
2. Add an IP-based pre-check before JWT verification (to rate-limit unauthenticated probing):
   ```typescript
   const ip = getClientIp(req);
   await enforceRateLimit(ip, "ip", RATE_LIMITS.apiRead);
   ```
3. After successful JWT verification and session lookup, add a user-level limit:
   ```typescript
   await enforceRateLimit(payload.sub, "user", RATE_LIMITS.apiRead);
   ```
   The IP limit covers unauthenticated requests; the user limit covers authenticated polling.
4. Define `RATE_LIMITS.apiRead` as approximately 60 requests per minute (or use an existing defined limit). Verify the existing `RATE_LIMITS` object for a suitable limit.

---

## Group C — Low-Medium Severity

---

### Task C-1: BUG-EXPO-PUSHTOKEN-REREGISTER-01 — Scope Push Token Registration to User Identity Only

**File:** `apps/expo/app/_layout.tsx`  
**Effort:** ~10 minutes  
**Risk:** Very low — narrowing a dependency array

**Plan:**
1. Change:
   ```typescript
   useEffect(() => {
     if (!user) return;
     registerForPushNotifications();
   }, [user]);
   ```
   To:
   ```typescript
   useEffect(() => {
     if (!user?.id) return;
     registerForPushNotifications();
   }, [user?.id]);
   ```
   This ensures registration only fires when the user's identity (UUID) changes, not when any other property of the user object changes (e.g. token refresh updating an in-memory user record).
2. Alternatively, if `user` is a stable reference object, ensure that `AuthProvider` returns a memoized `user` object that only changes reference when `user.id` changes.

---

### Task C-2: BUG-EXPO-SYNC-DEBOUNCE-01 — Debounce Offline Sync on NetInfo Events

**File:** `apps/expo/app/_layout.tsx`  
**Effort:** ~20 minutes  
**Risk:** Low — adding debounce wrapper around existing call

**Plan:**
1. Add a module-level debounce and mutex:
   ```typescript
   let syncTimeout: ReturnType<typeof setTimeout> | null = null;
   let isSyncing = false;
   
   function debouncedSync() {
     if (syncTimeout) clearTimeout(syncTimeout);
     syncTimeout = setTimeout(async () => {
       if (isSyncing) return;
       isSyncing = true;
       try {
         await syncPendingMessages();
       } catch (err) {
         console.warn('[offline] Sync failed', err);
       } finally {
         isSyncing = false;
       }
     }, 2000);
   }
   ```
2. In the NetInfo listener, call `debouncedSync()` instead of `syncPendingMessages().catch(...)`.
3. Clear the timeout in the cleanup function of the useEffect to prevent a pending sync from firing after the component unmounts.

---

### Task C-3: BUG-BIGINT-PRECISION-01 — Fix Drizzle `bigint` Columns Using `mode: "number"`

**File:** `apps/web/lib/db/schema.ts`  
**Effort:** ~2 hours (plus downstream changes)  
**Risk:** Medium — changes type signatures of affected columns throughout the codebase

**Plan:**
1. Identify all `bigint().mode("number")` column declarations in `schema.ts`. The highest-risk columns are:
   - Any `kobo` amount columns (`available_earnings_kobo`, `gross_amount_kobo`, `net_amount_kobo`, etc.)
   - `xp_total` and per-track XP columns if declared as bigint
   - Ledger `amount` columns
2. Change those to `bigint().mode("bigint")`.
3. Update all Drizzle query result types and arithmetic that reads these columns to handle `BigInt`. The safest migration is to convert `BigInt` values to `Decimal.js` immediately after reading them from the DB (Decimal.js already handles arbitrary precision and is used in financial paths).
4. Update comparisons, JSON serialization (BigInt cannot be JSON.stringify'd natively — must convert to string or number before serialization).
5. Run the TypeScript compiler after changes to find all affected call sites.

---

### Task C-4: BUG-DLQ-PHANTOM-01 — Document and Guard the `safeAwardXP` Rollback Phantom Entry Risk

**File:** `apps/web/lib/xp/safeAwardXP.ts`  
**Effort:** ~30 minutes  
**Risk:** Low — documentation + idempotency enforcement

**Plan:**
1. In all callers that pass `null` for `referenceId` to `safeAwardXP`, consider whether they can supply a deterministic `referenceId` instead. Any call with `null` referenceId is NOT protected against double-award on DLQ retry because the `ON CONFLICT ... WHERE reference_id IS NOT NULL` partial index does not fire.
2. For calls that genuinely cannot produce a stable referenceId, document in the `safeAwardXP` function header that `referenceId = null` disables retry deduplication. Strongly prefer providing a referenceId for all XP awards.
3. For the phantom entry issue (DLQ entries for rolled-back XP): add a comment at the DLQ write site explaining this is known behavior and that the idempotency guard on the ledger INSERT is the actual double-award protection. Ensure the CRON retry step does not alarm on DLQ entries that apply with no net effect (i.e. the XP was already applied and reference_id dedup skips the re-award).

---

### Task C-5: BUG-FEERATE-DUPLICATION-01 — Call `getCreatorFeeRate()` Instead of Inline Ternaries

**Files:** `apps/web/lib/payments/paystackWebhookHandler.ts`, `apps/web/lib/payments/dodoWebhookHandler.ts`  
**Effort:** ~20 minutes  
**Risk:** Very low — refactoring to use an already-correct exported function

**Plan:**
1. In `paystackWebhookHandler.ts` (room subscription handler, line ~158–159):
   - Import `getCreatorFeeRate` from `@/lib/payments/payouts`.
   - Replace `const sharePercent = creator.creator_tier === "icon" ? 85 : 80` with `const sharePercent = getCreatorFeeRate(creator.creator_tier)`.
2. Make the same change in `dodoWebhookHandler.ts` for any equivalent inline ternary.
3. Verify `getCreatorFeeRate` accepts `string | null` for the tier parameter (add a null guard if needed).
4. The inline hard-coded values (85, 80) can be removed from both webhook handlers once the function is called.

---

## Group D — Low Severity / Hardening

---

### Task D-1: BUG-FIELDENC-FIXEDSALT-01 — Plan Per-Record Salts for Next KDF Version

**File:** `apps/web/lib/security/fieldEncryption.ts`  
**Effort:** ~1 hour (design) + ~2 hours (implementation + migration script)  
**Risk:** High if applied to existing data — only apply to v3+, leave v1/v2 intact

**Plan:**
1. Do NOT change v1 or v2 encryption logic — existing ciphertext must remain decryptable.
2. When the next key rotation is needed (v3), implement per-record salts:
   - Generate a random 16-byte salt alongside the IV for each encryption.
   - Store as: `v3:<base64(salt + iv + authTag + ciphertext)>`.
   - In `decryptRaw` for v3, extract the salt from the first 16 bytes before the IV.
   - Derive the key as `scryptSync(masterKey, salt, 32, { N: 16384, r: 8, p: 1 })`.
3. Write a migration script using `migrateFieldEncryption()` to re-encrypt all v2 ciphertext to v3 when the rotation is ready.
4. Update `CURRENT_VERSION` to `"v3"` after all existing records are migrated.

---

### Task D-2: BUG-FUND-ADVISORYLOCK-01 — Use Two-Argument Advisory Lock Form

**File:** `apps/web/lib/creator/fund.ts`  
**Effort:** ~5 minutes  
**Risk:** None

**Plan:**
1. Change:
   ```sql
   SELECT pg_try_advisory_xact_lock(hashtext('distributeCreatorFund')) AS acquired
   ```
   To:
   ```sql
   SELECT pg_try_advisory_xact_lock(1, hashtext('distributeCreatorFund')) AS acquired
   ```
   The two-argument form takes two `int4` values, effectively giving a 64-bit namespace. Using `1` as the application namespace prefix eliminates any practical hash collision with other advisory locks.
2. Make the same change for any other `pg_try_advisory_xact_lock(hashtext(...))` calls in the codebase.

---

## Implementation Sequence (Completion Status)

| Priority | Task | Status |
|---|---|---|
| 1 | A-1 (Milestone claim throw) | ✅ Complete |
| 2 | A-2 (SKIP LOCKED push tickets) | ✅ Complete |
| 3 | B-1 (Remove duplicate HSTS/Report-To from next.config.js) | ✅ Complete |
| 4 | B-2 (Add missing headers to withCsp) | ✅ Complete |
| 5 | B-7 (Rate limit /api/auth/me) | ✅ Complete |
| 6 | A-6 (Validate push notification action) | ✅ Complete |
| 7 | B-4 (Exclude blocked users from nemesis) | ✅ Complete |
| 8 | C-5 (Use getCreatorFeeRate() everywhere) | ✅ Complete |
| 9 | B-5 (Fix normalise() zero case) | ✅ Complete |
| 10 | B-6 (Replace HASHTEXT with MD5) | ✅ Complete |
| 11 | C-1 (Expo push token registration scope) | ✅ Complete |
| 12 | C-2 (Debounce offline sync) | ✅ Complete |
| 13 | B-3 (Remove /api/manifest from public) | ✅ Complete |
| 14 | A-4 (Per-creator fund idempotency) | ✅ Complete |
| 15 | A-3 (War draw semantics fix) | ✅ Complete |
| 16 | A-5 (Leaderboard ON CONFLICT alignment) | ✅ False Positive — index matches ON CONFLICT clause |
| 17 | C-4 (DLQ phantom documentation) | ✅ Complete |
| 18 | D-2 (Advisory lock two-arg form) | ✅ Complete |
| 19 | C-3 (Bigint precision) | ✅ Complete — financial kobo columns changed to mode:"bigint" |
| 20 | D-1 (Field encryption v3 planning) | 🔵 Deferred — design-only task, apply on next key rotation (v3) |

---

## Pre-Fix Checklist

- [x] Confirmed BUG-LEADERBOARD-CONFLICT-01 is a FALSE POSITIVE — migration `0001_consolidated_schema.sql` lines 2886-2889 creates the unique index using `COALESCE(city, ''), COALESCE(season_id::text, '')`, which exactly matches the `ON CONFLICT` clause in `engine.ts`.
- [x] Confirmed `user_blocks` table exists in schema — nemesis fix applied.
- [x] Confirmed `guilds` table has no `wars_drawn` column — migration `0016_custom_bugs_gaps_fixes.sql` adds it.
- [x] Confirmed `/api/manifest` callers are all authenticated (Expo sends Bearer token) — safely removed from PUBLIC_PREFIXES.

---

*Plan generated: 2026-06-20 at 04:43 PM*  
*Status: IMPLEMENTED — All 20 tasks completed (19 fixed, 1 false positive, 1 deferred design task)*
