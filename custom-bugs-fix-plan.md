# Zobia Codebase — Bug Fix Plan

**Generated:** June 21, 2026 · 11:47 AM  
**Source:** `custom-bugs-report.md` — 22 confirmed bugs  
**Status:** PENDING REVIEW — Do NOT apply fixes until approved  
**Priority order:** Critical (P0) → High (P1) → Medium (P2) → Low (P3)

---

## Fix Order and Priority

| # | Bug ID | Priority | Effort | Risk |
|---|--------|----------|--------|------|
| 1 | BUG-CREA-01 | P0 | Low | Low — schema migration + no logic change |
| 2 | BUG-NEM-01 | P0 | Low | Low — index swap only |
| 3 | BUG-CSRF-01 | P0 | Low | Low — one-line PUBLIC_PREFIXES addition |
| 4 | BUG-XSS-01 | P0 | Low | Low — one function call change |
| 5 | BUG-QST-01 | P1 | Low | Low — add two map entries |
| 6 | BUG-PIN-01 | P1 | Low | Low — add try/catch around redis.get |
| 7 | BUG-XP-GIFT-01 | P1 | Medium | Medium — refactor awardGiftXP to use safeAwardXP |
| 8 | BUG-RACE-01 | P1 | Medium | Low — convert to atomic upsert |
| 9 | BUG-LB-01 | P1 | Medium | Medium — requires comparing index DDL to code |
| 10 | BUG-RL-01 | P2 | Low | Low — hardcode global window |
| 11 | BUG-BIGINT-01 | P2 | Medium | Low — type change + test coverage |
| 12 | BUG-REGEX-01 | P2 | Low | Low — factory function or drop g flag |
| 13 | BUG-GAME-SILENT-01 | P2 | Low | Low — add logger.error |
| 14 | BUG-DODO-01 | P2 | Low | Low — add field to type |
| 15 | BUG-ENC-01 | P2 | Medium | Low — distinguish error types |
| 16 | BUG-SCHEMA-01 | P2 | Low | Low — schema default + migration |
| 17 | BUG-XP-DEDUP-01 | P2 | Medium | Medium — audit all safeAwardXP call sites |
| 18 | BUG-MILE-01 | P2 | Low | Low — add retry/logging |
| 19 | BUG-L1-01 | P2 | Low | Low — TTL reduction or documentation |
| 20 | BUG-PUSH-DEDUP-01 | P3 | Low | Low — token dedup by value |
| 21 | BUG-STICKER-01 | P3 | Low | Low — explicit conflict target |
| 22 | BUG-XP-ACTION-01 | P3 | Low | Low — standardise on source column |

---

## Phase 1 — Critical Fixes (P0) — Must deploy before next CRON run or payment event

---

### TASK-01 · BUG-CREA-01 — Add unique index on `creator_earnings.reference_id`

**Why urgent:** `distributeCreatorFund` throws a PostgreSQL error on every execution. The creator fund has never been distributed successfully in any environment that runs this CRON.

**Files to change:**
- Migration SQL (new file, e.g. `migrations/0020_creator_earnings_ref_unique.sql`)
- `apps/web/lib/db/schema.ts` (add `uniqueIndex` to `creator_earnings.referenceId` column definition)

**Steps:**
1. Write migration: `CREATE UNIQUE INDEX CONCURRENTLY creator_earnings_reference_id_idx ON creator_earnings(reference_id) WHERE reference_id IS NOT NULL;`
2. In `schema.ts`, update the `creator_earnings` table definition to add `.unique()` or a named `uniqueIndex('creator_earnings_reference_id_idx', ['referenceId'], { where: sql\`reference_id IS NOT NULL\` })`.
3. Deploy migration before the next creator fund CRON run.
4. Verify by running `distributeCreatorFund` in a staging environment against real data.

---

### TASK-02 · BUG-NEM-01 — Replace `nemesis_assignments` unique index with partial unique index

**Why urgent:** Every second nemesis reassignment for any user+track combination causes a hard PostgreSQL constraint violation crash. This means the nemesis engine has been silently broken for all users assigned more than one nemesis.

**Files to change:**
- Migration SQL (new file)
- `apps/web/lib/db/schema.ts`

**Steps:**
1. Write migration:
   ```sql
   DROP INDEX CONCURRENTLY IF EXISTS nemesis_assignments_user_track_active_idx;
   CREATE UNIQUE INDEX CONCURRENTLY nemesis_assignments_active_idx
     ON nemesis_assignments(user_id, track)
     WHERE is_active = TRUE;
   ```
2. Update `schema.ts`: remove the existing `uniqueIndex(['userId', 'track', 'isActive'])` and add `uniqueIndex('nemesis_assignments_active_idx', ['userId', 'track'], { where: sql\`is_active = TRUE\` })`.
3. No application code changes required — `nemesisEngine.ts` already uses the correct deactivation UPDATE pattern; the index change makes it work as intended.
4. After migration, verify the engine can reassign nemeses multiple times per user without error.

---

### TASK-03 · BUG-CSRF-01 — Add legacy webhook routes to `PUBLIC_PREFIXES`

**Why urgent:** Payment providers registered on the legacy URLs receive 403 on every webhook delivery. Real payment events (purchases, subscription renewals) are silently dropped.

**File to change:**
- `apps/web/middleware.ts`

**Steps:**
1. Add `"/api/webhooks/paystack"` and `"/api/webhooks/dodopayments"` to the `PUBLIC_PREFIXES` array.
2. Deploy.
3. Verify by triggering a test webhook from the Paystack dashboard to the legacy URL and confirming it processes correctly.
4. Long-term: migrate all registered webhook URLs in provider dashboards to the canonical `/api/economy/webhooks/*` paths and remove the legacy re-export routes.

---

### TASK-04 · BUG-XSS-01 — Sanitize markdown announcements before delivery

**Why urgent:** An admin or compromised admin account could store a markdown announcement containing `<script src=...>` or `<img onerror=...>` and execute arbitrary JavaScript in every active user's browser session.

**File to change:**
- `apps/web/lib/announcements/engine.ts`

**Steps:**
1. In `getActiveModalForUser` and `getActiveBannerForUser`, replace the conditional `sanitizeHtml(selected.content)` with `sanitizeAnnouncementContent(selected.content, selected.content_type)`.
2. Import `sanitizeAnnouncementContent` from `@/lib/security/htmlSanitizer` (it's already implemented correctly with the `marked` pipeline).
3. Add a test with a markdown announcement containing `<script>alert(1)</script>` and verify it's stripped.

---

## Phase 2 — High Priority (P1) — Fix within one sprint

---

### TASK-05 · BUG-QST-01 — Add `'gaming'` and `'main'` to quest engine `TRACK_COLUMN`

**File to change:**
- `apps/web/lib/quests/questEngine.ts`

**Steps:**
1. Add to the `TRACK_COLUMN` map: `gaming: 'xp_gaming'` and `main: 'xp_total'`.
2. Verify that no quest templates in the DB have `action_type` values that map to `'gaming'` or `'main'` via `ACTION_TRACKS` that would have been silently failing. Run a data audit query: `SELECT action_type, COUNT(*) FROM quest_templates WHERE action_type IN (SELECT action_type FROM ... mapped to 'gaming' or 'main') GROUP BY 1;`
3. If broken quest progress records exist, consider a one-time remediation to re-award lost XP.

---

### TASK-06 · BUG-PIN-01 — Make `requirePinVerified` fail closed on Redis outage

**File to change:**
- `apps/web/lib/auth/pinGuard.ts`

**Steps:**
1. Wrap the `redis.get(pinKey)` call in a `try/catch`.
2. On error: log the failure with `logger.error({ userId, err }, '[pinGuard] Redis unavailable — denying PIN check')` and return `false` (unverified).
3. On `null` (key not found): return `false` as before.
4. On value found: return `true` as before.
5. This ensures the PIN guard always fails secure (denied) when Redis is down rather than throwing an unhandled exception.

---

### TASK-07 · BUG-XP-GIFT-01 — Route `awardGiftXP` through `safeAwardXP`

**File to change:**
- `apps/web/app/api/economy/gifts/send/route.ts`

**Steps:**
1. Remove the `db.transaction` wrapper inside `awardGiftXP`; the CTE-based atomic `UPDATE` pattern within `safeAwardXP` is sufficient and handles its own atomicity.
2. Replace each XP ledger INSERT block with a `safeAwardXP(userId, amount, track, source, referenceId)` call, called sequentially after the main gift transaction commits (same pattern as `checkDeckCompletion`).
3. Update the `awardGiftXP` function signature to accept the transaction commit signal (or call it post-commit from the route handler, outside any `db.transaction`).
4. Ensure `firstGiftXP`, `senderXP`, `recipientXP`, and `tippedXP` each get a deterministic `referenceId` (e.g., `gift:${giftId}:sender`, `gift:${giftId}:recipient`, etc.) — the existing reference strings are already correct, just need to go through `safeAwardXP`.

---

### TASK-08 · BUG-RACE-01 — Make ceremony room creation atomic

**File to change:**
- `apps/web/lib/seasons/seasonEngine.ts`

**Steps:**
1. Replace the two-step `SELECT` + `INSERT` with a single `INSERT INTO rooms (...) ON CONFLICT (name) DO NOTHING RETURNING id` inside a transaction.
2. After the INSERT, read back the room id from RETURNING or from a subsequent SELECT if the INSERT was a no-op.
3. Alternatively, acquire a session-level advisory lock (`SELECT pg_advisory_lock(hashtext(seasonId || ':ceremony'))`) before the check+insert block, ensuring only one CRON runner proceeds at a time.

---

### TASK-09 · BUG-LB-01 — Verify leaderboard upsert index DDL matches `ON CONFLICT` clause

**Files to change:**
- Migration SQL files for `leaderboard_snapshots` table
- `apps/web/lib/leaderboards/engine.ts` (if DDL fix changes the conflict signature)

**Steps:**
1. Locate the migration that creates the `leaderboard_snapshots` unique index.
2. If the index was created on raw columns (`city`, `season_id`), drop it and recreate with expressions:
   ```sql
   CREATE UNIQUE INDEX CONCURRENTLY leaderboard_snapshots_unique_idx
     ON leaderboard_snapshots (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''));
   ```
3. Confirm the `ON CONFLICT` clause in `upsertLeaderboardSnapshot` matches character-for-character.
4. If the index uses raw columns, update the `ON CONFLICT` clause instead: change `COALESCE(city, '')` to `city` and store `''` as a sentinel value in the column (requires a NOT NULL default change to the column definition).
5. Add an integration test that upserts a snapshot with `city = NULL` and `season_id = NULL` twice and verifies exactly one row exists.

---

## Phase 3 — Medium Priority (P2) — Fix within two sprints

---

### TASK-10 · BUG-RL-01 — Fix global rate limiter window

**File to change:**
- `apps/web/lib/security/rateLimit.ts`

**Steps:**
1. In `createGlobalRateLimiter`, pass a hardcoded `windowMs: 60_000` (1 minute) to the global limiter constructor instead of `options.windowMs`.
2. If a configurable global window is ever needed, add an explicit `globalWindowMs` option to the `RateLimitOptions` type.
3. Verify by checking the Redis keys for global rate limits after the fix — they should expire in 60 seconds, not 900.

---

### TASK-11 · BUG-BIGINT-01 — Type coin/star BIGINT results correctly

**Files to change:**
- `apps/web/lib/economy/coins.ts`
- `apps/web/lib/economy/stars.ts`

**Steps:**
1. Change the query result type from `{ coin_balance: number }` to `{ coin_balance: string }` (node-postgres returns bigints as strings).
2. Parse with `BigInt(row.coin_balance)` or `new Decimal(row.coin_balance)` before arithmetic.
3. Ensure the returned balance value is serialised correctly in JSON responses (BigInt is not JSON-serialisable by default — convert to string for API responses or use a serialiser).
4. Add a unit test that mocks a DB row returning a string `"10000000000000000"` and verifies the parsed value matches.

---

### TASK-12 · BUG-REGEX-01 — Convert exported global regexes to factory functions

**File to change:**
- `apps/web/lib/messaging/antispam.ts`

**Steps:**
1. Change each exported constant from `export const URL_REGEX = /pattern/gi` to `export const getUrlRegex = () => /pattern/gi`.
2. Update all callers to use the factory function: `const re = getUrlRegex(); re.test(str)`.
3. Remove all manual `re.lastIndex = 0` resets that compensate for the current mutable state.
4. Alternatively, if the callers always use `.test()` and never `.exec()` in a loop, simply remove the `g` flag from each regex — the `g` flag on `.test()` causes state mutation, but for single-match checks it's unnecessary.

---

### TASK-13 · BUG-GAME-SILENT-01 — Log `recordChallengeRoundPlay` failures

**File to change:**
- `apps/web/lib/games/sessions.ts`

**Steps:**
1. Change `.catch(() => {})` to `.catch((err) => logger.error({ roundId, userId, score }, \`[games] recordChallengeRoundPlay failed: ${err}\`))`.
2. Consider surfacing the error to the HTTP caller: if `recordChallengeRoundPlay` fails, the score endpoint should return 500 so the client can retry rather than treating the submission as successful when the round record is actually stale.

---

### TASK-14 · BUG-DODO-01 — Fix DodoPayments `itemSlug` type

**File to change:**
- `apps/web/lib/payments/dodoWebhookHandler.ts`

**Steps:**
1. Add `itemSlug?: string` to the metadata type used by the DodoPayments handler (wherever the webhook payload is typed).
2. Replace the type assertion cast with a runtime check: `const itemSlug = typeof metadata?.itemSlug === 'string' ? metadata.itemSlug : null`.
3. Add handling (log a warning) when `itemSlug` is unexpectedly absent so future payload schema changes are visible.

---

### TASK-15 · BUG-ENC-01 — Make missing encryption key observable

**File to change:**
- `apps/web/lib/security/fieldEncryption.ts`

**Steps:**
1. In `decryptField`, after catching the exception from `decryptRaw`, distinguish between `Error.message` containing "env var not set" and a genuine decryption failure. For missing-key errors, re-throw with a clearly labeled operational error (e.g., `throw new Error('[fieldEncryption] MISSING KEY: ' + err.message)`) rather than returning `null`.
2. Add a startup validation function `validateEncryptionKeys()` that calls `getKeyForVersion(CURRENT_VERSION)` and throws if the env var is absent. Call this during app startup (e.g., in a Next.js `instrumentation.ts` hook) so the deployment fails fast rather than silently serving broken decryption.
3. Ensure all call sites handle the re-thrown error explicitly rather than treating `null` as a no-data condition.

---

### TASK-16 · BUG-SCHEMA-01 — Add `.defaultNow()` to `seasons.updatedAt`

**Files to change:**
- `apps/web/lib/db/schema.ts`
- Migration SQL (new file)

**Steps:**
1. In `schema.ts`, add `.defaultNow()` to the `seasons` table's `updatedAt` column.
2. Write migration: `ALTER TABLE seasons ALTER COLUMN updated_at SET DEFAULT NOW(); UPDATE seasons SET updated_at = COALESCE(updated_at, created_at, NOW()) WHERE updated_at IS NULL;`
3. Deploy.

---

### TASK-17 · BUG-XP-DEDUP-01 — Audit all `safeAwardXP` call sites for null referenceId

**Files to change:**
- All files calling `safeAwardXP` without a referenceId (search codebase)

**Steps:**
1. Run: `grep -rn "safeAwardXP" apps/web --include="*.ts"` and list all call sites.
2. For each call where `referenceId` is `null`, `undefined`, or omitted, determine a stable deterministic referenceId. Use a pattern like `{source}:{userId}:{date}` for daily-limited actions or `{source}:{entityId}` for entity-scoped ones.
3. Update each call site.
4. Separately, for the CRON retry (`retryFailedXPAwards`), the existing synthetic `dlq_retry:{userId}:{source}:{id}` referenceId is already correct — no change needed there.
5. After the change, re-run the DLQ CRON retry in staging and confirm it doesn't double-award.

---

### TASK-18 · BUG-MILE-01 — Add outer failure logging in `checkPlayMilestones`

**File to change:**
- `apps/web/lib/games/rewards.ts`

**Steps:**
1. In `checkPlayMilestones`, wrap the outer `globalDb.query<{ plays: number }>(...)` in a try/catch that logs the full error with userId context via `logger.error`.
2. Optionally, record a `failed_milestone_checks` DLQ-like row (or use a system_alert INSERT) so the CRON can retry milestone eligibility checks for users whose outer query failed — similar to `retryFailedXPAwards`.
3. At minimum, surface the failure via Sentry or the existing alert mechanism so it's not invisible.

---

### TASK-19 · BUG-L1-01 — Document or reduce L1 session cache TTL for high-security paths

**File to change:**
- `apps/web/lib/auth/session.ts`
- `apps/web/lib/api/middleware.ts`

**Steps:**
1. If the 3-second multi-instance staleness window is acceptable as a deliberate performance tradeoff, add an explicit comment documenting the security implication and the rationale.
2. For the admin `withAdminAuth` path, bypass the L1 cache entirely (set `l1TtlMs = 0`) to ensure admin de-provisioning takes effect immediately.
3. For account-banned user flags, the existing Redis cache with a short TTL already handles this — confirm the ban flag is always read from Redis (not L1).

---

## Phase 4 — Low Priority (P3) — Fix in cleanup sprint

---

### TASK-20 · BUG-PUSH-DEDUP-01 — Deduplicate push tokens by token value

**File to change:**
- `apps/web/lib/notifications/push.ts`

**Steps:**
1. After fetching all tokens for a user, add a secondary dedup step that groups by `push_token` value and keeps the most recently updated one per unique token string.
2. This prevents a user with multiple legacy null-device_id registrations from receiving N copies of every notification.
3. Consider adding a NOT NULL constraint to `device_id` for new token registrations to prevent the root cause from recurring.

---

### TASK-21 · BUG-STICKER-01 — Add explicit conflict target to `dm_score_sticker_unlocks` INSERT

**File to change:**
- `apps/web/lib/messaging/conversationScore.ts`

**Steps:**
1. Confirm the `dm_score_sticker_unlocks` table has a unique index on `(user_id_1, user_id_2, pack_name)`. If the migration is missing this index, add it.
2. Change `ON CONFLICT DO NOTHING` to `ON CONFLICT (user_id_1, user_id_2, pack_name) DO NOTHING` to make the deduplication constraint explicit and compile-time verifiable.

---

### TASK-22 · BUG-XP-ACTION-01 — Standardise `xp_ledger` usage on `source` column

**Files to change:**
- `apps/web/lib/mystery/xpDrop.ts`
- Migration SQL (drop `action` column if unused elsewhere)

**Steps:**
1. Audit all queries that reference the `xp_ledger.action` column: `grep -rn "\.action" apps/web/lib --include="*.ts" | grep xp_ledger`.
2. If `action` is only used in `xpDrop.ts`, update the INSERT to remove the `action` column and update the 24-hour eligibility check from `WHERE action = 'mystery_drop'` to `WHERE source = 'mystery_drop'`.
3. Write a migration to drop the `action` column: `ALTER TABLE xp_ledger DROP COLUMN IF EXISTS action;`
4. If `action` is used elsewhere in the codebase, document why both `source` and `action` exist, consider aliasing one to the other, and add a note to the schema file.

---

## Deployment Checklist

Before any of these fixes are applied in production:

- [ ] All P0 tasks (TASK-01 through TASK-04) reviewed and approved
- [ ] Database migrations for TASK-01 and TASK-02 tested in staging with production data volume
- [ ] `TASK-03` (CSRF fix) deployed in the same release as any legacy URL migration for payment providers
- [ ] `TASK-04` (XSS fix) verified with a test markdown announcement containing embedded script tags
- [ ] `TASK-09` (leaderboard index) — confirm with a SQL `\d leaderboard_snapshots` in staging that index DDL matches the ON CONFLICT clause before deploying the P1 logic fix
- [ ] `TASK-07` (gift XP DLQ) — run an end-to-end gift send test in staging to verify DLQ entries are written correctly on simulated DB failure
- [ ] `TASK-17` (safeAwardXP audit) — complete audit of all call sites before deploying; partial fix could leave some call sites still vulnerable to double-award

---

*Fix Plan End*  
**Generated:** June 21, 2026 · 11:47 AM
