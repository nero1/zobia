# Zobia Codebase — Forensic Bug Report

**Generated:** June 20, 2026 · 10:45 AM
**Analyst:** Independent forensic analysis — manual review of 80+ files, no automated scanners, no sub-agents
**Scope:** `apps/web` (Next.js 14 App Router, PWA), `apps/expo` (React Native / Expo Android)
**Status:** PENDING USER REVIEW — NO CODE HAS BEEN MODIFIED

---

## Bug Quick-Reference (one line each)

1: BUG-PLAY-01: Google Play IAP consumable coin purchases never consumed — `finishTransactionAsync(purchase, false)` for ALL types, should be `!isSubscription`.
2: BUG-COIN-01: Paystack payment initialised before the DB record is inserted — orphan provider payment on any DB failure after the call.
3: BUG-XP-01: `safeAwardXP` calls `upsertLeaderboardSnapshot(globalDb)` outside the caller's transaction — leaderboard drifts if the outer transaction rolls back.
4: BUG-LB-01: `upsertLeaderboardSnapshot` ON CONFLICT expression targets may not match the actual DB index — runtime error on every XP award.
5: BUG-AUTH-01: Expo JWT decode uses `atob()` without base64url character substitution — JWTs with `-` or `_` in the payload are misread or throw.
6: BUG-AUTH-02: `AuthUser.rankTier` enum values (`"bronze"/"silver"`) do not match server rank names (`"Beginner"/"Rookie"`); Google OAuth callback hardcodes `rankTier: "bronze"` for all mobile users.
7: BUG-GAME-01: Challenge cancellation refunds full escrow regardless of rounds played — exploitable by forfeiting after winning most rounds.
8: BUG-GIFT-01: Gift-send Redis idempotency key is written before the DB transaction commits — a rollback permanently poisons that idempotency slot.
9: BUG-LOCK-01: `distributeCreatorFund` uses a session-level PostgreSQL advisory lock with connection pooling — lock may be acquired on connection A and released (or fail to release) on connection B, risking double payout.
10: BUG-PAY-01: Paystack `subscription.not_renew` event sends a `subscription_cancelled` notification instead of `subscription_ending` — misleads users whose plan ends at period close vs. being immediately cancelled.
11: BUG-MOB-01: Expo SQLite migration catch-all error handler silently swallows ALL failures, leaving the local database in a partially migrated state with no visible error.
12: BUG-SEASON-01: `distributeSeasonRewards` uses `Math.floor()` on every user's coin share with no remainder redistribution — coins are silently discarded into rounding.
13: BUG-SPAM-01: `filterDMContent`/`filterPublicContent` returns an empty string when the entire message is a URL — callers that do not guard for this persist or display a blank message.
14: BUG-LB-02: Leaderboard `getLeaderboard` ORDER BY has no tiebreaker — pagination produces duplicates or gaps for users with equal XP values.
15: BUG-NOTIF-01: `challenges.ts` notification INSERTs do not include `title` or `body` fields — challenge notification rows are persisted with null display content.
16: BUG-TRUST-01: `meetsMinimumTrust` reads the cached `users.trust_score` column without recomputing — recent bans or warnings are not reflected until the next explicit recalculation.
17: BUG-WAR-01: `recordWarContribution` active-war status check runs outside the write transaction — war can be resolved between the check and the contribution upsert (TOCTOU).
18: BUG-SPAM-02: Antispam `URL_REGEX` does not match Punycode/IDN domains (`xn--` prefix) — trivially bypassed by encoding a domain in Punycode.

---

## Detailed Analysis

---

### 1: BUG-PLAY-01 — Google Play IAP consumable coin purchases never consumed

**FILES:** `apps/expo/lib/payments/googlePlay.ts`

`setupGlobalPurchaseListener` calls `await InAppPurchases.finishTransactionAsync(purchase, false)` for every purchase unconditionally. The second argument is `consume` — it must be `true` for consumable products (coin packs) so Google Play marks the purchase as consumed and allows re-purchase of the same SKU. With `false`, the purchase is only acknowledged, not consumed. Google Play auto-voids acknowledged-but-unconsumed in-app products after 3 days and blocks re-purchase of the same SKU in the meantime. The variable `isSubscription` is correctly computed in the same function but is never used for the consume argument.

**FIX:** Change the call to `finishTransactionAsync(purchase, !isSubscription)`. Subscriptions pass `false` (do not consume); consumable coin packs pass `true`.

---

### 2: BUG-COIN-01 — Paystack payment initialised before the DB record is created

**FILES:** `apps/web/app/api/economy/coins/purchase/route.ts`

Step 5 calls `initializePayment` (Paystack API) to create the provider session, then Step 6 inserts the local payment record. If the DB INSERT at Step 6 fails (connection error, constraint violation), a real Paystack payment session exists with no corresponding local record. The user is redirected to Paystack, may complete payment, and the webhook handler will find no matching payment row — silently dropping the credit.

**FIX:** Insert the DB record first (in a `pending` state with a locally generated reference ID), then call Paystack with that reference ID. On Paystack failure, mark the local record as `failed` — the user never gets a redirect. This ensures a local record always pre-exists before any provider state is created.

---

### 3: BUG-XP-01 — safeAwardXP leaderboard snapshot update runs outside the caller's transaction

**FILES:** `apps/web/lib/xp/safeAwardXP.ts`

After a successful XP INSERT + users UPDATE (which correctly runs inside the caller's transaction when one is passed), `safeAwardXP` calls `upsertLeaderboardSnapshot(userId, …, globalDb)` — explicitly using the global DB pool, not the transaction client. If the caller's transaction is later rolled back, the XP credit is rolled back but the leaderboard snapshot update has already committed on `globalDb`. The leaderboard shows XP the user does not actually have.

**FIX:** Pass the `client` (same connection used for the XP award) to `upsertLeaderboardSnapshot` instead of `globalDb`. Since `upsertLeaderboardSnapshot` accepts a `DatabaseAdapter`, this is a one-argument change. The snapshot will then roll back together with the XP award if the outer transaction fails.

---

### 4: BUG-LB-01 — upsertLeaderboardSnapshot ON CONFLICT expression may not match the actual DB index

**FILES:** `apps/web/lib/leaderboards/engine.ts`

The upsert uses `ON CONFLICT (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))`. PostgreSQL ON CONFLICT requires the conflict target to exactly match an existing index definition. If the actual DB index is a standard column-based UNIQUE constraint on `(user_id, track, scope, city, season_id)` (with NULLs distinct), the COALESCE expression target will not match and the upsert will throw `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification` on every single XP award.

**FIX:** Check the actual index definition with `\d leaderboard_snapshots` in psql. If the index is column-based, replace the COALESCE expression targets with a named constraint reference (`ON CONFLICT ON CONSTRAINT leaderboard_snapshots_unique_idx`) or create an expression index that exactly matches the COALESCE syntax. Align the migration, index definition, and upsert clause so all three agree.

---

### 5: BUG-AUTH-01 — Expo JWT decode uses atob() without base64url character substitution

**FILES:** `apps/expo/lib/auth/context.tsx`

The JWT payload decode uses `atob(payload)` on the raw base64url-encoded JWT segment. The JWT standard (RFC 7515/7519) uses base64url encoding which replaces `+` with `-`, `/` with `_`, and omits `=` padding. `atob()` expects standard base64 — it will throw or silently misparse any JWT whose payload segment contains `-` or `_` characters (common in UUIDs and large numeric claims encoded into the payload).

**FIX:** Before calling `atob()`, apply: `payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(payload.length + (4 - payload.length % 4) % 4, '=')`. Or use the `jose` library's built-in decode utilities (already a dependency on the web side) which handle this correctly.

---

### 6: BUG-AUTH-02 — AuthUser.rankTier enum mismatches server rank names; OAuth callback hardcodes "bronze"

**FILES:** `apps/expo/lib/auth/context.tsx`, `apps/web/app/api/auth/google/callback/route.ts`

The Expo `AuthUser` type defines `rankTier` with values like `"bronze"`, `"silver"`, `"gold"`. The server rank system (confirmed in `lib/db/schema.ts` and `lib/xp/engine.ts`) uses `"Beginner"`, `"Rookie"`, `"Rising Star"`, etc. All mobile UI that branches on `rankTier` compares against values that the server never sends — rank-gated features and rank display on mobile are permanently broken. Additionally, the Google OAuth callback hardcodes `rankTier: "bronze"` in the mobile pre-auth payload for all users regardless of their actual rank, so every mobile sign-in receives rank "bronze" in the decoded auth object.

**FIX:** (1) Update the `AuthUser` type's `rankTier` enum values to match the server's actual rank name strings from `lib/xp/engine.ts`. (2) In the Google OAuth callback, replace the hardcoded `rankTier: "bronze"` with the user's actual `rank_name` from the DB (query `users.rank_name` during the OAuth upsert and include it in the pre-auth code payload).

---

### 7: BUG-GAME-01 — Challenge cancellation refunds full escrow regardless of rounds played

**FILES:** `apps/web/lib/games/challenges.ts`

When a challenge is cancelled (timeout, forfeit, or explicit cancel), the code refunds the full escrowed amount to both players regardless of how many rounds have been completed. A player who is losing after several rounds can cancel to recover their full stake — a monetarily exploitable escape hatch. Rounds-played count and per-round outcome are tracked in the DB but are not consulted during cancellation.

**FIX:** Add a partial-payout path: if at least one round has been completed, award escrowed coins proportionally based on rounds-won ratio, rather than a full refund to both parties. Alternatively, forfeit the cancelling player's stake entirely (simpler, harder to exploit). The policy decision is the product owner's, but the current full-refund-always behaviour is clearly exploitable.

---

### 8: BUG-GIFT-01 — Gift-send Redis idempotency key written before DB transaction commits

**FILES:** `apps/web/app/api/economy/gifts/send/route.ts`

The handler writes the Redis idempotency key (`gift:${senderId}:${idempotencyKey}`) before the DB transaction containing the coin debit and credit commits. If the subsequent DB commit fails, the Redis key is already set and the transaction cannot be retried — the idempotency slot is permanently poisoned. The user's coins are not deducted (DB rolled back) but they also cannot re-attempt the gift with the same key.

**FIX:** Move the Redis key write to AFTER the DB transaction successfully commits. The safe pattern: (1) check key exists → return cached response; (2) execute and commit DB transaction; (3) write Redis key with the successful response body. A Redis TTL slightly shorter than the client retry timeout covers the small commit-to-Redis window.

---

### 9: BUG-LOCK-01 — distributeCreatorFund advisory lock not safe with connection pooling

**FILES:** `apps/web/lib/creator/fund.ts`

`distributeCreatorFund` acquires a PostgreSQL session-level advisory lock via `pg_try_advisory_lock` and releases it in a `finally` block via `pg_advisory_unlock`. With a connection pool, the lock is acquired on whichever pool connection handles the initial `query()`, but subsequent queries — including the `finally` unlock — may execute on a different connection/session. `pg_advisory_unlock` on the wrong session is a no-op. The lock may stay held indefinitely (blocking all future CRON runs until the holding connection is recycled) or release on the wrong session (allowing a concurrent CRON to also acquire and run a double payout).

**FIX:** Replace the session-level advisory lock pair with `pg_try_advisory_xact_lock`, which is automatically released when the transaction ends regardless of which pool connection handles the unlock. Wrap the entire distribution in a single `db.transaction()` call and acquire the transaction-level lock as the first statement inside that transaction.

---

### 10: BUG-PAY-01 — Paystack subscription.not_renew sends incorrect notification type

**FILES:** `apps/web/lib/payments/paystackWebhookHandler.ts`

The `subscription.not_renew` event (the plan will end at the current billing period, not auto-renew) inserts a notification with `type = 'subscription_cancelled'`. This is factually wrong: the user's subscription is NOT cancelled yet — it remains active until the end of the billing period. The mobile UI that branches on notification type will show "Your subscription has been cancelled" instead of "Your subscription will not renew at period end", causing user alarm and unnecessary support contacts.

**FIX:** Change the notification `type` in the `subscription.not_renew` branch from `'subscription_cancelled'` to `'subscription_ending'` (or whichever type the push/in-app renderer uses for the "ending at period close" state). Ensure the corresponding notification template on mobile handles this type correctly.

---

### 11: BUG-MOB-01 — Expo SQLite migration catch-all silently swallows schema failures

**FILES:** `apps/expo/lib/offline/sqlite.ts`

The SQLite migration runner wraps each migration step in a `try/catch` that logs a `console.warn` and continues to the next migration. If a `CREATE TABLE` or `ALTER TABLE` fails (table already exists with an incompatible schema, disk full, corruption), the migration is marked complete and the loop continues. Subsequent migrations that depend on the failed one will also fail silently. The app proceeds to operate on a partially migrated database with no visible indication that anything is wrong — offline data may be silently discarded or cause crashes far from the actual failure point.

**FIX:** Change the catch block to re-throw for structural migration failures. Only swallow genuinely idempotent errors (e.g., `error.message.includes('already exists')`) as a narrow guard. Bubble real failures up to the app init path so the user sees a clear "database error, please reinstall" message rather than silent data loss.

---

### 12: BUG-SEASON-01 — Season reward distribution uses Math.floor() with no remainder redistribution

**FILES:** `apps/web/lib/seasons/seasonEngine.ts`

`distributeSeasonRewards` applies `Math.floor()` to each user's computed coin share. For 100 users and a prize pool of 997 coins, up to 99 coins are silently discarded (fractional part per user × user count). These coins are neither recorded as unspent nor redistributed — they vanish.

**FIX:** Compute total actually distributed (sum of all floored amounts) then add the remainder (`pool − distributed`) to the top-ranked user's award. This is the standard "largest remainder" method and accounts for every coin in the pool. At minimum, log the discarded amount as an accounting entry.

---

### 13: BUG-SPAM-01 — filterDMContent/filterPublicContent can return an empty string

**FILES:** `apps/web/lib/messaging/antispam.ts`

Both filter functions strip URLs, emails, and phone numbers from message text. If the entire message is a URL (e.g., a user sharing a link with no other text), the return value is `""`. Callers that do not explicitly check for an empty result will persist a blank message row or render a blank chat bubble with no indication that content was stripped.

**FIX:** Document in JSDoc that the return can be `""`. Callers should check: either reject the message with "Message cannot contain links" or substitute a configurable placeholder (e.g., `"[link removed]"`). The filter function itself is working as designed — it is the callers that need to guard for the empty case.

---

### 14: BUG-LB-02 — Leaderboard getLeaderboard has no tiebreaker — pagination is non-deterministic for equal XP

**FILES:** `apps/web/lib/leaderboards/engine.ts`

`getLeaderboard` uses `ORDER BY ls.xp_value DESC NULLS LAST` with no secondary sort column. When multiple users share identical XP values, the database may return them in any order, and that order can change between queries. A client requesting page 1 and page 2 can receive the same user on both pages or miss a user entirely.

**FIX:** Add a stable tiebreaker: `ORDER BY ls.xp_value DESC NULLS LAST, ls.user_id ASC`. This guarantees a total order across all rows and produces correct, consistent cursor-based pagination.

---

### 15: BUG-NOTIF-01 — challenges.ts notification INSERTs do not include title or body

**FILES:** `apps/web/lib/games/challenges.ts`

The notification INSERT statements inside the `challenges.ts` logic do not include `title` or `body` columns. Across the rest of the codebase (per `lib/notifications/insert.ts`), every notification INSERT provides these fields so the push/in-app renderer can display the notification. Challenge notifications would be persisted as rows with null titles and bodies, rendering as blank notifications in the mobile app.

**FIX:** Add `title` and `body` values to each notification INSERT in `challenges.ts`. Use descriptive strings appropriate to the notification type (e.g., `"Game Challenge"` as title, `"You received a challenge from {username}"` as body). Refer to `lib/notifications/insert.ts` for the expected field set and any existing type-to-message mappings.

---

### 16: BUG-TRUST-01 — meetsMinimumTrust reads the stale cached trust_score without recomputing

**FILES:** `apps/web/lib/trust/trustScore.ts`

`meetsMinimumTrust` reads `users.trust_score` (a cached denormalized column) without calling `calculateTrustScore`. If a user has just received a ban, warning, or moderation action, the `trust_score` column reflects the pre-action state until the next explicit recalculation is triggered. During this window, a user whose actual score is now below a feature threshold can still pass the gate and use the gated feature.

**FIX:** On any event that reduces trust (ban, warning issued, report received, content removed), call `calculateTrustScore` synchronously before any subsequent `meetsMinimumTrust` check in the same request. Alternatively, add a `forceRecalculate?: boolean` parameter to `meetsMinimumTrust` and set it to `true` in all moderation action handlers.

---

### 17: BUG-WAR-01 — recordWarContribution active-war check runs outside the write transaction (TOCTOU)

**FILES:** `apps/web/lib/guilds/recordWarContribution.ts`

Lines 33–54 query for an active war (checking status) outside the transaction that then writes the contribution upsert. A concurrent `resolveWar` call can mark the war as resolved between the status check and the contribution write. The write succeeds (no re-check inside the transaction), recording points for a war that has already ended. Post-resolution leaderboard calculations include these phantom points.

**FIX:** Move the active-war status check inside the same transaction as the contribution upsert. Use `SELECT … FOR UPDATE` on the war row to hold the lock. This serialises the check and write atomically, eliminating the TOCTOU window.

---

### 18: BUG-SPAM-02 — Antispam URL_REGEX does not match Punycode/IDN domains

**FILES:** `apps/web/lib/messaging/antispam.ts`

`URL_REGEX` matches domains by looking for standard ASCII hostname patterns. Internationalized domain names encoded in Punycode (e.g., `https://xn--n3h.example.com`) pass through the filter undetected because the `xn--` prefix is not in the pattern. A malicious actor can bypass the link filter trivially by encoding their domain in Punycode.

**FIX:** Add `xn--` as a matched hostname prefix pattern in `URL_REGEX`, or replace the regex approach with WHATWG URL API parsing (`new URL(token)`) to detect valid URLs regardless of encoding. The URL API approach is more robust and future-proof than extending the regex.

---

## Code Quality Assessment

### Current Rating: 7.2 / 10

The codebase reflects genuine engineering maturity in most subsystems:

**Strengths observed:**
- CSP nonces with `strict-dynamic` and no `unsafe-inline`; per-request nonce generation in edge middleware.
- CSRF validation via Origin header for all API mutations; OAuth CSRF state token with Redis.
- SSRF protection with DNS-pinned `undici` Agent, single DNS resolution, TOCTOU prevention via IP pinning, streaming body size cap.
- AES-256-GCM field encryption with scrypt KDF v2; v1 key migration path.
- Coin and star economies use SELECT FOR UPDATE throughout; append-only ledgers; Decimal.js for all arithmetic.
- `safeAwardXP()` with dead-letter queue, exponential backoff retry, and leaderboard snapshot updates — correct everywhere except the one caller (BUG-XP-01) that bypasses the transaction boundary.
- Atomic Lua scripts for rate limiting (sliding window), DM coin daily limits, and room presence cap — no TOCTOU races.
- JWT multi-key rotation with kid-based registry; TOTP with `timingSafeEqual` anti-timing.
- Structured logging, per-request trace IDs, audit log, system alerts for permanently failed operations.
- Webhook replay protection via Redis with `NX` and TTL; HMAC-SHA512 (Paystack) verification.
- `safeHtml()` sanitizer with strict allowlist; anti-spam phone/URL/email stripping in DMs.
- Geo-anomaly detection, rate-limiting, and PIN guard are all correctly implemented with Redis atomic ops.

**Areas of concern:**
- BUG-PLAY-01 is a critical mobile revenue defect: Android coin pack purchases are never consumed, leading to auto-voids and blocked re-purchase. This is very likely the root cause of any "I can't buy coins again" support tickets on Android.
- BUG-LB-01 is a latent runtime error on every XP award if the DB index doesn't match the upsert expression — needs immediate verification.
- BUG-LOCK-01 (creator fund advisory lock) is a latent double-payout risk that only triggers under specific connection-pool conditions — easy to miss in testing, impactful in production.
- BUG-AUTH-02 (rankTier mismatch) means rank-gated mobile UI has never worked correctly — every feature guarded by rank on mobile evaluates the wrong strings.
- BUG-GAME-01 (challenge cancellation exploit) is immediately exploitable by any user who understands the refund behaviour.

### Projected Rating After All 18 Fixes: 8.7 / 10

Applying all fixes closes the Google Play consumable defect, fixes the leaderboard runtime risk, eliminates the advisory lock double-payout hazard, corrects all rank-gated mobile UI, removes the challenge escape-hatch exploit, ensures the gift send and coin purchase flows are properly ordered and idempotent, aligns the Paystack notification types, fixes Expo offline database reliability, ensures season coins are fully distributed, and hardens the anti-spam filter against Punycode bypass. The gap from 8.7 to 10 reflects the absence of a visible integration/E2E test suite (the notification and rank bugs appear to have been live for some time without detection) and the leaderboard tiebreaker issue that is a non-trivial pagination redesign.

---

*Report generated: June 20, 2026 · 10:45 AM*
*Scope: 80+ files manually reviewed across apps/web and apps/expo*
*Bugs found: 18 | No code modified during this analysis*
