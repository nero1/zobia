# Zobia Social — Bug Fix Plan

**Generated:** 2026-06-12 12:51 PM UTC
**Branch:** `claude/codebase-bug-security-audit-x7qexk`
**Companion to:** `custom-bugs-report.md`

> **DO NOT START FIXING UNTIL THIS PLAN IS REVIEWED AND APPROVED.**
> Ordered by risk-to-value. Each phase is independently shippable and testable.

---

## Phase 0 — Guardrails before touching money/auth (prep)
- [ ] Add/expand DB-level invariants used as tests: `coin_ledger` sum == `users.coin_balance`; payout debit == DLQ restore; no negative balances.
- [ ] Stand up integration tests for the webhook → credit → referral path and the payout batch path (these change the most below).
- [ ] Snapshot current `lib/economy/__tests__/*` and `lib/creator/__tests__/payout.test.ts` as the regression baseline.

## Phase 1 — Financial integrity & re-entrancy (highest priority)
- [ ] **ZB-08** Remove the creator double-credit in `gifts/send` — pick coins-only or earnings-only and conserve value; add a "value in == value out + fee" test.
- [ ] **ZB-06** Replace INSERT + `ORDER BY created_at DESC LIMIT 1` with `INSERT ... RETURNING *` in `lib/economy/coins.ts` and `lib/economy/stars.ts`.
- [ ] **ZB-09** Remove all in-transaction `.catch(()=>{})`; move best-effort writes outside the transaction or let them roll back the whole op intentionally.
- [ ] **ZB-10** Make payout selection claim-atomic (`UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`) before calling the provider; verify provider idempotency reference.
- [ ] **ZB-17** Add idempotency keys (unique-constrained) + `withRateLimit` to `coins/transfer` and `gifts/send`.
- [ ] **ZB-34** Route referral commission credits through locked `creditCoins`; add self/cycle/qualification validation.
- [ ] **ZB-07** Write Decimal values as `.toFixed(0)` strings to BIGINT columns.
- [ ] **ZB-31** Verify/realign payout debit-at-creation vs DLQ restore (gross vs net) with a test.
- [ ] **ZB-21** Return 5xx from webhooks on transient processing failure (keep 200 only on success/confirmed duplicate).
- [ ] **ZB-22** Re-derive coin/star grants server-side from `store_items`/`payments` by `provider_reference`; assert `amount == price_kobo`.

## Phase 2 — Authentication, sessions & account lifecycle
- [ ] **ZB-13** Add a cached account-status check (`is_banned`/`is_suspended`/`deleted_at`) to `withAuth`, or a session status/version stamp compared each request.
- [ ] **ZB-14** Block `createSession` for banned/suspended users in Google & Telegram callbacks with a clear message.
- [ ] **ZB-16** Call `invalidateAllSessions` inside account self-deletion.
- [ ] **ZB-15** Replace hard PII wipe with a soft-delete grace window (keep recovery handle, schedule purge) + reactivation-on-login flow.
- [ ] **ZB-24** Implement refresh-token rotation + reuse detection (revoke session chain on reuse).
- [ ] **ZB-25** Carry `adminSession` in the session record; re-issue refresh access tokens with the correct TTL/claims.
- [ ] **ZB-23** Remove the edge `fetch('/api/auth/refresh')`; refresh in the route/client layer or via shared crypto.
- [ ] **ZB-36** Drop unused forwarded identity headers, or strip inbound spoofed copies on every path.

## Phase 3 — Serverless scalability & cost (Vercel Hobby fit)
- [ ] **ZB-01** Replace DB-polling SSE with the `lib/realtime` provider (push on write) or Redis pub/sub; cap connection lifetime/concurrency.
- [ ] **ZB-02** Lower `pg` pool `max` to 1–2 for serverless (env-driven); confirm PgBouncer transaction pooler endpoint.
- [ ] **ZB-03 / ZB-04** Rewrite the rate limiter as a single atomic Lua `eval` (true sliding window), one round-trip per check.
- [ ] **ZB-05** Use the platform-trusted client IP (`x-vercel-forwarded-for`/`request.ip`); stop trusting left-most XFF.
- [ ] **ZB-28** Add single-flight/stale-while-revalidate to `loadManifest`; make `getManifestValue` read the cached map.
- [ ] **ZB-29** Eliminate `redis.keys()` from runtime paths; use index sets / `SCAN` for maintenance only.
- [ ] **ZB-11** Add jitter to payout retry `next_retry_at`.
- [ ] **ZB-12** Add a reconciliation pass for stuck `processing` payouts (re-query provider status).
- [ ] **ZB-27** Migrate user-facing feeds to keyset/cursor pagination.
- [ ] **ZB-32** Use a composite `(created_at, id)` cursor in the stream/feed queries.

## Phase 4 — Web security hardening
- [ ] **ZB-19** Server-side sanitize announcement/footer HTML on write (allow-list) and on render.
- [ ] **ZB-20** Add CSP (script-src allow-list), HSTS, Permissions-Policy in `vercel.json`/`next.config.js`.
- [ ] **ZB-18** Resolve & validate hostnames against private ranges in `safeFetch` (anti-rebinding), per redirect hop.
- [ ] **ZB-30** Use `crypto.timingSafeEqual` for CRON/webhook secret comparisons.
- [ ] **ZB-33** Exclude authenticated/personalized `/api/*` from service-worker caching.
- [ ] **ZB-35** Make transaction `ROLLBACK` failures not mask the original error.

## Phase 5 — SEO, i18n & polish
- [ ] **ZB-26** Provide public SSR profile/room pages (or public variants), fix sitemap URL params to match routes, cache sitemap output.
- [ ] **ZB-37** Verify locale key parity + actual RTL application at the layout level.
- [ ] Add a user Help/Support section and accessibility pass (focus states, ARIA, contrast) as called out in the brief.

---

## Suggested rollout
1. Land **Phase 1** behind tests on a staging DB with a money-conservation assertion suite; do not deploy without it.
2. Ship **Phase 2** with forced re-login (rotate JWT secrets) so the new session-status checks apply immediately.
3. Roll **Phase 3** incrementally (realtime first, then rate limiter, then pooling) watching Vercel function-hours and Upstash command counts.
4. **Phase 4/5** can ship continuously.

## Verification per phase
- Unit + integration tests green (`npm run test:all`).
- Load test (`load-tests/room-feed.js`) shows stable DB connections and Upstash command rate within free-tier budget.
- Manual: ban a user → immediate lockout; delete → cannot act, can later reactivate within window; duplicate gift/transfer/webhook → single effect.

---

*Plan generated 2026-06-12 12:51 PM UTC — Zobia Social forensic audit. Awaiting approval before implementation.*
