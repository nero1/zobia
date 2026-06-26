# Zobia Social — Bug Fix Plan

**Date:** June 26, 2026
**Time:** 12:00 PM (12-hour format)
**Based on:** custom-bugs-report.md (75 bugs, BUG-001 through BUG-075)
**Status:** PLAN ONLY — no fixes applied. Awaiting review and approval.

---

## Overview

75 bugs are organized into 4 execution phases based on severity and risk. Critical production-breaking and security bugs are addressed first. Financial integrity and data-loss risks come second. Reliability, correctness, and schema hardening third. Minor improvements and cleanup last.

**Severity breakdown:**
- Phase 1 — Critical (fix immediately, production broken or high-exploit risk): 8 bugs
- Phase 2 — High (security, financial integrity, data loss): 22 bugs
- Phase 3 — Medium (reliability, correctness, edge cases): 28 bugs
- Phase 4 — Low (cleanup, hardening, minor improvements): 17 bugs

Each task entry references the BUG code from the report, the affected file(s), and the effort estimate (S = ≤1h, M = 1–4h, L = 4–8h, XL = 8h+).

---

## Phase 1 — Critical: Fix Immediately

These bugs are either production-breaking right now (entire feature disabled) or expose an immediately exploitable security/financial vulnerability.

---

### TASK-C01 — Fix Paystack Webhook Syntax Error (BUG-001)

**Bug:** `import { logger } from "@/lib/logger"` is injected inside another import's brace block, breaking the entire module. The Paystack webhook endpoint 500s on every call — no payments are processed.

**Files:** `apps/web/app/api/economy/webhooks/paystack/route.ts`

**Steps:**
1. Open the file and locate the malformed import block (lines 23–30).
2. Remove the injected `import { logger }` line from inside the outer import.
3. Add `import { logger } from "@/lib/logger";` as a standalone import line at the top of the file, alongside the other imports.
4. Run `tsc --noEmit` to confirm no remaining type errors in this file.
5. Test the webhook endpoint locally or in staging with a Paystack test event payload.

**Effort:** S

---

### TASK-C02 — Fix Paystack Webhook `db.query()` NullPointerError (BUG-022)

**Bug:** In the non-recoverable error handler, `db.query(...)` is called to mark a webhook failed. When `DATABASE_PROVIDER=supabase`, the `db` object is the Drizzle Supabase client which does not expose a `.query()` method (or the variable is `null`) — this throws a TypeError, masking the original error and preventing webhook failure recording.

**Files:** `apps/web/app/api/economy/webhooks/paystack/route.ts`

**Steps:**
1. Replace the raw `db.query()` call in the catch block with the Drizzle ORM update API: `await db.update(failedWebhooks).set({ status: 'dead' }).where(...)`.
2. Wrap the update itself in a try/catch so a DB failure in the error handler is logged but does not re-throw.
3. Confirm the pattern is consistent with how other webhook handlers record failure.

**Effort:** S

---

### TASK-C03 — Fix Payout Over-Restoration on `net_kobo` Null (BUG-006)

**Bug:** `restoreAmount = current[0].net_kobo ?? current[0].gross_kobo` over-restores creator earnings by the full platform fee (up to 20% of payout value) when `net_kobo` is null.

**Files:** `apps/web/lib/payments/payouts.ts`

**Steps:**
1. Add a guard: if `net_kobo` is null when entering the restoration path, throw an application error (do not fall back to `gross_kobo`) and push the item to the payout dead-letter queue for manual ops review.
2. Add an ops alert notification at this error path.
3. Audit all existing payout rows in production to find any with null `net_kobo` and null out or correct any incorrect restorations already applied.
4. Add a migration to set `net_kobo NOT NULL` with a migration-time backfill from `gross_kobo * (1 - platform_fee_rate)` for legacy rows where `net_kobo` is null but `gross_kobo` is known.

**Effort:** M

---

### TASK-C04 — Fix Guild Member Re-join Failure (BUG-009)

**Bug:** The unique index on `(guild_id, user_id)` is non-partial, blocking soft-deleted users from re-joining the same guild.

**Files:** `apps/web/lib/db/schema.ts`, whichever migration handles `guild_members`

**Steps:**
1. Write a new Drizzle migration that drops the existing `guild_members_guild_user_idx` unique index.
2. Create a new partial unique index: `CREATE UNIQUE INDEX guild_members_guild_user_active_idx ON guild_members (guild_id, user_id) WHERE left_at IS NULL`.
3. Update the guild join logic in the application to `UPDATE guild_members SET left_at = NULL, joined_at = NOW(), role = 'member' WHERE guild_id = $1 AND user_id = $2` instead of INSERT on conflict (use `INSERT ... ON CONFLICT ... DO UPDATE`).
4. Test re-join flow: leave guild → wait for cooldown if any → re-join → confirm row updated correctly, not duplicated.

**Effort:** M

---

### TASK-C05 — Fix `storeItems.priceKobo` Nullable — Free-Purchase Risk (BUG-019)

**Bug:** `priceKobo` has no `.notNull()` constraint; null price can allow free purchases.

**Files:** `apps/web/lib/db/schema.ts`, purchase handler API route

**Steps:**
1. Write a migration to backfill any existing null `price_kobo` rows (set to 0 or delete them), then add `ALTER TABLE store_items ALTER COLUMN price_kobo SET NOT NULL`.
2. Add a `CHECK (price_kobo >= 0)` constraint to the column.
3. Update the Drizzle schema definition to add `.notNull()` to `priceKobo`.
4. In the purchase handler, add an explicit `if (item.priceKobo === null || item.priceKobo < 0)` guard with a 400 error before processing payment.

**Effort:** M

---

### TASK-C06 — Fix `ONBOARDING_ALLOWED_PREFIXES` Over-Broad `/api` (BUG-002)

**Bug:** Including `"/api"` in `ONBOARDING_ALLOWED_PREFIXES` lets any user skip onboarding and hit any API route directly.

**Files:** `apps/web/middleware.ts`

**Steps:**
1. Replace the `"/api"` entry in `ONBOARDING_ALLOWED_PREFIXES` with the minimal specific set of allowed API prefixes for pre-onboarding users: `"/api/auth"`, `"/api/config"`, `"/api/manifest"`, `"/api/public"`, `"/api/health"`.
2. Test the Expo app to confirm that all API calls made during onboarding still succeed with the narrower allowlist.
3. Test that a request to `/api/economy/purchase` with an onboarding-incomplete JWT is now rejected with a redirect to the onboarding flow.

**Effort:** S

---

### TASK-C07 — Fix `distributeSeasonRewards` TOCTOU on Concurrent CRONs (BUG-023)

**Bug:** Season reward distribution reads season and user data outside the credit transaction, allowing concurrent CRON invocations to double-reward users.

**Files:** `apps/web/lib/seasons/seasonEngine.ts`

**Steps:**
1. Add a `status` column (or dedicated `rewards_distributed_at` timestamp) to the `seasons` table.
2. At the start of `distributeSeasonRewards`, perform an atomic `UPDATE seasons SET status = 'distributing' WHERE id = $id AND status = 'ended' RETURNING id` (using Drizzle `returning()`). If no row is returned, another instance is already distributing — exit immediately.
3. Move the top-users query and all reward credits inside a single DB transaction that begins after claiming the `distributing` status.
4. On completion, set `status = 'rewards_distributed'`.
5. Test by simulating two simultaneous CRON calls and confirm only one succeeds.

**Effort:** L

---

### TASK-C08 — Fix `withRLS` `SET LOCAL` Ineffective Outside Transaction (BUG-065)

**Bug:** `SET LOCAL app.current_user_id = '...'` only persists for the duration of the current transaction. Queries run outside a transaction context (any bare `db.select()` not wrapped in `db.transaction()`) revert the session variable immediately, meaning RLS policies that depend on `app.current_user_id` are not applied.

**Files:** `apps/web/lib/db/withRLS.ts` (or equivalent utility)

**Steps:**
1. Change `withRLS` to always open an explicit DB transaction: `db.transaction(async (tx) => { await tx.execute(sql\`SET LOCAL app.current_user_id = ${userId}\`); return callback(tx); })`.
2. Audit all call sites of `withRLS` to ensure they pass the transaction client `tx` to their queries, not a top-level `db` handle.
3. For cases where callers cannot be in a transaction, use `SET SESSION app.current_user_id = ...` with explicit reset (`SET SESSION app.current_user_id TO DEFAULT`) in a try/finally, and document the trade-off.
4. Add an integration test that confirms `current_user_id` is accessible inside RLS policies during and not after the callback.

**Effort:** L

---

## Phase 2 — High: Security, Financial Integrity, Data Loss

These bugs have direct security implications or can cause financial data corruption or loss.

---

### TASK-H01 — Fix Bigint `mode:"number"` Precision Loss on Financial Columns (BUG-003, BUG-004)

**Bugs:** BUG-003, BUG-004

**Files:** `apps/web/lib/db/schema.ts`

**Steps:**
1. Change `storeItems.coinsCost` and `storeItems.coinsGranted` from `mode:"number"` to `mode:"bigint"`.
2. Change `referralCommissions.commissionCoins` from `mode:"number"` to `mode:"bigint"`.
3. Audit all call sites that read these columns; update any code that passes them to arithmetic operations or Decimal.js constructors to handle `bigint` type (use `.toString()` for Decimal.js and `Number()` only after a safe-integer bounds check).
4. Ensure TypeScript types propagate correctly (Drizzle will now type these as `bigint`, not `number`).

**Effort:** M

---

### TASK-H02 — Fix `transferCoins` Idempotency Collision on Shared `referenceId` (BUG-059)

**Bug:** Debit and credit ledger entries use the same `referenceId` as idempotency key — two entries for the same reference can conflict or one silently no-ops.

**Files:** `apps/web/lib/economy/coins.ts`

**Steps:**
1. Use distinct idempotency keys for debit and credit: `${referenceId}:debit` and `${referenceId}:credit`.
2. Verify that the ledger's `ON CONFLICT (reference_id) DO NOTHING` behavior is still correct with the suffixed keys.
3. Ensure the `transferRef` pattern is applied consistently in all transfer code paths.

**Effort:** S

---

### TASK-H03 — Fix `restoreAmount` and Add Circuit Breaker for Paystack HTTP Calls (BUG-073)

**Bug:** No circuit breaker around Paystack HTTP calls; repeated failures exhaust retry slots and create cascading DLQ backlog.

**Files:** `apps/web/lib/payments/payouts.ts`

**Steps:**
1. Implement a circuit breaker (open/half-open/closed state) for Paystack HTTP calls using a Redis key to store state, with a 60-second open window and a 2-success threshold to close.
2. When the circuit is open, move retry items to the DLQ immediately rather than attempting the HTTP call.
3. Add a metric/alert when the circuit opens so ops is notified of a Paystack API outage.

**Effort:** L

---

### TASK-H04 — Fix Refresh Token Exposure in JSON Response Body (BUG-058)

**Bug:** The refresh token is included in the JSON response body for mobile clients, where it may appear in server access logs or CDN logs.

**Files:** `apps/web/app/api/auth/refresh/route.ts`

**Steps:**
1. Evaluate whether the Expo client can store the refresh token as an httpOnly cookie on the mobile webview or via SecureStore.
2. If mobile truly requires the token in the body, log a rotation event ID (not the token itself) for correlation, and add a warning comment.
3. Alternatively, use a short-lived token-exchange flow: return a one-time code in the body that the mobile client immediately exchanges for the actual refresh token via a separate HTTPS call.
4. Ensure `Cache-Control: no-store` and `Pragma: no-cache` are set on all auth token response headers.

**Effort:** M

---

### TASK-H05 — Fix `footerScripts` and Announcement HTML Stored XSS (BUG-020)

**Bug:** Admin-inserted raw HTML/JS is rendered without sanitization.

**Files:** `apps/web/lib/db/schema.ts`, admin HTML insertion routes, front-end render components

**Steps:**
1. For `footerScripts.content`: restrict insertion to super-admins only via a role check at the API level, and log all insertions to `adminAuditLog` with immutable timestamp.
2. For `announcementModals.content` and `announcementBanners.content` with `contentType='html'`: pass content through the existing `htmlSanitizer.ts` at the point of insertion (not just at render time).
3. Add a strict allowlist of permitted HTML tags and attributes for announcements (e.g., `<b>`, `<i>`, `<a>`, `<p>`, `<br>`) in the sanitizer configuration for this use case.
4. Add an integration test that verifies `<script>` tags are stripped from announcement content on insert.

**Effort:** M

---

### TASK-H06 — Fix HTML Sanitizer Global `class` Allowance (BUG-011)

**Bug:** `allowedAttributes: { '*': ['class'] }` enables CSS injection.

**Files:** `apps/web/lib/security/htmlSanitizer.ts`

**Steps:**
1. Remove `'*': ['class']` from the global allowedAttributes.
2. Add `class` only to specific elements where it is required (e.g., `<code class="language-js">`).
3. Add `disallowedTagsMode: 'discard'` and explicitly strip all `data-*` attributes using the `allowedAttributes` configuration.
4. Test all rich-text rendered surfaces (user bios, messages, post bodies) to confirm no visual regressions from class removal.

**Effort:** S

---

### TASK-H07 — Fix SSRF `HOSTNAME_ALLOWLIST` Missing Supabase URLs (BUG-012)

**Bug:** When `STORAGE_PROVIDER=supabase-storage`, Supabase storage hostnames are not in the SSRF allowlist, causing server-side storage fetches to fail.

**Files:** `apps/web/lib/security/ssrf.ts`

**Steps:**
1. Read `NEXT_PUBLIC_SUPABASE_HOST` and `NEXT_PUBLIC_SUPABASE_IN_HOST` from env.
2. Conditionally add these hostnames to `HOSTNAME_ALLOWLIST` when `STORAGE_PROVIDER=supabase-storage` or always add them (safe since they're controlled infrastructure).
3. Write a unit test asserting that a `safeFetch` to the configured Supabase host succeeds and to an arbitrary host fails.

**Effort:** S

---

### TASK-H08 — Fix `announcementBanners.linkUrl` and `sponsoredLeaderboardBanners.ctaUrl` Not URL-Validated (BUG-043, BUG-063)

**Bugs:** BUG-043, BUG-063

**Files:** `apps/web/lib/db/schema.ts`, admin API routes for banner creation/update

**Steps:**
1. At the API layer for creating/updating these rows, validate that `linkUrl`/`ctaUrl` starts with `https://` (or is a safe relative path) using a URL-parse check.
2. Reject any value starting with `javascript:`, `data:`, or `vbscript:`.
3. Add a `CHECK` constraint at the DB level: `CHECK (link_url IS NULL OR link_url ~ '^https?://')`.
4. On the front-end render side, ensure these URLs are passed to `<Link href={...}>` with `target="_blank" rel="noopener noreferrer"` and never to `dangerouslySetInnerHTML`.

**Effort:** S

---

### TASK-H09 — Fix JWT Key Rotation — Old Token Invalidation Risk (BUG-007)

**Bug:** If `JWT_SECRET_v1` is not explicitly set when rotating to `v2`, all existing user sessions are invalidated.

**Files:** `apps/web/lib/auth/jwt.ts`

**Steps:**
1. Add a startup check that logs a prominent WARNING if `JWT_KEY_ID` is not `"v1"` but `JWT_SECRET_v1` is unset, instructing operators to set it.
2. Document in `README` (or ops runbook): when rotating `JWT_KEY_ID` from `v1` to `v2`, the old `JWT_SECRET` value must be set as `JWT_SECRET_v1` in the same deployment.
3. Consider adding a grace period key-rotation helper: a migration script that rotates all active refresh tokens in Redis to new keys, triggered once the new key is stable.

**Effort:** M

---

### TASK-H10 — Fix `captcha` Provider Falls Back to `"none"` on Unexpected Value (BUG-051)

**Bug:** An unexpected manifest captcha provider string causes silent fallback to `"none"`, effectively disabling CAPTCHA for all users.

**Files:** `apps/web/lib/security/captcha.ts`

**Steps:**
1. Change the fallback behavior: instead of silently using `"none"`, throw a configuration error (logged to monitoring) and default to the most restrictive known provider.
2. If using `_lastKnownGoodProvider`, ensure it is initialized from a known-good default (`"recaptcha"` or `"turnstile"`) rather than `"none"`.
3. Add an alert when the manifest returns an unrecognized captcha provider value.

**Effort:** S

---

### TASK-H11 — Fix `guildWars` Resolution Lacking DB Idempotency Guard (BUG-071)

**Bug:** Two concurrent CRON instances could resolve the same war, double-crediting winners.

**Files:** `apps/web/lib/guilds/warEngine.ts`

**Steps:**
1. Add a `resolved_at` timestamp column to `guild_wars`.
2. Before resolving, run `UPDATE guild_wars SET resolved_at = NOW() WHERE id = $id AND resolved_at IS NULL RETURNING id`. If no row is returned, another instance already resolved — exit.
3. Move all reward distribution inside the same transaction as the `resolved_at` update.
4. Add a unique index or application-level guard to ensure rewards are credited only once per war.

**Effort:** M

---

### TASK-H12 — Fix `findWarOpponent` TOCTOU on Busy-Guild Check (BUG-026)

**Bug:** Busy-guild check is a separate query before matchmaking — another instance can match the same guild in the window between the check and the insert.

**Files:** `apps/web/lib/guilds/warEngine.ts`

**Steps:**
1. Move the busy-guild check into the same DB transaction as the war record INSERT, using a `SELECT ... FOR UPDATE NOWAIT` on the guild row.
2. If the lock fails (another instance holds it), raise a user-friendly error and abort matchmaking.
3. Alternatively, use a Redis distributed lock (`SET nx ex`) keyed on `war:matchmaking:${guildId}` to serialize the entire matchmaking operation per guild.

**Effort:** M

---

### TASK-H13 — Fix War Entry Fee Deducted Without Treasury Balance Pre-check (BUG-034)

**Bug:** Guild war entry fee is deducted without pre-checking treasury balance — can result in negative treasury.

**Files:** `apps/web/lib/guilds/warEngine.ts`

**Steps:**
1. Read the guild treasury balance inside the transaction (using `SELECT ... FOR UPDATE`) before deducting the entry fee.
2. If balance < `WAR_ENTRY_FEE_COINS`, abort the matchmaking with a clear error message to the guild admin.
3. Add a CHECK constraint or application-level guard to ensure guild treasury coin balance never goes negative.

**Effort:** S

---

### TASK-H14 — Fix `reactionSets.coinPrice` No Minimum CHECK Constraint (BUG-044)

**Bug:** `coinPrice` can be set to 0 or negative by an admin, making reactions free or causing negative coin deductions.

**Files:** `apps/web/lib/db/schema.ts`

**Steps:**
1. Add a migration adding `CHECK (coin_price >= 1)` to `reaction_sets.coin_price`.
2. Update the Drizzle schema to add `.check(sql\`coin_price >= 1\`)` (or use Drizzle v2 check syntax).
3. Validate coin price at the admin API insert/update layer as well (`>= 1`).

**Effort:** S

---

### TASK-H15 — Fix `loadPendingRecovery` Silent JSON Parse Error Swallowing (BUG-030, BUG-070)

**Bugs:** BUG-030, BUG-070

**Files:** `apps/expo/lib/payments/googlePlay.ts`

**Steps:**
1. In `loadPendingRecovery`, catch JSON.parse errors explicitly and log them to the crash reporter (Sentry/equivalent).
2. On parse error, clear the corrupted SecureStore key (to unblock future purchases) and log a warning that recovery data was lost.
3. Add Zod schema validation on the parsed object before loading it into `pendingRecovery`. Invalid schema → treat as no recovery data + log warning.
4. Test by manually corrupting the SecureStore value and confirming the app recovers gracefully.

**Effort:** M

---

### TASK-H16 — Fix `payments.updatedAt` Not Auto-Updated on Status Transitions (BUG-027)

**Bug:** `updatedAt` always shows creation time, making it impossible to track when a payment status changed.

**Files:** `apps/web/lib/db/schema.ts`, payment status update queries

**Steps:**
1. Add a DB-level trigger: `CREATE OR REPLACE TRIGGER payments_set_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at()` (using a standard Drizzle/Supabase timestamp trigger).
2. Alternatively, ensure all Drizzle `db.update(payments).set({ status, updatedAt: new Date() })` calls explicitly include `updatedAt: new Date()`.
3. Audit all payment status transition code paths and confirm `updatedAt` is always set.

**Effort:** S

---

### TASK-H17 — Fix `SKIP_ENV_VALIDATION=1` Producing All-Undefined Proxy (BUG-048)

**Bug:** `SKIP_ENV_VALIDATION=1` makes `env` return `undefined` for all keys — runtime crashes deferred silently to first use.

**Files:** `apps/web/lib/env.ts`

**Steps:**
1. Change `SKIP_ENV_VALIDATION` behavior: either fail fast with a clear error, or return `process.env` directly (unsafe but explicit).
2. Restrict `SKIP_ENV_VALIDATION` to build-time only by checking `process.env.NODE_ENV === 'test'` and refusing to skip in production.
3. Document clearly in `.env.example` that `SKIP_ENV_VALIDATION` must never be set in production deployments.

**Effort:** S

---

### TASK-H18 — Fix `moderationAiEscalations.reportId` Missing DB-Level FK (BUG-066)

**Bug:** The FK to `moderation_reports.id` is only in code comments, not enforced at the DB level.

**Files:** `apps/web/lib/db/schema.ts`

**Steps:**
1. Add a Drizzle FK reference: `.references(() => moderationReports.id, { onDelete: 'cascade' })` on `moderationAiEscalations.reportId`.
2. Write a migration adding the FK: `ALTER TABLE moderation_ai_escalations ADD CONSTRAINT fk_moderation_report FOREIGN KEY (report_id) REFERENCES moderation_reports(id) ON DELETE CASCADE`.
3. Check for any existing orphaned rows before running the migration and clean them up.

**Effort:** S

---

### TASK-H19 — Fix `messages.conversationId` Nullable Without FK (BUG-054)

**Bug:** `conversationId` is nullable without a FK to `dmConversations`, allowing orphaned message rows.

**Files:** `apps/web/lib/db/schema.ts`

**Steps:**
1. Add `.references(() => dmConversations.id, { onDelete: 'cascade' })` to `messages.conversationId`.
2. If `conversationId` can legitimately be null (channel messages vs DMs), add a CHECK constraint: `CHECK ((conversation_id IS NULL) != (channel_id IS NULL))` to enforce exactly one must be set.
3. Clean up any existing rows with null `conversationId` AND null `channelId`.

**Effort:** S

---

### TASK-H20 — Fix `canAfford()` TOCTOU Race — Documented Atomic Helper Needed (BUG-005)

**Bug:** `canAfford()` reads balance without a lock; callers can race between check and debit.

**Files:** `apps/web/lib/economy/coins.ts`

**Steps:**
1. Add a JSDoc comment to `canAfford()` explicitly warning it is advisory only and must not be used as the sole gate on a financial debit.
2. Create an `ensureAffordableAndDebit(userId, amount, reference, tx)` helper that performs `SELECT FOR UPDATE` + balance check + debit in a single atomic function.
3. Audit all call sites of `canAfford()` that are followed by a debit operation and migrate them to the new atomic helper.

**Effort:** M

---

### TASK-H21 — Fix `adminAuditLog` Missing Indexes (BUG-025)

**Bug:** No indexes on `admin_id` or `created_at` — audit log queries will full-scan at scale.

**Files:** `apps/web/lib/db/schema.ts`

**Steps:**
1. Add an index on `admin_audit_log.admin_id`.
2. Add an index on `admin_audit_log.created_at DESC`.
3. Consider a composite index `(admin_id, created_at DESC)` for paginated per-admin audit views.

**Effort:** S

---

### TASK-H22 — Fix `DLQ` No Depth-Monitoring Alert (BUG-061)

**Bug:** `payoutDeadLetterQueue` depth grows silently with no operator alert.

**Files:** `apps/web/lib/payments/payouts.ts`, monitoring/alerting config

**Steps:**
1. In the daily CRON that processes the DLQ, emit a `trackEvent('dlq.depth', { depth: count })` metric after counting pending items.
2. Add a threshold alert: if `depth > N` (e.g., 10), send an urgent notification to the ops channel via the existing notification provider.
3. Add `dlq_depth` as a visible stat on the admin monitoring dashboard.

**Effort:** S

---

## Phase 3 — Medium: Reliability, Correctness, Schema Hardening

---

### TASK-M01 — Fix `SessionRecord` Storing Stale Email (BUG-010)

**Files:** `apps/web/lib/auth/session.ts`

**Steps:**
1. Remove the `email` field from `SessionRecord`.
2. Update all code reading `session.email` to instead query the DB for the current user's email when needed.
3. Alternatively, on every email change, call the existing session-invalidation utility to force all devices to re-authenticate.

**Effort:** M

---

### TASK-M02 — Fix `telegramLoginStates` Table — No TTL / Unbounded Growth (BUG-015)

**Files:** `apps/web/lib/db/schema.ts`, Telegram auth route, daily CRON

**Steps:**
1. Add `expires_at TIMESTAMPTZ NOT NULL` column to `telegram_login_states`.
2. Create an index on `expires_at`.
3. Set `expires_at = NOW() + INTERVAL '15 minutes'` at row creation time.
4. Add cleanup to the daily CRON: `DELETE FROM telegram_login_states WHERE expires_at < NOW()`.
5. In the Telegram auth verification handler, reject tokens where `expires_at < NOW()`.

**Effort:** S

---

### TASK-M03 — Fix `xpLedger.amount` Integer Overflow Risk (BUG-035)

**Files:** `apps/web/lib/db/schema.ts`

**Steps:**
1. Change `xp_ledger.amount` from `integer` to `bigint` in the schema and write the accompanying migration.
2. Update Drizzle column definition to `bigint("amount", { mode: "bigint" })`.
3. Update all XP arithmetic in the XP engine to handle `bigint` values.

**Effort:** S

---

### TASK-M04 — Fix `poweredByHeader` Not Disabled in next.config.js (BUG-018)

**Files:** `apps/web/next.config.js`

**Steps:**
1. Add `poweredByHeader: false` to the `nextConfig` object.
2. Verify in a local build that the `X-Powered-By` header is no longer present.

**Effort:** S (5 minutes)

---

### TASK-M05 — Fix Deprecated `X-XSS-Protection` Header in vercel.json (BUG-017)

**Files:** `apps/web/vercel.json`

**Steps:**
1. Remove the `{ "key": "X-XSS-Protection", "value": "1; mode=block" }` entry from `vercel.json` headers.
2. Or replace with `X-XSS-Protection: 0` to explicitly disable the IE auditor.

**Effort:** S (5 minutes)

---

### TASK-M06 — Fix `X-Frame-Options` / CSP `frame-ancestors` Conflict (BUG-038) and Missing Header in Middleware (BUG-008)

**Bugs:** BUG-008, BUG-038

**Files:** `apps/web/middleware.ts`, `apps/web/vercel.json`

**Steps:**
1. Remove `X-Frame-Options: DENY` from `vercel.json` to avoid conflict with the middleware's CSP `frame-ancestors 'self'`.
2. In `withCsp()` in middleware, add `response.headers.set('X-Frame-Options', 'SAMEORIGIN')` so old-browser clickjacking protection remains.
3. Verify that the middleware header is present in responses using `curl -I`.

**Effort:** S

---

### TASK-M07 — Fix CSP `img-src` Missing R2 Dev/Custom URL (BUG-039, BUG-074)

**Bugs:** BUG-039, BUG-074

**Files:** `apps/web/middleware.ts`

**Steps:**
1. Read `NEXT_PUBLIC_R2_DEV_HOST` and `NEXT_PUBLIC_R2_STORAGE_HOST` from env in the middleware CSP builder.
2. Add them to the `img-src` directive alongside the existing Supabase and Google image hostnames.
3. Test that user avatars served from R2 dev URLs load without CSP violations.

**Effort:** S

---

### TASK-M08 — Fix `trackEvent()` Dropping Attributes for Sentry (BUG-014)

**Files:** `apps/web/lib/monitoring/index.ts`

**Steps:**
1. Replace `sentry.captureMessage(name, "info")` with `sentry.withScope((scope) => { scope.setExtras(attributes); sentry.captureMessage(name, 'info'); })`.
2. Add a unit test asserting that attributes are present in the captured Sentry event.

**Effort:** S

---

### TASK-M09 — Fix `trackEvent()` Silent No-Op in Production with `MONITORING_PROVIDER=none` (BUG-047)

**Files:** `apps/web/lib/monitoring/index.ts`

**Steps:**
1. Log a startup warning when `MONITORING_PROVIDER=none` in a non-test environment.
2. Add a structured console.log fallback in the `none` provider that outputs event name + attributes as JSON to stdout (so events appear in serverless function logs).

**Effort:** S

---

### TASK-M10 — Fix `games.playCount` Non-Atomic Increment (BUG-040)

**Files:** `apps/web/lib/games/*` (game submission handler)

**Steps:**
1. Replace any read-modify-write pattern for `play_count` with an atomic SQL increment: `UPDATE games SET play_count = play_count + 1 WHERE id = $id`.
2. Ensure this is done within the game session commit transaction.

**Effort:** S

---

### TASK-M11 — Fix `storeItems.validUntil` Not Checked at Purchase Confirmation (BUG-042, BUG-075)

**Bugs:** BUG-042, BUG-075

**Files:** Purchase handler API route, `apps/web/lib/economy/store.ts`

**Steps:**
1. Add `WHERE valid_until IS NULL OR valid_until > NOW()` to the store item lookup query inside the purchase transaction.
2. Lock the row with `SELECT ... FOR UPDATE` inside the transaction to prevent a race during expiry.
3. If the item has expired between the product list display and the purchase commit, return a 409 "item no longer available" error.

**Effort:** S

---

### TASK-M12 — Fix `referralCommissions.tier` Type Inconsistency With `referrals.tier` (BUG-057)

**Files:** `apps/web/lib/db/schema.ts`, referral commission code

**Steps:**
1. Change `referral_commissions.tier` from `text` default `'1'` to `integer` default `1` to match `referrals.tier`.
2. Write a migration: `ALTER TABLE referral_commissions ALTER COLUMN tier TYPE INTEGER USING tier::INTEGER`.
3. Update all application code and Drizzle queries that read `commissionRow.tier` to handle integer type.

**Effort:** S

---

### TASK-M13 — Fix `createSeasonCeremonyRoom` Expression Index Dependency (BUG-024)

**Files:** `apps/web/lib/seasons/seasonEngine.ts`, migration files

**Steps:**
1. Verify whether the expression index `ON rooms ((metadata->>'season_ceremony_id'))` exists in the migration history.
2. If it doesn't exist, add a migration to create it.
3. If the index cannot be created (e.g., JSONB column with expression), consider using a dedicated `season_ceremony_id` column in the `rooms` table instead.

**Effort:** M

---

### TASK-M14 — Fix `Paystack` Subscription Plan Detection via Fragile Regex (BUG-013)

**Files:** `apps/web/lib/payments/paystackWebhookHandler.ts`, DB schema for `storeItems`

**Steps:**
1. Add a `paystack_plan_code` column to `store_items` (or a `paystack_plans` lookup table).
2. In the webhook handler, look up the plan type by `plan.plan_code` against the DB table instead of regex-matching the plan name.
3. Add an admin UI or migration script to populate this mapping.
4. Write a test that confirms a renamed plan still maps correctly.

**Effort:** L

---

### TASK-M15 — Fix `season pass sticker_pack` Reward Non-Unique Name Lookup (BUG-062)

**Files:** `apps/web/lib/seasons/seasonEngine.ts`

**Steps:**
1. Add a `UNIQUE` constraint on `sticker_packs.name` if names are intended to be unique. If not unique, remove the name fallback lookup entirely.
2. Change the reward reference to use `sticker_pack_id` (UUID) stored in the season pass milestone config instead of a string slug/name.
3. Update all admin reward configuration to store UUID references.

**Effort:** M

---

### TASK-M16 — Fix `redis.keys()` in Public Interface — O(N) Risk (BUG-031)

**Files:** `apps/web/lib/redis/index.ts`

**Steps:**
1. Remove `keys(pattern)` from the `RedisClient` public interface or mark it as `@internal` with a deprecation warning.
2. Replace any usage of `keys()` in hot paths with `scan()` (cursor-based iteration) to avoid blocking the Redis event loop.
3. For Upstash, verify whether the `keys()` command is rate-limited and use the scan alternative.

**Effort:** M

---

### TASK-M17 — Fix `userAnnouncementRotation.lastShownId` Missing FK Constraint (BUG-033)

**Files:** `apps/web/lib/db/schema.ts`

**Steps:**
1. Add a FK: `.references(() => announcements.id, { onDelete: 'set null' })` (or the correct parent table for the announcement type).
2. Write a migration adding the FK constraint.
3. Handle the `ON DELETE SET NULL` case in the rotation logic so a deleted announcement doesn't prevent the column from being updated.

**Effort:** S

---

### TASK-M18 — Fix `adminMessages.targetUserIds` Unbounded Array (BUG-067)

**Files:** `apps/web/lib/db/schema.ts`, admin broadcast API

**Steps:**
1. Add an application-level limit at the admin API: reject if `targetUserIds.length > MAX_BROADCAST_RECIPIENTS` (e.g., 10,000).
2. For large broadcasts, require using a cohort/filter approach (e.g., `target = 'all'` or `target = 'segment:premium'`) rather than an explicit array.
3. Add a CHECK constraint or trigger on the DB side if possible.

**Effort:** M

---

### TASK-M19 — Fix `dataExportRequests` No Expiry/Cleanup (BUG-068)

**Files:** `apps/web/lib/db/schema.ts`, `apps/web/app/api/cron/daily-core/route.ts`

**Steps:**
1. Add an `expires_at` column to `data_export_requests`.
2. Set `expires_at = NOW() + INTERVAL '30 days'` when creating an export request.
3. Add cleanup to the daily CRON: `DELETE FROM data_export_requests WHERE expires_at < NOW()`.
4. Ensure the associated storage file is also deleted when the row expires (call `storage.delete(key)`).

**Effort:** S

---

### TASK-M20 — Fix `moments` No CHECK for `media_url` When Content Is Non-Text (BUG-055)

**Files:** `apps/web/lib/db/schema.ts`, moment creation API

**Steps:**
1. Add an application-level validation in the moment creation handler: if `content_type != 'text'`, require `media_url` to be non-null.
2. Optionally add a DB-level CHECK: `CHECK (content_type = 'text' OR media_url IS NOT NULL)`.
3. Audit existing moments rows for violations and set a placeholder or delete corrupt rows.

**Effort:** S

---

### TASK-M21 — Fix `gifts.giftItemId` NOT NULL Even With New `giftTypeId` System (BUG-045)

**Files:** `apps/web/lib/db/schema.ts`, gift creation API

**Steps:**
1. Decide the canonical FK: if `giftTypeId` is the new system, make `giftItemId` nullable (`.references().nullable()`).
2. Write a migration to make `gift_item_id` nullable.
3. Update gift creation logic to populate whichever FK is appropriate for the gift type.
4. Add a CHECK ensuring at least one of `gift_item_id` or `gift_type_id` is non-null.

**Effort:** M

---

### TASK-M22 — Fix CSRF Check — Expo App Mutations Without Origin Header (BUG-053)

**Files:** `apps/web/middleware.ts`

**Steps:**
1. In `isCsrfSafe`, add a check: if the request has a valid `Authorization: Bearer <token>` header (JWT-authenticated API call from Expo), skip the Origin check for non-browser-routed paths (i.e., paths under `/api/` but not state-mutating endpoints shared with browsers).
2. Alternatively, configure the Expo app to always send `Origin: https://app.zobia.com` (or the production domain) on all API calls.
3. Document the CSRF model clearly: cookie-authenticated requests require Origin validation; bearer-token-authenticated requests (Expo) rely on the token for auth.

**Effort:** M

---

### TASK-M23 — Fix `communityNoteVotes` No Rate Limit on Vote Toggle (BUG-041)

**Files:** `apps/web/app/api/community-notes/vote/route.ts` (or equivalent)

**Steps:**
1. Apply the existing rate-limiting middleware (`rateLimit()`) to the community note vote endpoint with a tight per-user limit (e.g., 30 votes per 10 minutes).
2. Add a `UNIQUE` constraint on `(note_id, user_id)` to prevent duplicate votes at the DB level.
3. For the toggle use case, use `INSERT ... ON CONFLICT DO UPDATE` or `DELETE ... RETURNING` in a single atomic operation.

**Effort:** S

---

### TASK-M24 — Fix `refunds.status` Defaults to `'processed'` Immediately (BUG-029)

**Files:** `apps/web/lib/db/schema.ts`

**Steps:**
1. Change the default value of `refunds.status` from `'processed'` to `'pending'`.
2. Update the refund workflow to transition: `pending` → `reviewing` → `approved` → `processed` (or `rejected`).
3. Update any refund status CHECK constraint to include the new intermediate states.

**Effort:** S

---

### TASK-M25 — Fix `nemesisAssignments` Schema Ambiguity (BUG-037)

**Files:** `apps/web/lib/db/schema.ts`

**Steps:**
1. Clarify the intent of `nemesisUserId` vs `nemesisId` — if they both reference `users.id`, one should be renamed to `challengerUserId` / `targetUserId` or similar.
2. Write a migration to rename the ambiguous column (if data exists, use `ALTER TABLE ... RENAME COLUMN`).
3. Update all queries referencing the old column name.

**Effort:** M

---

### TASK-M26 — Fix `XP Bonus Milestone` Inconsistent XP Column Updates (BUG-056)

**Files:** `apps/web/lib/seasons/seasonEngine.ts`

**Steps:**
1. Audit the `xp_bonus` milestone reward path for all XP-related columns (`xp_total`, `season_xp`, and any track-specific XP columns).
2. Ensure all relevant columns are updated atomically in the same DB transaction.
3. Use the existing XP engine's `awardXp()` function (if it exists) rather than manually updating columns, to ensure all columns are updated consistently.

**Effort:** M

---

### TASK-M27 — Fix `is_admin` JWT Claim Propagation Lag on Demotion (BUG-028)

**Files:** `apps/web/lib/auth/jwt.ts`, `apps/web/middleware.ts`, admin-check middleware

**Steps:**
1. When an admin is demoted (`is_admin = false`), immediately invalidate all their Redis sessions by deleting the session keys.
2. The 15-minute JWT lag for page routing is acceptable, but the DB check in `withAdminAuth` already re-validates on every admin API call — confirm this is true for ALL admin routes.
3. For the admin UI route guard (middleware-level), accept the 15-minute lag as documented behavior, but ensure demotion triggers session invalidation so the JWT expires within the standard 15-minute TTL without a grace extension.

**Effort:** M

---

### TASK-M28 — Fix `Redis buildStub` Returning `null` for Build-Phase Commands (BUG-049)

**Files:** `apps/web/lib/redis/index.ts`

**Steps:**
1. Review all code paths that call `redis.set()` or `redis.get()` during SSG/build and may receive `null`.
2. Add `null` guards in callers: `const result = await redis.set(...); if (result === null) { /* build phase — skip */ }`.
3. Consider returning a typed stub that throws on write operations and returns typed empty values on reads to make build-phase misuse more obvious.

**Effort:** M

---

## Phase 4 — Low: Cleanup, Hardening, Minor Improvements

---

### TASK-L01 — Add Upload Size Limit to Storage Adapters (BUG-016)

**Files:** `apps/web/lib/storage/providers/r2.ts`, `apps/web/lib/storage/providers/supabase-storage.ts`, `apps/web/lib/storage/interface.ts`

**Steps:**
1. Add `maxSizeBytes?: number` to `UploadOptions`.
2. In each adapter's `upload()`, if `buffer.byteLength > maxSizeBytes`, throw a typed `UploadSizeExceededError`.
3. Set a global default of 50 MB in the adapter base or document the expected max.

**Effort:** S

---

### TASK-L02 — Add Health Check Endpoint (BUG-032)

**Files:** `apps/web/app/api/health/route.ts` (create if absent)

**Steps:**
1. Create `/api/health` GET endpoint.
2. Check: DB connectivity (simple `SELECT 1`), Redis ping, optional realtime provider ping.
3. Return `200 { status: 'ok', db: 'ok', redis: 'ok' }` or `503` with which dependency failed.
4. Exclude this endpoint from auth middleware.
5. Configure the Vercel deployment health check to hit this endpoint.

**Effort:** M

---

### TASK-L03 — Fix `failedWebhooks` No Max Retry Limit at Schema Level (BUG-036)

**Files:** `apps/web/lib/db/schema.ts`, webhook retry CRON

**Steps:**
1. Add a `max_attempts INTEGER NOT NULL DEFAULT 5` column to `failed_webhooks`.
2. In the retry CRON, skip rows where `attempt_count >= max_attempts` and mark their status as `'exhausted'`.
3. Alert when rows reach `'exhausted'` status.

**Effort:** S

---

### TASK-L04 — Fix `skipThreshold` Not Clamped in `rateLimit.ts` (BUG-069)

**Files:** `apps/web/lib/security/rateLimit.ts`

**Steps:**
1. Add a clamp in the rate-limit factory: `const threshold = Math.min(Math.max(options.skipThreshold ?? RL_SKIP_THRESHOLD, 0), 1)`.
2. Log a warning if the caller passes a value outside `[0, 1]`.

**Effort:** S

---

### TASK-L05 — Fix `aiClassifier.ts` Global Manifest Cache Staleness (BUG-050)

**Files:** `apps/web/lib/moderation/aiClassifier.ts`

**Steps:**
1. Reduce the `manifestCache` TTL from 60s to 10s for admin config changes to propagate faster.
2. Add a cache-bust mechanism: when an admin saves moderation config, write a Redis key `moderation:config:updated_at` with a timestamp, and on each classification check if the cached config is older than `updated_at`.

**Effort:** S

---

### TASK-L06 — Fix `userPins.hashedPin` No Algorithm Enforcement at Column Level (BUG-072)

**Files:** `apps/web/lib/db/schema.ts`

**Steps:**
1. Add an application-level constant for the required bcrypt rounds (e.g., `BCRYPT_ROUNDS = 12`).
2. Before storing, validate the hash starts with `$2b$12$` (bcrypt v2b, 12 rounds).
3. Consider a migration to re-hash any existing pins with weaker rounds when users next authenticate.

**Effort:** S

---

### TASK-L07 — Fix `fieldEncryption.ts` `keyCache` Never Cleared (BUG-052)

**Files:** `apps/web/lib/security/fieldEncryption.ts`

**Steps:**
1. Add input validation for version strings before cache lookup: only accept versions matching `/^v\d+$/`.
2. Cap the `keyCache` size with an LRU eviction (e.g., max 10 entries).
3. On decryption failure with a cached key, remove the entry from the cache and retry with a fresh key derivation.

**Effort:** S

---

### TASK-L08 — Fix `giftsTable.giftItemId` Ambiguity Documentation (BUG-045, sub-task)

Already covered in TASK-M21. No additional action needed.

---

### TASK-L09 — Fix JWT Key Registry and Refresh Key Registry Stale on Container Reload (BUG-046)

**Files:** `apps/web/lib/auth/jwt.ts`

**Steps:**
1. Document that JWT key registry is built at module load — this is expected behavior for serverless functions.
2. Add a note in the ops runbook: rotating JWT keys requires a full re-deployment so new containers pick up the updated `JWT_SECRET_v*` env vars.
3. No code change needed unless you add support for remote key fetching (not recommended for latency reasons).

**Effort:** S (documentation only)

---

### TASK-L10 — Fix Rate Limiting — Auth Endpoints Share Same Limiter Bucket (BUG-060)

**Files:** `apps/web/lib/security/rateLimit.ts`, auth route handlers

**Steps:**
1. Define separate `RATE_LIMITS` presets for `auth.oauth_initiate`, `auth.oauth_callback`, `auth.login`, `auth.register`, `auth.refresh`.
2. Apply the appropriate preset to each route handler instead of a shared `auth` bucket.

**Effort:** M

---

### TASK-L11 — Fix `creatorBroadcasts.content` Unbounded Text (BUG-064)

**Files:** `apps/web/lib/db/schema.ts`, creator broadcast API

**Steps:**
1. Add an application-level check at the API: reject if `content.length > 10_000` characters.
2. Add a DB-level CHECK constraint: `CHECK (char_length(content) <= 10000)`.

**Effort:** S

---

### TASK-L12 — Fix Season Pass `xp_bonus` Milestone XP Column Consistency (BUG-056 — schema part)

Already covered in TASK-M26.

---

### TASK-L13 — Fix `communityNoteVotes` Rate Limit and Dedup

Already covered in TASK-M23.

---

### TASK-L14 — Remove Unreachable `isAppRoute` Dead Code in Middleware (cleanup)

**Files:** `apps/web/middleware.ts`

**Steps:**
1. If `isAppRoute()` always returns `true` (default-deny design, intentional), add a comment explaining why the function always returns true and is a security default.
2. If the always-true behavior is unintentional, implement proper logic.

**Effort:** S

---

### TASK-L15 — Fix `aiClassifier` System Prompt Override Not Isolated Per Instance (BUG-050 follow-up)

**Files:** `apps/web/lib/moderation/aiClassifier.ts`

**Steps:**
1. Confirm the admin `systemPromptOverride` is applied per-request from the manifest (not cached for the wrong request).
2. Add a unit test asserting that changing the manifest's systemPromptOverride is reflected within the next cache TTL cycle.

**Effort:** S

---

### TASK-L16 — Fix `dataExportRequests` Storage File Cleanup on Expiry (BUG-068 follow-up)

Already covered in TASK-M19.

---

### TASK-L17 — Fix `SSRF allowlist` Environment Variable vs Hardcoded Tension

**Files:** `apps/web/lib/security/ssrf.ts`

**Steps:**
1. Replace any hardcoded test hostnames in `HOSTNAME_ALLOWLIST` with env-var-driven entries.
2. Ensure the allowlist is read at startup and cached (not rebuilt per request).
3. Add a test asserting the allowlist includes the configured DB, storage, and external API hosts.

**Effort:** S

---

## Execution Order Summary

| Priority | Phase | Tasks | Effort Range |
|---|---|---|---|
| Immediate (P0) | Phase 1 — Critical | TASK-C01 through TASK-C08 | S to L |
| High (P1) | Phase 2 — Security/Financial | TASK-H01 through TASK-H22 | S to L |
| Normal (P2) | Phase 3 — Reliability | TASK-M01 through TASK-M28 | S to M |
| Low (P3) | Phase 4 — Cleanup | TASK-L01 through TASK-L17 | S |

**Recommended starting order within Phase 1:** C01 → C02 (both in same file, batch) → C04 → C05 → C06 → C03 → C07 → C08.

**Recommended Phase 2 starting order:** H01 → H02 → H04 → H05 → H06 → H07 → H08 → H09 → H10 → H11 → H12 → H13 then remaining H tasks.

---

*Bug Fix Plan generated: June 26, 2026, 12:00 PM*
*Report basis: custom-bugs-report.md, 75 bugs, BUG-001 through BUG-075*
*Author: Claude Code (claude-sonnet-4-6)*
