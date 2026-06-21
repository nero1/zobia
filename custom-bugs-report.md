# Zobia Codebase Forensic Bug Report

**Date:** 2026-06-21  
**Time:** 06:28 AM UTC  
**Analysis:** Three-pass forensic review of all web, PWA, and Expo Android app source files  
**Scope:** `/apps/web` (Next.js 14 App Router + PWA) and `/apps/expo` (React Native Android)

---

## Summary Bug Index (one-line descriptions)

1. **SCHEMA-01** — `login_streak_days` column exists in DB migrations but is absent from Drizzle `schema.ts`; both streak columns are incremented in lockstep creating an unlisted authoritative duplicate.
2. **RACE-01** — Concurrent gift-send requests can both pass the Redis idempotency pre-check and insert duplicate `gifts` table rows because the table has no `ON CONFLICT` guard.
3. **AUTH-01** — Session refresh race: concurrent requests with the same refresh token can both succeed within the 30 s grace window, producing two valid but conflicting rotation states.
4. **AUTH-02** — Banned user Redis cache has a 30 s TTL — a newly banned user can perform sensitive mutations for up to 30 s.
5. **SCHEMA-02** — Dead `sessions` DB table has no cleanup mechanism; stale rows accumulate indefinitely with no TTL or deletion.
6. **SCHEMA-03** — Deprecated `userQuests` table is retained with no documented migration or removal plan.
7. **SCHEMA-04** — `dm_conversations` canonical ordering (`user_id_1 < user_id_2`) is enforced only at the application layer — no DB CHECK constraint prevents a reversed duplicate conversation.
8. **PERF-01** — Monthly plan bonus bulk CTE in `daily-economy` processes all users in a single unbounded query, risking the Vercel 10 s function timeout.
9. **PAY-01** — `processTransferEvent` looks up payouts using `transfer_code ?? reference`; if Paystack provides both fields with different values, the lookup uses `transfer_code` but payouts are keyed on `reference`, causing a miss.
10. **GUILD-01** — Guild tier demotion is tracked in two different DB columns by two different crons: `below_minimum_days` (integer) in `guild-wars/route.ts` and `below_min_since` (timestamp) in `daily-guilds/route.ts` — enabling double-demotion or permanently conflicting state.
11. **LB-01** — Hall of Fame injection in `getLeaderboard` checks `entries.length < 100` before adding HoF entries; on a full page of exactly 100 results, zero HoF users are injected, breaking the PRD's permanent top-100 visibility guarantee.
12. **LB-02** — Season top-100 badge in `daily-social` awards only to `rank BETWEEN 11 AND 100`; ranks 1–10 are silently excluded.
13. **RACE-02** — Alliance war resolution in `daily-platform` reads and updates war status without `FOR UPDATE` — concurrent CRON runs can double-resolve the same war.
14. **GUILD-02** — Alliance war score query filters `gm.left_at IS NULL`, discarding XP contributions from members who departed during the war window.
15. **TYPE-01** — `daily-social` and `leaderboards/route.ts` both cast XP arrays as `int[]` via `unnest($N::int[])` but `leaderboard_snapshots.xp_value` is `bigint`; values above 2,147,483,647 overflow silently.
16. **NOTIF-01** — Guild war final-hour notification (`guild-wars/route.ts`) populates only the legacy `notifications.payload` column; clients rendering `title`/`body` display blank text.
17. **MAINT-01** — Four or more cron routes (`guild-wars`, `leaderboards`, `reconcile-balances`, `games`) each define their own local CRON secret validation function instead of importing from `@/lib/cron/auth`.
18. **PERF-02** — `daily-guilds/route.ts` guild tier demotion performs one `UPDATE` per guild in a sequential loop; this should be a single set-based `UPDATE … WHERE`.
19. **SCHEMA-05** — `referral_commissions.tier` defaults to `'standard'` in the Drizzle schema but code always inserts `'1'` or `'2'`; the default is never used and tier-based filters on `'standard'` return no rows.
20. **LB-03** — `getLeaderboard` total count is computed before HoF injection; after injection, page 1 may silently drop legitimate non-HoF entries to fit `pageSize`, with no pagination signal to the client.
21. **AUTH-03** — Expo `signOut` sends `Origin: env.API_BASE_URL` but the CSRF middleware validates against `NEXT_PUBLIC_APP_URL`; a mismatch (trailing slash, case difference) causes logout to be blocked, leaving server sessions live indefinitely.
22. **DLQ-01** — `safeAwardXP` called with a `dbClient` inside a DB transaction: if that transaction rolls back, a DLQ entry is still written via `globalDb`, describing XP that was never actually lost and consuming retry slots needlessly.
23. **PERF-03** — `daily-platform` SYS-02 leaderboard reconciliation queries ALL non-deleted users in one pass with no batch limit — risks OOM or timeout on large datasets.
24. **IAP-01** — `iap/verify/route.ts` uses the client-supplied `packageName` directly in the Google Play API URL without validating it against the expected app bundle ID — allows purchase tokens from a different app to be accepted.
25. **NULLABLE-01** — Multiple queries use `is_banned = FALSE` instead of `COALESCE(is_banned, false) = FALSE`; because `is_banned` is nullable in the schema, users with `NULL` in that column are incorrectly excluded.
26. **PERF-04** — `daily-users/route.ts` comeback bonus expiry runs one sequential DB transaction per expired user — easily exceeds the 10 s function limit for large sets.
27. **OPS-01** — `reconcile-balances/route.ts` auto-corrects discrepancies ≤ 50 XP/coins but raises no alert (no `system_alerts` entry) for discrepancies above the threshold that need manual investigation.
28. **HDRDUP-01** — Both `next.config.js` and `middleware.ts` set `Permissions-Policy` with different feature sets, producing duplicate headers with inconsistent values in every HTTP response.
29. **PERF-05** — `nemesisEngine.ts` `refreshNemesisAssignments` runs `assignNemesis` (3–5 queries each) sequentially per user — for 1 000+ unassigned users this is impractically slow.
30. **PERF-06** — `reconcile-balances/route.ts` pages users with `LIMIT … OFFSET` — OFFSET-based pagination degrades to O(N²) as the offset grows; keyset pagination on the primary key would be O(1) per page.
31. **OPS-02** — `geoAnomaly.ts` inserts a `system_alerts` row for every single IP anomaly, even the very first (logged as 'info'); for users with dynamic IPs this floods the alerts table.
32. **DATA-01** — `questEngine.ts` `resetDailyQuests` marks `user_quest_progress` rows as expired but never deletes them — no pruning step exists, causing unbounded table growth.
33. **SEC-01** — `middleware.ts` CSRF bypass for cron paths compares the Bearer token with `===` instead of `timingSafeEqual`, leaking CRON_SECRET length and content information via timing.
34. **NOTIF-02** — In `daily-notify/route.ts` step 1, push/email notifications are dispatched fire-and-forget; the batch `UPDATE push_email_notified = true` is separate and its error is swallowed with `.catch(() => {})` — if the UPDATE fails, all dispatched users receive the same notification again on the next run.
35. **PERF-07** — In `daily-notify/route.ts`, comeback coin credits for 90-day inactive users are all fired concurrently without a concurrency limit (no `await` in the loop), creating a thundering herd that can exhaust the DB connection pool.
36. **SCHEMA-06** — The `notifications` table has both a legacy `payload` (jsonb) column and newer `title`/`body`/`metadata` columns with no documented migration path; mixed-format rows cause blank notifications on clients that read the newer fields.
37. **AUDIT-01** — `reconcile-balances/route.ts` auto-corrects balances silently without verifying which side (ledger or balance column) is the source of truth; when the ledger is incomplete (missing entries), this correction silently removes valid XP or coins from users without notification.
38. **QUEST-01** — `generateDailyDeck` shuffles quest templates using `MD5(CONCAT(userId, questId))` as the seed but the current date is excluded; the same user receives the exact same quest deck every day unless the template set changes.
39. **PAY-02** — `creator_earnings` INSERT in the DodoPay `room_subscription` webhook handler has no `ON CONFLICT DO NOTHING`; webhook retries create duplicate earnings rows.
40. **SCHEMA-07** — `creator_earnings` unique index is on `reference_id` alone (not `(creator_id, reference_id)`); a reference_id collision between two different creators silently drops one creator's legitimate earnings on conflict.

---

## Detailed Bug Entries

---

### 1. SCHEMA-01 — `login_streak_days` missing from Drizzle schema / redundant streak columns

**FILES:**
- `apps/web/lib/db/schema.ts`
- `apps/web/db/migrations/0001_consolidated_schema.sql` (line 120)
- `apps/web/app/api/cron/daily-core/route.ts`
- `apps/web/app/api/cron/daily-economy/route.ts`
- `apps/web/app/api/cron/daily-notify/route.ts`
- `apps/web/app/api/login/daily/route.ts`

**FIX:** The `users` table has both `login_streak` and `login_streak_days` in the DB migration SQL but only `loginStreak` is in the Drizzle schema.ts. The two columns are incremented and reset in lockstep in every caller, making one of them redundant. Add `loginStreakDays: integer("login_streak_days").notNull().default(0)` to the Drizzle schema and decide which column is authoritative. Deprecate and eventually drop the redundant one via migration. All callers should reference the single canonical column.

---

### 2. RACE-01 — Duplicate gift record race condition

**FILES:**
- `apps/web/app/api/economy/gifts/send/route.ts`

**FIX:** Two concurrent requests that arrive within the same millisecond both read `existingKey === null` from Redis (the idempotency key hasn't been written yet), both pass the pre-check, and both enter `db.transaction`. The `debitCoins`/`creditCoins` calls are protected by the coin_ledger partial unique index, so no double-charge occurs. However, the `INSERT INTO gifts` at the end of the transaction has no `ON CONFLICT` clause and no unique constraint on `(sender_id, recipient_id, gift_item_id, created_at)` — if both transactions commit (second one succeeds because coins are idempotently blocked), two `gifts` rows are created. Add an `ON CONFLICT (reference_id) DO NOTHING` to the gifts INSERT (using the idempotency key as reference_id), or add a unique index on `(sender_id, gift_item_id, reference_id)` to the `gifts` table.

---

### 3. AUTH-01 — Session refresh race condition

**FILES:**
- `apps/web/lib/auth/session.ts`
- `apps/web/app/api/auth/refresh/route.ts`

**FIX:** The 30 s grace window allows multiple concurrent refresh calls with the same token to all succeed. Redis stores session data with a SET-then-GET pattern; if two serverless instances both pass the grace-window check and both rotate the session, the last writer wins and the first writer's new token is silently invalidated. This manifests as sporadic 401s for mobile clients on flaky connections. Use a Redis Lua script or `SET NX` to make the session rotation atomic: the first writer claims the rotation and the second writer gets a "rotation in progress" signal, then re-reads the new session after a short delay.

---

### 4. AUTH-02 — 30 s ban cache window

**FILES:**
- `apps/web/lib/api/middleware.ts`

**FIX:** The `withAuth` middleware caches the user's ban status in Redis for 30 s to avoid a DB hit on every request. A user banned at time T can still successfully authenticate and submit mutations until T+30 s. For sensitive operations (coin transfer, gift send, content posting), reduce the cache TTL to 0 for post-ban checks by calling `getSessionFresh` (or an equivalent DB-direct lookup) when `is_banned` is being evaluated, rather than relying on the cached value. Alternatively, add a Redis pubsub signal on ban that immediately invalidates the cached session.

---

### 5. SCHEMA-02 — Dead `sessions` table accumulates stale rows

**FILES:**
- `apps/web/lib/db/schema.ts`

**FIX:** The `sessions` table exists in the DB schema (kept "to avoid a destructive migration") but is no longer written to — all session state is Redis-backed. Without a TTL, DELETE trigger, or periodic cleanup job, this table grows indefinitely with orphaned rows from before the Redis migration. Add a CRON step to `DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '30 days'`, or create a migration that either drops the table (with a guard confirming it is unused) or adds a row-level TTL mechanism.

---

### 6. SCHEMA-03 — Deprecated `userQuests` table retained indefinitely

**FILES:**
- `apps/web/lib/db/schema.ts`

**FIX:** The `userQuests` table is marked as "deprecated, superseded by `user_quest_progress`" in the schema comment but no migration removes it and no cleanup prevents new rows from accidentally being inserted by stale code paths. Create a migration to `DROP TABLE IF EXISTS user_quests` (or rename to `_deprecated_user_quests`) once all callers have been confirmed to use `user_quest_progress` exclusively.

---

### 7. SCHEMA-04 — `dm_conversations` ordering not enforced at DB level

**FILES:**
- `apps/web/lib/db/schema.ts`

**FIX:** The unique index on `dm_conversations(user_id_1, user_id_2)` assumes `user_id_1 < user_id_2` for deduplication. Application code enforces this ordering using `LEAST` / `GREATEST`, but there is no DB-level CHECK constraint (`CHECK (user_id_1 < user_id_2)`). If any caller inserts with the wrong ordering, a reversed duplicate conversation is created that the unique index does not catch. Add `CHECK (user_id_1 < user_id_2)` to the `dm_conversations` table definition.

---

### 8. PERF-01 — Monthly plan bonus bulk CTE unbounded

**FILES:**
- `apps/web/app/api/cron/daily-economy/route.ts`

**FIX:** The monthly plan bonus step selects and updates all eligible users in a single CTE query. On a large user base this query can exceed Vercel's 10 s function limit mid-write, leaving some users credited and others not. Add a `LIMIT 5000` (or similar) to the CTE and use the daily idempotency key (`checkCronIdempotency`) to detect and resume partial runs, or paginate the operation using a cursor-based approach within the cron.

---

### 9. PAY-01 — Paystack transfer payout lookup mismatch

**FILES:**
- `apps/web/lib/payments/paystackWebhookHandler.ts`

**FIX:** `processTransferEvent` resolves the payout record using `transfer_code ?? reference`. Paystack's transfer webhooks include both `transfer_code` (a Paystack-generated identifier) and `reference` (the merchant reference stored in the `payouts` table). When both are present and differ, the lookup uses `transfer_code` as the first operand, but payouts are stored under `reference`. The WHERE clause should search by `reference` explicitly (the value that was sent to Paystack at initiation time) rather than preferring `transfer_code`. Update the lookup to `WHERE reference_id = $data.reference`.

---

### 10. GUILD-01 — Guild tier demotion tracked in two separate DB columns by two separate crons

**FILES:**
- `apps/web/app/api/cron/guild-wars/route.ts`
- `apps/web/app/api/cron/daily-guilds/route.ts`
- `apps/web/lib/db/schema.ts`

**FIX:** `guild-wars/route.ts` step 7 uses `below_minimum_days` (an integer counter that increments daily) to determine guild demotion. `daily-guilds/route.ts` uses `below_min_since` (a timestamp marking when the guild first dropped below minimum) for the same purpose. Both columns exist in the `guilds` table, both are independently maintained, and both can trigger demotion. A guild can be demoted twice in one day if both crons run close together, or the demotion logic can produce inconsistent results if one column is updated without the other. Choose one mechanism (timestamp `below_min_since` is more robust), remove the other column via migration, and update both crons to use the single authoritative field.

---

### 11. LB-01 — Hall of Fame injection skipped when page is full

**FILES:**
- `apps/web/lib/leaderboards/engine.ts`

**FIX:** In `getLeaderboard`, after fetching the page of results, HoF users are injected only when `entries.length < 100`. On a full page (exactly 100 entries), `entries.length === 100` and the condition is false — no HoF users are injected despite the PRD guaranteeing permanent top-100 visibility. Change the injection condition to `entries.length <= pageSize` (the configured page size, not the hardcoded 100), or better: inject HoF entries before truncating to `pageSize`, then slice to `pageSize` afterward. This ensures HoF users always appear on page 1.

---

### 12. LB-02 — Season top-100 badge excludes ranks 1–10

**FILES:**
- `apps/web/app/api/cron/daily-social/route.ts`

**FIX:** The badge award query filters `rank BETWEEN 11 AND 100`, which explicitly excludes ranks 1–10. The `season_top100_frame` badge should be awarded to users ranked 1–100 (the entire top 100). Change the condition to `rank <= 100`.

---

### 13. RACE-02 — Alliance war resolution without row lock

**FILES:**
- `apps/web/app/api/cron/daily-platform/route.ts`

**FIX:** The alliance war resolution step reads war scores and updates `war_status = 'completed'` without acquiring a `FOR UPDATE` lock on the war rows first. If two CRON instances overlap (e.g., an external scheduler fires twice close together), both can read the same "active" war, both compute scores, and both mark it resolved — potentially with conflicting winner selections and double-rewarding participants. Add `FOR UPDATE SKIP LOCKED` to the war row SELECT before computing scores and updating status, consistent with how `resolveWar` in `warEngine.ts` handles guild wars.

---

### 14. GUILD-02 — Alliance war excludes XP from departed members

**FILES:**
- `apps/web/app/api/cron/daily-platform/route.ts`

**FIX:** The alliance war score aggregation JOINs `guild_members gm ON gm.left_at IS NULL`, filtering to only currently-active members. Members who contributed XP during the war window and then left before the war ends have their contributions silently dropped from the score. The correct approach is to count contributions from all members who were in the guild at any point during the war window: join with `gm.joined_at <= war.ends_at AND (gm.left_at IS NULL OR gm.left_at >= war.starts_at)`.

---

### 15. TYPE-01 — XP values overflow: `int[]` cast but column is `bigint`

**FILES:**
- `apps/web/app/api/cron/daily-social/route.ts`
- `apps/web/app/api/cron/leaderboards/route.ts`
- `apps/web/lib/db/schema.ts` (confirms `leaderboard_snapshots.xp_value` is `bigint`)

**FIX:** Both crons pass XP values using `unnest($N::int[])`, which truncates values above PostgreSQL's `INT_MAX` (2,147,483,647). The `leaderboard_snapshots.xp_value` column is defined as `bigint`. Change the array type cast to `unnest($N::bigint[])` in both crons. Also update the TypeScript array declaration types from `number[]` to `bigint[]` (or `string[]` with explicit casting) to prevent silent truncation in the JavaScript layer.

---

### 16. NOTIF-01 — Guild war notifications use legacy `payload` column only

**FILES:**
- `apps/web/app/api/cron/guild-wars/route.ts`

**FIX:** The final-hour and war-resolved notifications in `guild-wars/route.ts` INSERT into `notifications.payload` (a legacy jsonb column) and leave `title`, `body`, and `metadata` NULL. All other notification senders — both cron routes and API handlers — populate the `title`/`body`/`metadata` columns. Clients that read `body` display blank text for these notifications. Update the war notification INSERTs to populate `title`, `body`, and `metadata` instead of (or in addition to) `payload`, matching the pattern used in every other cron route.

---

### 17. MAINT-01 — CRON secret validation duplicated across four or more cron routes

**FILES:**
- `apps/web/app/api/cron/guild-wars/route.ts`
- `apps/web/app/api/cron/leaderboards/route.ts`
- `apps/web/app/api/cron/reconcile-balances/route.ts`
- `apps/web/app/api/cron/games/route.ts`
- `apps/web/lib/cron/auth.ts` (canonical location)

**FIX:** Each of the four listed cron routes defines its own local `isValidSecret` / `validateCronSecret` function, duplicating the canonical implementation in `@/lib/cron/auth`. If the canonical implementation is ever patched (e.g., to add key-length pre-check or change comparison semantics), the duplicates will not be updated. Replace all four local implementations with `import { validateCronSecret } from '@/lib/cron/auth'`.

---

### 18. PERF-02 — Guild tier demotion N+1 loop in `daily-guilds`

**FILES:**
- `apps/web/app/api/cron/daily-guilds/route.ts`

**FIX:** The guild tier enforcement loop fetches all guilds and issues one `UPDATE` per guild. For N guilds this is N+1 queries, which becomes slow at scale. Replace the loop with a single set-based `UPDATE guilds SET tier = ..., below_min_since = ... WHERE ... (conditions)` query that promotes/demotes all applicable guilds in one round-trip, consistent with the set-based pattern already used for other guild operations.

---

### 19. SCHEMA-05 — `referral_commissions.tier` wrong default, inconsistent with usage

**FILES:**
- `apps/web/lib/db/schema.ts`
- `apps/web/lib/referrals/commissions.ts`

**FIX:** The Drizzle schema defines `tier` with `.default('standard')`, but `commissions.ts` always inserts `'1'` (direct referral) or `'2'` (second-level referral). No code path ever inserts `'standard'`. Any query that filters `WHERE tier = 'standard'` returns nothing. Change the column type to an explicit `text` enum or integer, update the default to match actual usage (e.g., remove the default entirely or use `'1'`), and ensure the schema is consistent with all inserting callers.

---

### 20. LB-03 — `getLeaderboard` total count excludes HoF-injected entries

**FILES:**
- `apps/web/lib/leaderboards/engine.ts`

**FIX:** The leaderboard query returns `COUNT(*) OVER()` as the `total` before HoF injection. After injecting HoF users, the entries array can exceed `pageSize`. The response is then sliced back to `pageSize`, silently dropping legitimate non-HoF entries with no pagination signal. The client receives fewer entries than it expects and its total count is wrong. Compute the total count after injection and truncation, and explicitly communicate to the client that HoF entries are included (e.g., a `hofCount` field) so pagination can account for them.

---

### 21. AUTH-03 — Expo logout CSRF failure due to Origin mismatch

**FILES:**
- `apps/expo/lib/auth/context.tsx`
- `apps/expo/lib/api/client.ts`
- `apps/web/middleware.ts`

**FIX:** Expo sets `Origin: env.API_BASE_URL` on outgoing requests. The CSRF middleware validates `origin === process.env.NEXT_PUBLIC_APP_URL || origin === requestOrigin`. If `env.API_BASE_URL` (used in the Expo app) differs from `NEXT_PUBLIC_APP_URL` (configured on the server) in any way — trailing slash, port, protocol case — the POST to `/api/auth/logout` is rejected with 403, leaving the server session alive. Ensure that both env vars are set to the exact same string (enforce this in CI), or relax the comparison to normalize both sides (strip trailing slash, lowercase) before comparing.

---

### 22. DLQ-01 — Phantom DLQ entries when outer transaction rolls back

**FILES:**
- `apps/web/lib/xp/safeAwardXP.ts`

**FIX:** When `safeAwardXP` is called with a `dbClient` that belongs to an in-progress outer transaction, and that transaction later rolls back (e.g., because the calling API route hits an error), the DLQ `INSERT INTO failed_xp_awards` is written via `globalDb` (outside the transaction) and persists. The DLQ entry describes XP that was never actually lost — the CRON retry will attempt to re-award XP that is correctly absent, consuming retry slots and creating system noise. The code comment acknowledges this but no mitigation is in place. Fix: only call `safeAwardXP` after the outer transaction has committed (already done in `updateQuestProgress`), and add a note enforcing this contract in callers; flag any call site inside a non-committed transaction as a lint/review warning.

---

### 23. PERF-03 — Daily-platform leaderboard reconciliation full-table scan

**FILES:**
- `apps/web/app/api/cron/daily-platform/route.ts`

**FIX:** The SYS-02 leaderboard reconciliation step in `daily-platform` queries `WHERE u.deleted_at IS NULL` with no LIMIT or batch processing. For a production database with hundreds of thousands of users this produces an enormous result set in memory, risks function timeout, and can OOM the serverless instance. Paginate this query using keyset pagination (e.g., `WHERE id > $lastSeenId ORDER BY id LIMIT 500`), or move it to the dedicated `reconcile-balances` cron which already has proper batching.

---

### 24. IAP-01 — Google Play purchase verification uses unvalidated client-supplied `packageName`

**FILES:**
- `apps/web/app/api/economy/iap/verify/route.ts`

**FIX:** The `packageName` field from the client request body is used directly in the Google Play Developer API URL (`/${packageName}/purchases/products/…`). A malicious client could submit a `purchaseToken` from a completely different Android app (e.g., a different game) paired with that app's `packageName` and claim coins from Zobia. Validate `body.packageName` against a known constant (e.g., `process.env.ANDROID_PACKAGE_NAME` or a hardcoded `'com.zobia.social'`) and reject the request with 400 if it does not match. The same check should be applied in the subscription verification path.

---

### 25. NULLABLE-01 — `is_banned = FALSE` does not handle NULL values

**FILES:**
- `apps/web/app/api/economy/gifts/send/route.ts` (line 238)
- `apps/web/app/api/cron/leaderboards/route.ts` (line 109)
- (Other callers using the same pattern)

**FIX:** `is_banned` is defined in the schema as `boolean("is_banned").default(false)` without `.notNull()`, meaning the column is nullable. PostgreSQL's `column = FALSE` returns `NULL` (unknown) when `column IS NULL`, so users with `is_banned = NULL` are incorrectly excluded from queries that expect them to be non-banned. Replace every `is_banned = FALSE` / `is_banned = false` predicate with `COALESCE(is_banned, false) = false` or `is_banned IS NOT TRUE`. Alternatively, add `.notNull()` to the column definition and backfill NULLs to `false`.

---

### 26. PERF-04 — Comeback bonus expiry sequential per-user transactions

**FILES:**
- `apps/web/app/api/cron/daily-users/route.ts`

**FIX:** The comeback bonus expiry loop (lines 124–143) runs one `db.transaction` per expired user, sequentially. For a large number of expired users this quickly exceeds the 10 s `maxDuration`. Batch the debit into a single SQL CTE that debits all expired bonuses in one query using `unnest()` arrays, or limit the batch to at most 100 users per CRON invocation and rely on the next run to continue.

---

### 27. OPS-01 — No alert raised for large balance discrepancies in `reconcile-balances`

**FILES:**
- `apps/web/app/api/cron/reconcile-balances/route.ts`

**FIX:** Discrepancies above `AUTO_CORRECT_THRESHOLD` (50) are recorded in `audit_discrepancies` but no `system_alerts` row is inserted and no notification is sent to operators. Large discrepancies — which may signal ledger corruption or a bug in XP/coin award logic — can go unnoticed indefinitely. Add an `INSERT INTO system_alerts (type, severity, …)` for every discrepancy above the auto-correct threshold, or send an alerting webhook, so operators are actively notified of anomalies requiring manual review.

---

### 28. HDRDUP-01 — Duplicate `Permissions-Policy` headers with different values

**FILES:**
- `apps/web/next.config.js`
- `apps/web/middleware.ts`

**FIX:** `next.config.js` statically adds `Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()`, while `middleware.ts` sets `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` on every response. Both headers are sent together, resulting in two `Permissions-Policy` headers with different values. Browsers apply the intersection (most restrictive), but the effective policy is hard to reason about and maintain since changes must be made in two places. Remove the `Permissions-Policy` entry from `next.config.js` and manage it exclusively in `middleware.ts` (which already runs on every request and handles production-only HSTS correctly).

---

### 29. PERF-05 — Nemesis refresh N+1 sequential loop for 1 000+ users

**FILES:**
- `apps/web/lib/nemesis/nemesisEngine.ts`

**FIX:** `refreshNemesisAssignments` loops over all users with active nemesis assignments and calls `assignNemesis` for each, where `assignNemesis` itself performs 3–5 separate DB queries (user lookup, friend lookup, current nemesis lookup, candidate query, transaction). For 1 000 unassigned users this is at minimum 5 000 synchronous DB round-trips with no concurrency limit. Refactor using concurrent batches (similar to the `withConcurrency` helper in `daily-notify`), or rewrite as a set-based operation that selects candidates in bulk and assigns them via a single CTE.

---

### 30. PERF-06 — OFFSET-based pagination in `reconcile-balances` degrades at scale

**FILES:**
- `apps/web/app/api/cron/reconcile-balances/route.ts`

**FIX:** The reconciliation loop pages users via `ORDER BY id LIMIT 500 OFFSET $N`. PostgreSQL must scan and skip all rows below the offset on every page, so the query cost grows linearly with each iteration — page 200 is 200× slower than page 1. For a table with 100 K users, the total scan work is O(N²). Switch to keyset pagination: keep track of the last processed `id` and use `WHERE id > $lastId ORDER BY id LIMIT 500` on each iteration to maintain O(1) per page.

---

### 31. OPS-02 — `geoAnomaly.ts` floods `system_alerts` with info-severity entries

**FILES:**
- `apps/web/lib/security/geoAnomaly.ts`

**FIX:** `recordAndCheckAnomaly` inserts a `system_alerts` row for every single anomaly event, even the very first occurrence (logged as `'info'` severity). Users with VPNs, dynamic IPs, or who travel generate many anomaly events per session, each creating an alert row. Only alert when the threshold is actually crossed: gate the INSERT on `count >= ANOMALY_THRESHOLD` and log sub-threshold events to application logs instead of the alerts table.

---

### 32. DATA-01 — `user_quest_progress` table grows without bounds

**FILES:**
- `apps/web/lib/quests/questEngine.ts`

**FIX:** `resetDailyQuests` marks old `user_quest_progress` rows as `expired_at = NOW()` but never deletes them. `user_quest_decks` rows older than 30 days are deleted, but there is no matching DELETE for `user_quest_progress`. Over time this table accumulates every quest attempt from every user in history. Add a `DELETE FROM user_quest_progress WHERE quest_date < CURRENT_DATE - INTERVAL '90 days'` (or similar retention period) to the reset step, consistent with the 30-day `user_quest_decks` cleanup that already exists.

---

### 33. SEC-01 — Timing-unsafe CRON secret comparison in CSRF middleware

**FILES:**
- `apps/web/middleware.ts` (`isCsrfSafe` function)
- `apps/web/lib/cron/auth.ts` (correct `timingSafeEqual` reference)

**FIX:** The CSRF bypass for cron paths in `middleware.ts` compares the Bearer token with `===`: `authHeader === \`Bearer ${process.env.CRON_SECRET}\``. JavaScript string equality is not constant-time and leaks information about where the strings differ via measurable timing differences. An attacker who can time requests to any `/api/cron/*` endpoint could recover the `CRON_SECRET` byte-by-byte. Replace the comparison with `timingSafeEqual` from the `crypto` module, consistent with `validateCronSecret` in `@/lib/cron/auth.ts`.

---

### 34. NOTIF-02 — Re-engagement notification mark-as-sent can silently fail, causing duplicates

**FILES:**
- `apps/web/app/api/cron/daily-notify/route.ts`

**FIX:** In step 1, push and email notifications are dispatched fire-and-forget (`.catch(() => {})`). After the loop, a single batch `UPDATE … SET push_email_notified = true` is run with its error swallowed by `.catch(() => {})`. If this UPDATE fails (DB transient error), all users who received notifications remain with `push_email_notified = false` and will be re-notified on the next cron run. Remove the `.catch(() => {})` on the marking UPDATE (let it surface in the `errors` array), and consider tracking which individual notifications were dispatched successfully so only confirmed-sent users are marked, rather than all users in the `notifiedIds` list.

---

### 35. PERF-07 — Comeback coin credit fires all transactions concurrently without limit

**FILES:**
- `apps/web/app/api/cron/daily-notify/route.ts`

**FIX:** The loop that credits comeback coins to 90-day inactive users (lines 125–129) fires every `db.transaction` without `await` and without a concurrency limit. For a large batch of users, this launches every transaction simultaneously, exhausting the DB connection pool in one burst. Wrap this in the `withConcurrency` helper already defined at the top of the same file (used with `CONCURRENCY = 5` for Telegram), or add `await` and a `LIMIT` to process at most N users per run.

---

### 36. SCHEMA-06 — `notifications` table dual-format: legacy `payload` and modern `title/body/metadata`

**FILES:**
- `apps/web/lib/db/schema.ts`
- `apps/web/app/api/cron/guild-wars/route.ts` (writes `payload` only)
- All other notification writers (write `title`/`body`/`metadata`)

**FIX:** The `notifications` table has both a legacy `payload` jsonb column (used by older code) and the newer `title`, `body`, `metadata` columns (used by all modern writers). There is no migration plan or documented deprecation of `payload`. Clients that read `body` display blank for legacy-format notifications. Pick the canonical format, write a migration that back-fills `title`/`body`/`metadata` from existing `payload` rows, then remove `payload` from the INSERT path. Update all writers (including `guild-wars/route.ts` — see NOTIF-01) to use the canonical format.

---

### 37. AUDIT-01 — Balance auto-correction can silently reduce valid user balances

**FILES:**
- `apps/web/app/api/cron/reconcile-balances/route.ts`

**FIX:** The reconciliation auto-corrects `users.xp_total` and `coin_balance` to match the ledger sum for discrepancies ≤ 50, without verifying which side is wrong. If the discrepancy exists because a ledger entry is missing (the balance column is correct but the ledger is incomplete due to a bug), the correction silently reduces the user's balance to the lower incorrect ledger value. Users lose valid XP or coins with no notification. Before auto-correcting, insert a compensating `xp_ledger`/`coin_ledger` entry explaining the correction (source = `'reconciliation_correction'`) so the ledger remains the append-only source of truth, and flag large discrepancies (even those ≤50) as requiring review rather than silent correction.

---

### 38. QUEST-01 — Daily quest deck shuffle excludes the date from the seed, producing the same deck every day

**FILES:**
- `apps/web/lib/quests/questEngine.ts`

**FIX:** The quest template shuffle order is `MD5(CONCAT($3::text, id::text))` where `$3` is `userId`. The current date (`today`) is not part of the seed, so the shuffle order is identical every day for the same user. With a stable template set, every user sees the same 3–6 quests in the same order daily. Change the shuffle expression to `MD5(CONCAT($3::text, $1::text, id::text))` (where `$1` is `today`) so the deck varies each day.

---

### 39. PAY-02 — `creator_earnings` INSERT in DodoPay `room_subscription` handler not idempotent

**FILES:**
- `apps/web/lib/payments/dodoWebhookHandler.ts`

**FIX:** The DodoPay `room_subscription` event handler inserts a `creator_earnings` row without `ON CONFLICT DO NOTHING`. DodoPay (and all payment providers) guarantee at-least-once webhook delivery. On a retry, a second `creator_earnings` row is created for the same subscription payment, doubling the creator's credited earnings. Add `ON CONFLICT (reference_id) DO NOTHING` to the INSERT (using the payment `reference_id` as the conflict target) to make the handler idempotent.

---

### 40. SCHEMA-07 — `creator_earnings` unique index on `reference_id` alone, not `(creator_id, reference_id)`

**FILES:**
- `apps/web/lib/db/schema.ts`

**FIX:** The `creator_earnings` table has a unique index on `reference_id` alone. If two different creators both earn a commission on the same payment reference (e.g., a room subscription referral that credits both the room creator and a platform referral), the second INSERT fails silently with `ON CONFLICT DO NOTHING`, and one creator's legitimate earnings row is dropped. Change the unique index to `UNIQUE (creator_id, reference_id)` so the uniqueness constraint is per-creator, allowing different creators to have the same `reference_id` without conflict.

---

## Code Quality & Security Rating

### Before Fixes

| Category | Score | Notes |
|---|---|---|
| **Security** | 7.2 / 10 | CSP nonce, CSRF Origin check, JWT rotation, `timingSafeEqual` for most secrets — but CSRF bypass for cron uses unsafe `===`, IAP `packageName` is unvalidated, ban cache allows 30 s exposure window. |
| **Correctness** | 6.0 / 10 | Good ledger idempotency patterns, but leaderboard HoF logic is wrong, season badge excludes top 10, bigint overflow on XP, quest shuffle doesn't rotate daily — all silent functional failures. |
| **Performance** | 6.5 / 10 | Many good set-based bulk operations, but several N+1 loops remain, OFFSET pagination in reconcile, and three cron steps risk timeout on large datasets. |
| **Maintainability** | 6.8 / 10 | Duplicate CRON auth validators in 4+ files, dual guild-tier-demotion columns, dual notifications format, redundant streak columns — each a future maintenance trap. |
| **Data Integrity** | 7.0 / 10 | Append-only ledgers are strong, but `creator_earnings` unique index design can silently drop rows, and auto-correction can silently remove valid balances without leaving a ledger audit trail. |

**Overall Before: 6.7 / 10**

### After All Recommended Fixes

| Category | Score | Notes |
|---|---|---|
| **Security** | 9.2 / 10 | Timing-safe CRON secret in CSRF path, validated IAP package name, reduced ban-cache window. |
| **Correctness** | 9.0 / 10 | HoF injection fixed, badge 1–10 included, bigint XP arrays, daily quest variety restored. |
| **Performance** | 8.5 / 10 | N+1 loops replaced with set-based ops, keyset pagination, batched concurrent notifications. |
| **Maintainability** | 9.0 / 10 | Single CRON auth source, single guild tier column, canonical notifications format, single streak column. |
| **Data Integrity** | 9.0 / 10 | Ledger-traced corrections, idempotent webhook handlers, correct unique index on `creator_earnings`. |

**Overall After: 8.9 / 10**

---

*Report generated: 2026-06-21 06:28 AM UTC*  
*Forensic analysis by Claude Code — three-pass review of all web, PWA, and Expo Android source files.*
