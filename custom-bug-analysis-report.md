# Zobia Social — Final Bug Analysis Report

**Generated:** 2026-06-12 12:51 PM UTC
**Branch:** `claude/codebase-bug-security-audit-x7qexk`
**Reviewer:** Forensic codebase audit (manual, no sub-agents)
**Companion files:** `custom-bugs-report.md` (full detail) · `custom-bugs-fix-plan.md` (remediation plan)

This is the consolidated final report. It restates every finding and the overall rating. Full per-bug detail (files + fixes) lives in `custom-bugs-report.md`; the ordered remediation tasks live in `custom-bugs-fix-plan.md`.

---

## Severity breakdown

| Severity | Count | IDs |
|---|---|---|
| Critical | 6 | ZB-01, ZB-02, ZB-08, ZB-10, ZB-13, ZB-14 |
| High | 12 | ZB-03, ZB-04, ZB-05, ZB-06, ZB-09, ZB-15, ZB-16, ZB-17, ZB-18, ZB-19, ZB-21, ZB-24 |
| Medium | 15 | ZB-07, ZB-11, ZB-12, ZB-20, ZB-22, ZB-23, ZB-26, ZB-27, ZB-28, ZB-29, ZB-31, ZB-32, ZB-33, ZB-34 |
| Low | 4 | ZB-25, ZB-30, ZB-35, ZB-36, ZB-37 |

(Totals: 37 findings.)

---

## Complete findings list

1. **ZB-01 (Critical/Scaling):** SSE endpoint DB-polls every 2s for 60s per connection — unviable on Vercel serverless; exhausts function-hours and the DB pool.
2. **ZB-02 (Critical/Scaling):** `pg` pool `max:10` per serverless instance → hundreds of backend connections under load.
3. **ZB-03 (High/Concurrency):** Rate limiter is non-atomic (get-then-incr TOCTOU) and a fixed — not sliding — window.
4. **ZB-04 (High/Cost):** ~4 Redis commands per rate-limit check → blows Upstash free-tier budget and adds latency.
5. **ZB-05 (High/Security):** `getClientIp` trusts spoofable left-most `X-Forwarded-For` → IP rate-limit/ban bypass.
6. **ZB-06 (High/Financial):** Ledger re-reads inserted row by `ORDER BY created_at DESC`; `NOW()` is constant in a transaction → wrong row returned. Use `RETURNING`.
7. **ZB-07 (Medium/Financial):** Decimal written via `.toNumber()` to BIGINT — precision loss above 2^53.
8. **ZB-08 (Critical/Accounting):** Creator gifts credit both `coin_balance` and `available_earnings_kobo` → value granted twice.
9. **ZB-09 (High/Integrity):** `.catch(()=>{})` inside transactions poisons the aborted Postgres transaction.
10. **ZB-10 (Critical/Re-entrancy):** Batch payouts lack `FOR UPDATE SKIP LOCKED`/atomic claim → overlapping runs double-pay.
11. **ZB-11 (Medium/Resilience):** Payout retry backoff has no jitter → synchronized retry herd.
12. **ZB-12 (Medium/Financial):** `processing` payouts never reconciled if the webhook is lost → funds stuck.
13. **ZB-13 (Critical/Auth):** `withAuth` checks only the Redis session, never DB `is_banned`/`is_suspended`/`deleted_at`.
14. **ZB-14 (Critical/Auth):** Login does not check ban/suspension → banned users re-login freely.
15. **ZB-15 (High/Recovery):** Self-deletion wipes all identifiers, no grace window → no reactivation after lost access.
16. **ZB-16 (High/Auth):** Self-deletion doesn't invalidate sessions → deleted user keeps access/refresh.
17. **ZB-17 (High/Payment):** `coins/transfer` & `gifts/send` lack idempotency and rate limiting → double-spend on retry.
18. **ZB-18 (High/SSRF):** SSRF guard validates hostname string only → DNS-rebinding bypass.
19. **ZB-19 (High/XSS):** Announcements/footer scripts rendered via `dangerouslySetInnerHTML` unsanitized; no CSP.
20. **ZB-20 (Medium/Hardening):** Missing CSP, HSTS, Permissions-Policy headers.
21. **ZB-21 (High/Payment):** Webhooks return 200 on processing errors → provider won't retry → user paid but uncredited.
22. **ZB-22 (Medium/Payment):** Webhook credits provider-supplied `coinsGranted` instead of re-deriving from `packId`.
23. **ZB-23 (Medium/Scaling):** Edge middleware HTTP-fetches `/api/auth/refresh` per token-less request.
24. **ZB-24 (High/Security):** No refresh-token rotation / reuse detection — stolen token valid 30 days.
25. **ZB-25 (Low/Auth):** Refresh mints default (non-admin) TTL and stale `is_admin` from the session.
26. **ZB-26 (Medium/SEO):** Sitemap lists auth-gated `(app)` routes and uses `username` on a `[userId]` route.
27. **ZB-27 (Medium/Scaling):** Offset pagination on user-facing lists → deep-page scans, skip/dupe under churn.
28. **ZB-28 (Medium/Thundering herd):** Manifest cache has no single-flight; `getManifestValue` bypasses cache on hot paths.
29. **ZB-29 (Medium/Scaling):** `redis.keys(pattern)` O(N) blocking scan exposed/used.
30. **ZB-30 (Low/Security):** `CRON_SECRET` compared non-constant-time.
31. **ZB-31 (Medium/Financial — verify):** DLQ restores `gross_kobo`; confirm it equals what was debited.
32. **ZB-32 (Medium/Data loss):** SSE cursor `created_at > $cursor` strict comparison skips same-timestamp messages.
33. **ZB-33 (Medium/Privacy):** Service worker caches `GET /api/*` → stale/authenticated data served from cache.
34. **ZB-34 (Medium/Financial):** Referral commissions bypass locked `creditCoins`; shallow self/cycle protection.
35. **ZB-35 (Low/Robustness):** `ROLLBACK` in catch can mask the original error.
36. **ZB-36 (Low/Dead code):** Middleware forwards identity headers no handler reads and doesn't strip inbound copies on public routes.
37. **ZB-37 (Low/i18n):** Verify locale key parity and that RTL is actually applied app-wide.

---

## What is already done well

Clean, swappable provider abstractions (db / redis / realtime / storage) with a typed `DatabaseAdapter` interface; centralized Zod env validation that fails fast; an append-only `coin_ledger`/`star_ledger` with `SELECT FOR UPDATE`; Decimal.js arithmetic; HMAC-SHA512 webhook signature checks with idempotency guards keyed on a UNIQUE `provider_reference`; admin authorization that re-checks `is_admin` against the DB (not just the JWT); AES-256-GCM field encryption with random IV + auth tag; CSRF state tokens, SSRF allow-listing scaffolding, captcha abstraction, and a payout dead-letter queue with creator/admin notifications. The intent and structure are mature — the defects are concentrated and fixable, not architectural.

---

## Rating & Review

**Current implementation: 6.0 / 10.**
The skeleton is well-architected and security-aware, but a cluster of **money-correctness and re-entrancy defects** (ZB-06, ZB-08, ZB-09, ZB-10, ZB-17, ZB-34) and **weak account-status enforcement** (ZB-13/14/15/16) are serious for a monetised platform, and the **serverless-fit issues** (ZB-01/02/03/04) conflict directly with the stated zero-cost Vercel Hobby + thousands-of-concurrent-users goal.

**Projected after all recommended fixes: 8.5–9.0 / 10.**
Every finding has a concrete, contained remedy and none require re-architecting. Fixing money/auth correctness first, then re-platforming realtime + rate-limiting + pooling for serverless, then SEO/i18n/hardening polish, yields a secure, scalable, cost-appropriate system suitable for the target hosting and load.

**Recommended order:** Phase 1 (financial integrity) → Phase 2 (auth/sessions/recovery) → Phase 3 (serverless scaling) → Phase 4 (web hardening) → Phase 5 (SEO/i18n/UX). See `custom-bugs-fix-plan.md`.

---

*Final report generated 2026-06-12 12:51 PM UTC — Zobia Social forensic audit. No code was modified; awaiting your approval of the fix plan before any changes are made.*
