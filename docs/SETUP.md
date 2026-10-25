# Zobia — Step-by-step dashboard setup

Follow these sections in order. Everything here uses websites and dashboards; you do not need a terminal. The website/PWA is in `apps/web`; the Android app is Vite/Capacitor in `apps/android`.

Use one website address throughout, for example `https://zobia.vercel.app`. Replace that example with your own address wherever it appears. If you already have a working service, reuse it rather than creating another one.

## 1. Create your Supabase database and storage

- Create an account at [supabase.com](https://supabase.com).
- Open the dashboard and click **New project**. Create an organization first if asked.
- Enter a project name, generate a strong database password, and save the password in your password manager.
- Select a suitable region, choose the Free plan if appropriate, and click **Create new project**. Wait until the project is ready.
- Click **Connect** at the top of the project. Select **Transaction pooler** and copy the PostgreSQL connection string. Save it as your future `DATABASE_URL` value.
- In the same dialog, select **Direct connection** and copy its connection string. Save it as `DIRECT_URL`. If that connection is IPv6-only and unavailable from your host, use **Session pooler** instead.
- Replace `[YOUR-PASSWORD]` in both strings with the database password. The square brackets must not remain. Special characters in passwords must be URL-encoded in connection strings; a long randomly generated letters-and-numbers password avoids this extra step.
- Open **Project Settings → Database → SSL Configuration** (sometimes shown under **Database → Settings**). Download the CA certificate.
- Open the downloaded certificate in a text editor. Keep its entire text, including `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----`; you will paste it into `DB_CA_CERT`.
- Open **Project Settings → API** / **API Keys**. Copy the **Project URL** and the **legacy service_role key**. Keep the key private; do not use the `anon` key for this setting.
- Open **Storage → New bucket**. Name the bucket `zobia-media`, enable **Public bucket**, and create it.
- Create another bucket named `zobia-private`. Leave **Public bucket** off.
- Leave anonymous upload/write permissions disabled. The app's server handles authenticated uploads.

**Using another supported database?** You can use Railway or DigitalOcean PostgreSQL instead. Choose `railway` or `digitalocean` for `DATABASE_PROVIDER`, copy that provider's connection URLs, and use `RAILWAY_CA_CERT` or `DO_CA_CERT` for its certificate. You can still use Supabase Storage independently. The schema works in PostgreSQL without Supabase Auth; Supabase grants are applied only when its roles exist.

## 2. Create Upstash Redis

- Create an account at [console.upstash.com](https://console.upstash.com).
- Click **Create Database** under **Redis**. Choose a name, a nearby region, and the Free plan if available for your account.
- Open the new database and find **REST API** / **REST API credentials**.
- Copy the **REST URL** and **REST token**. These become `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
- Use the normal REST token, not a read-only token: the app needs to write session and rate-limit data.

## 3. Create Ably realtime messaging

- Create an account at [ably.com](https://ably.com) and open your dashboard.
- Click **Create app**, enter a name, and open the app.
- Open **API Keys** and create a server key with **Publish** and **Subscribe** permissions.
- Copy the complete key as `ABLY_API_KEY`. Keep it private.
- Both the website and Android use this server key through the backend. Do not put it into Android build settings.

## 4. Choose your website address in Vercel

- Create an account at [vercel.com](https://vercel.com) and connect your GitHub account.
- Click **Add New → Project**, find `nero1/zobia`, and click **Import**. Grant GitHub repository access if requested.
- Set the project name. Its default address will usually be `https://PROJECT_NAME.vercel.app`; check the actual address Vercel assigns.
- Set **Framework Preset** to **Next.js**.
- Set **Root Directory** to `apps/web`. Enable **Include source files outside of the Root Directory**.
- Use `main` as the production branch. Select **Node.js 22.x** in the project settings.
- Keep the detected install/output settings. The **Build Command** field should contain `npm run build`; this is a dashboard field, not something you run locally.
- Use the assigned address in the next section. For a custom domain, add it in **Settings → Domains** and follow Vercel's DNS instructions first.
- Complete the environment variables below before expecting a successful deployment. If Vercel makes an initial deployment before you finish, redeploy after setup.

## 5. Set up Google sign-in

- Open [console.cloud.google.com](https://console.cloud.google.com) and sign in.
- Use the project selector at the top to create or select a Google Cloud project.
- Open **Google Auth Platform → Branding**. Enter the app name, support email, and developer contact email; save the changes.
- Open **Audience**. Choose **External** for users outside your organization. While the app is in **Testing**, add your Google account under **Test users**.
- Open **Clients → Create client**. Choose **Web application**, give it a name, and add your website address under **Authorized JavaScript origins**, for example `https://zobia.vercel.app`.
- Under **Authorized redirect URIs**, add `https://zobia.vercel.app/api/auth/google/callback`, using your actual domain.
- Click **Create** and copy the **Client ID** and **Client secret**. These become `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
- Use this same Web application client for website/PWA and Android browser sign-in. Google's redirect goes to the website backend; do not enter the Android deep link here.
- Before opening sign-in to everyone, change the consent screen's publishing status from **Testing** to **In production**. Complete any verification Google requests.

## 6. Add your Vercel environment variables

- In your Vercel project, open **Settings → Environment Variables**. On the initial import screen, use its **Environment Variables** section instead.
- Add each variable below with its exact name and corresponding value. Select **Production**, then save.
- Each table row is a separate variable. Preview deployments need their own matching settings only if you intend to use them.

| Variable name | Value to enter |
|---|---|
| `DATABASE_PROVIDER` | `supabase` |
| `DATABASE_URL` | Transaction-pooler connection string from section 1 |
| `DIRECT_URL` | Direct or session-pooler connection string from section 1 |
| `DB_CA_CERT` | Complete certificate text from section 1, including BEGIN/END lines |
| `DB_POOL_SIZE` | `2` |
| `DB_DIRECT_POOL_SIZE` | `2` |
| `REDIS_PROVIDER` | `upstash` |
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL from section 2 |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token from section 2 |
| `STORAGE_PROVIDER` | `supabase-storage` |
| `SUPABASE_URL` | Supabase Project URL from section 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key from section 1 |
| `SUPABASE_STORAGE_BUCKET` | `zobia-media` |
| `SUPABASE_PRIVATE_STORAGE_BUCKET` | `zobia-private` |
| `REALTIME_PROVIDER` | `ably` |
| `NEXT_PUBLIC_REALTIME_PROVIDER` | `ably` |
| `ABLY_API_KEY` | Complete Ably server key from section 3 |
| `NEXT_PUBLIC_APP_URL` | Your HTTPS website address, e.g. `https://zobia.vercel.app`, without a trailing `/` |
| `GOOGLE_CLIENT_ID` | Google Client ID from section 5 |
| `GOOGLE_CLIENT_SECRET` | Google Client secret from section 5 |
| `JWT_SECRET` | A new random secret of at least 32 characters |
| `JWT_REFRESH_SECRET` | A different random secret of at least 32 characters |
| `CRON_SECRET` | Another different random secret of at least 32 characters |
| `KYC_ENCRYPTION_KEY_V2` | Another different random secret of at least 32 characters |

- Generate the four random secrets with your password manager's generator; save a secure backup. Do not use the example words above as values.
- For an existing deployment, retain its secrets and encryption keys. If it already uses `KYC_ENCRYPTION_KEY_V1`, keep that variable too; replacing encryption keys can make saved records unreadable.
- Paste values without extra quotation marks. For certificates, paste the full multiline text.
- Leave `SKIP_ENV_VALIDATION` unset. Omit unused optional variables instead of adding empty values from `.env.example`.
- Only variables beginning with `NEXT_PUBLIC_` are intended for the browser. Never add that prefix to a private key or secret.

## 7. Create the database tables

Choose **one** route below. For a new empty Supabase project, route A is the simplest.

### A. Supabase SQL Editor (new, empty database)

- On GitHub, open [`apps/web/db/migrations/0001_consolidated_schema.sql`](../apps/web/db/migrations/0001_consolidated_schema.sql) on branch **main**.
- Click **Raw**, select the complete file, and copy it. Do not copy only the visible preview.
- In Supabase, open **SQL Editor → New query**.
- Paste the complete SQL and click **Run**. Wait until it finishes successfully.
- This creates the final tables, views, reference/configuration data, permissions, and row-level security rules in one migration. Do not run historical migration files. Optional starter content is installed separately after administrator setup in section 8.
- If SQL Editor reports an error, keep the message and resolve it before proceeding. Do not repeatedly rerun the baseline over partially created application tables.

### If reinstalling after deliberately wiping the old tables

Deleting tables does not necessarily delete their helper functions. If SQL Editor reports **function "app_group_member" already exists**, the wipe left functions behind.

- Open [`clear-orphaned-baseline-functions.sql`](../apps/web/db/maintenance/clear-orphaned-baseline-functions.sql) on GitHub and click **Raw**. Copy the complete file.
- Paste it into a new query in **Supabase → SQL Editor**, then click **Run**. It removes only the eight baseline helper functions, inside a transaction.
- The cleanup refuses to run if application tables, views, or sequences remain. If it refuses, use route B for an existing installation; do not bypass the check.
- After cleanup succeeds, run the complete `0001_consolidated_schema.sql` from route A again.
- Do not delete Supabase's `auth` or `storage` schemas. Do not change function declarations or skip migration statements to get past the error.

### B. GitHub Actions (alternative to Supabase SQL Editor)

- For an existing database, first create a backup using the provider's dashboard and confirm how you would restore it. Backup availability depends on your provider and plan.
Use this route instead of pasting SQL into Supabase. It installs a new database or applies supported upgrades to an existing one, without a terminal.

- In **Supabase → your project → Connect**, select **Session pooler** and copy the PostgreSQL connection URI. Replace `[YOUR-PASSWORD]` with your database password (URL-encode special characters, as explained in section 1). Do not use the transaction-pooler URL for migrations.
- Open your **GitHub repository → Settings → Secrets and variables → Actions → New repository secret**.
- Enter **Name:** `MIGRATION_DATABASE_URL`. Paste the connection URI into **Secret**, then click **Add secret**.
- Click **New repository secret** again. Name it `MIGRATION_DB_CA_CERT`, paste the complete database CA certificate from section 1, including the BEGIN/END lines, and save.
- These secrets must be saved in GitHub; adding them only in Vercel does not configure this workflow. If it says **Add MIGRATION_DATABASE_URL in GitHub Actions secrets first**, check the secret's exact name and repository.
- Open **Actions → Database Setup → Run workflow**.
- Select branch **main**. Choose **apply** for a new database or a recognized existing installation.
- Choose **adopt** if the baseline was previously pasted manually and the database has no migration history. It verifies the schema, applies recognized upgrades, and registers it without wiping data. Supabase's additional automatic RLS and SQL Editor line endings are supported; keep those protections enabled.
- Click **Run workflow**. Open the run and wait for a green checkmark; approve the `production` environment if your repository requires it.
- After pulling schema updates, run **apply** here before redeploying Vercel. Recognized existing databases are upgraded without wiping content, including the campaign-list indexes. Rebuild the Vite Android app after client changes.
- A refused schema check means the runner did not recognize the database's state. Do not wipe tables, paste the baseline over them, or bypass the check.
- If **adopt** reports schema drift, open **Actions → Database Schema Diagnostics → Run workflow → main**. It uses the same secrets and reads your schema without changing it. After success, download **schema-diagnostics** under the run's **Artifacts** and share `schema-diagnostics.json` for review. It contains object names and fingerprints, not user records, SQL definitions or credentials. Differences require review before a repair is selected.

## 8. Deploy the website and create your administrator

- Return to Vercel. Click **Deploy**, or open **Deployments → latest deployment → ⋯ → Redeploy** after saving all variables.
- Wait until the deployment says **Ready**. If it fails, open its build logs and read the first reported error.
- Open `https://YOUR_DOMAIN/api/health`, replacing `YOUR_DOMAIN` with your website domain. Confirm the database, schema, and Redis checks are healthy.
- Open your website and sign in with Google. Complete the account onboarding.
- Open **Settings → Set Password** and create a password for your account.
- In Supabase **SQL Editor**, or your database provider's query editor, run the following. Replace the sample email with the exact email of the account you just created:

  ```sql
  UPDATE public.users
  SET is_admin = true
  WHERE lower(email) = lower('you@example.com')
  RETURNING id, email, is_admin, is_email_verified;
  ```

- Confirm the query updated your account. If it updated zero rows, check the email before continuing.
- Open `https://YOUR_DOMAIN/gate44/login`. Sign in with your email/password and complete the authenticator-app setup. Admin actions use this separate admin sign-in.
- In the admin panel, configure the features, payment providers, moderation, and limits you want to enable.
- Test Google sign-in in a fresh browser session. For the PWA, install the site using your browser's **Install app** / **Add to Home Screen** option and test sign-in there too.

### Optional: Add starter content

- Finish the administrator setup above first.
- Open [`apps/web/db/seed.sql`](../apps/web/db/seed.sql) on GitHub, click **Raw**, and copy the complete file.
- Paste it into **Supabase → SQL Editor → New query**.
- Near the top, replace `REPLACE_WITH_YOUR_ADMIN_EMAIL` with your administrator email, keeping the single quotes, then click **Run**.
- Refresh the site and review the examples. This adds broad starter content and 80 extra quest templates without creating accounts or crediting wallets. Commercial/season/event examples stay inactive or drafts.
- See [content coverage, prerequisites and quest behaviour](SEED-CONTENT.md). Existing daily decks stay unchanged; new templates enter future decks.

## 9. Build and download the Android test APK

- In GitHub, open your repository → **Settings → Secrets and variables → Actions**.
- Click **New repository secret**. Add `VITE_API_BASE_URL` with your website address, e.g. `https://zobia.vercel.app`.
- Add another secret named `VITE_WEB_BASE_URL` with the same website address. Do not add `/api` or a trailing `/` to either value.
- Open **Actions → Android APK Build → Run workflow**.
- Select branch **main**, leave **release** unchecked, and click **Run workflow**.
- Open the new run and wait for the build to finish with a green checkmark.
- Open its **Summary**, scroll to **Artifacts**, and download the `zobia-debug-…` artifact.
- Extract the downloaded ZIP. The installable file inside is `app-debug.apk`.
- Keep this run open: you need its signing fingerprint in the next section. Google secrets, database credentials, and the Ably server key stay on Vercel.

## 10. Enable Android sign-in links and install the APK

- In the successful GitHub run's **Summary**, find **Android App Links** and copy the complete **SHA-256 fingerprint**. This identifies the APK's signing certificate.
- In Vercel → **Settings → Environment Variables**, add `ANDROID_APP_LINK_SHA256` for **Production** and paste the fingerprint.
- Redeploy the website so the new value takes effect.
- Open `https://YOUR_DOMAIN/.well-known/assetlinks.json`. It should show `com.zobiasocial.app` and the fingerprint you entered, with no placeholder.
- Transfer `app-debug.apk` to your Android phone and open it. If prompted, allow **Install unknown apps** for the browser or file manager you used, then install Zobia.
- On the phone, open **Settings → Apps → Zobia → Open by default** and enable **Open supported links**. The exact wording varies by Android version.
- After financial/schema updates, rebuild the APK. Older campaign submissions need the new funding request key. [Sponsored quest funding](SPONSORED-QUEST-FUNDING.md) explains reserves, legacy campaigns and refunds.
- Open Zobia and test Google sign-in. After Google returns to the backend, Android should open the app to complete sign-in.
- When the app opens a protected page in your browser (for example, identity verification), confirm the displayed username before continuing. The link expires after 90 seconds.
- After deploying realtime security updates, rebuild and reinstall the APK using steps 9–10. Older APKs use polling for private updates until rebuilt.
- Each debug build can have a different signing certificate. Use the fingerprint from the exact APK you install, and update Vercel/redeploy when it changes.
- Changing a `VITE_*` value requires a new APK. Changing a Vercel server variable requires a website redeploy.

**Publishing through Google Play:** This requires a release-signing keystore. If you already have one, add `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` as GitHub Actions secrets, then run **Android APK Build** with **release** checked. Download the release AAB artifact and upload it through [Google Play Console](https://play.google.com/console). For Play-installed apps, copy **App integrity → App signing certificate → SHA-256** into Vercel's `ANDROID_APP_LINK_SHA256`, then redeploy. Use the app-signing certificate, not the upload certificate. Separate multiple supported fingerprints with commas. If you do not have a release keystore yet, the debug APK steps above are sufficient for device testing; creating the signing identity is a separate prerequisite for publishing.

## 11. Enable optional features

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
| Native crypto payouts | Set `CRYPTO_PAYOUT_ADDRESS_BSC` / `CRYPTO_PAYOUT_ADDRESS_SOLANA` to the public sending-wallet address for each enabled chain. Approve the withdrawal in Admin → Payouts, send the exact displayed asset/amount, then submit its transaction hash to confirm settlement. Never enter a wallet private key. |
| AdMob rewarded ads | Configure native App ID/unit IDs and SSV callback `https://YOUR_DOMAIN/api/ads/admob-completion`; set `ADMOB_REWARDED_UNIT_IDS` on Vercel to the allowed rewarded unit IDs |
| R2 instead of Supabase Storage | `STORAGE_PROVIDER=r2`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`, `R2_PRIVATE_BUCKET_NAME`; keep the private bucket unexposed |

The full optional variable list is in [`apps/web/.env.example`](../apps/web/.env.example). Vercel's daily jobs are already declared in `apps/web/vercel.json`. Keep your existing external schedules; authenticate their requests with `Authorization: Bearer YOUR_CRON_SECRET`. Include `/api/cron/tasks` for durable email/reward/review/maintenance/chapter-notification delivery. No secret should appear in scheduler query strings.

## If Google sign-in still fails

### Missing `session_valid_after` column

The website code is newer than your database. Update the existing database as follows:

- Back up the database. Do not recreate it or add only this one column; other upgrade changes are also required.
- In **GitHub → repository → Settings → Secrets and variables → Actions**, add `MIGRATION_DATABASE_URL` and `MIGRATION_DB_CA_CERT` as described in section 7B. Use the same database as Vercel's `DATABASE_URL`/`DIRECT_URL`.
- Open **Actions → Database Setup → Run workflow**, and select **main**.
- Choose **adopt** if you installed the SQL manually without migration history. Choose **apply** for a tracked installation.
- Run it and wait for a green checkmark. If schema verification fails, keep the error for diagnosis; do not bypass the check.
- Open `/api/health` again, confirm the schema check is healthy, and retry Google sign-in.

### Other sign-in errors

- **`Invalid IP address: undefined`:** deploy the merged DNS callback fix. This was backend code, shared by web/PWA and Android; changing your Google client secret does not fix it.
- **`redirect_uri_mismatch`:** compare Google's redirect URI with `NEXT_PUBLIC_APP_URL` plus `/api/auth/google/callback`, including HTTPS and the exact domain.
- **Android stays in the browser:** check the built domain, installed APK certificate, published `assetlinks.json`, and Android's supported-link setting in step 10.
- **Works on the old deployment only:** redeploy after changing variables. Android `VITE_*` values require a new APK build; server variables require a Vercel redeploy.
