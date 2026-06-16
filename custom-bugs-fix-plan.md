# Zobia Social — Bug Fix Plan

**Generated:** June 16, 2026 · 5:11 AM UTC  
**Based on:** `custom-bugs-report.md` (same analysis session)

> **IMPORTANT: Do NOT begin any fix until the report has been reviewed and approved.**

Fixes are grouped by priority tier (P0 → P2) and then by theme. Each task is self-contained unless a dependency is noted. Estimate times assume one developer familiar with the codebase.

---

## Priority Tiers

| Tier | Criteria |
|------|----------|
| **P0 — Critical** | Broken user-facing feature OR money correctness issue |
| **P1 — High** | Silent data corruption, notification spam, or data loss |
| **P2 — Medium** | Security hardening, tech debt, deferred safety work |

---

## P0 — Critical (Fix Immediately)

---

### TASK-01 · Fix Expo mobile login CSRF block (BUG-CSRF-01)

**Effort:** ~1 hour  
**Files:** `apps/expo/app/auth/login.tsx`

In `handleDeepLink`, find the `fetch()` call that POSTs to `/api/auth/mobile-token`. Add `'Origin': process.env.EXPO_PUBLIC_API_BASE_URL` to the `headers` object. Verify the env var name matches what is declared in the Expo config. Optionally, refactor this call to use the shared Axios client (which already sets Origin) to prevent the pattern recurring.

Test: perform a full Google/Telegram OAuth login on a physical Android device or emulator and confirm a session token is issued without a 403 error.

---

### TASK-02 · Fix double platform-fee deduction on creator payouts (BUG-FIN-01)

**Effort:** ~2 hours  
**Files:** `apps/web/app/api/cron/daily/route.ts` (Section 33 — weekly payout aggregation)

**Step 1 — Understand the intent:** Determine whether the weekly payout step should charge any fee at all. Given that `available_earnings_kobo` is already net (fee taken at credit time in `creator_earnings`), the correct answer for most flows is NO second fee.

**Step 2 — Fix the calculation:** Remove the `platformFeeKobo = grossKobo * 0.10` line. Set `netKobo = grossKobo` (pass the full available earnings through to the payout record). Update `platformFeeKobo` to `0` in the payout INSERT.

**Step 3 — Audit historic records:** Query `creator_payouts` for rows created by the weekly CRON after the first deployment of this code, compare `gross_kobo` vs `net_kobo` to identify under-paid creators, and issue correction payouts or `available_earnings_kobo` adjustments as appropriate.

**Step 4 — Add a test:** In `apps/web/lib/payments/__tests__/payouts.test.ts`, add a test case asserting that `net_kobo === gross_kobo` when no secondary fee is applied.

---

## P1 — High (Fix Within Sprint)

---

### TASK-03 · Deduplicate council invitation notifications (BUG-NOTIF-01)

**Effort:** ~30 minutes  
**Files:** `apps/web/app/api/cron/daily/route.ts`

In the council invitation notification INSERT, add a `reference_id` parameter. Use a deterministic key scoped to the user and the current period, e.g. `council_invite:<userId>:<YYYY-WW>`. Add `reference_id` to the INSERT column list and the `$N` bind parameter list. The existing `ON CONFLICT (user_id, type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING` will then correctly deduplicate.

---

### TASK-04 · Deduplicate guild war final-hour notifications (BUG-NOTIF-02)

**Effort:** ~20 minutes  
**Files:** `apps/web/app/api/cron/guild-wars/route.ts`

Add `reference_id = 'war_final_hour:<warId>'` to the final-hour notification INSERT. This makes the partial unique index effective. Confirm the war ID is available in scope at the insert site.

---

### TASK-05 · Deduplicate guild tier-downgrade notifications (BUG-NOTIF-03)

**Effort:** ~20 minutes  
**Files:** `apps/web/app/api/cron/guild-wars/route.ts`

Add `reference_id = 'guild_tier_downgrade:<guildId>:<warId>'` to the downgrade notification INSERT. Use the same pattern as TASK-04.

---

### TASK-06 · Stamp nemesis's `last_notified_at` on overtake events (BUG-NOTIF-04)

**Effort:** ~30 minutes  
**Files:** `apps/web/app/api/cron/daily/route.ts`

After the nemesis overtake notification is sent, the existing UPDATE only stamps `user_id = ANY($userIds)`. Collect the nemesis user IDs (the `nemesis_id` field on each winning assignment row) into a separate array and issue a second UPDATE:
```sql
UPDATE nemesis_assignments SET last_notified_at = NOW()
WHERE user_id = ANY($nemesisIds::uuid[])
```
Or combine both into a single UPDATE with `WHERE user_id = ANY(($userIds || $nemesisIds)::uuid[])`.

---

### TASK-07 · Fix `guild_quests` missing unique constraint (BUG-DB-01)

**Effort:** ~1 hour (schema change + migration)  
**Files:** `apps/web/lib/db/schema.ts`, new migration file

Add a unique constraint to the `guildQuests` table. Identify the correct idempotency key columns (likely `guild_id`, `quest_type`, `week_start`). Write and apply a Drizzle migration:
```sql
ALTER TABLE guild_quests ADD CONSTRAINT guild_quests_guild_questtype_weekstart_unique
  UNIQUE (guild_id, quest_type, week_start);
```
Update the `ON CONFLICT` clause in the CRON section to reference these columns. Delete any existing duplicate rows before applying the migration (`DELETE ... WHERE id NOT IN (SELECT MIN(id) FROM guild_quests GROUP BY guild_id, quest_type, week_start)`).

---

### TASK-08 · Fix `guild_tier_history` missing coverage for non-war tier changes (BUG-DB-02)

**Effort:** ~45 minutes  
**Files:** `apps/web/lib/db/schema.ts`, new migration file

The existing partial unique index covers `WHERE war_id IS NOT NULL`. Add a complementary partial index for the null-war case. A practical approach is a full unique index on `(guild_id, new_tier, changed_at::date) WHERE war_id IS NULL`. Write a migration for this index. Update the non-war promotion/demotion CRON section to include the `ON CONFLICT` column list matching the new index.

---

### TASK-09 · Fix `platform_events.name` constraint breaking recurrence and Flash XP (BUG-DB-03)

**Effort:** ~2 hours (schema change + dual fix)  
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/app/api/cron/daily/route.ts`, `apps/web/lib/events/flashXP.ts`, new migration

**Step 1:** Write a migration that drops the single-column `UNIQUE(name)` constraint from `platform_events` and replaces it with a composite unique constraint on `(name, starts_at)`.

**Step 2:** Update the annual recurrence cloning INSERT in the daily CRON to use `ON CONFLICT (name, starts_at) DO NOTHING`. Verify that cloned events get their `starts_at` advanced by exactly 1 year.

**Step 3:** The Flash XP `platform_events` upsert already uses `ON CONFLICT (name, starts_at) DO NOTHING` — once the composite index exists it will start working automatically. Remove the `.catch(() => {})` that was silently swallowing the error (or keep it but log at `warn` level to catch future schema drift).

**Step 4:** Test by manually inserting two `platform_events` rows with the same name but different `starts_at` — both should succeed. Inserting a third row with the same `(name, starts_at)` pair should conflict correctly.

---

### TASK-10 · Fix alliance wars duplicate creation (BUG-DB-04)

**Effort:** ~1 hour  
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/app/api/cron/daily/route.ts`, new migration

Add a unique constraint to `alliance_wars` that identifies a unique matchup per week. Normalise the alliance pair order (use LEAST/GREATEST or enforce `alliance_1_id < alliance_2_id` via a migration CHECK constraint). Example migration:
```sql
ALTER TABLE alliance_wars ADD CONSTRAINT alliance_wars_pair_week_unique
  UNIQUE (LEAST(alliance_1_id, alliance_2_id), GREATEST(alliance_1_id, alliance_2_id), scheduled_week);
```
If expression-based unique constraints are not desired, add an application-layer normalisation step before INSERT and use a column-based unique index. Update the CRON `ON CONFLICT` clause to match.

---

### TASK-11 · Fix Web PWA "sending" messages stranded after crash (BUG-SYNC-01)

**Effort:** ~1.5 hours  
**Files:** `apps/web/lib/offline/messageQueue.ts`, `apps/web/lib/offline/useOfflineSync.ts`

**Step 1:** Add `resetSendingMessages()` to `messageQueue.ts`. This function opens the `messages` IndexedDB object store and updates all records with `status === "sending"` back to `status === "pending"`. Use the existing pattern from `apps/expo/lib/offline/syncQueue.ts` as a reference.

**Step 2:** In `useOfflineSync.ts`, call `resetSendingMessages()` before the sync loop starts — either on component mount or at the point where the online/reconnect event fires, whichever comes first.

**Step 3:** Verify in a browser: open the app, start sending a message, hard-kill the tab, reopen, confirm the message retries rather than disappearing.

---

### TASK-12 · Fix DeviceNotRegistered push receipt purging all user tokens (BUG-PUSH-01)

**Effort:** ~2 hours  
**Files:** `apps/web/lib/notifications/push.ts`

At batch-send time, store a mapping from Expo ticket ID to device token. A short-TTL Redis hash (`push_ticket:<ticketId> → token`) or a DB column (`push_tickets.token`) works. When the receipt loop detects `DeviceNotRegistered`, look up only the specific token for that ticket ID and delete only that row from `user_push_tokens`. This ensures users retain push notification delivery on all other devices.

---

### TASK-13 · Consolidate duplicate login-streak columns (BUG-DB-05)

**Effort:** ~1 hour  
**Files:** `apps/web/lib/db/schema.ts`, all files referencing `loginStreak` or `loginStreakDays`, new migration

Run a project-wide search for all references to both `loginStreak` and `loginStreakDays` (and their snake_case SQL equivalents). Determine which column has the most up-to-date values across existing rows. Write a migration that sets the canonical column (e.g. `login_streak_days`) to `MAX(login_streak, login_streak_days)` for each user, drops `login_streak`, and updates all application references to the single canonical column.

---

### TASK-14 · Fix null email in JWT signing (BUG-AUTH-01)

**Effort:** ~30 minutes  
**Files:** `apps/web/lib/auth/session.ts`, `apps/web/app/api/auth/2fa/verify/route.ts`

In `createSession`, guard the email before it reaches `signAccessToken`:
- Option A (simple): `email: user.email ?? ''`
- Option B (correct): omit the `email` claim from the JWT when it is null; update `signAccessToken` to make `email` optional; update the `TokenPayload` interface in `middleware.ts` accordingly.

Option B is recommended because an empty-string claim would misrepresent the account state. After the change, add a test in the auth suite for a Telegram-only user (null email) confirming the session is created without error.

---

## P2 — Medium (Fix Before Next Release)

---

### TASK-15 · Encrypt Expo MMKV offline store (BUG-SEC-03)

**Effort:** ~1 day  
**Files:** `apps/expo/lib/offline/store.ts`, new `apps/expo/lib/storage/mmkvKey.ts` helper

**Step 1:** Add `react-native-keychain` or use `expo-secure-store` to persist a randomly-generated 256-bit encryption key securely in the Android Keystore.

**Step 2:** Create a helper `getMmkvEncryptionKey()` that: (a) attempts to load the key from secure storage; (b) if absent, generates `crypto.getRandomValues(new Uint8Array(32))`, encodes to base64, stores it, and returns it.

**Step 3:** Await the key before creating the MMKV instance and pass it as `encryptionKey`. Because MMKV cannot be re-keyed in-place, existing stores must be migrated: read all values before encryption, delete the old store, create the encrypted store, write values back. Gate this migration on a persisted flag.

**Step 4:** Test on a real device: confirm the MMKV backing file is not readable in plaintext via ADB or file manager.

---

### TASK-16 · Remove `id` attribute from HTML sanitizer allowlist (BUG-SEC-01)

**Effort:** ~30 minutes  
**Files:** `apps/web/lib/security/htmlSanitizer.ts`

Remove `'id'` from the `'*': ['class', 'id']` entry in `SANITIZE_OPTIONS`. Search the codebase for any UI code that relies on user-generated IDs for anchor navigation; if found, allowlist `id` only on the specific safe elements (e.g. `'h2': ['id', 'class']`). Add a test case to the sanitizer suite asserting that `<div id="foo">` is stripped to `<div>` in output.

---

### TASK-17 · Harden markdown link sanitizer with an allow-list (BUG-SEC-02)

**Effort:** ~1 hour  
**Files:** `apps/web/lib/security/htmlSanitizer.ts`

Replace the deny-list scheme filter with an allow-list that only passes `https:`, `http:`, and `mailto:` in link `href` and image `src` values. After running markdown through the chosen markdown parser, pipe the rendered HTML through the same DOMPurify instance already used for `sanitizeHtml`, with `ALLOWED_URI_REGEXP` set to `^(https?|mailto):`. Add tests for `blob:`, `file:`, and a custom-scheme URI confirming they are stripped.

---

### TASK-18 · Tighten pre-auth 2FA path guard to exact match (BUG-AUTH-02)

**Effort:** ~15 minutes  
**Files:** `apps/web/lib/api/middleware.ts`

Change:
```ts
pathname.endsWith('/2fa/verify')
```
to:
```ts
pathname === '/api/auth/2fa/verify'
```
Verify that the 2FA verify route still works end-to-end after the change.

---

### TASK-19 · Migrate legacy v1 field-encryption ciphertext to v2 (BUG-SEC-04)

**Effort:** ~1 day (migration job) + ~2 hours (deprecation)  
**Files:** `apps/web/lib/security/fieldEncryption.ts`, new migration script

**Step 1:** Write a one-shot migration script (can be a CRON or admin-triggered CLI command) that:
1. Queries all columns known to use field encryption (audit `fieldEncryption.ts` call sites to enumerate them).
2. For each row, checks if the ciphertext starts with `v1:`.
3. Decrypts with the v1 path.
4. Re-encrypts with the v2 path.
5. UPDATEs the row in a transaction.
6. Logs a progress counter.

**Step 2:** After all rows are confirmed migrated (counter reaches 0 v1 rows), remove the v1 decryption code path from `fieldEncryption.ts` and the corresponding test stubs.

**Step 3:** Confirm the master encryption key is stored in a hardware-backed secret manager (Doppler, AWS Secrets Manager, GCP Secret Manager) and is not present in any `.env` file committed to the repository.

---

## Summary Table

| Task | Bug | Priority | Effort |
|------|-----|----------|--------|
| TASK-01 | BUG-CSRF-01 | P0 | ~1 hr |
| TASK-02 | BUG-FIN-01 | P0 | ~2 hrs |
| TASK-03 | BUG-NOTIF-01 | P1 | ~30 min |
| TASK-04 | BUG-NOTIF-02 | P1 | ~20 min |
| TASK-05 | BUG-NOTIF-03 | P1 | ~20 min |
| TASK-06 | BUG-NOTIF-04 | P1 | ~30 min |
| TASK-07 | BUG-DB-01 | P1 | ~1 hr |
| TASK-08 | BUG-DB-02 | P1 | ~45 min |
| TASK-09 | BUG-DB-03 | P1 | ~2 hrs |
| TASK-10 | BUG-DB-04 | P1 | ~1 hr |
| TASK-11 | BUG-SYNC-01 | P1 | ~1.5 hrs |
| TASK-12 | BUG-PUSH-01 | P1 | ~2 hrs |
| TASK-13 | BUG-DB-05 | P1 | ~1 hr |
| TASK-14 | BUG-AUTH-01 | P1 | ~30 min |
| TASK-15 | BUG-SEC-03 | P2 | ~1 day |
| TASK-16 | BUG-SEC-01 | P2 | ~30 min |
| TASK-17 | BUG-SEC-02 | P2 | ~1 hr |
| TASK-18 | BUG-AUTH-02 | P2 | ~15 min |
| TASK-19 | BUG-SEC-04 | P2 | ~1 day |

**Total estimated effort:** ~3 days for P0+P1 fixes, ~2–3 additional days for P2 hardening.

---

*Plan generated: June 16, 2026 · 5:11 AM UTC*
