# Zobia Social — Custom Forensic Bug Report

**Generated:** Saturday, June 13, 2026 — 12:36 AM (UTC)
**Scope:** Full monorepo — Next.js 15 web app + PWA (`apps/web`), Expo/React-Native Android app (`apps/expo`), shared types, DB schema.
**Method:** Independent three-pass manual review of the database/auth/economy/payment cores, every money-movement path, the daily CRON, security libraries, the Expo client, and cross-checks against `001_complete_schema.sql`. No reliance on any pre-existing report. CRON-frequency concerns and test files were excluded per instructions.

---

## Overall Rating & Review

**Current state — 6.4 / 10**

The architecture is genuinely strong: clean provider abstractions (DB/Redis/storage/realtime), strictly parameterised SQL (no injection found anywhere), `decimal.js` money arithmetic, append-only ledgers with `SELECT … FOR UPDATE`, partial-unique idempotency indexes, HMAC webhook verification, refresh-token rotation with reuse detection, and DB-backed admin authorization. That foundation is above average for an app this size.

However, the review surfaced a cluster of **shipping-blocker functional bugs** that break paid, money-handling, or core flows end-to-end:
- Drop-room entry payments cannot complete (webhook crashes on a `0`-coin credit).
- Roughly **half** of the Expo app's API calls use the wrong URL path and will 404.
- Offline message sync targets a non-existent endpoint and never retries.
- Google Play purchases are consumed even when server verification fails (real money loss).
- The advertised paid-plan XP multiplier is never applied to messaging XP.
- A weekly leaderboard CRON writes to columns that don't exist.

There are also meaningful security gaps (plaintext TOTP secrets, a regex HTML sanitizer that is bypassable, PIN not enforced on the payout/transfer endpoints it's meant to guard, and an unbounded SSRF response body).

**Projected state after the recommended fixes — 9.0 / 10.** None of the issues are architectural; they are localized defects and a few cross-cutting consistency problems. Once the path convention, the webhook item-type handling, the IAP consume-ordering, and the XP/notification/ledger consistency items are resolved, this becomes a robust, secure platform.

Category breakdown (current → projected):
- Correctness / functional: 5.5 → 9.0
- Security: 6.5 → 9.0
- Structure / maintainability: 8.0 → 9.0
- Performance / scalability: 7.5 → 8.5

---

## Summary List (all findings, one line each)

1. **ZBX-01 (Critical):** Drop-room entry payments never complete — webhook crashes calling `creditCoins(…, 0)`; user is charged but can never join.
2. **ZBX-02 (Critical):** Expo app — ~65 of ~133 `apiClient` calls omit the `/api/` path prefix; with the configured base URL, roughly half the mobile API surface 404s.
3. **ZBX-03 (Critical):** Expo offline message sync posts to `/api/messages/{id}` (no `/dm/` or `/group/`) — wrong/nonexistent route; failed messages are never retried.
4. **ZBX-04 (High):** Google Play purchase is consumed/acknowledged even when server verification fails — user pays, coins are lost, token is gone.
5. **ZBX-05 (High):** Paid-plan XP multiplier is never applied to messaging XP — room/DM messages award flat base XP, nullifying a core monetised perk.
6. **ZBX-06 (High):** Weekly season-leaderboard CRON (section 5b) INSERT/DELETE references non-existent columns (`season_id`, `xp_total`, `snapshotted_at`) — fails every Sunday.
7. **ZBX-07 (High):** Daily-login XP can be double-awarded under concurrency — Redis guard is set *after* the transaction (not `NX` before), and the same-day branch doesn't zero the award.
8. **ZBX-08 (High):** Expo API client wipes credentials on refresh failure but never notifies `AuthContext` (no sign-out event fired) — UI is stuck in a broken authenticated state.
9. **ZBX-09 (High):** `setPurchaseListener` is registered per-purchase in the Google Play flow — sequential/concurrent purchases cross-fire; non-matching purchases are never finished or resolved (hung promises / stuck purchases).
10. **ZBX-10 (High):** TOTP secrets are stored in plaintext in `users.totp_secret` — `fieldEncryption` exists but is not applied; DB compromise fully defeats 2FA.
11. **ZBX-11 (Medium):** PIN is enforced server-side only for bank-account/wallet changes, not for payout/transfer/purchase endpoints — client-side PIN gates are bypassable by direct API call.
12. **ZBX-12 (Medium):** `safeFetch` enforces the response-size cap only via `Content-Length`; chunked/omitted-length responses are unbounded (memory-exhaustion DoS).
13. **ZBX-13 (Medium):** SSRF check is TOCTOU/DNS-rebinding-vulnerable — `validateOutboundUrl` resolves DNS, then `fetch()` re-resolves with no IP pinning.
14. **ZBX-14 (Medium):** Coin transfer & gift-send acquire row locks in sender→recipient order — two opposite simultaneous transfers deadlock (one user gets a 500).
15. **ZBX-15 (Medium):** Subscription monthly bonus can double-credit — webhook uses `subscription_bonus` while CRON's dedupe checks `monthly_plan_bonus`; also `subscription.create` re-awards on every duplicate webhook.
16. **ZBX-16 (Medium):** Comeback-bonus "claimed" marker (`comeback_bonus_claimed`) is never written — the claim logic is dead and only the unique index prevents repeat credits (throws daily, swallowed).
17. **ZBX-17 (Medium):** Two parallel XP audit tables (`xp_events` vs `xp_ledger`) are written by different routes — XP history is fragmented; any single-table read is incomplete.
18. **ZBX-18 (Medium):** Regex HTML sanitizer's protocol filter is bypassable via HTML entities / embedded control chars (e.g. `java&#9;script:`) — stored-XSS path for announcement HTML.
19. **ZBX-19 (Medium):** Notifications are written in two incompatible shapes (`payload` vs `title`/`body`/`metadata`); the read API ignores `metadata` and `unreadCount` is capped at the 50 loaded rows.
20. **ZBX-20 (Medium):** Admin login sets a 30-day refresh-cookie `Max-Age` for a 1-hour admin session — `buildCookieHeaders` is called without the admin `refreshTtl`.
21. **ZBX-21 (Medium):** 4-digit PIN with a 10/min per-user limit and no lockout — full 10,000 keyspace is brute-forceable in ~16h with a valid session.
22. **ZBX-22 (Low):** `payouts.attemptTransfer` retry calls `verifyTransfer(idempotency_key)` instead of the `transfer_code` — the pre-retry confirmation always fails; double-pay protection relies solely on Paystack reference dedup.
23. **ZBX-23 (Low):** Concurrent duplicate IAP submissions surface as a raw 500 (unique-index violation) instead of a clean 409 — idempotency SELECT is outside the credit transaction.
24. **ZBX-24 (Low):** `geoAnomaly.isPrivateIp` treats *all* `172.*` and `192.*` as private (should be `172.16/12` and `192.168/16`) — weakens IP-anomaly detection with false negatives.
25. **ZBX-25 (Low):** Pagination `limit` params are `parseInt`-ed with no `NaN` guard across many routes — `?limit=abc` passes `NaN` to Postgres and 500s.
26. **ZBX-26 (Low):** `getClientIp` x-forwarded-for fallback returns the *rightmost* value (closest proxy / often an internal LB IP), mislabeled as the trusted client IP.
27. **ZBX-27 (Low):** CSRF origin check exempts the entire `/api/auth/*` prefix — login/logout/refresh have no CSRF protection.
28. **ZBX-28 (Low):** `media_url`/`thumbnail_url` accept arbitrary external URLs (only `z.string().url()`); the web app has no upload endpoint and the storage abstraction is unused — open-media-URL abuse / no domain allowlist.
29. **ZBX-29 (Low):** Daily CRON moments-expiry runs a redundant no-op `UPDATE … SET expires_at = expires_at` that locks every expired row before the DELETE.
30. **ZBX-30 (Low):** CRON 5b badge insert uses `ON CONFLICT (user_id, badge_type, reference_id)` but no such unique constraint exists on `user_badges` — would throw if the (already-broken) snapshot block reached it.
31. **ZBX-31 (Low):** CAPTCHA verification fails *open* — provider `"none"` (the default, and the DB-error fallback) returns `true` even in production.
32. **ZBX-32 (Low):** Gift-send and coin-transfer don't check block relationships — a blocked/blocking user can still push gifts/coins to a target.
33. **ZBX-33 (Low):** Google login links a verified Google email to any pre-existing account with the same email without a confirmation step — edge-case account-linking risk.
34. **ZBX-34 (Low):** TOTP verification has no replay protection (a code is reusable within its ±1 step window) on the legacy `sessionToken` and admin paths.

---

## Detailed Findings

### 1: ZBX-01 — Drop-room entry payments crash the webhook and never complete (Critical)
**FILES:** `apps/web/app/api/economy/webhooks/paystack/route.ts` (`processChargeSuccess`), `apps/web/app/api/rooms/[roomId]/pay-entry/route.ts`, `apps/web/app/api/rooms/[roomId]/join/route.ts`
**FIX:** `pay-entry` creates a payment with `metadata.itemType = "room_entry"` and `coinsGranted: 0`. `processChargeSuccess` has no `room_entry` branch — it falls through to the coin path, looks up `store_items` by `packId = roomId` (no row), leaves `serverCoinsGranted = 0`, then calls `creditCoins(userId, 0, …)`, which throws (amount must be a positive integer). The transaction rolls back, the payment stays `pending`, and the webhook 500s on every Paystack retry. The `join` route requires `status='completed'`, so the paying user is permanently locked out while having been charged. Add an explicit `room_entry` branch in `processChargeSuccess` *before* the coin path that marks the payment completed and returns (mirroring `room_subscription`), and harden the coin path to skip crediting when `serverCoinsGranted <= 0` instead of calling `creditCoins(…, 0)`.

### 2: ZBX-02 — Half the Expo app's API calls use the wrong path prefix (Critical)
**FILES:** `apps/expo/lib/api/client.ts` (`baseURL = env.API_BASE_URL`), `apps/expo/lib/env.ts` (`API_BASE_URL` default `https://api.zobia.app`), plus ~65 call sites across `apps/expo/app/**` and `apps/expo/components/**`
**FIX:** `apiClient.baseURL` has no `/api` suffix, and infra calls expect the prefix (`/api/auth/refresh`, `/api/economy/iap/verify`), yet **68 calls start with `/api/` and 65 start with `/` but not `/api/`** (e.g. `/auth/pin/verify`, `/friends`, `/follows/${id}`, `/guilds`, `/leaderboards`, `/merch/*`, `/nemesis`, `/rooms`, `/seasons/current`, `/stickers`, `/users/${id}/profile`, `/messages/conversations/*`). No base-URL value makes both groups resolve — the other ~half always 404s. Standardize on one convention: make all paths relative *without* `/api` and put `/api` in `baseURL` (recommended), or keep `/api/` everywhere; add a wrapper/lint that rejects non-conforming paths, then fix the 65 offenders. Note `/messages/conversations/...` also doesn't match the real `/api/messages/dm/[conversationId]` structure and needs the `conversations`→`dm` correction too.

### 3: ZBX-03 — Offline message sync posts to a nonexistent route and never retries (Critical)
**FILES:** `apps/expo/lib/offline/syncQueue.ts`, `apps/expo/lib/offline/sqlite.ts` (`getPendingMessages`, `markMessageFailed`, `retryFailedMessages`)
**FIX:** `syncQueue` posts to `` `/api/messages/${msg.conversation_id}` `` but the real routes are `/api/messages/dm/[conversationId]` and `/api/messages/group/[groupId]` — there is no `/api/messages/[id]` route, so every queued message 404s and is marked `failed`. `getPendingMessages` only selects `sync_status='pending'`, and `retryFailedMessages()` is never called, so failed messages are stuck permanently. Route by stored conversation type to `/api/messages/dm/${id}` or `/api/messages/group/${id}` (with the prefix from ZBX-02), call `retryFailedMessages()` on reconnect before draining the queue, and add a client idempotency key to each queued message.

### 4: ZBX-04 — Google Play purchase consumed even when server verification fails → money loss (High)
**FILES:** `apps/expo/lib/payments/googlePlay.ts` (`purchaseCoins`, `purchaseSubscription`, `verifyPurchaseServerSide`)
**FIX:** `verifyPurchaseServerSide` returns `null` on *any* failure (including transient network/5xx), and the listener then calls `finishTransactionAsync(...)` "regardless of server verification outcome." Consuming discards the `purchaseToken`, so a user who paid Google gets no coins and nothing to retry. Only finish/acknowledge after a confirmed server credit; on transient/unknown failure leave the purchase unconsumed so Google Play replays it next launch (the server credit is idempotent via the unique `coin_ledger` ref). Distinguish "definitively invalid" (consume) from "transient" (keep) using the server status code.

### 5: ZBX-05 — Paid-plan XP multiplier never applied to messaging XP (High)
**FILES:** `apps/web/app/api/rooms/[roomId]/messages/route.ts`, `apps/web/app/api/messages/dm/route.ts`, `apps/web/app/api/messages/dm/[conversationId]/route.ts` (plus the 21-vs-15 split of inline-XP vs engine-using routes)
**FIX:** Per PRD §6 the plan multiplier (1×/1.5×/3×/5×) applies to messaging XP, but message routes award flat base XP and write `multiplier=1` to `xp_ledger` without calling `applyMultipliers`/`calculateFinalXP`. A Max-plan user gets the same messaging XP as a free user — the headline paid perk is inert (guild/season-pass boosts are skipped too). Route all XP awards through a single `awardXp()` helper that calls `calculateFinalXP(action, ctx)` with the user's plan/guild/season-pass context and persists the real `multiplier`/`base_amount` (this also fixes ZBX-17).

### 6: ZBX-06 — Weekly season leaderboard CRON writes to columns that don't exist (High)
**FILES:** `apps/web/app/api/cron/daily/route.ts` (section 5b "Weekly Season Leaderboard Snapshot"), `apps/web/db/migrations/001_complete_schema.sql` (`leaderboard_rank_snapshots`)
**FIX:** The table is `(id, user_id, scope, rank, xp, snapped_at)` with `UNIQUE(user_id, scope)`. Section 5b's `DELETE … WHERE season_id = $1` and `INSERT … (user_id, scope, season_id, rank, xp_total, snapshotted_at)` reference `season_id`, `xp_total`, and `snapshotted_at`, none of which exist — both statements throw every Sunday (swallowed into `errors`), so the snapshot and its `season_top100_frame` badge block never run. Either add `season_id` + a `UNIQUE(user_id, scope, season_id)` and alias the columns, or rewrite 5b to the real columns (`xp`, `snapped_at`) encoding season scope inside `scope`. Reconcile with the correctly-written section 14 so both writers agree.

### 7: ZBX-07 — Daily-login XP double-award under concurrency (High)
**FILES:** `apps/web/app/api/login/daily/route.ts`
**FIX:** The idempotency key is set with `redis.set(redisKey,"1","EX",…)` *after* the transaction, not `NX` before it. Two near-simultaneous requests both pass the initial `redis.get === null` check and both run the transaction; the `FOR UPDATE` only serializes them, and the second's `lastLogin === today` branch keeps the streak but does **not** zero `xpAwarded`, so it credits another 50 XP. Set `redis.set(redisKey,"1","EX",ttl,"NX")` *before* the transaction and bail when it returns `null`; defensively set `xpAwarded = 0` whenever `lastLogin === today`.

### 8: ZBX-08 — Expo client clears credentials on refresh failure but never signs out (High)
**FILES:** `apps/expo/lib/api/client.ts` (response interceptor), `apps/expo/lib/auth/context.tsx`
**FIX:** On failed refresh the interceptor deletes SecureStore keys and comments "fire global sign-out event," but emits nothing and `AuthContext` has no listener; the in-memory `user`/`token` stay set, so the app keeps showing authenticated screens while every request fails until a cold restart. Add a small event bus or a registered `onUnauthenticated` callback that the `AuthProvider` subscribes to, and have the interceptor invoke it after clearing storage so `signOut()` runs and the router redirects to login.

### 9: ZBX-09 — Per-purchase `setPurchaseListener` causes cross-fire and hung promises (High)
**FILES:** `apps/expo/lib/payments/googlePlay.ts` (`purchaseCoins`, `purchaseSubscription`)
**FIX:** Each call installs a fresh listener whose closure filters by *that* `productId`; a later purchase's listener replaces the earlier one, so when the earlier purchase resolves the active listener's `results.find(...)` misses — it neither resolves the promise nor finishes the transaction (purchase hangs, stays unconsumed, later replayed). Register one global listener at init that resolves pending purchases via a `Map<productId|orderId, resolver>` and always finishes processed transactions; have the purchase functions register/await a resolver instead of re-installing the listener.

### 10: ZBX-10 — TOTP secrets stored in plaintext (High)
**FILES:** `apps/web/app/api/auth/2fa/setup/route.ts`, `apps/web/app/api/auth/2fa/verify/route.ts`, `apps/web/app/api/admin/auth/totp/route.ts`, `apps/web/app/api/admin/auth/totp/setup/route.ts`, `apps/web/lib/security/fieldEncryption.ts` (present but unused for TOTP)
**FIX:** `users.totp_secret` is written/read as plaintext Base32 while bank PII is already AES-256-GCM encrypted via `encryptField`/`decryptField`. A DB read (backup leak, insider, SQLi elsewhere) yields working 2FA seeds for every user/admin. Encrypt `totp_secret` with `encryptField` on write and `decryptField` on read in all TOTP routes, migrate existing rows, and confirm the encryption key env var is set. Consider hashing recovery codes too.

### 11: ZBX-11 — PIN not enforced server-side on payout/transfer/purchase endpoints (Medium)
**FILES:** `apps/web/app/api/creator/payouts/route.ts`, `apps/web/app/api/economy/coins/transfer/route.ts`, `apps/web/app/api/economy/gifts/send/route.ts`, `apps/web/app/api/economy/store/*`; PIN is checked only in `creator/bank-account/route.ts` and `creator/wallet-address/route.ts`; Expo gates client-side in `app/economy/store.tsx`, `app/creator/dashboard.tsx`
**FIX:** The PIN guards changing the payout destination (good) but the payout-initiation, transfer, gift, and store endpoints accept any valid session token without PIN proof, so the client-side prompts are advisory and a stolen token can move funds directly. Decide which actions require the PIN and enforce it server-side, ideally via a short-lived "PIN-verified" claim (signed nonce or `pin_ok:{uid}` Redis key with a few-minutes TTL) minted by `/auth/pin/verify` and required by the sensitive mutations — not a bare boolean the client can skip.

### 12: ZBX-12 — `safeFetch` response-size cap not enforced on chunked responses (Medium)
**FILES:** `apps/web/lib/security/ssrf.ts` (`safeFetch`)
**FIX:** The size guard only inspects `Content-Length`; a server can omit it (chunked) and stream unbounded data — the comment claims an "actual body size" check that doesn't exist. Used for link-preview/manifest/admin-URL fetches, this is a memory-exhaustion DoS. Read the body through a size-counting stream reader and abort with `SSRFError` once `maxResponseBytes` is exceeded, instead of trusting the header.

### 13: ZBX-13 — SSRF DNS-rebinding / TOCTOU (Medium)
**FILES:** `apps/web/lib/security/ssrf.ts` (`validateOutboundUrl`, `isHostnameResolvingToPrivateIp`, `safeFetch`)
**FIX:** `validateOutboundUrl` resolves the hostname and rejects private results, but `safeFetch` then calls `fetch(url)` which re-resolves independently, letting attacker DNS answer "public" for validation and "private" (e.g. `169.254.169.254`) for the fetch; only `resolve4` is checked so IPv6 rebinding is unguarded too. Resolve once, validate the resolved IP(s) for both A and AAAA, and pin the connection to that IP (custom lookup/agent or fetch-by-IP with the original `Host`), re-validating on every redirect hop.

### 14: ZBX-14 — Lock-ordering deadlock in coin transfer / gift send (Medium)
**FILES:** `apps/web/lib/economy/coins.ts` (`transferCoins`), `apps/web/app/api/economy/coins/transfer/route.ts`, `apps/web/app/api/economy/gifts/send/route.ts`
**FIX:** Both flows debit the sender (locks sender row) then credit the recipient (locks recipient row); two simultaneous opposite operations (A→B and B→A) acquire locks in opposite order and deadlock, surfacing as a 500. Lock the two user rows in a deterministic order (e.g. ascending `id`) before mutating either balance regardless of direction, and optionally retry once on SQLSTATE `40P01`.

### 15: ZBX-15 — Subscription monthly bonus can double-credit (Medium)
**FILES:** `apps/web/app/api/economy/webhooks/paystack/route.ts` (`processSubscriptionEvent`), `apps/web/app/api/cron/daily/route.ts` (section 21), `apps/web/app/api/economy/iap/verify/route.ts` (`verifyAndActivateSubscription`)
**FIX:** The webhook awards `subscription_bonus` keyed on `subscription_code`; the day-1 CRON awards `monthly_plan_bonus` and dedupes only against `monthly_plan_bonus` — so subscribing on the 1st yields both. Also `subscription.create` awards on every delivery of that event (Paystack may resend), prevented only by the `(transaction_type, reference_id)` unique index, which throws a raw 500 on collision. Pick one authoritative monthly-bonus path and dedupe across both transaction types for the period (e.g. key `monthly_plan_bonus` as `plan:{userId}:{YYYY-MM}`); make `subscription.create` swallow the unique violation as "already processed."

### 16: ZBX-16 — Comeback-bonus "claimed" marker is never written (Medium)
**FILES:** `apps/web/app/api/login/daily/route.ts`, `apps/web/app/api/cron/daily/route.ts` (sections 11/22)
**FIX:** The login route credits claimed bonuses with `transaction_type='comeback_bonus'`, but both the claim's `NOT EXISTS` guard and the expiry CRON look for `transaction_type='comeback_bonus_claimed'`, which nothing ever inserts. The claim re-selects the reserved bonus on every login and only the unique index stops a repeat credit (throwing a swallowed error daily); expiry instead leans on `last_active_at`. Write an explicit `comeback_bonus_claimed` ledger row (or a `claimed_at` flag) in the same transaction as the credit and have both guards test it. Also time-scope the reservation reference (`comeback:{userId}` permanently blocks a second lifetime comeback).

### 17: ZBX-17 — Fragmented XP audit trail across `xp_events` and `xp_ledger` (Medium)
**FILES:** `apps/web/app/api/economy/gifts/send/route.ts` & `economy/coins/transfer/route.ts` (write `xp_events`), ~29 routes write `xp_ledger`; readers split 8 (`xp_ledger`) vs 1 (`xp_events`)
**FIX:** Two append-only XP tables are populated by different features, so any history/analytics/reconciliation reading one silently misses the other and totals won't match `users.xp_total`. Consolidate onto one canonical ledger (recommend `xp_ledger`, which carries `multiplier`/`base_amount`), migrate `xp_events`, repoint the gift/transfer routes, and funnel all writes through the single `awardXp()` helper from ZBX-05.

### 18: ZBX-18 — Regex HTML sanitizer protocol filter is bypassable (Medium)
**FILES:** `apps/web/lib/security/htmlSanitizer.ts`; consumers `apps/web/app/api/admin/announcements/{banners,modals}/**`; renderers `apps/web/components/announcements/AnnouncementBanner.tsx`, `AnnouncementModal.tsx`
**FIX:** `DANGEROUS_PROTOCOLS` is tested against the raw value, but browsers ignore embedded tabs/newlines and decode entities in URL schemes, so `href="java&#9;script:alert(1)"` (or a literal tab) passes the filter yet executes — stored XSS rendered to all users via `dangerouslySetInnerHTML`. Replace the hand-rolled regex with a vetted sanitizer (`sanitize-html`/DOMPurify); if not possible, decode entities and strip control chars before the scheme test and allow only an explicit scheme allowlist (`http`/`https`/`mailto`). Add `rel="noopener noreferrer"` for `target=_blank`.

### 19: ZBX-19 — Inconsistent notification shapes; read API drops `metadata` and miscounts unread (Medium)
**FILES:** notification writers across `apps/web/app/api/**` (some insert `payload`, others `title`/`body`/`metadata`), `apps/web/app/api/economy/webhooks/paystack/route.ts` (both in one file), `apps/web/app/api/notifications/route.ts`
**FIX:** The table carries both `payload` and `title`/`body`/`metadata`, populated inconsistently, so one renderer can't reliably display every notification; the GET endpoint never selects `metadata` and computes `unreadCount` from only the 50 loaded rows. Standardize on one content shape (recommend structured `payload` + optional `title`/`body`), backfill, update all writers, select all needed fields in the read API, and compute `unreadCount` with a dedicated `COUNT(*) WHERE is_read=false`.

### 20: ZBX-20 — Admin refresh cookie outlives the 1-hour admin session (Medium)
**FILES:** `apps/web/app/api/admin/auth/totp/route.ts`, `apps/web/lib/auth/session.ts` (`buildCookieHeaders`)
**FIX:** `createSession({ adminSession: true })` stores a 1-hour refresh session in Redis, but the login calls `buildCookieHeaders(tokens)` without the admin `refreshTtl`, so the browser keeps the refresh cookie 30 days (access still expires at 1h since Redis is authoritative, but the cookie lifetime contradicts the intent and the function's own documented warning). Pass `ADMIN_REFRESH_TOKEN_TTL_SECONDS` as the third arg to `buildCookieHeaders` in the admin TOTP login, as the refresh route already does.

### 21: ZBX-21 — 4-digit PIN brute-forceable with no lockout (Medium)
**FILES:** `apps/web/app/api/auth/pin/verify/route.ts`, `apps/web/app/api/auth/pin/setup/route.ts`
**FIX:** The PIN space is 10,000 and the limiter allows 10/min per user with no escalating lockout, exhausting the space in ~16h for anyone holding a valid session. Add an escalating per-user lockout (exponential cooldown after a few failures; require re-auth/2FA after N), tracked in Redis, and consider 6-digit PINs. Combine with ZBX-11 so the PIN actually gates sensitive actions.

### 22: ZBX-22 — Payout retry verifies the wrong Paystack identifier (Low)
**FILES:** `apps/web/lib/payments/payouts.ts` (`attemptTransfer`), `apps/web/lib/payments/paystack.ts` (`verifyTransfer`)
**FIX:** On retry the code calls `verifyTransfer(payout.idempotency_key)`, but `GET /transfer/:id_or_code` expects the `transfer_code`/numeric id, not your reference — so the lookup always errors and the catch re-initiates, defeating the pre-retry confirmation. Double-payment is prevented only by Paystack rejecting a duplicate `reference`. Verify by the stored `provider_reference` (the `transfer_code`), falling back to the reference only when no code is recorded, restoring the intended confirm-before-reinitiate guard.

### 23: ZBX-23 — Concurrent duplicate IAP returns 500 instead of 409 (Low)
**FILES:** `apps/web/app/api/economy/iap/verify/route.ts`
**FIX:** Idempotency is a `SELECT … coin_ledger WHERE reference_id` *outside* the `creditCoins` transaction; two concurrent submissions of the same `purchaseToken` both pass the SELECT and the second's insert hits the partial unique index, throwing a raw Postgres 500 (no double-credit, but poor UX/noisy logs). Catch SQLSTATE `23505` from `creditCoins` and translate it to the clean 409 `PURCHASE_ALREADY_PROCESSED`, or move the idempotency check inside the credit transaction.

### 24: ZBX-24 — Over-broad private-IP test weakens geo-anomaly detection (Low)
**FILES:** `apps/web/lib/security/geoAnomaly.ts` (`isIpAnomalous`)
**FIX:** `isPrivate` flags any first octet of `172` or `192` as private, but only `172.16.0.0–172.31.255.255` and `192.168.0.0/16` are private, so legitimate public IPs in those ranges are skipped (false negatives) and never flagged. Compare full CIDR ranges using integer math like `ssrf.ts` already does, rather than first-octet equality.

### 25: ZBX-25 — Pagination `parseInt` 500s on non-numeric input (Low)
**FILES:** e.g. `apps/web/app/api/economy/gifts/route.ts`, `apps/web/app/api/moments/route.ts`, `apps/web/app/api/inbox/route.ts`, and many `Math.min(parseInt(searchParams...), MAX)` sites
**FIX:** `Math.min(parseInt("abc"), 100)` is `NaN`, which errors at the driver when bound to a SQL param → 500 on `?limit=abc`. Add a shared `parsePositiveInt(value, default, max)` (or a `z.coerce.number().int().min(1).max(...)` query schema) and use it everywhere pagination/limit params are read.

### 26: ZBX-26 — `getClientIp` fallback trusts the wrong x-forwarded-for entry (Low)
**FILES:** `apps/web/lib/security/rateLimit.ts` (`getClientIp`)
**FIX:** When `x-vercel-forwarded-for`/`x-real-ip` are absent the fallback returns the *rightmost* x-forwarded-for hop (closest proxy / often an internal LB IP), which the comment mislabels as the trusted client IP — bucketing many clients under one IP on non-Vercel hosts. Make the trusted-proxy depth explicit (take the Nth-from-right hop), or require `x-real-ip` and treat its absence as `unknown`.

### 27: ZBX-27 — Auth endpoints exempt from CSRF origin check (Low)
**FILES:** `apps/web/middleware.ts` (`isCsrfSafe`, `PUBLIC_PREFIXES` includes `/api/auth`)
**FIX:** The Origin check runs only for non-public `/api/` paths; since `/api/auth/*` is public, login/logout/refresh skip it, enabling logout-CSRF and login-CSRF. Apply the Origin/Referer check to the state-changing `/api/auth/*` POSTs while still allowing OAuth `GET` callbacks, or add CSRF tokens to those forms.

### 28: ZBX-28 — Unrestricted client-supplied media URLs; storage abstraction unused on web (Low)
**FILES:** `apps/web/app/api/moments/route.ts` (`media_url`/`thumbnail_url` = `z.string().url()`), `apps/web/lib/storage/**` (imported by no `app/`/`components/` code)
**FIX:** Media is accepted as an arbitrary URL with no allowlist (hotlinking, tracking-pixel injection, unmoderatable content), and the S3/R2 adapters are never wired into a web upload path. Restrict `media_url`/`thumbnail_url` to the configured storage/CDN host(s), or add a signed-upload endpoint using the existing storage adapters and persist only keys you control, validating content-type/size at upload.

### 29: ZBX-29 — Redundant no-op UPDATE locks all expired moments before deletion (Low)
**FILES:** `apps/web/app/api/cron/daily/route.ts` (section 7)
**FIX:** Before deleting expired moments the CRON runs `UPDATE moments SET expires_at = expires_at WHERE expires_at < NOW()` whose result is unused, locking/writing every expired row for no effect before the DELETE. Remove the no-op UPDATE and report the deleted count from the DELETE's `RETURNING`/`rowCount`.

### 30: ZBX-30 — `ON CONFLICT` target without a matching constraint on `user_badges` (Low)
**FILES:** `apps/web/app/api/cron/daily/route.ts` (section 5b `season_top100_frame` insert), `apps/web/db/migrations/001_complete_schema.sql` (`user_badges`)
**FIX:** The badge insert uses `ON CONFLICT (user_id, badge_type, reference_id)`, but the only unique index is `(user_id, badge_key) WHERE badge_key IS NOT NULL`, so Postgres raises "no unique or exclusion constraint matching the ON CONFLICT specification." It's masked today only because 5b already fails earlier (ZBX-06). Standardize badge idempotency on `badge_key` (`ON CONFLICT (user_id, badge_key)`), or add a unique index on `(user_id, badge_type, reference_id)` if that's the intended key.

### 31: ZBX-31 — CAPTCHA verification fails open in production (Low)
**FILES:** `apps/web/lib/security/captcha.ts` (`verifyCaptcha`, `resolveProvider`)
**FIX:** Provider `"none"` — the default and the fallback when the manifest read throws — returns `true` (only a prod warning), so degrading the manifest lookup or a misconfig silently disables bot protection on signup/login. Treat "provider not configured" as a hard fail on protected endpoints in production (return `false`) and fail closed when the manifest read errors; also enforce a real reCAPTCHA score when `score` is undefined for v3.

### 32: ZBX-32 — Gifts/transfers ignore block relationships (Low)
**FILES:** `apps/web/app/api/economy/gifts/send/route.ts`, `apps/web/app/api/economy/coins/transfer/route.ts`
**FIX:** Neither flow checks whether the recipient has blocked the sender (or vice-versa), so a blocked user can still push gifts/coins plus an attached message/room event — a harassment vector that bypasses the block UX. Before debiting, check the block relationship both directions and reject with a 403 (`USER_BLOCKED`).

### 33: ZBX-33 — Google email auto-links to any existing same-email account (Low)
**FILES:** `apps/web/app/api/auth/google/callback/route.ts` (`upsertGoogleUser`)
**FIX:** With no `google_id` match, a verified Google email is linked to any non-deleted account sharing that email with no confirmation; if that account's email was set via a weakly-verified path, this enables edge-case linking/takeover. Require an explicit "link account" confirmation (or only auto-link when the existing account's email was itself verified). Also include `is_banned, is_suspended, deleted_at` in the new-user INSERT `RETURNING` (currently omitted, leaving them `undefined` on the returned row).

### 34: ZBX-34 — TOTP codes replayable within their window (Low)
**FILES:** `apps/web/app/api/auth/2fa/verify/route.ts` (legacy `sessionToken` path), `apps/web/app/api/admin/auth/totp/route.ts`
**FIX:** Verification accepts ±1 time-step with no record of the last-used counter, so a code is valid/reusable for ~90s. The login pre-auth path is protected by a single-use Redis token, but the legacy `sessionToken` and admin paths are not. Track the last accepted TOTP counter per user (e.g. `users.totp_last_counter` or a short Redis key) and reject any code whose step ≤ the last accepted step.

---

*End of report — 34 findings. Generated Saturday, June 13, 2026 at 12:36 AM (UTC) by independent forensic code review of Zobia Social. Every item cites concrete file locations and was cross-checked against the live schema; no findings were fabricated. Per instructions, do not begin fixes until this plan and the accompanying `custom-bugs-fix-plan.md` are reviewed.*
