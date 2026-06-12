# Zobia Social — Bug Fix Plan

**Generated:** 2026-06-12, 08:34 PM (UTC)
**Companion to:** `custom-bugs-report.md`
**Status:** IN PROGRESS — implementation started 2026-06-12.

**Legend:** ✅ Fixed | 🟠 Partially fixed | ⬜ Not yet fixed

This plan is ordered by priority. Each phase is independently shippable. Bug numbers map to `custom-bugs-report.md`.

---

## Phase 0 — Release Blockers (deploy ASAP, ~half day)

These break core money & session flows. Fix and verify before anything else.

### ✅ 0.1 — Add missing DB columns (Bugs #1, #2, #9)
- New migration `010_fix_ledger_and_payment_columns.sql`:
  - `ALTER TABLE star_ledger ADD COLUMN IF NOT EXISTS balance_before BIGINT NOT NULL DEFAULT 0;`
  - `ALTER TABLE star_ledger ADD COLUMN IF NOT EXISTS balance_after BIGINT NOT NULL DEFAULT 0;`
  - `ALTER TABLE star_ledger ALTER COLUMN reference_id TYPE TEXT;` (parity with coin_ledger; verify no UUID-typed dependency).
  - `ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_received_kobo BIGINT;`
  - Backfill: `UPDATE payments SET amount_received_kobo = amount_kobo WHERE status='completed' AND amount_received_kobo IS NULL;`
- Update the consolidated `001_complete_schema.sql` to include these so fresh installs are correct.
- **Verify:** run `npm run migrate` against a scratch DB; execute a real star credit and a Paystack `charge.success` (signed) against a local instance; assert balances move and `payments.status='completed'`; load `/api/admin/financial`.

### ✅ 0.2 — Complete refresh-token rotation (Bug #3)
- File: `apps/web/app/api/auth/refresh/route.ts` — read `newRefreshToken` from `refreshAccessToken`, set the refresh cookie from it via `buildCookieHeaders`, and return it in `X-Refresh-Token` for mobile.
- File: `apps/web/apps/expo/lib/api/client.ts` — persist the rotated refresh token from the response header/body into `SecureStore`.
- **Verify:** call `/api/auth/refresh` twice in succession with the same browser session; the user must remain logged in (no "reuse detected"). Add a regression test.

### ✅ 0.3 — Unblock CRON endpoints in middleware (Bug #5)
- File: `apps/web/middleware.ts` — allow `/api/cron/` to bypass the JWT-cookie default-deny (the route's `CRON_SECRET` timing-safe check is the real gate). Keep CSRF behavior intact.
- **Verify:** `curl -XPOST -H "Authorization: Bearer $CRON_SECRET" /api/cron/payouts` returns 200; without the header returns 401 from the *route* (not middleware).

### ✅ 0.4 — Fix guild-quest coin reward (Bug #4)
- File: `apps/web/app/api/guilds/[guildId]/quests/[questId]/contribute/route.ts` — replace `UPDATE users SET coins = …` with `creditCoins(member.user_id, coinsPerMember, "quest_reward", questId, …, tx)` inside the transaction.
- **Verify:** complete a quest in a seeded guild; confirm each member's `coin_balance` rises and a `coin_ledger` row exists per member.

---

## Phase 1 — Payment & Accounting Integrity (~1–2 days)

### ✅ 1.1 — Idempotent payout reference (Bug #6)
- File: `lib/payments/payouts.ts` — use one stable reference per payout for all attempts; before re-initiating, call `verifyTransfer`/lookup to confirm the prior attempt didn't already succeed.

### ✅ 1.2 — Idempotent earnings restoration (Bugs #7, #8)
- Add `earnings_restored BOOLEAN NOT NULL DEFAULT false` to `creator_payouts` (migration).
- Centralize restoration in one helper that, in a `FOR UPDATE` transaction, flips status AND credits `gross_kobo` only if `earnings_restored=false`, then sets it true.
- Route `moveToDeadLetterQueue`, `reconcileStuckPayouts`, and the webhook `transfer.failed`/`reversed` branches through this helper.

### ✅ 1.3 — Atomic, correctly-ordered transfer idempotency (Bug #12)
- File: `app/api/economy/coins/transfer/route.ts` — replace `exists`+`setex` with `SET key val NX EX 86400`; only treat as duplicate when `NX` fails; set the marker after commit (or cache the result for replay).

### ✅ 1.4 — Gift idempotency + rate limit (Bug #13)
- File: `app/api/economy/gifts/send/route.ts` — add `enforceRateLimit(senderId,"user",RATE_LIMITS.apiWrite)` and optional idempotency key via the same `SET NX` pattern.

### ✅ 1.5 — Server-derived referral amount + amount validation (Bugs #17, #18)
- Webhook: pass `serverCoinsGranted` to `awardReferralCommissions`; assert `amount >= price_kobo` and currency match before crediting; otherwise flag for review.

### ✅ 1.6 — Coin/star ledger idempotency keys (Bug #19)
- Migration: partial unique index `coin_ledger (transaction_type, reference_id) WHERE reference_id IS NOT NULL` (same for `star_ledger`).
- `creditCoins`/`debitCoins`/`creditStars`/`debitStars`: accept optional idempotency key; inside the locked transaction, no-op if a matching entry exists.

### ✅ 1.7 — Separate virtual-coin gift accounting from fiat (Bug #14)
- Stop writing coin amounts into `creator_earnings.*_kobo`. Either add coin-denominated columns or restrict `creator_earnings` to fiat sources; define an explicit coin→kobo rate if gifts are cashable. Audit payout/financial aggregations for the conflation.

### ✅ 1.8 — Subscription period-end downgrade (Bug #16)
- Webhook: on `non-renewing`, set `status='cancelling'`, keep plan until `next_payment_date`; downgrade via the daily cron when the period lapses.

---

## Phase 2 — Security Hardening (~1 day)

- ✅ **SSRF (Bug #15):** link-preview route now uses `safeFetch` from `lib/security/ssrf.ts` (full DNS rebinding protection + recursive redirect validation). GIF proxy uses hardcoded Giphy/Tenor URLs (no user input). No image proxy route exists and no admin-configurable outbound URL fields were found.
- ✅ **Fail-closed status (Bug #20):** for payment/payout/transfer/gift mutations, now denies when ban/suspend status can't be confirmed.
- ✅ **CSP + XSS sinks (Bug #23):** CSP moved from static `next.config.js` headers to per-request middleware with `'nonce-${nonce}'` + `'strict-dynamic'` in script-src (CSP3 browsers ignore `unsafe-inline` when a valid nonce is present). All `dangerouslySetInnerHTML` paths audited: announcement modal/banner sanitized via `sanitizeHtmlContent()`, leaderboard banner is a static constant, footer scripts are admin-gated and have the nonce injected server-side. Nonce forwarded via `x-nonce` request header and applied to footer `<script>` tags in `app/layout.tsx`.

## Phase 3 — Scalability & Cost (~1 day)

- ✅ **Pool timeouts + no HTTP in transactions (Bug #21):** `statement_timeout=10s` / `idle_in_transaction_session_timeout=15s` added to all 3 DB providers. Audit of webhook and payout code confirmed no HTTP/fetch calls inside `db.transaction()` callbacks — all external calls (Paystack, DodoPayments) are made before or after transaction boundaries.
- ✅ **Global circuit breaker (Bug #22):** AI circuit breaker state now persisted in Redis; in-memory L1 cache reduces Redis round-trips.
- ✅ **Rate-limit keying (Bug #27):** `"unknown"` IP now skips rate limiting instead of bucketing all unidentifiable clients together.

## Phase 4 — SEO (~1 day)

- ✅ **Public read views (Bug #10):** `/u/[username]` and `/r/[id]` created with SSR + `generateMetadata` (title/OG/canonical); prefixes added to `PUBLIC_PREFIXES`; sitemap updated to point at these URLs.
- ✅ **Sitemap query (Bug #11):** rooms now ordered by `updated_at`; profiles and rooms wrapped in separate try/catch blocks.

## Phase 5 — Data Model & Cleanup (~1–2 days, lower urgency)

- ✅ Treasury cap clamp (Bug #24) — `LEAST(treasury_cap, treasury_balance + amount)` in gift route and treasury donation route.
- ✅ BigInt-safe admin aggregates (Bug #25) — `Number()` instead of `parseInt(..., 10)` for BIGINT sums.
- ✅ Admin refresh-cookie TTL (Bug #26) — `buildCookieHeaders` now accepts `refreshTtl` param; `refreshAccessToken` returns the actual TTL.
- ⬜ Schema de-duplication (Bug #28) — not addressed; requires DB migrations and codebase-wide refactor.

---

## Suggested Sequencing & Effort

| Phase | Theme | Effort | Risk if skipped |
|---|---|---|---|
| 0 | Release blockers | ~0.5 day | Money/sessions/cron broken |
| 1 | Payment/accounting | 1–2 days | Financial loss, double-pay |
| 2 | Security | ~1 day | SSRF/XSS exposure |
| 3 | Scalability/cost | ~1 day | Outages under load |
| 4 | SEO | ~1 day | No organic discovery |
| 5 | Cleanup | 1–2 days | Tech-debt/bloat |

## Global Verification Checklist (after each phase)
- `npm run typecheck` and `npm run lint` clean.
- `npm run migrate` on a scratch DB succeeds; re-running is idempotent.
- Targeted manual flow per fix (listed above).
- For money paths: assert ledger row count == expected and balances reconcile (`SUM(coin_ledger.amount)` per user == `users.coin_balance`).
- Re-run the existing security/e2e suites (test fixes themselves are out of scope per instructions, but do not introduce new failures in passing tests).

---

*Plan generated 2026-06-12 at 08:34 PM (UTC). No fixes have been applied. Please review and approve (or amend priorities) before implementation begins.*
