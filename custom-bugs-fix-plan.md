# Zobia Social — Bug Fix Plan
**Generated:** Thursday, June 19, 2026 — 12:00 AM (UTC)
**Scope:** 22 confirmed bugs from forensic analysis (independent, no existing reports consulted)
**Branch:** claude/wizardly-brahmagupta-1ttyod
**Status:** PENDING USER REVIEW — DO NOT EXECUTE UNTIL APPROVED

---

## Execution Strategy

Fixes are grouped by subsystem and ordered so that foundational/blocking fixes land first. Critical bugs (data corruption, silent financial failures) are prioritised in Phase 1. Within each phase, fixes that touch shared infrastructure are listed before the features that depend on them.

**Estimated effort:** ~3–5 engineering days for all 22 fixes with testing.

---

## Phase 1 — Critical / Data-Integrity (Fix First)

### TASK-01 — Fix BUG-08: Monthly plan bonus ON CONFLICT mismatch
**Priority:** CRITICAL | **File:** `apps/web/app/api/cron/daily-economy/route.ts`

The `ON CONFLICT` clause references only `(transaction_type, reference_id)` but the actual DB unique index (`uidx_coin_ledger_tx_type_ref`) is on `(user_id, transaction_type, reference_id)`. PostgreSQL throws a constraint-mismatch error every 1st of the month, meaning no monthly plan bonus is ever credited.

**Steps:**
1. Open `daily-economy/route.ts` and locate the monthly plan bonus CTE.
2. Change `ON CONFLICT (transaction_type, reference_id) WHERE reference_id IS NOT NULL` to `ON CONFLICT (user_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL`.
3. Verify the reference_id format used (e.g. `monthly_bonus:${userId}:${month}`) is unique per user per month to confirm the idempotency intent is preserved.
4. Add a regression test that runs the CTE twice for the same user/month and asserts only one row is inserted.

---

### TASK-02 — Fix BUG-01: Leaderboard upsert ON CONFLICT expression mismatch
**Priority:** CRITICAL | **File:** `apps/web/lib/leaderboards/engine.ts`

`upsertLeaderboardSnapshot` uses `ON CONFLICT (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))` but PostgreSQL requires the conflict target to match the index definition exactly — functional expressions in ON CONFLICT must match the index's stored expression. The schema-defined unique index likely uses `NULLS NOT DISTINCT` or a simple multi-column definition, not COALESCE expressions in the conflict target.

**Steps:**
1. Read `apps/web/lib/db/schema.ts` and find the exact definition of the leaderboard_snapshots unique index — note whether it uses a partial WHERE clause, expression columns, or NULLS NOT DISTINCT.
2. Rewrite the ON CONFLICT target to exactly mirror the index definition. Two safe options:
   - If the index is a plain multi-column index (nullable columns), switch to `ON CONFLICT DO NOTHING` + a prior SELECT to detect existing rows, OR
   - Create/confirm a coalesced expression index `CREATE UNIQUE INDEX ... ON leaderboard_snapshots (user_id, track, scope, COALESCE(city,''), COALESCE(season_id::text,''))` so the ON CONFLICT expression matches.
3. Write an integration test that upserts twice for the same (user, track, scope, null city, null season_id) and asserts one row.

---

### TASK-03 — Fix BUG-07: Guild war draws recorded as challenger wins
**Priority:** CRITICAL | **File:** `apps/web/lib/guilds/warEngine.ts`

`let outcome: "win" | "draw" = "win"` is never assigned `"draw"` when scores are equal, so all tied wars are credited to the challenger.

**Steps:**
1. Locate the `resolveWar` function in `warEngine.ts`.
2. After computing challenger and defender scores, add:
   ```
   if (challengerScore === defenderScore) outcome = "draw";
   ```
   (or equivalent conditional before the outcome is written to the DB).
3. Verify `distributeWarRewards` correctly handles the `"draw"` outcome — if it only handles `"win"`, add draw-reward logic per the PRD.
4. Add unit tests: win case, loss case, and draw (equal scores) case.

---

### TASK-04 — Fix BUG-05: Paystack subscription.disable processed as immediate cancellation
**Priority:** CRITICAL | **File:** `apps/web/lib/payments/paystackWebhookHandler.ts`

`processSubscriptionEvent` checks `isCancelled` (status-based) before checking `event.event === "subscription.disable"`. When Paystack sends `subscription.disable` with `status="cancelled"`, the `isCancelled` branch fires and immediately downgrades the user's plan instead of setting non-renewing status until period end.

**Steps:**
1. Reorder the conditional checks so `event.event === "subscription.disable"` is evaluated first (before any status-based checks).
2. When `event.event === "subscription.disable"` is matched, set `subscription_status = 'non_renewing'` and set `plan_expires_at` to the current period end — do NOT downgrade the plan yet.
3. Add a separate handler (or confirm one exists) for `subscription.not_renew` or `charge.failure` that performs the actual plan downgrade when the period lapses.
4. Test with a mock webhook payload of `{ event: "subscription.disable", data: { status: "cancelled" } }` to confirm non-renewing treatment.

---

## Phase 2 — High Severity / Functional Bugs

### TASK-05 — Fix BUG-02: safeAwardXP does not update leaderboard snapshot
**Priority:** HIGH | **File:** `apps/web/lib/xp/safeAwardXP.ts`

XP is awarded but `upsertLeaderboardSnapshot` is never called, so leaderboard positions drift over time and never reflect real XP totals.

**Steps:**
1. After the XP CTE completes successfully, call `upsertLeaderboardSnapshot(userId, track, newLevel, db)` (or equivalent signature).
2. The call should be non-blocking with respect to the caller (use fire-and-forget with error logging, similar to the DLQ pattern) so a leaderboard failure never blocks the XP award.
3. Confirm the same fix is applied in `claimPassMilestone` in `seasonEngine.ts` where `xp_bonus` reward type also skips the snapshot.
4. Add integration test: award XP, then query leaderboard_snapshots for the user and assert the score updated.

---

### TASK-06 — Fix BUG-03: Daily login XP does not update leaderboard snapshot
**Priority:** HIGH | **File:** `apps/web/app/api/cron/daily-core/route.ts`

The daily login XP CTE updates `xp_total` on the users table but does not call `upsertLeaderboardSnapshot`.

**Steps:**
1. After the daily login XP batch CTE executes, iterate the affected user IDs and call `upsertLeaderboardSnapshot` for each (or use the batch variant if available).
2. Because this is a CRON context, the call can be synchronous — failure should be logged but should NOT abort the CRON (wrap in try/catch).
3. If `upsertLeaderboardSnapshot` has a bulk API, prefer one batch call over N individual calls for performance.

---

### TASK-07 — Fix BUG-04: Daily login streak uses wrong date condition
**Priority:** HIGH | **File:** `apps/web/app/api/cron/daily-core/route.ts`

`WHERE last_login_date = CURRENT_DATE - 1` means a user who logged in today won't have their streak incremented until TOMORROW's CRON run — a 24-hour delay.

**Steps:**
1. Change the WHERE clause to `WHERE last_login_date >= CURRENT_DATE - 1 AND last_login_date < CURRENT_DATE` (or `= CURRENT_DATE`) depending on when last_login_date is set (on login vs. on CRON).
2. Review the login handler to understand exactly when `last_login_date` is written and make the CRON condition match that semantic.
3. Add a test that simulates a user logging in today and verifies the CRON increments their streak in the same run.

---

### TASK-08 — Fix BUG-06: DM duplicate detection uses hardcoded "room" context
**Priority:** HIGH | **File:** `apps/web/lib/moderation/contentFilter.ts`

`detectDuplicateMessage` is called with hardcoded `"room"` as `messageContext` even for DM messages, so DM spam is never caught.

**Steps:**
1. In `applyAutoModeration`, locate the `detectDuplicateMessage(message, userId, "room")` call.
2. Add a `messageContext` parameter to `applyAutoModeration` (or read it from the existing context object if one is passed).
3. Pass the actual context (`"room"` or `"dm"`) through to `detectDuplicateMessage`.
4. Update all callers of `applyAutoModeration` to pass the correct context.
5. Confirm the Redis key namespace for DM duplicate detection won't collide with room keys (different prefixes).

---

### TASK-09 — Fix BUG-11: Guild tier history stores wrong tier values
**Priority:** HIGH | **File:** `apps/web/lib/guilds/warEngine.ts`

The `guild_tier_history` INSERT sets both `from_tier` and `to_tier` to the new tier value — the pre-change tier is never recorded.

**Steps:**
1. Before the tier update query, fetch the guild's current tier (or pass it as a parameter if it's already in scope).
2. Store the pre-update tier as `fromTier`.
3. Change the INSERT to `from_tier: fromTier, to_tier: newTier`.
4. Add a test: start at tier 3, trigger promotion, assert `guild_tier_history` row has `from_tier=3, to_tier=4`.

---

### TASK-10 — Fix BUG-15: Gaming sticker packs never auto-unlock
**Priority:** HIGH | **File:** `apps/web/app/api/cron/daily-social/route.ts`

The CASE expression mapping `unlock_condition` to user level columns is missing the `gaming_level_` branch, so users who reach gaming milestones never receive their sticker packs.

**Steps:**
1. In the earnable sticker CASE expression, add:
   `WHEN sp.unlock_condition LIKE 'gaming_level_%' THEN u.level_gaming`
2. Verify that `level_gaming` is the correct column name in both the query and `schema.ts` (confirmed at line 154).
3. While there, audit the CASE expression for all other track level columns (social, creator, competitor, generosity, knowledge, explorer) to ensure none are similarly missing.
4. Add a test: create a sticker pack with `unlock_condition = 'gaming_level_5'`, set user's `level_gaming = 5`, run the CRON logic, assert the pack is unlocked.

---

### TASK-11 — Fix BUG-12: Failed Expo push notifications silently dropped
**Priority:** HIGH | **File:** `apps/web/lib/notifications/push.ts`

When `sendExpoBatch` receives a non-2xx HTTP response, it logs the error and returns an empty set — no retry, no DLQ, notifications are permanently lost.

**Steps:**
1. In the non-2xx branch of `sendExpoBatch`, instead of returning an empty set, throw an error (or return a typed failure result).
2. In the caller, catch the failure and write the affected notification IDs to a DLQ table (e.g. `failed_push_notifications`) with the error payload.
3. Add a CRON task (or extend an existing one) to retry from the DLQ with exponential backoff (cap at 3 retries), following the same pattern as `failed_xp_awards`.
4. Alternatively, use the existing Expo `sendPushNotificationsAsync` retry semantics if the SDK supports it.

---

## Phase 3 — Medium Severity / Correctness Bugs

### TASK-12 — Fix BUG-13: Hall of Fame can exceed pageSize on leaderboard page 1
**Priority:** MEDIUM | **File:** `apps/web/lib/leaderboards/engine.ts`

When Hall of Fame entries are injected into page 1, no check is made against pageSize, so the first page can return more rows than requested.

**Steps:**
1. In the HoF injection logic, after prepending HoF entries to page 1 results, trim the combined array to `pageSize`.
2. Alternatively, subtract the HoF count from the page 1 query LIMIT before fetching regular results, then append HoF entries.
3. Ensure total returned length always equals `pageSize` (or less on the final page).

---

### TASK-13 — Fix BUG-21: Duplicate login streak column update
**Priority:** MEDIUM | **File:** `apps/web/app/api/cron/daily-core/route.ts`

Both `login_streak_days` and `login_streak` are set to the same incremented value. One column is likely redundant or serves a different purpose.

**Steps:**
1. Review the schema definition for users to determine the intended difference between `login_streak_days` and `login_streak`.
2. If they are truly synonymous, remove one from the schema and all references (and add a migration to drop the column).
3. If they serve different purposes (e.g. `login_streak` = current run, `login_streak_days` = all-time longest), fix the update logic to write the correct value to each.
4. Update any read paths that query both columns.

---

### TASK-14 — Fix BUG-22: Comeback coin reversal fails silently for repeat users
**Priority:** MEDIUM | **File:** `apps/web/app/api/cron/daily-users/route.ts`

The reversal uses `referenceId = 'comeback_reversal:${userId}'` — if the same user qualifies for a comeback bonus twice, the second reversal hits the unique index and is silently skipped (ON CONFLICT DO NOTHING).

**Steps:**
1. Change the `referenceId` to include a time-based component, e.g. `comeback_reversal:${userId}:${bonusMonth}` where `bonusMonth` is the year-month when the original bonus was credited.
2. Alternatively, include the original bonus's `referenceId` in the reversal key to tie them together.
3. Verify the original bonus credit also uses a unique referenceId format and that the reversal key derivation will correctly identify the right credit row.

---

### TASK-15 — Fix BUG-09: Field encryption keyCache is unbounded (memory leak)
**Priority:** MEDIUM | **File:** `apps/web/lib/crypto/fieldEncryption.ts` (or equivalent)

The in-process `keyCache` Map grows without bound as new keys are added, which can cause memory pressure in long-running serverless instances.

**Steps:**
1. Replace the unbounded `Map` with an LRU cache (e.g. `lru-cache` npm package, or a simple fixed-size Map with eviction).
2. Set a maximum size of 50–100 entries (key rotation means only a handful of keys are ever active at once).
3. Add a unit test that adds more than the max entries and asserts the cache size stays bounded.

---

### TASK-16 — Fix BUG-10: XP award does not handle concurrent track level-ups atomically
**Priority:** MEDIUM | **File:** `apps/web/lib/xp/safeAwardXP.ts`

If two concurrent XP awards for the same user on the same track both read the same `current_level` before either commits, they can both compute the same new level and double-apply milestone rewards.

**Steps:**
1. Add `SELECT ... FOR UPDATE` on the user's XP row (or the track-specific counter) at the start of the XP CTE, so concurrent awards for the same user serialize.
2. Alternatively, use an advisory lock (`pg_try_advisory_xact_lock(userId hashcode)`) to serialize per-user XP updates.
3. Confirm `checkAndAwardTrackMilestones` uses `ON CONFLICT DO NOTHING` on the milestone insert (it does per the code), so duplicate milestone grants are idempotent even if the lock is missed.

---

### TASK-17 — Fix BUG-14: Flash XP event expiry race — XP awarded after expiry
**Priority:** MEDIUM | **File:** `apps/web/lib/xp/flashXP.ts` (or equivalent flash XP handler)

The flash XP lifecycle check (announced → fired → expired) and the XP award are not atomic — a request arriving just before `expired` is set can pass the lifecycle check and then award XP after the event has logically ended.

**Steps:**
1. Wrap the lifecycle transition and XP award in a single database transaction.
2. Use a `WHERE status = 'fired' AND expires_at > NOW()` guard inside the XP award CTE so the award only proceeds if the event is still live at the moment of the write.
3. Confirm the `expires_at` column exists and is indexed.

---

### TASK-18 — Fix BUG-16: Silent-refresh loop risk when refresh token is also expired
**Priority:** MEDIUM | **File:** `apps/web/middleware.ts`, `apps/web/app/api/auth/silent-refresh/route.ts`

When both the access token and the refresh token are expired, the middleware redirects to `/api/auth/silent-refresh?to=<path>`, which then fails and should redirect to login. If the silent-refresh route itself redirects back through middleware, it could loop.

**Steps:**
1. In the silent-refresh route handler, on refresh failure, redirect to `/auth/login?redirect=<to>&reason=session_expired` and clear both cookies.
2. Ensure `/api/auth/silent-refresh` is in `PUBLIC_PREFIXES` so the middleware never intercepts it again (it already is — confirm it also handles the failure path without triggering another redirect).
3. Add a `reason=refresh_failed` query param so the login page can display an appropriate message.
4. Add an end-to-end test: expired AT + expired RT → assert final redirect is `/auth/login`, not a loop.

---

### TASK-19 — Fix BUG-17: App manifest in-process cache never invalidated
**Priority:** MEDIUM | **File:** `apps/web/lib/manifest/manifestCache.ts` (or equivalent)

The in-process manifest cache uses a fixed TTL (or no TTL at all), so manifest changes made in the admin panel are not reflected until the serverless instance is recycled.

**Steps:**
1. Add a cache TTL of 60 seconds (or match the Redis TTL) to the in-process Map entry.
2. On admin manifest update, emit a Redis pub/sub message or set a Redis invalidation key that the manifest reader checks before serving the cached value.
3. Alternatively, skip the in-process cache entirely for the manifest and rely solely on Redis (TTL ≤ 60s), accepting one extra Redis round-trip per request.

---

### TASK-20 — Fix BUG-18: Quest deck generation is not idempotent across CRON retries
**Priority:** MEDIUM | **File:** `apps/web/lib/quests/questEngine.ts`

`generateDailyDeck` uses `HASHTEXT` for deterministic seed selection but if the CRON retries partway through batch generation, duplicate deck entries can be inserted for users already processed.

**Steps:**
1. Add `ON CONFLICT (user_id, deck_date) DO NOTHING` to the deck INSERT so retries are safe.
2. Confirm `deck_date` + `user_id` have a unique constraint in the schema; add a migration if not.
3. Add a test: call `generateDailyDeck` twice for the same user/date and assert exactly one deck row exists.

---

### TASK-21 — Fix BUG-19: triggerActivityQuestProgress fire-and-forget hides errors
**Priority:** MEDIUM | **File:** `apps/web/lib/quests/questEngine.ts`

`triggerActivityQuestProgress` is called without `await` and without a `.catch()` handler, so errors are swallowed and progress updates are silently lost.

**Steps:**
1. Add a `.catch((err) => console.error('[questEngine] triggerActivityQuestProgress failed:', err))` to the fire-and-forget call.
2. Consider writing failed updates to a lightweight DLQ or retry queue if quest progress consistency is important.
3. If the calling context can afford a small await, switch to `await` with try/catch to get observability without a DLQ.

---

### TASK-22 — Fix BUG-20: Referral tier-2 commission awarded without verifying tier-1 eligibility
**Priority:** LOW | **File:** `apps/web/lib/referrals/commissions.ts`

The tier-2 commission (2%) is computed and awarded based on `referredBy` chain without verifying that the tier-1 referrer is still an active user and has themselves made a qualifying purchase.

**Steps:**
1. Before awarding the tier-2 commission to the grandparent referrer, verify that the tier-1 referrer (`referredBy`) has `status = 'active'` and at least one `completed` payment.
2. If tier-1 is inactive/unqualified, skip the tier-2 award (or hold it pending tier-1 qualification).
3. Log the skip for finance auditing purposes.
4. Add a test: inactive tier-1 referrer → assert tier-2 commission is NOT awarded.

---

## Phase 4 — Low Severity / Polish

### TASK-23 — Clean up BUG-21 duplicate column after TASK-13 decision
*(Dependent on TASK-13 schema investigation.)*
Once the intended meaning of `login_streak` vs `login_streak_days` is resolved and the schema change is made, update the CRON logic, the user profile read paths, and any frontend display code that references the removed column.

---

## Verification Checklist (Post-Fix)

Run these checks after all fixes are applied:

- [ ] Monthly plan bonus CRON test: trigger day-1 run twice, assert idempotent ledger entries
- [ ] Leaderboard upsert: upsert same snapshot twice, assert single row in DB
- [ ] Guild war draw test: equal scores → outcome = "draw", correct reward distribution
- [ ] Paystack `subscription.disable` webhook test: status="cancelled" → non_renewing, not downgraded
- [ ] XP award → leaderboard snapshot updated (safeAwardXP + daily CRON)
- [ ] Login streak: user logs in today → streak incremented in same CRON run
- [ ] DM duplicate detection: spam in DM thread → caught and rejected
- [ ] Guild tier history: promotion recorded with correct from/to tiers
- [ ] Gaming sticker auto-unlock: user reaches gaming_level_5 → sticker pack granted
- [ ] Push notification DLQ: non-2xx from Expo → entry written to failed_push_notifications
- [ ] Hall of fame page 1: result count ≤ pageSize
- [ ] Memory test: keyCache stays bounded after many encryption operations
- [ ] Flash XP race: XP award rejected when event expires before DB write

---

**Thursday, June 19, 2026 — 12:00 AM (UTC)**
*Zobia Social — custom-bugs-fix-plan.md — Independent Forensic Analysis*
