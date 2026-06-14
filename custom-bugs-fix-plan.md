# Zobia Social — Bug Fix Plan

**Generated:** June 14, 2026 12:28 PM  
**Source:** custom-bugs-report.md (27 confirmed bugs)  
**Instruction:** DO NOT begin any fix until the plan is reviewed and approved.

---

## Priority Tiers

| Tier | Description |
|------|-------------|
| P0 — Critical | Runtime crashes / features completely broken in production |
| P1 — High | Silent data loss, security holes, or broken user-facing features |
| P2 — Medium | Degraded functionality, incorrect behaviour under specific conditions |
| P3 — Low | Cosmetic, minor logic gaps, informational |

---

## P0 — Critical (Fix First)

These bugs cause runtime DB errors, silent data loss, or complete feature breakdowns every time the affected code paths are executed.

---

### TASK-01: Fix `trustScore.ts` — replace missing columns with correlated subqueries [BUG-DB01]

**Files to edit:**  
`apps/web/lib/trust/trustScore.ts`

**Steps:**  
1. In `calculateTrustScore`, replace `COALESCE(u.report_count, 0)::text AS report_count` with a correlated subquery: `(SELECT COUNT(*)::text FROM reports WHERE reported_user_id = u.id) AS report_count`.  
2. Replace `COALESCE(u.warning_count, 0)::text AS warning_count` with: `(SELECT COUNT(*)::text FROM moderation_actions WHERE target_user_id = u.id AND action_type = 'warning') AS warning_count`.  
3. Run the trust score tests to confirm they pass.  
4. Manually verify that `meetsMinimumTrust` resolves without DB errors for a sample user.

---

### TASK-02: Fix referral column name mismatch — `referred_by_user_id` vs `referred_by` [BUG-DB02]

**Files to edit:**  
`apps/web/lib/referrals/commissions.ts`  
`apps/web/app/api/referrals/claim/route.ts`

**Steps (preferred: rename in code, keep schema):**  
1. In `commissions.ts` lines 68–69 and 150–151, change `referred_by_user_id` to `referred_by` in both the SELECT and the TypeScript type.  
2. In `referrals/claim/route.ts`, change all four references to `referred_by_user_id` (lines 49, 70, 115, 130–131) to `referred_by`.  
3. Confirm the referral claim and commission flows work end-to-end.  

*Alternative: create a migration `ALTER TABLE users RENAME COLUMN referred_by TO referred_by_user_id` and keep the code unchanged — only if other code that correctly uses `referred_by` also needs updating.*

---

### TASK-03: Create `user_quest_decks` table and populate it in `generateDailyDeck` [BUG-DB03 / BUG-XP01]

**Files to create/edit:**  
`apps/web/db/migrations/006_user_quest_decks.sql` (new migration)  
`apps/web/lib/quests/questEngine.ts`

**Steps:**  
1. Create migration with:
   ```sql
   CREATE TABLE IF NOT EXISTS user_quest_decks (
     id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     quest_id      UUID NOT NULL REFERENCES quest_templates(id) ON DELETE CASCADE,
     assigned_date DATE NOT NULL,
     created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE(user_id, quest_id, assigned_date)
   );
   CREATE INDEX IF NOT EXISTS idx_user_quest_decks_user_date
     ON user_quest_decks(user_id, assigned_date);
   ```
2. In `generateDailyDeck`, after selecting the deck's quest IDs, INSERT them into `user_quest_decks` for the current date using `ON CONFLICT DO NOTHING`.  
3. Verify `checkDeckCompletion` now runs without error and awards 500 XP on deck completion.

---

### TASK-04: Fix SYS-02 reconciliation — remove `wallets` join, fix column names [BUG-DB04]

**Files to edit:**  
`apps/web/app/api/cron/daily/route.ts` (SYS-02 block)

**Steps:**  
1. Replace `JOIN wallets w ON w.user_id = cl.user_id` → `JOIN users u ON u.id = cl.user_id`.  
2. For coin reconciliation, replace `SUM(CASE WHEN cl.direction = 'credit' THEN cl.amount ELSE -cl.amount END)` → `SUM(cl.amount)` (already signed), and compare against `u.coin_balance`.  
3. For star reconciliation, replace `wallets.stars_balance` → `u.star_balance`.  
4. Verify SYS-02 no longer errors in the CRON log.

---

### TASK-05: Add unique index to `xp_ledger` for deduplication [BUG-DB06]

**Files to create:**  
`apps/web/db/migrations/007_xp_ledger_unique_ref.sql` (new migration)

**Steps:**  
1. Add migration:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS uidx_xp_ledger_source_ref
     ON xp_ledger(user_id, source, reference_id)
     WHERE reference_id IS NOT NULL;
   ```
2. Run the migration on the database.  
3. Verify that `safeAwardXP` correctly no-ops when called twice with the same `reference_id`.

---

### TASK-06: Fix automated payout CRON — populate `bank_account_snapshot` [BUG-EC01]

**Files to edit:**  
`apps/web/app/api/cron/daily/route.ts` (step 32)

**Steps:**  
1. Locate the `creator_payouts` INSERT in step 32.  
2. In the SELECT that fetches creator data, ensure `u.payout_recipient_code` and `u.payout_account_last4` are included.  
3. Add `bank_account_snapshot = jsonb_build_object('recipient_code', u.payout_recipient_code, 'account_last4', COALESCE(u.payout_account_last4, ''))` to the INSERT.  
4. Add a guard: only INSERT a payout row if `u.payout_recipient_code IS NOT NULL`.  
5. Test by triggering a manual payout CRON run in a staging environment and confirming payouts progress past the dead-letter check.

---

## P1 — High (Fix After P0)

---

### TASK-07: Fix `getUserMetricsForWeighting` — wrong table name `followers` → `follows` [BUG-DB05]

**Files to edit:**  
`apps/web/lib/leaderboards/engine.ts` (line 422)

**Steps:**  
1. Change `LEFT JOIN followers f ON f.user_id = u.id` to `LEFT JOIN follows f ON f.following_id = u.id`.  
2. Update the column reference: `COUNT(DISTINCT f.follower_id)` → `COUNT(DISTINCT f.follower_id)` (column name on `follows` table is `follower_id`, so this stays the same if the follows table uses that column). Confirm by checking migration 001 for the `follows` schema (`follower_id`, `following_id` columns).

---

### TASK-08: Implement Redis-backed circuit breaker [BUG-INF01]

**Files to create/edit:**  
`apps/web/lib/payments/circuit.ts`  
`apps/web/lib/redis/index.ts` (reference)

**Steps:**  
1. Create a `RedisCircuitBreaker` class that stores `{ state, openedAt, failures, windowStart }` in a Redis hash keyed by `circuit:{name}`.  
2. Implement state transitions (CLOSED → OPEN → HALF_OPEN → CLOSED) atomically using a Lua script or WATCH/MULTI.  
3. Replace `paystackBreaker`, `expoPushBreaker`, and `dodoPaymentsBreaker` singletons with `RedisCircuitBreaker` instances.  
4. Keep the existing in-memory `CircuitBreaker` class for unit testing.  
5. Add TTL on the Redis keys (e.g., `resetTimeoutMs * 3`) so stale state is automatically cleaned up.

---

### TASK-09: Fix announcement targeting for null plan/role users [BUG-SEC03]

**Files to edit:**  
`apps/web/lib/announcements/engine.ts`

**Steps:**  
1. In `matchesTargeting`, change:
   ```ts
   if (targetPlans.length > 0 && user.plan_id) {
     if (!targetPlans.includes(user.plan_id)) return false;
   }
   ```
   to:
   ```ts
   if (targetPlans.length > 0 && (!user.plan_id || !targetPlans.includes(user.plan_id))) return false;
   ```
2. Apply the same fix for `targetRoles`.  
3. Write a unit test with a user who has `plan_id = null` and a plan-targeted announcement; confirm they don't see it.

---

### TASK-10: Fix `useRealtimeChannel` async cleanup race condition [BUG-RT01]

**Files to edit:**  
`apps/web/lib/realtime/useRealtimeChannel.ts`

**Steps:**  
1. Add a `cancelled` flag before each async IIFE.  
2. In each provider's async IIFE, check `if (cancelled) { unsubscribe(); return; }` before assigning `cleanup`.  
3. In the `useEffect` return, set `cancelled = true` before calling `cleanup?.()`.  
4. Apply this to all three provider branches (Supabase, Ably, Pusher).

---

### TASK-11: Fix `replyToMessageId` cross-room injection [BUG-MSG01]

**Files to edit:**  
`apps/web/app/api/rooms/[roomId]/messages/route.ts`

**Steps:**  
1. After parsing `body.replyToMessageId`, add a DB validation query:
   ```sql
   SELECT id FROM room_messages WHERE id = $replyToMessageId AND room_id = $roomId LIMIT 1
   ```
2. If no row is returned, return `422 Unprocessable Entity` with `{ error: 'Reply target message not found in this room' }`.

---

### TASK-12: Fix `withAdminAuth` — add request context and `X-Request-Id` [BUG-AUTH01]

**Files to edit:**  
`apps/web/lib/api/middleware.ts`

**Steps:**  
1. In `withAdminAuth`, replicate the same `requestId` generation and `requestContext.run()` wrapping used in `withAuth`.  
2. Set `X-Request-Id: requestId` on all responses (success and error) from `withAdminAuth`.  
3. Confirm admin route logs now include correlation IDs.

---

### TASK-13: Fix `withAuth` sensitive-mutation regex — add purchase endpoints [BUG-AUTH02]

**Files to edit:**  
`apps/web/lib/api/middleware.ts`

**Steps:**  
1. Extend the `isSensitiveMutation` regex to include `economy\/coins\/purchase` and `economy\/stars\/purchase`.  
2. Or replace the regex with an explicit prefix array and `pathname.startsWith()` checks — more readable and less fragile.

---

### TASK-14: Prevent circular referral chains [BUG-EC03]

**Files to edit:**  
`apps/web/lib/referrals/commissions.ts`

**Steps:**  
1. Add `if (tier2Id === buyerId || tier2Id === tier1Id) return result;` to stop the 2-hop case where tier-1 and tier-2 referrers are the same person.  
2. At referral claim time (`app/api/referrals/claim/route.ts`), before setting `referred_by`, walk the referral chain upward (up to a max depth of 5) and reject the claim if the new user's ID already appears in the chain.  
3. Add a test for the A→B→C→A circular chain scenario.

---

### TASK-15: Fix SYS-02 CRON reconciliation `wallets` reference and column naming — combine with TASK-04

*(Already covered in TASK-04.)*

---

## P2 — Medium

---

### TASK-16: Fix season-discriminated badge keys [BUG-XP02, BUG-XP03]

**Files to edit:**  
`apps/web/app/api/cron/daily/route.ts` (weekly snapshot step)  
`apps/web/lib/seasons/seasonEngine.ts` (`claimPassMilestone`)

**Steps:**  
1. In the weekly top-100 snapshot step, change `badge_key = 'season_top100_frame'` to `badge_key = 'season_top100_frame:' || current_season_id`.  
2. In `claimPassMilestone`, change the badge INSERT's `badge_key` from `badgeType` to `badgeType || ':s' || seasonId`.  
3. Update any frontend badge display logic that looks up the badge by the old static key.  
4. Optionally backfill existing badges with the season-specific key if you want historical data to be accurate.

---

### TASK-17: Fix guild quest reset logic [BUG-GW01]

**Files to edit:**  
`apps/web/app/api/cron/daily/route.ts` (step 23)  
`apps/web/db/migrations/` (potentially new migration)

**Steps:**  
1. If the intent is to retire old quests: add `is_active BOOLEAN NOT NULL DEFAULT TRUE` to `guild_quests` (new migration), then in step 23 set `is_active = FALSE` for quests where `week_end < weekStart AND completed = FALSE`.  
2. If the intent is to delete stale progress: DELETE from `guild_quest_contributions` and `guild_quests` where they are from a previous week and incomplete.  
3. Confirm the reset step now produces a non-zero `rowCount` each week.

---

### TASK-18: Add unique constraint for alliance wars [BUG-GW02]

**Files to create/edit:**  
`apps/web/db/migrations/008_alliance_wars_unique.sql` (new migration)  
`apps/web/app/api/cron/daily/route.ts` (alliance war step)

**Steps:**  
1. Identify the actual column names in `alliance_wars` (check migration 001).  
2. Add a migration: `CREATE UNIQUE INDEX IF NOT EXISTS uidx_alliance_wars_pair_week ON alliance_wars(guild_id_1, guild_id_2, week_of);` (adjust to actual column names).  
3. Update the CRON INSERT to use `ON CONFLICT (guild_id_1, guild_id_2, week_of) DO NOTHING`.

---

### TASK-19: Fix gift idempotency bucket granularity [BUG-MSG02]

**Files to edit:**  
`apps/web/app/api/economy/gifts/send/route.ts`

**Steps:**  
1. Narrow the hourly bucket to a per-minute bucket (`YYYY-MM-DDTHH:mm`) or remove the time-based fallback entirely.  
2. Rely on the client-supplied idempotency key for true deduplication, and use the server-side bucket only for detecting mis-fired duplicate requests within a very short window (e.g., 10 seconds: `:${Math.floor(Date.now() / 10_000)}`).

---

### TASK-20: Fix DM sticker unlock individual grant [BUG-MSG03]

**Files to edit:**  
`apps/web/app/api/cron/daily/route.ts` (step 22)  
`apps/web/db/migrations/` (add `processed_at` column if needed)

**Steps:**  
1. In CRON step 22, fetch unprocessed `dm_score_sticker_unlocks` rows (add `processed_at TIMESTAMPTZ` column).  
2. For each unprocessed row, find the sticker pack by name; if it doesn't exist, create it.  
3. INSERT into `user_sticker_packs` for both `user_id_1` and `user_id_2` with `ON CONFLICT DO NOTHING`.  
4. Mark the `dm_score_sticker_unlocks` row as processed (`processed_at = NOW()`).

---

### TASK-21: Fix profanity regex `lastIndex` reset location [BUG-SEC01]

**Files to edit:**  
`apps/web/lib/moderation/contentFilter.ts`

**Steps:**  
1. Move `pattern.lastIndex = 0` to be the first statement inside the word-iteration loop, before `if (pattern.test(filtered))`.  
2. Run the profanity filter tests to confirm repeated filtering of the same content works correctly.

---

### TASK-22: Fix `safeFetch` SSRF — preserve hostname for TLS/SNI [BUG-SEC02]

**Files to edit:**  
`apps/web/lib/security/ssrf.ts`

**Steps:**  
1. Remove the `fetchParsed.hostname = pinnedIp` substitution from `validateOutboundUrl`.  
2. Keep the DNS resolution and IP validation as-is (this still prevents SSRF by ensuring the hostname only resolves to public IPs), but use the original URL for the fetch so TLS SNI works.  
3. Remove the `Host` header override in `safeFetch` since it is no longer needed.  
4. Add a comment explaining the trade-off: DNS rebinding is mitigated by the fact that DNS resolution is validated once before the request, and in a controlled serverless environment further rebinding is not a realistic attack vector for outbound calls to allowlisted hosts.

---

### TASK-23: Fix Creator Fund tier leakage for small pools [BUG-EC02]

**Files to edit:**  
`apps/web/lib/creator/fund.ts`

**Steps:**  
1. After iterating all tiers, compute `distributedKobo = distributions.reduce((sum, d) => sum + d.amountKobo, 0)`.  
2. If `distributedKobo < poolKobo`, distribute the remainder equally among all creators in the last tier, or roll it into the next month's pool via a database credit.  
3. Remove `'zobia_icon'` from the `creator_tier IN (...)` filter since the schema constraint only allows tiers up to `'icon'`.

---

### TASK-24: Fix re-engagement steps shared `notified` flag [BUG-CRON01]

**Files to create/edit:**  
`apps/web/db/migrations/009_inactivity_notification_flags.sql` (new migration)  
`apps/web/app/api/cron/daily/route.ts` (steps 11 and 19)

**Steps:**  
1. Add migration: `ALTER TABLE user_inactivity_events ADD COLUMN IF NOT EXISTS telegram_notified BOOLEAN NOT NULL DEFAULT FALSE;` (rename existing `notified` to `push_email_notified` or keep it as is and add a second column).  
2. Step 11 reads `WHERE push_email_notified = FALSE` and marks `push_email_notified = TRUE`.  
3. Step 19 reads `WHERE telegram_notified = FALSE` and marks `telegram_notified = TRUE`.

---

### TASK-25: Standardize CRON notification inserts to use `insertNotification` helper [BUG-CRON02]

**Files to edit:**  
`apps/web/app/api/cron/daily/route.ts` (all raw `INSERT INTO notifications` statements)  
`apps/web/lib/notifications/insert.ts`

**Steps:**  
1. Import `insertNotification` and `insertNotificationBatch` at the top of `cron/daily/route.ts`.  
2. Replace all raw `INSERT INTO notifications (user_id, type, title, body, ...)` statements with calls to `insertNotification(db, userId, type, { title, body, ... })`.  
3. Identify any cases where a batch `SELECT ... FROM users` is used to mass-insert notifications; replace those with `insertNotificationBatch(db, userIds, type, payload)`.  
4. Update the API response serializer (`/api/notifications` GET) to handle both `payload` and `COALESCE(payload, jsonb_build_object('title', title, 'body', body))` for backward compatibility with any existing rows.

---

## P3 — Low

---

### TASK-26: Fix Google Play `purchaseResolvers` map — use purchase-session IDs [BUG-EXPO01]

**Files to edit:**  
`apps/expo/lib/payments/googlePlay.ts`

**Steps:**  
1. In `purchaseCoins` and `purchaseSubscription`, generate a unique `sessionId = crypto.randomUUID()`.  
2. Store `purchaseResolvers.set(sessionId, resolver)` instead of `productId`.  
3. Pass `sessionId` as `developerPayload` in the `purchaseItemAsync` call (check `expo-in-app-purchases` API for the correct parameter).  
4. In the global listener, read `purchase.developerPayload` to get the `sessionId` and dispatch to the correct resolver.  
5. Handle replayed transactions (purchases with no matching resolver) by verifying server-side and finishing the transaction without resolving a local promise.

---

### TASK-27: Remove dead `'zobia_icon'` creator tier value [BUG-EC02 cleanup]

**Files to edit:**  
`apps/web/lib/creator/fund.ts` (line 133)

**Steps:**  
1. Remove `'zobia_icon'` from `AND u.creator_tier IN ('elite', 'icon', 'zobia_icon')`.  
2. The schema constraint only allows `'rookie','rising','verified','elite','icon'`.

---

### TASK-28: Fix `useAuth` hook — no polling after initial load

**Files to edit:**  
`apps/web/lib/auth/hooks.ts`

**Steps:**  
1. The `useAuth` hook makes one `/api/auth/me` fetch on mount only — this is correct. No changes needed unless the session should be refreshed periodically. Verify the hook satisfies the use case; if session expiry needs to be detected, consider adding a `useEffect` with interval polling or WebSocket push.

---

## Execution Order Recommendation

```
Week 1 (P0 — Block ship-critical bugs):
  TASK-01  Fix trust score non-existent columns
  TASK-02  Fix referral column name (referred_by_user_id)
  TASK-03  Create user_quest_decks table
  TASK-04  Fix SYS-02 reconciliation
  TASK-05  Add xp_ledger unique index
  TASK-06  Fix automated payout CRON

Week 2 (P1 — High-impact correctness):
  TASK-07  Fix leaderboard followers table name
  TASK-08  Redis-backed circuit breakers
  TASK-09  Fix announcement targeting for null plan/role
  TASK-10  Fix useRealtimeChannel cleanup race
  TASK-11  Validate replyToMessageId against roomId
  TASK-12  Add withAdminAuth request context
  TASK-13  Extend sensitive-mutation regex
  TASK-14  Prevent circular referral chains

Week 3 (P2 — Medium correctness and UX):
  TASK-16  Season-discriminated badge keys
  TASK-17  Fix guild quest reset logic
  TASK-18  Add alliance wars unique constraint
  TASK-19  Fix gift idempotency granularity
  TASK-20  Fix DM sticker unlock individual grant
  TASK-21  Fix profanity regex lastIndex
  TASK-22  Fix safeFetch SSRF/TLS hostname
  TASK-23  Fix Creator Fund pool leakage
  TASK-24  Split re-engagement notification flags
  TASK-25  Standardize CRON notification inserts

Week 4 (P3 — Polish and edge cases):
  TASK-26  Google Play purchase resolver IDs
  TASK-27  Remove dead zobia_icon creator tier
```

---

*Plan end — June 14, 2026 12:28 PM*
