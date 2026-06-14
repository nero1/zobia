# Zobia Codebase — Bug Fix Plan

**Generated:** 2026-06-14 at 6:06 AM UTC  
**Scope:** All 33 bugs from `custom-bugs-report.md`  
**Status:** Awaiting review — DO NOT implement until approved  

---

## Fix Execution Order

Fixes are grouped by risk and dependency. Complete each phase before starting the next.

- **Phase 1 — Critical Security & Financial Integrity** (BUG-002, BUG-006, BUG-021, BUG-022, BUG-025): Fix these first. They are credential exposures, a double-spend risk, and a broken user-facing feature.
- **Phase 2 — Data Integrity & Silent Failures** (BUG-007, BUG-009, BUG-010, BUG-012, BUG-023, BUG-024, BUG-026, BUG-027, BUG-029, BUG-033): Correct data-loss bugs and silent no-ops.
- **Phase 3 — Correctness** (BUG-003, BUG-005, BUG-008, BUG-013, BUG-016, BUG-018, BUG-019, BUG-020, BUG-030, BUG-031, BUG-032): Fix logic errors and race conditions.
- **Phase 4 — Cleanup** (BUG-001, BUG-004, BUG-011, BUG-014, BUG-015, BUG-017, BUG-028): Dead code, misleading guards, schema consistency.

---

## Phase 1 — Critical Security & Financial Integrity

---

**Fix 1 (BUG-002): Remove tokens from 2FA verify response body — set them as HttpOnly cookies instead**

FILES: `apps/web/app/api/auth/2fa/verify/route.ts`

In the 2FA verify route, locate the `return NextResponse.json({ accessToken, refreshToken })` call (or equivalent). Replace it with the same pattern used in `/api/auth/login/route.ts`: call the cookie-setting utility to write `zobia_at` and `zobia_rt` as HttpOnly, Secure, SameSite=Strict cookies, then return `NextResponse.json({ ok: true })`. The `accessToken` and `refreshToken` values must not appear as JSON fields in the response. Also update any mobile clients that currently read these from the JSON body — they should instead read from cookies (web) or use the one-time-code exchange described in Fix 6 (BUG-006).

---

**Fix 2 (BUG-006): Replace refresh token in mobile OAuth redirect URL with a one-time exchange code**

FILES: `apps/web/app/api/auth/google/callback/route.ts`, new file `apps/web/app/api/auth/mobile-token/route.ts`

Step 1: In the Google OAuth callback, when a mobile client is detected, generate a cryptographically random 32-byte hex code (`crypto.randomBytes(32).toString('hex')`). Store `{ refreshToken, accessToken, userId }` in Redis under the key `mobile_exchange:{code}` with a 90-second TTL. Build the deep-link redirect with `?code=<hex>` only — no token in the URL.

Step 2: Create a new route `POST /api/auth/mobile-token`. It accepts `{ code }` in the request body, looks up `mobile_exchange:{code}` in Redis, deletes the key immediately (one-time use), and returns the tokens in the response body (mobile apps cannot use HttpOnly cookies so this is the accepted pattern for native clients — the tokens arrive over HTTPS, not in a URL). Return 400 if the key is missing or expired.

Step 3: Update the Expo mobile app to hit this exchange endpoint immediately after receiving the OAuth redirect.

---

**Fix 3 (BUG-021): Make IAP idempotency check atomic with the coin credit**

FILES: `apps/web/app/api/economy/iap/verify/route.ts`

Remove the pre-check `SELECT FROM coin_ledger WHERE reference_id = purchaseToken`. Instead, modify `creditCoins()` (or the inline ledger insert in this route) so the very first database operation is `INSERT INTO coin_ledger (user_id, amount, type, reference_id, …) VALUES (…) ON CONFLICT (reference_id) DO NOTHING RETURNING id`. Check whether the INSERT returned a row: if `RETURNING id` comes back empty, it was a duplicate — return HTTP 200 with a message like `{ ok: true, duplicate: true }`. Only if the INSERT succeeded proceed to `UPDATE users SET coin_balance = coin_balance + $amount WHERE id = $userId`. Wrap both operations in a single database transaction.

---

**Fix 4 (BUG-022): Fix `rank_position` → `rank` column reference in leaderboard CRON**

FILES: `apps/web/app/api/cron/leaderboards/route.ts`

In Step 2 of the leaderboard CRON, find every reference to `ls_prev.rank_position` and replace with `ls_prev.rank`. This single-column rename will un-break all rank-change notification queries. After deploying, verify by running the CRON once and checking the `notifications` table for newly inserted rank-change rows. Also do a project-wide grep for `rank_position` to confirm no other callers reference the wrong column name.

---

**Fix 5 (BUG-025): Move Gemini API key from URL query parameter to request header**

FILES: `apps/web/lib/ai/client.ts`

Locate the Gemini API fetch call that constructs the URL with `?key=${effectiveKey}`. Remove the `key` query parameter from the URL. Add the key as an HTTP request header: `'x-goog-api-key': effectiveKey` in the fetch options headers object. Google's Generative Language API accepts authentication via this header as a documented alternative to the query parameter. After this change, rotate the Gemini API key in Google Cloud Console and in all deployment environment variables, since any existing logs may already contain the key.

---

## Phase 2 — Data Integrity & Silent Failures

---

**Fix 6 (BUG-007): Atomise Redis session-set TTL management with a Lua script**

FILES: `apps/web/lib/auth/session.ts`

Replace the multi-round-trip pattern (`SCARD` → `TTL` → conditional `EXPIRE`) with a single Lua script executed via `redis.eval()`. The script should: read the current TTL of `user_sessions:{userId}`, and if it is less than some threshold (e.g., 7 days), call EXPIRE to extend it. Because Lua scripts execute atomically in Redis, no other command can interleave. This eliminates the window between the TTL read and the EXPIRE write.

---

**Fix 7 (BUG-009): Distribute guild war remainder coins to the first winner**

FILES: `apps/web/lib/guilds/warEngine.ts`

After calculating `perMemberReward = Math.floor(totalPool / winnerCount)`, calculate `remainder = totalPool - (perMemberReward * winnerCount)`. Add `remainder` to `winners[0].coinReward` (or whichever ledger entry corresponds to the top winner). This ensures 100% of the coin pool is distributed and the coin supply is fully conserved. Add an assertion or log statement that verifies `sum(distributed) === totalPool` to catch any future regressions.

---

**Fix 8 (BUG-010): Write season XP-bonus milestone to `xp_ledger`**

FILES: `apps/web/lib/seasons/seasonEngine.ts`

In the `claimMilestoneReward()` path where `reward.type === 'xp_bonus'`, insert a row into `xp_ledger` before updating `users.total_xp`. The ledger row should use `type = 'season_milestone_bonus'`, `reference_id = 'season:{seasonId}:milestone:{milestoneId}:user:{userId}'` (for deduplication), and `amount = reward.xpAmount`. Then derive the user update from the new ledger balance (or add the amount atomically) to stay consistent with all other XP-granting paths. Use `ON CONFLICT (reference_id) DO NOTHING` to make it safe to call twice.

---

**Fix 9 (BUG-012): Mark Telegram re-engagement users as notified after sending**

FILES: `apps/web/app/api/cron/daily/route.ts`

After the `sendBulkTelegramMessages()` call in Step 19, execute a batched `UPDATE users SET telegram_reengagement_sent_at = NOW() WHERE id = ANY($1::uuid[])` where the array contains the IDs of users who were selected for the batch. In the SELECT query that identifies candidates, add a filter: `AND (telegram_reengagement_sent_at IS NULL OR telegram_reengagement_sent_at < NOW() - INTERVAL '7 days')` (or whatever cooldown period is appropriate). This prevents the same user receiving the same Telegram message on every CRON run. If the `telegram_reengagement_sent_at` column doesn't exist yet, add it in a migration.

---

**Fix 10 (BUG-023): Compute leaderboard RANK() over the full snapshot table, not a subset**

FILES: `apps/web/app/api/cron/leaderboards/route.ts`

Step 4's rank-change query currently filters rows before computing `RANK()`. Restructure the query as a CTE or subquery: first compute `RANK() OVER (PARTITION BY period ORDER BY score DESC)` across ALL rows in `leaderboard_snapshots` for the current period (no WHERE filter on activity), then outer-join that result to the previous period's snapshot to detect rank changes, and finally filter to only users whose rank changed. This gives each user their true absolute rank position before doing the comparison. Alternatively, store the computed rank in the snapshot row during upsert, and the CRON simply reads pre-computed values.

---

**Fix 11 (BUG-024): Fix Final Hour notification batch INSERT column/value mismatch**

FILES: `apps/web/app/api/cron/guild-wars/route.ts`

Locate the Final Hour notification batch INSERT. Either: (a) Remove `created_at` from the declared column list and rely on the table's `DEFAULT NOW()` — confirm the column has a default in the migration; or (b) add a `NOW()` literal as the fifth value in each row's `($1,$2,$3,$4,NOW())` placeholder group. Option (a) is simpler and preferred. After the fix, verify the INSERT by checking that `created_at` is populated in the `notifications` table after a test war reaches Final Hour.

---

**Fix 12 (BUG-026): Replace UPDATE-then-INSERT with a single atomic upsert in `upsertLeaderboardSnapshot()`**

FILES: `apps/web/lib/leaderboards/engine.ts`

Delete the two-step `UPDATE … then INSERT … ON CONFLICT DO NOTHING` pattern. Replace with a single: `INSERT INTO leaderboard_snapshots (user_id, period, score, rank, …) VALUES ($1,$2,$3,$4,…) ON CONFLICT (user_id, period) DO UPDATE SET score = EXCLUDED.score, rank = EXCLUDED.rank, updated_at = NOW()`. PostgreSQL executes this as a single atomic operation (no gap between check and write). Ensure a unique constraint or unique index exists on `(user_id, period)`.

---

**Fix 13 (BUG-027): Fix Creator Fund tier sizing for pools smaller than 100 creators**

FILES: `apps/web/lib/creator/fund.ts`

Change `Math.floor(0.01 * totalCreators)` to `Math.max(1, Math.floor(0.01 * totalCreators))` for each tier that uses a fractional multiplier, so that at minimum 1 creator occupies any tier where creators exist. Additionally, after computing all tier sizes, calculate any undistributed pool (tiers that computed to 0 after the original floor, before the fix) and add a redistribution pass: if a tier has 0 members or 0 pool share after rounding, add its share to the next largest tier. Document the intended behaviour when `totalCreators < 10` (only one tier possible) with a comment.

---

**Fix 14 (BUG-029): Send actual user notifications when a monthly gift drop goes active**

FILES: `apps/web/lib/events/monthlyGiftDrop.ts`

After `UPDATE gift_drops SET announced_at = NOW()` in `processPendingGiftDrops()`, add a notification dispatch step. Query eligible users (or all active users, depending on drop eligibility rules). For each batch of users, call the in-app notification helper (`insertNotification()` from `lib/notifications/insert.ts`) with `type = 'gift_drop_available'`, a relevant title/body, and a `deep_link` pointing to the gift drop screen. For large user bases, batch this in pages of 1000 and schedule Expo push notifications via the push notification batch system already used elsewhere in the codebase. Ensure the notification is only sent once per drop by checking `announced_at IS NULL` before the UPDATE (already in place) — this is already idempotent.

---

**Fix 15 (BUG-033): Reject DodoPayments webhook when no coin amount can be determined**

FILES: `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

In `processPaymentSucceeded()`, after attempting to resolve `coinsGranted` from the price catalogue (by `itemSlug`), check whether the result is 0 and `itemSlug` was absent or unrecognised. If so, do not silently complete with 0 coins. Instead: log a `console.error` with the full payload for ops visibility, insert the payment reference into a `failed_webhooks` or `manual_review_queue` table, and return HTTP 200 (to prevent DodoPayments from retrying a fundamentally unresolvable payload). Raise an ops alert (Slack, email, etc.). Never deliver 0 coins silently on a successful payment.

---

## Phase 3 — Correctness

---

**Fix 16 (BUG-003): Implement token issuance in the `sessionToken` 2FA path**

FILES: `apps/web/app/api/auth/2fa/verify/route.ts`

The `sessionToken` branch currently returns `{ verified: true }` with no usable credential. Add the full token-issue path: sign a new access token and refresh token for the `userId` stored in the pending-2FA Redis record, create a Redis session entry, and return the tokens in the response body (since this path is for mobile/non-cookie callers). If the `sessionToken` concept is deprecated and all callers now use cookies, delete the entire branch and its Redis key handler — do not leave dead code that appears to authenticate but doesn't.

---

**Fix 17 (BUG-005): Handle username uniqueness race in Google OAuth callback**

FILES: `apps/web/app/api/auth/google/callback/route.ts`

Add a `try/catch` around the user INSERT that specifically handles PostgreSQL error code `23505` (unique_violation on the `users.username` column). On catching a `23505`, call `uniqueUsername()` again to generate a new candidate (the previous one was taken), then retry the INSERT once more. If the second attempt also fails (highly unlikely), return a 500 with a useful error message. This makes username assignment safe under concurrent OAuth sign-ups.

---

**Fix 18 (BUG-008): Restrict `checkDeckCompletion()` to the user's assigned deck quests only**

FILES: `apps/web/lib/quests/questEngine.ts`

Add a subquery or JOIN to the deck-completion check query: first get the user's active deck assignment from `user_quest_decks WHERE user_id = $1 AND assigned_date = CURRENT_DATE`, extract the quest IDs assigned to that deck, then count progress only for those specific quest IDs. If no active deck assignment is found, return false (no deck = not complete). This ensures that quest completions from other contexts (historical, different deck) do not falsely trigger the deck completion bonus.

---

**Fix 19 (BUG-013): Add idempotency guard to Daily CRON alliance war creation**

FILES: `apps/web/app/api/cron/daily/route.ts`

Add a unique constraint on the `alliance_wars` table covering `(guild_id_a, guild_id_b, scheduled_for::date)` (or the equivalent business key) if one doesn't exist: `CREATE UNIQUE INDEX IF NOT EXISTS alliance_wars_unique_daily ON alliance_wars (LEAST(guild_id_a, guild_id_b), GREATEST(guild_id_a, guild_id_b), scheduled_for::date)`. Then change the INSERT in Step 32 to `INSERT INTO alliance_wars … ON CONFLICT DO NOTHING`. This makes the step safe to run multiple times in one day.

---

**Fix 20 (BUG-016): Unify monthly plan bonus transaction type across CRON and Paystack webhook**

FILES: `apps/web/app/api/cron/daily/route.ts`, `apps/web/app/api/economy/webhooks/paystack/route.ts`

Pick one canonical `type` string for the monthly subscription bonus ledger entry — `'subscription_bonus'` is preferred as it matches the Paystack context. Update the CRON to use `'subscription_bonus'`. Define the canonical string as a shared constant in `lib/economy/types.ts` (or similar shared module) and import it in both files to prevent future drift. Standardise the `reference_id` format to `sub_bonus:{userId}:{YYYY-MM}` in both paths. Verify that the `ON CONFLICT (reference_id) DO NOTHING` guard on the ledger insert prevents any accidental duplicate from the coexistence of both paths.

---

**Fix 21 (BUG-018): Replace fixed-window geo-anomaly counter with a proper sliding window**

FILES: `apps/web/lib/security/geoAnomaly.ts`

Replace the `INCR` + conditional `EXPIRE` pattern with a Redis sorted-set sliding window — the same approach used in `lib/security/rateLimit.ts`. On each suspicious login from a new location: `ZADD geo_anomaly:{userId} <timestamp_ms> <timestamp_ms>`, then `ZREMRANGEBYSCORE … 0 <now - window_ms>`, then `ZCARD …` to get the count in the window. Set the sorted-set TTL to the window duration. This gives a true sliding window that cannot be gamed by straddling a fixed boundary. Keep the Lua script atomic for correctness.

---

**Fix 22 (BUG-019): Add explicit parentheses to CSRF condition to fix operator precedence**

FILES: `apps/web/middleware.ts` (line 197)

Change: `if ((pathname.startsWith("/api/") && !isPublicRoute(pathname) || isAuthMutation) && !isCsrfSafe(request))`

To: `if (((pathname.startsWith("/api/") && !isPublicRoute(pathname)) || isAuthMutation) && !isCsrfSafe(request))`

The change adds parentheses around the `||` sub-expression to make `isAuthMutation` a peer of the `&&` expression, not a lower-precedence alternative that changes evaluation order. This is a one-character structural change — add parentheses around the left side of the `||`. Add a comment above explaining the two independent conditions to prevent future regressions.

---

**Fix 23 (BUG-020): Remove default parameter from `awardReferralCommissions()` `paymentId`**

FILES: `apps/web/lib/referrals/commissions.ts`

Change the function signature from `awardReferralCommissions(buyerId, amount, paymentId = buyerId)` to `awardReferralCommissions(buyerId, amount, paymentId: string)` (required parameter, no default). TypeScript will immediately flag all call sites that omit `paymentId`. Visit each flagged call site and pass the actual Paystack payment reference, Dodo payment ID, or IAP purchase token as `paymentId`. This makes the deduplication key unambiguous at every call.

---

**Fix 24 (BUG-030): Incorporate a unique request/payment reference into the coin purchase idempotency key**

FILES: `apps/web/app/api/economy/coins/purchase/route.ts`

The idempotency key is currently `purchase:{userId}:{packId}:{YYYY-MM-DD}`. Change it to `purchase:{userId}:{packId}:{clientRequestId}` where `clientRequestId` is a UUID generated by the client and sent in the request body (the mobile/web app generates a new UUID per purchase attempt). The route stores this key in Redis for 24 hours to catch accidental double-submits (network retries), but a deliberate second purchase the same day uses a new UUID and is not blocked. If a `clientRequestId` is not provided, fall back to the Paystack-returned transaction reference after payment initiation.

---

**Fix 25 (BUG-031): Remove the duplicate HTML sanitizer from `announcements/engine.ts`**

FILES: `apps/web/lib/announcements/engine.ts`, `apps/web/lib/security/htmlSanitizer.ts`

Delete the local `sanitizeHtmlContent()` function in `announcements/engine.ts`. Import the canonical `sanitizeHtml()` (or equivalent) from `lib/security/htmlSanitizer.ts`. If announcement content requires `mailto:` link support that the canonical sanitizer doesn't currently allow, extend the canonical sanitizer's href-scheme allowlist to include `mailto:` rather than maintaining a separate implementation. Run a regression test on existing announcement content to confirm no previously-stored HTML is stripped differently after the switch.

---

**Fix 26 (BUG-032): Route AI classification through the Redis-backed circuit breaker in `lib/ai/client.ts`**

FILES: `apps/web/lib/moderation/aiClassifier.ts`

Delete the module-level `failureCount`, `circuitState`, `lastFailureTime` variables and all the manual circuit-breaker logic in `aiClassifier.ts`. Replace direct fetch/axios calls to the AI provider with calls to `aiClient.chat()` from `lib/ai/client.ts`, which already implements a Redis-backed, cross-instance circuit breaker with DeepSeek primary / Gemini fallback. This gives content moderation the same resilience as other AI calls without maintaining a separate (broken) circuit.

---

## Phase 4 — Cleanup

---

**Fix 27 (BUG-001): Remove dead `dynamic` export from login page**

FILES: `apps/web/app/auth/login/page.tsx`

Delete the line `export const dynamic = "force-dynamic"`. It has no effect in a Client Component and misleads readers. If dynamic rendering was the intent, the component needs to be restructured as a Server Component boundary that wraps the client interaction — but given it is an auth page with no server-rendered secrets, the default static-shell behaviour is correct.

---

**Fix 28 (BUG-004): Add bounds-check for empty `X-Forwarded-For` in rate limiter**

FILES: `apps/web/lib/security/rateLimit.ts`

Before the `ips[ips.length - TRUSTED_PROXY_COUNT - 1]` index, add: `if (ips.length === 0) { /* use request.ip fallback */ }`. Also add: `if (TRUSTED_PROXY_COUNT >= ips.length) { console.warn('[rateLimit] TRUSTED_PROXY_COUNT exceeds XFF depth — possible misconfiguration'); /* use ips[0] or block */ }`. These guards prevent undefined array accesses under edge configurations and make misconfiguration visible in logs rather than silently bypassing rate limiting.

---

**Fix 29 (BUG-011): Add error logging to `createSeasonCeremonyRoom()`**

FILES: `apps/web/lib/seasons/seasonEngine.ts`

In the `catch` block of `createSeasonCeremonyRoom()`, add `console.error('[seasonEngine] createSeasonCeremonyRoom failed:', err)` before returning `null`. Consider adding a Sentry/error-tracking call if the platform uses one. This is a minimal one-line change that makes the silence visible. A future improvement would be to let schema/auth errors propagate while only swallowing "duplicate room" conflicts, but the immediate fix is to at least log the error.

---

**Fix 30 (BUG-014): Fix contradictory streak-update date conditions in daily CRON**

FILES: `apps/web/app/api/cron/daily/route.ts`

Audit the `users` table schema to determine the single authoritative column for "last active day": is it `last_login_date` (a DATE), `last_login_at` (a TIMESTAMP), or both? Pick the single correct column for the streak-update WHERE clause. If `last_login_at` is the timestamp of the most recent login, the correct streak condition is: user logged in yesterday, i.e., `last_login_at::date = CURRENT_DATE - INTERVAL '1 day'`. Remove the contradictory `last_login_date = yesterday` filter entirely, or — if both columns must stay — ensure they are always written together in the same transaction so they are always consistent.

---

**Fix 31 (BUG-015): Fix monthly plan bonus to use the correct subscription status predicate**

FILES: `apps/web/app/api/cron/daily/route.ts`

Replace `WHERE is_active = true` with the schema-appropriate active-subscription predicate. If subscriptions use soft-delete: `WHERE deleted_at IS NULL AND status = 'active'`. If they use a status enum: `WHERE status = 'active'`. Check the actual `subscriptions` table migration to confirm the correct columns and values. If no `is_active` column exists, this query currently throws a runtime error every day, which means the monthly plan bonus is never being awarded. Verify by checking logs or the coins ledger for `monthly_plan_bonus` entries.

---

**Fix 32 (BUG-017): Use the shared `insertNotification()` helper for all notification inserts in Paystack webhook**

FILES: `apps/web/app/api/economy/webhooks/paystack/route.ts`

Both the subscription-event notification and the payout notification in this file should call `insertNotification()` from `lib/notifications/insert.ts` instead of writing raw INSERT SQL. The helper enforces the correct column schema (`user_id, title, body, type, metadata`) and prevents the `payload` vs `title/body/metadata` inconsistency. Update both notification INSERT calls to use the helper.

---

**Fix 33 (BUG-028): Remove dead `CONNECTION_BADGE_THRESHOLD` constant**

FILES: `apps/web/lib/messaging/conversationScore.ts`

Delete `const CONNECTION_BADGE_THRESHOLD = 50`. Add a comment on `CONNECTION_BADGE_STREAK_DAYS = 7` clarifying that the Connection Badge is awarded based on a 7-consecutive-day messaging streak, not a score threshold. If a score-based badge was intended as a future feature, track it in a GitHub issue rather than leaving a dangling constant that implies implemented logic.

---

## Migration Checklist

Before deploying fixes, confirm the following database objects exist (create migrations if not):

- [ ] `users.telegram_reengagement_sent_at` (TIMESTAMPTZ, nullable) — required for Fix 9
- [ ] `leaderboard_snapshots` unique index on `(user_id, period)` — required for Fix 12
- [ ] `alliance_wars` unique index on daily war business key — required for Fix 19
- [ ] `coin_ledger` unique index on `reference_id` — required for Fix 3
- [ ] `subscriptions` table: confirm correct `status` column name — required for Fix 31
- [ ] `notifications` table: confirm column schema matches `insertNotification()` helper — required for Fix 32
- [ ] `gift_drops.announced_at` column exists — appears to be in place already

## Credential Rotation Required

After Fix 5 (BUG-025 — Gemini API key in URL):

- [ ] Rotate the Gemini API key in Google Cloud Console immediately after deploying the fix
- [ ] Update the `GEMINI_API_KEY` (or equivalent) environment variable in all deployment environments (Vercel, Railway, etc.)
- [ ] Check server access logs / CDN logs for the previous key value and confirm rotation succeeded

---

*Plan generated: 2026-06-14 at 6:06 AM UTC*  
*33 bugs — 33 fixes — do not begin implementation until plan is reviewed and approved*
