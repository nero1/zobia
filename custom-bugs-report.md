# Zobia Social — Forensic Bug Report
**Generated:** Thursday, June 19, 2026 — 12:00 AM (UTC)
**Analyst:** Independent forensic analysis (no prior bug reports referenced)
**Scope:** `apps/web` (Next.js 14 App Router, PWA), `apps/expo` (Android), `packages/`

---

## Code Quality Rating

| Dimension | Current | Post-Fix |
|---|---|---|
| Overall | **6.5 / 10** | **8.5 / 10** |
| Security | 8.5 / 10 | 9.0 / 10 |
| Data Integrity | 5.5 / 10 | 9.0 / 10 |
| Economy/Payments | 7.0 / 10 | 9.0 / 10 |
| Correctness | 6.0 / 10 | 8.5 / 10 |
| Architecture | 8.0 / 10 | 8.5 / 10 |

**Review:** The codebase is structurally solid. JWT auth, CSRF protection, CSP hardening, Decimal.js economy, append-only coin/star ledger with SELECT FOR UPDATE idempotency, Redis circuit breakers, and DLQ retry patterns are all well-implemented. However, several critical data-integrity bugs will silently fail in production: the leaderboard ON CONFLICT clause is guaranteed to misbehave on every write, the Paystack subscription.disable webhook fires the wrong handler branch causing immediate incorrect plan downgrades, the guild war draw outcome is never recorded, and the monthly plan bonus CRON ON CONFLICT has the wrong column list that will make it fail every 1st of the month. These critical bugs hide behind best-effort try/catch blocks and will never surface as visible errors until a user complains.

---

## Bug Summary (Quick Reference)

```
BUG-01: Leaderboard upsert ON CONFLICT columns mismatch database unique constraint
BUG-02: safeAwardXP never updates leaderboard snapshots — leaderboard always stale
BUG-03: Daily login XP cron skips leaderboard snapshot update
BUG-04: Login streak / daily XP cron has 24-hour delay — uses CURRENT_DATE-1 not today
BUG-05: Paystack subscription.disable event unreachable — isCancelled branch fires first
BUG-06: DM duplicate-message detection never runs — wrong messageContext always passed
BUG-07: Guild war draw outcome never recorded — draw always treated as challenger win
BUG-08: Monthly plan bonus ON CONFLICT missing user_id — PostgreSQL throws every 1st of month
BUG-09: Admin createSession does not return refreshTtl — admin refresh cookie has wrong expiry
BUG-10: DM daily coin-limit check is a TOCTOU race — concurrent sends can exceed limit
BUG-11: guild_tier_history stores from_tier = to_tier — tier change history always wrong
BUG-12: Expo push send-batch failure drops messages silently — no DLQ on send side
BUG-13: Hall of Fame injection ignores pageSize — page 1 can exceed requested size
BUG-14: DodoPayments subscription ends_at hardcoded to NOW()+1 month — ignores actual billing
BUG-15: Gaming track missing from earnable sticker CASE — gaming sticker packs never unlock
BUG-16: Rate limiter L1 cache is per-instance — 30% overage possible across instances
BUG-17: fieldEncryption keyCache is unbounded — minor memory leak under key rotation
BUG-18: Inconsistent notification payload column usage — mixed payload vs title/body paths
BUG-19: useOfflineSync fixed retry delay — no exponential backoff for offline message retry
BUG-20: flashXP toLocaleTimeString uses en-NG locale — Node.js locale support not guaranteed
BUG-21: Redundant login_streak / login_streak_days dual-update in CRON
BUG-22: Comeback coin reversal non-unique referenceId — second reversal silently skipped
```

---

## Detailed Bug Descriptions

---

### BUG-01
**Leaderboard upsert ON CONFLICT columns mismatch the database unique constraint**

FILES: `apps/web/lib/leaderboards/engine.ts`, `apps/web/app/api/cron/leaderboards/route.ts`

FIX: Both `upsertLeaderboardSnapshot` and the leaderboard CRON batch-upsert use `ON CONFLICT (user_id, track, scope, COALESCE(city, ''), COALESCE(season_id::text, ''))`. PostgreSQL ON CONFLICT column-list targets must exactly match a real unique index. The schema's unique constraint on `leaderboard_snapshots` uses `IS NOT DISTINCT FROM` semantics or an expression index — not a bare COALESCE in the ON CONFLICT column list. Either: (a) create a matching expression unique index on `(user_id, track, scope, COALESCE(city,''), COALESCE(season_id::text,''))` in the schema migration, or (b) use `ON CONFLICT ON CONSTRAINT <constraint_name>` referencing the actual named constraint. Until fixed, every call to `upsertLeaderboardSnapshot` will either error with "there is no unique or exclusion constraint matching the ON CONFLICT specification" or silently insert duplicate leaderboard rows. This affects real-time XP awards, quest completions, season milestone XP, and the leaderboard CRON.

---

### BUG-02
**`safeAwardXP` never calls `upsertLeaderboardSnapshot` — leaderboard is always stale**

FILES: `apps/web/lib/xp/safeAwardXP.ts`, `apps/web/lib/leaderboards/engine.ts`

FIX: After the CTE-based `UPDATE users SET xp_total = ...` succeeds, `safeAwardXP` does not call `upsertLeaderboardSnapshot` for the affected user. The leaderboard only updates when the 15-minute external CRON fires, so all real-time XP events (gifts, quests, game rewards, flash XP, referral bonuses) are invisible on the leaderboard for up to 15 minutes. Add a best-effort (fire-and-forget) call to `upsertLeaderboardSnapshot(userId, track, newXpValue, db)` after the main CTE executes. The same gap exists in the `retryFailedXPAwards` retry path and must be fixed there too.

---

### BUG-03
**Daily login XP cron updates `xp_total` but never calls `upsertLeaderboardSnapshot`**

FILES: `apps/web/app/api/cron/daily-core/route.ts`

FIX: The daily login XP section runs a CTE that inserts into `xp_ledger` and updates `users.xp_total` for all users who logged in the previous day. There is no subsequent `upsertLeaderboardSnapshot` call. After the CTE completes, collect the `user_id` values from the `awarded` CTE RETURNING clause and call a batch `upsertLeaderboardSnapshot` for each (or run a single bulk-upsert as done in the leaderboard CRON). Otherwise the daily login XP bump is not reflected on the leaderboard until the next CRON cycle.

---

### BUG-04
**Login streak increment and daily login XP have a 24-hour delay**

FILES: `apps/web/app/api/cron/daily-core/route.ts`

FIX: The streak-increment query uses `WHERE last_login_date = CURRENT_DATE - 1` and the daily login XP query uses the same condition. The CRON runs at 23:00 UTC. A user who logs in today (any time 00:00–22:59 UTC) has `last_login_date = CURRENT_DATE`. The CRON only credits that login the following night when today becomes `CURRENT_DATE - 1`. Change both conditions to `WHERE last_login_date = CURRENT_DATE` so the same-day login gets its streak increment and XP on the day it occurs. Verify there is no double-award risk: the XP ledger ON CONFLICT on `reference_id = 'daily_login:' || id || ':' || CURRENT_DATE` already prevents duplicates.

---

### BUG-05
**Paystack `subscription.disable` event is unreachable — `isCancelled` branch fires first**

FILES: `apps/web/lib/payments/paystackWebhookHandler.ts`

FIX: In `processSubscriptionEvent`, the chain checks `isNonRenewing` and `isCancelled` (both derived from `data.status`) before checking `event.event === "subscription.disable"`. When Paystack sends a `subscription.disable` event it often sets `status = "cancelled"`, so the `isCancelled` branch fires first and immediately downgrades the user to `plan = "free"`. A `subscription.disable` should be treated as non-renewing (plan stays active until the current billing period ends). Move the `event.event === "subscription.disable"` check to the top of the if/else chain, ahead of any status-based conditions. Status checks should only be fallbacks for event types where the event name alone does not indicate the action.

---

### BUG-06
**DM duplicate-message detection never runs — wrong `messageContext` always passed**

FILES: `apps/web/lib/moderation/contentFilter.ts`

FIX: `applyAutoModeration` calls `detectDuplicateMessage(userId, content, "room")` with a hardcoded `"room"` argument regardless of message type. The `messageContext` parameter controls which table is queried for recent messages — passing `"room"` for a DM queries the wrong table, so repeated DM content is never flagged. The caller must pass the correct context: `"dm"` when processing a direct message (i.e. when a `conversationId` is present), `"room"` otherwise. Update all call sites of `applyAutoModeration` to pass the derived context.

---

### BUG-07
**Guild war draw outcome never recorded — every draw is treated as a challenger win**

FILES: `apps/web/lib/guilds/warEngine.ts`

FIX: In `resolveWar`, `let outcome: "win" | "draw" = "win"` is declared but never reassigned to `"draw"` when `challengerScore === defenderScore`. The draw detection sets the `isTie` flag (used correctly in reward distribution), but the `war_results` DB record is written with `outcome = "win"` for all draws. Add `outcome = "draw"` inside the draw detection branch before the DB write. No other changes are needed — `isTie` is already used downstream to skip win-only rewards.

---

### BUG-08
**Monthly plan bonus ON CONFLICT missing `user_id` — PostgreSQL throws every 1st of month**

FILES: `apps/web/app/api/cron/daily-economy/route.ts`

FIX: The monthly plan bonus CTE uses `ON CONFLICT (transaction_type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING` on `coin_ledger`. The actual unique index `uidx_coin_ledger_tx_type_ref` (schema.ts line 1948) is on `(user_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL` — three columns, not two. PostgreSQL rejects this with "there is no unique or exclusion constraint matching the ON CONFLICT specification", causing the entire transaction to fail and no user receiving their monthly bonus. Change to `ON CONFLICT (user_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`.

---

### BUG-09
**Admin `createSession` return type omits `refreshTtl` — admin refresh cookie set with wrong max-age**

FILES: `apps/web/lib/auth/session.ts`

FIX: `createSession` returns `{ accessToken, refreshToken, expiresIn: accessTtl }` — the `AuthTokens` interface does not include `refreshTtl`. Login route handlers that call `createSession` for admin users cannot read the admin-specific refresh TTL (1 hour, vs 30 days for regular users) from the return value. Consequently the `zobia_rt` cookie `maxAge` is set using a default or wrong TTL. Add a `refreshTtl` field to the `AuthTokens` interface and populate it in `createSession`'s return value using the same TTL that was passed to `signRefreshToken`.

---

### BUG-10
**DM daily coin-limit check is a TOCTOU race — concurrent sends can exceed the daily limit**

FILES: `apps/web/lib/messaging/coinCost.ts`

FIX: `checkDailyLimitReached` reads the Redis counter and `incrementDailyCount` increments it in two separate operations. Under concurrent DM sends (multiple tabs or rapid retries), both reads can observe the same below-limit counter value and both proceed, allowing more messages than the daily cap. Replace with an atomic check-and-increment: call Redis `INCR` and then compare the returned value against the limit. If the result exceeds the limit, decrement it (or let it stand but reject the request). A short Lua script `if redis.call('INCR', key) > limit then return 1 else ... end` is the cleanest solution.

---

### BUG-11
**`guild_tier_history` INSERT stores `from_tier = to_tier` — tier change history is always wrong**

FILES: `apps/web/lib/guilds/warEngine.ts`

FIX: In `resolveWar`, the `guild_tier_history` row is inserted with both `from_tier` and `to_tier` set to the same `tier` variable. This variable is the guild's new computed tier, so `from_tier` (the pre-war tier) is never captured. Before updating the guild's tier, read the current tier from the `guilds` table and store it as `fromTier`. Pass `fromTier` as `from_tier` and the newly computed tier as `to_tier` in the INSERT.

---

### BUG-12
**Expo push send-batch failure silently drops notifications — no retry or DLQ on send side**

FILES: `apps/web/lib/notifications/push.ts`

FIX: In `sendExpoBatch`, when `fetch(EXPO_PUSH_URL)` returns a non-2xx response, the function logs the error and returns an empty stale-token set. The affected notifications are gone — no tickets are saved, no retry entry is created. Add a DLQ path: on a failed batch send, insert the `(userId, token, title, body, data)` tuples into a `failed_push_sends` table with `retry_count = 0`. The existing daily CRON (which already handles push receipt polling) can include a step to retry these entries with the same send logic. At minimum, insert a `system_alerts` row so the team is notified of a send failure.

---

### BUG-13
**`getLeaderboard` Hall of Fame injection ignores `pageSize` — page 1 can return too many entries**

FILES: `apps/web/lib/leaderboards/engine.ts`

FIX: On page 1, `getLeaderboard` appends HoF users not already present in the paginated result set without re-applying the `pageSize` limit to the final array. If there are many HoF users absent from the top-N results, the returned array exceeds `pageSize`. After combining the regular results and HoF entries, apply `slice(0, pageSize)` to the final array, or cap the HoF injection at `Math.max(0, pageSize - results.length)` entries.

---

### BUG-14
**DodoPayments subscription `ends_at` hardcoded to `NOW() + 1 month` regardless of billing cycle**

FILES: `apps/web/lib/payments/dodoWebhookHandler.ts`

FIX: In `processPaymentSucceeded`, when the item type is `subscription`, `ends_at` is unconditionally set to `NOW() + INTERVAL '1 month'`. Annual subscribers receive a 1-month expiry. The DodoPayments webhook event payload contains billing period information (e.g. `next_billing_date` or equivalent). Extract this date from the event payload and use it as `ends_at`. Fall back to `NOW() + INTERVAL '1 month'` only if the field is absent or unparseable.

---

### BUG-15
**Gaming track missing from earnable sticker CASE — gaming-track sticker packs never auto-unlock**

FILES: `apps/web/app/api/cron/daily-social/route.ts`

FIX: In step 6 (earnable sticker pack auto-unlock), the CASE expression maps `unlock_condition` patterns like `social_level_N` to `u.level_social`, `creator_level_N` to `u.level_creator`, etc., but there is no `WHEN sp.unlock_condition LIKE 'gaming_level_%' THEN u.level_gaming` branch. Sticker packs with `gaming_level_*` unlock conditions fall through to `ELSE 0` and are never granted. Add the missing WHEN branch. The `level_gaming` column exists in the `users` table (confirmed in `schema.ts` line 154).

---

### BUG-16
**Rate limiter L1 in-process skip cache is per-serverless-instance — limit can be overshot by ~30%**

FILES: `apps/web/lib/security/rateLimit.ts`

FIX: The L1 skip cache allows a request to bypass Redis if the in-process counter shows the user is below 70% of the limit (`skipThreshold = limit * 0.7`). On a multi-instance deployment, each instance's L1 counter is independent. A user can make `instances × (limit × 0.7)` requests before any instance hits Redis. On 3 instances with a 10 req/min limit, a determined user can make ~21 req/min. For sensitive endpoints (auth, payments, gifts), disable the L1 cache entirely (`bypassL1: true` option). For content endpoints, lower the skip threshold to 40% to reduce the worst-case overshoot.

---

### BUG-17
**`fieldEncryption.ts` `keyCache` Map is unbounded — minor memory leak under key rotation**

FILES: `apps/web/lib/security/fieldEncryption.ts`

FIX: The module-level `keyCache` Map accumulates derived encryption keys and is never evicted. Under normal operation (stable keys) this is fine. During active key rotation, each unique cache key combination (field + key version) adds an entry that persists for the process lifetime. Cap the cache at a fixed size (e.g. 50 entries) using an LRU eviction strategy, or use the `lru-cache` package. As a simpler fix, use a WeakMap keyed on the raw key buffer so entries are garbage-collected when the key buffer goes out of scope.

---

### BUG-18
**Notification inserts use inconsistent column sets — mixed `payload` vs `title`/`body`/`metadata`**

FILES: `apps/web/lib/notifications/insert.ts`, `apps/web/app/api/cron/daily-social/route.ts`, `apps/web/app/api/cron/daily-users/route.ts`, `apps/web/lib/events/flashXP.ts`, `apps/web/lib/leaderboards/engine.ts`

FIX: The centralised `lib/notifications/insert.ts` helper writes `title`, `body`, and `metadata` columns. Direct SQL in several CRON routes and feature modules writes only the `payload` jsonb column (or some write both). The notification UI reads one or the other — whichever pattern is inconsistent will render blank notifications. Audit all notification INSERT sites and standardise: either route all writes through `lib/notifications/insert.ts`, or explicitly set both `payload` and the individual text columns in every direct INSERT. Remove the `payload` column from the schema if it is redundant, or make it the sole source of truth.

---

### BUG-19
**`useOfflineSync` (PWA) uses a fixed 2-second retry delay — no exponential backoff**

FILES: `apps/web/lib/offline/useOfflineSync.ts`

FIX: `RETRY_DELAY_MS = 2000` is a compile-time constant. Every retry fires after the same 2-second pause regardless of how many times the send has failed. Under intermittent connectivity or a degraded backend, this hammers the server. Change to exponential backoff: `delay = Math.min(2000 * Math.pow(2, attemptCount), 60_000)`. The existing `MAX_ATTEMPTS = 5` ceiling already prevents infinite retries; only the delay calculation needs updating.

---

### BUG-20
**`flashXP.ts` uses `toLocaleTimeString("en-NG")` — Node.js locale support is environment-dependent**

FILES: `apps/web/lib/events/flashXP.ts`

FIX: `new Date().toLocaleTimeString("en-NG")` depends on the `en-NG` ICU locale being present in the Node.js runtime's ICU data. Vercel production uses full ICU, so it works there. However local dev environments, CI Docker images, or alternative hosting environments built with `--with-intl=small-icu` will silently fall back to a different locale or throw. Replace with a portable UTC-to-WAT conversion using `Intl.DateTimeFormat` with an explicit `timeZone: "Africa/Lagos"` option, or format the time manually from UTC offsets.

---

### BUG-21
**Daily-core CRON sets both `login_streak_days` and `login_streak` to the same value**

FILES: `apps/web/app/api/cron/daily-core/route.ts`

FIX: The streak-increment UPDATE sets `login_streak_days = login_streak_days + 1, login_streak = login_streak_days + 1` in the same statement. After the update both columns hold the same incremented value. If the two columns serve different purposes (e.g. `login_streak_days` is the current streak and `login_streak` is the highest-ever streak), this is a logic error — `login_streak` should only increase, never decrease. If they are duplicates, remove one. Clarify the intent in the schema and update the query accordingly. The reset query has the same pattern.

---

### BUG-22
**Comeback coin reversal uses a non-unique `referenceId` — second reversal for same user silently skipped**

FILES: `apps/web/app/api/cron/daily-users/route.ts`

FIX: In step 3 (expire unclaimed comeback coin reservations), `debitCoins` is called with `referenceId = 'comeback_reversal:${row.user_id}'`. If a user has two separate unclaimed `comeback_bonus_reserved` entries (from multiple comeback campaigns), the second debit uses the same reference ID as the first. The partial unique index on `coin_ledger(user_id, transaction_type, reference_id)` causes the second INSERT to be skipped, leaving the second bonus unreversed. The fix is to include a unique discriminator in the reference ID — use the `coin_ledger.id` of the original `comeback_bonus_reserved` entry: `comeback_reversal:${row.user_id}:${row.ledger_id}`. This requires the outer query to also select the ledger entry's `id`.

---

## Summary Table

| # | Severity | Category | Primary File(s) |
|---|---|---|---|
| BUG-01 | **Critical** | Data Integrity | `lib/leaderboards/engine.ts`, `api/cron/leaderboards/route.ts` |
| BUG-02 | **Critical** | Data Integrity | `lib/xp/safeAwardXP.ts` |
| BUG-03 | **Critical** | Data Integrity | `api/cron/daily-core/route.ts` |
| BUG-04 | **Critical** | Logic | `api/cron/daily-core/route.ts` |
| BUG-05 | **Critical** | Payments | `lib/payments/paystackWebhookHandler.ts` |
| BUG-06 | **Critical** | Moderation | `lib/moderation/contentFilter.ts` |
| BUG-07 | **Critical** | Game Logic | `lib/guilds/warEngine.ts` |
| BUG-08 | **Critical** | Economy CRON | `api/cron/daily-economy/route.ts` |
| BUG-09 | **Medium** | Auth | `lib/auth/session.ts` |
| BUG-10 | **Medium** | Economy | `lib/messaging/coinCost.ts` |
| BUG-11 | **Medium** | Game Logic | `lib/guilds/warEngine.ts` |
| BUG-12 | **Medium** | Notifications | `lib/notifications/push.ts` |
| BUG-13 | **Medium** | API | `lib/leaderboards/engine.ts` |
| BUG-14 | **Medium** | Payments | `lib/payments/dodoWebhookHandler.ts` |
| BUG-15 | **Medium** | Feature | `api/cron/daily-social/route.ts` |
| BUG-16 | Low | Security | `lib/security/rateLimit.ts` |
| BUG-17 | Low | Performance | `lib/security/fieldEncryption.ts` |
| BUG-18 | Low | Consistency | Multiple notification write sites |
| BUG-19 | Low | UX | `lib/offline/useOfflineSync.ts` |
| BUG-20 | Low | Portability | `lib/events/flashXP.ts` |
| BUG-21 | Low | Redundancy | `api/cron/daily-core/route.ts` |
| BUG-22 | Low | Economy | `api/cron/daily-users/route.ts` |

---

*Report completed: Thursday, June 19, 2026 — 12:00 AM (UTC)*
*Do not implement any fixes until this report has been reviewed and the fix plan approved.*
