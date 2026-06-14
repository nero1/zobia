# Zobia Codebase — Bug Fix Plan

**Generated:** 2026-06-14 at 02:58 PM
**Source:** `custom-bugs-report.md` (25 confirmed bugs across Critical / Moderate / Minor severity tiers)
**Instruction:** DO NOT begin any fix until this plan is reviewed and approved.

---

## Overview

25 bugs are organized into 4 fix phases by risk and dependency order. Critical data-integrity bugs are addressed first (Phases 1–2), followed by moderate operational bugs (Phase 3), and minor/housekeeping issues last (Phase 4). Some fixes are prerequisites for others and are noted explicitly.

---

## Phase 1 — Critical: Data Integrity (Fix First)

These bugs cause incorrect data to be written to the database on live traffic. They must be fixed before any other phase.

---

### TASK-01 — Fix Double XP Credit in `safeAwardXP` (BUG-01, BUG-02)

**Priority:** P0 — Fix immediately; XP balances are being corrupted on every idempotency collision
**Files to edit:** `apps/web/lib/xp/safeAwardXP.ts`
**Depends on:** Nothing
**Estimated effort:** Small (2 SQL rewrites)

Both the primary award path and the `retryFailedXPAwards` path have the same flaw: an `INSERT ... ON CONFLICT DO NOTHING` followed by an unconditional `UPDATE users SET xp_total = xp_total + $1`. When the INSERT is a no-op (idempotency hit), the UPDATE still fires, double-crediting the balance.

For each affected location:
1. Replace the two separate queries with a single CTE:
   `WITH ins AS (INSERT INTO xp_ledger ... ON CONFLICT DO NOTHING RETURNING id) UPDATE users SET xp_total = xp_total + $1, [track_col] = COALESCE([track_col], 0) + $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM ins)`
2. Verify the CTE approach works with the existing `DatabaseAdapter` interface (it should, since it's a single SQL string).
3. Run a one-time audit query to count `xp_ledger` rows with duplicate `(user_id, source, reference_id)` tuples where `reference_id IS NOT NULL` — these are evidence of past double-awards. Decide whether to reconcile affected user balances.

---

### TASK-02 — Fix Double XP Credit in `claimPassMilestone` (BUG-03)

**Priority:** P0
**Files to edit:** `apps/web/lib/seasons/seasonEngine.ts`
**Depends on:** Nothing
**Estimated effort:** Small (1 SQL rewrite)

The `xp_bonus` branch in `claimPassMilestone` has the identical flaw. Apply the same CTE fix: merge the INSERT and UPDATE into a single statement gated on the INSERT returning a row. Ensure the `referenceId` used for the xp_ledger entry is stable across retries (should already be `milestone:{milestoneId}:{userId}` or similar — verify this).

---

### TASK-03 — Fix `referral_commissions` INSERT Column Mismatch (BUG-04)

**Priority:** P0 — Every referral commission attempt fails at runtime; referrers have received zero commissions
**Files to edit:** `apps/web/lib/referrals/commissions.ts`
**Depends on:** Confirming the intended schema (see below)
**Estimated effort:** Small-Medium (1 SQL rewrite + schema verification)

Steps:
1. Confirm the canonical column names in `schema.ts` for `referralCommissions`: `referred_user_id`, `trigger_event_id`, `purchase_amount_kobo`, `commission_kobo`, `commission_coins`, and `tier` (if it exists).
2. Identify what `trigger_event_id` should reference — likely a `coin_purchases.id` or `payments.id` value. Thread this value through the commission calculation call chain.
3. Rewrite the INSERT to use the correct column names and supply all NOT NULL columns.
4. Add an `ON CONFLICT DO NOTHING` or `ON CONFLICT (referrer_id, trigger_event_id) DO NOTHING` clause if one doesn't exist, to ensure idempotency on retries.
5. After fixing, run a manual check to assess whether any commissions from the live period need to be backfilled. This requires reviewing the coin purchase log against the referral relationships.

---

### TASK-04 — Fix Leaderboard NULL Upsert (BUG-05)

**Priority:** P1 — Global and all-time leaderboards are accumulating duplicate rows on every update
**Files to edit:** `apps/web/lib/db/schema.ts`, `apps/web/lib/leaderboards/engine.ts`
**Depends on:** Nothing
**Estimated effort:** Medium (schema change + migration + query update)

Steps:
1. In `schema.ts`, change the unique index on `leaderboard_snapshots` from a standard unique constraint to an expression-based unique index using `COALESCE` to handle NULLs: `UNIQUE (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))`.
2. Generate and apply the Drizzle migration (drop old constraint, add new index).
3. In `engine.ts`, update the `ON CONFLICT` clause to target the new index name.
4. Run a one-time deduplication query to remove the spurious duplicate rows already accumulated in production: `DELETE FROM leaderboard_snapshots WHERE id NOT IN (SELECT DISTINCT ON (user_id, track, scope, COALESCE(city,''), COALESCE(season_id::text,'')) id FROM leaderboard_snapshots ORDER BY user_id, track, scope, city, season_id, updated_at DESC)`.

---

## Phase 2 — Critical: Security

---

### TASK-05 — Replace SHA-256 Key Derivation with Proper KDF (BUG-06)

**Priority:** P0 — KYC field ciphertext is vulnerable to offline brute-force if raw keys are weak
**Files to edit:** `apps/web/lib/security/fieldEncryption.ts`
**Depends on:** Coordinated migration plan for existing ciphertext (see below)
**Estimated effort:** Medium (code change) + Large (data migration)

Steps:
1. In `getKeyForVersion`, replace `createHash("sha256").update(raw).digest()` with `crypto.scrypt(raw, versionSalt, 32, { N: 16384, r: 8, p: 1 })`. Define `versionSalt` as a per-version constant (e.g., `Buffer.from("zobia-field-enc-v1")`) stored in the function alongside the version table.
2. Cache the derived key in a module-level `Map<string, Buffer>` keyed by version, so the KDF cost is paid once per process cold start, not per encryption/decryption call.
3. Add a new key version (e.g., `v2`) using the KDF-derived key. Keep the old `v1` (SHA-256) entry for decryption only, so existing ciphertext can still be read.
4. Write a migration script that: reads every encrypted field from the DB, decrypts with the old v1 key, re-encrypts with the new v2 key, and writes back. Run in a transaction with a dry-run mode first.
5. After confirming all rows are migrated to v2, remove the v1 key entry from the code and drop decryption support for v1 in a follow-up deployment.

**Warning:** This migration touches PII/KYC data. Coordinate with any DPA/compliance requirements before running it. Test thoroughly in staging first.

---

## Phase 3 — Moderate: Operational Reliability

---

### TASK-06 — Add `type` Field to `AccessTokenPayload` and Reject Pre-Auth Tokens in `withAuth` (BUG-19)

**Priority:** P1 — Pre-auth tokens can be used as full access credentials against any authenticated route
**Files to edit:** `apps/web/app/api/auth/google/callback/route.ts`, `apps/web/lib/auth/jwt.ts` (or wherever `AccessTokenPayload` is defined), `apps/web/lib/api/middleware.ts`
**Depends on:** Nothing
**Estimated effort:** Small

Steps:
1. Add `type?: 'pre_auth' | 'access'` to the `AccessTokenPayload` interface.
2. In the Google OAuth callback, remove the unsafe TypeScript cast and set `type: 'pre_auth'` explicitly.
3. In `withAuth`, after verifying the token, check `if (payload.type === 'pre_auth') return unauthorized(...)`. This ensures pre-auth tokens are rejected on all normal routes.
4. Check whether the 2FA verification endpoint itself needs to specifically accept `pre_auth` tokens — if so, add an explicit allowance there only.

---

### TASK-07 — Fix `withAuth` Suspension Check to Evaluate `suspended_until` (BUG-10)

**Priority:** P1
**Files to edit:** `apps/web/lib/api/middleware.ts`
**Depends on:** Nothing
**Estimated effort:** Small

In `withAuth`, after loading the user record (from Redis cache or DB), add: `if (user.is_suspended && user.suspended_until && new Date(user.suspended_until) <= new Date()) { treat as not suspended; optionally fire background DB update to clear the flag }`. This makes the middleware consistent with the room messages route, which already checks `suspended_until` directly.

---

### TASK-08 — Atomize `RedisCircuitBreaker` State Transitions (BUG-09)

**Priority:** P1
**Files to edit:** `apps/web/lib/payments/circuit.ts`
**Depends on:** Nothing
**Estimated effort:** Medium

Replace the non-atomic read-modify-write in `onSuccess()` and `onFailure()` with Lua scripts evaluated via `redis.eval`. Write two scripts:
- `failure.lua`: Atomically read the current state, increment failure count, transition to `OPEN` if threshold reached, write back. Return new state.
- `success.lua`: Atomically read state, reset failure count, transition to `CLOSED` if currently `HALF_OPEN`, write back. Return new state.

This eliminates the race between concurrent serverless instances and ensures the circuit breaker behaves correctly under load.

---

### TASK-09 — Fix CSRF Middleware CRON Bypass to Check Header Value (BUG-13)

**Priority:** P1
**Files to edit:** `apps/web/middleware.ts`
**Depends on:** Nothing
**Estimated effort:** Trivial (1-line change)

In `isCsrfSafe`, change:
`const hasCronSecret = request.headers.has("x-cron-secret");`
to:
`const hasCronSecret = request.headers.get("x-cron-secret") === process.env.CRON_SECRET && !!process.env.CRON_SECRET;`

The guard on `!!process.env.CRON_SECRET` prevents accidentally bypassing CSRF in environments where the env var is not set.

---

### TASK-10 — Fix N+1 Queries in Hall of Fame Leaderboard Injection (BUG-11)

**Priority:** P2
**Files to edit:** `apps/web/lib/leaderboards/engine.ts`
**Depends on:** Nothing
**Estimated effort:** Small-Medium

Refactor the HoF injection logic:
1. After building the paginated result set, collect the IDs of all HoF users not already present.
2. If any are missing, fetch all of their rank data in a single `WHERE user_id = ANY($1::uuid[])` query (joining against `leaderboard_snapshots` or computing rank inline).
3. Merge the results in-process, applying HoF pin ordering.
4. Cache the final merged result at the leaderboard page level so HoF injection is free for subsequent requests within the TTL.

---

### TASK-11 — Add `safeAwardXP` to Guild War Resolution (BUG-14)

**Priority:** P2
**Files to edit:** `apps/web/lib/guilds/warEngine.ts`
**Depends on:** TASK-01 (for correct behavior of `safeAwardXP` itself)
**Estimated effort:** Small

Replace raw `INSERT INTO xp_ledger` + `UPDATE users` in `resolveWar` with calls to `safeAwardXP(memberId, xpAmount, 'competitor', 'guild_war_win', \`war:${warId}:${memberId}\`)`. Do the same for any loser consolation XP if applicable. This routes failures to the DLQ automatically.

---

### TASK-12 — Add `safeAwardXP` to Quest Progress Completion (BUG-15)

**Priority:** P2
**Files to edit:** `apps/web/lib/quests/questEngine.ts`
**Depends on:** TASK-01
**Estimated effort:** Small

Replace the raw XP SQL in `updateQuestProgress` with `safeAwardXP(userId, amount, 'main', 'quest_completion', \`quest:${questId}:${userId}:${deckDate}\`)`. The `referenceId` must be stable and unique per completion event to provide idempotency.

---

### TASK-13 — Fix Duplicate 2FA Columns in Schema (BUG-07)

**Priority:** P2
**Files to edit:** `apps/web/lib/db/schema.ts`, auth route handlers, 2FA setup/verify code
**Depends on:** Nothing
**Estimated effort:** Medium

1. Audit all code that reads or writes `twoFaSecret`, `twoFaEnabled`, `totpSecret`, `totpEnabled`. Map which routes use which column pair.
2. Determine the canonical pair (likely `totpSecret`/`totpEnabled` based on naming convention).
3. Write a migration: copy data from the deprecated pair to the canonical pair for any users where the canonical columns are NULL.
4. Drop the deprecated columns from `schema.ts` and generate the Drizzle migration.
5. Update all code to use only the canonical column names.

---

### TASK-14 — Add Missing Tables to Drizzle `schema.ts` (BUG-12, BUG-08, BUG-17)

**Priority:** P2 — Prerequisite for proper FK enforcement (BUG-08) and for migrating raw SQL to Drizzle
**Files to edit:** `apps/web/lib/db/schema.ts`
**Depends on:** Nothing (but unlocks TASK-15, TASK-17)
**Estimated effort:** Large (mechanical but extensive)

Add `pgTable` definitions for all tables currently missing from `schema.ts`:
- `gifts` / `gift_types`
- `rooms` / `room_members`
- `guild_wars` / `guild_war_members`
- `user_push_tokens`
- Any others referenced via raw SQL but absent from schema

Match column names, types, and constraints exactly to the migration SQL. Once done, add the FK reference on `userQuestDecks.questId` → `quests.id` (BUG-08) and migrate `push.ts` raw queries to Drizzle (BUG-17).

---

### TASK-15 — Add FK Reference on `userQuestDecks.questId` (BUG-08)

**Priority:** P2
**Files to edit:** `apps/web/lib/db/schema.ts`
**Depends on:** TASK-14 (quests table must be in schema first)
**Estimated effort:** Trivial once TASK-14 is done

Add `.references(() => quests.id, { onDelete: 'cascade' })` to the `questId` column in `userQuestDecks`. Generate and apply the Drizzle migration.

---

### TASK-16 — Migrate `push.ts` Raw SQL to Drizzle Query Builder (BUG-17)

**Priority:** P3
**Files to edit:** `apps/web/lib/notifications/push.ts`
**Depends on:** TASK-14
**Estimated effort:** Small once TASK-14 is done

After `user_push_tokens` is defined in `schema.ts`, replace raw SQL strings in `push.ts` with Drizzle query builder calls for type safety and consistency.

---

## Phase 4 — Minor: Code Quality and Correctness

---

### TASK-17 — Add Missing `bank_account_added` Case to XP Switch (BUG-16)

**Priority:** P3
**Files to edit:** `apps/web/lib/xp/engine.ts`
**Depends on:** Nothing
**Estimated effort:** Trivial

Add `case 'bank_account_added': return XP_VALUES.bank_account_added;` to the switch statement in `calculateXPForAction`. Also do a full audit: list all keys in `XP_VALUES` and verify each has a corresponding `case`.

---

### TASK-18 — Fix Room Message XP Cap Off-by-One (BUG-18)

**Priority:** P3
**Files to edit:** `apps/web/app/api/rooms/[roomId]/messages/route.ts`
**Depends on:** Nothing
**Estimated effort:** Small

Move the `todayMsgCount` fetch to after the message insert (within the same transaction), or use an atomic `UPDATE users SET today_msg_count = today_msg_count + 1 WHERE ... RETURNING today_msg_count` pattern and check the returned value. This ensures the cap accounts for the message being sent right now.

---

### TASK-19 — Scope `x-vercel-forwarded-for` Trust to Vercel Deployments (BUG-24)

**Priority:** P3
**Files to edit:** `apps/web/lib/security/rateLimit.ts`
**Depends on:** Nothing
**Estimated effort:** Trivial

In `getClientIp`, wrap the `x-vercel-forwarded-for` check with `if (process.env.VERCEL === '1')`. This is a free env variable Vercel sets on all its deployments. When absent (local dev, staging, Docker), skip this header and fall through to `x-real-ip` and `x-forwarded-for`.

---

### TASK-20 — Add `X-Request-Id` to `withAdminAuth` Error Responses (BUG-25)

**Priority:** P3
**Files to edit:** `apps/web/lib/api/middleware.ts`
**Depends on:** Nothing
**Estimated effort:** Trivial

Generate a `requestId` at the start of `withAdminAuth` (same way `withAuth` does it) and attach it to all 401/403 error responses as `X-Request-Id`. This makes admin API errors traceable in logs.

---

### TASK-21 — Fix `commissions.ts` Dynamic Import (BUG-21)

**Priority:** P4 (after BUG-04 is fixed)
**Files to edit:** `apps/web/lib/referrals/commissions.ts`
**Depends on:** TASK-03 (fix the column mismatch first, confirm commissions work)
**Estimated effort:** Trivial

Replace `await import("@/lib/economy/coins")` inside the function body with a static top-level `import { creditCoins } from "@/lib/economy/coins"`.

---

### TASK-22 — Fix `gross_kobo` TypeScript Type in `reconcileStuckPayouts` (BUG-22)

**Priority:** P4
**Files to edit:** `apps/web/lib/payments/payouts.ts`
**Depends on:** Nothing
**Estimated effort:** Trivial

Change the query result type for `gross_kobo` from `string` to `number`. Add a `Number(row.gross_kobo)` parse at the point of use if the pg driver returns it as a string. Verify with a quick test that arithmetic operations on this value produce numeric results.

---

### TASK-23 — Harden `filterProfanity` RegExp Cache (BUG-23)

**Priority:** P4
**Files to edit:** `apps/web/lib/moderation/contentFilter.ts`
**Depends on:** Nothing
**Estimated effort:** Small

Replace the global regex cache approach with one of:
- (Preferred) Store pattern strings in the cache and compile a fresh `new RegExp(pattern, 'gi')` on each call — avoids shared `lastIndex` state entirely.
- (Alternative) Keep the cache but change `replace()` to use `String.prototype.replaceAll` or ensure `lastIndex` is explicitly reset to 0 before each use (add a defensive comment explaining why).

---

### TASK-24 — Implement `'sending'` Status in Expo Offline Queue or Remove It (BUG-20)

**Priority:** P4
**Files to edit:** `apps/expo/lib/offline/sqlite.ts`, `apps/expo/lib/offline/syncQueue.ts`
**Depends on:** Nothing
**Estimated effort:** Small-Medium

Option A (implement properly):
1. Before calling the API, update the queued message status to `'sending'`.
2. On success, delete the row as before.
3. On terminal failure, set to `'failed'` as before.
4. On app startup, find any rows stuck in `'sending'` (from a crashed mid-send) and reset them to `'pending'` for retry.

Option B (remove dead state):
1. Remove `'sending'` from the CHECK constraint in the SQLite migration.
2. Add the migration via the ALTER TABLE try/catch pattern already in use.

Option A is preferred as it closes a real double-send race condition on crash-restart.

---

### TASK-25 — Atomize `RedisCircuitBreaker` Pending Note: Pre-auth Token Guard Already Included Above

*(This task was already captured as TASK-06.)*

---

## Fix Sequence Summary

| Order | Task | Bug(s) | Priority |
|---|---|---|---|
| 1 | TASK-01 | BUG-01, BUG-02 | P0 |
| 2 | TASK-02 | BUG-03 | P0 |
| 3 | TASK-03 | BUG-04 | P0 |
| 4 | TASK-04 | BUG-05 | P1 |
| 5 | TASK-05 | BUG-06 | P0 (coordinate migration) |
| 6 | TASK-06 | BUG-19 | P1 |
| 7 | TASK-07 | BUG-10 | P1 |
| 8 | TASK-08 | BUG-09 | P1 |
| 9 | TASK-09 | BUG-13 | P1 |
| 10 | TASK-10 | BUG-11 | P2 |
| 11 | TASK-11 | BUG-14 | P2 |
| 12 | TASK-12 | BUG-15 | P2 |
| 13 | TASK-13 | BUG-07 | P2 |
| 14 | TASK-14 | BUG-12 | P2 |
| 15 | TASK-15 | BUG-08 | P2 (after TASK-14) |
| 16 | TASK-16 | BUG-17 | P3 (after TASK-14) |
| 17 | TASK-17 | BUG-16 | P3 |
| 18 | TASK-18 | BUG-18 | P3 |
| 19 | TASK-19 | BUG-24 | P3 |
| 20 | TASK-20 | BUG-25 | P3 |
| 21 | TASK-21 | BUG-21 | P4 (after TASK-03) |
| 22 | TASK-22 | BUG-22 | P4 |
| 23 | TASK-23 | BUG-23 | P4 |
| 24 | TASK-24 | BUG-20 | P4 |

---

*Plan generated: 2026-06-14 at 02:58 PM*
*DO NOT begin any fix until this plan is reviewed and approved.*
