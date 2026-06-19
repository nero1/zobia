# Zobia Codebase — Bug Fix Plan

**Generated:** 2026-06-19 06:40 PM  
**Based on:** custom-bugs-report.md (same session, independent forensic analysis)  
**Branch:** `claude/codebase-bug-analysis-zmki1e`

> **IMPORTANT:** Do not apply any fix until each item has been reviewed and approved. Each task is self-contained and can be applied independently. Estimated effort is noted per task (S = <1 hour, M = 1–3 hours, L = 3–8 hours).

---

## Priority Grouping

### P0 — Correctness (feature behaves incorrectly for users today)
- Task 13: BUG-QUEST-02 — double main XP award
- Task 15: BUG-SEASON-01 — season XP counter divergence
- Task 16: BUG-SEASON-02 — milestone XP invisible in season leaderboard
- Task 20: BUG-FUND-01 — creator fund inflation on zero metrics
- Task 21: BUG-NEM-01 — gaming track throws at runtime
- Task 23: BUG-GAME-01 — declineChallenge crashes on concurrent deletion

### P1 — Security / Data Integrity
- Task 1: BUG-SCHEMA-01 — nemesis index constraint violation
- Task 19: BUG-PAY-01 — unsafe type cast in payment webhook
- Task 27: BUG-AUTH-01 — 10-second revoked session window
- Task 28: BUG-AUTH-02 — non-constant-time TOTP comparison
- Task 29: BUG-GIFT-01 — non-transactional gift drop retirement

### P2 — Reliability / Data Loss
- Task 9: BUG-WAR-02 — silent error swallow in war resolution
- Task 10: BUG-PUSH-01 — push receipts checked_at set before processing
- Task 14: BUG-XP-01 — unawaited DLQ write
- Task 22: BUG-ANN-01 — modal view recorded before display

### P3 — Performance / Quality
- Task 6: BUG-RT-01 — Ably unmount cleanup race
- Task 7: BUG-RT-02 — Pusher per-instance clients
- Task 11: BUG-PUSH-02 — stale push token targeting
- Task 26: BUG-MOD-01 — DM bot detection gap

### P4 — Schema / Structural
- Task 2: BUG-SCHEMA-02 — bigint precision
- Task 3: BUG-SCHEMA-03 — nullable room slug
- Task 4: BUG-SCHEMA-04 — partial index qualification
- Task 5: BUG-MW-01 — ZodError not ApiError
- Task 8: BUG-WAR-01 — 2-member war reward split
- Task 12: BUG-QUEST-01 — wrong XP track fallback
- Task 17: BUG-SEASON-03 — ceremony room has no slug
- Task 18: BUG-SEASON-04 — ambiguous sticker_pack lookup
- Task 24: BUG-GAME-02 — interval string concatenation
- Task 25: BUG-GAME-03 — unlimited wager size
- Task 30: BUG-OFFLINE-01 — inflated queue counts

---

## Task Details

---

### Task 1: BUG-SCHEMA-01 — Nemesis unique index constraint on re-deactivation
**Priority:** P1 | **Effort:** S

**Files to change:**
- `apps/web/lib/nemesis/nemesisEngine.ts`

**Steps:**
1. In `assignNemesis`, find every `UPDATE nemesis_assignments SET is_active = FALSE` query and confirm it includes `AND is_active = TRUE` in the WHERE clause. If missing, add it. This makes deactivation a no-op on already-inactive rows.
2. In `refreshNemesisAssignments`, apply the same guard to any deactivation UPDATE.
3. Write a unit test: deactivate an already-inactive assignment and confirm no constraint error.
4. No schema migration needed — the index definition itself is correct.

---

### Task 2: BUG-SCHEMA-02 — bigint coinBalance precision loss
**Priority:** P4 | **Effort:** M

**Files to change:**
- `apps/web/lib/db/schema.ts`
- `apps/web/lib/economy/coins.ts`
- `apps/web/lib/economy/stars.ts`
- Any other file reading monetary bigint fields

**Steps:**
1. Decide on approach: either change bigint columns to `mode: "bigint"` (returns `BigInt` in JS) and update all arithmetic to use `BigInt`, or add a DB `CHECK (coin_balance <= 9007199254740991)` constraint and document the ceiling.
2. If choosing the BigInt approach, update all arithmetic in `coins.ts` and `stars.ts` to handle `BigInt` values, and update API response serializers to convert to string for JSON output (JSON cannot represent large integers).
3. Run `pnpm db:push` or generate a migration for any CHECK constraints added.
4. No urgent user impact today (balances unlikely to exceed 2^53) but fix before any large-scale airdrop or bonus event.

---

### Task 3: BUG-SCHEMA-03 — rooms.slug nullable
**Priority:** P4 | **Effort:** M

**Files to change:**
- `apps/web/lib/db/schema.ts`
- All room-creation paths (search codebase for `INSERT INTO rooms`)

**Steps:**
1. Audit all `INSERT INTO rooms` call sites and confirm each provides a slug. Key sites: room creation API, `createSeasonCeremonyRoom` (fix covered by Task 17).
2. Add a partial DB CHECK constraint: `CHECK (NOT (is_public = TRUE AND slug IS NULL))` to enforce that public rooms always have slugs.
3. For rooms that can be private (no /r/ URL needed), leaving slug nullable is acceptable.
4. Generate a migration for the CHECK constraint.

---

### Task 4: BUG-SCHEMA-04 — pushTickets partial index unqualified column
**Priority:** P4 | **Effort:** S

**Files to change:**
- `apps/web/lib/db/schema.ts`

**Steps:**
1. Find the `pushTickets` index definition and update the `.where()` clause.
2. Change `sql\`status = 'pending'\`` to `sql\`${pushTickets.status} = 'pending'\`` (using the Drizzle column reference) or explicitly qualify as `push_tickets.status = 'pending'`.
3. Generate and apply a migration (`pnpm db:generate && pnpm db:push`). The migration will drop and recreate the index.

---

### Task 5: BUG-MW-01 — validateBody/validateSearchParams throw ZodError not ApiError
**Priority:** P4 | **Effort:** S

**Files to change:**
- `apps/web/lib/api/middleware.ts`

**Steps:**
1. In `validateBody` (line ~471), wrap `schema.parse(raw)` in a try/catch that catches `ZodError` and rethrows as `new ApiError(400, "VALIDATION_ERROR", "Invalid request body", { issues: err.issues })`.
2. Apply the identical fix in `validateSearchParams` (line ~487).
3. Update the JSDoc comments to accurately state the thrown type.
4. Search for any handlers that call `validateBody`/`validateSearchParams` outside `withAuth`/`withErrorHandling` and confirm they now handle the ApiError correctly.

---

### Task 6: BUG-RT-01 — Ably useRealtimeChannel fast-unmount race (web)
**Priority:** P3 | **Effort:** M

**Files to change:**
- `apps/web/lib/realtime/useRealtimeChannel.ts`

**Steps:**
1. At the top of the `useEffect` body, declare `let cancelled = false`.
2. Check `if (cancelled) return` immediately after every `await` inside the effect.
3. In the effect's cleanup function (the returned teardown), set `cancelled = true` first, then call `cleanup()` if assigned.
4. If `cancelled` is set before channel setup completes, skip channel creation entirely.
5. Compare with `apps/expo/lib/realtime/useRealtimeChannel.ts` (correct implementation) as a reference.

---

### Task 7: BUG-RT-02 — Pusher per-instance client multiplication (web)
**Priority:** P3 | **Effort:** M

**Files to change:**
- `apps/web/lib/realtime/useRealtimeChannel.ts`

**Steps:**
1. Create a module-level variable `let pusherSingleton: Pusher | null = null`.
2. In the Pusher branch of the hook, replace `new Pusher(...)` with a lazy initializer: `if (!pusherSingleton) pusherSingleton = new Pusher(...)`.
3. Use `pusherSingleton` for all channel subscriptions.
4. In the effect cleanup, call `channel.unbind_all(); channel.unsubscribe()` but do NOT call `pusherSingleton.disconnect()` (other hook instances may still be using it).
5. Add a `disconnectPusher()` utility function that can be called at app unmount if needed.

---

### Task 8: BUG-WAR-01 — distributeWarRewards 2-member wrong split
**Priority:** P4 | **Effort:** S

**Files to change:**
- `apps/web/lib/guilds/warEngine.ts`

**Steps:**
1. Add a special case at the top of `distributeWarRewards`: if `members.length === 2`, award explicitly defined winner/runner-up percentages (e.g., 60% winner, 40% runner-up) rather than running the general algorithm.
2. If `members.length === 1`, award 100% to the sole member.
3. Write unit tests for 1-, 2-, 3-, and 5-member scenarios, documenting the intended split for each.
4. Consider reading winner/runner-up percentages from the manifest for configurability.

---

### Task 9: BUG-WAR-02 — resolveWar silently swallows tier history errors
**Priority:** P2 | **Effort:** S

**Files to change:**
- `apps/web/lib/guilds/warEngine.ts`

**Steps:**
1. Find `.catch(() => {})` on the guild tier history INSERT inside `resolveWar`.
2. Replace with `.catch((err) => logger.error({ warId, err }, "[resolveWar] Failed to write guild tier history"))`.
3. Optionally: move the tier history INSERT inside the main transaction block so it rolls back atomically with the rest of the war resolution. If kept outside, add a DLQ or retry mechanism.
4. Verify no other silent catches exist in `warEngine.ts`.

---

### Task 10: BUG-PUSH-01 — pollPushReceipts checked_at before processing
**Priority:** P2 | **Effort:** M

**Files to change:**
- `apps/web/lib/notifications/push.ts`

**Steps:**
1. Remove the bulk `UPDATE push_tickets SET checked_at = NOW()` that currently runs before the receipt loop.
2. Move the `checked_at` update to per-ticket: after each ticket's receipt is processed (success, error, or failed), update that individual row's `checked_at`.
3. Alternatively, introduce a `receipt_status` column (`pending | checked | failed`) and track state more granularly.
4. Ensure that `DeviceNotRegistered` receipts trigger token cleanup (deactivate the device token row).

---

### Task 11: BUG-PUSH-02 — Stale device token targeting
**Priority:** P3 | **Effort:** S

**Files to change:**
- `apps/web/lib/notifications/push.ts`

**Steps:**
1. Add `AND last_seen_at > NOW() - INTERVAL '90 days'` (or a configurable env var) to the device token SELECT query in `sendPushNotification` and `sendBulkPushNotification`.
2. In the receipt-processing loop (Task 10 above), when Expo returns `DeviceNotRegistered` for a token, immediately SET `push_token = NULL, push_token_updated_at = NOW()` on that device row so it is never targeted again.
3. Consider adding a CRON task that bulk-nullifies tokens for devices with `last_seen_at` older than 180 days.

---

### Task 12: BUG-QUEST-01 — Wrong XP track fallback for unknown action types
**Priority:** P4 | **Effort:** S

**Files to change:**
- `apps/web/lib/quests/questEngine.ts`

**Steps:**
1. Find the XP track mapping switch/object in `updateQuestProgress`.
2. Replace the silent `?? "main"` fallback with an explicit error path: `logger.error({ actionType }, "[updateQuestProgress] unknown action_type, skipping XP award")` followed by a `return` (no XP awarded for unknown types).
3. Add a TypeScript exhaustive check (`const _: never = actionType`) so any new action type not added to the mapping causes a compile-time error.

---

### Task 13: BUG-QUEST-02 — Quest engine double-awards main XP
**Priority:** P0 | **Effort:** S

**Files to change:**
- `apps/web/lib/quests/questEngine.ts`

**Steps:**
1. Find the parallel-track `safeAwardXP` call inside the quest completion block.
2. Add a null guard before it: `if (quest.parallelTrack !== null && quest.parallelTrack !== undefined) { await safeAwardXP(..., quest.parallelTrack, ...); }`.
3. Remove the `?? "main"` fallback from this specific call site. The primary reward already handles the main track.
4. Write a unit test: complete a quest where `parallelTrack = null` and confirm main XP is awarded exactly once.

---

### Task 14: BUG-XP-01 — safeAwardXP unawaited DLQ write
**Priority:** P2 | **Effort:** S

**Files to change:**
- `apps/web/lib/xp/safeAwardXP.ts`

**Steps:**
1. In the catch block of `safeAwardXP`, add `await` to the `globalDb.query(INSERT INTO failed_xp_awards ...)` call.
2. Keep the inner `.catch((dlqErr) => logger.error(...))` to handle DLQ write failures without throwing.
3. Confirm the outer function signature remains `Promise<void>` — the added `await` does not change the return type.
4. Review whether the global db connection is always available in this context (it should be, as it's the module-level singleton).

---

### Task 15: BUG-SEASON-01 — resetSeasonRankings diverges users.season_xp
**Priority:** P0 | **Effort:** S

**Files to change:**
- `apps/web/lib/seasons/seasonEngine.ts`

**Steps:**
1. In `resetSeasonRankings`, after or alongside the `UPDATE user_season_passes SET season_xp = 0` statement, add: `UPDATE users SET season_xp = 0, updated_at = NOW() WHERE deleted_at IS NULL`.
2. If the reset should only target users who participated in the season, scope it: `WHERE id IN (SELECT user_id FROM user_season_passes WHERE season_id = $seasonId)`.
3. Run both updates inside a transaction to ensure atomicity.
4. Add an assertion in tests: after `resetSeasonRankings`, query both `users.season_xp` and `user_season_passes.season_xp` and confirm both are 0.

---

### Task 16: BUG-SEASON-02 — xp_bonus milestone doesn't update season_xp
**Priority:** P0 | **Effort:** S

**Files to change:**
- `apps/web/lib/seasons/seasonEngine.ts`

**Steps:**
1. In the `xp_bonus` milestone handling block inside `claimPassMilestone`, find the `UPDATE users SET xp_total = xp_total + $bonus` statement.
2. Add `season_xp = season_xp + $bonus` to the same SET clause.
3. Also update `user_season_passes`: `UPDATE user_season_passes SET season_xp = season_xp + $bonus WHERE user_id = $userId AND season_id = $seasonId`.
4. Ensure both updates are inside the same transaction as the milestone claim INSERT.

---

### Task 17: BUG-SEASON-03 — createSeasonCeremonyRoom missing slug
**Priority:** P4 | **Effort:** S

**Files to change:**
- `apps/web/lib/seasons/seasonEngine.ts`

**Steps:**
1. In `createSeasonCeremonyRoom`, generate a slug before the INSERT: `const slug = \`season-\${seasonId.slice(0, 8)}-ceremony\``.
2. Include `slug` in the INSERT column list and values.
3. If `slug` must be unique across all rooms, add a collision suffix: `season-${seasonId.slice(0,8)}-ceremony-${Date.now()}`.
4. Confirm the slug is returned in the function result and usable for /r/ routing.

---

### Task 18: BUG-SEASON-04 — claimPassMilestone ambiguous OR sticker_pack lookup
**Priority:** P4 | **Effort:** S

**Files to change:**
- `apps/web/lib/seasons/seasonEngine.ts`

**Steps:**
1. Replace the single `WHERE slug = $1 OR name = $1` query with a two-step lookup: first query `WHERE slug = $1`, then if not found, query `WHERE name = $1`.
2. Or use `ORDER BY (slug = $1) DESC LIMIT 1` to prefer slug matches without a second round-trip.
3. Add a log warning if the name-fallback path is taken, as slug should always be the canonical identifier.

---

### Task 19: BUG-PAY-01 — null as unknown as string type cast in webhook handler
**Priority:** P1 | **Effort:** S

**Files to change:**
- `apps/web/lib/payments/paystackWebhookHandler.ts`

**Steps:**
1. Find `roomId = null as unknown as string` and remove the cast.
2. Change the `roomId` variable type to `string | null`.
3. Trace all downstream uses of `roomId` in `processChargeSuccess` and add null guards (`if (roomId !== null) { ... }`) before any string operations or DB queries that use it.
4. If a `null` roomId is a valid business case (non-room purchase), document it clearly with a comment.

---

### Task 20: BUG-FUND-01 — Creator fund normalise() wrong value when all equal
**Priority:** P0 | **Effort:** S

**Files to change:**
- `apps/web/lib/creator/fund.ts`

**Steps:**
1. Find the `normalise()` function inside `calculateFundDistributions`.
2. Change the `min === max` branch: return `values.map(() => 0)` instead of `values.map(() => 1)`.
3. Add a unit test: call `normalise([0, 0, 0])` and confirm it returns `[0, 0, 0]`. Call `normalise([5, 5, 5])` and confirm it also returns `[0, 0, 0]` (equal non-zero values also normalize to 0 — no differentiation possible).
4. Verify the weighted score formula still makes sense when all normalized values are 0 for a dimension.

---

### Task 21: BUG-NEM-01 — compareNemesisProgress missing gaming track
**Priority:** P0 | **Effort:** S

**Files to change:**
- `apps/web/lib/nemesis/nemesisEngine.ts`

**Steps:**
1. Find `trackColumnMap` inside `compareNemesisProgress`.
2. Add `gaming: "xp_gaming"` to the map.
3. Cross-reference with `TRACK_COLUMN` in `apps/web/lib/xp/safeAwardXP.ts` to confirm all eight tracks are present in both maps.
4. Consider extracting `TRACK_COLUMN` as a shared export and importing it in `nemesisEngine.ts` to keep the two maps in sync automatically.
5. Write a test that calls `compareNemesisProgress` with track `"gaming"` and confirms it does not throw.

---

### Task 22: BUG-ANN-01 — Announcement modal view recorded before client confirms display
**Priority:** P2 | **Effort:** M

**Files to change:**
- `apps/web/lib/announcements/engine.ts`
- The API route(s) that call `getActiveModalForUser` / `getActiveBannerForUser`
- Client-side code that displays announcements

**Steps:**
1. Modify `getActiveModalForUser` and `getActiveBannerForUser` to return the modal/banner data WITHOUT inserting into `announcement_views`.
2. Create a new function `confirmAnnouncementView(userId: string, announcementId: string)` that inserts the view record.
3. Add a new API endpoint: `POST /api/announcements/confirm-view` that calls `confirmAnnouncementView`. Protect it with `withAuth`.
4. Update the client-side announcement display components (web + Expo) to call this confirmation endpoint after the user dismisses the modal/banner.

---

### Task 23: BUG-GAME-01 — declineChallenge post-transaction non-null assertion crash
**Priority:** P0 | **Effort:** S

**Files to change:**
- `apps/web/lib/games/challenges.ts`

**Steps:**
1. Inside the transaction block of `declineChallenge`, capture `challenger_id` from the locked challenge row into a local variable before the transaction commits.
2. Remove the post-transaction `(await getChallengeRow(challengeId))!.challenger_id` re-fetch.
3. Use the locally captured `challenger_id` for all post-transaction operations (notifications, etc.).
4. The result: one fewer DB round-trip and no crash risk on concurrent deletion.

---

### Task 24: BUG-GAME-02 — createChallenge interval string concatenation
**Priority:** P4 | **Effort:** S

**Files to change:**
- `apps/web/lib/games/challenges.ts`

**Steps:**
1. Find `NOW() + ($6 || ' hours')::interval` in the INSERT query.
2. Replace with `NOW() + ($6 * INTERVAL '1 hour')` where `$6` is a numeric parameter.
3. Confirm the parameter binding passes a plain number (not a string with units).
4. Add validation upstream: if `expiryHours` is not a positive finite number, reject with a 400.

---

### Task 25: BUG-GAME-03 — createChallenge no maximum wager validation
**Priority:** P4 | **Effort:** S

**Files to change:**
- `apps/web/lib/games/challenges.ts`
- `apps/web/lib/manifest.ts` (or env config) for the max wager constant

**Steps:**
1. Add a manifest key `max_wager_coins` (default: 10000) and `max_wager_stars` (default: 100).
2. At the start of `createChallenge`, after parsing the wager amount, read these limits.
3. If `wagerCoins > maxWagerCoins` or `wagerStars > maxWagerStars`, throw an `ApiError(400, "WAGER_TOO_HIGH", ...)`.
4. Return a user-visible error message explaining the limit.

---

### Task 26: BUG-MOD-01 — detectBotBehavior misses DM flooding
**Priority:** P3 | **Effort:** M

**Files to change:**
- `apps/web/lib/moderation/contentFilter.ts`

**Steps:**
1. Modify `detectBotBehavior` to also query the `messages` table (DMs) for recent messages from the user, in addition to `room_messages`.
2. Option A: run two COUNT queries (one per table) and sum them. If the combined total exceeds the velocity threshold, flag as bot.
3. Option B: use a UNION: `SELECT COUNT(*) FROM (SELECT id FROM room_messages WHERE sender_id = $1 AND created_at > NOW() - INTERVAL '1 minute' UNION ALL SELECT id FROM messages WHERE sender_id = $1 AND created_at > NOW() - INTERVAL '1 minute') t`.
4. Update the JSDoc to accurately describe coverage.

---

### Task 27: BUG-AUTH-01 — 10-second revoked session window
**Priority:** P1 | **Effort:** M

**Files to change:**
- `apps/web/lib/auth/session.ts`
- `apps/web/lib/api/middleware.ts` (possibly)
- Redis pub/sub setup (new utility if implementing immediate invalidation)

**Steps:**
1. As a quick win: reduce `SESSION_CACHE_TTL_MS` from 10,000 to 3,000 (3 seconds). Lower risk, minimal Redis overhead increase.
2. For immediate invalidation (recommended): subscribe each Next.js instance to a Redis pub/sub channel `session:revoked`. When `invalidateSession` is called, also publish `{ sid }` to this channel. Each instance's subscriber calls `evictSessionCache(sid)` on receipt.
3. Use `redis.subscribe` on a dedicated Redis client connection at server startup (not the main query client). Implement in `apps/web/lib/auth/session.ts` startup path.
4. Document in code that the L1 cache bypass for sensitive mutations already reduces risk for the most critical paths.

---

### Task 28: BUG-AUTH-02 — TOTP non-constant-time comparison
**Priority:** P1 | **Effort:** S

**Files to change:**
- `apps/web/lib/auth/totp.ts`

**Steps:**
1. In `verifyTotp`, find `computedCode === userCode` (or similar string comparison).
2. Replace with:
   ```
   const a = Buffer.from(computedCode, 'utf8');
   const b = Buffer.from(userCode.padStart(computedCode.length, '0'), 'utf8');
   if (a.length !== b.length) return false;
   return crypto.timingSafeEqual(a, b);
   ```
3. TOTP codes are always 6 digits so length equality is guaranteed — the pad is a safety belt for malformed input.
4. Add a unit test confirming that timing-safe comparison returns true for a valid code and false for an invalid one.

---

### Task 29: BUG-GIFT-01 — retireGiftDrop non-transactional UPDATEs
**Priority:** P1 | **Effort:** S

**Files to change:**
- `apps/web/lib/events/monthlyGiftDrop.ts`

**Steps:**
1. Wrap the two UPDATE statements in `retireGiftDrop` inside a `db.transaction(async tx => { ... })` block.
2. Confirm the `db` parameter supports transactions (it accepts `DatabaseAdapter` which has `.transaction()`).
3. If called from `processPendingGiftDrops` which doesn't pass a transaction, the nested transaction will be a new savepoint — confirm this is acceptable or pass the outer db down.
4. Test: simulate a failure in the second UPDATE and verify the first UPDATE is rolled back.

---

### Task 30: BUG-OFFLINE-01 — Web PWA getQueueCounts inflated
**Priority:** P4 | **Effort:** S

**Files to change:**
- `apps/web/lib/offline/messageQueue.ts`

**Steps:**
1. In `getQueueCounts`, replace the `getAllMessages()` call with a filtered call that returns only messages with `status === 'pending'`.
2. Either: add a `getPendingMessages()` helper (mirroring the Expo SQLite version in `apps/expo/lib/offline/sqlite.ts`) and call it here.
3. Or: filter the result of `getAllMessages()` inline: `const pending = (await getAllMessages()).filter(m => m.status === 'pending')`.
4. Update the count logic to use the filtered list.

---

## Suggested Sprint Ordering

If applying fixes in one sprint:

**Day 1 (P0 — correctness critical):**
Tasks 13, 15, 16, 20, 21, 23

**Day 2 (P1 — security + data integrity):**
Tasks 1, 19, 28, 29, 27

**Day 3 (P2 — reliability):**
Tasks 9, 10, 14, 22

**Day 4 (P3 — performance):**
Tasks 6, 7, 11, 26

**Day 5 (P4 — schema + structural):**
Tasks 2, 3, 4, 5, 8, 12, 17, 18, 24, 25, 30

Database migrations required: Tasks 2, 3, 4 (schema changes). All others are code-only.

---

*Fix plan generated: 2026-06-19 06:40 PM*  
*Analyst: Claude Code — forensic independent analysis*
