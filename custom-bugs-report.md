# Zobia Social — Forensic Bug Report

**Generated:** 2026-06-21 02:10 AM  
**Scope:** Full codebase analysis — Next.js web app, PWA, Expo (Android) mobile app  
**Analyst:** Deep static analysis, no agents used

---

## Summary Index (One-Line Descriptions)

1. BUG-EXPO-01: Expo startup token refresh on network error clears entire session, logging out offline users
2. BUG-EXPO-02: Startup token refresh clears session on network fail but AppState foreground refresh does not — inconsistent behavior
3. BUG-EXPO-03: `AuthUser` interface too minimal — missing `plan`, `isAdmin`, `isModerator`, `isCreator` fields
4. BUG-PAY-01: `room_subscription` payments skip the Creator Fund 5% contribution on both Paystack and DodoPayments
5. BUG-PAY-02: `room_entry` payments (Paystack) skip the Creator Fund 5% contribution
6. BUG-PAY-03: DodoPayments `subscription` type falls through to Creator Fund seeding, but Paystack `subscription` returns early — inconsistent cross-provider Creator Fund behaviour
7. BUG-SSE-01: SSE room stream query omits `deleted_at IS NULL` — deleted rooms remain accessible via stream
8. BUG-SSE-02: SSE `lastMessageId` query param not validated as UUID — invalid value causes PostgreSQL type error (500)
9. BUG-SSE-03: Muted room members can subscribe to the SSE stream and receive all messages
10. BUG-RATE-01: Global IP rate limiter uses a fixed-window (INCR + EXPIRE) instead of sliding window — burst of up to 2× the limit is possible at window boundaries
11. BUG-IP-01: `getClientIp` unconditionally trusts the `x-real-ip` header — IP address spoofable on non-Vercel deployments
12. BUG-GAMES-01: `checkPlayMilestones` called after transaction commit without try/catch — throws 500 to client even though the play is already recorded
13. BUG-GAMES-02: No maximum play-session age check — stale sessions started days ago can still submit scores
14. BUG-GAMES-03: `prepareChallengeRoundPlay` does not verify the challenge's `expires_at` — expired-but-not-yet-cleaned-up challenges can still be played
15. BUG-SEASON-01: `claimPassMilestone` does not verify the season is currently active — milestone claims accepted after season end
16. BUG-ENC-01: `decryptField` returns `null` silently on GCM authentication tag failure — callers that skip the null check may serve empty/wrong KYC data
17. BUG-SESSION-01: `invalidateAllSessions` spreads an unbounded session-key array into `redis.del()` — argument count can exceed limits for power users
18. BUG-SCHEMA-01: The `sessions` DB table is defined in the schema but never used — Redis is the sole session store
19. BUG-SCHEMA-02: Two overlapping quest-tracking tables (`user_quests` and `user_quest_progress`) risk data inconsistency
20. BUG-2FA-01: 2FA verify route doc comment references a legacy `sessionToken` path that no longer exists in the handler
21. BUG-CHALLENGE-01: Challenge-cancel notification copy does not mention the coin forfeiture penalty — challenger is unaware of economic consequences
22. BUG-SANITIZE-01: `sanitizeAnnouncementContent` returns raw unsanitized content for any `contentType` other than `'html'` or `'markdown'`
23. BUG-REFERRAL-01: No self-referral guard for tier-1 commissions — if `referred_by` equals `userId` in the database, a user earns commissions on their own purchases

---

## Detailed Bug Entries

---

### 1. BUG-EXPO-01 — Startup token refresh clears session on network error (logs out offline users)

**FILES:** `apps/expo/lib/auth/context.tsx` lines 139–164

**Description:**  
When the app starts and the stored access token is expired or expiring within 60 seconds, it attempts a silent refresh. The `catch` block on that refresh call (lines 159–165) calls `SecureStore.deleteItemAsync` on the JWT, refresh token, and user object, then returns without setting any state. This means a user who is offline, or whose network is temporarily flaky at startup, is completely logged out and loses their session even though their refresh token may still be valid. The foreground AppState refresh code (lines 218–242) has the same catch block but is a silent no-op (no credential deletion) — the two paths are therefore inconsistent.

**FIX:** In the startup catch block, do not delete stored credentials on a network failure. Instead, if the stored refresh token exists and the access token fetch failed due to a network error (distinguish via `error instanceof TypeError` or `!resp.ok`), retain the stored credentials and allow the user to proceed with the potentially-stale access token (API calls will naturally return 401 and trigger re-login at that point). Only delete credentials when the server explicitly rejects the refresh token (e.g. HTTP 401 from `/api/auth/refresh`), not on network-level failures.

---

### 2. BUG-EXPO-02 — Inconsistent session-clearing on network failure (startup vs foreground)

**FILES:** `apps/expo/lib/auth/context.tsx` lines 139–243

**Description:**  
The startup token refresh (in the mount-time `useEffect`) deletes all SecureStore credentials when a network error occurs. The foreground AppState refresh (AppState `'change'` listener) catches the same error with a no-op `// Network failure on foreground — leave existing token`. This is the correct behaviour, but it is only applied in one place. The two code paths must be made consistent. The inconsistency means a user who launches the app offline is logged out, but a user who resumes the app from background is not — an irrational UX distinction.

**FIX:** Unify both refresh paths into a shared `silentRefresh()` function that never deletes credentials on a network error, only on a server-side 401 rejection. Apply it in both the startup effect and the AppState listener.

---

### 3. BUG-EXPO-03 — `AuthUser` interface missing critical fields

**FILES:** `apps/expo/lib/auth/context.tsx` lines 63–70

**Description:**  
`AuthUser` only contains `{ id, username, avatarEmoji, city, xp, rankTier }`. Fields like `plan` (free/plus/pro/max), `isAdmin`, `isModerator`, `isCreator`, and `onboardingCompleted` are absent. Any screen that needs to conditionally render premium features, admin controls, or creator tools must either make an extra API call (`/api/auth/me`) or infer the data from the JWT payload — which circumvents the single authoritative user object. The 2FA verify route already has the correct shape in its response body (lines 157–165 of the route), it just isn't reflected in the type.

**FIX:** Extend the `AuthUser` interface to include `plan`, `isAdmin`, `isModerator`, `isCreator`, and `onboardingCompleted`. Update `signIn` to accept and persist these fields. Update all API responses that return user objects to include the full shape.

---

### 4. BUG-PAY-01 — `room_subscription` payments do not seed the Creator Fund

**FILES:**  
- `apps/web/lib/payments/paystackWebhookHandler.ts` lines 115–181 (Paystack)  
- `apps/web/lib/payments/dodoWebhookHandler.ts` lines 206–276 (DodoPayments)

**Description:**  
The Creator Fund contribution (PRD §14: 5% of gross revenue) is written at the very end of `processChargeSuccess` / `processPaymentSucceeded`, after all `if/else` branches. Both the Paystack and DodoPayments handlers for `room_subscription` end with an explicit `return` before reaching the Creator Fund code. This means every room subscription payment — a payment that represents platform-mediated creator revenue — bypasses the Creator Fund entirely. Over time this creates a significant funding gap versus the PRD-defined 5% baseline.

**FIX:** Remove the early `return` from the `room_subscription` branch in both handlers, OR move the Creator Fund seeding to before the branch's `return` statement. The Creator Fund increment must run for room subscriptions exactly as it does for coin packs.

---

### 5. BUG-PAY-02 — `room_entry` payments (Paystack) do not seed the Creator Fund

**FILES:** `apps/web/lib/payments/paystackWebhookHandler.ts` lines 185–187

**Description:**  
The `room_entry` item type (paid entry to a drop room) reaches an early `return` on line 187 with the comment "no coin credit needed". While coin crediting is rightly skipped, the Creator Fund contribution (5% of gross, lines 307–318) is also skipped. Entry fees are gross revenue and should follow the same 5% rule as coin packs.

**FIX:** Before the `return` on line 187, add the Creator Fund seeding logic (same block as lines 307–318), or lift it to execute before all `itemType` branching.

---

### 6. BUG-PAY-03 — DodoPayments `subscription` type inconsistently seeds Creator Fund; Paystack does not

**FILES:**  
- `apps/web/lib/payments/paystackWebhookHandler.ts` line 110–112 (returns early for `subscription`)  
- `apps/web/lib/payments/dodoWebhookHandler.ts` lines 279–359 (`subscription` falls through to Creator Fund)

**Description:**  
In `paystackWebhookHandler.ts`, `itemType === "subscription"` returns early (line 112) before reaching Creator Fund seeding — plan subscription revenue does not seed the fund. In `dodoWebhookHandler.ts`, the `subscription` branch handles plan activation and bonus coins but does NOT return early, so it falls through to Creator Fund seeding on the same payment amount. This means identical plan subscriptions purchased via Paystack vs DodoPayments have different Creator Fund impacts. This is almost certainly unintentional.

**FIX:** Decide the canonical policy (plan subscriptions seed Creator Fund or they don't) and apply it consistently in both handlers. Given the Paystack handler was written first and explicitly returns early, the intent is likely that plan subscriptions do NOT seed the Creator Fund. Add `return;` after the subscription bonus coins credit in `dodoWebhookHandler.ts`.

---

### 7. BUG-SSE-01 — SSE stream room query missing `deleted_at IS NULL`

**FILES:** `apps/web/app/api/rooms/[roomId]/stream/route.ts` lines 217–228

**Description:**  
The room existence check query is `SELECT type, creator_id, is_active FROM rooms WHERE id = $1`. It does not include `AND deleted_at IS NULL`. Soft-deleted rooms remain accessible to their members via the SSE stream, allowing deleted rooms to deliver message history.

**FIX:** Add `AND deleted_at IS NULL` to the room query. Additionally check `AND is_active = TRUE` explicitly (the current code checks `!room.is_active` after the query, but baking it into the WHERE clause is cleaner and more efficient).

---

### 8. BUG-SSE-02 — SSE `lastMessageId` not validated as UUID — causes PostgreSQL 500

**FILES:** `apps/web/app/api/rooms/[roomId]/stream/route.ts` lines 250–263

**Description:**  
`lastMessageId` is taken directly from the query string and passed as `$1` in a parameterized query against the `room_messages.id UUID` column: `WHERE id = $1 AND room_id = $2`. PostgreSQL will throw an `invalid_text_representation` error (code 22P02) if `$1` is not a valid UUID string. The try/catch around the SSE stream body logs the error but still exposes a 500 to the client.

**FIX:** Validate `lastMessageId` as a UUID before querying: `const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i; if (lastMessageId && !UUID_RE.test(lastMessageId)) return new Response("Invalid lastMessageId", { status: 400 });`

---

### 9. BUG-SSE-03 — Muted room members can subscribe to SSE stream and receive messages

**FILES:** `apps/web/app/api/rooms/[roomId]/stream/route.ts` lines 233–246

**Description:**  
The membership check only verifies `role` from `room_members` (any non-null role passes). It does not check if the user has been muted (e.g. a `muted_until` column or `is_muted` flag). A muted user is silently prevented from sending messages but can still connect to the SSE stream and receive all room content indefinitely.

**FIX:** Add a muted-user check alongside the membership query. Whether muted users should be fully denied from reading (full ban) or just from writing (standard mute) should be a product decision, but the current implementation enforces neither consistently. At minimum, document the intended behaviour clearly in the route comment.

---

### 10. BUG-RATE-01 — Global IP rate limiter uses fixed-window, not sliding window

**FILES:** `apps/web/lib/security/rateLimit.ts` (global rate limit implementation, Lua script)

**Description:**  
The rate limit for individual endpoints uses a sliding-window sorted-set Lua script (correct). However, the global/IP-level rate limiter uses `INCR + EXPIRE if count == 1` — a classic fixed-window approach. This allows a burst of up to 2× the configured limit: a client can make `limit` requests at the end of one window, then `limit` requests immediately at the start of the next window. For a 1-minute window of 100 requests, 200 requests in ~2 seconds is possible.

**FIX:** Replace the `INCR + EXPIRE if == 1` Lua script for the global rate limiter with the same sorted-set sliding-window Lua script already used for per-endpoint limits, using `ZREMRANGEBYSCORE + ZADD + ZCARD + PEXPIRE` with a timestamp-based member. Alternatively, use the existing `enforceRateLimit` function with a dedicated `globalIp` limit config.

---

### 11. BUG-IP-01 — `getClientIp` trusts `x-real-ip` without proxy trust verification

**FILES:** `apps/web/lib/security/rateLimit.ts` (`getClientIp` function)

**Description:**  
`getClientIp` reads `x-real-ip` as the first choice for the client IP. This header is set by reverse proxies (Nginx, Vercel edge) but can also be trivially spoofed by clients that connect directly to the Node process (e.g. during local dev, staging, or any non-Vercel deployment). A malicious client can set `x-real-ip: 1.2.3.4` to bypass IP-based rate limiting by rotating through arbitrary IP strings.

**FIX:** For production, restrict `x-real-ip` trust to a known set of proxy CIDR ranges, or rely exclusively on `x-forwarded-for` with a configured trusted-proxy count (`TRUSTED_PROXY_COUNT` env var). On Vercel, `x-vercel-forwarded-for` is tamper-proof. Add a `NODE_ENV === 'production'` guard that falls back to `req.ip` (the connection-level IP) when no trusted proxy header is present.

---

### 12. BUG-GAMES-01 — `checkPlayMilestones` throws 500 after play is already recorded

**FILES:** `apps/web/lib/games/sessions.ts` line 207

**Description:**  
`await checkPlayMilestones(userId)` is called after the main `db.transaction()` block commits. If `checkPlayMilestones` throws (DB error, XP engine failure, etc.), the entire `finalizeScore` function propagates the error to the route handler, which returns a 500. The client retrying the `/score` endpoint then hits "This play session has already been scored" (the nonce is consumed). The user's play was counted and their score recorded, but they see a permanent error and cannot retrieve their reward or confirm the result.

**FIX:** Wrap `checkPlayMilestones` in a try/catch:  
`await checkPlayMilestones(userId).catch((err) => logger.error({ err, userId }, '[games] checkPlayMilestones failed'));`  
This matches the pattern already used for `recordChallengeRoundPlay` on line 211.

---

### 13. BUG-GAMES-02 — No maximum play-session age check

**FILES:** `apps/web/lib/games/sessions.ts` lines 142–148

**Description:**  
`finalizeScore` enforces a minimum elapsed time (`game.min_play_seconds`) but no maximum. A player can start a play session, wait any amount of time, and submit a score days later. This enables score farming against older configurations (e.g. if reward amounts decreased, hoard old sessions and use them after the change). It also undermines daily/weekly limits: hoard sessions from before a limit reset and submit them after.

**FIX:** Add a maximum session age check. After reading `play.started_at`, compute elapsed time and reject if it exceeds a threshold (e.g. `MAX_PLAY_SESSION_AGE_SECONDS = 3600` or a game-configurable value): `if (elapsedSec > MAX_PLAY_SESSION_AGE_SECONDS) throw badRequest("Play session has expired.");`

---

### 14. BUG-GAMES-03 — `prepareChallengeRoundPlay` does not check challenge `expires_at`

**FILES:** `apps/web/lib/games/challenges.ts` lines 172–189

**Description:**  
`prepareChallengeRoundPlay` fetches a challenge via `getChallengeRow` which only checks `status = 'active'`. It does not verify `expires_at > NOW()`. If the challenge has expired but the CRON sweep hasn't run yet, a player can still play rounds, submit scores, and trigger series settlement. The expired challenge's escrow may then be paid out as a win prize rather than refunded.

**FIX:** Add an expiry check in `prepareChallengeRoundPlay`: `if (new Date(c.expiresAt) < new Date()) throw conflict("This challenge has expired.");` Also add `AND expires_at > NOW()` to the `lockChallenge` query in `expireChallenges` to prevent a concurrent cron from evicting a row being settled.

---

### 15. BUG-SEASON-01 — `claimPassMilestone` does not verify the season is active

**FILES:** `apps/web/lib/seasons/seasonEngine.ts` (`claimPassMilestone` function)

**Description:**  
`claimPassMilestone` validates that the milestone exists and hasn't been claimed, but does not check whether the associated season is still active (`ended_at > NOW()`, `status = 'active'`). Players can claim season-pass milestone rewards after a season has ended, inflating their coin/XP balances with post-season rewards.

**FIX:** Add a season status check at the start of `claimPassMilestone`: query the season's `ended_at` and `status`, and throw `forbidden("This season has ended. Milestone claims are closed.")` if the season is no longer active.

---

### 16. BUG-ENC-01 — `decryptField` silently returns `null` on GCM authentication tag failure

**FILES:** `apps/web/lib/security/fieldEncryption.ts` lines 65–83, `decryptRaw` lines 104–118

**Description:**  
When AES-256-GCM decryption fails due to an authentication tag mismatch (indicating tampered ciphertext), `decryptRaw` catches the error and returns `null`. `decryptField` propagates `null` to callers. Most callers do not check for `null` (they assume decryption always succeeds for valid DB rows), so tampered KYC fields are silently served as empty strings or cause null-reference errors deeper in the stack. The existing `BUG-ENC-01` comment notes that missing env vars are re-thrown — but tampered data (equally serious) is silently swallowed.

**FIX:** Add a distinct error type for authentication tag failures and re-throw them the same way missing-env-var errors are re-thrown. Callers that handle expected "no data" should use a separate `decryptFieldSafe()` wrapper that explicitly documents the null return. Alternatively, log an anomaly alert to `system_alerts` when a GCM tag failure occurs, since it signals possible data tampering.

---

### 17. BUG-SESSION-01 — `invalidateAllSessions` spreads unbounded key array into `redis.del()`

**FILES:** `apps/web/lib/auth/session.ts` (`invalidateAllSessions` function)

**Description:**  
`invalidateAllSessions` fetches all session IDs for a user and calls `redis.del(...sids.map(sessionKey))`. The JavaScript spread operator passes each key as a separate argument. For a power user with hundreds of sessions (no hard cap exists on the set size), this can exceed Node.js argument stack limits (`Maximum call stack size exceeded`). Ioredis itself passes these as varargs to a TCP write, which may fragment or error at high counts.

**FIX:** Use a Redis pipeline instead of varargs `del`. Iterate over `sids` and call `pipeline.del(sessionKey(sid))` for each, then `pipeline.exec()`. This mirrors the pattern already used in `createSession`'s eviction block (line 185–193).

---

### 18. BUG-SCHEMA-01 — `sessions` DB table is defined but never used

**FILES:** `apps/web/lib/db/schema.ts` (the `sessions` table)

**Description:**  
The Drizzle schema defines a `sessions` table with `id`, `userId`, `refreshTokenHash`, `createdAt`, `expiresAt`, and other session fields. Session management is entirely Redis-based (see `lib/auth/session.ts`). No application code writes to or reads from this DB table. Its presence creates confusion about the source of truth for active sessions and may mislead future developers into dual-writing or querying the wrong store.

**FIX:** If the table was created by an early migration and is now superceded by Redis, create a migration to drop it and remove its Drizzle schema definition. If it was intended for audit-log purposes (e.g. historical record of all sessions), document that explicitly and add a write path to populate it.

---

### 19. BUG-SCHEMA-02 — Two overlapping quest-tracking tables risk dual-write data inconsistency

**FILES:** `apps/web/lib/db/schema.ts` (`user_quests` and `user_quest_progress` tables)

**Description:**  
`user_quests` stores the entire daily deck assignment with progress as JSONB arrays (`quest_ids`, `completed_ids`, `claimed_ids`). `user_quest_progress` stores individual quest progress rows with `quest_deck_id`, `quest_id`, `progress`, `is_completed`. These are structurally parallel representations of the same data. If both tables are actively written to, a write to one that fails to write to the other leaves them inconsistent. If only one is used, the other is dead schema accumulating space and migration risk.

**FIX:** Audit all query sites in `lib/quests/questEngine.ts` and related cron jobs to determine which table is actually used. Deprecate and migrate data out of the unused one. If both are live, introduce an explicit transaction that writes atomically to both, and add a CHECK constraint or trigger to enforce consistency.

---

### 20. BUG-2FA-01 — 2FA verify route documentation references removed legacy `sessionToken` path

**FILES:** `apps/web/app/api/auth/2fa/verify/route.ts` lines 9–16

**Description:**  
The route's JSDoc comment says it "Accepts either: a) { code, preAuthToken } — pre-auth flow or b) { code, sessionToken } — legacy". The Zod schema only validates `{ code, preAuthToken }`. The legacy `sessionToken` path has been completely removed from the handler. Any client or integrator reading the comment and sending `{ code, sessionToken }` will receive a Zod validation error with no indication that the API changed.

**FIX:** Remove the legacy `b)` bullet from the JSDoc. If the legacy path is still needed for a native client, re-add it properly. Otherwise clean up the comment to accurately describe only the pre-auth flow.

---

### 21. BUG-CHALLENGE-01 — Challenge cancellation notification omits coin forfeiture amount

**FILES:** `apps/web/lib/games/challenges.ts` lines 425–466, 468–476

**Description:**  
When a challenger cancels an active challenge, `cancelEscrow` may forfeit a fraction of their stake proportional to their round-win deficit (e.g. forfeit 100% if they are losing all decisive rounds). The notification copy sent to both parties is: "The challenge has been cancelled." There is no mention of the forfeiture amount or the coin redistribution to the opponent. The challenger may be surprised to find their balance lower than expected.

**FIX:** Include the computed `challForfeitCoins` and `challRefund` amounts in the notification metadata for the challenger, and the `oppRefund` amount for the opponent. Update the notification copy to say something like "Challenge cancelled. You forfeited N coins due to active round results." Reference the challenge ID so users can audit.

---

### 22. BUG-SANITIZE-01 — `sanitizeAnnouncementContent` returns raw unsanitized content for unknown content types

**FILES:** `apps/web/lib/security/htmlSanitizer.ts` lines 42–57

**Description:**  
```ts
export function sanitizeAnnouncementContent(content: string, contentType: string): string {
  if (contentType === 'html') { return sanitizeHtml(content); }
  if (contentType === 'markdown') { /* ... */ return sanitizeHtml(patched); }
  return content; // ← raw, unsanitized
}
```
Any `contentType` value other than `'html'` or `'markdown'` passes through with zero sanitization. If a new content type is added to the API without updating this function, or if the DB/admin panel allows setting an arbitrary type, XSS is possible. Even for `'text'` or `'plain'` announcements, raw HTML tags in the content field would be passed to the client.

**FIX:** Change the final `return content` to an explicit deny: throw an error for unknown content types, or at minimum run the content through `sanitizeHtml` with an empty `allowedTags: []` config to strip all HTML. Log a warning when an unexpected `contentType` is encountered.

---

### 23. BUG-REFERRAL-01 — No self-referral guard for tier-1 commissions

**FILES:** `apps/web/lib/referrals/commissions.ts` lines 77–149

**Description:**  
When awarding tier-1 referral commissions, the code checks tier-2 against the buyer and tier-1 (`if (!tier2Id || tier2Id === buyerId || tier2Id === tier1Id) return result`), but does not check `tier1Id === buyerId`. If database integrity somehow permits `users.referred_by = users.id` (self-referral), the buyer would earn tier-1 commissions on their own purchases indefinitely. This is a defensive gap — the DB should enforce it via a CHECK constraint but does not appear to.

**FIX:** Add `if (!tier1Id || tier1Id === buyerId) return result;` before tier-1 commission processing. Also add a DB-level CHECK constraint: `CHECK (referred_by != id)` on `users.referred_by`.

---

## Code Quality Assessment

### Current Ratings (before fixes)

| Dimension | Rating | Notes |
|-----------|--------|-------|
| **Security** | 7.5 / 10 | Strong: SSRF protection, CSRF headers, CSP nonce+strict-dynamic, JWT kid rotation, GCM encryption, TOTP anti-replay, rate limiting. Weak: fixed-window global limiter, untrusted `x-real-ip`, GCM failures silently swallowed. |
| **Data Integrity** | 7 / 10 | Good: coin ledger is append-only with SELECT FOR UPDATE, Decimal.js arithmetic, idempotency via partial unique indexes. Weak: Creator Fund gaps in 3 payment paths, dual quest tables, unused sessions table. |
| **Reliability** | 7 / 10 | Good: Redis circuit breaker on AI, retry/dead-letter queue on payouts, transactional integrity on wagers. Weak: `checkPlayMilestones` 500 after committed play, offline-logout on network error. |
| **Code Quality** | 8 / 10 | Solid patterns: Zod validation, typed DB queries, schema-derived column checks. Weak: stale docs, inconsistent cross-provider payment handling, missing UUID validation in SSE. |
| **Overall** | **7.5 / 10** | A well-architected production codebase with good security fundamentals, let down by a cluster of medium-severity bugs in payment accounting, auth edge cases, and game session integrity. |

### Post-Fix Ratings (after applying all recommendations)

| Dimension | Rating | Notes |
|-----------|--------|-------|
| **Security** | 9 / 10 | All identified IP-spoofing, rate-limit bypass, and data-tamper gaps closed. |
| **Data Integrity** | 9 / 10 | Creator Fund seeded consistently across all payment types. Quest schema unified. Session schema cleaned up. |
| **Reliability** | 9 / 10 | Offline sessions preserved. Post-commit errors non-fatal. Challenge expiry enforced. |
| **Code Quality** | 9 / 10 | Consistent error handling, accurate docs, complete type definitions. |
| **Overall** | **9 / 10** | Suitable for high-growth production with confidence. |

---

*Report generated: 2026-06-21 02:10 AM*  
*Files analyzed: middleware.ts, lib/auth/session.ts, lib/auth/jwt.ts, lib/api/middleware.ts, lib/economy/coins.ts, lib/payments/payouts.ts, lib/payments/paystackWebhookHandler.ts, lib/payments/dodoWebhookHandler.ts, lib/db/schema.ts (full), lib/xp/engine.ts, lib/security/rateLimit.ts, lib/security/fieldEncryption.ts, lib/security/htmlSanitizer.ts, lib/security/ssrf.ts, lib/security/captcha.ts, lib/security/geoAnomaly.ts, lib/games/sessions.ts, lib/games/challenges.ts, lib/games/wager.ts, lib/guilds/warEngine.ts, lib/quests/questEngine.ts, lib/seasons/seasonEngine.ts, lib/realtime/index.ts, lib/referrals/commissions.ts, lib/notifications/push.ts, lib/trust/trustScore.ts, lib/moderation/aiClassifier.ts, lib/moderation/contentFilter.ts, app/api/rooms/[roomId]/stream/route.ts, app/api/auth/refresh/route.ts, app/api/auth/silent-refresh/route.ts, app/api/auth/logout/route.ts, app/api/auth/2fa/verify/route.ts, app/api/economy/webhooks/paystack/route.ts, app/api/economy/webhooks/dodopayments/route.ts, apps/expo/lib/auth/context.tsx, apps/expo/app/auth/login.tsx*
