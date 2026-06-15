# Zobia Codebase Bug Fix Plan
**Date:** 2026-06-15 | **Time:** 12:00 PM
**Scope:** Fix plan for all 20 bugs identified in `custom-bugs-report.md`
**Do not implement until this plan is reviewed and approved.**

---

## Execution Order

Fixes are ordered by: (1) severity — critical and high first; (2) dependency — schema migrations before application code that depends on them; (3) risk — isolated changes before cross-cutting ones.

---

## Phase 1 — Critical Fixes (ship ASAP, zero downtime risk)

---

### Fix BUG-01 — Subscription status copy-paste error

**Files to change:**
- `apps/web/app/api/economy/webhooks/paystack/route.ts`

**Steps:**
1. Find the ternary at line 499: `isActive ? "active" : "active"`
2. Change the falsy branch to match your DB enum — `"inactive"` or `"cancelled"` depending on the value defined in `schema.ts` for the subscriptions status column.
3. Verify the subscription status enum in `schema.ts` to confirm the correct string.
4. Add a unit test (or at minimum a manual test) that fires a `subscription.disable` webhook payload and asserts the DB record status becomes `"inactive"`/`"cancelled"`.

**Risk:** Low. Single-line change. Zero schema migration needed.

---

### Fix BUG-02 — Missing unique constraint on `subscriptions.user_id`

**Files to change:**
- `apps/web/lib/db/schema.ts`
- New Drizzle migration file

**Steps:**
1. In `schema.ts`, add `.unique()` to the `userId` column of the `subscriptions` table, OR add a separate `uniqueIndex('subscriptions_user_id_idx').on(subscriptions.userId)` declaration.
2. Run `pnpm drizzle-kit generate` to produce the migration SQL.
3. Inspect the generated migration — it should be `CREATE UNIQUE INDEX subscriptions_user_id_idx ON subscriptions (user_id);`. This is safe to apply on a live table (PostgreSQL builds the index without locking writes in modern versions, but verify your PG version).
4. Apply the migration.
5. In the webhook handler's `.catch` block, change `() => {}` to `(err) => logger.error(err, 'subscriptions upsert failed')` so future silent failures are visible.

**Risk:** Low. Index creation is non-destructive. If duplicate `user_id` rows exist (due to the pre-existing bug), the migration will fail — run `SELECT user_id, COUNT(*) FROM subscriptions GROUP BY user_id HAVING COUNT(*) > 1` first and resolve duplicates manually before applying.

---

## Phase 2 — High Severity Fixes

---

### Fix BUG-03 — `verifyRefreshToken` ignores `kid`

**Files to change:**
- `apps/web/lib/auth/jwt.ts`

**Steps:**
1. Inside `verifyRefreshToken`, before calling `jwtVerify`, decode the JWT header with `decodeProtectedHeader(token)` (already imported via `jose`).
2. Extract `kid` from the decoded header.
3. Call `getSecretForKid(kid)` (or a dedicated `getRefreshSecretForKid` function if refresh keys are stored separately from access keys) to get the correct secret.
4. Pass that secret to `jwtVerify` instead of calling `refreshSecret()` unconditionally.
5. If `kid` is missing or not found in the registry, throw an appropriate auth error.
6. Test: issue a refresh token with key K1, rotate to K2, confirm `verifyRefreshToken` still validates the K1 token correctly without logging the user out.

**Risk:** Low. This is additive — adds a key lookup step. The only regression risk is if the key registry doesn't contain the refresh secret for historical tokens, which would already be a problem at rotation time.

---

### Fix BUG-04 — Gift XP no `reference_id`

**Files to change:**
- `apps/web/app/api/economy/gifts/send/route.ts`

**Steps:**
1. Locate the `safeAwardXP` call inside the gift send handler.
2. Pass the gift transaction ID or gift record ID as the `referenceId` parameter — e.g. `safeAwardXP(userId, xpAmount, 'social', 'send_gift', giftId)`.
3. Ensure `giftId` is available at that point in the handler (it should be, since the gift record is inserted before XP is awarded).
4. Verify the same deduplication approach for the recipient's XP award if one exists.

**Risk:** Zero. Adding a non-null `referenceId` only enables deduplication — it cannot cause double-awards to be lost.

---

### Fix BUG-05 — CSRF blocks mobile auth POST mutations

**Files to change:**
- `apps/expo/lib/api/client.ts` (preferred fix)

**Steps:**
1. Add a default request header to the Axios instance: `'Origin': process.env.EXPO_PUBLIC_APP_URL`.
2. Ensure `EXPO_PUBLIC_APP_URL` is set in the Expo `.env` / EAS environment and matches `NEXT_PUBLIC_APP_URL` used in the server's `isCsrfSafe()` check.
3. Test: make a POST to `/api/auth/refresh` from the Expo app and confirm a 200 response (not 403).

**Alternative (server-side):** If adding an Origin header to the Expo client is not feasible, add a carve-out in `isCsrfSafe()` for requests to `/api/auth/refresh` and `/api/auth/mobile-token` that carry a valid Bearer JWT — mobile clients are authenticated via the token, so the CSRF risk is already mitigated. This is a viable fallback but less clean than the client-side fix.

**Risk:** Low. Adding an `Origin` header to mobile requests is standard practice. Verify the value matches the server-side check exactly (protocol + host, no trailing slash).

---

### Fix BUG-06 — `assignNemesis` not in transaction

**Files to change:**
- `apps/web/lib/nemesis/nemesisEngine.ts`

**Steps:**
1. Wrap the deactivation UPDATE and the new nemesis INSERT in a single `db.transaction(async (tx) => { ... })` call.
2. Replace both `db.query(...)` calls inside the function with `tx.query(...)`.
3. Ensure the transaction client type (`TransactionClient`) is compatible with the queries used.
4. Test failure scenario: mock the INSERT to throw, verify the old nemesis relationship is not deactivated.

**Risk:** Low. Wrapping in a transaction only makes the operation safer — it cannot break the happy path.

---

### Fix BUG-07 — Referral commission kobo columns store coin counts

**Files to change:**
- `apps/web/lib/referrals/commissions.ts`

**Steps:**
1. Identify the variable holding the actual Paystack payment amount in kobo (likely passed in from the webhook handler — e.g. `paymentAmountKobo`).
2. In the commission INSERT, replace the `purchase_amount_kobo` parameter value with `paymentAmountKobo`.
3. Compute `tier1CommissionKobo = Math.round(paymentAmountKobo * TIER1_RATE)` and `tier2CommissionKobo = Math.round(paymentAmountKobo * TIER2_RATE)`.
4. Pass these computed values to `commission_kobo`.
5. Leave `commission_coins` values unchanged — those are correct.
6. If `paymentAmountKobo` is not available at the call site, trace back to the Paystack webhook event data where the amount is present (Paystack's event body has `data.amount` in kobo).
7. Consider a one-time data migration to fix historical rows if monetary reporting matters for past records.

**Risk:** Medium. Requires verifying the data flow from Paystack webhook → commission call. Test carefully to confirm `paymentAmountKobo` is the right variable and not off by any unit conversion.

---

## Phase 3 — Medium Severity Fixes

---

### Fix BUG-08 — DB circuit breaker in-memory only

**Files to change:**
- `apps/web/lib/db/circuit.ts`

**Steps:**
1. Refactor `DatabaseCircuitBreaker` to use Redis for state storage, mirroring the `RedisCircuitBreaker` pattern in `apps/web/lib/payments/circuit.ts`.
2. Use the same Lua atomic compare-and-set scripts to ensure consistent state transitions across serverless instances.
3. Store state under a Redis key like `circuit:db:state`, with matching `circuit:db:failure_count` and `circuit:db:last_failure_time` keys.
4. Update the `DatabaseCircuitBreaker` constructor to accept a Redis client and key prefix.
5. Update wherever `DatabaseCircuitBreaker` is instantiated to pass the Redis client.
6. Test: simulate DB failures across multiple instances and verify the circuit opens globally.

**Risk:** Medium. Changing circuit breaker persistence affects operational behaviour. Test the open/half-open/closed transitions thoroughly. Ensure the Redis client used here is the same connected instance used elsewhere (avoid creating a second connection).

---

### Fix BUG-09 — `img` tag in HTML sanitizer allowlist

**Files to change:**
- `apps/web/lib/security/htmlSanitizer.ts`

**Steps:**
1. Remove `"img"` from the `ALLOWED_TAGS` set/array.
2. Check all callers of the sanitizer to confirm none rely on `img` being allowed for a product feature.
3. If inline images are a product requirement, implement a media upload endpoint and convert the UX to upload-then-embed (render via `/api/media/<id>`) rather than allowing arbitrary `src` URLs.
4. Run existing sanitizer tests to confirm no regressions.

**Risk:** Low. Removing a tag is purely restrictive. The only risk is breaking a product feature that actually uses `img` in rich text — verify with product before shipping.

---

### Fix BUG-10 — Table name interpolated in SQL

**Files to change:**
- `apps/web/lib/moderation/contentFilter.ts`

**Steps:**
1. Define an explicit allowlist: `const ALLOWED_CONTENT_TABLES = new Set(['messages', 'posts', 'comments'])` (add any other tables this function legitimately queries).
2. At the top of the function, before building the query: `if (!ALLOWED_CONTENT_TABLES.has(table)) throw new Error(\`contentFilter: unknown table '${table}'\`)`.
3. The interpolation itself can remain (the value is now guaranteed safe) — or switch to using `pg`/Drizzle identifier quoting for defense in depth.
4. Review all call sites to ensure the `table` parameter is always a string literal at the call site, not a user-derived value.

**Risk:** Zero. Adding an allowlist check before interpolation only hardens the code — no behaviour change on the happy path.

---

### Fix BUG-11 — National leaderboard silent 'NG' default

**Files to change:**
- `apps/web/lib/leaderboards/engine.ts`

**Steps:**
1. Remove the `?? 'NG'` fallback on both the snapshot path (lines ~104–105) and the query path (lines ~183–184).
2. Replace with an explicit guard: if `scope === 'national'` and `!options?.country`, throw `new Error('country is required for national leaderboard scope')`.
3. Audit all call sites to either always pass a country or to handle the error gracefully.
4. If the leaderboard API endpoint is user-facing, return a 400 with a clear error rather than throwing internally.

**Risk:** Low. This is a correctness fix. Any callers that were relying on the silent 'NG' default will now fail loudly — which is the desired behaviour; they need to be updated to pass an explicit country.

---

### Fix BUG-12 — `learningCertificates` duplicate column pairs

**Files to change:**
- `apps/web/lib/db/schema.ts`
- New migration file

**Steps:**
1. Determine the canonical column names for each pair. Suggested: `roomId`, `recipientUserId`, `issuerUserId`.
2. Generate a migration that:
   - Copies non-null data from legacy columns to canonical ones where canonical is null.
   - Drops the unique index on the legacy column if present.
   - Adds the unique index to the canonical column.
   - Drops the legacy columns (`classroomRoomId`, `studentId`, `issuerId`).
3. Update all query sites in the codebase to reference only the canonical column names.
4. Update the Drizzle schema definition to remove the legacy column declarations.

**Risk:** Medium. Schema migration with data movement. Run in a transaction. Take a backup before applying. Verify row counts before and after.

---

## Phase 4 — Low Severity Fixes (schema cleanup)

These can be batched into a single "schema cleanup" PR/migration.

---

### Fix BUG-13 — `userBadges` awardedAt vs grantedAt

**Steps:**
1. Migration: `UPDATE user_badges SET awarded_at = granted_at WHERE awarded_at IS NULL AND granted_at IS NOT NULL`.
2. Drop `granted_at` column.
3. Update schema and any query sites referencing `grantedAt`.

---

### Fix BUG-14 — Dual reports tables

**Steps:**
1. Decide canonical table (recommend `reports` since the trust score queries it).
2. Migrate any rows from `moderationReports` that are not already in `reports`.
3. Update all moderation tooling to query `reports`.
4. Drop `moderationReports`.
5. If the two tables genuinely serve different purposes, rename them unambiguously (e.g. `user_reports` vs `admin_reports`) and document the distinction clearly in the schema file.

---

### Fix BUG-15 — `starBalance` integer overflow risk

**Steps:**
1. `ALTER TABLE users ALTER COLUMN star_balance TYPE bigint;`
2. Update Drizzle schema: `bigint('star_balance', { mode: 'number' })` or `bigint('star_balance')`.
3. Generate and apply migration.

---

### Fix BUG-16 — `moderationActions` duplicate columns

**Steps:**
1. Canonical columns: `moderatorId`, `actionType`, `reason`.
2. Migration: copy non-null values from `actionedBy` → `moderatorId`, `action` → `actionType`, `note` → `reason` where canonical is null.
3. Drop `actionedBy`, `action`, `note`.
4. Update schema and all query sites.

---

### Fix BUG-17 — `sponsoredQuests` dual reward coin columns

**Steps:**
1. Keep `rewardCoins`.
2. Migration: `UPDATE sponsored_quests SET reward_coins = reward_amount_coins WHERE reward_coins IS NULL AND reward_amount_coins IS NOT NULL`.
3. Drop `rewardAmountCoins`.
4. Update schema and all query sites.

---

### Fix BUG-18 — Redundant status update in guild wars CRON

**Files to change:**
- `apps/web/app/api/cron/guild-wars/route.ts`

**Steps:**
1. Delete the `UPDATE guild_wars SET status = 'completed' WHERE id = $1` query that runs after `resolveWar(war.id, db)`.
2. Add a comment near the `resolveWar` call noting that `resolveWar` sets `status = 'completed'` internally.

**Risk:** Zero. This is dead code removal.

---

### Fix BUG-19 — `compareNemesisProgress` no throw on unknown track

**Files to change:**
- `apps/web/lib/nemesis/nemesisEngine.ts`

**Steps:**
1. Import or inline the same `TRACK_COLUMN` map used in `safeAwardXP`.
2. Resolve `col = TRACK_COLUMN[track]`.
3. Add the allowlist guard: `if (!new Set(Object.values(TRACK_COLUMN)).has(col)) throw new Error(...)`.
4. Remove the `?? "xp_total"` fallback.

---

### Fix BUG-20 — `giftItems` coinPrice vs coinCost

**Steps:**
1. Keep `coinCost` (aligns with the "cost" naming convention for buyer-facing prices).
2. Migration: `UPDATE gift_items SET coin_cost = coin_price WHERE coin_cost IS NULL AND coin_price IS NOT NULL`.
3. Drop `coinPrice`.
4. Update schema and all query sites.

---

## Suggested Execution Batches

| Batch | Bugs | Description |
|-------|------|-------------|
| **Hotfix** | BUG-01, BUG-02 | Critical — ship immediately; no schema change needed for BUG-01, fast index for BUG-02 |
| **Auth & Security** | BUG-03, BUG-05, BUG-09, BUG-10 | Security hardening; all low-risk file-level changes |
| **Economy & XP** | BUG-04, BUG-07 | Economy correctness; verify with Paystack data before shipping BUG-07 |
| **Atomicity** | BUG-06, BUG-08 | Transactional correctness; BUG-08 needs Redis client plumbing |
| **Leaderboards** | BUG-11, BUG-19 | Correctness fixes; audit call sites |
| **Schema Cleanup** | BUG-12, BUG-13, BUG-14, BUG-15, BUG-16, BUG-17, BUG-18, BUG-20 | Single migration PR; lower risk but requires backup |

---

*Plan generated: 2026-06-15 at 12:00 PM*
*Analyst: Claude (claude-sonnet-4-6) — Zobia forensic bug fix plan*
*DO NOT implement until this plan has been reviewed and approved.*
