# Zobia Social — Custom Bug & Code Quality Report

**Generated:** 2026-06-12 at 11:21 PM UTC (Friday)
**Analyst:** Claude Code (forensic deep-dive, independent — no reliance on prior bug reports)
**Scope:** `apps/web` (Next.js API + PWA), `apps/expo` (Android), `shared`, DB schema (`db/migrations/001_complete_schema.sql`)
**Method:** Manual, line-by-line review of economy, auth, security, payments, cron, guild/season engines, webhooks, middleware, and representative client code. Schema cross-checked against query column names. CRON frequency and test files intentionally excluded per instructions.

---

## How to read this report

Findings are listed once as a numbered summary, then expanded individually with affected files and recommended fixes. Severities: **CRITICAL** (money loss / account takeover / core feature broken), **HIGH** (security weakness or silently broken feature), **MEDIUM** (incorrect behaviour, degraded feature), **LOW** (smell / robustness / maintainability).

---

## Summary list

1. **CRITICAL — ZB-01:** OAuth `redirect` param is unvalidated → access + refresh tokens exfiltrated to attacker URL (account takeover).
2. **CRITICAL — ZB-02:** Referral commission ledger reference collides (tier1 & tier2 share `reference_id=buyerId`) → unique-index violation rolls back the whole charge webhook → buyer never gets coins; every repeat purchase fails.
3. **CRITICAL — ZB-03:** Guild-war coin rewards never distributed — all winners share `('war_reward', warId)` violating the unique ledger index on the 2nd member.
4. **CRITICAL — ZB-04:** Season-end coin rewards never distributed — same `('season_reward', seasonId)` collision across top-10 users.
5. **CRITICAL — ZB-05:** Monthly plan bonus & 90-day comeback bonus `coin_ledger` inserts omit `NOT NULL` `balance_before`/`balance_after` → always fail → both features silently broken.
6. **CRITICAL — ZB-06:** `claimPassMilestone` applies the reward even when the claim row already existed (`ON CONFLICT DO NOTHING` not checked) → repeatable coin/XP farming.
7. **HIGH — ZB-07:** `resolveWar` runs `SELECT … FOR UPDATE` outside any transaction and checks status in a different transaction from the reward writes → concurrent calls double-resolve / double-pay.
8. **HIGH — ZB-08:** Google login links accounts by email without checking `email_verified` → account takeover via unverified Google email.
9. **HIGH — ZB-09:** Password reset completion does not invalidate existing sessions.
10. **HIGH — ZB-10:** Creator Fund metrics query has a cartesian fan-out (`xp_ledger` joined twice) → `xp_earned_30d` is inflated by a factor of the ledger row count → grossly unfair fund distribution.
11. **HIGH — ZB-11:** Payment status compared against `'success'` but the schema only allows `'completed'` → trust-score payment signal always 0, cron skips real payers, admin revenue under-reports.
12. **HIGH — ZB-12:** `sanitizeHtml` is regex-based with an unused allow-list → trivially bypassable stored XSS (`<svg onload>`, `<iframe>`, entity-encoded `javascript:`).
13. **HIGH — ZB-13:** `safeFetch` follows redirects with unbounded recursion (no max-hops) and never enforces `maxResponseBytes` → SSRF redirect loop / memory DoS.
14. **MEDIUM — ZB-14:** Weekly season snapshot cron queries `seasons.started_at`, which does not exist (column is `starts_at`) → the whole step throws every Sunday.
15. **MEDIUM — ZB-15:** Re-engagement guild-war context query references non-existent `guild_wars.result`, `.guild_id`, `.ended_at` → always silently fails.
16. **MEDIUM — ZB-16:** Re-engagement season context queries `seasons.phase`, which does not exist → silently fails.
17. **MEDIUM — ZB-17:** Ad-revenue MAU auto-enrolment queries `rooms.room_type`, but the column is `type` → silently fails (no room ever auto-enrolled).
18. **MEDIUM — ZB-18:** `idempotencyKey` is optional on gift-send and coin-transfer → double-tap double-spend when the client omits it.
19. **MEDIUM — ZB-19:** Refresh-token rotation reuse-detection logs the user out of all devices when a refresh response is lost (common on flaky mobile networks).
20. **MEDIUM — ZB-20:** `INSUFFICIENT_BALANCE` / `INSUFFICIENT_STAR_BALANCE` thrown by the economy layer are returned as HTTP 500 anywhere callers don't special-case them (`errors.ts` doesn't map the code).
21. **MEDIUM — ZB-21:** Trust score is never computed for ordinary users → trust-gated actions (send gift, create guild, etc.) are permanently blocked for legitimate accounts.
22. **MEDIUM — ZB-22:** `claimPassMilestone` coin reward bypasses `coin_ledger` entirely (direct `coin_balance` update, no row lock) → balance/ledger drift.
23. **MEDIUM — ZB-23:** Creator Fund Day-5 distribution has no idempotency guard → a double cron run double-credits creators.
24. **LOW — ZB-24:** Telegram login hash comparison is a plain `!==` (not constant-time) despite the comment claiming otherwise.
25. **LOW — ZB-25:** `decryptField` calls `decipher.update(encrypted)` without an output encoding → possible multibyte corruption across the update/final boundary.
26. **LOW — ZB-26:** `notifications` table is written with two incompatible shapes (`payload` vs `title/body/metadata`) → UI must guess which is present.
27. **LOW — ZB-27:** XP is recorded in two parallel tables (`xp_events` and `xp_ledger`) inconsistently → any reconciliation summing one table is wrong.
28. **LOW — ZB-28:** `middleware.ts` imports `SignJWT` unused; CSP mixes `'strict-dynamic'` with `'unsafe-inline'` + host allow-list (the latter two are ignored by modern browsers).
29. **LOW — ZB-29:** `transferCoins` computes fee/net before validating the amount is a positive integer (cosmetic ordering).
30. **LOW — ZB-30:** DM daily-limit check and increment are separate (TOCTOU); the TTL is only set when the counter is first created, so a Redis blip can leave a key without expiry.
31. **LOW — ZB-31:** Ledger reads `ORDER BY created_at DESC` only → non-deterministic ordering for entries written in the same transaction/timestamp.
32. **LOW — ZB-32:** Paystack `transfer.failed` webhook passes the un-incremented `retry_count` into `moveToDeadLetterQueue`, mislabelling the recorded retry count.

---

## Detailed findings

### 1: ZB-01 — Unvalidated OAuth redirect leaks auth tokens (account takeover)
**FILES:** `apps/web/app/api/auth/google/route.ts`, `apps/web/app/api/auth/google/callback/route.ts`
**Severity:** CRITICAL
The initiation route stores the raw `redirect` query param into the `zobia_mobile_redirect` cookie with no validation. The callback then does `new URL(mobileRedirect)` and appends `token`, `refresh_token` and the user payload as query parameters before redirecting the browser there. An attacker who sends a victim a link such as `/api/auth/google?redirect=https://evil.com` receives the victim's **access and refresh tokens** after the victim completes a normal Google login (CSRF state still validates because it is the victim's own browser). **FIX:** Validate the redirect target against a strict allow-list — only permit the app's custom scheme(s) (e.g. `zobia://`, `exp://` for dev) and/or a small set of exact first-party hosts. Reject anything else before setting the cookie *and* again in the callback before redirecting. Prefer delivering tokens to the mobile app via a one-time, server-stored exchange code rather than embedding them in a URL.

### 2: ZB-02 — Referral commission reference collision breaks coin purchases
**FILES:** `apps/web/lib/referrals/commissions.ts`, `apps/web/app/api/economy/webhooks/paystack/route.ts`, schema `coin_ledger` unique index `uidx_coin_ledger_type_ref`
**Severity:** CRITICAL
Both the tier-1 and tier-2 commission credits call `creditCoins(..., "referral_commission", buyerId, ...)`, i.e. identical `(transaction_type, reference_id)`. The partial unique index `(transaction_type, reference_id) WHERE reference_id IS NOT NULL` makes the second insert throw. Because `awardReferralCommissions` runs inside the webhook's `db.transaction`, the violation aborts the whole transaction (the `.catch` swallows the JS error but Postgres has already marked the tx failed), so the payment-completed update, coin credit and creator-fund seed all roll back. The webhook then 500s and Paystack retries forever. This triggers on the **first** purchase of any 2-level referee and on **every repeat** purchase of any referred user. **FIX:** Make each commission reference unique per purchase and per tier, e.g. `reference_id = `referral:${paymentId}:t1`` / `:t2``. Use the payment id (already available as `paymentId`) so retries remain idempotent. Add a regression test for repeat purchases and 2-level chains.

### 3: ZB-03 — Guild-war coin rewards never paid (ledger collision)
**FILES:** `apps/web/lib/guilds/warEngine.ts` (`distributeWarRewards`)
**Severity:** CRITICAL
The loop inserts `('war_reward', warId)` into `coin_ledger` for every winning member. The unique index rejects the second member, aborting the transaction, so **no member is paid** and the gift-retirement/stat updates roll back. **FIX:** Make the reference unique per recipient, e.g. `reference_id = `war:${warId}:${userId}``, or route the credit through `creditCoins(..., tx)` with a per-user reference. Apply the same pattern everywhere multiple users are credited under one event id.

### 4: ZB-04 — Season-end coin rewards never paid (ledger collision)
**FILES:** `apps/web/lib/seasons/seasonEngine.ts` (`distributeSeasonRewards`)
**Severity:** CRITICAL
Identical root cause to ZB-03: every top-10 winner is inserted as `('season_reward', seasonId)`; the 2nd insert violates the unique index and rolls back the whole distribution (and the season gift retirement). **FIX:** Use `reference_id = `season:${seasonId}:${userId}`` (or per-rank) and prefer `creditCoins`.

### 5: ZB-05 — Monthly plan bonus & comeback bonus inserts violate NOT NULL
**FILES:** `apps/web/app/api/cron/daily/route.ts` (lines ~824–831 comeback grant, ~1278–1290 monthly plan bonus, ~1343–1349 comeback expiry), schema `coin_ledger`
**Severity:** CRITICAL
`coin_ledger.balance_before` and `balance_after` are `BIGINT NOT NULL` with no default, but these three inserts omit them. Every execution throws a NOT NULL violation: the monthly paid-plan coin bonus (Plus/Pro/Max) is **never credited**, and the 90-day comeback bonus grant/expiry are silently broken (their try/catch hides it). **FIX:** Compute and pass `balance_before`/`balance_after` (lock the user row first), or — better — route all of these through `creditCoins`/`debitCoins`, which already handle the ledger correctly and atomically. After the fix, verify the unique-reference rule (ZB-02/03/04) since these run for many users.

### 6: ZB-06 — Repeatable season-pass milestone reward claim
**FILES:** `apps/web/lib/seasons/seasonEngine.ts` (`claimPassMilestone`)
**Severity:** CRITICAL
The claim `INSERT … ON CONFLICT (user_id, milestone_id) DO NOTHING` is not checked for an actual insert; the reward (coins / XP / badge) is then applied unconditionally. A user can call the endpoint repeatedly (or concurrently double-submit) and receive the coin/XP reward each time. **FIX:** Use `RETURNING` (or check `rowCount`) and only apply the reward when a row was actually inserted; wrap the read-eligibility, insert, and reward in one transaction with `SELECT … FOR UPDATE` on the pass row.

### 7: ZB-07 — War resolution is not concurrency-safe (double payout)
**FILES:** `apps/web/lib/guilds/warEngine.ts` (`resolveWar`)
**Severity:** HIGH
`SELECT * FROM guild_wars … FOR UPDATE` is issued via `db.query` (auto-commit), so the row lock is released immediately and provides no protection. The "already resolved" guard and the reward-writing transaction are separate, so two overlapping invocations (cron + manual, or retried cron) can both pass the guard and both award XP/coins/guild-XP. **FIX:** Move the `SELECT … FOR UPDATE` and the status check **inside** the same `db.transaction` that performs the updates, and re-check `status` after acquiring the lock; bail if already `completed`/`cancelled`.

### 8: ZB-08 — Google account linking ignores email_verified
**FILES:** `apps/web/lib/auth/google.ts`, `apps/web/app/api/auth/google/callback/route.ts` (`upsertGoogleUser`)
**Severity:** HIGH
`fetchGoogleUserProfile` returns `emailVerified`, but `upsertGoogleUser` links a Google identity to a pre-existing email account without checking it. Combined with any path that creates accounts by email, this is a classic account-linking takeover vector. **FIX:** Reject (or route to a manual verification flow) when `email_verified !== true` before linking a Google id to an existing email-based account.

### 9: ZB-09 — Password reset does not revoke sessions
**FILES:** `apps/web/app/api/auth/password-reset/route.ts` (PATCH), `apps/web/lib/auth/session.ts` (`invalidateAllSessions`)
**Severity:** HIGH
After setting a new password hash, existing sessions remain valid, so a compromised/old session survives a reset. `invalidateAllSessions` already exists for exactly this. **FIX:** Call `invalidateAllSessions(userId)` inside the reset transaction (or immediately after) so all access/refresh tokens are revoked.

### 10: ZB-10 — Creator Fund engagement metric inflated by join fan-out
**FILES:** `apps/web/lib/creator/fund.ts` (`calculateFundDistributions`)
**Severity:** HIGH
The query LEFT JOINs `xp_ledger xl`, `follows f`, `sponsored_quest_applications qa`, and a **second** `xp_ledger xl2`, then `SUM(xl.amount)`. Because multiple one-to-many joins form a cartesian product and `SUM` is not `DISTINCT`-protected, `xp_earned_30d` is multiplied by the number of joined rows (notably by the count of `xl2` rows). The engagement dimension (40% weight) is therefore wildly wrong, skewing the entire distribution toward whoever has the most ledger rows. **FIX:** Compute each aggregate in its own subquery/CTE (one row per user) and join those, or use `SUM(DISTINCT …)` only where mathematically valid. Remove the duplicate `xl2` self-join (use `COUNT(DISTINCT xl.created_at::date)` over the single `xl`).

### 11: ZB-11 — Wrong payment status literal (`'success'` vs `'completed'`)
**FILES:** `apps/web/lib/trust/trustScore.ts` (line ~151), `apps/web/app/api/cron/daily/route.ts` (line ~1221), `apps/web/app/api/admin/overview/route.ts` (lines ~152/159/166)
**Severity:** HIGH
`payments.status` is constrained to `('pending','processing','completed','failed','refunded')` — `'success'` is impossible. Every query filtering `status = 'success'` returns nothing: trust scores never credit payment history, the daily trust-recompute never selects paying users, and admin revenue/overview figures under-report. **FIX:** Replace `'success'` with `'completed'` in all four locations; grep the codebase for other `'success'` status comparisons.

### 12: ZB-12 — Regex HTML sanitizer is bypassable (stored XSS)
**FILES:** `apps/web/lib/security/htmlSanitizer.ts`
**Severity:** HIGH
`ALLOWED_TAGS`/`ALLOWED_ATTRS` are declared but never used; `sanitizeHtml` only strips `<script>`, `<style>`, and whitespace-prefixed `on*=`/`javascript:` patterns. Disallowed tags (`<iframe>`, `<object>`, `<svg>`, `<math>`, `<base>`) pass through, and handlers using `/` separators (`<svg/onload=…>`) or HTML-entity-encoded `javascript:` bypass the regexes. Anywhere this output is rendered as HTML (announcements, community notes) is an XSS sink. **FIX:** Replace with a vetted allow-list sanitizer (`sanitize-html` server-side, or `DOMPurify` via `jsdom`) that actually enforces the tag/attribute allow-list and URL-scheme checks.

### 13: ZB-13 — safeFetch redirect loop & unbounded response
**FILES:** `apps/web/lib/security/ssrf.ts` (`safeFetch`)
**Severity:** HIGH
`safeFetch` recurses on every 3xx with no maximum-redirect counter, so a malicious endpoint that 302-loops causes unbounded recursion. The documented `maxResponseBytes` option is never enforced, so a large response can exhaust memory. **FIX:** Add a redirect-hop limit (e.g. ≤5) threaded through the recursion, and enforce `maxResponseBytes` by streaming/capping the body (`Content-Length` check plus a bounded reader). Also note the inherent TOCTOU between the DNS check and `fetch` re-resolving — consider resolving once and connecting to the validated IP, or use an egress proxy/allow-list for production.

### 14: ZB-14 — Weekly season snapshot uses non-existent column `started_at`
**FILES:** `apps/web/app/api/cron/daily/route.ts` (step "5b", line ~225/263)
**Severity:** MEDIUM
`SELECT id, name, started_at FROM seasons …` — the column is `starts_at`. The query throws and the entire weekly snapshot/top-100-frame step is recorded as an error and never runs. **FIX:** Use `starts_at` (and alias if downstream code reads `started_at`).

### 15: ZB-15 — Re-engagement guild-war context queries non-existent columns
**FILES:** `apps/web/app/api/cron/daily/route.ts` (step 11, lines ~846–854)
**Severity:** MEDIUM
The query selects `gw.result`, joins on `gw.guild_id`, and orders by `gw.ended_at`, none of which exist on `guild_wars` (it has `challenger_guild_id`/`defender_guild_id`, `winner_guild_id`, `ends_at`). The `try/catch` hides the failure, so 7-day-inactive users never get guild-war personalisation. **FIX:** Rewrite using real columns: join through `guild_members` to the user's guild, match `challenger_guild_id`/`defender_guild_id`, derive win/loss from `winner_guild_id`, and order by `ends_at`.

### 16: ZB-16 — Re-engagement season context queries non-existent `phase`
**FILES:** `apps/web/app/api/cron/daily/route.ts` (step 11, lines ~878–883)
**Severity:** MEDIUM
`SELECT phase, name FROM seasons …` — there is no `phase` column; phase is computed in code (`getSeasonPhase`). The query throws (caught), so 14-day-inactive users get no season context. **FIX:** Select `starts_at, ends_at, name` and compute the phase via `getSeasonPhase`.

### 17: ZB-17 — Ad-revenue MAU enrolment uses non-existent `rooms.room_type`
**FILES:** `apps/web/app/api/cron/daily/route.ts` (step 25, line ~1537)
**Severity:** MEDIUM
The rooms table column is `type` (CHECK in `('free_open','vip','drop','tipping','classroom','guild')`), not `room_type`. The query is wrapped in `.catch(() => ({rows:[]}))`, so it silently returns nothing and no room is ever auto-enrolled into ad revenue share. **FIX:** Use `r.type = 'free_open'`.

### 18: ZB-18 — Optional idempotency key allows double-spend
**FILES:** `apps/web/app/api/economy/gifts/send/route.ts`, `apps/web/app/api/economy/coins/transfer/route.ts`
**Severity:** MEDIUM
`idempotencyKey` is optional in both schemas. When the client omits it, nothing prevents a rapid double-submit (the `apiWrite` limit is 60/min) from sending two gifts / two transfers. **FIX:** Require `idempotencyKey` for all value-moving endpoints, and reject requests without it; or derive a server-side dedup key (sender + recipient + amount + short time bucket).

### 19: ZB-19 — Refresh-token rotation causes spurious global logout
**FILES:** `apps/web/lib/auth/session.ts` (`refreshAccessToken`), `apps/web/app/api/auth/refresh/route.ts`, `apps/expo/lib/api/client.ts`
**Severity:** MEDIUM
Each refresh rotates the token and stores the new hash; if the response is lost (common on mobile), the client retries with the old token, the hash mismatches, and `invalidateAllSessions` logs the user out everywhere. **FIX:** Add a short grace window — keep the previous token hash valid for a few seconds, or only treat reuse as malicious if the *old* token is presented *after* the new one has already been used. Make refresh idempotent for the immediately-previous token.

### 20: ZB-20 — Insufficient-balance errors surface as HTTP 500
**FILES:** `apps/web/lib/api/errors.ts` (`handleApiError`), `apps/web/lib/economy/coins.ts`, `apps/web/lib/economy/stars.ts`, plus any debit caller not special-casing the code (e.g. DM cost, room powers)
**Severity:** MEDIUM
`debitCoins`/`debitStars` throw a plain `Error` with `code = INSUFFICIENT_BALANCE`/`INSUFFICIENT_STAR_BALANCE` but **no** `statusCode`. `handleApiError` only maps `ApiError`, `ZodError`, and errors carrying `statusCode`, so these become generic 500s wherever the route doesn't manually catch them (gift-send and transfer do; other debit paths may not). **FIX:** Either attach `statusCode = 402/400` to those errors at the source, or add a branch in `handleApiError` that maps the `INSUFFICIENT_*` codes to a 4xx response.

### 21: ZB-21 — Trust score never computed for normal users blocks features
**FILES:** `apps/web/lib/trust/trustScore.ts` (`meetsMinimumTrust`), `apps/web/app/api/cron/daily/route.ts` (step 20), registration flow
**Severity:** MEDIUM
`meetsMinimumTrust` reads the cached `users.trust_score` (default 0 / NULL) and never recomputes. The only recompute path (daily cron step 20) selects users who had a report/payment/mod-action in the last 24h. A normal user therefore keeps trust 0 forever and can never pass `send_gift` (≥20), `guild_creation` (≥30), etc. **FIX:** Compute the trust score at registration and on login, and/or have `meetsMinimumTrust` lazily recompute when the score is null/stale. (Also depends on ZB-11 being fixed for the payment signal to count.)

### 22: ZB-22 — Milestone coin reward bypasses the ledger
**FILES:** `apps/web/lib/seasons/seasonEngine.ts` (`claimPassMilestone`)
**Severity:** MEDIUM
The coin reward path does `UPDATE users SET coin_balance = coin_balance + amount` directly, with no `coin_ledger` entry and no row lock. This breaks the "ledger is the source of truth" invariant and can drift from `coin_balance`. **FIX:** Use `creditCoins(userId, amount, "season_milestone_reward", milestoneId, …, tx)` so the ledger and balance stay consistent (this also gives idempotency via the unique reference once ZB-06 is fixed).

### 23: ZB-23 — Creator Fund distribution lacks idempotency
**FILES:** `apps/web/lib/creator/fund.ts` (`distributeCreatorFund`), `apps/web/app/api/cron/daily/route.ts` (Day-5 block)
**Severity:** MEDIUM
Distribution inserts `creator_earnings` with `reference_id = fund:${period}:rank${rank}` and unconditionally increments `available_earnings_kobo`. If the Day-5 cron runs twice (external scheduler retry), creators are credited twice (no unique guard on the insert, no "already distributed this period" flag). **FIX:** Add a unique constraint on `creator_earnings(source_type, reference_id)` (or a `creator_fund_distributions(period)` marker row) and make the balance increment conditional on a fresh insert.

### 24: ZB-24 — Telegram hash comparison not constant-time
**FILES:** `apps/web/lib/auth/telegram.ts` (`verifyTelegramLogin`)
**Severity:** LOW
The code uses `expectedHash !== hash` (plain string compare) while the comment claims constant-time. **FIX:** Use `crypto.timingSafeEqual` on equal-length buffers (guard length first), matching the pattern already used in `csrf.ts`.

### 25: ZB-25 — Field decryption may corrupt multibyte text
**FILES:** `apps/web/lib/security/fieldEncryption.ts` (`decryptField`)
**Severity:** LOW
`decipher.update(encrypted)` returns a Buffer (no encoding), then `+ decipher.final("utf8")` coerces it; a multibyte UTF-8 character split across the update/final boundary can be mangled. **FIX:** Pass the output encoding to both calls: `decipher.update(encrypted, undefined, "utf8") + decipher.final("utf8")`, or concatenate Buffers and `toString("utf8")` once.

### 26: ZB-26 — Notifications table written with two shapes
**FILES:** schema `notifications`; writers across `apps/web/app/api/**` and `lib/**` (some use `payload`, others use `title/body/metadata`)
**Severity:** LOW
The table has both `payload` and `title/body/metadata`; different writers populate different columns, so consumers must defensively handle both. **FIX:** Pick one canonical shape (recommend `type` + `payload` JSONB) and migrate all writers/readers; or add a thin helper `insertNotification()` that normalises every call.

### 27: ZB-27 — XP recorded in two parallel tables
**FILES:** `xp_events` vs `xp_ledger` writers (e.g. `app/api/economy/gifts/send/route.ts` writes `xp_events`; `lib/referrals/commissions.ts`, `lib/guilds/warEngine.ts`, cron write `xp_ledger`)
**Severity:** LOW
Two audit tables for the same concept mean any analytics/reconciliation summing one table silently omits the other. `users.xp_total` is the de-facto truth, which makes both ledgers untrustworthy as audit. **FIX:** Consolidate on a single XP ledger table and update all writers; if both must remain, document which is authoritative and stop writing the other.

### 28: ZB-28 — Middleware dead import and mixed CSP directives
**FILES:** `apps/web/middleware.ts`
**Severity:** LOW
`SignJWT` is imported but unused. The CSP includes `'strict-dynamic'` together with `'unsafe-inline'` and host allow-lists in `script-src`; CSP3 browsers ignore the host list and `unsafe-inline` when `strict-dynamic` + a nonce are present, so the host entries are misleading and `unsafe-inline` weakens older browsers. **FIX:** Remove the unused import; decide on a single strategy — nonce + `strict-dynamic` (drop `unsafe-inline` and host allow-list from `script-src`), keeping host allow-lists only where you don't use `strict-dynamic`.

### 29: ZB-29 — transferCoins validates after computing fee/net
**FILES:** `apps/web/lib/economy/coins.ts` (`transferCoins`)
**Severity:** LOW
`fee`/`net` are computed before the `isInteger()/lte(0)` guard. No exploit (it still throws before DB work), but a negative `amount` produces nonsensical intermediate values. **FIX:** Move the validation to the top of the function.

### 30: ZB-30 — DM daily-limit TOCTOU and fragile TTL
**FILES:** `apps/web/lib/messaging/coinCost.ts` (`checkDailyLimitReached`, `incrementDailyCount`)
**Severity:** LOW
The limit check and the increment are separate operations, so two concurrent sends can both pass the check. Also `expire` is only set when `incr` returns 1; if that `expire` call fails, the counter can persist without a TTL. **FIX:** Use an atomic check-and-increment (Lua, like the rate limiter) and set the TTL via `SET … EX`/`PEXPIRE` on every write, or recreate the TTL idempotently.

### 31: ZB-31 — Non-deterministic ledger ordering
**FILES:** `apps/web/lib/economy/coins.ts` (`getLedgerEntries`), `apps/web/lib/economy/stars.ts` (`getStarLedgerEntries`)
**Severity:** LOW
`ORDER BY created_at DESC` alone is ambiguous for multiple entries sharing a timestamp (same transaction), producing inconsistent paging/order. **FIX:** Add a stable tiebreaker, e.g. `ORDER BY created_at DESC, id DESC`.

### 32: ZB-32 — DLQ records the pre-increment retry count
**FILES:** `apps/web/app/api/economy/webhooks/paystack/route.ts` (`processTransferEvent`, `transfer.failed`)
**Severity:** LOW
On terminal failure it calls `moveToDeadLetterQueue(payout.id, payout.creator_id, payout.retry_count, …)` passing the old `retry_count` rather than `newRetryCount`, so the DLQ row/UPDATE records one less attempt than actually occurred. **FIX:** Pass `newRetryCount`.

---

## Overall assessment

### Current state (before fixes)

| Dimension | Rating (/10) | Notes |
|---|---|---|
| Architecture & structure | 8.0 | Clean provider abstractions (db/redis/storage/realtime), good HOC middleware, typed errors, Decimal-based money math. Genuinely well-organised. |
| Security | 4.5 | Strong foundations (JWT+Redis sessions, refresh rotation+reuse detection, SSRF guard, rate limiting, fail-closed status checks) undermined by a **critical OAuth token-leak (ZB-01)**, a bypassable HTML sanitizer (ZB-12), and missing email-verification (ZB-08). |
| Financial correctness | 3.5 | Core ledger design is sound and idempotent, but several reward/bonus paths are **outright broken or exploitable** (ZB-02..06) due to ledger unique-reference collisions, NOT NULL omissions, and an unchecked claim. |
| Reliability / data integrity | 5.0 | Schema↔query mismatches (ZB-11, ZB-14..17) silently break multiple cron features; concurrency gap in war resolution (ZB-07). |
| Code quality / maintainability | 7.0 | Excellent docs/comments and consistent patterns; weakened by dual notification/XP schemas and a very large monolithic daily-cron handler. |
| **Overall** | **5.0** | A strong, thoughtfully-built platform carrying a cluster of high-impact correctness/security defects that would surface immediately in production (broken bonuses/rewards, token leak). |

### Projected state (after all recommended fixes)

| Dimension | Rating (/10) |
|---|---|
| Architecture & structure | 8.5 |
| Security | 8.5 |
| Financial correctness | 9.0 |
| Reliability / data integrity | 8.5 |
| Code quality / maintainability | 8.0 |
| **Overall** | **8.5** |

**Summary review:** The codebase is above-average in craftsmanship — provider-agnostic infrastructure, immutable Decimal ledgers, defence-in-depth auth, and unusually thorough documentation. Its weaknesses are concentrated and fixable: (1) a single critical OAuth redirect-validation gap, (2) a recurring "multiple users credited under one `(type, reference_id)`" pattern that the unique index turns into transaction-aborting failures, (3) a handful of `coin_ledger` inserts missing required columns, (4) schema/column-name drift between cron queries and the consolidated schema, and (5) the `'success'` vs `'completed'` status mismatch. Address the CRITICAL and HIGH items (ZB-01 through ZB-13) first — they are the difference between "broken/exploitable in production" and "solid." Once corrected, this is a genuinely robust 8.5/10 platform.

---

*Report generated by Claude Code on 2026-06-12 at 11:21 PM UTC (Friday). Bugs were identified through independent static analysis; no fixes have been applied — awaiting review of the accompanying `custom-bugs-fix-plan.md`.*
