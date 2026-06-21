# Zobia Codebase — Forensic Bug Report

**Generated:** 2026-06-21 at 09:05 AM  
**Analyst:** Independent forensic review — no existing bug reports consulted  
**Scope:** Web app (Next.js), PWA, Expo Android app — full monorepo

---

## Summary List (all bugs, one line each)

1. **BUG-QE-01** — `resetDailyQuests()` queries the wrong table name and wrong column names, silently failing and causing unbounded `user_quest_progress` table growth.
2. **BUG-WH-01** — Paystack `room_subscription` webhook branch silently accepts payment and does nothing if any required metadata field is missing, losing revenue and never granting room access.
3. **BUG-WE-01** — PostgreSQL `bigint` guild XP column returned as a JS string by the pg driver; `Math.floor(string * 0.85)` evaluates to `NaN`, breaking guild war matchmaking tolerance.
4. **BUG-PU-01** — `push.ts` queries a `device_id` column that does not exist in the `userPushTokens` schema table, breaking push token device deduplication at runtime.
5. **BUG-LB-01** — `upsertLeaderboardSnapshot()` is only ever called with the default `scope='global'`; city-scoped leaderboard snapshots are never created, leaving all city leaderboards permanently empty.
6. **BUG-SS-01** — `isPrivateIp()` in `ssrf.ts` checks only `fe80:` for IPv6 link-local, but the full link-local range (`fe80::/10`) extends through `febf:`, leaving `fe90:` through `febf:` unblocked.
7. **BUG-CS-01** — Raw `fetch()` calls in Expo that bypass the `apiClient` axios instance do not include the `Origin` header, causing CSRF 403 errors on mutations.
8. **BUG-WH-02** — `processTransferEvent()` in the Paystack webhook handler uses a dynamic `import()` for the payouts module inside a hot code path, adding latency and cold-start risk.
9. **BUG-GS-01** — `finalizeScore()` fetches `previousBest` outside the write transaction, so two concurrent score submissions can both detect `isNewBest=true` and both receive win rewards.
10. **BUG-SK-01** — Sticker unlock threshold row is committed before checking if the sticker pack exists; if the pack is missing from the DB, the threshold is permanently consumed but the sticker pack is never granted.
11. **BUG-DM-01** — `getDMCost()` returns `0` for Free/Plus users initiating DMs, creating an ambiguity that allows a cost-check-only call site to grant DM initiation for free.
12. **BUG-SC-01** — The `sessions` table exists in the schema and migrations but is never read or written by any application code (all sessions live in Redis).
13. **BUG-SC-02** — The `userQuests` table is explicitly marked deprecated in the schema but is still present, adding dead schema weight.
14. **BUG-SC-03** — Multiple `xp_ledger` audit columns (`action`, `xp_amount`, `xp_net`, `multiplier`, `description`, `ceremony_room_id`, `metadata`) are never populated by `safeAwardXP()`, and `base_amount` is always identical to `amount`.
15. **BUG-RL-01** — The L1 in-process rate limit cache at 40% of the Redis limit means N serverless instances can collectively allow N × 40% × limit requests before Redis enforcement fires.

---

## Detailed Bug Reports

---

### 1. BUG-QE-01: resetDailyQuests() wrong table and column names

**Severity:** Critical — Data Loss / Unbounded Table Growth

**FILES:**
- `apps/web/lib/quests/questEngine.ts`

**FIX:**
The `resetDailyQuests()` function performs a DELETE to purge expired quest rows but references `quest_progress` (which does not exist) instead of `user_quest_progress`, and uses `status = 'expired'` and `date < ...` instead of the correct `expired_at IS NOT NULL` and `quest_date < ...` columns. The entire DELETE silently fails every time because the table name is wrong — the catch block swallows the error. As a result, the `user_quest_progress` table grows without bound, accumulating expired rows permanently.

Fix: Correct the table name to `user_quest_progress` and correct the column predicates to `expired_at IS NOT NULL AND quest_date < $1` (using whatever the retention cutoff date is). Also remove or narrow the `.catch()` so the error is at minimum logged.

---

### 2. BUG-WH-01: Paystack room_subscription webhook silent payment acceptance with no action

**Severity:** Critical — Revenue Loss / Feature Broken

**FILES:**
- `apps/web/lib/payments/paystackWebhookHandler.ts`

**FIX:**
The `room_subscription` branch of the webhook handler extracts `metadata` from the Paystack event and casts it directly as `unknown as { roomId: string; grossKobo: number; subscriptionDays: number }`. There is no runtime validation that these fields actually exist on the metadata object. If any field is absent or under a different key, the code proceeds with `undefined` values — calls to credit the creator's earnings and grant room access silently become no-ops or produce garbage values, while the webhook returns 200 OK (causing Paystack to consider the event delivered successfully).

Fix: Add a runtime guard that validates the presence and types of `roomId`, `grossKobo`, and `subscriptionDays` from `metadata` before proceeding. If validation fails, log the raw metadata and return a 400 or throw to the error handler (do NOT return 200) so Paystack retries. Consider using a narrow Zod schema or explicit `typeof` checks.

---

### 3. BUG-WE-01: Guild war matchmaking NaN from bigint string multiplication

**Severity:** High — Feature Broken

**FILES:**
- `apps/web/lib/guilds/warEngine.ts`

**FIX:**
The Node.js `pg` driver returns PostgreSQL `bigint` columns as JavaScript strings to avoid IEEE 754 precision loss. In `findWarOpponent()` (or wherever the guild XP tolerance band is computed), the code does `Math.floor(self.guild_xp * 0.85)` where `self.guild_xp` is the string value from the DB. JavaScript coerces `string * number` → `NaN`, so `lowerBound` and `upperBound` are both `NaN`. The WHERE clause `guild_xp BETWEEN $lowerBound AND $upperBound` will never match any rows, making the war matchmaking system unable to find any opponent.

Fix: Parse the value before arithmetic: `const guildXp = Number(self.guild_xp)` (safe here because guild XP won't exceed Number.MAX_SAFE_INTEGER in practice), then compute `Math.floor(guildXp * 0.85)`. Apply the same Number() coercion to any other bigint columns read from this query.

---

### 4. BUG-PU-01: push.ts queries non-existent device_id column

**Severity:** High — Feature Broken / Runtime Error

**FILES:**
- `apps/web/lib/notifications/push.ts`
- `apps/web/lib/db/schema.ts`

**FIX:**
The `PushTokenRow` interface in `push.ts` declares `device_id: string | null` and the SQL query selects it. However, the `userPushTokens` table definition in `schema.ts` only has `id`, `userId`, `token`, `createdAt`, `updatedAt`, and `lastSeenAt` — there is no `device_id` column. At runtime this causes a PostgreSQL column-not-found error (if the column is named in a SELECT list) or silently returns null for all rows (if the ORM does a `SELECT *` and maps missing columns). Either way, any logic that uses `device_id` to deduplicate push tokens per device is broken.

Fix: Either add a `device_id` column to the `userPushTokens` schema (with a migration) and wire the Expo push token registration flow to supply it, OR remove `device_id` from the interface and query and implement a different deduplication strategy (e.g. one token per user, or dedup by token value).

---

### 5. BUG-LB-01: City-scoped leaderboard snapshots never created

**Severity:** High — Feature Broken (silent / permanent)

**FILES:**
- `apps/web/lib/leaderboards/engine.ts`
- `apps/web/lib/xp/safeAwardXP.ts`

**FIX:**
`upsertLeaderboardSnapshot()` accepts optional `scope` and `city` parameters and defaults `scope` to `"global"` and `city` to `null`. Every call site in `safeAwardXP.ts` invokes it as `upsertLeaderboardSnapshot(userId, track, xp, client)` with no additional arguments. Consequently, only `scope='global'` rows are ever written to `leaderboard_snapshots`. The city leaderboard query pages (`scope='city'`, `ls.city = $cityName`) match zero rows for every user.

Fix: In `safeAwardXP`, after a successful XP award, fetch the user's `city` value (it can be included in the RETURNING clause of the UPDATE users query, or loaded via a separate fast point-read) and pass it to an additional `upsertLeaderboardSnapshot(userId, track, xp, client, { scope: 'city', city: user.city })` call when the user has a non-null city. The global snapshot call stays as-is.

---

### 6. BUG-SS-01: Incomplete IPv6 link-local range check in SSRF guard

**Severity:** Medium — Security

**FILES:**
- `apps/web/lib/security/ssrf.ts`

**FIX:**
`isPrivateIp()` guards against IPv6 link-local via `hostname.startsWith("fe80:")`. The IANA link-local prefix is `fe80::/10`, which spans `fe80::` through `febf::ffff:…`. Addresses in the `fe90:`, `fea0:`, `feb0:` sub-ranges also fall within link-local but are not caught by the `startsWith("fe80:")` check. An attacker could potentially supply `fe90::1` and bypass the SSRF filter.

Fix: Replace `hostname.startsWith("fe80:")` with a check that covers the full `/10` range: parse the first 16-bit group as a hex integer and verify it falls between `0xfe80` and `0xfebf` inclusive. For example: `const firstGroup = parseInt(hostname.split(':')[0], 16); if (firstGroup >= 0xfe80 && firstGroup <= 0xfebf) return true;`. The existing `fc`/`fd` ULA check is correct and needs no change.

---

### 7. BUG-CS-01: Raw fetch() calls in Expo bypass CSRF Origin header requirement

**Severity:** Medium — Security / Reliability

**FILES:**
- `apps/web/middleware.ts`
- `apps/expo/lib/api/client.ts`

**FIX:**
The server-side CSRF check in `middleware.ts` requires a matching `Origin` header on all mutation requests (POST/PUT/PATCH/DELETE). The Expo `apiClient` (axios instance) correctly sets `Origin: env.API_BASE_URL` as a default header, covering requests made through it. However, any code in the Expo app that uses native `fetch()` directly — such as deeplink callback handlers, third-party SDK callbacks, Expo push token registration calls, or ad network integrations — will lack this header and receive 403 CSRF rejections.

Fix: Audit all `fetch()` calls in `apps/expo/` that target the app's own API and replace them with `apiClient` calls, OR wrap the native `fetch` with a thin interceptor that injects the `Origin` header when the host matches the API base URL. Document the requirement in a comment near the CSRF check so future contributors know.

---

### 8. BUG-WH-02: Dynamic import() in hot Paystack webhook handler path

**Severity:** Medium — Performance / Reliability

**FILES:**
- `apps/web/lib/payments/paystackWebhookHandler.ts`

**FIX:**
`processTransferEvent()` calls `await import("@/lib/payments/payouts")` at the point of use inside the handler. Dynamic imports carry a non-trivial overhead on first invocation per cold serverless instance — they trigger module evaluation that should have happened at boot time. In a webhook handler that must complete quickly (to avoid Paystack marking delivery as failed and retrying), this adds latency and introduces a risk of timing out before the module is loaded.

Fix: Convert to a static top-level import: `import { reconcileStuckPayouts, ... } from "@/lib/payments/payouts"`. If the only concern was circular dependency, that should be resolved structurally rather than via dynamic import.

---

### 9. BUG-GS-01: Race condition in personal-best detection lets two concurrent plays both win

**Severity:** Medium — Economy / Race Condition

**FILES:**
- `apps/web/lib/games/sessions.ts`

**FIX:**
`finalizeScore()` loads `previousBest` from `game_best_scores` BEFORE opening the write transaction. The CAS guard inside the transaction (`WHERE counted = FALSE`) only prevents the same `playId` from being counted twice. It does NOT prevent two distinct concurrent plays (player submits two tabs/devices simultaneously) from both reading the same stale `previousBest`, both evaluating `isNewBest = newScore > previousBest → true`, and both triggering the new-personal-best reward path.

Fix: Move the `game_best_scores` lookup inside the transaction (or fold it into the UPDATE statement using a CTE) so the check is atomic with the `counted=TRUE` mark. Alternatively, use an advisory lock keyed on `(userId, gameId)` for the duration of the finalization.

---

### 10. BUG-SK-01: Sticker pack unlock threshold permanently consumed when pack missing from DB

**Severity:** Medium — Feature Broken / Data Integrity

**FILES:**
- `apps/web/lib/messaging/conversationScore.ts`

**FIX:**
When a conversation score crosses a sticker unlock threshold (100 or 250), the code first inserts a row into `dm_score_sticker_unlocks` (ON CONFLICT DO NOTHING) to record the unlock, then queries `SELECT id FROM sticker_packs WHERE name = $1`. If the sticker pack name is not present in the `sticker_packs` table (e.g. the seed migration hasn't run, or the pack was renamed), the SELECT returns no rows, the grant is skipped, and the function returns. The `dm_score_sticker_unlocks` row is already committed, so the threshold is permanently consumed. The user will never receive the sticker pack, even after the pack is later seeded.

Fix: Reverse the order: query the sticker pack ID first. If the pack is not found, log an error alert and do NOT insert the `dm_score_sticker_unlocks` row (so the threshold can be re-triggered once the data is corrected). Alternatively, assert pack existence at startup and treat missing packs as a fatal misconfiguration.

---

### 11. BUG-DM-01: getDMCost() returns 0 for Free/Plus DM initiation masking missing guard

**Severity:** Medium — Business Logic

**FILES:**
- `apps/web/lib/messaging/coinCost.ts`

**FIX:**
`getDMCost(plan, isInitiating)` returns `0` for `plan='free'` or `plan='plus'` when `isInitiating=true`. The intent appears to be "Free/Plus users cannot initiate DMs at all" (so the cost is N/A), but returning `0` is semantically indistinguishable from "initiation is free." Any call site that only charges `getDMCost()` without also calling `canInitiateDM()` will silently grant DM initiation for 0 coins to Free/Plus users.

Fix: Clarify the function contract — either return `null` (or `undefined`) to signal "not applicable / not allowed", and update all call sites to handle the null case, OR throw an error if `isInitiating=true` for a plan that cannot initiate. Document the restriction explicitly in a JSDoc comment. This ensures no call site can accidentally bypass the plan gate.

---

### 12. BUG-SC-01: Unused `sessions` table in schema

**Severity:** Low — Schema Maintenance / Confusion

**FILES:**
- `apps/web/lib/db/schema.ts`

**FIX:**
The `sessions` table is defined in the Drizzle schema and included in migrations, but all application sessions are stored exclusively in Redis (see `apps/web/lib/auth/session.ts`). No application code reads from or writes to this table. It creates confusion for developers reviewing the schema ("why is there a sessions table if we use Redis?") and wastes DB storage if rows ever ended up there.

Fix: Drop the `sessions` table in a new migration and remove its Drizzle schema definition. Document in a comment near `session.ts` that sessions are Redis-only.

---

### 13. BUG-SC-02: Deprecated `userQuests` table still in schema

**Severity:** Low — Schema Maintenance

**FILES:**
- `apps/web/lib/db/schema.ts`

**FIX:**
The schema file explicitly marks `userQuests` as "DEPRECATED — superseded by `user_quest_progress`. No current code path reads or writes this table." Despite this, the table definition remains in the schema and will be included in any future migration diffs.

Fix: Drop the table in a migration and remove the Drizzle schema definition. If historical data needs to be preserved, archive it first.

---

### 14. BUG-SC-03: xp_ledger audit columns never populated by safeAwardXP

**Severity:** Low — Schema/Auditability

**FILES:**
- `apps/web/lib/db/schema.ts`
- `apps/web/lib/xp/safeAwardXP.ts`

**FIX:**
The `xp_ledger` table has schema columns `action`, `xp_amount`, `xp_net`, `multiplier`, `description`, `ceremony_room_id`, and `metadata` that are never populated by `safeAwardXP()`. The INSERT in `safeAwardXP` only sets `user_id, amount, track, source, reference_id, base_amount, created_at`, leaving all audit-trail fields null. Additionally, `base_amount` is always set to the same value as `amount` (the raw XP before any multiplier), suggesting the multiplier audit trail was never wired up.

Fix: Either pass the additional context (multiplier, base amount, action type) into `safeAwardXP` from the XP engine and write them to the ledger row, OR formally deprecate and drop the unused columns to keep the schema honest. If XP multipliers from the engine are being applied upstream, the multiplier and base_amount values should flow through to the ledger INSERT for accurate audit.

---

### 15. BUG-RL-01: Multi-instance L1 rate limit cache allows overage at scale

**Severity:** Low — Scalability / Defense in Depth

**FILES:**
- `apps/web/lib/security/rateLimit.ts`

**FIX:**
The L1 in-process rate limiter fires at 40% of the Redis limit per serverless instance. This is intentional (reduced from 70% to mitigate the issue) and documented in the code. However, with N concurrent serverless instances, each instance independently allows up to 40% × limit requests before going to Redis, so burst traffic can be as high as N × 40% × limit before Redis enforcement cuts in. This is a defense-in-depth weakness rather than a complete bypass (Redis still catches sustained abuse), but it means the L1 threshold provides weaker isolation than intended at scale.

Fix: Consider reducing the L1 multiplier further (e.g. to 20-25%), or for the most sensitive endpoints (auth, payment), set `bypassL1: true` to always go straight to Redis (this is already done for some endpoints — verify coverage). Document which endpoints bypass L1 so future additions follow the same pattern.

---

## Code Quality Assessment

### Current Rating: 7.5 / 10

**Strengths:**
- Security posture is genuinely strong: SSRF DNS-pinning with TOCTOU fix, AES-256-GCM field encryption with key rotation, CSP nonce per request, constant-time HMAC comparison for webhooks, IPv4-mapped IPv6 unwrap — these show serious security thinking.
- Economy correctness is solid: `SELECT FOR UPDATE` with ascending UUID lock ordering prevents deadlocks; Decimal.js for coin arithmetic; idempotency keys throughout; CTE pattern in `safeAwardXP` prevents double-award.
- DLQ pattern for XP and payout failures is a mature engineering choice; the DLQ-only-on-non-tx-client rule is correctly implemented.
- XP engine uses named constants, integer basis-point arithmetic, and per-track columns — clear and auditable.
- The Expo offline queue (SQLite) with crash recovery (`resetSendingMessages`) and the PWA offline queue (IndexedDB) are both well-implemented.
- Auth session management is robust: distributed lock on refresh, 30s grace window, MAX_SESSIONS eviction.
- Circuit breaker on Paystack API calls is a good reliability pattern.

**Weaknesses (beyond specific bugs above):**
- Schema drift: deprecated tables and unpopulated columns left in place reduce developer trust in the schema as source of truth.
- The webhook metadata validation gap (BUG-WH-01) is a process issue as much as a code issue — incoming external data should always be validated at the boundary.
- City leaderboard gap (BUG-LB-01) is an architectural oversight: the snapshot upsert function was extended to support city scope but no call site was updated.
- Some defensive patterns are inconsistently applied (L1 bypass on auth endpoints but not uniformly).

---

### Projected Rating After All Fixes: 9 / 10

Resolving the critical bugs (QE-01, WH-01) eliminates real revenue loss and data corruption risk. Fixing the high bugs (WE-01, PU-01, LB-01) restores three broken features (guild wars, push deduplication, city leaderboards). The medium and low bugs mostly tighten security, economy integrity, and schema hygiene. The resulting codebase would be well above industry average for a consumer social app of this complexity.

---

*Report generated: 2026-06-21 at 09:05 AM*  
*Analysis performed on the full monorepo at `/home/user/zobia` — web, PWA, and Expo Android app*
