# Zobia Social — Setup Guide

## Prerequisites

Before you begin, you will need accounts and tools for the following:

### Accounts
- **Vercel** — app hosting and deployment (vercel.com)
- **Supabase** — PostgreSQL database + optional storage + optional realtime (supabase.com)
- **Paystack** — Africa-first payments (paystack.com)
- **DodoPayments** — global payments (dodopayments.com)
- **Mailgun** — transactional email (mailgun.com)
- **DeepSeek** — primary AI moderation (platform.deepseek.com)
- **Google AI Studio** — Gemini fallback AI (aistudio.google.com)
- **Google Cloud Console** — OAuth 2.0 credentials (console.cloud.google.com)
- **Telegram BotFather** — Telegram login bot (@BotFather on Telegram)
- **Expo** — React Native build platform (expo.dev)
- **EAS CLI** — Expo Application Services for Android builds
- **Redis / Upstash** — session store, presence, rate limiting, cron idempotency

### Optional (for non-Supabase storage)
- **Cloudflare** — R2 object storage (cloudflare.com) — recommended for production

### Local Tools
- **Node.js 20+** — `node --version` must show v20 or higher
- **npm 10+** — bundled with Node 20. **This repo is an npm-workspaces monorepo with a single root `package-lock.json`.** Do **not** use pnpm or yarn, and do **not** run `npm install` inside `apps/expo` — that creates a nested `apps/expo/package-lock.json` and a divergent `node_modules` that breaks the EAS Android build. See [Mobile (Expo) Android APK Build](#mobile-expo-android-apk-build).
- **EAS CLI** — `npm install -g eas-cli`
- **Git**

---

## Quick Start (Supabase + Vercel default path)

```bash
# 1. Clone the repository
git clone https://github.com/your-org/zobia-social.git
cd zobia-social

# 2. Install dependencies — ALWAYS from the repo root (npm workspaces).
#    Never run `npm install` inside apps/expo or apps/web individually.
npm install

# 3. Copy environment variables
cp apps/web/.env.example apps/web/.env.local

# 4. Fill in all required env vars (see Environment Variables Reference below)
#    At minimum: DATABASE_URL, DIRECT_URL, JWT_SECRET, JWT_REFRESH_SECRET, REDIS_URL

# 5. Run database migrations (canonical directory — numbered 001 onwards, always in order)
cd apps/web
for f in db/migrations/*.sql; do
  echo "Applying $f..."
  psql "$DATABASE_URL" < "$f"
done

# 6. Start the development server (web)
npm run dev:web

# 7. Open http://localhost:3000
```

### Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Link and deploy
vercel link
vercel env pull apps/web/.env.local   # sync env vars from Vercel dashboard
vercel deploy --prod
```

### Verify deployment

After deploying, confirm the app is healthy:

```bash
# Health check — returns 200 when DB and Redis are reachable
curl https://your-domain.com/api/health
# Expected: { "status": "ok", "db": "ok", "redis": "ok", "circuit": "closed", "timestamp": "..." }
```

`GET /api/health` returns HTTP 200 when all backing services (database and Redis) are reachable. It returns HTTP 503 with `"status": "degraded"` if any service is unavailable. Configure your load balancer or uptime monitor to poll this endpoint.

---

## Mobile (Expo) Android APK Build

> **Read this before touching the Expo app or the Android build.** This monorepo
> hits several non-obvious traps that have historically broken the EAS APK build
> at the very last step (the Metro JS bundle), *after* ~4 minutes of native
> compilation. Each is cheap to avoid and expensive to debug from scratch.

The Android APK is built in the cloud with **Expo EAS Build** — there is no local
Android Studio requirement. It is triggered by `.github/workflows/build-android.yml`
(which runs `eas build --platform android --profile preview`) and requires the
`EXPO_TOKEN` repository secret. Without `EXPO_TOKEN` the workflow skips the build
(this is the only reason older runs "passed"). Target is **Android API level 36**.

### ⚠️ The five rules that keep the Android build green

1. **One lockfile, installed from the root.** This is an npm-workspaces monorepo.
   Run `npm install` **only from the repo root**. Never run it inside `apps/expo`
   or `apps/web` — that produces a nested `package-lock.json` and a divergent
   `node_modules`, which is exactly what fragments dependency resolution on EAS.
   There must be exactly one `package-lock.json`, at the repo root.

2. **Do NOT unify the React version.** The two apps run different React majors **on
   purpose**:
   - `apps/web` (Next.js 15) → `react@18.3.1`
   - `apps/expo` (React Native 0.74) → `react@18.2.0` (RN 0.74 has a *strict*
     `react@18.2.0` peer; 18.3.1 makes `npm install` fail with `ERESOLVE`).

   Because of this split, **`expo-router` cannot hoist to the root `node_modules`** —
   it stays nested under `apps/expo/node_modules` so it binds the app's `react@18.2.0`.
   Do not "fix" the warning by aligning versions; that either breaks the install
   (RN peer) or causes a dual-React runtime crash (`Invalid hook call`).

3. **Keep the explicit expo-router Babel plugin in `apps/expo/babel.config.js`.**
   `babel-preset-expo` only applies its expo-router transform if it can
   `require.resolve('expo-router')` relative to **its own** location. `babel-preset-expo`
   hoists to the repo root, but (per rule 2) `expo-router` is nested under `apps/expo`,
   so that detection silently fails, the transform is skipped, and
   `process.env.EXPO_ROUTER_APP_ROOT` is left un-inlined. The release bundle then dies with:

   ```
   SyntaxError: expo-router/_ctx.android.js: Invalid call ... process.env.EXPO_ROUTER_APP_ROOT
   First argument of `require.context` should be a string
   ```

   `apps/expo/babel.config.js` works around this by applying
   `babel-preset-expo/build/expo-router-plugin`'s `expoRouterBabelPlugin` explicitly
   (resolved from `apps/expo`, so it loads the correct nested copy). **Do not remove it**
   unless the React split above is also removed.

4. **AdMob app ID lives in `app.json`, as a root-level key — and the warning is expected.**
   `react-native-google-mobile-ads` reads the app ID at build time from its **own** Gradle
   script (`android/app-json.gradle`), not from an Expo config plugin. It must therefore sit
   as a **sibling of the `expo` object** in `apps/expo/app.json`:

   ```jsonc
   {
     "expo": { ... },
     "react-native-google-mobile-ads": {
       "android_app_id": "ca-app-pub-XXXXXXXX~XXXXXXXX",
       "ios_app_id": "ca-app-pub-XXXXXXXX~XXXXXXXX"
     }
   }
   ```

   Expo CLI prints `Ignoring extra key in Expo config: "react-native-google-mobile-ads"` —
   this is **harmless and expected**; Expo's config normaliser ignores the key but Gradle
   still reads the raw file. If `android_app_id` is *missing*, the Gradle build hard-fails
   with `System.exit(1)` (it will not even reach the bundle step). The values above are
   Google's official **test** IDs — replace them with your live AdMob IDs before release.

5. **`google-services.json` is required for native Google Sign-In on Android.**
   Place a valid `google-services.json` (downloaded from the Firebase Console or Google Cloud
   Console under the **Android** OAuth client) at `apps/expo/google-services.json`. EAS Build
   picks it up automatically. Without it, the native GoogleSignIn module fails to initialize
   and all Google OAuth attempts silently return an error. The file is `.gitignore`d and must
   be set as an EAS secret (or supplied at build time via the EAS credentials UI) for CI builds.
   For local development, download it from the Firebase Console → your Android app → "Download
   google-services.json".

6. **`mobileAds().initialize()` must run at startup.** The native app ID in the manifest is
   only half of the wiring — the SDK must also be initialised once in JS or ads silently
   never serve (no crash, just no-fill). This repo calls `initializeAds()`
   (`apps/expo/lib/ads/admob.ts`) from the root layout's startup effect
   (`apps/expo/app/_layout.tsx`). Per-surface ad unit IDs come from
   `EXPO_PUBLIC_ADMOB_*` env vars and fall back to `TestIds` in dev.

### Triggering a build

- `.github/workflows/build-android.yml` auto-runs on pushes to `main` (and the
  configured build branch) that touch `apps/expo/**`. Feature branches are **not**
  auto-built — use **Actions → Build Android APK → Run workflow** (`workflow_dispatch`)
  to build any branch manually, or merge to `main`.
- To validate the JS bundle locally **without** a native build (catches rules 1–3 in
  seconds rather than via a full cloud build):

  ```bash
  cd apps/expo
  NODE_ENV=production npx expo export --platform android --output-dir /tmp/expo-export
  # Success looks like: "Android Bundled … node_modules/expo-router/entry.js (NNNN modules)"
  ```

### Building without a full set of env vars (CI / local type-check)

The build validates all required env vars at startup via `lib/env.ts`. In CI environments where secrets aren't available (e.g. for a type-check or lint-only run), set `SKIP_ENV_VALIDATION=1`:

```bash
SKIP_ENV_VALIDATION=1 npm run build
```

This skips the Zod validation step and exports an empty `env` object. API routes will still fail at runtime if accessed without valid env vars — `SKIP_ENV_VALIDATION` is only intended for the build/type-check phase.

### Running on free tiers (Vercel Hobby + free Redis)

The app is tuned to stay within a free Redis plan and Vercel Hobby's serverless quotas. Two mechanisms do the heavy lifting (see *HOW-IT-WORKS.md → Redis Cost Controls* for detail):

- **Per-instance L1 caching** of the per-request session and account-status reads, so a warm function makes ~0 Redis reads for auth instead of ~3–4 per request.
- **Activity-based chat-poll backoff** (3s active → 15s idle, paused when the tab is hidden), so an idle chat costs ~4 polls/minute instead of ~20. Each avoided poll is both a saved Redis round-trip and a saved serverless invocation.

To cut Redis/invocation load further, configure a **realtime provider** (see *Realtime Setup*). When connected, chat surfaces drop to a 30s reconcile poll and receive messages over the provider's WebSocket instead — no extra Redis. Presence heartbeats remain at 45s and self-expire via short Redis TTLs, so they do not need explicit cleanup calls.

---

## Environment Variables Reference

All variables belong in `apps/web/.env.local` locally and in the Vercel project environment variables for production.

| Variable | Required | Description | Where to get it |
|---|---|---|---|
| `DATABASE_PROVIDER` | Yes | Database backend: `supabase` \| `railway` \| `digitalocean` | Choose your provider |
| `DATABASE_URL` | Yes | Pooled connection string — **transaction mode** (for serverless/Vercel functions) | Supabase → Settings → Database → "Use pooler transaction mode" |
| `DIRECT_URL` | Yes | Direct connection string — bypasses the pooler, used for migrations only | Supabase → Settings → Database → "Use the direct connection string" |
| `DB_POOL_SIZE` | No | Connection pool size for the pooled `DATABASE_URL` (default: `2`). Keep at 2 for serverless/Vercel functions to avoid exhausting the PgBouncer connection limit. | — |
| `DB_DIRECT_POOL_SIZE` | No | Connection pool size for `DIRECT_URL` used in migrations/long-running scripts (default: `2`). | — |

> **TCP keepalive is always enabled** on all database pools (`keepAlive: true`, initial delay 10 s). This prevents idle connections from being silently dropped by NAT or cloud provider firewalls — a common issue on Railway and DigitalOcean managed databases. No configuration is needed.
| `DB_CA_CERT` | **Yes for Supabase** | PEM-encoded CA certificate for TLS verification of the database connection. **Required for Supabase** — its pooler uses a private CA that is not in Node's system trust store, so without this the driver fails with `SELF_SIGNED_CERT_IN_CHAIN` in production. Also required for any other self-signed/custom CA. SSL is always enforced (`rejectUnauthorized: true`). | Supabase → Settings → Database → SSL Configuration → Download certificate |
| `STORAGE_PROVIDER` | Yes | Storage backend: `supabase-storage` \| `r2` \| `s3` | Choose your provider |
| `R2_ACCOUNT_ID` | If R2 | Cloudflare account ID | Cloudflare dashboard → right sidebar |
| `R2_ACCESS_KEY_ID` | If R2 | R2 API access key ID | Cloudflare → R2 → Manage R2 API tokens |
| `R2_SECRET_ACCESS_KEY` | If R2 | R2 API secret access key | Cloudflare → R2 → Manage R2 API tokens |
| `R2_BUCKET_NAME` | If R2 | Name of the R2 bucket | Cloudflare → R2 → Buckets |
| `R2_PUBLIC_URL` | If R2 | Public URL for the R2 bucket (e.g. `https://pub-xxx.r2.dev`) | Cloudflare → R2 → Bucket settings |
| `REALTIME_PROVIDER` | Recommended | Realtime backend: `supabase-realtime` \| `ably` \| `pusher`. Optional — when unset, chat (rooms, DMs, groups) still delivers messages via a 3-second baseline poll; set it for instant WebSocket push. | Choose your provider |
| `SUPABASE_URL` | If supabase-realtime | Supabase project URL (e.g. `https://xxx.supabase.co`) | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | If supabase-realtime | Service-role key — server-side only, never expose to clients | Supabase → Project Settings → API |
| `ABLY_API_KEY` | If ably | Ably API key with Publish capability (Root key or custom key) | Ably Console → API Keys |
| `PUSHER_APP_ID` | If pusher | Pusher app ID | Pusher Dashboard → App Keys |
| `PUSHER_KEY` | If pusher | Pusher app key (public identifier) | Pusher Dashboard → App Keys |
| `PUSHER_SECRET` | If pusher | Pusher app secret (server-side only) | Pusher Dashboard → App Keys |
| `PUSHER_CLUSTER` | If pusher | Pusher cluster region (e.g. `mt1`, `eu`, `us2`) | Pusher Dashboard → App Keys |
| `REDIS_URL` | Yes | Redis connection URL (e.g. `redis://localhost:6379` or Upstash URL) | Upstash → Create Database → REST URL |
| `REDIS_PROVIDER` | Yes | `ioredis` \| `upstash` | Choose your provider |
| `UPSTASH_REDIS_REST_URL` | If Upstash | Upstash REST URL | Upstash → Database → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | If Upstash | Upstash REST token | Upstash → Database → REST API |
| `JWT_SECRET` | Yes | Secret for signing access tokens (min 32 chars) | `openssl rand -hex 64` |
| `JWT_REFRESH_SECRET` | Yes | Secret for signing refresh tokens (different from JWT_SECRET) | `openssl rand -hex 64` |
| `GOOGLE_CLIENT_ID` | No | Google OAuth 2.0 client ID — Google login is hidden when not set | Google Cloud Console → Credentials |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth 2.0 client secret — required when GOOGLE_CLIENT_ID is set | Google Cloud Console → Credentials |
| `TELEGRAM_BOT_TOKEN` | No | Telegram bot token — Telegram login widget is hidden when not set | @BotFather → /newbot |
| `TELEGRAM_WEBHOOK_SECRET` | No | Secret for authenticating incoming Telegram webhook requests | Generate a random string |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Yes | Bot username **without** the `@` (e.g. `ZobiaBot`) — used by the Telegram Login Widget on the frontend. Without this, the widget is hidden. | @BotFather → `/mybots` → select your bot → username shown at the top |
| `DEEPSEEK_API_KEY` | No* | DeepSeek API key for AI moderation. Optional — app starts without it, but AI moderation calls will fail if not set. | platform.deepseek.com → API Keys |
| `DEEPSEEK_API_ENDPOINT` | No | Override endpoint (default: `https://api.deepseek.com/v1`) | DeepSeek docs |
| `GEMINI_API_KEY` | No* | Google Gemini API key (AI fallback). Optional — at least one AI key should be set for moderation to work. | aistudio.google.com → Get API key |
| `MAILGUN_API_KEY` | No | Mailgun API key for transactional email | Mailgun → Account → API Keys |
| `MAILGUN_DOMAIN` | No | Mailgun sending domain (e.g. `mg.yourdomain.com`) | Mailgun → Sending → Domains |
| `PAYSTACK_SECRET_KEY` | No | Paystack secret key — must have Transfers permission enabled | Paystack dashboard → Settings → API Keys |
| `PAYSTACK_PUBLIC_KEY` | No | Paystack public key | Paystack dashboard → Settings → API Keys |
| `DODOPAYMENTS_API_KEY` | No | DodoPayments API key | DodoPayments dashboard → API |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | No | Google Play service account JSON (base64-encoded or raw) for Android IAP verification | Google Play Console → Setup → API access |
| `GOOGLE_PLAY_PACKAGE_NAME` | No | Your Android app's package name for IAP purchase validation (default: `com.zobia.app`). Must match the package name in your Google Play Console app. | Google Play Console → App details |
| `ADMOB_APP_ID` | No | Google AdMob app ID (for rewarded ads + game banner ads in the Expo app) | AdMob → Apps |
| `NEXT_PUBLIC_ADSENSE_CLIENT` | No | Google AdSense client id (`ca-pub-…`) for web/PWA ad slots (incl. game pages). Without it, `<AdSlot>` renders a labelled placeholder when ads are enabled. | AdSense → Account |
| `NEXT_PUBLIC_ADSENSE_SLOT` | No | Default AdSense ad-unit slot id used by `<AdSlot>` | AdSense → Ads → By ad unit |
| `RECAPTCHA_SITE_KEY` | No | reCAPTCHA v3 site key (if using reCAPTCHA) | console.cloud.google.com → reCAPTCHA |
| `RECAPTCHA_SECRET_KEY` | No | reCAPTCHA v3 secret key | console.cloud.google.com → reCAPTCHA |
| `CLOUDFLARE_TURNSTILE_SITE_KEY` | No | Cloudflare Turnstile site key (preferred over reCAPTCHA) | Cloudflare → Turnstile |
| `CLOUDFLARE_TURNSTILE_SECRET_KEY` | No | Cloudflare Turnstile secret key | Cloudflare → Turnstile |
| `CRON_SECRET` | Prod | Shared secret for CRON endpoint authentication. Required in production. | `openssl rand -hex 32` |
| `KYC_ENCRYPTION_KEY` | No | 32-byte hex key for AES field-level encryption of KYC data | `openssl rand -hex 32` |
| `SERVICE_TOKEN` | No | Service-to-service auth token for internal endpoints (e.g. XP award). Defaults to `JWT_SECRET` if unset. | `openssl rand -hex 32` |
| `TENOR_API_KEY` | No | Tenor GIF API key — enables Tenor GIF search in messages | console.cloud.google.com → Tenor API |
| `GIPHY_API_KEY` | No | Giphy GIF API key — fallback GIF search | developers.giphy.com |
| `EXPO_ACCESS_TOKEN` | No | Expo access token for enhanced push notification delivery | expo.dev → Account → Access tokens |
| `EXPO_ORIGIN` | No | Origin URL of the Expo mobile app (e.g. `https://expo.dev` or your custom scheme) used by the CSRF middleware to allow requests from the mobile app. Must match the `Origin` header sent by the Expo Axios client. Defaults to `NEXT_PUBLIC_APP_URL` if unset. | Your Expo app origin |
| `PROFANITY_WORDLIST` | No | Comma-separated list of additional profanity words to block | Custom list |
| `NEXT_PUBLIC_APP_URL` | Yes | Full public URL of the app (e.g. `https://zobia.vercel.app`, later `https://zobia.org`). Drives canonical URLs, sitemap, `robots.txt`, OG tags and referral links. No trailing slash. | Your domain |
| `NEXT_PUBLIC_API_URL` | Yes | Full public API URL (e.g. `https://zobia.vercel.app/api`) | Your domain |
| `NEXT_PUBLIC_REALTIME_PROVIDER` | Recommended | Client-side realtime provider — must match `REALTIME_PROVIDER`. Optional; without it the client falls back to the 3-second baseline poll. | `supabase-realtime` \| `ably` \| `pusher` |
| `NEXT_PUBLIC_SUPABASE_URL` | If supabase-realtime | Supabase project URL — same as `SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | If supabase-realtime | Supabase anon/public key — safe to expose to browsers | Supabase → Project Settings → API → `anon public` |
| `NEXT_PUBLIC_PUSHER_KEY` | If pusher | Pusher App Key (public identifier, same as `PUSHER_KEY`) | Pusher Dashboard → App Keys |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | If pusher | Pusher cluster region (e.g. `mt1`, `eu`) | Pusher Dashboard → App Keys |
| `NEXT_PUBLIC_PWA_WEB_ENABLED` | No | Set to `"false"` to disable PWA/service-worker generation at build time. Default: `"true"` | `"true"` or `"false"` |
| `NODE_ENV` | Auto | Runtime environment — set automatically by Next.js (`development` \| `test` \| `production`) | Set by Next.js |
| `SKIP_ENV_VALIDATION` | Build only | Set to `"1"` to bypass env-var validation at build time (CI type-check only). Never set in production. | `"1"` |
| `MONITORING_PROVIDER` | No | Error monitoring provider: `sentry` \| `newrelic` \| `none` (default: `none`) | Choose your provider |
| `SENTRY_DSN` | If sentry | Sentry Data Source Name — required when `MONITORING_PROVIDER=sentry` | Sentry → Project Settings → Client Keys (DSN) |
| `NEW_RELIC_LICENSE_KEY` | If newrelic | New Relic ingest licence key — required when `MONITORING_PROVIDER=newrelic` | New Relic → API keys |
| `JWT_KEY_ID` | No | Key ID embedded in JWT headers for key-rotation versioning (default: `v1`). Increment when rotating `JWT_SECRET` to allow grace-period validation of old tokens. | Choose (e.g. `v1`, `v2`) |
| `JWT_REFRESH_SECRET_v{N}` | No | Previous refresh token signing secret(s) kept during key rotation grace period (e.g. `JWT_REFRESH_SECRET_v1`, `JWT_REFRESH_SECRET_v2`). The server accepts refresh tokens signed with any key in the registry. When rotating, set the old secret as `JWT_REFRESH_SECRET_v{old_kid}`, update `JWT_REFRESH_SECRET` to the new value, and update `JWT_KEY_ID`. Old secrets can be removed after the refresh token TTL expires. | `openssl rand -hex 64` |
| `SECURITY_TEST_BASE_URL` | Testing only | Base URL for security/penetration tests (e.g. `http://localhost:3000`) | Local dev server |
| `SECURITY_TEST_USER_TOKEN` | Testing only | Valid JWT for a regular (non-admin) test user | Login as test user and copy token |
| `SECURITY_TEST_ADMIN_TOKEN` | Testing only | Valid JWT for an admin test user | Login as admin and copy token |
| `SECURITY_TEST_USER_ID` | Testing only | UUID of the regular test user | From `users` table |
| `SECURITY_TEST_OTHER_USER_ID` | Testing only | UUID of a second test user (for IDOR tests) | From `users` table |

---

## Database Setup

### Option A: Supabase (default)

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Choose a region close to your users.
3. Wait for the project to finish provisioning (about 60 seconds).
4. Navigate to **Settings → Database**.
5. Supabase shows three connection options — here is which one to use for each env var:

   | Supabase option | Use for |
   |---|---|
   | **"Use the direct connection string"** | `DIRECT_URL` — migrations, `pg_dump`, schema changes |
   | **"Use pooler transaction mode"** | `DATABASE_URL` — all runtime app traffic on Vercel (serverless) |
   | **"Use pooler session mode"** | Not needed for this project |

   Copy the **pooler transaction mode** string → paste as `DATABASE_URL`.  
   Copy the **direct connection string** → paste as `DIRECT_URL`.

   > **Required: download the SSL CA certificate.** Supabase's connection
   > pooler presents a **private** CA chain that is not in Node's system trust
   > store. Because the app enforces TLS verification in production
   > (`rejectUnauthorized: true`), you **must** provide the CA or every query
   > fails with `self-signed certificate in certificate chain`
   > (`SELF_SIGNED_CERT_IN_CHAIN`) — which silently breaks login, the manifest,
   > and all DB-backed features. To fix it:
   >
   > 1. Go to **Settings → Database → SSL Configuration → "Download
   >    certificate"** (a `prod-ca-*.crt` file).
   > 2. Open the file and copy its full PEM contents (including the
   >    `-----BEGIN CERTIFICATE-----` / `-----END CERTIFICATE-----` lines).
   > 3. Set it as `DB_CA_CERT`. On Vercel: **Project → Settings → Environment
   >    Variables → Add** `DB_CA_CERT`, paste the multi-line PEM as the value,
   >    apply it to **Production** (and Preview), then **redeploy**.
6. Run all migrations in order (use the canonical `db/migrations/` directory, **not** `lib/db/migrations/`):
   ```bash
   cd apps/web
   for f in db/migrations/*.sql; do
     echo "Applying $f..."
     psql "$DIRECT_URL" < "$f"
   done
   ```
   Migrations are numbered 001 onwards. Always apply them in order. Each migration is idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).

   Migration `0002_bug_fixes.sql` adds:
   - UNIQUE index on `subscriptions (user_id)` — required for `ON CONFLICT (user_id)` upserts in the Paystack webhook to work correctly
   - Widens `users.star_balance` from `integer` to `bigint` — prevents overflow at ~2.1 billion stars
   - Backfills `user_badges.awarded_at` from `granted_at` and drops the legacy `granted_at` column
   - Consolidates `learning_certificates` legacy columns (`classroom_room_id`, `student_id`, `issuer_id`) into canonical columns; recreates unique index on `(room_id, recipient_user_id)`
   - Consolidates `moderation_actions` duplicate columns: drops `actioned_by`, `action`, `note`; keeps `moderator_id`, `action_type`, `reason`
   - Removes `sponsored_quests.reward_amount_coins` (duplicate of `reward_coins`)
   - Removes `gift_items.coin_price` (duplicate of `coin_cost`)

   Migration `0003_bug_fixes.sql` adds:
   - `left_at TIMESTAMPTZ` column to `guild_members` + partial index for active-member lookups
   - UNIQUE constraint on `payout_dead_letter_queue.payout_id` — prevents duplicate DLQ entries for the same payout
   - `reference_id TEXT` column to `notifications` + partial unique index `uidx_notifications_user_type_ref (user_id, type, reference_id) WHERE reference_id IS NOT NULL` — required for idempotent `ON CONFLICT ... DO NOTHING` notification inserts (batch events, CRON awards)
   - UNIQUE partial index on `xp_ledger (user_id, source, reference_id) WHERE reference_id IS NOT NULL` — required for `safeAwardXP` deduplication
   - Fixes `season_pass_milestones` unique index to include `tier` so free and paid milestones can share `sort_order` values
   - Adds `war_id UUID` to `guild_tier_history` + unique index so each guild war produces at most one tier-history entry per guild

   Migration `012_session_bug_fixes.sql` adds:
   - `updated_at` column to `seasons` table
   - UNIQUE index on `room_subscriptions (room_id, user_id)` — required for Paystack VIP room subscription webhook
   - UNIQUE index on `season_pass_milestones (season_id, sort_order)` — required for season pass seeding
   - `tier` column to `referral_commissions`
   - Partial unique index on `failed_xp_awards` for XP DLQ idempotency
   - Broadened `audit_discrepancies.asset_type` CHECK constraint to include `'xp'`

   Migration `010_feature_flags_table.sql` adds:
   - `feature_flags` table (key, available_from, early_access_plans) for admin-controlled feature gating beyond the boolean toggle in `x_manifest`
   - `next_renewal_at TIMESTAMPTZ` column to `user_subscriptions` — written by the Paystack subscription webhook
   - `pre_auth_session TEXT` column to `users` — stores the active pre-auth JWT during 2FA verification; cleared after successful 2FA to prevent token reuse
   - Seeds standard feature flags (`feature_guild_wars`, `feature_mystery_xp_drops`, `feature_alliance_wars`, etc.) into `x_manifest`

   Migration `011_performance_indexes.sql` adds:
   - Covering indexes on `xp_ledger (user_id, source, reference_id)`, `(user_id, source, created_at::date)`, and `(user_id, track, created_at)` for dedup and leaderboard queries
   - Unique index on `coin_ledger (reference_id)` for idempotent coin credits
   - Indexes on `leaderboard_snapshots`, `leaderboard_rank_snapshots`, `nemesis_assignments`, `referrals`, `user_inactivity_events`, `failed_xp_awards`, `guild_members`, `creator_payouts`, and `payments`
   - All indexes use `IF NOT EXISTS` and are safe to apply on a live database

   Migration `0004_custom_bug_fixes.sql` adds:
   - `x_manifest.value` column widened from JSONB to TEXT (prevents silent JSON coercions for plain string config values)
   - `star_ledger.amount` widened from INTEGER to BIGINT (safe up to ~9.2 × 10¹⁸ stars)
   - `creator_bank_accounts` — drops the 1:1 unique constraint on `creator_id`; adds `is_primary BOOLEAN` and `deleted_at TIMESTAMPTZ` to support multiple bank accounts per creator; adds a partial unique index `(creator_id) WHERE is_primary = TRUE AND deleted_at IS NULL`
   - `dm_conversations` — CHECK constraint `user_id_1 < user_id_2` to enforce canonical ordering; deduplicates any existing rows that violated the ordering
   - `users.last_login_date DATE` — date-only column for efficient streak calculations (backfilled from `last_login_at`); indexed
   - `users.longest_streak INTEGER` — tracks the user's all-time best login streak (backfilled from current `login_streak_days`)
   - `nemesis_assignments.last_notified_at TIMESTAMPTZ` — prevents repeated notifications for the same nemesis state change
   - Partial unique index on `alliance_wars (alliance_1_id, alliance_2_id) WHERE status = 'active'` — prevents duplicate active wars between the same alliance pair
   - Partial unique index on `coin_ledger (transaction_type, reference_id) WHERE reference_id IS NOT NULL` — deduplicates monthly Creator Fund distributions
   - Partial index on `creator_payouts (next_retry_at) WHERE status IN ('pending', 'processing')` — speeds up the payout retry queue
   - `push_tickets` table — two-stage Expo push receipt tracking (see Push Notification System in HOW-IT-WORKS.md)
   - `failed_webhooks` — adds `resolved`, `resolved_at`, `retry_count`, `last_error`, `next_retry_at`, `updated_at` columns for structured webhook retry tracking

   Migration `0006_custom_bug_fixes_round2.sql` adds:
   - Recreates `coin_ledger`'s dedup index as `(user_id, transaction_type, reference_id)` — the original `0004` index (scoped only to `transaction_type, reference_id`) let two different users sharing the same reference (e.g. a guild quest reward keyed only on `questId`) collide, silently dropping every credit/debit after the first user's
   - Partial unique index on `star_ledger (user_id, transaction_type, reference_id) WHERE reference_id IS NOT NULL` — gives Star credits/debits the same idempotent-retry support as coins and XP
   - `room_messages.idempotency_key TEXT` — lets offline-queued sends (Expo sync queue / PWA) be safely retried without creating duplicate messages on reconnect

   Migration `0012_slugs_and_referrals.sql` adds (SEO-friendly URLs + referral attribution):
   - `rooms.slug` + partial unique index `rooms_slug_unique_idx`, and **backfills** slugs for all existing rooms (deduped with a numeric suffix). New rooms get a slug at creation time via `lib/slug.ts`.
   - `games` table (upcoming feature) backing the public `/g/<slug>` route + referral links.
   - `slug_redirects` table — records retired slugs so renamed Rooms/games 301-redirect instead of 404.
   - Points `x_manifest.deep_link_base_url` at the active domain (away from the retired `zobia.social`).

   Migration `0014_bug_fixes_round3.sql` adds:
   - `guilds.wars_drawn INTEGER NOT NULL DEFAULT 0` — tracks draw outcomes for guilds; required for the alliance war tie resolution path
   - `guild_alliances.wars_drawn INTEGER NOT NULL DEFAULT 0` — tracks draws at alliance level alongside `wars_won` / `wars_lost`
   - `store_items.slug TEXT UNIQUE` — URL-safe slug for each store item; **required** by the DodoPayments webhook to look up grant amounts server-side via `metadata.itemSlug` (see DodoPayments Setup)
   - Partial unique index on `failed_xp_awards (user_id, source, reference_id) WHERE reference_id IS NOT NULL` — prevents duplicate XP dead-letter rows for the same event
   - Unique index on `audit_discrepancies (user_id, asset_type)` — prevents duplicate discrepancy records per user per asset type
   - Unique index on `guild_quest_contributions (quest_id, user_id)` — prevents a user from being credited twice for the same guild quest

   Migration `0016_custom_bugs_gaps_fixes.sql` adds:
   - `guilds.wars_drawn INTEGER NOT NULL DEFAULT 0` — backfills the draw-outcome counter used by the Alliance Wars resolution path

   Migration `0017_partial_index_fixes.sql` adds:
   - **BUG-NEM-01**: Drops the non-partial `UNIQUE(user_id, track, is_active)` constraint on `nemesis_assignments` and replaces it with a partial unique index on `(user_id, track) WHERE is_active = TRUE`. The old constraint meant only one inactive row per (user, track) could exist, causing conflicts after a single reassignment cycle.
   - **BUG-CREA-01**: Adds partial unique index on `creator_earnings(reference_id) WHERE reference_id IS NOT NULL` to prevent double-crediting if the creator fund CRON runs twice in the same period. (Superseded by migration `0019` which widens this to `(creator_id, reference_id)`.)
   - **BUG-RACE-01**: Adds functional unique index on `rooms ((metadata->>'season_ceremony_id')) WHERE metadata->>'season_ceremony_id' IS NOT NULL` — required for the `ON CONFLICT ((metadata->>'season_ceremony_id')) DO NOTHING` guard in `createSeasonCeremonyRoom` to work without throwing a constraint-not-found error.

   Migration `0018_self_referral_constraint.sql` adds:
   - **BUG-REFERRAL-01**: `CHECK (referred_by IS NULL OR referred_by <> id)` constraint on `users` to prevent self-referrals at the database level. The application layer already guards this; the constraint provides defence-in-depth.

   Migration `0019_bug_fix_schema_changes.sql` adds:
   - **NULLABLE-01**: Backfills `NULL` values in `users.is_banned` to `false` and adds `NOT NULL DEFAULT false` constraint.
   - **SCHEMA-01**: Adds `login_streak_days INTEGER DEFAULT 0` column to `users` if not present.
   - **SCHEMA-04**: Adds `CHECK (user1_id < user2_id)` constraint on `dm_conversations` to enforce canonical conversation ordering (prevents duplicate rows for the same pair).
   - **SCHEMA-05**: Fixes `referral_commissions.tier` column default from `"standard"` to `"1"` to match the two-tier referral system.
   - **SCHEMA-07**: Drops the old single-column `creator_earnings_reference_id_idx` unique index and recreates it as a composite unique index on `(creator_id, reference_id)` — prevents double-crediting across creators sharing the same reference.
   - **GUILD-01**: Drops the legacy `guilds.below_minimum_days` integer column (replaced by the timestamp-based `below_min_since`).

7. Optional seed data: `psql "$DIRECT_URL" < apps/web/lib/db/seed.sql`

### Option B: Railway PostgreSQL

1. Go to [railway.app](https://railway.app) and create a new project.
2. Add a **PostgreSQL** service from the Railway marketplace.
3. Click the PostgreSQL service → **Connect** tab.
4. Copy the **PostgreSQL connection URL** → `DATABASE_URL`.
5. Railway does not use PgBouncer by default — set `DIRECT_URL` to the same value unless you add a PgBouncer service.
6. Run migrations the same way as Option A (using `DIRECT_URL`).
7. Set `DATABASE_PROVIDER=railway` in your env vars.

### Option C: DigitalOcean Managed PostgreSQL

1. Go to DigitalOcean → **Databases** → **Create Database** → PostgreSQL.
2. Choose your plan (minimum 1 GB RAM for development).
3. Enable **Connection Pooling** → mode: **Transaction** → pool size: 25.
4. Under **Connection details**, copy:
   - **Connection string (pooled)** → `DATABASE_URL`
   - **Connection string (direct)** → `DIRECT_URL`
5. SSL mode is required. DigitalOcean provides a CA certificate — download it and reference it in `sslrootcert` if needed.
6. Run migrations using `DIRECT_URL`.
7. Set `DATABASE_PROVIDER=digitalocean`.

### Adding a new database provider

1. Create a new adapter file at `apps/web/lib/db/providers/yourprovider.ts`.
2. Implement the `DatabaseAdapter` interface from `apps/web/lib/db/interface.ts`.
3. The interface's `query<T>` generic defaults to `Record<string, unknown>` without a constraint. If your underlying driver (e.g. `pg`) requires `T extends QueryResultRow`, use `T & Record<string, unknown>` when calling the driver and cast the result back: `result.rows as T[]`. This keeps the public interface flexible for callers.
4. Add the provider key to the `DATABASE_PROVIDER` enum/union in `apps/web/lib/env.ts`.
5. Import and register the new adapter in `apps/web/lib/db/index.ts`.
6. Add a corresponding ESLint rule if the provider has a client SDK that must not leak into business logic.

---

## Realtime Setup

Zobia uses a **provider-native** realtime architecture. The server makes a fast, stateless HTTP call to the configured provider's REST API after saving each message. The provider (Ably / Pusher / Supabase Realtime) is responsible for maintaining persistent WebSocket connections to browser and mobile clients. No Redis Pub/Sub is involved in realtime delivery.

**Mobile (Expo):** set `EXPO_PUBLIC_REALTIME_PROVIDER=ably` to enable WebSocket push in the app (only Ably is wired client-side today; unset = adaptive poll only). The app authorizes Ably via `GET /api/realtime/ably-token` using its Bearer JWT (an `authCallback`, not a cookie), so that endpoint accepts both cookie and `Authorization: Bearer` auth and grants subscribe-only capability on `dm:*`, `room:*`, and `group:*` channels.

**Room capacity & push (v1.7) manifest keys** (admin-editable at `/admin/config`, all integers): `room_free_open_cap` (30), `room_tipping_cap` (30), `room_vip_cap` (200), `room_drop_cap` (100), `room_classroom_cap` (150), `room_guild_cap` (100), `room_capacity_upgrade_step` (25), `room_capacity_upgrade_cost` (500 Credits), `room_capacity_hard_max` (1000). Per-category push toggles live on `users` (`dm_notifications`, `group_notifications`, `room_mention_notifications`); migrations `0008_room_capacity_caps.sql` and `0009_push_preferences.sql` seed/add these. Room presence and the online check reuse Redis — no extra service.

### Architecture

```
User sends DM
    │
    ▼
POST /api/messages/dm/[conversationId]   (saves to DB, ~10ms)
    │
    ▼
publishRealtimeEvent("dm:conversation:uuid", "new_message", { message })
    │
    ▼
Provider REST API  (stateless HTTP call, ~30–50ms)
    │
    ▼
Provider cloud infrastructure  (handles all WebSocket connections)
    │
    ▼
Provider client SDK in browser / Expo  (Ably JS / pusher-js / @supabase/supabase-js)
    │
    ▼
React state updated — new message appears instantly
```

The Vercel function returns as soon as the DB write and provider REST call complete — no persistent connections, no timeouts.

**Scalability at free tier:**

| Provider | Concurrent connections (free) | Messages/month (free) |
|---|---|---|
| Supabase Realtime | 200 | Unlimited (Broadcast) |
| Ably | 100 | 6 million |
| Pusher | 100 | 200,000/day |

**Fallback:** The DM conversation page also runs a 3-second baseline poll. Even if the provider is down, messages arrive within 3 seconds.

### Required env vars per provider

You need **two sets** of vars: server-side (for publishing) and client-side (`NEXT_PUBLIC_`) for the browser SDK.

Set both `REALTIME_PROVIDER` and `NEXT_PUBLIC_REALTIME_PROVIDER` to the same value.

---

#### Option A: `supabase-realtime` (default — recommended if you're already on Supabase)

**Server-side vars:**

| Variable | Required | Description | Where to get it |
|---|---|---|---|
| `REALTIME_PROVIDER` | Yes | Set to `supabase-realtime` | — |
| `SUPABASE_URL` | Yes | Your Supabase project URL (e.g. `https://abcdef.supabase.co`) | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service-role secret key — **never expose to clients** | Supabase → Project Settings → API → `service_role` |

> The `service_role` key bypasses Row Level Security (RLS). Keep it server-side only. It is used only to publish Broadcast events — it never reads user data.

**Client-side vars:**

| Variable | Required | Description | Where to get it |
|---|---|---|---|
| `NEXT_PUBLIC_REALTIME_PROVIDER` | Yes | Set to `supabase-realtime` | — |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Same as `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Anon / public key — safe to expose to browsers | Supabase → Project Settings → API → `anon public` |

The `anon` key is designed to be public. Supabase Row Level Security policies control what authenticated vs anonymous users can access.

**Enabling Realtime in Supabase:**
1. In the Supabase dashboard, go to **Realtime → Enabled tables** (if using DB changes). For Broadcast (which Zobia uses), no table setup is required.
2. Ensure **Realtime** is enabled for your project (it is by default on all plans).

---

#### Option B: `ably`

**Server-side vars:**

| Variable | Required | Description | Where to get it |
|---|---|---|---|
| `REALTIME_PROVIDER` | Yes | Set to `ably` | — |
| `ABLY_API_KEY` | Yes | Server-side API key with Publish capability | See below |

**Client-side vars:**

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_REALTIME_PROVIDER` | Yes | Set to `ably` | — |

> No `NEXT_PUBLIC_ABLY_*` key is needed. The browser obtains a **scoped token** from `/api/realtime/ably-token` — your Ably API key is never exposed to clients. The token is valid for 1 hour and grants subscribe-only access to the specific conversation channel.

**Which Ably key to use:**

Ably offers three key types in their Console:
- **Root key** — full access (publish + subscribe + stats + channel management). Fine for development.
- **Subscribe-only key** — can only receive messages. **Do NOT use this** for `ABLY_API_KEY` — the server needs to publish.
- **Custom key (recommended for production)** — create a key with exactly the capabilities you need.

**Creating a production Ably key:**
1. Go to [ably.com](https://ably.com) → log in → select your app.
2. Navigate to **API Keys → Add New Key**.
3. Name it `Zobia Server`.
4. Capabilities: enable **Publish** and **Subscribe** on channel namespace `dm:*` (or `*` for all channels).
5. Click **Create Key** — copy the full key string (format: `appId.keyId:keySecret`).
6. Paste it as `ABLY_API_KEY`.

---

#### Option C: `pusher`

**Server-side vars:**

| Variable | Required | Description | Where to get it |
|---|---|---|---|
| `REALTIME_PROVIDER` | Yes | Set to `pusher` | — |
| `PUSHER_APP_ID` | Yes | Numeric app ID (e.g. `1234567`) | Pusher Dashboard → App Keys |
| `PUSHER_KEY` | Yes | App key — public identifier | Pusher Dashboard → App Keys |
| `PUSHER_SECRET` | Yes | App secret — **never expose to clients** | Pusher Dashboard → App Keys |
| `PUSHER_CLUSTER` | Yes | Region cluster code (e.g. `mt1`, `eu`, `us2`) | Pusher Dashboard → App Keys |

**Client-side vars:**

| Variable | Required | Description | Where to get it |
|---|---|---|---|
| `NEXT_PUBLIC_REALTIME_PROVIDER` | Yes | Set to `pusher` | — |
| `NEXT_PUBLIC_PUSHER_KEY` | Yes | Same as `PUSHER_KEY` — this is the **public** App Key, safe to expose | Pusher Dashboard → App Keys |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | Yes | Same as `PUSHER_CLUSTER` | Pusher Dashboard → App Keys |

> `PUSHER_SECRET` is server-side only. The browser subscribes to **private channels** and gets an auth token from `/api/realtime/pusher-auth` — the secret never leaves the server.

**Setting up Pusher:**
1. Go to [pusher.com](https://pusher.com) → log in → **Channels → Create app**.
2. Name the app (e.g. `zobia-social`).
3. Choose a region cluster close to your users (`mt1` = multi-region US, `eu` = EU, `ap2` = Asia Pacific).
4. Go to **App Keys** and copy all four values.
5. In **App Settings**, enable **Private channels** (required for auth).

---

### Verifying realtime is working

1. Set all required env vars for your provider.
2. Start the dev server: `cd apps/web && npm run dev`
3. Open **two browser tabs**, each logged in as a different user who share a DM conversation.
4. Send a message in tab 1 → it should appear in tab 2 **within ~1 second** without any page refresh.
5. Open your browser's Network tab (filter by WebSocket) — you should see a persistent WS connection to the provider's infrastructure.
6. To confirm the fallback works: disconnect from the internet briefly, reconnect — new messages should arrive within 3 seconds (baseline poll interval).

**Checking provider dashboards:**
- **Ably:** Ably Console → your app → **Stats** — you should see channel connections and message counts update in real time.
- **Pusher:** Pusher Dashboard → your app → **Overview** — connection and message counts visible.
- **Supabase:** Supabase Dashboard → **Realtime** — shows active connections and channel activity.

---

## Object Storage Setup

### Supabase Storage (default)

1. In the Supabase dashboard, go to **Storage**.
2. Create a bucket named `avatars` (public) and a bucket named `uploads` (private or with RLS).
3. Set bucket RLS policies:
   - `avatars`: Allow public read, authenticated upload.
   - `uploads`: Require authentication for all operations.
4. Set `STORAGE_PROVIDER=supabase-storage` — no additional env vars needed (uses `DATABASE_URL` credentials).

### Cloudflare R2 (recommended for non-Supabase)

1. Log in to [cloudflare.com](https://cloudflare.com).
2. Go to **R2** → **Create bucket** → name it (e.g. `zobia-media`).
3. In **R2 settings → Manage R2 API tokens**:
   - Create a token with **Object Read and Write** permissions scoped to your bucket.
   - Copy the **Access Key ID** and **Secret Access Key**.
4. Under bucket settings, enable a **Public bucket URL** or connect a custom domain.
5. Configure CORS on the bucket to allow your app domain:
   ```json
   [{ "AllowedOrigins": ["https://zobia.social"], "AllowedMethods": ["GET", "PUT", "DELETE"], "AllowedHeaders": ["*"] }]
   ```
6. Set `STORAGE_PROVIDER=r2` and fill in `R2_*` env vars.

---

## Auth Setup

Zobia uses platform-managed JWT — Supabase Auth is **not** used anywhere. All auth flows go through the Next.js API layer.

### Generate JWT secrets

```bash
openssl rand -hex 64  # copy output to JWT_SECRET
openssl rand -hex 64  # copy output to JWT_REFRESH_SECRET
```

Both secrets must be different and at least 32 characters long. Keep them private and never commit them.

### Google OAuth

1. Go to [console.cloud.google.com](https://console.cloud.google.com).
2. Create a new project (or select an existing one).
3. Go to **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**.
4. Application type: **Web application**.
5. Add to **Authorized redirect URIs**:
   - `http://localhost:3000/api/auth/google/callback` (for local development)
   - `https://your-domain.com/api/auth/google/callback` (for production)
6. Copy **Client ID** → `GOOGLE_CLIENT_ID`
7. Copy **Client Secret** → `GOOGLE_CLIENT_SECRET`

> **Important:** The redirect URI must match exactly what `NEXT_PUBLIC_APP_URL` resolves to (including protocol and port). Do not include a trailing slash in `NEXT_PUBLIC_APP_URL` (use `http://localhost:3000`, not `http://localhost:3000/`). A mismatch causes `Error 400: redirect_uri_mismatch` from Google. Changes to Authorized redirect URIs in Google Cloud Console can take up to 5 minutes to propagate.

> **Legacy URI:** The old path `/auth/callback/google` still exists and automatically forwards to `/api/auth/google/callback`, so existing Google Console entries pointing at the old URI will continue to work. However, new projects should register only the `/api/auth/google/callback` URI — it is the canonical route and the only one that runs the onboarding check.

#### Onboarding flow

New users (first-ever Google sign-in) are redirected to `/onboarding` after the OAuth callback completes. Returning users go straight to `/home`. This is handled automatically by `/api/auth/google/callback` — no configuration required.

#### Mobile (Expo) OAuth

The Expo app opens an in-app browser to:

```
/api/auth/google?platform=mobile&redirect=zobia://auth/callback
```

The backend stores the deep-link redirect URI in a short-lived HttpOnly cookie, completes the standard Google OAuth flow, and then — instead of setting web cookies — redirects the in-app browser to:

```
zobia://auth/callback?token=JWT&refresh_token=...&user=...&onboarding_completed=true|false
```

The app catches this deep link, stores the JWT in SecureStore, and routes to `/(tabs)` or `/onboarding` depending on `onboarding_completed`. No separate Google Cloud Console entry is required for the mobile flow — it reuses the same web OAuth client and redirect URI.

### Public URLs, Deep Links & App-Link Verification

The app exposes SEO-friendly public URLs that double as universal/app links across web, PWA and Expo:

- `/u/<username>` (profile), `/r/<slug>` (room), `/c/<slug>` (course), `/g/<slug>` (game)
- A `?r=<code>` referral param can be attached to **any** of these and is attributed automatically.

To make these open the native app (instead of the browser) you must publish two association files **on the same domain as `NEXT_PUBLIC_APP_URL`** and fill in the platform credentials:

1. **Android App Links** — `apps/web/public/.well-known/assetlinks.json`. Replace `REPLACE_WITH_YOUR_APP_SIGNING_CERT_SHA256` with your Play app-signing SHA-256 fingerprint (`Play Console → Setup → App signing`, or `keytool -list -v -keystore …`). Package is `org.zobia.social`.
2. **iOS Universal Links** — `apps/web/public/.well-known/apple-app-site-association` (served as `application/json`, no extension — header set in `next.config.js`). Replace `REPLACE_WITH_TEAMID` with your Apple Team ID, giving `TEAMID.org.zobia.social`.

Expo config:
- `app.json` declares the host in `android.intentFilters` (autoVerify) and `ios.associatedDomains` (`applinks:<host>`). Update both when the domain changes.
- `WEB_BASE_URL` (in `app.json → extra`, read by `lib/env.ts`) is the origin used to build shareable universal/referral links from the app. Defaults to `https://zobia.vercel.app`; switch to `https://zobia.org` when the custom domain is connected.

Verify after deploying:
```bash
# Android
curl -s https://<host>/.well-known/assetlinks.json | jq .
# iOS (must return Content-Type: application/json)
curl -sI https://<host>/.well-known/apple-app-site-association | grep -i content-type
```

### Games feature

The games feature works out of the box once migrations are applied — no extra services
are required.

- **Migration:** `apps/web/db/migrations/0013_games_feature.sql` adds the games columns,
  the gaming track (`xp_gaming` / `level_gaming`), play/challenge/leaderboard/milestone
  tables, seeds the 26 launch games, and seeds the manifest keys.
  `apps/web/db/migrations/0029_games_catalog_expansion.sql` adds 30 more games across 4
  new categories (Trivia, Strategy, Sports, Music), bringing the total to **57 games across
  13 categories**. Both migrations are idempotent (`ON CONFLICT DO NOTHING`).
- **Master toggle:** `feature_games` (Admin → Feature Flags), default on. Per-game
  activation, cover-page editing, rewards, free/paid play cost and stats live at
  `/admin/games`. Runtime config (`game_wager_rake_pct`, `game_challenge_expiry_hours`,
  `game_default_reward_credits/xp`, `game_max_wager_credits`,
  `game_max_play_session_age_seconds`) at `/admin/config`.
  `game_max_wager_credits` (default 10 000) is the server-enforced ceiling on per-challenge
  credit wagers; attempts to create a challenge above this value are rejected with
  `WAGER_TOO_HIGH`. `game_max_play_session_age_seconds` (default 3600 — 1 hour) is the
  maximum age of a play session; `/score` submissions older than this are rejected to prevent
  replay attacks with stale sessions.
- **Mobile (Expo):** games render in a `react-native-webview` that loads
  `<WEB_BASE_URL>/g/<slug>/embed`. The dependency is declared in `apps/expo/package.json`;
  run `npm install` (from the repo root) after pulling. No native game code ships — write a
  game once as a web engine and it runs on web, PWA and mobile.
- **Ads:** set `NEXT_PUBLIC_ADSENSE_CLIENT` / `NEXT_PUBLIC_ADSENSE_SLOT` (web) and/or
  `ADMOB_APP_ID` (Expo) and enable the `admob_ads` flag to show ads on game surfaces;
  otherwise web shows a labelled placeholder and mobile renders nothing.
- **Cron:** add the hourly `/api/cron/games` job (see CRON Setup) so stale challenges
  expire and wagers refund.

### Why reCAPTCHA applies to Google sign-in but not Telegram

The "Continue with Google" button calls your own API endpoint (`/api/auth/google`) before redirecting to Google. This endpoint is publicly reachable and needs reCAPTCHA/Turnstile protection to prevent automated abuse.

The Telegram Login Widget is rendered and authenticated entirely by Telegram's infrastructure — when a user clicks it, Telegram's own app/website handles the authentication and returns a cryptographically signed payload (HMAC-SHA256 with your bot token). Telegram's own systems act as the anti-bot layer, so no additional CAPTCHA is needed on your side.

Both methods are protected — just by different mechanisms. This is the correct and common approach.

### Telegram Login

1. Open Telegram and message **@BotFather**.
2. Send `/newbot` and follow the prompts to name your bot.
3. BotFather will reply with a **bot token** — copy it to `TELEGRAM_BOT_TOKEN`.
4. The bot username is shown at the top of BotFather's reply (e.g. `ZobiaBot`) — copy it **without the `@`** to `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`. This is required for the Login Widget to appear on the register/login pages.
5. Send `/setdomain` to BotFather → select your bot → enter your domain (e.g. `zobia.social`).
6. The Telegram Login Widget will now work on your domain.
7. **Mobile (Expo):** The Expo app reads the bot name from `Constants.expoConfig?.extra?.telegramBotName`. Set it in `apps/expo/app.json` under `extra` so different EAS build profiles (development/staging/production) can use different bots:
   ```json
   {
     "expo": {
       "extra": {
         "telegramBotName": "ZobiaBot"
       }
     }
   }
   ```
   The value must match the bot username **without the `@`**. Omitting it falls back to the hardcoded development bot name.

---

## Pagination

User-facing feed APIs (gifts history, inbox, guilds discovery, season leaderboard) use **cursor-based pagination** instead of `OFFSET`/`page` parameters.

- **Request:** pass `cursor=<opaque_string>` (returned by a previous response as `nextCursor`).
- **Response:** each paginated endpoint returns a `nextCursor` field. A `null` value means there are no more pages.
- The cursor is a base64-encoded JSON value containing enough information to resume the query from the exact position. Do not construct cursors manually — always use the value returned by the API.
- `/api/admin/users` uses cursor-based pagination with a `cursor` param (format: `"<iso-timestamp>|<uuid>"`); the response includes `hasMore` and `nextCursor` instead of `total`/`pages`. Most other admin routes still use `OFFSET`/`page` pagination.

---

## CRON Setup (CRITICAL)

Vercel Hobby Plan allows up to 100 CRON jobs, but **each can only run once per day**. Zobia uses 7 staggered daily slots (23:00–05:00 UTC = midnight–6am WAT) plus external sub-daily CRONs.

### Daily CRON slots (Vercel-native, already configured in `vercel.json`)

The 7 daily slots are staggered hourly through the night so each finishes well within Vercel's 10-second function timeout. All are idempotent (DB-based guard key in `cron_state`).

| UTC time | Route | Responsibilities |
|---|---|---|
| 23:00 | `/api/cron/daily-core` | Quest deck reset, login streaks (increment + reset), daily login XP, moments expiry, expired pin sweep, message history cleanup |
| 00:00 | `/api/cron/daily-users` | Inactivity event detection (3/7/14/30/90-day thresholds), guild discovery prompts for new users, comeback coin expiry |
| 01:00 | `/api/cron/daily-notify` | Re-engagement push + email dispatch, Telegram re-engagement (concurrent), Platform Council invitations (last 7 days of month) |
| 02:00 | `/api/cron/daily-guilds` | Guild tier demotion/promotion, Patron badge, guild contribution alerts, guild quest reset (Mondays) |
| 03:00 | `/api/cron/daily-economy` | Creator Fund seed (day 1) + distribute (day 5), monthly plan bonus (day 1), ad revenue enrolment (day 1), weekly payouts (Fridays), referral streak qualifying |
| 04:00 | `/api/cron/daily-social` | Nemesis refresh (Sundays), season leaderboard snapshot (Sundays), leaderboard ripple notifications, DM sticker milestones, trust score batch recalculation, earnable sticker unlocks, creator tier progression |
| 05:00 | `/api/cron/daily-platform` | Season transitions, gift drops, mystery XP drop, Flash XP lifecycle, annual event recurrence, moderation digest (Fridays), Master Teacher award, Alliance Wars resolution + pairing (Sundays), Telegram delivery queue, room expiry, SYS-01/SYS-02/SYS-04/WEBHOOK-RETRY/PUSH-RECEIPT |

No additional setup is required for these — they are already defined in `apps/web/vercel.json` and Vercel schedules them automatically on deploy.

### Generating `CRON_SECRET`

All CRON handlers (both Vercel-native and external) verify an `Authorization: Bearer <CRON_SECRET>` header using a timing-safe comparison. Generate and set this once:

```bash
openssl rand -hex 32
# Paste output as CRON_SECRET in your Vercel environment variables
```

Never expose `CRON_SECRET` publicly.

### Sub-daily CRONs (external — required, via cron-jobs.org)

Because Vercel Hobby limits each path to once per day, sub-daily jobs must be triggered externally.

1. Create a free account at [cron-jobs.org](https://cron-jobs.org).
2. Use the same `CRON_SECRET` you set above.
3. In cron-jobs.org, create the following jobs:

**Guild War Checks (hourly)**
- URL: `https://your-domain.com/api/cron/guild-wars`
- Schedule: Every 1 hour
- HTTP Method: GET
- Header: `Authorization: Bearer YOUR_CRON_SECRET`

**Leaderboard Updates (every 15 minutes)**
- URL: `https://your-domain.com/api/cron/leaderboards`
- Schedule: Every 15 minutes
- HTTP Method: GET
- Header: `Authorization: Bearer YOUR_CRON_SECRET`

**Games Housekeeping (hourly)**
- URL: `https://your-domain.com/api/cron/games`
- Schedule: Every 1 hour
- HTTP Method: GET
- Header: `Authorization: Bearer YOUR_CRON_SECRET`
- Purpose: expires stale game challenges and refunds any escrowed wager credits.

**Payout Batch Processing (every 30 minutes)**
- URL: `https://your-domain.com/api/cron/payouts`
- Schedule: Every 30 minutes
- HTTP Method: POST
- Header: `Authorization: Bearer YOUR_CRON_SECRET`

**Nightly Balance Reconciliation**
- URL: `https://your-domain.com/api/cron/reconcile-balances`
- Schedule: Every night at 06:00 UTC (after the 7 daily slots complete)
- HTTP Method: GET
- Header: `Authorization: Bearer YOUR_CRON_SECRET`

### Paystack Setup (Payments & Payouts)

#### 1. Get API Keys

1. Log into your [Paystack dashboard](https://dashboard.paystack.com).
2. Go to **Settings → API Keys**.
3. Copy your **Secret Key** (starts with `sk_live_` or `sk_test_`) → `PAYSTACK_SECRET_KEY`.
4. Copy your **Public Key** (starts with `pk_live_` or `pk_test_`) → `PAYSTACK_PUBLIC_KEY`.

#### 2. Configure Webhook URL

1. In the Paystack dashboard, go to **Settings → API Keys & Webhooks**.
2. Under **Webhooks**, set:
   - **URL**: `https://zobia.vercel.dev/api/economy/webhooks/paystack` (replace `zobia.vercel.dev` with your actual domain)
   - **Events to listen for**: `charge.success` (minimum required; you can also add `transfer.success`, `transfer.failed` for payout confirmations)
3. Click **Save**. Paystack will show a test event — confirm you can receive it.

#### 3. Configure Callback URLs (Optional)

Paystack redirects users back to your app after payment. Each payment flow specifies its own callback:

- **Coins/Stars purchase**: `https://zobia.vercel.dev/economy/purchase/callback`
- **Subscription purchase**: `https://zobia.vercel.dev/settings/subscription/callback`
- **Room entry fee**: `https://zobia.vercel.dev/rooms/[roomId]?payment=complete`

You can also set a **default callback URL** in Paystack settings (Settings → Preferences) that applies to all payments that don't specify one.

#### 4. Enable Transfers for Payouts (Creator Fund)

**Paystack Transfers permission** must be enabled before payouts can be processed:

1. Log into your Paystack dashboard.
2. Go to **Settings → Transfers** and enable the Transfer feature for your account.
3. Ensure your `PAYSTACK_SECRET_KEY` has the **Transfers** permission scope.

Without this, `POST /api/cron/payouts` will fail on every bank transfer attempt.

#### 5. Test Your Setup

1. Add `PAYSTACK_PUBLIC_KEY` and `PAYSTACK_SECRET_KEY` to your Vercel environment variables.
2. Deploy the app.
3. In the Paystack dashboard, go to **Settings → API Keys & Webhooks** and send a test webhook event.
4. Check your app's logs to confirm the webhook was received and processed.

**Payout-related `x_manifest` keys** (seeded automatically by migration 030 with defaults):

| Key | Default | Description |
|---|---|---|
| `payouts_enabled` | `true` | Master on/off toggle for all creator payouts |
| `nigeria_cash_payout_enabled` | `true` | Enable/disable bank transfer payouts for Nigeria |
| `nigeria_coins_payout_enabled` | `true` | Enable/disable Coins payout for Nigeria |
| `nigeria_crypto_payout_enabled` | `true` | Enable/disable USDT/Tron payout for Nigeria |
| `global_coins_payout_enabled` | `true` | Enable/disable Coins payout for global creators |
| `global_crypto_payout_enabled` | `true` | Enable/disable USDT/Tron payout for global creators |
| `nigeria_payout_auto_approve` | `true` | `true` = automatic CRON processing; `false` = manual admin review required |
| `payout_batch_size` | `200` | Maximum payouts processed per CRON run |
| `payout_max_retries` | `3` | Retry attempts before a payout is moved to the dead-letter queue |
| `bank_account_first_add_xp` | `5` | Main XP awarded when a creator adds their first bank account |
| `bank_account_first_add_creator_xp` | `10` | Creator Track XP for first bank account add |

These can be updated from the Admin → Config panel at any time.

**PWA install prompt `x_manifest` key** (optional):

| Key | Default | Description |
|---|---|---|
| `android_app_url` | _(empty)_ | Full URL to the Android APK or Play Store listing. When set, Android users see a download prompt instead of the PWA install guide. Set via **Admin → Config** or directly in `x_manifest`. |

---

**Fraud-detection `x_manifest` keys** (admin-configurable; default values shown):

| Key | Default | Description |
|---|---|---|
| `fraud_gift_window_days` | `7` | Look-back window (days) for new-account gift-inflow fraud check |
| `fraud_inflow_threshold_coins` | `5000` | Min coins received from new accounts within the fraud window to flag a payout |
| `fraud_new_account_age_days` | `7` | Account age (days) below which a gift sender is treated as a "new account" |
| `fraud_max_payouts_per_day` | `3` | Max payout requests per creator per 24 h before a velocity fraud flag fires |

All four keys are read at payout time from `apps/web/lib/fraud/payouts.ts`. Adjusting them takes effect on the next payout request with no deployment needed.

### DodoPayments Setup (Global Payments)

#### 1. Get API Keys

1. Log into your [DodoPayments dashboard](https://app.dodopayments.com).
2. Go to **Settings → API Keys**.
3. Copy your **API Key** → `DODOPAYMENTS_API_KEY`.
4. Copy your **Webhook Secret** → `DODOPAYMENTS_WEBHOOK_SECRET`.

#### 2. Configure Webhook URL

1. In the DodoPayments dashboard, go to **Settings → Webhooks**.
2. Add a new webhook endpoint:
   - **URL**: `https://your-domain/api/economy/webhooks/dodopayments`
   - **Events**: `payment.succeeded`, `payout.completed`, `payout.failed`
3. Copy the signing secret and set `DODOPAYMENTS_WEBHOOK_SECRET`.

#### 3. Store Items — itemSlug Requirement

When creating payment links or checkout sessions in DodoPayments, you **must** include `itemSlug` in the payment metadata. The webhook handler uses `metadata.itemSlug` to look up grant amounts from the `store_items` table server-side — client-supplied `coinsGranted`/`starsGranted` metadata values are ignored for security.

```json
// Required metadata when creating a DodoPayments payment session:
{
  "userId": "<user-uuid>",
  "itemSlug": "coin_pack_500",   // must match store_items.slug
  "itemType": "coin_pack",       // coin_pack | star_pack | subscription | room_subscription
  "packName": "500 Coins",
  "idempotencyKey": "<uuid>"
}
```

Ensure every active item in `store_items` has a non-null `slug` that exactly matches the `itemSlug` sent in DodoPayments metadata.

### Creator Fund ad revenue tracking

To ensure the Creator Fund pool is correctly seeded on the 1st of each month, ad revenue must be recorded in `x_manifest` using the key format `ad_revenue_YYYY_MM_kobo` (e.g. `ad_revenue_2026_05_kobo`). The admin financial dashboard records monthly ad revenue totals automatically. If integrating a third-party ad network, ensure the revenue webhook updates this key each month.

---

## APK Build

### Prerequisites

- Expo account at [expo.dev](https://expo.dev) — create a project named `zobia-social`
- EAS CLI installed globally: `npm install -g eas-cli`
- Android `compileSdkVersion` and `targetSdkVersion` both set to **36** in `apps/expo/app.json` (Google Play requires `targetSdkVersion ≥ 36`; `compileSdkVersion` must be ≥ `targetSdkVersion`)

### Build steps

```bash
cd apps/expo
eas login
eas build --platform android --profile preview
```

Build will be queued on Expo's build servers. When complete, a download link appears at `expo.dev → Projects → zobia-social → Builds`.

### Build profiles

The `eas.json` file in `apps/expo/` defines:
- `preview` — internal APK for testing (not signed for Play Store)
- `production` — signed AAB for Google Play Store submission

### Android API Level 36

Both `compileSdkVersion` and `targetSdkVersion` must be 36. Verify in `apps/expo/app.json`:

```json
{
  "expo": {
    "android": {
      "compileSdkVersion": 36,
      "targetSdkVersion": 36
    }
  }
}
```

> **`compileSdkVersion` must equal `targetSdkVersion`.** Setting only `targetSdkVersion: 36` without `compileSdkVersion: 36` causes AGP to compile the app against API 34 while targeting 36 — that inconsistency is what the above snippet avoids.

### Keystore management

EAS manages the keystore automatically by default. For self-managed signing, see the `credentials` section in `apps/expo/eas.json` and run `eas credentials` to configure.

### GitHub Actions auto-build

1. Go to your GitHub repository → **Settings → Secrets and variables → Actions**.
2. Add a secret named `EXPO_TOKEN` — get it from `expo.dev → Account → Access tokens`.
3. Push to `main` to trigger `.github/workflows/build-android.yml` automatically.

### Downloading the APK

Go to [expo.dev](https://expo.dev) → **Projects → zobia-social → Builds** → click the build → **Download**.

---

## Deep Links Verification

### Android App Links

Zobia uses Android App Links (Universal Links) so tapping a `https://zobia.social/...` link opens the app instead of a browser.

1. Get your app's SHA-256 signing certificate fingerprint:
   ```bash
   eas credentials --platform android
   # Look for SHA-256 fingerprint under Keystore
   ```
2. Update `apps/web/public/.well-known/assetlinks.json`:
   ```json
   [{
     "relation": ["delegate_permission/common.handle_all_urls"],
     "target": {
       "namespace": "android_app",
       "package_name": "com.zobia.social",
       "sha256_cert_fingerprints": ["AA:BB:CC:...your actual fingerprint..."]
     }
   }]
   ```
3. Deploy the web app so `https://your-domain/.well-known/assetlinks.json` is publicly accessible.
4. Verify with:
   ```bash
   curl https://your-domain/.well-known/assetlinks.json
   # Should return your JSON without redirects
   ```
5. Test deep linking:
   ```bash
   adb shell am start -W -a android.intent.action.VIEW \
     -d "https://your-domain/profile/testuser" com.zobia.social
   ```

---

## Secret Rotation Runbook

### JWT Secret rotation (zero downtime)

JWT rotation will invalidate all existing sessions — users will need to log in again.

1. Generate a new secret: `openssl rand -hex 64`
2. In Vercel dashboard → **Settings → Environment Variables**, update `JWT_SECRET`.
3. Trigger a new deployment (Vercel → **Deployments → Redeploy**).
4. All existing sessions will be invalidated when the new deployment goes live.
5. Communicate to users that they will need to log in again (expected behaviour).

To do a softer rotation, add a `JWT_SECRET_OLD` variable, temporarily validate tokens signed by either secret, then remove `JWT_SECRET_OLD` after the grace period.

### Payment provider key rotation

No downtime expected. Old key remains valid briefly during transition.

1. Generate a new API key in the Paystack or DodoPayments dashboard.
2. Update `PAYSTACK_SECRET_KEY` or `DODOPAYMENTS_API_KEY` in Vercel env vars.
3. Trigger a redeployment.
4. Revoke the old key in the payment provider dashboard after deployment succeeds.


## AI Provider Key Management

API keys for DeepSeek and Gemini can be managed in two ways:

1. **Environment variable (default)** — set `DEEPSEEK_API_KEY` and `GEMINI_API_KEY` in
   `.env.local` or the Vercel dashboard. This is the base configuration required at deployment.

2. **Admin override** — in Admin Panel → **AI Settings**, an admin can enter a different
   API key for either provider. The override is stored in `x_manifest` under
   `ai_deepseek_api_key_override` / `ai_gemini_api_key_override` and takes precedence over
   the environment variable without requiring a redeployment. Clearing the override reverts
   to the environment variable.

The AI Settings page (available in both the web admin panel and the Expo mobile admin) also shows:
- **Circuit breaker status** for DeepSeek (closed / half-open / open) with consecutive failure count.
- **Live connection test** — sends a minimal ping to verify the key is valid and the provider
  is reachable. You can test a new key before saving it.

### AI API key rotation

1. Generate a new key in the DeepSeek or Gemini dashboard.
2. Update `DEEPSEEK_API_KEY` or `GEMINI_API_KEY` in Vercel.
3. Trigger a redeployment.
4. Revoke the old key in the provider dashboard.

### CRON Secret rotation

1. Generate a new secret: `openssl rand -hex 32`
2. Update `CRON_SECRET` in Vercel env vars.
3. Update the `Authorization` header in all cron-jobs.org jobs to use the new value.
4. Trigger a redeployment.

---

## Backup and Restore

### Supabase

Supabase Pro and above includes automatic daily backups.

- View backups: **Supabase dashboard → Database → Backups**
- Point-in-time recovery is available on Pro plan.
- Manual restore: select a backup → **Restore**.

### Railway / DigitalOcean

```bash
# Backup
pg_dump "$DATABASE_URL" > backup_$(date +%Y%m%d_%H%M%S).sql

# Restore (CAUTION: this replaces all data)
psql "$DATABASE_URL" < backup_20240101_120000.sql
```

For large databases, use `pg_dump` with `--format=custom` for faster restore:

```bash
pg_dump --format=custom "$DATABASE_URL" > backup.dump
pg_restore --dbname="$DATABASE_URL" backup.dump
```

Schedule automated backups with a cron job or your provider's backup feature.

---

## Running Tests

### Unit Tests

```bash
cd apps/web
npx jest
```

Runs all Jest unit tests for the XP engine, coin ledger, financial integrity, concurrency, payout computation, guild wars, and season engine.

### E2E Tests (Playwright)

```bash
cd apps/web
npx playwright install  # first time only
npx playwright test
```

Runs all 11 PRD-required end-to-end scenarios. A running dev or staging server is required.

### Load Tests (k6)

Install k6: `brew install k6` (macOS) or see [k6 installation docs](https://k6.io/docs/getting-started/installation/).

```bash
# Room feed under 1000 concurrent users
k6 run load-tests/room-feed.js --env BASE_URL=https://staging.zobia.app

# Guild War Final Hour
k6 run load-tests/guild-war-final-hour.js --env BASE_URL=https://staging.zobia.app

# Daily login thundering-herd (midnight burst of 500 VUs)
k6 run load-tests/cron-daily-reset.js --env BASE_URL=https://staging.zobia.app

# CRON daily processing at scale — verify /api/cron/daily completes under concurrent load
CRON_SECRET=<your-cron-secret> k6 run load-tests/cron-daily-processing.js --env BASE_URL=https://staging.zobia.app
```

### Security / Penetration Tests

Requires a running server and environment variables (see table above).

```bash
cd apps/web
npx jest --testPathPattern="security-tests" --runInBand
```

Each test file covers a distinct OWASP category. Tests are designed to be non-destructive: they probe for vulnerabilities but do not attempt to exploit them destructively. Run against a **staging** environment, not production.

---

## Running Tests

### Unit Tests (Jest)

```bash
cd apps/web
npm run test:unit
```

Covers: XP engine, coin ledger atomicity, financial integrity, concurrency race conditions, payout math, guild war resolution, season engine.

To run with coverage:
```bash
npx jest --coverage
```

### E2E Tests (Playwright)

Install browser binaries (first time only):
```bash
cd apps/web
npx playwright install chromium firefox
```

Start the dev server in one terminal:
```bash
cd apps/web && npm run dev
```

Run tests in another terminal:
```bash
cd apps/web
npm run test:e2e
```

Test results + screenshots saved to `playwright-report/`. On CI, `TEST_BASE_URL` env var overrides the default localhost target.

E2E test files cover all 11 PRD §28 scenarios:

| File | Scenarios |
|---|---|
| `e2e/onboarding.spec.ts` | Full onboarding flow, age gate, username validation |
| `e2e/messaging.spec.ts` | DM auth enforcement, SSRF on link preview, group chat caps |
| `e2e/economy.spec.ts` | Coin purchase, webhook signature validation, gift catalogue |
| `e2e/rooms.spec.ts` | Room creation, VIP access, spectacle threshold, promotion |
| `e2e/guilds.spec.ts` | Guild creation, war declaration, CRON protection |
| `e2e/creator-payouts.spec.ts` | Creator payouts, admin approval, KYC |
| `e2e/admin.spec.ts` | Admin auth, suspension, season reset, referral flow |

### Load Tests (k6)

Install k6 from https://k6.io/docs/get-started/installation/

```bash
# Room feed — 1,000 concurrent users
k6 run load-tests/room-feed.js --env BASE_URL=https://staging.zobia.app

# Guild War Final Hour — 500 concurrent War Point writes
k6 run load-tests/guild-war-final-hour.js --env BASE_URL=https://staging.zobia.app

# Daily login thundering herd — 500 simultaneous midnight logins
k6 run load-tests/daily-login.js --env BASE_URL=https://staging.zobia.app
```

### Security Tests

Requires a running server. Set env vars before running:
```
SECURITY_TEST_BASE_URL=http://localhost:3000
SECURITY_TEST_USER_TOKEN=<jwt>
SECURITY_TEST_ADMIN_TOKEN=<admin-jwt>
SECURITY_TEST_USER_ID=<uuid>
SECURITY_TEST_OTHER_USER_ID=<uuid>
```

Run:
```bash
cd apps/web
npm run test:security
```

See `security-tests/pentest-runbook.md` for a full external assessor runbook.

---

## Push Notification Setup (Expo App)

The Expo app uses the Expo Push API (server-side) and `expo-notifications` (client-side).

### Server side

The server sends notifications via `apps/web/lib/notifications/push.ts`. No additional infrastructure is required — the Expo Push API handles delivery.

Set the optional access token for enhanced delivery:
```
EXPO_ACCESS_TOKEN=your_expo_access_token
```

### Client side

When a user logs into the Expo app on a physical device, the app automatically:
1. Requests notification permission via `expo-notifications`.
2. Retrieves the Expo Push Token.
3. Generates or retrieves a stable per-installation `deviceId` (UUID stored in `expo-secure-store`).
4. Registers the token and device ID with the backend via `POST /api/users/push-token` (`{ token, platform, deviceId }`).

The `deviceId` enables deduplication when a user reinstalls the app: only the most recently registered token per `(user_id, device_id)` pair receives notifications, preventing duplicate delivery after reinstalls.

**EAS Project ID (required since Expo SDK 47):** `Notifications.getExpoPushTokenAsync()` now requires the EAS `projectId` to be passed explicitly. The app reads this from `Constants.expoConfig?.extra?.eas?.projectId`. Ensure your `apps/expo/app.json` (or `app.config.js`) includes the EAS project ID in the `extra.eas` block:

```json
{
  "expo": {
    "extra": {
      "eas": {
        "projectId": "your-eas-project-id-here"
      }
    }
  }
}
```

Find your project ID at [expo.dev](https://expo.dev) → your project → Project ID. Without this, push tokens may be silently invalid on SDK 47+.

To test push notifications locally:
```bash
# Get a push token from the Expo app (check console logs on device)
# Then send a test notification:
curl -X POST https://exp.host/--/api/v2/push/send \
  -H "Content-Type: application/json" \
  -d '{"to":"ExponentPushToken[...]","title":"Test","body":"Hello from Zobia"}'
```

---

## Community Notes Feature

Community Notes is an admin-toggleable crowdsourced fact-checking feature (PRD §19).

- **Toggle:** In the admin panel under Feature Flags, set `community_notes_enabled` to on/off.
- **User UI:** Available at `/community-notes` in the web app.
- **API:** `GET/POST /api/community-notes`, `POST /api/community-notes/[noteId]/vote`.
- **Expo:** Available at `/community-notes` in the Expo app.

When enabled, users can add contextual notes to flagged content and vote notes as helpful or unhelpful. Notes with sufficient helpful votes gain "Visible" status and appear alongside the original content.

---

## Gift Spectacle Threshold (Creator Setting)

Room creators can configure the minimum gift value (in coins) required to trigger the full room-wide spectacle animation (PRD §12).

- **UI:** Visible in the room sidebar when you are the room creator. Look for "🎁 Spectacle Threshold."
- **API:** `PUT /api/rooms/[roomId]/spectacle-threshold` with body `{ thresholdCoins: number | null }`.
- Setting to `null` or leaving blank reverts to the gift item's own default threshold.
- Example: set to 100 so only gifts worth 100+ coins trigger the spectacle.

---

## Floating Reward Notifications

Floating currency notifications are enabled by default. To configure:
- **Toggle on/off**: Admin Panel → Config → Floating Notifications → "Enable Floating Notifications"
- **Confetti thresholds**: Set per-currency thresholds in the same panel (default: 100 XP, 50 Credits, 10 Stars)
- **Demo/Preview**: Admin Panel → Notifications Demo

No additional environment variables are required for this feature.

---

## Troubleshooting

### Login button does nothing / blank or non-interactive pages (CSP)

**Symptoms:** Clicking "Continue with Google" (or any button) does nothing. The
browser console shows:

```
Content-Security-Policy: The page's settings blocked an inline script
(script-src-elem) … "script-src 'nonce-…' 'strict-dynamic'"
```

**Cause:** Next.js only stamps its per-request CSP `nonce` onto its own
framework `<script>` tags when it can read the `Content-Security-Policy` from the
**request** headers. If the middleware sets the nonce only on the response, the
inline bootstrap script ships without a nonce and `strict-dynamic` blocks it, so
no client JS hydrates.

**Fix:** `apps/web/middleware.ts` sets `Content-Security-Policy` on the forwarded
request headers inside `withCsp()` (in addition to the response header). This is
already in place — if you customise the middleware, keep that line.

### `TypeError: c.handle is not a function` from `sw.js`

**Symptoms:** The console shows `A ServiceWorker passed a promise to
FetchEvent.respondWith() that rejected with 'TypeError: c.handle is not a
function'` and `_next/static/chunks/*.js` fail to load.

**Cause:** Serwist's `runtimeCaching[].handler` must be a Strategy **instance**
(e.g. `new NetworkOnly()`), not a workbox/next-pwa **string** name
(`"NetworkOnly"`) or a bare function.

**Fix:** `apps/web/app/sw.ts` uses Strategy instances (`NetworkOnly`,
`NetworkFirst`, `CacheFirst`, `StaleWhileRevalidate`) with `ExpirationPlugin`.
After changing the SW, hard-reload and **unregister the old service worker**
(DevTools → Application → Service Workers → Unregister) once, since clients may
still run the previous `sw.js`.

### `self-signed certificate in certificate chain` (SELF_SIGNED_CERT_IN_CHAIN)

**Symptoms:** Server logs show `Error: self-signed certificate in certificate
chain` and features that read the DB (login, manifest) fail or fall back to
defaults.

**Cause:** TLS verification is enforced in production, but the database
provider's CA is not in Node's system trust store (Supabase's pooler uses a
private CA).

**Fix:** Provide the provider CA via `DB_CA_CERT` (Supabase), `RAILWAY_CA_CERT`
(Railway) or `DO_CA_CERT` (DigitalOcean). For Supabase: Settings → Database →
SSL Configuration → Download certificate, then paste the full PEM into
`DB_CA_CERT` (multi-line is fine on Vercel) and redeploy. See the database
provider section above.

### In-app purchases: `react-native-iap` (not `expo-in-app-purchases`)

Android in-app purchases (coin top-ups and subscriptions) use **`react-native-iap`**.
We migrated away from `expo-in-app-purchases`, which is **deprecated and does not build
on Expo SDK 51**.

**Why `expo-in-app-purchases` was removed:** EAS builds failed at
`:expo-in-app-purchases:compileReleaseJavaWithJavac` with:

```
import expo.modules.core.ExportedModule;          error: cannot find symbol
import expo.modules.core.interfaces.ExpoMethod;   error: cannot find symbol
public class InAppPurchasesModule extends ExportedModule ...
```

`expo-in-app-purchases@14.0.0` is written against the **legacy unimodules API**
(`ExportedModule`, `@ExpoMethod`). Expo SDK 51's `expo-modules-core` (1.12.26) **removed**
those base classes, so the module's Java can no longer compile — and no `build.gradle`
patch (compileSdkVersion, Play Billing version, etc.) can fix it, because the missing
symbols are the module's own React/Expo bridge base classes, not Android framework or
Billing classes.

> A previous attempt blamed `compileSdkVersion 36` and pinned the module to
> `compileSdkVersion 34`; that build still failed. A second attempt forced Play Billing
> back to `4.0.0`; that resolved the `SkuDetails`/`getSkus` symbols but the build still
> failed on `ExportedModule`/`ExpoMethod`. The package is simply incompatible with SDK 51.

**What changed:**

- Removed `expo-in-app-purchases` from `apps/expo/package.json` and deleted its
  `patches/expo-in-app-purchases+14.0.0.patch`.
- Added `react-native-iap` (Play Billing v6/v7, maintained).
- Rewrote `apps/expo/lib/payments/googlePlay.ts` against the `react-native-iap` API
  (`initConnection`, `getProducts`/`getSubscriptions`, `requestPurchase`/
  `requestSubscription`, `finishTransaction`, `purchaseUpdatedListener`/
  `purchaseErrorListener`). The public wrapper API
  (`initGooglePlayBilling`, `getCoinProducts`, `purchaseCoins`,
  `getSubscriptionProducts`, `purchaseSubscription`, `disconnectGooglePlayBilling`) and
  the **verify-server-side-before-acknowledge** flow are unchanged.

The app keeps `compileSdkVersion: 36` and `targetSdkVersion: 36` in `app.json` — Google
Play's "target API 36" requirement depends only on the **app's** `targetSdkVersion`.

**Android subscription note:** Play Billing v5+ purchases a specific *offer*, identified
by an `offerToken` from the product details. `getSubscriptionProducts()` caches the
token; `purchaseSubscription()` passes it through (fetching on demand if the catalogue
hasn't loaded). Ensure each subscription product in the Play Console has at least one
active base plan/offer or `requestSubscription` will have no offer to purchase.

`react-native-iap` autolinks under the Expo dev-client / EAS build — no extra config
plugin is required — and contributes the `com.android.vending.BILLING` permission via its
own manifest.

**`react-native-iap` Gradle variant ambiguity (`amazon` vs `play`)**

`react-native-iap` v12+ exposes two product flavors — `amazon` and `play` — which causes
Gradle to fail with:

```
Could not resolve project :react-native-iap.
  > Cannot choose between amazonReleaseApiElements and playReleaseApiElements
```

**Fix:** `apps/expo/plugins/withIapPlayFlavor.js` is a config plugin that injects
`missingDimensionStrategy 'store', 'play'` into the app-level `build.gradle`
`defaultConfig` block, telling Gradle to always use the Play Store flavor. It is
registered in `app.json → plugins` and runs automatically on every EAS build — no
manual action required.
