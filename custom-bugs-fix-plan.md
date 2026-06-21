# Zobia Codebase — Bug Fix Plan

**Generated:** 2026-06-21 at 09:05 AM  
**Reference:** custom-bugs-report.md (same date)  
**Status:** PENDING REVIEW — do not begin implementation until approved

---

## Fix Order & Rationale

Fixes are ordered by severity and dependency. Critical bugs first (live revenue/data impact), then high (broken features), then medium (security/integrity), then low (maintenance).

---

## Phase 1 — Critical (fix immediately, production impact)

---

### TASK-01 — Fix BUG-QE-01: Correct `resetDailyQuests()` table and column names

**Priority:** P0 — live data corruption (unbounded table growth)  
**Files to edit:** `apps/web/lib/quests/questEngine.ts`

**Steps:**
1. Locate `resetDailyQuests()` in `questEngine.ts`.
2. Change the DELETE statement's table name from `quest_progress` to `user_quest_progress`.
3. Change the WHERE predicate from `status = 'expired' AND date < $1` to `expired_at IS NOT NULL AND quest_date < $1` (verify the exact column names against the schema).
4. Remove or narrow the `.catch(() => {})` that silently swallows the error — replace with at minimum a `logger.error(...)` call so future failures are visible.
5. Test by confirming the DELETE runs against the correct table in a staging environment and that expired rows are purged.

---

### TASK-02 — Fix BUG-WH-01: Validate room_subscription webhook metadata before acting

**Priority:** P0 — live revenue loss / feature broken  
**Files to edit:** `apps/web/lib/payments/paystackWebhookHandler.ts`

**Steps:**
1. Locate the `room_subscription` branch inside the Paystack charge-success handler.
2. Add explicit runtime validation of `metadata.roomId` (non-empty string), `metadata.grossKobo` (positive number), and `metadata.subscriptionDays` (positive integer) BEFORE any downstream actions.
3. If validation fails: log the full raw metadata object (so the failure is auditable), and return a non-200 response (e.g. 400 or re-throw) so Paystack retries the webhook. Do NOT return 200 on failure.
4. Optionally use a Zod schema for the metadata shape to make the validation self-documenting.
5. Review all other webhook metadata casts in the same file for the same pattern and apply the same treatment.

---

## Phase 2 — High (broken features, fix before next release)

---

### TASK-03 — Fix BUG-WE-01: Cast guild bigint to Number before arithmetic

**Priority:** P1 — guild war matchmaking completely broken  
**Files to edit:** `apps/web/lib/guilds/warEngine.ts`

**Steps:**
1. Locate the `findWarOpponent()` function (or wherever `self.guild_xp` is used in tolerance band arithmetic).
2. Add `const guildXp = Number(self.guild_xp)` immediately after the DB row is loaded. Verify `Number()` is safe (guild XP won't approach `Number.MAX_SAFE_INTEGER` — 9 quadrillion — in practice).
3. Replace all uses of `self.guild_xp` in arithmetic expressions with `guildXp`.
4. Check for any other `bigint` columns in the same query result (e.g. `member_count`, `total_war_score`) and apply the same cast.
5. Add a comment noting the pg-driver bigint-as-string behavior so future contributors don't re-introduce the same issue.

---

### TASK-04 — Fix BUG-PU-01: Add `device_id` column to `userPushTokens` or remove it from query

**Priority:** P1 — push notification device deduplication broken  
**Files to edit:** `apps/web/lib/db/schema.ts`, `apps/web/lib/notifications/push.ts`, and a new migration file

**Steps (Option A — add the column, recommended):**
1. Add `device_id varchar(255)` to the `userPushTokens` Drizzle schema definition.
2. Write a migration: `ALTER TABLE user_push_tokens ADD COLUMN device_id VARCHAR(255)`.
3. In the Expo app, when registering a push token (`apps/expo/`), include the device's unique identifier (e.g. `expo-device` ID or `Constants.installationId`) in the registration API call body.
4. In the push token registration API route, save `device_id` to the new column.
5. Verify the push.ts SQL SELECT now resolves `device_id` correctly.

**Steps (Option B — remove device_id from the query):**
1. Remove `device_id` from the `PushTokenRow` interface and the SQL SELECT in `push.ts`.
2. Implement token deduplication by token value alone (one active row per unique token string).

---

### TASK-05 — Fix BUG-LB-01: Populate city-scoped leaderboard snapshots on XP award

**Priority:** P1 — city leaderboards permanently empty  
**Files to edit:** `apps/web/lib/xp/safeAwardXP.ts`, `apps/web/lib/leaderboards/engine.ts`

**Steps:**
1. In `safeAwardXP.ts`, extend the `RETURNING` clause of the `UPDATE users ...` query to also return the `city` column: append `, city` to the RETURNING expression.
2. After the existing `upsertLeaderboardSnapshot(userId, "main", xpTotal, client)` calls, add conditional city snapshot upserts:
   - If `rows[0].city` is non-null, call `upsertLeaderboardSnapshot(userId, "main", xpTotal, client, { scope: 'city', city: rows[0].city })`.
   - If `track !== "main"` and city is non-null, also call `upsertLeaderboardSnapshot(userId, track, trackXP, client, { scope: 'city', city: rows[0].city })`.
3. Verify `upsertLeaderboardSnapshot` in `engine.ts` accepts and correctly uses the `scope` and `city` options (it should based on existing code — confirm the function signature).
4. Apply the same pattern in the `retryFailedXPAwards` DLQ retry path.
5. Run a one-time backfill migration or script to populate city snapshots for existing users from their current `xp_total` / track XP values.

---

## Phase 3 — Medium (security and integrity, fix within one sprint)

---

### TASK-06 — Fix BUG-SS-01: Extend IPv6 link-local check to full fe80::/10 range

**Priority:** P2 — SSRF security gap  
**Files to edit:** `apps/web/lib/security/ssrf.ts`

**Steps:**
1. Locate `isPrivateIp()` in `ssrf.ts`.
2. Replace `if (hostname.startsWith("fe80:")) return true;` with a check covering the full `/10` range:
   - Split the hostname on `:`, parse the first group as hex: `parseInt(hostname.split(':')[0], 16)`.
   - Return true if the value is between `0xfe80` and `0xfebf` inclusive.
   - Handle the edge case where the hostname may be in compressed notation (e.g. `fe80::1` — `split(':')[0]` is still `fe80` and works correctly).
3. Add a unit test covering `fe80::1`, `fe90::1`, `fea0::1`, `feb0::1`, `febf::1` (all should be blocked) and `fec0::1` (should use the existing site-local check), and `ff00::1` (should be allowed by this check but potentially caught by multicast).

---

### TASK-07 — Fix BUG-CS-01: Audit raw fetch() calls in Expo and add Origin header

**Priority:** P2 — CSRF gap for Expo API calls  
**Files to edit:** `apps/expo/` (various), potentially `apps/expo/lib/api/client.ts`

**Steps:**
1. Run a search in `apps/expo/` for all calls to `fetch(` that are not through `apiClient`.
2. For each call targeting the app's own API (`API_BASE_URL`): replace with `apiClient.get/post/...` or wrap in a small helper that includes `Origin: env.API_BASE_URL`.
3. For third-party URLs (analytics, CDNs, etc.): these are fine as raw fetch — no Origin needed.
4. Add a lint rule or comment at the top of the Expo API client explaining the Origin requirement so future contributors know to use apiClient for own-API calls.

---

### TASK-08 — Fix BUG-WH-02: Convert dynamic import to static import in webhook handler

**Priority:** P2 — latency / reliability in webhook hot path  
**Files to edit:** `apps/web/lib/payments/paystackWebhookHandler.ts`

**Steps:**
1. Move `import("@/lib/payments/payouts")` to a static top-level import at the top of the file.
2. If the dynamic import was added to resolve a circular dependency, trace the dependency graph and restructure to break the cycle (e.g. extract shared types to a third module, or inline the needed function).
3. Verify the build succeeds and no circular dependency error appears.

---

### TASK-09 — Fix BUG-GS-01: Make personal-best detection atomic

**Priority:** P2 — economy race condition  
**Files to edit:** `apps/web/lib/games/sessions.ts`

**Steps:**
1. Locate `finalizeScore()` in `sessions.ts`.
2. Move the `SELECT best_score FROM game_best_scores WHERE user_id = $1 AND game_id = $2` query to inside the write transaction (after the `counted = TRUE` CAS update succeeds).
3. Alternatively, fold the best-score check into the CTE or use `INSERT ... ON CONFLICT DO UPDATE RETURNING (xmax = 0) AS is_new_best` to detect whether the upsert actually changed the record.
4. Ensure the `isNewBest` determination and the reward grant happen atomically within the same transaction so concurrent plays cannot both claim the reward.

---

### TASK-10 — Fix BUG-SK-01: Check sticker pack existence before consuming unlock threshold

**Priority:** P2 — sticker pack permanently lost on missing seed data  
**Files to edit:** `apps/web/lib/messaging/conversationScore.ts`

**Steps:**
1. Locate the sticker unlock block in `updateConversationScore()`.
2. Reverse the operation order:
   a. First: `SELECT id FROM sticker_packs WHERE name = $packName`.
   b. If no row is found: log a `logger.error` (this is a misconfiguration, not a user error) and return early WITHOUT inserting into `dm_score_sticker_unlocks`. This preserves the threshold so it can fire again once the pack is seeded.
   c. If the row is found: insert into `dm_score_sticker_unlocks` (ON CONFLICT DO NOTHING) and then insert into `user_sticker_packs`.
3. Add a startup check (or a CRON health check) that verifies all sticker pack names referenced in the code constants actually exist in the `sticker_packs` table.

---

### TASK-11 — Fix BUG-DM-01: Make getDMCost() return null for disallowed plan+initiation combos

**Priority:** P2 — business logic safety net  
**Files to edit:** `apps/web/lib/messaging/coinCost.ts`, and all call sites

**Steps:**
1. Change `getDMCost(plan, isInitiating)` to return `null` (or `undefined`) when `isInitiating=true` and `plan` is `"free"` or `"plus"` (plans that cannot initiate DMs).
2. Update the return type signature accordingly: `number | null`.
3. Find all call sites of `getDMCost` in the codebase and add null-guards: if the return is null, the call site must treat it as "not allowed" and return an error before attempting any coin deduction.
4. Add JSDoc to `getDMCost` explaining the null/not-applicable semantics clearly.

---

## Phase 4 — Low (schema hygiene and maintenance)

---

### TASK-12 — Fix BUG-SC-01: Drop unused `sessions` table

**Priority:** P3 — schema cleanup  
**Files to edit:** `apps/web/lib/db/schema.ts`, new migration

**Steps:**
1. Confirm with a codebase search that no file outside of `schema.ts` references the `sessions` table.
2. Write a migration: `DROP TABLE IF EXISTS sessions;`
3. Remove the `sessions` table definition from `schema.ts`.
4. Add a brief comment near `apps/web/lib/auth/session.ts` noting that sessions are stored exclusively in Redis.

---

### TASK-13 — Fix BUG-SC-02: Drop deprecated `userQuests` table

**Priority:** P3 — schema cleanup  
**Files to edit:** `apps/web/lib/db/schema.ts`, new migration

**Steps:**
1. Confirm no application code reads or writes `userQuests`.
2. If any historical data in the table needs archiving, export it first.
3. Write a migration: `DROP TABLE IF EXISTS user_quests;`
4. Remove the `userQuests` definition from `schema.ts`.

---

### TASK-14 — Fix BUG-SC-03: Populate or remove unused xp_ledger audit columns

**Priority:** P3 — schema integrity / auditability  
**Files to edit:** `apps/web/lib/xp/safeAwardXP.ts`, `apps/web/lib/xp/engine.ts`, `apps/web/lib/db/schema.ts`, new migration

**Steps (Option A — populate the columns, recommended for audit trail):**
1. Add parameters to `safeAwardXP()` for `baseAmount` (pre-multiplier XP), `multiplier` (basis-point integer), and optionally `description`.
2. Update the INSERT in `safeAwardXP` to write these values to the `base_amount`, `multiplier`, and `description` columns.
3. Update all callers of `safeAwardXP` in the XP engine to pass the pre-multiplier values.
4. This creates a correct audit trail: `base_amount` = raw XP before multiplier, `amount` = actual credited XP, `multiplier` = effective multiplier applied.

**Steps (Option B — drop the unused columns):**
1. Write a migration to `ALTER TABLE xp_ledger DROP COLUMN action, DROP COLUMN xp_amount, DROP COLUMN xp_net, DROP COLUMN multiplier, DROP COLUMN description, DROP COLUMN ceremony_room_id, DROP COLUMN metadata;`
2. Remove them from the Drizzle schema.

---

### TASK-15 — Fix BUG-RL-01: Review and tighten L1 rate limit cache multiplier

**Priority:** P3 — defense in depth  
**Files to edit:** `apps/web/lib/security/rateLimit.ts`

**Steps:**
1. Review which endpoints currently have `bypassL1: true` and verify all auth, PIN, and payment endpoints are covered.
2. For any sensitive endpoint not yet on the bypass list, add `bypassL1: true`.
3. Consider reducing the L1 multiplier from 40% to 20-25% for the general case to reduce multi-instance burst headroom.
4. Add a comment documenting the multi-instance overage formula (N × L1% × limit) so the trade-off is visible to future reviewers.

---

## Implementation Notes

- **Database migrations:** Tasks 04-A, 05, 12, 13, 14 all require new Drizzle migration files. Generate them with `pnpm drizzle-kit generate` after schema changes, review the output SQL before applying.
- **Backfill needed after TASK-05:** Existing users will have no city-scoped leaderboard snapshots. Run a one-time backfill after deploying to populate `leaderboard_snapshots` with `scope='city'` rows from current user data.
- **Do not bundle schema cleanup (TASK-12/13/14) with functional fixes:** Deploy them separately so a broken migration doesn't block a critical fix.
- **Test the webhook fix (TASK-02) in Paystack's test mode** before deploying to production. Send a test charge event with missing metadata fields and verify the handler returns non-200 and logs correctly.

---

*Fix plan generated: 2026-06-21 at 09:05 AM*  
*Do not begin implementation until this plan has been reviewed and approved*
