# Zobia Codebase — Bug Analysis Report

**Generated:** June 21, 2026 · 11:47 AM  
**Scope:** Web app (Next.js 14 App Router), PWA (service worker), Expo Android app — full monorepo forensic analysis  
**Analyst:** Claude Code (claude-sonnet-4-6)  
**Instruction:** No sub-agents. All files read directly, analysis performed personally.

---

## Quick Summary (all bugs, one line each)

1. **BUG-NEM-01** — Nemesis unique index on `(userId, track, isActive)` causes a constraint crash on every second nemesis reassignment per user+track pair.
2. **BUG-CREA-01** — `distributeCreatorFund` uses `ON CONFLICT (reference_id)` on `creator_earnings` but no unique index exists on that column — PostgreSQL errors every run.
3. **BUG-CSRF-01** — Legacy webhook routes `/api/webhooks/paystack` and `/api/webhooks/dodopayments` are missing from `PUBLIC_PREFIXES`; payment provider POST calls (no `Origin` header) get blocked with 403.
4. **BUG-XSS-01** — Announcement engine returns raw markdown content to clients without going through the `marked` → `sanitize-html` pipeline, allowing embedded HTML tags to survive as XSS payloads.
5. **BUG-QST-01** — `TRACK_COLUMN` map in `questEngine.ts` is missing the `'gaming'` and `'main'` XP tracks; quests mapped to those tracks throw a runtime error and award no XP.
6. **BUG-RACE-01** — Season ceremony room creation in `seasonEngine.ts` has a TOCTOU race: two concurrent CRON runs can both pass the existence check and INSERT duplicate ceremony rooms.
7. **BUG-LB-01** — `upsertLeaderboardSnapshot` uses `COALESCE` expressions in the `ON CONFLICT` clause; if the underlying unique index was built on raw nullable columns, the conflict target won't match and duplicate snapshot rows are silently inserted.
8. **BUG-XP-GIFT-01** — `awardGiftXP` in the gift send route performs raw XP ledger INSERTs inside a transaction without going through `safeAwardXP`; failures are `console.error`-only and never written to the DLQ.
9. **BUG-PIN-01** — `requirePinVerified` calls `redis.get(...)` without a try/catch; a Redis outage causes an uncaught exception that returns 500 to the client instead of failing securely with 403.
10. **BUG-BIGINT-01** — `getBalance()` and `getStarBalance()` type PostgreSQL `BIGINT` results as `{ coin_balance: number }` / `{ star_balance: number }`; balances exceeding `Number.MAX_SAFE_INTEGER` lose precision silently.
11. **BUG-REGEX-01** — `URL_REGEX`, `EMAIL_REGEX`, `PHONE_REGEX` in `antispam.ts` are module-level global `RegExp` instances with the `g` flag; their mutable `lastIndex` state can cause incorrect results in any caller that forgets to reset them.
12. **BUG-RL-01** — The global rate limiter in `rateLimit.ts` uses the caller's `options.windowMs` instead of a fixed 60-second window; for the 15-minute auth rate limit, the global bucket's window is also 15 minutes, not 60 seconds.
13. **BUG-DODO-01** — `dodoWebhookHandler.ts` reads `itemSlug` from webhook metadata via an unsafe type assertion `(metadata as { itemSlug?: string })` on a declared type that doesn't include that field.
14. **BUG-GAME-SILENT-01** — `finalizeScore` in `sessions.ts` calls `recordChallengeRoundPlay(...)` with `.catch(() => {})`, silently discarding failures and leaving challenge rounds in a stale state with no log entry.
15. **BUG-XP-DEDUP-01** — `safeAwardXP` callers that pass `null` or omit `referenceId` disable the `ON CONFLICT` partial-index dedup guard; CRON retries of such null-referenceId awards from `failed_xp_awards` can produce double-awards.
16. **BUG-MILE-01** — `checkPlayMilestones` is called fire-and-forget after `finalizeScore`; if the outer `SELECT COUNT(*)` fails (DB timeout, etc.), no milestone is checked and no failure is recorded in any log or DLQ.
17. **BUG-L1-01** — Session logout clears only the local serverless instance's in-process L1 cache `Map`; other instances continue serving the revoked session from their own `Map` for up to 3 seconds.
18. **BUG-PUSH-DEDUP-01** — Push tokens where `device_id IS NULL` bypass deduplication in `push.ts`; users with multiple null-device_id tokens receive one push notification per token.
19. **BUG-SCHEMA-01** — `seasons.updatedAt` in `lib/db/schema.ts` has no `.defaultNow()`; new season rows insert with `updated_at = NULL` unless the caller explicitly sets the field.
20. **BUG-ENC-01** — If a versioned KYC encryption key env var is missing, `decryptField` silently returns `null` instead of throwing; at call sites this presents as "2FA not enabled" or missing data instead of an operational alert.
21. **BUG-STICKER-01** — `dm_score_sticker_unlocks` INSERT uses bare `ON CONFLICT DO NOTHING` with no column target; if the table has no unique constraint the PostgreSQL docs say this is valid but the deduplication may be unenforceable.
22. **BUG-XP-ACTION-01** — `xpDrop.ts` inserts to `xp_ledger` with a separate `action` column set to `'mystery_drop'`; the 24-hour eligibility check queries `WHERE action = 'mystery_drop'`, while `safeAwardXP` never writes an `action` column — the two codepaths are inconsistent and analytics queries by `source` or `action` yield different result sets.

---

## Detailed Bug Descriptions

---

### 1. BUG-NEM-01 — Nemesis unique index crashes on second reassignment

**FILES:**  
`apps/web/lib/db/schema.ts` · `apps/web/lib/nemesis/nemesisEngine.ts`

**FIX:**  
The `nemesis_assignments` table has a `uniqueIndex` on `(userId, track, isActive)`. This means only one row per `(user, track)` can have `isActive = FALSE` at any time. After the first nemesis reassignment, `(user, track, FALSE)` is already occupied by the deactivated first nemesis. When a second reassignment runs and tries to UPDATE the current active nemesis to `is_active = FALSE`, PostgreSQL throws a unique constraint violation because the `(user, track, FALSE)` slot is taken. Change the unique index to a **partial unique index** scoped to active records only: `UNIQUE (user_id, track) WHERE is_active = TRUE`. This allows unlimited historical (inactive) rows per user+track while still guaranteeing only one active nemesis per pair. The migration should drop the existing index and create the new partial one.

---

### 2. BUG-CREA-01 — `creator_earnings` missing unique index breaks `ON CONFLICT`

**FILES:**  
`apps/web/lib/creator/fund.ts` · `apps/web/lib/db/schema.ts`

**FIX:**  
`distributeCreatorFund` uses `ON CONFLICT (reference_id) DO NOTHING` in its INSERT to `creator_earnings`, but inspecting the schema reveals `creator_earnings.reference_id` has no unique index. PostgreSQL requires a unique constraint or exclusion constraint to exist on exactly the conflict columns; without one it throws `"there is no unique or exclusion constraint matching the ON CONFLICT specification"` on every execution, meaning the creator fund is never distributed. Add a migration to create a unique index on `creator_earnings(reference_id) WHERE reference_id IS NOT NULL`, matching the partial-index pattern used elsewhere.

---

### 3. BUG-CSRF-01 — Legacy webhook routes blocked by CSRF middleware

**FILES:**  
`apps/web/middleware.ts` · `apps/web/app/api/webhooks/paystack/route.ts` · `apps/web/app/api/webhooks/dodopayments/route.ts`

**FIX:**  
`PUBLIC_PREFIXES` in `middleware.ts` correctly includes `/api/economy/webhooks/paystack` and `/api/economy/webhooks/dodopayments`, but the legacy re-export routes at `/api/webhooks/paystack` and `/api/webhooks/dodopayments` are absent. Payment providers send POST callbacks with no `Origin` header, which `isCsrfSafe` rejects with 403 for non-public routes. Since these legacy routes simply re-export the canonical handlers, the simplest fix is to add `"/api/webhooks/paystack"` and `"/api/webhooks/dodopayments"` to `PUBLIC_PREFIXES`. Alternatively, redirect the providers' dashboards to the canonical URLs and delete the legacy routes once all registered webhooks have been migrated.

---

### 4. BUG-XSS-01 — Markdown announcements bypass HTML sanitizer

**FILES:**  
`apps/web/lib/announcements/engine.ts` · `apps/web/lib/security/htmlSanitizer.ts`

**FIX:**  
`getActiveModalForUser` and `getActiveBannerForUser` call `sanitizeHtml(selected.content)` only when `content_type === 'html'`. For `content_type === 'markdown'`, the raw markdown string is returned to the client unsanitized. `htmlSanitizer.ts` already exports `sanitizeAnnouncementContent(content, contentType)` which correctly pipes markdown through `marked` → `sanitize-html`. Replace the conditional `sanitizeHtml` call with `sanitizeAnnouncementContent(selected.content, selected.content_type)` in both functions. This eliminates embedded `<script>` or `javascript:` href injection that could survive in markdown-typed announcements.

---

### 5. BUG-QST-01 — Quest engine `TRACK_COLUMN` map missing `'gaming'` and `'main'` tracks

**FILES:**  
`apps/web/lib/quests/questEngine.ts`

**FIX:**  
`TRACK_COLUMN` in `questEngine.ts` maps six XP tracks (social, creator, competitor, generosity, knowledge, explorer) but omits `'gaming'` and `'main'`. The `ACTION_TRACKS` map imported from `xp/engine.ts` can map certain quest action types to these tracks. When `updateQuestProgress` looks up `TRACK_COLUMN[track]` and gets `undefined`, the subsequent `SAFE_XP_COLS` allowlist check throws `"Unsafe XP track column: undefined"` and no XP is awarded. Add `gaming: 'xp_gaming'` and `main: 'xp_total'` to `TRACK_COLUMN` to match the full set of valid tracks used elsewhere in the XP system.

---

### 6. BUG-RACE-01 — Season ceremony room creation is not atomic

**FILES:**  
`apps/web/lib/seasons/seasonEngine.ts`

**FIX:**  
The ceremony room existence check (`SELECT 1 FROM rooms WHERE name = $1`) and the subsequent `INSERT INTO rooms` are two separate queries without a wrapping transaction or advisory lock. Two concurrent CRON invocations (or a retried CRON job) can both pass the existence check before either INSERT executes, resulting in two identical ceremony rooms. Fix by wrapping both statements in a transaction and using `INSERT INTO rooms ... ON CONFLICT (name) DO NOTHING RETURNING id` as a single atomic upsert, or by acquiring a `pg_advisory_xact_lock` keyed on the season ID before the check+insert block.

---

### 7. BUG-LB-01 — Leaderboard snapshot `ON CONFLICT` COALESCE clause may not match DB index

**FILES:**  
`apps/web/lib/leaderboards/engine.ts`

**FIX:**  
`upsertLeaderboardSnapshot` specifies the conflict target as `(user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))`. PostgreSQL's `ON CONFLICT` clause must exactly match an existing unique index definition, including the same expressions. If the migration created the index on the raw columns (allowing multiple NULLs as distinct values), the COALESCE expressions in the `ON CONFLICT` clause don't match it and PostgreSQL will throw or insert a duplicate row on every NULL-city/NULL-season_id snapshot. Confirm the unique index in the migration SQL is built with the same COALESCE expressions, e.g. `CREATE UNIQUE INDEX ... ON leaderboard_snapshots (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))`. Alternatively, redesign to use `''` as the sentinel value stored in the column and never store NULLs.

---

### 8. BUG-XP-GIFT-01 — Gift XP awards bypass `safeAwardXP` dead-letter queue

**FILES:**  
`apps/web/app/api/economy/gifts/send/route.ts`

**FIX:**  
`awardGiftXP` performs XP ledger INSERTs directly via `db.transaction` instead of calling `safeAwardXP`. If the XP transaction fails (DB connectivity blip, lock timeout), the outer `try/catch` logs to `console.error` but does not write to `failed_xp_awards`. Unnoticed XP loss degrades the economy for senders and recipients. Replace the direct ledger INSERTs with `safeAwardXP` calls (after the transaction, per the established pattern), or extract the XP awards from the transaction and call `safeAwardXP` post-commit for DLQ protection, consistent with how `updateQuestProgress` and `checkDeckCompletion` handle this.

---

### 9. BUG-PIN-01 — `requirePinVerified` throws unhandled error on Redis outage

**FILES:**  
`apps/web/lib/auth/pinGuard.ts`

**FIX:**  
`requirePinVerified` calls `redis.get(pinKey)` without a try/catch. When Redis is unavailable, the call rejects with an unhandled promise rejection which propagates as a 500 Internal Server Error to the client. Sensitive endpoints (gift send, payout, etc.) should fail **closed** on infrastructure errors, not open. Wrap the Redis call in a try/catch: on error, return `false` (pin not verified) rather than letting the exception propagate. Log the Redis failure with sufficient context for alerting.

---

### 10. BUG-BIGINT-01 — PostgreSQL `BIGINT` coin/star balances typed as JS `number`

**FILES:**  
`apps/web/lib/economy/coins.ts` · `apps/web/lib/economy/stars.ts`

**FIX:**  
`getBalance()` and `getStarBalance()` declare the query result type as `{ coin_balance: number }` and `{ star_balance: number }`. Node-postgres returns PostgreSQL `BIGINT` columns as JavaScript strings when their values exceed `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991). The type annotation silently narrows that string to `number` and `parseInt` or direct numeric coercion then silently drops precision. While the DB's balance cap should prevent practical overflow today, the correct pattern is to declare the type as `{ coin_balance: string }` and use `BigInt()` or `Decimal.js` for arithmetic. At minimum, add a numeric guard `if (balance > Number.MAX_SAFE_INTEGER) throw new Error(...)` until the type is corrected.

---

### 11. BUG-REGEX-01 — Mutable global regex with `g` flag exported from `antispam.ts`

**FILES:**  
`apps/web/lib/messaging/antispam.ts`

**FIX:**  
`URL_REGEX`, `EMAIL_REGEX`, and `PHONE_REGEX` are module-level `RegExp` instances created with the `g` flag (enabling global search). JavaScript's `RegExp.prototype.lastIndex` is mutated in-place on every `.exec()` or `.test()` call when the `g` flag is set. The module resets `lastIndex` in all known internal callers, but the regexes are exported, meaning any external module that calls `.test()` on them without first resetting `lastIndex` will get wrong results. Change these to either (a) factory functions that return a fresh `RegExp` per call — the safe default — or (b) remove the `g` flag if global matching is not required. The safest fix is `() => /pattern/gi` and use the return value locally.

---

### 12. BUG-RL-01 — Global rate limiter window inherits per-user window size

**FILES:**  
`apps/web/lib/security/rateLimit.ts`

**FIX:**  
`createGlobalRateLimiter` creates a second rate limiter using `options.windowMs` for its window. The inline comment says "60 000ms" but the actual window is whatever the caller passed. For `RATE_LIMITS.auth` (`windowMs: 15 * 60 * 1000 = 900,000ms`), the global bucket allows 100 auth attempts per IP per **15 minutes**, not per minute as intended. To fix, pass a hardcoded `60_000` (or a separate `globalWindowMs` option) to the global limiter constructor so it always resets every 60 seconds regardless of the per-user window.

---

### 13. BUG-DODO-01 — DodoPayments webhook `itemSlug` accessed via unsafe type assertion

**FILES:**  
`apps/web/lib/payments/dodoWebhookHandler.ts`

**FIX:**  
The handler casts `metadata` to `{ itemSlug?: string }` to read a field that is not present in the declared metadata type. If the DodoPayments payload schema changes or the field is renamed, the assertion returns `undefined` at runtime without any TypeScript error. Define `itemSlug` explicitly in the metadata type for DodoPayments webhooks (matching the actual payload contract from the provider docs). If the field is provider-specific and not guaranteed, add an explicit runtime check: `const itemSlug = typeof metadata?.itemSlug === 'string' ? metadata.itemSlug : undefined` with a fallback/log on missing value.

---

### 14. BUG-GAME-SILENT-01 — Challenge round recording failure silently discarded

**FILES:**  
`apps/web/lib/games/sessions.ts`

**FIX:**  
`finalizeScore` calls `recordChallengeRoundPlay(roundId, userId, playId, score)` inside a `.catch(() => {})` guard with no logging. If the DB call fails (network blip, lock contention, schema mismatch), the game score is recorded but the challenge round is never updated. From the user's perspective the challenge appears frozen: no progress, no winner, no refund. Replace the empty catch with at minimum `logger.error({ roundId, userId }, '[games] recordChallengeRoundPlay failed: ' + err)` so failures are observable. Consider surfacing the error to the caller so the client can prompt a retry.

---

### 15. BUG-XP-DEDUP-01 — `safeAwardXP` null `referenceId` disables double-award protection

**FILES:**  
`apps/web/lib/xp/safeAwardXP.ts`

**FIX:**  
The `ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL` partial index only de-duplicates when `reference_id` is non-null. Callers passing `null` skip deduplication entirely, and the CRON retry step for `failed_xp_awards` uses a synthetic `dlq_retry:...` referenceId for null rows. If the original null-referenceId award DID succeed but then encountered a post-commit failure that caused a DLQ entry, the CRON retry creates a second XP award (a double-award). Audit all `safeAwardXP` call sites and supply stable, deterministic referenceIds for each. Where a referenceId cannot be derived at call time, generate one from a combination of `userId + source + date` that remains stable across retries.

---

### 16. BUG-MILE-01 — `checkPlayMilestones` outer failure produces no DLQ entry

**FILES:**  
`apps/web/lib/games/rewards.ts`

**FIX:**  
`checkPlayMilestones` is called fire-and-forget after `finalizeScore`. If the first `SELECT COUNT(*)` from `game_plays` fails, the entire function exits in its `catch` block with a `logger.warn`, and no milestone checking occurs. The individual `grantGamingReward` calls inside the loop do use `safeAwardXP` (protected by the DLQ), but the outer count failure means even determining whether milestones are due never happens. Record a DLQ-style entry or scheduled retry when the outer count query fails, or call `checkPlayMilestones` within a retry queue similar to how XP awards are retried, so transient failures do not silently cause missed milestone grants.

---

### 17. BUG-L1-01 — Revoked sessions remain valid in other serverless instances for up to 3 seconds

**FILES:**  
`apps/web/lib/auth/session.ts`

**FIX:**  
The in-process L1 cache is a `Map` local to each serverless instance. Calling `invalidateSession` or `invalidateAllSessions` clears Redis (the authoritative source) and the local instance's `Map`, but other active serverless instances continue to serve the cached session until their 3-second TTL expires. For most logout scenarios this is an acceptable tradeoff. For high-security flows (admin de-provisioning, compromised-account lockout), reduce the L1 TTL to 0 seconds (disable L1 entirely) or use a Redis `keyspace notification` to propagate invalidation events to other instances. At minimum, document this window clearly in comments and ensure the security threat model accounts for it.

---

### 18. BUG-PUSH-DEDUP-01 — Multiple push tokens with `device_id = NULL` cause duplicate notifications

**FILES:**  
`apps/web/lib/notifications/push.ts`

**FIX:**  
Token deduplication in `push.ts` groups by `device_id` and takes one token per device. Tokens where `device_id IS NULL` fall outside this grouping and are all included as separate push targets. A user with N legacy null-device_id tokens receives N copies of every notification. Add a secondary deduplication pass by `push_token` value (not `device_id`) to collapse tokens with the same token string. For tokens where `device_id IS NULL`, consider whether to include only the most-recently-updated token per user or to migrate them to require a device_id on registration.

---

### 19. BUG-SCHEMA-01 — `seasons.updatedAt` has no `.defaultNow()`

**FILES:**  
`apps/web/lib/db/schema.ts`

**FIX:**  
Every other `updatedAt` column in the schema is defined with `.defaultNow()`. `seasons.updatedAt` is missing this, meaning new season rows insert with `updated_at = NULL` unless the caller explicitly provides the value. Add `.defaultNow()` to the column definition and add a migration that backfills any `NULL` values with `created_at` or `NOW()`.

---

### 20. BUG-ENC-01 — Missing KYC encryption key env var silently returns `null`

**FILES:**  
`apps/web/lib/security/fieldEncryption.ts`

**FIX:**  
When a versioned env var (e.g., `KYC_ENCRYPTION_KEY_V1`) is absent, `getKeyForVersion` throws `"<envVar> env var not set"`. The `decryptField`/`decryptRaw` functions catch this exception and return `null`. At call sites such as the 2FA verify route, a `null` secret results in `"2FA is not enabled for this user"` being returned to the client — an incorrect error that hides an operational outage. Two changes needed: (1) In `decryptField`, distinguish between a legitimate decryption failure and a missing-key error; for missing keys, re-throw or emit an alert rather than returning `null`. (2) Add a startup health check that validates all required encryption key env vars are present and non-empty before the app accepts traffic.

---

### 21. BUG-STICKER-01 — `dm_score_sticker_unlocks` `ON CONFLICT DO NOTHING` has no column target

**FILES:**  
`apps/web/lib/messaging/conversationScore.ts`

**FIX:**  
The INSERT to `dm_score_sticker_unlocks` uses `ON CONFLICT DO NOTHING` without specifying `ON CONFLICT (column_list) DO NOTHING`. The bare form catches any constraint violation but cannot guarantee which constraint it will match. If there is no unique index at all, PostgreSQL 15+ still accepts the form but the statement will never actually de-duplicate — every duplicate event inserts a new row. Verify that a unique index on `(user_id_1, user_id_2, pack_name)` exists in the migration, then change to `ON CONFLICT (user_id_1, user_id_2, pack_name) DO NOTHING` to make the intent explicit and schema-safe.

---

### 22. BUG-XP-ACTION-01 — `xp_ledger` `action` and `source` columns used inconsistently

**FILES:**  
`apps/web/lib/mystery/xpDrop.ts` · `apps/web/lib/xp/safeAwardXP.ts`

**FIX:**  
`xpDrop.ts` inserts both `source = 'mystery_drop'` AND `action = 'mystery_drop'` into `xp_ledger`, then checks 24-hour deduplication with `WHERE action = 'mystery_drop'`. All other XP-awarding code (`safeAwardXP`) only writes `source`, never `action`. This creates two de-facto schemas for the same table: admin reports filtering by `source = 'mystery_drop'` find xpDrop rows; anything filtering by `action` finds nothing from other sources. The `action` column appears to be a legacy or redundant field. Standardise on `source` throughout: remove the `action` column from the xpDrop INSERT, update the 24-hour eligibility check to `WHERE source = 'mystery_drop'`, and if the `action` column is unused elsewhere, drop it via migration.

---

## Code Quality, Security, and Performance Assessment

### Current Ratings (Pre-Fix)

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Code Quality** | 7.2 / 10 | Excellent architectural patterns (DLQ, CTE-based idempotency, FOR UPDATE row locks, kid-based JWT rotation, Decimal.js arithmetic, circuit breakers, cursor pagination). Weaknesses: inconsistent use of `safeAwardXP`, TRACK_COLUMN omissions, mutable global regexes, and missing schema defaults. |
| **Security** | 7.5 / 10 | Strong fundamentals: CSP nonce with `strict-dynamic`, HSTS in production, CSRF Origin check, AES-256-GCM field encryption with scrypt KDF (v2), constant-time TOTP comparison, sliding-window rate limits, PIN brute-force lockout, TOTP anti-replay via Redis. Critical weaknesses: XSS in markdown announcements, PIN guard failing open on Redis outage, legacy webhook CSRF block silently dropping payment events. |
| **Performance** | 7.0 / 10 | Good: L1 in-process session cache (3 s TTL), 60-second Redis Flash XP cache, TABLESAMPLE BERNOULLI for mystery drops, compound cursor pagination, delta-fetch for room messages, batch push notifications with Expo receipts. Weaknesses: `NOT IN` subquery in eligibility check (xpDrop), leaderboard COALESCE conflict clause risk of duplicate inserts under load, global rate limiter window misconfiguration. |

### Projected Ratings (Post-Fix)

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Code Quality** | 8.7 / 10 | Consistent use of `safeAwardXP` DLQ, complete TRACK_COLUMN maps, explicit ON CONFLICT targets, standardised column usage, no mutable exported regexes. |
| **Security** | 9.1 / 10 | XSS vector eliminated, PIN guard fails closed on infra errors, payment webhooks correctly routed, encryption key outages are alertable rather than silent. |
| **Performance** | 8.2 / 10 | Corrected global rate limiter window, leaderboard upsert guaranteed to use correct index, push deduplication prevents thundering-herd duplicate deliveries. |

---

*Report End*  
**Generated:** June 21, 2026 · 11:47 AM
