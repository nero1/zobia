# Zobia Social — Bug Fix Plan

**Generated:** June 14, 2026, 09:27 PM
**Source:** custom-bugs-report.md (40 confirmed bugs)
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
```

Total estimated effort: ~40–55 engineering hours across all groups.

---

*Fix plan generated: June 14, 2026, 09:27 PM*
*Based on: custom-bugs-report.md (40 bugs, forensic static analysis)*
