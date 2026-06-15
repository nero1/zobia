# Zobia Social — Bug Fix Plan

**Generated:** June 15, 2026 at 06:00 AM  
**Source:** custom-bugs-report.md (24 confirmed bugs)  
**Branch:** `claude/codebase-bug-analysis-z1fnxx`

> **IMPORTANT: DO NOT BEGIN ANY FIX UNTIL THIS PLAN HAS BEEN REVIEWED AND APPROVED.**

---

## Fix Priority Groups

Bugs are grouped by urgency. Each group should be completed and deployed (or at minimum staged) before moving to the next.

---

### GROUP 1 — CRITICAL (Production Breaking / Security)

These bugs either completely break core user flows or represent exploitable security vulnerabilities. Fix first.

---

#### Fix 1.1 — SCHEMA-STORE-01: Add missing store_items columns
**Bug:** #9  
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/app/api/economy/coins/purchase/route.ts`  
**Plan:**
- Add `coins_granted integer NOT NULL DEFAULT 0` and `currency varchar(3) NOT NULL DEFAULT 'NGN'` columns to the `storeItems` Drizzle schema definition.
- Generate and run a database migration.
- Populate existing rows with correct values.
- Update the coin purchase route query to use these column names (no other changes needed if names match).

---

#### Fix 1.2 — XP-MSG-01: Fix message XP reference_id to use messageId
**Bug:** #5  
**Files:** `apps/web/app/api/rooms/[roomId]/messages/route.ts`  
**Plan:**
- After inserting the message into `room_messages`, capture the returned `id` (message UUID).
- Pass that `messageId` (or `msg_${messageId}`) as the `referenceId` argument to `maybeAwardMessageXP()`.
- Update `maybeAwardMessageXP()` signature to accept and forward this `referenceId`.
- Verify the daily cap logic still works correctly (cap check should happen before the XP insert, not be confused by the unique constraint).

---

#### Fix 1.3 — SSRF-DNS-01: Implement actual IP pinning in safeFetch
**Bug:** #1  
**Files:** `apps/web/lib/security/ssrf.ts`  
**Plan:**
- In `validateOutboundUrl()`, retain the `pinnedIp` returned by `resolveAndValidateHostname()`.
- Build `fetchUrl` by replacing `parsed.hostname` in the URL string with `pinnedIp` (preserve path, query, fragment).
- In `safeFetch()`, add `Host: originalHostname` to the outbound headers so TLS SNI/virtual hosting still resolves correctly.
- Update the `ValidatedUrl` interface: `fetchUrl` will now contain the IP-pinned URL.
- Re-test that the allowlist check still uses `parsed.hostname` (not the IP).

---

#### Fix 1.4 — IAP-ANNUAL-01: Add annual subscription productIds to IAP verify
**Bug:** #10  
**Files:** `apps/web/app/api/economy/iap/verify/route.ts`  
**Plan:**
- Add `sub_plus_annual`, `sub_pro_annual`, `sub_max_annual` to the `verifyIapSchema` Zod enum.
- Add corresponding entries to the `SUBSCRIPTION_PRODUCTS` server-side map, mapping each annual ID to the correct plan tier (plus/pro/max).
- Verify the Google Play API subscription verification path handles annual subscriptions correctly (they may have different `purchaseType` values in the Google receipt).

---

#### Fix 1.5 — SCHEMA-BADGE-01: Add user_badges unique constraint and awarded_at column
**Bug:** #7  
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/app/api/cron/daily/route.ts`  
**Plan:**
- Add `awarded_at timestamptz NOT NULL DEFAULT NOW()` column to the `userBadges` Drizzle schema.
- Add a unique index on `(user_id, badge_key)` to `userBadges`.
- Generate and run a migration (the unique index may need a `CREATE UNIQUE INDEX CONCURRENTLY` for production with existing data).
- No changes needed in the CRON step — it will work correctly once the constraint exists.

---

#### Fix 1.6 — SCHEMA-ROOM-01: Add rooms.status and rooms.drop_ends_at columns
**Bug:** #8  
**Files:** `apps/web/lib/db/schema.ts`, `apps/web/app/api/cron/daily/route.ts`  
**Plan:**
- Add `status varchar(20)` (or a pgEnum with values `'active'`, `'closed'`, `'ended'`) to the `rooms` Drizzle schema.
- Add `drop_ends_at timestamptz` to the `rooms` Drizzle schema.
- Generate and run a migration. Set a default value for existing rows (e.g., `status = 'active'`).
- No changes needed in the CRON step — it will work once the columns exist.

---

#### Fix 1.7 — SCHEMA-UXT-01: Rewrite CRON step 27 to use users table columns
**Bug:** #6  
**Files:** `apps/web/app/api/cron/daily/route.ts`  
**Plan:**
- Locate CRON step 27 (earnable sticker packs).
- Rewrite the query to JOIN `users` directly and read `u.xp_social`, `u.xp_creator`, `u.xp_knowledge`, etc. (whichever tracks gate sticker pack eligibility).
- Remove all references to `user_xp_tracks`.

---

### GROUP 2 — HIGH (Financial Integrity / Data Corruption)

These bugs cause silent financial misreporting or data corruption. Fix before next payout cycle.

---

#### Fix 2.1 — PAYOUT-WEEKLY-01: Correctly compute net_kobo and platform_fee_kobo
**Bug:** #19  
**Files:** `apps/web/app/api/cron/daily/route.ts` (step 32), `apps/web/lib/payments/payouts.ts`  
**Plan:**
- Define a `PLATFORM_FEE_RATE` constant (e.g., 0.10 for 10%).
- Before the payout INSERT, compute:
  - `gross_kobo = candidate.balance_kobo`
  - `platform_fee_kobo = Math.round(gross_kobo * PLATFORM_FEE_RATE)`
  - `net_kobo = gross_kobo - platform_fee_kobo`
- Use `net_kobo` as the transfer amount in the payment gateway call.
- Insert all three values correctly into the `payouts` table.

---

#### Fix 2.2 — PAYOUT-NC-01: Fix retry path to use net_kobo
**Bug:** #4  
**Files:** `apps/web/lib/payments/payouts.ts`  
**Plan:**
- In the payout failure retry path, replace `gross_kobo` with `net_kobo` as the transfer amount.
- Verify the `payouts` table schema stores `net_kobo`; if missing, add it (related to Fix 2.1 above — do these together).

---

#### Fix 2.3 — WEBHOOK-PAY-01: Paystack webhook fail-safe on Redis error
**Bug:** #2  
**Files:** `apps/web/app/api/economy/webhooks/paystack/route.ts`  
**Plan:**
- Remove the `.catch(() => null)` on the Redis idempotency SET.
- If Redis SET throws, return HTTP 500 so Paystack retries the webhook.
- Move the idempotency key write to after the DB transaction succeeds (two-phase approach), OR use a single-phase approach where you check for idempotency BEFORE processing and write the key only after a successful DB commit within the same try block.
- Add a `logger.error` with a system alert for Redis failures so they are visible.

---

#### Fix 2.4 — WEBHOOK-DODO-01: DodoPayments webhook Redis fix + server-authoritative coin grant
**Bug:** #3  
**Files:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`  
**Plan:**
- Apply the same Redis fix as Fix 2.3 above.
- After HMAC signature verification, look up the product by `productId` in the server-side catalogue (DB `store_items.coins_granted` once Fix 1.1 is applied, or a hardcoded server config map).
- Use the server-authoritative `coins_granted` value — never the payload's `coins_granted`.

---

#### Fix 2.5 — CRON-WAR-TX-01: Replace raw war XP SQL with safeAwardXP()
**Bug:** #23  
**Files:** `apps/web/app/api/cron/daily/route.ts` (step 32b)  
**Plan:**
- Replace the raw `INSERT INTO xp_ledger` + `UPDATE users` SQL in the alliance war step with calls to `safeAwardXP()`.
- Pass a deterministic `referenceId` (e.g., `war_${warId}_participant_${userId}`) to ensure idempotency.
- `safeAwardXP()`'s CTE pattern already handles atomicity.

---

### GROUP 3 — MEDIUM (Correctness / Logic Bugs)

These bugs cause incorrect behavior but are not immediate financial or security issues.

---

#### Fix 3.1 — REFERRAL-RACE-01 + REFERRAL-XP-01: Atomic referral streak with idempotency
**Bugs:** #20, #21  
**Files:** `apps/web/app/api/cron/daily/route.ts` (step 33)  
**Plan:**
- Add `FOR UPDATE SKIP LOCKED` to the referral row SELECT query.
- Generate a deterministic `referenceId` for the XP award: `referral_streak_${referralId}_${today}` where `today` is the CRON run date string.
- Pass this `referenceId` to `safeAwardXP()`.
- Consider wrapping the entire step in a distributed Redis lock for belt-and-suspenders protection against concurrent CRON runs.

---

#### Fix 3.2 — COIN-PROV-01: Honour user-supplied paymentProvider
**Bug:** #18  
**Files:** `apps/web/app/api/economy/coins/purchase/route.ts`  
**Plan:**
- After reading `paymentProvider` from the validated request body, check if it's a valid, configured provider.
- If valid, use it for the `initializePayment()` call.
- Fall back to `manifest.payment.primaryProvider` only if not supplied or not configured.
- Add a validation step that returns 400 if the requested provider is not active.

---

#### Fix 3.3 — WAR-LIMIT-01: Move opponent exclusions into SQL query
**Bug:** #12  
**Files:** `apps/web/lib/guilds/warEngine.ts`  
**Plan:**
- Move all JS-side filter conditions (exclude current guild, exclude guilds already in active wars) into the SQL WHERE clause.
- Replace the `LIMIT 20` on pre-filtered candidates with a `LIMIT 5` on post-filtered eligible opponents.
- Remove the JS `.filter()` step.

---

#### Fix 3.4 — SUB-PLAN-01: Remove silent fallback in plan code mapping
**Bug:** #16  
**Files:** `apps/web/lib/payments/paystack.ts`  
**Plan:**
- Remove the `default: "pro"` fallback from the plan code to tier mapping.
- Return `null` or throw for unrecognized plan codes.
- In the webhook handler: if plan code is unrecognized, log a system alert, return HTTP 200 to Paystack (to prevent retries), and do NOT activate any subscription tier.

---

#### Fix 3.5 — DM-DEDUP-01: Fix duplicate check for DM messages
**Bug:** #14  
**Files:** `apps/web/lib/messaging/antispam.ts`  
**Plan:**
- Add a `messageContext: 'room' | 'dm'` parameter to `detectDuplicateMessage()`.
- When `messageContext === 'dm'`, query `direct_messages` table instead of `room_messages`.
- Update all callers to pass the correct context.

---

#### Fix 3.6 — CRON-LOGIN-01: Canonicalize login date to single column
**Bug:** #13  
**Files:** `apps/web/app/api/cron/daily/route.ts`, `apps/web/lib/db/schema.ts`  
**Plan:**
- Decide on canonical column: recommend `last_login_at` (timestamptz) as the single source.
- Derive the date for streak comparison: `DATE(last_login_at AT TIME ZONE 'UTC')`.
- Update the CRON streak step to use this derived date instead of `last_login_date`.
- If `last_login_date` column is no longer needed anywhere else, drop it in a later migration (or keep for performance if indexed).

---

#### Fix 3.7 — QUEST-SRC-01: Align quest pre-check source string with insert source
**Bug:** #11  
**Files:** `apps/web/lib/quests/questEngine.ts`  
**Plan:**
- Audit the `source` string used in the xp_ledger pre-check query vs. the string passed to `safeAwardXP()` on quest completion.
- Extract both as a named constant (e.g., `QUEST_XP_SOURCE = 'quest_completion'`) and use it in both places.
- Verify that the `referenceId` used in the pre-check matches the one used in the actual insert (should be `questId` or `${questId}_${userId}`).

---

### GROUP 4 — LOW (Security Hardening / Robustness)

These bugs are lower urgency but should be fixed before the next public launch or security audit.

---

#### Fix 4.1 — RL-GLOBAL-01: Atomic global rate limiter
**Bug:** #17  
**Files:** `apps/web/lib/security/rateLimit.ts`  
**Plan:**
- Replace the `INCR` + `EXPIRE` two-command sequence with a Lua script that atomically increments and conditionally sets TTL on first creation.
- Example Lua: `local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n`.
- This matches the existing pattern used for the per-user sliding window (which is already atomic).

---

#### Fix 4.2 — JWT-KID-01: Implement JWT key ID registry for rotation
**Bug:** #22  
**Files:** `apps/web/lib/auth/jwt.ts`  
**Plan:**
- Create a key registry: an object (or DB table for dynamic rotation) mapping `kid` → `secret`.
- In `verifyAccessToken()`, decode the JWT header first (without verification) to extract `kid`.
- Look up the corresponding secret from the registry.
- Verify the token against that specific secret.
- Add `JWT_SECRET_v1`, `JWT_SECRET_v2`, etc. env vars (or a structured registry) to support N-1 key during rotation window.
- The max rotation window needed is 15 minutes (access token TTL).
- Document the rotation procedure clearly.

---

#### Fix 4.3 — EXPO-TOKEN-01: Validate restored token on Expo launch
**Bug:** #15  
**Files:** `apps/expo/lib/auth/context.tsx`  
**Plan:**
- After reading token from SecureStore, decode the JWT client-side (without verifying signature — just the payload).
- Check `exp` claim: if expired or expiring within 60 seconds, call the silent refresh endpoint before setting authenticated state.
- If refresh fails (network error or 401), clear SecureStore and set unauthenticated state.
- This eliminates the stale-auth window on app launch.

---

#### Fix 4.4 — DEAD-CODE-01: Remove unreachable throw in 2FA verify
**Bug:** #24  
**Files:** `apps/web/app/api/auth/2fa/verify/route.ts`  
**Plan:**
- Remove the unreachable `throw badRequest("preAuthToken is required", "MISSING_TOKEN")` statement.
- If the intent was to guard against missing token: add the guard as the first check in the handler before the pre-auth block.
- Add a brief comment marking the end of the pre-auth flow if control flow is non-obvious.

---

## Execution Notes

1. **Migrations first:** GROUP 1 fixes 1.1, 1.5, 1.6 all require DB migrations. Run and verify in staging before deploying API code changes that depend on new columns.

2. **Schema + code together:** Fixes that add columns (1.1, 1.5, 1.6) should be deployed with the corresponding API code changes in the same deployment (or schema migrated first, then code). Deploying code before the schema will cause runtime errors.

3. **Fix 2.1 + 2.2 together:** The payout net/gross split fix and the retry-path fix must be deployed together. Fixing only one leaves the system in a partially-correct state.

4. **Fix 2.3 + 2.4 together:** Both webhook handlers have the same Redis pattern. Fix them in the same PR to avoid inconsistent resilience posture.

5. **No fixes yet:** Review this plan in full before implementing any changes.

---

*Plan generated: June 15, 2026 at 06:00 AM*  
*Branch: `claude/codebase-bug-analysis-z1fnxx`*
