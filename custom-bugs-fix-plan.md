# Zobia Social — Bug Fix Plan

**Generated:** 2026-06-12 at 11:21 PM UTC (Friday)
**Companion to:** `custom-bugs-report.md`
**Status:** ⛔ DO NOT IMPLEMENT YET — awaiting owner review of this plan.

This plan groups the 32 findings into ordered work phases. Each task lists the bug code, files, concrete change, and how to verify. Phases are ordered by risk: ship Phase 1 before anything else.

---

## Phase 0 — Pre-work (shared scaffolding)

- [ ] **P0.1 — Ledger reference helper.** Several fixes (ZB-02/03/04/05/22) depend on giving each per-user credit a unique `(transaction_type, reference_id)`. Add/confirm a convention: per-recipient references of the form `${event}:${eventId}:${userId}`. Audit every multi-user credit loop for the same anti-pattern.
- [ ] **P0.2 — Branch + CI.** Work on `claude/codebase-bug-analysis-kv8dem`. Ensure `npm run typecheck` and the existing economy/concurrency tests run locally before each push.
- [ ] **P0.3 — Repro tests first.** For each CRITICAL, write a failing test before fixing (repeat referral purchase, multi-member war payout, season payout, monthly bonus credit, double milestone claim, OAuth redirect rejection).

---

## Phase 1 — CRITICAL (security & money). Do first.

- [ ] **ZB-01 — OAuth redirect allow-list.**
  Files: `apps/web/app/api/auth/google/route.ts`, `apps/web/app/api/auth/google/callback/route.ts` (and check the Telegram callback for the same pattern).
  Change: Validate `redirect` against an explicit allow-list (custom app scheme(s) + exact first-party hosts) in **both** initiation (before setting `zobia_mobile_redirect`) and callback (before redirecting). Reject otherwise. Preferred hardening: deliver mobile tokens via a one-time server-stored exchange code instead of URL query params.
  Verify: unit test that `redirect=https://evil.com` is rejected; manual mobile login still works with the approved scheme.

- [ ] **ZB-02 — Referral commission unique references.**
  Files: `apps/web/lib/referrals/commissions.ts`.
  Change: Use `reference_id = `referral:${paymentId}:t1`` and `:t2`` (thread `paymentId` in from the webhook). Keep the qualifying-bonus reference distinct too.
  Verify: repeat purchase by the same referee and a 2-level chain both credit coins and don't 500 the webhook.

- [ ] **ZB-03 / ZB-04 — Per-recipient reward references.**
  Files: `apps/web/lib/guilds/warEngine.ts` (`distributeWarRewards`), `apps/web/lib/seasons/seasonEngine.ts` (`distributeSeasonRewards`).
  Change: `reference_id = `war:${warId}:${userId}`` / `season:${seasonId}:${userId}``; prefer routing through `creditCoins(..., tx)`.
  Verify: a war/season with ≥2 winners pays every winner; ledger has one row per winner.

- [ ] **ZB-05 — Fix NOT NULL ledger inserts.**
  Files: `apps/web/app/api/cron/daily/route.ts` (comeback grant ~824, monthly plan bonus ~1278, comeback expiry ~1343).
  Change: Route through `creditCoins`/`debitCoins` (preferred) or include locked `balance_before`/`balance_after`. Keep idempotency (unique reference, not `gen_random_uuid()` if you want true de-dup).
  Verify: run the cron path in a test DB; Plus/Pro/Max users receive their monthly coins and a ledger row.

- [ ] **ZB-06 — Guard milestone claim against re-award.**
  Files: `apps/web/lib/seasons/seasonEngine.ts` (`claimPassMilestone`).
  Change: Use `INSERT … ON CONFLICT DO NOTHING RETURNING id`; only apply the reward when a row was inserted. Wrap eligibility read + insert + reward in one transaction with `SELECT … FOR UPDATE` on the pass.
  Verify: second claim of the same milestone returns "already claimed" and grants nothing; concurrent double-submit grants once.

---

## Phase 2 — HIGH (security weaknesses & broken core features)

- [ ] **ZB-07 — Atomic war resolution.** Move `SELECT … FOR UPDATE` + status guard inside the reward transaction in `warEngine.ts` (`resolveWar`); re-check status post-lock.
- [ ] **ZB-08 — Require email_verified.** In `upsertGoogleUser` (`auth/google/callback/route.ts`), refuse to link a Google id to an existing email account unless `profile.emailVerified === true`.
- [ ] **ZB-09 — Revoke sessions on password reset.** Call `invalidateAllSessions(userId)` in the PATCH transaction of `auth/password-reset/route.ts`.
- [ ] **ZB-10 — Fix Creator Fund fan-out.** Rewrite `calculateFundDistributions` query in `creator/fund.ts` so each metric is a one-row-per-user subquery/CTE; remove the duplicate `xl2` self-join.
- [ ] **ZB-11 — `'success'` → `'completed'`.** Fix `trust/trustScore.ts`, `cron/daily/route.ts` (~1221), `admin/overview/route.ts` (~152/159/166); grep for other occurrences.
- [ ] **ZB-12 — Real HTML sanitizer.** Replace `security/htmlSanitizer.ts` internals with `sanitize-html` (server) / `DOMPurify`+`jsdom`, enforcing the existing allow-lists and URL-scheme checks. Audit all render sites.
- [ ] **ZB-13 — safeFetch hardening.** Add a max-redirect counter and enforce `maxResponseBytes` in `security/ssrf.ts`; consider resolve-once-then-connect to close the DNS TOCTOU.

---

## Phase 3 — MEDIUM (correctness & degraded features)

- [ ] **ZB-14 — `started_at` → `starts_at`** in `cron/daily/route.ts` weekly snapshot.
- [ ] **ZB-15 — Rewrite guild-war re-engagement query** to real `guild_wars` columns (`challenger/defender_guild_id`, `winner_guild_id`, `ends_at`) via `guild_members`.
- [ ] **ZB-16 — Drop `seasons.phase` usage;** select timestamps and compute phase with `getSeasonPhase`.
- [ ] **ZB-17 — `rooms.room_type` → `rooms.type`** in the MAU enrolment query.
- [ ] **ZB-18 — Require `idempotencyKey`** for gift-send and coin-transfer (or derive a server-side dedup key).
- [ ] **ZB-19 — Refresh grace window.** Keep the previous refresh-token hash valid briefly (or treat reuse as malicious only when the new token has already been consumed) in `auth/session.ts`.
- [ ] **ZB-20 — Map INSUFFICIENT_* to 4xx.** Either attach `statusCode` at throw sites in `economy/coins.ts`/`stars.ts`, or add a branch in `api/errors.ts` `handleApiError`.
- [ ] **ZB-21 — Compute trust score at registration/login** and/or lazily recompute in `meetsMinimumTrust` when null/stale. (Depends on ZB-11.)
- [ ] **ZB-22 — Route milestone coins through `creditCoins`** in `claimPassMilestone` (folds into ZB-06).
- [ ] **ZB-23 — Idempotent Creator Fund distribution.** Add unique `creator_earnings(source_type, reference_id)` and a per-period marker; make the balance increment conditional on a fresh insert.

---

## Phase 4 — LOW (robustness, hygiene, maintainability)

- [ ] **ZB-24 — `timingSafeEqual`** in `auth/telegram.ts`.
- [ ] **ZB-25 — `decryptField` utf8 encoding** in `security/fieldEncryption.ts`.
- [ ] **ZB-26 — Unify notification shape** (helper `insertNotification`, migrate writers/readers).
- [ ] **ZB-27 — Consolidate XP ledger tables** (or document the authoritative one and stop dual-writing).
- [ ] **ZB-28 — Remove unused `SignJWT` import; tidy CSP** in `middleware.ts`.
- [ ] **ZB-29 — Reorder validation** in `transferCoins`.
- [ ] **ZB-30 — Atomic DM counter** (Lua check-and-increment; always set TTL) in `messaging/coinCost.ts`.
- [ ] **ZB-31 — Stable ledger ordering** (`, id DESC`) in `economy/coins.ts` / `stars.ts`.
- [ ] **ZB-32 — Pass `newRetryCount`** to `moveToDeadLetterQueue` in the Paystack webhook.

---

## Cross-cutting follow-ups (recommended, not bugs)

- [ ] **Schema↔code drift guard.** Add a CI check (or integration test against a migrated DB) that exercises each cron sub-task so column-name mismatches (ZB-11/14/15/16/17) fail loudly instead of being swallowed by `try/catch`.
- [ ] **Split `cron/daily/route.ts`.** ~2,279 lines / 25+ steps in one handler. Extract each step into `lib/cron/*` functions with unit tests; the route just orchestrates. This alone would have caught ZB-14..17.
- [ ] **Stop swallowing cron errors silently.** The per-step `try/catch` is fine for isolation, but surface a structured failure summary (and alert) so silently-broken steps are visible.
- [ ] **Ledger reference audit script.** One-off scan for any `creditCoins/INSERT INTO coin_ledger` inside a loop sharing one `reference_id`.

---

## Suggested execution order & checkpoints

1. Phase 1 (ZB-01..06) → review → deploy. These are user-visible breakage/exploits.
2. Phase 2 (ZB-07..13) → review → deploy.
3. Phase 3 (ZB-14..23) → batch deploy.
4. Phase 4 (ZB-24..32) + cross-cutting → batch deploy.

Each phase: write/extend tests, run `npm run typecheck` + economy/concurrency suites, commit per-bug with the `ZB-xx` code in the message, push to `claude/codebase-bug-analysis-kv8dem`. No PR unless explicitly requested.

---

*Plan generated by Claude Code on 2026-06-12 at 11:21 PM UTC (Friday). Awaiting your review before any code changes are made.*
