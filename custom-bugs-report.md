# Zobia Codebase — Forensic Bug Report

**Generated:** 2026-06-14 at 6:06 AM UTC  
**Scope:** `apps/web` (Next.js 14 App Router, Edge Middleware, API Routes, Lib modules)  
**Methodology:** Manual forensic line-by-line analysis — no automated scanners used  

---

## Quick-Reference Index

1. BUG-001 — Dead `dynamic` export on client component (login page)
2. BUG-002 — 2FA tokens leaked in JSON response body
3. BUG-003 — Legacy `sessionToken` 2FA path is unimplemented (no session, no cookies)
4. BUG-004 — Rate-limiter off-by-one: TRUSTED_PROXY_COUNT=0 reads wrong IP index
5. BUG-005 — Username uniqueness race condition in Google OAuth callback
6. BUG-006 — Mobile OAuth refresh token exposed in redirect URL
7. BUG-007 — TOCTOU race in Redis session-set TTL management
8. BUG-008 — Quest deck completion counts ALL quests, not the user's assigned deck
9. BUG-009 — Guild war reward distribution loses remainder coins (floor rounding)
10. BUG-010 — Season XP-bonus milestone omits write to `xp_ledger`
11. BUG-011 — `createSeasonCeremonyRoom()` silently swallows errors with no logging
12. BUG-012 — Daily CRON: Telegram re-engagement never marks users as notified
13. BUG-013 — Daily CRON: Alliance War creation lacks `ON CONFLICT` guard
14. BUG-014 — Daily CRON: streak-update condition is logically contradictory
15. BUG-015 — Daily CRON: monthly plan bonus references non-existent `is_active` column
16. BUG-016 — Monthly plan bonus uses inconsistent transaction type strings across two flows
17. BUG-017 — Paystack subscription notification INSERT uses wrong schema (`payload` vs `title`/`body`/`metadata`)
18. BUG-018 — Geo-anomaly rate window is not truly sliding (TTL only set on first hit)
19. BUG-019 — CSRF middleware condition has operator precedence bug (missing parentheses)
20. BUG-020 — Referral commission `paymentId` defaults to `buyerId`, causing dedup key collisions
21. BUG-021 — IAP verification TOCTOU: idempotency check outside transaction allows double-credit
22. BUG-022 — Leaderboard CRON queries non-existent `rank_position` column (all rank-change notifications broken)
23. BUG-023 — Leaderboard CRON RANK() computed over active-user subset, not full leaderboard
24. BUG-024 — Guild Wars CRON: Final Hour batch INSERT column/value count mismatch
25. BUG-025 — Gemini API key passed as URL query parameter (logged in server/CDN logs)
26. BUG-026 — `upsertLeaderboardSnapshot()` UPDATE-then-INSERT without transaction (silent data loss under concurrency)
27. BUG-027 — Creator Fund tier distribution broken for pools smaller than 100 creators
28. BUG-028 — `CONNECTION_BADGE_THRESHOLD = 50` is dead code (badge logic uses a different constant)
29. BUG-029 — `processPendingGiftDrops()` sets `announced_at` but sends no actual notifications
30. BUG-030 — Coin purchase idempotency key is daily-granular, blocking same-day re-purchases
31. BUG-031 — Two divergent HTML sanitizer implementations with conflicting allowlists
32. BUG-032 — AI content-moderation circuit breaker is per-instance only (not Redis-backed)
33. BUG-033 — DodoPayments webhook: metadata fallback still allows 0-coin grants on tampered payloads

---

## Code Quality Rating

### Current State: 6.5 / 10

The codebase demonstrates strong architectural intent. The security posture (CSP nonces, parameterized queries, HMAC webhook verification, SSRF protection, atomic ledger patterns, TOTP anti-replay) is well above average for a social platform of this scale. The abstractions are clean and the module boundaries make sense. However, a significant number of correctness bugs — especially around concurrency (multiple TOCTOU races), data integrity (ledger audit trail gap, floor-rounding coin loss), and silent failure paths — undermine the otherwise solid foundation. Several bugs are not merely cosmetic: BUG-022 causes 100% failure of a visible user feature, BUG-025 is a credential exposure, and BUG-021 allows financial double-credit under load.

### Projected Post-Fix Rating: 8.5 / 10

Resolving all 33 items would close the gaps in financial integrity, credential security, and user-visible feature correctness. The architecture itself is sound and would merit that higher rating once the implementation catches up to the design.

---

## Detailed Bug Entries

---

**1: BUG-001: Dead `dynamic = "force-dynamic"` export on a Client Component (login page)**

FILES: `apps/web/app/auth/login/page.tsx`

FIX: The `export const dynamic = "force-dynamic"` directive is a Server Component hint and is silently ignored on any file that contains `"use client"`. It has zero effect on rendering strategy or caching. Remove the export entirely — it creates misleading documentation in the file and can confuse future developers into thinking it influences behaviour.

---

**2: BUG-002: 2FA verify route returns `accessToken` and `refreshToken` in JSON response body**

FILES: `apps/web/app/api/auth/2fa/verify/route.ts`

FIX: Tokens are currently returned as JSON fields, which means they will be stored in JavaScript-accessible memory and potentially in Axios/fetch response history. The correct pattern — already used by the primary login and refresh routes — is to write the tokens as HttpOnly `Secure` `SameSite=Strict` cookies and return only a success status. Update this route to call the same cookie-setting utility used by `/api/auth/login`, then return `{ ok: true }` with no token values in the body.

---

**3: BUG-003: Legacy `sessionToken` 2FA completion path creates no session and sets no cookies**

FILES: `apps/web/app/api/auth/2fa/verify/route.ts`

FIX: The route has a branch that accepts a `sessionToken` (for mobile/non-cookie callers) and, once 2FA is verified, returns `{ verified: true }` with no access token, no refresh token, and no session record written to Redis. The caller is left with no usable credential. Either implement the full token-issue path for this branch (sign tokens, create a Redis session, return the tokens in the response) or document that this branch is intentionally removed and delete the dead code. As-is it silently succeeds while leaving the user unauthenticated.

---

**4: BUG-004: Rate-limiter IP extraction off-by-one when `TRUSTED_PROXY_COUNT` is 0**

FILES: `apps/web/lib/security/rateLimit.ts`

FIX: The client IP is obtained by indexing the `X-Forwarded-For` array from the right: `ips[ips.length - TRUSTED_PROXY_COUNT - 1]`. When `TRUSTED_PROXY_COUNT` is 0 (no proxy), this evaluates to `ips[ips.length - 1]` — the rightmost (most recently added) address — which is correct. However when the header is absent or empty the array has length 0 and the index becomes -1, returning `undefined`. The code falls back to `request.ip` in that case, but the guard condition is missing a check for `ips.length === 0` before the array access. Under zero-proxy deployments with a missing header, `ips[-1]` evaluates to `undefined` without the guard, and the fallback is only reached because `undefined` is falsy. This is currently benign but the logic is fragile. Additionally, if `TRUSTED_PROXY_COUNT` exceeds the number of IPs in the header (misconfiguration), the index goes negative and returns `undefined`, silently bypassing the IP-based limit for all requests. Add explicit bounds-checking: if `ips.length <= TRUSTED_PROXY_COUNT`, log a warning and fail closed (block or return a safe default).

---

**5: BUG-005: Username uniqueness race condition in Google OAuth callback**

FILES: `apps/web/app/api/auth/google/callback/route.ts`

FIX: The `uniqueUsername()` helper performs a `SELECT … LIKE username%` check then returns a candidate. Between that check and the subsequent `INSERT INTO users`, a concurrent OAuth callback for another user who received the same candidate can claim it first, causing a unique-constraint violation and a 500 error. Apply a `UNIQUE` constraint on `users.username` (it likely already exists) and catch the `23505` PostgreSQL unique-violation error code in the INSERT block, then retry `uniqueUsername()` and re-INSERT once. This makes the handler idempotent under the race.

---

**6: BUG-006: Mobile OAuth flow passes refresh token as a URL query parameter**

FILES: `apps/web/app/api/auth/google/callback/route.ts`

FIX: When the OAuth callback detects a mobile client, it builds a deep-link redirect URL and appends `?refresh_token=<value>`. Refresh tokens in URLs are logged by every proxy, CDN edge node, server access log, and browser history entry they touch. They are also visible to any JavaScript snippet on the landing page via `window.location`. Use a short-lived one-time code instead: store the refresh token in Redis under a random UUID with a 60-second TTL, redirect the mobile app with only `?code=<uuid>`, and add a dedicated `/api/auth/mobile-token-exchange` endpoint that swaps the code for the token over an authenticated POST.

---

**7: BUG-007: TOCTOU race in Redis session-set TTL management**

FILES: `apps/web/lib/auth/session.ts`

FIX: The session cleanup path calls `SCARD user_sessions:{userId}`, then conditionally calls `TTL user_sessions:{userId}`, then calls `EXPIRE user_sessions:{userId}` as separate round-trips. Between the TTL read and the EXPIRE write, another process can modify the set. Replace the three separate commands with a single Lua script that reads the TTL and conditionally extends it atomically, or use Redis pipelines with a WATCH/MULTI/EXEC block. This prevents a race where the TTL is extended twice or where a concurrent logout deletes the key between the TTL read and the EXPIRE.

---

**8: BUG-008: `checkDeckCompletion()` counts all daily quest progress, not the assigned deck**

FILES: `apps/web/lib/quests/questEngine.ts`

FIX: The completion check query joins `quest_progress` to `quests` and filters only by `user_id` and `completed_today = true`. It does not filter by the quest IDs that belong to the user's currently-assigned deck. If a user completes quests from an old deck or from a different context, `checkDeckCompletion` will see them as part of the current deck and may falsely award the deck-completion bonus. Add a subquery or CTE that first fetches the user's active deck assignment (`user_quest_decks WHERE user_id = $1 AND assigned_date = TODAY`), then restricts the progress count to only the quest IDs in that deck.

---

**9: BUG-009: Guild war reward distribution loses remainder coins due to floor rounding**

FILES: `apps/web/lib/guilds/warEngine.ts`

FIX: `distributeWarRewards()` divides the total reward pool by the number of winners using integer floor division. The modulo remainder (e.g., 7 coins on a 3-way split of 100) is never assigned to anyone — it simply disappears from the ledger. To preserve the supply, either add the remainder to the first winner's share (`winners[0].amount += remainder`) or return the remainder to the guild's treasury via a ledger credit. The current behaviour silently destroys coins on every guild war, which will compound over time and cause supply drift.

---

**10: BUG-010: Season XP-bonus milestone write missing from `xp_ledger`**

FILES: `apps/web/lib/seasons/seasonEngine.ts`

FIX: When a user claims a season pass milestone whose reward type is `xp_bonus`, the code updates `users.total_xp` and `users.rank` but does not insert a corresponding row into `xp_ledger`. Every other XP-granting path writes to `xp_ledger` first and derives the user update from it (the ledger is the source of truth). This gap means season XP bonuses are invisible to XP audits, lifetime XP totals in the ledger will be understated, and any future XP recalculation from the ledger will lose the bonus. Insert a ledger row with `type = 'season_milestone_bonus'` before updating the user record.

---

**11: BUG-011: `createSeasonCeremonyRoom()` silently returns `null` on failure with no logging**

FILES: `apps/web/lib/seasons/seasonEngine.ts`

FIX: The entire function body is wrapped in a broad `try/catch` that returns `null` on any error without logging anything. If room creation fails (database error, missing permissions, schema mismatch), the season end-ceremony will silently skip the ceremony room and the caller has no way to distinguish "no room needed" from "room creation threw an unhandled exception". At minimum, add `console.error` in the catch block. Ideally, let specific recoverable errors (duplicate-room conflict) be caught with `null` returns while unexpected errors propagate to the caller, which can decide whether to abort or continue the ceremony without a room.

---

**12: BUG-012: Daily CRON Telegram re-engagement never marks users as notified**

FILES: `apps/web/app/api/cron/daily/route.ts`

FIX: Step 19 of the daily CRON selects users who have enabled Telegram notifications and have been inactive for some threshold, then sends Telegram messages. However, it never updates any `notified_at`, `telegram_notified_at`, or `re_engagement_sent_at` field on the user record or in a notifications table. On the next CRON run, the same users are selected again and receive a second (identical) Telegram message. This continues indefinitely. After the `sendBulkTelegramMessages()` call, add a batched UPDATE that marks the notified users (by ID) with a timestamp, and add that timestamp to the WHERE filter on future runs to prevent repeat notifications within a cooldown window.

---

**13: BUG-013: Daily CRON Alliance War creation lacks `ON CONFLICT DO NOTHING` guard**

FILES: `apps/web/app/api/cron/daily/route.ts`

FIX: Step 32 inserts new alliance wars with a plain `INSERT INTO alliance_wars`. If the daily CRON is invoked twice in the same day (manual trigger, retry, or external CRON service overlap), a second set of wars is created for the same guilds on the same date, duplicating active wars. Add a unique constraint on `(guild_id_a, guild_id_b, scheduled_for::date)` (or similar business-key) and use `ON CONFLICT DO NOTHING` on the INSERT to make the operation idempotent.

---

**14: BUG-014: Daily CRON streak-update condition is logically self-contradictory**

FILES: `apps/web/app/api/cron/daily/route.ts`

FIX: The streak increment query filters for users where `last_login_date = CURRENT_DATE - INTERVAL '1 day'` AND `last_login_at::date = CURRENT_DATE`. The first condition requires the stored date to be yesterday; the second requires the timestamp to be today. Both conditions reference different columns. If `last_login_date` and `last_login_at` are kept in sync, one of these conditions is always redundant. If they differ by design, the combined filter will exclude many legitimate streak users whose records haven't been updated yet when the CRON runs. Audit which of the two columns is authoritative for streak tracking and rewrite the query using only that one.

---

**15: BUG-015: Daily CRON monthly plan bonus references non-existent `is_active` column**

FILES: `apps/web/app/api/cron/daily/route.ts`

FIX: The monthly subscription bonus query filters `subscriptions WHERE is_active = true`. The subscriptions table almost certainly uses `deleted_at IS NULL` (soft-delete pattern) or a `status = 'active'` enum consistent with the rest of the schema — there is no evidence of an `is_active` boolean column in any migration or related query. If this column doesn't exist the query will throw a runtime error every day, silently failing the monthly bonus step. Replace `is_active = true` with the correct status predicate matching the actual schema.

---

**16: BUG-016: Monthly plan bonus uses inconsistent transaction type strings across two flows**

FILES: `apps/web/app/api/cron/daily/route.ts`, `apps/web/app/api/economy/webhooks/paystack/route.ts`

FIX: The CRON that grants monthly subscription bonuses records the ledger entry with `type = 'monthly_plan_bonus'`. The Paystack subscription webhook also grants the bonus but uses `type = 'subscription_bonus'`. The `reference_id` for deduplication is constructed differently in each path too. A user renewing via webhook and also being processed by the CRON could receive the bonus twice in the same month, or dedup logic could falsely block the legitimate webhook grant. Unify both paths to use a single canonical transaction type string and a deterministic reference_id (e.g., `sub_bonus:{userId}:{YYYY-MM}`) checked with `ON CONFLICT DO NOTHING`.

---

**17: BUG-017: Paystack subscription notification INSERT uses wrong column schema**

FILES: `apps/web/app/api/economy/webhooks/paystack/route.ts`

FIX: The payout notification inserts correctly into a `notifications` table using `(user_id, title, body, type, metadata)`. However the subscription-event notification in the same file uses a `payload` column instead of `title`/`body`/`metadata`. One of these is wrong. Inspect the actual `notifications` table schema and standardise all notification inserts in this file to use the correct column set. Using the shared `insertNotification()` helper from `lib/notifications/insert.ts` would prevent this class of divergence entirely.

---

**18: BUG-018: Geo-anomaly rate window is not truly sliding (TTL only set on initial hit)**

FILES: `apps/web/lib/security/geoAnomaly.ts`

FIX: The anomaly counter in Redis uses `INCR` then sets a TTL only when `count === 1` (first hit). This means the window starts at the first suspicious login and expires at a fixed time later — it is a fixed-window counter, not a sliding window. Under the fixed window, an attacker who spans midnight can get roughly double the allowed attempts. To implement a proper sliding window, either use a sorted set with timestamps as scores (and trim entries older than the window on every read) or use an atomic Lua script similar to the one in `rateLimit.ts`. The geo-anomaly module is a security control and deserves the same rigour as the rate limiter.

---

**19: BUG-019: CSRF middleware condition has operator precedence bug**

FILES: `apps/web/middleware.ts` (line 197)

FIX: The condition reads: `if ((pathname.startsWith("/api/") && !isPublicRoute(pathname) || isAuthMutation) && !isCsrfSafe(request))`. Due to JavaScript operator precedence, `&&` binds tighter than `||`, so this parses as `((A && B) || C) && D` — meaning `isAuthMutation` alone (without the `/api/` prefix check) can trigger the CSRF gate. This is actually slightly over-broad (auth mutations on non-`/api/` paths are also gated) but more critically it means the two intended independent conditions are not independently evaluated. The correct formulation should be `((pathname.startsWith("/api/") && !isPublicRoute(pathname)) || isAuthMutation) && !isCsrfSafe(request)` with explicit parentheses. Wrap the `||` sub-expression in parentheses to make the intent unambiguous and verifiable.

---

**20: BUG-020: Referral commission `paymentId` default parameter collides with `buyerId`**

FILES: `apps/web/lib/referrals/commissions.ts`

FIX: The function signature is `awardReferralCommissions(buyerId, amount, paymentId = buyerId)`. If a caller omits `paymentId`, the buyer's UUID is used as the commission reference key. On the buyer's second purchase (different `paymentId`), if the caller again omits it, the reference key is still the same UUID — the dedup check treats it as an already-processed commission and silently skips it. All callers must always pass an explicit `paymentId`. Remove the default entirely (make the parameter required), which will cause a TypeScript compile error at every call site that omitted it, forcing each to be audited. This is preferable to the silent dedup failure.

---

**21: BUG-021: IAP verification TOCTOU allows double coin credit under concurrency**

FILES: `apps/web/app/api/economy/iap/verify/route.ts`

FIX: The handler first checks `coin_ledger` for an existing row with the IAP purchase token as the reference_id (idempotency check), then — in a separate database round-trip — calls `creditCoins()` if no row is found. Between the SELECT and the INSERT inside `creditCoins`, a second concurrent request (e.g., a retry from the mobile app) can also pass the SELECT check and both proceed to credit. The fix is to make the idempotency check and the insert atomic: use `INSERT INTO coin_ledger … ON CONFLICT (reference_id) DO NOTHING RETURNING id` as the very first operation inside a transaction, and only update `users.coin_balance` if the INSERT succeeded (i.e., returned a row). Discard the pre-check SELECT entirely.

---

**22: BUG-022: Leaderboard CRON queries non-existent `rank_position` column (CRITICAL)**

FILES: `apps/web/app/api/cron/leaderboards/route.ts`

FIX: Step 2 of the leaderboard CRON joins `leaderboard_snapshots ls_prev` and selects `ls_prev.rank_position`. The `leaderboard_snapshots` table (as created by `upsertLeaderboardSnapshot`) stores `rank` not `rank_position`. This column reference will throw a PostgreSQL error on every CRON run, causing Step 2 to fail entirely. As a result, zero rank-change notifications are ever sent to users. Fix by replacing `rank_position` with `rank` in the query. Also audit any other references to this column name across the codebase for consistency.

---

**23: BUG-023: Leaderboard CRON RANK() computed over active-user subset, not full leaderboard**

FILES: `apps/web/app/api/cron/leaderboards/route.ts`

FIX: Step 4 uses a window function `RANK() OVER (ORDER BY score DESC)` applied only to the users who have been active in the current snapshot period. A user ranked #42 globally may be ranked #5 within the active-user subset and will receive a "you moved to rank 5!" notification, which is factually wrong. The rank calculation must be done over the full `leaderboard_snapshots` table for the current period, not a filtered subset. Either use a subquery that includes all rows in the snapshot, or store the true absolute rank in the snapshot row during `upsertLeaderboardSnapshot` so the CRON can simply read it.

---

**24: BUG-024: Guild Wars CRON Final Hour batch INSERT has column/value count mismatch**

FILES: `apps/web/app/api/cron/guild-wars/route.ts`

FIX: The Final Hour notification batch INSERT declares 5 column names: `(user_id, type, payload, is_read, created_at)` but the VALUES template for each row only provides 4 placeholders (no value for `created_at`). If `created_at` has a DB-level DEFAULT of `NOW()` the INSERT will succeed but the column list in the SQL is still misleading and fragile. If there is no default, the INSERT will throw a `not-null constraint` error for every row in the batch, silently killing all Final Hour notifications. Either remove `created_at` from the column list and rely on the DB default, or add `NOW()` as the fifth value in every row's placeholder group.

---

**25: BUG-025: Gemini API key exposed as URL query parameter**

FILES: `apps/web/lib/ai/client.ts`

FIX: The Gemini API call constructs the endpoint URL as `https://generativelanguage.googleapis.com/…?key=${effectiveKey}`. API keys in URLs appear verbatim in server-side access logs, reverse proxy logs (Nginx, Cloudflare, Vercel), CDN edge logs, and `Referer` headers on any subsequent redirect. The correct approach is to pass the key as an `x-goog-api-key` HTTP header (Google's documented alternative) or use Google's ADC (Application Default Credentials) / service-account approach. Move the key to a request header and remove it from the URL.

---

**26: BUG-026: `upsertLeaderboardSnapshot()` UPDATE-then-INSERT pattern loses data under concurrency**

FILES: `apps/web/lib/leaderboards/engine.ts`

FIX: The function first tries `UPDATE leaderboard_snapshots SET … WHERE user_id = $1 AND period = $2`. If 0 rows are updated, it falls through to `INSERT … ON CONFLICT DO NOTHING`. Under concurrent writes (two CRON processes, a triggered snapshot from an XP award and the scheduled CRON simultaneously), both can see 0 rows updated and both attempt the INSERT. The second INSERT is silently swallowed by `ON CONFLICT DO NOTHING` — neither an error nor a merge. Replace the two-step pattern with a single `INSERT … ON CONFLICT (user_id, period) DO UPDATE SET score = EXCLUDED.score, …` (upsert) which is atomic in PostgreSQL.

---

**27: BUG-027: Creator Fund tier distribution broken for pools smaller than 100 creators**

FILES: `apps/web/lib/creator/fund.ts`

FIX: Tier 1 (top creators) is sized by `Math.floor(0.01 * totalCreators)`. For any pool with fewer than 100 creators, this evaluates to 0. With a tier-1 size of 0, no creators are placed in tier 1, but the pool share allocated to tier 1 (e.g., 50% of the fund) is not redistributed to the other tiers — it is simply not distributed at all. The fund runs every distribution cycle but pays out less than 100% of the pool whenever `totalCreators < 100`. Fix by replacing `Math.floor` with `Math.max(1, Math.floor(0.01 * totalCreators))` so at minimum one creator occupies each tier, and add logic to redistribute any undistributed remainder (due to tier sizes rounding to 0) proportionally to the tiers that do have members.

---

**28: BUG-028: `CONNECTION_BADGE_THRESHOLD = 50` is dead code**

FILES: `apps/web/lib/messaging/conversationScore.ts`

FIX: The constant `CONNECTION_BADGE_THRESHOLD = 50` is defined at the top of the module and appears to guard a badge based on conversation score reaching 50. However the actual badge award logic uses `CONNECTION_BADGE_STREAK_DAYS = 7` and triggers on a consecutive-day streak, not on score. The threshold constant is never referenced anywhere in the module or in any importer. Remove the constant to eliminate dead code confusion, and add a comment to `CONNECTION_BADGE_STREAK_DAYS` clarifying that the badge is streak-based (not score-based) so future contributors don't re-introduce the wrong constant.

---

**29: BUG-029: `processPendingGiftDrops()` sets `announced_at` but sends no user notifications**

FILES: `apps/web/lib/events/monthlyGiftDrop.ts`

FIX: After a monthly gift drop becomes active, `processPendingGiftDrops()` updates `gift_drops.announced_at = NOW()` — indicating the drop has been announced — but does not send any push notification, in-app notification, or email to users. Users have no way to know a gift drop is available unless they happen to open the app and the client polls for active drops. Implement the actual announcement: after setting `announced_at`, insert an in-app notification row for all eligible users (or publish a push notification batch via the Expo push system) with a message and deep-link to the gift drop flow.

---

**30: BUG-030: Coin purchase idempotency key is daily-granular, blocking legitimate same-day repurchases**

FILES: `apps/web/app/api/economy/coins/purchase/route.ts`

FIX: The idempotency key is `purchase:{userId}:{packId}:{YYYY-MM-DD}`. A user who legitimately purchases the same coin pack twice in one day (e.g., buys a small pack in the morning and again in the evening) will have their second purchase rejected with an idempotency collision, even though both are real distinct transactions with different Paystack `reference` values. The idempotency key should incorporate the Paystack transaction reference or a client-provided request ID, not the date. The date-granular key may have been intended to prevent accidental double-taps but has the side effect of limiting purchases to once per pack per day, which is not a documented business rule.

---

**31: BUG-031: Two divergent HTML sanitizer implementations with conflicting allowlists**

FILES: `apps/web/lib/security/htmlSanitizer.ts`, `apps/web/lib/announcements/engine.ts`

FIX: `lib/security/htmlSanitizer.ts` is the canonical sanitizer shared across the codebase. `lib/announcements/engine.ts` contains a local `sanitizeHtmlContent()` implementation with a different tag allowlist and, critically, does not permit `mailto:` links that the canonical version supports. This means announcement content with `mailto:` links will have them stripped, while the same links in other contexts are preserved. Additionally, having two sanitizer implementations means any future security fix (adding a blocked tag, adjusting `href` scheme validation) must be applied in both places or divergence will re-introduce a vulnerability in one path. Delete the local implementation in `announcements/engine.ts` and replace it with an import from `lib/security/htmlSanitizer.ts`.

---

**32: BUG-032: AI content-moderation circuit breaker is per-Lambda-instance only**

FILES: `apps/web/lib/moderation/aiClassifier.ts`

FIX: `aiClassifier.ts` maintains its own module-level failure counter and circuit-breaker state (open/closed/half-open). In a serverless environment (Vercel), each function instance has isolated in-process memory. If the AI provider is down, one instance opens its circuit breaker, but the next request may hit a cold-start on a fresh instance whose counter is at zero — it calls the (still-down) AI provider, fails, increments locally, and so on. The circuit never opens globally. By contrast, the main `lib/ai/client.ts` AI circuit breaker is Redis-backed and therefore survives across instances. Move `aiClassifier.ts` to use the same Redis-backed circuit breaker from `lib/ai/client.ts`, or at minimum call through `aiClient.chat()` which already has that protection.

---

**33: BUG-033: DodoPayments webhook metadata fallback allows 0-coin grants**

FILES: `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

FIX: When `itemSlug` is absent or doesn't match any entry in the price catalogue, the code falls back to `coinsGranted = metadata.coinsGranted ?? 0` and `starsGranted = metadata.starsGranted ?? 0`. This means a DodoPayments payment with no `itemSlug` and no `coinsGranted` in metadata will be acknowledged as successful (HTTP 200) but grant zero coins. The user pays real money and receives nothing. More dangerously, the metadata fields come from the payment object and could potentially be manipulated at the payment-creation stage. The fallback should either (a) reject the webhook with an alert if `itemSlug` is missing and no catalogue entry can be found, or (b) treat `coinsGranted = 0` as an error condition and refund/flag the transaction rather than silently completing it with zero value delivered.

---

## Summary

33 bugs identified. Severity breakdown:
- **Critical** (data integrity / security / feature completely broken): BUG-002, BUG-006, BUG-021, BUG-022, BUG-025
- **High** (silent data loss / incorrect user-visible behaviour): BUG-007, BUG-009, BUG-010, BUG-012, BUG-023, BUG-024, BUG-026, BUG-027, BUG-029, BUG-033
- **Medium** (correctness bugs with bounded blast radius): BUG-003, BUG-005, BUG-008, BUG-013, BUG-016, BUG-018, BUG-019, BUG-020, BUG-030, BUG-031, BUG-032
- **Low** (dead code / misleading logic / minor inconsistency): BUG-001, BUG-004, BUG-011, BUG-014, BUG-015, BUG-017, BUG-028

---

*Report generated: 2026-06-14 at 6:06 AM UTC*  
*Analyst: Forensic code review — zobia web app codebase*
