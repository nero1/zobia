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
- **pnpm** — `npm install -g pnpm`
- **EAS CLI** — `npm install -g eas-cli`
- **Git**

---

## Quick Start (Supabase + Vercel default path)

```bash
# 1. Clone the repository
git clone https://github.com/your-org/zobia-social.git
cd zobia-social

# 2. Install dependencies
pnpm install

# 3. Copy environment variables
cp apps/web/.env.example apps/web/.env.local

# 4. Fill in all required env vars (see Environment Variables Reference below)
#    At minimum: DATABASE_URL, DIRECT_URL, JWT_SECRET, JWT_REFRESH_SECRET, REDIS_URL

# 5. Run database migrations
cd apps/web
npx prisma migrate deploy
# OR if using raw SQL migrations:
psql $DATABASE_URL < db/migrations/001_initial_schema.sql
psql $DATABASE_URL < db/migrations/002_rls_policies.sql

# 6. Start the development server
pnpm dev

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

---

## Environment Variables Reference

All variables belong in `apps/web/.env.local` locally and in the Vercel project environment variables for production.

| Variable | Required | Description | Where to get it |
|---|---|---|---|
| `DATABASE_PROVIDER` | Yes | Database backend: `supabase` \| `railway` \| `digitalocean` | Choose your provider |
| `DATABASE_URL` | Yes | Primary PostgreSQL connection string (pooled via PgBouncer) | Supabase → Settings → Database → Connection pooling |
| `DIRECT_URL` | Yes | Direct PostgreSQL connection (bypasses PgBouncer — used for migrations) | Supabase → Settings → Database → Connection string |
| `STORAGE_PROVIDER` | Yes | Storage backend: `supabase-storage` \| `r2` \| `s3` | Choose your provider |
| `R2_ACCOUNT_ID` | If R2 | Cloudflare account ID | Cloudflare dashboard → right sidebar |
| `R2_ACCESS_KEY_ID` | If R2 | R2 API access key ID | Cloudflare → R2 → Manage R2 API tokens |
| `R2_SECRET_ACCESS_KEY` | If R2 | R2 API secret access key | Cloudflare → R2 → Manage R2 API tokens |
| `R2_BUCKET_NAME` | If R2 | Name of the R2 bucket | Cloudflare → R2 → Buckets |
| `R2_PUBLIC_URL` | If R2 | Public URL for the R2 bucket (e.g. `https://pub-xxx.r2.dev`) | Cloudflare → R2 → Bucket settings |
| `REALTIME_PROVIDER` | Yes | Realtime backend: `supabase-realtime` \| `ably` \| `pusher` | Choose your provider |
| `REDIS_URL` | Yes | Redis connection URL (e.g. `redis://localhost:6379` or Upstash URL) | Upstash → Create Database → REST URL |
| `REDIS_PROVIDER` | Yes | `ioredis` \| `upstash` | Choose your provider |
| `UPSTASH_REDIS_REST_URL` | If Upstash | Upstash REST URL | Upstash → Database → REST API |
| `UPSTASH_REDIS_REST_TOKEN` | If Upstash | Upstash REST token | Upstash → Database → REST API |
| `JWT_SECRET` | Yes | Secret for signing access tokens (min 64 hex chars) | `openssl rand -hex 64` |
| `JWT_REFRESH_SECRET` | Yes | Secret for signing refresh tokens (different from JWT_SECRET) | `openssl rand -hex 64` |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth 2.0 client ID | Google Cloud Console → Credentials |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth 2.0 client secret | Google Cloud Console → Credentials |
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token for Telegram Login | @BotFather → /newbot |
| `DEEPSEEK_API_KEY` | Yes | DeepSeek API key for AI moderation | platform.deepseek.com → API Keys |
| `DEEPSEEK_API_ENDPOINT` | No | Override endpoint (default: `https://api.deepseek.com/v1`) | DeepSeek docs |
| `GEMINI_API_KEY` | Yes | Google Gemini API key (AI fallback) | aistudio.google.com → Get API key |
| `MAILGUN_API_KEY` | Yes | Mailgun API key for transactional email | Mailgun → Account → API Keys |
| `MAILGUN_DOMAIN` | Yes | Mailgun sending domain (e.g. `mg.yourdomain.com`) | Mailgun → Sending → Domains |
| `PAYSTACK_SECRET_KEY` | Yes | Paystack secret key — must have Transfers permission enabled | Paystack dashboard → Settings → API Keys |
| `PAYSTACK_PUBLIC_KEY` | Yes | Paystack public key | Paystack dashboard → Settings → API Keys |
| `DODOPAYMENTS_API_KEY` | Yes | DodoPayments API key | DodoPayments dashboard → API |
| `ADMOB_APP_ID` | No | Google AdMob app ID (for rewarded ads in the Expo app) | AdMob → Apps |
| `RECAPTCHA_SITE_KEY` | No | reCAPTCHA v3 site key (if using reCAPTCHA) | console.cloud.google.com → reCAPTCHA |
| `RECAPTCHA_SECRET_KEY` | No | reCAPTCHA v3 secret key | console.cloud.google.com → reCAPTCHA |
| `CLOUDFLARE_TURNSTILE_SITE_KEY` | No | Cloudflare Turnstile site key (preferred over reCAPTCHA) | Cloudflare → Turnstile |
| `CLOUDFLARE_TURNSTILE_SECRET_KEY` | No | Cloudflare Turnstile secret key | Cloudflare → Turnstile |
| `CRON_SECRET` | Yes | Shared secret for CRON endpoint authentication | `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | Yes | Full public URL of the app (e.g. `https://zobia.social`) | Your domain |
| `NEXT_PUBLIC_API_URL` | Yes | Full public API URL (e.g. `https://zobia.social/api`) | Your domain |
| `NEXT_PUBLIC_PWA_WEB_ENABLED` | No | Set to `"false"` to disable PWA/service-worker generation at build time. At runtime the admin can also toggle via x_manifest `pwa_web_enabled`. Default: `"true"` | `"true"` or `"false"` |
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
5. Under **Connection string**, copy:
   - **URI** (with `?pgbouncer=true` appended) → this is your `DATABASE_URL`
   - **Direct connection** URI → this is your `DIRECT_URL`
6. Run all migrations in order:
   ```bash
   for f in apps/web/db/migrations/*.sql; do
     echo "Applying $f..."
     psql "$DIRECT_URL" < "$f"
   done
   ```
   Migrations are numbered 001–023. Always apply them in order. Each migration is idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
7. Optional seed data: `psql "$DIRECT_URL" < apps/web/db/seed.sql`

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
3. Add the provider key to the `DATABASE_PROVIDER` enum/union in `apps/web/lib/env.ts`.
4. Import and register the new adapter in `apps/web/lib/db/index.ts`.
5. Add a corresponding ESLint rule if the provider has a client SDK that must not leak into business logic.

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

### Telegram Login

1. Open Telegram and message **@BotFather**.
2. Send `/newbot` and follow the prompts to name your bot.
3. BotFather will reply with a **bot token** — copy it to `TELEGRAM_BOT_TOKEN`.
4. Send `/setdomain` to BotFather → select your bot → enter your domain (e.g. `zobia.social`).
5. The Telegram Login Widget will now work on your domain.

---

## CRON Setup (CRITICAL)

Vercel Hobby Plan allows **only one CRON job per day**. Zobia requires multiple CRON frequencies:

| Job | Frequency | Handler | Notes |
|---|---|---|---|
| Daily reset | Midnight UTC | `/api/cron/daily` (configured in vercel.json) | Quest reset, login streaks, mystery XP drop, Creator Fund (days 1 & 5), guild tier demotion |
| Guild war checks | Every 1 hour | `/api/cron/guild-wars` | Final Hour transitions, war resolution, Drop Room auto-close, Flash XP announcements |
| Leaderboard updates | Every 15 minutes | `/api/cron/leaderboards` | Snapshot upserts, rank-change notifications |
| Payout batch processing | Every 30 minutes | `/api/cron/payouts` | Initiates Paystack transfers for pending Nigeria bank payouts; retries eligible failed payouts |

### Daily CRON responsibilities (day-of-month logic)

The daily CRON (`/api/cron/daily`) runs at **midnight UTC** every day. Some steps are conditional on the calendar date:

- **Every day**: Quest deck reset, login streak updates, re-engagement notifications, daily login XP, mystery XP drop (probabilistic), guild discovery prompts, guild tier demotion checks.
- **Day 1 of month**: Creator Fund pool seeded from 5% of prior month's ad revenue (`ad_revenue_YYYY_MM_kobo` key in `x_manifest` → write to `creator_fund_balance_kobo`).
- **Day 5 of month**: Creator Fund distributed to eligible creators (Elite tier+) and pool reset to 0.
- **Sundays**: Nemesis assignments refreshed, season leaderboard snapshot published.

### Vercel Hobby CRON (daily — already configured)

The daily CRON is already defined in `apps/web/vercel.json`:

```json
{ "path": "/api/cron/daily", "schedule": "0 0 * * *" }
```

This runs at midnight UTC automatically on Vercel. No additional setup needed.

### cron-jobs.org external CRON (required for sub-daily jobs)

All sub-daily CRON jobs must be driven by an external scheduler because Vercel Hobby limits you to one daily CRON.

1. Create a free account at [cron-jobs.org](https://cron-jobs.org).
2. Generate a secure CRON secret: `openssl rand -hex 32`
3. Add this value as `CRON_SECRET` in your Vercel environment variables.
4. In cron-jobs.org, create the following jobs:

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

**Payout Batch Processing (every 30 minutes)**
- URL: `https://your-domain.com/api/cron/payouts`
- Schedule: Every 30 minutes
- HTTP Method: POST
- Header: `Authorization: Bearer YOUR_CRON_SECRET`

All CRON handlers verify the `Authorization: Bearer <CRON_SECRET>` header and return 401 if it does not match. Never expose `CRON_SECRET` publicly.

### Creator Payout Setup

**Paystack Transfers permission** must be enabled before payouts can be processed:

1. Log into your Paystack dashboard.
2. Go to **Settings → Transfers** and enable the Transfer feature for your account.
3. Ensure your `PAYSTACK_SECRET_KEY` has the **Transfers** permission scope.

Without this, `POST /api/cron/payouts` will fail on every bank transfer attempt.

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

### Creator Fund ad revenue tracking

To ensure the Creator Fund pool is correctly seeded on the 1st of each month, ad revenue must be recorded in `x_manifest` using the key format `ad_revenue_YYYY_MM_kobo` (e.g. `ad_revenue_2026_05_kobo`). The admin financial dashboard records monthly ad revenue totals automatically. If integrating a third-party ad network, ensure the revenue webhook updates this key each month.

---

## APK Build

### Prerequisites

- Expo account at [expo.dev](https://expo.dev) — create a project named `zobia-social`
- EAS CLI installed globally: `npm install -g eas-cli`
- Android `targetSdkVersion` set to **36** in `apps/expo/app.json`

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

Verify in `apps/expo/app.json`:

```json
{
  "expo": {
    "android": {
      "targetSdkVersion": 36
    }
  }
}
```

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
3. Registers the token with the backend via `POST /api/users/push-token`.

No configuration is needed beyond including `expo-notifications` in your Expo SDK (already included in `apps/expo/package.json`).

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
