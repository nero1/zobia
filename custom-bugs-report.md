# Zobia Codebase — Forensic Bug Report

**Generated:** Monday, June 15, 2026 11:31 PM UTC  
**Scope:** Full monorepo — `apps/web` (Next.js), `apps/expo` (React Native/Android), `shared/`  
**Methodology:** Source-level static analysis. All files read directly; no existing bug reports consulted.

---

## Current Code Quality Rating: **6.5 / 10**

The codebase is architecturally ambitious and shows deliberate design in areas like atomic Lua rate limiting, CTE-based XP idempotency, circuit-breaker patterns, AES-256-GCM field encryption, and dead-letter queues. The security posture is above average (CSRF middleware, header stripping, timing-safe comparisons, HMAC webhook verification). However, a cluster of data-integrity issues in the CRON subsystem, residual schema inconsistencies from rapid iteration, and several high-impact logic errors bring the rating down.

**Expected rating after all recommended fixes: 8.5 / 10**

---

## Bug / Issue Index (one-line descriptions)

1. EXPO-AUTH-01: Expo cold-start token refresh blocked by CSRF check — missing Origin header in fetch()
2. DODO-PLAN-01: DodoPayments webhook accepts unvalidated planName from metadata — plan injection risk
3. CRON-PAYOUT-01: Weekly payout INSERT omits required NOT NULL columns (amount_kobo, provider) — always throws
4. CRON-PAYOUT-02: Weekly payout CRON never deducts available_earnings_kobo — double-payout the following week
5. SW-API-01: Service worker precaches server-side API route JS chunks — useless on client, wastes storage
6. SW-ADMIN-01: Service worker precaches admin page JS bundles — admin UI code cached on every PWA user's device
7. XP-STREAK-01: getDailyMessageStreakXP off-by-one — day 7 earns tier-0 XP instead of advancing to tier 1
8. CRON-STREAK-01: Daily CRON updates login_streak_days but never touches login_streak column
9. CRON-STREAK-02: Streak query uses last_login_at::date unindexed cast instead of indexed last_login_date column
10. SCHEMA-STREAK-01: longest_streak not updated when a streak resets — persists stale record forever
11. CRON-COIN-01: Comeback-coin expiry step silently swallows INSUFFICIENT_BALANCE — reversals fail invisibly
12. CRON-IDEMPOTENCY-01: Daily CRON has no run-guard — non-idempotent steps run multiple times on duplicate triggers
13. SCHEMA-DM-01: dm_conversations unique index has no enforced pair-ordering — duplicate conversation rows possible
14. SCHEMA-BANK-01: creator_bank_accounts.creator_id is unique-per-row but CRON queries is_primary — schema contradicts multi-account design
15. SCHEMA-XP-01: x_manifest.value typed as jsonb but manifest loader treats it as plain text — parseBool/parseInt break
16. SCHEMA-SEASON-01: Duplicate season-pass and milestone-claim tables with overlapping purposes
17. ECONOMY-TRANSFER-01: transferCoins() with no idempotencyRef generates Date.now() key — network retry double-transfers
18. CRON-MONTHLY-01: Monthly plan coin-bonus CTE uses ON CONFLICT on a non-existent unique constraint
19. CRON-TIER-01: Creator tier update counter increments unconditionally — reports false update counts
20. CRON-ALLIANCE-01: Alliance war re-insertion uses ON CONFLICT DO NOTHING with no matching unique constraint
21. CRON-ORDER-01: CRON step numbers are out of order (step 10 after 14, 32 after 32b)
22. CRON-GUILD-01: Guild tier promotion and demotion use two separate hardcoded maps — diverge when tiers added
23. REDIS-RL-01: Global rate limit EXPIRE is hardcoded to 60 s regardless of endpoint window
24. SESSION-EVICT-01: Session eviction uses multiple non-atomic Redis calls — race leaves orphaned sorted-set entries
25. SW-STALE-01: StaleWhileRevalidate on /api/users/me and /api/creator/wallet — shared-device users may see each other's data
26. EXPO-AUTH-02: purchaseCoins/purchaseSubscription packageName param unused by global listener — silently ignored
27. CRON-DIGEST-01: Moderation digest counts open/escalated only within new-report WHERE filter — metric is misleading
28. CRON-NEMESIS-01: Nemesis overtake query filters on assignment created_at not overtake date — most users never notified

---

## Detailed Bug Entries

---

### 1. EXPO-AUTH-01 — Expo cold-start token refresh blocked by CSRF check

FILES: apps/expo/lib/auth/context.tsx (lines 122–128)

FIX: The cold-start silent refresh in AuthProvider uses a raw fetch() call instead of the shared apiClient. The apiClient explicitly sets Origin: env.API_BASE_URL in its default headers, satisfying the server-side CSRF check in middleware.ts. The bare fetch() sends no Origin header, so isCsrfSafe() returns false, the POST is rejected 403 CSRF_ORIGIN_MISMATCH, and every user who opens the app with an expired token is force-logged out instead of silently refreshed. Add 'Origin': env.API_BASE_URL to the headers object on that fetch() call, or refactor the cold-start refresh to reuse the refreshAccessToken function already defined in apps/expo/lib/api/client.ts.

---

### 2. DODO-PLAN-01 — DodoPayments webhook accepts unvalidated planName from metadata

FILES: apps/web/app/api/economy/webhooks/dodopayments/route.ts

FIX: The Paystack webhook handler derives the subscription plan safely from the provider's plan.name field using keyword matching (pro/plus/max). The DodoPayments handler reads metadata.planName ?? "pro" verbatim. A tampered or misconfigured payload could set planName to any arbitrary string, granting an unrecognised plan tier to a user. Apply the same keyword-based plan derivation used in the Paystack handler: check the value against known keywords and reject or flag unknown values rather than passing them through unchecked.

---

### 3. CRON-PAYOUT-01 — Weekly payout INSERT missing NOT NULL columns

FILES:
- apps/web/app/api/cron/daily/route.ts (step 32, weekly payout INSERT ~line 2288)
- apps/web/lib/db/schema.ts (creatorPayouts table)

FIX: The creatorPayouts schema declares amount_kobo BIGINT NOT NULL and provider TEXT NOT NULL with no database defaults. The CRON INSERT at step 32 lists columns (creator_id, net_kobo, gross_kobo, platform_fee_kobo, status, idempotency_key, bank_account_snapshot, created_at) and omits both. Every Friday this INSERT throws a NOT NULL constraint violation and the per-creator catch block swallows it silently — zero payouts are ever initiated. Add amount_kobo (use grossKobo value) and provider ('paystack' or read from manifest) to both the column list and the VALUES clause.

---

### 4. CRON-PAYOUT-02 — Weekly payout CRON never deducts available_earnings_kobo

FILES: apps/web/app/api/cron/daily/route.ts (step 32)

FIX: After inserting the creator_payouts row, the CRON does not decrement users.available_earnings_kobo. The eligibility query filters `status IN ('awaiting_approval', 'processing')` to avoid duplicate payouts within the same CRON run, but once the payout completes and that status moves to 'completed', the user's balance is unchanged. The next week's CRON sees the full original balance and initiates a second payout. Inside the transaction that creates the payout row, add UPDATE users SET available_earnings_kobo = available_earnings_kobo - $gross, updated_at = NOW() WHERE id = $creator_id. Restore the balance only if the payout is permanently abandoned in the DLQ.

---

### 5. SW-API-01 — Service worker precaches server-side API route JS chunks

FILES: apps/web/public/sw.js

FIX: The Workbox precache manifest includes all /_next/static/chunks/app/api/** entries. These are Next.js server-component/route-handler JS bundles that execute only on the server and are never run by the browser. Precaching them wastes client storage (can be multiple MB) and bandwidth. Update the Workbox build config (next.config.js or a dedicated workbox-config.js) to exclude app/api/** from the precache glob patterns, e.g. add '!/_next/static/chunks/app/api/**' to the exclusions.

---

### 6. SW-ADMIN-01 — Service worker precaches admin page JS bundles

FILES: apps/web/public/sw.js

FIX: Admin page chunks (/_next/static/chunks/app/admin/**) appear in the precache manifest and are downloaded and stored on the device of every PWA user, regardless of their admin status. This leaks admin UI code (endpoint names, field names, UI flows) to all users' devices. Exclude app/admin/** from the Workbox precache glob patterns. Admin pages should never be cached offline since they always require live server access.

---

### 7. XP-STREAK-01 — getDailyMessageStreakXP off-by-one in tier calculation

FILES: apps/web/lib/xp/engine.ts (getDailyMessageStreakXP function)

FIX: The formula tier = Math.floor((day - 1) / 7) computes tier 0 for days 1–7 and tier 1 for days 8–14. The milestone advertised to users is every 7 days, so day 7 should be the first day of tier 1. The formula should be Math.floor(day / 7) so days 1–6 are tier 0 and day 7 is tier 1. Confirm the exact breakpoints against the PRD and adjust accordingly. As written, every tier milestone is one day late.

---

### 8. CRON-STREAK-01 — CRON updates login_streak_days but leaves login_streak stale

FILES:
- apps/web/app/api/cron/daily/route.ts (step 2 — streak increment UPDATE)
- apps/web/lib/db/schema.ts (users table, both columns)

FIX: The streak-increment UPDATE sets login_streak_days = login_streak_days + 1 but never touches login_streak. Any code path that reads users.login_streak for display, XP multiplier lookups, or badge awards will see a perpetually stale value (whatever was last written by an older code path). Either consolidate on one column (migrate all references to login_streak_days and drop login_streak), or update both columns in the same UPDATE statement.

---

### 9. CRON-STREAK-02 — Streak query casts timestamp to date, bypassing index

FILES: apps/web/app/api/cron/daily/route.ts (step 2 — eligibility WHERE clause)

FIX: The streak eligibility filter is WHERE last_login_at::date = CURRENT_DATE - 1. Casting last_login_at to date prevents PostgreSQL from using any index on that column, resulting in a sequential scan of the users table. The schema has a dedicated last_login_date DATE column intended for exactly this. Replacing the condition with WHERE last_login_date = CURRENT_DATE - 1 allows use of a B-tree index and will scale orders of magnitude better as user count grows.

---

### 10. SCHEMA-STREAK-01 — longest_streak not updated before streak reset

FILES: apps/web/app/api/cron/daily/route.ts (step 2 — streak-reset branch)

FIX: The streak-reset UPDATE zeroes login_streak_days without first checking whether the current streak exceeds longest_streak. A user who breaks their personal record then misses a day will never see their new record reflected. Before the reset, add: UPDATE users SET longest_streak = GREATEST(COALESCE(longest_streak, 0), login_streak_days) WHERE id = ANY($missed_users), or fold it into the reset UPDATE as: SET login_streak_days = 0, longest_streak = GREATEST(COALESCE(longest_streak, 0), login_streak_days).

---

### 11. CRON-COIN-01 — Comeback-coin expiry swallows INSUFFICIENT_BALANCE silently

FILES: apps/web/app/api/cron/daily/route.ts (step 22 — comeback coin expiry)

FIX: When a user received comeback coins and subsequently spent them before expiry, debitCoins() throws INSUFFICIENT_BALANCE. The catch block swallows every error identically — the user keeps coins they shouldn't and no alert is emitted. In the catch block, check if error.code === 'INSUFFICIENT_BALANCE': if so, log it as expected and mark the expiry as processed (so the CRON doesn't retry it tomorrow). For all other errors, insert a system_alerts row so the ops team can investigate actual DB failures.

---

### 12. CRON-IDEMPOTENCY-01 — Daily CRON has no run-guard against duplicate invocations

FILES:
- apps/web/app/api/cron/daily/route.ts
- apps/web/lib/db/schema.ts (cronState table defined but unused by daily handler)

FIX: The schema exports a cronState table but the daily CRON handler never writes to it. If the external CRON service fires twice the same day (misconfiguration, retry), non-idempotent steps execute twice: guild tier promotions/demotions, annual event cloning, Master Teacher awards, weekly Alliance War pairings, moderation digest emails, etc. At the very start of the handler, attempt an atomic INSERT INTO cron_state (key, last_run_at) VALUES ('daily', NOW()) ON CONFLICT (key) DO UPDATE SET last_run_at = NOW() WHERE last_run_at < NOW()::date RETURNING key. If no rows returned, another run already completed today — return 200 immediately.

---

### 13. SCHEMA-DM-01 — dm_conversations lacks enforced canonical pair ordering

FILES: apps/web/lib/db/schema.ts (dmConversations table and unique index)

FIX: The unique index is on (user_id_1, user_id_2) but there is no CHECK constraint enforcing user_id_1 < user_id_2. If any code path inserts a DM conversation without sorting the pair, two rows are created for the same pair of users and messages are silently split between them. Add a CHECK constraint: CHECK (user_id_1 < user_id_2). Audit all INSERT paths to ensure they sort the pair as [min(a, b), max(a, b)] before inserting.

---

### 14. SCHEMA-BANK-01 — creator_bank_accounts unique-per-creator contradicts multi-account query pattern

FILES:
- apps/web/lib/db/schema.ts (creatorBankAccounts — .unique() on creatorId)
- apps/web/app/api/cron/daily/route.ts (step 32 — WHERE is_primary = TRUE AND deleted_at IS NULL)
- apps/web/lib/payments/payouts.ts

FIX: The Drizzle schema adds a unique constraint on creator_id, so a creator can only ever have one bank account row in the database. However, payout and CRON logic queries for is_primary = TRUE AND deleted_at IS NULL, which implies the system was designed to support multiple accounts per creator with one marked as primary and soft-deletable. These two contracts are mutually exclusive. Decide on the correct model: if multiple accounts are needed, drop the unique constraint and add a partial unique index on (creator_id) WHERE is_primary = TRUE AND deleted_at IS NULL; if only one account is needed, remove is_primary and deleted_at.

---

### 15. SCHEMA-XP-01 — x_manifest.value typed as jsonb but used as plain text strings

FILES:
- apps/web/lib/db/schema.ts (xManifest table — value: jsonb("value"))
- apps/web/lib/manifest/index.ts (parseBool, parseInt10 helpers)

FIX: The manifest loader does SELECT key, value FROM x_manifest and passes each value to parseBool() (checks === "true") and parseInt10() (calls parseInt(v, 10)). PostgreSQL returns jsonb string values with surrounding quotes (e.g. the jsonb string true is returned as the JSON literal true without quotes, but the jsonb string "hello" is returned as "hello" with quotes). This causes parseBool("true") to match correctly for jsonb boolean literals but break for jsonb string values like "true". Change the column type to text (more appropriate since all manifest values are scalar strings), align the migration, and update any existing jsonb-typed rows.

---

### 16. SCHEMA-SEASON-01 — Duplicate season-pass and milestone-claim table pairs

FILES: apps/web/lib/db/schema.ts (seasonPasses, userSeasonPasses, userSeasonPassClaims, userSeasonMilestoneClaims)

FIX: The schema defines two tables that appear to serve overlapping purposes: season_passes (template-like) and user_season_passes (ownership-like), plus user_season_pass_claims and user_season_milestone_claims. seasonEngine.ts resets user_season_passes; other code appears to use user_season_pass_claims. This creates ambiguity about the authoritative table for each concept, making it easy to write a query against the wrong one. Conduct an audit of every read and write to all four tables, identify the canonical table for each concept, migrate data from the redundant tables, and remove the unused ones with a clear migration comment.

---

### 17. ECONOMY-TRANSFER-01 — transferCoins() default idempotency key is not retry-safe

FILES: apps/web/lib/economy/coins.ts (transferCoins function)

FIX: When called without an idempotencyRef, the function generates transfer:${from}:${to}:${amount}:${Date.now()}. A network timeout followed by a client retry generates a different Date.now() value, bypasses the duplicate-detection partial index on coin_ledger, and executes a second transfer. All callers in API route handlers must supply a stable, request-scoped idempotency key (e.g. derived from the gift ID, payment reference, or a UUID generated at request entry and stored in the request body). Consider making idempotencyRef a required parameter at the TypeScript level to prevent accidental omission.

---

### 18. CRON-MONTHLY-01 — Monthly plan bonus CTE references a non-existent unique constraint

FILES: apps/web/app/api/cron/daily/route.ts (monthly plan coin-bonus step)

FIX: The monthly plan coin-bonus INSERT uses ON CONFLICT (transaction_type, reference_id) WHERE reference_id IS NOT NULL DO NOTHING. The coin_ledger table has no unique index on (transaction_type, reference_id) — that clause is from a different table. PostgreSQL will throw "there is no unique or exclusion constraint matching the ON CONFLICT specification" and the monthly bonus fails for all users every month. Either add the missing partial unique index on coin_ledger (transaction_type, reference_id) WHERE reference_id IS NOT NULL, or change the ON CONFLICT clause to match an existing unique index such as a (user_id, source, reference_id) partial index.

---

### 19. CRON-TIER-01 — Creator tier update counter over-counts unchanged tiers

FILES: apps/web/app/api/cron/daily/route.ts (step 28 — creator tier progression)

FIX: tierUpdates++ is called unconditionally for every creator in the loop, even when the UPDATE's WHERE COALESCE(creator_tier, 'rookie') != $1 condition matches zero rows (i.e. the tier is unchanged). The reported metric results.creatorTierUpdates.updated equals the total number of creators with active rooms rather than the actual number of tier changes, rendering it useless for monitoring. Add RETURNING id to the UPDATE and increment tierUpdates only when rows.length > 0, or use the rowcount from pg's commandResult.

---

### 20. CRON-ALLIANCE-01 — Alliance war re-insertion ON CONFLICT DO NOTHING has no matching constraint

FILES: apps/web/app/api/cron/daily/route.ts (step 32b — Alliance War weekly re-pairing)

FIX: After resolving a war, the CRON inserts next week's war with INSERT INTO alliance_wars ... ON CONFLICT DO NOTHING. The alliance_wars table has no unique constraint on (alliance_1_id, alliance_2_id) or any column subset that would match, so PostgreSQL's ON CONFLICT DO NOTHING only catches PK conflicts (duplicate UUID). A concurrent or duplicate CRON run inserts multiple active war rows for the same pair. Add a partial unique index on (alliance_1_id, alliance_2_id) WHERE status = 'active' and use ON CONFLICT ON CONSTRAINT <constraint_name> DO NOTHING.

---

### 21. CRON-ORDER-01 — CRON step numbers are discontiguous and out of order

FILES: apps/web/app/api/cron/daily/route.ts

FIX: Step comments are not sequential with execution: step 10 (Platform Council invitation) appears in the code after step 14 (leaderboard ripple), and step 32b (Alliance Wars) appears before the labelled step 32 (automated payouts). This is a pure maintainability issue but causes confusion when referencing steps in bug reports, logs, or code reviews. Renumber all steps sequentially in the order they execute, and consider extracting each step into a named async function so the main handler reads as an ordered list of step calls.

---

### 22. CRON-GUILD-01 — Guild tier promotion and demotion use separate hardcoded maps

FILES: apps/web/app/api/cron/daily/route.ts (guild tier promotion step and demotion step)

FIX: Two separate objects/maps define guild tier boundaries for promotions and demotions independently. Adding, removing, or renaming a tier requires editing both, and there is no compile-time guarantee they stay in sync. Consolidate into a single ordered array of tier definitions — e.g. const GUILD_TIERS = [{ name: 'bronze', minXP: 0 }, ...] — and derive both promotion and demotion targets programmatically from the same structure.

---

### 23. REDIS-RL-01 — Global rate limit EXPIRE hardcoded to 60 seconds

FILES: apps/web/lib/security/rateLimit.ts (enforceRateLimit, GLOBAL_RATE_LUA script)

FIX: The global endpoint cap Lua script calls redis.call('EXPIRE', KEYS[1], ARGV[1]) where ARGV[1] is always the string "60" (60 seconds). Endpoints with globalLimit that use windowMs longer than 60 000 ms — specifically coinPurchase (1-hour window) and payoutRequest (24-hour window) — will have their global counter reset every 60 seconds rather than over the intended window, making the global cap almost entirely ineffective. Pass Math.round(options.windowMs / 1000).toString() as the TTL argument instead of the hardcoded "60".

---

### 24. SESSION-EVICT-01 — Session eviction uses non-atomic Redis calls

FILES: apps/web/lib/auth/session.ts (createSession function — eviction block)

FIX: When the MAX_SESSIONS limit is reached, the code calls redis.del(...evictedKeys) and then separately redis.zremrangebyrank(...) as two independent commands. If the process crashes between them (or Redis connection drops), the sorted set retains entries pointing to deleted session hashes — or vice versa — causing phantom sessions that never expire and waste memory. Wrap both operations in a redis.multi() / .exec() pipeline (or a Lua script) so they execute atomically in a single round-trip.

---

### 25. SW-STALE-01 — StaleWhileRevalidate on authenticated profile/wallet endpoints

FILES: apps/web/public/sw.js (StaleWhileRevalidate handler for /api/users/me, /api/creator/wallet)

FIX: The service worker caches /api/users/me and /api/creator/wallet responses for 60 seconds with StaleWhileRevalidate. On a shared device, if user A logs out and user B logs in within 60 seconds, user B briefly sees user A's cached profile and wallet balance. Switch these routes to NetworkOnly, or key the cache entry by session: add a cache key that includes the Authorization header value or a session ID query param so cached responses are never served across session boundaries.

---

### 26. EXPO-AUTH-02 — purchaseCoins/purchaseSubscription packageName param silently ignored

FILES: apps/expo/lib/payments/googlePlay.ts (setupGlobalPurchaseListener, purchaseCoins, purchaseSubscription)

FIX: Both purchaseCoins(productId, packageName) and purchaseSubscription(productId, packageName) accept a packageName parameter. However the global purchase listener calls verifyPurchaseServerSide(..., 'com.zobia.app', ...) with a hardcoded literal, making the caller-supplied packageName unreachable. If the package name changes (white-label build, staging environment), all server-side verifications will use the wrong package name. Either remove the parameter and declare a module-level constant, or store the packageName in a module-level variable set by purchaseCoins/purchaseSubscription and read by the listener.

---

### 27. CRON-DIGEST-01 — Moderation digest open/escalated counts only cover new reports

FILES: apps/web/app/api/cron/daily/route.ts (step 29 — moderation digest)

FIX: The digest query adds WHERE created_at >= NOW() - INTERVAL '7 days' to the reports table and then counts rows WHERE status = 'open' OR status = 'escalated'. This silently excludes older unresolved reports — a report opened three weeks ago and still unresolved would be invisible in the digest. For a meaningful weekly digest, the open and escalated counts should query the full reports table without the created_at filter: COUNT(*) FILTER (WHERE status = 'open') across all unresolved reports, with the filter applied only to the new-reports-this-week metric.

---

### 28. CRON-NEMESIS-01 — Nemesis overtake notification filters on assignment date, not overtake date

FILES: apps/web/app/api/cron/daily/route.ts (step 31 — nemesis notifications)

FIX: The query finds nemesis pairs where nemesis_xp > user_xp AND na.created_at >= NOW() - INTERVAL '24 hours'. The created_at filter is on when the nemesis assignment row was created, not on when the XP overtake actually occurred. Since nemesis assignments persist across weeks, most pairs have created_at well before 24 hours ago and will never satisfy the filter — they never receive notifications. The intended logic is: notify about overtakes that occurred since the last Sunday nemesis refresh. Replace the filter with a nemesis_assignments.last_notified_at IS NULL OR last_notified_at < NOW() - INTERVAL '6 days' condition (add a last_notified_at column to nemesis_assignments), and set it to NOW() after sending notifications for that pair.

---

*Report generated: Monday, June 15, 2026 11:31 PM UTC*
