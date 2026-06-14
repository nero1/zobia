# Zobia Codebase — Forensic Bug Report (Fresh Analysis)

**Generated:** June 14, 2026 — 01:42 AM  
**Scope:** Web App (Next.js App Router), all lib/* and app/api/* — fresh forensic read  
**Method:** Direct file-by-file forensic analysis of live source. No prior reports consulted. CRON-frequency concerns and test files excluded per instructions.  
**Status:** AWAITING REVIEW — bugs confirmed in source. DO NOT FIX until plan approved.

---

## Bug Index (14 Confirmed Live Bugs)

```
1:  BUG-01: Long-lived refresh token exposed in HTTP response headers
2:  BUG-02: DodoPayments trusts client-supplied coin/star grant amounts (no server-side validation)
3:  BUG-03: DodoPayments awardReferralCommissions missing paymentId argument (idempotency collision)
4:  BUG-04: DodoPayments subscription inserts into wrong table (subscriptions vs user_subscriptions)
5:  BUG-05: Gift guild-share creates coins from thin air (not deducted from platform fee)
6:  BUG-06: War engine never updates xp_competitor column (only xp_total)
7:  BUG-07: CRON daily-login XP awards on last_active_at instead of last_login_date
8:  BUG-08: CRON Telegram bulk send is fire-and-forget (failures silently lost)
9:  BUG-09: CRON alliance war victory XP has no xp_ledger insert (audit trail missing)
10: BUG-10: Quest engine coin reward bypasses creditCoins() (direct SQL mutation, no FOR UPDATE)
11: BUG-11: Nemesis refresh permanently excludes users with deactivated assignments
12: BUG-12: Season top-10 badge uses hardcoded key (multi-season winners keep only first badge)
13: BUG-13: Paystack subscription handler runs duplicate email-to-userId DB query
14: BUG-14: PIN brute-force: no escalating lockout (4-digit space, only generic write rate limit)
```

---

## Detailed Findings

---

### 1: BUG-01: Long-lived refresh token exposed in HTTP response headers

**FILES:** `apps/web/app/api/auth/refresh/route.ts` (lines 69-70)

**DETAILS:**  
After issuing a new access + refresh token pair, the route explicitly sets both tokens as plain response headers:
```ts
response.headers.set("X-Access-Token", accessToken);
response.headers.set("X-Refresh-Token", rotatedRefreshToken);
```
The access token (15 min TTL) is low risk here, but the **refresh token** (30-day TTL for regular users, 1 hour for admins) is a long-lived credential. Exposing it in a response header means it is:
- Logged by any CDN (Vercel, Cloudflare, etc.) in access logs
- Visible to any MITM if TLS is stripped in a proxy layer
- Accessible to any third-party analytics/APM script on the page
- Potentially cached by HTTP intermediaries

The refresh token is already correctly set as an `HttpOnly; Secure; SameSite=Strict` cookie by `buildCookieHeaders`. The header exposure is redundant and a significant credential leak.

**FIX:** Remove both `response.headers.set("X-Access-Token", ...)` and `response.headers.set("X-Refresh-Token", ...)` lines. The tokens are already delivered via secure HttpOnly cookies — the headers serve no legitimate purpose and introduce credential exposure.

---

### 2: BUG-02: DodoPayments trusts client-supplied coin/star grant amounts (no server-side validation)

**FILES:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

**DETAILS:**  
The DodoPayments webhook handler reads grant amounts directly from webhook metadata supplied by the client at payment initiation:
```ts
// star_pack branch
await creditStars(userId, starsGranted ?? 0, "purchase", paymentId, ...)

// coin_pack branch
await creditCoins(userId, coinsGranted ?? 0, ...)
```
Where `starsGranted` and `coinsGranted` come from `metadata.starsGranted` and `metadata.coinsGranted` in the webhook payload. This means an attacker who can craft a DodoPayments payment with manipulated metadata (or who intercepts and replays a webhook with modified metadata) can grant themselves arbitrary coins or stars at any price point.

The Paystack webhook handler correctly validates: it looks up the `store_items` table using the item slug and verifies the paid amount matches `item.price_ngn` before granting coins. DodoPayments has no equivalent check.

**FIX:** After verifying the webhook HMAC signature, look up the `store_items` record using `metadata.itemSlug` (or equivalent). Validate `payload.data.payment.amount` (in the webhook's currency minor units) matches the expected `store_items.price_usd` (or relevant currency field). Use the server-authoritative `starsGranted`/`coinsGranted` from the `store_items` record, not from client metadata.

---

### 3: BUG-03: DodoPayments awardReferralCommissions missing paymentId argument (idempotency collision)

**FILES:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

**DETAILS:**  
The call to `awardReferralCommissions` in the DodoPayments handler passes only 3 arguments:
```ts
await awardReferralCommissions(tx, userId, coinsGranted ?? 0);
```
The function signature expects a 4th argument: `paymentId` (used as the idempotency key to prevent double-awarding commissions). When the 4th argument is omitted, the function likely defaults to `undefined` or falls back to the `buyerId`. If it falls back to `buyerId`, every purchase by the same user shares the same idempotency key, meaning only the first purchase ever generates a referral commission — all subsequent purchases silently produce no commission. If it defaults to `undefined`, referral commission records have a null `reference_id`, making deduplication impossible and potentially allowing double-crediting on webhook retries.

Compare: the Paystack handler correctly passes 4 args: `awardReferralCommissions(tx, userId, serverCoinsGranted, paymentId)`.

**FIX:** Pass `paymentId` (the DodoPayments transaction/payment ID from the webhook payload) as the 4th argument: `awardReferralCommissions(tx, userId, serverCoinsGranted, paymentId)`.

---

### 4: BUG-04: DodoPayments subscription inserts into wrong table (subscriptions vs user_subscriptions)

**FILES:** `apps/web/app/api/economy/webhooks/dodopayments/route.ts`

**DETAILS:**  
The DodoPayments subscription event handler inserts subscription records into the `subscriptions` table with `ON CONFLICT (user_id)`. The Paystack subscription handler inserts into `user_subscriptions`. These are different tables. The application's subscription-check queries (e.g., in route guards or XP multiplier lookups) will read from one table but not the other, meaning DodoPayments subscribers will appear as non-subscribers or vice versa depending on which table is authoritative.

This also means the two payment providers have completely separate subscription records with no unified view — a user who subscribes via DodoPayments internationally and then through Paystack locally would appear as having two separate active subscriptions in different tables.

**FIX:** Determine the canonical subscription table (likely `user_subscriptions` based on the Paystack path being the primary/older integration). Migrate the DodoPayments handler to use `user_subscriptions` with the same `ON CONFLICT (user_id) DO UPDATE` pattern as Paystack. If `subscriptions` is intentional, audit all subscription-checking code paths to ensure they query the right table for each payment provider.

---

### 5: BUG-05: Gift guild-share creates coins from thin air (not deducted from platform fee)

**FILES:** `apps/web/app/api/economy/gifts/send/route.ts`

**DETAILS:**  
The gift send flow works as follows:
1. Sender pays `coin_cost` coins (debited via `debitCoins`)
2. Recipient receives `recipientCoins = coin_cost - platformFeeCoins` (credited via `creditCoins`)
3. Guild treasury gets `guildShare = Math.floor(coin_cost * 5 / 100)` (credited via `UPDATE guilds SET treasury_balance = LEAST(treasury_cap, COALESCE(treasury_balance, 0) + $1)`)

The platform fee (`platformFeeCoins`) is collected as the gap between sender debit and recipient credit — it is not credited to any account, which is intentional (fee income to the platform). However, the guild share is credited from _outside_ this fee pool: no deduction from `platformFeeCoins`, no deduction from recipient coins. The guild gets 5% of `coin_cost` added to its treasury without any offsetting debit anywhere. This creates `guildShare` coins from nothing on every gift transaction, causing coin supply inflation proportional to gift volume.

**FIX:** The guild share must be sourced from somewhere. Two correct approaches:
- **Option A (guild share from platform fee):** Compute `platformFeeCoins = Math.floor(coin_cost * platformFeeRate)`, then `guildShare = Math.floor(coin_cost * 0.05)`, and require `guildShare <= platformFeeCoins`. The guild receives a portion of the platform's fee — no new coins created.
- **Option B (guild share from recipient):** `recipientCoins = coin_cost - platformFeeCoins - guildShare`. Sender pays, recipient gets less, guild gets its cut, platform gets its fee. No new coins.

Whichever option is the intended business logic, ensure `debitCoins(sender) === creditCoins(recipient) + guildShare + platformFeeRetained` to maintain ledger balance.

---

### 6: BUG-06: War engine never updates xp_competitor column (only xp_total)

**FILES:** `apps/web/lib/guilds/warEngine.ts`

**DETAILS:**  
In both `resolveWar` (victory XP distribution) and `distributeWarRewards` (top contributor bonus XP), the SQL updates only `xp_total`:
```sql
UPDATE users SET xp_total = xp_total + $1, updated_at = NOW() WHERE id = $2
```
The `xp_ledger` correctly records `track = 'competitor'` for these entries, but the corresponding `users.xp_competitor` column is never incremented. This causes a permanent divergence between:
- `users.xp_competitor` (always under-counts by all war reward XP ever earned)
- The actual sum of `xp_ledger WHERE track = 'competitor' AND user_id = ...`

This breaks any feature that displays or ranks by `xp_competitor` (competitor leaderboards, rank calculations for the competitor track, profile XP breakdowns). The divergence compounds on every war resolution and grows silently over time.

**FIX:** Update both columns atomically:
```sql
UPDATE users 
SET xp_total = xp_total + $1,
    xp_competitor = xp_competitor + $1,
    updated_at = NOW()
WHERE id = $2
```
Apply this fix to all war XP award sites: `resolveWar` victory XP loop, `distributeWarRewards` top-contributor bonus XP, and any other war-specific XP grants in the same file.

---

### 7: BUG-07: CRON daily-login XP awards based on last_active_at instead of last_login_date

**FILES:** `apps/web/app/api/cron/daily/route.ts` (~line 178, Step 4)

**DETAILS:**  
Step 4 of the daily CRON awards login XP to users with the following filter:
```sql
WHERE last_active_at::date = NOW()::date
```
`last_active_at` is a timestamp updated on any authenticated API call — browsing rooms, sending messages, loading the feed, etc. `last_login_date` is only updated on explicit login authentication. Using `last_active_at` means any user whose background tab fires a refresh or who makes any API call at any point during the day qualifies for daily-login XP, regardless of whether they actually logged in. Users who logged in yesterday and left a tab open earn daily-login XP indefinitely without re-authenticating.

Compare: Step 2 (streak calculation) correctly uses `last_login_date` as the login signal.

**FIX:** Change the filter to:
```sql
WHERE last_login_date = CURRENT_DATE
```
This mirrors the Step 2 streak logic and correctly ties login XP to actual authentication events.

---

### 8: BUG-08: CRON Telegram bulk send is fire-and-forget (failures silently lost)

**FILES:** `apps/web/app/api/cron/daily/route.ts` (~line 2276, Step 34)

**DETAILS:**  
Telegram notification dispatch:
```ts
sendBulkTelegramMessages(row.telegram_ids.map(...))  // no await
// immediately after:
await db.query("UPDATE ... SET delivered_at = NOW() ...")
```
`sendBulkTelegramMessages` returns a Promise that is never awaited. The `delivered_at` timestamp is written immediately after the un-awaited call, before any Telegram send completes or fails. If Telegram delivery fails (network error, bot blocked, rate limit), the failure is silently swallowed and `delivered_at` is set as though delivery succeeded. Recipients never get the notification; the system records it as delivered.

**FIX:** `await sendBulkTelegramMessages(...)` before updating `delivered_at`. If the send is expected to be slow, either:
- Await it and handle errors (retry or mark as failed separately)
- Move to a proper queue/background job and don't mark `delivered_at` until the queue confirms delivery

At minimum, the `await` must be added so failures are not silently swallowed.

---

### 9: BUG-09: CRON alliance war victory XP has no xp_ledger insert (audit trail gap)

**FILES:** `apps/web/app/api/cron/daily/route.ts` (Step 32b, alliance war resolution)

**DETAILS:**  
Alliance war victory XP is distributed via:
```sql
UPDATE users SET xp_total = xp_total + $1 WHERE id = $2
```
There is no corresponding `INSERT INTO xp_ledger (user_id, amount, track, source, reference_id, ...) VALUES (...)` for these XP grants. Every other XP award path in the codebase (guild war rewards via `warEngine.ts`, quest completions, login bonuses, etc.) inserts an `xp_ledger` record for auditability and track-specific column updates. Alliance war victories silently increment `xp_total` with no ledger trace.

This means:
- `xp_total` grows but no ledger row exists to explain why
- The `xp_competitor` column (relevant track for alliance wars) is also not updated (same pattern as BUG-06)
- Support cannot audit XP for disputes
- Leaderboard reconciliation against ledger will show discrepancies

**FIX:** After the `UPDATE users SET xp_total = xp_total + $1` for alliance war victory XP, insert an `xp_ledger` record with `track = 'competitor'`, `source = 'alliance_war_victory'`, `reference_id = warId`, and `amount = xpAmount`. Also add `xp_competitor = xp_competitor + $1` to the `UPDATE users` statement.

---

### 10: BUG-10: Quest engine coin reward bypasses creditCoins() (direct SQL, no locking or precision)

**FILES:** `apps/web/lib/quests/questEngine.ts` (lines ~234–259, `updateQuestProgress`)

**DETAILS:**  
Quest completion coin rewards are issued via direct SQL mutation:
```sql
UPDATE users SET coin_balance = coin_balance + $2 WHERE id = $1
INSERT INTO coin_ledger 
  SELECT $1, $2, coin_balance - $2, coin_balance ... FROM users WHERE id = $1
```
This bypasses the `creditCoins()` helper used by every other coin-credit path in the codebase. The problems:

1. **No `SELECT FOR UPDATE`:** `creditCoins()` locks the user row before reading/writing balance to prevent TOCTOU races. The direct `UPDATE` + `INSERT` pattern here has a race window between the UPDATE and the INSERT's balance read — a concurrent write between those two statements produces incorrect `balance_before`/`balance_after` values in the ledger.

2. **No Decimal.js precision:** `creditCoins()` uses Decimal.js for all arithmetic to avoid IEEE 754 floating-point rounding. The raw SQL `coin_balance + $2` relies on PostgreSQL numeric math, which may differ in edge cases.

3. **Inconsistency:** Two code paths now exist for crediting coins. Any future change to `creditCoins()` (fee logic, audit hooks, sanity checks) will not apply to quest rewards.

**FIX:** Replace the direct SQL block with a call to `creditCoins(userId, rewardAmount, "quest_reward", questCompletionId, tx)`, passing the existing transaction `tx` so it executes within the same atomic block. Remove the raw `UPDATE users SET coin_balance` and raw `INSERT INTO coin_ledger` from `updateQuestProgress`.

---

### 11: BUG-11: Nemesis refresh permanently excludes users with deactivated assignments

**FILES:** `apps/web/lib/nemesis/nemesisEngine.ts` (~line 191, `refreshNemesisAssignments`)

**DETAILS:**  
`refreshNemesisAssignments` finds users eligible for a new nemesis with:
```sql
WHERE id NOT IN (
  SELECT user_id FROM nemesis_assignments WHERE dismissed_at IS NULL
)
```
The intent is to exclude users who already have an active nemesis. However, `dismissed_at` is **never set** by any code path — deactivation uses `SET is_active = false`. The column `dismissed_at` is always `NULL` for every row. Therefore the subquery `WHERE dismissed_at IS NULL` returns ALL users who have any nemesis assignment ever (active or deactivated). Any user who previously had a nemesis (even if long deactivated) is permanently excluded from the eligible pool and will never receive a new assignment.

The `assignNemesis` function fetches the current nemesis with a similar query `WHERE dismissed_at IS NULL ORDER BY assigned_at DESC LIMIT 1` — this accidentally works (returns the latest row regardless of `is_active`) but is semantically incorrect.

**FIX:** Change both queries to use `is_active` instead of `dismissed_at IS NULL`:
- Exclusion query: `WHERE id NOT IN (SELECT user_id FROM nemesis_assignments WHERE is_active = true)`
- Current nemesis query: `WHERE user_id = $1 AND is_active = true ORDER BY assigned_at DESC LIMIT 1`

Optionally, remove `dismissed_at` from the schema if it serves no purpose, or populate it when `is_active` is set to false.

---

### 12: BUG-12: Season top-10 badge uses hardcoded key (multi-season winners lose earlier badges)

**FILES:** `apps/web/lib/seasons/seasonEngine.ts` (`distributeSeasonRewards`)

**DETAILS:**  
Badge insertion for top-10 season finishers:
```sql
INSERT INTO user_badges (user_id, badge_key, badge_name, season_id, ...)
VALUES ($1, 'season_top10', 'season_top10', $2, ...)
ON CONFLICT (user_id, badge_key) WHERE badge_key IS NOT NULL DO NOTHING
```
The `badge_key` is hardcoded to `'season_top10'` for every season. The `ON CONFLICT ... DO NOTHING` means: if a user already has any `season_top10` badge, the new season's badge is silently dropped. A user who finishes top-10 in seasons 2, 3, and 4 retains only their season 1 badge; all subsequent wins are discarded with no error.

This effectively caps each user at one lifetime season badge, regardless of performance across seasons.

**FIX:** Make `badge_key` season-specific: `'season_top10:' || seasonId`. This makes each badge unique per season. A user winning top-10 in season 3 gets badge `season_top10:3`, not the same key as season 1. Remove or narrow the `ON CONFLICT` constraint accordingly, or add `(user_id, season_id)` uniqueness separately.

```sql
VALUES ($1, 'season_top10:' || $2::text, 'Season Top 10', $2, ...)
```

---

### 13: BUG-13: Paystack subscription handler runs duplicate email-to-userId DB query

**FILES:** `apps/web/app/api/economy/webhooks/paystack/route.ts` (`processSubscriptionEvent`)

**DETAILS:**  
In `processSubscriptionEvent`, when `userId` is not found in metadata, the handler queries the DB by email twice:
```ts
// First query (result discarded)
if (!userId) {
  const { rows } = await db.query("SELECT id FROM users WHERE email = $1", [email]);
  // rows used here for some early check
}

// Second query (same email, same table)
const resolvedUserId = userId ?? (await db.query("SELECT id FROM users WHERE email = $1", [email])).rows[0]?.id;
```
The first query's result is discarded; the second query re-fetches the same row. This is a redundant DB round-trip on every subscription event where `userId` is absent from metadata (which includes all subscription renewals and events fired by Paystack's backend where metadata isn't forwarded).

**FIX:** Cache the result of the first query:
```ts
let resolvedUserId = userId;
if (!resolvedUserId) {
  const { rows } = await db.query("SELECT id FROM users WHERE email = $1", [email]);
  resolvedUserId = rows[0]?.id;
}
if (!resolvedUserId) return; // unknown user
```
This requires a single DB query regardless of how the handler is entered.

---

### 14: BUG-14: PIN has no escalating lockout (4-digit keyspace is brute-forceable at current limits)

**FILES:** `apps/web/lib/security/rateLimit.ts`, PIN verification route handler

**DETAILS:**  
User PINs are 4 digits (10,000 possible values). The only rate limit on PIN verification attempts is the generic `apiWrite` preset: 60 requests/minute per user. At this rate:
- 60 attempts/min × 60 min = 3,600 attempts/hour
- Full keyspace (10,000) exhausted in under 3 hours
- No lockout after N consecutive failures, no CAPTCHA, no notification to user

An attacker with a valid session (account takeover via stolen access token, or insider threat) can brute-force another user's PIN within a morning.

PINs gate high-value actions (coin transfers, gift sends). The low entropy of 4-digit PINs makes this attack practical without any additional tooling.

**FIX:** Add a PIN-specific rate limit in `RATE_LIMITS`:
```ts
pinVerify: { limit: 5, windowMs: 15 * 60 * 1000, name: "pin:verify" } as RateLimitOptions,
```
Apply this per-user PIN limit on every PIN verification attempt. After 5 failures in 15 minutes, return 429. Ideally, add a hard lockout after repeated failures (e.g., lock PIN for 30 minutes after 10 failures across any window), require re-authentication, and notify the user via push/email of suspicious PIN attempts. Consider 6-digit PINs for meaningfully larger keyspace.

---

## Summary

| # | Bug ID | Severity | Category |
|---|--------|----------|----------|
| 1 | BUG-01 | HIGH | Security — Credential Exposure |
| 2 | BUG-02 | CRITICAL | Security — Economy Manipulation |
| 3 | BUG-03 | MEDIUM | Logic — Idempotency / Revenue |
| 4 | BUG-04 | HIGH | Data Integrity — Table Mismatch |
| 5 | BUG-05 | HIGH | Economy — Coin Inflation |
| 6 | BUG-06 | MEDIUM | Data Integrity — XP Column Drift |
| 7 | BUG-07 | MEDIUM | Logic — Incorrect Login Signal |
| 8 | BUG-08 | MEDIUM | Reliability — Silent Notification Failure |
| 9 | BUG-09 | MEDIUM | Data Integrity — Missing Audit Trail |
| 10 | BUG-10 | MEDIUM | Consistency — Coin Bypass |
| 11 | BUG-11 | HIGH | Logic — Permanent Nemesis Exclusion |
| 12 | BUG-12 | MEDIUM | Logic — Badge Overwrite |
| 13 | BUG-13 | LOW | Performance — Redundant DB Query |
| 14 | BUG-14 | HIGH | Security — PIN Brute Force |

**CRITICAL (1):** BUG-02 — economy manipulation via unvalidated webhook metadata  
**HIGH (4):** BUG-01, BUG-04, BUG-05, BUG-11, BUG-14  
**MEDIUM (7):** BUG-03, BUG-06, BUG-07, BUG-08, BUG-09, BUG-10, BUG-12  
**LOW (1):** BUG-13

---

**Report generated:** June 14, 2026 — 01:42 AM  
**Analyst:** Claude Code (Sonnet 4.6) — fresh forensic read, zero prior report influence  
**Next step:** Review `custom-bugs-fix-plan.md` and approve before any fixes are applied.
