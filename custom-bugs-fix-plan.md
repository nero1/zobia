# Zobia Social — Bug Fix Plan

**Generated:** 2026-06-12, 08:34 PM (UTC)
**Companion to:** `custom-bugs-report.md`
**Status:** AWAITING REVIEW — do not implement until approved.

This plan is ordered by priority. Each phase is independently shippable. Bug numbers map to `custom-bugs-report.md`.

---

## Phase 0 — Release Blockers (deploy ASAP, ~half day)

These break core money & session flows. Fix and verify before anything else.

### 0.1 — Add missing DB columns (Bugs #1, #2, #9)
- New migration `010_fix_ledger_and_payment_columns.sql`:
  - `ALTER TABLE star_ledger ADD COLUMN IF NOT EXISTS balance_before BIGINT NOT NULL DEFAULT 0;`
  - `ALTER TABLE star_ledger ADD COLUMN IF NOT EXISTS balance_after BIGINT NOT NULL DEFAULT 0;`
  - `ALTER TABLE star_ledger ALTER COLUMN reference_id TYPE TEXT;` (parity with coin_ledger; verify no UUID-typed dependency).
  - `ALTER TABLE payments ADD COLUMN IF NOT EXISTS amount_received_kobo BIGINT;`
  - Backfill: `UPDATE payments SET amount_received_kobo = amount_kobo WHERE status='completed' AND amount_received_kobo IS NULL;`
- Update the consolidated `001_complete_schema.sql` to include these so fresh installs are correct.
- **Verify:** run `npm run migrate` against a scratch DB; execute a real star credit and a Paystack `charge.success` (signed) against a local instance; assert balances move and `payments.status='completed'`; load `/api/admin/financial`.

### 0.2 — Complete refresh-token rotation (Bug #3)
- File: `apps/web/app/api/auth/refresh/route.ts` — read `newRefreshToken` from `refreshAccessToken`, set the refresh cookie from it via `buildCookieHeaders`, and return it in `X-Refresh-Token` for mobile.
- File: `apps/web/apps/expo/lib/api/client.ts` — persist the rotated refresh token from the response header/body into `SecureStore`.
- **Verify:** call `/api/auth/refresh` twice in succession with the same browser session; the user must remain logged in (no "reuse detected"). Add a regression test.

### 0.3 — Unblock CRON endpoints in middleware (Bug #5)
- File: `apps/web/middleware.ts` — allow `/api/cron/` to bypass the JWT-cookie default-deny (the route's `CRON_SECRET` timing-safe check is the real gate). Keep CSRF behavior intact.
- **Verify:** `curl -XPOST -H "Authorization: Bearer $CRON_SECRET" /api/cron/payouts` returns 200; without the header returns 401 from the *route* (not middleware).

### 0.4 — Fix guild-quest coin reward (Bug #4)
- File: `apps/web/app/api/guilds/[guildId]/quests/[questId]/contribute/route.ts` — replace `UPDATE users SET coins = …` with `creditCoins(member.user_id, coinsPerMember, "quest_reward", questId, …, tx)` inside the transaction.
- **Verify:** complete a quest in a seeded guild; confirm each member's `coin_balance` rises and a `coin_ledger` row exists per member.

---

## Phase 1 — Payment & Accounting Integrity (~1–2 days)

### 1.1 — Idempotent payout reference (Bug #6)
- File: `lib/payments/payouts.ts` — use one stable reference per payout for all attempts; before re-initiating, call `verifyTransfer`/lookup to confirm the prior attempt didn't already succeed.

### 1.2 — Idempotent earnings restoration (Bugs #7, #8)
- Add `earnings_restored BOOLEAN NOT NULL DEFAULT false` to `creator_payouts` (migration).
- Centralize restoration in one helper that, in a `FOR UPDATE` transaction, flips status AND credits `gross_kobo` only if `earnings_restored=false`, then sets it true.
- Route `moveToDeadLetterQueue`, `reconcileStuckPayouts`, and the webhook `transfer.failed`/`reversed` branches through this helper.

### 1.3 — Atomic, correctly-ordered transfer idempotency (Bug #12)
- File: `app/api/economy/coins/transfer/route.ts` — replace `exists`+`setex` with `SET key val NX EX 86400`; only treat as duplicate when `NX` fails; set the marker after commit (or cache the result for replay).

### 1.4 — Gift idempotency + rate limit (Bug #13)
- File: `app/api/economy/gifts/send/route.ts` — add `enforceRateLimit(senderId,"user",RATE_LIMITS.apiWrite)` and optional idempotency key via the same `SET NX` pattern.

### 1.5 — Server-derived referral amount + amount validation (Bugs #17, #18)
- Webhook: pass `serverCoinsGranted` to `awardReferralCommissions`; assert `amount >= price_kobo` and currency match before crediting; otherwise flag for review.

### 1.6 — Coin/star ledger idempotency keys (Bug #19)
- Migration: partial unique index `coin_ledger (transaction_type, reference_id) WHERE reference_id IS NOT NULL` (same for `star_ledger`).
- `creditCoins`/`debitCoins`/`creditStars`/`debitStars`: accept optional idempotency key; inside the locked transaction, no-op if a matching entry exists.

### 1.7 — Separate virtual-coin gift accounting from fiat (Bug #14)
- Stop writing coin amounts into `creator_earnings.*_kobo`. Either add coin-denominated columns or restrict `creator_earnings` to fiat sources; define an explicit coin→kobo rate if gifts are cashable. Audit payout/financial aggregations for the conflation.

### 1.8 — Subscription period-end downgrade (Bug #16)
- Webhook: on `non-renewing`, set `status='cancelling'`, keep plan until `next_payment_date`; downgrade via the daily cron when the period lapses.

---

## Phase 2 — Security Hardening (~1 day)

- **SSRF (Bug #15):** import & enforce `lib/security/ssrf.ts` in every server-side fetch of user/admin-supplied URLs (image/GIF proxy, brand logos, footer-script sources, webhook callbacks). Reject private/link-local/non-HTTP(S).
- **Fail-closed status (Bug #20):** for payment/payout/transfer/gift mutations, deny when ban/suspend status can't be confirmed.
- **CSP + XSS sinks (Bug #23):** move to nonce-based CSP, drop `unsafe-inline`/`unsafe-eval`; route all `dangerouslySetInnerHTML` through `htmlSanitizer`; gate footer-script injection behind a 2FA-required admin role.

## Phase 3 — Scalability & Cost (~1 day)

- **Pool timeouts + no HTTP in transactions (Bug #21):** add `statement_timeout`/`idle_in_transaction_session_timeout`; move Paystack/Dodo/AI HTTP calls out of `db.transaction` blocks (do external call first, then a short DB transaction).
- **Global circuit breaker (Bug #22):** persist AI breaker state in Redis.
- **Rate-limit keying (Bug #27):** per-session fallback when IP unknown; consider token-bucket for hot endpoints.

## Phase 4 — SEO (~1 day)

- **Public read views (Bug #10):** add SSR `/u/[username]` and `/r/[id]` with `generateMetadata` (title/description/canonical/OG); add their prefixes to `PUBLIC_PREFIXES`; point sitemap at them.
- **Sitemap query (Bug #11):** order rooms by `updated_at`; isolate the two dynamic queries in separate try/catch so one failure doesn't void the sitemap.

## Phase 5 — Data Model & Cleanup (~1–2 days, lower urgency)

- Treasury cap clamp (Bug #24); BigInt-safe admin aggregates (Bug #25); admin refresh-cookie TTL (Bug #26); schema de-duplication + retention/partitioning for append-only tables (Bug #28).

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
