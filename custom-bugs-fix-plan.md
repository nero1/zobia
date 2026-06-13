# Zobia Social — Custom Bug Fix Plan

**Generated:** Saturday, June 13, 2026 — 12:36 AM (UTC)
**Companion to:** `custom-bugs-report.md` (34 findings, ZBX-01 … ZBX-34)
**Status:** AWAITING REVIEW — do not implement until approved.

This plan sequences the fixes by risk and dependency. Each phase is independently shippable. Effort is rough (S ≈ <1h, M ≈ a few hours, L ≈ a day+). IDs map 1:1 to the report.

---

## Phase 0 — Pre-work (do first, unblocks everything)

- **P0.1 Reproduce on a staging DB.** Load `001_complete_schema.sql`, seed, and stand up the web app + a dev Expo build pointing at staging so each fix can be verified end-to-end.
- **P0.2 Decide the canonical conventions** that several fixes depend on:
  - Expo API path convention (ZBX-02): **recommend** paths relative *without* `/api`, with `baseURL = API_BASE_URL + '/api'`.
  - Single XP award helper + single XP ledger table (ZBX-05, ZBX-17): **recommend** `xp_ledger`.
  - Single notification content shape (ZBX-19): **recommend** structured `payload` + optional `title`/`body`.
  - PIN enforcement model (ZBX-11/21): **recommend** a short-lived signed "PIN-verified" claim.
- **P0.3 Add regression tests first** for the money paths touched in Phase 1 (drop-room entry, IAP, daily login) so fixes are provably correct. *(Test work itself is out of scope per the brief, but a few targeted ones de-risk the money changes.)*

---

## Phase 1 — Critical / money-loss & broken-flow blockers (ship ASAP)

| ID | Fix | Effort |
|----|-----|--------|
| ZBX-01 | Add a `room_entry` branch to `processChargeSuccess` (mark payment `completed`, no coin credit, optional creator-earnings, `return`) before the coin path; guard the coin path to skip `creditCoins` when `serverCoinsGranted <= 0`. | M |
| ZBX-02 | Standardize the Expo API path convention (per P0.2); set `baseURL` accordingly and fix the ~65 non-conforming call sites; correct `/messages/conversations/*` → `/messages/dm/*`. Add a thin request wrapper that asserts the path shape. | L |
| ZBX-03 | Route offline sync by stored conversation type to `/messages/dm/${id}` or `/messages/group/${id}` (with the agreed prefix); call `retryFailedMessages()` on reconnect before draining; add a per-message client idempotency key. | M |
| ZBX-04 | Only `finishTransactionAsync` after a confirmed server credit; on transient/unknown failure leave the purchase unconsumed for Google-Play replay; classify "invalid" vs "transient" by server status. | M |
| ZBX-06 | Fix CRON section 5b to the real `leaderboard_rank_snapshots` columns (or add `season_id` + `UNIQUE(user_id, scope, season_id)`); reconcile with section 14. | M |
| ZBX-07 | Replace get-then-set with `redis.set(key,"1","EX",ttl,"NX")` before the daily-login transaction; defensively zero `xpAwarded` when `lastLogin === today`. | S |

**Exit criteria:** a paid drop-room user can join; a fresh Expo build can hit every screen's API; offline messages deliver and retry; an IAP that fails server-side is retried (not lost); the Sunday snapshot succeeds; daily-login XP cannot be farmed by parallel requests.

---

## Phase 2 — High-impact correctness & security

| ID | Fix | Effort |
|----|-----|--------|
| ZBX-05 | Introduce `awardXp(action, ctx, opts)` that calls `calculateFinalXP` and persists real `multiplier`/`base_amount`; repoint room/DM message routes (and other inline-XP routes) through it. | L |
| ZBX-08 | Add an `onUnauthenticated` bus/callback; interceptor invokes it after clearing storage so `AuthContext.signOut()` runs and routes to login. | S |
| ZBX-09 | Register one global Google-Play purchase listener at init resolving via a `Map`; always finish processed transactions; purchase fns register/await a resolver. | M |
| ZBX-10 | Encrypt `totp_secret` with `encryptField`/`decryptField` in all TOTP routes; migrate existing rows; confirm key env var. | M |
| ZBX-11 | Mint a short-lived PIN-verified claim in `/auth/pin/verify`; require it in payout/transfer/gift/store mutations server-side. | M |
| ZBX-12 | Stream-count the `safeFetch` body and abort past `maxResponseBytes` instead of trusting `Content-Length`. | S |
| ZBX-13 | Resolve once (A+AAAA), validate, and pin the connection to the resolved IP; re-validate per redirect hop. | M |
| ZBX-14 | Lock both user rows in deterministic id order in `transferCoins`/gift-send; retry once on deadlock (`40P01`). | S |
| ZBX-18 | Replace the regex sanitizer with `sanitize-html`/DOMPurify (or decode-entities + control-char strip + scheme allowlist); add `rel="noopener noreferrer"`. | M |

**Exit criteria:** Max-plan messaging XP reflects the multiplier; a failed mobile refresh redirects to login; no hung/stuck purchases; TOTP seeds encrypted at rest; PIN actually gates payouts/transfers server-side; SSRF body bounded and rebinding-resistant; no transfer deadlocks; announcement HTML is XSS-safe.

---

## Phase 3 — Consistency, idempotency & moderate hardening

| ID | Fix | Effort |
|----|-----|--------|
| ZBX-15 | One authoritative monthly-bonus path keyed `plan:{userId}:{YYYY-MM}`, deduped across `subscription_bonus`/`monthly_plan_bonus`; make `subscription.create` swallow the unique violation. | M |
| ZBX-16 | Write a real `comeback_bonus_claimed` marker (or `claimed_at`) in the credit transaction; both guards test it; time-scope the reservation reference. | S |
| ZBX-17 | Consolidate `xp_events` into `xp_ledger`; migrate + repoint gift/transfer routes through `awardXp` (depends on ZBX-05). | M |
| ZBX-19 | Standardize notification shape; backfill; update writers; read API selects all fields; `unreadCount` via dedicated `COUNT(*)`. | M |
| ZBX-20 | Pass `ADMIN_REFRESH_TOKEN_TTL_SECONDS` to `buildCookieHeaders` in the admin TOTP login. | S |
| ZBX-21 | Escalating per-user PIN lockout in Redis; require re-auth/2FA after N failures; consider 6-digit. | M |
| ZBX-22 | Verify payouts by stored `provider_reference` (transfer_code), falling back to reference only when absent. | S |
| ZBX-23 | Catch `23505` from `creditCoins` in IAP verify → return clean 409. | S |

---

## Phase 4 — Low-severity polish & defense-in-depth

| ID | Fix | Effort |
|----|-----|--------|
| ZBX-24 | Full-range private-IP check in `geoAnomaly` (reuse `ssrf.ts` integer logic). | S |
| ZBX-25 | Shared `parsePositiveInt`/`z.coerce` for all pagination/limit params. | S |
| ZBX-26 | Make trusted-proxy depth explicit in `getClientIp`, or require `x-real-ip`. | S |
| ZBX-27 | Apply CSRF Origin check to `/api/auth/*` POSTs (allow OAuth GET callbacks). | S |
| ZBX-28 | Allowlist media host(s) or add a signed-upload endpoint via the storage adapters. | M |
| ZBX-29 | Remove the no-op moments `UPDATE`; count via DELETE `RETURNING`. | S |
| ZBX-30 | Align `user_badges` `ON CONFLICT` with `badge_key` (or add the missing unique index). | S |
| ZBX-31 | CAPTCHA fails closed in production when unconfigured/manifest-read fails; enforce v3 score. | S |
| ZBX-32 | Block-relationship check in gift-send and coin-transfer (403 `USER_BLOCKED`). | S |
| ZBX-33 | Require explicit account-link confirmation for Google email match; add missing columns to INSERT `RETURNING`. | M |
| ZBX-34 | Track last-used TOTP counter per user; reject replays. | S |

---

## Cross-cutting follow-ups (recommended after the above)

- **Single XP pipeline:** once ZBX-05/17 land, delete the inline `xp_total = xp_total + N` updates entirely so no route can hand-roll XP again.
- **Idempotency audit:** confirm every external-money credit path (`creditCoins`/`creditStars`) passes a stable, operation-scoped `reference_id` so the partial-unique indexes are the real backstop (gift-send currently passes `null` refs — acceptable since gifts are guarded by the Redis idempotency key, but worth documenting).
- **Notification + ledger shape lint:** add a CI check that all `INSERT INTO notifications`/`xp_ledger` use the canonical column set.
- **Schema/`ON CONFLICT` lint:** a quick script asserting every `ON CONFLICT (...)` target has a matching unique index would have caught ZBX-06 and ZBX-30 automatically.

## Suggested sequencing summary

1. Phase 1 (P1) — unblock paid/core flows (1–2 days).
2. Phase 2 (P2) — security + the XP multiplier (2–3 days).
3. Phase 3 (P3) — consistency/idempotency (1–2 days).
4. Phase 4 (P4) — polish (1 day).

Phases 1 and 4 can run in parallel with different owners; Phase 3's ZBX-17 depends on Phase 2's ZBX-05.

---

*Fix plan for 34 findings. Generated Saturday, June 13, 2026 at 12:36 AM (UTC). Awaiting your review before any code changes are made.*
