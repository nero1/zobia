# Zobia Codebase — Bug Fix Plan

**Generated:** June 13, 2026 02:57 PM  
**Companion to:** `custom-bugs-report.md` (60 findings, BUG-01 … BUG-60)  
**Status:** AWAITING REVIEW — do not implement until approved.

This plan sequences fixes by risk and dependency. Each phase is independently shippable. Effort: S = <1h, M = a few hours, L = a day+. IDs map 1:1 to the report.

---

## Phase 0 — Pre-work (do first, unblocks everything)

- **P0.1** Reproduce on a staging DB. Load `001_complete_schema.sql`, seed, and stand up the web app + a dev Expo build pointing at staging so each fix can be verified end-to-end.
- **P0.2** Decide canonical conventions several fixes depend on:
  - Expo API path convention (BUG-02): **recommend** paths relative without `/api`, with `baseURL = API_BASE_URL + '/api'`.
  - Single XP award helper + single XP ledger table (BUG-06, BUG-24): **recommend** `xp_ledger`.
  - Single notification content shape (BUG-25): **recommend** structured `payload` + optional `title`/`body`.
  - PIN enforcement model (BUG-17, BUG-29): **recommend** short-lived signed "PIN-verified" claim in Redis.
- **P0.3** Add a CI assertion that every `ON CONFLICT (...)` target has a matching unique index (would have caught BUG-07 and BUG-39 automatically).

---

## Phase 1 — Critical: shipping-blocker and money-loss bugs (ship ASAP)

| ID | Fix | Effort |
|----|-----|--------|
| BUG-01 | Add an explicit `room_entry` branch in `processChargeSuccess` before the coin path that marks the payment `completed` and returns. Guard the coin path to skip `creditCoins` when `serverCoinsGranted <= 0`. | M |
| BUG-02 | Standardize Expo API path convention (per P0.2). Set `baseURL = API_BASE_URL + '/api'`. Fix the ~65 non-conforming call sites. Correct `/messages/conversations/*` → `/messages/dm/*`. Add a request-wrapper lint that rejects non-conforming paths. | L |
| BUG-03 | Route offline sync by stored conversation type to `/messages/dm/${id}` or `/messages/group/${id}`. Call `retryFailedMessages()` on reconnect before draining the queue. Add a per-message client idempotency key. | M |
| BUG-04 | Add `starsGranted?: number` to `DodoPaymentsMetadata` type. Populate it in the checkout creation flow. Change the `creditStars` call in the `star_pack` branch to use `metadata.starsGranted ?? 0`. | S |

**Exit criteria:** A paid drop-room user can join; a fresh Expo build hits every screen's API; offline messages deliver and retry; DodoPayments star pack purchases award the correct number of stars.

---

## Phase 2 — High: security and critical correctness

| ID | Fix | Effort |
|----|-----|--------|
| BUG-05 | Only call `finishTransactionAsync` after confirmed server credit. On transient/unknown failure leave the purchase unconsumed for Google Play replay. Distinguish "invalid" (consume) vs "transient" (keep) by server status code. | M |
| BUG-06 | Introduce `awardXp(action, ctx, opts)` that calls `calculateFinalXP` and persists real `multiplier`/`base_amount` in basis points. Repoint all room/DM message XP awards through it. | L |
| BUG-07 | Fix CRON section 5b to use real `leaderboard_rank_snapshots` columns (`xp`, `snapped_at`). Either add a `season_id` column with `UNIQUE(user_id, scope, season_id)` or encode season into `scope`. Reconcile with section 14. Also fix BUG-39 in the same pass: align `ON CONFLICT` to `(user_id, badge_key)`. | M |
| BUG-08 | Replace get-then-set with `redis.set(key, "1", "EX", ttl, "NX")` before the daily-login transaction. Defensively set `xpAwarded = 0` when `lastLogin === today`. | S |
| BUG-09 | Add `onUnauthenticated` event bus or callback. AuthProvider subscribes to it. Interceptor invokes it after clearing storage so `signOut()` runs and router redirects to login. | S |
| BUG-10 | Register one global Google Play purchase listener at app init resolving via a `Map<productId|orderId, resolver>`. Always finish processed transactions. Purchase functions register/await a resolver instead of re-installing the listener. | M |
| BUG-11 | Encrypt `totp_secret` with `encryptField` on write and `decryptField` on read in all TOTP routes. Write a one-time migration to encrypt existing rows. Confirm the encryption key env var is set in all environments. | M |
| BUG-12 | Track the last accepted TOTP counter per user in Redis (`totp:used:{userId}:{code}` with 90s TTL). Reject any code already present in that key. Apply to both the admin path and the user 2FA verify path. | S |
| BUG-13 | Pass `ADMIN_REFRESH_TOKEN_TTL_SECONDS` as the second argument to `buildCookieHeaders` in the admin TOTP login route. Confirm the refresh route for admin already does this. | S |
| BUG-14 | Replace the broad Bearer token CSRF exemption with a dedicated `x-service-token` header checked against an environment variable. Scope the exemption to specific non-user-facing paths (`/api/cron/*`) rather than the full API surface. | M |
| BUG-15 | In `createSession()`, before calling `EXPIRE` on `userSessionsKey`, check its current `PTTL`. Only update the TTL if the new TTL would extend it (not shrink it). Or: always set the set key TTL to 30 days since it is an index, not a secret. | S |

**Exit criteria:** IAP failure leaves purchase unclaimed for retry; Max-plan messaging XP reflects the multiplier; Sunday snapshot runs; daily-login XP cannot be farmed; failed mobile refresh redirects to login; no hung/stuck purchases; TOTP seeds encrypted at rest; TOTP codes non-replayable; admin cookie lifetime matches Redis session; CSRF check not bypassable via Bearer; session set not prematurely evicted.

---

## Phase 3 — Medium: reliability, idempotency, and security hardening

| ID | Fix | Effort |
|----|-----|--------|
| BUG-16 | Add `PEXPIRE` call on `userSessionsKey` within `refreshAccessToken()` to extend it to at least the session's remaining TTL each refresh. | S |
| BUG-17 | Mint a short-lived PIN-verified claim in `/auth/pin/verify` (Redis key `pin_ok:{uid}` with 5-minute TTL). Require it in payout, transfer, gift, and store mutations server-side before any balance mutation. | M |
| BUG-18 | Stream the `safeFetch` response body through a size-counting reader. Abort the connection and throw `SSRFError` once accumulated bytes exceed `maxResponseBytes`. Remove reliance on `Content-Length` header alone. | S |
| BUG-19 | Resolve once (A+AAAA), validate both, pin the connection to the resolved IP. Re-validate per redirect hop. Remove the separate DNS call from `validateOutboundUrl` and the separate `fetch` call that re-resolves. | M |
| BUG-20 | Lock both user rows in deterministic ascending `id` order in `transferCoins` and gift-send before mutating either balance, regardless of transfer direction. Retry once on `SQLSTATE 40P01`. | S |
| BUG-21 | Unify monthly bonus dedup on `plan:{userId}:{YYYY-MM}` across webhook and CRON. Check both `subscription_bonus` and `monthly_plan_bonus` transaction types for the same period. Swallow unique violations from `subscription.create` as "already processed." | M |
| BUG-22 | Write an explicit `comeback_bonus_claimed` ledger row (or set `claimed_at` column) in the same transaction as the credit. Have both the claim guard and the expiry CRON check for it. Time-scope the reservation reference. | S |
| BUG-23 | Replace hand-rolled regex HTML sanitizer with `sanitize-html` or DOMPurify. If that is not possible: decode HTML entities and strip control chars before the scheme test; allow only `https`/`mailto`; add `rel="noopener noreferrer"` to `target=_blank` links. | M |
| BUG-24 | Consolidate `xp_events` into `xp_ledger`. Write a migration. Repoint gift/transfer routes to write `xp_ledger`. Funnel all XP awards through the `awardXp()` helper from BUG-06. Delete any remaining inline `xp_total = xp_total + N` raw SQL updates. | M |
| BUG-25 | Standardize notification content on structured `payload` + optional `title`/`body`. Write a migration to normalize existing rows. Update all writers. Read API selects all fields. Compute `unreadCount` via `SELECT COUNT(*) WHERE is_read = false`. | M |
| BUG-26 | Add `SELECT … FOR UPDATE` on the quest_progress row at the start of `checkDeckCompletion()`. Wrap the check-and-award in a transaction so only one concurrent call can award the bonus. | S |
| BUG-27 | Change room messages pagination to a compound cursor `(created_at, id)`. Return both as the cursor token. Query with `(created_at, id) < ($cursor_ts, $cursor_id)` using a row-value comparison. | S |
| BUG-28 | Add a separate `last_login_at` column updated only on explicit auth token creation. Use `last_login_at::date = yesterday` as the streak increment condition in the CRON. | M |
| BUG-29 | Add an escalating per-user PIN lockout in Redis (exponential cooldown; require re-auth/2FA after N total failures). Consider upgrading to 6-digit PINs at the same time. | M |
| BUG-30 | Remove `'unsafe-inline'` from `script-src` in `buildCsp()`. Verify all inline scripts in the Next.js app correctly use the `x-nonce` forwarded header. Test on Chrome, Firefox, and Safari. | S |

---

## Phase 4 — Low: polish, defense-in-depth, and code quality

| ID | Fix | Effort |
|----|-----|--------|
| BUG-31 | In `attemptTransfer`, verify by stored `provider_reference` (the `transfer_code`) before re-initiating. Fall back to the reference only when no code is recorded. | S |
| BUG-32 | Catch `SQLSTATE 23505` from `creditCoins` in IAP verify and return a clean 409 `PURCHASE_ALREADY_PROCESSED`. Alternatively, move the idempotency SELECT inside the credit transaction. | S |
| BUG-33 | Replace first-octet private-IP check in `geoAnomaly.ts` with full CIDR range comparison, mirroring the existing logic in `ssrf.ts`. | S |
| BUG-34 | Add a shared `parsePositiveInt(value, default, max)` utility or `z.coerce.number().int().min(1).max(...)` query schema. Apply it everywhere pagination/limit params are read from search params. | S |
| BUG-35 | Add `TRUSTED_PROXY_COUNT` env var. Extract the correct IP from `X-Forwarded-For` by counting `TRUSTED_PROXY_COUNT` entries from the right. Document the Vercel-first priority clearly. | S |
| BUG-36 | Apply the CSRF origin check to state-changing `/api/auth/*` POSTs (logout, refresh). Continue allowing GET OAuth callback URLs without origin check. | S |
| BUG-37 | Restrict `media_url`/`thumbnail_url` to the configured storage/CDN host(s) via an allowlist in the Zod schema. Or add a signed-upload endpoint using the existing storage adapters and persist only controlled keys. | M |
| BUG-38 | Remove the no-op `UPDATE moments SET expires_at = expires_at WHERE ...` from CRON section 7. Use `DELETE ... RETURNING id` and log the count of deleted rows. | S |
| BUG-39 | (Addressed alongside BUG-07 in Phase 2.) Align `ON CONFLICT` in the badge INSERT to `(user_id, badge_key)` or add the missing unique index. | S |
| BUG-40 | In `verifyCaptcha()`, treat "provider not configured" as a hard failure (`return false`) in production. Fail closed when the manifest read errors rather than logging a warning and returning `true`. | S |
| BUG-41 | Add a block-relationship check in gift-send and coin-transfer (both directions) before debiting. Return 403 `USER_BLOCKED`. | S |
| BUG-42 | Require an explicit "link account" confirmation before auto-linking a Google email to an existing account. Include `is_banned`, `is_suspended`, `deleted_at` in the new-user INSERT `RETURNING` clause. | M |
| BUG-43 | Change `seasonTransitions.ended = season.id` to `seasonTransitions.ended.push(season.id)` inside the CRON season-transition loop. Ensure downstream processing iterates over the full array. | S |
| BUG-44 | Await `createSeasonCeremonyRoom(season.id)` and propagate errors (allowing the CRON to retry), or wrap in try/catch and log the failure with full context. Remove `void`. | S |
| BUG-45 | Replace the raw negative-amount SQL in comeback coin reversal with a call to `debitCoins(userId, amount, "comeback_reversal", ...)`. Thread the transaction client parameter through as needed. | S |
| BUG-46 | In `distributeSeasonRewards()`, detect when top user count is below 4 and redistribute unallocated pool shares to existing winners proportionally, or transfer them to a season reserve wallet rather than discarding. | M |
| BUG-47 | Add a status index to the IndexedDB store in `messageQueue.ts`. Filter `getPendingMessages()` on `status === 'pending'` in the cursor loop. Add a `retryFailed()` function that resets `'failed'` messages to `'pending'` up to a configurable retry count cap. | S |
| BUG-48 | Replace the per-row INSERT loop in `insertNotificationBatch()` with a single parameterized bulk INSERT. Chunk at ~500 rows per statement to avoid parameter count limits. | S |
| BUG-49 | Add `URL_REGEX.lastIndex = 0` and `EMAIL_REGEX.lastIndex = 0` at the top of `stripContactInfo()` before any `.replace()` call. Or switch to non-global regex literals with `replaceAll()`. | S |
| BUG-50 | Remove `amount_kobo` from the `reconcileStuckPayouts` row interface since it is never selected. Audit whether `gross_kobo` is the correct field for the reconciliation logic or whether `amount_kobo` should be added to the SELECT. | S |
| BUG-51 | Map the `userPlan` value to a numeric constant (days limit) in application code and pass that number as a `$N` parameter in the DM history query. Remove the string interpolation entirely. | S |
| BUG-52 | In the DM route, when `stripContactInfo()` returns an empty string, reject with a 400 error ("Message content was removed by content filters") or replace with `[Message removed by content filter]`. Do not store null. | S |
| BUG-53 | Before inserting a DM, query the block relationship table for `blocker_id = recipientId AND blocked_id = senderId`. Return a 403 or a generic 400 that does not reveal block status to the sender. | S |
| BUG-54 | Change all XP ledger INSERTs to use basis-point multiplier representation (store `100` for 1×, `150` for 1.5×). Audit all `xp_ledger` INSERT sites for consistency. This is naturally resolved when BUG-06 and BUG-24 are implemented via the single `awardXp()` helper. | S |
| BUG-55 | Add a try/catch inside `decryptField()`. Return `null` on AES-GCM authentication failure or throw a typed `DecryptionError`. Log the field name (not value) on failure. Update callers to handle the null/error return. | S |
| BUG-56 | Audit the Paystack subscription metadata schema for `starsGranted`. If present for star-pack plans, add a `creditStars()` call in `processSubscriptionEvent()` analogous to the coin_pack path. Align with the DodoPayments handler post-BUG-04. | M |
| BUG-57 | Remove `randomUUID()` suffix from the coin purchase idempotency key. Make it deterministic as the comment states (`${userId}-${packId}-${dayPrefix}`). Fix the DB deduplication check to match the now-stable key pattern. | S |
| BUG-58 | In the Google OAuth username fallback, `.slice(0, DB_USERNAME_MAX_LENGTH - suffixLength)` before appending the random suffix. Derive `DB_USERNAME_MAX_LENGTH` from the schema column definition. | S |
| BUG-59 | Simplify `filterPublicContent(content, isAdmin && !blockLinks)` in the DM route to a single clear boolean that expresses the intent directly without redundant double-admin layering. | S |
| BUG-60 | Consolidate the three per-plan monthly bonus DB transactions into a single transaction. If a single large transaction is a concern, add error handling so partial failures are detected and the full batch retried. | S |

---

## Cross-cutting follow-ups (recommended after the above)

- **Single XP pipeline:** Once BUG-06 and BUG-24 land, delete all remaining inline `xp_total = xp_total + N` updates so no route can hand-roll XP again. Add a CI lint.
- **Notification schema lint:** Add a CI check that all `INSERT INTO notifications` use the canonical column set defined in BUG-25.
- **Schema/ON CONFLICT lint:** A script asserting every `ON CONFLICT (...)` target has a matching unique index (addresses BUG-07 and BUG-39 class of issues at the source).
- **Idempotency audit:** Confirm every external-money credit path passes a stable, operation-scoped `reference_id` so the partial-unique indexes are the real backstop.
- **Paystack webhook signature return code:** Also review all other webhook handlers to confirm they all return HTTP 200 on signature failures (per BUG-01 pattern) rather than 4xx codes that trigger retries.

---

## Suggested Sequencing Summary

| Phase | Focus | Estimated Time |
|---|---|---|
| Phase 0 | Pre-work + conventions | 0.5 day |
| Phase 1 | Critical blockers | 1–2 days |
| Phase 2 | High security + correctness | 2–3 days |
| Phase 3 | Medium reliability | 2 days |
| Phase 4 | Low polish | 1 day |
| **Total** | | **~7–9 days** |

Phases 1 and 4 can run in parallel with different owners. Phase 3's BUG-24 depends on Phase 2's BUG-06. Phase 2's BUG-07 and BUG-39 can be done in one pass.

---

*Fix plan for 60 findings. Generated June 13, 2026 02:57 PM. Awaiting your review before any code changes are made.*
