# Zobia Social — Forensic Bug Report

**Date:** June 15, 2026  
**Time:** 06:38 AM  
**Analyst:** Claude Code — Full Codebase Forensic Analysis  
**Scope:** Web app (Next.js 14 App Router), PWA (Workbox service worker), Expo mobile Android app  
**Method:** Three-pass deep static analysis of all source files, migration SQL, Drizzle ORM schema, CRON handlers, webhook handlers, Expo mobile libs, and DB constraints cross-referenced against all callers

---

## Code Quality Rating (Before Fixes): 6.5 / 10

The codebase is architecturally well-conceived. Security fundamentals (CSRF, HMAC webhook verification, constant-time comparisons, SSRF protection, JWT with Redis session backing, refresh token rotation, Zod input validation) are generally strong. The payment pipeline (Paystack + DodoPay) handles idempotency and re-entrancy correctly in most places. The schema is rich and expressive.

However, there is a critical structural problem: **two parallel migration systems** (`apps/web/db/migrations/` vs `apps/web/lib/db/migrations/`) define conflicting schemas for several tables. This is the root cause of a cluster of runtime-breaking bugs. CRON handlers reference columns and constraints that were never added or were dropped by later migrations, and several SQL `ON CONFLICT` clauses name unique indexes that only exist if specific migrations were applied.

**Code Quality After All Fixes Applied: projected 8.5 / 10** — production-grade, no architectural overhaul required.

---

## All Bugs — Master List (One Line Each)

1.  **BUG-01:** `creator_earnings` Drizzle schema defines `gross_kobo`/`net_kobo` but the actual DB from migration 001 uses `gross_amount_kobo`/`net_amount_kobo` — all Drizzle ORM queries on this table fail at runtime.
2.  **BUG-02:** CRON daily handler inserts `user_badges` rows including an `awarded_at` column that migration 009 dropped — every Sunday badge-award INSERT fails.
3.  **BUG-03:** `seasons` table in migration 001 has no `updated_at` column, but `seasonEngine.ts` and CRON daily both run `UPDATE seasons SET … updated_at = NOW()`.
4.  **BUG-04:** Two competing migration directories (`db/migrations/` vs `lib/db/migrations/`) define the same tables with irreconcilably different column names and schemas.
5.  **BUG-05:** `lib/db/migrations/009_bug_fixes.sql` attempts to rename `gifts.gift_type_id → gift_item_id` but that column doesn't exist in the migration-001 gifts table — breaks the entire migration chain.
6.  **BUG-06:** Paystack webhook inserts into `system_alerts` with `severity = 'high'` which violates the DB `CHECK (severity IN ('info','warning','critical'))` constraint — unknown plan alerts are silently swallowed.
7.  **BUG-07:** `room_subscriptions` (migration 001) has no UNIQUE constraint; Paystack webhook `ON CONFLICT (room_id, user_id) DO UPDATE` throws without it — VIP room subscription payments complete but access is never granted.
8.  **BUG-08:** `season_pass_milestones` has no UNIQUE index on `(season_id, sort_order)`, so `seedSeasonPassMilestones`'s `ON CONFLICT (season_id, sort_order)` always throws — season pass milestones can never be seeded.
9.  **BUG-09:** `leaderboard_snapshots` UPSERT relies on an expression index added by migration 011; on installs missing that migration, `ON CONFLICT` fails and duplicate leaderboard rows are created instead.
10. **BUG-10:** `detectDuplicateMessage` in `contentFilter.ts` queries a `direct_messages` table that doesn't exist — DMs live in the `messages` table; this crashes anti-spam for all DM messages.
11. **BUG-11:** `claimPassMilestone` in `seasonEngine.ts` has no handler for `reward_type = 'sticker_pack'` — milestone is marked claimed but the sticker pack is never granted to the user.
12. **BUG-12:** Dynamic `import("@/lib/economy/coins")` inside DB transaction callbacks in `seasonEngine.ts` and `warEngine.ts` — a failed import mid-transaction leaves the DB in an inconsistent partial state.
13. **BUG-13:** `getCommissionStats` in `commissions.ts` compares a TEXT `tier` column against unquoted integer literals `1` and `2` — type mismatch causes referral commission stats to always return zero.
14. **BUG-14:** `transferCoins` in `coins.ts` includes `Date.now()` in the transfer reference — a retried call generates a new ref and the transfer executes twice, double-debiting the sender.
15. **BUG-15:** `buildKeyRegistry()` in `jwt.ts` iterates all `process.env` entries to rebuild a Map on every single call to `verifyAccessToken` — unnecessary overhead on every authenticated request.
16. **BUG-16:** Middleware public-route redirect checks `payload?.sub` but not `payload?.type` — a pre-auth JWT (type='pre_auth', issued before 2FA) can redirect a user to `/home`, bypassing 2FA.
17. **BUG-17:** `DEEPSEEK_API_KEY` and `GEMINI_API_KEY` are both `.min(1)` (required) in `env.ts` — app fails to start if either AI key is absent, even when only one provider is configured.
18. **BUG-18:** `resetDailyQuests` computes "yesterday's" cutoff as `Date.now() - 24h` (server local time) instead of an explicit UTC midnight boundary.
19. **BUG-19:** Daily CRON streak increment applies to users where `last_login_at = yesterday` — this credits today's streak increment to users who haven't actually logged in yet today.
20. **BUG-20:** `audit_discrepancies` UNIQUE on `(user_id, asset_type)` with no timestamp — once a discrepancy is recorded for a user, any later discrepancy for the same pair is silently dropped forever until the first is resolved.
21. **BUG-21:** Offline message sync in the Expo app only covers DM and group-chat messages — room messages sent offline are silently lost with no queue, no retry, and no user indication.
22. **BUG-22:** CSP nonce is generated as `Buffer.from(crypto.randomUUID()).toString("base64")` — UUID provides only 122 bits of entropy with fixed variant bits; nonces should use full-entropy random bytes.
23. **BUG-23:** `xp_ledger` INSERT in `safeAwardXP` uses `ON CONFLICT DO NOTHING` without an explicit conflict target — silently swallows any unique violation on the table, not just the intended idempotency index.
24. **BUG-24:** `reconcile-balances` CRON authenticates via `x-cron-secret` header while all other CRONs use `Authorization: Bearer` — inconsistent auth surface causes misconfiguration risk with external CRON services.
25. **BUG-25:** Google Play IAP `purchaseCoins` and `purchaseSubscription` promises have no timeout — they hang indefinitely if the Play Store listener never fires (user dismisses sheet, app backgrounds, etc.).
26. **BUG-26:** `distributeSeasonRewards` in `seasonEngine.ts` uses dynamic `import("@/lib/economy/coins")` inside a DB transaction — same anti-pattern as BUG-12, different function.
27. **BUG-27:** `safeAwardXP` DLQ INSERT uses `ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL` which requires migration 005's partial unique index; this index is absent on installs using only `lib/db/migrations/009_bug_fixes.sql`.
28. **BUG-28:** `processSubscriptionEvent` in Paystack webhook has a dead redundant `if (!resolvedUserId) return;` guard at line 412 — dead code from incomplete refactor.
29. **BUG-29:** Drizzle `creatorEarnings` schema is also missing the `reference_id`, `paid_out`, and `payout_id` columns that exist in the actual DB — ORM-level reads silently return undefined for these fields.
30. **BUG-30:** `resetSeasonRankings` in `seasonEngine.ts` references `seasons.updated_at` in an UPDATE — this is the same missing-column bug as BUG-03 appearing in a second code path.
31. **BUG-31:** Room chat subscribes to realtime channel `room:<id>` but the server publishes new messages to `room:<id>:messages` — channel mismatch means messages never appear in the UI until the page is manually refreshed.
32. **BUG-32:** Room powers (pin message, room spotlight, member highlight) send `{ powerType }` in the request body but the server's Zod schema expects `{ power }` — Zod validation fails with a 400 and no power ever activates; additionally `message_pin` requires a `messageId` and `member_highlight` requires a `targetUserId` which the UI never collects.
33. **BUG-33:** The moments feed page (`/moments`) and create page (`/moments/create`) are fully implemented but `/moments` is absent from both the Sidebar and Navbar navigation — the entire feature is unreachable from the UI.

---

## Detailed Bug Descriptions

---

### BUG-01: `creator_earnings` Drizzle Schema Column Name Mismatch

**FILES:**  
`apps/web/lib/db/schema.ts` (line 1047), `apps/web/db/migrations/001_complete_schema.sql` (line 1360–1362), `apps/web/lib/db/migrations/009_bug_fixes.sql`

The Drizzle ORM schema (`schema.ts`) defines the `creator_earnings` table with fields `grossKobo` → DB column `gross_kobo` and `netKobo` → DB column `net_kobo`. However, the canonical SQL migration 001 (which always runs first and takes priority) creates the table with columns named `gross_amount_kobo`, `platform_fee_kobo`, and `net_amount_kobo`. Any Drizzle ORM query using `schema.creatorEarnings.grossKobo` generates SQL referencing `gross_kobo`, a column that doesn't exist in the database. The `lib/db/migrations/009_bug_fixes.sql` also creates the table with `gross_kobo` but the IF NOT EXISTS guard makes it a no-op since migration 001 creates it first.

**FIX:** Either (a) update `lib/db/schema.ts` `creatorEarnings` columns to match migration 001's actual names (`grossAmountKobo`/`gross_amount_kobo`, `netAmountKobo`/`net_amount_kobo`), or (b) add a migration that renames the DB columns to `gross_kobo`/`net_kobo` to match what the Drizzle schema declares. Be consistent: all raw SQL and Drizzle queries must reference the same column names.

---

### BUG-02: CRON Daily Handler Inserts `awarded_at` Into `user_badges` After Column Was Dropped

**FILES:**  
`apps/web/app/api/cron/daily/route.ts` (line 283), `apps/web/lib/db/migrations/009_bug_fixes.sql` (line 17)

Migration `009_bug_fixes.sql` executes `ALTER TABLE user_badges DROP COLUMN IF EXISTS awarded_at`. The CRON daily handler at line 283 still performs an INSERT that explicitly lists `awarded_at` in its column list: `INSERT INTO user_badges (user_id, badge_type, badge_key, reference_id, granted_at, awarded_at)`. After migration 009 is applied, this INSERT will fail with "column awarded_at of relation user_badges does not exist" — every Sunday season-badge distribution silently crashes.

**FIX:** Remove `awarded_at` from the INSERT column list (and the corresponding VALUES position) at line 283 of `daily/route.ts`. The table now only uses `granted_at`.

---

### BUG-03 / BUG-30: `seasons` Table Missing `updated_at` Column — Two Code Paths Affected

**FILES:**  
`apps/web/app/api/cron/daily/route.ts` (lines 141, 341–344), `apps/web/lib/seasons/seasonEngine.ts` (line 141), `apps/web/db/migrations/001_complete_schema.sql` (line 933–945)

Migration 001's `seasons` table definition has: `id, name, theme, description, season_number, starts_at, ends_at, pass_price_coins, reward_pool_coins, is_active, created_by, created_at`. There is no `updated_at` column. However, two distinct code paths attempt `UPDATE seasons SET … updated_at = NOW()`:

1. `daily/route.ts` line 341–344: `UPDATE seasons SET is_active = TRUE, updated_at = NOW()` (when activating upcoming seasons)
2. `seasonEngine.ts` line 141: `UPDATE seasons SET is_active = FALSE, updated_at = NOW()` (when closing a season)

Both will fail at runtime with "column updated_at of relation seasons does not exist."

**FIX:** Add a migration: `ALTER TABLE seasons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`. Then update both SQL statements to set it appropriately.

---

### BUG-04: Two Competing Migration Directories With Conflicting Table Schemas

**FILES:**  
`apps/web/db/migrations/` (001–011), `apps/web/lib/db/migrations/009_bug_fixes.sql`

There are two separate migration directories. The canonical one (`db/migrations/001–011`) is authoritative. A second file at `lib/db/migrations/009_bug_fixes.sql` independently creates several of the same tables with different column definitions:

- `creator_earnings`: 009 version uses `gross_kobo`/`net_kobo`; migration 001 uses `gross_amount_kobo`/`net_amount_kobo`
- `system_alerts`: 009 version uses columns `alert_type`/`payload`; migration 001 uses `type`/`severity`/`message`/`metadata` — completely different column names
- `user_subscriptions`: 009 version has a different structure (adds `plan`, `current_period_start`, `current_period_end`)
- `sponsored_quest_applications`: 009 references `quest_templates` via FK; 001 references `sponsored_quests` — different semantic meaning

All code uses migration 001's column names for `system_alerts` etc. If migration 009 (lib version) were ever applied to a DB that doesn't yet have these tables, the code would fail because the column names would differ. Additionally, migration 009 contains `ALTER TABLE user_badges DROP COLUMN IF EXISTS awarded_at` which is destructively applied to a column that CRON code still inserts (BUG-02), and `ALTER TABLE gifts RENAME COLUMN gift_type_id TO gift_item_id` which fails because the column doesn't exist (BUG-05).

**FIX:** Consolidate into a single migration directory. Audit `lib/db/migrations/009_bug_fixes.sql` for any genuine schema intent and migrate those changes as new numbered files in `db/migrations/` using IF NOT EXISTS / IF EXISTS guards. Delete `lib/db/migrations/009_bug_fixes.sql` once reconciled.

---

### BUG-05: Migration 009 Renames a Non-Existent Column in `gifts`, Breaking Migration Chain

**FILES:**  
`apps/web/lib/db/migrations/009_bug_fixes.sql` (line 8), `apps/web/db/migrations/001_complete_schema.sql` (line 1221–1234), `apps/web/db/migrations/011_bug_fixes.sql`

`009_bug_fixes.sql` line 8: `ALTER TABLE gifts RENAME COLUMN gift_type_id TO gift_item_id`. Migration 001 creates the `gifts` table with columns `gift_item_id` (FK to `gift_items`), `coin_value`, `coin_cost`, etc. — there is no `gift_type_id`. Migration 011 creates a new `gifts` table with `gift_type_id` but the IF NOT EXISTS guard makes it a no-op since migration 001's version already exists. Therefore, after migrations 001 and 011 run, the column `gift_type_id` still does not exist. When migration 009 executes its RENAME, it throws "column gift_type_id does not exist on table gifts" and the migration chain halts.

**FIX:** Wrap the RENAME in a conditional guard: `DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'gifts' AND column_name = 'gift_type_id') THEN ALTER TABLE gifts RENAME COLUMN gift_type_id TO gift_item_id; END IF; END $$;`. Or remove the statement from 009 entirely since migration 001's gifts table already uses `gift_item_id`.

---

### BUG-06: `system_alerts` INSERT Uses Unsupported Severity `'high'`, Violates CHECK Constraint

**FILES:**  
`apps/web/app/api/economy/webhooks/paystack/route.ts` (line 450)

The `system_alerts` DB table has `severity CHECK (severity IN ('info','warning','critical'))`. The Paystack webhook handler at line 450 inserts `severity = 'high'` when an unrecognised plan name is encountered. This violates the CHECK constraint, throws a PostgreSQL error, and — because the outer `.catch(() => {})` at the call site swallows errors — the alert is silently lost. Operators never see alerts about unknown Paystack plan names, and the subscription is never activated.

**FIX:** Change `'high'` to `'critical'` (or `'warning'`) at line 450 in the Paystack webhook handler. Audit all other `system_alerts` INSERT statements in the codebase for the same misuse of `'high'` as a severity level.

---

### BUG-07: `room_subscriptions` Has No Unique Constraint; Paystack ON CONFLICT Target Fails

**FILES:**  
`apps/web/app/api/economy/webhooks/paystack/route.ts` (lines 131–138), `apps/web/db/migrations/001_complete_schema.sql` (line 807–816)

Migration 001 creates `room_subscriptions` without any UNIQUE constraint. The Paystack webhook at line 131 performs `INSERT INTO room_subscriptions … ON CONFLICT (room_id, user_id) DO UPDATE`. PostgreSQL requires a unique constraint or unique index covering exactly those columns for a named ON CONFLICT clause. Without it, the INSERT throws: "there is no unique or exclusion constraint matching the ON CONFLICT specification." VIP room subscription payments complete on Paystack's side but the user's room access is never granted.

**FIX:** Add a migration: `CREATE UNIQUE INDEX IF NOT EXISTS room_subscriptions_room_user_idx ON room_subscriptions (room_id, user_id);` This satisfies the conflict target without altering the existing table constraint.

---

### BUG-08: `season_pass_milestones` ON CONFLICT References Non-Existent Unique Index

**FILES:**  
`apps/web/lib/seasons/seasonEngine.ts` (`seedSeasonPassMilestones` function), `apps/web/db/migrations/001_complete_schema.sql` (line 972–983)

`seedSeasonPassMilestones` runs `INSERT INTO season_pass_milestones … ON CONFLICT (season_id, sort_order) DO NOTHING`. The `season_pass_milestones` table only has a primary key on `id`. No unique constraint on `(season_id, sort_order)` exists. Attempting to seed milestones always fails with "there is no unique or exclusion constraint matching the ON CONFLICT specification" — season pass milestones can never be created programmatically.

**FIX:** Add a migration: `CREATE UNIQUE INDEX IF NOT EXISTS season_pass_milestones_season_sort_idx ON season_pass_milestones (season_id, sort_order);`

---

### BUG-09: `leaderboard_snapshots` UPSERT Fails on Installs Missing Migration 011

**FILES:**  
`apps/web/lib/leaderboards/engine.ts` (`upsertLeaderboardSnapshot`), `apps/web/db/migrations/011_bug_fixes.sql`, `apps/web/db/migrations/001_complete_schema.sql`

`upsertLeaderboardSnapshot` uses `ON CONFLICT (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))`. This requires an expression index — not a plain column list. Migration 011 creates this index (`leaderboard_snapshots_upsert_idx`) after first dropping the plain UNIQUE constraint from migration 001. On any install where migration 011 has not been applied, this ON CONFLICT clause will fail at runtime. Furthermore, without the expression index, the plain UNIQUE constraint from migration 001 treats each NULL city as a distinct value, allowing duplicate leaderboard rows for the same user/track/scope when `city = NULL`.

**FIX:** Ensure migration 011 is always applied in sequence. Additionally, embed the expression index in `001_complete_schema.sql` so fresh installs don't rely on incremental patches: replace the plain `UNIQUE(user_id, track, scope, city, season_id)` with a `CREATE UNIQUE INDEX … ON leaderboard_snapshots (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))`.

---

### BUG-10: `detectDuplicateMessage` Queries Non-Existent `direct_messages` Table

**FILES:**  
`apps/web/lib/moderation/contentFilter.ts` (line 162)

`detectDuplicateMessage` computes: `const table = messageContext === "dm" ? "direct_messages" : "room_messages"`. The table `direct_messages` does not exist in the database. Direct messages are stored in the `messages` table (with `conversation_id` FK to `dm_conversations`). Any call to `detectDuplicateMessage` with DM context will throw "relation 'direct_messages' does not exist", crashing the anti-spam check for every DM sent.

**FIX:** Change `"direct_messages"` to `"messages"` (the correct table). Also verify that the column names used in the subsequent SELECT (`content`, `created_at`, `sender_id`) match those on the `messages` table.

---

### BUG-11: `claimPassMilestone` Silently Skips `sticker_pack` Reward Type

**FILES:**  
`apps/web/lib/seasons/seasonEngine.ts` (`claimPassMilestone` function)

`claimPassMilestone` handles reward types `'coins'`, `'xp'`, `'badge'`, and `'cosmetic'` but has no branch for `'sticker_pack'`. When a user claims a sticker-pack milestone, the claim is recorded in `user_season_pass_claims` (preventing re-claim), but no sticker pack is granted. The user permanently loses the reward with no indication anything went wrong.

**FIX:** Add a `case 'sticker_pack':` branch in `claimPassMilestone` that inserts into `user_sticker_packs (user_id, pack_id)` using the pack identifier from `reward_value`. Also add a default case that logs an error for unrecognised reward types so future omissions are caught at development time.

---

### BUG-12: Dynamic `import()` Inside DB Transaction Callbacks (`warEngine.ts`, `seasonEngine.ts`)

**FILES:**  
`apps/web/lib/guilds/warEngine.ts`, `apps/web/lib/seasons/seasonEngine.ts` (see also BUG-26 for the second instance in `distributeSeasonRewards`)

Both files execute `const { creditCoins } = await import("@/lib/economy/coins")` inside `db.transaction(async (client) => { … })` callbacks. If the dynamic import fails (even from module cache miss during cold start, circular dependency, or a bundling issue), the transaction throws mid-flight. Depending on what has already executed, the DB ends up in a partially updated state with no clean rollback path visible at the caller. This is an unnecessary and avoidable risk.

**FIX:** Convert to static top-level imports in both files: `import { creditCoins } from "@/lib/economy/coins"` at the top of each file. Remove the `await import(…)` calls inside the transaction bodies.

---

### BUG-13: `getCommissionStats` Compares TEXT `tier` Column Against Integer Literals

**FILES:**  
`apps/web/lib/referrals/commissions.ts` (`getCommissionStats` function)

Migration `009_bug_fixes.sql` adds a `tier TEXT NOT NULL DEFAULT 'standard'` column to `referral_commissions`. The `getCommissionStats` function groups by `tier` and then filters/compares using integer literals (e.g. `tier = 1`, `tier = 2`). A TEXT column compared to an integer without quoting is a type mismatch. PostgreSQL will either reject it or produce an implicit cast that never matches real text values like `'standard'`, `'1'`, `'2'`. Commission tier statistics always return zero.

**FIX:** If tier values are stored as `'1'` and `'2'` (strings), update comparisons to use string literals: `tier = '1'` and `tier = '2'`. If the intent is to store integers, change the column type to INTEGER via migration and update code accordingly.

---

### BUG-14: `transferCoins` Uses `Date.now()` in Transfer Ref — Double-Transfer Risk on Retry

**FILES:**  
`apps/web/lib/economy/coins.ts` (`transferCoins` function)

`transferCoins` constructs a default `transferRef = \`transfer:${fromUserId}:${toUserId}:${Date.now()}\`` as the coin ledger idempotency key. On a network error, if the caller retries the same logical transfer, `Date.now()` returns a new value, producing a new reference. The `creditCoins`/`debitCoins` duplicate-detection logic (which keys on `reference_id`) treats this as a distinct new transfer and executes it again, double-debiting the sender.

**FIX:** Require callers to pass a stable, externally-generated idempotency key. Remove `Date.now()` from the default construction. If a default is needed, derive it deterministically from the stable inputs: `crypto.createHash('sha256').update(fromUserId + toUserId + amount.toString()).digest('hex')`.

---

### BUG-15: `buildKeyRegistry()` Rebuilds Map on Every JWT Verification Call

**FILES:**  
`apps/web/lib/auth/jwt.ts` (`buildKeyRegistry`, `getSecretForKid`, `verifyAccessToken`)

`verifyAccessToken` calls `getSecretForKid()` → `buildKeyRegistry()` on every invocation. `buildKeyRegistry()` iterates `Object.entries(process.env)` scanning for `JWT_SECRET_v*` keys and builds a new Map each time. Since environment variables are immutable after process start, this work is entirely redundant on every authenticated request and on every middleware invocation.

**FIX:** Extract `const keyRegistry = buildKeyRegistry()` as a module-level constant (evaluated once at import time). Update `getSecretForKid` to reference the module-level constant.

---

### BUG-16: Middleware Pre-Auth JWT Can Redirect User to `/home` Before 2FA Completion

**FILES:**  
`apps/web/middleware.ts` (line 232–237)

The public-route redirect block at line 232 checks: `if (payload?.sub)` to decide whether to redirect an authenticated user from `/auth/login` to `/home`. A pre-auth JWT (issued during the password-success phase of 2FA login, containing `type: 'pre_auth'`) has `payload.sub` set. If this token is present in the cookie when the user visits `/auth/login` (e.g., after a failed TOTP attempt), they are immediately redirected to `/home` — bypassing the TOTP verification entirely.

**FIX:** Update the condition to also exclude pre-auth tokens: `if (payload?.sub && payload?.type !== 'pre_auth')`. Only redirect users holding a full access token (type is `'access'` or absent).

---

### BUG-17: Both AI Provider Keys Required — App Fails to Start Without Either

**FILES:**  
`apps/web/lib/env.ts` (lines 75, 80)

`DEEPSEEK_API_KEY` and `GEMINI_API_KEY` are declared with `.min(1)` in the Zod env schema, making them effectively required. Any deployment that only configures one AI provider (e.g., only DeepSeek) will fail to start with "Environment validation failed: GEMINI_API_KEY: String must contain at least 1 character(s)". Both providers are used for different tasks in moderation and AI classification, but they should be independently optional with per-call runtime validation.

**FIX:** Change both to `.optional()` in the Zod schema. In the specific functions that call each provider, add a runtime check: `if (!env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY not configured")` (or similar). This fails fast at the point of use, not at startup.

---

### BUG-18: `resetDailyQuests` Uses Server Local Time Instead of UTC Date Boundary

**FILES:**  
`apps/web/lib/quests/questEngine.ts` (`resetDailyQuests`)

`resetDailyQuests` computes the cutoff as `new Date(Date.now() - 24 * 60 * 60 * 1000)` (24 hours ago). This is a rolling window, not a calendar day boundary, and is evaluated in the server's local timezone. In a UTC server environment the results are usually correct, but if the server's timezone is configured as anything other than UTC, quests will reset at a non-midnight boundary. It also means the reset window slightly drifts with DST transitions and is imprecise compared to "the start of today in UTC."

**FIX:** Use an explicit UTC date string: `const todayUTC = new Date().toISOString().slice(0, 10)` and filter with `WHERE quest_date < $1::date` using `todayUTC`. This guarantees resets happen at UTC midnight regardless of server timezone.

---

### BUG-19: Daily CRON Streak Increment Credits Users Who Haven't Logged In Yet Today

**FILES:**  
`apps/web/app/api/cron/daily/route.ts` (lines 100–110)

The streak-increment SQL increments `login_streak_days` for all users where `last_login_at::date = yesterday`. This only checks whether the user's most recent login was yesterday — it does NOT require the user to have also logged in today. The CRON runs at midnight UTC. A user who logged in yesterday evening and hasn't yet logged in today will receive a streak increment, even though they are technically about to break their streak. Their streak is temporarily inflated until the next day's CRON either keeps it (if they log in today) or resets it (if they don't).

**FIX:** Move streak increment logic to the login API handler: when a user logs in, check if `last_login_date = today - 1 day` and increment streak; if `last_login_date < today - 1 day`, reset streak to 1. The CRON should only handle resets for users who have NOT logged in by midnight UTC.

---

### BUG-20: `audit_discrepancies` Unique Constraint Blocks Re-Recording of Updated Discrepancies

**FILES:**  
`apps/web/db/migrations/005_sys_improvements.sql`, `apps/web/app/api/cron/reconcile-balances/route.ts` (lines 61–64, 78–81)

Migration 005 creates `audit_discrepancies` with `UNIQUE (user_id, asset_type)` — no timestamp in the key. The reconcile-balances CRON uses `ON CONFLICT DO NOTHING` (no conflict target). If a user already has an unresolved XP discrepancy row, any subsequent reconcile run silently skips recording a potentially larger or different discrepancy for the same user/asset pair. The table keeps stale discrepancy values until manually resolved, making the nightly reconciliation unreliable for persistent drifters.

**FIX:** Change the CRON's INSERT to use `ON CONFLICT (user_id, asset_type) DO UPDATE SET ledger_sum = EXCLUDED.ledger_sum, wallet_balance = EXCLUDED.wallet_balance, detected_at = NOW(), resolved = FALSE` so the row is refreshed with the latest discrepancy data on every reconcile pass.

---

### BUG-21: Expo Offline Queue Doesn't Cover Room Messages — They're Lost on Send

**FILES:**  
`apps/expo/lib/offline/useOfflineSync.ts`, `apps/expo/lib/offline/syncQueue.ts`, `apps/expo/lib/offline/sqlite.ts`

The offline message SQLite queue accepts `conversation_type` values of `'dm'` or `'group'`. The sync queue routes to `/messages/dm/…` or `/messages/group/…`. Room messages sent while the device is offline have no offline-queue path — the send call simply fails and the message is lost. The user sees no failure indicator and no retry mechanism exists for rooms.

**FIX:** Add `'room'` as a valid `conversation_type` in the SQLite schema and in `syncQueue.ts`. Route room-type messages to the appropriate room message endpoint (`/rooms/:roomId/messages`). Show the user a visual indicator (e.g., clock icon) when a message is queued offline, and remove it on successful sync.

---

### BUG-22: CSP Nonce Uses UUID Entropy Instead of Full-Entropy Random Bytes

**FILES:**  
`apps/web/middleware.ts` (line 188)

`const nonce = Buffer.from(crypto.randomUUID()).toString("base64")` generates a nonce by base64-encoding the ASCII bytes of a UUID string. UUIDs have only 122 bits of randomness (version and variant bits are fixed). Additionally, base64-encoding the UUID's ASCII string representation results in ~32 bytes encoding 36 ASCII characters (0–9, a–f, hyphens) — a very limited character space, further reducing effective entropy. CSP nonces should use raw random bytes.

**FIX:** Replace with: `const nonceBytes = crypto.getRandomValues(new Uint8Array(16)); const nonce = Buffer.from(nonceBytes).toString("base64url")`. This produces 128 bits of true entropy in a standard base64url format.

---

### BUG-23: `xp_ledger` INSERT Uses `ON CONFLICT DO NOTHING` Without Explicit Conflict Target

**FILES:**  
`apps/web/lib/xp/safeAwardXP.ts` (lines 72–83)

The CTE `INSERT INTO xp_ledger … ON CONFLICT DO NOTHING` has no explicit conflict target. Without naming a specific unique constraint or column list, PostgreSQL's `ON CONFLICT DO NOTHING` silently suppresses *any* unique constraint violation on the table. If a future schema change adds a new unique index on `xp_ledger` for unrelated reasons, a valid new XP award that happens to conflict with it would be silently dropped — making awards disappear invisibly.

**FIX:** Specify the conflict target explicitly: `ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`. Confirm the corresponding partial unique index exists (migration 007 adds `xp_ledger_unique_ref`).

---

### BUG-24: CRON Auth Inconsistency — `reconcile-balances` Uses `x-cron-secret` Header, Others Use `Authorization: Bearer`

**FILES:**  
`apps/web/app/api/cron/reconcile-balances/route.ts` (line 17), `apps/web/app/api/cron/daily/route.ts` (line 55)

`reconcile-balances/route.ts` reads authentication from `req.headers.get("x-cron-secret")`. All other CRON handlers (`daily`, `payouts`, `guild-wars`, `leaderboards`) validate `Authorization: Bearer <CRON_SECRET>`. External CRON services (cron-job.org, etc.) must be configured with a different header for this one endpoint, which is easy to misconfigure and leave the reconcile endpoint unprotected.

**FIX:** Update `reconcile-balances/route.ts` to use the same `Authorization: Bearer <CRON_SECRET>` pattern used by all other CRON handlers. Consider extracting a shared `validateCronSecret(req)` helper (one already exists in `daily/route.ts`) into a shared lib file.

---

### BUG-25: Google Play IAP Purchase Promises Have No Timeout

**FILES:**  
`apps/expo/lib/payments/googlePlay.ts` (`purchaseCoins`, `purchaseSubscription`)

Both purchase functions return a `new Promise` that resolves only when the global `InAppPurchases.setPurchaseListener` callback fires. If the user dismisses the Google Play billing sheet without completing the purchase, if the listener fails silently, or if the app backgrounds during a purchase, the promise hangs indefinitely. The calling UI code has no way to detect or escape this stuck state.

**FIX:** Wrap the inner promise with `Promise.race` against a 5-minute timeout: `Promise.race([purchasePromise, new Promise((_, reject) => setTimeout(() => reject(new Error('Purchase timed out')), 5 * 60 * 1000))])`. In the timeout handler, clean up the resolver and active-session maps to prevent leaks.

---

### BUG-26: `distributeSeasonRewards` Dynamic Import Inside Transaction (Second Instance of BUG-12)

**FILES:**  
`apps/web/lib/seasons/seasonEngine.ts` (line 256–257, inside `distributeSeasonRewards`)

`await import("@/lib/economy/coins")` is called inside the `db.transaction(async (client) => { … })` callback in `distributeSeasonRewards`. This is the same anti-pattern as BUG-12. If the import fails mid-transaction (e.g., during a serverless cold start or due to a bundling edge case), partial season rewards are committed with no clean rollback.

**FIX:** Add a static top-level import: `import { creditCoins } from "@/lib/economy/coins"` at the top of `seasonEngine.ts`. Remove the `await import(…)` call inside the transaction.

---

### BUG-27: `safeAwardXP` DLQ INSERT Conflict Target Requires Partial Index That May Not Exist

**FILES:**  
`apps/web/lib/xp/safeAwardXP.ts` (lines 91–96), `apps/web/db/migrations/005_sys_improvements.sql`

The DLQ INSERT in `safeAwardXP` uses: `ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`. This requires the partial unique constraint `uq_failed_xp_reference` which is defined in migration 005 as `UNIQUE (user_id, source, reference_id) DEFERRABLE INITIALLY IMMEDIATE`. If a DB is initialised using only `lib/db/migrations/009_bug_fixes.sql` (which creates `failed_xp_awards` without the partial unique index), this ON CONFLICT target fails. The DLQ INSERT throws, and the error is caught by the inner `.catch()` which logs a "Failed to write to DLQ" message — on top of the original XP award failure.

**FIX:** Remove the `failed_xp_awards` CREATE TABLE from `lib/db/migrations/009_bug_fixes.sql` and rely solely on migration 005's definition which includes the partial unique constraint. Add a guard in `009` to skip the create if the table already exists.

---

### BUG-28: Paystack Webhook `processSubscriptionEvent` Has Dead Redundant Null Check

**FILES:**  
`apps/web/app/api/economy/webhooks/paystack/route.ts` (lines 400–412)

At line 400–408, the function attempts to look up `resolvedUserId` from email if the metadata userId is absent, and returns early at line 408 if the lookup also fails. At line 412, a second `if (!resolvedUserId) return;` check is present — but control cannot reach line 412 if `resolvedUserId` is null, because the function already returned at line 408. This is dead code left from a partially completed refactor. While not a functional bug, it misleads readers about the actual control flow.

**FIX:** Remove the redundant null check at line 412.

---

### BUG-29: Drizzle `creatorEarnings` Schema Missing `reference_id`, `paid_out`, `payout_id` Columns

**FILES:**  
`apps/web/lib/db/schema.ts` (lines 1042–1060), `apps/web/db/migrations/001_complete_schema.sql` (line 1353–1366)

Beyond BUG-01 (wrong column names for grossKobo/netKobo), the `creatorEarnings` Drizzle table definition is also missing `reference_id TEXT`, `paid_out BOOLEAN`, and `payout_id UUID` — all of which exist in the actual DB from migration 001. Any ORM-level query that selects all fields from `creator_earnings` will receive `undefined` for these columns, silently hiding data. Code that reads `creatorEarning.paidOut` or `creatorEarning.referenceId` via Drizzle will always get `undefined`.

**FIX:** Add the missing fields to the `creatorEarnings` pgTable definition in `lib/db/schema.ts`: `referenceId: text("reference_id"), paidOut: boolean("paid_out").default(false), payoutId: uuid("payout_id")`. Align all column names with the actual migration 001 definition.

---

### BUG-30: `resetSeasonRankings` Also References `seasons.updated_at` — Second Instance of BUG-03

**FILES:**  
`apps/web/lib/seasons/seasonEngine.ts` (line 141 inside `resetSeasonRankings`)

`resetSeasonRankings` calls `UPDATE seasons SET is_active = FALSE, updated_at = NOW() WHERE id = $1` inside its transaction. This is a second occurrence of the missing-column bug (BUG-03). Applying the migration fix from BUG-03 (adding `updated_at` to the `seasons` table) resolves both this instance and the one in `daily/route.ts`.

**FIX:** See BUG-03 fix: `ALTER TABLE seasons ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();`

---

### BUG-31: Room Chat Realtime Channel Name Mismatch — Messages Don't Appear Until Page Refresh

**FILES:**  
`apps/web/app/(app)/rooms/[roomId]/page.tsx` (line 1072)  
`apps/web/app/api/rooms/[roomId]/messages/route.ts` (line 608)  
`apps/web/app/api/rooms/[roomId]/stream/route.ts` (line 297)

The server publishes every new room message to the realtime channel `room:<roomId>:messages`. The SSE stream endpoint also explicitly instructs the client (via a `realtime_ready` event) to subscribe to `room:<roomId>:messages`. However, the room page hard-codes the subscription channel as `room:${roomId}` — missing the `:messages` suffix. The client is listening on a channel that receives no events. New messages only appear after a manual page refresh because the REST GET snapshot re-fetches all messages.

DMs are not affected — the DM page subscribes to `dm:conversation:${conversationId}` and the server publishes to exactly that channel. If DMs also feel slow, it is because the `NEXT_PUBLIC_REALTIME_PROVIDER` environment variable is not configured, causing both rooms and DMs to fall back to polling rather than push.

**FIX:** Change `room:${roomId}` to `room:${roomId}:messages` at line 1072 of `rooms/[roomId]/page.tsx`. One character change. Ensure `NEXT_PUBLIC_REALTIME_PROVIDER` is set in production for live push delivery.

---

### BUG-32: Room Powers Send Wrong Request Body Key — Pin Message and All Powers Do Nothing

**FILES:**  
`apps/web/app/(app)/rooms/[roomId]/page.tsx` (line 584)  
`apps/web/app/api/rooms/[roomId]/powers/route.ts` (lines 43–57)

The `activate()` function on the room page sends `{ powerType: "message_pin" }`. The server's Zod schema uses `z.discriminatedUnion("power", [...])` — it expects the discriminant key to be `power`, not `powerType`. Zod validation fails on every request and returns a 400; no power ever fires. Additionally, even after fixing the key name, `message_pin` requires a `messageId` UUID (which specific message to pin) and `member_highlight` requires a `targetUserId` UUID — neither value is collected anywhere in the current UI.

**FIX:**
1. Change the fetch body from `{ powerType }` to `{ power: powerType }` at line 584 — fixes `room_spotlight` immediately.
2. Redesign `message_pin` as a per-message context-menu action (long-press / right-click) that passes the selected message's ID. The current toolbar pin button has nowhere to get a `messageId` from.
3. Redesign `member_highlight` to show a member picker before activation so `targetUserId` can be captured.

---

### BUG-33: Moments Page Exists but Is Unreachable — Not Listed in Navigation

**FILES:**  
`apps/web/components/layout/Sidebar.tsx` (lines 41–56)  
`apps/web/components/layout/Navbar.tsx` (lines 44–70)

The moments feed (`/app/(app)/moments/page.tsx`) and create page (`/app/(app)/moments/create/page.tsx`) are both fully implemented — the API (`/api/moments/`, `/api/moments/[id]/reactions/`) is complete, and moments are correctly stored and expired by the daily CRON. However, `/moments` is absent from both the Sidebar's `primaryNavItems` array and the Navbar's `primaryNavItems` array. There is no link to the feature anywhere in the navigation. Users can only discover it by guessing the URL directly. The in-room ⚡ moment toggle works correctly and sends moment-type messages, but the standalone moments feed is a dead end.

**FIX:** Add `{ href: "/moments", label: "Moments", icon: "⚡" }` to `primaryNavItems` in both `Sidebar.tsx` and `Navbar.tsx`. No other changes required — the feature is otherwise complete.

---

## Code Quality Summary Table

| Dimension | Before | After Fixes |
|---|---|---|
| Security architecture | ✅ Strong | ✅ Strong |
| Payment integrity | ✅ Good (HMAC, idempotency) | ✅ Good |
| Schema/migration hygiene | ❌ Dual conflicting systems | ✅ Consolidated |
| DB query correctness | ❌ Multiple broken ON CONFLICT clauses | ✅ All fixed |
| Runtime crash risk | ❌ High (missing columns, wrong table names) | ✅ Low |
| Auth & session model | ✅ Good (JWT + Redis rotation) | ✅ + pre-auth bypass fix |
| Mobile (Expo) offline | ⚠️ Room messages lost, no IAP timeout | ✅ Fixed |
| Realtime chat delivery | ❌ Channel mismatch — room msgs never push | ✅ Fixed (1-line fix) |
| Room powers / paid extras | ❌ Wrong request key, 400 on every call | ✅ Fixed + UX redesign |
| Feature discoverability | ❌ Moments page unreachable (no nav link) | ✅ Fixed |
| Performance (hot path) | ⚠️ JWT key registry rebuilt every call | ✅ Memoized |
| Env config robustness | ⚠️ Fails hard if either AI key absent | ✅ Graceful |
| Streak/XP data accuracy | ⚠️ Streak overcounting, XP silently dropped | ✅ Fixed |

---

*Report generated: June 15, 2026 — 06:38 AM*  
*Zobia Social Forensic Bug Report v1.0 — Complete, untruncated listing of all discovered issues*
