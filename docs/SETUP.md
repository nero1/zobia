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

### Building without a full set of env vars (CI / local type-check)

The build validates all required env vars at startup via `lib/env.ts`. In CI environments where secrets aren't available (e.g. for a type-check or lint-only run), set `SKIP_ENV_VALIDATION=1`:

```bash
SKIP_ENV_VALIDATION=1 npm run build
```

This skips the Zod validation step and exports an empty `env` object. API routes will still fail at runtime if accessed without valid env vars — `SKIP_ENV_VALIDATION` is only intended for the build/type-check phase.

---

## Environment Variables Reference

All variables belong in `apps/web/.env.local` locally and in the Vercel project environment variables for production.

| Variable | Required | Description | Where to get it |
|---|---|---|---|
| `DATABASE_PROVIDER` | Yes | Database backend: `supabase` \| `railway` \| `digitalocean` | Choose your provider |
| `DATABASE_URL` | Yes | Pooled connection string — **transaction mode** (for serverless/Vercel functions) | Supabase → Settings → Database → "Use pooler transaction mode" |
| `DIRECT_URL` | Yes | Direct connection string — bypasses the pooler, used for migrations only | Supabase → Settings → Database → "Use the direct connection string" |
| `STORAGE_PROVIDER` | Yes | Storage backend: `supabase-storage` \| `r2` \| `s3` | Choose your provider |
| `R2_ACCOUNT_ID` | If R2 | Cloudflare account ID | Cloudflare dashboard → right sidebar |
| `R2_ACCESS_KEY_ID` | If R2 | R2 API access key ID | Cloudflare → R2 → Manage R2 API tokens |
| `R2_SECRET_ACCESS_KEY` | If R2 | R2 API secret access key | Cloudflare → R2 → Manage R2 API tokens |
| `R2_BUCKET_NAME` | If R2 | Name of the R2 bucket | Cloudflare → R2 → Buckets |
| `R2_PUBLIC_URL` | If R2 | Public URL for the R2 bucket (e.g. `https://pub-xxx.r2.dev`) | Cloudflare → R2 → Bucket settings |
| `REALTIME_PROVIDER` | Yes | Realtime backend: `supabase-realtime` \| `ably` \| `pusher` | Choose your provider |
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
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth 2.0 client ID | Google Cloud Console → Credentials |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth 2.0 client secret | Google Cloud Console → Credentials |
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token for Telegram Login | @BotFather → /newbot |
| `TELEGRAM_WEBHOOK_SECRET` | No | Secret for authenticating incoming Telegram webhook requests | Generate a random string |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | Yes | Bot username **without** the `@` (e.g. `ZobiaBot`) — used by the Telegram Login Widget on the frontend. Without this, the widget is hidden. | @BotFather → `/mybots` → select your bot → username shown at the top |
| `DEEPSEEK_API_KEY` | Yes | DeepSeek API key for AI moderation | platform.deepseek.com → API Keys |
| `DEEPSEEK_API_ENDPOINT` | No | Override endpoint (default: `https://api.deepseek.com/v1`) | DeepSeek docs |
| `GEMINI_API_KEY` | Yes | Google Gemini API key (AI fallback) | aistudio.google.com → Get API key |
| `MAILGUN_API_KEY` | No | Mailgun API key for transactional email | Mailgun → Account → API Keys |
| `MAILGUN_DOMAIN` | No | Mailgun sending domain (e.g. `mg.yourdomain.com`) | Mailgun → Sending → Domains |
| `PAYSTACK_SECRET_KEY` | No | Paystack secret key — must have Transfers permission enabled | Paystack dashboard → Settings → API Keys |
| `PAYSTACK_PUBLIC_KEY` | No | Paystack public key | Paystack dashboard → Settings → API Keys |
| `DODOPAYMENTS_API_KEY` | No | DodoPayments API key | DodoPayments dashboard → API |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | No | Google Play service account JSON (base64-encoded or raw) for Android IAP verification | Google Play Console → Setup → API access |
| `ADMOB_APP_ID` | No | Google AdMob app ID (for rewarded ads in the Expo app) | AdMob → Apps |
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
| `PROFANITY_WORDLIST` | No | Comma-separated list of additional profanity words to block | Custom list |
| `NEXT_PUBLIC_APP_URL` | Yes | Full public URL of the app (e.g. `https://zobia.social`) | Your domain |
| `NEXT_PUBLIC_API_URL` | Yes | Full public API URL (e.g. `https://zobia.social/api`) | Your domain |
| `NEXT_PUBLIC_REALTIME_PROVIDER` | Yes | Client-side realtime provider — must match `REALTIME_PROVIDER` | `supabase-realtime` \| `ably` \| `pusher` |
| `NEXT_PUBLIC_SUPABASE_URL` | If supabase-realtime | Supabase project URL — same as `SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | If supabase-realtime | Supabase anon/public key — safe to expose to browsers | Supabase → Project Settings → API → `anon public` |
| `NEXT_PUBLIC_PUSHER_KEY` | If pusher | Pusher App Key (public identifier, same as `PUSHER_KEY`) | Pusher Dashboard → App Keys |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | If pusher | Pusher cluster region (e.g. `mt1`, `eu`) | Pusher Dashboard → App Keys |
| `NEXT_PUBLIC_PWA_WEB_ENABLED` | No | Set to `"false"` to disable PWA/service-worker generation at build time. Default: `"true"` | `"true"` or `"false"` |
| `NODE_ENV` | Auto | Runtime environment — set automatically by Next.js (`development` \| `test` \| `production`) | Set by Next.js |
| `SKIP_ENV_VALIDATION` | Build only | Set to `"1"` to bypass env-var validation at build time (CI type-check only). Never set in production. | `"1"` |
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
3. The interface's `query<T>` generic defaults to `Record<string, unknown>` without a constraint. If your underlying driver (e.g. `pg`) requires `T extends QueryResultRow`, use `T & Record<string, unknown>` when calling the driver and cast the result back: `result.rows as T[]`. This keeps the public interface flexible for callers.
4. Add the provider key to the `DATABASE_PROVIDER` enum/union in `apps/web/lib/env.ts`.
5. Import and register the new adapter in `apps/web/lib/db/index.ts`.
6. Add a corresponding ESLint rule if the provider has a client SDK that must not leak into business logic.

---

## Realtime Setup

Zobia uses a **provider-native** realtime architecture. The server makes a fast, stateless HTTP call to the configured provider's REST API after saving each message. The provider (Ably / Pusher / Supabase Realtime) is responsible for maintaining persistent WebSocket connections to browser and mobile clients. No Redis Pub/Sub is involved in realtime delivery.

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

### Telegram Login

1. Open Telegram and message **@BotFather**.
2. Send `/newbot` and follow the prompts to name your bot.
3. BotFather will reply with a **bot token** — copy it to `TELEGRAM_BOT_TOKEN`.
4. The bot username is shown at the top of BotFather's reply (e.g. `ZobiaBot`) — copy it **without the `@`** to `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`. This is required for the Login Widget to appear on the register/login pages.
5. Send `/setdomain` to BotFather → select your bot → enter your domain (e.g. `zobia.social`).
6. The Telegram Login Widget will now work on your domain.

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
