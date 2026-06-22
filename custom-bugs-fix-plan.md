# Zobia Social — Bug Fix Plan
**Generated:** June 21, 2026 — 11:58 PM  
**Status:** DO NOT EXECUTE until approved. This is the plan only.  
**Based on:** `custom-bugs-report.md` (all 40 bugs)

---

## Execution Order & Priority Groupings

Bugs are grouped by risk and urgency. Fix in order: **P0 first** (production is broken), then **P1** (security), then **P2** (correctness/financial), then **P3** (reliability), then **P4** (code quality/maintenance).

---

## P0 — IMMEDIATE: Production Is Currently Broken (Fix These First)

These two bugs prevent users from logging in and cause all API calls to fail.

---

### TASK-01 — Fix SELF_SIGNED_CERT_IN_CHAIN (login broken)
**Resolves:** BUG-PROD-01, BUG-ENV-05

1. **Vercel Dashboard (immediate hotfix):** Go to Vercel → Project Settings → Environment Variables. Add `DB_CA_CERT` with the value set to the full PEM certificate from your database provider:
   - **Supabase:** Dashboard → Project Settings → Database → SSL → Download certificate. Paste the PEM content.
   - Set the variable for Production only.
2. **Code change:** In `apps/web/lib/db/providers/supabase.ts`, verify the `getPool()` function already reads `process.env.DB_CA_CERT` for the `ca` field (it does — this is already coded, just needs the env var set).
3. **`.env.example`:** Add `DB_CA_CERT=` with a comment explaining where to get the cert from each provider.
4. **Verify:** After setting the env var and triggering a Vercel redeploy, the `[manifest] Failed to load from DB` error should disappear and login should work.

---

### TASK-02 — Fix Service Worker `c.handle is not a function` (all API calls broken)
**Resolves:** BUG-SW-02, BUG-SW-01

1. **Immediate fix in `app/sw.ts`:**
   - Change `skipWaiting: true` to `skipWaiting: false` in the `Serwist` constructor.
   - Add the activate event listener at the bottom of the file so clients are notified to reload:
     ```ts
     self.addEventListener('activate', (event) => {
       event.waitUntil(
         self.clients.matchAll({ type: 'window' }).then((clients) => {
           clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED' }));
         })
       );
     });
     ```
2. **Remove the stale `public/sw.js` from git tracking:**
   - Add `apps/web/public/sw.js` and `apps/web/public/workbox-*.js` to `apps/web/.gitignore`.
   - Run `git rm --cached apps/web/public/sw.js` and any `apps/web/public/workbox-*.js` files.
   - Commit the removal.
3. **Verify the build generates a fresh sw.js:** Run `next build` locally. Confirm `public/sw.js` is regenerated and contains `serwist.addEventListeners()` style code (Serwist v9 format) rather than the old `define(["./workbox-..."], ...)` AMD format.
4. **Deploy** the updated code. The new service worker will handle all registered routes correctly.

---

## P1 — CRITICAL SECURITY (Fix Before Next User-Facing Feature)

---

### TASK-03 — Parameterize SQL injection in guild war engine
**Resolves:** BUG-SEC-02

In `apps/web/lib/guilds/warEngine.ts`, find the `findWarOpponent` SQL query that contains:
```js
`ORDER BY ABS(g.guild_xp - ${selfXP}) ASC`
```
Replace with a parameterized placeholder. Add `selfXP` to the params array at the correct index. Ensure the `$N` number matches its position.

---

### TASK-04 — Move Gemini API key from URL to request header
**Resolves:** BUG-SEC-01

In `apps/web/lib/ai/client.ts`, find the Gemini `fetch` call that appends `?key=<apiKey>` to the URL. Change to:
```ts
fetch(endpoint, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-goog-api-key': effectiveKey,
  },
  body: JSON.stringify(body),
})
```
Remove the `?key=...` query string from the URL entirely.

---

### TASK-05 — Fix CORS null origin fallback
**Resolves:** BUG-CORS-01

In `apps/web/middleware.ts`, find the CORS origin logic where the fallback sets the `Access-Control-Allow-Origin` header to `"null"` (string). Change the fallback behavior to **not set the header at all** when the origin doesn't match. The header must either be absent or set to a matched allowed origin — never the string `"null"`.

---

### TASK-06 — Fix SSL cert validation for Railway and DigitalOcean DB adapters
**Resolves:** BUG-SSL-01

1. In `apps/web/lib/db/providers/railway.ts`: Replace `ssl: { rejectUnauthorized: false }` with:
   ```ts
   ssl: env.NODE_ENV === 'production'
     ? { rejectUnauthorized: true, ...(process.env.RAILWAY_CA_CERT ? { ca: process.env.RAILWAY_CA_CERT } : {}) }
     : undefined,
   ```
2. In `apps/web/lib/db/providers/digitalocean.ts`: Same change, using `process.env.DO_CA_CERT`.
3. Add `RAILWAY_CA_CERT=` and `DO_CA_CERT=` to `.env.example` with instructions.
4. Set these in Vercel environment variables for any Railway/DigitalOcean deployments.

---

### TASK-07 — Fix CSP `'self'` + `strict-dynamic` conflict and nonce gaps
**Resolves:** BUG-CSP-01

In `apps/web/middleware.ts`:
1. Remove `'self'` from the `script-src` directive — it is redundant when `'strict-dynamic'` is present and wastes character budget.
2. Ensure the nonce generated in middleware is forwarded to Next.js via the `x-nonce` custom request header so the Next.js root layout can apply it to all `<script>` and `<style>` tags.
3. For `style-src`: either add `'unsafe-inline'` specifically for styles (separate from scripts, since CSP style-src doesn't support nonces in the same way), or ensure inline style attributes are removed in favor of Tailwind classes.
4. Test: after changes, open DevTools → Console and confirm zero CSP violation messages on the login page.

---

### TASK-08 — Address RLS gap (set GUC per request and expand coverage)
**Resolves:** BUG-SEC-03

This is a larger multi-part task:

1. **GUC injection on auth:** In `apps/web/lib/api/middleware.ts`, inside the `withAuth` HOC, after verifying the JWT and before calling the route handler, execute `SET LOCAL app.current_user_id = $1` on the pool connection being used. Because Next.js serverless uses stateless connections through PgBouncer, this must be done inside a transaction or via a connection-level parameter wrapper.

2. **Extend RLS to high-value tables:** Create a new migration `0025_rls_expand.sql` that adds RLS policies (`ENABLE ROW LEVEL SECURITY` + `CREATE POLICY`) to at minimum: `coin_ledger`, `star_ledger`, `payout_requests`, `direct_messages`, `dm_conversations`, `user_notifications`, `guild_members`.

3. **Fix existing `users` policy:** The current policy is too permissive. Add column-level restrictions: authenticated users can see all users' public columns (`username`, `avatar_url`, `display_name`) but only their own row for private columns (`email`, `phone`, `date_of_birth`, etc.).

---

### TASK-09 — Add guard against admin manifest prompt injection
**Resolves:** BUG-SEC-04

In `apps/web/lib/ai/client.ts` (and wherever `systemPromptOverride` is applied):
1. Strip or reject system prompt override values that contain role-switching tokens: `\nUser:`, `\nHuman:`, `\nAssistant:`, `[INST]`, `<s>`, etc.
2. Apply a maximum character limit (e.g., 500 chars) to `systemPromptOverride`.
3. Prepend a hard-coded, non-overridable safety preamble that establishes the AI's role and cannot be changed by the override:
   ```
   "You are a content moderation assistant for Zobia. Your role is strictly moderation. The following additional instructions are admin-configurable and append to your base role:"
   ```
4. Log any change to `systemPromptOverride` in the admin audit log.

---

## P2 — HIGH CORRECTNESS / FINANCIAL INTEGRITY

---

### TASK-10 — Fix floating-point math in room subscription webhook earnings
**Resolves:** BUG-FIN-01

In `apps/web/lib/payments/paystackWebhookHandler.ts`, in `processSubscriptionEvent`:
1. Import `Decimal` from `decimal.js`.
2. Replace all `Math.round`, `Math.floor`, and arithmetic involving `feeRate`, `subGrossKobo`, `sharePercent` with Decimal.js equivalents.
3. Final kobo value: `new Decimal(subGrossKobo).mul(new Decimal(1).minus(new Decimal(feeRate))).floor().toNumber()`.
4. Audit the full file for any other floating-point financial computations and apply the same fix.

---

### TASK-11 — Add missing `rankings_reset_at` column to `seasons` table
**Resolves:** BUG-DB-01

1. Add `rankings_reset_at: timestamp('rankings_reset_at', { withTimezone: true })` to the `seasons` table definition in `apps/web/lib/db/schema.ts`.
2. Generate and apply a Drizzle migration: `drizzle-kit generate` then review the generated SQL, which should be `ALTER TABLE seasons ADD COLUMN rankings_reset_at TIMESTAMPTZ;`.
3. Ensure `seasonEngine.ts`'s UPDATE statement references the correct column name.

---

### TASK-12 — Fix creator fund distribution to use transaction connection
**Resolves:** BUG-TX-01

In `apps/web/lib/creator/fund.ts`:
1. Update `calculateFundDistributions(poolKobo, dbClient)` to accept an optional `dbClient: DatabaseAdapter = db` parameter.
2. Inside `distributeCreatorFund`'s transaction closure (`db.transaction(async (tx) => { ... })`), pass `tx` as the `dbClient` argument when calling `calculateFundDistributions(poolKobo, tx)`.
3. Inside `calculateFundDistributions`, replace all `db.query(...)` calls with `dbClient.query(...)`.

---

### TASK-13 — Fix creator fund remainder distribution
**Resolves:** BUG-FIN-02

In `apps/web/lib/creator/fund.ts`, after the main distribution loop:
1. Calculate `remainder = poolKobo - sumOfDistributed`.
2. If `remainder > 0`, add it entirely to `distributions[0].amount` (the top-ranked creator) rather than attempting the per-recipient one-kobo distribution loop that fails when `remainder < distributions.length`.
3. Log the remainder amount and how it was assigned for the admin financial audit.

---

### TASK-14 — Fix circuit breaker half-open thundering herd
**Resolves:** BUG-REDIS-01

In `apps/web/lib/ai/client.ts`, in the circuit breaker half-open transition:
1. Instead of immediately deleting the circuit state keys, use a Redis `SET NX PX <ttl>` to set a `CB_PROBE_KEY` (e.g., `ai:cb:probe`) with a 30-second TTL.
2. Only the caller that successfully sets `CB_PROBE_KEY` gets to make the probe request.
3. Other concurrent callers that see `CB_PROBE_KEY` already set should continue to fail fast (or fall through to the Gemini fallback directly).
4. On successful probe: delete `CB_FAILURES_KEY`, `CB_OPENED_AT_KEY`, and `CB_PROBE_KEY`.
5. On failed probe: delete only `CB_PROBE_KEY` (leaving the circuit open for the full cooldown).

---

### TASK-15 — Add unique database index on `messages.idempotency_key`
**Resolves:** BUG-MSG-01

1. Add to `apps/web/lib/db/schema.ts` (or generate a migration):
   ```sql
   CREATE UNIQUE INDEX messages_idempotency_key_uq
   ON messages(idempotency_key)
   WHERE idempotency_key IS NOT NULL;
   ```
2. In the message send handler, replace the pre-INSERT select check with `INSERT ... ON CONFLICT (idempotency_key) DO NOTHING` (or `ON CONFLICT DO UPDATE SET updated_at = NOW()` if you want to return the existing row).
3. Remove the application-level TOCTOU select check.

---

### TASK-16 — Fix notification deduplication for NULL reference_id
**Resolves:** BUG-NOTIF-01

In `apps/web/lib/db/schema.ts` (or a migration):
```sql
CREATE UNIQUE INDEX user_notif_dedup_null_ref
ON user_notifications(user_id, type)
WHERE reference_id IS NULL;
```
The existing partial index already handles non-null cases. This new index prevents duplicate entries when `reference_id IS NULL`. In the notification insert code, use `ON CONFLICT DO NOTHING`.

---

### TASK-17 — Add self-DM prevention constraint
**Resolves:** BUG-DM-01

1. Migration: `ALTER TABLE dm_conversations ADD CONSTRAINT no_self_dm CHECK (user_a_id <> user_b_id);`
2. In the DM creation API route, add an early check before the DB query:
   ```ts
   if (targetUserId === currentUserId) return Response.json({ error: 'Cannot DM yourself' }, { status: 400 });
   ```

---

### TASK-18 — Fix leaderboard cursor pagination total count
**Resolves:** BUG-PERF-01

In `apps/web/lib/leaderboards/engine.ts`:
1. Remove `COUNT(*) OVER () AS total_count` from the cursor-paginated query.
2. Add a separate count query: `SELECT COUNT(*) FROM leaderboard_entries WHERE season_id = $1 AND [other filters]`.
3. Cache this count in Redis with a 60-second TTL keyed by `leaderboard:count:{seasonId}:{filters}`.
4. Return `{ entries, total, nextCursor, hasMore }` where `total` comes from the cached count query.

---

### TASK-19 — Fix guild war opponent race condition
**Resolves:** BUG-RACE-01

In `apps/web/lib/guilds/warEngine.ts`:
1. Move the opponent availability check inside the war declaration transaction.
2. Use `SELECT guild_id FROM guilds WHERE guild_id = $opponentId AND ... FOR UPDATE SKIP LOCKED` within the INSERT transaction. If no row is returned, the guild is already locked (in a war) and the INSERT should abort.
3. Alternatively, use a `WITH opponent AS (SELECT ... FOR UPDATE SKIP LOCKED) INSERT INTO guild_wars SELECT ... FROM opponent WHERE opponent IS NOT NULL` CTE.

---

### TASK-20 — Add `push_tickets` pruning mechanism
**Resolves:** BUG-DB-02

1. Add `created_at TIMESTAMPTZ DEFAULT NOW()` to `push_tickets` if not already present (check schema, add migration if needed).
2. Add a CRON endpoint `POST /api/cron/prune-push-tickets` that runs:
   ```sql
   DELETE FROM push_tickets
   WHERE created_at < NOW() - INTERVAL '48 hours'
   AND status IN ('ok', 'error', 'DeviceNotRegistered');
   ```
3. Register it in your external CRON service (daily is sufficient).

---

### TASK-21 — Add cursor pagination to `listUserChallenges`
**Resolves:** BUG-PAGINATE-01

In `apps/web/lib/games/challenges.ts`:
1. Add `cursor?: string` and `limit?: number` (default 20, max 50) parameters to `listUserChallenges`.
2. Convert the query from `LIMIT 100` to `WHERE challenge_id > $cursor ORDER BY challenge_id ASC LIMIT $limit + 1` (or use composite cursor on `created_at + id`).
3. Return `{ challenges, nextCursor, hasMore }` per the standard cursor pattern already used in `coin_ledger`.

---

## P3 — RELIABILITY / SCALABILITY

---

### TASK-22 — Fix env var handling for JWT rotation keys and DB_POOL_SIZE
**Resolves:** BUG-ENV-01, BUG-ENV-02, BUG-ENV-03, BUG-ENV-04, BUG-ENV-06

1. In `apps/web/lib/env.ts`:
   - Add `DB_POOL_SIZE: z.coerce.number().int().min(1).max(20).default(2)` to the schema.
   - Add `JWT_SECRET_v1: z.string().min(32).optional()` and `JWT_SECRET_v2: z.string().min(32).optional()` for the rotation key slots (add more if needed).
   - Add `DB_CA_CERT: z.string().optional()` to the schema.
   - Add `NEXT_PUBLIC_SUPABASE_HOST: z.string().optional()` etc. for the image host overrides.
2. Remove `SKIP_ENV_VALIDATION` support for anything other than the `type-check` npm script. Add a guard in `env.ts`:
   ```ts
   if (process.env.SKIP_ENV_VALIDATION === '1' && process.env.npm_lifecycle_event !== 'type-check') {
     throw new Error('SKIP_ENV_VALIDATION is only allowed during tsc type-check. Remove it from production/dev.');
   }
   ```
3. In Railway and DigitalOcean providers, replace `process.env.DB_POOL_SIZE` with `env.DB_POOL_SIZE`.
4. In `apps/web/app/robots.ts`, replace `process.env.NEXT_PUBLIC_APP_URL` with `env.NEXT_PUBLIC_APP_URL` (import `env` from `@/lib/env`).
5. Update `.env.example` to include all new vars.

---

### TASK-23 — Fix N+1 Redis calls in chat push notification eligibility check
**Resolves:** BUG-PERF-02

In `apps/web/lib/notifications/chatPush.ts`, in `eligibleRecipients`:
1. Collect all candidate user IDs into an array.
2. Use `redis.smembers('online_users')` (or equivalent) to get all currently online user IDs in one call.
3. Intersect the candidate set with the online set locally in JavaScript.
4. If online status is stored as individual keys (`online:{userId}`), use a Redis pipeline (`redis.pipeline()`) to batch all `GET` calls and execute them in a single round-trip.

---

### TASK-24 — Add Expo network retry logic
**Resolves:** BUG-NET-01

In `apps/expo/lib/api/apiFetch.ts`:
1. Wrap the `fetch` call in a retry loop that catches network-level errors (those that throw rather than return a response).
2. Retry up to 3 times with delays of 1s, 2s, 4s plus ±20% jitter.
3. Do NOT retry on 4xx or 5xx responses — only on thrown exceptions (`TypeError: Network request failed`, etc.).
4. Pattern already exists in `apps/expo/lib/offline/syncQueue.ts` — extract the retry helper into a shared utility and reuse it.

---

### TASK-25 — Add bot strike escalation in content filter
**Resolves:** BUG-MOD-01

In `apps/web/lib/moderation/contentFilter.ts`:
1. When a message is blocked: `await redis.incr(`bot:strikes:${userId}`)` with `await redis.expire(...)` set to 86400 (24 hours).
2. Read the strike count. If >= 3:
   - Insert a row into `reports` with `report_type = 'automated_bot_detection'` and `reported_user_id = userId`.
   - Send an admin push notification or webhook to the moderation channel.
   - Optionally reset the counter after filing the report to allow a new accumulation window.
3. Replace `console.error` with `logger.error` in this file.

---

### TASK-26 — Fix audit log fragmentation and replace console.error
**Resolves:** BUG-AUDIT-01, BUG-LOG-01

1. **Audit log:** Create a migration that adds an `actor_type TEXT NOT NULL DEFAULT 'user' CHECK (actor_type IN ('user', 'admin', 'system'))` column to `audit_log`. Update `auditLog.ts` to accept and pass `actor_type`. Migrate admin ops to call `auditLog()` with `actor_type: 'admin'` instead of writing directly to `admin_audit_log`. Create a database view `v_admin_audit` that filters `audit_log` by `actor_type = 'admin'` for backward compatibility. Eventually drop `admin_audit_log`.
2. **Logging:** In all files listed in BUG-LOG-01, replace `console.error(...)` with `import { logger } from '@/lib/logger'; logger.error({ err }, 'message')`.

---

### TASK-27 — Fix fraud checks to fail-safe (deny on error, not pass)
**Resolves:** BUG-FRAUD-01

In `apps/web/lib/fraud/payouts.ts`:
1. In each individual check function's catch block, instead of returning `{ score: 50, passed: true }` (fail-open), return `{ score: 0, passed: false, reason: 'check_unavailable' }`.
2. In `runFraudChecks`, aggregate check results: if any check returns `check_unavailable`, mark the payout for manual review rather than either passing or failing it outright.
3. Add `SUSPICIOUS_INFLOW_MIN_ACCOUNTS` to the x_manifest under the key `fraud_suspicious_inflow_min_accounts` (default: 3) and read it at runtime via `getManifestValue`.

---

### TASK-28 — Resolve i18n gaps
**Resolves:** BUG-I18N-01, BUG-I18N-02

1. **Pidgin locale in Expo:** Copy `apps/web/lib/i18n/locales/pidgin.json` to `apps/expo/lib/i18n/locales/pidgin.json`. Add `'pidgin'` to the `SupportedLocale` type in `apps/expo/lib/i18n/index.ts` and add the locale loader.
2. **Nested key resolution:** In `apps/web/lib/i18n/index.ts`, replace the flat `messages[key] ?? key` lookup in `getServerTranslation` with a recursive key resolver that traverses dot-separated segments:
   ```ts
   function resolveNestedKey(obj: Record<string, unknown>, key: string): string {
     const value = key.split('.').reduce((o: unknown, k) => (o && typeof o === 'object') ? (o as Record<string, unknown>)[k] : undefined, obj);
     return typeof value === 'string' ? value : key;
   }
   ```

---

### TASK-29 — Fix antispam URL regex false positives
**Resolves:** BUG-SPAM-01

In `apps/web/lib/messaging/antispam.ts`:
1. Update `getUrlRegex()` to require either a protocol prefix (`https?://`, `ftp://`) or a `www.` prefix before matching domain-like patterns.
2. Alternatively, use the WHATWG `URL` constructor in a try/catch as a validation step: only flag a token as a URL if `new URL(token)` succeeds.
3. Test with common English words like "become", "income", "reform" to verify they no longer match.

---

### TASK-30 — Fix manifest fields that are never populated
**Resolves:** BUG-MANIFEST-01

In `apps/web/lib/manifest/index.ts`, in `buildManifest()`:
1. For `vipRoomPricing`: add keys `vip_room_pricing_min_ngn` and `vip_room_pricing_max_ngn` to the x_manifest read. Populate `features.vipRoomPricing` only when both keys are present and valid integers. Remove the `?` optional marker if the field is intended to always be present (provide defaults instead).
2. For `payment.currenciesAccepted`: read key `payment_currencies_accepted` (comma-separated string, e.g., `"NGN,USD"`) and split into an array. If missing, default to `["NGN"]`.

---

## P4 — MAINTENANCE / QUALITY

---

### TASK-31 — Add SQLite encryption for Expo offline messages
**Resolves:** BUG-PRIV-01

1. Evaluate `@op-engineering/op-sqlite` (supports encryption key parameter) or `expo-sqlite-encrypted`.
2. Derive an encryption key from a combination of the device's Android Keystore and the user's session ID.
3. Apply the encryption key when opening the SQLite database.
4. Document in the app's privacy policy that offline message data is encrypted at rest.

---

### TASK-32 — Restrict Next.js image domain allowlist to specific project hosts
**Resolves:** BUG-IMAGES-01

In `apps/web/next.config.js`:
1. Change the default for Supabase from `"*.supabase.co"` to require `NEXT_PUBLIC_SUPABASE_HOST` to be set in production (throw at build time if missing in production env).
2. In `apps/web/lib/env.ts`, add `NEXT_PUBLIC_SUPABASE_HOST: z.string().optional()` and document that this should be set to the specific project hostname (e.g., `abcdefgh.supabase.co`) in production.

---

### TASK-33 — Miscellaneous cleanup

1. **BUG-ENV-03 (DB_POOL_SIZE in Supabase provider):** The Supabase provider also reads `process.env.DB_POOL_SIZE ?? "2"` directly. Update it to use `env.DB_POOL_SIZE` after TASK-22 adds it to env.ts.
2. **BUG-QUEST-01 (misleading comment):** In `apps/web/lib/quests/questEngine.ts`, change the comment that says "deterministic shuffle" to "cryptographically random shuffle" since it uses CSPRNG (`randomBytes`), not a seeded deterministic source.
3. **BUG-FRAUD-01 (hardcoded constant):** Extract `SUSPICIOUS_INFLOW_MIN_ACCOUNTS = 3` in `apps/web/lib/fraud/payouts.ts` to be read from the manifest as described in TASK-27.

---

## Verification Checklist (After All Tasks Complete)

- ✅ TASK-01: Login works in production; no `SELF_SIGNED_CERT_IN_CHAIN` errors in Vercel logs
- ✅ TASK-02: No `c.handle is not a function` in browser console; API calls succeed through SW
- ✅ TASK-03: Guild war opponent SQL query uses parameterized `$N` for `selfXP`
- ✅ TASK-04: Gemini API key no longer appears in Vercel access logs (moved to `x-goog-api-key` header)
- ✅ TASK-05: `Access-Control-Allow-Origin: null` header no longer set for non-matching origins
- ✅ TASK-06: Railway/DO DB connections use `rejectUnauthorized: true` with CA cert
- ✅ TASK-07: Zero CSP violation messages in DevTools console on login/home page (`'self'` removed)
- ✅ TASK-08: RLS GUC set per request via `withRLS` in AuthContext; migration 0028 adds policies
- ✅ TASK-09: Admin system prompt override strips injection tokens; max 2000 chars; safety preamble prepended
- ✅ TASK-10: Room subscription creator earnings use Decimal.js; test with `feeRate = 0.125`
- ✅ TASK-11: `seasons` table has `rankings_reset_at` column; migration 0027 applied
- ✅ TASK-12: `calculateFundDistributions` receives `tx` inside transaction; reads same snapshot
- ✅ TASK-13: Creator fund remainder credited to top creator; dust handled via `distributions[0]`
- ✅ TASK-14: Only one concurrent caller probes DeepSeek during half-open (SET NX probe key)
- ✅ TASK-15: Duplicate message inserts rejected by DB unique index; migration 0027 applied
- ✅ TASK-16: System notifications (null reference_id) cannot be duplicated; migration 0027 applied
- ✅ TASK-17: `dm_conversations` rejects self-DM at DB level; migration 0027 applied
- ✅ TASK-18: Leaderboard `total` count is consistent across all pages (separate Redis-cached count query)
- ✅ TASK-19: Guild war declaration is atomic; opponent re-verified inside transaction with `FOR UPDATE SKIP LOCKED`
- ✅ TASK-20: push_tickets pruning CRON at `/api/cron/prune-push-tickets` created; migration 0027 adds `created_at`
- ✅ TASK-21: Challenge list supports cursor pagination; `ChallengesPage` return type with `nextCursor`
- ✅ TASK-22: All env vars go through env.ts Zod schema; `DB_POOL_SIZE`, JWT rotation keys, image hosts added
- ✅ TASK-23: Chat push eligibility uses Redis pipeline — 1 round-trip regardless of recipient count
- ✅ TASK-24: Expo API fetch retries on network errors (3 retries, exponential backoff 500ms base)
- ✅ TASK-25: Bot strikes create moderation report in `moderation_reports`; logger used throughout
- ✅ TASK-26: All `console.error` replaced with `logger.error` in lib files; audit log uses logger
- ✅ TASK-27: Fraud check failure flags payout as suspicious (`trust_score_check_unavailable` reason)
- ✅ TASK-28: Expo and web apps support Nigerian Pidgin locale; dot-notation i18n keys resolve correctly
- ✅ TASK-29: Bare domain regex removed from `getUrlRegex()`; only protocol/www-prefixed URLs matched
- ✅ TASK-30: `vipRoomPricing` and `currenciesAccepted` populated from `x_manifest` in `buildManifest()`
- 🟡 TASK-31: SQLite encryption documented with TODO comment and migration guide reference in `sqlite.ts`
- ✅ TASK-32: Image domain env vars added to `env.ts` and `.env.example` with per-project hostname guidance

---

*Fix plan generated: June 21, 2026 — 11:58 PM*  
*Zobia Social — Bug Fix Plan v1.0*
