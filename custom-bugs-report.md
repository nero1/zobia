# Zobia Codebase — Forensic Bug Report

**Generated:** June 20, 2026 · 11:45 AM
**Analyst:** Independent forensic analysis — manual review of 80+ files, no automated scanners, no sub-agents
**Scope:** `apps/web` (Next.js 14 App Router, PWA), `apps/expo` (React Native / Expo Android)
**Status:** PENDING USER REVIEW — NO CODE HAS BEEN MODIFIED

---

## Bug Quick-Reference (one line each)

1: BUG-PAY-01: Paystack `subscription.disable` event handler returns early before inserting the user notification.
2: BUG-RT-01: Room message realtime broadcast always sends username as displayName, ignoring the `display_name` field.
3: BUG-NOTIF-01: Game challenge `notify()` helper writes to a `payload` column that does not exist — the correct column is `metadata`.
4: BUG-CACHE-01: Link-preview Redis cache key is sliced to 64 chars, creating URL-collision risk for long similar URLs.
5: BUG-SSRF-01: `HOSTNAME_ALLOWLIST` in `ssrf.ts` omits Cloudflare R2 bucket hostnames, blocking any `safeFetch` call targeting R2 storage.
6: BUG-WH-01: DodoPayments webhook route returns HTTP 200 on internal processing errors, permanently suppressing provider retries.
7: BUG-API-01: `buildCookieHeaders()` in `session.ts` accepts a `refreshTtl` parameter that is computed but never applied to the Set-Cookie header.
8: BUG-ECON-01: DM creation handler debits coins with raw SQL instead of `debitCoins()`, producing no ledger row and a stale `balance_before`.
9: BUG-ECON-02: DM creation handler inserts XP with raw SQL instead of `safeAwardXP()`, bypassing the dead-letter queue entirely.
10: BUG-ECON-03: `handleDMGift()` passes `null` as `reference_id` to `debitCoins()`, making gift-coin debits non-idempotent on retry.
11: BUG-LB-01: `upsertLeaderboardSnapshot()` wraps the conflict-update score in `COALESCE(excluded.score, existing)`, which can overwrite a higher score with a lower one.
12: BUG-SEC-01: reCAPTCHA v3 verification never checks the `action` field, allowing a token obtained for any action to be replayed against any other.
13: BUG-DUP-01: `cron/payouts/route.ts` contains a private inline `isValidSecret()` that duplicates — and can silently diverge from — the canonical `validateCronSecret()` in `lib/cron/auth.ts`.
14: BUG-SEC-02: `postToMailgun()` in `lib/notifications/email.ts` calls the global `fetch()` directly, bypassing all SSRF protections.
15: BUG-SCHEMA-01: `display_name` is declared `NOT NULL` in the Drizzle schema but is treated as nullable throughout the codebase via `?? username` fallbacks.
16: BUG-PGTN-01: `listGames()` in `lib/games/repo.ts` uses `created_at` as the cursor for "popular" and "trending" sort modes whose ORDER BY column is `play_count` / `recent_plays`, producing missing or duplicated results on subsequent pages.
17: BUG-CRON-01: The `master_teacher_award` notification INSERT in the `daily-platform` CRON has no `reference_id` or `ON CONFLICT` guard, flooding eligible users with duplicate notifications on every CRON run within the 7-day season-end window.

---

## Detailed Analysis

---

### 1: BUG-PAY-01 — Paystack subscription.disable skips the notification INSERT

**FILES:** `apps/web/lib/payments/paystackWebhookHandler.ts`

When Paystack fires a `subscription.disable` event the handler updates the subscription row in the DB and then executes an early `return { success: true }` before reaching the notification INSERT that all other event branches perform. Users whose subscription is disabled (failed renewal, voluntary cancel, admin action) receive zero in-app notification about the change.

**FIX:** Remove the early return that follows the subscription UPDATE in the `subscription.disable` branch. The execution should fall through to, or explicitly call, a notification INSERT with `type = 'subscription_disabled'` and the relevant `metadata` (plan name, renewal date, reason). Mirror the pattern used by the `subscription.create` and `subscription.activate` branches in the same handler.

---

### 2: BUG-RT-01 — Room message realtime broadcast sends username as displayName

**FILES:** `apps/web/app/api/rooms/[roomId]/messages/route.ts`

In the POST handler, after inserting the message row the code builds the realtime broadcast object with `displayName: senderUsername` — the raw username — without consulting `senderDisplayName`. The GET handler's `rowToMessage()` correctly resolves `row.sender_display_name ?? row.sender_username`. The result is that live messages show the username while replayed history shows the display name: an inconsistent experience for any user whose display name differs from their username.

**FIX:** In the POST handler's broadcast payload, change the `displayName` value from `senderUsername` to `senderDisplayName ?? senderUsername`, exactly matching `rowToMessage()`. Confirm that `senderDisplayName` is included in the INSERT … RETURNING clause or the preceding user-lookup SELECT so the value is available at that point in the handler.

---

### 3: BUG-NOTIF-01 — Game challenge notify() writes to a non-existent `payload` column

**FILES:** `apps/web/lib/games/challenges.ts`

The private `notify()` helper inside `challenges.ts` constructs an INSERT into the `notifications` table with a `payload` column. The actual schema (confirmed in `lib/notifications/insert.ts`) uses a `metadata` column. Every challenge-related notification — game invitation, result announcement, series resolution — throws a PostgreSQL "column payload does not exist" runtime error and is silently swallowed, meaning no challenge notifications have ever been delivered.

**FIX:** Rename `payload` to `metadata` in every SQL INSERT built by `notify()` inside `challenges.ts`. This is a one-field rename; the value structure does not need to change. Add a smoke test or integration test that triggers `notify()` and asserts a row is present in `notifications`.

---

### 4: BUG-CACHE-01 — Link-preview cache key truncated to 64 chars causes URL collisions

**FILES:** `apps/web/app/api/messages/link-preview/route.ts`

The Redis cache key is built as `` `link_preview:${url.slice(0, 64)}` ``. Two different URLs that share a common 64-character prefix (e.g., two articles on the same domain with a long path stem) will hash to the same key. The first URL's preview will be returned for all subsequent requests whose URL shares that prefix, regardless of the actual destination. This produces incorrect link previews silently, with no error and no way for the user to detect the mismatch.

**FIX:** Replace the raw URL slice with a deterministic hash of the full URL: `` `link_preview:${createHash('sha256').update(url).digest('hex')}` `` using `node:crypto`. The resulting 64-hex-character key is collision-resistant, a fixed length, and cheaper to store in Redis than a raw URL substring.

---

### 5: BUG-SSRF-01 — HOSTNAME_ALLOWLIST missing Cloudflare R2 storage hostnames

**FILES:** `apps/web/lib/security/ssrf.ts`

The `HOSTNAME_ALLOWLIST` includes `storage.googleapis.com` for GCS but does not include Cloudflare R2 bucket hostnames (e.g., `<account-id>.r2.cloudflarestorage.com`). The R2 SDK adapter (`lib/storage/providers/r2.ts`) currently uses the AWS SDK's internal HTTP layer and is unaffected. However, any code path that calls `safeFetch(r2Url, …, { requireAllowlist: true })` — for example, server-side avatar or asset pre-processing — will throw `SSRFError: Hostname not in allowlist` and fail silently. The allowlist is also missing other plausible integration hostnames that may be needed as the product grows.

**FIX:** Add `r2.cloudflarestorage.com` to `HOSTNAME_ALLOWLIST`. The existing allowlist check already supports subdomain matching via `parsed.hostname.endsWith('.' + h)`, so this single entry covers all `<account>.r2.cloudflarestorage.com` bucket URLs. Add a comment indicating which service each hostname serves so future reviewers can audit the list at a glance.

---

### 6: BUG-WH-01 — DodoPayments webhook returns HTTP 200 on processing errors

**FILES:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

The outer catch block returns `NextResponse.json({ error: … }, { status: 200 })`. Webhook delivery systems treat any 2xx as "successfully processed" and will not retry. Any transient DB error, timeout, or unhandled exception during payment processing permanently loses the webhook from the provider's perspective, while the corresponding purchase may never be credited to the user. This is a silent, irreversible data-loss path.

**FIX:** Change the catch-block response status from `200` to `500` (or `503`). DodoPayments will then retry delivery according to its retry policy. The signature-verification rejection should remain `400` (no retry for malformed/unsigned requests) to avoid retry-bombing on invalid payloads.

---

### 7: BUG-API-01 — buildCookieHeaders() refreshTtl parameter is never applied to the cookie

**FILES:** `apps/web/lib/auth/session.ts`

`buildCookieHeaders()` accepts a `refreshTtl` parameter (in seconds) intended to control the refresh-token cookie lifetime (e.g., for "remember me" sessions). The parameter is received and potentially forwarded by callers, but the `Set-Cookie` string for the refresh-token cookie uses a hard-coded constant for `maxAge` rather than the passed `refreshTtl`. Any caller that passes a custom TTL believes it is extending the session lifetime; in reality the cookie expiry is always fixed to the constant regardless of the argument.

**FIX:** Either (a) replace the hard-coded `maxAge` in the refresh-token Set-Cookie string with `refreshTtl` so the parameter has effect, or (b) if the TTL should always be fixed, remove the parameter entirely and update callers so the API is honest about its contract. Do not leave a parameter that is accepted but ignored.

---

### 8: BUG-ECON-01 — DM creation debits coins with raw SQL instead of debitCoins()

**FILES:** `apps/web/app/api/messages/dm/route.ts`

The POST handler for creating a new DM conversation executes a raw `UPDATE users SET coins = coins - $amount` rather than calling `debitCoins()` from `lib/economy/coins.ts`. Consequences: (1) No row is written to `coin_ledger` so the debit is invisible to the audit trail and any balance reconciliation; (2) `debitCoins()` wraps the UPDATE in `SELECT FOR UPDATE` to prevent concurrent race conditions — the raw SQL does not, so two simultaneous DM-creation requests from the same user can both debit; (3) the insufficient-balance check logic may diverge subtly from the canonical guard inside `debitCoins()`; (4) there is no `balance_before` snapshot for fraud detection.

**FIX:** Replace the inline raw SQL UPDATE with `debitCoins(userId, amount, 'dm_initiation', conversationId, tx)` where `conversationId` is the idempotency key. This provides ledger auditability, SELECT FOR UPDATE locking, canonical balance checking, and safe retry behaviour at zero additional cost.

---

### 9: BUG-ECON-02 — DM creation awards XP via raw SQL INSERT instead of safeAwardXP()

**FILES:** `apps/web/app/api/messages/dm/route.ts`

The same POST handler inserts XP directly with a raw `INSERT INTO xp_ledger` rather than calling `safeAwardXP()`. If this INSERT fails (DB timeout, transient network error, constraint violation) the error is silently caught and the XP is permanently lost — it is never written to `failed_xp_awards` for DLQ retry. The entire `safeAwardXP()` / DLQ infrastructure exists to prevent exactly this silent XP loss, and this handler bypasses it entirely.

**FIX:** Replace the inline XP INSERT with `await safeAwardXP(userId, xpAmount, 'social', 'dm_initiation', conversationId)`. The DLQ fallback, leaderboard snapshot update, and duplicate-award guard are all handled automatically by that helper.

---

### 10: BUG-ECON-03 — handleDMGift() passes null reference_id to debitCoins(), making gifts non-idempotent

**FILES:** `apps/web/app/api/messages/dm/route.ts`

`handleDMGift()` calls `debitCoins(senderId, giftAmount, 'dm_gift', null, tx)` with an explicit `null` reference_id. The `coin_ledger` partial unique index is defined as `(user_id, source, reference_id) WHERE reference_id IS NOT NULL`, so a null reference_id is never subject to ON CONFLICT deduplication. If the request is retried (client-side retry on network timeout, infrastructure retry on 5xx) the sender is debited twice and the recipient credited twice. For a coin-transfer operation in an economy product, this is a P0 data-integrity defect.

**FIX:** Pass a deterministic, non-null `reference_id` — such as `dm_gift:${conversationId}:${messageId}` or simply the `messageId` of the gift message — to both the `debitCoins()` call and the corresponding `creditCoins()` call. This activates the ON CONFLICT dedup path on both sides, making the entire gift transaction safely idempotent on retry.

---

### 11: BUG-LB-01 — upsertLeaderboardSnapshot() COALESCE in ON CONFLICT can overwrite higher scores

**FILES:** `apps/web/lib/leaderboards/engine.ts`

The ON CONFLICT … DO UPDATE SET clause uses `COALESCE(excluded.score, leaderboard_snapshots.score)` to update the score column. Since `excluded.score` is never NULL (a numeric XP value is always passed), `COALESCE` always resolves to `excluded.score`. The net effect is that the upsert unconditionally overwrites the stored score with the incoming value — including replacing a higher stored score with a lower incoming one (which can occur if an admin adjusts XP downward or if `safeAwardXP` is called with a stale XP total). Additionally, the misleading `COALESCE` wrapper implies null-safety logic that does not actually exist, confusing future readers.

**FIX:** Decide on the leaderboard's semantic and make the SQL explicit:
- If the leaderboard should always reflect the user's current total XP (the most common intent): use `SET score = excluded.score` directly — simple and honest.
- If the leaderboard should track the all-time best score: use `SET score = GREATEST(excluded.score, leaderboard_snapshots.score)` — this correctly prevents a downward update.

Remove the COALESCE wrapper in either case.

---

### 12: BUG-SEC-01 — reCAPTCHA v3 action field is never validated, enabling token replay

**FILES:** `apps/web/lib/security/captcha.ts`

The `verifyCaptcha()` function calls the Google siteverify API and checks `response.success` and `response.score` but never reads or validates `response.action`. A reCAPTCHA v3 token is bound to a specific action name at generation time (e.g., `"login"`, `"register"`, `"purchase"`). Without action validation, an attacker can solve reCAPTCHA on a low-value page (e.g., a static page-view that generates a high score token) and replay that token against a high-value endpoint (e.g., account registration, password reset) — bypassing the intended bot protection entirely. Google explicitly documents action validation as required for v3.

**FIX:** Add an optional `expectedAction: string` parameter to `verifyCaptcha()`. When provided, compare it against `verifyResponse.action` and return `false` (or throw) if they do not match. Update all call sites to pass the action string they used when calling `grecaptcha.execute(siteKey, { action: '...' })` on the client side. This is a one-parameter addition with no breaking change to call sites that do not need action enforcement (e.g., internal tools).

---

### 13: BUG-DUP-01 — cron/payouts/route.ts contains an inline duplicate of isValidSecret()

**FILES:** `apps/web/app/api/cron/payouts/route.ts`, `apps/web/lib/cron/auth.ts`

`payouts/route.ts` contains its own private `isValidSecret(request)` function that is an inline copy of the canonical `validateCronSecret()` in `lib/cron/auth.ts`. This creates a maintenance hazard: if the secret-validation logic is hardened in the future (e.g., adding timing-safe comparison, changing the header name, adding IP allowlisting), the duplicate in `payouts/route.ts` silently diverges, potentially leaving the payouts CRON endpoint with a weaker or subtly broken security check.

**FIX:** Delete the inline `isValidSecret()` from `payouts/route.ts`. Import and use `validateCronSecret` from `lib/cron/auth.ts` instead, exactly as all other CRON routes do. This is a pure refactor — no behaviour change — but it ensures the payouts endpoint automatically inherits any future security improvements.

---

### 14: BUG-SEC-02 — postToMailgun() uses global fetch(), bypassing all SSRF protections

**FILES:** `apps/web/lib/notifications/email.ts`

`postToMailgun()` constructs the Mailgun API URL and calls the global Node.js `fetch()` directly. While the Mailgun URL is currently derived from server-set environment variables rather than user input, using global `fetch()` bypasses the SSRF protection layer (`lib/security/ssrf.ts`) entirely. The policy mandated throughout the codebase is that all server-side outbound HTTP must go through `safeFetch()`. A misconfigured or injected `MAILGUN_DOMAIN` env var targeting an internal IP would be executed without any DNS validation or private-IP block.

**FIX:** Replace the global `fetch()` call in `postToMailgun()` with `safeFetch(url, init, { requireAllowlist: true })`. The Mailgun hostname `api.mailgun.net` is already present in `HOSTNAME_ALLOWLIST` in `ssrf.ts`, so no allowlist change is needed. The performance overhead is a single DNS validation per email send, dominated by the network round-trip to Mailgun.

---

### 15: BUG-SCHEMA-01 — display_name declared NOT NULL in schema but treated as nullable in code

**FILES:** `apps/web/lib/db/schema.ts`, `apps/web/app/api/rooms/[roomId]/messages/route.ts`, `apps/web/app/api/messages/dm/route.ts` (and multiple others)

The Drizzle schema declares `display_name TEXT NOT NULL` on the `users` table. However, everywhere in the application code where `display_name` is used it is treated as potentially null, with `?? username` / `?? sender_username` fallbacks applied. Exactly one of these two representations is wrong:
- If the NOT NULL constraint is correct, then existing data never has null display names, and all the `?? username` fallbacks are dead code that clutters the codebase.
- If the field can be null (e.g., users who registered before `display_name` was introduced), the schema constraint is wrong and will cause INSERT errors for any code path that attempts to insert a user without an explicit `display_name`.

**FIX:** Query the production database for `SELECT COUNT(*) FROM users WHERE display_name IS NULL`. If zero: confirm the NOT NULL constraint is correct and remove all `?? username` fallbacks from the application code. If non-zero: the schema must be corrected to `display_name TEXT` (nullable) — add a DEFAULT or migration to backfill with the username, and keep the fallbacks in code. The two must agree.

---

### 16: BUG-PGTN-01 — listGames() cursor pagination broken for "popular" and "trending" tabs

**FILES:** `apps/web/lib/games/repo.ts`

`listGames()` supports three sort modes: `"new"` (ORDER BY `created_at DESC`), `"popular"` (ORDER BY `play_count DESC`), and `"trending"` (ORDER BY `recent_plays DESC`). All three modes share the same cursor logic: the cursor value emitted is `items[items.length - 1].created_at`, and the WHERE clause for the next page is `AND g.created_at < $cursor`. This is only correct for `"new"`. For `"popular"` and `"trending"`:

- The ORDER BY column (`play_count` / `recent_plays`) has no relationship to `created_at`.
- Page 2 for "popular" excludes all games created after the last item's `created_at` regardless of their play count, missing high-play-count games that are newer.
- Conversely, low-play-count games created before the cursor appear on page 2 even though they would not rank there.
- The result is an inconsistent, order-dependent page boundary where results can be duplicated or silently omitted across pages.

**FIX:** Use keyset (seek) pagination with the actual sort key as the cursor for each mode:
- `"popular"`: cursor encodes `{ play_count, id }` (last item's values); WHERE adds `AND (play_count < $cursorPlayCount OR (play_count = $cursorPlayCount AND id < $cursorId))`.
- `"trending"`: same with `recent_plays`.
- `"new"`: existing `created_at` cursor is correct, keep as-is.

Encode the cursor as a base64 JSON object so the API surface stays a single opaque `cursor` string parameter.

---

### 17: BUG-CRON-01 — master_teacher_award notification INSERT has no dedup guard

**FILES:** `apps/web/app/api/cron/daily-platform/route.ts`

The `master_teacher_award` section correctly uses `ON CONFLICT (user_id, badge_key) DO UPDATE` for the badge INSERT to prevent duplicate badges across CRON runs. However, the immediately following notification INSERT (informing the user they received the badge) has no `ON CONFLICT` clause and no `reference_id`. The eligibility query window is `ends_at >= NOW() - INTERVAL '7 days'`, so for every day within 7 days of a season's end, the CRON re-queries the same set of eligible users and inserts a new notification row for each of them. A user can receive 7 identical "You earned Master Teacher!" notifications within a single season close window.

**FIX:** Set `reference_id = 'master_teacher:' || u.user_id || ':' || s.id` (or equivalent deterministic key) on the notification INSERT, then add `ON CONFLICT (user_id, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`. This mirrors the dedup pattern used correctly for council-invitation notifications in the same file. Confirm the `notifications` table has the required partial unique index on `(user_id, reference_id) WHERE reference_id IS NOT NULL`.

---

## Code Quality Assessment

### Current Rating: 7.2 / 10

The codebase reflects genuine engineering maturity in most subsystems:

**Strengths observed:**
- CSP nonces with `strict-dynamic` and no `unsafe-inline`, per-request nonce generation in middleware.
- CSRF validation via Origin header for all API mutations; OAuth CSRF state token with Redis.
- SSRF protection with DNS-pinned `undici` Agent, single DNS resolution, TOCTOU prevention via IP pinning, streaming body size cap.
- AES-256-GCM field encryption with scrypt KDF v2; v1 key migration path.
- Coin and star economies use SELECT FOR UPDATE throughout; append-only ledgers; Decimal.js for all arithmetic.
- `safeAwardXP()` with dead-letter queue, exponential backoff retry, and leaderboard snapshot updates.
- Atomic Lua scripts for rate limiting (sliding window), DM coin daily limits (check-and-increment), and room presence cap — no TOCTOU races.
- JWT multi-key rotation with kid-based registry; TOTP with `timingSafeEqual` anti-timing.
- Structured logging, per-request trace IDs, audit log, system alerts for permanently failed operations.
- Webhook replay protection via Redis with `NX` and TTL; HMAC-SHA512 (Paystack) and HMAC-SHA256 (Dodo) verification.
- `safeHtml()` sanitizer with strict allowlist; anti-spam phone/URL/email stripping in DMs.
- reCAPTCHA v3 score threshold check (just missing action validation — see BUG-SEC-01).

**Areas of concern:**
- `apps/web/app/api/messages/dm/route.ts` is the highest-risk file: three separate economy bugs (BUG-ECON-01, 02, 03) indicate it was written without referencing the canonical helpers that every other file uses correctly.
- The `payload` vs `metadata` column mismatch in `challenges.ts` (BUG-NOTIF-01) means all challenge notifications have been silently broken since the schema column was renamed — a regression that would have been caught by even a basic integration test suite.
- The reCAPTCHA v3 action-omission (BUG-SEC-01) is a low-effort exploit path: any bot that can obtain a high-score token on any page can replay it against registration or password-reset endpoints.
- The DodoPayments 200-on-error pattern (BUG-WH-01) is a silent financial data-loss path that will only manifest when a transient DB error coincides with a purchase — the kind of bug that surfaces in production at the worst possible moment.

### Projected Rating After All 17 Fixes: 8.6 / 10

Applying all fixes eliminates three economy atomicity/idempotency gaps, closes two SSRF bypass routes, fixes the only broken notification flow (challenge notify), restores the Paystack subscription.disable notification, hardens CAPTCHA against action replay, makes all pagination correct, and eliminates the duplicate notification flood. The gap from 8.6 to 10 reflects the absence of a visible integration/E2E test suite (not audited in this report, but implied by the challenge notify regression going undetected) and the schema–code display_name mismatch that requires a production-data decision before it can be fully resolved.

---

*Report generated: June 20, 2026 · 11:45 AM*
*Scope: 80+ files manually reviewed across apps/web and apps/expo*
*Bugs found: 17 | No code modified during this analysis*
