# Zobia Codebase — Bug Fix Plan

**Generated:** June 20, 2026 · 11:45 AM
**Scope:** 17 confirmed bugs from independent forensic analysis (see `custom-bugs-report.md`)
**Status:** PENDING USER REVIEW — DO NOT EXECUTE UNTIL APPROVED

---

## Execution Strategy

Fixes are ordered by risk and dependency. Phase 1 covers bugs that cause silent data loss, financial errors, or broken core features in production right now. Phase 2 covers security hardening. Phase 3 covers correctness and code quality issues that have lower immediate impact.

Each task is self-contained and can be executed independently unless a dependency is noted.

**Estimated effort:** ~2–3 engineering days for all 17 fixes with smoke testing.

---

## Phase 1 — Critical: Silent Data Loss & Broken Core Features

These bugs cause real harm in production silently (no visible error, no alarm).

---

### TASK-01 — Fix BUG-NOTIF-01: Rename `payload` to `metadata` in challenge notify()

**Priority:** CRITICAL — challenge notifications completely broken
**File:** `apps/web/lib/games/challenges.ts`

1. Open `challenges.ts` and locate the private `notify()` helper function.
2. Find every SQL INSERT into the `notifications` table built inside that helper.
3. Rename the `payload` column reference to `metadata` in each INSERT.
4. Confirm with `lib/notifications/insert.ts` that `metadata` is the correct column name.
5. Smoke-test by triggering a game challenge invitation and checking the `notifications` table for a new row.

---

### TASK-02 — Fix BUG-WH-01: DodoPayments webhook must return 500 on errors

**Priority:** CRITICAL — payment events permanently lost on transient errors
**File:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

1. Open the file and locate the outer `catch` block at the end of the route handler.
2. Change `{ status: 200 }` in the catch-block `NextResponse.json(…)` response to `{ status: 500 }`.
3. Verify that the signature-verification failure response (for unsigned/invalid payloads) remains `{ status: 400 }` — this must not be changed.
4. Confirm the DodoPayments webhook dashboard shows "pending retry" for 5xx responses (not "delivered").

---

### TASK-03 — Fix BUG-ECON-01: DM creation must use debitCoins() not raw SQL

**Priority:** CRITICAL — coin debits produce no ledger row and are race-prone
**File:** `apps/web/app/api/messages/dm/route.ts`

1. Find the raw `UPDATE users SET coins = coins - $amount` in the POST (new conversation) handler.
2. Replace it with `await debitCoins(userId, amount, 'dm_initiation', conversationId, tx)`.
   - `conversationId` (the newly-inserted conversation ID) serves as the idempotency key.
   - Pass the active transaction client `tx` so the debit is inside the same atomic transaction.
3. Remove any manual balance check that duplicates what `debitCoins()` already does.
4. Verify a `coin_ledger` row with `source = 'dm_initiation'` is written after a DM is started.

---

### TASK-04 — Fix BUG-ECON-02: DM creation must use safeAwardXP() not raw SQL

**Priority:** CRITICAL — XP silently lost on any DB error; no DLQ fallback
**File:** `apps/web/app/api/messages/dm/route.ts`

1. Find the raw `INSERT INTO xp_ledger …` in the same POST handler.
2. Replace it with `await safeAwardXP(userId, xpAmount, 'social', 'dm_initiation', conversationId)`.
   - `conversationId` is the idempotency key (same as TASK-03).
   - Call this AFTER the transaction commits (or as a fire-and-forget after `tx.commit()`) since `safeAwardXP` uses the global DB and manages its own DLQ fallback.
3. Verify an `xp_ledger` row is created and that `leaderboard_snapshots` is updated.

---

### TASK-05 — Fix BUG-ECON-03: handleDMGift() must pass a non-null reference_id

**Priority:** CRITICAL — gift coin debits double-charge on any client retry
**File:** `apps/web/app/api/messages/dm/route.ts`

1. Locate `handleDMGift()` — specifically the `debitCoins(senderId, giftAmount, 'dm_gift', null, tx)` call.
2. Replace the `null` reference_id with a deterministic key such as `messageId` of the gift message, or `` `dm_gift:${conversationId}:${messageId}` ``.
3. Apply the same non-null reference_id to the corresponding `creditCoins(recipientId, …, 'dm_gift', reference_id, tx)` call so both sides are idempotent together.
4. Verify that submitting the same gift message twice (simulating a retry) results in exactly one debit and one credit row in `coin_ledger`.

---

### TASK-06 — Fix BUG-PAY-01: Paystack subscription.disable must insert a notification

**Priority:** HIGH — users get no in-app notice when subscription is cancelled
**File:** `apps/web/lib/payments/paystackWebhookHandler.ts`

1. Locate the `subscription.disable` event branch.
2. Find the early `return { success: true }` after the subscription UPDATE.
3. Remove the early return. Add a notification INSERT (or call the shared notification helper used by other branches) with:
   - `type = 'subscription_disabled'`
   - `metadata` containing the plan name, end date, and reason (if available from the webhook payload)
4. Verify that after a `subscription.disable` webhook is received, a row appears in `notifications` for the affected user.

---

### TASK-07 — Fix BUG-CRON-01: master_teacher_award notification needs a dedup reference_id

**Priority:** HIGH — users flooded with duplicate badge notifications for up to 7 days
**File:** `apps/web/app/api/cron/daily-platform/route.ts`

1. Locate the `master_teacher_award` section, specifically the notification INSERT that follows the badge INSERT.
2. Add `reference_id = 'master_teacher:' || u.user_id || ':' || s.id` (or equivalent string concatenation) to the INSERT column list and values.
3. Add `ON CONFLICT (user_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING` to the INSERT.
4. Confirm the `notifications` table has a partial unique index on `(user_id, reference_id) WHERE reference_id IS NOT NULL`. If not, add the migration.
5. Run the CRON twice in a test environment covering the same 7-day window and confirm only one notification row per user.

---

## Phase 2 — Security Hardening

These bugs create exploitable or bypassable security controls.

---

### TASK-08 — Fix BUG-SEC-01: reCAPTCHA v3 must validate the action field

**Priority:** HIGH — tokens earned on any page can be replayed against any protected endpoint
**File:** `apps/web/lib/security/captcha.ts`

1. Add an optional parameter `expectedAction?: string` to `verifyCaptcha()`.
2. After parsing the Google siteverify response, if `expectedAction` is provided:
   - Compare `response.action` to `expectedAction`.
   - Return `false` (or throw a descriptive error) if they do not match.
3. Update all call sites that pass an action to `grecaptcha.execute(siteKey, { action: '...' })` on the client to also pass the same action string to `verifyCaptcha()` on the server.
4. Callers that do not perform action-specific protection (e.g., internal tools) can omit the parameter — backward compatible.

---

### TASK-09 — Fix BUG-SEC-02: postToMailgun() must use safeFetch()

**Priority:** HIGH — global fetch() bypasses SSRF protection for all outbound email requests
**File:** `apps/web/lib/notifications/email.ts`

1. Import `safeFetch` from `@/lib/security/ssrf`.
2. Replace the `fetch(url, init)` call in `postToMailgun()` with `safeFetch(url, init, { requireAllowlist: true })`.
3. No change to `HOSTNAME_ALLOWLIST` is needed — `api.mailgun.net` is already present in `ssrf.ts`.
4. Confirm that sending a test email still works end-to-end after the change.

---

### TASK-10 — Fix BUG-SSRF-01: Add R2 storage hostname to HOSTNAME_ALLOWLIST

**Priority:** MEDIUM — blocks any future server-side safeFetch calls to R2 bucket URLs
**File:** `apps/web/lib/security/ssrf.ts`

1. Add `'r2.cloudflarestorage.com'` to the `HOSTNAME_ALLOWLIST` array.
2. Add an inline comment indicating this covers Cloudflare R2 buckets (subdomain matching already works via the `.endsWith()` check).
3. Review the rest of the allowlist and add comments for all existing entries so the list is self-documenting.
4. If there are any other confirmed external service hostnames the app fetches server-side via `safeFetch`, add them now rather than discovering them at runtime.

---

## Phase 3 — Correctness, Schema, and Code Quality

These bugs produce incorrect output or violate architectural constraints, but with lower immediate financial or security impact.

---

### TASK-11 — Fix BUG-RT-01: Room message broadcast must use display_name not username

**Priority:** MEDIUM — live messages show username while history shows display_name
**File:** `apps/web/app/api/rooms/[roomId]/messages/route.ts`

1. Find the realtime broadcast payload construction in the POST handler.
2. Change `displayName: senderUsername` to `displayName: senderDisplayName ?? senderUsername`.
3. Confirm `senderDisplayName` is selected in the INSERT … RETURNING clause or in the preceding user lookup. Add it to the SELECT if missing.
4. Test: post a message as a user whose display name differs from their username and verify the live event contains the display name.

---

### TASK-12 — Fix BUG-LB-01: Remove misleading COALESCE from leaderboard upsert

**Priority:** MEDIUM — can silently overwrite a higher score with a lower one
**File:** `apps/web/lib/leaderboards/engine.ts`

1. Find the `ON CONFLICT … DO UPDATE SET score = COALESCE(excluded.score, leaderboard_snapshots.score)` clause in `upsertLeaderboardSnapshot()`.
2. Decide on the semantic:
   - If the leaderboard reflects current total XP (monotonically increasing): replace with `SET score = excluded.score`.
   - If the leaderboard should show the all-time best: replace with `SET score = GREATEST(excluded.score, leaderboard_snapshots.score)`.
3. Make the same decision for the `updated_at` field — it should always reflect the most recent call regardless.
4. Remove the COALESCE wrapper entirely after the replacement.

---

### TASK-13 — Fix BUG-CACHE-01: Link-preview cache key must hash the full URL

**Priority:** MEDIUM — different URLs with a shared 64-char prefix return wrong previews
**File:** `apps/web/app/api/messages/link-preview/route.ts`

1. Import `createHash` from `node:crypto`.
2. Replace `` `link_preview:${url.slice(0, 64)}` `` with `` `link_preview:${createHash('sha256').update(url).digest('hex')}` ``.
3. Optionally flush existing Redis cache entries with the old truncated-key pattern (they will expire naturally, so flushing is optional).
4. Confirm that two URLs sharing a common prefix now produce distinct cache keys.

---

### TASK-14 — Fix BUG-PGTN-01: listGames() must use correct cursor columns per sort mode

**Priority:** MEDIUM — page 2+ for "popular" and "trending" returns wrong or missing games
**File:** `apps/web/lib/games/repo.ts`

1. For the `"popular"` sort mode:
   - Change the emitted cursor from `items[last].created_at` to `JSON.stringify({ play_count: items[last].play_count, id: items[last].id })`, base64-encoded.
   - Change the WHERE clause from `AND g.created_at < $cursor` to `AND (g.play_count < $cursorPlayCount OR (g.play_count = $cursorPlayCount AND g.id < $cursorId))`.
2. For the `"trending"` sort mode: apply the same pattern using `recent_plays` instead of `play_count`.
3. For the `"new"` sort mode: the existing `created_at` cursor is correct — leave it unchanged.
4. Update the cursor encoding/decoding helpers to handle the new object-cursor format for the non-`new` modes.
5. Test by fetching page 1 and page 2 for "popular" and verifying no games are duplicated or skipped across pages.

---

### TASK-15 — Fix BUG-SCHEMA-01: Resolve display_name schema vs. code NULL mismatch

**Priority:** MEDIUM — schema constraint or code fallbacks must be made consistent
**Files:** `apps/web/lib/db/schema.ts`, and every file containing `?? username` / `?? sender_username` fallbacks

1. Query the production database: `SELECT COUNT(*) FROM users WHERE display_name IS NULL`.
2. **If count is 0** (NOT NULL constraint is valid):
   - Keep the schema as-is (`NOT NULL`).
   - Remove all `?? username` and `?? sender_username` fallbacks in the codebase — they are dead code.
   - Add a database-level DEFAULT for `display_name` (e.g., `DEFAULT ''` or `DEFAULT username`) to prevent future NULL insertions.
3. **If count > 0** (NULLs exist in production):
   - Write a migration that sets `display_name = username WHERE display_name IS NULL`.
   - After backfill, add `NOT NULL DEFAULT ''` or keep nullable with a DEFAULT — pick one.
   - Retain the `?? username` fallbacks in code until the migration is confirmed applied everywhere.

---

### TASK-16 — Fix BUG-API-01: buildCookieHeaders() must apply refreshTtl to the cookie

**Priority:** LOW — "remember me" / extended sessions silently use fixed TTL
**File:** `apps/web/lib/auth/session.ts`

1. Locate `buildCookieHeaders()` and find the Set-Cookie string for the refresh-token cookie.
2. Replace the hard-coded `maxAge` value with the `refreshTtl` parameter.
3. If the TTL should always be fixed (and `refreshTtl` was never meant to be variable), remove the parameter from the function signature and update all callers to stop passing it.
4. Test: call the function with two different `refreshTtl` values and confirm the resulting Set-Cookie `Max-Age` attribute reflects the passed value.

---

### TASK-17 — Fix BUG-DUP-01: Remove inline isValidSecret() from cron/payouts/route.ts

**Priority:** LOW — code duplication that can silently diverge from the canonical implementation
**Files:** `apps/web/app/api/cron/payouts/route.ts`, `apps/web/lib/cron/auth.ts`

1. Open `payouts/route.ts` and delete the private `isValidSecret()` function definition.
2. Add `import { validateCronSecret } from '@/lib/cron/auth'` at the top of the file.
3. Replace all calls to the deleted `isValidSecret(request)` with `validateCronSecret(request)`.
4. Confirm `validateCronSecret` returns the same boolean semantics as the deleted function (check the return type — it may return `void` and throw instead of returning `false`; adjust the call site accordingly).
5. Run the payouts CRON in a test environment with a valid and an invalid secret to confirm auth still works.

---

## Fix Sequencing Summary

| Phase | Task | Bug | Priority |
|---|---|---|---|
| 1 | TASK-01 | BUG-NOTIF-01 | CRITICAL |
| 1 | TASK-02 | BUG-WH-01 | CRITICAL |
| 1 | TASK-03 | BUG-ECON-01 | CRITICAL |
| 1 | TASK-04 | BUG-ECON-02 | CRITICAL |
| 1 | TASK-05 | BUG-ECON-03 | CRITICAL |
| 1 | TASK-06 | BUG-PAY-01 | HIGH |
| 1 | TASK-07 | BUG-CRON-01 | HIGH |
| 2 | TASK-08 | BUG-SEC-01 | HIGH |
| 2 | TASK-09 | BUG-SEC-02 | HIGH |
| 2 | TASK-10 | BUG-SSRF-01 | MEDIUM |
| 3 | TASK-11 | BUG-RT-01 | MEDIUM |
| 3 | TASK-12 | BUG-LB-01 | MEDIUM |
| 3 | TASK-13 | BUG-CACHE-01 | MEDIUM |
| 3 | TASK-14 | BUG-PGTN-01 | MEDIUM |
| 3 | TASK-15 | BUG-SCHEMA-01 | MEDIUM |
| 3 | TASK-16 | BUG-API-01 | LOW |
| 3 | TASK-17 | BUG-DUP-01 | LOW |

---

*Fix plan generated: June 20, 2026 · 11:45 AM*
*Total tasks: 17 | Estimated effort: 2–3 engineering days*
*DO NOT BEGIN IMPLEMENTATION UNTIL THE USER APPROVES THIS PLAN*
