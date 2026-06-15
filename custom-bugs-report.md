# Zobia Codebase Bug Report
**Date:** 2026-06-15 | **Time:** 12:00 PM
**Scope:** Full forensic analysis — web app, PWA, Expo mobile Android, shared libs, DB schema, CRON routes
**Analyst:** Claude (claude-sonnet-4-6) — independent self-conducted analysis, no sub-agents

---

## Current Code Rating: 6.5 / 10
### Projected Rating After All Fixes: 8.5 / 10

**Review Summary:**
The codebase demonstrates sophisticated architectural thinking — Redis-backed circuit breakers for payments, DNS-pinned SSRF protection, CTE-gated idempotent XP awards, Lua sliding-window rate limiting, kid-based JWT key rotation, and deterministic lock ordering in the coin ledger. These are genuinely well-engineered. The security posture is materially above average for a startup-scale codebase.

However, a cluster of critical and high-severity bugs undermines the otherwise strong foundation: a copy-paste error makes subscription status always "active", a missing DB unique constraint silently swallows ON CONFLICT, a JWT key-rotation path is incomplete for refresh tokens, CSRF protection accidentally blocks mobile clients, and referral commission columns store the wrong unit of value. The schema also accumulated several duplicate/redundant column pairs that signal organic growth without cleanup passes.

After applying the 20 fixes below, the architecture fully delivers on its design intent and earns the higher rating.

---

## Bug Index (One-Line Summaries)

1. **BUG-01** [CRITICAL] — Paystack webhook subscription status always set to "active" regardless of event type
2. **BUG-02** [CRITICAL] — `subscriptions` table missing unique constraint; `ON CONFLICT (user_id)` silently fails
3. **BUG-03** [HIGH] — `verifyRefreshToken` ignores the `kid` header, breaking multi-key rotation for refresh tokens
4. **BUG-04** [HIGH] — Gift XP award has no `reference_id`, enabling double-award on retry
5. **BUG-05** [HIGH] — CSRF origin check blocks all mobile POST mutations to `/api/auth/*` (no Origin header)
6. **BUG-06** [HIGH] — `assignNemesis` deactivates old nemesis and inserts new one in two separate queries without a transaction
7. **BUG-07** [HIGH] — Referral commission INSERT stores coin quantities in `_kobo` columns instead of kobo amounts
8. **BUG-08** [MEDIUM] — DB circuit breaker is in-memory only; state is not shared across serverless instances
9. **BUG-09** [MEDIUM] — HTML sanitizer allowlist includes `img` tag, enabling tracking pixels and hotlinking
10. **BUG-10** [MEDIUM] — Table name interpolated directly into SQL in content filter; potential SQL injection
11. **BUG-11** [MEDIUM] — National leaderboard silently defaults to `'NG'` when no country provided
12. **BUG-12** [MEDIUM] — `learningCertificates` schema has three duplicate column pairs; unique index on wrong column
13. **BUG-13** [LOW] — `userBadges` has both `awardedAt` and `grantedAt` columns for the same concept
14. **BUG-14** [LOW] — Both `reports` and `moderationReports` tables exist for the same concept
15. **BUG-15** [LOW] — `starBalance` stored as `integer` not `bigint`; overflow risk at ~2.1 billion stars
16. **BUG-16** [LOW] — `moderationActions` has duplicate actor FK (`moderatorId`/`actionedBy`), action type, and reason columns
17. **BUG-17** [LOW] — `sponsoredQuests` has both `rewardCoins` and `rewardAmountCoins` for the same field
18. **BUG-18** [LOW] — Guild wars CRON sets `status = 'completed'` redundantly after `resolveWar()` already does it
19. **BUG-19** [LOW] — `compareNemesisProgress` interpolates XP column name without throwing on unknown track
20. **BUG-20** [LOW] — `giftItems` has both `coinPrice` and `coinCost` for the same concept

---

## Detailed Bug Reports

---

### BUG-01 [CRITICAL] — Subscription status always set to "active"

**File:** `apps/web/app/api/economy/webhooks/paystack/route.ts` — line 499

**Description:**
A copy-paste error produces `isActive ? "active" : "active"` — both the truthy and falsy branches of the ternary return `"active"`. This means that when Paystack fires a `subscription.not_renew`, `subscription.disable`, or `invoice.payment_failed` webhook, the subscription is still written to the DB as `status = "active"`. Customers who cancel or whose payments fail retain full subscription access indefinitely. The `isActive` variable is computed correctly from the event type earlier in the function — the ternary is simply broken.

**Fix:** Change the falsy branch to `"inactive"` (or `"cancelled"` — whichever matches the enum in your DB schema): `isActive ? "active" : "inactive"`.

---

### BUG-02 [CRITICAL] — `subscriptions` table missing unique constraint; silent ON CONFLICT failure

**Files:**
- `apps/web/lib/db/schema.ts` (subscriptions table definition)
- `apps/web/app/api/economy/webhooks/paystack/route.ts` (ON CONFLICT upsert)

**Description:**
The Paystack webhook handler uses `INSERT INTO subscriptions ... ON CONFLICT (user_id) DO UPDATE SET ...` to upsert subscription records. However, the `subscriptions` table in the Drizzle schema has no `.unique()` constraint on `userId`. PostgreSQL requires a unique index or constraint for `ON CONFLICT` to work — without it, the query throws `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification`. That error is swallowed by a bare `.catch(() => {})` wrapper, so subscription upserts silently do nothing. New subscribers never get a DB record.

**Fix:** Add `.unique()` to the `userId` column in the `subscriptions` table definition (or add `uniqueIndex('subscriptions_user_id_idx').on(subscriptions.userId)`) and generate a migration. Also improve the catch block to at least log the error so future silent failures surface.

---

### BUG-03 [HIGH] — `verifyRefreshToken` ignores `kid`, breaking refresh-token key rotation

**File:** `apps/web/lib/auth/jwt.ts` — `verifyRefreshToken` function (~line 203–220)

**Description:**
`verifyAccessToken` correctly decodes the JWT header, extracts the `kid`, and calls `getSecretForKid(kid)` to retrieve the matching key from the rotation registry. `verifyRefreshToken` does not do this — it calls `refreshSecret()` directly, always using the current (latest) refresh secret. During a key rotation, any refresh token issued under the previous key will fail verification with a signature mismatch, logging users out unnecessarily. The kid-based rotation mechanism that protects access tokens is incomplete for refresh tokens.

**Fix:** Mirror `verifyAccessToken`'s approach: decode the JWT header inside `verifyRefreshToken`, extract the `kid`, and look it up via `getSecretForKid(kid)` (or a dedicated `getRefreshSecretForKid` if refresh keys are separate). The signing side (`signRefreshToken`) already writes the `kid` into the protected header — the verification side just needs to read it.

---

### BUG-04 [HIGH] — Gift XP award has no `reference_id` for deduplication

**File:** `apps/web/app/api/economy/gifts/send/route.ts` (XP award call inside gift handler)

**Description:**
When a gift is sent, `safeAwardXP` is called with `referenceId` omitted (or `null`). The idempotency guard in `safeAwardXP` — the `ON CONFLICT (user_id, source, reference_id) WHERE reference_id IS NOT NULL` partial index — only fires when `reference_id IS NOT NULL`. With a null reference, every retry (network timeout, double-tap, client retry) inserts a new `xp_ledger` row and increments the user's XP again. Gift sends are exactly the kind of action that generates retries.

**Fix:** Pass the gift's unique identifier (e.g. the gift transaction ID or `giftId`) as `referenceId` when calling `safeAwardXP`. This ensures the partial unique index deduplicates concurrent or retried XP awards for the same gift event.

---

### BUG-05 [HIGH] — CSRF origin check blocks mobile POST mutations to `/api/auth/*`

**Files:**
- `apps/web/middleware.ts` — `isCsrfSafe()` and CSRF guard block
- `apps/expo/lib/api/client.ts` — Axios instance (no Origin header added)
- `apps/web/app/api/auth/refresh/route.ts` — affected endpoint
- `apps/web/app/api/auth/mobile-token/route.ts` — affected endpoint

**Description:**
`isCsrfSafe()` requires either a safe HTTP method or a matching `Origin` header. Mobile HTTP clients (Axios, native fetch) do not send an `Origin` header on non-browser requests. The middleware marks `/api/auth/*` POST mutations as `isAuthMutation = true` and applies the CSRF check. Mobile clients posting to `/api/auth/refresh` or `/api/auth/mobile-token` receive a `403 CSRF_ORIGIN_MISMATCH` response, making token refresh and mobile auth token exchange broken on Android.

The existing CRON carve-out (`isCronPath && hasCronSecret`) shows the right pattern. Mobile auth endpoints need a similar carve-out, or the Axios client needs to add `Origin: <APP_URL>`.

**Fix (preferred — client-side):** Add a default header `Origin: process.env.EXPO_PUBLIC_APP_URL` to the Axios instance in `apps/expo/lib/api/client.ts`. This is the minimal, correct fix — it makes mobile requests look like same-origin to the CSRF check without any server-side carve-out. Alternatively, the server can exempt `/api/auth/refresh` and `/api/auth/mobile-token` with a Bearer-token check (mobile clients send a valid JWT), but the client-side fix is cleaner.

---

### BUG-06 [HIGH] — `assignNemesis` not wrapped in a transaction

**File:** `apps/web/lib/nemesis/nemesisEngine.ts` — `assignNemesis` function

**Description:**
`assignNemesis` performs two sequential DB operations: (1) `UPDATE nemesis_relationships SET is_active = false WHERE user_id = $1` to deactivate the old nemesis, then (2) `INSERT INTO nemesis_relationships ...` to insert the new one. These are two separate `db.query` calls with no transaction. If the INSERT fails (constraint violation, DB hiccup), the user's old nemesis has already been deactivated and they are left with no active nemesis. The system is now in an inconsistent state.

**Fix:** Wrap both queries in `db.transaction(async (tx) => { ... })`. The deactivation UPDATE and the new INSERT must be atomic — either both succeed or neither does.

---

### BUG-07 [HIGH] — Referral commission INSERT stores coin quantities in `_kobo` columns

**File:** `apps/web/lib/referrals/commissions.ts` — lines 138–144 (approximately)

**Description:**
The referral commission INSERT populates `purchase_amount_kobo` and `commission_kobo` with coin amounts (the number of coins purchased/earned), not with the actual kobo monetary value. The `_kobo` suffix denotes the smallest Nigerian currency unit (₦0.01). Storing coin counts there makes the monetary audit trail wrong: a 500-coin purchase might cost ₦5,000 (500,000 kobo) but the column records `500`. Downstream reporting, payout calculations, and any compliance exports that read `commission_kobo` will produce garbage values.

**Fix:** Pass `paymentAmountKobo` (the actual Paystack charge in kobo) to `purchase_amount_kobo`, and compute `commissionKobo = Math.round(paymentAmountKobo * commissionRate)` for `commission_kobo`. The coin amounts belong in `commission_coins` (which is already correct). Verify the column names in the schema and align the INSERT parameter order accordingly.

---

### BUG-08 [MEDIUM] — DB circuit breaker is in-memory; not shared across serverless instances

**File:** `apps/web/lib/db/circuit.ts`

**Description:**
`DatabaseCircuitBreaker` is a plain TypeScript class holding state in module-level variables (`state`, `failureCount`, `lastFailureTime`). In a serverless (Vercel) deployment, each function invocation may run in a separate isolate with its own memory. One instance can trip to OPEN state while hundreds of other instances remain CLOSED and keep hammering a degraded database. The Redis-backed `RedisCircuitBreaker` in `apps/web/lib/payments/circuit.ts` correctly solves this for payment APIs — the DB circuit breaker needs the same treatment.

**Fix:** Replace `DatabaseCircuitBreaker` with a Redis-backed implementation mirroring `RedisCircuitBreaker`. Use the same Lua-atomic pattern (compare-and-set on `state`, `failure_count`, `last_failure_time` keys) so all serverless instances share a single circuit view.

---

### BUG-09 [MEDIUM] — `img` tag in HTML sanitizer allowlist

**File:** `apps/web/lib/security/htmlSanitizer.ts`

**Description:**
The `ALLOWED_TAGS` set includes `"img"`. Allowing the `img` tag in user-generated content enables: (1) tracking pixels — a `1x1` image from an attacker's server reveals the reader's IP address and read timestamp; (2) hotlinking arbitrary external content, including potentially illegal or offensive images that bypass the content filter; (3) if `src` attributes aren't fully stripped, potential CSP bypass vectors. The CSP `img-src` policy in `middleware.ts` limits `img-src` to `'self' data: blob: https:`, which mitigates XSS but not the tracking pixel or content hotlinking issues.

**Fix:** Remove `"img"` from `ALLOWED_TAGS`. If inline images are a product requirement, require users to upload images to your own storage (GCS/S3) and render them via `<img src="/api/media/...">` so you control the content. If you keep `img`, at minimum strip the `src` attribute and only allow `data:` URIs after scanning, and add a `referrerpolicy="no-referrer"` attribute via sanitizer config.

---

### BUG-10 [MEDIUM] — Table name interpolated directly into SQL in content filter

**File:** `apps/web/lib/moderation/contentFilter.ts`

**Description:**
The content filter queries the DB using `FROM ${table}` where `table` is a parameter passed into the function. Even if the callers today pass only string literals, interpolating a variable into a SQL identifier is a SQL injection vector. If any future caller passes a user-influenced value, or if the function is refactored to accept runtime input, this becomes exploitable. PostgreSQL identifier injection is less common than value injection but equally dangerous (e.g. `table = "users; DROP TABLE users; --"`).

**Fix:** Replace the interpolation with an allowlist: define `const ALLOWED_TABLES = new Set(['messages', 'posts', ...])`, throw if `!ALLOWED_TABLES.has(table)`, and continue using the interpolation only after the check. Alternatively, use `pg.identifier` quoting (e.g. `sql.identifier([table])` in the Drizzle/postgres.js API) to safely escape the identifier.

---

### BUG-11 [MEDIUM] — National leaderboard silently defaults to `'NG'` when no country supplied

**File:** `apps/web/lib/leaderboards/engine.ts` — lines ~104–105 and ~183–184

**Description:**
When `options.country` is not provided, both the snapshot and query paths use `options?.country ?? 'NG'`. This means a call to get the national leaderboard without a country parameter silently returns Nigeria's leaderboard. Callers that forget to pass a country get subtly wrong results with no error. Non-Nigerian users who don't have a country set would see NG rankings instead of an empty result or an error.

**Fix:** Remove the `?? 'NG'` fallback and instead throw or return an error when `options.country` is required but missing. If `country` is genuinely optional for some call sites, make that intent explicit: e.g. return an empty result or require callers to explicitly pass `'NG'` when they want Nigeria.

---

### BUG-12 [MEDIUM] — `learningCertificates` has three duplicate column pairs

**File:** `apps/web/lib/db/schema.ts` — `learningCertificates` table

**Description:**
The table contains three pairs of columns representing the same concept under different names:
- `classroomRoomId` and `roomId` — both reference the classroom room
- `studentId` and `recipientUserId` — both reference the certificate recipient
- `issuerId` and `issuerUserId` — both reference the issuer

Additionally, the unique index appears to be on the legacy column name, not the canonical one. Code reading either column name will get inconsistent results unless both are always written together. Migration history suggests these were added in separate passes without removing the originals.

**Fix:** Pick one canonical column for each concept, write a migration to copy data from the legacy column to the canonical one for any existing rows, add the unique index to the canonical column, then drop the legacy columns. Regenerate the Drizzle schema. Update all query sites to use the canonical columns.

---

### BUG-13 [LOW] — `userBadges` has both `awardedAt` and `grantedAt`

**File:** `apps/web/lib/db/schema.ts` — `userBadges` table

**Description:**
Two timestamp columns represent the same thing — the moment a badge was granted to a user. Having both creates ambiguity: application code may write to one and read from the other, producing `null` timestamps that appear as un-awarded badges. New code written without awareness of the dual columns will likely only populate one.

**Fix:** Retain `awardedAt` (more semantically clear), migrate any non-null values from `grantedAt`, then drop `grantedAt` in a migration.

---

### BUG-14 [LOW] — Both `reports` and `moderationReports` tables exist

**File:** `apps/web/lib/db/schema.ts`

**Description:**
Two tables serve the content/user reporting concept: `reports` and `moderationReports`. The trust score calculation queries `reports` while moderation tooling likely queries `moderationReports`. Reports submitted by users may go to one table while the other is queried for enforcement decisions, causing inconsistency in moderation visibility and trust score accuracy.

**Fix:** Decide on a canonical table, migrate all data, update all query sites (including the trust score signal query), and drop the redundant table. If the two tables truly serve different purposes (e.g. user-submitted vs. admin-raised), rename them unambiguously and document the distinction.

---

### BUG-15 [LOW] — `starBalance` stored as `integer` not `bigint`

**File:** `apps/web/lib/db/schema.ts` — `users` table, `starBalance` column (or equivalent balance column)

**Description:**
PostgreSQL `integer` maxes out at 2,147,483,647. For a social platform with gifting economies, star accumulation through events, and potential promotional multipliers, a power user could theoretically approach this limit. Once hit, the column throws an overflow error. `bigint` (max ~9.2 × 10¹⁸) is the safe choice for any balance column.

**Fix:** `ALTER TABLE users ALTER COLUMN star_balance TYPE bigint;` and update the Drizzle column definition to `bigint()`.

---

### BUG-16 [LOW] — `moderationActions` has duplicate actor FK and duplicate semantic columns

**File:** `apps/web/lib/db/schema.ts` — `moderationActions` table

**Description:**
The table has:
- Both `moderatorId` and `actionedBy` referencing the admin who took the action
- Both `actionType` and `action` for the type of moderation action
- Both `reason` and `note` for the free-text explanation

This is the same organic-growth duplication pattern as BUG-12 and BUG-13. Queries that expect `reason` but get `note` (or vice versa) return `null` silently.

**Fix:** Consolidate to one column per concept (`moderatorId`, `actionType`, `reason` seem canonical), migrate data, drop the duplicates.

---

### BUG-17 [LOW] — `sponsoredQuests` has both `rewardCoins` and `rewardAmountCoins`

**File:** `apps/web/lib/db/schema.ts` — `sponsoredQuests` table

**Description:**
Two columns represent the same value — the coin reward for completing a sponsored quest. Code paths that write to one and read from the other will produce zero rewards.

**Fix:** Retain `rewardCoins`, migrate data from `rewardAmountCoins`, drop the legacy column, update all references.

---

### BUG-18 [LOW] — Guild wars CRON redundantly sets `status = 'completed'` after `resolveWar` already does it

**File:** `apps/web/app/api/cron/guild-wars/route.ts`

**Description:**
`resolveWar(war.id, db)` is called inside a transaction that already sets `guild_wars.status = 'completed'`. After `resolveWar` returns, the CRON runs another `UPDATE guild_wars SET status = 'completed' WHERE id = $1`. This is harmless but is dead code that adds confusion — a future developer may wonder if `resolveWar` actually sets the status, or may introduce a third update here.

**Fix:** Remove the redundant `UPDATE guild_wars SET status = 'completed'` from the CRON handler. Trust the `resolveWar` transaction to be the single authoritative source of the status change.

---

### BUG-19 [LOW] — `compareNemesisProgress` interpolates XP column without a throw on unknown track

**File:** `apps/web/lib/nemesis/nemesisEngine.ts` — `compareNemesisProgress` function

**Description:**
The function maps a track name to a column name with a `?? "xp_total"` fallback. Unlike `safeAwardXP` (which has an explicit allowlist check and throws `Unsafe XP track column` on unknown input), `compareNemesisProgress` silently falls back to `xp_total` for any unknown track. If a caller passes a typo or a new track that doesn't exist in the map, the comparison uses the wrong column with no indication of the error.

**Fix:** Add the same allowlist pattern used in `safeAwardXP` — validate the resolved column against `new Set(Object.values(TRACK_COLUMN))` and throw if not found. Remove the `?? "xp_total"` fallback.

---

### BUG-20 [LOW] — `giftItems` has both `coinPrice` and `coinCost`

**File:** `apps/web/lib/db/schema.ts` — `giftItems` table

**Description:**
Two columns represent the same concept — how many coins a gift item costs. The same organic-growth duplication pattern as BUG-13, BUG-16, BUG-17. Code that reads `coinCost` when the item was saved to `coinPrice` will find `null` and potentially allow free gifts.

**Fix:** Retain `coinCost` (or `coinPrice` — pick one and be consistent with the rest of the schema's naming convention), migrate data from the legacy column, drop the redundant column, and update all query/insert sites.

---

## Summary Table

| # | Severity | Bug | File(s) |
|---|----------|-----|---------|
| BUG-01 | CRITICAL | Always-active subscription status | `api/economy/webhooks/paystack/route.ts` |
| BUG-02 | CRITICAL | Missing unique constraint; silent ON CONFLICT | `lib/db/schema.ts`, `api/economy/webhooks/paystack/route.ts` |
| BUG-03 | HIGH | `verifyRefreshToken` ignores kid | `lib/auth/jwt.ts` |
| BUG-04 | HIGH | Gift XP no reference_id | `api/economy/gifts/send/route.ts` |
| BUG-05 | HIGH | CSRF blocks mobile auth POSTs | `middleware.ts`, `apps/expo/lib/api/client.ts` |
| BUG-06 | HIGH | Nemesis assignment not transactional | `lib/nemesis/nemesisEngine.ts` |
| BUG-07 | HIGH | Referral kobo columns store coin counts | `lib/referrals/commissions.ts` |
| BUG-08 | MEDIUM | DB circuit breaker in-memory only | `lib/db/circuit.ts` |
| BUG-09 | MEDIUM | `img` in HTML sanitizer allowlist | `lib/security/htmlSanitizer.ts` |
| BUG-10 | MEDIUM | Table name interpolated in SQL | `lib/moderation/contentFilter.ts` |
| BUG-11 | MEDIUM | National leaderboard defaults to 'NG' | `lib/leaderboards/engine.ts` |
| BUG-12 | MEDIUM | learningCertificates 3x duplicate columns | `lib/db/schema.ts` |
| BUG-13 | LOW | userBadges awardedAt vs grantedAt | `lib/db/schema.ts` |
| BUG-14 | LOW | Dual reports / moderationReports tables | `lib/db/schema.ts` |
| BUG-15 | LOW | starBalance integer not bigint | `lib/db/schema.ts` |
| BUG-16 | LOW | moderationActions duplicate columns | `lib/db/schema.ts` |
| BUG-17 | LOW | sponsoredQuests dual reward coin columns | `lib/db/schema.ts` |
| BUG-18 | LOW | Guild wars CRON redundant status update | `api/cron/guild-wars/route.ts` |
| BUG-19 | LOW | compareNemesisProgress no throw on bad track | `lib/nemesis/nemesisEngine.ts` |
| BUG-20 | LOW | giftItems coinPrice vs coinCost | `lib/db/schema.ts` |

---

*Report generated: 2026-06-15 at 12:00 PM*
*Analyst: Claude (claude-sonnet-4-6) — Zobia forensic bug analysis*
*DO NOT fix any bugs until the fix plan has been reviewed and approved.*
