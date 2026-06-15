# Zobia Social — Bug Fix Plan

**Date:** June 15, 2026  
**Time:** 06:38 AM  
**Source:** custom-bugs-report.md (30 confirmed bugs)  
**Analyst:** Claude Code — Full Codebase Forensic Analysis  
**Branch:** `claude/codebase-bug-analysis-duq6ut`

> **IMPORTANT: DO NOT BEGIN ANY FIX UNTIL THIS PLAN HAS BEEN REVIEWED AND APPROVED.**

---

## Overview

This plan covers all 30 bugs identified in `custom-bugs-report.md`. Fixes are ordered by impact and dependency — migration fixes must come first because multiple code bugs are downstream of the schema inconsistency. Within each phase, independent fixes can be parallelised.

**Estimated scope:**  
- Phase 1 (Migration surgery): 1–2 developer-days  
- Phase 2 (Runtime-breaking code fixes): 1–2 developer-days  
- Phase 3 (Data correctness + security): 1 developer-day  
- Phase 4 (Performance + polish): half a day  

---

## Phase 1 — Migration System Surgery (Do First, Blocks Everything Else)

These must be resolved before any other code fix, because BUG-04/05 are the structural root cause of BUG-01, BUG-02, BUG-03, BUG-06, BUG-07, BUG-08, BUG-09, BUG-27, and BUG-30.

---

### TASK-01 · Fix BUG-04 — Consolidate the two competing migration directories

**Priority:** CRITICAL  
**Files:** `apps/web/db/migrations/`, `apps/web/lib/db/migrations/`, Drizzle config  
**Effort:** Large (requires careful audit)

The codebase has two parallel migration directories that define overlapping tables with different schemas. This is the single biggest structural risk in the entire codebase.

**Steps:**

1. Decide on ONE canonical migration directory. The recommendation is `apps/web/db/migrations/` — it contains the richer, more complete schema in migration 001. The `lib/db/migrations/` directory is the newer but inconsistent one.

2. Audit every migration in `lib/db/migrations/` to extract any genuinely new schema additions (tables or columns that `db/migrations/` does NOT have). Port those additions into new numbered migrations under `db/migrations/`.

3. Remove or archive `lib/db/migrations/` entirely once all net-new content has been ported.

4. Update the Drizzle config (wherever `drizzle.config.ts` or `drizzle.config.js` is defined) to point only at `apps/web/db/migrations/`.

5. Ensure there is exactly one migration runner invocation in CI/CD.

6. After consolidating, run a full schema diff against a fresh database to confirm no tables or columns are missing.

---

### TASK-02 · Fix BUG-05 — Remove the broken `gifts` column rename in migration 009

**Priority:** CRITICAL  
**Files:** `apps/web/lib/db/migrations/009_bug_fixes.sql`  
**Effort:** Small

Migration 009 contains `ALTER TABLE gifts RENAME COLUMN gift_type_id TO gift_item_id`. The `gifts` table created by migration 001 has no `gift_type_id` column — this rename has always thrown a fatal error and broken the migration chain for any environment that applies both migration directories.

**Steps:**

1. Delete the `ALTER TABLE gifts RENAME COLUMN gift_type_id TO gift_item_id` statement from `009_bug_fixes.sql`.

2. Verify the rest of migration 009 does not reference `gift_type_id` or `gift_item_id` anywhere.

3. If a `gifts` schema change is actually needed, create a fresh migration in the canonical `db/migrations/` directory that aligns with migration 001's gifts schema (which already has both `coin_value` and `coin_cost`).

---

### TASK-03 · Fix BUG-07 — Add UNIQUE constraint to `room_subscriptions`

**Priority:** CRITICAL  
**Files:** `apps/web/db/migrations/` (new migration), `apps/web/lib/db/schema.ts`  
**Effort:** Small

Without this, Paystack's VIP room subscription webhook always throws on `ON CONFLICT (room_id, user_id) DO UPDATE`, meaning paid room access is never granted.

**Steps:**

1. Create a new migration (e.g. `012_room_subscriptions_unique.sql`) under `db/migrations/`:
   ```sql
   ALTER TABLE room_subscriptions
     ADD CONSTRAINT room_subscriptions_room_user_unique UNIQUE (room_id, user_id);
   ```

2. Update the Drizzle schema (`lib/db/schema.ts`) `roomSubscriptions` table definition to add a `uniqueIndex` on `(room_id, user_id)`.

---

### TASK-04 · Fix BUG-08 — Add UNIQUE index to `season_pass_milestones`

**Priority:** CRITICAL  
**Files:** `apps/web/db/migrations/` (new migration), `apps/web/lib/db/schema.ts`  
**Effort:** Small

Without this index, `seedSeasonPassMilestones`'s `ON CONFLICT (season_id, sort_order) DO NOTHING` always errors — season pass milestones can never be seeded.

**Steps:**

1. Add to a new migration:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS season_pass_milestones_season_sort_unique
     ON season_pass_milestones (season_id, sort_order);
   ```

2. Add the corresponding unique index to the Drizzle schema `seasonPassMilestones` table.

---

### TASK-05 · Fix BUG-09 — Ensure leaderboard expression index exists on all environments

**Priority:** CRITICAL  
**Files:** `apps/web/db/migrations/011_bug_fixes.sql`, canonical migration dir  
**Effort:** Small

If migration 011 has not been applied (or is in the wrong directory), the `leaderboard_snapshots` UPSERT `ON CONFLICT` fails, creating duplicate rows.

**Steps:**

1. Copy the expression index creation from `011_bug_fixes.sql` into a guaranteed-run migration in the canonical `db/migrations/` directory if it isn't already there.

2. Verify the migration creates:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_snapshots_upsert_key
     ON leaderboard_snapshots (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''));
   ```

3. Drop any plain UNIQUE constraint on the same table that would conflict.

---

### TASK-06 · Fix BUG-03 & BUG-30 — Add `updated_at` column to `seasons` table

**Priority:** CRITICAL  
**Files:** `apps/web/db/migrations/` (new migration), `apps/web/lib/db/schema.ts`, `apps/web/lib/seasons/seasonEngine.ts`, `apps/web/app/api/cron/daily/route.ts`  
**Effort:** Small

Two separate code paths (`resetSeasonRankings` and CRON daily) run `UPDATE seasons SET … updated_at = NOW()` — this column is missing from the `seasons` table defined in migration 001.

**Steps:**

1. Add to a new migration:
   ```sql
   ALTER TABLE seasons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
   UPDATE seasons SET updated_at = created_at WHERE updated_at IS NULL;
   ```

2. Add `updatedAt` to the `seasons` Drizzle schema definition.

---

### TASK-07 · Fix BUG-06 — Replace `severity = 'high'` in `system_alerts` INSERT

**Priority:** CRITICAL  
**Files:** `apps/web/app/api/economy/webhooks/paystack/route.ts` (line ~450)  
**Effort:** Trivial

The `system_alerts` table has a `CHECK (severity IN ('info','warning','critical'))` constraint. The Paystack webhook inserts `severity = 'high'` which violates this — the alert is dropped and the DB raises an error.

**Steps:**

1. Find all `severity = 'high'` strings in `apps/web/app/api/economy/webhooks/paystack/route.ts` and change them to `severity = 'warning'` or `severity = 'critical'` as appropriate for each context.

2. Grep the entire codebase for `severity.*high` in any raw SQL INSERT targeting `system_alerts` and fix each occurrence.

---

### TASK-08 · Fix BUG-02 — Remove `awarded_at` from CRON badge INSERT

**Priority:** CRITICAL  
**Files:** `apps/web/app/api/cron/daily/route.ts` (line ~283)  
**Effort:** Trivial

`awarded_at` was dropped from `user_badges` by migration 009. The daily CRON still inserts it, causing every Sunday badge-award to fail with a column-not-found error.

**Steps:**

1. Remove `awarded_at` from the column list and values in the `user_badges` INSERT in `apps/web/app/api/cron/daily/route.ts`.

2. Grep for any other `awarded_at` references on `user_badges` across the codebase and remove them.

---

### TASK-09 · Fix BUG-27 — Ensure `uq_failed_xp_reference` partial unique index exists

**Priority:** HIGH  
**Files:** `apps/web/db/migrations/005_sys_improvements.sql`, canonical migration dir  
**Effort:** Small

The `safeAwardXP` DLQ INSERT uses `ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL`. If migration 005 hasn't been applied this index doesn't exist and the INSERT fails, defeating the entire DLQ idempotency mechanism.

**Steps:**

1. Ensure the migration that creates `uq_failed_xp_reference` is included in the canonical migration chain (either migration 005 is present, or copy the index definition into a new migration).

2. Verify the index definition:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS uq_failed_xp_reference
     ON failed_xp_awards (user_id, source, reference_id)
     WHERE reference_id IS NOT NULL;
   ```

---

## Phase 2 — Runtime-Breaking Code Fixes

These bugs cause crashes or silent data loss at runtime and should be fixed immediately after Phase 1.

---

### TASK-10 · Fix BUG-10 — Correct table name in `contentFilter.ts`

**Priority:** CRITICAL  
**Files:** `apps/web/lib/moderation/contentFilter.ts` (line ~162)  
**Effort:** Trivial

The anti-spam duplicate-detection query uses table `direct_messages` which doesn't exist. DMs are stored in the `messages` table. This crash affects all incoming DM messages.

**Steps:**

1. Change `"direct_messages"` to `"messages"` in `contentFilter.ts` at the line that builds the table name string.

2. Confirm the query's `WHERE` clause uses the correct column name for the conversation/thread ID in the `messages` table.

---

### TASK-11 · Fix BUG-16 — Block pre-auth tokens from bypassing 2FA in middleware

**Priority:** CRITICAL (security)  
**Files:** `apps/web/middleware.ts` (lines ~232–237)  
**Effort:** Small

The middleware redirects authenticated users away from `/auth/login` if `payload?.sub` is truthy. A pre-auth JWT (issued mid-2FA flow with `type = 'pre_auth'`) has a `sub` claim and would trigger this redirect, sending users to `/home` before completing 2FA.

**Steps:**

1. In the public-route redirect block, change the condition from:
   ```
   if (payload?.sub) { redirect to /home }
   ```
   to:
   ```
   if (payload?.sub && payload?.type !== 'pre_auth') { redirect to /home }
   ```

2. Apply the same `payload?.type !== 'pre_auth'` guard everywhere else in middleware that redirects based on an authenticated token.

---

### TASK-12 · Fix BUG-01 & BUG-29 — Correct Drizzle `creatorEarnings` schema

**Priority:** CRITICAL  
**Files:** `apps/web/lib/db/schema.ts` (creatorEarnings definition)  
**Effort:** Small

The Drizzle schema defines `grossKobo` → `gross_kobo` and `netKobo` → `net_kobo`, but the actual DB (from migration 001) uses `gross_amount_kobo`, `platform_fee_kobo`, and `net_amount_kobo`. Additionally, the Drizzle definition is missing `reference_id`, `paid_out`, and `payout_id` columns that exist in the real table. Every ORM query on this table is broken.

**Steps:**

1. In `lib/db/schema.ts`, rename the Drizzle column definitions:
   - `grossKobo` → `grossAmountKobo` with DB name `gross_amount_kobo`
   - Remove `netKobo` or rename to `netAmountKobo` → `net_amount_kobo`
   - Add `platformFeeKobo` → `platform_fee_kobo`

2. Add the three missing columns to the Drizzle schema: `referenceId` → `reference_id`, `paidOut` → `paid_out`, `payoutId` → `payout_id`.

3. After updating the schema, do a project-wide search for any callers that use the old column names (e.g. `grossKobo`, `netKobo`) and update them to the new names.

---

### TASK-13 · Fix BUG-12 & BUG-26 — Remove dynamic imports from inside DB transactions

**Priority:** HIGH  
**Files:** `apps/web/lib/seasons/seasonEngine.ts`, `apps/web/lib/economy/warEngine.ts` (wherever dynamic imports appear inside transaction callbacks)  
**Effort:** Small

`await import("@/lib/economy/coins")` inside a transaction callback means: if the import fails for any reason, the DB transaction is left open in a partially committed state. This can deadlock the connection pool.

**Steps:**

1. In `seasonEngine.ts` (`distributeSeasonRewards` and any other function using dynamic import inside a transaction), move the import to the top of the file as a static import.

2. Do the same in `warEngine.ts` and any other file with this pattern.

3. Grep for `await import(` across all files under `apps/web/lib/` and `apps/web/app/api/` — fix every occurrence inside a transaction block.

---

### TASK-14 · Fix BUG-11 — Add `sticker_pack` reward handler to `claimPassMilestone`

**Priority:** HIGH  
**Files:** `apps/web/lib/seasons/seasonEngine.ts` (`claimPassMilestone` function)  
**Effort:** Small

When a season pass milestone has `reward_type = 'sticker_pack'`, `claimPassMilestone` marks it as claimed but never grants the sticker pack. The user loses their reward silently.

**Steps:**

1. In the `switch`/`if-else` block that handles `reward_type` in `claimPassMilestone`, add a case for `'sticker_pack'`:
   - Insert a row into the appropriate user-stickers table (or grant the sticker pack via whatever mechanism sticker packs use in the system).
   - The reward metadata should contain the sticker pack ID — pass it to the grant function.

2. Consider adding a default/fallthrough case that logs an error if an unknown `reward_type` is encountered, so future missing handlers surface immediately.

---

### TASK-15 · Fix BUG-21 — Add room message support to Expo offline queue

**Priority:** HIGH  
**Files:** `apps/expo/lib/offline/sqlite.ts`, `apps/expo/lib/offline/syncQueue.ts`  
**Effort:** Medium

The offline SQLite queue only handles `'dm'` and `'group'` conversation types. Room messages sent while offline are silently lost — no queue, no retry, no user feedback.

**Steps:**

1. In `sqlite.ts`, add `'room'` as a valid `conversation_type` value. Update the TypeScript type/enum for `conversation_type` accordingly.

2. In `syncQueue.ts`, add a routing branch for `conversation_type === 'room'` that posts to the correct endpoint (e.g. `/api/rooms/:roomId/messages`).

3. In the Expo UI layer, show a "queued — will send when online" indicator for room messages sent while offline, the same way DMs and group messages are handled.

---

### TASK-16 · Fix BUG-25 — Add timeout to Google Play IAP promises

**Priority:** HIGH  
**Files:** `apps/expo/lib/payments/googlePlay.ts`  
**Effort:** Small

`purchaseCoins` and `purchaseSubscription` create promises that wait for the Play Store listener to fire. If the user dismisses the sheet, backgrounds the app, or the Play Store hangs, the promise never resolves — the purchase flow hangs until the app is killed.

**Steps:**

1. Wrap each awaited IAP promise with a `Promise.race([iapPromise, timeout(30_000)])` where `timeout` rejects after 30 seconds.

2. On timeout, call `IAPManager.finishTransactionAsync` if a `currentPurchase` exists (to avoid leaving a dangling transaction), then surface an appropriate error to the user.

3. Use 30 seconds as the timeout — the Play Store UI typically resolves well within this window.

---

### TASK-17 · Fix BUG-13 — Fix tier comparison in `getCommissionStats`

**Priority:** HIGH  
**Files:** `apps/web/lib/referrals/commissions.ts` (`getCommissionStats` function)  
**Effort:** Trivial

The `referral_commissions.tier` column is TEXT (default `'standard'`). `getCommissionStats` compares it against unquoted integers `1` and `2`. This type mismatch means the WHERE clause never matches and stats always return zero.

**Steps:**

1. Change the integer literals in the WHERE clause to string literals: `tier = '1'` → `tier = 'tier_1'` (or whatever string value the system actually stores — audit the INSERT paths to see what value is written when a commission is created at Tier 1 vs Tier 2).

2. If the tier column was intended to be an integer, create a migration to change its type and update all INSERT paths to write integers.

3. Check whether the new `tier TEXT DEFAULT 'standard'` from migration 009 was actually applied — if so, the value stored for tier-1 commissions may be `'standard'` not `'1'`, and the stats query logic needs a fuller rethink to match the actual data.

---

### TASK-18 · Fix BUG-14 — Make `transferCoins` idempotent-safe

**Priority:** HIGH  
**Files:** `apps/web/lib/economy/coins.ts` (`transferCoins` function)  
**Effort:** Small

The default transfer reference includes `Date.now()`, so each retry call generates a unique reference — the coin ledger treats each call as a new transfer and debits the sender multiple times.

**Steps:**

1. Remove `Date.now()` from the default `transferRef` construction. Instead, require callers to supply an explicit, stable idempotency key that is derived from the triggering event (e.g. the gift message ID, the purchase ID).

2. Make `transferRef` a **required** parameter (not optional with a default) so callers are forced to think about idempotency. Alternatively, throw an error if no ref is provided.

3. Audit all call sites of `transferCoins` to ensure they pass a stable reference derived from the triggering event's immutable ID.

---

### TASK-19 · Fix BUG-19 — Correct streak increment logic

**Priority:** HIGH  
**Files:** `apps/web/app/api/cron/daily/route.ts` (streak section, lines ~100–110)  
**Effort:** Small

The daily CRON increments streaks for users where `last_login_at::date = yesterday`. This is wrong — it should only increment for users who have already logged in **today**, meaning `last_login_at::date = today`.

**Steps:**

1. Change the WHERE clause in the streak increment query from `last_login_at::date = CURRENT_DATE - 1` to `last_login_at::date = CURRENT_DATE`.

2. Reconsider the streak logic flow: streak increments should happen in the login API handler (immediate, on today's login), not the daily CRON. Alternatively, if the CRON approach is kept, it should run at end-of-day only for users who have logged in today — which is `last_login_at::date = CURRENT_DATE`.

3. Ensure the streak increment is idempotent (no double-increment if the CRON runs more than once per day).

---

## Phase 3 — Data Correctness and Security

---

### TASK-20 · Fix BUG-17 — Make AI provider keys optional individually

**Priority:** MEDIUM  
**Files:** `apps/web/lib/env.ts`  
**Effort:** Small

Both `DEEPSEEK_API_KEY` and `GEMINI_API_KEY` are `.min(1)` (required). If only one AI provider is configured, the app refuses to start. These should be optional at the `env.ts` level, with the AI router gracefully falling back to whichever key is present.

**Steps:**

1. Change both `z.string().min(1)` to `z.string().optional()` (or `.default('')`) in `env.ts`.

2. In any code path that calls a specific AI provider, guard with `if (!env.DEEPSEEK_API_KEY)` / `if (!env.GEMINI_API_KEY)` and skip or fall back to the other provider.

3. Decide on a required-at-least-one-provider validation rule at startup if the feature is actually in use, and implement it as a runtime check in the AI router rather than at the env schema level.

---

### TASK-21 · Fix BUG-22 — Use cryptographically full-entropy CSP nonces

**Priority:** MEDIUM (security hardening)  
**Files:** `apps/web/middleware.ts` (line ~188)  
**Effort:** Trivial

`Buffer.from(crypto.randomUUID()).toString("base64")` encodes a UUID string as base64, not raw bytes. The UUID itself has only 122 bits of randomness and has fixed variant/version bits — this reduces entropy and encodes predictable structure.

**Steps:**

1. Replace the nonce generation with:
   ```ts
   const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
   ```
   This uses 128 bits of full cryptographic entropy with no fixed bits.

2. This is a security hardening improvement, not a breakage — the change is safe to make immediately.

---

### TASK-22 · Fix BUG-23 — Add explicit conflict target to `xp_ledger` INSERT

**Priority:** MEDIUM  
**Files:** `apps/web/lib/xp/safeAwardXP.ts`  
**Effort:** Trivial

`ON CONFLICT DO NOTHING` without a target silently suppresses ALL unique violations on the `xp_ledger` table, not just the intended idempotency check. This could hide real data integrity bugs.

**Steps:**

1. Identify the unique constraint or index on `xp_ledger` intended to catch duplicate awards (likely on `reference_id` or `(user_id, source, reference_id)`).

2. Replace `ON CONFLICT DO NOTHING` with `ON CONFLICT (reference_id) DO NOTHING` (or the appropriate column list) to target only the idempotency index.

3. Apply the same fix in the `retryFailedXPAwards` function which has the same pattern.

---

### TASK-23 · Fix BUG-24 — Normalise CRON authentication to one method

**Priority:** MEDIUM  
**Files:** `apps/web/app/api/cron/reconcile-balances/route.ts`, all other `/api/cron/` handlers  
**Effort:** Small

`reconcile-balances` uses `x-cron-secret` header while all other CRON routes use `Authorization: Bearer`. This inconsistency is a misconfiguration footgun when setting up the external CRON service.

**Steps:**

1. Choose one mechanism — recommend `Authorization: Bearer <CRON_SECRET>` as it is the existing standard in the rest of the codebase.

2. Update `reconcile-balances/route.ts` to use the Bearer pattern, matching the other CRON handlers.

3. Update the external CRON service configuration to send `Authorization: Bearer <CRON_SECRET>` to all CRON endpoints.

---

### TASK-24 · Fix BUG-20 — Allow re-recording of `audit_discrepancies`

**Priority:** MEDIUM  
**Files:** `apps/web/app/api/cron/reconcile-balances/route.ts`, migration  
**Effort:** Small

`audit_discrepancies` has a UNIQUE constraint on `(user_id, asset_type)`. Once a discrepancy is recorded, any subsequent discrepancy (after the first is "resolved" by being ignored) is silently dropped by `ON CONFLICT DO NOTHING`. Stale data accumulates indefinitely.

**Steps:**

1. Change the INSERT to use `ON CONFLICT (user_id, asset_type) DO UPDATE SET detected_amount = EXCLUDED.detected_amount, detected_at = NOW(), error_message = EXCLUDED.error_message` so that a fresh discrepancy always updates the row with the latest data.

2. Alternatively, add a `detected_at TIMESTAMPTZ` column and include it in a composite primary key, dropping the flat UNIQUE constraint — this allows multiple discrepancy records per user per asset_type over time.

---

### TASK-25 · Fix BUG-18 — Use UTC midnight boundary for quest resets

**Priority:** MEDIUM  
**Files:** `apps/web/lib/quests/questEngine.ts` (or wherever `resetDailyQuests` is defined)  
**Effort:** Trivial

Quest reset uses `Date.now() - 24 * 60 * 60 * 1000` which is server-local time. If the server's timezone is not UTC, quests reset at the wrong time for users (and inconsistently between servers in different regions).

**Steps:**

1. Replace the rolling-24h cutoff with an explicit UTC midnight boundary: compute `new Date().setUTCHours(0, 0, 0, 0)` (today midnight UTC) and use that as the reset boundary.

2. Verify the `user_quest_decks` table's timestamp columns are stored as `TIMESTAMPTZ` (not `TIMESTAMP WITHOUT TIME ZONE`) so UTC comparisons work correctly.

---

### TASK-26 · Fix BUG-15 — Cache the JWT key registry

**Priority:** MEDIUM (performance)  
**Files:** `apps/web/lib/auth/jwt.ts` (`buildKeyRegistry` function)  
**Effort:** Small

`buildKeyRegistry()` iterates all `process.env` entries to find `JWT_SECRET_*` keys, and is called on every invocation of `verifyAccessToken`. This is unnecessary overhead on every authenticated request.

**Steps:**

1. Move the key registry construction outside of the function call — compute it once at module initialisation time and cache it in a module-level `const`.

2. If hot key rotation is needed at runtime (without a process restart), add a refresh mechanism that is triggered by a specific admin API endpoint or a Redis pub/sub signal rather than rebuilding the registry on every request.

---

### TASK-27 · Fix BUG-28 — Remove dead redundant null check in Paystack webhook

**Priority:** LOW (code clarity)  
**Files:** `apps/web/app/api/economy/webhooks/paystack/route.ts` (line ~412)  
**Effort:** Trivial

`processSubscriptionEvent` has a `if (!resolvedUserId) return;` guard that can never be true at that point in the code — `resolvedUserId` is already guaranteed non-null by an earlier return guard (line ~400). This is dead code from an incomplete refactor.

**Steps:**

1. Delete the redundant null check at line ~412.

2. Add a comment in the vicinity explaining the earlier null check is the authoritative guard to prevent future re-introduction.

---

## Phase 4 — Expo / Mobile Polish

---

### TASK-28 · Supplement TASK-15 (BUG-21) — Expo offline room message UX

*(Already covered structurally in TASK-15. This task covers the UX layer.)*

**Priority:** MEDIUM  
**Files:** Expo chat screen components for room chat  
**Effort:** Small

**Steps:**

1. In the room chat screen, detect when the device is offline (use Expo's `NetInfo` or existing connectivity hook).

2. On "send" while offline, write the message to the offline SQLite queue (after TASK-15 adds room support), and immediately show the message in the UI with a "pending" state indicator (e.g. clock icon instead of delivered checkmark).

3. When connectivity resumes and the sync queue flushes the message, update the UI state from "pending" to "delivered."

---

## Recommended Fix Sequence

Apply fixes in this order to minimise the chance of one fix breaking another:

```
Phase 1:
  TASK-01 (migration consolidation) — do this first; unblocks everything
  TASK-02 (migration 009 broken rename)
  TASK-03 (room_subscriptions UNIQUE)
  TASK-04 (season_pass_milestones UNIQUE)
  TASK-05 (leaderboard expression index)
  TASK-06 (seasons updated_at column)
  TASK-07 (severity='high' fix in Paystack)
  TASK-08 (remove awarded_at from CRON badge INSERT)
  TASK-09 (uq_failed_xp_reference index)

Phase 2 (can mostly be parallelised after Phase 1):
  TASK-10 (contentFilter table name)
  TASK-11 (middleware pre-auth check)        ← security, do early
  TASK-12 (Drizzle creatorEarnings schema)
  TASK-13 (dynamic imports in transactions)
  TASK-14 (claimPassMilestone sticker_pack)
  TASK-15 (Expo offline room messages)
  TASK-16 (Google Play IAP timeout)
  TASK-17 (commission tier type mismatch)
  TASK-18 (transferCoins idempotency)
  TASK-19 (streak increment logic)

Phase 3:
  TASK-20 (AI keys optional)
  TASK-21 (CSP nonce entropy)               ← security hardening
  TASK-22 (xp_ledger ON CONFLICT target)
  TASK-23 (CRON auth normalisation)
  TASK-24 (audit_discrepancies re-recording)
  TASK-25 (quest reset UTC boundary)
  TASK-26 (JWT key registry cache)

Phase 4:
  TASK-27 (dead code removal)
  TASK-28 (Expo room offline UX)
```

---

## Post-Fix Verification Checklist

- [ ] Apply all migrations to a clean database and verify no errors
- [ ] Verify `creator_earnings` ORM queries return correct field values
- [ ] Trigger a Paystack webhook in staging — confirm `room_subscriptions` row is created or updated
- [ ] Run the daily CRON in staging — confirm no column errors on badge INSERT or streak UPDATE
- [ ] Complete a 2FA login flow — confirm pre-auth token does not redirect to /home mid-flow
- [ ] Send a DM while offline in Expo — confirm message appears as "pending" and is delivered on reconnect
- [ ] Send a room message while offline — confirm it is queued (after TASK-15)
- [ ] Complete a Google Play IAP — confirm the flow doesn't hang; dismiss the sheet and confirm timeout fires
- [ ] Confirm `system_alerts` inserts succeed (no CHECK constraint violations)
- [ ] Verify commission stats return non-zero values for users with referrals

---

*— End of Bug Fix Plan —*

**Date:** June 15, 2026  
**Time:** 06:38 AM  
**Analyst:** Claude Code — Full Codebase Forensic Analysis
