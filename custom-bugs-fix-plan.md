# Zobia Social — Bug Fix Plan
**Date:** Saturday, June 20, 2026 | **Time:** 9:17 PM UTC

---

## Overview

This plan covers all 19 bugs identified in the independent forensic report (`custom-bugs-report.md`). Fixes are ordered by severity and dependency. Do NOT begin any fixes until this plan has been reviewed. No existing code should be touched without a corresponding entry below being checked off.

Bugs are grouped into three fix phases:
- **Phase 1 (Critical — fix first):** Schema/SQL mismatches causing runtime crashes or silent data loss
- **Phase 2 (High — fix before next release):** Behavioral failures affecting payments, auth security, and notifications
- **Phase 3 (Medium — fix in current sprint):** Security hardening and mobile UX correctness

---

## Phase 1 — Critical Schema / SQL Fixes

### Fix 1: Add unique index to `failed_xp_awards`
**Bug:** BUG-XDL-01
**Risk:** Without this fix, every failed XP award is permanently lost — the DLQ is broken.

**Tasks:**
1. Write a migration adding: `CREATE UNIQUE INDEX uidx_failed_xp_awards_ref ON failed_xp_awards (user_id, source, reference_id) WHERE reference_id IS NOT NULL;`
2. In `apps/web/lib/db/schema.ts`, add `uniqueIndex('uidx_failed_xp_awards_ref').on(table.userId, table.source, table.referenceId).where(sql`reference_id IS NOT NULL`)` to the `failedXpAwards` table definition.
3. No application code changes required — `safeAwardXP.ts` already has the correct `ON CONFLICT` clause, it just needs the index to exist.
4. After deploying the migration, verify by intentionally triggering a DLQ scenario in staging and confirming the `failed_xp_awards` row is inserted correctly.

---

### Fix 2: Add unique index to `audit_discrepancies`
**Bug:** BUG-AUD-01
**Risk:** Balance discrepancy tracking is a complete no-op without this index.

**Tasks:**
1. Write a migration adding: `CREATE UNIQUE INDEX uidx_audit_discrepancies_user_asset ON audit_discrepancies (user_id, asset_type);`
2. In `apps/web/lib/db/schema.ts`, add the corresponding Drizzle index to the `auditDiscrepancies` table.
3. No application code changes required in the CRON routes — they already use the correct `ON CONFLICT (user_id, asset_type) DO UPDATE` syntax.
4. Note: `audit_discrepancies` already has a `resolved` boolean column (confirmed in schema), so the CRON's `resolved = FALSE` upsert value is correct once the index exists.

---

### Fix 3: Fix `failed_webhooks` column name mismatches in webhook retry CRON
**Bug:** BUG-WBK-01
**Risk:** The entire webhook retry system never executes a single successful query.

**Tasks:**
1. In `apps/web/app/api/cron/daily-platform/route.ts`, find the webhook retry block and make these SQL fixes:
   - `WHERE resolved = false` → `WHERE resolved_at IS NULL`
   - `SET resolved = true, updated_at = NOW()` (success path, line ~505) → `SET resolved_at = NOW(), updated_at = NOW()`
   - `SET resolved = true, resolved_at = NOW(), updated_at = NOW()` (line ~509) → `SET resolved_at = NOW(), updated_at = NOW()` (remove the invalid `resolved = true`)
   - `SET retry_count = ..., last_error = $2` (line ~517) → `SET retry_count = ..., error = $2`
2. Run a local query against `failed_webhooks` to confirm the column names match: `id, provider, event_type, payload, error, retry_count, next_retry_at, resolved_at, created_at`.
3. Write a test that seeds a `failed_webhooks` row and verifies the retry CRON updates `resolved_at` correctly.

---

### Fix 4: Add `wars_drawn` column to `guilds` table
**Bug:** BUG-WAR-01
**Risk:** Any guild war that ends in a draw crashes the entire resolution transaction — war remains stuck as `active` forever.

**Tasks:**
1. Write a migration adding: `ALTER TABLE guilds ADD COLUMN wars_drawn INTEGER NOT NULL DEFAULT 0;`
2. In `apps/web/lib/db/schema.ts`, add `warsDrawn: integer("wars_drawn").notNull().default(0)` to the `guilds` table alongside `warsWon` and `warsLost` (line ~765).
3. No changes to `warEngine.ts` required — the code already correctly references `wars_drawn`.
4. Also check if the `alliances` table (if it tracks wins/losses separately) needs a similar `draws` column for Fix 9 (alliance war tie resolution).

---

### Fix 5: Fix Dodo webhook store item lookup — `slug` column does not exist
**Bug:** BUG-DOD-01
**Risk:** All Dodo coin/star pack purchases succeed on the payment provider side but deliver no coins/stars to the user.

**Tasks:**
1. Decide on the canonical lookup key: since the Paystack handler uses `WHERE id = $1` (UUID), align the Dodo handler to also use `id`. This requires that Dodo payment metadata stores the store item `id` (UUID) in `itemSlug` — audit the Dodo payment initiation flow (`apps/web/app/api/economy/coins/purchase/route.ts`) to confirm what is stored in the `metadata` object sent to Dodo.
2. If `itemSlug` in Dodo metadata already contains the UUID, change `dodoWebhookHandler.ts` to `SELECT ... FROM store_items WHERE id = $1` using that UUID.
3. If `itemSlug` genuinely contains a text slug, add a `slug` column to `store_items` via migration (`ALTER TABLE store_items ADD COLUMN slug TEXT UNIQUE`) and populate it for all existing rows.
4. Option 3 (recommended for future flexibility): Add `slug` column to `store_items`, populate it, and update both Paystack and Dodo handlers to accept both id and slug lookups with a fallback.
5. Add an integration test covering the Dodo `payment.succeeded` event for a `coin_pack` to verify coins are credited.

---

## Phase 2 — High Severity Fixes

### Fix 6: Add webhook endpoints to `PUBLIC_PREFIXES`
**Bug:** BUG-CSRF-WBK
**Risk:** No payment webhooks are being received. All coin credits, star credits, payout completions, and subscription activations from Paystack and Dodo are silently failing.

**Tasks:**
1. In `apps/web/middleware.ts`, add both paths to the `PUBLIC_PREFIXES` array:
   ```
   "/api/economy/webhooks/paystack",
   "/api/economy/webhooks/dodopayments",
   ```
2. The routes themselves already validate HMAC signatures before any processing, so bypassing the middleware CSRF check is safe.
3. Optionally, also add a comment explaining that these paths use provider-side HMAC auth instead of Origin-based CSRF.
4. Verify by running a local Paystack webhook simulation (e.g., using the Paystack CLI or a curl POST with the correct HMAC header) and confirming the route handler is reached.

---

### Fix 7: Add `await` to `verifyTotp()` call in 2FA setup POST
**Bug:** BUG-2FA-01
**Risk:** Any user can enable 2FA with any code — or an attacker with brief access can set a known 2FA code.

**Tasks:**
1. In `apps/web/app/api/auth/2fa/setup/route.ts` line 122, change:
   `if (!verifyTotp(pendingSecret, code))`
   to:
   `if (!(await verifyTotp(pendingSecret, code)))`
2. Audit all other call sites of `verifyTotp` across the codebase to confirm no other missing `await` exists (the admin TOTP handler already correctly awaits it).
3. Add a test case: seed a pending TOTP secret, call the POST endpoint with an incorrect code, and assert the response is an error — not a success.

---

### Fix 8: Apply device_id deduplication in `sendPushNotificationBatch`
**Bug:** BUG-PUSH-01
**Risk:** Users with multiple registered push tokens (after reinstalls or device changes) receive duplicate notifications for every batch push call (mystery XP drops, leaderboard alerts, announcements).

**Tasks:**
1. In `apps/web/lib/notifications/push.ts`, locate `sendPushNotificationBatch`.
2. Before constructing the Expo messages array, group recipient tokens by `device_id`. For each `userId`, query their push tokens and apply the same deduplication logic used in `sendPushNotification` — select only the most recently registered token per unique `device_id`.
3. Alternatively, extract the device-id dedup into a shared helper `getDeduplicatedTokensForUser(userId)` and use it in both the single and batch paths.
4. Consider adding a `device_id` column to the push tokens table if it does not already exist and populate it from the Expo registration flow.

---

### Fix 9: Fix alliance war tie resolution to declare a draw
**Bug:** BUG-AWAR-01
**Risk:** Every tied alliance war incorrectly credits a win to alliance_1, distorting win records and awarding unearned rewards.

**Tasks:**
1. In `apps/web/app/api/cron/daily-platform/route.ts`, find the alliance war resolution block.
2. Change `if (score1 >= score2)` to `if (score1 > score2)` for a clear win.
3. Add an `else if (score1 === score2)` branch:
   - Set `winner_alliance_id = NULL`, status = 'draw' (or 'completed')
   - Do not increment `wars_won` for either alliance
   - Award draw XP to members of both alliances (analogous to the guild war draw XP in `warEngine.ts`)
   - If the alliances/guilds table has a `wars_drawn` column after Fix 4, increment it for both
4. If there is no `draws` counter on alliances yet, add the column as part of this fix's migration.

---

### Fix 10: Set `reference_id` on rank-change notifications to enable ON CONFLICT dedup
**Bug:** BUG-NOTIF-01
**Risk:** Every CRON run duplicates rank-change notifications — users accumulate hundreds of stale alerts.

**Tasks:**
1. In `apps/web/app/api/cron/leaderboards/route.ts`, find the rank-change notification INSERT.
2. Populate `reference_id` with a deterministic key scoped to the user, track, scope, and day: e.g., `rank_change:${userId}:${track}:${scope}:${new Date().toISOString().slice(0, 10)}`.
3. The partial unique index `UNIQUE(user_id, type, reference_id) WHERE reference_id IS NOT NULL` will then correctly suppress re-insertions within the same day.
4. Optionally purge historical duplicate rank-change notifications older than 7 days as a one-time cleanup.

---

### Fix 11: Fix guild tier promotion running after demotion in same loop
**Bug:** BUG-GTIER-01

**Tasks:**
1. In `apps/web/app/api/cron/daily-guilds/route.ts`, find the per-guild tier evaluation loop.
2. After the demotion block, add an early `continue` to skip the promotion check in the same iteration (since a just-demoted guild should not be immediately re-evaluated for promotion using stale tier state).
3. Alternatively, record the new tier in a local variable immediately after demotion and use that variable in the promotion check — but `continue` is simpler and less error-prone.
4. Verify with a test case: a guild at tier boundary that meets demotion criteria should end the loop iteration as demoted, with no promotion applied.

---

### Fix 12: Log guild tier demotions to `guild_tier_history`
**Bug:** BUG-GTIER-02

**Tasks:**
1. In `apps/web/app/api/cron/daily-guilds/route.ts`, locate the demotion block.
2. After the demotion UPDATE, insert a row into `guild_tier_history` matching the structure of the promotion entry: `(guild_id, from_tier, to_tier, guild_xp_at, timestamp)`.
3. The `from_tier` should be the guild's tier before demotion; `to_tier` is the demoted tier.

---

## Phase 3 — Medium Severity Fixes

### Fix 13: Add unique constraint to `guildQuestContributions`
**Bug:** BUG-GQST-01

**Tasks:**
1. Write a migration: `CREATE UNIQUE INDEX uidx_guild_quest_contributions_quest_user ON guild_quest_contributions (quest_id, user_id);`
2. In `apps/web/lib/db/schema.ts`, add the corresponding Drizzle unique index.
3. Update the contribution INSERT in the quest engine to use `ON CONFLICT (quest_id, user_id) DO UPDATE SET amount = guild_quest_contributions.amount + EXCLUDED.amount` rather than a bare INSERT, so concurrent requests accumulate safely rather than failing.

---

### Fix 14: Call `upsertLeaderboardSnapshot` after season milestone XP bonus claim
**Bug:** BUG-SLDR-01

**Tasks:**
1. In `apps/web/lib/seasons/seasonEngine.ts`, in `claimPassMilestone()`, find the `xp_bonus` reward type handler (after the CTE-gated UPDATE users query, lines ~589–609).
2. After the UPDATE commits (still inside the transaction), call `upsertLeaderboardSnapshot(userId, 'main', newXpTotal, client)`. The new `xp_total` value needs to be retrieved — either use a `RETURNING xp_total` clause on the UPDATE, or fetch it separately.
3. If the season has an active `season_id`, also upsert the season-scope snapshot.

---

### Fix 15: Update city and season leaderboard snapshots after daily login XP
**Bug:** BUG-LDB-01

**Tasks:**
1. In `apps/web/app/api/cron/daily-core/route.ts`, after the daily login XP batch award, extend the `upsertLeaderboardSnapshot` calls to also cover city and season scopes.
2. For users with a non-null `city`, call `upsertLeaderboardSnapshot(userId, 'main', xpTotal, db, { scope: 'city', city: user.city })`.
3. If an active season exists (call `getCurrentSeason`), also call `upsertLeaderboardSnapshot(userId, 'main', xpTotal, db, { scope: 'season', seasonId: activeSeasonId })`.
4. Batch these additional upserts using `unnest` if performance with many users is a concern (similar to the existing global batch upsert).

---

### Fix 16: Remove `'unsafe-inline'` from `style-src` CSP directive
**Bug:** BUG-CSP-01

**Tasks:**
1. In `apps/web/middleware.ts` `buildCsp()` function, change:
   `"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com"`
   to:
   `"style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com"`
2. Audit all server components and layout files that render inline `<style>` tags or `style` props that would need the nonce applied. In Next.js App Router, the nonce is available via `headers().get('x-nonce')` in server components.
3. Test thoroughly — removing `unsafe-inline` from `style-src` is the most likely to cause visual regressions if any component relies on unscoped inline styles.
4. As a fallback, use `'unsafe-hashes'` with pre-computed SHA-256 hashes for any inline styles that cannot be removed or attributed to a nonce.

---

### Fix 17: Clear SecureStore on `onUnauthenticated` in mobile auth context
**Bug:** BUG-MOB-AUTH-01

**Tasks:**
1. In `apps/expo/lib/auth/context.tsx`, find the callback registered with `onUnauthenticated` from `client.ts`.
2. Add `await SecureStore.deleteItemAsync(JWT_KEY)`, `await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY)`, and `await SecureStore.deleteItemAsync(USER_STORAGE_KEY)` (or whatever constant holds the user object key) before or alongside setting `sessionExpired = true`.
3. Reset the `user` state to `null`.
4. Verify on both Android emulator and a physical device that after forced session expiry, reinstalling is no longer required to clear stale credentials.

---

### Fix 18: Clear `sessionExpired` on sign-in
**Bug:** BUG-MOB-AUTH-02

**Tasks:**
1. In `apps/expo/lib/auth/context.tsx`, in the `signIn` function (or immediately after a successful authentication response), add `setSessionExpired(false)`.
2. Ensure this runs before any navigation occurs so that screens that check `sessionExpired` render correctly on the first frame after login.

---

### Fix 19: Refresh stored `user` object after silent token rotation
**Bug:** BUG-MOB-AUTH-03

**Tasks:**
1. In `apps/expo/lib/api/client.ts`, after a successful `refreshAccessToken()` call and SecureStore write of the new JWT:
   - Decode the new JWT payload (e.g., using a lightweight JWT decode library — no verification needed here since it just came from the server).
   - Update SecureStore with the new user object derived from the payload.
   - Emit an event (or call a context update function) so that the in-memory `user` state in `auth/context.tsx` is also updated.
2. Alternatively (simpler and more reliable), after a successful refresh, make a lightweight `GET /api/users/me` call to fetch the fresh user profile and update both SecureStore and context state.
3. Choose option 2 if the JWT payload does not include all fields needed by the mobile UI (XP, rank tier, plan, etc.).

---

## Implementation Order

| Priority | Fix | Estimated Effort |
|----------|-----|-----------------|
| 1 | Fix 1 — `failed_xp_awards` unique index | 30 min (migration only) |
| 2 | Fix 2 — `audit_discrepancies` unique index | 30 min (migration only) |
| 3 | Fix 3 — `failed_webhooks` column names | 1 hour |
| 4 | Fix 4 — `guilds.wars_drawn` column | 30 min (migration + schema) |
| 5 | Fix 5 — Dodo `slug` column / id lookup | 1–2 hours (depends on metadata audit) |
| 6 | Fix 6 — Webhook endpoints to PUBLIC_PREFIXES | 15 min |
| 7 | Fix 7 — `await verifyTotp()` in 2FA setup | 5 min + test |
| 8 | Fix 8 — Push batch device_id dedup | 1–2 hours |
| 9 | Fix 9 — Alliance war tie → draw | 2 hours |
| 10 | Fix 10 — Rank notification reference_id | 30 min |
| 11 | Fix 11 — Guild tier loop continue after demotion | 30 min |
| 12 | Fix 12 — Guild tier history on demotion | 30 min |
| 13 | Fix 13 — guildQuestContributions unique constraint | 30 min |
| 14 | Fix 14 — Leaderboard snapshot after XP bonus | 1 hour |
| 15 | Fix 15 — City/season leaderboard after daily login XP | 1 hour |
| 16 | Fix 16 — Remove unsafe-inline from style-src | 2–3 hours (QA heavy) |
| 17 | Fix 17 — Clear SecureStore on unauthenticated | 30 min |
| 18 | Fix 18 — Clear sessionExpired on sign-in | 15 min |
| 19 | Fix 19 — Refresh user object after token rotation | 1–2 hours |

**Total estimated effort: ~16–20 hours of engineering time.**

All Phase 1 fixes (1–5) should be deployed together in a single migration PR — they are DB-level changes with no application code risk, and the application code already handles them correctly once the schema is in place.

---

*Fix plan generated alongside independent forensic analysis on Saturday, June 20, 2026 at 9:17 PM UTC.*
*No bugs should be fixed until this plan has been reviewed and approved.*
