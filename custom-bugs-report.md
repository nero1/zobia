# Zobia Codebase — Forensic Bug Report

**Generated:** June 16, 2026 — 12:00 AM  
**Analyst:** Claude Code (claude-sonnet-4-6)  
**Scope:** Full codebase — `apps/web` (Next.js/PWA), `apps/expo` (Android), shared libs  
**Note:** CRON frequency concerns excluded per instruction (external service handles frequency). Test issues excluded.

---

## Quick-Reference Index (30 issues)

1. BUG-CRON-01 — Daily login XP awarded for wrong date (CURRENT_DATE at midnight cron)
2. BUG-PAYOUT-01 — All automated weekly payouts go to DLQ (missing recipient_code in snapshot)
3. BUG-SEASON-01 — Season rewards never distributed (season_rank never written during season)
4. BUG-CRON-02 — Streak increment and login-XP award query different date populations
5. BUG-SEC-01 — 2FA TOTP verify rate-limits by IP only; distributed brute-force possible
6. BUG-SEC-02 — Webhook replay protection skipped when eventRef is null
7. BUG-SEC-03 — room_subscription webhook inserts unvalidated roomId from metadata
8. BUG-SEC-04 — CSRF cron exemption checks x-cron-secret; actual handler uses Authorization Bearer
9. BUG-QUEST-01 — Quest progress can be triggered on quests not in user's assigned deck
10. BUG-LB-01 — Leaderboard 'national' scope: snapshot lookup and rank count use different scope strings
11. BUG-ROOM-01 — Ceremony rooms never auto-closed (cron only closes type='drop')
12. BUG-GUILD-01 — Guild tier promotion does not check minimum member count
13. BUG-GUILD-02 — Alliance war pairing allows reverse-order duplicates (A,B) + (B,A)
14. BUG-SEASON-02 — Season pass sticker-pack reward inserts string pack name into UUID FK column
15. BUG-DM-01 — DM message pagination uses single-column cursor (created_at only); skips/duplicates on same-ms timestamps
16. BUG-SEASON-03 — Integer division in rank 4–10 season reward split discards coins
17. BUG-QUEST-02 — Stale user_quest_decks rows accumulate indefinitely (never cleaned up)
18. BUG-FRAUD-01 — Fraud audit log INSERT uses nil UUID as admin_id; FK violation silently swallowed
19. BUG-PUSH-01 — Push ticket receipts: all tickets marked checked_at before polling Expo; partial failures strand tickets
20. BUG-AUTH-01 — SameSite=Strict on cookie set, SameSite=Lax on cookie clear — inconsistency
21. BUG-SCHEMA-01 — Duplicate loginStreak / loginStreakDays columns on users table; can diverge
22. BUG-SCHEMA-02 — Duplicate activeCosmeticFrameId (UUID) / activeFrameId (text) on users table
23. BUG-SCHEMA-03 — Two subscription tables (subscriptions + user_subscriptions) with no consistency guarantee
24. BUG-SCHEMA-04 — giftTypes table is orphaned — no FK from gifts; second catalogue unusable
25. BUG-SCHEMA-05 — failedWebhooks has no retry_count / resolved_at; logged but never retried
26. BUG-SCHEMA-06 — No DB CHECK constraint preventing self-referral in referrals table
27. BUG-PERF-01 — /api/messages/link-preview has no Redis caching; same URL fetched fresh every time
28. BUG-PERF-02 — useAuth hook fetches /api/auth/me on every component mount; no shared cache
29. BUG-SEC-05 — Markdown announcement sanitizer does not strip embedded HTML tags; XSS risk
30. BUG-LOGIC-01 — War draw tie-breaking (challenger wins) undocumented; contradicts expected neutrality

---

## Detailed Entries

---

### 1. BUG-CRON-01 — Daily login XP awarded for wrong date

**Severity:** CRITICAL — login XP is awarded to effectively zero users daily

**Description:** The daily CRON runs at midnight UTC. When it executes the login XP step, it queries:
```sql
WHERE DATE(last_login_at AT TIME ZONE 'UTC') = CURRENT_DATE
```
`CURRENT_DATE` just flipped to the new day at midnight. Almost no user has `last_login_at` on this new day yet — they all logged in yesterday. The streak step next to it correctly uses `CURRENT_DATE - 1`, but the XP step never received the same fix. The result is that daily login XP goes to virtually no one.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — step 4 (daily login XP award)

**FIX:** Change the WHERE condition from `= CURRENT_DATE` to `= CURRENT_DATE - 1`. Audit all other date comparisons in the same cron file to ensure they all use the prior-day convention consistently.

---

### 2. BUG-PAYOUT-01 — All automated weekly payouts route to DLQ (missing recipient_code)

**Severity:** CRITICAL — creators are never paid out automatically

**Description:** The weekly payout step in the CRON builds a `bank_account_snapshot` JSON and stores it on the `creator_payouts` record. However, the snapshot object does not include the `recipient_code` field (Paystack's transfer recipient identifier). `attemptTransfer` in `lib/payments/payouts.ts` reads `snapshot?.recipient_code` as the first thing it does; if it is undefined it calls `moveToDeadLetterQueue` immediately. Since `recipient_code` is always absent from the snapshot, every automated payout is silently moved to the DLQ and no transfer is ever initiated. The `creator_bank_accounts` table has a `recipient_code` column; it simply isn't being included when building the snapshot.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — weekly payouts step (step 33)
- `apps/web/lib/payments/payouts.ts` — `attemptTransfer`
- `apps/web/lib/db/schema.ts` — `creatorBankAccounts.recipientCode`

**FIX:** Include `recipient_code` in the SELECT query that fetches the bank account when building the snapshot. Verify the snapshot object is serialized to JSON with this field intact. Add a guard in `attemptTransfer` to raise a `system_alert` (not just silently DLQ) when `recipient_code` is missing, so the issue is visible in the admin panel.

---

### 3. BUG-SEASON-01 — Season rewards never distributed (season_rank never populated)

**Severity:** CRITICAL — no player receives end-of-season rank rewards

**Description:** `distributeSeasonRewards` reads `season_rank_archives.final_rank`, which is populated by `resetSeasonRankings`. That function copies `user_season_passes.season_rank` into the archive. But `user_season_passes.season_rank` is never written to during an active season — no code path updates it. At season end, `resetSeasonRankings` archives all-NULL `final_rank` values. `distributeSeasonRewards` filters `WHERE final_rank IS NOT NULL`, returns zero rows, and distributes nothing. The entire season reward system is broken by this missing write.

**FILES:**
- `apps/web/lib/seasons/seasonEngine.ts` — `resetSeasonRankings`, `distributeSeasonRewards`
- `apps/web/lib/db/schema.ts` — `userSeasonPasses.seasonRank`

**FIX:** Either (a) write `season_rank` to `user_season_passes` each time the leaderboard snapshot runs during the season, or (b) compute rank on the fly in `resetSeasonRankings` by joining against the leaderboard snapshot at season end rather than reading a stale column. Option (b) is safer and avoids a continuous write burden.

---

### 4. BUG-CRON-02 — Streak increment and login-XP query different date populations

**Severity:** HIGH — streak count and XP awards apply to different user cohorts

**Description:** Even after fixing BUG-CRON-01, the streak step and login-XP step are still semantically misaligned. The streak step filters on `last_login_date = CURRENT_DATE - 1` (a date column set by the login handler). The login-XP step filters on `DATE(last_login_at AT TIME ZONE 'UTC')` (a timestamp column). These two columns may not be in sync — a user whose `last_login_at` was updated but `last_login_date` was not (or vice versa) will have their streak incremented without XP or XP awarded without a streak update.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — streak step and login XP step

**FIX:** Decide on one source of truth for "logged in yesterday." Prefer `last_login_date` (the date-only column) since it is already correctly used by the streak step. Update the login-XP step to use `last_login_date = CURRENT_DATE - 1` as well, eliminating the timestamp vs date-column discrepancy.

---

### 5. BUG-SEC-01 — 2FA rate-limit by IP only; distributed brute-force possible

**Severity:** HIGH (security)

**Description:** `POST /api/auth/2fa/verify` enforces `enforceRateLimit(ip, "ip", RATE_LIMITS.auth)`. There is no rate limit keyed on the pre-auth userId. An attacker with access to many IP addresses (VPN pool, botnet) can try multiple TOTP codes per user per window by distributing requests across IPs, bypassing the per-IP cap entirely. A 6-digit TOTP code has 1,000,000 values; given the 30-second window and any grace period, a distributed attack is feasible.

**FILES:**
- `apps/web/app/api/auth/2fa/verify/route.ts`
- `apps/web/lib/security/rateLimit.ts`

**FIX:** Add a second rate limit keyed on the pre-auth userId (extractable from the pre-auth Redis entry):
```
enforceRateLimit(userId, "user", { limit: 5, windowMs: 15 * 60 * 1000, name: "2fa:verify" })
```
Use a tight limit matching the `pinVerify` preset (5 attempts / 15 minutes). After exhaustion, invalidate the pre-auth token and require re-login.

---

### 6. BUG-SEC-02 — Webhook replay protection skipped when eventRef is null

**Severity:** HIGH (security)

**Description:** In `paystackWebhookHandler.ts`, the Redis NX-set replay-protection block is guarded by `if (eventRef)`. Certain Paystack events (some `subscription.*` events, test hooks) may have a null or empty reference. For these, the entire dedup block is skipped and the handler processes the event unconditionally. If Paystack retries delivery (which it does on any 5xx response — and the code returns 500 for transient errors), the event can be processed multiple times: double coin credits, duplicate subscription activations, or duplicate payment records.

**FILES:**
- `apps/web/app/api/economy/webhooks/paystack/route.ts`
- `apps/web/lib/payments/paystackWebhookHandler.ts`

**FIX:** When `eventRef` is null, derive a synthetic replay key from the event payload hash (e.g. SHA-256 of event type + raw body truncated). Never skip dedup entirely. Alternatively, for events with no trackable reference, return 200 immediately (silently discard) rather than processing without protection.

---

### 7. BUG-SEC-03 — room_subscription webhook inserts unvalidated roomId

**Severity:** HIGH (security)

**Description:** `processChargeSuccess` handles `payment_type === 'room_subscription'` by casting webhook metadata to extract `roomId` and inserting it directly into `room_subscriptions`. No query is run to verify the room exists. A crafted or corrupted webhook payload with an arbitrary UUID as `roomId` will be committed to the database, potentially creating subscription records that reference non-existent rooms and causing downstream queries to behave unexpectedly.

**FILES:**
- `apps/web/lib/payments/paystackWebhookHandler.ts` — `processChargeSuccess`

**FIX:** Before the `room_subscriptions` insert, add:
```sql
SELECT id FROM rooms WHERE id = $roomId LIMIT 1
```
If the room does not exist, log to `failedWebhooks` and return early (do not insert the subscription). Also validate that `roomId` is a well-formed UUID before using it as a query parameter.

---

### 8. BUG-SEC-04 — CSRF cron exemption uses wrong header (dead code)

**Severity:** MEDIUM (security / reliability)

**Description:** `isCsrfSafe` in `middleware.ts` exempts no-Origin requests to `/api/cron/*` paths when `request.headers.get("x-cron-secret") === process.env.CRON_SECRET`. In practice, all cron requests authenticate using `Authorization: Bearer <CRON_SECRET>` at the route handler level — they never send `x-cron-secret`. The middleware exemption is therefore dead: legitimate cron requests don't satisfy it. Currently cron routes are GET-only, so no POST mutation is blocked, but the dead exemption is a maintenance trap. Any future cron POST mutation that relies on this exemption will be silently CSRF-blocked with no explanation.

**FILES:**
- `apps/web/middleware.ts` — `isCsrfSafe`
- `apps/web/app/api/cron/daily/route.ts` — authentication pattern

**FIX:** Update `isCsrfSafe` to match the actual authentication header: check `request.headers.get("authorization")?.startsWith("Bearer ")` and compare the token against `CRON_SECRET`. Remove the dead `x-cron-secret` branch.

---

### 9. BUG-QUEST-01 — Quest progress triggers on quests not in user's assigned deck

**Severity:** HIGH — users can gain quest credit for quests they were never assigned

**Description:** `updateQuestProgress` in `questEngine.ts` finds the active quest template matching the triggered action and increments the user's progress — without verifying the matched template is in the user's current `user_quest_decks` assignment. A user whose deck doesn't contain that template can still receive progress credit (e.g., by triggering an action type associated with a quest in another user's deck). This could be exploited via direct API calls to complete quests and claim rewards for unassigned quests.

**FILES:**
- `apps/web/lib/quests/questEngine.ts` — `updateQuestProgress`
- `apps/web/lib/db/schema.ts` — `userQuestDecks`

**FIX:** Add a deck membership check to the quest lookup query:
```sql
AND qt.id IN (
  SELECT unnest(quest_ids)
  FROM user_quest_decks
  WHERE user_id = $userId AND is_active = TRUE
  LIMIT 1
)
```
This ensures progress is only credited when the quest is part of the user's assigned daily deck.

---

### 10. BUG-LB-01 — Leaderboard national scope: lookup and count use different scope strings

**Severity:** HIGH — national leaderboard rank numbers are computed incorrectly

**Description:** `getUserRank` in `lib/leaderboards/engine.ts` maps `scope === 'national'` to `'global'` for the snapshot lookup query but uses the original `'national'` string for the rank-count query. If snapshots are stored as `'national'` (which they should be for national boards), the lookup with `'global'` finds no row. If snapshots are stored as `'global'`, the count with `'national'` finds no rows. Either way, the user's rank is miscalculated.

**FILES:**
- `apps/web/lib/leaderboards/engine.ts` — `getUserRank`

**FIX:** Remove the `national → global` remapping and use the same scope string for both the snapshot lookup and the rank count query. Verify `upsertLeaderboardSnapshot` consistently uses `'national'` for national boards, and align all callers.

---

### 11. BUG-ROOM-01 — Ceremony rooms never auto-closed

**Severity:** HIGH — ceremony rooms run indefinitely past their ends_at

**Description:** The CRON room auto-close step queries `WHERE type = 'drop' AND ends_at < NOW()`. Ceremony rooms (`type = 'ceremony'`) created with an `ends_at` timestamp are excluded from this query and never closed. They remain `is_active = TRUE` indefinitely, appear in room listings, and consume any associated resources.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — room auto-close step

**FIX:** Broaden the WHERE clause:
```sql
WHERE type IN ('drop', 'ceremony', 'event')
  AND ends_at IS NOT NULL
  AND ends_at < NOW()
  AND is_active = TRUE
```
Review all room types in the schema that have an `ends_at` semantics and include them all.

---

### 12. BUG-GUILD-01 — Guild tier promotion skips minimum member count requirement

**Severity:** MEDIUM-HIGH — single-member guilds can be promoted to top tiers via XP farming

**Description:** The CRON guild tier promotion step promotes guilds based solely on `guild_xp` crossing a tier threshold. It does not enforce any minimum member count for the target tier. A creator running one very active account could farm enough guild XP to reach Legend tier alone, bypassing any intended gating on community size.

**FILES:**
- `apps/web/app/api/cron/daily/route.ts` — guild tier promotion step

**FIX:** Define per-tier minimum member counts as constants (e.g. `TIER_MIN_MEMBERS = { bronze: 1, silver: 5, gold: 10, legend: 25 }`). Add `AND member_count >= $MIN` to the promotion eligibility query (or apply the check in application code before each promotion).

---

### 13. BUG-GUILD-02 — Alliance war pairing allows reverse-order duplicate wars

**Severity:** MEDIUM-HIGH — two alliances can be at war with each other twice simultaneously

**Description:** The `alliance_wars` partial unique index covers `(alliance_id_1, alliance_id_2)`. If war 1 stores `(A, B)`, a second war `(B, A)` does not conflict with the index and can be inserted. The CRON re-pairing step does not enforce canonical pair ordering before inserting, so duplicate wars can occur with the pair's IDs in different positions.

**FILES:**
- `apps/web/lib/db/schema.ts` — `allianceWars` table
- `apps/web/app/api/cron/daily/route.ts` — alliance war re-pairing step

**FIX:** Normalize pair ordering at insert time: always store `LEAST(id1, id2)` as `alliance_id_1` and `GREATEST(id1, id2)` as `alliance_id_2`. Apply this normalization in both the INSERT and the pre-check lookup. The existing unique index then prevents both orderings.

---

### 14. BUG-SEASON-02 — Season pass sticker-pack reward inserts string name into UUID FK

**Severity:** HIGH — every sticker-pack milestone claim throws a FK/type constraint violation

**Description:** `claimPassMilestone` in `seasonEngine.ts` handles `reward_type === 'sticker_pack'` by inserting `val.packId` (a human-readable string from the milestone config such as `'seasonal_free'`) directly as `pack_id` into `user_sticker_packs`. The `pack_id` column is a UUID FK referencing `sticker_packs.id`. PostgreSQL rejects the INSERT with an invalid UUID syntax or FK violation error. This is silently swallowed by the outer catch, so every sticker-pack reward is silently dropped — users never receive their pack.

**FILES:**
- `apps/web/lib/seasons/seasonEngine.ts` — `claimPassMilestone`
- `apps/web/lib/db/schema.ts` — `userStickerPacks`, `stickerPacks`

**FIX:** Before the insert, look up the pack's UUID by name:
```sql
SELECT id FROM sticker_packs WHERE name = $packId LIMIT 1
```
Use the returned UUID as `pack_id`. If no matching pack is found, log an error and return a clear failure code rather than silently absorbing the exception.

---

### 15. BUG-DM-01 — DM message pagination uses single-column cursor (created_at only)

**Severity:** MEDIUM-HIGH — messages with identical millisecond timestamps are skipped or duplicated

**Description:** `GET /api/messages/dm/[conversationId]` uses `AND m.created_at < $before` as its only cursor condition. If two messages share the same `created_at` value (possible when messages arrive in the same millisecond), the cursor boundary falls between them inconsistently: one may be included on both pages or skipped entirely. The room messages endpoint correctly uses the compound cursor `(m.created_at, m.id) < ($ts::timestamptz, $id::uuid)` — DMs should match.

**FILES:**
- `apps/web/app/api/messages/dm/[conversationId]/route.ts` — GET handler

**FIX:** Switch to a compound cursor. Pass `${lastMessage.created_at}__${lastMessage.id}` as `nextCursor`. In the WHERE clause:
```sql
AND (m.created_at, m.id) < ($before_ts::timestamptz, $before_id::uuid)
```
Update the `querySchema` to accept and parse the compound cursor string.

---

### 16. BUG-SEASON-03 — Integer division discards coins in rank 4–10 season reward split

**Severity:** MEDIUM — small but real coin loss every season; amounts grow with pool size

**Description:** In `distributeSeasonRewards`, the equal share for ranks 4–10 is computed as `Math.floor(pool / n)`. For any pool not divisible by n, the remainder is silently discarded. For example, a pool of 100 coins split among 7 players yields 14 per player = 98 total; 2 coins vanish. The remainder should be credited to rank 4 (or returned to the platform treasury).

**FILES:**
- `apps/web/lib/seasons/seasonEngine.ts` — `distributeSeasonRewards`

**FIX:**
```
const equalShare = Math.floor(remainder / n);
const dustCoins = remainder - equalShare * n;
// credit dustCoins to rank 4 in addition to equalShare
```

---

### 17. BUG-QUEST-02 — Stale user_quest_decks rows accumulate indefinitely

**Severity:** MEDIUM — table grows without bound; query and index performance degrades

**Description:** `resetDailyQuests` marks expired deck entries as `is_active = FALSE` but never deletes them. After a year of daily operation with N users, the table will contain ~365 × N rows. Indexes on `user_quest_decks` degrade proportionally, slowing the `updateQuestProgress` and deck assignment lookups.

**FILES:**
- `apps/web/lib/quests/questEngine.ts` — `resetDailyQuests`

**FIX:** Add a cleanup step after the mark-inactive pass:
```sql
DELETE FROM user_quest_decks
WHERE is_active = FALSE
  AND assigned_at < NOW() - INTERVAL '30 days';
```
A 30-day retention window preserves recent history for debugging while keeping the table bounded.

---

### 18. BUG-FRAUD-01 — Fraud audit log always fails silently (nil UUID FK violation)

**Severity:** MEDIUM — payout fraud audit trail is always lost

**Description:** `checkPayoutFraud` inserts into `admin_audit_log` with `admin_id = '00000000-0000-0000-0000-000000000000'`. The `admin_audit_log.admin_id` column has a NOT NULL FK referencing `users.id`. No user with the nil UUID exists in production. Every INSERT throws a FK violation, silently swallowed by `.catch(() => {})`. The `system_alerts` entry still fires (that table has no FK), but the audit trail is permanently lost.

**FILES:**
- `apps/web/lib/fraud/payouts.ts` — `checkPayoutFraud`
- `apps/web/lib/db/schema.ts` — `adminAuditLog`

**FIX:** Either (a) make `adminAuditLog.adminId` nullable (`references(null ON DELETE SET NULL)`) to allow system-generated entries, or (b) remove the `admin_audit_log` insert from the fraud check entirely, relying solely on `system_alerts` for fraud signals. If audit log entries are required, seed a well-known system-actor user at deploy time.

---

### 19. BUG-PUSH-01 — Push ticket receipts marked checked_at before Expo API is polled

**Severity:** MEDIUM — partial Expo API failure strands tickets permanently

**Description:** `pollPushReceipts` bulk-updates all fetched pending tickets with `checked_at = NOW()` before entering the Expo polling loop. If Expo returns a non-200 for one batch (the error case `continue`s the loop), those tickets already have `checked_at` set. On the next poll cycle, the WHERE clause `WHERE status = 'pending' AND created_at < NOW() - INTERVAL '15 minutes'` skips them (no `resolved_at`, but `checked_at` is set). They are stranded: not pending, not resolved, and never re-polled.

**FILES:**
- `apps/web/lib/notifications/push.ts` — `pollPushReceipts`

**FIX:** Move the `checked_at = NOW()` update inside the batch loop, only after a successful Expo API response for that batch. If the Expo API call fails, leave `checked_at` as NULL so the ticket is eligible for re-polling on the next run.

---

### 20. BUG-AUTH-01 — Cookie SameSite inconsistency (Strict on set, Lax on clear)

**Severity:** MEDIUM — logout may fail after cross-site redirect flows

**Description:** `buildCookieHeaders` sets auth cookies with `SameSite=Strict`. `buildClearCookieHeaders` uses `SameSite=Lax`. After a top-level cross-site navigation (Paystack payment return, OAuth callback), the browser will not attach `SameSite=Strict` cookies on the initial GET. If the app relies on the cookie being present for the landing page auth check, the user appears logged out. The clearing path using Lax is also inconsistent with the access cookies.

**FILES:**
- `apps/web/lib/auth/session.ts` — `buildCookieHeaders`, `buildClearCookieHeaders`

**FIX:** Standardize both to `SameSite=Lax`. This maintains CSRF protection (Lax blocks cross-site POST/PUT/DELETE cookies) while allowing cookies to travel on top-level GET navigations. Alternatively, ensure all post-payment/oauth landing pages are not session-sensitive on the first request.

---

### 21. BUG-SCHEMA-01 — Duplicate loginStreak / loginStreakDays columns (users table)

**Severity:** MEDIUM — columns can diverge; streak display and streak-based rewards show wrong values

**Description:** The `users` table has both `login_streak` and `login_streak_days`. Different code paths update one or the other independently. The CRON streak step, login handler, and any streak-based reward logic may be reading/writing to different columns, causing them to diverge silently over time.

**FILES:**
- `apps/web/lib/db/schema.ts` — `users` table
- `apps/web/app/api/cron/daily/route.ts` — streak update step
- `apps/web/app/api/auth/` — login handlers

**FIX:** Designate `login_streak` as canonical. Remove `login_streak_days`. Write a migration to copy `login_streak_days` → `login_streak` where `login_streak` is zero/null. Update all read/write references.

---

### 22. BUG-SCHEMA-02 — Duplicate activeCosmeticFrameId / activeFrameId columns (users table)

**Severity:** MEDIUM — two sources of truth for active frame; UI can show different values

**Description:** `users` has both `active_cosmetic_frame_id` (UUID FK → `store_items`) and `active_frame_id` (plain text). Both represent the user's active cosmetic frame. Code paths that update one but not the other leave them diverged. Profile rendering that reads one column sees a different frame than code reading the other.

**FILES:**
- `apps/web/lib/db/schema.ts` — `users` table
- `apps/web/app/api/economy/cosmetics/equip/route.ts`

**FIX:** Canonicalize to `active_cosmetic_frame_id` (the FK-backed UUID column). Remove `active_frame_id`. Update all reads/writes. Add a migration.

---

### 23. BUG-SCHEMA-03 — Two subscription tables with no consistency guarantee

**Severity:** MEDIUM — subscription state is split across tables; reads return different results

**Description:** `subscriptions` (with `userId` unique) and `user_subscriptions` (also with `userId` unique) both track user subscriptions. They have different columns and there is no trigger or transaction wrapper ensuring both are updated atomically on plan changes. Routes querying different tables see different states, causing inconsistent feature gating and plan checks.

**FILES:**
- `apps/web/lib/db/schema.ts` — `subscriptions`, `user_subscriptions`
- `apps/web/lib/payments/paystackWebhookHandler.ts` — `processSubscriptionEvent`

**FIX:** Decide which table is canonical (most likely `subscriptions`). Remove the other after a data migration. If they truly serve different purposes, document that explicitly and add a consistency-check CRON step.

---

### 24. BUG-SCHEMA-04 — giftTypes table is orphaned (no FK from gifts)

**Severity:** LOW-MEDIUM — second gift catalogue is invisible to the gifting system

**Description:** The schema defines both `giftItems` (original) and `giftTypes` (migration 011). The `gifts` table only has `gift_item_id` → `giftItems`. `giftTypes` has no FK inbound from `gifts`. Items added in `giftTypes` cannot be sent as gifts. Admin tooling that creates items in `giftTypes` produces records that are never used.

**FILES:**
- `apps/web/lib/db/schema.ts` — `gifts`, `giftItems`, `giftTypes`

**FIX:** Either add `gift_type_id UUID REFERENCES gift_types(id)` to `gifts` and migrate, or drop `giftTypes` if it is not intended to be used. Do not leave two disconnected catalogues indefinitely.

---

### 25. BUG-SCHEMA-05 — failedWebhooks table has no retry mechanism

**Severity:** MEDIUM — failed payment webhook events are logged but never recovered

**Description:** The `failedWebhooks` table records processing failures but has no `retry_count`, `resolved_at`, `next_retry_at`, or error columns. No CRON step queries this table to retry events. Missed coin awards, subscription activations, or payment records from failed webhooks accumulate without recovery. There is no equivalent to the `failed_xp_awards` retry loop.

**FILES:**
- `apps/web/lib/db/schema.ts` — `failedWebhooks`
- `apps/web/app/api/cron/daily/route.ts` — no retry step for failedWebhooks

**FIX:** Add `retry_count integer NOT NULL DEFAULT 0`, `last_retried_at timestamptz`, `resolved_at timestamptz`, and `error text` columns. Implement a CRON retry step (mirroring `retryFailedXPAwards`) with exponential backoff and a max of 5 retries. Raise a `system_alert` on permanent failure.

---

### 26. BUG-SCHEMA-06 — No DB-level constraint preventing self-referral

**Severity:** LOW-MEDIUM — self-referral coins/XP can be claimed under certain edge conditions

**Description:** `referrals` has a unique index on `(referrer_id, referred_id)` but no `CHECK (referrer_id <> referred_id)`. Application-level guards in `commissions.ts` prevent some self-referral commission paths but do not block the row from being inserted. A bug or race condition in the referral creation flow could create a self-referral and trigger a commission award.

**FILES:**
- `apps/web/lib/db/schema.ts` — `referrals`
- `apps/web/lib/referrals/commissions.ts`

**FIX:** Add a DB-level check constraint: `CHECK (referrer_id <> referred_id)`. Also add an explicit application-level guard in the endpoint that creates referral records (not just in commission calculation).

---

### 27. BUG-PERF-01 — Link preview has no Redis caching

**Severity:** LOW — popular URLs fetched fresh on every request

**Description:** `GET /api/messages/link-preview` makes a fresh `safeFetch` call on every request. If 50 users share the same news article URL in DMs, 50 outbound fetches hit the same external server within seconds. The 5-second timeout means tail latency accumulates quickly for the users waiting.

**FILES:**
- `apps/web/app/api/messages/link-preview/route.ts`

**FIX:** Cache results in Redis for 1 hour keyed on a normalized URL hash:
```ts
const cacheKey = `lp:${sha256(normalizedUrl).slice(0, 24)}`;
const cached = await redis.get(cacheKey);
if (cached) return NextResponse.json(JSON.parse(cached));
// ... fetch ... 
await redis.setex(cacheKey, 3600, JSON.stringify(result));
```

---

### 28. BUG-PERF-02 — useAuth hook has no shared cache; N fetches per page

**Severity:** LOW — redundant round-trips on every page load

**Description:** `useAuth` in `lib/auth/hooks.ts` issues `fetch('/api/auth/me')` in a `useEffect` with no dependency. Every component that calls `useAuth()` triggers its own independent fetch. A page with 5 components using `useAuth()` makes 5 simultaneous authenticated requests to the same endpoint.

**FILES:**
- `apps/web/lib/auth/hooks.ts`

**FIX:** Wrap auth state in a React Context in the root layout, or use SWR (`useSWR('/api/auth/me', fetcher)`) so all consumers share a single deduplicated request and in-memory cache. This is the standard Next.js App Router pattern.

---

### 29. BUG-SEC-05 — Markdown announcement sanitizer does not strip embedded HTML

**Severity:** MEDIUM (security) — admin-entered markdown can embed XSS payloads

**Description:** `sanitizeAnnouncementContent` for `contentType === 'markdown'` only rewrites non-http relative links to `about:blank`. It does not strip raw HTML tags embedded in the markdown body (e.g., `<script>alert(1)</script>`, `<img onerror="...">`). When a markdown renderer (remark, marked, etc.) converts this content to HTML for display, embedded tags are rendered verbatim, potentially executing attacker-controlled scripts if a compromised admin account supplies malicious content.

**FILES:**
- `apps/web/lib/security/htmlSanitizer.ts` — `sanitizeAnnouncementContent`

**FIX:** After applying the link-patch regex, also run the result through `sanitizeHtml()` (the existing allowlist sanitizer):
```ts
if (contentType === 'markdown') {
  const linkPatched = content.replace(/\]\((?!(https?:|mailto:))[^)]*\)/gi, '](about:blank)');
  return sanitizeHtml(linkPatched); // strips embedded HTML tags
}
```
Alternatively, configure the markdown renderer with `sanitize: true` or enable HTML-stripping in the render options.

---

### 30. BUG-LOGIC-01 — War draw tie-breaking is undocumented

**Severity:** LOW — silent policy assumption; could contradict PRD or operator expectations

**Description:** `resolveWar` uses `war.challenger_points >= war.defender_points`, meaning the challenger wins on an exact tie. There is no comment, no PRD reference, and no admin notification for draws. If the PRD specifies draws should result in a split reward, re-match, or no-win outcome, this code silently contradicts it.

**FILES:**
- `apps/web/lib/guilds/warEngine.ts` — `resolveWar`

**FIX:** Add an explicit comment: `// PRD §X: challenger wins on tie`. If re-match or split rewards are intended, add a `status = 'draw'` branch. At minimum, emit a `system_alert` when `challenger_points === defender_points` so operators can see draw outcomes in the admin panel.

---

## Code Quality Assessment

### Current Rating: **5.5 / 10**

**Strengths:**
- Strong idempotency architecture throughout: CTE-gated UPDATEs, partial unique indexes on `coin_ledger`, `xp_ledger`, `star_ledger`, per-user-per-reference ON CONFLICT dedup.
- Security fundamentals are well-implemented: HMAC-SHA512 webhook verification with constant-time comparison, JWT kid-based key rotation, CSRF origin-header validation, CSP nonce injection, AES-256-GCM field encryption with scrypt KDF, complete SSRF protection (DNS pinning, redirect re-validation, response body size bounding).
- Rate limiting is thorough: atomic Lua sliding-window, per-user and per-IP variants, global endpoint caps, sentinel bucket for unknown IPs.
- Dead-letter queues with exponential backoff for XP and payouts — the right pattern.
- `SELECT FOR UPDATE` discipline on coin/star balance mutations; single-transaction war resolution with `FOR UPDATE` row lock.
- Well-structured fraud detection with non-blocking `forceManual` flag.

**Critical Gaps:**
- Three core systems are completely broken by CRON bugs: daily XP awards, automated payouts, and season rewards.
- Two high-severity security gaps: 2FA brute-force and webhook replay bypass.
- Schema accrual debt with duplicate columns and orphaned tables creates silent divergence risk.

### Projected Post-Fix Rating: **8.5 / 10**

After applying all 30 fixes the major functional gaps are closed. The economy engine becomes reliable end-to-end (XP, payouts, season rewards). The security posture improves meaningfully (2FA per-account throttling, webhook dedup completeness, room subscription validation). Schema consistency eliminates silent divergence. The remaining gap from 10/10 reflects: no CRON integration tests, no chaos/fault-injection coverage of DLQ paths, and pending migration effort for schema consolidation (dual subscription tables, orphaned giftTypes).

---

**Report completed:** June 16, 2026 — 12:00 AM  
*Forensic analysis — Zobia Social codebase — claude-sonnet-4-6*
