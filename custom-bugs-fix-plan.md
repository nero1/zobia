# Zobia Social — Bug Fix Plan

**Date:** 2026-06-24  
**Time:** 09:24 PM  
**Branch:** `claude/codebase-bug-analysis-9xb73t`  
**Reference Report:** `custom-bugs-report.md`

> **IMPORTANT:** Do NOT begin any fix until the report has been reviewed and this plan approved.
> Fixes are ordered by priority (Critical → High → Medium → Low). Within each tier they are ordered by risk/impact.

---

## Fix Index (One-Line Summary)

1. BUG-001 [CRITICAL]: Wrap `retryFailedCommissions` in `globalDb.transaction()` to hold FOR UPDATE lock during processing
2. BUG-002 [HIGH]: Align antispam digit-detection threshold to match the strip threshold (or vice versa), extract shared constant
3. BUG-003 [HIGH]: Migrate `failed_commissions.amount_kobo` from `INTEGER` to `BIGINT`
4. BUG-004 [HIGH]: Migrate `gifts.coin_value` and `gifts.coin_cost` from `INTEGER` to `BIGINT`
5. BUG-005 [HIGH]: Add Redis pub/sub ban-invalidation to evict session L1 cache on ban/suspend
6. BUG-006 [HIGH]: Guard `generateDailyDeck` with a distributed lock (Redis or DB advisory lock) per user per day
7. BUG-007 [HIGH]: Standardise XP booster multiplier to integer basis points in schema + migration
8. BUG-008 [HIGH]: Add `t.me` and `telegram.org` to CSP `img-src` in `middleware.ts`
9. BUG-009 [MEDIUM]: Re-query `user_quest_decks` after INSERT and return stable DB-ordered result
10. BUG-010 [MEDIUM]: Add push ticket purge to daily CRON + add partial index on `processed_at IS NULL`
11. BUG-011 [MEDIUM]: Randomise war opponent selection from the top-N candidate pool
12. BUG-012 [MEDIUM]: Merge busy-guild exclusion and candidate selection into one query + add advisory lock
13. BUG-013 [MEDIUM]: Reduce or remove `RL_SKIP_THRESHOLD` for auth/payment endpoints
14. BUG-014 [MEDIUM]: Remove dead `about:blank` href-patch code from `htmlSanitizer.ts`
15. BUG-015 [MEDIUM]: Pass `projectId` to `Notifications.getExpoPushTokenAsync()`
16. BUG-016 [MEDIUM]: Fix `handleDeepLink` useEffect dependency array in `login.tsx`
17. BUG-017 [MEDIUM]: Pass `lockTx` (not `globalDb`) to leaderboard snapshots in `retryFailedXPAwards`
18. BUG-018 [MEDIUM]: Replace `fetch` with `safeFetch` in `captcha.ts`, add CAPTCHA hosts to allowlist
19. BUG-019 [MEDIUM]: Add migration for functional unique index on `metadata->>'season_ceremony_id'`
20. BUG-020 [MEDIUM]: Add `canonicalDmPair()` helper and call it at every DM conversation entry point
21. BUG-021 [MEDIUM]: Add FK `.references()` + `ON DELETE SET NULL` to `moderationReports.reportedMessageId`
22. BUG-022 [MEDIUM]: Add positive-increment guard to `updateQuestProgress` + DB check constraint
23. BUG-023 [MEDIUM]: Call `resetSendingMessages` at start of each reconnect sync, not only at app startup
24. BUG-024 [MEDIUM]: Move Telegram bot name to EAS config `extra.telegramBotName`
25. BUG-025 [MEDIUM]: Apply per-user rate limit check inside `sendPushNotificationBatch`
26. BUG-026 [MEDIUM]: Audit all `safeAwardXP` call sites with `dbClient`; ensure DLQ or explicit catch
27. BUG-027 [LOW]: Replace `xp_ledger` active-day source with a real `daily_logins` / session table
28. BUG-028 [LOW]: One-time cleanup migration for dangling `moderation_reports.reported_message_id` (covered by BUG-021 fix)
29. BUG-029 [LOW]: Use webhook payload timestamp (not `new Date()`) for Paystack subscription dedup key
30. BUG-030 [LOW]: Tighten `webRedirect` regex to disallow query strings / fragments
31. BUG-031 [LOW]: Use `BigInt` or `Decimal.js` in `computeWagerPayout`

---

## Detailed Fix Plans

---

### Fix 1 — BUG-001: `retryFailedCommissions` FOR UPDATE Outside Transaction [CRITICAL]

**Files to change:** `apps/web/lib/referrals/commissions.ts`

**Steps:**
1. Locate the `retryFailedCommissions` function.
2. Wrap the entire `SELECT FOR UPDATE SKIP LOCKED` query and all subsequent processing inside `globalDb.transaction(async (tx) => { ... })`.
3. Replace every `globalDb.query(...)` call inside the function body with `tx.query(...)` so all reads, award calls, and `resolved_at` updates share the same connection and transaction.
4. Ensure the `creditCoins` call (or equivalent commission credit) is also passed `tx` as its database client.
5. If `creditCoins` does not accept an external client, refactor it to accept an optional `DatabaseAdapter | TransactionClient` parameter consistent with the pattern in `safeAwardXP`.
6. Test: run two concurrent CRON invocations in a staging environment and confirm no commission is credited twice.

**Effort:** Medium (1–2 hours). No schema change needed.

---

### Fix 2 — BUG-002: Antispam Digit-Threshold Mismatch [HIGH]

**Files to change:** `apps/web/lib/messaging/antispam.ts`

**Steps:**
1. Add `const MIN_PHONE_DIGITS = 7;` as a module-level constant.
2. Update `containsContactInfo`'s digit-sequence regex to use `MIN_PHONE_DIGITS` as the quantifier.
3. Update `stripContactInfo`'s digit-sequence regex to also use `MIN_PHONE_DIGITS`.
4. Run the existing antispam unit tests; add test cases for 7-digit, 9-digit, and 10-digit sequences to confirm both functions behave identically.

**Effort:** Low (30 minutes). No schema change needed.

---

### Fix 3 — BUG-003: `failedCommissions.amountKobo` Integer Overflow [HIGH]

**Files to change:** `apps/web/lib/db/schema.ts`, new migration file

**Steps:**
1. In `schema.ts`, change the `amountKobo` column in the `failedCommissions` table from `integer("amount_kobo")` to `bigint("amount_kobo", { mode: "number" })`.
2. Create a new Drizzle migration (or raw SQL migration) containing: `ALTER TABLE failed_commissions ALTER COLUMN amount_kobo TYPE BIGINT;`
3. Update any TypeScript types or Zod schemas that reference `amountKobo` as `number` — `bigint({ mode: "number" })` returns a JS `number`, so runtime types stay the same; only DB behaviour changes.
4. Deploy migration before deploying code change.

**Effort:** Low (30 minutes). Requires a migration.

---

### Fix 4 — BUG-004: `gifts` Coin Columns Integer vs Bigint [HIGH]

**Files to change:** `apps/web/lib/db/schema.ts`, new migration file

**Steps:**
1. In `schema.ts`, change `coinValue` and `coinCost` in the `gifts` table from `integer(...)` to `bigint("...", { mode: "number" })`.
2. Create a migration: `ALTER TABLE gifts ALTER COLUMN coin_value TYPE BIGINT; ALTER TABLE gifts ALTER COLUMN coin_cost TYPE BIGINT;`
3. Check any admin gift-creation UI or seed scripts for hardcoded coin values that might need to be reviewed for correctness (unlikely to overflow in practice for current values, but good hygiene).
4. Deploy migration before code.

**Effort:** Low (30 minutes). Requires a migration.

---

### Fix 5 — BUG-005: Session L1 Cache Delays Ban Enforcement [HIGH]

**Files to change:** `apps/web/lib/auth/session.ts`, potentially a new `apps/web/lib/auth/sessionInvalidation.ts`, admin ban handler route

**Steps:**
1. Create a Redis pub/sub channel key: `session:invalidate:{userId}`.
2. In the admin ban/suspend handler (wherever `status: 'banned'` is written to the DB), after the DB update, publish a message to `session:invalidate:{userId}` via Redis.
3. In `session.ts`, subscribe to `session:invalidate:*` (or use keyspace notifications) and on receipt, evict the matching key from the L1 in-process cache (`Map.delete(userId)` or equivalent).
4. Since Next.js route handlers are stateless and ioredis subscriptions are long-lived connections, implement the subscriber in a server-side module that initialises once (use a module-level singleton subscriber client distinct from the main Redis client — ioredis requires a separate client for pub/sub).
5. If pub/sub adds too much operational complexity, an acceptable fallback is reducing `SESSION_CACHE_TTL_MS` to `500` (500ms) — this still provides cache benefit while bounding propagation lag to half a second.
6. Document the chosen propagation delay in the session module's comments.

**Effort:** High (3–4 hours for pub/sub; 15 minutes for TTL reduction fallback).

---

### Fix 6 — BUG-006: Quest Deck Generation Race Condition [HIGH]

**Files to change:** `apps/web/lib/quests/questEngine.ts`

**Steps:**
1. At the start of `generateDailyDeck`, acquire a Redis lock using a key like `lock:deck_gen:{userId}:{deckDate}` with a 10-second TTL.
2. Use the existing Redis client and a simple `SET NX PX` pattern (or the `redlock` library if already a dependency).
3. If the lock is not acquired (another call is already generating), wait and re-read from `user_quest_decks` rather than generating a new shuffle.
4. Release the lock after inserting.
5. Alternatively (simpler): add a DB-level unique constraint on `(user_id, deck_date)` in `user_quest_decks` and wrap the full deck insertion in a single `INSERT INTO user_quest_decks ... ON CONFLICT (user_id, deck_date) DO NOTHING` using a CTE that inserts all quests in one statement, ensuring atomicity.
6. Test: send 10 concurrent requests to the deck endpoint for the same user on the same day; verify exactly `deckSize` rows in `user_quest_decks`.

**Effort:** Medium (1–2 hours).

---

### Fix 7 — BUG-007: XP Booster Multiplier Type Mismatch [HIGH]

**Files to change:** `apps/web/lib/db/schema.ts`, `apps/web/lib/xp/engine.ts`, new migration file, any admin/seed scripts that write booster records

**Steps:**
1. Decide the canonical representation: **integer basis points** (150 = 1.5×) aligns with the XP engine's existing approach.
2. In `schema.ts`, change `multiplier: decimal("multiplier", { precision: 4, scale: 2 })` to `multiplier: integer("multiplier")` in `userXpBoosters`.
3. Write a migration: `ALTER TABLE user_xp_boosters ALTER COLUMN multiplier TYPE INTEGER USING ROUND(multiplier * 100)::INTEGER;`
4. Review `engine.ts` to confirm it reads the column and applies it as integer basis points (no code change needed if it already does).
5. Update any admin UI, API route, or seed file that creates booster records to write `150` for a 1.5× multiplier (not `1.50`).
6. Add a DB check constraint: `ALTER TABLE user_xp_boosters ADD CONSTRAINT chk_multiplier_range CHECK (multiplier BETWEEN 100 AND 500);` (or whatever the valid range is).

**Effort:** Medium (1–2 hours). Requires migration + admin UI audit.

---

### Fix 8 — BUG-008: CSP Missing Telegram Image Domains [HIGH]

**Files to change:** `apps/web/middleware.ts`

**Steps:**
1. In `buildCsp(nonce)`, locate the `img-src` directive string.
2. Append `https://t.me` and `https://telegram.org` to `img-src`.
3. Consider extracting a shared `REMOTE_IMAGE_HOSTS` array that is used both in `next.config.js` `remotePatterns` and in the CSP `img-src` directive to prevent future drift.
4. Test: render a page that displays a Telegram avatar image and verify no CSP violation appears in the browser console.

**Effort:** Low (30 minutes). No schema change needed.

---

### Fix 9 — BUG-009: `generateDailyDeck` Non-Deterministic Return Order [MEDIUM]

**Files to change:** `apps/web/lib/quests/questEngine.ts`

**Steps:**
1. After the bulk INSERT (with `ON CONFLICT DO NOTHING`), add a SELECT query: `SELECT template_id FROM user_quest_decks WHERE user_id = $1 AND deck_date = $2 ORDER BY created_at ASC` (or by a `position` column if one is added).
2. Return the result of this query mapped back to template objects rather than the in-memory shuffled array.
3. This ensures every call to `generateDailyDeck` for the same user on the same day returns the same ordered list.

**Effort:** Low (30 minutes).

---

### Fix 10 — BUG-010: Push Tickets Table Grows Unbounded [MEDIUM]

**Files to change:** `apps/web/app/api/cron/` (daily CRON handler), `apps/web/lib/db/schema.ts` or a new migration for the index

**Steps:**
1. In the daily CRON route handler, add a step after push receipt processing that executes: `DELETE FROM push_tickets WHERE processed_at < NOW() - INTERVAL '7 days';`
2. Add a partial index migration: `CREATE INDEX CONCURRENTLY idx_push_tickets_unprocessed ON push_tickets (created_at) WHERE processed_at IS NULL;` — this keeps Stage 2 polling fast regardless of historical table size.
3. Optionally add an archival table `push_tickets_archive` and INSERT before DELETE if historical data is needed for analytics.

**Effort:** Low (1 hour).

---

### Fix 11 — BUG-011: War Matchmaking Always Picks Closest XP Match [MEDIUM]

**Files to change:** `apps/web/lib/guilds/warEngine.ts`

**Steps:**
1. In `findWarOpponent`, after receiving the up-to-5 candidate rows, select a random index: `const idx = Math.floor(Math.random() * rows.length);` and return `rows[idx].id`.
2. If a weighted random selection (favouring closer XP) is desired, compute inverse-distance weights and use a weighted random draw.
3. Test: run 10 consecutive matchmaking calls for the same guild and verify varied opponents are returned.

**Effort:** Low (15 minutes).

---

### Fix 12 — BUG-012: War Matchmaking TOCTOU Window [MEDIUM]

**Files to change:** `apps/web/lib/guilds/warEngine.ts`

**Steps:**
1. Merge the busy-exclusion and candidate-selection into a single query using a `NOT IN (SELECT guild_id FROM active_guild_wars UNION SELECT opponent_guild_id FROM active_guild_wars)` subquery.
2. Before inserting the new war row, use `pg_try_advisory_xact_lock(hashtext($opponentGuildId))` inside a transaction to prevent two concurrent matchmakers from both picking and starting a war with the same opponent.
3. If the advisory lock is not acquired, treat it as "opponent unavailable" and return null.
4. Test: concurrently invoke matchmaking for two guilds targeting the same opponent and verify only one war is created.

**Effort:** Medium (1–2 hours).

---

### Fix 13 — BUG-013: Rate Limiter L1 Bypass Percentage Too High [MEDIUM]

**Files to change:** `apps/web/lib/security/rateLimit.ts`, call sites for auth/payment endpoints

**Steps:**
1. Add a `skipThreshold` parameter to the rate limiter function (default stays `RL_SKIP_THRESHOLD = 0.25` for read endpoints).
2. For security-sensitive endpoints (login, OTP, password reset, payment initiation), call the rate limiter with `skipThreshold: 0` — effectively disabling L1 bypass and always going to Redis.
3. Alternatively, add an `alwaysCheck: boolean` flag that forces the Redis path when `true`.
4. Document which endpoints use strict (no-bypass) rate limiting.

**Effort:** Medium (1–2 hours).

---

### Fix 14 — BUG-014: HTML Sanitizer Dead `about:blank` Patch [MEDIUM]

**Files to change:** `apps/web/lib/security/htmlSanitizer.ts`

**Steps:**
1. Locate the code block that rewrites href values to `about:blank`.
2. Delete the rewrite code — `sanitize-html` with its current `allowedSchemes` already strips non-allowlisted hrefs entirely.
3. Run existing sanitiser tests to confirm output is unchanged.
4. Add a test case explicitly verifying that `javascript:`, `data:`, and arbitrary protocol hrefs are stripped (not rewritten).

**Effort:** Low (15 minutes).

---

### Fix 15 — BUG-015: Expo Push Token Missing `projectId` [MEDIUM]

**Files to change:** `apps/expo/app/_layout.tsx`, `apps/expo/app.config.js` (or `app.json`)

**Steps:**
1. In `app.config.js`, ensure `extra.eas.projectId` is set to the EAS project ID (from `eas.json` or the EAS dashboard).
2. In `_layout.tsx`, update the call to: `Notifications.getExpoPushTokenAsync({ projectId: Constants.expoConfig?.extra?.eas?.projectId })`.
3. Add a runtime guard: if `projectId` is undefined (misconfigured env), log a warning and skip push registration rather than sending potentially invalid tokens to the server.
4. Test on a physical Android device (not simulator) and confirm the returned token format is `ExponentPushToken[...]`.

**Effort:** Low (30 minutes).

---

### Fix 16 — BUG-016: Deep Link Handler Stale Closure [MEDIUM]

**Files to change:** `apps/expo/app/auth/login.tsx`

**Steps:**
1. Remove the `// eslint-disable-line react-hooks/exhaustive-deps` comment from the `useEffect` that registers `handleDeepLink`.
2. Add `signIn` (and any other captured variables) to the dependency array.
3. Ensure the event listener is torn down and re-registered in the cleanup function returned by `useEffect` whenever dependencies change: `return () => subscription.remove();`.
4. Test: trigger a deep link while in the middle of a re-render cycle and verify `signIn` is called with the current auth context.

**Effort:** Low (30 minutes).

---

### Fix 17 — BUG-017: DLQ Retry Leaderboard Snapshot Outside Transaction [MEDIUM]

**Files to change:** `apps/web/lib/xp/safeAwardXP.ts`

**Steps:**
1. In `retryFailedXPAwards`, locate all calls to `upsertLeaderboardSnapshot(...)` inside the `lockTx` transaction callback.
2. Replace every `globalDb` argument with `lockTx` in those calls.
3. Verify `upsertLeaderboardSnapshot` accepts a `DatabaseAdapter | TransactionClient` parameter (it should, given the pattern in the rest of the file).
4. Test: cause a transaction rollback after a successful XP award in the DLQ retry and verify the leaderboard snapshot is also rolled back.

**Effort:** Low (15 minutes).

---

### Fix 18 — BUG-018: CAPTCHA Uses Plain `fetch` [MEDIUM]

**Files to change:** `apps/web/lib/security/captcha.ts`, `apps/web/lib/security/ssrf.ts`

**Steps:**
1. In `ssrf.ts`, add reCAPTCHA and Turnstile verification hostnames to `HOSTNAME_ALLOWLIST`: `'www.google.com'` (reCAPTCHA) and `'challenges.cloudflare.com'` (Turnstile).
2. In `captcha.ts`, import `safeFetch` from `lib/security/ssrf.ts`.
3. Replace the `fetch(verifyUrl, ...)` call with `safeFetch(verifyUrl, ...)`.
4. Test CAPTCHA verification in staging to ensure the allowed-host path works correctly.

**Effort:** Low (30 minutes).

---

### Fix 19 — BUG-019: Season Ceremony Room Functional Index Missing [MEDIUM]

**Files to change:** New migration file

**Steps:**
1. Create a new migration with: `CREATE UNIQUE INDEX CONCURRENTLY idx_rooms_season_ceremony_id ON rooms ((metadata->>'season_ceremony_id')) WHERE metadata->>'season_ceremony_id' IS NOT NULL;`
2. Deploy the migration BEFORE any code that calls `createSeasonCeremonyRoom` (the index must exist for `ON CONFLICT` to work).
3. Test: call `createSeasonCeremonyRoom` twice for the same season and verify the second call is a no-op (returns the existing room) rather than erroring.

**Effort:** Low (30 minutes). Migration only, no code change needed.

---

### Fix 20 — BUG-020: `dmConversations` UUID Sort Unenforced at App Layer [MEDIUM]

**Files to change:** New utility file `apps/web/lib/messaging/dmHelpers.ts` (or inline), all DM conversation call sites

**Steps:**
1. Create a utility: `export function canonicalDmPair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a]; }`
2. Search for all usages of `dm_conversations` inserts and lookups.
3. Wrap each with `canonicalDmPair` before constructing the query.
4. Consider adding a TypeScript branded type `type SortedUserPair = readonly [string, string] & { __brand: 'sorted' }` and a constructor that asserts the sort, to make incorrect usage a compile error.
5. Test: create a DM conversation with user IDs in both orderings and verify the same conversation row is returned in both cases.

**Effort:** Medium (1–2 hours) — mostly search-and-replace across call sites.

---

### Fix 21 — BUG-021: `moderationReports.reportedMessageId` Missing FK [MEDIUM]

**Files to change:** `apps/web/lib/db/schema.ts`, new migration file

**Steps:**
1. In `schema.ts`, add `.references(() => roomMessages.id, { onDelete: "set null" })` to the `reportedMessageId` column in `moderationReports`.
2. Create a migration:
   - First, null out dangling references: `UPDATE moderation_reports SET reported_message_id = NULL WHERE reported_message_id IS NOT NULL AND reported_message_id NOT IN (SELECT id FROM room_messages);`
   - Then add the FK: `ALTER TABLE moderation_reports ADD CONSTRAINT fk_modreports_message FOREIGN KEY (reported_message_id) REFERENCES room_messages(id) ON DELETE SET NULL;`
3. Update admin moderation UI to display "Message deleted" when `reported_message_id IS NULL`.
4. Deploy migration in a single transaction (UPDATE then ALTER) to avoid a window where the FK fails due to existing orphans.

**Effort:** Medium (1–2 hours). Requires migration + admin UI update.

---

### Fix 22 — BUG-022: `updateQuestProgress` Allows Negative Increment [MEDIUM]

**Files to change:** `apps/web/lib/quests/questEngine.ts`, new migration for DB constraint

**Steps:**
1. At the top of `updateQuestProgress`, add: `if (typeof increment !== 'number' || increment <= 0) throw new Error('[updateQuestProgress] increment must be a positive number');`
2. Add a migration to add a DB-level safeguard: `ALTER TABLE user_quest_decks ADD CONSTRAINT chk_progress_nonneg CHECK (progress_count >= 0);`
3. Review all call sites to confirm they pass positive integer values.

**Effort:** Low (30 minutes).

---

### Fix 23 — BUG-023: Sync Queue 'sending' State Leak on Crash [MEDIUM]

**Files to change:** `apps/expo/lib/offline/syncQueue.ts`

**Steps:**
1. In the reconnect sync handler (the function that runs when the device comes back online), call `resetSendingMessages()` as the very first step — before fetching pending messages or marking any as `'sending'`.
2. Verify that `resetSendingMessages()` is idempotent and safe to call multiple times per session.
3. Test: simulate an app kill mid-sync and then reconnect; verify previously stuck `'sending'` messages are retried on the next sync.

**Effort:** Low (15 minutes).

---

### Fix 24 — BUG-024: Telegram Bot Name Hardcoded [MEDIUM]

**Files to change:** `apps/expo/app/auth/login.tsx`, `apps/expo/app.config.js`

**Steps:**
1. In `app.config.js`, add `extra.telegramBotName: process.env.TELEGRAM_BOT_NAME || 'Zobia_bot_bot'`.
2. In `login.tsx`, replace the hardcoded string with `Constants.expoConfig?.extra?.telegramBotName ?? 'Zobia_bot_bot'`.
3. Set `TELEGRAM_BOT_NAME` in `.env.production`, `.env.staging`, and `.env.development` with the appropriate bot for each environment.
4. Add `TELEGRAM_BOT_NAME` to EAS build environment variable configuration.

**Effort:** Low (30 minutes).

---

### Fix 25 — BUG-025: Batch Push Bypasses Per-User Rate Limit [MEDIUM]

**Files to change:** `apps/web/lib/notifications/push.ts`

**Steps:**
1. In `sendPushNotificationBatch`, before building the batch payload, group the notification records by `userId`.
2. For each unique `userId`, call the same rate-limit check used in `sendPushNotification` (the `atomicIncrWithTtl` Redis call with a 1-minute window and cap of 10).
3. Collect token lists only for users who have not exceeded the limit; skip (and optionally log) tokens for users over the limit.
4. Send the filtered batch to the Expo API.
5. Test: send a batch of 15 notifications to the same user within 1 minute and verify only 10 are delivered.

**Effort:** Medium (1 hour).

---

### Fix 26 — BUG-026: XP Loss When `safeAwardXP` Called With Caller Transaction [MEDIUM]

**Files to change:** `apps/web/lib/xp/safeAwardXP.ts`, all call sites that pass `dbClient`

**Steps:**
1. Search for all `safeAwardXP(...)` calls that pass a non-null `dbClient`.
2. For each call site, audit the surrounding transaction: if the XP award must be atomic with the outer transaction (e.g., a gift redemption), ensure the outer `catch` block handles the re-thrown error and either writes a DLQ record or surfaces the failure to the caller.
3. For call sites where the XP award is a "nice to have" fire-and-forget bonus (not atomic with the outer transaction), restructure to call `safeAwardXP` AFTER committing the outer transaction, without passing `dbClient`.
4. Add a `// IMPORTANT: callers must handle the thrown error or XP may be permanently lost` JSDoc on the re-throw path.
5. Consider adding a separate `safeAwardXPFireAndForget(...)` helper that explicitly does NOT accept a `dbClient` and always writes to DLQ on failure — to make the intent unmistakeable at call sites.

**Effort:** Medium (1–2 hours) — mostly call site audit.

---

### Fix 27 — BUG-027: Creator Fund Active Days Inflated by Batch XP [LOW]

**Files to change:** `apps/web/lib/creator/fund.ts`, potentially new migration for a `daily_logins` table

**Steps:**
1. Create a `user_daily_logins` table: `(user_id UUID, login_date DATE, created_at TIMESTAMPTZ)` with a unique constraint on `(user_id, login_date)`.
2. On each successful authentication (JWT issue or refresh), INSERT into `user_daily_logins` with `ON CONFLICT DO NOTHING`.
3. In `fund.ts`, replace the `COUNT(DISTINCT DATE(xp_ledger.created_at))` subquery with `COUNT(*) FROM user_daily_logins WHERE user_id = ... AND login_date >= NOW() - INTERVAL '30 days'`.
4. Initially, backfill from `xp_ledger` or `user_sessions` if available to preserve historical data.

**Effort:** High (3–4 hours) — new table + migration + backfill + code change.

---

### Fix 28 — BUG-028: Orphaned `moderation_reports.reported_message_id` [LOW]

**Files to change:** Covered by Fix 21 (BUG-021)

**Steps:**
1. This bug is fully resolved as part of the BUG-021 fix (adding the FK with `ON DELETE SET NULL` and running the cleanup migration).
2. No additional code change needed beyond Fix 21.
3. Verify admin UI gracefully handles `NULL reported_message_id` with a "Message deleted" label.

**Effort:** No additional effort — covered by Fix 21.

---

### Fix 29 — BUG-029: Paystack Subscription Dedup Key Midnight Race [LOW]

**Files to change:** `apps/web/lib/payments/paystackWebhookHandler.ts`

**Steps:**
1. Locate the `subscription.create` handler.
2. Extract the month from `data.created_at` (the Paystack event timestamp, in ISO 8601 format) rather than from `new Date()`.
3. Update the key to: `` `plan:${userId}:${subscriptionCode}:${yearMonth}` `` where `yearMonth` is derived from `data.created_at`.
4. Test: replay a `subscription.create` webhook with a creation timestamp from the previous month; verify the dedup key is stable regardless of when the webhook arrives.

**Effort:** Low (30 minutes).

---

### Fix 30 — BUG-030: `webRedirect` Validation Too Permissive [LOW]

**Files to change:** `apps/web/app/api/auth/google/callback/route.ts`

**Steps:**
1. Replace the current `/^\/[^/]/` regex with a stricter pattern that disallows query strings and fragments: `/^\/[a-zA-Z0-9\/_-]*$/`.
2. If query strings in redirect URLs are intentional (e.g., `/dashboard?tab=profile`), sanitise the query string using `URLSearchParams` to encode all values: parse the path and query, re-encode the query, reconstruct.
3. Add test cases covering: `/?next=<script>`, `/evil`, `//evil.com`, `/valid/path`, `/valid/path?key=value`.
4. Apply the same strictness to any other OAuth callback handlers in the codebase.

**Effort:** Low (30 minutes).

---

### Fix 31 — BUG-031: Wager Payout Integer Precision Risk [LOW]

**Files to change:** `apps/web/lib/games/wager.ts`

**Steps:**
1. Import or confirm `Decimal` from `decimal.js` is available (already used elsewhere in the codebase).
2. Replace: `Math.floor((pot * (100 - rakePct)) / 100)` with `new Decimal(pot).mul(100 - rakePct).divToInt(100).toNumber()`.
3. Alternatively, use BigInt: `Number(BigInt(pot) * BigInt(100 - rakePct) / 100n)`.
4. Add a unit test with `pot = Number.MAX_SAFE_INTEGER` and `rakePct = 5` to confirm the result is correct.
5. Ensure `pot` values stored in the database are `bigint` columns (audit `game_wagers` or equivalent table schema).

**Effort:** Low (15 minutes).

---

## Suggested Fix Order

Execute in this order to maximise risk reduction per unit of effort:

**Phase 1 — Critical & High (do first, deploy together):**
Fix 1 (BUG-001), Fix 8 (BUG-008), Fix 3 (BUG-003), Fix 4 (BUG-004), Fix 7 (BUG-007), Fix 2 (BUG-002), Fix 5 (BUG-005), Fix 6 (BUG-006)

**Phase 2 — Medium (next sprint):**
Fix 17 (BUG-017), Fix 13 (BUG-013), Fix 25 (BUG-025), Fix 21 (BUG-021 + BUG-028), Fix 19 (BUG-019), Fix 10 (BUG-010), Fix 12 (BUG-012), Fix 11 (BUG-011), Fix 15 (BUG-015), Fix 16 (BUG-016), Fix 9 (BUG-009), Fix 18 (BUG-018), Fix 20 (BUG-020), Fix 22 (BUG-022), Fix 23 (BUG-023), Fix 24 (BUG-024), Fix 26 (BUG-026), Fix 14 (BUG-014)

**Phase 3 — Low (final polish):**
Fix 27 (BUG-027), Fix 29 (BUG-029), Fix 30 (BUG-030), Fix 31 (BUG-031)

---

## Migrations Required

| Bug | Migration |
|-----|-----------|
| BUG-003 | `ALTER TABLE failed_commissions ALTER COLUMN amount_kobo TYPE BIGINT;` |
| BUG-004 | `ALTER TABLE gifts ALTER COLUMN coin_value TYPE BIGINT; ALTER COLUMN coin_cost TYPE BIGINT;` |
| BUG-007 | `ALTER TABLE user_xp_boosters ALTER COLUMN multiplier TYPE INTEGER USING ROUND(multiplier * 100)::INTEGER;` |
| BUG-019 | `CREATE UNIQUE INDEX CONCURRENTLY idx_rooms_season_ceremony_id ON rooms ((metadata->>'season_ceremony_id')) WHERE metadata->>'season_ceremony_id' IS NOT NULL;` |
| BUG-021/028 | Null-out orphans + `ALTER TABLE moderation_reports ADD CONSTRAINT fk_modreports_message FOREIGN KEY ...` |
| BUG-022 | `ALTER TABLE user_quest_decks ADD CONSTRAINT chk_progress_nonneg CHECK (progress_count >= 0);` |
| BUG-010 | `CREATE INDEX CONCURRENTLY idx_push_tickets_unprocessed ON push_tickets (created_at) WHERE processed_at IS NULL;` |
| BUG-027 | New `user_daily_logins` table + backfill |

All migrations should be deployed BEFORE the corresponding code changes go live.

---

*Plan generated: 2026-06-24 at 09:24 PM*  
*Analyst: Claude (claude-sonnet-4-6) — Zobia Social Bug Fix Plan*  
*Branch: `claude/codebase-bug-analysis-9xb73t`*
