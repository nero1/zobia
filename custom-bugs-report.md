# Zobia Codebase — Forensic Bug Report

**Generated:** 2026-06-19 06:40 PM  
**Scope:** `apps/web` (Next.js 14 App Router + PWA), `apps/expo` (React Native / Android), `shared/`  
**Analyst:** Claude Code — independent analysis, no prior bug reports referenced

---

## Summary List — All Bugs Found

1. BUG-SCHEMA-01: `nemesisAssignments` unique index on `(userId, track, isActive)` causes constraint violation on re-deactivation
2. BUG-SCHEMA-02: `users.coinBalance` bigint stored as JS `number` — precision lost above MAX_SAFE_INTEGER
3. BUG-SCHEMA-03: `rooms.slug` is nullable — rooms without slugs unreachable via public /r/ URL
4. BUG-SCHEMA-04: `pushTickets` partial index uses unqualified column reference `status = 'pending'`
5. BUG-MW-01: `validateBody`/`validateSearchParams` throw ZodError not ApiError — can cause 500 in unwrapped handlers
6. BUG-RT-01: Web Ably `useRealtimeChannel` fast-unmount race — cleanup closure may never fire on early unmount
7. BUG-RT-02: Web Pusher `useRealtimeChannel` spawns a new Pusher client per hook instance — multiple concurrent WebSocket connections
8. BUG-WAR-01: `distributeWarRewards` with exactly 2 members produces wrong payout split
9. BUG-WAR-02: `resolveWar` silently swallows guild tier-history insert errors via empty `.catch()`
10. BUG-PUSH-01: `pollPushReceipts` marks entire batch `checked_at` before processing individual results — mid-batch exception strands tickets
11. BUG-PUSH-02: Push notification recipient query never filters by `last_seen_at` — sends to stale/abandoned devices indefinitely
12. BUG-QUEST-01: `updateQuestProgress` silently falls back to "main" XP track for any unrecognized `action_type`
13. BUG-QUEST-02: Quest engine double-awards main XP when `parallelTrack` is null — `null ?? "main"` awards main XP a second time
14. BUG-XP-01: `safeAwardXP` DLQ write is unawaited — lost on process termination immediately after primary failure
15. BUG-SEASON-01: `resetSeasonRankings` resets `user_season_passes.season_xp` but not `users.season_xp` — counter divergence at season end
16. BUG-SEASON-02: Season pass `xp_bonus` milestone only credits `users.xp_total`, not `users.season_xp` — milestone XP invisible in season leaderboard
17. BUG-SEASON-03: `createSeasonCeremonyRoom` creates a room without a slug — ceremony room unreachable via /r/ URL
18. BUG-SEASON-04: `claimPassMilestone` sticker_pack lookup uses ambiguous `slug = $1 OR name = $1`
19. BUG-PAY-01: `processChargeSuccess` uses `null as unknown as string` type cast — suppresses TypeScript safety, risks runtime NPE
20. BUG-FUND-01: Creator fund `normalise()` returns 1 for all when all values equal — inflates scores when all creators score 0 on a metric
21. BUG-NEM-01: `compareNemesisProgress` missing "gaming" track — throws unhandled error on gaming comparison request
22. BUG-ANN-01: `getActiveModalForUser` records modal view at API call time before client confirms display
23. BUG-GAME-01: `declineChallenge` non-null asserts a post-transaction re-fetch — crashes if row deleted concurrently
24. BUG-GAME-02: `createChallenge` builds PostgreSQL interval via string concatenation — fragile on non-integer input
25. BUG-GAME-03: `createChallenge` accepts arbitrarily large wagers with no server-side maximum
26. BUG-MOD-01: `detectBotBehavior` only counts room message velocity — DM flooding bypasses bot detection
27. BUG-AUTH-01: L1 in-process session cache (10 s TTL) allows revoked/banned sessions to remain active up to 10 seconds
28. BUG-AUTH-02: `verifyTotp` uses `===` string comparison instead of `crypto.timingSafeEqual` — timing side-channel
29. BUG-GIFT-01: `retireGiftDrop` runs two non-transactional UPDATEs — partial failure leaves drop deactivated but gift item un-retired
30. BUG-OFFLINE-01: Web PWA `getQueueCounts` calls `getAllMessages` — counts sent/failed messages as pending, inflating UI indicators

---

## Detailed Entries

---

### 1: BUG-SCHEMA-01: nemesisAssignments unique index breaks on re-deactivation

**FILES:**
- `apps/web/lib/db/schema.ts`
- `apps/web/lib/nemesis/nemesisEngine.ts`

**FIX:** The partial unique index `UNIQUE (user_id, track, is_active) WHERE is_active = TRUE` is correct for preventing duplicate active assignments. The risk arises when any code path tries to set `is_active = FALSE` on a row that is already inactive and then re-insert a new active row — the WHERE clause is on the unique index, so duplicate (user, track, FALSE) rows are never caught by it and accumulate. In `assignNemesis`, the deactivation UPDATE must include `AND is_active = TRUE` to be a no-op on already-inactive rows. Verify that all deactivation paths carry this guard, and add a separate partial index on `(userId, track) WHERE is_active = FALSE` if you need uniqueness on inactive records too.

---

### 2: BUG-SCHEMA-02: coinBalance bigint stored as JS number — precision loss

**FILES:**
- `apps/web/lib/db/schema.ts` (`users.coinBalance` and all other `bigint mode:"number"` columns)
- `apps/web/lib/economy/coins.ts`

**FIX:** `bigint("coin_balance", { mode: "number" })` instructs Drizzle to deserialize PostgreSQL bigint as JavaScript `number`. JavaScript `number` is IEEE 754 double-precision, which can only represent integers exactly up to 2^53−1 (~9 quadrillion). Coin balances are unlikely to ever reach that, but the same mode is used for all monetary `bigint` columns (kobo amounts, XP amounts, etc.) — any value above ~9 quadrillion loses precision silently. Either change mode to `"bigint"` and propagate `BigInt` types through the economy logic, or enforce a safe maximum ceiling with a DB CHECK constraint (`coin_balance <= 9007199254740991`) and add application-layer guards. The same issue affects `gross_amount_kobo`, `platform_fee_kobo`, `amount_kobo`, and other monetary bigint columns throughout the schema.

---

### 3: BUG-SCHEMA-03: rooms.slug is nullable — /r/ URL routing is unreliable

**FILES:**
- `apps/web/lib/db/schema.ts` (`rooms.slug`)
- `apps/web/lib/seasons/seasonEngine.ts` (`createSeasonCeremonyRoom`)

**FIX:** The `rooms.slug` column is nullable, meaning rooms can be created without a public URL handle. Any room created without a slug is silently unreachable via `/r/<slug>`. This is confirmed to happen for ceremony rooms (see BUG-SEASON-03). Either make `slug` NOT NULL with a generated fallback (e.g., auto-slug from title + short UUID) or add a DB CHECK constraint that `slug IS NOT NULL` when `is_public = TRUE`. Update all room-creation code paths to always provide a slug.

---

### 4: BUG-SCHEMA-04: pushTickets partial index uses unqualified column reference

**FILES:**
- `apps/web/lib/db/schema.ts` (`pushTickets` table index definition)

**FIX:** The partial index on `push_tickets` uses `.where(sql\`status = 'pending'\`)` with an unqualified column name. Some PostgreSQL migration contexts and ORM introspection tools resolve this fine, but it is non-standard and may silently fall back to a full-table scan or fail to apply under schema-qualified connections. Qualify the reference: `push_tickets.status = 'pending'`, or use Drizzle's typed `.where(eq(pushTickets.status, 'pending'))` form if the ORM supports it in index definitions.

---

### 5: BUG-MW-01: validateBody/validateSearchParams throw ZodError not ApiError

**FILES:**
- `apps/web/lib/api/middleware.ts` (lines ~471, ~487)

**FIX:** Both helpers call `schema.parse(raw)` which throws `ZodError` on invalid input, not an `ApiError`. They are documented as "throws a 400 ApiError." They work correctly when called inside `withAuth` or `withErrorHandling` because `handleApiError` catches `ZodError` and converts it. However, any handler that uses these helpers without those wrappers will let the `ZodError` propagate uncaught, producing a 500. Fix by wrapping `schema.parse()` in a try/catch inside each helper and rethrowing as `new ApiError(400, "VALIDATION_ERROR", ...)`, making them safe to call in any handler context.

---

### 6: BUG-RT-01: Ably useRealtimeChannel fast-unmount cleanup leak (web)

**FILES:**
- `apps/web/lib/realtime/useRealtimeChannel.ts`

**FIX:** The hook imports Ably asynchronously inside `useEffect`. If React calls the effect cleanup before the async import resolves (fast unmount), the `cleanup` variable has not been assigned yet and the cleanup function returned by `useEffect` runs before `cleanup` is set — the channel is never detached. Set a `cancelled` boolean flag before the first `await`, check it immediately after every `await`, and only proceed with channel setup if `!cancelled`. If the component unmounts during the async init, the flag prevents channel creation entirely. The Expo version of this hook handles this correctly and can serve as a reference.

---

### 7: BUG-RT-02: Pusher creates new client per hook instance (web)

**FILES:**
- `apps/web/lib/realtime/useRealtimeChannel.ts`

**FIX:** When `provider === "pusher"`, the hook creates `new Pusher(...)` inside the effect body each time a component mounts. Each component subscribed to any channel creates its own WebSocket connection, multiplying transport connections linearly with component count. This quickly exhausts Pusher's per-client channel limit and increases cost. Fix by creating a module-level singleton Pusher client (initialized lazily on first use) shared across all hook instances. The existing Ably path correctly uses a shared client and should be used as a model.

---

### 8: BUG-WAR-01: distributeWarRewards wrong split with exactly 2 members

**FILES:**
- `apps/web/lib/guilds/warEngine.ts` (`distributeWarRewards`)

**FIX:** The reward distribution awards rank-1 a fixed 30% base, then distributes 50% of the remaining pool proportionally among all members by rank weight. With exactly 2 members, rank-1 receives 30% + ~50% of remainder, while rank-2 receives only ~20% — an unintended 80/20 split. The formula was designed for larger guilds and misfires on small ones. Add a branch for guilds with 2 members that uses explicit winner/runner-up percentages (e.g., 60/40). At minimum, write unit tests covering 1-, 2-, 3-, and N-member scenarios and document the intended split for each.

---

### 9: BUG-WAR-02: resolveWar silently swallows guild tier history errors

**FILES:**
- `apps/web/lib/guilds/warEngine.ts` (`resolveWar`)

**FIX:** The guild tier history INSERT at the end of `resolveWar` is wrapped in `.catch(() => {})` — any error (constraint violation, DB unavailability) is silently discarded. Guild tier history is audit-critical data. Replace the empty catch with at minimum `logger.error(...)`, and consider moving the insert inside the main transaction block or writing to a DLQ so it can be retried. Silent data loss here undermines any future analytics or dispute resolution capability.

---

### 10: BUG-PUSH-01: pollPushReceipts marks checked_at before processing receipts

**FILES:**
- `apps/web/lib/notifications/push.ts` (`pollPushReceipts`)

**FIX:** The function fetches a batch of push tickets and immediately bulk-updates `checked_at = NOW()` for all of them before entering the per-ticket result processing loop. If an exception occurs mid-loop (network error, malformed receipt), the remaining unprocessed tickets have `checked_at` set and will not be retried. Move the `checked_at` update to per-ticket: mark each ticket only after its receipt has been handled, or use a two-phase status column (`receipt_status: 'pending' | 'processed' | 'failed'`) to distinguish state clearly.

---

### 11: BUG-PUSH-02: Push notification recipient query never filters stale device tokens

**FILES:**
- `apps/web/lib/notifications/push.ts` (`sendPushNotification`, `sendBulkPushNotification`)

**FIX:** Device push tokens are queried without any recency filter. Tokens from devices inactive for months (uninstalled apps, replaced phones) are targeted on every notification. This wastes Expo push quota and degrades throughput. Add a `last_seen_at > NOW() - INTERVAL '90 days'` (or configurable) filter to device token queries. Additionally, when Expo returns a `DeviceNotRegistered` error for a token, immediately delete or nullify that token — do not wait for the next receipt poll cycle.

---

### 12: BUG-QUEST-01: updateQuestProgress falls back to wrong XP track for unknown action types

**FILES:**
- `apps/web/lib/quests/questEngine.ts` (`updateQuestProgress`)

**FIX:** When `updateQuestProgress` encounters an `action_type` with no defined XP track mapping, it silently awards "main" XP instead. Any typo in a quest definition, or a newly added action type that lacks a mapping, quietly credits the wrong track with no error. Fix by throwing a logged error or returning early without awarding XP when no mapping is found. A runtime exhaustiveness check (or TypeScript exhaustive union) at the top of the function would catch this during development before it reaches production.

---

### 13: BUG-QUEST-02: Quest engine double-awards main XP when parallelTrack is null

**FILES:**
- `apps/web/lib/quests/questEngine.ts`
- `apps/web/lib/xp/safeAwardXP.ts`

**FIX:** After awarding the quest's `xp_reward` to the "main" track, the engine calls `safeAwardXP(userId, xpReward, parallelTrack ?? "main", ...)`. When `parallelTrack` is null, the nullish coalescing fallback evaluates to "main", causing main XP to be awarded twice for that quest completion. Fix by adding a null-guard: only execute the parallel-track award when `parallelTrack !== null`. The null case should be a no-op.

---

### 14: BUG-XP-01: safeAwardXP DLQ write is unawaited — lost on fast process exit

**FILES:**
- `apps/web/lib/xp/safeAwardXP.ts` (catch block)

**FIX:** After a primary XP award failure, the DLQ insert into `failed_xp_awards` is issued without `await`. In serverless/edge environments (Vercel, short-lived containers), the process may be suspended or killed in the milliseconds between the primary failure and the DLQ write completing. This silently drops XP events. Fix by `await`-ing the DLQ insert and re-catching any DLQ errors separately, or write the intent to a Redis list synchronously before the primary attempt and remove it on success (reliable write-ahead approach).

---

### 15: BUG-SEASON-01: resetSeasonRankings diverges users.season_xp from user_season_passes.season_xp

**FILES:**
- `apps/web/lib/seasons/seasonEngine.ts` (`resetSeasonRankings`)

**FIX:** The function resets `user_season_passes.season_xp = 0` but does NOT reset `users.season_xp`. After a season reset, the two columns are out of sync: `users.season_xp` retains the previous season's value, so any query or leaderboard reading `users.season_xp` shows stale data for the new season. Add a bulk `UPDATE users SET season_xp = 0 WHERE deleted_at IS NULL` (or scoped to active season participants) inside the same database operation as the season pass reset.

---

### 16: BUG-SEASON-02: Season pass xp_bonus milestone doesn't update users.season_xp

**FILES:**
- `apps/web/lib/seasons/seasonEngine.ts` (`claimPassMilestone`)

**FIX:** When a user claims a `xp_bonus` milestone from their season pass, the code increments `users.xp_total` (all-time XP) but does not increment `users.season_xp` or `user_season_passes.season_xp`. The bonus XP is therefore invisible on the in-season leaderboard and doesn't contribute to the user's seasonal standing. Fix by including `season_xp = season_xp + $bonus` in the `UPDATE users` statement, and likewise `season_xp = season_xp + $bonus` in the `UPDATE user_season_passes` row for the current season.

---

### 17: BUG-SEASON-03: createSeasonCeremonyRoom creates room without a slug

**FILES:**
- `apps/web/lib/seasons/seasonEngine.ts` (`createSeasonCeremonyRoom`)
- `apps/web/lib/db/schema.ts`

**FIX:** The ceremony room INSERT does not include a `slug` value, leaving it NULL. Any attempt to link to or navigate to the ceremony room via `/r/<slug>` will 404. Generate a deterministic slug at creation time — for example, `season-${seasonId.slice(0, 8)}-ceremony` — and include it in the INSERT. If `slug` is made NOT NULL globally (see BUG-SCHEMA-03), this fix becomes mandatory.

---

### 18: BUG-SEASON-04: claimPassMilestone sticker_pack OR lookup is ambiguous

**FILES:**
- `apps/web/lib/seasons/seasonEngine.ts` (`claimPassMilestone`)

**FIX:** The sticker pack lookup uses `WHERE slug = $1 OR name = $1`. If a pack's `name` collides with a different pack's `slug`, the query may return the wrong pack. The intent is "find by slug, fall back to name." Replace with a two-step approach: first query by `slug = $1`, and if not found, query by `name = $1`. Or use `ORDER BY (slug = $1) DESC LIMIT 1` to prefer slug matches. This eliminates the ambiguity and is clearer in intent.

---

### 19: BUG-PAY-01: processChargeSuccess uses `null as unknown as string` type cast

**FILES:**
- `apps/web/lib/payments/paystackWebhookHandler.ts` (`processChargeSuccess`)

**FIX:** `roomId` is assigned `null as unknown as string` to satisfy TypeScript's type checker. This is a type safety escape hatch that hides the fact that `roomId` can be null at runtime. Any downstream code that calls string methods on `roomId` without a null guard will throw at runtime. Fix by correctly typing `roomId` as `string | null | undefined` throughout the function and adding explicit null checks before any string operation or database query using it. Remove the unsafe cast entirely.

---

### 20: BUG-FUND-01: Creator fund normalise() inflates scores when all values equal zero

**FILES:**
- `apps/web/lib/creator/fund.ts` (`normalise`, `calculateFundDistributions`)

**FIX:** The `normalise()` helper detects `min === max` (all values equal) and returns `values.map(() => 1)`. For any metric where every creator scored 0 (e.g., no gifts sent this month), all creators receive a normalized score of 1.0 instead of 0.0, causing the metric to contribute positively to everyone's weighted distribution score. Fix: when `min === max`, return `values.map(() => 0)`. A metric where no one performed should contribute zero to all scores, not 1.

---

### 21: BUG-NEM-01: compareNemesisProgress missing "gaming" track — throws at runtime

**FILES:**
- `apps/web/lib/nemesis/nemesisEngine.ts` (`compareNemesisProgress`)

**FIX:** The `trackColumnMap` inside `compareNemesisProgress` maps XP track names to database column names, but the "gaming" track is absent. Any comparison request for the gaming track throws `Error: unknown XP track 'gaming'`, crashing the API endpoint. Add `gaming: "xp_gaming"` to the map. Cross-reference with `TRACK_COLUMN` in `safeAwardXP.ts` to ensure all eight tracks (main, social, creator, competitor, generosity, knowledge, explorer, gaming) are present in both maps consistently.

---

### 22: BUG-ANN-01: Announcement modal view recorded before client confirms display

**FILES:**
- `apps/web/lib/announcements/engine.ts` (`getActiveModalForUser`, `getActiveBannerForUser`)

**FIX:** Both functions insert a view record into `announcement_views` immediately when the GET API is called, before the client has rendered and displayed the content. If the API succeeds but the client then crashes, navigates away, or hits a network error before the modal appears, the modal is permanently marked as viewed and will never be shown again. Fix by decoupling delivery from confirmation: the GET endpoint returns the modal without recording the view, and a separate POST `/api/announcements/:id/confirm-view` endpoint records the view when the client explicitly dismisses the modal. This is the standard pattern for impression tracking.

---

### 23: BUG-GAME-01: declineChallenge crashes on concurrent row deletion

**FILES:**
- `apps/web/lib/games/challenges.ts` (`declineChallenge`)

**FIX:** After completing its transaction (which marks the challenge as declined), the function re-fetches the challenge row with a non-null assertion: `(await getChallengeRow(challengeId))!.challenger_id`. If a concurrent expiry sweep or admin deletion removes the row between the transaction commit and this re-fetch, the expression throws `Cannot read properties of undefined`. Fix by capturing `challenger_id` from the locked row inside the transaction itself and passing it out as a local variable — no post-transaction re-fetch is needed. This also eliminates a redundant DB round-trip.

---

### 24: BUG-GAME-02: createChallenge builds PostgreSQL interval via string concatenation

**FILES:**
- `apps/web/lib/games/challenges.ts` (`createChallenge`)

**FIX:** Challenge expiry is computed with `NOW() + ($6 || ' hours')::interval`. If the `$6` value contains anything other than a plain integer (e.g., a float, a unit suffix, leading/trailing whitespace from a misconfigured source), PostgreSQL will throw a `invalid input syntax for type interval` error surfaced as a 500. Replace with: `NOW() + ($6 * INTERVAL '1 hour')`, which uses numeric multiplication and avoids string casting entirely. This is both safer and clearer.

---

### 25: BUG-GAME-03: createChallenge accepts unlimited wager size

**FILES:**
- `apps/web/lib/games/challenges.ts` (`createChallenge`)

**FIX:** There is no server-side maximum wager validation in `createChallenge`. A user can submit a challenge with an arbitrarily large coin or star wager. The challenge record is persisted and the challenger's notification is sent before the opponent ever tries to accept. The opponent's `acceptChallenge` will fail if they can't afford the wager, but the dangling challenge record and stale notification have already been created. Add a configurable `MAX_WAGER_COINS` and `MAX_WAGER_STARS` check at the start of `createChallenge`, sourced from the manifest or environment, and return a 400 before inserting if either threshold is exceeded.

---

### 26: BUG-MOD-01: detectBotBehavior only checks room message velocity — DMs not covered

**FILES:**
- `apps/web/lib/moderation/contentFilter.ts` (`detectBotBehavior`)

**FIX:** The bot velocity check counts recent rows only in `room_messages`. A user sending 100 DMs per minute will not trigger any bot detection because the `messages` table (DMs) is never queried. Fix by unioning the velocity check across both tables, or by introducing a single unified per-user message rate counter (e.g., the existing Redis per-user `messageSend` rate limiter can serve as a proxy). At minimum, the function should document explicitly that it does not cover DMs so callers are not misled into thinking it provides complete coverage.

---

### 27: BUG-AUTH-01: 10-second L1 session cache allows brief use of revoked sessions

**FILES:**
- `apps/web/lib/auth/session.ts` (`SESSION_CACHE_TTL_MS = 10_000`)

**FIX:** The in-process session cache holds session records for 10 seconds. When a session is revoked (ban, admin kill, logout from another device), any warm Next.js instance will continue to accept requests from that session for up to 10 seconds. This window is acceptable for most use cases but too long for security-critical revocations. Consider reducing `SESSION_CACHE_TTL_MS` to 2–3 seconds as a first step. For immediate revocation (hard bans, fraud lockout), publish a Redis pub/sub `session:revoked:<sid>` event and have each instance subscribe to invalidate its L1 cache entry immediately. The `withAuth` middleware already bypasses L1 for sensitive mutations — document this exception and ensure all ban/revocation code paths benefit from it.

---

### 28: BUG-AUTH-02: verifyTotp uses non-constant-time string comparison

**FILES:**
- `apps/web/lib/auth/totp.ts` (`verifyTotp`)

**FIX:** TOTP code verification uses `computedCode === userCode` — a standard JavaScript string comparison that short-circuits on the first mismatched character. While the practical exploitability is very low (rate limiting is tight and Redis anti-replay prevents reuse), timing side-channels in authentication primitives are a recognized vulnerability class. Replace with `crypto.timingSafeEqual(Buffer.from(computedCode, 'utf8'), Buffer.from(userCode, 'utf8'))` to guarantee constant-time comparison. This is a one-line change with no functional impact.

---

### 29: BUG-GIFT-01: retireGiftDrop runs two non-transactional UPDATEs

**FILES:**
- `apps/web/lib/events/monthlyGiftDrop.ts` (`retireGiftDrop`)

**FIX:** The function first sets `monthly_gift_drops.is_active = FALSE`, then in a separate statement sets `gift_items.is_retired = TRUE`. These are two independent queries with no surrounding transaction. If the process dies or a transient DB error occurs between the two, the drop is deactivated (gift no longer purchasable via the drop) but the gift item is not retired — it can be re-scheduled into a new drop, violating the "permanently retired after 48 hours" rule. Wrap both UPDATE statements inside `db.transaction(async tx => { ... })`.

---

### 30: BUG-OFFLINE-01: Web PWA getQueueCounts inflates counts with non-pending messages

**FILES:**
- `apps/web/lib/offline/messageQueue.ts` (`getQueueCounts`)

**FIX:** `getQueueCounts` calls `getAllMessages()` which returns all messages regardless of status (pending, sending, sent, failed). The function then counts total results and presents them as "queued messages," including already-sent and permanently-failed items. This inflates the offline queue indicator in the UI, misleading the user about how many messages are actually waiting to be sent. Fix by filtering to `status === 'pending'` only inside `getQueueCounts`, or replace the call with a dedicated `getPendingMessages()` method (which already exists in the Expo SQLite counterpart at `apps/expo/lib/offline/sqlite.ts` and can serve as a reference).

---

## Code Quality Rating & Review

### Current State — 7.4 / 10

**Architecture & Design (9/10):** Genuinely impressive for a team product at this stage. The append-only coin and star ledgers, CTE-based atomic XP awards, Lua sliding-window rate limiter, kid-based JWT rotation, Redis circuit breakers, versioned AES-256-GCM field encryption with scrypt KDF, and XP dead-letter queue all reflect production-grade patterns correctly applied. The layered cache (L1 in-process + L2 Redis + DB), SELECT FOR UPDATE with deterministic lock ordering for deadlock prevention, and Expo SQLite offline queue show solid engineering judgment throughout.

**Security (7.5/10):** Strong foundations: per-request CSP nonce, CSRF Origin header validation, TOTP anti-replay via Redis SET NX with 90-second TTL, constant-time webhook signature verification (Paystack), and scrypt KDF for KYC field encryption. Weaknesses: the 10-second L1 session cache creates a revocation window; TOTP comparison is not timing-safe; DM flooding bypasses bot detection; and the `null as unknown as string` type cast conceals a potential NPE in the payment webhook path.

**Correctness (6.5/10):** Several bugs materially affect core feature correctness: the season XP double-counter divergence produces wrong season leaderboards from day 1 of a new season; the creator fund `normalise()` bug inflates payouts when any metric is uniformly zero; the quest engine double-awards main XP; war reward distribution misfires on small guilds; and the announcement view pre-recording silently skips modals on network errors. These are not obscure edge cases — they affect the core game mechanics on which retention depends.

**Performance (7.5/10):** The L1 memory cache with `memGet`/`memSet`, atomic Lua round-trips, and paginated gift drop notifications (10,000-user batches) are well-applied. The main performance concerns are: the Pusher client multiplication will cause real WebSocket overhead under multi-channel pages; stale device tokens in push notifications waste Expo push quota proportionally as the user base grows and attrits.

**Code Style & Maintainability (8/10):** Generally clean, well-commented, and consistent. Schema-derived type patterns (as seen in the referral commissions module), runtime allowlist guards before SQL interpolation (`SAFE_XP_COLS`), and thorough JSDoc on public APIs are good examples. The main maintainability concerns are the `null as unknown as string` cast (type debt), undocumented ZodError-not-ApiError behaviour in middleware helpers, and missing "gaming" track in the nemesis map (indicating the map is maintained manually and not derived from the canonical `TRACK_COLUMN` source of truth).

---

### Projected State After All Fixes — 8.8 / 10

After applying all 30 fixes:

- **Architecture** stays at 9/10: fixes are additive corrections and localised refactors, not structural changes.
- **Security** rises to ~9/10: revocation latency tightened, TOTP comparison timing-safe, DM flood covered, NPE-in-webhook eliminated.
- **Correctness** rises to ~9.5/10: season XP consistency, quest XP double-award, war reward distribution, fund normalisation, challenge concurrency, and announcement view tracking all corrected.
- **Performance** rises to ~8.5/10: Pusher singleton eliminates transport multiplication; stale push token filtering reduces waste.
- **Maintainability** rises to ~8.5/10: validated helpers, canonical track maps, and removed unsafe casts reduce future maintenance risk.

The codebase is above average for a product at this stage. The bugs found are the kinds that emerge when feature complexity accelerates — not signs of poor engineering. The fixes are mostly contained (single-file or two-file changes) and carry low regression risk. A structured hardening sprint applying these fixes alongside a comprehensive unit test pass for the economy, XP, and season subsystems would bring this to a genuinely strong production baseline.

---

*Report generated: 2026-06-19 06:40 PM*  
*Analyst: Claude Code — forensic independent analysis*
