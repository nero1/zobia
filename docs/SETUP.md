# Zobia — Dashboard Deployment

Deploy the web/PWA from `apps/web`. The current Android app is **Vite/Capacitor in `apps/android`**. These steps use the Vercel, database and GitHub websites; no local terminal is required.

## 1. Create the services

1. Create a **Supabase PostgreSQL** project. In **Connect**, copy its transaction-pooler URL for `DATABASE_URL` and its direct URL for `DIRECT_URL`. Replace the password placeholder; URL-encode special password characters. If the direct host is IPv6-only and your runner cannot reach it, use the session-pooler URL for migrations.
2. In **Database → SSL Configuration**, download the database CA certificate. Keep its complete PEM text for `DB_CA_CERT`.
3. In **Storage**, create `zobia-media` as a **public** bucket and `zobia-private` as a **private** bucket. Uploads go through the authenticated application server; do not enable anonymous writes or public access to the private bucket.
4. Copy the project URL and **service_role** key from Supabase's API settings. The service-role key stays server-side.
5. Create an **Upstash Redis** database and copy its REST URL/token.
6. Create an **Ably** app and a server API key with Publish and Subscribe permissions. Both web/PWA and Android use this backend; no Ably secret goes into the Android build.

Railway and DigitalOcean PostgreSQL also work: select `railway` or `digitalocean` for `DATABASE_PROVIDER`, use their connection URLs, and apply the same schema. Set their CA certificate as `RAILWAY_CA_CERT` or `DO_CA_CERT`, respectively; `DB_CA_CERT` is the Supabase runtime setting. Storage and realtime are configured independently of the database.

## 2. Configure Google sign-in

1. Open **Google Cloud Console → Google Auth Platform**. Configure the consent screen and add your account under **Test users** while the app is in Testing.
2. Create an OAuth client with application type **Web application**. This same client handles web/PWA and Android's browser-based sign-in.
3. Add your exact website origin under **Authorized JavaScript origins**, for example `https://zobia.vercel.app`.
4. Add this exact **Authorized redirect URI**: `https://zobia.vercel.app/api/auth/google/callback`. Replace the domain if using your own domain. Do not register the Android deep link as Google's redirect URI.
5. Copy the client ID and secret into the Vercel variables below. The callback domain must match `NEXT_PUBLIC_APP_URL` and the domain where you start sign-in.

## 3. Configure Vercel

1. Import **nero1/zobia**, select branch **main**, and choose **Next.js**.
2. Set **Root Directory** to `apps/web` and enable access to files outside that directory. Keep the detected install/output settings; the build command is `npm run build`. Select **Node.js 22.x**.
3. In **Settings → Environment Variables**, add the following for **Production**. Add separate Preview values only if you intend to test preview deployments.

| Variable | Value |
|---|---|
| `DATABASE_PROVIDER` | `supabase` |
| `DATABASE_URL` | Supabase transaction-pooler PostgreSQL URL |
| `DIRECT_URL` | Direct PostgreSQL URL, or session pooler when direct IPv6 is unavailable |
| `DB_CA_CERT` | Complete database PEM certificate, including BEGIN/END lines |
| `DB_POOL_SIZE` / `DB_DIRECT_POOL_SIZE` | `2` each |
| `REDIS_PROVIDER` | `upstash` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash REST credentials |
| `STORAGE_PROVIDER` | `supabase-storage` |
| `SUPABASE_URL` | `https://YOUR_PROJECT.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key; never a public variable |
| `SUPABASE_STORAGE_BUCKET` | `zobia-media` |
| `SUPABASE_PRIVATE_STORAGE_BUCKET` | `zobia-private` |
| `REALTIME_PROVIDER` / `NEXT_PUBLIC_REALTIME_PROVIDER` | `ably` for both |
| `ABLY_API_KEY` | Ably server API key |
| `NEXT_PUBLIC_APP_URL` | Your final HTTPS website origin, e.g. `https://zobia.vercel.app`; no trailing slash |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google Web application OAuth credentials |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Two different, securely generated random secrets, at least 32 characters each |
| `CRON_SECRET` | Another independent random secret; used by your scheduler |
| `KYC_ENCRYPTION_KEY_V2` | Another independent random secret, at least 32 characters; keep a secure backup |

Use a password manager's generator for the random secrets. Keep existing encryption keys when upgrading an existing deployment; replacing them makes encrypted records unreadable. If existing records use `KYC_ENCRYPTION_KEY_V1`, retain that variable too. Leave `SKIP_ENV_VALIDATION` unset in production.

Do not copy blank optional URL variables from `.env.example`; omit unused optional variables. Only `NEXT_PUBLIC_*` values are exposed to the browser.

## 4. Install or upgrade the database

**Empty Supabase database:** Open GitHub's `apps/web/db/migrations/0001_consolidated_schema.sql`, copy the complete file into **Supabase → SQL Editor**, and click **Run**. It is one final-state schema with reference/configuration data, RLS and conditional Supabase grants. Do not run the old historical migration files or demo seeds.

**Existing database, or migrations through GitHub's website:**

1. Back up the existing database in your database provider's dashboard.
2. In **GitHub repository → Settings → Secrets and variables → Actions**, add `MIGRATION_DATABASE_URL` using the direct/session-pooler URL and `MIGRATION_DB_CA_CERT` using the PEM certificate.
3. In **Actions → Database Setup → Run workflow**, select **main** and choose **apply**. If you previously pasted the baseline SQL manually and it has no migration history, choose **adopt** instead.
4. Wait for a green run. The runner verifies known existing schemas before upgrading; it preserves application data and refuses unknown schema drift. Do not paste the fresh baseline over an existing application schema or bypass a refused upgrade.

The baseline is ordinary PostgreSQL; Supabase-only grants are conditional on those roles existing. No Supabase Auth dependency is required.

## 5. Deploy and create the administrator

1. In Vercel, click **Deploy**, or open **Deployments → Redeploy** after saving environment variables. Check that the deployed commit is the merged PR's commit.
2. Open `https://YOUR_DOMAIN/api/health` in your browser. It must report healthy database and Redis connections.
3. Sign in with Google, complete onboarding, and open **Settings → Set Password** to create your account password.
4. In your database's SQL editor, promote only your own account, replacing the email below:

   ```sql
   UPDATE public.users SET is_admin = true WHERE email = 'you@example.com';
   ```

5. Open `/gate44/login`, sign in with that email/password, and complete the authenticator setup. Admin actions require this separate assured admin sign-in.
6. Configure features, payment providers, moderation and limits in the admin panel. Test Google sign-in in a fresh browser session and as an installed PWA.

## 6. Build the Vite/Capacitor Android app

1. In **GitHub → Settings → Secrets and variables → Actions**, set `VITE_API_BASE_URL` and `VITE_WEB_BASE_URL` to the **same HTTPS website origin** used above. Do not append `/api`. Google secrets and database credentials belong only on the server.
2. Open **Actions → Android APK Build → Run workflow**, select **main**, and leave **release** unchecked for a test APK.
3. When it finishes, download the APK from **Artifacts**. The build uses `VITE_WEB_BASE_URL` for its Android App Link hostname.
4. In that run's **Summary → Android App Links**, copy the SHA-256 fingerprint into Vercel's `ANDROID_APP_LINK_SHA256` variable, then **redeploy the website**. Debug signing certificates can differ between builds; use the fingerprint for the APK you install.
5. Open `https://YOUR_DOMAIN/.well-known/assetlinks.json` in your browser. It must show `com.zobiasocial.app` and your APK's fingerprint, with no placeholder.
6. Install the APK, open Android **Settings → Apps → Zobia → Open by default**, and allow supported links. Retry Google sign-in. Google's callback reaches the backend first; the verified `/auth/callback` App Link returns the one-time exchange code to the app.

For a Play Store release, supply the existing `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` GitHub secrets, then run the workflow with **release** checked. For Play-installed builds, use **Play Console → App integrity → App signing certificate → SHA-256** in `ANDROID_APP_LINK_SHA256`. Multiple installed signing certificates can be listed separated by commas. Add the domain in Vercel before building against a custom domain.

## 7. Connect optional services and background jobs

Set only the variables needed by the features you enable, then redeploy Vercel:

| Feature | Variables / dashboard setup |
|---|---|
| Recovery and transactional email | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`; verify the sending domain in Mailgun |
| Paystack | `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`; Paystack webhook URL: `https://YOUR_DOMAIN/api/economy/webhooks/paystack` |
| Crypto payments | `CRYPTO_RECEIVING_ADDRESS_BSC`, `CRYPTO_RECEIVING_ADDRESS_SOLANA`; optional `BSC_RPC_URL`, `SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`; configure allowed currencies in admin payments |
| AI moderation | `DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, optionally `GROQ_API_KEY`; enable the desired providers in admin settings |
| Telegram login/alerts | `TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`; set the bot's allowed domain in BotFather |
| CAPTCHA | Turnstile: `CLOUDFLARE_TURNSTILE_SITE_KEY`, `CLOUDFLARE_TURNSTILE_SECRET_KEY`; or reCAPTCHA: `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY`; select the provider in admin settings |
| PWA background push | Your matching `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` (`mailto:you@example.com`) |
| Native push | `FCM_SERVICE_ACCOUNT_JSON` on Vercel and the matching Firebase `google-services.json` in `apps/android/android/app/`; configure the Firebase Android app as `com.zobiasocial.app` |
| AdMob rewarded ads | Configure native App ID/unit IDs and SSV callback `https://YOUR_DOMAIN/api/ads/admob-completion`; set `ADMOB_REWARDED_UNIT_IDS` on Vercel to the allowed rewarded unit IDs |
| R2 instead of Supabase Storage | `STORAGE_PROVIDER=r2`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`, `R2_PRIVATE_BUCKET_NAME`; keep the private bucket unexposed |

The full optional variable list is in [`apps/web/.env.example`](../apps/web/.env.example). Vercel's daily jobs are already declared in `apps/web/vercel.json`. Keep your existing external schedules; authenticate their requests with `Authorization: Bearer YOUR_CRON_SECRET`. Include `/api/cron/tasks` for durable email/reward/review/maintenance delivery. No secret should appear in scheduler query strings.

## If Google sign-in still fails

- **`Invalid IP address: undefined`:** deploy the merged DNS callback fix. This was backend code, shared by web/PWA and Android; changing your Google client secret does not fix it.
- **`redirect_uri_mismatch`:** compare Google's redirect URI with `NEXT_PUBLIC_APP_URL` plus `/api/auth/google/callback`, including HTTPS and the exact domain.
- **Android stays in the browser:** check the built domain, installed APK certificate, published `assetlinks.json`, and Android's supported-link setting in step 6.
- **Works on the old deployment only:** redeploy after changing variables. Android `VITE_*` values require a new APK build; server variables require a Vercel redeploy.
