# Zobia Social — Bug Fix Plan

**Generated:** 2026-06-21 at 07:56 PM  
**Based on:** `custom-bugs-report.md` (50 bugs, same session)  
**Status:** PLAN ONLY — no code changes have been made. Await developer review before implementation.

---

## How to Use This Plan

Each task below maps 1:1 to a numbered bug in `custom-bugs-report.md`. Tasks are grouped into priority tiers. Within each tier, items are ordered roughly from lowest-risk to highest-risk change. Dependencies between tasks are noted inline.

Suggested workflow:
1. Review `custom-bugs-report.md` to understand each bug in full.
2. Work through **Tier 1** (critical security + data-integrity) first, in a single focused sprint.
3. Run the test suite + type-check after each tier.
4. Commit and deploy Tier 1 before starting Tier 2.

---

## Priority Tiers

### Tier 1 — Critical (Security, Data Integrity, Financial Correctness)

These must be fixed before the next production release. Each represents either a potential exploit, a data-loss risk, or a financial integrity gap.

| # | Bug Ref | One-liner |
|---|---------|-----------|
| 1 | BUG-RACE-02 | `FOR UPDATE SKIP LOCKED` outside transaction defeats concurrent-safe intent |
| 2 | BUG-RACE-01 | War engine TOCTOU — mutual war declaration race |
| 3 | BUG-AUTH-04 | Restore link is replayable within its TTL |
| 4 | BUG-TRUST-01 | Grace bonus trivially bypasses `send_gift` trust gate |
| 5 | BUG-AUTH-02 | No rate limit on restore initiation |
| 6 | BUG-SECURITY-04 | `isFeatureAvailableForUser` fails open on DB error |
| 7 | BUG-CRON-03 | Reconcile-balances TOCTOU race (balance vs. ledger read) |
| 8 | BUG-AUTH-03 | Auth rate-limit blocks logout — security risk |
| 9 | BUG-SECURITY-05 | Webhook missing `Content-Type` pre-validation |
| 10 | BUG-AUTH-01 | Restore token in URL query string — Referer/history leak |
| 11 | BUG-SECURITY-01 | Field encryption v1→v2 migration never executed |
| 12 | BUG-AI-02 | AI client uses `axios` — bypasses SSRF-safe undici agent |

### Tier 2 — High (Reliability, Observability, Significant Logic Bugs)

Fix in the next sprint after Tier 1 is deployed and stable.

| # | Bug Ref | One-liner |
|---|---------|-----------|
| 13 | BUG-CRON-01 | No `system_alert` for large reconcile discrepancies |
| 14 | BUG-AI-01 | Gemini fallback has no circuit breaker |
| 15 | BUG-MANIFEST-01 | `sessionTtls` manifest values are never consumed |
| 16 | BUG-CRON-02 | `parseInt` for coin values — precision risk |
| 17 | BUG-MANIFEST-02 | Captcha defaults to `"none"` — no bot protection on fresh deploy |
| 18 | BUG-CRON-04 | `daily-core` `maxDuration=10` too short |
| 19 | BUG-OBS-01 | New Relic `trackEvent` is a no-op — events silently dropped |
| 20 | BUG-INFRA-01 | No SIGTERM handler — pool/Redis not drained on shutdown |
| 21 | BUG-SEASON-01 | Ceremony room `ON CONFLICT` may target non-existent expression index |
| 22 | BUG-QUEST-01 | Quest shuffle uses MD5 (predictable) |
| 23 | BUG-MANIFEST-03 | War cooldown ignores manifest key — hardcoded 72h |
| 24 | BUG-DB-02 | No pg pool idle-connection health check / reconnect config |
| 25 | BUG-FRAUD-01 | Gift fraud window hardcoded at 7 days |
| 26 | BUG-CRON-05 | Auto-correct threshold hardcoded at 50 coins |

### Tier 3 — Medium (Performance, Scalability, UX, Developer Experience)

Address in parallel or in a dedicated cleanup sprint.

| # | Bug Ref | One-liner |
|---|---------|-----------|
| 27 | BUG-PERF-01 | No HTTP cache headers on public endpoints |
| 28 | BUG-PERF-02 | `getLeaderboard` falls back to OFFSET on page 1 |
| 29 | BUG-PERF-03 | Memory cache has no size cap |
| 30 | BUG-API-01 | Admin payouts route uses OFFSET pagination |
| 31 | BUG-API-02 | Gift history missing `gift_types` JOIN |
| 32 | BUG-DB-01 | No retention policy for audit/event tables (DB bloat) |
| 33 | BUG-PERF-04 | HoF injection can exceed declared page `limit` |
| 34 | BUG-CRON-06 | Message cleanup retention logic uses snapshot plan (orphan risk) |
| 35 | BUG-ENV-01 | Provider env vars required even when providers disabled |
| 36 | BUG-ANTISPAM-01 | Anti-spam URL regex misses major link domains |
| 37 | BUG-EXPO-01 | Expo patches `global.fetch` — affects third-party libs |
| 38 | BUG-EXPO-02 | Push token registration fire-and-forget with no retry |
| 39 | BUG-EXPO-03 | Telegram polling: fixed 2s interval, no backoff |
| 40 | BUG-SECURITY-08 | Gemini/DeepSeek API key format not validated at startup |

### Tier 4 — Low (Polish, SEO, Accessibility, Minor Clean-up)

These are improvements that don't block shipping but should land before any marketing-launch date.

| # | Bug Ref | One-liner |
|---|---------|-----------|
| 41 | BUG-SEO-01 | SEO metadata reads `process.env` directly |
| 42 | BUG-SEO-02 | LocalBusiness JSON-LD has wrong outer `@type` |
| 43 | BUG-SEO-03 | Missing `robots.txt` and `sitemap.xml` |
| 44 | BUG-I18N-01 | Web app has no i18n layer |
| 45 | BUG-A11Y-01 | Missing `<html lang>` attribute |
| 46 | BUG-SECURITY-02 | No CORS policy on API routes |
| 47 | BUG-SECURITY-03 | No CSP `report-uri` endpoint |
| 48 | BUG-SECURITY-06 | Image `remotePatterns` double-wildcard |
| 49 | BUG-SECURITY-07 | `X-Frame-Options` redundant alongside CSP `frame-ancestors` |
| 50 | BUG-SEASON-02 | `createSeasonCeremonyRoom` uses `console.error` instead of `logger` |

---

## Detailed Fix Tasks

---

### TASK-T1-01 — Fix `FOR UPDATE SKIP LOCKED` outside transaction (BUG-RACE-02)
**File:** `apps/web/lib/xp/safeAwardXP.ts`  
**Steps:**
1. Wrap the entire `SELECT … FOR UPDATE SKIP LOCKED` query and the subsequent for-loop in `retryFailedXPAwards` inside a single `globalDb.transaction(async (tx) => { … })` call so the row locks are held for the full batch-processing duration.
2. All per-row `tx.query(…)` calls within the loop should use the transaction client `tx`, not `globalDb`.
3. The `upsertLeaderboardSnapshot` calls (which intentionally run outside the per-row transaction) remain outside, but the lock+process cycle must be atomic per-batch.
4. Test with two concurrent CRON calls to verify only one processes each row.

---

### TASK-T1-02 — Fix `findWarOpponent` TOCTOU race (BUG-RACE-01)
**File:** `apps/web/lib/guilds/warEngine.ts`  
**Steps:**
1. Add a unique constraint on `guild_wars` for the pair `(LEAST(challenger_guild_id, target_guild_id), GREATEST(challenger_guild_id, target_guild_id))` with a `WHERE status = 'active'` partial index via a new migration.
2. In `findWarOpponent`, remove the pre-check SELECT and rely entirely on the unique constraint to reject duplicates. The `INSERT INTO guild_wars` will raise a unique-violation error on collision; catch that specific Postgres error code (`23505`) and return a "guild already at war" response.
3. Alternatively, if a pre-check is kept for UX reasons, wrap the SELECT + INSERT in a transaction with `SELECT … FOR UPDATE` on both guild rows locked in `ORDER BY id ASC` order to prevent deadlock.

---

### TASK-T1-03 — Make account-restore link single-use (BUG-AUTH-04)
**File:** `apps/web/lib/auth/restore.ts`  
**Steps:**
1. Add a migration: `CREATE TABLE restore_tokens (jti TEXT PRIMARY KEY, used_at TIMESTAMPTZ, expires_at TIMESTAMPTZ NOT NULL)`.
2. In `initiateRestore`, after signing the JWT, insert a row `(jti, NULL, expires_at)` into `restore_tokens`.
3. In `completeRestore`, after verifying the JWT signature and expiry, attempt `UPDATE restore_tokens SET used_at = NOW() WHERE jti = $1 AND used_at IS NULL`. If 0 rows updated, reject with 410 Gone.
4. Add a nightly CRON step to `DELETE FROM restore_tokens WHERE expires_at < NOW()` (can go in `daily-core`).

---

### TASK-T1-04 — Fix trust grace bonus bypass on `send_gift` (BUG-TRUST-01)
**File:** `apps/web/lib/trust/trustScore.ts`  
**Steps:**
1. In `meetsMinimumTrust`, after computing/reading the trust score, add a secondary guard for `send_gift`: if `user.account_age_days < 7 && !user.is_verified`, return `false` regardless of score.
2. Fetch `is_verified` in the `meetsMinimumTrust` query (it's already fetched in `calculateTrustScore` but not in the lighter gate query).
3. Alternatively, raise the `send_gift` threshold to 40 (same as `classroom_creation`) and keep the grace bonus — but the secondary gate approach is safer and more explicit.
4. Ensure the `computeScore` grace-bonus note in comments is updated to reflect that `send_gift` has an additional verification requirement.

---

### TASK-T1-05 — Add rate limiting to account-restore initiation (BUG-AUTH-02)
**File:** `apps/web/lib/auth/restore.ts` (and/or restore API route)  
**Steps:**
1. At the top of `initiateRestore`, call `rateLimit({ key: 'restore:' + email, limit: 3, windowSeconds: 3600 })` using the existing `rateLimit` helper from `lib/security/rateLimit.ts`.
2. If `rateLimit` returns `{ limited: true }`, return 429 before sending the email.
3. Also apply an IP-based rate limit with a generous limit (e.g., 10/hour per IP) as a secondary guard in the API route handler.

---

### TASK-T1-06 — Fix `isFeatureAvailableForUser` fail-open (BUG-SECURITY-04)
**File:** `apps/web/lib/manifest/index.ts`  
**Steps:**
1. In the `isFeatureAvailableForUser` catch block, change the return value from `true` to `false`.
2. Log the error with `logger.error({ err, userId, feature }, '[manifest] Feature gate DB error — denying access')` so it is visible in dashboards.
3. Review all callers to confirm that returning `false` during a transient DB error is acceptable UX (it is: the user gets a temporary "feature unavailable" message rather than unintended access).

---

### TASK-T1-07 — Fix reconcile-balances TOCTOU race (BUG-CRON-03)
**File:** `apps/web/app/api/cron/reconcile-balances/route.ts`  
**Steps:**
1. Wrap the balance-fetch and ledger-sum queries inside a single `BEGIN; SET TRANSACTION ISOLATION LEVEL REPEATABLE READ; … COMMIT;` block (or as a single CTE: `WITH balance AS (SELECT coin_balance FROM users WHERE id = $1), ledger AS (SELECT COALESCE(SUM(amount),0) AS total FROM coin_ledger WHERE user_id = $1) SELECT * FROM balance, ledger`).
2. A single CTE eliminates the TOCTOU window without needing explicit transaction isolation level changes — the CTE snapshot is taken at query start.
3. Remove any code that reads the two values in separate queries.

---

### TASK-T1-08 — Separate logout from auth rate limit (BUG-AUTH-03)
**File:** `apps/web/app/api/auth/logout/route.ts`, `apps/web/lib/security/rateLimit.ts`  
**Steps:**
1. Add a `RATE_LIMITS.logout` entry: `{ limit: 20, windowSeconds: 60 }` (per user ID, not per IP).
2. In the logout route handler, replace the `RATE_LIMITS.auth` call with `RATE_LIMITS.logout` keyed by `userId` from the decoded session.
3. If the user is not authenticated (no valid session to decode), apply a loose IP-based limit (e.g., 5/min) to prevent logout-endpoint abuse, but never block a legitimate authenticated logout.

---

### TASK-T1-09 — Validate `Content-Type` on Paystack webhook (BUG-SECURITY-05)
**File:** `apps/web/app/api/payments/paystack/webhook/route.ts`  
**Steps:**
1. As the first line in the `POST` handler (before any `req.json()` call), check `req.headers.get('content-type')?.includes('application/json')`.
2. If false, return `NextResponse.json({ error: 'Unsupported Media Type' }, { status: 415 })`.
3. Apply the same check to any other webhook endpoints (DodoPayments, etc.) that parse JSON bodies.

---

### TASK-T1-10 — Move restore token out of URL query string (BUG-AUTH-01)
**File:** `apps/web/lib/auth/restore.ts`, restore email template, restore page component  
**Steps:**
1. Change the restore email link to point to a confirmation page (e.g., `/auth/restore`) that shows a "Confirm account restoration" button.
2. Store the token in `sessionStorage` on the page load (extracted from the URL fragment `#token=…` rather than `?token=…` — fragments are not sent in Referer headers).
3. On button click, POST the token from `sessionStorage` to `/api/auth/restore/complete` in the request body.
4. Add `<meta name="referrer" content="no-referrer">` to the restore page as an additional backstop.
5. Combine with TASK-T1-03 (single-use validation) to complete the restore-flow hardening.

---

### TASK-T1-11 — Execute field encryption v1→v2 migration (BUG-SECURITY-01)
**File:** `apps/web/lib/security/fieldEncryption.ts`, new `scripts/migrate-field-encryption.ts`  
**Steps:**
1. Create `scripts/migrate-field-encryption.ts` that: queries all rows with encrypted fields from relevant tables (identify from schema which columns use `fieldEncryption`); calls `migrateFieldEncryption(ciphertext, db)` for each; updates the row with the v2 ciphertext; commits in batches of 100.
2. Run the script in a maintenance window with a DB backup taken first.
3. After confirming all rows are v2, open a follow-up PR to remove the v1 `decrypt` path from `fieldEncryption.ts`.
4. Add a CI assertion (e.g., check that no rows have `v1:` prefix in encrypted columns) to prevent regressions.

---

### TASK-T1-12 — Replace `axios` with SSRF-safe `fetch` in AI client (BUG-AI-02)
**File:** `apps/web/lib/ai/client.ts`  
**Steps:**
1. Remove the `axios` import and dependency from `apps/web/package.json`.
2. Re-implement the DeepSeek and Gemini HTTP calls using native `fetch` (Node 18+ global) with the SSRF-safe undici dispatcher from `lib/security/ssrf.ts` as the `dispatcher` option.
3. Map the Axios response interface to the `fetch` Response interface (`.json()`, status checks, etc.).
4. Run `pnpm install` and verify `axios` is no longer in the lock file for the web app.

---

### TASK-T2-01 — Alert on large reconcile discrepancies (BUG-CRON-01)
**File:** `apps/web/app/api/cron/reconcile-balances/route.ts`  
**Steps:**
1. After determining that a discrepancy exceeds `AUTO_CORRECT_THRESHOLD`, add an `INSERT INTO system_alerts (type, severity, message, metadata, created_at) VALUES ('balance_discrepancy', 'critical', …)` alongside the existing `logger.warn`.
2. Include `userId`, `expectedBalance`, `actualBalance`, and `discrepancy` in the `metadata` JSON.
3. Ensure the `system_alerts` table has an index on `(type, created_at DESC)` for the admin dashboard query.

---

### TASK-T2-02 — Add circuit breaker to Gemini AI client (BUG-AI-01)
**File:** `apps/web/lib/ai/client.ts`  
**Steps:**
1. Extract the existing DeepSeek circuit-breaker logic into a shared `CircuitBreaker` class (or functional utility) in `lib/ai/circuitBreaker.ts`.
2. Instantiate a separate `CircuitBreaker` for Gemini with appropriate thresholds (e.g., 5 failures in 60s → open for 120s).
3. Wrap the Gemini HTTP call path in the circuit breaker: if open, immediately throw `CircuitOpenError` to fall back to the error handler rather than waiting for Gemini's full timeout.
4. Track the circuit state in Redis (key: `cb:gemini:state`) so it persists across serverless function invocations (unlike in-process state which resets on cold start).

---

### TASK-T2-03 — Wire manifest `sessionTtls` into JWT creation (BUG-MANIFEST-01)
**Files:** `apps/web/lib/manifest/index.ts`, `apps/web/lib/auth/jwt.ts`, `apps/web/lib/auth/session.ts`  
**Steps:**
1. In `jwt.ts`, change `createAccessToken` / `createRefreshToken` / `createAdminToken` to accept an optional `ttl: string` parameter. Default to the current hardcoded constants if not provided.
2. In `session.ts` (where tokens are created), fetch `getManifestValue('sessionTtls')` and pass the relevant TTL to the token-creation functions.
3. Handle the case where the manifest value is absent or malformed by falling back to the hardcoded default.
4. Add a startup validation step that checks `sessionTtls` values match the `jose` duration string format (e.g., `/^\d+[smhd]$/`).

---

### TASK-T2-04 — Use `BigInt` / `Decimal` for coin values in reconcile CRON (BUG-CRON-02)
**File:** `apps/web/app/api/cron/reconcile-balances/route.ts`  
**Steps:**
1. Replace `parseInt(row.balance, 10)` with `BigInt(row.balance)` for the balance and ledger sum values.
2. Perform the comparison and discrepancy calculation using `BigInt` arithmetic.
3. Convert back to `Number` only when calling `logger` (which needs serialisable values) or when inserting into `audit_discrepancies` (use string representation for the DB column if it is `numeric`).
4. Alternatively, if Decimal.js is already a dependency, use `new Decimal(row.balance)` for consistency with `coins.ts`.

---

### TASK-T2-05 — Change manifest captcha default to `"turnstile"` (BUG-MANIFEST-02)
**File:** `apps/web/lib/manifest/index.ts`  
**Steps:**
1. Change the default value for `captchaProvider` from `"none"` to `"turnstile"` in the manifest schema defaults.
2. Ensure `TURNSTILE_SITE_KEY` is documented as a required env var in `.env.example`.
3. Update the admin panel to show a warning if `captchaProvider` is set to `"none"` in production.
4. Verify the registration and login flows correctly handle the Turnstile challenge when the provider is set.

---

### TASK-T2-06 — Increase / split `daily-core` maxDuration (BUG-CRON-04)
**File:** `apps/web/app/api/cron/daily-core/route.ts`  
**Steps:**
1. Change `export const maxDuration = 10` to `export const maxDuration = 60` (Vercel Hobby plan maximum for serverless functions).
2. If tasks still exceed 60s on a large dataset, split into separate endpoints: `daily-core-streaks`, `daily-core-moments`, `daily-core-messages`, each with its own `maxDuration = 60` and separate CRON trigger via the external CRON service.
3. Add a `logger.info` with timing breakdowns for each sub-task so you can identify which step grows first.

---

### TASK-T2-07 — Implement New Relic `trackEvent` (BUG-OBS-01)
**File:** `apps/web/lib/monitoring/index.ts`  
**Steps:**
1. Install `newrelic` npm package (or use the New Relic Browser API for client events).
2. In `trackEvent`, after the Sentry call, add `newrelic.recordCustomEvent(eventName, { userId, ...properties })` guarded by `if (typeof newrelic !== 'undefined')` (New Relic agent may not be present in development).
3. Add `NEW_RELIC_LICENSE_KEY` and `NEW_RELIC_APP_NAME` to the env schema in `lib/env.ts` as optional strings.
4. Add a `newrelic.js` configuration file in `apps/web/` per New Relic docs.

---

### TASK-T2-08 — Add SIGTERM handler for graceful shutdown (BUG-INFRA-01)
**File:** `apps/web/lib/db/index.ts` or a new `apps/web/lib/lifecycle.ts`  
**Steps:**
1. Create `lib/lifecycle.ts` that registers `process.on('SIGTERM', ...)` and `process.on('SIGINT', ...)` handlers.
2. In the handler: call `await closeDb()` (already exists in `lib/db/index.ts`), then `await redis.quit()` (from `lib/redis/index.ts`), then `process.exit(0)`.
3. Import `lib/lifecycle.ts` in the Next.js root layout or a server-side instrumentation file so it registers once when the process starts.
4. In Next.js 13+ App Router, the best place is `instrumentation.ts` (the `register()` export) which runs once per server process.

---

### TASK-T2-09 — Verify / add expression index for ceremony room `ON CONFLICT` (BUG-SEASON-01)
**Files:** `apps/web/lib/seasons/seasonEngine.ts`, DB migrations  
**Steps:**
1. Search the migration files for `CREATE UNIQUE INDEX … ON rooms ((metadata->>'season_id'))`.
2. If absent, write a new migration: `CREATE UNIQUE INDEX CONCURRENTLY rooms_season_id_uidx ON rooms ((metadata->>'season_id')) WHERE (metadata->>'season_id') IS NOT NULL;`.
3. Apply the migration to all environments (staging, production) before the season engine code runs.
4. Add a startup sanity-check in the season engine (or a one-time migration guard) that validates the index exists.

---

### TASK-T2-10 — Replace MD5 quest shuffle with CSPRNG (BUG-QUEST-01)
**File:** `apps/web/lib/quests/questEngine.ts`  
**Steps:**
1. Remove the MD5-based shuffle function.
2. Replace with a Fisher-Yates shuffle seeded from `crypto.randomBytes(4).readUInt32BE()` at deck-generation time.
3. Store the shuffled quest IDs (ordered array) in the `daily_quest_decks` table at generation so the order is stable for the day without re-computing the shuffle on each view.
4. Ensure the generation endpoint is idempotent: if a deck already exists for (user_id, date), return the stored order rather than regenerating.

---

### TASK-T2-11 — Read war cooldown from manifest (BUG-MANIFEST-03)
**File:** `apps/web/lib/guilds/warEngine.ts`  
**Steps:**
1. At the top of `findWarOpponent`, add `const cooldownHours = await getManifestValue('wardEventCooldownHours') ?? 72;`.
2. Replace the hardcoded `WAR_COOLDOWN_HOURS` constant usage in the SQL query with the fetched value: `NOW() - INTERVAL '1 hour' * $n` using parameterised queries (pass `cooldownHours` as a bind parameter to avoid SQL injection).
3. Keep `WAR_COOLDOWN_HOURS = 72` as the fallback constant only (used in the `?? 72` above).
4. Remove the `WAR_COOLDOWN_HOURS` constant from the module export if it is not used elsewhere.

---

### TASK-T2-12 — Configure pg pool idle-timeout and keepalive (BUG-DB-02)
**File:** `apps/web/lib/db/index.ts`  
**Steps:**
1. Add `idleTimeoutMillis: 30000` (30s) to the `pg.Pool` constructor options so idle connections are evicted before the proxy's timeout.
2. Add `connectionTimeoutMillis: 5000` to fail fast on a stalled connection attempt.
3. Add `keepAlive: true` and `keepAliveInitialDelayMillis: 10000` to prevent proxy-side idle eviction for actively-held connections.
4. Add a `pool.on('error', (err) => logger.error({ err }, '[db] Idle client error'))` handler so silent pool errors are visible.

---

### TASK-T2-13 — Make fraud detection window configurable (BUG-FRAUD-01)
**File:** `apps/web/lib/fraud/payouts.ts`  
**Steps:**
1. Add `fraudDetectionGiftWindowDays` to the manifest schema with a default of `7`.
2. At the start of `runFraudDetection` (or `processPendingPayouts`), fetch `getManifestValue('fraudDetectionGiftWindowDays')`.
3. Pass it as a bind parameter into the gift-count query: `NOW() - ($n * INTERVAL '1 day')` where `$n` is the fetched value.
4. Document the manifest key in the admin panel configuration guide.

---

### TASK-T2-14 — Make reconcile auto-correct threshold configurable (BUG-CRON-05)
**File:** `apps/web/app/api/cron/reconcile-balances/route.ts`  
**Steps:**
1. Add `reconcileAutoCorrectThreshold` to the manifest schema with a default of `50`.
2. Fetch it at CRON startup before the batch loop.
3. Replace the hardcoded `50` comparison with the fetched value.
4. Combine with TASK-T2-01 (system_alert for large discrepancies) — the alert threshold can also come from a separate manifest key (e.g., `reconcileAlertThreshold`, default `50`) to allow distinct alert and auto-correct thresholds.

---

### TASK-T3-01 — Add HTTP cache headers to read-heavy endpoints (BUG-PERF-01)
**Files:** Leaderboard, quest, store, and public-profile API routes  
**Steps:**
1. For fully public, non-personalised routes (e.g., leaderboard page 1, gift store items): add `Cache-Control: public, s-maxage=60, stale-while-revalidate=300` via `NextResponse.headers.set(...)`.
2. For personalised but slowly-changing routes (own profile, own quest deck): add `Cache-Control: private, max-age=30`.
3. For truly dynamic routes (coin balance, transaction history): keep `Cache-Control: no-store`.
4. Add `Vary: Authorization` on any route that has different responses for authenticated vs. anonymous callers.

---

### TASK-T3-02 — Enforce cursor-only pagination in `getLeaderboard` (BUG-PERF-02)
**File:** `apps/web/lib/leaderboards/engine.ts`  
**Steps:**
1. Remove the OFFSET fallback code path from `getLeaderboard`.
2. For the first page (no cursor), use `ORDER BY score DESC, user_id ASC LIMIT $n` without OFFSET (effectively `OFFSET 0`, but stated explicitly so no OFFSET-scan occurs on future pages).
3. Ensure all callers pass `cursor: null` for the first page, not a page number.
4. Handle the Hall-of-Fame injection as a separate in-memory merge step (see TASK-T3-05).

---

### TASK-T3-03 — Add LRU size cap to in-process memory cache (BUG-PERF-03)
**File:** `apps/web/lib/cache/memory.ts`  
**Steps:**
1. Add a `maxSize: number` option to the cache constructor (default: 1000).
2. After each `set()`, if `cache.size > maxSize`, find and delete the entry with the oldest `expiresAt` (or maintain a FIFO insertion queue for O(1) eviction).
3. For a more robust implementation, replace the custom `Map`-based cache with an LRU-cache package (e.g., `lru-cache` — lightweight, well-tested).
4. Document the maximum memory usage estimate in a comment: `maxSize × avgValueBytes`.

---

### TASK-T3-04 — Replace OFFSET with cursor in admin payouts route (BUG-API-01)
**File:** `apps/web/app/api/admin/payouts/route.ts`  
**Steps:**
1. Change the query parameter from `?page=N` to `?after=<payout_id>`.
2. Update the SQL: `WHERE id > $after ORDER BY id ASC LIMIT $n` (or `id < $before` for reverse-chrono order — pick one consistently).
3. Return `nextCursor` (the last row's `id`) in the response JSON.
4. Update the admin UI payout table component to use `nextCursor` for the "Load More" / "Next Page" button.

---

### TASK-T3-05 — Add `gift_types` JOIN to gift history endpoint (BUG-API-02)
**File:** `apps/web/app/api/economy/gifts/route.ts`  
**Steps:**
1. Add `LEFT JOIN gift_types gt ON gi.gift_type_id = gt.id` to the gift history query.
2. Select relevant columns from `gt` (e.g., `gt.name AS gift_type_name`, `gt.icon_url AS gift_type_icon`).
3. Include these in the JSON response shape.
4. Update the gift history TypeScript response type to include the new fields.

---

### TASK-T3-06 — Add retention policy for audit/event tables (BUG-DB-01)
**Files:** `apps/web/app/api/cron/daily-core/route.ts`, new migration  
**Steps:**
1. Add manifest keys: `auditRetentionDays` (default 365), `eventRetentionDays` (default 90).
2. In `daily-core`, add cleanup steps:
   - `DELETE FROM audit_discrepancies WHERE created_at < NOW() - ($n * INTERVAL '1 day')` using `auditRetentionDays`.
   - `DELETE FROM rank_up_events WHERE created_at < NOW() - ($n * INTERVAL '1 day')` using `eventRetentionDays`.
   - `DELETE FROM xp_events WHERE created_at < NOW() - ($n * INTERVAL '1 day')` using `eventRetentionDays`.
3. Delete in batches (e.g., `LIMIT 1000` per invocation) to avoid long-running deletes.
4. Add `created_at` indexes on these tables if not already present (required for efficient range deletes).

---

### TASK-T3-07 — Fix Hall-of-Fame injection overflowing page limit (BUG-PERF-04)
**File:** `apps/web/lib/leaderboards/engine.ts`  
**Steps:**
1. Change the response shape: return `{ entries: LeaderboardEntry[], hallOfFame: HofEntry[], nextCursor: string | null }`.
2. Fetch the regular leaderboard entries and the HoF entries in parallel (two separate queries).
3. Do NOT merge them into a single array — return them as separate fields. This lets the frontend place the HoF section visually above/below the regular list without confusing pagination.
4. Update all callers (API routes) to expose the new `hallOfFame` field.

---

### TASK-T3-08 — Fix message-history cleanup retention logic (BUG-CRON-06)
**File:** `apps/web/app/api/cron/daily-core/route.ts`, `apps/web/lib/db/schema.ts`  
**Steps:**
1. Add a `retain_until TIMESTAMPTZ` column to the `messages` table via a new migration.
2. Set `retain_until = created_at + INTERVAL '<retention_days> days'` at message creation time, based on the sender's current plan tier.
3. Update the CRON cleanup query to `DELETE FROM messages WHERE retain_until < NOW() LIMIT 1000`.
4. Backfill existing rows with a one-time migration script that computes `retain_until` from `created_at + plan_retention_days` using the current plan (accepting that the backfill is an approximation for historical rows).

---

### TASK-T3-09 — Make provider env vars optional in `env.ts` (BUG-ENV-01)
**File:** `apps/web/lib/env.ts`  
**Steps:**
1. Change `TELEGRAM_BOT_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `PAYSTACK_SECRET_KEY` from `.min(1)` to `.optional()` (or `.min(1).optional()`).
2. In each provider's handler/client (Telegram route, Google OAuth handler, Paystack webhook handler), add a guard at the top: `if (!env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram not configured')`.
3. The startup validation failure is replaced with a runtime 500 error on the specific provider endpoint, which is the correct failure mode.

---

### TASK-T3-10 — Extend anti-spam URL blocklist (BUG-ANTISPAM-01)
**File:** `apps/web/lib/messaging/antispam.ts`  
**Steps:**
1. Add `discord.gg`, `bit.ly`, `t.co`, `tinyurl.com`, `ow.ly`, `chat.whatsapp.com`, `wa.me`, `buff.ly`, and `rebrand.ly` to the blocked-domain list.
2. Move the blocked-domain list to a manifest key `spamBlockedDomains` (string array) so it can be updated without code deploys.
3. Ensure the regex handles both `http://` and `https://` prefixes, and bare domains (without scheme).
4. Add a test case for each newly added domain.

---

### TASK-T3-11 — Scope Expo fetch patch to internal API utility (BUG-EXPO-01)
**File:** `apps/expo/app/_layout.tsx`, new `apps/expo/lib/apiFetch.ts`  
**Steps:**
1. Create `apps/expo/lib/apiFetch.ts` that exports a `apiFetch(url, options)` wrapper applying any needed patches (interceptors, auth headers, etc.).
2. Remove the `global.fetch = patchedFetch` line from `_layout.tsx`.
3. Update all API calls throughout the Expo app to use `apiFetch` instead of `fetch` directly.
4. Verify that third-party SDK calls (Supabase realtime, Expo notifications, etc.) still function correctly after removing the global patch.

---

### TASK-T3-12 — Add retry to Expo push token registration (BUG-EXPO-02)
**File:** `apps/expo/app/_layout.tsx`  
**Steps:**
1. Extract the push token registration logic into a named `async function registerPushToken(maxRetries = 3)` function.
2. Implement exponential backoff: on failure, wait `Math.min(1000 * 2^attempt, 10000)` ms before retrying.
3. On `AppState` change to `'active'` (app foregrounded), re-check whether a push token is registered and retry if not.
4. Surface a silent background error via `logger` (or Sentry) after all retries are exhausted so you know which devices failed registration.

---

### TASK-T3-13 — Add exponential backoff to Telegram login polling (BUG-EXPO-03)
**File:** `apps/expo/app/auth/login.tsx`  
**Steps:**
1. Replace the `setInterval` Telegram poll with a recursive `setTimeout` chain.
2. Start at 2s delay; double on each non-response (up to 15s cap).
3. Reset to 2s immediately on a successful response (token received or definitive failure).
4. After 5 minutes with no response, stop polling and show a "Telegram timed out — try again" message.
5. On cleanup (component unmount), clear the pending `setTimeout`.

---

### TASK-T3-14 — Validate Gemini/DeepSeek API key format at startup (BUG-SECURITY-08)
**File:** `apps/web/lib/ai/client.ts`  
**Steps:**
1. When the manifest value for the Gemini API key is first read (lazy init), validate it against `/^AIza[0-9A-Za-z_-]{35}$/`.
2. For the DeepSeek key, validate against its documented format (typically `sk-…`).
3. If validation fails, `logger.error(…)` and throw during the lazy init so the first AI moderation request fast-fails with a clear error instead of a generic 401 from the upstream provider.
4. Add the format regexes as named constants so they can be updated when key formats change.

---

### TASK-T4-01 — Fix SEO metadata to use `env` singleton (BUG-SEO-01)
**File:** `apps/web/lib/seo/metadata.ts`  
**Steps:**
1. Add `import { env } from '@/lib/env';` at the top of the file.
2. Replace every `process.env.NEXT_PUBLIC_APP_URL` reference with `env.NEXT_PUBLIC_APP_URL`.
3. Run `tsc --noEmit` to confirm no type errors.

---

### TASK-T4-02 — Fix LocalBusiness JSON-LD outer `@type` (BUG-SEO-02)
**File:** `apps/web/lib/seo/metadata.ts`  
**Steps:**
1. Locate `generateLocalBusinessSchema`.
2. Change the outer `"@type": "Thing"` to `"@type": "LocalBusiness"` (or whichever is the correct Schema.org type for the business — `Organization`, `Store`, etc.).
3. Validate the output at `schema.org/LocalBusiness` or via Google's Rich Results Test tool.

---

### TASK-T4-03 — Add `robots.ts` and `sitemap.ts` (BUG-SEO-03)
**Files:** `apps/web/app/robots.ts` (new), `apps/web/app/sitemap.ts` (new)  
**Steps:**
1. Create `app/robots.ts` using the Next.js `MetadataRoute.Robots` type. Disallow `/api/`, `/admin/`, `/auth/`, `/cron/`. Allow `/`, `/p/`, `/u/`, `/g/` (public routes).
2. Create `app/sitemap.ts` using `MetadataRoute.Sitemap`. Statically list the major public routes and dynamically fetch public user/guild slugs (with a reasonable limit, e.g., top 10k by activity).
3. Set `changeFrequency` and `priority` appropriately (home = 'daily', user profiles = 'weekly', etc.).

---

### TASK-T4-04 — Add i18n layer to web app (BUG-I18N-01)
**File:** `apps/web/next.config.js`, `apps/web/app/layout.tsx`, new `messages/en.json`  
**Steps:**
1. Install `next-intl` (zero-config i18n for Next.js App Router).
2. Add `i18n: { locales: ['en'], defaultLocale: 'en' }` to `next.config.js`.
3. Create `messages/en.json` and extract all hardcoded strings from UI components into it.
4. Wrap the root layout with `NextIntlClientProvider`.
5. This is a significant refactor — do it in a dedicated branch and prioritise it after Tier 1–3 are complete. Start with just the framework plumbing and add strings incrementally.

---

### TASK-T4-05 — Add `<html lang="en">` to root layout (BUG-A11Y-01)
**File:** `apps/web/app/layout.tsx`  
**Steps:**
1. Add `lang="en"` to the `<html>` element: `<html lang="en">`.
2. When i18n is added (TASK-T4-04), make this dynamic: `<html lang={locale}>`.
3. One-line change — ship immediately.

---

### TASK-T4-06 — Configure CORS on API routes (BUG-SECURITY-02)
**File:** `apps/web/middleware.ts`  
**Steps:**
1. In the middleware, intercept `OPTIONS` preflight requests to `/api/` paths.
2. Return `Access-Control-Allow-Origin: <allowed-origin>`, `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`, `Access-Control-Allow-Headers: Content-Type, Authorization` with a `204 No Content` status.
3. Allowed origins: the Vercel production URL (`env.NEXT_PUBLIC_APP_URL`), and the Expo development origin during development only.
4. Reject all other origins with a `403 Forbidden` on the preflight response.

---

### TASK-T4-07 — Add CSP `report-uri` endpoint (BUG-SECURITY-03)
**Files:** `apps/web/app/api/csp-report/route.ts` (new), `apps/web/middleware.ts`  
**Steps:**
1. Create `app/api/csp-report/route.ts` that accepts `POST` with `Content-Type: application/csp-report`, parses the body, and logs it via `logger.warn({ report }, '[csp] Violation report')`.
2. Optionally, persist to a `csp_violations` table for trend analysis.
3. Add `report-uri /api/csp-report` at the end of the CSP string in `middleware.ts` (also add `report-to` header for the newer Reporting API).
4. Rate-limit the endpoint heavily (e.g., 100 req/min per IP) to prevent log flooding from a CSP-injection attack.

---

### TASK-T4-08 — Tighten Next.js image `remotePatterns` (BUG-SECURITY-06)
**File:** `apps/web/next.config.js`  
**Steps:**
1. Replace `{ hostname: "**.supabase.co" }` with the specific Supabase project subdomain used by the app (e.g., `{ hostname: "abcdef.supabase.co" }`). Store the subdomain in `env.NEXT_PUBLIC_SUPABASE_URL` and derive the hostname from it.
2. Similarly replace `**.r2.dev` and `**.r2.cloudflarestorage.com` with the specific Cloudflare R2 bucket hostnames used.
3. Keeping `lh3.googleusercontent.com` and `t.me` as-is is acceptable since these are stable Google/Telegram CDN hostnames.

---

### TASK-T4-09 — Remove redundant `X-Frame-Options` header (BUG-SECURITY-07)
**File:** `apps/web/next.config.js`  
**Steps:**
1. Remove the `{ key: "X-Frame-Options", value: "SAMEORIGIN" }` entry from the `securityHeaders` array in `next.config.js`.
2. The CSP `frame-ancestors 'self'` set in `middleware.ts` provides equivalent (and in modern browsers, superior) protection.
3. One-line deletion — no functional change for modern browsers, reduced header bloat.

---

### TASK-T4-10 — Fix `createSeasonCeremonyRoom` to use `logger` (BUG-SEASON-02)
**File:** `apps/web/lib/seasons/seasonEngine.ts` (line 412)  
**Steps:**
1. Import `logger` from `@/lib/logger` if not already imported.
2. Replace `console.error(err)` with `logger.error({ err }, '[season] Failed to create ceremony room')`.
3. One-line change.

---

## Estimated Effort Summary

| Tier | Bug Count | Estimated Dev Hours | Risk Level |
|------|-----------|---------------------|------------|
| Tier 1 — Critical | 12 | ~20–30h | High (security / financial) |
| Tier 2 — High | 14 | ~15–20h | Medium |
| Tier 3 — Medium | 14 | ~20–25h | Low–Medium |
| Tier 4 — Low | 10 | ~10–15h | Low |
| **Total** | **50** | **~65–90h** | — |

---

## Pre-Implementation Checklist

- [ ] Backup production database before executing any DB migrations
- [ ] Run `pnpm type-check` after each file change
- [ ] Run the full test suite (`pnpm test`) after each tier is complete
- [ ] Deploy Tier 1 fixes to staging and run smoke tests before production deploy
- [ ] Review all SQL migrations with `EXPLAIN ANALYZE` on a representative dataset before applying
- [ ] Ensure `CONCURRENT` index builds are used where possible to avoid table locks

---

*Plan generated: 2026-06-21 at 07:56 PM*  
*Analyst: Claude Code (claude-sonnet-4-6) — forensic inline analysis, no agents used*  
*DO NOT begin implementation until this plan has been reviewed and approved.*
