# Zobia Social — Forensic Bug Report

**Generated:** June 14, 2026 12:28 PM  
**Scope:** Full codebase — web app, PWA, Expo Android app  
**Method:** Deep forensic manual code review + schema cross-validation against all migration files  

---

## Code Quality Rating

### Current State: 6.5 / 10

The codebase demonstrates strong architectural intent: append-only ledgers, atomic Lua scripts for rate limiting, deterministic lock ordering for deadlock prevention, circuit breakers, XP dead-letter queues, CSRF/SSRF protections, per-request CSP nonces, and constant-time HMAC comparison. These are the marks of a thoughtful engineering team.

However, the codebase has a systemic problem: **column and table names in application code diverge from the actual database schema**. Several critical features — trust scores, referral commissions, ledger reconciliation, and the quest deck bonus — will throw runtime DB errors because the code references columns and tables that don't exist. Additionally, the XP deduplication mechanism relies on an `ON CONFLICT DO NOTHING` clause without the underlying unique constraint to back it up.

### Projected State After All Fixes: 8.5 / 10

Applying all fixes below would bring the app to a high standard. The core architecture is sound; the bugs are mostly fixable schema mismatches and logic errors rather than fundamental design flaws.

---

## Complete Bug List (Quick Reference)

1. BUG-DB01 — `trustScore.ts` queries non-existent columns `users.report_count` and `users.warning_count`
2. BUG-DB02 — Referrals code queries `referred_by_user_id` column but schema column is `referred_by`
3. BUG-DB03 — `user_quest_decks` table referenced in `checkDeckCompletion` does not exist in any migration
4. BUG-DB04 — SYS-02 reconciliation queries a `wallets` table and `coin_ledger.direction` column that do not exist
5. BUG-DB05 — `getUserMetricsForWeighting` queries `followers` table; schema uses `follows`
6. BUG-DB06 — `xp_ledger` has no unique index on `(user_id, source, reference_id)` — `safeAwardXP` deduplication is a no-op
7. BUG-EC01 — Automated payout CRON creates records without `bank_account_snapshot` — every auto-payout is immediately dead-lettered
8. BUG-EC02 — Creator Fund tier math leaves 60%+ of pool undistributed for small eligible creator sets
9. BUG-EC03 — Referral circular chain (A→B→C→A) not prevented; only direct 2-hop cycles checked
10. BUG-XP01 — Quest deck completion bonus (500 XP) never awarded because `user_quest_decks` table is missing
11. BUG-XP02 — `season_top100_frame` badge uses static badge_key with no season discriminator
12. BUG-XP03 — `claimPassMilestone` season pass badge_key collision — second-season badge silently no-ops
13. BUG-GW01 — Weekly guild quest reset is a SQL no-op — old incomplete quests never marked inactive
14. BUG-GW02 — Alliance war `ON CONFLICT DO NOTHING` has no unique constraint target — duplicate war rows can be inserted
15. BUG-MSG01 — `replyToMessageId` not validated against the current `roomId` — cross-room reply injection possible
16. BUG-MSG02 — Gift hourly idempotency bucket too aggressive — one gift per type per recipient per hour
17. BUG-MSG03 — DM conversation score sticker unlocks never actually grant individual user sticker packs
18. BUG-AUTH01 — `withAdminAuth` missing request context wrapper and `X-Request-Id` correlation header
19. BUG-AUTH02 — `withAuth` sensitive-mutation regex misses economy coin/star purchase endpoints
20. BUG-SEC01 — Profanity regex `lastIndex` not reset before `.test()` call — can miss matches
21. BUG-SEC02 — `safeFetch` SSRF protection breaks HTTPS via TLS SNI mismatch when connecting to pinned IP
22. BUG-SEC03 — Announcement targeting bypasses plan/role filter when user has null plan or null role
23. BUG-CRON01 — Re-engagement push/email (step 11) and Telegram (step 19) share one `notified` flag
24. BUG-CRON02 — CRON notification inserts inconsistently use `payload` vs `title`/`body` columns
25. BUG-RT01 — `useRealtimeChannel` async cleanup race — subscription leaks if component unmounts before setup completes
26. BUG-INF01 — Circuit breakers are in-process singletons; ineffective in serverless (no Redis-backed variant)
27. BUG-EXPO01 — Google Play `purchaseResolvers` map unsafe for concurrent or replayed purchases

---

## Detailed Bug Entries

---

### 1. BUG-DB01 — `trustScore.ts` queries non-existent columns `report_count` / `warning_count`

**FILES:**  
`apps/web/lib/trust/trustScore.ts`  
`apps/web/db/migrations/001_complete_schema.sql`

**FIX:**  
`calculateTrustScore` fetches `COALESCE(u.report_count, 0)` and `COALESCE(u.warning_count, 0)` directly from the `users` table. These columns do not exist in the schema. Every call to `calculateTrustScore` (and by extension `meetsMinimumTrust` when the score is null) throws a PostgreSQL "column does not exist" error. This silently breaks the entire trust gate system — gifts, coin withdrawals, classroom creation, guild creation, and moderator nomination all depend on `meetsMinimumTrust`. Replace the direct column reads with correlated subqueries: `(SELECT COUNT(*) FROM reports WHERE reported_user_id = u.id)` for `report_count`, and `(SELECT COUNT(*) FROM moderation_actions WHERE target_user_id = u.id AND action_type = 'warning')` for `warning_count`. Also re-examine whether `is_banned` on users and `moderation_actions` cover all the trust signal categories the scoring formula intends.

---

### 2. BUG-DB02 — Referrals code queries `referred_by_user_id`; schema column is `referred_by`

**FILES:**  
`apps/web/lib/referrals/commissions.ts` (lines 68–69, 150–151)  
`apps/web/app/api/referrals/claim/route.ts` (lines 70, 130–131)  
`apps/web/db/migrations/001_complete_schema.sql`

**FIX:**  
The `users` schema defines the column as `referred_by UUID`. Both `commissions.ts` and `referrals/claim/route.ts` query and write `referred_by_user_id`, which does not exist. Every referral claim and every commission calculation fails with a DB column error. Either rename the schema column (`ALTER TABLE users RENAME COLUMN referred_by TO referred_by_user_id;` in a new migration) or update all application references to use `referred_by`. Whichever direction is chosen, verify there are no other files with either name before making the change.

---

### 3. BUG-DB03 — `user_quest_decks` table does not exist; `checkDeckCompletion` queries it

**FILES:**  
`apps/web/lib/quests/questEngine.ts`  
`apps/web/db/migrations/001_complete_schema.sql`

**FIX:**  
`generateDailyDeck` never inserts into a `user_quest_decks` table, and no such table exists in any migration. `checkDeckCompletion` filters using `WHERE uqp.quest_id IN (SELECT quest_id FROM user_quest_decks WHERE user_id = $1 AND assigned_date = $2::date)` — this subquery throws "relation does not exist" at runtime, so the 500 XP deck completion bonus is never awarded. Either create the missing table with a migration and populate it in `generateDailyDeck`, or rewrite `checkDeckCompletion` to identify the deck entirely from `user_quest_progress` by `(user_id, quest_date)` without a separate decks table.

---

### 4. BUG-DB04 — SYS-02 reconciliation queries non-existent `wallets` table and `coin_ledger.direction` column

**FILES:**  
`apps/web/app/api/cron/daily/route.ts` (SYS-02 step, lines ~2385–2435)  
`apps/web/db/migrations/001_complete_schema.sql`

**FIX:**  
The nightly SYS-02 step joins `JOIN wallets w ON w.user_id = cl.user_id` and aggregates `cl.direction`. Neither the `wallets` table nor a `direction` column on `coin_ledger` exist. Balances live on `users.coin_balance` and `users.star_balance`; `coin_ledger.amount` is a signed BIGINT (positive = credit, negative = debit). Rewrite the reconciliation to `JOIN users u ON u.id = cl.user_id` and compare `SUM(cl.amount)` against `u.coin_balance` / `u.star_balance`. Every CRON run silently fails this step without this fix.

---

### 5. BUG-DB05 — `getUserMetricsForWeighting` queries non-existent `followers` table

**FILES:**  
`apps/web/lib/leaderboards/engine.ts` (line 422)  
`apps/web/db/migrations/001_complete_schema.sql`

**FIX:**  
The query uses `LEFT JOIN followers f ON f.user_id = u.id`. The schema table is `follows` with columns `follower_id` and `following_id`. Fix the join: `LEFT JOIN follows f ON f.following_id = u.id`. This function provides weighted scoring metrics used by leaderboard analytics; currently it throws a DB error on every call.

---

### 6. BUG-DB06 — `xp_ledger` missing unique constraint; `safeAwardXP` deduplication is a no-op

**FILES:**  
`apps/web/lib/xp/safeAwardXP.ts`  
`apps/web/db/migrations/001_complete_schema.sql`

**FIX:**  
`safeAwardXP` inserts with `ON CONFLICT DO NOTHING` intending to prevent double XP awards on retry when a `reference_id` is supplied. No unique constraint exists on `xp_ledger(user_id, source, reference_id)` — unlike `failed_xp_awards` which correctly has `CONSTRAINT uq_failed_xp_reference UNIQUE (user_id, source, reference_id)`. Without the constraint, `ON CONFLICT DO NOTHING` is inert; retries insert duplicate rows and double-credit XP. Add a new migration: `CREATE UNIQUE INDEX IF NOT EXISTS uidx_xp_ledger_source_ref ON xp_ledger(user_id, source, reference_id) WHERE reference_id IS NOT NULL;`

---

### 7. BUG-EC01 — Automated payout CRON omits `bank_account_snapshot`; all auto-payouts are dead-lettered

**FILES:**  
`apps/web/app/api/cron/daily/route.ts` (step 32, weekly automated payouts)  
`apps/web/lib/payments/payouts.ts`

**FIX:**  
CRON step 32 inserts `creator_payouts` rows without populating `bank_account_snapshot`. The `attemptTransfer` function immediately checks `if (!snapshot?.recipient_code)` and calls `moveToDeadLetterQueue`, so every auto-initiated payout is dead-lettered before the first transfer attempt. The payout query already fetches `payout_recipient_code` and `payout_account_last4` from `users` but never passes them to the INSERT. Fix: include `bank_account_snapshot = jsonb_build_object('recipient_code', u.payout_recipient_code, 'account_last4', COALESCE(u.payout_account_last4, ''))` in the payout row INSERT.

---

### 8. BUG-EC02 — Creator Fund pool leakage: small eligible creator pools leave most funds undistributed

**FILES:**  
`apps/web/lib/creator/fund.ts`

**FIX:**  
`calculateFundDistributions` slices creators into 5 tiers using `Math.floor((tier.topPercent / 100) * total)` cutoffs. With fewer than ~20 eligible creators, tiers 2–4 produce empty slices and their pool shares (25% + 20% + 15% = 60%) go undistributed. With 5 eligible creators, only 40% of the monthly fund is paid out. Add a redistribution step: after all tier slices are computed, if any pool share goes unclaimed, distribute it proportionally across all eligible creators (or add it to the next tier's allocation). Also remove the dead-code `'zobia_icon'` value from the `creator_tier IN (...)` filter — the schema only allows tiers up to `'icon'`.

---

### 9. BUG-EC03 — Referral circular chain (3-hop) enables commission loops

**FILES:**  
`apps/web/lib/referrals/commissions.ts`

**FIX:**  
`awardReferralCommissions` prevents a buyer from being their own tier-2 referrer (`tier2Id === buyerId`) but does not prevent 3-hop cycles (A refers B, B refers C, C refers A). When C buys, tier1=B, tier2=A — since `A !== C` the check passes, and A receives perpetual tier-2 commission on all of C's purchases. Add `if (tier2Id === buyerId || tier2Id === tier1Id) return result;` to also prevent the case where the tier-2 and tier-1 referrer are the same person. For more complete protection, enforce a maximum referral chain depth at claim time (prevent claiming a referral code from any user already in your own referral chain).

---

### 10. BUG-XP01 — Quest deck completion bonus (500 XP) never awarded

**FILES:**  
`apps/web/lib/quests/questEngine.ts`

**FIX:**  
This is the symptom of BUG-DB03. `checkDeckCompletion` queries the non-existent `user_quest_decks` table and throws at runtime. Even if the error is caught silently, the bonus XP is never awarded. Fix by resolving BUG-DB03; additionally, add explicit try-catch logging inside `checkDeckCompletion` and ensure callers surface the error if it occurs, rather than swallowing it.

---

### 11. BUG-XP02 — `season_top100_frame` badge uses static key with no season discriminator

**FILES:**  
`apps/web/app/api/cron/daily/route.ts` (weekly leaderboard snapshot step, ~line 284)

**FIX:**  
The weekly top-100 snapshot awards `badge_key = 'season_top100_frame'` to leaderboard ranks 11–100. The `user_badges` unique partial index `ON (user_id, badge_key) WHERE badge_key IS NOT NULL` means a user in the top 100 for Season 2 gets `ON CONFLICT DO NOTHING` if they were already awarded this badge in Season 1 — no new badge is created, and the `granted_at` date is not updated. Compare with how `distributeSeasonRewards` correctly uses `'season_top10:' || season.id`. Fix: use `'season_top100_frame:' || season_id` as the badge key, and update any frontend display logic to handle the season-specific key format.

---

### 12. BUG-XP03 — Season pass milestone badge_key collision across seasons

**FILES:**  
`apps/web/lib/seasons/seasonEngine.ts` (`claimPassMilestone`)

**FIX:**  
For `badge` and `title` reward types, `claimPassMilestone` inserts with `badge_key = badgeType` (e.g., `'season_pass_holder'`). Due to the unique index, a Season 2 claim by a user who already claimed this badge in Season 1 silently no-ops. The user gets no feedback that their Season 2 badge grant failed. Append the season or milestone ID to make the key unique per-season: `badge_key = badgeType || ':s' || seasonId`. Update any badge display queries accordingly.

---

### 13. BUG-GW01 — Weekly guild quest reset is a SQL no-op

**FILES:**  
`apps/web/app/api/cron/daily/route.ts` (step 23, weekly guild quest reset)

**FIX:**  
The reset query sets `completed = CASE WHEN completed THEN completed ELSE false END` on old incomplete quests — which sets `completed = false` where `completed` was already `false`. No rows change. Old quests are never marked expired or retired. The fix depends on the intended behavior: if old quests should be expired and not visible, either add an `is_active`/`expired_at` column to `guild_quests` and set it in this step, or DELETE the stale progress records and INSERT new quest assignments for the week. Also confirm whether complete guild quests should be archived or deleted.

---

### 14. BUG-GW02 — Alliance war insertion `ON CONFLICT DO NOTHING` has no backing unique constraint

**FILES:**  
`apps/web/app/api/cron/daily/route.ts` (alliance war creation step)  
`apps/web/db/migrations/001_complete_schema.sql`

**FIX:**  
Alliance war rows are inserted with `ON CONFLICT DO NOTHING` with no conflict target. Without a relevant unique constraint on the `alliance_wars` table (e.g., on `(guild_id, opponent_id, week_start)` or similar), this clause only catches primary key collisions — which never happen for new UUIDs. Each CRON run that triggers the alliance war step can insert duplicate war rows. Add a unique constraint to the table: `UNIQUE(guild_id_1, guild_id_2, week_of)` (adjusting to actual column names), and reference it in the `ON CONFLICT` clause.

---

### 15. BUG-MSG01 — `replyToMessageId` not validated against current room

**FILES:**  
`apps/web/app/api/rooms/[roomId]/messages/route.ts`

**FIX:**  
When a message POST body includes `replyToMessageId`, it is passed directly to the INSERT without verifying that the referenced message belongs to the same `roomId`. A malicious user can reply to a message from any room, creating semantically invalid reply links that expose message IDs from rooms the user may not have access to. Before inserting, validate: `SELECT 1 FROM room_messages WHERE id = $replyToMessageId AND room_id = $roomId` and return a 422 if not found.

---

### 16. BUG-MSG02 — Gift hourly idempotency bucket too aggressive — blocks legitimate repeat gifts

**FILES:**  
`apps/web/app/api/economy/gifts/send/route.ts`

**FIX:**  
The fallback idempotency key `idempotency:gift:{senderId}:{recipientId}:{giftItemId}:{YYYY-MM-DDTHH}` limits any specific gift type to one per recipient per hour. Users who want to send the same gift twice in an hour (a legitimate use case, e.g., cheering repeatedly during a live event) are silently blocked. Consider: either narrow the bucket to per-minute, use only the client-supplied idempotency key (no server-side fallback bucket), or make the bucket broader (24h) but tie it to explicit retry detection.

---

### 17. BUG-MSG03 — DM conversation score sticker unlocks never grant individual sticker packs

**FILES:**  
`apps/web/lib/messaging/conversationScore.ts`  
`apps/web/app/api/cron/daily/route.ts` (step 22, DM sticker unlocks)

**FIX:**  
When a conversation score crosses a threshold (100 / 250 points), the pair achievement is recorded in `dm_score_sticker_unlocks` but neither user's `user_sticker_packs` is updated. The daily CRON step 22 should read unprocessed `dm_score_sticker_unlocks` rows and grant the pack to each user individually. Verify that step 22 actually does this — if it only sends a notification without inserting into `user_sticker_packs`, add the INSERT for both `user_id_1` and `user_id_2`. Add a `processed_at` column to `dm_score_sticker_unlocks` to prevent re-processing.

---

### 18. BUG-AUTH01 — `withAdminAuth` missing request context and `X-Request-Id` correlation

**FILES:**  
`apps/web/lib/api/middleware.ts`

**FIX:**  
`withAuth` wraps each request in `requestContext.run()`, generating and forwarding a correlation ID, and sets `X-Request-Id` on every response. `withAdminAuth` skips both. Admin request logs have no correlation ID, making production incident tracing nearly impossible. Apply the same `requestContext.run()` pattern and `X-Request-Id` header logic from `withAuth` to `withAdminAuth`. This is a low-risk, copy-and-adapt change.

---

### 19. BUG-AUTH02 — `withAuth` sensitive-mutation regex misses purchase endpoints

**FILES:**  
`apps/web/lib/api/middleware.ts`

**FIX:**  
The `isSensitiveMutation` check `/\/(payments|payouts|gifts|coins\/transfer|stars\/gift|economy\/webhooks)/` is used to decide whether to re-validate account status (checking suspension, ban) on each request. Coin purchase (`/api/economy/coins/purchase`) and star purchase (`/api/economy/stars/purchase`) are not matched. A suspended user could complete a purchase. Expand the regex to include `economy\/coins\/purchase` and `economy\/stars\/purchase`, or replace the regex with an explicit path-prefix allow-list.

---

### 20. BUG-SEC01 — Profanity regex `lastIndex` not reset before `.test()` — can skip matches

**FILES:**  
`apps/web/lib/moderation/contentFilter.ts`

**FIX:**  
Inside the profanity word iteration, `pattern.test(filtered)` is called in an `if` condition. After a global regex's `.test()` returns `true`, `lastIndex` advances. On a subsequent call to `filterProfanity` for the same cached regex object (5-min TTL cache), `.test()` starts from the advanced `lastIndex` and can miss a match at the start of the string, returning `false` and skipping the replacement. The explicit `pattern.lastIndex = 0` after the block runs only once per iteration and only if `test()` matched. Move the reset to immediately before the `if (pattern.test(filtered))` line.

---

### 21. BUG-SEC02 — `safeFetch` SSRF protection breaks HTTPS via TLS SNI mismatch

**FILES:**  
`apps/web/lib/security/ssrf.ts`

**FIX:**  
`validateOutboundUrl` replaces the URL hostname with the pinned resolved IP. In Node.js's native `fetch` and Vercel's Edge Runtime, TLS SNI is derived from the URL's hostname — which is now the IP address. Connecting to `https://104.21.0.1/...` sends SNI `104.21.0.1`, failing certificate validation for domain-certified API servers. All URLs in `HOSTNAME_ALLOWLIST` are HTTPS-only APIs, so `safeFetch` with `requireAllowlist: true` will always fail in production. Short-term fix: validate the resolved DNS IPs without substituting the IP into the URL (keep the original hostname in the URL so TLS works normally). This accepts a theoretical DNS-rebinding risk that is minimal for server-to-server calls to trusted external APIs behind Vercel's edge network. Long-term, use `node:https` with `servername` to pin SNI separately from the connection target.

---

### 22. BUG-SEC03 — Announcement targeting bypasses plan/role filter when user has null plan or role

**FILES:**  
`apps/web/lib/announcements/engine.ts`

**FIX:**  
`matchesTargeting` checks `if (targetPlans.length > 0 && user.plan_id)`. If `user.plan_id` is `null` (free/unassigned users), the plan-restriction check is skipped and the announcement is shown regardless of targeting. Same pattern for `user.role`. Change to unconditional membership check:
```ts
if (targetPlans.length > 0 && (!user.plan_id || !targetPlans.includes(user.plan_id))) return false;
if (targetRoles.length > 0 && (!user.role || !targetRoles.includes(user.role))) return false;
```
This correctly excludes users with no plan from plan-targeted announcements.

---

### 23. BUG-CRON01 — Push/email and Telegram re-engagement steps share `notified` flag

**FILES:**  
`apps/web/app/api/cron/daily/route.ts` (steps 11 and 19)

**FIX:**  
Steps 11 (push + email) and 19 (Telegram queue) both query `user_inactivity_events WHERE notified = false` and mark `notified = true`. If step 11 fails for a specific user but step 19 succeeds, that user gets Telegram but never gets push/email, and the `notified = true` flag prevents any future retry. Use separate columns — `push_email_notified BOOLEAN` and `telegram_notified BOOLEAN` — or process both steps atomically so a partial failure is not masked by the shared flag.

---

### 24. BUG-CRON02 — Notification inserts inconsistently populate `payload` vs `title`/`body` columns

**FILES:**  
`apps/web/app/api/cron/daily/route.ts`  
`apps/web/lib/notifications/insert.ts`

**FIX:**  
The `notifications` schema has both a `payload JSONB` and separate `title TEXT`, `body TEXT`, `metadata JSONB` columns (all nullable). The `insertNotification` helper and most routes populate only `payload`. Some CRON steps (guild discovery, guild low contribution, guild tier demotion) do raw SQL with `title`/`body`/`metadata`. If the frontend API serialises only `payload`, those notifications render empty. Standardise all inserts to use the `insertNotification(db, userId, type, { ... })` helper so all notifications use the same column, and update the API response serializer to read from `COALESCE(payload, jsonb_build_object('title', title, 'body', body, 'metadata', metadata))` to handle legacy rows.

---

### 25. BUG-RT01 — `useRealtimeChannel` async cleanup races with component unmount

**FILES:**  
`apps/web/lib/realtime/useRealtimeChannel.ts`

**FIX:**  
The `cleanup` variable is assigned inside an async IIFE. The `useEffect` cleanup function (`return () => { cleanup?.(); }`) executes synchronously on unmount. If the component unmounts before the async IIFE resolves (dynamic import pending or subscription setup in-flight), `cleanup` is still `undefined`, the subscription is never torn down, and event listeners leak. Add a cancellation flag:
```ts
let cancelled = false;
let cleanup: (() => void) | undefined;
(async () => {
  const unsub = await subscribeToProvider(...);
  if (cancelled) { unsub?.(); return; }
  cleanup = unsub;
})();
return () => { cancelled = true; cleanup?.(); };
```
Apply this pattern for all three provider branches (Supabase, Ably, Pusher).

---

### 26. BUG-INF01 — Circuit breakers are in-process singletons; reset on every cold start in serverless

**FILES:**  
`apps/web/lib/payments/circuit.ts`

**FIX:**  
`paystackBreaker`, `expoPushBreaker`, and `dodoPaymentsBreaker` are module-level `CircuitBreaker` instances that hold state in-memory. In Vercel serverless, each function invocation can spin up a fresh process, resetting circuit state to CLOSED regardless of how many failures recently occurred. The file comments acknowledge the problem ("For distributed state across instances, use the Redis-backed variant below") but no Redis variant was implemented. Build a Redis-backed circuit breaker that stores `{ state, openedAt, failureCount, windowStart }` in a Redis hash with atomic WATCH/MULTI updates or a Lua script, keyed by circuit name. This is the only way the breaker actually protects against cascading failures in a serverless deployment.

---

### 27. BUG-EXPO01 — Google Play `purchaseResolvers` map unsafe for concurrent or replayed purchases

**FILES:**  
`apps/expo/lib/payments/googlePlay.ts`

**FIX:**  
`purchaseResolvers` maps `productId → resolver`. Two issues: (1) Two simultaneous purchases of the same product ID overwrite each other's resolver — the first caller's promise never resolves. (2) Google Play can replay unacknowledged transactions from prior sessions; the global listener dispatches them to the current resolver for that product, potentially crediting the wrong purchase flow or resolving a stale promise. Fix: generate a unique purchase-session ID (`crypto.randomUUID()`) per `purchaseCoins`/`purchaseSubscription` call, store it in the purchase request metadata, and use it as the resolver map key. In the listener, read the purchase-session ID from `purchase.developerPayload` or metadata and dispatch accordingly. Also guard against replayed transactions by checking `purchase.purchaseState` and whether the session's resolver is still active.

---

## Informational / Minor Issues

- **INFO-01**: `lib/mystery/xpDrop.ts` — `randomInt` uses `buf[0] % range` (modular bias). For range 901, bias is ~0.021% — negligible.
- **INFO-02**: `lib/auth/google.ts` uses Axios while most server-side code uses native `fetch`. No functional issue, but adds a dependency for no reason.
- **INFO-03**: `lib/payments/dodopayments.ts:verifyWebhookSignature` does a length check before the constant-time loop. Safe, since the expected HMAC is always 64 hex chars.
- **INFO-04**: `apps/expo/lib/offline/syncQueue.ts` — `state.isInternetReachable === null` (unknown) skips sync. Conservative and correct.
- **INFO-05**: `lib/security/htmlSanitizer.ts` — Relative URLs, HTTP links, anchors, and relative paths are all stripped by the sanitizer. Only `https://` and `mailto:` pass. May be intentional but should be documented so content editors know.

---

*Report end — June 14, 2026 12:28 PM*
