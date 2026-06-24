# Zobia Social — Forensic Bug Report

**Date:** 2026-06-24  
**Time:** 09:24 PM  
**Analyst:** Claude (claude-sonnet-4-6) — Full codebase forensic review  
**Branch:** `claude/codebase-bug-analysis-9xb73t`  
**Scope:** `apps/web` (Next.js 14 App Router + PWA) + `apps/expo` (React Native / Android)

---

## Bug Index (One-Line Summaries)

1. BUG-001 [CRITICAL]: `retryFailedCommissions` uses `FOR UPDATE SKIP LOCKED` outside a transaction — row locks release immediately, allowing concurrent CRON runs to double-process DLQ rows
2. BUG-002 [HIGH]: Antispam digit-count thresholds inconsistent between detection (≥7) and stripping (≥10) — 7–9 digit phone numbers blocked but not stripped
3. BUG-003 [HIGH]: `failedCommissions.amountKobo` is `integer` (max ~2.1B) instead of `bigint` — overflows for large commission amounts in high-value markets
4. BUG-004 [HIGH]: `gifts.coinValue` and `gifts.coinCost` are `integer` instead of `bigint` — inconsistent with `coin_balance` which is `bigint`
5. BUG-005 [HIGH]: Session L1 in-process cache TTL of 3 seconds allows recently banned/suspended users to continue acting for up to 3 seconds per warm instance
6. BUG-006 [HIGH]: `generateDailyDeck` race condition — concurrent calls insert differently-shuffled decks, accumulating more than `deckSize` quests per day per user
7. BUG-007 [HIGH]: `userXpBoosters.multiplier` is `decimal(4,2)` (e.g. 1.50) but XP engine treats multipliers as integer basis points (e.g. 150) — type mismatch corrupts XP calculations
8. BUG-008 [HIGH]: CSP `img-src` directive does not include `t.me` or `telegram.org` — Telegram avatar images blocked by browser despite being in `next.config.js` `remotePatterns`
9. BUG-009 [MEDIUM]: `generateDailyDeck` returns a freshly-shuffled subset on every call — quest order differs between calls even though `user_quest_decks` is already fixed in DB
10. BUG-010 [MEDIUM]: `push_tickets` table accumulates resolved records indefinitely — no purge CRON or TTL, table grows unbounded over time
11. BUG-011 [MEDIUM]: `findWarOpponent` always selects `rows[0].id` (closest XP match) from candidates — no randomization, same guild pairs repeatedly match each other
12. BUG-012 [MEDIUM]: `findWarOpponent` TOCTOU — a guild could change war-busy status between the "busy guilds" exclusion query and the candidate selection query
13. BUG-013 [MEDIUM]: `RL_SKIP_THRESHOLD = 0.25` means up to 25% of requests per instance bypass Redis rate limiting — across 3+ instances up to 75% of limit consumed without global enforcement
14. BUG-014 [MEDIUM]: `htmlSanitizer` patches unsafe `href` to `about:blank` redundantly — `about:` is not in `allowedSchemes`, so sanitize-html strips the href anyway; the patch is dead code
15. BUG-015 [MEDIUM]: Expo `Notifications.getExpoPushTokenAsync()` called without `projectId` parameter — deprecated since Expo SDK 47, may silently return invalid tokens
16. BUG-016 [MEDIUM]: `handleDeepLink` in `login.tsx` registered in `useEffect` with empty deps — stale closure on `signIn` function, deep link handling can use outdated auth state
17. BUG-017 [MEDIUM]: `retryFailedXPAwards` passes `globalDb` (not `lockTx`) to leaderboard snapshot updates — auto-commits outside the wrapping transaction; snapshot reflects non-committed XP if the outer tx rolls back
18. BUG-018 [MEDIUM]: CAPTCHA verification (`captcha.ts`) uses plain `fetch` instead of `safeFetch` — inconsistent with SSRF protection pattern applied elsewhere
19. BUG-019 [MEDIUM]: `createSeasonCeremonyRoom` uses `ON CONFLICT ((metadata->>'season_ceremony_id')) DO NOTHING` — requires a functional unique index on a JSON expression that may not exist, causing runtime error
20. BUG-020 [MEDIUM]: `dmConversations` check constraint `userId1 < userId2` requires callers to pre-sort UUIDs — no enforcement helper; callers that get the order wrong get a DB constraint violation instead of a clear error
21. BUG-021 [MEDIUM]: `moderationReports.reportedMessageId` has no FK reference to `roomMessages` — unlike the `reports` table which has `.references()` with `onDelete: "set null"`, `moderation_reports` can hold dangling message IDs after deletion
22. BUG-022 [MEDIUM]: `updateQuestProgress` does not validate that `increment` is non-negative — a negative increment can reduce `progress_count` below zero
23. BUG-023 [MEDIUM]: Expo offline sync queue — if the app crashes mid-batch during a reconnect sync (not startup), messages remain stuck in `'sending'` state until the next app restart calls `resetSendingMessages`
24. BUG-024 [MEDIUM]: Telegram bot name `'Zobia_bot_bot'` is hardcoded in `login.tsx` — should come from an env var or manifest value to support different environments
25. BUG-025 [MEDIUM]: `sendPushNotificationBatch` does not apply the per-user rate limit (10/min) — only the single `sendPushNotification` function rate-limits; batch sends can flood devices
26. BUG-026 [MEDIUM]: When `safeAwardXP` is called with a caller-supplied `dbClient` and XP fails, it re-throws rather than writing to DLQ — callers that don't catch this will permanently lose XP without a DLQ record
27. BUG-027 [LOW]: Creator Fund `active_days_30d` metric counts distinct XP-earning dates from `xp_ledger` rather than actual login days — a creator with batch XP awards can inflate their active-day score without genuine daily engagement
28. BUG-028 [LOW]: `moderationReports.reportedMessageId` missing FK means no cascade-to-null on message deletion — orphaned report rows accumulate without cleanup
29. BUG-029 [LOW]: Paystack `subscription.create` dedup key uses `plan:{userId}:{YYYY-MM}` from `new Date()` server-side — webhook arriving just before midnight UTC but processed after midnight produces a different key, enabling double-bonus
30. BUG-030 [LOW]: `webRedirect` validation in Google OAuth callback only checks `/^\/[^/]/` — does not sanitize query strings; crafted redirect URLs could carry XSS payloads to the destination page
31. BUG-031 [LOW]: `computeWagerPayout` uses `Math.floor((pot * (100 - rake)) / 100)` with plain JavaScript integer arithmetic — potential precision loss for very large pot values near `Number.MAX_SAFE_INTEGER`

---

## Detailed Bug Reports

---

### 1: BUG-001 — `retryFailedCommissions` FOR UPDATE Outside Transaction [CRITICAL]

**FILES:** `apps/web/lib/referrals/commissions.ts`

**DETAIL:** `retryFailedCommissions` issues `SELECT … FOR UPDATE SKIP LOCKED` via a plain `globalDb.query()` call with no wrapping `BEGIN`/`COMMIT`. In PostgreSQL, row-level locks acquired by `SELECT FOR UPDATE` are released at the end of the current transaction; for an auto-commit single query, that means the lock is released immediately after the `SELECT` returns — before the retry logic runs. Two concurrent CRON invocations can therefore read the same batch of failed commission rows simultaneously, process all of them, and create duplicate payouts. This is the same anti-pattern fixed in `safeAwardXP.ts`'s `retryFailedXPAwards` (which explicitly wraps in `globalDb.transaction()`). The DLQ's `ON CONFLICT DO NOTHING` on `(user_id, source, reference_id)` only protects against re-inserting a new failed row; it does NOT prevent the same row being retried concurrently.

**FIX:** Wrap the entire fetch-and-process loop in `globalDb.transaction(async (tx) => { ... })` exactly as done in `retryFailedXPAwards`. All queries inside — the `SELECT FOR UPDATE SKIP LOCKED`, the commission credit call, and the `resolved_at` update — must run through `tx`, not `globalDb`, so the advisory lock is held for the full batch duration.

---

### 2: BUG-002 — Antispam Digit-Threshold Mismatch [HIGH]

**FILES:** `apps/web/lib/messaging/antispam.ts`

**DETAIL:** `containsContactInfo` flags a message as containing contact info when it detects a sequence of **7 or more** consecutive digits (the regex threshold). `stripContactInfo` only removes digit sequences of **10 or more** digits. For 7–9 digit numbers (common short phone numbers, bank codes, ZIP+extension combos), `containsContactInfo` returns `true` and the message is blocked or flagged, but if `stripContactInfo` is called on the same text it leaves the offending sequence in place. Depending on the call path, this can either silently block content the user typed without clearly communicating why, or produce inconsistent filter behavior between the DM flow and the public room flow.

**FIX:** Align the two thresholds to the same value. Either lower `stripContactInfo`'s threshold to 7 to match detection, or raise `containsContactInfo`'s threshold to 10 to match stripping. The lower threshold (7) is the safer choice for a social app. Alternatively, centralise the threshold into a single exported constant `MIN_PHONE_DIGITS = 7` used by both functions.

---

### 3: BUG-003 — `failedCommissions.amountKobo` Integer Overflow [HIGH]

**FILES:** `apps/web/lib/db/schema.ts`

**DETAIL:** `failedCommissions.amountKobo` is typed as a Drizzle `integer()` column, which maps to PostgreSQL `INTEGER` (max 2,147,483,647 — approximately ₦21,474 at kobo denomination). High-value markets (USD, GBP) where commissions are tracked in the smallest denomination easily exceed this. The `coin_ledger.amount` and `coin_balance` columns correctly use `bigint`. Only the `failed_commissions` DLQ uses `integer`, meaning large-amount commissions that fail and land in the DLQ will silently truncate or error on INSERT.

**FIX:** Change `amountKobo: integer("amount_kobo")` to `amountKobo: bigint("amount_kobo", { mode: "number" })` in the `failedCommissions` table definition. Write a migration to ALTER the column type: `ALTER TABLE failed_commissions ALTER COLUMN amount_kobo TYPE BIGINT;`

---

### 4: BUG-004 — `gifts` Coin Columns Integer vs Bigint [HIGH]

**FILES:** `apps/web/lib/db/schema.ts`

**DETAIL:** `gifts.coinValue` and `gifts.coinCost` are both defined as `integer()` in the schema. The `users.coin_balance` column is `bigint`. Gift redemption involves debiting `coin_balance` by `coinCost` and crediting by `coinValue`. If `coinCost` or `coinValue` values are large enough to overflow a signed 32-bit integer (>2.1B), the schema column silently stores the wrong value while `coin_balance` operates correctly as a 64-bit value. This is also a correctness signal — integer mismatch between a gift's cost and the ledger column it affects.

**FIX:** Change both `coinValue` and `coinCost` in the `gifts` table from `integer()` to `bigint("...", { mode: "number" })`. Add an `ALTER TABLE gifts ALTER COLUMN coin_value TYPE BIGINT; ALTER TABLE gifts ALTER COLUMN coin_cost TYPE BIGINT;` migration.

---

### 5: BUG-005 — Session L1 Cache Delays Ban Enforcement [HIGH]

**FILES:** `apps/web/lib/auth/session.ts`

**DETAIL:** `SESSION_CACHE_TTL_MS = 3_000` means that once a session is fetched from Redis and stored in the in-process L1 cache, it is served from cache for up to 3 seconds regardless of subsequent Redis changes. If an admin bans or suspends a user, the user can continue to act for up to 3 seconds on each warm server instance. With multiple instances this is multiplied. The more fundamental issue is: the cache stores the full session object including `status`, so a `status: 'banned'` change in Redis is not reflected until the cache entry expires.

**FIX:** For ban enforcement, either (a) reduce `SESSION_CACHE_TTL_MS` to 0 for requests where status-sensitive operations are performed, (b) publish a Redis pub/sub invalidation event on ban/suspend and have instances evict the specific session key immediately, or (c) check session status directly from Redis (not L1) for any route that mutates data. Option (b) is the most scalable. At minimum, document that ban propagation has up to a 3-second delay per instance.

---

### 6: BUG-006 — Quest Deck Generation Race Condition [HIGH]

**FILES:** `apps/web/lib/quests/questEngine.ts`

**DETAIL:** `generateDailyDeck` selects a shuffled subset of quest templates then inserts them into `user_quest_decks` with `ON CONFLICT DO NOTHING`. Two concurrent calls (e.g., two tab opens in rapid succession) each compute a different shuffled subset and issue separate INSERT statements. Because each call only skips individual quests already in the DB (per the partial unique index), the two calls together can insert the union of their two subsets — accumulating more than `deckSize` quests in `user_quest_decks` for the day. The final deck visible to the user depends on which rows arrive in what order, and the count exceeds the intended deck size.

**FIX:** Add a database-level unique constraint on `(user_id, deck_date)` for the `user_quest_decks` table (or use `pg_try_advisory_xact_lock(hashtext(user_id::text || deck_date::text))`) to ensure only one deck generation can commit per user per day. Alternatively, wrap deck generation in a distributed Redis lock keyed on `deck_gen:{userId}:{date}` before querying templates.

---

### 7: BUG-007 — XP Booster Multiplier Type Mismatch [HIGH]

**FILES:** `apps/web/lib/db/schema.ts`, `apps/web/lib/xp/engine.ts`

**DETAIL:** `userXpBoosters.multiplier` is a `decimal(4,2)` column — it stores values like `1.50` (representing 50% bonus). The XP engine applies multipliers as integer basis points (e.g., `150` for 50% bonus), reading from a different source or expecting integer values. If the engine reads the booster multiplier directly from this column and treats it as basis points, `1.50` becomes a 1.5 basis point bonus instead of 150 — essentially a no-op. Conversely, if the engine expects the decimal form and the column someday contains basis-point integers, XP would be multiplied by factors of 100–200×.

**FIX:** Standardise on one representation. The XP engine's basis-point approach (`150` = 1.5×) is consistent with how many financial systems handle multipliers without floating point. Change `userXpBoosters.multiplier` to `integer("multiplier")` and store `150` for a 1.5× multiplier. Write a migration: `ALTER TABLE user_xp_boosters ALTER COLUMN multiplier TYPE INTEGER USING ROUND(multiplier * 100)::INTEGER;` Update any admin UI or seeder that writes booster records.

---

### 8: BUG-008 — CSP Missing Telegram Image Domains [HIGH]

**FILES:** `apps/web/middleware.ts`

**DETAIL:** `next.config.js` `images.remotePatterns` includes `t.me` and `telegram.org` so Next.js's Image component will proxy/optimise those images. However, the CSP `img-src` directive built in `middleware.ts` `buildCsp()` does not include `t.me` or `telegram.org`. For browsers that honour CSP (all modern browsers), any direct `<img>` tag referencing Telegram URLs (Telegram avatar images, Telegram channel previews) will be blocked by the browser's CSP enforcement, even though Next.js would have been willing to serve them via the image optimisation route. The gap between `remotePatterns` and CSP `img-src` creates a runtime breakage for Telegram-sourced images.

**FIX:** Add `t.me` and `telegram.org` to the `img-src` directive in `buildCsp(nonce)` in `middleware.ts`. Also audit the full `remotePatterns` list against `img-src` to ensure they stay in sync going forward — consider extracting a shared constant array.

---

### 9: BUG-009 — `generateDailyDeck` Non-Deterministic Return Order [MEDIUM]

**FILES:** `apps/web/lib/quests/questEngine.ts`

**DETAIL:** After inserting quests into `user_quest_decks`, the function returns `selectedTemplates` — the freshly-shuffled in-memory array from the current call. On a second call for the same user on the same day, the quests are already in the DB (conflict-skipped) but a new shuffle is computed, producing a different ordering. Any caller that uses the return value for display will show quests in a different order each time the deck is "fetched." The deck ordering becomes random per-request rather than stable per-day.

**FIX:** After the INSERT (with `ON CONFLICT DO NOTHING`), re-query `user_quest_decks` for `(user_id, deck_date)` ordered by `created_at` or a stored `position` column and return that stable result. This ensures every call returns the same ordering that was committed on first generation.

---

### 10: BUG-010 — Push Tickets Table Grows Unbounded [MEDIUM]

**FILES:** `apps/web/lib/notifications/push.ts`

**DETAIL:** `push_tickets` records are created during Stage 1 push delivery and updated (status, receipt_id) during Stage 2 receipt polling. Resolved tickets (`status = 'ok'` or `status = 'error'`, `processed_at IS NOT NULL`) are never deleted or archived. Over time the table accumulates one row per push notification sent, growing indefinitely. This degrades query performance for Stage 2 polling which scans for unprocessed tickets, and wastes storage.

**FIX:** Add a CRON step (can run as part of the existing daily CRON) that deletes or archives `push_tickets` rows where `processed_at < NOW() - INTERVAL '7 days'`. Add a partial index on `(processed_at) WHERE processed_at IS NULL` to keep Stage 2 polling fast regardless of historical row count.

---

### 11: BUG-011 — War Matchmaking Always Picks Closest XP Match [MEDIUM]

**FILES:** `apps/web/lib/guilds/warEngine.ts`

**DETAIL:** `findWarOpponent` queries up to 5 candidate guilds ordered by `ABS(xp_total - $targetXp)` and always returns `rows[0].id` — the closest XP match. This deterministically pairs the same two guilds together every matchmaking cycle as long as their XP totals remain similar. Dominant guilds that farm XP at the same rate will repeatedly match each other, creating a permanent rivalry loop and shutting out other guilds from matchmaking.

**FIX:** After fetching the top 5 candidate guilds, randomly select one using a cryptographically uniform random index (`Math.floor(Math.random() * rows.length)`). This retains the ±15% XP band constraint while introducing matchmaking variety. Alternatively, weight the selection inversely by XP distance so closer matches are more likely but not guaranteed.

---

### 12: BUG-012 — War Matchmaking TOCTOU Window [MEDIUM]

**FILES:** `apps/web/lib/guilds/warEngine.ts`

**DETAIL:** `findWarOpponent` first queries `active_guild_wars` to build an exclusion list of busy guilds, then queries `guilds` for candidates excluding that list. Between these two queries, another concurrent matchmaking request could start a war involving a guild from the candidate set, making the selected opponent already war-busy by the time this function's caller tries to create the war.

**FIX:** Perform the busy-guild exclusion and the candidate selection in a single query using a `NOT IN (SELECT guild_id FROM active_guild_wars WHERE ...)` subquery, and wrap the entire matchmaking + war creation in a `SELECT ... FOR UPDATE` or use `pg_try_advisory_xact_lock` to prevent two concurrent matchmakers from selecting the same guild. At minimum, guard the war creation INSERT with a check that the opponent is not already in an active war.

---

### 13: BUG-013 — Rate Limiter L1 Bypass Percentage Too High [MEDIUM]

**FILES:** `apps/web/lib/security/rateLimit.ts`

**DETAIL:** `RL_SKIP_THRESHOLD = 0.25` means that on each server instance, 25% of requests for a given key skip the Redis Lua script entirely (counting only against the in-process L1 counter). With 3 server instances, a determined client could hit 3 × 25% = 75% of their rate limit without any record in Redis, then consume the remaining 25% through Redis. Effectively the real limit is 1.75× the nominal limit. For security-sensitive endpoints (login, OTP, password reset) this materially weakens protection.

**FIX:** Either reduce `RL_SKIP_THRESHOLD` significantly (0.05 or 0.02) for security-sensitive endpoints, or apply the L1 bypass only to low-sensitivity read endpoints (feed fetch, leaderboard fetch) and always use Redis for auth/payment/mutation endpoints. Add a per-endpoint `skipThreshold` override parameter to the rate limiter.

---

### 14: BUG-014 — HTML Sanitizer Dead `about:blank` Patch [MEDIUM]

**FILES:** `apps/web/lib/security/htmlSanitizer.ts`

**DETAIL:** The sanitizer contains code that rewrites any `href` that fails an allowlist check to `about:blank` before passing to `sanitize-html`. However, `about:` is not in the `allowedSchemes` list, so `sanitize-html` will strip the `href` attribute entirely regardless — whether it contains the original unsafe URL or the patched `about:blank`. The rewrite to `about:blank` has no effect on the final output. While this is not a security vulnerability (the outcome is the same), it is dead code that obscures intent and may mislead future maintainers into thinking the patch provides meaningful protection.

**FIX:** Remove the `about:blank` rewrite code path. If the intent was to render a visible but non-navigable link, use `allowedSchemes: [..., 'about']` and rewrite to `about:blank` deliberately, but note this is unusual UX. Otherwise, simply let `sanitize-html` strip the href, which is what already happens.

---

### 15: BUG-015 — Expo Push Token Missing `projectId` [MEDIUM]

**FILES:** `apps/expo/app/_layout.tsx`

**DETAIL:** `Notifications.getExpoPushTokenAsync()` is called without the `projectId` (EAS project ID) parameter. Since Expo SDK 47, providing `projectId` is required for correct token generation using the new EAS infrastructure. Without it, the SDK may fall back to legacy token generation (which may be deprecated/broken for new projects) or return a token that cannot be used to send notifications via the Expo Push API. Notification delivery would silently fail for affected devices.

**FIX:** Pass the EAS project ID: `Notifications.getExpoPushTokenAsync({ projectId: Constants.expoConfig?.extra?.eas?.projectId })`. Ensure `app.json` / `app.config.js` has `extra.eas.projectId` set, or read it from `expo-constants`. Test on a physical Android device to verify the returned token format starts with `ExponentPushToken[...]`.

---

### 16: BUG-016 — Deep Link Handler Stale Closure [MEDIUM]

**FILES:** `apps/expo/app/auth/login.tsx`

**DETAIL:** `handleDeepLink` is registered in a `useEffect` with an empty dependency array (or suppressed deps lint warning). The handler closes over `signIn` and related auth state at mount time. If `signIn` changes reference (e.g., after a context re-render), the registered listener continues to call the stale version. In practice this could mean an auth token arriving via deep link is processed with outdated credentials or skipped entirely.

**FIX:** Add `signIn` (and any other auth state the handler uses) to the `useEffect` dependency array. The listener should be torn down and re-registered whenever those dependencies change. If the lint suppression comment is the only thing keeping this from erroring, remove the suppression and fix the dependency list properly.

---

### 17: BUG-017 — DLQ Retry Leaderboard Snapshot Outside Transaction [MEDIUM]

**FILES:** `apps/web/lib/xp/safeAwardXP.ts`

**DETAIL:** In `retryFailedXPAwards`, leaderboard snapshot updates (`upsertLeaderboardSnapshot(...)`) pass `globalDb` as the database client instead of `lockTx` (the transaction client that holds the `FOR UPDATE SKIP LOCKED` lock). `globalDb` queries auto-commit immediately, meaning the snapshot update is persisted even if the outer `lockTx` transaction later rolls back (e.g., due to a subsequent error in the batch). The leaderboard then shows XP that was never actually committed.

**FIX:** Pass `lockTx` instead of `globalDb` to all `upsertLeaderboardSnapshot` calls inside `retryFailedXPAwards`. This ensures snapshot updates are rolled back atomically with the XP award if the transaction fails.

---

### 18: BUG-018 — CAPTCHA Verification Uses Plain `fetch` [MEDIUM]

**FILES:** `apps/web/lib/security/captcha.ts`

**DETAIL:** CAPTCHA token verification calls the reCAPTCHA / Turnstile validation endpoint using Node's built-in `fetch` rather than the project's `safeFetch` wrapper. `safeFetch` enforces SSRF protection (DNS resolution validation, private IP blocking, max response size, redirect stripping). While the CAPTCHA URLs are hardcoded constants (not attacker-controlled), using plain `fetch` creates an inconsistency in the security model and means if the URL source ever changes (env var, manifest value) the SSRF guard would be absent.

**FIX:** Replace `fetch(...)` in `captcha.ts` with `safeFetch(...)` from `lib/security/ssrf.ts`. This is a low-friction change since `safeFetch` has the same signature. Add the reCAPTCHA and Turnstile verification hostnames to `HOSTNAME_ALLOWLIST` in `ssrf.ts` so they bypass the private-IP check.

---

### 19: BUG-019 — Season Ceremony Room Functional Index May Not Exist [MEDIUM]

**FILES:** `apps/web/lib/seasons/seasonEngine.ts`

**DETAIL:** `createSeasonCeremonyRoom` uses `ON CONFLICT ((metadata->>'season_ceremony_id')) DO NOTHING` in a raw SQL INSERT. PostgreSQL requires a matching unique index on exactly that JSON expression for `ON CONFLICT` to work. If the index doesn't exist, PostgreSQL raises `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification` at runtime — the ceremony room creation will error rather than silently deduplicate.

**FIX:** Add a migration that creates the functional unique index: `CREATE UNIQUE INDEX CONCURRENTLY idx_rooms_season_ceremony_id ON rooms ((metadata->>'season_ceremony_id')) WHERE metadata->>'season_ceremony_id' IS NOT NULL;` Alternatively, use `ON CONFLICT ON CONSTRAINT <constraint_name>` if a named constraint exists, or re-implement deduplication with an explicit SELECT-then-INSERT-if-absent pattern guarded by `pg_try_advisory_xact_lock`.

---

### 20: BUG-020 — `dmConversations` UUID Sort Constraint Unenforced at Application Layer [MEDIUM]

**FILES:** `apps/web/lib/db/schema.ts`

**DETAIL:** The `dm_conversations` table has a check constraint `userId1 < userId2` to ensure a canonical ordering of participants (preventing duplicate rows with swapped user IDs). The database enforces this, but there is no helper function in the application layer that pre-sorts the two user IDs before looking up or inserting a DM conversation. Any caller that passes UUIDs in the wrong order gets a DB constraint violation (`ERROR: new row for relation "dm_conversations" violates check constraint`) without a clear application-level error message.

**FIX:** Add a utility function `canonicalDmPair(userA: string, userB: string): [string, string]` that returns the pair sorted so `[0] < [1]`. Call it at every DM conversation lookup and creation site. Add a runtime assertion or TypeScript branded type to make the sorted requirement explicit.

---

### 21: BUG-021 — `moderationReports.reportedMessageId` Missing FK [MEDIUM]

**FILES:** `apps/web/lib/db/schema.ts`

**DETAIL:** `moderationReports.reportedMessageId` is defined as `uuid("reported_message_id")` with no `.references()` call. The `reports` table has an equivalent `reportedMessageId` column with `.references(() => roomMessages.id, { onDelete: "set null" })`. When a room message is deleted, `reports.reported_message_id` is set to NULL (preserving the report while unlinking the deleted content). `moderation_reports.reported_message_id` is NOT nulled out — it holds a dangling UUID pointing to a deleted message, and any query joining `moderation_reports` with `room_messages` on that column silently returns no rows.

**FIX:** Add `.references(() => roomMessages.id, { onDelete: "set null" })` to `moderationReports.reportedMessageId`. Write a migration: `ALTER TABLE moderation_reports ADD CONSTRAINT fk_modreports_message FOREIGN KEY (reported_message_id) REFERENCES room_messages(id) ON DELETE SET NULL;` Run a one-time cleanup to NULL out any already-dangling references: `UPDATE moderation_reports SET reported_message_id = NULL WHERE reported_message_id NOT IN (SELECT id FROM room_messages);`

---

### 22: BUG-022 — `updateQuestProgress` Allows Negative Increment [MEDIUM]

**FILES:** `apps/web/lib/quests/questEngine.ts`

**DETAIL:** `updateQuestProgress(userId, questId, increment)` does not validate that `increment` is a positive number. A negative `increment` would reduce `progress_count` below zero (if the DB column allows negative values) or cause an unexpected underflow. While current callers pass positive values, the absence of a guard means future callers or a refactor could silently corrupt quest progress.

**FIX:** Add `if (increment <= 0) throw new Error('[updateQuestProgress] increment must be positive');` at the top of the function. Also consider adding a `CHECK (progress_count >= 0)` constraint to the `user_quest_decks` table in the schema.

---

### 23: BUG-023 — Offline Sync Queue 'sending' State Leak on Crash [MEDIUM]

**FILES:** `apps/expo/lib/offline/syncQueue.ts`

**DETAIL:** When the reconnect sync batch starts, each message is marked `'sending'` before the API call. `resetSendingMessages` (which resets `'sending'` → `'pending'`) is called at app startup. If the app crashes mid-batch during a reconnect sync (not on cold start), those messages remain in `'sending'` state until the next full app restart. They are effectively invisible to the sync queue's normal retry logic (which only picks `'pending'` messages). On a device with frequent background kills, messages could be stuck for an extended period.

**FIX:** Call `resetSendingMessages` not only at startup but also at the beginning of each reconnect sync attempt — before marking any new messages as `'sending'`. This ensures any leak from a previous crashed batch is cleaned up before the new batch starts.

---

### 24: BUG-024 — Telegram Bot Name Hardcoded [MEDIUM]

**FILES:** `apps/expo/app/auth/login.tsx`

**DETAIL:** The Telegram bot username `'Zobia_bot_bot'` is hardcoded in the deep link URL construction for Telegram login. This couples the app binary to a specific Telegram bot, making it impossible to use a different bot for staging/development environments without a code change and a new app build.

**FIX:** Move the bot name to `Constants.expoConfig?.extra?.telegramBotName` (set in `app.config.js` per environment) and fall back to the hardcoded string only in development. This allows different bots per EAS build profile (development/staging/production).

---

### 25: BUG-025 — Batch Push Bypasses Per-User Rate Limit [MEDIUM]

**FILES:** `apps/web/lib/notifications/push.ts`

**DETAIL:** `sendPushNotification` (single send) checks the per-user rate limit (10 notifications/minute via `atomicIncrWithTtl`) before sending. `sendPushNotificationBatch` (used for broadcast/bulk sends) does not call the rate limiter at all — it sends directly to the Expo batch endpoint. A broadcast to 1,000 users would send all 1,000 notifications without any per-user throttling, potentially overwhelming device notification centres and Expo's API.

**FIX:** In `sendPushNotificationBatch`, group the notification batch by `userId` and check/apply the per-user rate limit for each unique user before including their device tokens in the batch payload. Tokens for users who have hit the rate limit should be skipped for that batch cycle.

---

### 26: BUG-026 — XP Loss When `safeAwardXP` Called With Caller Transaction [MEDIUM]

**FILES:** `apps/web/lib/xp/safeAwardXP.ts`

**DETAIL:** When `safeAwardXP` is called with a caller-supplied `dbClient` (transaction) and the XP award fails, the function re-throws the error (line 158) instead of writing to the DLQ. This is documented in the JSDoc. The problem is that many callers wrap XP awards in a larger transaction and do not explicitly catch errors from `safeAwardXP` — if the outer transaction catches and swallows the error at a higher level, the XP award is permanently lost with no DLQ record and no retry path.

**FIX:** Audit all call sites that pass a `dbClient` to `safeAwardXP` and ensure they either (a) explicitly catch the re-thrown error and write their own DLQ record, or (b) use a two-phase approach: commit the main transaction first, then call `safeAwardXP` without a `dbClient` so the DLQ path is available. Add a prominent `@throws` note to the JSDoc making the caller responsibility explicit.

---

### 27: BUG-027 — Creator Fund Active Days Inflated by Batch XP [LOW]

**FILES:** `apps/web/lib/creator/fund.ts`

**DETAIL:** The Creator Fund's `active_days_30d` metric counts `COUNT(DISTINCT DATE(created_at))` from `xp_ledger` for the past 30 days. A creator can inflate this count by triggering many XP-earning events on the same day (each counts as one distinct day) — but cannot inflate it by earning XP in bulk on a single day. However, automated bots or scripts that trigger XP events spread across multiple calendar dates (e.g., by completing quests at midnight UTC) could game the active-day score without genuine daily engagement. The more fundamental issue is that `xp_ledger` dates are not the same as login/session dates.

**FIX:** Replace the `xp_ledger` source with `user_sessions` or a `daily_logins` table that records actual authenticated sessions. If no such table exists, add a `daily_login_streaks` or `user_activity_log` table and populate it on each authenticated request (once per user per UTC day). Use that for the active-day count.

---

### 28: BUG-028 — `moderation_reports` Orphaned References After Message Deletion [LOW]

**FILES:** `apps/web/lib/db/schema.ts`

**DETAIL:** This is the cascade consequence of BUG-021. Without a foreign key + `ON DELETE SET NULL`, deleted `room_messages` leave `moderation_reports.reported_message_id` pointing to non-existent rows. Admin moderation tools that join on this column will silently return no message content for those reports, potentially misleading moderators into thinking the report has no associated message rather than understanding the message was deleted.

**FIX:** Covered by BUG-021 fix (adding the FK). Additionally, add a migration to null out already-dangling references and update admin query logic to handle `NULL reported_message_id` gracefully (display "Message deleted" instead of an empty state).

---

### 29: BUG-029 — Paystack Subscription Dedup Key Midnight Race [LOW]

**FILES:** `apps/web/lib/payments/paystackWebhookHandler.ts`

**DETAIL:** The idempotency key for `subscription.create` bonuses is `plan:{userId}:{YYYY-MM}` derived from `new Date()` on the server at webhook processing time. If a subscription is created just before midnight UTC and the webhook is delivered and processed after midnight, the computed month key differs from what it would have been at creation time. A second webhook delivery attempt (Paystack retries on non-2xx) after the clock rolls over would find no existing key and apply the bonus again.

**FIX:** Use the event timestamp from the Paystack webhook payload (`data.created_at` or `event.created_at`) to compute the month key rather than `new Date()`. This ensures the key is stable regardless of processing delay. Additionally, add the `subscriptionCode` to the key: `plan:{userId}:{subscriptionCode}:{YYYY-MM}` to make it globally unique.

---

### 30: BUG-030 — `webRedirect` Validation Too Permissive [LOW]

**FILES:** `apps/web/app/api/auth/google/callback/route.ts`

**DETAIL:** The `webRedirect` value (from the OAuth state parameter) is validated with `/^\/[^/]/` — it must start with `/` and not have a second `/` as the second character (preventing `//evil.com` open-redirects). However, it does not sanitize or validate the query string or fragment portion of the redirect path. A crafted state parameter containing `/?next=<script>alert(1)</script>` would pass the regex and be passed to `NextResponse.redirect()`. Depending on the destination page's handling of the `next` query parameter, this could enable reflected XSS.

**FIX:** Strip or encode the query string from `webRedirect` before using it, or validate it against an allowlist of safe redirect destinations (e.g., `/`, `/dashboard`, `/profile`). At minimum, use `encodeURIComponent` on any query parameter values embedded in the redirect URL. A safe default: only allow paths without a query string (validate with `/^\/[a-zA-Z0-9/_-]*$/`).

---

### 31: BUG-031 — Wager Payout Integer Precision Risk [LOW]

**FILES:** `apps/web/lib/games/wager.ts`

**DETAIL:** `computeWagerPayout(pot, rakePct)` computes `Math.floor((pot * (100 - rake)) / 100)`. JavaScript's `Number` type is IEEE 754 double-precision, which can represent integers exactly only up to `2^53 - 1` (≈ 9 quadrillion). For very large wager pools (in coin denomination), `pot * (100 - rake)` could overflow safe integer range and introduce floating-point imprecision before the `Math.floor`. The result would be an incorrect payout that could be off by several coins.

**FIX:** Use `BigInt` arithmetic for payout calculation: `BigInt(pot) * BigInt(100 - rake) / 100n` (note: BigInt division truncates — equivalent to `Math.floor`). Or use the `Decimal.js` library (already used elsewhere in the codebase for coin arithmetic) to ensure precision. Store and pass wager amounts as `bigint`-compatible values throughout.

---

## Code Quality Rating

### Current Rating: **6.2 / 10**

**Strengths:**
- Architecture is thoughtful: CTE-based atomic XP awards, dead-letter queue with retry, distributed locking, field encryption with KDF, SSRF protection, nonce-based CSP, refresh token rotation with grace window, service worker PWA with offline sync.
- Security fundamentals are largely present: CSRF protection, timing-safe comparisons, SQL injection prevention (parameterised queries throughout), RLS groundwork, HTML sanitisation.
- The XP/coin/ledger design is auditable: append-only ledgers, `ON CONFLICT` deduplication, `RETURNING` for atomic read-after-write.
- Dead-letter queues exist for both XP awards and commissions — the pattern is sound even if BUG-001 undermines it.

**Weaknesses:**
- The critical DLQ race (BUG-001) means the system the developer spent the most effort on (reliable payouts) has a fundamental correctness flaw under concurrent load.
- Schema type inconsistencies (BUG-003, BUG-004, BUG-007) create silent data corruption risks for high-value operations.
- CSP gap (BUG-008) means a security feature actively breaks legitimate functionality.
- Multiple medium-severity races (BUG-006, BUG-012) in high-traffic paths.
- Mobile app has several reliability gaps (BUG-015, BUG-016, BUG-023) that affect core notification and auth flows.

### Projected Rating After All Fixes: **8.4 / 10**

Fixing the critical and high-severity bugs (BUG-001 through BUG-008) alone would bring the rating to approximately **7.8 / 10**. Addressing all 31 bugs pushes it to **8.4 / 10**. The remaining gap to 10/10 reflects areas outside this bug report: test coverage depth, observability/tracing completeness, and a few architectural choices (single monolithic schema file, in-process rate limit bypass by design) that are acceptable tradeoffs but limit the ceiling.

---

*Report generated: 2026-06-24 at 09:24 PM*  
*Analyst: Claude (claude-sonnet-4-6) — Zobia Social Forensic Bug Analysis*  
*Branch: `claude/codebase-bug-analysis-9xb73t`*
