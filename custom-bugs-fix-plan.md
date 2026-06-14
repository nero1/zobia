# Zobia Codebase — Bug Fix Plan

**Generated:** 2026-06-14 at 02:58 PM
**Source:** `custom-bugs-report.md` (38 confirmed bugs across Critical / Moderate / Minor severity tiers)
**Instruction:** DO NOT begin any fix until this plan is reviewed and approved.

---

## Overview

38 bugs are organized into 5 fix phases by risk and dependency order. Critical data-integrity and security bugs are addressed first (Phases 1–2), followed by moderate operational bugs (Phase 3), minor housekeeping (Phase 4), and the structural 9.7+ improvements (Phase 5). Some fixes are prerequisites for others and are noted explicitly.

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

---

## Phase 5 — 9.7+ Quality: Security Hardening, Observability, and Structural Completeness

---

### TASK-25 — Add Unique Partial Index on `xp_ledger` to Enable `ON CONFLICT` (BUG-26)

**Priority:** P0 — Without this index, all idempotency logic in BUG-01/02/03 fixes is inoperative; duplicate ledger entries are inserted unconditionally
**Files to edit:** `apps/web/lib/db/schema.ts`
**Depends on:** Must be done alongside or before TASK-01/02/03
**Estimated effort:** Trivial (1 index definition + migration)

Add to `schema.ts`: a Drizzle `uniqueIndex('xp_ledger_reference_id_uq').on(xpLedger.userId, xpLedger.source, xpLedger.referenceId).where(sql\`reference_id IS NOT NULL\`)`. Generate and apply the migration. Verify with an `EXPLAIN` that the `ON CONFLICT DO NOTHING` in the CTE now correctly detects duplicates. This is a prerequisite for TASK-01 to work — without the index, the RETURNING-based CTE detects no conflict and the UPDATE still fires on every call.

---

### TASK-26 — Implement Session ID Rotation After Login and 2FA Completion (BUG-27)

**Priority:** P1 — Session fixation allows pre-login session hijack
**Files to edit:** `apps/web/lib/auth/session.ts`, `apps/web/app/api/auth/google/callback/route.ts`, and any other auth completion handlers
**Depends on:** Nothing
**Estimated effort:** Small-Medium

Steps:
1. Add a `rotateSession(oldSessionId: string, userId: string, newPayload: SessionPayload)` function to `session.ts` that: writes the new session payload to a new random session key in Redis, sets the new key's TTL, deletes the old session key, and returns the new session ID.
2. In the Google OAuth callback (and any other auth completion point), call `rotateSession` instead of simply writing to the existing session. Set the updated session cookie with the new session ID.
3. After 2FA verification, if the pre-auth session ID is preserved into the fully-authenticated state, rotate again at that point.
4. Audit all `response.cookies.set(ACCESS_TOKEN_COOKIE, ...)` and `response.cookies.set(REFRESH_TOKEN_COOKIE, ...)` calls to ensure `Secure: true` and `SameSite: 'Lax'` (minimum) are explicitly set in every call, not relying on browser defaults.

---

### TASK-27 — Fix CSP `img-src` to Remove `http:` (BUG-28)

**Priority:** P2
**Files to edit:** `apps/web/middleware.ts`
**Depends on:** Nothing
**Estimated effort:** Trivial

In `buildCsp`, change:
`"img-src 'self' data: blob: https: http:"`
to:
`"img-src 'self' data: blob: https:"`

Verify that no legitimate app image sources are served over plain HTTP. If any are, fix them at the source (enforce HTTPS on all image CDN origins) rather than loosening the CSP.

---

### TASK-28 — Add Missing Security Response Headers (BUG-29)

**Priority:** P2
**Files to edit:** `apps/web/middleware.ts`
**Depends on:** Nothing
**Estimated effort:** Small

Add the following headers to the `withCsp` helper (or extract a `addSecurityHeaders(res: NextResponse)` utility):

1. `Cross-Origin-Opener-Policy: same-origin`
2. `Cross-Origin-Resource-Policy: same-origin`
3. `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`
4. `Cross-Origin-Embedder-Policy: credentialless` (start here, not `require-corp`, to avoid breaking Paystack iframe and Google OAuth popup; upgrade to `require-corp` after verifying those providers send correct CORP headers)

Test each header against the Paystack coin purchase flow, Google OAuth login, and any other third-party iframe/popup integrations before shipping to production.

---

### TASK-29 — Validate OAuth `redirect` Parameter Against Same-Origin Paths (BUG-35)

**Priority:** P1 — Open redirect enables phishing post-authentication
**Files to edit:** `apps/web/app/api/auth/google/callback/route.ts` (and any other OAuth callback handlers)
**Depends on:** Nothing
**Estimated effort:** Trivial

In each OAuth callback handler, before redirecting to the `redirect` query param, validate it:
`const safePath = typeof redirect === 'string' && /^\/[^/]/.test(redirect) ? redirect : HOME_URL`

The regex requires the path to start with exactly one `/` — this rejects `//evil.com` (protocol-relative), `https://evil.com` (absolute URL), and empty strings, while allowing all valid internal paths like `/home`, `/rooms/123`, etc. Use `safePath` as the redirect target.

---

### TASK-30 — Create Audit Log Infrastructure (BUG-30)

**Priority:** P2
**Files to edit:** `apps/web/lib/db/schema.ts` (new table), new file `apps/web/lib/audit/auditLog.ts`, all admin route handlers, `apps/web/app/api/auth/` handlers
**Depends on:** Nothing
**Estimated effort:** Medium-Large

Steps:
1. Add `audit_log` table to `schema.ts`: `id` (UUID), `actor_id` (UUID, nullable for system), `action` (text), `target_type` (text, nullable), `target_id` (text, nullable), `metadata` (JSONB, nullable), `ip_address` (text, nullable), `user_agent` (text, nullable), `created_at` (timestamptz, not null, default NOW()).
2. Create `lib/audit/auditLog.ts` with a `writeAuditLog(params)` async helper that inserts fire-and-forget (`.catch(err => console.error('[audit]', err))` — non-blocking).
3. Define an `AuditAction` enum or string union covering: `login_success`, `login_failure`, `logout`, `admin_ban_user`, `admin_unban_user`, `kyc_viewed`, `kyc_updated`, `payout_approved`, `payout_rejected`, `pin_changed`, `pin_verify_failed`, `user_suspended`, `user_unsuspended`, `2fa_enabled`, `2fa_disabled`.
4. Instrument all admin route handlers (add `writeAuditLog` calls), auth completion handlers, and PIN/KYC endpoints.

---

### TASK-31 — Create Balance Reconciliation CRON Job (BUG-31)

**Priority:** P2
**Files to edit:** New file `apps/web/app/api/cron/reconcile-balances/route.ts`
**Depends on:** Nothing
**Estimated effort:** Medium

Create a CRON route at `/api/cron/reconcile-balances` that:
1. Selects batches of users (e.g., 500 at a time, paginated by `last_reconciled_at` or alphabetically by ID) to avoid full-table scans in a single run.
2. For each batch: runs `SELECT user_id, SUM(amount) as ledger_xp FROM xp_ledger GROUP BY user_id WHERE user_id = ANY($1)` and similarly for `coin_ledger`. Compares to `users.xp_total` and `users.coin_balance`.
3. On mismatch: inserts a `system_alerts` row with `type = 'balance_discrepancy'`, the user ID, both values, and the delta. Also logs structured output.
4. For discrepancies below a small threshold (e.g., < 50 XP, likely from the double-credit bug before it was fixed): auto-corrects the balance column to the ledger sum.
5. For large discrepancies: flags for human review only — do not auto-correct.

---

### TASK-32 — Audit and Fix Raw SQL for Missing `deleted_at IS NULL` Filters (BUG-32)

**Priority:** P2
**Files to edit:** `apps/web/lib/guilds/warEngine.ts`, `apps/web/lib/quests/questEngine.ts`, `apps/web/lib/leaderboards/engine.ts`, and other engine files with raw SQL
**Depends on:** Nothing (but long-term fix is TASK-14 migration to Drizzle)
**Estimated effort:** Small-Medium

Run: `grep -rn "FROM users\|JOIN users\|FROM guild_members\|JOIN guild_members\|FROM room_members\|JOIN room_members" apps/web/lib/` and review each match. Verify that every query that could return soft-deleted entities includes `AND [table_alias].deleted_at IS NULL`. Add the missing filters. Document which tables use soft deletes in a comment at the top of `schema.ts` so future developers know which queries need the filter.

---

### TASK-33 — Add Zod Input Validation to All API Route Handlers (BUG-33)

**Priority:** P1 (for financial routes) / P2 (for all others)
**Files to edit:** All files under `apps/web/app/api/`
**Depends on:** Nothing
**Estimated effort:** Large (many files, mechanical)

Prioritize in this order:
1. Financial routes first: `/api/economy/gifts/send`, `/api/economy/coins/purchase`, `/api/economy/payouts/request`, `/api/economy/webhooks/paystack`.
2. Auth routes: `/api/auth/google/callback`, `/api/auth/telegram/callback`, `/api/auth/2fa/verify`.
3. All remaining POST/PUT/PATCH routes.
4. GET routes with query parameters (pagination, filters).

For each route: define a Zod schema for the request body (and query params for GETs), call `schema.safeParse(...)`, and return 400 with `{ data: null, error: "Invalid request body", issues: parsed.error.flatten() }` on failure. Use `z.string().uuid()` for ID fields, `z.number().int().positive()` for amounts, `z.string().max(N)` for text fields — enforcing both type and business-rule constraints at the boundary.

---

### TASK-34 — Add Structured Observability: Logging, DLQ Alerting, and Key Metrics (BUG-34)

**Priority:** P2
**Files to edit:** `apps/web/lib/api/middleware.ts`, `apps/web/lib/xp/safeAwardXP.ts`, `apps/web/app/api/cron/retry-xp-awards/route.ts`, and other engine files
**Depends on:** Nothing (but pairs well with TASK-30 audit log)
**Estimated effort:** Medium-Large

Three incremental steps:

**Step 1 — Structured logging:** Install Pino (`pino`, `pino-pretty` for dev). Create `lib/logger.ts` exporting a configured Pino instance. Replace all `console.error/log/warn` calls in `lib/` and `app/api/` with `logger.error/info/warn({requestId, userId, ...context}, message)`. Wire `requestId` from `withAuth`'s existing generation into a Node.js `AsyncLocalStorage` context so all downstream calls within a request emit the same `requestId` without threading it manually.

**Step 2 — DLQ alerting:** In the `retryFailedXPAwards` CRON response handler, if `permanentlyFailed > 0` or total `failed_xp_awards` rows exceed a threshold (e.g., 100), post a Slack webhook or insert a high-severity `system_alerts` row. Add equivalent alerting for `failed_payouts`.

**Step 3 — Key metrics:** Add response-time logging to `withAuth` and `withAdminAuth` (already have `requestId`, add `durationMs = Date.now() - start`). Log 4xx/5xx counts per route. Consider a lightweight `/api/metrics` endpoint (protected, admin-only) returning current DLQ depths and circuit breaker states.

---

### TASK-35 — Standardize API Response Envelopes (BUG-36)

**Priority:** P3
**Files to edit:** New file `apps/web/lib/api/response.ts`, all API route handlers
**Depends on:** Nothing
**Estimated effort:** Large (many files, mechanical)

Create `lib/api/response.ts` with:
```
apiSuccess<T>(data: T, status = 200): NextResponse
apiError(message: string, code: string, status: number): NextResponse
```
Both return `NextResponse.json({ data: T | null, error: string | null, code?: string }, { status })`. Migrate all `NextResponse.json(...)` calls in route handlers to use these helpers. This is a mechanical refactor — do it route-file by route-file, verifying client-side code handles the new shape. Update any frontend `fetch` wrappers to expect the standard envelope.

---

### TASK-36 — Create Health Check Endpoint (BUG-37)

**Priority:** P3
**Files to edit:** New file `apps/web/app/api/health/route.ts`, `apps/web/middleware.ts`
**Depends on:** Nothing
**Estimated effort:** Small

Create `GET /api/health`:
1. `SELECT 1` on the DB with a 2-second timeout. Record latency and success/failure.
2. `PING` on Redis. Record latency and success/failure.
3. Check that `process.env.JWT_SECRET`, `DATABASE_URL`, `REDIS_URL` are non-empty.
4. Return 200 `{ status: "ok", checks: { db: "ok", redis: "ok" }, latencyMs: { db: N, redis: N } }` on full health.
5. Return 503 `{ status: "degraded", checks: { db: "error", redis: "ok" }, error: "DB timeout" }` on any failure. Keep error messages generic (no connection strings, no stack traces).

Add `/api/health` to `PUBLIC_PREFIXES` in `middleware.ts`.

---

### TASK-37 — Add Runtime Allowlist Guard to `TRACK_COLUMN` SQL Interpolation (BUG-38)

**Priority:** P4
**Files to edit:** `apps/web/lib/xp/safeAwardXP.ts`
**Depends on:** Nothing
**Estimated effort:** Trivial

Before the SQL string interpolation of `col`, add:
`const SAFE_XP_COLS = new Set(Object.values(TRACK_COLUMN)); if (!SAFE_XP_COLS.has(col)) throw new Error(\`[safeAwardXP] Unsafe column name: ${col}\`);`

This makes the safety invariant explicit, documents the intent, and provides defense-in-depth if the `TRACK_COLUMN` map is ever populated from an external or user-controlled source.

---

## Fix Sequence Summary

| Order | Task | Bug(s) | Priority | Notes |
|---|---|---|---|---|
| 1 | TASK-25 | BUG-26 | P0 | Must run before or with TASK-01/02/03 |
| 2 | TASK-01 | BUG-01, BUG-02 | P0 | Depends on TASK-25 (unique index) |
| 3 | TASK-02 | BUG-03 | P0 | Depends on TASK-25 |
| 4 | TASK-03 | BUG-04 | P0 | |
| 5 | TASK-04 | BUG-05 | P1 | |
| 6 | TASK-05 | BUG-06 | P0 | Coordinate KYC migration separately |
| 7 | TASK-26 | BUG-27 | P1 | Session fixation |
| 8 | TASK-29 | BUG-35 | P1 | Open redirect |
| 9 | TASK-06 | BUG-19 | P1 | Pre-auth token type |
| 10 | TASK-07 | BUG-10 | P1 | Suspension expiry check |
| 11 | TASK-08 | BUG-09 | P1 | Circuit breaker atomicity |
| 12 | TASK-09 | BUG-13 | P1 | CSRF CRON bypass |
| 13 | TASK-33 | BUG-33 | P1 (financial routes first) | Zod validation |
| 14 | TASK-27 | BUG-28 | P2 | CSP img-src http: |
| 15 | TASK-28 | BUG-29 | P2 | Missing security headers |
| 16 | TASK-10 | BUG-11 | P2 | N+1 HoF |
| 17 | TASK-11 | BUG-14 | P2 | War XP DLQ |
| 18 | TASK-12 | BUG-15 | P2 | Quest XP DLQ |
| 19 | TASK-13 | BUG-07 | P2 | Duplicate 2FA columns |
| 20 | TASK-14 | BUG-12 | P2 | Complete Drizzle schema |
| 21 | TASK-15 | BUG-08 | P2 | FK on questId (after TASK-14) |
| 22 | TASK-30 | BUG-30 | P2 | Audit log |
| 23 | TASK-31 | BUG-31 | P2 | Balance reconciliation CRON |
| 24 | TASK-32 | BUG-32 | P2 | soft-delete filter audit |
| 25 | TASK-34 | BUG-34 | P2 | Structured observability |
| 26 | TASK-16 | BUG-17 | P3 | push.ts Drizzle migration (after TASK-14) |
| 27 | TASK-17 | BUG-16 | P3 | Missing XP switch case |
| 28 | TASK-18 | BUG-18 | P3 | Message cap off-by-one |
| 29 | TASK-19 | BUG-24 | P3 | Vercel IP header scoping |
| 30 | TASK-20 | BUG-25 | P3 | Admin request ID |
| 31 | TASK-35 | BUG-36 | P3 | API response envelopes |
| 32 | TASK-36 | BUG-37 | P3 | Health check endpoint |
| 33 | TASK-21 | BUG-21 | P4 | Dynamic import (after TASK-03) |
| 34 | TASK-22 | BUG-22 | P4 | gross_kobo type |
| 35 | TASK-23 | BUG-23 | P4 | RegExp cache |
| 36 | TASK-24 | BUG-20 | P4 | SQLite 'sending' state |
| 37 | TASK-37 | BUG-38 | P4 | TRACK_COLUMN allowlist |

---

*Plan generated: 2026-06-14 at 02:58 PM*
*Updated: 2026-06-14 at 02:58 PM — 13 additional tasks added (TASK-25 through TASK-37) covering BUG-26 through BUG-38*
*DO NOT begin any fix until this plan is reviewed and approved.*
