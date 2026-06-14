# Zobia Codebase — Bug Fix Plan

**Generated:** June 14, 2026 — 12:00 PM
**Based on:** custom-bugs-report.md (same session)
**Status:** Review pending — DO NOT IMPLEMENT until approved

> All task references map 1:1 to ZBUG-XX entries in the bug report.
> Priority order: Critical → High → Medium → Low/Code Quality.

---

## Phase 1 — Critical (Fix First, Production-Breaking)

### Task 1 — Fix ZBUG-01: Season rewards ordering
**Files:** `apps/web/app/api/cron/daily/route.ts`
- Find the section where `distributeSeasonRewards()` is called in the CRON
- Find where `resetSeasonRankings()` is called
- Swap their order so `resetSeasonRankings()` always executes first
- Add a guard after `resetSeasonRankings()` to verify `season_rank_archives` has rows before continuing to `distributeSeasonRewards()` — log a warning and skip distribution if no rows exist (defensive)
- Test: run both functions in sequence on a staging DB with an ended season; confirm rewards are credited

### Task 2 — Fix ZBUG-02: Mobile token refresh broken
**Files:** `apps/web/app/api/auth/refresh/route.ts`, `apps/expo/lib/api/client.ts`
- On the server: detect when the request is mobile-initiated by checking for the `X-Refresh-Token` request header
- When mobile path detected, additionally include the new access token in the JSON response body: `{ expiresIn, accessToken }`. Also include the rotated refresh token: `{ refreshToken }` (the server already computes `rotatedRefreshToken`)
- On the Expo client (`client.ts`): change `res.headers['x-access-token']` to `res.data?.accessToken`. Also read `res.data?.refreshToken` and persist it to SecureStore if present
- Test: sign in on Expo, wait 15 minutes, confirm a subsequent API call succeeds (triggers silent refresh) without logging the user out

### Task 3 — Fix ZBUG-03: DodoPayments payout failure recovery
**Files:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`
- In the `processPayoutEvent` function, add a `payout.failed` case alongside any existing cases
- In the `payout.failed` handler, look up the `creator_payouts` record by the payout's provider reference ID
- Call `moveToDeadLetterQueue(payoutId, db)` from `apps/web/lib/payments/payouts.ts` to restore `available_earnings_kobo` and flag for admin review
- The `earnings_restored` guard in `moveToDeadLetterQueue` already prevents double-credit — no additional guard needed
- Test: simulate a `payout.failed` webhook on staging; confirm `available_earnings_kobo` is restored and `creator_payouts` row is in dead-letter state

---

## Phase 2 — High (Fix Next Sprint)

### Task 4 — Fix ZBUG-04: Guild war XP operator precedence
**Files:** `apps/web/lib/guilds/warEngine.ts`
- Locate the guild XP reward line: `Math.round(war.defender_points + war.challenger_points) * 2`
- Change to: `Math.round((war.defender_points + war.challenger_points) * 2)`
- Tiny change — add unit test covering fractional point totals to prevent regression

### Task 5 — Fix ZBUG-05: Admin TOTP setup catch-22
**Files:** `apps/web/app/api/admin/auth/login/route.ts`, `apps/web/app/api/admin/auth/totp/setup/route.ts`
- In `/api/admin/auth/login` when `needsSetup: true`, generate a 5-minute single-use Redis token: `redis.set('admin_pre_auth:{userId}', '1', 'EX', 300, 'NX')`. Return its ID or derive it from the userId with a hmac
- Create a new endpoint or add an alternative auth path to the TOTP setup GET/POST: accept a `X-Admin-Pre-Auth` header containing the one-time token. Validate it with `redis.getdel('admin_pre_auth:{userId}')` before allowing setup to proceed (no `withAdminAuth` required for this alternative path)
- Keep `withAdminAuth` for the normal path (already-set-up admin reconfiguring 2FA)
- Test: create a net-new admin user with no TOTP, complete full login + setup flow via API

### Task 6 — Fix ZBUG-06: Paystack webhook 500 error handling
**Files:** `apps/web/app/api/economy/webhooks/paystack/route.ts`
- Audit the outer try-catch and any inner error handling that currently returns a 500
- For errors that indicate non-recoverable processing failure (payload parse errors, unexpected event type, missing reference), return `NextResponse.json({ received: true, processed: false }, { status: 200 })` and log to `system_alerts`
- Reserve 500 status (or let the error propagate) only for transient infrastructure errors where Paystack retry is meaningful (look for `instanceof DatabaseConnectionError` or Redis timeout, etc.)
- Document the retry behavior in a comment near the error handling

---

## Phase 3 — Medium (Fix Within Month)

### Task 7 — Fix ZBUG-07: Logout cookie clearing missing Secure flag
**Files:** `apps/web/lib/auth/session.ts`
- In `buildClearCookieHeaders()`, add `; Secure` to the Set-Cookie string when `process.env.NODE_ENV === 'production'`
- Apply the same conditional to `buildCookieHeaders()` for consistency
- Test: in production/staging, verify the logout response Set-Cookie headers include `Secure` and that the browser clears the tokens after logging out

### Task 8 — Fix ZBUG-08: Extract COMEBACK_COIN_AMOUNT constant
**Files:** `apps/web/app/api/cron/daily/route.ts`
- Search for magic number `200` near both the comeback coin credit and expiry debit logic
- Extract to `const COMEBACK_COIN_AMOUNT = 200` at the top of the CRON handler
- Replace both usages with the constant reference
- Trivial change — no functional impact

### Task 9 — Fix ZBUG-09: Unify streak column names
**Files:** `apps/web/app/api/cron/daily/route.ts`, DB migration
- Check the `users` table schema in the migration files to find the authoritative column name
- If `last_login_at` is the real column: update the streak reset branch to use `last_login_at::date < $1::date`
- If `last_login_date` is the real column: update the streak increment branch to use `last_login_date = $1`
- If both exist and are redundant: create a migration to drop or consolidate them and update both CRON branches
- Test: seed a user with a login 2 days ago; confirm both streak increment and streak reset work correctly

### Task 10 — Fix ZBUG-10: Unify notification schema in CRON
**Files:** `apps/web/app/api/cron/daily/route.ts`
- Determine the current notification schema by examining working notification inserts (e.g., the nemesis daily push or the council invitation notification)
- Update CRON tasks 30 (masterTeacherAward), 31 (nemesisNotifications), and 32b (allianceWarsResolved) to use the same column format
- Consider extracting a helper function `insertNotification(userId, type, title, body, metadata, db)` to enforce the schema across all callers

### Task 11 — Fix ZBUG-11: Standardize subscription bonus dedup key
**Files:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`, `apps/web/app/api/economy/webhooks/paystack/route.ts`
- In both handlers, when crediting the monthly plan bonus, compute the `reference_id` as `plan:${userId}:${YYYY-MM}` where the date is derived from the webhook event timestamp (not `Date.now()`, to handle late/replayed webhooks correctly)
- Ensure both handlers use the same formula — extract to a shared helper: `planBonusReferenceId(userId, eventDate)`
- Test: simulate a renewal via Paystack then DodoPayments for the same user in the same calendar month; confirm only one bonus coin credit appears in `coin_ledger`

### Task 12 — Fix ZBUG-12: Make awardGiftXP atomic
**Files:** `apps/web/app/api/economy/gifts/send/route.ts`
- Wrap all writes inside `awardGiftXP` in a `db.transaction()`: xp_ledger INSERT, users.xp_total UPDATE, and any track-specific column updates
- Change the fire-and-forget call site to: `awardGiftXP(...).catch((err) => console.error('[gifts] XP award failed', err))`
- Ensure the transaction uses the same DB connection (not the global `db` singleton when inside an outer transaction)

### Task 13 — Fix ZBUG-13: Memoize fieldEncryption.getKey()
**Files:** `apps/web/lib/security/fieldEncryption.ts`
- Add `let cachedKey: Buffer | null = null` at module scope
- In `getKey()`, return `cachedKey` if non-null; otherwise compute, assign, and return
- This is a pure performance fix — no behavioral change

### Task 14 — Fix ZBUG-14: Clarify legacy_score in claimPassMilestone
**Files:** `apps/web/lib/seasons/seasonEngine.ts`
- Decision required from product: should season pass milestone XP count toward `legacy_score`?
- If NO: remove `legacy_score = legacy_score + $1` from the claimPassMilestone UPDATE
- If YES: add a comment explicitly documenting this as intentional product decision

### Task 15 — Fix ZBUG-15: Add ON CONFLICT target for monthly plan bonus
**Files:** `apps/web/app/api/cron/daily/route.ts`, DB migration
- Identify the unique columns for monthly plan bonus dedup (likely `user_id` + `month_key` or similar)
- Confirm the unique constraint exists in the DB: add a migration if needed
- Change `ON CONFLICT DO NOTHING` to `ON CONFLICT (column_a, column_b) DO NOTHING` with the actual column names
- Test: run the CRON twice in the same calendar month; confirm second run does not add duplicate bonus entries

### Task 16 — Fix ZBUG-16: Add retry limit to Expo offline sync queue
**Files:** `apps/expo/lib/offline/sqlite.ts`, `apps/expo/lib/offline/syncQueue.ts`
- Add migration: `ALTER TABLE offline_messages ADD COLUMN retry_count INTEGER DEFAULT 0`
- In `markMessageFailed()`: increment retry_count alongside setting status to `failed`
- In `resetFailedMessages()`: only reset messages where `retry_count < 3` (configurable threshold)
- Add a new `markMessagePermanentlyFailed(localId)` function that sets `sync_status = 'permanent_failure'`
- In `syncPendingMessages()`: after a permanent server rejection (check HTTP status in catch), call `markMessagePermanentlyFailed` instead of `markMessageFailed`
- Add a query `getPermFailedMessages()` for UI display

### Task 17 — Fix ZBUG-17: Move mobile pre-auth token out of deep-link URL
**Files:** `apps/web/app/api/auth/google/callback/route.ts`, `apps/web/app/api/auth/mobile-token/route.ts`
- Instead of `deepLink.searchParams.set("pre_auth_token", preAuthToken)`:
  - Generate an opaque exchange code: `const preAuthCode = crypto.randomBytes(32).toString('hex')`
  - Store in Redis: `redis.setex('mobile_pre_auth:${preAuthCode}', 300, JSON.stringify({ preAuthToken, userId }))`
  - Set in URL: `deepLink.searchParams.set("pre_auth_code", preAuthCode)`
- Either reuse `/api/auth/mobile-token` (adding a `pre_auth_code` field to the schema) or create `/api/auth/mobile-preauth-token` that reads the code from Redis with GETDEL and returns the pre-auth token in the JSON response body

### Task 18 — Fix ZBUG-18: Extract shared TOTP utilities
**Files:** `apps/web/lib/auth/totp.ts` (new), `apps/web/app/api/admin/auth/totp/setup/route.ts`, `apps/web/app/api/admin/auth/totp/route.ts`
- Create `apps/web/lib/auth/totp.ts` exporting `base32Encode`, `base32Decode`, `computeTotp`, `verifyTotp`, `generateTotpSecret`
- Import from both route files instead of duplicating
- In the setup route's POST handler, add the same `totp:used:{userId}:{code}` Redis anti-replay check that exists in the login route (ZBUG-18 bonus fix)

### Task 19 — Fix ZBUG-19: Hoist manifest lookups out of CRON task 33 loop
**Files:** `apps/web/app/api/cron/daily/route.ts`
- Before the `for (const referral of streakReferrals)` loop, add:
  ```
  const xpBonusStr = await getManifestValue("referral_tier1_xp_bonus");
  const coinBonusStr = await getManifestValue("referral_tier1_coin_bonus");
  const xpBonus = parseInt(xpBonusStr ?? "500", 10) || 500;
  const coinBonus = parseInt(coinBonusStr ?? "100", 10) || 100;
  ```
- Remove the same calls from inside the transaction callback

### Task 20 — Fix ZBUG-20: Clean up isFirstGift COUNT query
**Files:** `apps/web/app/api/economy/gifts/send/route.ts`
- Replace `SELECT COUNT(*) FROM gifts WHERE recipient_id = $1 LIMIT 1` with `SELECT EXISTS(SELECT 1 FROM gifts WHERE recipient_id = $1 LIMIT 1)`
- Update the conditional that checks the result to use the boolean EXISTS result
- Search for similar `COUNT(*) ... LIMIT 1` patterns elsewhere and fix those too

---

## Phase 4 — Low / Code Quality (Fix As Time Allows)

### Task 21 — Fix ZBUG-21: Remove http:// from HTML sanitizer allowed schemes
**Files:** `apps/web/lib/security/htmlSanitizer.ts`
- Remove `"http"` from `ALLOWED_SCHEMES` in the href/src validation block
- Optionally: rewrite `http://` links to `https://` before scheme validation for graceful handling of legacy content
- Test: submit HTML with `http://` link; confirm it is stripped. Submit `https://` link; confirm it passes.

### Task 22 — Fix ZBUG-22: Sanitize markdown announcement content
**Files:** `apps/web/lib/security/htmlSanitizer.ts`, all markdown render call sites
- Audit all client-side components that render announcement `markdown` content — confirm which Markdown library is used and whether raw HTML is enabled
- Option A (preferred): run markdown content through a safe parser (e.g., `remark` + `rehype-sanitize`) before storage or before rendering, stripping dangerous constructs
- Option B: document and enforce via ESLint/code review that all markdown renderers must set `allowDangerousHtml: false` (or equivalent)

### Task 23 — Fix ZBUG-23: Allow public IPv6 in SSRF validator
**Files:** `apps/web/lib/security/ssrf.ts`
- In `isPrivateIp()`, replace the blanket `hostname.includes(":")` check with specific IPv6 private-range checks:
  - `hostname === "::1"` (loopback)
  - `hostname.toLowerCase().startsWith("fe80:")` (link-local)
  - `hostname.toLowerCase().startsWith("fc") || hostname.toLowerCase().startsWith("fd")` (unique-local)
  - `hostname.toLowerCase().startsWith("fec0:")` (site-local, deprecated but safe to block)
- All other IPv6 addresses pass to `resolveAndValidateHostname()` for DNS-pinned validation

### Task 24 — Fix ZBUG-24: Wrap DM message XP in its own transaction
**Files:** `apps/web/app/api/messages/dm/[conversationId]/route.ts`
- After the coin+message transaction commits, wrap the two XP writes in `db.transaction(async (tx) => { await tx.query(xp_ledger_insert...); await tx.query(user_xp_update...); })`
- Add `.catch((err) => console.error('[dm/xp]', err))` to the fire-and-forget call
- Apply the same pattern to the equivalent room messages route if it has the same issue

### Task 25 — Fix ZBUG-25: Batch leaderboard ripple CRON operations
**Files:** `apps/web/app/api/cron/daily/route.ts`
- Collect all upsert payloads into an array before looping
- Batch DB upserts using PostgreSQL `unnest()` or chunked multi-row INSERT...ON CONFLICT (chunk size 500)
- Collect all push notification payloads and call `sendPushNotificationBatch(allNotifications)` once outside the loop
- Add a `LIMIT N` to the query that fetches users for ripple processing to cap per-CRON-run work

### Task 26 — Fix ZBUG-26: Exclude pending-approval messages from XP cap
**Files:** `apps/web/app/api/rooms/[roomId]/messages/route.ts`
- In `countTodayMessages()` (or the inline query), add `AND is_pending_approval = FALSE` to the WHERE clause so only approved/published messages count toward the daily XP cap
- Alternatively: move the XP cap check to the message approval endpoint so it only triggers when a moderator approves the message. Document whichever approach is chosen.

### Task 27 — Fix ZBUG-27: Scope PIN verification to session
**Files:** `apps/web/lib/auth/pinGuard.ts`, `apps/web/app/api/auth/pin/verify/route.ts`
- Update `pinOkKey(userId)` to `pinOkKey(userId, sessionId)`: `return 'pin_ok:${userId}:${sessionId}'`
- Update `markPinVerified(userId)` → `markPinVerified(userId, sessionId)` — requires passing sessionId from the route
- Update `requirePinVerified(userId)` → `requirePinVerified(userId, sessionId)` — requires the same at all call sites (gifts/send, payouts, etc.)
- In `POST /api/auth/pin/verify`, extract `auth.user.sid` and pass to `markPinVerified`
- At all `requirePinVerified` call sites, extract `auth.user.sid` from the JWT payload and pass it in

---

## Implementation Notes

- **Phase 1 tasks are blocking**: ZBUG-01, ZBUG-02, ZBUG-03 directly cause silent data loss or prevent mobile users from authenticating. Fix before next release.
- **Phase 2 tasks are high-priority security**: ZBUG-05 and ZBUG-06 affect admin access and payment reliability.
- **Phase 3 tasks** can be batched into a single PR per functional area (auth, economy, CRON, Expo).
- **Phase 4 tasks** are code quality improvements — batch into a "hardening" PR.
- Run the full test suite after each phase. ZBUG-01 in particular may reveal downstream test failures from season reward tests that assumed the wrong order.

---

**Plan complete.** 27 tasks mapped to bug report entries.
**Generated:** June 14, 2026 — 12:00 PM
