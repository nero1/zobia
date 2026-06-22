# Zobia Social — Forensic Bug Report
**Generated:** June 21, 2026 — 11:58 PM  
**Scope:** Full codebase audit — `apps/web` (Next.js PWA), `apps/expo` (Android), shared libs  
**Analyst:** Deep forensic pass — security, correctness, performance, scalability, financial integrity

---

## Current Code Rating

**Overall: 6.8 / 10**

**Strengths:** The architecture is impressive for a solo/small team project. JWT + Redis session handling is well-designed with key rotation, multi-slot sessions, and atomic refresh locks. Financial math uses Decimal.js throughout most of the codebase. Rate limiting is done with an atomic Lua script. The circuit breaker, DLQ, and advisory lock patterns show mature engineering thinking. XP arithmetic avoids floats. The auth restore flow uses the secure hash-fragment token approach. SSRF protection is solid with DNS-pinning.

**Weaknesses:** RLS is implemented on only 4 of 30+ tables; the GUC variables that enforce it are never set per-request, making the existing RLS policies effectively inert. The production deployment is currently broken due to an SSL misconfiguration and a stale/mismatched service worker. Several financial calculations in the webhook handler use plain JS floating-point. SQL injection exists in the guild war engine. An API key is being leaked via URL parameters into server logs. The audit trail is fragmented across two separate tables and partially uses unstructured `console.error`. Dozens of env vars accessed directly via `process.env` bypass the Zod-validated env module.

**Projected Rating After All Fixes: 8.9 / 10**

---

## Complete Bug List (One-Line Summaries)

1. BUG-PROD-01: Missing `DB_CA_CERT` env var causes `SELF_SIGNED_CERT_IN_CHAIN` in production — login and all manifest-dependent features fail  
2. BUG-SW-02: `public/sw.js` is stale and mismatched with `app/sw.ts`, causing `TypeError: c.handle is not a function` — ALL API calls fail through the service worker  
3. BUG-SEC-01: Gemini API key passed as a URL query parameter — exposed in server access logs, proxy logs, and CDN logs  
4. BUG-SEC-02: Unparameterized `selfXP` integer interpolated directly into SQL in guild war opponent finder — SQL injection vector  
5. BUG-SEC-03: Row Level Security policies exist on only 4 of 30+ tables; the `SET LOCAL app.current_user_id` GUC is never called per-request — RLS is effectively inert across the app  
6. BUG-SEC-04: Admin `systemPromptOverride` in the manifest passes unvalidated admin-entered text directly as the AI system prompt — stored prompt injection  
7. BUG-CSP-01: CSP `script-src` includes `'self'` alongside `'strict-dynamic'` — `'self'` is silently ignored per spec; inline Next.js scripts are blocked because nonce injection is incomplete  
8. BUG-SSL-01: Railway and DigitalOcean DB adapters use `ssl: { rejectUnauthorized: false }` in production — certificate validation completely disabled  
9. BUG-FIN-01: Room subscription creator earnings split uses plain JS `Math.round` / `Math.floor` with floating-point intermediates instead of Decimal.js — possible kobo-level rounding errors  
10. BUG-DB-01: `seasons` table schema is missing the `rankings_reset_at` column referenced by `resetSeasonRankings()` — runtime crash on season reset  
11. BUG-PERF-01: Leaderboard cursor pagination computes `COUNT(*) OVER ()` after the cursor `WHERE` clause — reported `total` shrinks per page; page 2+ shows wrong total count  
12. BUG-TX-01: `calculateFundDistributions()` is called inside `distributeCreatorFund`'s transaction closure but reads from global `db` (not `tx`) — scoring query runs on a different connection outside the snapshot  
13. BUG-REDIS-01: AI client circuit breaker half-open recovery deletes Redis state keys before making the probe request — concurrent callers all probe DeepSeek simultaneously (thundering herd)  
14. BUG-MSG-01: `messages` table has no unique database index on `idempotency_key` — deduplication relies on an in-code check only; retries can create duplicate messages  
15. BUG-NOTIF-01: `user_notifications` partial unique index excludes `NULL` reference_id rows — unlimited duplicate notifications are inserted when `reference_id IS NULL`  
16. BUG-DM-01: `dm_conversations` table has no database constraint preventing a user from opening a DM with themselves  
17. BUG-ENV-01: `SKIP_ENV_VALIDATION=1` creates a Proxy that returns `undefined` for every property — the entire application runs with no env var safety net  
18. BUG-ENV-02: JWT_SECRET_v* rotation variables read directly via `process.env` instead of being declared in and validated by `env.ts` — malformed rotation keys go undetected until JWT verification fails at runtime  
19. BUG-ENV-03: `DB_POOL_SIZE` read via `process.env` directly in Railway and DigitalOcean providers — bypasses Zod validation and `env.ts`  
20. BUG-ENV-04: `robots.ts` reads `process.env.NEXT_PUBLIC_APP_URL` directly instead of the validated `env.NEXT_PUBLIC_APP_URL` object  
21. BUG-ENV-05: `DB_CA_CERT` env var (required for Supabase SSL in production) is absent from `.env.example` — deployers don't know it exists  
22. BUG-ENV-06: `DB_POOL_SIZE`, `NEXT_PUBLIC_SUPABASE_HOST`, `NEXT_PUBLIC_SUPABASE_IN_HOST`, `NEXT_PUBLIC_R2_DEV_HOST`, `NEXT_PUBLIC_R2_STORAGE_HOST` are used in the codebase but missing from `.env.example`  
23. BUG-RACE-01: `findWarOpponent` reads available guilds, returns the best candidate, then declares war — no re-check inside the declaration transaction means the candidate may already be in a war  
24. BUG-FIN-02: Creator Fund `remainder` kobo is silently dropped when `remainder < distributions.length` — tiny amounts are neither distributed nor tracked  
25. BUG-DB-02: `push_tickets` table has no TTL, pruning CRON, or expiry mechanism — grows indefinitely (DB bloat)  
26. BUG-PAGINATE-01: `listUserChallenges` uses hard-coded `LIMIT 100` with no cursor — silently truncates users with over 100 challenges  
27. BUG-PERF-02: `eligibleRecipients` in `chatPush.ts` calls `isUserOnline()` once per recipient in a loop — N+1 Redis round-trips; should use `SMEMBERS` or pipeline  
28. BUG-I18N-01: Expo app's `SupportedLocale` type and locale file set are missing Nigerian Pidgin (`pidgin`) — inconsistent with the web app  
29. BUG-I18N-02: `getServerTranslation()` uses a flat `messages[key]` object lookup — nested i18next dot-notation keys like `errors.network` resolve to `undefined`  
30. BUG-SW-01: `app/sw.ts` sets `skipWaiting: true` in the Serwist constructor, contradicting the manual `SW_UPDATED` postMessage anti-skip-waiting approach hand-edited into `public/sw.js`  
31. BUG-PRIV-01: Expo offline queue stores message content in plaintext SQLite — readable by any process on a rooted Android device  
32. BUG-NET-01: Expo `apiFetch.ts` has no retry logic or exponential backoff for network failures — a single flaky request permanently fails  
33. BUG-MOD-01: Bot/spam detection in `contentFilter.ts` blocks individual messages but never flags the sender's account or alerts an admin  
34. BUG-SPAM-01: The URL regex in `antispam.ts` may produce false positives on common English words whose suffixes resemble TLDs  
35. BUG-CORS-01: CORS middleware fallback sets `Access-Control-Allow-Origin: null` (string literal) — browsers send `Origin: null` for sandboxed iframes, matching this and opening a security hole  
36. BUG-AUDIT-01: Audit trail is split between `audit_log` (general) and `admin_audit_log` (admin ops) tables — no unified view; `auditLog.ts` uses `console.error` on failure instead of structured logger  
37. BUG-LOG-01: `contentFilter.ts`, `chatPush.ts`, `realtime/index.ts`, and pool error handlers in DB providers use `console.error` instead of the structured Pino `logger`  
38. BUG-FRAUD-01: Fraud check helper functions (`checkTrustScore`, etc.) swallow all errors with empty catch blocks — a network error silently returns a passing score (50), allowing fraudulent payouts through  
39. BUG-IMAGES-01: `next.config.js` image domain allowlist uses `*.supabase.co` wildcard — any attacker-controlled Supabase project can serve images that Next.js will accept  
40. BUG-MANIFEST-01: `ZobiaManifest.features.vipRoomPricing` and `payment.currenciesAccepted` fields are defined in the TypeScript interface but never populated by `buildManifest()` — always `undefined`  

---

## Detailed Bug Descriptions

---

### 1. BUG-PROD-01: Missing `DB_CA_CERT` causes SSL cert rejection in production — login broken

**FILES:**  
`apps/web/lib/db/providers/supabase.ts`  
`apps/web/.env.example`

**FIX:**  
The Supabase provider correctly uses `ssl: { rejectUnauthorized: true }` in production, which is the secure setting. However, the `DB_CA_CERT` environment variable that provides the CA certificate is not documented in `.env.example`, so no deployer knows to set it. Without it, Node.js falls back to its default system CA bundle, which rejects Supabase's PgBouncer pooler SSL chain with `SELF_SIGNED_CERT_IN_CHAIN`. Add `DB_CA_CERT=` to `.env.example` with instructions to paste the PEM from Supabase Dashboard → Project Settings → Database → SSL Certificate. In Vercel, add `DB_CA_CERT` as a multi-line environment variable containing the full CA PEM. As a stopgap for immediate relief while deploying the proper fix, the code can fall back to `ssl: { rejectUnauthorized: false }` temporarily (see BUG-SSL-01 for context on why this is an acceptable tradeoff for Railway/DO but not ideal for Supabase).

---

### 2. BUG-SW-02: Stale `public/sw.js` causes `TypeError: c.handle is not a function` — all API calls broken

**FILES:**  
`apps/web/public/sw.js`  
`apps/web/app/sw.ts`  
`apps/web/next.config.js`

**FIX:**  
The `public/sw.js` file is a stale, manually-modified compilation artifact that does not match the current `app/sw.ts` source. Evidence: sw.ts uses `handler: "StaleWhileRevalidate"` for JS files but sw.js uses `new e.CacheFirst`; sw.ts has `skipWaiting: true` but sw.js has a comment saying skipWaiting was removed. The file uses an older Workbox AMD module format (`define(["./workbox-04ce5d95"], ...)`) that produces strategy instances incompatible with the current Serwist v9 routing internals — hence `c.handle is not a function` for all NetworkOnly routes (`/api/manifest`, `/api/config/rewards-ui`, `/api/auth/google`). Fix: (a) delete `public/sw.js` from version control (it should be a build artifact, not committed), (b) add `apps/web/public/sw.js` and `apps/web/public/workbox-*.js` to `.gitignore`, (c) run `next build` locally to regenerate from the current sw.ts, (d) also fix sw.ts to set `skipWaiting: false` and add the SW_UPDATED activate listener there (see BUG-SW-01). The new Serwist v9 build will emit a completely different sw.js that uses the modern `serwist.addEventListeners()` approach without the stale workbox AMD format.

---

### 3. BUG-SEC-01: Gemini API key passed as URL query parameter — leaks into logs

**FILES:**  
`apps/web/lib/ai/client.ts`

**FIX:**  
The Gemini API call constructs the URL as:
```
`${endpoint}?key=${encodeURIComponent(effectiveKey)}`
```
This puts the API key in the URL, where it is logged by nginx/Vercel access logs, CDN providers, and any monitoring system that captures URLs. Switch to Gemini's header-based authentication: pass the key as `x-goog-api-key: <key>` in the `fetch` headers instead. If the Gemini endpoint requires the `?key=` query param (older REST API style), it is acceptable to use it only if outbound access logs are confirmed to be private, but prefer the header approach for defense in depth.

---

### 4. BUG-SEC-02: SQL injection via unparameterized `selfXP` in guild war opponent finder

**FILES:**  
`apps/web/lib/guilds/warEngine.ts`

**FIX:**  
The query uses template literal string interpolation:
```js
`ORDER BY ABS(g.guild_xp - ${selfXP}) ASC`
```
`selfXP` is read from a DB query result (`guild.guild_xp`), which is a number in practice, but depending on the exact type coercion path and future refactors, this is a SQL injection surface. Replace with a parameterized placeholder: `ORDER BY ABS(g.guild_xp - $N) ASC` and pass `selfXP` as a bound parameter. All dynamic values must be parameterized regardless of apparent type.

---

### 5. BUG-SEC-03: Row Level Security covers only 4 tables; GUC vars never set — RLS is inert

**FILES:**  
`apps/web/db/migrations/0024_rls_policies.sql`  
`apps/web/lib/db/index.ts`  
`apps/web/lib/api/middleware.ts`

**FIX:**  
RLS policies are defined on `users`, `user_sessions`, `messages`, and `room_members` only — roughly 4 of 30+ tables in the schema. More critically, the policies on `users` check `auth.uid() = id`, which depends on a PostgreSQL GUC (`app.current_user_id`) that is never set by the application per-request. The `withAuth` HOC in `lib/api/middleware.ts` knows the authenticated user's ID but never calls `SET LOCAL app.current_user_id = $userId` before executing queries. Without this GUC, all RLS policies evaluate as if there is no current user, meaning they either allow all rows or deny all rows depending on policy definition. Fix: (a) after acquiring a pool connection and before any query in an authenticated context, call `SET LOCAL app.current_user_id = $1` with the user's UUID, (b) extend RLS coverage to `coin_ledger`, `star_ledger`, `payout_requests`, `direct_messages`, `dm_conversations`, `notifications`, `guild_members`, and all other sensitive tables, (c) audit the existing `users` RLS policy which currently allows `SELECT` for all authenticated users to see all users' data — it should restrict to `id = current_setting('app.current_user_id')::uuid` for personal data fields.

---

### 6. BUG-SEC-04: Admin manifest `systemPromptOverride` enables stored prompt injection

**FILES:**  
`apps/web/lib/ai/client.ts`  
`apps/web/lib/manifest/index.ts`

**FIX:**  
The manifest includes an admin-configurable `systemPromptOverride` field that is passed directly as the AI system prompt for content moderation queries. A malicious admin (or a compromised admin account) can inject adversarial instructions into the system prompt, causing the AI to approve otherwise-blocked content or exfiltrate classified information from user submissions. Fix: (a) strip or escape any content that looks like injection attempts from the system prompt override (e.g., disallow `User:`, `Human:`, `Assistant:`, role delimiters), (b) prepend a non-overridable safety preamble before the admin-supplied text so the override can only append, not replace, the base instructions, (c) enforce a character limit on the override field, (d) log all changes to `systemPromptOverride` in the audit trail.

---

### 7. BUG-CSP-01: `'self'` ignored by `strict-dynamic`; inline scripts blocked by CSP nonce gap

**FILES:**  
`apps/web/middleware.ts`

**FIX:**  
CSP Level 3 specifies that when `'strict-dynamic'` is present in `script-src`, host-source and keyword-source entries like `'self'` are ignored by supporting browsers (the browser logs "Ignoring 'self' within script-src: 'strict-dynamic' specified"). Remove `'self'` from `script-src` — it has no effect alongside `'strict-dynamic'` and only adds visual confusion. For the blocked inline script: Next.js injects inline scripts for hydration and app initialization that must carry the per-request `nonce` attribute. Ensure the nonce generated in middleware is forwarded to Next.js via the `x-nonce` response header (or `Content-Security-Policy-Report-Only` during testing), and that the Next.js `<Script>` component and any custom `<script>` tags use `nonce={nonce}`. Review the `style-src` directive as well — the inline style block violation requires `'unsafe-inline'` or a nonce on style tags, or moving inline styles to CSS classes.

---

### 8. BUG-SSL-01: Railway and DigitalOcean DB adapters disable certificate validation in production

**FILES:**  
`apps/web/lib/db/providers/railway.ts`  
`apps/web/lib/db/providers/digitalocean.ts`

**FIX:**  
Both providers unconditionally set `ssl: { rejectUnauthorized: false }` (DigitalOcean) or conditionally in production (Railway), which disables TLS certificate verification entirely. This makes the connection vulnerable to MITM attacks that could intercept all database traffic including user credentials, PII, and financial data. Fix: obtain the CA certificate from Railway (Settings → Variables → SSL certificates) and DigitalOcean (Database → Connection Details → CA Certificate) and supply it via a `DB_CA_CERT` environment variable (or provider-specific variants like `RAILWAY_CA_CERT`, `DO_CA_CERT`). Set `ssl: { rejectUnauthorized: true, ca: process.env.DB_CA_CERT }` for both providers. Add these vars to `.env.example`.

---

### 9. BUG-FIN-01: Room subscription creator earnings use floating-point arithmetic instead of Decimal.js

**FILES:**  
`apps/web/lib/payments/paystackWebhookHandler.ts`

**FIX:**  
In `processSubscriptionEvent`, the creator's net share is computed as:
```js
const sharePercent = Math.round((1 - feeRate) * 100);
// feeRate = 0.15 → (1 - 0.15) = 0.8500000000000001 in IEEE 754
const netKobo = Math.floor((subGrossKobo * sharePercent) / 100);
```
The intermediate `(1 - 0.15)` produces `0.8500000000000001` due to IEEE 754, which `Math.round() * 100` happens to handle correctly for this specific value, but this fragility will break for other fee rates (e.g., `feeRate = 0.125`). Rewrite using Decimal.js:
```js
const net = new Decimal(subGrossKobo).mul(new Decimal(1).minus(feeRate)).floor();
const netKobo = net.toNumber();
```
Apply consistently to all financial calculations in this file.

---

### 10. BUG-DB-01: `seasons` table is missing the `rankings_reset_at` column — season reset crashes

**FILES:**  
`apps/web/lib/seasons/seasonEngine.ts`  
`apps/web/lib/db/schema.ts`

**FIX:**  
`resetSeasonRankings()` issues an `UPDATE seasons SET rankings_reset_at = NOW() WHERE id = $1` SQL statement. The `rankings_reset_at` column does not exist in the Drizzle schema definition for the `seasons` table, which means the column was either never added to the schema or was added via raw SQL without a corresponding schema update. Create a Drizzle migration to add `rankings_reset_at TIMESTAMPTZ` to the `seasons` table. Add the column to the Drizzle schema definition as well to keep TypeScript types in sync.

---

### 11. BUG-PERF-01: Leaderboard cursor pagination reports wrong `total` on pages 2+

**FILES:**  
`apps/web/lib/leaderboards/engine.ts`

**FIX:**  
The query uses `COUNT(*) OVER () AS total_count` inside a query that already has a `WHERE rank > $cursor` clause. `COUNT(*) OVER ()` counts the rows in the current window (i.e., rows after the cursor), not all rows in the leaderboard. On page 1 `total` = 1000; on page 2 `total` = 980; on page 3 `total` = 960. This breaks any UI that shows "Page 2 of 40" etc. Fix: run a separate `SELECT COUNT(*) FROM leaderboard_entries WHERE season_id = $1` query (which can be cached in Redis) and pass it alongside the paginated results. Alternatively, remove `total_count` from the paginated query and only return it on the first page call.

---

### 12. BUG-TX-01: Creator Fund distribution scoring query runs outside the transaction snapshot

**FILES:**  
`apps/web/lib/creator/fund.ts`

**FIX:**  
`distributeCreatorFund()` opens a transaction via `db.transaction(async (tx) => { ... })` and then calls `calculateFundDistributions(poolKobo)` inside that closure. However, `calculateFundDistributions` internally calls `db.query(...)` (the global adapter), not `tx.query(...)`. This means the scoring SELECT runs on a completely separate connection that is not part of the transaction, allowing the balances being distributed to diverge from the scoring snapshot mid-distribution. Pass `tx` (the `TransactionClient`) as a parameter to `calculateFundDistributions` and replace all internal `db.query` calls with `dbClient.query` where `dbClient` defaults to the global `db` singleton but can be overridden.

---

### 13. BUG-REDIS-01: Circuit breaker half-open thundering herd on AI client recovery

**FILES:**  
`apps/web/lib/ai/client.ts`

**FIX:**  
When the circuit breaker transitions to half-open, the code does `await redis.del(CB_FAILURES_KEY, CB_OPENED_AT_KEY)` which clears the circuit state for ALL concurrent callers simultaneously. Every request that was waiting for the circuit to open will then pass the half-open check and simultaneously probe DeepSeek, causing a thundering herd. Fix: use a Redis `SET NX` (set-if-not-exists) probe flag with a short TTL (e.g., 30 seconds) to ensure only one caller gets to probe while others continue to fail fast. Only delete the full circuit state after a successful probe.

---

### 14. BUG-MSG-01: `messages` table lacks a unique database index on `idempotency_key`

**FILES:**  
`apps/web/lib/db/schema.ts`  
`apps/web/lib/messaging/` (message send handler)

**FIX:**  
The `messages` table has an `idempotency_key` column intended to prevent duplicate messages on retry, but there is no `UNIQUE` constraint or unique index on that column in the schema. The deduplication check is performed in application code (`SELECT 1 FROM messages WHERE idempotency_key = $1`) before the INSERT, which is a TOCTOU race condition — two concurrent retries can both pass the check and both insert. Add a `UNIQUE` index on `messages.idempotency_key` where it is not null: `CREATE UNIQUE INDEX messages_idempotency_key_unique ON messages(idempotency_key) WHERE idempotency_key IS NOT NULL;`. Remove the application-level pre-check and rely on catching the unique violation with an `ON CONFLICT DO NOTHING`.

---

### 15. BUG-NOTIF-01: Unlimited duplicate notifications when `reference_id IS NULL`

**FILES:**  
`apps/web/lib/db/schema.ts`  
`apps/web/lib/notifications/` (notification insert logic)

**FIX:**  
The `user_notifications` table has a partial unique index like `UNIQUE (user_id, type, reference_id) WHERE reference_id IS NOT NULL`, which correctly deduplicates notifications that have a reference ID. However, SQL `NULL != NULL`, so when `reference_id IS NULL` (e.g., system-wide or admin notifications), there is no constraint preventing unlimited duplicate rows per user per type. Add a second partial unique index for the NULL case keyed on `(user_id, type)` with a `WHERE reference_id IS NULL` predicate, or add a surrogate deduplication key that is always non-null.

---

### 16. BUG-DM-01: No database constraint prevents users from DMing themselves

**FILES:**  
`apps/web/lib/db/schema.ts`  
`apps/web/lib/messaging/` (DM conversation creation)

**FIX:**  
The `dm_conversations` table has no `CHECK (user_a_id <> user_b_id)` constraint. A user can create a DM conversation with their own user ID as both participants, leading to confusing UX (messages appear to come from yourself). Add a `CHECK` constraint: `ALTER TABLE dm_conversations ADD CONSTRAINT dm_no_self_chat CHECK (user_a_id <> user_b_id);`. Also enforce this at the API layer to return a clear 400 error before the DB query.

---

### 17. BUG-ENV-01: `SKIP_ENV_VALIDATION=1` makes all env vars undefined — silent full bypass

**FILES:**  
`apps/web/lib/env.ts`

**FIX:**  
When `SKIP_ENV_VALIDATION` is set, `env.ts` returns a `Proxy` that returns `undefined` for every property lookup. Any code that reads `env.DATABASE_URL` will get `undefined`, and any code that reads `env.JWT_SECRET` will get `undefined`. This causes cryptic downstream failures (e.g., the DB pool gets `undefined` as its connection string and attempts to connect, failing silently). This flag is only needed for `tsc` type-checking in CI. Replace the full bypass Proxy with a typed partial: throw an error if `SKIP_ENV_VALIDATION` is set outside of a `tsc --noEmit` context (i.e., if `process.env.npm_lifecycle_event !== 'type-check'`). Alternatively, add a comment warning and only use it in the `type-check` script, never for actual builds or `next dev`.

---

### 18. BUG-ENV-02: JWT key-rotation vars (`JWT_SECRET_v*`) bypass Zod validation

**FILES:**  
`apps/web/lib/env.ts`  
`apps/web/lib/auth/jwt.ts`

**FIX:**  
`buildKeyRegistry()` in `jwt.ts` scans `process.env` for `JWT_SECRET_v<N>` keys at runtime, completely bypassing the Zod schema in `env.ts`. A mis-typed or empty rotation key (e.g., `JWT_SECRET_v2=` in `.env`) silently becomes an empty string and is used to verify tokens, creating a critical auth vulnerability. The fix options: (a) enumerate and validate expected rotation key slots (`JWT_SECRET_v1`, `JWT_SECRET_v2`) in `env.ts` as optional strings with minimum-length validation, (b) or validate the format inside `buildKeyRegistry()` by throwing if any discovered key is shorter than 32 characters.

---

### 19. BUG-ENV-03: `DB_POOL_SIZE` bypasses `env.ts` in Railway and DigitalOcean providers

**FILES:**  
`apps/web/lib/db/providers/railway.ts`  
`apps/web/lib/db/providers/digitalocean.ts`

**FIX:**  
Both providers read pool size as `parseInt(process.env.DB_POOL_SIZE ?? "2", 10)` instead of using the validated `env` object. If `DB_POOL_SIZE` is set to a non-integer (e.g., `"large"` from a misconfiguration), `parseInt` returns `NaN`, and `new Pool({ max: NaN })` uses the default (10), silently overriding the intent. Add `DB_POOL_SIZE` to `env.ts` as an optional numeric field with a default of `2`, and reference `env.DB_POOL_SIZE` in all providers (including Supabase which already does this — via `process.env` there too, fix that as well).

---

### 20. BUG-ENV-04: `robots.ts` reads `process.env.NEXT_PUBLIC_APP_URL` directly

**FILES:**  
`apps/web/app/robots.ts`

**FIX:**  
The robots.ts route reads `process.env.NEXT_PUBLIC_APP_URL` directly instead of `env.NEXT_PUBLIC_APP_URL`. This bypasses the validated env module and could silently produce an empty or malformed sitemap URL if the var is missing. Replace with `import { env } from '@/lib/env'` and use `env.NEXT_PUBLIC_APP_URL`.

---

### 21. BUG-ENV-05: `DB_CA_CERT` undocumented — deployers cannot fix SSL cert rejection

**FILES:**  
`apps/web/.env.example`  
`apps/web/lib/db/providers/supabase.ts`

**FIX:**  
Add the following to `.env.example` with documentation:
```
# CA certificate for PostgreSQL SSL (PEM format, required in production for Supabase).
# Supabase: Settings → Database → SSL → Download certificate
DB_CA_CERT=
```
Also note that multi-line PEM values must be handled correctly in Vercel (add as a single-line env var with escaped newlines or via the Vercel dashboard raw value UI).

---

### 22. BUG-ENV-06: Multiple env vars used in code are absent from `.env.example`

**FILES:**  
`apps/web/.env.example`  
`apps/web/next.config.js`  
`apps/web/lib/db/providers/railway.ts`  
`apps/web/lib/db/providers/digitalocean.ts`

**FIX:**  
Add the following missing variables to `.env.example`:
- `DB_POOL_SIZE=2` — connection pool size (used by all DB providers)
- `NEXT_PUBLIC_SUPABASE_HOST=` — overrides Supabase image domain wildcard
- `NEXT_PUBLIC_SUPABASE_IN_HOST=` — overrides Supabase `.in` image domain wildcard
- `NEXT_PUBLIC_R2_DEV_HOST=` — overrides R2 `.r2.dev` image domain wildcard
- `NEXT_PUBLIC_R2_STORAGE_HOST=` — overrides R2 `.r2.cloudflarestorage.com` image domain wildcard
- `DB_CA_CERT=` (covered above, kept here for completeness)

---

### 23. BUG-RACE-01: Guild war opponent selection has a TOCTOU race condition

**FILES:**  
`apps/web/lib/guilds/warEngine.ts`

**FIX:**  
`findWarOpponent()` runs a `SELECT` to find available guilds that are not in an active war, returns the best match, and then the caller proceeds to declare war. Between the `SELECT` and the `INSERT INTO guild_wars`, the candidate guild can be claimed by another concurrent war declaration. Fix: move the opponent check inside the same transaction that inserts the war record. Use `SELECT ... FOR UPDATE SKIP LOCKED` on the candidate guild row to atomically claim it, rolling back if the row is already locked. Alternatively, use a `INSERT INTO guild_wars (...) SELECT ... WHERE NOT EXISTS (active_war)` combined CTE that is a single atomic statement.

---

### 24. BUG-FIN-02: Creator Fund kobo remainder dust is silently discarded

**FILES:**  
`apps/web/lib/creator/fund.ts`

**FIX:**  
After distributing weighted shares, the remainder `poolKobo - sum(shares)` is computed but if `remainder < distributions.length` (i.e., fewer kobo remain than there are recipients), the loop that distributes one extra kobo per recipient exits with unspent remainder. This remainder is never credited, tracked, or rolled over. Fix: credit the full remainder to the top-ranked creator (first in the sorted distribution list), or roll it into the next fund distribution period by tracking it in a `creator_fund_remainder` x_manifest key. Either way, log it and include it in the admin financial report.

---

### 25. BUG-DB-02: `push_tickets` table has no pruning — grows indefinitely

**FILES:**  
`apps/web/lib/notifications/push.ts`  
`apps/web/lib/db/schema.ts`

**FIX:**  
Push notification tickets are inserted into `push_tickets` when sending and then polled for receipt status. Tickets older than 24 hours are no longer queryable from Expo's servers, yet the rows remain in the table forever. Add a `created_at` column (if not present) and a CRON job that runs `DELETE FROM push_tickets WHERE created_at < NOW() - INTERVAL '48 hours' AND status IN ('ok', 'error', 'DeviceNotRegistered')`. Alternatively, add `ON DELETE CASCADE` or a PostgreSQL `pg_partman` retention policy.

---

### 26. BUG-PAGINATE-01: `listUserChallenges` silently truncates at 100 with no cursor

**FILES:**  
`apps/web/lib/games/challenges.ts`

**FIX:**  
The function issues `SELECT ... LIMIT 100` with no cursor-based pagination and no total count. Users with more than 100 challenges will never see the older ones. Implement cursor-based pagination using `challenge_id` (or `created_at` + `id` composite) as the cursor, consistent with the `coin_ledger` pagination pattern already in the codebase. Accept `cursor` and `limit` (max 50) parameters.

---

### 27. BUG-PERF-02: N+1 Redis calls in `eligibleRecipients` for chat push

**FILES:**  
`apps/web/lib/notifications/chatPush.ts`

**FIX:**  
For each candidate recipient, `eligibleRecipients` calls `isUserOnline(userId)` which makes one Redis call per user. With 100 recipients this is 100 sequential Redis round-trips. Replace with a Redis pipeline or `SMEMBERS` on the online users set to fetch all online user IDs in one call, then intersect locally with the recipient list. Alternatively use `redis.mget()` if online status is stored per key.

---

### 28. BUG-I18N-01: Expo missing Nigerian Pidgin locale

**FILES:**  
`apps/expo/lib/i18n/index.ts`  
`apps/web/lib/i18n/locales/` (pidgin.json exists on web)

**FIX:**  
The Expo app's `SupportedLocale` type is `'en' | 'fr' | 'ar' | 'ha' | 'sw' | 'am' | 'zu' | 'pt'` — missing `'pidgin'`. The web app has full pidgin locale support. Copy the `pidgin.json` locale file to the Expo project and add `'pidgin'` to `SupportedLocale` and the locale detection/loading logic in `apps/expo/lib/i18n/index.ts`.

---

### 29. BUG-I18N-02: `getServerTranslation` breaks for nested i18next dot-notation keys

**FILES:**  
`apps/web/lib/i18n/index.ts`

**FIX:**  
`getServerTranslation` does `messages[key] ?? key` where `messages` is a flat object. i18next supports nested keys accessed with dot-notation (e.g., `t('errors.network')`) and namespaced keys (`t('common:button.save')`). A flat lookup of `messages["errors.network"]` returns `undefined` even if the messages object has `messages.errors.network`. Implement a nested key resolver:
```ts
function resolveKey(obj: Record<string, unknown>, key: string): string {
  return key.split('.').reduce((o, k) => (o as Record<string, unknown>)?.[k], obj) as string ?? key;
}
```

---

### 30. BUG-SW-01: `sw.ts` `skipWaiting: true` contradicts manual anti-skip-waiting edit in `sw.js`

**FILES:**  
`apps/web/app/sw.ts`  
`apps/web/public/sw.js`

**FIX:**  
The source `sw.ts` has `skipWaiting: true` in the `Serwist` constructor. The compiled `sw.js` was manually edited after compilation to remove `self.skipWaiting()` and add an activate listener that posts `SW_UPDATED` to clients. This is the correct approach (avoids ChunkLoadErrors), but the source and output are inconsistent. When `next build` is next run, the new `sw.js` will re-add `skipWaiting()`. Fix the source: set `skipWaiting: false` in `sw.ts` and add the `SW_UPDATED` activate event listener in `sw.ts` directly so the correct behavior is preserved after every rebuild.

---

### 31. BUG-PRIV-01: Expo offline SQLite stores messages in plaintext

**FILES:**  
`apps/expo/lib/offline/sqlite.ts`

**FIX:**  
The offline message queue writes message content to a local SQLite database in plaintext. On a rooted Android device (or via Android Debug Bridge with root access), this data is trivially readable. Fix: use SQLCipher (the encrypted SQLite variant) via `expo-sqlite-encrypted` or `@op-engineering/op-sqlite` with encryption enabled. The encryption key should be derived from the user's login credentials or stored in Android Keystore. At minimum, document this limitation in the app's privacy policy and warn users that offline-cached messages may be readable on rooted devices.

---

### 32. BUG-NET-01: Expo `apiFetch.ts` has no retry logic for network failures

**FILES:**  
`apps/expo/lib/api/apiFetch.ts`

**FIX:**  
The fetch wrapper in the Expo app has no retry-with-backoff logic for transient network errors (connection timeout, `ENETUNREACH`, etc.). A single flaky network call permanently fails and surfaces an error to the user. Implement exponential backoff with jitter for network-error retries (not 4xx/5xx — only for thrown exceptions indicating network failure). Example: 3 retries at 1s, 2s, 4s with ±20% jitter. The `syncQueue.ts` already has good retry logic; apply the same pattern to `apiFetch`.

---

### 33. BUG-MOD-01: Bot/spam detection blocks message but never flags or alerts on the account

**FILES:**  
`apps/web/lib/moderation/contentFilter.ts`

**FIX:**  
When `contentFilter.ts` detects a bot pattern or spam content, it returns `{ blocked: true }` but takes no action on the sender's account. The same bot can send the same content indefinitely (one blocked message at a time) with no escalating consequence. Fix: after blocking a message, increment a Redis counter `bot:strikes:{userId}` with a 24-hour TTL. On 3 strikes, automatically create a moderation report in the `reports` table flagging the user for admin review, and post a webhook or push notification to a moderation admin channel. This creates an escalating response without requiring manual review of every blocked message.

---

### 34. BUG-SPAM-01: URL regex in antispam may false-positive on English words ending in TLD-like suffixes

**FILES:**  
`apps/web/lib/messaging/antispam.ts`

**FIX:**  
The URL detection regex returned by `getUrlRegex()` matches tokens that end in common TLD suffixes (`.com`, `.net`, `.io`, etc.) without requiring the token to contain `://` or `www.`. Common English words like `"become"`, `"income"`, `"reform"` match `.com`, `.net`, `.org` suffixes and can trigger false positives. Tighten the regex to require either a scheme (`https?://`, `ftp://`) or a `www.` prefix, or use a validated URL parsing library like the WHATWG `URL` constructor in a `try/catch` instead of regex matching.

---

### 35. BUG-CORS-01: CORS fallback sets `Access-Control-Allow-Origin: null` (string literal)

**FILES:**  
`apps/web/middleware.ts`

**FIX:**  
When an origin doesn't match the allowlist, the middleware sets `Access-Control-Allow-Origin: null` (the string `"null"`, not the absence of the header). Browsers send `Origin: null` for requests from sandboxed iframes, `<iframe sandbox>` content, and `file://` origins — these all match the string `"null"` origin. This means sandboxed iframes can bypass CORS and make credentialed requests to the API. Fix: when the origin doesn't match, do NOT set any `Access-Control-Allow-Origin` header at all. The browser will block the preflight/request by default.

---

### 36. BUG-AUDIT-01: Audit trail fragmented between two tables; `auditLog.ts` uses `console.error`

**FILES:**  
`apps/web/lib/audit/auditLog.ts`  
Multiple admin API routes

**FIX:**  
General events are logged to `audit_log` via `auditLog.ts`, while admin-specific actions are logged directly to `admin_audit_log` by individual route handlers. There is no unified view, no foreign key relationship between them, and searching audit history requires querying two tables. Consolidate: either merge `admin_audit_log` into `audit_log` with an `actor_type` column (`'user' | 'admin'`), or have `auditLog.ts` route to the correct table based on context. Additionally, the `auditLog.ts` error handler uses `console.error` instead of the structured `logger` — replace it.

---

### 37. BUG-LOG-01: Multiple files use `console.error` instead of structured Pino logger

**FILES:**  
`apps/web/lib/moderation/contentFilter.ts`  
`apps/web/lib/notifications/chatPush.ts`  
`apps/web/lib/realtime/index.ts`  
`apps/web/lib/db/providers/supabase.ts` (pool error handler)  
`apps/web/lib/db/providers/railway.ts` (pool error handler, ROLLBACK failure)  
`apps/web/lib/db/providers/digitalocean.ts` (pool error handler, ROLLBACK failure)

**FIX:**  
Replace all `console.error(...)` calls with `logger.error({ err, ... }, 'message')` using the structured Pino logger from `@/lib/logger`. This ensures errors are captured in the same structured log stream as the rest of the application and are searchable by field (e.g., in Vercel Log Drains or Datadog).

---

### 38. BUG-FRAUD-01: Fraud check helpers swallow all errors — network failures silently pass as healthy

**FILES:**  
`apps/web/lib/fraud/payouts.ts`

**FIX:**  
Each individual fraud check function (e.g., `checkTrustScore`, `checkSuspiciousInflow`) wraps its DB query in a `try/catch` with an empty catch that returns a "passing" default score (e.g., `50` out of 100). If the trust score service or DB is unavailable, every payout passes the trust check silently. Fix: (a) catch errors and return a `{ passed: false, reason: 'check_unavailable', score: 0 }` result that puts the payout into a manual review queue, or (b) surface the error to the caller and let `runFraudChecks` aggregate whether checks are available before proceeding. Also: `SUSPICIOUS_INFLOW_MIN_ACCOUNTS = 3` is hardcoded — add it to the manifest so admins can tune fraud thresholds without a code deploy.

---

### 39. BUG-IMAGES-01: `next.config.js` uses `*.supabase.co` wildcard for image domains

**FILES:**  
`apps/web/next.config.js`

**FIX:**  
The image remote pattern `hostname: "*.supabase.co"` allows Next.js's image optimization to proxy images from ANY `*.supabase.co` subdomain. Since Supabase subdomains are project-specific and attacker-controlled (an attacker can create their own Supabase project at `evil.supabase.co`), this allows a stored XSS bypass via image proxy if Next.js image optimization has any SVG or content-type mishandling. Fix: set `NEXT_PUBLIC_SUPABASE_HOST` to the specific project hostname (e.g., `abcdef.supabase.co`) in production and document it in `.env.example`. Add it to the `required` fields of the Zod schema in `env.ts` for production deployments.

---

### 40. BUG-MANIFEST-01: `vipRoomPricing` and `currenciesAccepted` manifest fields never populated

**FILES:**  
`apps/web/lib/manifest/index.ts`

**FIX:**  
The `ZobiaManifest` TypeScript interface declares `features.vipRoomPricing?: { minNgn: number; maxNgn: number }` and `payment.currenciesAccepted?: string[]` as valid fields. However, `buildManifest()` never reads x_manifest keys for either field — they are always `undefined` in the runtime manifest object. If any code path relies on these fields, it will receive `undefined` unexpectedly. Either: (a) add the corresponding x_manifest keys (`vip_room_pricing_min_ngn`, `vip_room_pricing_max_ngn`, `payment_currencies_accepted`) to `buildManifest()` and `.env.example`, or (b) remove these fields from the `ZobiaManifest` interface if they are not yet implemented.

---

## Post-Fix Projected Rating

After all fixes are applied:

| Category | Before | After |
|---|---|---|
| Security | 5.5 | 9.0 |
| Financial Integrity | 7.5 | 9.5 |
| Reliability / Uptime | 5.0 | 8.5 |
| Scalability | 7.0 | 8.5 |
| Code Quality | 7.5 | 9.0 |
| Privacy | 6.0 | 8.0 |
| **Overall** | **6.8** | **8.9** |

---

*Report generated: June 21, 2026 — 11:58 PM*  
*Zobia Social — Forensic Bug Report v1.0*
