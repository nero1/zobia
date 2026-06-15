# Zobia Codebase Bug Report
**Date:** 2026-06-15 | **Time:** 12:00 PM
**Scope:** Full forensic analysis — web app, PWA, Expo mobile Android, shared libs, DB schema, CRON routes
**Analyst:** Claude (claude-sonnet-4-6) — independent self-conducted analysis, no sub-agents
**Status:** ✅ All 20 bugs fixed and pushed to `claude/custom-bugs-gaps-fixes-lm2j1z`

---

## Current Code Rating: 6.5 / 10
### Projected Rating After All Fixes: 8.5 / 10

**Review Summary:**
The codebase demonstrates sophisticated architectural thinking — Redis-backed circuit breakers for payments, DNS-pinned SSRF protection, CTE-gated idempotent XP awards, Lua sliding-window rate limiting, kid-based JWT key rotation, and deterministic lock ordering in the coin ledger. These are genuinely well-engineered. The security posture is materially above average for a startup-scale codebase.

However, a cluster of critical and high-severity bugs undermines the otherwise strong foundation: a copy-paste error makes subscription status always "active", a missing DB unique constraint silently swallows ON CONFLICT, a JWT key-rotation path is incomplete for refresh tokens, CSRF protection accidentally blocks mobile clients, and referral commission columns store the wrong unit of value. The schema also accumulated several duplicate/redundant column pairs that signal organic growth without cleanup passes.

After applying the 20 fixes below, the architecture fully delivers on its design intent and earns the higher rating.

---

## Bug Index (One-Line Summaries)

1. ✅ **BUG-01** [CRITICAL] — Paystack webhook subscription status always set to "active" regardless of event type
2. ✅ **BUG-02** [CRITICAL] — `subscriptions` table missing unique constraint; `ON CONFLICT (user_id)` silently fails
3. ✅ **BUG-03** [HIGH] — `verifyRefreshToken` ignores the `kid` header, breaking multi-key rotation for refresh tokens
4. ✅ **BUG-04** [HIGH] — Gift XP award has no `reference_id`, enabling double-award on retry
5. ✅ **BUG-05** [HIGH] — CSRF origin check blocks all mobile POST mutations to `/api/auth/*` (no Origin header)
6. ✅ **BUG-06** [HIGH] — `assignNemesis` deactivates old nemesis and inserts new one in two separate queries without a transaction
7. ✅ **BUG-07** [HIGH] — Referral commission INSERT stores coin quantities in `_kobo` columns instead of kobo amounts
8. ✅ **BUG-08** [MEDIUM] — DB circuit breaker is in-memory only; state is not shared across serverless instances
9. ✅ **BUG-09** [MEDIUM] — HTML sanitizer allowlist includes `img` tag, enabling tracking pixels and hotlinking
10. ✅ **BUG-10** [MEDIUM] — Table name interpolated directly into SQL in content filter; potential SQL injection
11. ✅ **BUG-11** [MEDIUM] — National leaderboard silently defaults to `'NG'` when no country provided
12. ✅ **BUG-12** [MEDIUM] — `learningCertificates` schema has three duplicate column pairs; unique index on wrong column
13. ✅ **BUG-13** [LOW] — `userBadges` has both `awardedAt` and `grantedAt` columns for the same concept
14. ✅ **BUG-14** [LOW] — Both `reports` and `moderationReports` tables exist for the same concept
15. ✅ **BUG-15** [LOW] — `starBalance` stored as `integer` not `bigint`; overflow risk at ~2.1 billion stars
16. ✅ **BUG-16** [LOW] — `moderationActions` has duplicate actor FK (`moderatorId`/`actionedBy`), action type, and reason columns
17. ✅ **BUG-17** [LOW] — `sponsoredQuests` has both `rewardCoins` and `rewardAmountCoins` for the same field
18. ✅ **BUG-18** [LOW] — Guild wars CRON sets `status = 'completed'` redundantly after `resolveWar()` already does it
19. ✅ **BUG-19** [LOW] — `compareNemesisProgress` interpolates XP column name without throwing on unknown track
20. ✅ **BUG-20** [LOW] — `giftItems` has both `coinPrice` and `coinCost` for the same concept

---

## Detailed Bug Reports

---

### ✅ BUG-01 [CRITICAL] — Subscription status always set to "active"

**File:** `apps/web/app/api/economy/webhooks/paystack/route.ts` — line 499

**Description:**
A copy-paste error produces `isActive ? "active" : "active"` — both the truthy and falsy branches of the ternary return `"active"`. This means that when Paystack fires a `subscription.not_renew`, `subscription.disable`, or `invoice.payment_failed` webhook, the subscription is still written to the DB as `status = "active"`. Customers who cancel or whose payments fail retain full subscription access indefinitely. The `isActive` variable is computed correctly from the event type earlier in the function — the ternary is simply broken.

**Fix applied:** Changed falsy branch to `"inactive"`: `isActive ? "active" : "inactive"`. Also improved the catch block to log errors instead of silently swallowing them.

---

### ✅ BUG-02 [CRITICAL] — `subscriptions` table missing unique constraint; silent ON CONFLICT failure

**Files:**
- `apps/web/lib/db/schema.ts` (subscriptions table definition)
- `apps/web/app/api/economy/webhooks/paystack/route.ts` (ON CONFLICT upsert)
- `apps/web/db/migrations/0002_bug_fixes.sql` (migration)

**Description:**
The Paystack webhook handler uses `INSERT INTO subscriptions ... ON CONFLICT (user_id) DO UPDATE SET ...` to upsert subscription records. However, the `subscriptions` table in the Drizzle schema has no `.unique()` constraint on `userId`. PostgreSQL requires a unique index or constraint for `ON CONFLICT` to work — without it, the query throws `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification`. That error is swallowed by a bare `.catch(() => {})` wrapper, so subscription upserts silently do nothing. New subscribers never get a DB record.

**Fix applied:** Added `uniqueIndex('subscriptions_user_id_idx').on(t.userId)` to the `subscriptions` table in Drizzle schema. Added `CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions (user_id)` to migration `0002_bug_fixes.sql`.

---

### ✅ BUG-03 [HIGH] — `verifyRefreshToken` ignores `kid`, breaking refresh-token key rotation

**File:** `apps/web/lib/auth/jwt.ts` — `verifyRefreshToken` function

**Description:**
`verifyAccessToken` correctly decodes the JWT header, extracts the `kid`, and calls `getSecretForKid(kid)` to retrieve the matching key from the rotation registry. `verifyRefreshToken` does not do this — it calls `refreshSecret()` directly, always using the current (latest) refresh secret. During a key rotation, any refresh token issued under the previous key will fail verification with a signature mismatch, logging users out unnecessarily.

**Fix applied:** Added `buildRefreshKeyRegistry()` and `getRefreshSecretForKid(kid)` functions. Updated `verifyRefreshToken` to decode the JWT header, extract the `kid`, and look up the correct secret. Refresh keys are now rotatable via `JWT_REFRESH_SECRET_v{N}` env vars in the same pattern as access token keys.

---

### ✅ BUG-04 [HIGH] — Gift XP award has no `reference_id` for deduplication

**File:** `apps/web/app/api/economy/gifts/send/route.ts`

**Description:**
When a gift is sent, `safeAwardXP` is called with `referenceId` omitted (or `null`). The idempotency guard — the `ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL` partial index — only fires when `reference_id IS NOT NULL`. With a null reference, every retry inserts a new `xp_ledger` row and increments the user's XP again.

**Fix applied:** Added `giftId: string` parameter to `awardGiftXP`. All three XP inserts (sender, recipient base, first-gift bonus) now include `reference_id` with `ON CONFLICT DO NOTHING` for idempotency.

---

### ✅ BUG-05 [HIGH] — CSRF origin check blocks mobile POST mutations to `/api/auth/*`

**Files:**
- `apps/web/middleware.ts` — `isCsrfSafe()` and CSRF guard block
- `apps/expo/lib/api/client.ts` — Axios instance

**Description:**
`isCsrfSafe()` requires either a safe HTTP method or a matching `Origin` header. Mobile HTTP clients (Axios, native fetch) do not send an `Origin` header on non-browser requests. Mobile clients posting to `/api/auth/refresh` or `/api/auth/mobile-token` receive a `403 CSRF_ORIGIN_MISMATCH` response.

**Fix applied:** Added `Origin: env.API_BASE_URL` as a default header to the Axios instance in `apps/expo/lib/api/client.ts`. Also added it to the bare `axios.post` call in the refresh interceptor. Mobile requests now pass the CSRF origin check correctly.

---

### ✅ BUG-06 [HIGH] — `assignNemesis` not wrapped in a transaction

**File:** `apps/web/lib/nemesis/nemesisEngine.ts` — `assignNemesis` function

**Description:**
`assignNemesis` performs two sequential DB operations — deactivate old nemesis, insert new one — in two separate `db.query` calls with no transaction. If the INSERT fails, the user is left with no active nemesis.

**Fix applied:** Wrapped both operations in `db.transaction(async (tx) => { ... })`. The deactivation UPDATE and the new INSERT are now atomic.

---

### ✅ BUG-07 [HIGH] — Referral commission INSERT stores coin quantities in `_kobo` columns

**Files:**
- `apps/web/lib/referrals/commissions.ts`
- `apps/web/app/api/economy/webhooks/paystack/route.ts`
- `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

**Description:**
The referral commission INSERT populates `purchase_amount_kobo` and `commission_kobo` with coin amounts (not kobo monetary values). A 500-coin purchase might cost ₦5,000 (500,000 kobo) but the column records `500`. Downstream reporting and payout calculations produce garbage values.

**Fix applied:** Added `paymentAmountKobo: number = 0` parameter to `awardReferralCommissions`. `purchase_amount_kobo` now stores the actual Paystack charge in kobo; `commission_kobo` is computed as `Math.round(paymentAmountKobo * commissionRate)`. Both webhook handlers now pass the actual payment amount as the 5th argument.

---

### ✅ BUG-08 [MEDIUM] — DB circuit breaker is in-memory; not shared across serverless instances

**File:** `apps/web/lib/db/circuit.ts`

**Description:**
`DatabaseCircuitBreaker` holds state in module-level variables. In a serverless deployment, each function invocation may run in a separate isolate. One instance can trip to OPEN state while hundreds of other instances remain CLOSED and keep hammering a degraded database.

**Fix applied:** Replaced `DatabaseCircuitBreaker` with the existing Redis-backed `RedisCircuitBreaker` from `lib/payments/circuit.ts`. All serverless instances now share a single circuit state via Redis using Lua-atomic operations.

---

### ✅ BUG-09 [MEDIUM] — `img` tag in HTML sanitizer allowlist

**File:** `apps/web/lib/security/htmlSanitizer.ts`

**Description:**
The `ALLOWED_TAGS` set includes `"img"`. Allowing the `img` tag in user-generated content enables tracking pixels (revealing reader IP and timestamp) and hotlinking arbitrary external content.

**Fix applied:** Removed `"img"` from `ALLOWED_TAGS` and removed all `img` attribute entries from `ALLOWED_ATTRIBUTES`.

---

### ✅ BUG-10 [MEDIUM] — Table name interpolated directly into SQL in content filter

**File:** `apps/web/lib/moderation/contentFilter.ts`

**Description:**
The content filter queries the DB using `FROM ${table}` where `table` is a function parameter. Interpolating a variable into a SQL identifier is a SQL injection vector if any future caller passes a user-influenced value.

**Fix applied:** Added `const ALLOWED_CONTENT_TABLES = new Set(['messages', 'room_messages'])`. The function throws with a clear error if `table` is not in the allowlist before any SQL is executed.

---

### ✅ BUG-11 [MEDIUM] — National leaderboard silently defaults to `'NG'` when no country supplied

**File:** `apps/web/lib/leaderboards/engine.ts`

**Description:**
When `options.country` is not provided, both the snapshot and query paths use `options?.country ?? 'NG'`. Callers that forget to pass a country get Nigeria's leaderboard silently instead of an error.

**Fix applied:** Removed `?? 'NG'` fallbacks. Added explicit `throw new Error(...)` when `scope === 'national'` and no country is provided, in both `getUserRank` and `getLeaderboard`.

---

### ✅ BUG-12 [MEDIUM] — `learningCertificates` has three duplicate column pairs

**Files:**
- `apps/web/lib/db/schema.ts` — `learningCertificates` table
- `apps/web/db/migrations/0002_bug_fixes.sql`

**Description:**
Three pairs of columns represent the same concept under different names: `classroomRoomId`/`roomId`, `studentId`/`recipientUserId`, `issuerId`/`issuerUserId`. The unique index was on the legacy column names.

**Fix applied:** Removed `classroomRoomId`, `studentId`, `issuerId` from the Drizzle schema. Changed unique index to `(roomId, recipientUserId)`. Migration backfills canonical columns from legacy columns, drops old unique index, creates new unique index on canonical columns, then drops legacy columns.

---

### ✅ BUG-13 [LOW] — `userBadges` has both `awardedAt` and `grantedAt`

**Files:**
- `apps/web/lib/db/schema.ts`
- `apps/web/db/migrations/0002_bug_fixes.sql`
- Multiple route files using `granted_at` in queries (updated to `awarded_at`)

**Description:**
Two timestamp columns represent when a badge was granted. Code may write to one and read from the other, producing null timestamps that appear as un-awarded badges.

**Fix applied:** Removed `grantedAt` from Drizzle schema. Migration backfills `awarded_at` from `granted_at` where null, then drops `granted_at`. All query sites updated: `stickers/route.ts`, `users/[userId]/profile/route.ts`, `cron/daily/route.ts`, `seasons milestones claim`, `prestige/route.ts`, `lib/stickers/milestoneStickers.ts`, `lib/seasons/seasonEngine.ts`, `lib/xp/trackMilestones.ts`.

---

### ✅ BUG-14 [LOW] — Both `reports` and `moderationReports` tables exist

**File:** `apps/web/lib/db/schema.ts`

**Description:**
Two tables serve the content/user reporting concept: `reports` (user-submitted) and `moderationReports` (AI/admin moderation pipeline). These serve genuinely different purposes and were documented rather than merged.

**Fix applied:** Added clear documentation comments to both tables in the schema distinguishing their purposes: `reports` = user-submitted content/user reports; `moderationReports` = AI moderation pipeline results. No merge performed — tables serve different pipelines and merging would require a non-trivial data migration with product implications.

---

### ✅ BUG-15 [LOW] — `starBalance` stored as `integer` not `bigint`

**Files:**
- `apps/web/lib/db/schema.ts`
- `apps/web/db/migrations/0002_bug_fixes.sql`

**Description:**
PostgreSQL `integer` maxes out at 2,147,483,647. A power user with gifts, events, and promotional multipliers could theoretically approach this limit.

**Fix applied:** Changed `starBalance: integer("star_balance")` to `bigint("star_balance", { mode: "number" })` in Drizzle schema. Migration: `ALTER TABLE users ALTER COLUMN star_balance TYPE bigint`.

---

### ✅ BUG-16 [LOW] — `moderationActions` has duplicate actor FK and duplicate semantic columns

**Files:**
- `apps/web/lib/db/schema.ts`
- `apps/web/db/migrations/0002_bug_fixes.sql`
- `apps/web/app/api/admin/moderation/[reportId]/action/route.ts`
- `apps/web/app/api/admin/moderation/[reportId]/route.ts`

**Description:**
Three pairs of duplicate columns: `moderatorId`/`actionedBy`, `actionType`/`action`, `reason`/`note`.

**Fix applied:** Removed `actionedBy`, `action`, `note` from Drizzle schema. Migration backfills canonical columns from legacy, then drops legacy. Admin moderation route files updated to use `moderator_id`, `action_type`, `reason`.

---

### ✅ BUG-17 [LOW] — `sponsoredQuests` has both `rewardCoins` and `rewardAmountCoins`

**Files:**
- `apps/web/lib/db/schema.ts`
- `apps/web/db/migrations/0002_bug_fixes.sql`
- `apps/web/app/api/admin/sponsored-quests/route.ts`
- `apps/web/app/api/creator/sponsored-quests/route.ts`
- `apps/web/app/api/creator/sponsored-quests/[questId]/route.ts`
- `apps/web/app/api/creator/sponsored-quests/[questId]/approve/route.ts`

**Description:**
Two columns represent the same value — the coin reward for a sponsored quest. Code paths that write to one and read from the other produce zero rewards.

**Fix applied:** Removed `rewardAmountCoins` from Drizzle schema. Migration backfills `reward_coins` from `reward_amount_coins` where null, then drops legacy column. All 4 route files updated to use `reward_coins`/`rewardCoins` exclusively.

---

### ✅ BUG-18 [LOW] — Guild wars CRON redundantly sets `status = 'completed'` after `resolveWar()` already does it

**File:** `apps/web/app/api/cron/guild-wars/route.ts`

**Description:**
`resolveWar()` sets `guild_wars.status = 'completed'` inside its own transaction. The CRON handler ran another `UPDATE guild_wars SET status = 'completed'` after `resolveWar` returned — dead code that adds confusion.

**Fix applied:** Removed the redundant `UPDATE guild_wars SET status = 'completed'` from the CRON handler. `resolveWar()` is the single authoritative source of the status change.

---

### ✅ BUG-19 [LOW] — `compareNemesisProgress` interpolates XP column without a throw on unknown track

**File:** `apps/web/lib/nemesis/nemesisEngine.ts` — `compareNemesisProgress` function

**Description:**
The function maps a track name to a column name with a `?? "xp_total"` fallback. An unknown track silently compares against `xp_total` — wrong results with no error.

**Fix applied:** Added allowlist validation matching the pattern in `safeAwardXP`. Resolves the column, validates it against `new Set(Object.values(trackColumnMap))`, and throws if not found. Removed `?? "xp_total"` fallback.

---

### ✅ BUG-20 [LOW] — `giftItems` has both `coinPrice` and `coinCost`

**Files:**
- `apps/web/lib/db/schema.ts`
- `apps/web/db/migrations/0002_bug_fixes.sql`

**Description:**
Two columns represent the same concept — the coin cost of a gift item. Code that reads `coinCost` when data was saved to `coinPrice` finds `null` and potentially allows free gifts.

**Fix applied:** Removed `coinPrice` from Drizzle schema. Migration backfills `coin_cost` from `coin_price` where `coin_cost = 0`, then drops `coin_price`.

---

## Summary Table

| # | Severity | Status | Bug | File(s) |
|---|----------|--------|-----|---------|
| BUG-01 | CRITICAL | ✅ Fixed | Always-active subscription status | `api/economy/webhooks/paystack/route.ts` |
| BUG-02 | CRITICAL | ✅ Fixed | Missing unique constraint; silent ON CONFLICT | `lib/db/schema.ts`, `api/economy/webhooks/paystack/route.ts` |
| BUG-03 | HIGH | ✅ Fixed | `verifyRefreshToken` ignores kid | `lib/auth/jwt.ts` |
| BUG-04 | HIGH | ✅ Fixed | Gift XP no reference_id | `api/economy/gifts/send/route.ts` |
| BUG-05 | HIGH | ✅ Fixed | CSRF blocks mobile auth POSTs | `middleware.ts`, `apps/expo/lib/api/client.ts` |
| BUG-06 | HIGH | ✅ Fixed | Nemesis assignment not transactional | `lib/nemesis/nemesisEngine.ts` |
| BUG-07 | HIGH | ✅ Fixed | Referral kobo columns store coin counts | `lib/referrals/commissions.ts` |
| BUG-08 | MEDIUM | ✅ Fixed | DB circuit breaker in-memory only | `lib/db/circuit.ts` |
| BUG-09 | MEDIUM | ✅ Fixed | `img` in HTML sanitizer allowlist | `lib/security/htmlSanitizer.ts` |
| BUG-10 | MEDIUM | ✅ Fixed | Table name interpolated in SQL | `lib/moderation/contentFilter.ts` |
| BUG-11 | MEDIUM | ✅ Fixed | National leaderboard defaults to 'NG' | `lib/leaderboards/engine.ts` |
| BUG-12 | MEDIUM | ✅ Fixed | learningCertificates 3x duplicate columns | `lib/db/schema.ts` |
| BUG-13 | LOW | ✅ Fixed | userBadges awardedAt vs grantedAt | `lib/db/schema.ts` |
| BUG-14 | LOW | ✅ Fixed | Dual reports / moderationReports tables | `lib/db/schema.ts` (documented) |
| BUG-15 | LOW | ✅ Fixed | starBalance integer not bigint | `lib/db/schema.ts` |
| BUG-16 | LOW | ✅ Fixed | moderationActions duplicate columns | `lib/db/schema.ts` |
| BUG-17 | LOW | ✅ Fixed | sponsoredQuests dual reward coin columns | `lib/db/schema.ts` |
| BUG-18 | LOW | ✅ Fixed | Guild wars CRON redundant status update | `api/cron/guild-wars/route.ts` |
| BUG-19 | LOW | ✅ Fixed | compareNemesisProgress no throw on bad track | `lib/nemesis/nemesisEngine.ts` |
| BUG-20 | LOW | ✅ Fixed | giftItems coinPrice vs coinCost | `lib/db/schema.ts` |

---

*Report generated: 2026-06-15 at 12:00 PM*
*Fixes completed: 2026-06-15*
*Analyst: Claude (claude-sonnet-4-6) — Zobia forensic bug analysis*
*Branch: `claude/custom-bugs-gaps-fixes-lm2j1z`*
