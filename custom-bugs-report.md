# Zobia Codebase — Forensic Bug Report

**Generated:** June 14, 2026 — 12:00 PM
**Scope:** Full forensic analysis — web app, PWA, Expo Android app
**Analyst:** Independent codebase review (no prior bug reports consulted)

---

## Code Quality Rating

| Dimension | Current | After Fixes |
|---|---|---|
| Security | 7.5 / 10 | 9.0 / 10 |
| Correctness | 6.5 / 10 | 8.5 / 10 |
| Robustness | 7.0 / 10 | 8.5 / 10 |
| Architecture | 8.5 / 10 | 8.5 / 10 |
| **Overall** | **7.0 / 10** | **8.6 / 10** |

The codebase is well-architected with solid patterns: atomic coin/star ledger operations using SELECT FOR UPDATE, Lua atomic sliding-window rate limiting, HMAC-based webhook signature verification (constant-time), SSRF protection with DNS pinning, CSRF origin checks in middleware, and a clean provider abstraction for realtime and payments. The critical bugs found are isolated logic errors rather than systemic design failures — the foundation is sound.

---

## One-Line Bug Index

1. **ZBUG-01:** Season rewards distributed before season_rank_archives is populated — no end-of-season rewards ever pay out
2. **ZBUG-02:** Expo mobile token refresh reads `x-access-token` response header that server never sends — all mobile users are always logged out on access token expiry
3. **ZBUG-03:** DodoPayments `payout.failed` webhook handler does not restore creator earnings, unlike its Paystack equivalent
4. **ZBUG-04:** Guild war XP reward operator precedence: `Math.round(a + b) * 2` instead of `Math.round((a + b) * 2)` — teams receive half the intended XP
5. **ZBUG-05:** Admin TOTP setup catch-22 — new admins or admins who lost their authenticator can never complete 2FA setup through the UI
6. **ZBUG-06:** Paystack webhook returns HTTP 500 on processing errors — triggers indefinite Paystack retry loop for non-recoverable failures
7. **ZBUG-07:** `buildClearCookieHeaders()` omits `Secure` attribute — logout silently fails to clear secure HttpOnly cookies in production
8. **ZBUG-08:** `COMEBACK_COIN_AMOUNT` (200 coins) hardcoded in two separate CRON locations — silent divergence risk
9. **ZBUG-09:** Login streak increment checks `last_login_at` column; streak reset checks `last_login_date` — different column names
10. **ZBUG-10:** CRON tasks 30 and 31 insert notifications using legacy `payload` column while rest of codebase uses `title`/`body`/`metadata`
11. **ZBUG-11:** DodoPayments subscription bonus coin dedup key uses payment ID while Paystack uses `plan:{userId}:{YYYY-MM}` — double bonus possible when switching providers
12. **ZBUG-12:** `awardGiftXP` runs multiple `db.query` calls via `Promise.all()` without a transaction — partial XP awards on failure
13. **ZBUG-13:** `fieldEncryption.getKey()` recomputes SHA-256 on every invocation — no memoization
14. **ZBUG-14:** `claimPassMilestone` XP reward also increments `legacy_score` — likely unintended
15. **ZBUG-15:** Monthly plan bonus SQL uses `ON CONFLICT DO NOTHING` without specifying a conflict target column
16. **ZBUG-16:** Expo offline sync queue resets ALL failed messages to `pending` on every sync pass — permanently-rejected messages retry forever
17. **ZBUG-17:** Pre-auth token for mobile 2FA appended as URL query param in deep-link — exposed in server logs and device history
18. **ZBUG-18:** TOTP `base32Decode`/`computeTotp`/`verifyTotp` implementation copy-pasted between two admin auth route files — security divergence risk
19. **ZBUG-19:** CRON task 33 calls `getManifestValue()` inside per-referral transaction loop — N+1 manifest DB lookups per qualifying referral
20. **ZBUG-20:** `isFirstGift` check queries `COUNT(*) FROM gifts LIMIT 1` — `LIMIT 1` on `COUNT(*)` is a no-op (misleading dead code)
21. **ZBUG-21:** HTML sanitizer `ALLOWED_SCHEMES` includes `"http"` — insecure mixed-content links pass sanitization
22. **ZBUG-22:** `sanitizeAnnouncementContent` returns `markdown` type completely unsanitized — potential XSS if rendered as HTML client-side
23. **ZBUG-23:** SSRF `isPrivateIp()` blocks ALL IPv6 addresses containing ":" — legitimate public IPv6 hosts unreachable
24. **ZBUG-24:** DM message XP ledger insert and user `xp_total` update are fire-and-forget outside the coin deduction transaction
25. **ZBUG-25:** CRON leaderboard ripple task performs per-user DB upserts and push notifications in an unbatched for-loop — timeout risk at scale
26. **ZBUG-26:** Room messages with `is_pending_approval` still count toward daily XP message cap even if they are never approved
27. **ZBUG-27:** PIN verification Redis key is scoped to user not session — PIN verified on one device grants `pin_ok` to all active sessions for 5 minutes

---

## Detailed Bug Entries

---

### ZBUG-01 — Season rewards distributed before rankings are archived
**FILES:** `apps/web/app/api/cron/daily/route.ts`

`distributeSeasonRewards()` is called before `resetSeasonRankings()` in the daily CRON. `distributeSeasonRewards()` queries the `season_rank_archives` table for each user's `final_rank` to determine reward tier. But `season_rank_archives` is populated only when `resetSeasonRankings()` runs its INSERT-SELECT. At the time `distributeSeasonRewards()` executes, the archive table has no rows for the just-ended season, so the query returns nothing and zero rewards are distributed. This has been silently broken since the feature was shipped.

**FIX:** Swap the call order in the CRON: invoke `resetSeasonRankings()` first to archive current standings, then call `distributeSeasonRewards()`. Verify with a test assertion that `season_rank_archives` is non-empty before distributing.

---

### ZBUG-02 — Expo mobile token refresh always fails silently
**FILES:** `apps/expo/lib/api/client.ts`, `apps/web/app/api/auth/refresh/route.ts`

The Expo `refreshAccessToken()` function expects to read the new access token from `res.headers['x-access-token']`. The server-side `POST /api/auth/refresh` endpoint issues the new token exclusively as a `Set-Cookie: zobia_at=...` response header (using `response.headers.append("Set-Cookie", accessCookie)`). `Set-Cookie` is a restricted header that Axios/mobile HTTP clients cannot read. No `x-access-token` header is ever set. As a result, `newToken` is always `null`, every refresh attempt "fails", credentials are wiped from SecureStore, and `notifyUnauthenticated()` fires — logging the user out on every 401. Mobile users cannot maintain a session beyond the 15-minute access token TTL.

**FIX:** Detect the mobile path on the server (presence of `X-Refresh-Token` request header means it's a mobile call) and additionally return the new access token in the JSON response body or as an explicit `X-Access-Token` response header. Update the Expo client to read from whichever location is chosen. Also return the rotated refresh token in the response so the mobile client can persist it.

---

### ZBUG-03 — DodoPayments payout failure silently drops creator earnings
**FILES:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`, `apps/web/lib/payments/payouts.ts`

When a payout via DodoPayments fails (`payout.failed` event), the webhook handler's `processPayoutEvent` branch for this event performs no recovery action — no retry queue, no earnings restoration, no dead-letter handling. In contrast, the Paystack `transfer.failed` handler calls `moveToDeadLetterQueue()`, which restores the creator's `available_earnings_kobo` (guarded by `earnings_restored` flag to prevent double-credit) and marks the payout for admin review. Any creator whose DodoPayments payout fails permanently loses that earnings balance with no recourse.

**FIX:** Mirror the Paystack recovery logic in the DodoPayments `payout.failed` branch: call `moveToDeadLetterQueue()` (or equivalent) to restore earnings and flag the payout for admin review/retry.

---

### ZBUG-04 — Guild war XP reward operator precedence error
**FILES:** `apps/web/lib/guilds/warEngine.ts`

The guild war XP reward calculation is: `Math.round(war.defender_points + war.challenger_points) * 2`. JavaScript evaluates function calls before the `*` operator, so `Math.round()` receives `(a + b)` and then the already-rounded integer is multiplied by 2. The intent is clearly to compute `Math.round((a + b) * 2)` — double the total points first, then round. For fractional point sums, the current code rounds prematurely and then doubles, producing a result half of what `Math.round((a + b) * 2)` would return in edge cases. For whole-number sums the result happens to be the same.

**FIX:** Add parentheses: `Math.round((war.defender_points + war.challenger_points) * 2)`.

---

### ZBUG-05 — Admin TOTP setup catch-22 locks out new and reset admins
**FILES:** `apps/web/app/api/admin/auth/login/route.ts`, `apps/web/app/api/admin/auth/totp/route.ts`, `apps/web/app/api/admin/auth/totp/setup/route.ts`

The admin login step 1 (`POST /api/admin/auth/login`) returns `{ needsSetup: true }` when TOTP is not configured, but issues no credential or session at this point. The TOTP setup endpoint (`GET/POST /api/admin/auth/totp/setup`) is protected by `withAdminAuth`, requiring a valid admin JWT. The admin JWT is only issued at step 2 (`POST /api/admin/auth/totp`) after a valid TOTP code is submitted — but that endpoint throws `unauthorized` if `totp_enabled = false`. Catch-22: no session without TOTP, no TOTP setup without session. A new admin or an admin whose authenticator was lost is permanently locked out of the UI.

**FIX:** On a successful step-1 login when `needsSetup: true`, issue a short-lived (5-minute) single-use Redis token keyed to the admin's user ID (e.g., `admin_pre_auth:{userId}`). Create a separate endpoint (or modify the setup routes) to accept this one-time token as an alternative to `withAdminAuth` for the sole purpose of initial TOTP configuration. Invalidate the token after use.

---

### ZBUG-06 — Paystack webhook returns HTTP 500 on processing errors
**FILES:** `apps/web/app/api/economy/webhooks/paystack/route.ts`

When an unexpected processing error occurs inside the webhook handler — corrupted payload, schema mismatch, missing DB record — the handler propagates the error and returns HTTP 500 (line ~595). Paystack treats any non-2xx response as a delivery failure and retries the webhook aggressively. For non-recoverable errors (e.g., malformed event data), retrying will always fail, causing hundreds of identical retry attempts and potential duplicate-processing side effects if retries eventually reach a partially-different state.

**FIX:** Catch processing errors and return HTTP 200 with a response body indicating the event was received but could not be processed (e.g., `{ received: true, processed: false, error: "..." }`). Log these to `system_alerts` for manual review. Only let genuine 5xx responses through for transient infrastructure failures (DB unreachable, Redis down) where Paystack retry is meaningful.

---

### ZBUG-07 — Logout does not clear secure cookies in production
**FILES:** `apps/web/lib/auth/session.ts`

`buildClearCookieHeaders()` clears cookies by setting `Max-Age=0` but does not include the `Secure` attribute in the Set-Cookie string. Per RFC 6265, a browser will only clear an existing HttpOnly+Secure cookie if the clearing directive also includes `Secure`. Without it, the browser interprets the clearing directive as targeting a different (non-secure) cookie and leaves the existing secure access/refresh tokens in place. Logout appears to succeed (200 response) but the tokens remain valid in the browser, leaving the session alive.

**FIX:** Add `; Secure` to the Set-Cookie string emitted by `buildClearCookieHeaders()` when running in production (conditional on `process.env.NODE_ENV === 'production'` or a `COOKIE_SECURE=true` env var). Ensure the same conditional applies to `buildCookieHeaders()` for consistency.

---

### ZBUG-08 — COMEBACK_COIN_AMOUNT hardcoded as 200 in two CRON locations
**FILES:** `apps/web/app/api/cron/daily/route.ts`

The comeback bonus coin amount (200) appears as a magic number in two separate places in the daily CRON: once when crediting the bonus to returning users, and again in the expiry logic when debiting it from users who let their comeback streak lapse. If the product team changes the bonus amount, only one location will likely be updated, causing an accounting mismatch where the credit and debit amounts diverge.

**FIX:** Extract to a single module-level constant `const COMEBACK_COIN_AMOUNT = 200` at the top of the CRON file and reference it in both credit and debit operations.

---

### ZBUG-09 — Login streak uses inconsistent column names
**FILES:** `apps/web/app/api/cron/daily/route.ts`

The streak increment branch compares `last_login_at::date = $1::date` (yesterday) to find users whose streak should grow. The streak reset branch queries `WHERE last_login_date < $1` — a different column name (`last_login_date` vs `last_login_at`). If the `users` table has only one of these columns, one branch silently matches zero rows: either streaks never increment (if `last_login_at` doesn't exist) or streaks never reset (if `last_login_date` doesn't exist).

**FIX:** Audit the `users` table schema migration files to identify the authoritative column name. Update both CRON branches to reference the same column with consistent date-comparison logic. Add a migration to rename or consolidate if both columns exist.

---

### ZBUG-10 — CRON notification inserts use legacy `payload` column
**FILES:** `apps/web/app/api/cron/daily/route.ts` (tasks 30, 31, 32b)

CRON tasks 30 (masterTeacherAward), 31 (nemesisNotifications), and 32b (allianceWarsResolved) insert into the `notifications` table using a single `payload` JSONB column. The rest of the codebase — and other CRON tasks in the same file — use separate `title`, `body`, and `metadata` columns in the `notifications` table. If the schema has migrated to the newer column format, these notifications are being written to a column that either doesn't exist (causing silent failure) or is ignored by notification consumers, making them invisible to users.

**FIX:** Update tasks 30, 31, and 32b to use the `title`/`body`/`metadata` schema consistent with the rest of the codebase. Extract a notification insert helper function to centralize the schema so future tasks use the correct format automatically.

---

### ZBUG-11 — Subscription bonus coin dedup key inconsistent across payment providers
**FILES:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`, `apps/web/app/api/economy/webhooks/paystack/route.ts`

When a subscription renews, both webhook handlers credit a monthly plan coin bonus to the user with an `ON CONFLICT (reference_id) DO NOTHING` dedup guard. The Paystack handler uses `plan:{userId}:{YYYY-MM}` as the `reference_id` (calendar-month keyed). The DodoPayments handler uses `providerReference` (the raw payment/transaction ID). A user paying via Paystack one month and DodoPayments the next will have two different reference IDs for the same billing month, bypassing the dedup guard and receiving double bonus coins.

**FIX:** Standardize both handlers to derive the `reference_id` from `plan:{userId}:{YYYY-MM}` (the calendar month of the renewal event, not the provider's transaction ID). This ensures a single dedup key regardless of which payment provider was used.

---

### ZBUG-12 — awardGiftXP is non-atomic (missing transaction wrapper)
**FILES:** `apps/web/app/api/economy/gifts/send/route.ts`

`awardGiftXP` issues multiple `db.query()` calls concurrently via `Promise.all()` without wrapping them in a `db.transaction()`. Calls include: inserting into `xp_ledger`, updating `users.xp_total`, updating track-specific XP columns. If any call fails mid-way, others may have already committed, leaving partially awarded XP (ledger row inserted but user XP total not updated, or vice versa). Since `awardGiftXP` is called as fire-and-forget (`.then()` not awaited), errors are silently dropped.

**FIX:** Wrap all XP-related writes inside `awardGiftXP` in a single `db.transaction()`. Ensure errors bubble up and are logged even when called fire-and-forget (`.catch((err) => console.error(...))`).

---

### ZBUG-13 — fieldEncryption.getKey() recomputes SHA-256 on every call
**FILES:** `apps/web/lib/security/fieldEncryption.ts`

`getKey()` derives the AES-256 encryption key by running `crypto.createHash('sha256').update(secret).digest()` every time it is invoked. This is called for every `encryptField()` and `decryptField()` operation (e.g., every TOTP secret read during admin login, every KYC field access). The secret is a static environment variable that never changes at runtime, making the repeated SHA-256 computation pure waste.

**FIX:** Memoize: compute the key once on first call, store in a module-level `let cachedKey: Buffer | null = null`, and return the cached value on all subsequent calls. This is a performance fix; correctness is unaffected.

---

### ZBUG-14 — claimPassMilestone XP reward unintentionally updates legacy_score
**FILES:** `apps/web/lib/seasons/seasonEngine.ts`

In `claimPassMilestone`, when an `xp_bonus` milestone is claimed, the SQL UPDATE increments both `xp_total` and `legacy_score` by the bonus amount. `legacy_score` is a permanent cumulative leaderboard metric intended for Hall-of-Fame ranking derived from real competitive play. Season pass milestone bonuses are purchased/earned rewards that arguably should not inflate the permanent competitive record alongside `xp_total`.

**FIX:** Decide explicitly whether pass milestone XP should count toward `legacy_score`. If not, remove `legacy_score = legacy_score + $1` from the UPDATE. If it should, add a comment explicitly documenting this business decision so future changes don't accidentally remove it.

---

### ZBUG-15 — Monthly plan bonus ON CONFLICT missing conflict target
**FILES:** `apps/web/app/api/cron/daily/route.ts`

The monthly plan bonus insert uses `ON CONFLICT DO NOTHING` without specifying a conflict target column or constraint name. PostgreSQL requires either `ON CONFLICT (column)` or `ON CONFLICT ON CONSTRAINT name` — a bare `ON CONFLICT DO NOTHING` is only valid in some PostgreSQL versions and may throw a syntax error or apply to no constraint (allowing duplicates). If the dedup behavior silently doesn't work, users would receive multiple monthly bonuses.

**FIX:** Specify the exact unique constraint: `ON CONFLICT (user_id, bonus_month) DO NOTHING` (or whatever the unique columns are). Ensure the corresponding unique constraint exists in the migration for the target table.

---

### ZBUG-16 — Expo offline sync retries permanently rejected messages forever
**FILES:** `apps/expo/lib/offline/syncQueue.ts`, `apps/expo/lib/offline/sqlite.ts`

`syncPendingMessages()` calls `resetFailedMessages()` at the start of every sync pass, unconditionally resetting all `failed` messages back to `pending`. If the server permanently rejects a message (400 — content policy violation, banned account, conversation deleted), the message will be marked `failed`, then reset to `pending` on next sync, then rejected again — indefinitely. There is no `retry_count` tracking or permanent-failure state, so stale messages accumulate and are retried on every network reconnection.

**FIX:** Add a `retry_count INTEGER DEFAULT 0` column to `offline_messages`. Increment it on each failed attempt. After a threshold (e.g., 3 retries), set a terminal `sync_status = 'permanent_failure'` that `resetFailedMessages()` does not touch. Expose a UI indicator for permanently failed messages so the user knows to dismiss them.

---

### ZBUG-17 — Mobile 2FA pre-auth token exposed in deep-link URL
**FILES:** `apps/web/app/api/auth/google/callback/route.ts`

When a mobile user with 2FA enabled completes OAuth, the callback generates a `preAuthToken` JWT and appends it directly as a URL query parameter to the app deep-link: `deepLink.searchParams.set("pre_auth_token", preAuthToken)`. Tokens embedded in URLs appear in: server access logs, proxy logs, mobile OS URL history/clipboard, and can be snooped by other apps registered for the same deep-link scheme. The 5-minute TTL mitigates but does not eliminate the exposure window.

**FIX:** Store the pre-auth token in Redis under a one-time opaque code (exactly the same pattern already used for the normal mobile token exchange: `mobile_exchange:{code}` with 90s TTL). Pass only the opaque code in the deep-link URL. The mobile app then POSTs the code to `/api/auth/mobile-token` (or a new `mobile-preauth-token` endpoint) to receive the actual pre-auth token over HTTPS — never in the URL.

---

### ZBUG-18 — TOTP implementation duplicated across two admin route files
**FILES:** `apps/web/app/api/admin/auth/totp/setup/route.ts`, `apps/web/app/api/admin/auth/totp/route.ts`

`base32Decode`, `computeTotp`, and `verifyTotp` are verbatim copy-pasted between the two files. Any future security improvement (timing-safe comparison, algorithm upgrade, clock-drift adjustment) must be applied in both files. A missed update in one file would leave a security gap in one branch of the admin 2FA flow.

**FIX:** Extract these functions into a shared module `apps/web/lib/auth/totp.ts` and import from both route files. Also note: neither file currently defends against TOTP code reuse during setup; the setup POST's `verifyTotp` call does not check the `totp:used:{userId}:{code}` Redis key that the login totp route does. Consider adding the same anti-replay check to the setup verification.

---

### ZBUG-19 — CRON referral task calls getManifestValue inside per-iteration transaction loop
**FILES:** `apps/web/app/api/cron/daily/route.ts` (task 33)

Inside the `for (const referral of streakReferrals)` loop, `getManifestValue("referral_tier1_xp_bonus")` and `getManifestValue("referral_tier1_coin_bonus")` are called inside each `db.transaction()` callback. These manifest values are static for the duration of the CRON run. Calling them N times per run makes 2N unnecessary round-trips to the manifest table/store.

**FIX:** Fetch both manifest values once before the loop. Store results in local constants `xpBonus` and `coinBonus`, and reference those constants inside each transaction.

---

### ZBUG-20 — isFirstGift check has no-op LIMIT 1 on COUNT(*)
**FILES:** `apps/web/app/api/economy/gifts/send/route.ts`

The first-gift detection query is `SELECT COUNT(*) FROM gifts WHERE recipient_id = $1 LIMIT 1`. `COUNT(*)` is an aggregate that unconditionally returns exactly one row regardless of the number of matching rows; `LIMIT 1` therefore has no effect. This is dead/misleading code — it implies intent to limit rows but does nothing.

**FIX:** Replace with `SELECT EXISTS(SELECT 1 FROM gifts WHERE recipient_id = $1 LIMIT 1)` which clearly expresses "has this user ever received a gift" and short-circuits after finding the first row. Remove `LIMIT 1` from COUNT queries throughout the codebase where this pattern recurs.

---

### ZBUG-21 — HTML sanitizer allows insecure http:// links
**FILES:** `apps/web/lib/security/htmlSanitizer.ts`

The `ALLOWED_SCHEMES` set inside the href/src validation block in `sanitizeHtml()` includes `"http"` alongside `"https"` and `"mailto"`. This allows users to embed plaintext HTTP links in sanitized HTML output, which triggers browser mixed-content warnings, strips TLS protection from followed links, and can enable traffic interception in hostile network environments.

**FIX:** Remove `"http"` from `ALLOWED_SCHEMES` — allow only `"https"` and `"mailto"`. If legacy HTTP URLs must be supported (e.g., old user-generated content), optionally rewrite them to HTTPS at sanitization time using a simple `value.replace(/^http:\/\//i, 'https://')` transformation before scheme validation.

---

### ZBUG-22 — Markdown announcement content passes through unsanitized
**FILES:** `apps/web/lib/security/htmlSanitizer.ts`

`sanitizeAnnouncementContent()` only sanitizes `contentType === "html"`. For `contentType === "markdown"`, it returns the raw content unchanged. If any downstream component renders this markdown using a parser that supports inline HTML or generates raw `<a href>` and `<img src>` elements without escaping (e.g., `marked` or `react-markdown` with `allowDangerousHtml: true`), user-controlled markdown like `[click](javascript:alert(1))` or `![x](javascript:void(0))` could execute XSS payloads.

**FIX:** Either: (a) sanitize markdown content through the same `sanitizeHtml()` pipeline by first rendering it to HTML via a safe Markdown parser, then sanitizing; or (b) explicitly document and enforce that all markdown renderers in the client must disable raw HTML output and URL scheme enforcement. Audit all call sites where announcement content is rendered to confirm safe configuration.

---

### ZBUG-23 — SSRF validator blocks all IPv6 public addresses
**FILES:** `apps/web/lib/security/ssrf.ts`

`isPrivateIp()` returns `true` for any hostname string that contains `":"`, catching all IPv6 addresses — both private and public. The comment acknowledges this is conservative, but it also prevents `safeFetch` from reaching legitimate IPv6-only API endpoints, CDNs, or services. For example, any API that resolves to an AAAA-only record will be blocked.

**FIX:** Refine the IPv6 check to only block known-private ranges: loopback (`::1`), link-local (`fe80::/10`), unique-local (`fc00::/7`), and site-local (`fec0::/10`). All other IPv6 addresses should pass the string-level check and proceed to `resolveAndValidateHostname()`, which performs DNS-pinned validation. The DNS pinning already provides the defense-in-depth for any addresses that slip through string matching.

---

### ZBUG-24 — DM message XP updates are fire-and-forget outside the coin transaction
**FILES:** `apps/web/app/api/messages/dm/[conversationId]/route.ts`

After the atomic `db.transaction()` that deducts coins and inserts the message, XP is awarded via two fire-and-forget `db.query()` calls: an `xp_ledger` INSERT and a `users.xp_total` UPDATE, both with `.catch(() => {})`. If either fails after the coin deduction committed, the user loses coins but receives no XP. The two XP writes are also not atomic with each other — a crash between them leaves `xp_ledger` and `users.xp_total` inconsistent.

**FIX:** Wrap the two XP writes in their own `db.transaction()` (separate from the coin transaction to avoid lock contention). Keep them fire-and-forget in terms of blocking the HTTP response, but catch and log errors: `.catch((err) => console.error("[dm/xp] XP award failed", err))`.

---

### ZBUG-25 — Leaderboard ripple CRON is unbatched — timeout risk at scale
**FILES:** `apps/web/app/api/cron/daily/route.ts` (leaderboard ripple task)

The leaderboard ripple task iterates through users whose rank changed and performs individual `db.query()` upserts and push notification calls inside a `for` loop with no batching. For platforms with thousands of active users on leaderboards, this will exhaust Vercel's function timeout or consume excessive wall-clock time blocking other CRON tasks.

**FIX:** Batch the DB upserts into multi-row `INSERT ... ON CONFLICT DO UPDATE` statements using `unnest()` or chunked VALUES clauses. Replace per-user `sendPushNotification()` calls with the existing `sendPushNotificationBatch()` which already handles batches of 100 notifications per API call. Consider a LIMIT clause on the number of users processed per CRON run to stay within function timeout budgets.

---

### ZBUG-26 — Pending-approval room messages count toward the daily XP message cap
**FILES:** `apps/web/app/api/rooms/[roomId]/messages/route.ts`

In rooms with `requires_approval = true`, `countTodayMessages()` executes before the message is inserted to check against the daily XP-eligible message cap. The pending (unapproved) message is then inserted and counted, even if it is later rejected by a moderator. A user in a high-moderation room can exhaust their daily XP-eligible send quota with messages that were never visible to anyone.

**FIX:** Either: (a) exclude `is_pending_approval = true` messages from `countTodayMessages()` so the cap only triggers for approved/published messages; or (b) document this as intentional (prevents XP farming via mass-submit-then-reject in approval-gated rooms). If intentional, add an explicit comment to the count query.

---

### ZBUG-27 — PIN verification Redis key is per-user, not per-session
**FILES:** `apps/web/lib/auth/pinGuard.ts`, `apps/web/app/api/auth/pin/verify/route.ts`

The Redis key for a successful PIN verification is `pin_ok:{userId}`. If a user has multiple active sessions (web browser + mobile app + shared computer), verifying the PIN on one device grants elevated access to all devices for 5 minutes. An attacker who compromises a valid JWT for the user (session hijacking, JWT theft) but does not know the PIN could piggyback on a `pin_ok` window opened by the legitimate user on another device.

**FIX:** Scope the key to `pin_ok:{userId}:{sid}` where `sid` is the session ID claim from the verified JWT. The session ID is already available in the JWT payload (`auth.user.sid`). Update both `markPinVerified` and `requirePinVerified` to accept and use the session ID. This ensures a PIN verification on one device/session does not unlock sensitive operations on others.

---

## Footer

**Report complete.** 27 bugs documented across web app, PWA, and Expo Android client.
**Generated:** June 14, 2026 — 12:00 PM
