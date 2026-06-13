# Zobia Codebase — Forensic Bug Report (Combined Second Pass)

**Generated:** June 13, 2026 02:57 PM  
**Scope:** Web App (Next.js 15 App Router), PWA, Expo Android — full monorepo forensic analysis  
**Method:** Two independent passes over the codebase (Pass 1: 12:36 AM; Pass 2: 02:57 PM). All findings merged. No prior bug reports consulted. CRON-frequency concerns and test files excluded per instructions.

---

## Code Quality Rating — BEFORE Fixes

**Overall: 6.2 / 10**

The architecture is genuinely strong: clean provider abstractions (DB/Redis/storage), strictly parameterised SQL in most places, Decimal.js money arithmetic, append-only ledgers with `SELECT … FOR UPDATE`, HMAC webhook verification, refresh-token rotation with reuse detection, atomic Lua rate-limiting scripts, and DB-backed admin authorization. That foundation is above average for a social platform of this size.

However, the review surfaced a cluster of shipping-blocker functional bugs that break paid, money-handling, and core flows end-to-end:
- Drop-room entry payments cannot complete (webhook crashes, user is charged but locked out).
- Roughly half of the Expo app's API calls use the wrong URL path and will 404.
- Offline message sync targets a non-existent endpoint and never retries.
- Google Play purchases are consumed even when server verification fails (real money loss).
- A critical DodoPayments bug awards 0 stars on every star-pack purchase via that provider.
- The advertised paid-plan XP multiplier is never applied to messaging XP.
- TOTP secrets are stored plaintext despite an encryption library being present.

There are also meaningful security gaps (CSRF bypass, regex HTML sanitizer bypassable, TOTP replay, PIN not server-enforced on payout endpoints, unbounded SSRF response body) and a range of reliability issues (race conditions, no-op SQL, silent CRON failures, session TTL misconfiguration).

Category breakdown (current):
- Correctness / functional: 5.5/10
- Security: 6.5/10
- Structure / maintainability: 8.0/10
- Performance / scalability: 7.5/10

---

## Code Quality Rating — AFTER Fixes

**Overall: 9.1 / 10**

None of the issues are architectural; they are localized defects and cross-cutting consistency problems. Once path conventions, webhook item-type handling, IAP consume-ordering, session TTL management, XP pipeline, and notification consistency are resolved, this becomes a robust, secure platform.

Category breakdown (projected):
- Correctness / functional: 9.0/10
- Security: 9.0/10
- Structure / maintainability: 9.0/10
- Performance / scalability: 8.5/10

---

## Bug Index — One-Line Summary List

```
BUG-01 [CRITICAL]: Drop-room entry payments crash the webhook; user is charged but can never join
BUG-02 [CRITICAL]: Expo app ~65 of ~133 API calls omit /api/ prefix — roughly half the mobile API surface 404s
BUG-03 [CRITICAL]: Expo offline message sync posts to nonexistent route; failed messages never retry
BUG-04 [CRITICAL]: DodoPayments star_pack webhook credits coinsGranted instead of starsGranted — always 0 stars
BUG-05 [HIGH]: Google Play purchase consumed/acknowledged even when server verification fails — user pays, gets nothing
BUG-06 [HIGH]: Paid-plan XP multiplier never applied to messaging XP — core monetised perk is inert
BUG-07 [HIGH]: Weekly season-leaderboard CRON writes to non-existent columns — fails every Sunday
BUG-08 [HIGH]: Daily-login XP can be double-awarded under concurrency — Redis guard set after, not before, the transaction
BUG-09 [HIGH]: Expo API client clears credentials on refresh failure but never notifies AuthContext — UI stuck
BUG-10 [HIGH]: Per-purchase setPurchaseListener causes cross-fire and hung promises on concurrent IAP
BUG-11 [HIGH]: TOTP secrets stored plaintext in users.totp_secret — fieldEncryption exists but unused here
BUG-12 [HIGH]: TOTP codes replayable within 90-second acceptance window — no used-code store on any TOTP path
BUG-13 [HIGH]: Admin refresh cookie receives 30-day Max-Age despite Redis session expiring in 1 hour
BUG-14 [HIGH]: CSRF protection bypassed by any request carrying a Bearer Authorization header
BUG-15 [HIGH]: userSessionsKey TTL reset to newest session's lifetime on every createSession() call
BUG-16 [MEDIUM]: refreshAccessToken() never extends per-user session-set TTL in Redis
BUG-17 [MEDIUM]: PIN not enforced server-side on payout/transfer/purchase endpoints
BUG-18 [MEDIUM]: safeFetch body-size limit only checks Content-Length header — chunked responses unbounded
BUG-19 [MEDIUM]: SSRF check is TOCTOU/DNS-rebinding-vulnerable — DNS resolved separately from fetch
BUG-20 [MEDIUM]: Coin transfer and gift-send lock rows in sender→recipient order — opposite concurrent transfers deadlock
BUG-21 [MEDIUM]: Subscription monthly bonus can double-credit via webhook + CRON using different dedup keys
BUG-22 [MEDIUM]: Comeback bonus "claimed" marker never written — only unique index prevents repeats (throws daily)
BUG-23 [MEDIUM]: Regex HTML sanitizer protocol filter bypassable via HTML entities or embedded control chars
BUG-24 [MEDIUM]: Two XP audit tables (xp_events vs xp_ledger) written by different routes — history fragmented
BUG-25 [MEDIUM]: Notifications written in two incompatible shapes; read API drops metadata; unreadCount capped at 50
BUG-26 [MEDIUM]: Quest deck-completion bonus can be double-awarded under concurrency — no row-level lock held
BUG-27 [MEDIUM]: Room messages use non-unique timestamp as pagination cursor — duplicates/skips in busy rooms
BUG-28 [MEDIUM]: Daily CRON login streak increments on any API activity, not on actual login event
BUG-29 [MEDIUM]: 4-digit PIN with 10/min rate limit and no lockout — full keyspace brute-forceable in ~16h
BUG-30 [MEDIUM]: CSP 'unsafe-inline' in script-src negates per-request nonce on legacy browsers
BUG-31 [LOW]: Payout retry calls verifyTransfer(idempotency_key) instead of transfer_code — confirmation always fails
BUG-32 [LOW]: Concurrent duplicate IAP submissions surface as raw 500 instead of clean 409
BUG-33 [LOW]: isPrivateIp treats all 172.x and 192.x as private — weakens geo-anomaly detection
BUG-34 [LOW]: Pagination parseInt with no NaN guard — ?limit=abc sends NaN to Postgres and 500s
BUG-35 [LOW]: getClientIp trusts rightmost X-Forwarded-For value — spoofable on non-Vercel deployments
BUG-36 [LOW]: Auth endpoints (/api/auth/*) exempt from CSRF origin check — login/logout/refresh unprotected
BUG-37 [LOW]: Unrestricted client-supplied media URLs accepted with no domain allowlist
BUG-38 [LOW]: Daily CRON moments-expiry contains no-op UPDATE (sets expires_at = expires_at) before DELETE
BUG-39 [LOW]: user_badges ON CONFLICT target has no matching unique constraint — throws when reached
BUG-40 [LOW]: CAPTCHA verification fails open — provider "none" returns true even in production
BUG-41 [LOW]: Gift-send and coin-transfer ignore block relationships — blocked users can push coins/gifts
BUG-42 [LOW]: Google login auto-links verified Google email to any existing same-email account without confirmation
BUG-43 [LOW]: Daily CRON season-end loop overwrites seasonTransitions.ended per iteration — all but last lost
BUG-44 [LOW]: createSeasonCeremonyRoom() called with void — failures silently swallowed
BUG-45 [LOW]: Comeback coin reversal uses raw negative SQL row, bypassing debitCoins() ledger helper
BUG-46 [LOW]: Season reward pool silently lost when fewer than 4 users placed in top rankings
BUG-47 [LOW]: getPendingMessages() returns messages of all statuses, not just 'pending'
BUG-48 [LOW]: insertNotificationBatch() issues one INSERT per recipient instead of bulk INSERT
BUG-49 [LOW]: Global regex lastIndex not reset before replace() in stripContactInfo() — misses leading matches
BUG-50 [LOW]: reconcileStuckPayouts TypeScript interface declares amount_kobo but SQL never selects it
BUG-51 [LOW]: DM history SQL filter injected via string interpolation — latent SQL injection
BUG-52 [LOW]: DM route stores null when antispam strips all message content — no user-facing error
BUG-53 [LOW]: DM route does not check if recipient has blocked sender before persisting message
BUG-54 [LOW]: XP ledger records multiplier as raw decimal 1 while XP engine uses basis points (100 = 1×)
BUG-55 [LOW]: decryptField() has no try/catch — AES-GCM auth tag failures propagate as unhandled exceptions
BUG-56 [LOW]: Paystack subscription webhook ignores starsGranted metadata for star-pack subscription purchases
BUG-57 [LOW]: Coin purchase idempotency key includes randomUUID() — deduplication is impossible
BUG-58 [LOW]: Google OAuth username fallback may exceed database username column length
BUG-59 [LOW]: filterPublicContent() called with redundant double-admin condition in DM route
BUG-60 [LOW]: Daily CRON monthly plan bonuses processed in 3 separate per-plan transactions instead of one
```

---

## Detailed Bug Entries

---

### BUG-01 [CRITICAL]
**Drop-room entry payments crash the webhook; user is charged but can never join**

FILES: `apps/web/app/api/economy/webhooks/paystack/route.ts` (`processChargeSuccess`), `apps/web/app/api/rooms/[roomId]/pay-entry/route.ts`, `apps/web/app/api/rooms/[roomId]/join/route.ts`

FIX: `pay-entry` creates a payment with `metadata.itemType = "room_entry"` and `coinsGranted: 0`. `processChargeSuccess` has no `room_entry` branch — it falls through to the coin path, looks up `store_items` by `packId = roomId` (no row), leaves `serverCoinsGranted = 0`, then calls `creditCoins(userId, 0, …)` which throws (amount must be positive). The transaction rolls back, the payment stays `pending`, the webhook 500s on every Paystack retry, and the `join` route (which requires `status='completed'`) permanently locks out the paying user. Add an explicit `room_entry` branch in `processChargeSuccess` before the coin path that marks the payment `completed` and returns; also guard the coin path to skip `creditCoins` when `serverCoinsGranted <= 0`.

---

### BUG-02 [CRITICAL]
**Expo app ~65 of ~133 API calls omit /api/ prefix — roughly half the mobile API surface 404s**

FILES: `apps/expo/lib/api/client.ts` (`baseURL = env.API_BASE_URL`), `apps/expo/lib/env.ts`, plus ~65 call sites across `apps/expo/app/**` and `apps/expo/components/**`

FIX: `apiClient.baseURL` has no `/api` suffix. 68 calls start with `/api/` and 65 calls start with `/` but without `/api/` (e.g. `/auth/pin/verify`, `/friends`, `/guilds`, `/rooms`, `/seasons/current`, `/messages/conversations/*`). No single base-URL value makes both groups resolve. Standardize: put `/api` in `baseURL` and remove the prefix from calls that include it, or add it to all that omit it. The `/messages/conversations/...` paths also need correcting to `/messages/dm/[conversationId]`. Add a request wrapper lint to catch non-conforming paths.

---

### BUG-03 [CRITICAL]
**Expo offline message sync posts to nonexistent route; failed messages never retry**

FILES: `apps/expo/lib/offline/syncQueue.ts`, `apps/expo/lib/offline/sqlite.ts`

FIX: `syncQueue` posts to `/api/messages/${msg.conversation_id}` but the real routes are `/api/messages/dm/[conversationId]` and `/api/messages/group/[groupId]` — there is no `/api/messages/[id]` route, so every queued message 404s and is marked `failed`. `getPendingMessages` selects only `sync_status='pending'` and `retryFailedMessages()` is never called, so failed messages are permanently stuck. Route by stored conversation type to the correct sub-path, call `retryFailedMessages()` on reconnect before draining the queue, and add a client idempotency key to each queued message.

---

### BUG-04 [CRITICAL]
**DodoPayments star_pack webhook credits coinsGranted instead of starsGranted — always awards 0 stars**

FILES: `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

FIX: In the `star_pack` product type branch, `creditStars(userId, coinsGranted ?? 0, ...)` is called using the `coinsGranted` field instead of a `starsGranted` field. The `DodoPaymentsMetadata` type does not even declare `starsGranted`, so `coinsGranted ?? 0` resolves to 0 for a star-only purchase. Every star pack purchase via DodoPayments currently awards 0 stars. Add `starsGranted?: number` to the metadata type, populate it in the checkout creation flow, and change the `creditStars` call to use `metadata.starsGranted ?? 0`.

---

### BUG-05 [HIGH]
**Google Play purchase consumed even when server verification fails — user pays, coins lost**

FILES: `apps/expo/lib/payments/googlePlay.ts` (`purchaseCoins`, `purchaseSubscription`, `verifyPurchaseServerSide`)

FIX: `verifyPurchaseServerSide` returns `null` on any failure including transient network errors, and the listener then calls `finishTransactionAsync(...)` "regardless of server verification outcome." Consuming discards the `purchaseToken`, so a user who paid Google gets nothing to retry. Only finish/acknowledge after a confirmed server credit. On transient/unknown failure, leave the purchase unconsumed so Google Play replays it on next launch (the server credit is idempotent via the unique `coin_ledger` ref). Distinguish "definitively invalid" (consume) from "transient" (keep) by server status code.

---

### BUG-06 [HIGH]
**Paid-plan XP multiplier never applied to messaging XP — core monetised perk is inert**

FILES: `apps/web/app/api/rooms/[roomId]/messages/route.ts`, `apps/web/app/api/messages/dm/route.ts`, `apps/web/app/api/messages/dm/[conversationId]/route.ts`

FIX: Per PRD §6 the plan multiplier (1×/1.5×/3×/5×) applies to messaging XP, but message routes award flat base XP and write `multiplier=1` to `xp_ledger` without calling `applyMultipliers`/`calculateFinalXP`. A Max-plan user gets the same messaging XP as a free user. Route all XP awards through a single `awardXp()` helper that calls `calculateFinalXP(action, ctx)` with the user's plan/guild/season-pass context and persists the real `multiplier`/`base_amount`.

---

### BUG-07 [HIGH]
**Weekly season-leaderboard CRON writes to non-existent columns — fails every Sunday**

FILES: `apps/web/app/api/cron/daily/route.ts` (section 5b), `apps/web/db/migrations/001_complete_schema.sql` (`leaderboard_rank_snapshots`)

FIX: The table is `(id, user_id, scope, rank, xp, snapped_at)` with `UNIQUE(user_id, scope)`. Section 5b's DELETE and INSERT reference `season_id`, `xp_total`, and `snapshotted_at` — none of which exist — so both statements throw every Sunday, the snapshot never runs, and the error is swallowed. Either add `season_id` column with a `UNIQUE(user_id, scope, season_id)` index and alias the column names, or rewrite section 5b to the real columns and encode season into the `scope` value. Reconcile with the correctly-written section 14.

---

### BUG-08 [HIGH]
**Daily-login XP double-awarded under concurrency — Redis guard set after, not before, the transaction**

FILES: `apps/web/app/api/login/daily/route.ts`

FIX: The idempotency key is set with `redis.set(key, "1", "EX", ...)` after the DB transaction, not `NX` before it. Two near-simultaneous requests both pass the initial `redis.get === null` check and both run the transaction. The `FOR UPDATE` serializes them, but the second request's `lastLogin === today` branch keeps the streak without zeroing `xpAwarded`, so it credits another 50 XP. Set `redis.set(key, "1", "EX", ttl, "NX")` before the transaction and bail when it returns null; defensively set `xpAwarded = 0` when `lastLogin === today`.

---

### BUG-09 [HIGH]
**Expo client clears credentials on refresh failure but never notifies AuthContext — UI stuck**

FILES: `apps/expo/lib/api/client.ts` (response interceptor), `apps/expo/lib/auth/context.tsx`

FIX: On failed token refresh, the interceptor deletes SecureStore keys and comments "fire global sign-out event," but emits nothing. `AuthContext` has no listener, so in-memory `user`/`token` stay set and the app keeps showing authenticated screens while every request fails — until a cold restart. Add a small event bus or registered `onUnauthenticated` callback that `AuthProvider` subscribes to, and have the interceptor invoke it after clearing storage so `signOut()` runs and the router redirects to login.

---

### BUG-10 [HIGH]
**Per-purchase setPurchaseListener causes cross-fire and hung promises on concurrent Google Play purchases**

FILES: `apps/expo/lib/payments/googlePlay.ts`

FIX: Each purchase call installs a fresh listener; a later purchase's listener replaces the earlier one. When the earlier purchase resolves, the active listener's `results.find(...)` misses it — the promise is never resolved and the transaction never finished (purchase hangs unconsumed, replayed next launch). Register one global listener at init that resolves pending purchases via a `Map<productId|orderId, resolver>` and always finishes processed transactions. Have purchase functions register/await a resolver instead of re-installing the listener.

---

### BUG-11 [HIGH]
**TOTP secrets stored in plaintext — fieldEncryption exists but is not applied**

FILES: `apps/web/app/api/auth/2fa/setup/route.ts`, `apps/web/app/api/auth/2fa/verify/route.ts`, `apps/web/app/api/admin/auth/totp/route.ts`, `apps/web/app/api/admin/auth/totp/setup/route.ts`, `apps/web/lib/security/fieldEncryption.ts`

FIX: `users.totp_secret` is written and read as plaintext Base32 while bank PII is already AES-256-GCM encrypted via `encryptField`/`decryptField`. A DB compromise yields working 2FA seeds for every user and admin. Encrypt `totp_secret` with `encryptField` on write and `decryptField` on read in all TOTP routes, migrate existing rows, and confirm the encryption key env var is set.

---

### BUG-12 [HIGH]
**TOTP codes replayable within 90-second acceptance window on all TOTP paths**

FILES: `apps/web/app/api/auth/2fa/verify/route.ts`, `apps/web/app/api/admin/auth/totp/route.ts`

FIX: The TOTP verifier accepts ±1 time-step (90 seconds). A code successfully used to log in can be replayed within that window. Track the last accepted TOTP counter per user in Redis (`totp:used:{userId}:{code}` with 90s TTL) and reject codes already present. The admin path is especially sensitive — replay window here yields full admin access.

---

### BUG-13 [HIGH]
**Admin refresh cookie receives 30-day Max-Age despite Redis session expiring in 1 hour**

FILES: `apps/web/app/api/admin/auth/totp/route.ts`, `apps/web/lib/auth/session.ts` (`buildCookieHeaders`)

FIX: `buildCookieHeaders(tokens)` is called without the second argument `refreshTtl`, defaulting to `REFRESH_TOKEN_TTL_SECONDS` (30 days). The admin refresh token in Redis expires in 1 hour. The browser presents the 30-day cookie long after the session is gone (always 401), and a stolen admin refresh cookie is valid at the browser level for 30 days. Pass `ADMIN_REFRESH_TOKEN_TTL_SECONDS` as the second argument to `buildCookieHeaders`.

---

### BUG-14 [HIGH]
**CSRF protection bypassed by any request carrying a Bearer Authorization header**

FILES: `apps/web/middleware.ts` → `isCsrfSafe()`

FIX: `isCsrfSafe()` returns `true` for any request with a Bearer Authorization header regardless of origin, letting an attacker craft a cross-origin mutation request with any Bearer value (including a stolen user JWT) and bypass CSRF. The intent was to exempt service-to-service calls only. Replace the broad Bearer exemption with a dedicated shared-secret header (e.g., `x-service-token`) checked against an environment variable, and scope it to specific server-only paths (e.g., `/api/cron/*`) rather than the full API surface.

---

### BUG-15 [HIGH]
**createSession() resets per-user session-set TTL to newest session's lifetime, evicting long-lived sessions**

FILES: `apps/web/lib/auth/session.ts`

FIX: Every `createSession()` call resets `userSessionsKey` TTL to the new session's lifetime. If a normal session (30-day refresh) is followed by an admin session creation (1-hour refresh), the set expires in 1 hour, silently evicting the still-valid normal session references. Set `userSessionsKey` TTL only when the new TTL would extend (not shrink) the existing one, using a `PTTL` check before `PEXPIRE`, or always set it to the maximum possible value (30 days) since the set is an index, not a secret.

---

### BUG-16 [MEDIUM]
**refreshAccessToken() never extends per-user session-set TTL in Redis**

FILES: `apps/web/lib/auth/session.ts`

FIX: When a user refreshes their access token, the individual session key TTL is extended but the per-user session-set key TTL is not updated. Active users whose set key expired (especially after BUG-15 contamination) will fail session-membership lookups for all sessions. Add a `PEXPIRE` call on `userSessionsKey` within `refreshAccessToken()` to extend it to at least the session's remaining TTL.

---

### BUG-17 [MEDIUM]
**PIN not enforced server-side on payout/transfer/purchase endpoints**

FILES: `apps/web/app/api/creator/payouts/route.ts`, `apps/web/app/api/economy/coins/transfer/route.ts`, `apps/web/app/api/economy/gifts/send/route.ts`, `apps/web/app/api/economy/store/**`; PIN checked only in `creator/bank-account/route.ts` and `creator/wallet-address/route.ts`

FIX: The PIN guards changing the payout destination (good) but payout initiation, transfers, gifts, and store purchases accept any valid session token without PIN proof. The client-side PIN prompts are advisory and a stolen token can move funds directly. Enforce server-side using a short-lived "PIN-verified" claim minted by `/auth/pin/verify` (a signed nonce or `pin_ok:{uid}` Redis key with a few-minutes TTL) that the sensitive mutations require.

---

### BUG-18 [MEDIUM]
**safeFetch body-size limit not enforced on chunked/streaming responses**

FILES: `apps/web/lib/security/ssrf.ts` → `safeFetch()`

FIX: The size guard only inspects `Content-Length`. A server can omit it (chunked transfer encoding) and stream unbounded data — a gigabyte response would be buffered in memory. The code comment claims an "actual body size" check that does not exist. Stream the response body through a size-counting reader and abort the connection once accumulated bytes exceed `maxResponseBytes`, instead of trusting the header.

---

### BUG-19 [MEDIUM]
**SSRF check is TOCTOU/DNS-rebinding-vulnerable — DNS resolved separately from fetch**

FILES: `apps/web/lib/security/ssrf.ts` → `validateOutboundUrl()`, `safeFetch()`

FIX: `validateOutboundUrl` resolves the hostname and rejects private results, but `safeFetch` then calls `fetch(url)` which re-resolves independently. An attacker whose DNS answers "public" for validation and "private" (e.g., `169.254.169.254`) for the fetch bypasses the check. Only `resolve4` is checked so IPv6 rebinding is also unguarded. Resolve once, validate A+AAAA, and pin the connection to the resolved IP (custom lookup or fetch-by-IP with original `Host` header), re-validating on every redirect hop.

---

### BUG-20 [MEDIUM]
**Coin transfer and gift-send lock rows in sender→recipient order — opposite concurrent transfers deadlock**

FILES: `apps/web/lib/economy/coins.ts` (`transferCoins`), `apps/web/app/api/economy/coins/transfer/route.ts`, `apps/web/app/api/economy/gifts/send/route.ts`

FIX: Both flows lock the sender row then the recipient row. Two simultaneous opposite operations (A→B and B→A) acquire locks in opposite order and deadlock, surfacing as a 500. Lock both user rows in deterministic ascending `id` order before mutating either balance, regardless of transfer direction, and optionally retry once on `SQLSTATE 40P01`.

---

### BUG-21 [MEDIUM]
**Subscription monthly bonus can double-credit via webhook and CRON using different dedup keys**

FILES: `apps/web/app/api/economy/webhooks/paystack/route.ts` (`processSubscriptionEvent`), `apps/web/app/api/cron/daily/route.ts` (section 21), `apps/web/app/api/economy/iap/verify/route.ts`

FIX: The webhook awards `subscription_bonus` keyed on `subscription_code`; the day-1 CRON awards `monthly_plan_bonus` with a different dedup key — so subscribing on the 1st yields both. Also, `subscription.create` awards on every delivery (Paystack may resend), prevented only by a unique index that throws a raw 500 on collision. Unify on one dedup key pattern per period (e.g., `plan:{userId}:{YYYY-MM}`), check it across both transaction types, and swallow unique violations as "already processed."

---

### BUG-22 [MEDIUM]
**Comeback bonus "claimed" marker never written — only unique index prevents repeats (throws daily)**

FILES: `apps/web/app/api/login/daily/route.ts`, `apps/web/app/api/cron/daily/route.ts` (sections 11/22)

FIX: The login route credits claimed bonuses with `transaction_type='comeback_bonus'` but both the claim's `NOT EXISTS` guard and the expiry CRON look for `transaction_type='comeback_bonus_claimed'`, which nothing ever inserts. The claim re-selects the reserved bonus on every login and only the unique index stops repeat credits (throwing a swallowed error daily). Write an explicit `comeback_bonus_claimed` ledger row (or a `claimed_at` flag column) in the same transaction as the credit and have both guards test it. Also time-scope the reservation reference so a second lifetime comeback is possible.

---

### BUG-23 [MEDIUM]
**Regex HTML sanitizer protocol filter bypassable via HTML entities or control characters — stored XSS**

FILES: `apps/web/lib/security/htmlSanitizer.ts`, `apps/web/app/api/admin/announcements/{banners,modals}/**`, `apps/web/components/announcements/AnnouncementBanner.tsx`, `AnnouncementModal.tsx`

FIX: `DANGEROUS_PROTOCOLS` is tested against the raw value, but browsers ignore embedded tabs/newlines and decode entities in URL schemes, so `href="java&#9;script:alert(1)"` (or a literal tab) passes the filter yet executes — stored XSS rendered to all users via `dangerouslySetInnerHTML`. Replace the hand-rolled regex with a vetted sanitizer (`sanitize-html` or DOMPurify); if not possible, decode entities and strip control chars before the scheme test, and allow only an explicit scheme allowlist (`https`/`mailto`). Add `rel="noopener noreferrer"` for `target=_blank`.

---

### BUG-24 [MEDIUM]
**Two XP audit tables (xp_events vs xp_ledger) written by different routes — history fragmented**

FILES: `apps/web/app/api/economy/gifts/send/route.ts`, `apps/web/app/api/economy/coins/transfer/route.ts` (write `xp_events`); ~29 routes write `xp_ledger`

FIX: Two append-only XP tables are populated by different features. Any history/analytics reading one silently misses the other and totals won't match `users.xp_total`. Consolidate onto `xp_ledger` (which carries `multiplier`/`base_amount`), migrate `xp_events` rows, repoint the gift/transfer routes, and funnel all writes through the single `awardXp()` helper from BUG-06.

---

### BUG-25 [MEDIUM]
**Notifications written in two incompatible shapes; read API drops metadata; unreadCount capped at 50**

FILES: Notification writers across `apps/web/app/api/**` (some insert `payload`, others `title`/`body`/`metadata`), `apps/web/app/api/notifications/route.ts`

FIX: The table carries both `payload` and `title`/`body`/`metadata`, populated inconsistently — one renderer can't reliably display every notification. The GET endpoint never selects `metadata` and computes `unreadCount` from only the 50 loaded rows instead of the full count. Standardize on one content shape (structured `payload` + optional `title`/`body`), backfill, update all writers, select all needed fields in the read API, and compute `unreadCount` with a dedicated `COUNT(*) WHERE is_read = false`.

---

### BUG-26 [MEDIUM]
**Quest deck-completion bonus can be double-awarded under concurrent requests**

FILES: `apps/web/lib/quests/questEngine.ts` → `checkDeckCompletion()`

FIX: The function checks `bonus_already_awarded` via a SELECT (including an xp_ledger subquery) and then conditionally runs the bonus award in separate database operations without holding a row-level lock between them. Two concurrent calls can both read `bonus_already_awarded = false` and both award the bonus. Fix with `SELECT … FOR UPDATE` on the quest_progress row at the start of the check, or use an `UPDATE … WHERE bonus_already_awarded = false RETURNING id` pattern so only one UPDATE wins. Wrap in a transaction.

---

### BUG-27 [MEDIUM]
**Room messages use non-unique timestamp as pagination cursor — duplicates/skips in busy rooms**

FILES: `apps/web/app/api/rooms/[roomId]/messages/route.ts`

FIX: `nextCursor` is set to `messages[messages.length - 1]?.created_at` and the next page queries `WHERE created_at < $cursor`. Multiple messages can share the same millisecond timestamp in high-traffic rooms, causing boundary messages to be silently skipped or duplicated. Fix with a compound cursor `(created_at, id)` and query condition `(created_at, id) < ($cursor_ts, $cursor_id)`. Both fields are returned to the client as the cursor token.

---

### BUG-28 [MEDIUM]
**Daily CRON login streak increments on any API activity, not on an actual login event**

FILES: `apps/web/app/api/cron/daily/route.ts`

FIX: The streak increment condition checks `last_active_at::date = today`, meaning it increments for any user who made any API call today. A user who never explicitly logs in but has a background tab refreshing data will have their streak incremented. Add a separate `last_login_at` column updated only on explicit auth token creation, or track a `last_streak_check_at` column updated exactly once per day on the first qualifying login action. The streak should reflect deliberate logins, not passive background activity.

---

### BUG-29 [MEDIUM]
**4-digit PIN brute-forceable with no lockout — full 10,000 keyspace exhaustible in ~16 hours**

FILES: `apps/web/app/api/auth/pin/verify/route.ts`, `apps/web/app/api/auth/pin/setup/route.ts`

FIX: The PIN keyspace is 10,000 and the rate limiter allows 10/min per user with no escalating lockout, exhausting the space in ~16h for anyone with a valid session. Add an escalating per-user lockout tracked in Redis (exponential cooldown after failures; require re-auth/2FA after N total failures) and consider requiring 6-digit PINs. This is especially critical combined with BUG-17 since the PIN is currently the only server-side gate on financial operations.

---

### BUG-30 [MEDIUM]
**CSP 'unsafe-inline' in script-src negates per-request nonce on legacy browsers**

FILES: `apps/web/middleware.ts` → `buildCsp()`

FIX: `script-src` includes both `'nonce-${nonce}'` and `'unsafe-inline'`. Modern browsers (CSP Level 3) correctly ignore `'unsafe-inline'` when a valid nonce is present, but CSP Level 2 browsers honor `'unsafe-inline'` and ignore the nonce — completely defeating XSS mitigation for those users. Remove `'unsafe-inline'` from `script-src`. Any inline scripts that need it must use the nonce forwarded via `x-nonce` header or be moved to external files. `'strict-dynamic'` already handles dynamic chunk loading.

---

### BUG-31 [LOW]
**Payout retry verifies wrong Paystack identifier — pre-retry confirmation always fails**

FILES: `apps/web/lib/payments/payouts.ts` → `attemptTransfer()`

FIX: On retry the code calls `verifyTransfer(payout.idempotency_key)`, but `GET /transfer/:id_or_code` expects the `transfer_code` or numeric id, not the idempotency reference. The lookup always errors and the catch re-initiates, defeating the pre-retry confirmation. Double-payment relies solely on Paystack's reference dedup. Verify by the stored `provider_reference` (the `transfer_code`), falling back to the reference only when no code is recorded.

---

### BUG-32 [LOW]
**Concurrent duplicate IAP submissions return raw 500 instead of clean 409**

FILES: `apps/web/app/api/economy/iap/verify/route.ts`

FIX: Idempotency is checked via `SELECT … coin_ledger WHERE reference_id` outside the `creditCoins` transaction. Two concurrent submissions of the same `purchaseToken` both pass the SELECT, and the second INSERT hits the partial unique index throwing a raw Postgres 500 (no double-credit, but poor UX and noisy logs). Catch `SQLSTATE 23505` from `creditCoins` and translate to a clean 409 `PURCHASE_ALREADY_PROCESSED`, or move the idempotency check inside the credit transaction.

---

### BUG-33 [LOW]
**isPrivateIp treats all 172.x and 192.x as private — weakens geo-anomaly detection**

FILES: `apps/web/lib/security/geoAnomaly.ts` → `isIpAnomalous()`

FIX: `isPrivate` flags any IP with first octet `172` or `192` as private, but only `172.16.0.0–172.31.255.255` and `192.168.0.0/16` are actually private. Legitimate public IPs in those ranges are skipped (false negatives) and never flagged as anomalies. Compare full CIDR ranges using integer math, mirroring how `ssrf.ts` already implements private-IP detection.

---

### BUG-34 [LOW]
**Pagination parseInt with no NaN guard — `?limit=abc` sends NaN to Postgres and returns 500**

FILES: `apps/web/app/api/economy/gifts/route.ts`, `apps/web/app/api/moments/route.ts`, `apps/web/app/api/inbox/route.ts`, and many other `Math.min(parseInt(searchParams...), MAX)` sites

FIX: `Math.min(parseInt("abc"), 100)` produces `NaN`, which errors at the DB driver when bound to a SQL parameter. Add a shared `parsePositiveInt(value, defaultValue, max)` utility or a `z.coerce.number().int().min(1).max(...)` query schema and apply it everywhere pagination/limit params are read.

---

### BUG-35 [LOW]
**getClientIp() trusts rightmost X-Forwarded-For value — spoofable on non-Vercel deployments**

FILES: `apps/web/lib/security/rateLimit.ts` → `getClientIp()`

FIX: On Vercel, `x-vercel-forwarded-for` is non-spoofable and checked first. On other deployments the fallback returns the rightmost `X-Forwarded-For` entry, which is the closest proxy's IP — correct only if infrastructure has exactly one trusted proxy. In multi-proxy or self-hosted configs this can be wrong or spoofable, bucketing many clients together or allowing rate-limit bypass. Make the trusted-proxy depth explicit via a `TRUSTED_PROXY_COUNT` env var, or document Vercel-only deployment as a hard security requirement.

---

### BUG-36 [LOW]
**Auth endpoints (/api/auth/*) exempt from CSRF origin check — login/logout/refresh unprotected**

FILES: `apps/web/middleware.ts` (`PUBLIC_PREFIXES` includes `/api/auth`)

FIX: The CSRF origin check only runs for non-public `/api/` paths. Since `/api/auth/*` is in `PUBLIC_PREFIXES`, login, logout, and refresh POSTs skip the CSRF check, enabling logout-CSRF and login-CSRF attacks. Apply the origin/referer check to state-changing `/api/auth/*` POSTs while still allowing OAuth GET callbacks.

---

### BUG-37 [LOW]
**Unrestricted client-supplied media URLs accepted with no domain allowlist**

FILES: `apps/web/app/api/moments/route.ts` (`media_url`/`thumbnail_url = z.string().url()`)

FIX: Media is accepted as an arbitrary URL with no domain allowlist — enabling hotlinking, tracking-pixel injection, and unmoderatable external content. The storage adapters in `lib/storage/**` are imported by no `app/` or `components/` code. Restrict `media_url`/`thumbnail_url` to the configured storage/CDN host(s), or add a signed-upload endpoint using the existing storage adapters and persist only keys you control.

---

### BUG-38 [LOW]
**Daily CRON moments-expiry step contains a no-op UPDATE (sets expires_at = expires_at)**

FILES: `apps/web/app/api/cron/daily/route.ts` (section 7)

FIX: Before deleting expired moments, the CRON runs `UPDATE moments SET expires_at = expires_at WHERE expires_at < NOW()` — the SET clause assigns the column to itself, locking/writing every expired row for no effect. This is followed by the DELETE that does the actual work. Remove the no-op UPDATE entirely; use DELETE `RETURNING id` if a count of deleted rows is needed for logging.

---

### BUG-39 [LOW]
**user_badges ON CONFLICT target has no matching unique constraint — throws when reached**

FILES: `apps/web/app/api/cron/daily/route.ts` (section 5b badge insert), `apps/web/db/migrations/001_complete_schema.sql` (`user_badges`)

FIX: The badge INSERT uses `ON CONFLICT (user_id, badge_type, reference_id)` but the only unique index is `(user_id, badge_key) WHERE badge_key IS NOT NULL`. Postgres raises "no unique or exclusion constraint matching the ON CONFLICT specification." Currently masked because section 5b fails earlier (BUG-07). Standardize badge idempotency on `badge_key` (`ON CONFLICT (user_id, badge_key)`), or add a unique index on `(user_id, badge_type, reference_id)` if that is the intended key.

---

### BUG-40 [LOW]
**CAPTCHA verification fails open in production — provider "none" returns true by default**

FILES: `apps/web/lib/security/captcha.ts` → `verifyCaptcha()`, `resolveProvider()`

FIX: Provider `"none"` — the default and the manifest-read-error fallback — returns `true` (only logs a warning), so any manifest lookup failure or misconfiguration silently disables bot protection on signup/login. Treat "provider not configured" as a hard failure on protected endpoints in production (return `false`); also fail closed when the manifest read errors. Enforce a real reCAPTCHA score threshold when `score` is undefined for v3.

---

### BUG-41 [LOW]
**Gift-send and coin-transfer ignore block relationships**

FILES: `apps/web/app/api/economy/gifts/send/route.ts`, `apps/web/app/api/economy/coins/transfer/route.ts`

FIX: Neither flow checks whether the recipient has blocked the sender or vice-versa. A blocked user can still push gifts, coins, and attached messages/events — bypassing the block UX and enabling a harassment vector. Before debiting, query the block relationship in both directions and reject with a 403 `USER_BLOCKED`. The DM endpoint has the same gap — see BUG-53.

---

### BUG-42 [LOW]
**Google login auto-links verified Google email to any existing same-email account without confirmation**

FILES: `apps/web/app/api/auth/google/callback/route.ts` → `upsertGoogleUser()`

FIX: With no `google_id` match, a verified Google email is linked to any non-deleted account sharing that email with no confirmation step. If that account's email was set via a weakly-verified path, this enables edge-case account linking or takeover. Require an explicit "link account" confirmation, or only auto-link when the existing account's email was itself verified. Also include `is_banned`, `is_suspended`, `deleted_at` in the new-user INSERT `RETURNING` clause (currently omitted, leaving them `undefined` on the returned row).

---

### BUG-43 [LOW]
**Daily CRON season-end loop overwrites seasonTransitions.ended per iteration — all but last season lost**

FILES: `apps/web/app/api/cron/daily/route.ts`

FIX: Inside the season-transition loop, `seasonTransitions.ended` is reassigned with `= season.id` on each iteration instead of pushed. If multiple seasons end on the same day, only the last one's ID is stored; earlier ones are lost and their downstream processing never runs. Change to `seasonTransitions.ended.push(season.id)` (if `ended` is an array) and ensure downstream logic processes all ended seasons.

---

### BUG-44 [LOW]
**createSeasonCeremonyRoom() called with void — errors silently swallowed**

FILES: `apps/web/app/api/cron/daily/route.ts`

FIX: `createSeasonCeremonyRoom(season.id)` is called with `void` (fire-and-forget). If it throws, the error is lost and the ceremony room is never created, but the CRON reports success. Either await the call and propagate the error (so the CRON can retry), or wrap it in a try/catch and log the failure with enough context to investigate. Never use `void` on async functions that have real, observable side effects.

---

### BUG-45 [LOW]
**Comeback coin reversal uses raw negative SQL row, bypassing debitCoins() ledger helper**

FILES: `apps/web/app/api/cron/daily/route.ts`

FIX: The comeback coin reversal step directly inserts a row with a negative `amount` into the coin ledger table and manually decrements `coin_balance` using raw SQL, bypassing the `debitCoins()` helper. This diverges from the established pattern, skips balance validation, and makes the ledger harder to audit. Refactor to call `debitCoins(userId, amount, "comeback_reversal", ...)` within the CRON transaction, threading the transaction client parameter through as needed.

---

### BUG-46 [LOW]
**Season reward pool silently lost when fewer than 4 users placed in top rankings**

FILES: `apps/web/lib/seasons/seasonEngine.ts` → `distributeSeasonRewards()`

FIX: The pool is split: 50% to rank 1, a share to ranks 2-3, and 50% to ranks 4-10. When fewer than 4 users placed, the 50% allocated to ranks 4-10 is computed but never distributed — those coins simply vanish, neither redistributed to existing winners nor returned to a house wallet. Fix by redistributing unallocated pool shares to the existing top users proportionally, or returning unallocated coins to a season reserve rather than discarding them.

---

### BUG-47 [LOW]
**getPendingMessages() returns messages of all statuses, not just 'pending'**

FILES: `apps/web/lib/offline/messageQueue.ts`

FIX: `getPendingMessages()` fetches ALL records from the IndexedDB store ordered by `createdAt`, including messages with status `'sending'` and `'failed'` alongside `'pending'`. Messages stuck in `'sending'` (e.g., after a crash mid-send) will be re-enqueued and sent again, causing duplicate delivery. Add a status index to the IndexedDB store and filter on `status === 'pending'` in the cursor loop. Add a separate retry mechanism for `'failed'` messages with a retry count cap.

---

### BUG-48 [LOW]
**insertNotificationBatch() issues one INSERT per recipient instead of a single bulk INSERT**

FILES: `apps/web/lib/notifications/insert.ts`

FIX: The function iterates over recipients and calls a single-row INSERT for each one in a loop. For a 1,000-user broadcast event this is 1,000 sequential DB round-trips. Replace with a single parameterized bulk `INSERT INTO notifications (user_id, type, data, ...) VALUES ($1, $2, ...), ($3, $4, ...) ...` built dynamically from the batch array. Use a chunk size of ~500 rows per statement to avoid parameter count limits.

---

### BUG-49 [LOW]
**Global regex lastIndex not reset before replace() in stripContactInfo() — leading matches missed**

FILES: `apps/web/lib/messaging/antispam.ts`

FIX: `URL_REGEX` and `EMAIL_REGEX` are module-level objects with the `g` flag. Global regexes maintain `lastIndex` across calls. `containsContactInfo()` correctly resets `lastIndex = 0` before `.test()`. However `stripContactInfo()` does NOT reset `lastIndex` before calling `.replace()`. If `lastIndex` is non-zero (from a prior `.test()` call), `.replace()` starts scanning from that offset and misses all URLs/emails at the start of the string. Add `URL_REGEX.lastIndex = 0` and `EMAIL_REGEX.lastIndex = 0` at the top of `stripContactInfo()`, or use non-global regexes with `replaceAll()`.

---

### BUG-50 [LOW]
**reconcileStuckPayouts() interface declares amount_kobo but SQL never selects it**

FILES: `apps/web/lib/payments/payouts.ts` → `reconcileStuckPayouts()`

FIX: The query row type declares `amount_kobo: string` but the SELECT retrieves `gross_kobo` (not `amount_kobo`). The field is never read so there is no runtime error, but the interface is misleading. Either remove `amount_kobo` from the interface (it is dead code), or add it to the SELECT if it is actually needed. Also audit whether `gross_kobo` is the correct field for the reconciliation logic or whether `amount_kobo` (payout amount after fees) should be used instead.

---

### BUG-51 [LOW]
**DM history SQL filter injected via string interpolation — latent SQL injection**

FILES: `apps/web/app/api/messages/dm/[conversationId]/route.ts`

FIX: `historyFilter` (derived from a DB-fetched `userPlan` enum value) is interpolated directly into the SQL string. While the value currently comes from the database and is safe, this pattern is fragile — if the derivation logic were ever changed to accept user input, SQL injection would be immediately possible. Map the plan value to a numeric constant (days limit) in application code and pass that number as a `$N` parameter.

---

### BUG-52 [LOW]
**DM route stores null when antispam strips all content from a message — no user-facing error**

FILES: `apps/web/app/api/messages/dm/[conversationId]/route.ts`

FIX: When `stripContactInfo()` removes all contact info and the result is an empty string, `filtered || null` stores null in the messages table. This is ambiguous, provides no feedback to the sender, and may cause client-side rendering errors for a null-content message. Either reject the message with a clear 400 error, store an empty string with a `filtered: true` flag, or replace with a placeholder like `[Message removed by content filter]` so the recipient sees something meaningful.

---

### BUG-53 [LOW]
**DM route does not check if recipient has blocked the sender before persisting the message**

FILES: `apps/web/app/api/messages/dm/[conversationId]/route.ts`

FIX: The route validates conversation membership and rate limits, but does not check whether the recipient has blocked the sending user. A blocked user can still send DMs that are persisted to the DB (the client may filter display, but the server does not). Add a block-relationship check before inserting the message, returning a 403 or a generic 400 that does not reveal the block status to the sender.

---

### BUG-54 [LOW]
**DM XP ledger records multiplier as raw decimal 1 while XP engine uses basis points (100 = 1×)**

FILES: `apps/web/app/api/messages/dm/[conversationId]/route.ts`

FIX: The XP ledger INSERT for DM messages records `multiplier = 1`. The XP engine (`lib/xp/engine.ts`) represents multipliers in basis points where `100` = 1× and `150` = 1.5×. A stored value of `1` reads as 0.01× in any analytics or future query that interprets the column as basis points. Standardize all XP ledger writes to basis-point representation (store `100` for 1×). Audit all other `xp_ledger` INSERTs for consistency.

---

### BUG-55 [LOW]
**decryptField() has no try/catch — AES-GCM authentication failures propagate as unhandled exceptions**

FILES: `apps/web/lib/security/fieldEncryption.ts`

FIX: `decryptField()` has no try/catch. An AES-256-GCM authentication tag failure (corrupted ciphertext, wrong key, or tampered data) throws a `DOMException` / SubtleCrypto error. If callers don't wrap it in their own try/catch (and some don't), the request crashes with a 500. Add a try/catch inside `decryptField()` and either return `null` on failure or throw a typed application error that identifies the failure as a decryption issue. Log the failure with the field name (not the value) to aid debugging.

---

### BUG-56 [LOW]
**Paystack subscription webhook ignores starsGranted metadata for star-pack subscription purchases**

FILES: `apps/web/app/api/economy/webhooks/paystack/route.ts` → `processSubscriptionEvent()`

FIX: In the star-pack subscription branch, only `coinsGranted` from metadata is processed. If a subscription plan grants stars, `starsGranted` is never read and no stars are credited. Audit the Paystack subscription metadata schema to confirm whether `starsGranted` is present for star-pack plans. If so, add a `creditStars()` call analogous to the coin_pack path. Align with the DodoPayments handler (after BUG-04 is fixed) so both payment providers award the same resources for the same product types.

---

### BUG-57 [LOW]
**Coin purchase idempotency key includes randomUUID() — true deduplication is impossible**

FILES: `apps/web/app/api/economy/coins/purchase/route.ts`

FIX: The comment says the key is "deterministic per user+pack+day" but it is constructed as `${userId}-${packId}-${dayPrefix}-${randomUUID()}`. The UUID makes it unique per request, not per user+pack+day. Duplicate requests within the same day generate different keys and both go through. The existing DB deduplication check using `LIKE $1` with a day-prefix pattern also never matches because the UUID suffix differs. Remove the UUID suffix to make the key truly deterministic, or switch to a client-supplied idempotency key from a request header validated server-side.

---

### BUG-58 [LOW]
**Google OAuth username fallback may exceed database username column length**

FILES: `apps/web/app/api/auth/google/callback/route.ts`

FIX: When Google does not provide a username or the preferred username is taken, a fallback is generated from the display name with non-alphanumeric chars stripped and a random suffix appended. If the display name is long (e.g., 60 characters), the result can exceed the DB `username` column's length constraint, causing an INSERT error. Add a `.slice(0, maxLength - suffixLength)` before appending the suffix. Check the DB schema for the exact column length and align the application-side cap to it.

---

### BUG-59 [LOW]
**filterPublicContent() called with redundant double-admin condition in DM route**

FILES: `apps/web/app/api/messages/dm/[conversationId]/route.ts`

FIX: The call `filterPublicContent(content, isAdmin && !blockLinks)` passes a condition where `blockLinks` is already derived from `isAdmin` status, making the `isAdmin &&` outer condition redundant and confusing. Simplify to a single clear boolean that expresses the intent directly — if admins always bypass link filtering, pass `isAdmin`; if `blockLinks` can be true for admins under specific plan conditions, document and express that logic explicitly without the double-layering.

---

### BUG-60 [LOW]
**Daily CRON monthly plan bonuses processed in 3 separate per-plan transactions instead of one**

FILES: `apps/web/app/api/cron/daily/route.ts`

FIX: The monthly plan bonus step iterates over three plan tiers and runs each in its own independent DB transaction. If the second transaction fails, the first has already committed (some users got bonuses, others did not). Consolidate into a single transaction covering all plan tiers. If a single large transaction is a concern for lock contention, at minimum add error handling so a partial failure is detected and retried, rather than leaving distribution in a half-applied state.

---

## Summary Statistics

| Severity | Count | Examples |
|---|---|---|
| Critical | 4 | BUG-01, BUG-02, BUG-03, BUG-04 |
| High | 11 | BUG-05 through BUG-15 |
| Medium | 15 | BUG-16 through BUG-30 |
| Low | 30 | BUG-31 through BUG-60 |
| **Total** | **60** | |

---

*Report generated: June 13, 2026 02:57 PM*  
*Analysis: Two independent forensic passes over web app, PWA (Next.js 15 App Router) and Expo Android app. All 60 findings cite concrete file locations. No agents or sub-agents used — all analysis performed via direct file reads. Per instructions, do not begin fixes until this report and the accompanying `custom-bugs-fix-plan.md` have been reviewed and approved.*
