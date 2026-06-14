# Zobia Social — Bug Fix Plan

**Generated:** June 14, 2026, 09:27 PM
**Updated:** June 14, 2026, 09:48 PM (added Group G — BUG-41 through BUG-52)
**Source:** custom-bugs-report.md (52 confirmed bugs)
**Instruction:** DO NOT begin any fix until this plan has been reviewed and approved.

---

## Fix Priority Groups

Bugs are grouped by execution dependency. Fix within each group in the order listed, as later bugs in a group may share a root cause with earlier ones. Groups can be done in parallel by different developers.

---

## GROUP A — Critical: Schema & Data Integrity (Fix First)
*These cause runtime crashes or silent data corruption. Nothing else is safe to fix until the schema is authoritative.*

### FIX-A1 (BUG-26): Consolidate `gift_types` and `gift_items` Into One Table

This is the root of BUG-04, BUG-05, and related gift-flow issues. Fix this before any other gift-related work.

1. Decide on the canonical table name. `gift_items` is referenced by more active code paths (history route, monthly drops). Recommend keeping `gift_items` as the canonical name.
2. Write a migration to add `is_active BOOLEAN NOT NULL DEFAULT TRUE` to `gift_items` and copy `is_active` values from `gift_types` for any matching records.
3. Update the `gifts` table FK column from `gift_type_id` to `gift_item_id` (and FK target from `gift_types` to `gift_items`) via migration.
4. Update the Drizzle schema: update the `gifts` table definition, add `isActive` to `giftItems`.
5. Mark `giftTypes` as deprecated in the schema with a comment; plan a separate migration to DROP it once all references are removed.

FILES: `apps/web/lib/db/schema.ts`, migration files

---

### FIX-A2 (BUG-04 + BUG-05): Fix Gift Send Route Column References

After FIX-A1, update the gift send route:

1. Change the JOIN query from `WHERE gi.is_active = TRUE` — this now works because `gift_items` has `is_active`.
2. Change the INSERT column from `gift_item_id` — this now works because the FK column is `gift_item_id` on `gifts`.
3. Verify the gift history route (`/api/economy/gifts`) JOIN against `gift_items` is unchanged and correct.

FILES: `apps/web/app/api/economy/gifts/send/route.ts`

---

### FIX-A3 (BUG-03): Add `tier` Column to `referral_commissions`

1. Add a migration: `ALTER TABLE referral_commissions ADD COLUMN tier TEXT NOT NULL DEFAULT 'standard'`.
2. Update the INSERT in `commissions.ts` to include the `tier` value when writing a new commission row.
3. Verify `getCommissionStats` GROUP BY tier now returns valid results.

FILES: `apps/web/lib/referrals/commissions.ts`, migration files

---

### FIX-A4 (BUG-28): Standardize UUID Generation on `gen_random_uuid()`

1. Audit all Drizzle table definitions that use `uuidPk()` vs `uuidPkGen()`.
2. Write a migration that calls `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` as a safety net for any remaining `uuid_generate_v4()` defaults, OR change all `uuidPk()` calls to `uuidPkGen()` in the schema and update the migration to use `DEFAULT gen_random_uuid()`.
3. Delete `uuidPk()` helper from schema.ts once all references are changed.

FILES: `apps/web/lib/db/schema.ts`, migration files

---

### FIX-A5 (BUG-35): Add Missing Tables to Drizzle Schema

1. Add Drizzle `pgTable` definitions for: `store_items`, `room_subscriptions`, `user_subscriptions`, `creator_earnings`, `sponsored_quest_applications`.
2. Inspect the actual DB tables (via `\d tablename` in psql or migration files) to match column names exactly.
3. Export the new table definitions from `schema.ts`.

FILES: `apps/web/lib/db/schema.ts`

---

### FIX-A6 (BUG-25 + BUG-38 + BUG-39): Consolidate `user_badges` Timestamp Columns

1. Decide on one canonical timestamp column. Recommendation: `granted_at`.
2. Write a migration: backfill `granted_at = awarded_at` for rows where `granted_at IS NULL`, then DROP COLUMN `awarded_at`.
3. Update `trackMilestones.ts`: remove `awarded_at` from the INSERT, set `granted_at = NOW()` only.
4. Update `milestoneStickers.ts` `checkStickerCollectorBadges`: change `awarded_at` to `granted_at` in the INSERT.
5. Fix `badge_type`: In `trackMilestones.ts` set `badge_type = 'title'` (the category) and keep `badge_key = 'title_${unlockKey}'`.

FILES: `apps/web/lib/db/schema.ts`, `apps/web/lib/xp/trackMilestones.ts`, `apps/web/lib/stickers/milestoneStickers.ts`, migration files

---

### FIX-A7 (BUG-27): Rename `guildWarMembers` ORM Export to `warContributions`

1. In `schema.ts`, rename the Drizzle export from `guildWarMembers` to `warContributions`.
2. Search for any ORM-based references to `guildWarMembers` and update them.
3. The raw SQL in `recordWarContribution.ts` uses the correct table name already — no change needed there.

FILES: `apps/web/lib/db/schema.ts`

---

## GROUP B — Critical: Wrong Table References (Fix Second)

### FIX-B1 (BUG-06): Fix `contentFilter.ts` Table Reference

1. Change `FROM messages` to `FROM room_messages` in both `detectDuplicateMessage` and `detectBotBehavior`.
2. Verify column names: `sender_id`, `room_id`, `content`, `deleted_at` — confirm these exist on `room_messages` (check schema or DB).
3. Check `room_messages` column name for soft-delete: the schema may use `is_deleted` rather than `deleted_at`; update the WHERE clause accordingly.

FILES: `apps/web/lib/moderation/contentFilter.ts`

---

### FIX-B2 (BUG-07): Fix `leaderboards/engine.ts` Table References

1. Change both occurrences of `FROM messages` to the correct table name (likely `room_messages` for room message counts).
2. If the intent was to count DM messages, identify the actual DM messages table name and use it for that metric specifically.
3. After fixing, verify that `getUserMetricsForWeighting` returns non-zero message counts for active users.

FILES: `apps/web/lib/leaderboards/engine.ts`

---

### FIX-B3 (BUG-08 + BUG-09): Fix `monthlyGiftDrop.ts` Notification INSERT

1. Remove the raw notification INSERT from `processPendingGiftDrops`.
2. Replace with `insertNotificationBatch(db, userIds, 'gift_drop_announced', { giftDropId: drop.id, title: '...', body: '...' })`.
3. To get `userIds`: either fetch them in bulk before the notification call or use the existing batch helper's `SELECT id FROM users` approach.
4. Remove `drop.id` as `$1` (the orphaned parameter from BUG-09 is resolved by eliminating the raw INSERT).

FILES: `apps/web/lib/events/monthlyGiftDrop.ts`

---

## GROUP C — Security (Fix Third, in Parallel with Group D)

### FIX-C1 (BUG-12): Add Geo-Anomaly Check to `withAdminAuth`

1. Extract the geo-anomaly block from `withAuth` into a standalone async helper function `runGeoAnomalyCheck(session, currentIp)`.
2. Call `runGeoAnomalyCheck` from both `withAuth` and `withAdminAuth`, after the session is validated but before the handler runs.
3. In `withAdminAuth`, use a stricter threshold if desired (e.g., lower `ANOMALY_THRESHOLD` for admin sessions).

FILES: `apps/web/lib/api/middleware.ts`

---

### FIX-C2 (BUG-13): Replace Pre-Auth Token in Web 2FA Redirect URL With Opaque Code

1. After generating `preAuthToken`, store it in Redis: `redis.setex('web_pre_auth:${code}', 300, preAuthToken)` where `code = randomBytes(32).toString('hex')`.
2. Redirect to `/auth/2fa?code=${code}` instead of `?token=${preAuthToken}`.
3. Create a new server endpoint (e.g., `POST /api/auth/2fa/pre-auth-token`) that accepts `{ code }`, retrieves the token from Redis (`GETDEL`), and returns it to the 2FA page for local use.
4. The 2FA page calls this endpoint on mount to retrieve the token, then proceeds with normal TOTP verification.

FILES: `apps/web/app/api/auth/google/callback/route.ts`, new `apps/web/app/api/auth/2fa/pre-auth-token/route.ts`

---

### FIX-C3 (BUG-21): Enforce Per-User Session Limit

1. After inserting a new session into `user_sessions:{userId}`, immediately call `ZREMRANGEBYRANK user_sessions:{userId} 0 -(MAX_SESSIONS+1)` to keep only the most-recent sessions.
2. Define `MAX_SESSIONS = 10` as a named constant in `session.ts`.
3. Consider also adding the removed sessions to a list for forced-logout notifications.

FILES: `apps/web/lib/auth/session.ts`

---

### FIX-C4 (BUG-19): Use Idempotency Key as `referenceId` in Gift Coin Operations

1. In the gift send route, derive a stable `referenceId` from the idempotency key stored in Redis (e.g., the gift's UUID once created, or the `gift:idem:{key}` Redis key value).
2. Pass this `referenceId` to `debitCoins` and all `creditCoins` calls.
3. Ensure the `coin_ledger` table has a unique index on `reference_id` where non-null to actually enforce idempotency.

FILES: `apps/web/app/api/economy/gifts/send/route.ts`

---

### FIX-C5 (BUG-18): Add Room Membership Check in Gift Send

1. When `roomId` is provided in the gift send request body, add a pre-check query before processing the gift:
   `SELECT 1 FROM room_members WHERE room_id = $roomId AND user_id = $senderId AND left_at IS NULL`
2. If no row is returned, return HTTP 403 with code `NOT_ROOM_MEMBER`.

FILES: `apps/web/app/api/economy/gifts/send/route.ts`

---

## GROUP D — Reliability / DLQ Coverage (Fix in Parallel with Group C)

### FIX-D1 (BUG-02): Add `knowledge` Track to `TRACK_COLUMN` Map

1. In `questEngine.ts`, add `knowledge: "xp_knowledge"` to the `TRACK_COLUMN` object.
2. Verify that the `users` table has an `xp_knowledge` column (add a migration if missing).

FILES: `apps/web/lib/quests/questEngine.ts`

---

### FIX-D2 (BUG-16): Replace Raw XP Award in `checkDeckCompletion` With `safeAwardXP`

1. Remove the raw `UPDATE users SET xp_total = ...` and direct `xp_ledger` INSERT from `checkDeckCompletion`.
2. Replace with `await safeAwardXP(userId, 500, 'main', 'deck_completion', db)`.
3. Verify the `safeAwardXP` import is available in `questEngine.ts`.

FILES: `apps/web/lib/quests/questEngine.ts`

---

### FIX-D3 (BUG-29): Replace Raw XP Award in Referral Commissions With `safeAwardXP`

1. In `commissions.ts`, replace the raw UPDATE + INSERT for first-purchase XP with `safeAwardXP(referrerId, xpAmount, 'main', 'referral_first_purchase', db)`.
2. Confirm that the `safeAwardXP` import path is resolvable from `lib/referrals/commissions.ts`.

FILES: `apps/web/lib/referrals/commissions.ts`

---

### FIX-D4 (BUG-17): Fix Payout Velocity Check to Exclude System Retries

1. In `lib/fraud/payouts.ts`, update the velocity count query to filter out auto-retry rows.
2. Add a condition: `AND status NOT IN ('retrying')` OR add a `is_user_initiated BOOLEAN DEFAULT TRUE` column to payouts and filter `WHERE is_user_initiated = TRUE`.
3. Ensure the payout CRON sets `is_user_initiated = FALSE` when creating retry rows.

FILES: `apps/web/lib/fraud/payouts.ts`, migration files

---

## GROUP E — Code Correctness (Fix in Parallel with Group D)

### FIX-E1 (BUG-01): Remove Duplicate TOTP Implementation From 2FA Verify Route

1. Verify that the TOTP implementation in `verify/route.ts` is identical to `lib/auth/totp.ts`. If any differences exist, evaluate which is correct and reconcile in `totp.ts` first.
2. Delete `base32Decode`, `generateTOTP`, and `verifyTOTP` from `apps/web/app/api/auth/2fa/verify/route.ts`.
3. Add `import { verifyTotp } from '@/lib/auth/totp'` and update the call site.

FILES: `apps/web/app/api/auth/2fa/verify/route.ts`

---

### FIX-E2 (BUG-10): Skip `total_messages` Increment for Pending-Approval Messages

1. In the room messages POST route, wrap the `UPDATE room_members SET total_messages = total_messages + 1` call in a condition: only execute it when the inserted message status is `'approved'` (i.e., when `approval_required` is false for the room).
2. In the message approval handler (wherever `status` is set to `'approved'`), add the increment there.

FILES: `apps/web/app/api/rooms/[roomId]/messages/route.ts`

---

### FIX-E3 (BUG-11): Include Pin Status in `rowToMessage()` Response

1. Add `isPinned`, `pinnedAt`, and `pinExpiresAt` to the return object of `rowToMessage()`.
2. Apply client-side expiry logic: if `pin_expires_at` is non-null and in the past, return `isPinned: false`.
3. Verify the client UI has a handler for these fields; add one if absent.

FILES: `apps/web/app/api/rooms/[roomId]/messages/route.ts`

---

### FIX-E4 (BUG-20): Fix `isEmailTypeEnabledForUser` to Query by User ID

1. Change the function signature to accept `userId: string` alongside or instead of `userEmail: string`.
2. Change the query to `SELECT uep.is_enabled FROM user_email_preferences uep WHERE uep.user_id = $userId AND uep.notification_type = $type LIMIT 1`.
3. Update `sendEmail` and `sendEmailBatch` to pass `userId` where available. For callers that only have the email, add a sub-select or a lookup step before calling this function.

FILES: `apps/web/lib/notifications/email.ts`

---

### FIX-E5 (BUG-14 + BUG-15 + BUG-32): Fix `ON CONFLICT DO NOTHING` Missing Conflict Targets

Three files, same fix pattern — add explicit conflict targets:

1. `seasonEngine.ts` → `ON CONFLICT (season_id, milestone_number) DO NOTHING`
2. `milestoneStickers.ts` → `ON CONFLICT (user_id, pack_id) DO NOTHING`
3. `flashXP.ts` → `ON CONFLICT (name, starts_at) DO NOTHING` (or add a unique index on `source_flash_xp_id` and use that)

FILES: `apps/web/lib/seasons/seasonEngine.ts`, `apps/web/lib/stickers/milestoneStickers.ts`, `apps/web/lib/events/flashXP.ts`

---

### FIX-E6 (BUG-40): Implement or Remove the 200-Coin Re-engagement Promise

Decision point — choose one approach:

**Option A (Implement):** At the time of dispatching the 90-day re-engagement notification, call `creditCoins(userId, 200, 'reengagement_bonus', referenceKey, ...)` with a `pending_claim` status flag. Create a CRON job that expires unclaimed reengagement bonuses after 7 days (set balance back or mark the ledger entry void). Track the dispatch in a `reengagement_dispatches` table to prevent duplicate grants.

**Option B (Remove the Promise):** Change the 90-day notification copy to remove any mention of reserved coins. Replace with a non-monetary hook (e.g., "Your old friends are still here — come see what you've missed").

FILES: `apps/web/lib/notifications/reengagement.ts`, and if Option A: `apps/web/lib/economy/coins.ts`, new CRON handler

---

## GROUP F — Code Quality & Minor Issues (Fix Last)

### FIX-F1 (BUG-22 + BUG-23): Remove `axios` and Deduplicate OAuth State Generator

1. Rewrite `exchangeGoogleCode` using `fetch`: POST to `GOOGLE_TOKEN_ENDPOINT` with `application/x-www-form-urlencoded` body, parse the JSON response.
2. Rewrite `fetchGoogleUserProfile` using `fetch`: GET to `GOOGLE_USERINFO_ENDPOINT` with `Authorization: Bearer` header.
3. Remove the `import axios from 'axios'` line.
4. Delete `generateOAuthState()` from `google.ts`. Update calling code to import `generateCsrfToken` from `lib/security/csrf.ts`.

FILES: `apps/web/lib/auth/google.ts`

---

### FIX-F2 (BUG-24): Remove Unnecessary `async` From `getReengagementPayload`

1. Remove the `async` keyword from the function declaration.
2. Change the return type annotation to `ReengagementPayload | null`.
3. Update all callers to remove the `await`.

FILES: `apps/web/lib/notifications/reengagement.ts`

---

### FIX-F3 (BUG-34): Replace CommonJS `require('crypto')` With ESM Import

1. Add `import { createHash, createCipheriv, createDecipheriv } from 'crypto'` at the top of `fieldEncryption.ts` (alongside existing imports).
2. Remove `const crypto = require('crypto')` from both v1 functions.
3. Replace `crypto.createHash` / `crypto.createCipheriv` / `crypto.createDecipheriv` calls with the directly imported functions.

FILES: `apps/web/lib/security/fieldEncryption.ts`

---

### FIX-F4 (BUG-30): Eliminate Dynamic Column Interpolation in `recordWarContribution.ts`

1. Replace the single interpolated UPDATE with two explicit SQL branches:
   ```
   if (is_challenger) {
     await db.query('UPDATE guild_wars SET challenger_points = challenger_points + $1, updated_at = NOW() WHERE id = $2', [pts, war_id]);
   } else {
     await db.query('UPDATE guild_wars SET defender_points = defender_points + $1, updated_at = NOW() WHERE id = $2', [pts, war_id]);
   }
   ```
2. Remove the `col` variable entirely.

FILES: `apps/web/lib/guilds/recordWarContribution.ts`

---

### FIX-F5 (BUG-31): Use Validated `env` in Admin Actions Route

1. Add `import { env } from '@/lib/env'` to the admin actions route.
2. Replace `process.env.NEXT_PUBLIC_APP_URL ?? "https://zobia.app"` with `env.NEXT_PUBLIC_APP_URL`.

FILES: `apps/web/app/api/admin/users/[userId]/actions/route.ts`

---

### FIX-F6 (BUG-33): Parameterize National Leaderboard Country Code

1. Add a `country: string` parameter to the relevant leaderboard query function.
2. Update the SQL to use `WHERE country = $country` as a parameterized value.
3. Update the calling route to pass `auth.user.country` (or derive the country from the user's profile).

FILES: `apps/web/lib/leaderboards/engine.ts`

---

### FIX-F7 (BUG-36): Guard Mystery XP Drop Against Small Candidate Pool

1. Add a fallback: if `eligibleResult.rows.length < batchSize / 2`, consider either running a full table scan as fallback or skipping this CRON invocation and logging a warning.
2. Alternatively, check total eligible user count before sampling and conditionally use `ORDER BY RANDOM()` for small tables.

FILES: `apps/web/lib/mystery/xpDrop.ts`

---

### FIX-F8 (BUG-37): Add Length Validation to AI Classifier System Prompt Override

1. In `getManifestConfig()`, after reading `ai_moderation_system_prompt`, add: `if (systemPromptOverride.length > 4000) systemPromptOverride = ''` (fall back to built-in prompt).
2. Log a warning when the override is too long so admins are aware.

FILES: `apps/web/lib/moderation/aiClassifier.ts`

---

## GROUP G — Quality Ceiling: Observability, Security Hardening, TypeScript Integrity (BUG-41–52)

*These raise the codebase from 8.3 to 9.7+. Independently schedulable after Groups A–F are merged.*

---

### FIX-G1 (BUG-41): Replace Custom HTML Sanitizer With `sanitize-html` Library

1. Install `sanitize-html` and `@types/sanitize-html`.
2. Replace the entire `lib/security/htmlSanitizer.ts` implementation with a thin wrapper around `sanitizeHtml(input, { allowedTags: [...], allowedAttributes: {...} })` using the same allowlist that currently exists in the file.
3. Delete the hand-rolled regex parsing logic.
4. Verify `sanitizeAnnouncementContent` for markdown also uses the library for any embedded HTML fragments.

FILES: `apps/web/lib/security/htmlSanitizer.ts`, `package.json`

---

### FIX-G2 (BUG-42): Implement JWT Key Rotation With `kid` Versioning

1. Store the active signing secret(s) in Redis as a hash: `HSET jwt_keys <kid> <secret>` with a `current_kid` pointer key.
2. When signing tokens, read `current_kid` and include it in the JWT header (`kid` claim). Sign with the corresponding secret.
3. When verifying tokens, read the `kid` header, look up the matching secret, and verify. Fall back to the legacy secret if `kid` is absent (for tokens minted before the change).
4. Implement a key-rotation CRON that generates a new secret, sets it as `current_kid`, and sets a TTL of `max_token_lifetime + 1 day` on old keys so in-flight tokens still verify during the overlap window.
5. Document the rotation procedure.

FILES: `apps/web/lib/auth/jwt.ts`, `apps/web/lib/auth/session.ts`, new CRON handler

---

### FIX-G3 (BUG-43): Add Structured Logging and Request Correlation IDs

1. Install `pino` and `pino-http` (or the equivalent for Edge runtime: `pino/browser` with a custom transport).
2. Create `lib/logger.ts` exporting a configured `pino` instance with `level` driven by `LOG_LEVEL` env var (default `'info'` in prod, `'debug'` in dev).
3. Add an `AsyncLocalStorage<{ requestId: string }>` store. Populate it in middleware from `x-request-id` header (or generate a UUID if absent) and propagate it to all log calls via `logger.child({ requestId })`.
4. Replace all `console.error`, `console.warn`, and `console.log` calls in lib/ and route handlers with the structured logger.
5. Ensure `requestId` is returned in error responses as `X-Request-ID` header so clients can correlate support tickets.

FILES: new `apps/web/lib/logger.ts`, `apps/web/middleware.ts`, all lib/ modules with console calls

---

### FIX-G4 (BUG-44): Add Endpoint-Level Global Rate Cap to Rate Limiter

1. In `lib/security/rateLimit.ts`, add a second Lua script (or extend the existing one) that increments a global counter keyed by path: `rate:global:{method}:{pathname}` with a sliding window.
2. Add a `globalLimit` field to `RATE_LIMITS` entries for sensitive endpoints (payment initiation, auth, payout).
3. In `enforceRateLimit`, check the global counter after the per-user/per-IP check; throw `429` with `code: 'GLOBAL_RATE_LIMIT'` if exceeded.
4. Set conservative starting values: 1,000 req/min per endpoint globally.

FILES: `apps/web/lib/security/rateLimit.ts`

---

### FIX-G5 (BUG-45): Log Read-Path Admin Access to Audit Table

1. In `auditLog.ts`, confirm `'kyc_viewed'` and add `'financial_read'`, `'user_profile_read'` to the `AuditAction` union.
2. In every admin GET route that reads sensitive data (user profile, KYC documents, financial records), call `logAuditEvent({ adminId, action: 'kyc_viewed', targetUserId, ...})` after the data is fetched.
3. Ensure the audit INSERT is fire-and-forget (do not block the response) but does log failures.

FILES: `apps/web/lib/audit/auditLog.ts`, all admin GET route handlers

---

### FIX-G6 (BUG-46): Add Circuit Breaker to Database Adapter

1. Extend the existing circuit breaker pattern from `lib/payments/circuit.ts` (or create `lib/db/circuit.ts`).
2. Wrap the `db.query` and `db.transaction` methods: after N consecutive timeout/connection errors within a 30-second window, open the circuit and return HTTP 503 immediately for new requests.
3. Add a half-open probe after a configurable cool-down period (default 15 seconds).
4. Expose circuit state via the health check endpoint (FIX-G9).

FILES: `apps/web/lib/db/index.ts`, `apps/web/lib/payments/circuit.ts` (as reference), new `apps/web/lib/db/circuit.ts`

---

### FIX-G7 (BUG-47): Add DLQ Depth Monitoring and Alerting

1. Create a CRON handler (or add to an existing daily health CRON): query `SELECT COUNT(*) FROM xp_award_dlq WHERE processed_at IS NULL`.
2. If count exceeds a configurable threshold (e.g., 100 unprocessed entries), insert a row into `system_alerts` table (create the table if absent: `id`, `alert_type`, `payload`, `created_at`, `resolved_at`).
3. Optionally send an email/Slack notification to the ops address.
4. The threshold should be read from the x_manifest feature config so it can be tuned without a deploy.

FILES: `apps/web/lib/xp/dlq.ts` (or new CRON handler), new migration for `system_alerts`

---

### FIX-G8 (BUG-48): Add Graceful Shutdown Handler

1. In the Next.js custom server entry point (or a top-level `instrumentation.ts` if using Next 14's instrumentation hook), register handlers for `SIGTERM` and `SIGINT`.
2. On signal receipt: stop accepting new requests, wait for in-flight requests to complete (with a max wait of 10 seconds), drain the DB connection pool (`await db.end()`), drain Redis (`await redis.quit()`), then exit.
3. Set the `server.keepAliveTimeout` and `server.headersTimeout` appropriately for containerised deployments.

FILES: `apps/web/instrumentation.ts` (new or existing), `apps/web/lib/db/index.ts`, `apps/web/lib/redis.ts`

---

### FIX-G9 (BUG-49): Add `GET /api/health` Endpoint

1. Create `apps/web/app/api/health/route.ts`.
2. The handler should:
   - Ping the DB: `await db.query('SELECT 1')` with a 2-second timeout.
   - Ping Redis: `await redis.ping()` with a 1-second timeout.
   - Return `{ status: 'ok', db: 'ok', redis: 'ok', circuit: dbCircuitState }` with HTTP 200 if all pass.
   - Return HTTP 503 with individual component statuses if any check fails.
3. Exempt this route from auth middleware and rate limiting.
4. Add the endpoint URL to uptime monitoring configuration docs.

FILES: new `apps/web/app/api/health/route.ts`

---

### FIX-G10 (BUG-50): Enforce TypeScript Strict Mode Throughout

1. In `apps/web/tsconfig.json`, ensure `"strict": true` is set (enables `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, etc.).
2. Run `tsc --noEmit` and address all new type errors introduced by strict mode.
3. Key areas to address: replace `as never` casts in `manifest/index.ts` (see FIX-G12), replace unsafe `JSON.parse(...) as Record<string, unknown>` patterns with `zod`-parsed types, add explicit `null` checks where strict mode flags optional accesses.
4. Enable `"noUncheckedIndexedAccess": true` in tsconfig for extra array/object safety.

FILES: `apps/web/tsconfig.json`, `apps/web/lib/manifest/index.ts`, `apps/web/lib/moderation/aiClassifier.ts`, and any file that fails `tsc --noEmit`

---

### FIX-G11 (BUG-51): Accept Injected DB Adapter in High-Value Lib Functions

1. Audit all lib modules that perform DB queries and currently hardcode `import { db } from '@/lib/db'`.
2. For functions that handle money (coins, stars, payouts, referral commissions, XP), change the function signature to accept an optional `client` parameter (a `PoolClient` or compatible interface) and default to the module-level `db` if not provided.
3. This makes these functions both testable with a mock and usable inside an existing transaction for true atomicity.
4. Priority files: `lib/economy/coins.ts`, `lib/economy/stars.ts`, `lib/xp/safeAwardXP.ts`, `lib/referrals/commissions.ts`.

FILES: `apps/web/lib/economy/coins.ts`, `apps/web/lib/economy/stars.ts`, `apps/web/lib/xp/safeAwardXP.ts`, `apps/web/lib/referrals/commissions.ts`

---

### FIX-G12 (BUG-52): Fix `feat()` Type Safety in `manifest/index.ts`

1. Remove the `as never` cast from the `feat()` helper.
2. Change the key parameter type to `keyof typeof DEFAULT_MANIFEST['features']` so TypeScript enforces that only valid feature keys are passed.
3. For any call site that passes a dynamic string, narrow the type at the call site using a type guard or a `z.enum([...featureKeys])` parse of the manifest key.
4. Add a compile-time assertion (e.g., `satisfies`) to catch any future drift between the type and the runtime object.

FILES: `apps/web/lib/manifest/index.ts`

---

## Implementation Sequence Summary

```
Week 1: Group A (Schema — must be first)
  A1 → A2 → A3 → A4 → A5 → A6 → A7

Week 2: Groups B, C, D (can run in parallel)
  B1, B2, B3 in parallel with
  C1, C2, C3, C4, C5 in parallel with
  D1, D2, D3, D4

Week 3: Groups E, F (can run in parallel)
  E1, E2, E3, E4, E5, E6 in parallel with
  F1, F2, F3, F4, F5, F6, F7, F8

Week 4: Group G — Quality Ceiling (independently schedulable after A–F are merged)
  G1, G2, G3, G4, G5, G6, G7, G8, G9 can run in parallel
  G10 (TypeScript strict) should run after G1–G9 are merged (all remaining type errors surface together)
  G11 (adapter injection) can run in parallel with G10
  G12 (feat() fix) is a 30-minute task — do it first in Week 4 to unblock G10
```

Total estimated effort:
- Groups A–F (BUG-01–40): ~40–55 engineering hours
- Group G (BUG-41–52): ~35–50 additional engineering hours
- Combined total: ~75–105 engineering hours

---

*Fix plan generated: June 14, 2026, 09:27 PM*
*Updated: June 14, 2026, 09:48 PM (added Group G — BUG-41 through BUG-52)*
*Based on: custom-bugs-report.md (52 bugs, forensic static analysis)*
