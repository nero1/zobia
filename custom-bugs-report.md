# Zobia Social — Comprehensive Bug & Code Quality Report

**Generated:** June 14, 2026, 09:27 PM
**Scope:** Full forensic analysis — `apps/web` (Next.js 14 App Router, all API routes, all lib/ modules)
**Method:** Deep static analysis, three full sweeps of all files

---

## Quick Reference: All Issues (One-Line Descriptions)

1. TOTP implementation duplicated inline in the 2FA verify route instead of importing the shared module
2. `questEngine.ts` TRACK_COLUMN map missing the `knowledge` track — knowledge-track XP never credited
3. `referral_commissions` GROUP BY `tier` column that does not exist in schema or INSERT — runtime SQL crash
4. Gift send route checks `gift_items.is_active` but the `giftItems` schema table has no `is_active` column
5. Gift send route INSERTs `gift_item_id` into `gifts` table but schema defines the FK column as `giftTypeId`
6. `contentFilter.ts` queries `FROM messages` table which does not exist in the Drizzle schema
7. `leaderboards/engine.ts` queries `FROM messages` table in two functions — same wrong table reference
8. `monthlyGiftDrop.ts` notification INSERT uses `title`, `body`, `metadata` columns absent from the notifications schema (which uses `payload`)
9. `monthlyGiftDrop.ts` passes `drop.id` as `$1` but the SQL text never references `$1` — unused parameter
10. `total_messages` counter incremented even for messages awaiting moderation approval
11. Pin data (`is_pinned`, `pin_expires_at`) queried in `rowToMessage()` but stripped before returning — pin state never delivered to clients
12. `withAdminAuth` skips geo-anomaly detection that `withAuth` applies — admin sessions have weaker anomaly protection
13. Pre-auth 2FA token placed directly in the web redirect URL (browser history / server logs exposure)
14. `seedSeasonPassMilestones` uses `ON CONFLICT DO NOTHING` without specifying a conflict target
15. `user_sticker_packs` INSERT in `milestoneStickers.ts` uses `ON CONFLICT DO NOTHING` without a conflict target
16. `checkDeckCompletion` awards 500 XP with raw SQL, bypassing `safeAwardXP` and the dead-letter queue
17. Payout velocity fraud check counts system retries as user requests — legitimate creators falsely flagged
18. Gift send route performs no room membership check when a `roomId` context is provided
19. `debitCoins`/`creditCoins` called with `referenceId = null` in gift send — no DB-level idempotency for retries
20. `isEmailTypeEnabledForUser` queries by email address instead of user ID — ambiguous across soft-deleted accounts
21. No per-user session limit enforced — unlimited concurrent sessions allowed
22. `lib/auth/google.ts` uses `axios` for HTTP while the rest of the codebase uses native `fetch`
23. `generateOAuthState()` in `google.ts` exactly duplicates `generateCsrfToken()` from `lib/security/csrf.ts`
24. `getReengagementPayload()` declared `async` with no `await` — unnecessary async wrapper
25. `user_badges` has both `awardedAt` and `grantedAt` columns; inserts across the codebase populate them inconsistently
26. Two separate gift-type tables (`gift_types` and `gift_items`) with overlapping purpose — root cause of BUG-04 and BUG-05
27. `guildWarMembers` Drizzle ORM name maps to `war_contributions` DB table — naming mismatch
28. Two UUID generator helpers in schema.ts: `uuidPk()` uses `uuid_generate_v4()`, `uuidPkGen()` uses `gen_random_uuid()`
29. Referral first-purchase XP awarded with raw SQL, bypassing `safeAwardXP` and the dead-letter queue
30. `recordWarContribution.ts` interpolates a column name directly into SQL without parameterization
31. Admin actions route uses `process.env.NEXT_PUBLIC_APP_URL` directly instead of the validated `env` import
32. Flash XP `platform_events` upsert uses `ON CONFLICT DO NOTHING` without a conflict target
33. National leaderboard scope hardcoded to `country = 'NG'`
34. v1 field encryption uses CommonJS `require('crypto')` inside an ESM module function body
35. `room_subscriptions`, `creator_earnings`, `store_items`, `user_subscriptions` tables used in webhook but absent from Drizzle schema
36. Mystery XP Drop uses `TABLESAMPLE BERNOULLI(5)` which may return far fewer than `batchSize` recipients on small tables
37. AI classifier accepts an unbounded admin-controlled system prompt override with no length or content validation
38. `user_badges` INSERT in `milestoneStickers.ts` omits `granted_at`, while `trackMilestones.ts` sets both redundant columns
39. `trackMilestones.ts` sets `badge_type = badge_key` — `badge_type` should be a semantic category string, not the full key
40. Re-engagement "200 Coins reserved" notification body has no backing coin-reservation mechanism

---

## Detailed Bug Entries

---

### BUG-01: TOTP Implementation Duplicated in 2FA Verify Route

FILES:
- `apps/web/app/api/auth/2fa/verify/route.ts`
- `apps/web/lib/auth/totp.ts`

FIX: The 2FA verify route contains a complete inline copy of `base32Decode`, `generateTOTP`, and `verifyTOTP` rather than importing from `lib/auth/totp.ts`. Any future fix or security improvement applied to the shared module (window size, algorithm, timing safety) will not propagate to the route. Verify both implementations are currently identical, delete the inline copies from the route, and import `verifyTotp` from `lib/auth/totp.ts`.

---

### BUG-02: `knowledge` Track Missing From `TRACK_COLUMN` Map in `questEngine.ts`

FILES:
- `apps/web/lib/quests/questEngine.ts`

FIX: The `TRACK_COLUMN` map (used to identify which DB column to update when awarding track XP) defines entries for `social`, `creator`, `competitor`, `generosity`, and `explorer` but not `knowledge`. Any quest that awards XP to the `knowledge` track silently skips the `UPDATE users SET xp_knowledge = ...` step — users never accumulate knowledge-track XP. Add `knowledge: "xp_knowledge"` to the map.

---

### BUG-03: `referral_commissions` Queried by Non-Existent `tier` Column — Runtime SQL Crash

FILES:
- `apps/web/lib/referrals/commissions.ts`

FIX: `getCommissionStats` uses `GROUP BY tier` to summarise commissions. The `tier` column does not exist in the Drizzle `referralCommissions` schema and is not included in any INSERT. The query throws `ERROR: column "tier" does not exist` at runtime. Either add a `tier` column to the table (with a migration and populated value on INSERT), or rewrite the grouping to use an existing column such as `referral_type`.

---

### BUG-04: `gift_items.is_active` Column Does Not Exist in Schema

FILES:
- `apps/web/app/api/economy/gifts/send/route.ts`
- `apps/web/lib/db/schema.ts`

FIX: The gift send route filters with `WHERE gi.is_active = TRUE` against the `gift_items` table, but the Drizzle `giftItems` schema defines no `is_active` column — only `giftTypes` has `isActive`. The query will fail at runtime with "column gi.is_active does not exist". Either add an `is_active` column to `gift_items` via migration, or redirect the active-status check to `gift_types` (see BUG-26 for the broader schema consolidation).

---

### BUG-05: Gift Send Inserts `gift_item_id` But Schema Defines FK as `gift_type_id`

FILES:
- `apps/web/app/api/economy/gifts/send/route.ts`
- `apps/web/lib/db/schema.ts`

FIX: The Drizzle `gifts` table defines `giftTypeId` (FK → `gift_types`). The gift send route INSERTs the column as `gift_item_id` (referencing `gift_items`). These are different tables and different column names. The INSERT will fail with "column gift_item_id does not exist" at runtime. Decide on one canonical gift-definition table (see BUG-26), update the schema FK column name accordingly, and align the INSERT.

---

### BUG-06: `contentFilter.ts` Queries Non-Existent `messages` Table

FILES:
- `apps/web/lib/moderation/contentFilter.ts`

FIX: `detectDuplicateMessage` and `detectBotBehavior` both query `FROM messages`. This table is absent from the Drizzle schema; room messages live in `room_messages`. As a result both functions return zero rows, so duplicate-message and bot-behavior detection are silently disabled for all room messages. Change the table reference to `room_messages` and verify that column names (`sender_id`, `room_id`, `content`, `deleted_at`) match the actual table.

---

### BUG-07: `leaderboards/engine.ts` Queries Non-Existent `messages` Table

FILES:
- `apps/web/lib/leaderboards/engine.ts`

FIX: `getUserMetricsForWeighting` references `FROM messages` in two places. The `messages` table is not in the schema. If the intent is room messages, change the reference to `room_messages`. If the intent is DM messages, confirm the actual table name. In both cases the leaderboard weighting query silently returns zero message counts for every user, distorting the leaderboard scores.

---

### BUG-08: `monthlyGiftDrop.ts` Notification INSERT Uses Wrong Column Set

FILES:
- `apps/web/lib/events/monthlyGiftDrop.ts`
- `apps/web/lib/notifications/insert.ts`

FIX: `processPendingGiftDrops` INSERTs notifications using columns `(user_id, type, title, body, metadata, is_read, created_at)`. The shared `insertNotification` helper and all other notification INSERTs in the codebase (e.g., `flashXP.ts`) use `(user_id, type, payload, is_read, created_at)` — a single JSON `payload` column rather than separate `title`/`body`/`metadata`. The gift-drop INSERT will fail at runtime because those columns do not exist on the `notifications` table. Replace the raw INSERT with a call to `insertNotificationBatch` from `lib/notifications/insert.ts`, embedding the title and body inside the `payload` JSON object.

---

### BUG-09: `monthlyGiftDrop.ts` Passes `drop.id` as `$1` But SQL Never References `$1`

FILES:
- `apps/web/lib/events/monthlyGiftDrop.ts`

FIX: The notification INSERT query references only `$2::jsonb` (the JSON metadata). The params array is `[drop.id, JSON.stringify({ giftDropId: drop.id })]`, making `$1 = drop.id` an unused orphaned parameter. PostgreSQL accepts extra parameters silently, but this signals a copy-paste defect. The correct fix depends on intent: if `$1` was meant to scope notifications to a specific user, the WHERE clause is missing it. Most likely the fix is to remove `drop.id` from params and renumber: params become `[JSON.stringify({ giftDropId: drop.id })]` with `$1::jsonb` in SQL. (This bug is already partly masked by BUG-08 — both must be fixed together.)

---

### BUG-10: `total_messages` Incremented for Pending-Approval Messages

FILES:
- `apps/web/app/api/rooms/[roomId]/messages/route.ts`

FIX: When a room requires message approval, new messages are inserted with `status = 'pending_approval'` and are not yet visible to other members. However, the route still increments `room_members.total_messages` at the time of INSERT. This counter should only reflect approved, visible messages. Either move the increment to the approval handler, or add a conditional in the current route: skip the increment when `approval_required = true`.

---

### BUG-11: Pin Status Queried But Stripped From Response

FILES:
- `apps/web/app/api/rooms/[roomId]/messages/route.ts`

FIX: The SELECT query fetches `is_pinned`, `pinned_at`, and `pin_expires_at` from `room_messages`, but `rowToMessage()` does not include these fields in the object it returns. Pin status is therefore never delivered to the client. Add `isPinned`, `pinnedAt`, and `pinExpiresAt` to `rowToMessage()`'s return object. Account for expired pins: treat a row as unpinned when `pin_expires_at` is non-null and in the past.

---

### BUG-12: `withAdminAuth` Skips Geo-Anomaly Detection

FILES:
- `apps/web/lib/api/middleware.ts`
- `apps/web/lib/security/geoAnomaly.ts`

FIX: `withAuth` calls `isIpAnomalous` and `recordAndCheckAnomaly` on every authenticated request. `withAdminAuth` does not. Admin sessions should receive at least the same geo-anomaly protection as regular sessions, if not stricter. Extract the geo-anomaly block from `withAuth` into a shared `checkGeoAnomaly(session, currentIp)` helper and call it from both middleware functions.

---

### BUG-13: Pre-Auth 2FA Token Exposed in Web Redirect URL

FILES:
- `apps/web/app/api/auth/google/callback/route.ts`

FIX: The web 2FA flow redirects to `/auth/2fa?token=<rawJWT>`. The JWT appears in browser history, Referer headers on any outbound navigation from the 2FA page, and server access logs. The mobile flow correctly uses an opaque one-time Redis code. Apply the same pattern to the web flow: store the pre-auth token in Redis keyed by a random code (`randomBytes(32).toString('hex')`), put only the code in the redirect (`?code=<code>`), and have the 2FA page POST the code to a server endpoint to exchange it for the token server-side.

---

### BUG-14: `ON CONFLICT DO NOTHING` Without Conflict Target in `seedSeasonPassMilestones`

FILES:
- `apps/web/lib/seasons/seasonEngine.ts`

FIX: PostgreSQL requires an explicit conflict target when using `ON CONFLICT DO NOTHING` unless the table has exactly one unique or primary key constraint. If `season_pass_milestones` has multiple constraints the statement throws `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification`. Add the explicit target: `ON CONFLICT (season_id, milestone_number) DO NOTHING`.

---

### BUG-15: `user_sticker_packs` INSERT Missing Explicit Conflict Target

FILES:
- `apps/web/lib/stickers/milestoneStickers.ts`

FIX: Same issue as BUG-14. Change `ON CONFLICT DO NOTHING` to `ON CONFLICT (user_id, pack_id) DO NOTHING`.

---

### BUG-16: `checkDeckCompletion` XP Bonus Bypasses `safeAwardXP` and Dead-Letter Queue

FILES:
- `apps/web/lib/quests/questEngine.ts`

FIX: The 500 XP deck-completion bonus is awarded via raw `UPDATE users SET xp_total = xp_total + 500` plus a direct `xp_ledger` INSERT. If either write fails, the XP is silently lost with no DLQ entry. Replace with `safeAwardXP(userId, 500, 'main', 'deck_completion', ...)` so transient failures land in the dead-letter queue and can be retried.

---

### BUG-17: Payout Velocity Fraud Check Counts System Retries as User Requests

FILES:
- `apps/web/lib/fraud/payouts.ts`

FIX: The velocity check counts all payout rows for a user in the past 30 days regardless of status. A payout that failed and was auto-retried 3 times creates 3 rows, all counted against the velocity threshold. A creator with a bank account error could have multiple retried-failed payouts and be incorrectly flagged as a fraud risk. Filter to count only user-initiated original requests: add a `WHERE initiated_by = 'user'` condition, or filter out rows with status `IN ('retrying', 'failed')` that were system-generated.

---

### BUG-18: No Room Membership Check for Gift Send With `roomId`

FILES:
- `apps/web/app/api/economy/gifts/send/route.ts`

FIX: The gift send route accepts an optional `roomId` to attribute the gift to a room context (war contributions, room leaderboards). It does not verify that the sender is a member of the specified room. A user could attribute gifts to rooms they never joined, inflating contribution scores for rooms they have no association with. Add a membership check before processing: `SELECT 1 FROM room_members WHERE room_id = $roomId AND user_id = $senderId AND left_at IS NULL`.

---

### BUG-19: Gift Send Coin Operations Called With `referenceId = null`

FILES:
- `apps/web/app/api/economy/gifts/send/route.ts`
- `apps/web/lib/economy/coins.ts`

FIX: `debitCoins` (sender) and all `creditCoins` calls (recipient, platform fee) receive `referenceId: null`. The idempotency mechanism in the coin ledger relies on `reference_id` being a unique value to detect duplicate requests. If a client retries a gift send after a partial failure (coins debited, gift INSERT failed), the retry will debit again because there is no reference ID to match against. Use the gift's Redis idempotency key (stored as `gift:idem:{key}`) as the `referenceId` for all ledger entries, or create the `gifts` row first and use its UUID.

---

### BUG-20: `isEmailTypeEnabledForUser` Queries by Email Address, Not User ID

FILES:
- `apps/web/lib/notifications/email.ts`

FIX: The preference lookup joins `user_email_preferences` to `users` via `u.email = $1`. If a user account was soft-deleted and a new account was created with the same email (permitted by the Google OAuth upsert flow), multiple rows could exist for that email. Querying by email is also slower than by UUID. Change the function signature to accept `userId: string` in addition to or instead of the email address, and query by `uep.user_id = $userId` directly without the `users` join.

---

### BUG-21: No Per-User Session Limit Enforced

FILES:
- `apps/web/lib/auth/session.ts`

FIX: `createSession` adds each new session to the Redis `user_sessions:{userId}` sorted set without checking or enforcing a maximum. A compromised credential set or a user logging in from many devices could accumulate unlimited sessions. Add a post-insert trim: `ZREMRANGEBYRANK user_sessions:{userId} 0 -(MAX_SESSIONS+1)` immediately after inserting the new session (e.g., keep the 10 most-recent). This limits blast radius if a refresh token is leaked and prevents indefinite session accumulation.

---

### BUG-22: `lib/auth/google.ts` Uses `axios` Instead of Native `fetch`

FILES:
- `apps/web/lib/auth/google.ts`

FIX: `exchangeGoogleCode` and `fetchGoogleUserProfile` use `axios` while every other outbound HTTP call in the codebase (Mailgun, Expo push, Paystack, Ably, SSRF guard) uses native `fetch`. This adds the `axios` package as a runtime dependency for two functions that can be trivially rewritten with `fetch`. Replace both with native `fetch` calls and remove the `axios` import.

---

### BUG-23: `generateOAuthState()` Duplicates `generateCsrfToken()`

FILES:
- `apps/web/lib/auth/google.ts`
- `apps/web/lib/security/csrf.ts`

FIX: Both functions are identical: `randomBytes(32).toString('hex')`. Delete `generateOAuthState` from `google.ts`. Update any callers (the Google OAuth initiation route) to import `generateCsrfToken` from `lib/security/csrf.ts`, which is the canonical security-token-generation module.

---

### BUG-24: `getReengagementPayload` Declared `async` With No Awaits

FILES:
- `apps/web/lib/notifications/reengagement.ts`

FIX: The function is marked `async` and the return type is `Promise<ReengagementPayload | null>`, but the function body is entirely synchronous — there are no `await` expressions. The `async` keyword is misleading and forces callers to unnecessarily `await` a synchronous result. Remove `async`, change the return type to `ReengagementPayload | null`, and update all callers to drop the `await`.

---

### BUG-25: `user_badges` Has Redundant `awardedAt` and `grantedAt` Columns; Inserts Are Inconsistent

FILES:
- `apps/web/lib/db/schema.ts`
- `apps/web/lib/xp/trackMilestones.ts`
- `apps/web/lib/stickers/milestoneStickers.ts`

FIX: The schema defines both `awardedAt` and `grantedAt`. `trackMilestones.ts` sets both to `NOW()`. `milestoneStickers.ts` sets only `awarded_at`. Any query that reads the column not set by a particular INSERT path gets NULL. Pick one column as the canonical grant timestamp (recommend `granted_at`), drop the other from the schema via migration, and update all INSERT and SELECT statements to use only the surviving column.

---

### BUG-26: Two Separate Gift-Definition Tables (`gift_types` and `gift_items`) With Overlapping Purpose

FILES:
- `apps/web/lib/db/schema.ts`
- `apps/web/app/api/economy/gifts/send/route.ts`
- `apps/web/app/api/economy/gifts/route.ts`
- `apps/web/lib/events/monthlyGiftDrop.ts`

FIX: `giftTypes` has `isActive` and `coinCost`. `giftItems` has `coinCost` but no `isActive`. The gift history route JOINs `gift_items`. The gift send route reads from `gift_items` but checks a column (`is_active`) only on `gift_types`. The `gifts` FK points at `gift_types`. This schema ambiguity is the direct root cause of BUG-04 and BUG-05 and causes divergent code paths throughout the gift system. Consolidate into a single table (recommend `gift_items` as the canonical name since it is used by more active code paths), run a migration to merge data, update the `gifts` FK, and update all code references.

---

### BUG-27: `guildWarMembers` Drizzle ORM Name Maps to `war_contributions` DB Table

FILES:
- `apps/web/lib/db/schema.ts`
- `apps/web/lib/guilds/recordWarContribution.ts`

FIX: The Drizzle ORM export is named `guildWarMembers` but the underlying table is `war_contributions`. The name mismatch makes Drizzle-based queries unreachable via the ORM because the object name suggests a `guild_war_members` table that does not exist. Rename the export to `warContributions` and update any ORM references. The raw SQL in `recordWarContribution.ts` already uses the correct table name.

---

### BUG-28: Two UUID Generator Strategies in schema.ts (`uuid_generate_v4` vs `gen_random_uuid`)

FILES:
- `apps/web/lib/db/schema.ts`

FIX: `uuidPk()` calls `DEFAULT uuid_generate_v4()` (requires the `uuid-ossp` PostgreSQL extension). `uuidPkGen()` calls `DEFAULT gen_random_uuid()` (built into PostgreSQL 13+ without any extension). Some hosting providers (Railway, DigitalOcean) do not enable `uuid-ossp` by default, meaning tables using `uuidPk()` will fail to insert rows unless the extension is explicitly created. Standardize all primary keys on `gen_random_uuid()` via `uuidPkGen()`. Write a migration to verify no table still depends on `uuid_generate_v4`.

---

### BUG-29: Referral First-Purchase XP Bypasses `safeAwardXP` and Dead-Letter Queue

FILES:
- `apps/web/lib/referrals/commissions.ts`

FIX: The XP award for a referrer's first qualifying purchase uses raw `UPDATE users SET xp_total = ...` plus a direct `xp_ledger` INSERT instead of `safeAwardXP`. If either DB write fails, the XP is silently lost. Replace with `safeAwardXP(referrerId, amount, 'main', 'referral_purchase', ...)` to ensure dead-letter queue coverage on failure.

---

### BUG-30: Dynamic Column Name Interpolated Into SQL in `recordWarContribution.ts`

FILES:
- `apps/web/lib/guilds/recordWarContribution.ts`

FIX: Line 77 builds the SQL string by interpolating `col` (`'challenger_points'` or `'defender_points'`) directly: `` UPDATE guild_wars SET ${col} = ${col} + $1 ``. Although the two values are currently hardcoded safe strings derived from a boolean, this pattern bypasses parameterization and creates a fragile SQL-injection-adjacent code pattern that becomes dangerous if the column selection logic is ever refactored. Replace with two explicit SQL strings — one for the challenger branch and one for the defender branch — with no string interpolation.

---

### BUG-31: Admin Actions Route Reads `process.env` Directly Instead of Validated `env`

FILES:
- `apps/web/app/api/admin/users/[userId]/actions/route.ts`

FIX: Line 216 reads `process.env.NEXT_PUBLIC_APP_URL` directly instead of using the Zod-validated `env` object from `lib/env.ts`. This bypasses startup validation and could silently use `undefined` if the variable is unset (falling back to the hardcoded `"https://zobia.app"` string). Import `env` from `lib/env.ts` and use `env.NEXT_PUBLIC_APP_URL`.

---

### BUG-32: Flash XP `platform_events` Upsert Missing Explicit Conflict Target

FILES:
- `apps/web/lib/events/flashXP.ts`

FIX: The `platform_events` INSERT in `advanceFlashXPLifecycle` uses `ON CONFLICT DO NOTHING` without specifying the conflict target. Same root issue as BUG-14. Add the conflict target: `ON CONFLICT (source_flash_xp_id)` (after adding a unique index on that column), or use a composite like `ON CONFLICT (name, starts_at)`.

---

### BUG-33: National Leaderboard Scope Hardcoded to Nigeria

FILES:
- `apps/web/lib/leaderboards/engine.ts`

FIX: The national leaderboard query hardcodes `WHERE country = 'NG'`. If the platform serves users in other countries, their national leaderboards will never appear. Parameterize the country code: accept it as a function argument and pass it from the calling route (which already knows the requesting user's country from their profile).

---

### BUG-34: v1 Field Encryption Uses CommonJS `require('crypto')` Inside ESM Function

FILES:
- `apps/web/lib/security/fieldEncryption.ts`

FIX: `encryptFieldV1` and `decryptFieldV1` call `const crypto = require('crypto')` inside the function body. While Node.js CJS interop makes this work today, it is not idiomatic ESM, breaks in strict ESM environments and edge runtimes that disallow CJS interop, and obscures the dependency. Import the needed functions (`createHash`, `createCipheriv`, `createDecipheriv`) at the top of the file using the existing ESM `import` statement, alongside the v2 imports.

---

### BUG-35: Several Runtime-Used Tables Absent From Drizzle Schema

FILES:
- `apps/web/lib/db/schema.ts`
- `apps/web/app/api/economy/webhooks/paystack/route.ts`
- `apps/web/lib/creator/fund.ts`

FIX: The Paystack webhook handler references `store_items`, `room_subscriptions`, `user_subscriptions`, and `creator_earnings`. `creator/fund.ts` references `creator_earnings` and `sponsored_quest_applications`. None of these appear in `schema.ts`. Without schema definitions there is no migration tracking, no ORM type safety, and no compile-time verification that column names match. Add Drizzle `pgTable` definitions for all missing tables. At minimum create them as annotated raw table stubs so they appear in schema diff output.

---

### BUG-36: Mystery XP Drop `TABLESAMPLE BERNOULLI(5)` May Return Too Few Recipients

FILES:
- `apps/web/lib/mystery/xpDrop.ts`

FIX: `TABLESAMPLE BERNOULLI(5)` samples approximately 5% of rows randomly. On a table with fewer than ~1,000 active users this could return far fewer than the requested `batchSize` of 50. The subsequent `NOT IN (SELECT user_id FROM xp_ledger ...)` subquery shrinks the candidate pool further. For tables smaller than ~2,000 rows, switch to `ORDER BY RANDOM() LIMIT $batchSize` (full scan is acceptable at that scale). For larger tables, verify the expected candidate count before issuing the drop.

---

### BUG-37: AI Classifier System Prompt Override Has No Length or Content Validation

FILES:
- `apps/web/lib/moderation/aiClassifier.ts`

FIX: An admin can set `ai_moderation_system_prompt` in the manifest to replace the built-in classification prompt entirely, with no length limit. An excessively long override wastes tokens and could exhaust the model's context window, degrading classification quality. Add a maximum length check (e.g., 4,000 characters) before accepting the override. Optionally, validate that the override contains the required JSON output format instruction before substituting it.

---

### BUG-38: `milestoneStickers.ts` `user_badges` INSERT Omits `granted_at`

FILES:
- `apps/web/lib/stickers/milestoneStickers.ts`
- `apps/web/lib/xp/trackMilestones.ts`

FIX: `checkStickerCollectorBadges` INSERTs `(user_id, badge_key, awarded_at)`. `trackMilestones.ts` sets both `granted_at` and `awarded_at`. Any query reading `granted_at` for sticker-granted badges finds NULL. This should be resolved as part of BUG-25: pick one canonical column and ensure all INSERT paths set it.

---

### BUG-39: `trackMilestones.ts` Sets `badge_type = badge_key` — Semantic Mismatch

FILES:
- `apps/web/lib/xp/trackMilestones.ts`

FIX: The `user_badges` INSERT sets `badge_type = 'title_${unlockKey}'` and `badge_key = 'title_${unlockKey}'` — both to the same constructed string. `badge_type` is semantically a category (e.g., `"title"`, `"achievement"`, `"collector"`), not the full key. Change to `badge_type = 'title'` (a fixed category constant) and keep `badge_key = 'title_${unlockKey}'` as the unique per-badge identifier.

---

### BUG-40: Re-engagement "200 Coins Reserved" Notification Has No Backing Coin Reservation

FILES:
- `apps/web/lib/notifications/reengagement.ts`

FIX: The 90-day inactivity bucket sends a push notification with the body "We saved 200 Coins for you. They expire in 7 days." and a second variant reading "We reserved 200 Coins just for you." No code creates a pending coin credit at notification dispatch time, no coins are held in escrow, and there is no expiry mechanism. Users who return expecting coins find nothing. Either implement a coin reservation: at dispatch time call `creditCoins(userId, 200, 'reengagement_bonus', ...)` with a flag and expiry job to reclaim unclaimed coins after 7 days, or change the push notification copy to remove the false promise of reserved coins.

---

## Code Quality Ratings

### Current State

| Dimension | Score | Assessment |
|-----------|-------|-----------|
| Architecture | 7.0/10 | Clean provider abstractions, append-only ledger, good DLQ concept — undermined by schema drift |
| Security | 6.0/10 | Good CSRF, timing-safe comparisons, SSRF protection — weakened by admin middleware bypass and token-in-URL |
| Performance | 6.5/10 | Redis caching, FOR UPDATE, Decimal.js done well — N+1 patterns in sticker/milestone paths |
| Reliability | 5.0/10 | DLQ exists but bypassed in multiple places; schema/column mismatches cause silent runtime failures |
| Correctness | 5.0/10 | Several code paths (gift send, referral stats, notifications) will throw runtime errors due to column mismatches |

**Overall Current: 5.9/10**

### Projected Post-Fix State

| Dimension | Score | Assessment |
|-----------|-------|-----------|
| Architecture | 8.0/10 | Consolidated gift table, single UUID strategy, proper module imports |
| Security | 8.5/10 | Admin geo-anomaly parity, opaque pre-auth codes, per-user session cap |
| Performance | 7.5/10 | Cleaner queries, correct indexes implied by explicit ON CONFLICT targets |
| Reliability | 8.5/10 | safeAwardXP used consistently, DLQ coverage complete, schema drift resolved |
| Correctness | 9.0/10 | Schema, column names, and code in sync; runtime crash paths eliminated |

**Overall Post-Fix: 8.3/10**

---

*Report generated: June 14, 2026, 09:27 PM*
*Scope: Full forensic static analysis — apps/web (Next.js 14 App Router + all lib/ modules)*
