# How Zobia Social Works

## User-Facing Features

### Onboarding

New users choose a username, select their city and country, pick an avatar emoji, and optionally enter a referral code. The onboarding flow calls `/api/onboarding/complete`, which atomically awards welcome XP and credits, generates a unique referral code, and records a tier-1 referral if a code was provided. Auth is immediately established via HTTP-only JWT cookie (web) or Expo SecureStore (Android).

### Direct Messages (DMs)

1-to-1 private messaging between any two users. Messages are stored in the `messages` table with `recipient_id` set. Conversations are fetched from `/api/inbox`.

**Realtime delivery flow:**
1. The sender's POST to `/api/messages/dm/[conversationId]` saves the message to the database.
2. The handler calls `publishRealtimeEvent("dm:conversation:uuid", "new_message", { message })`.
3. `publishRealtimeEvent` makes a stateless HTTP call to the configured provider's REST API (Ably / Pusher / Supabase Realtime).
4. The provider delivers the event over WebSocket to all subscribed clients.
5. The recipient's browser (subscribed via `useRealtimeChannel`) receives the event and updates React state immediately — the message appears without any page refresh.

The DM page also runs a 3-second baseline poll as a guaranteed fallback in case the provider is temporarily unreachable.

**Auth for realtime subscriptions:**
- Ably: the browser calls `GET /api/realtime/ably-token?channel=dm:conversation:uuid` which verifies the JWT, confirms the user is a participant, and returns a scoped Ably TokenRequest (subscribe-only, 1-hour TTL).
- Pusher: the browser calls `POST /api/realtime/pusher-auth` which verifies the JWT, confirms participation, and returns an HMAC-signed auth string for the private channel.
- Supabase Realtime: the browser connects directly with the public `anon` key; Broadcast channels are not RLS-restricted (but the channel name includes the conversation UUID, which is not guessable).

Each message sent earns XP on the `social` track.

### Rooms

Zobia has six room types, each with different XP earn mechanics:

| Room Type | Description |
|---|---|
| **Vibe Check** | Open discussion rooms — join, read, or post |
| **Debate Arena** | Structured debate with sides; posts earn extra XP for engagement |
| **Study Hall** | Knowledge-focused rooms; earns XP on the `knowledge` track |
| **Battle Room** | Competitive challenges where members vote for a winner |
| **Chill Zone** | Casual hangout; low-friction, low XP |
| **Flex Room** | Creator-gated rooms; room owner earns creator earnings |

Rooms can be city-scoped or global. Guild captains can create guild-exclusive rooms that earn `competitor` track XP.

### Guilds

Guilds are persistent groups of up to N members. Creating a guild costs 500 Credits (deducted atomically). Members earn `competitor` track XP from guild activities. Guilds have a treasury (credit pool) funded by member donations and war rewards. Guild tiers (bronze → silver → gold → platinum → diamond) unlock higher treasury caps and XP multipliers. See **Guild War Engine** below.

### XP System

XP is earned on seven tracks: `main` (overall), `social`, `creator`, `competitor`, `generosity`, `knowledge`, and `explorer`. Each action type maps to a specific track (e.g. sending a message → social; publishing content → creator; winning a guild war → competitor). The XP Engine applies a multiplier stack — plan bonus → guild bonus → season pass bonus → active booster — using integer basis-point arithmetic. All XP flows through `/api/xp`, which writes to `xp_ledger` and updates `users.xp_total` and the relevant track field.

### Dual Currencies

**Credits** (soft currency, previously "Coins") — Earned from quests, daily logins, season rewards, gifts received, rewarded ads (free users only, capped at 5/day). Spent on guilds, gifts, store items, and room creation. Stored in `users.coin_balance`; all mutations go through `coin_ledger` (append-only audit trail). The display name is admin-configurable via `x_manifest` keys `currency_soft_name_singular` / `currency_soft_name_plural` (defaults: Credit / Credits).

**Stars** (premium currency) — Purchased via Paystack or DodoPayments. Used for exclusive cosmetics and season pass upgrades. Stored in `users.star_balance`; all mutations go through `star_ledger`. The display name is admin-configurable via `currency_premium_name_singular` / `currency_premium_name_plural` (defaults: Star / Stars).

### Gifting

Users can send gift items (flower, trophy, crown, etc.) to any other user. Gift items have credit prices and tiers. The XP awards for gifting are (PRD §6):

| Event | Who | XP | Track |
|---|---|---|---|
| Sending any gift | Sender | 10 (fixed) | Generosity |
| Receiving any gift | Recipient | 5 | Social |
| First-ever gift received | Recipient | +15 bonus | Social |
| Gift sent in a Room (tip) | Room creator/recipient | 25 | Creator |
| Hosting a Room for 30+ minutes | Creator | 50 (on room close) | Creator |

Creators earn credit revenue when they receive gifts in their rooms (80% net; 85% for Zobia Icon creators). The platform retains the remainder. All credit flows are recorded atomically in `coin_ledger`.

### Seasons

Seasons run in 8-week cycles. Each season has four phases:

- **Opening (weeks 1–2)**: High XP for first-time actions, quest bonus multiplier active
- **Mid-Season (weeks 3–5)**: Standard rates, guild war frequency peaks
- **Push (weeks 6–7)**: Leaderboard freeze warnings, sprint quests unlock
- **Final Day (week 8)**: 2× XP all day, global leaderboard visible to all users

Season Pass: the free tier earns basic credit rewards for completing quests. The paid tier unlocks exclusive cosmetics, animated borders, and bonus XP multipliers. At season end, competitive rankings reset. Track levels, credit balance, friend list, and history are all preserved.

### Prestige

When a user reaches the maximum rank (Zobia Icon, sublevel III), they can Prestige via `POST /api/prestige`. Their main XP resets to 0 while their prestige count increments. Prestiged users receive:

- **Prestige 1**: 500 bonus credits + Phoenix frame badge
- **Prestige 2+**: 1 Zobia Star per prestige cycle
- **Prestige 3+**: 3× XP boost for the first 7 days of each new cycle; Elder Candidate badge at P3
- **Prestige 5**: Veteran Prestige badge
- **Prestige 10 — Hall of Fame**: Hall of Fame badge, permanent top-100 visibility on the global main leaderboard (users are always pinned into the top 100 even after XP reset), and the exclusive **custom crest** feature

**Custom Crest (Prestige 10 only)**: Hall of Fame users can set a custom crest (emoji or image URL, max 500 chars) via `PUT /api/users/me/crest`. The crest appears on their leaderboard entry, profile page, and DM header. Non–Hall of Fame users calling this endpoint receive a 403.

**Legacy Score**: Accumulated across all Prestige cycles; never resets; displayed with a ⚜️ icon on profile and leaderboard. The Hall of Fame table (`hall_of_fame`) records the user's legacy score at induction time.

### Creator Economy

Creators (marked `is_creator = true`) earn revenue from:
- Room entry fees (paid rooms)
- Gifts received in their rooms (80% to creator, 20% to platform; **85% for Zobia Icon tier** or Creator Track Level 50 unlock)
- Paid content subscriptions

Revenue accrues to `creator_earnings`. The daily CRON (on payout day) checks creators above the minimum payout threshold (default: ₦5,000 via Paystack). Creators above the manual-approval threshold (default: ₦100,000) require admin approval before disbursement. Completed payouts record to `creator_payouts`.

**Creator Fund (monthly):** The platform sets aside 5% of advertising revenue each month into the Creator Fund. On the **1st of each month**, the daily CRON seeds the fund pool by reading `ad_revenue_YYYY_MM_kobo` from `x_manifest` and writing 5% to `creator_fund_balance_kobo`. On the **5th of each month**, the daily CRON distributes the pool to eligible creators (Elite tier+) proportional to their engagement score, then resets the pool to 0. During **International Women's Month** (first week of March), female creators receive a 1.5× boost to their Creator Fund allocation.

**RIZE Coin conversion (PRD §14):** Instead of a bank payout, creators can request `asCoins: true` when calling `POST /api/creator/payouts`. The net earnings are converted to Credits at the admin-configurable `kobo_per_coin` rate (default 100 kobo = 1 Credit) and credited to the creator's wallet in the same atomic transaction.

**Room capacity gates by Creator Track level:** Creators below Level 5 can create rooms with up to 50 members. Reaching Level 5 raises the cap to 100 (Room Opener milestone). Reaching Level 20 removes the cap entirely (rooms can grow to the platform maximum).

### Social Graph

- **Friends**: Bilateral friendship requests. Stored in `friendships`. Friend list visible on profile.
- **Follows**: Unilateral following. Stored in `follows`. Used for feed curation and notification preferences.
- **Mutual follows** appear in suggestions.

The Friends page (`/friends`) has three tabs:
1. **My Friends** — accepted friendships with quick Remove action.
2. **Requests** — split into two sub-tabs:
   - **Received** — incoming pending requests; Accept / Decline buttons.
   - **Sent** — outgoing pending requests; Withdraw button (calls `DELETE /api/friends/[id]`). Sent requests fetched from `GET /api/friends/requests/sent`.
3. **Discover** — suggested users to add.

Count badges on the Received and Sent sub-tabs show pending counts at a glance.

### Profile Privacy

Users can control the visibility of their profile through three privacy settings, each gated to specific plans/ranks:

| Setting | Default gate | What it does |
|---|---|---|
| **Private Profile** | Pro / Max / Prestige 1+ | Hides the profile entirely from non-friends (returns 403) |
| **Hide profile sections** | Plus / Pro / Max / Prestige 1+ | Removes individual sections (avatar, bio, rank, xp, guild, seasons, badges) from the non-owner view |
| **Disable friend requests** | Plus / Pro / Max / Prestige 1+ | Prevents the "Add Friend" button appearing on the user's profile |

Settings are stored as three columns on the `users` table:
- `profile_private` — BOOLEAN
- `profile_hidden_sections` — JSONB array of section keys
- `disable_friend_requests` — BOOLEAN

**Enforcement** happens in `GET /api/users/[userId]/profile`:
1. If the profile owner is banned → 403 `ACCOUNT_RESTRICTED`.
2. If the profile owner is suspended → 403 `ACCOUNT_SUSPENDED`.
3. If `profile_private = true` AND the viewer is not a confirmed friend AND the viewer is not the owner AND the viewer is not an admin → 403 `PROFILE_PRIVATE`.
4. For non-owners, fields listed in `profile_hidden_sections` are stripped from the response.

**User control** via `PATCH /api/users/me/privacy` — only toggles the user is eligible for (based on plan/prestige) are accepted. Eligibility is checked server-side against `x_manifest` flags.

**Admin control** — the admin panel page at `/admin/settings/privacy` lets admins configure which plans and prestige ranks can access each privacy feature. The four configurable flags stored in `x_manifest`:

| Key | Default |
|---|---|
| `privacy_can_lock_profile` | `["pro","max","prestige_1"]` |
| `privacy_can_hide_sections` | `["plus","pro","max","prestige_1"]` |
| `privacy_can_disable_friend_requests` | `["plus","pro","max","prestige_1"]` |
| `privacy_hideable_sections` | `["avatar","bio","rank","xp","guild","seasons","badges"]` |

Changes take effect within 60 seconds (Redis cache TTL).

### Profile Components (PRD §15)

- **Creator Card**: When `is_creator = true`, the profile shows the creator's primary room (highest-member-count), member count, and total earnings (own profile only, for privacy).
- **Public Achievements Wall**: Up to 12 lifetime `user_badges` displayed as amber chips with earned-date tooltips.
- **Connection Badge**: If the viewer and profile user have a `dm_conversations.conversation_score ≥ 7`, a badge appears (Connected = 7 days, Gold Connection = 14 days, Platinum Bond = 30 days).
- **Legacy Score**: Accumulated across all Prestige cycles; displayed with a ⚜️ icon.

### Guild Treasury (PRD §13)

Legend-tier guilds earn a 5% share of credit gift values sent in rooms where their creator-members are active. Each qualifying gift atomically increments `guilds.treasury_balance` and appends a `guild_treasury_log` row with `source = 'room_revenue_share'`. The treasury balance is visible to guild members and spent via future guild upgrades.

### Ad Revenue Share (PRD §10)

Free Open Rooms with 500+ monthly active users (MAU) are automatically enrolled in the ad revenue share programme on the 1st of each month. The daily CRON:
1. Counts distinct members active in each room during the prior month and upserts a snapshot into `room_monthly_active_users`.
2. Sets `rooms.is_ad_enrolled = TRUE` for any room reaching the threshold and sends the creator an `ad_revenue_enrolled` notification.
Once enrolled, future revenue from the in-room AdMob/ad network is shared with the creator at the admin-configured rate.

### Nemesis System

Every week, each user can be assigned a Nemesis: another user within 10% of their XP on their highest active track. The algorithm prefers users in the same city, excludes mutual friends. The Nemesis is displayed on the home screen with an XP delta. Notifications fire when the Nemesis overtakes the user or falls behind. A **Challenge** button starts a 7-day XP sprint between the two users.

### Elder System

The Elder is the highest-XP user in a given city. The Elder badge appears on their profile and in the city leaderboard. The Elder title changes whenever the city leaderboard rank-1 changes.

### Platform Council

A small group of top users (selected by trust score + XP) who can vote on policy questions raised by the admin team. Council membership is updated weekly.

### Referral System

Each user gets a unique referral code after onboarding. Sharing `?r=<code>` when a new user signs up creates:
- **Tier 1 referral**: The referrer earns coins + XP when the new user qualifies (completes first action).
- **Tier 2 referral**: If the referrer was themselves referred, the original referrer also earns a smaller bonus.

Referral stats are visible at `/api/referrals`.

### Notifications

In-app notifications stored in the `notifications` table. Notification types include: guild war updates, nemesis rank changes, leaderboard rank changes, quest completions, friend activity, DM received, gift received, streak milestones, and season events. Telegram bot notifications are sent for high-priority events if the user has linked their Telegram account (`telegram_id` on users table).

### Deep Links

All deep-linkable routes are defined in `lib/deeplinks/routes.ts` — the single source of truth. Universal links via Android App Links use `/.well-known/assetlinks.json`. Referral links use `?r=<referralCode>`. Notification taps carry a route payload that maps to the correct screen via the deep link router.

---

## Admin Features

The admin panel is available at `/admin` and is protected by `is_admin = true` in the database (not just the JWT — every admin route calls `withAdminAuth` which re-checks the database).

### Dashboard Overview (`/api/admin/overview`)
Daily/weekly/monthly active users, new registrations, revenue totals (today / week / month), active rooms, active guilds, and moderation queue depth.

### Financial Monitoring (`/api/admin/financial`)
Transaction volume, creator payout pipeline status, pending payouts awaiting approval, payment provider health, credit/star ledger summaries.

### User Management (`/api/admin/users`)
Search, view, suspend, ban, or restore any user. View user's XP history, credit ledger, quest history, guild membership, and reports filed against them.

All moderation actions are performed via `POST /api/admin/users/:userId/actions` and are logged atomically to the `admin_actions` audit table. Supported actions:

| Action | Description |
|---|---|
| `suspend` | Temporarily suspend account for `duration_hours` hours. Invalidates all sessions immediately. |
| `ban` | Permanently ban account. Invalidates all sessions immediately. |
| `restore` | Lift a suspension or ban. |
| `upgrade_moderator` | Grant moderator role to account. |
| `downgrade_moderator` | Revoke moderator role. |
| `reset_password` | Null out password hash, generate a 1-hour reset token, send reset link to user's email. Invalidates all sessions. |
| `force_2fa` | Clear existing TOTP secret, set `require_2fa_setup = true` so the user must configure 2FA on next login. Invalidates all sessions. |
| `verify_account` | Manually mark the account's email as verified. |

Admins cannot action their own account or any other admin account. All actions are append-only in the audit log (no delete or update endpoints exist).

### Content Moderation (`/api/admin/moderation`)
View AI-classified reports queue. Accept or reject AI decisions. Bulk-action common violation types. View moderation history per user.

### Automated Actions Log
All automated moderation actions (auto-hide, auto-suspend triggered by trust score drop) logged with AI confidence score and DeepSeek/Gemini classification category.

### Feature Flags (`/api/admin/config`)
All `x_manifest` keys are editable from the admin panel. Changes take effect within seconds via Redis cache invalidation. Feature flags include: rooms enabled, DMs enabled, live streaming, AI assistant, marketplace, gifts, rankings.

### Configuration (x_manifest)
Admin-editable app-level settings: payment provider selection, max file upload size, rate limit thresholds, payout minimum thresholds, moderation settings.

### Admin Messaging (`/api/admin/messages`)
Send broadcast messages to all users or to a filtered segment (by city, plan, or trust score range).

### Announcement Modals and Banners
`announcement_modals` — full-screen overlays shown once per user. `announcement_banners` — dismissable top-of-screen banners. Both support scheduling (active_from / active_until).

### Footer Scripts
Inject custom `<script>` tags via `footer_scripts` table — for analytics, pixel tracking, or A/B tools. Managed from the admin panel, served by the layout on each page load.

### Alerts (`/api/admin/alerts`)
System alerts for: low payout balance, AI provider failure, CRON failure, moderation queue spike. Each alert can be resolved by an admin with an optional note.

### Android Admin Mirror
A read-only admin dashboard view available in the Expo app for admins, showing the same metrics as the web panel without write access.

---

## Technical Architecture

### XP Engine

Location: `lib/xp/engine.ts`

All XP values and multipliers are defined here — never inline at call sites.

Calculation flow:
1. `calculateXPForAction(action)` returns the **base XP** for the action type.
2. `applyMultipliers(baseXP, ctx)` applies the multiplier stack:
   - Plan multiplier (free=100bp, plus=110bp, pro=125bp, max=150bp)
   - Guild tier bonus (read from `getGuildXPBoostPercent(guildTier)`)
   - Season pass bonus (read from active season config)
   - Active booster (per-user temporary multiplier stored in Redis)
3. All multipliers are whole-number basis points (100bp = 1.0×). Integer division is used throughout — no floating-point values enter or exit the engine.
4. Minimum award when base > 0 is 1 XP.
5. The result is written to `xp_ledger` and added to `users.xp_total` and the relevant track column.

### Coin Ledger

`coin_ledger` is **append-only** — rows are never updated or deleted. This preserves a complete audit trail of every coin credit and debit.

Race condition prevention: every debit uses `SELECT ... FOR UPDATE` on the `users` row to lock it before reading `coin_balance`. This prevents two concurrent requests from reading the same balance and both believing there are sufficient funds.

Floating-point precision: all coin values are stored as `BIGINT` (smallest unit, like kobo/cents). The application layer uses `Decimal.js` for any arithmetic before writing to the database. This prevents the floating-point drift that would occur with JavaScript `number` arithmetic on large values.

Atomicity: every debit operation pairs the `UPDATE users SET coin_balance = ...` with an `INSERT INTO coin_ledger ...` inside a single database transaction. If either fails, both roll back.

### Payout Pipeline

**Account Setup:**
- *Nigeria:* Creator adds a bank account via a two-step Paystack verify-and-confirm flow. `GET /bank/resolve` returns the account name from Paystack; the creator confirms and `POST /api/creator/bank-account` (with `confirmed: true`) calls `createTransferRecipient` to generate a `recipient_code`, which is stored encrypted in `creator_bank_accounts`. The account number is separately encrypted with AES-256-GCM via `encryptField`.
- *Global:* Creator provides a Tron (TRC20) wallet address, which is validated (34 chars, starts with 'T') and stored encrypted in `creator_wallet_addresses`.

**Payout Request (`POST /api/creator/payouts`):**
1. Creator selects a method: `bank_transfer` (Nigeria only), `coins`, or `crypto`.
2. The manifest is checked to confirm the method is enabled for the creator's region (`users.country`).
3. For `bank_transfer`: the current `creator_bank_accounts` row is loaded and a snapshot `{ bank_name, account_name, last4, recipient_code }` is stored as JSONB in the payout record. Subsequent bank account changes do not affect this payout.
4. For `crypto`: the wallet address is loaded and stored (encrypted) as `wallet_address_snapshot`.
5. Three fraud checks run in parallel: new-account gift inflow, payout velocity (>3 requests in 24h), and trust score gate (<30). Any flag forces `awaiting_approval` status and creates a `system_alerts` record.
6. For `coins`: immediate `creditCoins()` call inside a transaction; status set to `completed`.
7. For `bank_transfer` in auto-approve mode: status set to `pending` (CRON picks it up). In manual mode: `awaiting_approval`.
8. For `crypto`: always `awaiting_approval` (manual admin processing).
9. `available_earnings_kobo` deducted atomically inside a `db.transaction()`.

**CRON Batch Processing (`POST /api/cron/payouts`, every 30 min):**
- Phase 1: SELECT up to `payout_batch_size` records with `status = 'pending'` AND `payout_method = 'bank_transfer'`, ordered by `created_at ASC`.
- For each: call `paystack.initiateTransfer(netKobo, recipientCode, reference)` using the snapshot's `recipient_code`.
- On success: `status → 'processing'`, store `transfer_code` as `provider_reference`.
- On failure: increment `retry_count`, set `next_retry_at` using exponential backoff (5 min → 15 min → 45 min).
- Phase 2: SELECT records with `status = 'failed'` AND `next_retry_at <= NOW()` AND `retry_count < max_retries`; re-attempt transfer.
- After `payout_max_retries` (default 3) failures: move to `payout_dead_letter_queue`, restore `gross_kobo` to creator's `available_earnings_kobo`, notify creator and create admin `system_alert`.

**Paystack Webhook (`POST /api/economy/webhooks/paystack`):**
- `transfer.success` → payout status `completed`, creator notified.
- `transfer.failed` → retry logic or DLQ (same as CRON failure path).
- `transfer.reversed` → payout status `reversed`, `gross_kobo` restored to creator's `available_earnings_kobo`, creator notified.

**Manual Mode (Nigeria) / Global crypto:**
Admin reviews payouts in the admin panel. For bank transfers: Approve → status `pending` (CRON processes). Admin can also manually advance status: `processing → completed/failed`. For crypto: Approve → admin sees the decrypted wallet address snapshot and manually sends USDT; then marks `completed` via the status PATCH endpoint.

**Appeal Pipeline:**
Creator can submit `POST /api/creator/payouts/:id/appeal` with a written reason for rejected payouts. Admin reviews in `/admin/payouts/appeals`. Approving re-opens the payout; dismissing closes the appeal. Both notify the creator.

**The 80/20 split** (80% to creator, 20% platform) is applied at the `creator_earnings` record level. Zobia Icon tier creators and those with the Creator Track L50 unlock receive an 85% split.

### Virtual Economy — Premium Send (PRD §11)

Premium Send is a purchasable booster that adds a gold-shimmer animation to a message. Two tiers:
- **One-shot** (`premium_send`): 50 Credits. Activates for the next message. Multiple one-shots can be queued (they stack; the next send consumes one activation from `user_xp_boosters`).
- **7-Day Pass** (`premium_send_7day`): 250 Credits. All messages for 7 days carry the premium animation. Cannot be stacked.

Both are purchasable via `POST /api/economy/boosters` with `boosterType: "premium_send"` or `"premium_send_7day"`. The message send handler checks for an active `premium_send` or `premium_send_7day` booster before attaching the animation metadata.

### Generosity Track L40 Coin Purchase Bonus (PRD §7)

When a user who has reached the Generosity Track L40 Philanthropist milestone purchases credits (via Paystack or DodoPayments), `getCoinPurchaseBonus()` is called and a 5% bonus credit amount is credited in the same transaction. The bonus is recorded as a separate ledger entry with `type = 'philanthropist_bonus'` for auditability.

### AI Moderation Pipeline

1. A user report is submitted → record created in `reports` with status `pending`.
2. DeepSeek classifier is called with the reported content (sandboxed from system instructions — user content is passed as a separate `user` role message, never interpolated into the system prompt).
3. DeepSeek returns: category (spam / hate / nsfw / misinformation / harassment / ok) + confidence score.
4. If DeepSeek fails 3 consecutive times (HTTP error or timeout) → circuit breaker trips → Gemini fallback is called.
5. If both fail → report remains `pending`, admin alerted via `system_alerts`.
6. AI result stored on the report record. Human moderators review high-confidence cases flagged for action.
7. Low-confidence cases (below the `x_manifest` threshold) are always routed to human review.

### CRON Architecture

**Vercel Hobby (1 daily CRON)**
- Configured in `apps/web/vercel.json`: `/api/cron/daily` at `0 0 * * *` (midnight UTC).
- Handles: daily quest reset, login streak updates, re-engagement checks (3/7/14/30/90-day inactivity), nemesis refresh (Sundays), season transitions.

**cron-jobs.org (sub-daily jobs)**
- `/api/cron/guild-wars` — every 1 hour: Final Hour transitions, war resolution.
- `/api/cron/leaderboards` — every 15 minutes: snapshot upserts, rank-change notifications.

All CRON handlers:
1. Require `Authorization: Bearer <CRON_SECRET>` — return 401 otherwise.
2. Are idempotent — safe to re-run if a previous run was interrupted.
3. Log failures to Redis (`cron_failure:<handler>:<date>`) for the admin alert system.
4. Return structured JSON with counts of actions taken and any errors encountered.

**Message History Enforcement (Step 23 of daily CRON)**

Plan-based message retention limits are enforced nightly:
- **Free plan**: Messages older than 90 days are permanently deleted.
- **Plus plan**: Messages older than 180 days are permanently deleted.
- **Pro / Max plan**: No deletion — unlimited history.

Deletion is batched by joining `messages` against the sender's subscription plan. Results (`freeDeleted`, `plusDeleted`) are included in the CRON response JSON for monitoring.

### Offline Sync

**Web (Service Worker + IndexedDB)**
- A Service Worker caches the app shell (HTML, CSS, JS) for instant load.
- `offline.html` is served as the navigation fallback when the network is unavailable.
- Recent messages, the user's profile, and the active quest deck are stored in IndexedDB.
- Outgoing messages composed while offline are saved to IndexedDB with status `pending_sync`.
- On reconnect (`online` event), the client flushes the IndexedDB queue to the server API.
- Stale-while-revalidate strategy: cached data is shown immediately while a fresh fetch runs in the background.

**Android (MMKV + Expo SQLite)**
- MMKV provides ultra-fast synchronous key-value storage for session tokens, user preferences, and feature flags.
- Expo SQLite stores structured offline data: recent message threads, the quest deck, and cached profile data.
- Same sync-on-reconnect pattern: NetInfo `addEventListener` fires the sync when connectivity is restored.
- Offline messages have a 72-hour TTL in SQLite. Messages older than 72 hours that never synced are dropped with a "message not sent" notice displayed to the user.

### JWT + Redis Session System

1. **Login** → backend issues two tokens:
   - **Access token** (JWT, 15-minute TTL) signed with `JWT_SECRET`. Stored in HttpOnly cookie (web) or Expo SecureStore (Android).
   - **Refresh token** (JWT, 30-day TTL) signed with `JWT_REFRESH_SECRET`. Stored in Redis under key `session:<refreshToken>` with a 30-day expiry, and in the `sessions` table for auditability.
2. **API call with valid access token** → validates JWT → proceeds.
3. **API call with expired access token + valid refresh token** → backend validates refresh token against Redis key → issues new access token → returns both to client.
4. **Logout** → deletes the Redis `session:*` key → immediate invalidation. The old access token will still parse as valid until its 15-minute TTL expires, but the refresh token can no longer be used to extend sessions.
5. **Ban or suspension** → admin action deletes all `session:*` keys for the user → all devices logged out immediately, without waiting for JWT expiry.
6. **Admin sessions** → separate shorter-lived JWT (5-minute TTL), re-verified against `is_admin` in the database on every admin route call.

### Database Provider Abstraction

`DATABASE_PROVIDER` env var → `lib/db/index.ts` reads it and returns the correct `DatabaseAdapter` singleton. All queries in business logic call `db.query()` or `db.transaction()` — never a provider-specific SDK.

An ESLint rule flags any direct import of `@supabase/supabase-js` or provider-specific modules from business logic files. Only the adapter file in `lib/db/providers/` may import provider SDKs.

Switching providers requires only changing `DATABASE_PROVIDER` and redeploying. Data migration (pg_dump/restore) is a separate, manual step.

**`db.query<T>` type parameter:** The generic `T` on `DatabaseAdapter.query<T>` (defined in `lib/db/interface.ts`) defaults to `Record<string, unknown>`. Provider implementations use `T & Record<string, unknown>` internally when calling the underlying `pg` driver (which requires `T extends QueryResultRow`), then cast the result back to `T[]`. This means call sites can pass any interface as the type parameter — they are not required to extend `Record<string, unknown>` themselves.

```typescript
// Correct — interface does not need to extend Record<string, unknown>
interface UserRow { id: string; username: string; }
const { rows } = await db.query<UserRow>('SELECT id, username FROM users WHERE id = $1', [userId]);
```

### Shared Type Package (`@zobia/types`)

Cross-cutting domain types (plans, ranks, XP actions, ledger entries, etc.) live in `shared/types/index.ts` and are imported via the `@zobia/types` alias, which is configured in `apps/web/tsconfig.json`:

```json
"@zobia/types": ["../../shared/types/index.ts"]
```

Add new domain-wide types to `shared/types/index.ts`, not to individual feature files. If a type is only used within one feature (e.g. a specific API route's response shape), keep it local.

**`CoinTransactionType`** — the full union of valid coin ledger transaction types is maintained in `shared/types/index.ts`. When adding a new coin operation, add its type string to this union; the TypeScript compiler will catch any call sites that pass a string not in the union.

### Rate Limiting

Rate limit options are specified with `lib/security/rateLimit.ts`'s `RateLimitOptions` interface:

```typescript
interface RateLimitOptions {
  limit: number;      // max requests allowed in the window
  windowMs: number;   // window duration in milliseconds
  name: string;       // identifier used in Redis key prefix and error messages
}
```

Pre-built presets are exported as `RATE_LIMITS` (e.g. `RATE_LIMITS.auth`, `RATE_LIMITS.apiWrite`). For custom limits, construct `RateLimitOptions` directly — use `limit` (not `max`) and `windowMs` (not `windowSeconds`).

### Presence Keys

The Redis key used for user presence (`presence:online:<userId>`) is defined in `lib/presence/keys.ts` and imported from there by both `app/api/presence/route.ts` and `app/api/presence/[userId]/route.ts`.

> **Note:** Next.js route files may only export HTTP method handlers and a small set of route-config constants (`dynamic`, `revalidate`, etc.). Any shared helper used by multiple route files must live in `lib/`, not in a route file, even if logically related.

### `useSearchParams` and Suspense

Pages that call `useSearchParams()` must be wrapped in a `<Suspense>` boundary; otherwise Next.js cannot statically generate the page and the build fails. The pattern used in this project:

```tsx
// Split into an inner component that uses the hook…
function PageContent() {
  const searchParams = useSearchParams();
  // …
}

// …and an outer default export that wraps it in Suspense
export default function Page() {
  return (
    <Suspense>
      <PageContent />
    </Suspense>
  );
}
```

This applies to any `"use client"` page that reads search params. Examples in this codebase: `app/auth/login/page.tsx`, `app/(app)/wallet/page.tsx`.

### Auth System

**No Supabase Auth anywhere.** All auth is platform-managed.

- **Google OAuth**: Frontend redirects to Google → Google calls `/api/auth/google/callback?code=...` → backend exchanges code for Google tokens → backend verifies Google ID token → creates or retrieves Zobia user by `google_id` → issues Zobia JWT pair.
- **Telegram Login**: Telegram Login Widget posts data to `/api/auth/telegram` → backend performs HMAC-SHA256 verification using the bot token as key → creates or retrieves user by `telegram_id` → issues JWT pair.
- **JWT validation**: `lib/auth/jwt.ts` using the `jose` library. No third-party auth SDK.

### Deep Link Structure

All deep-linkable routes are defined in `lib/deeplinks/routes.ts` — the **single source of truth**. No hardcoded paths exist in notification code or anywhere else.

Universal links via Android App Links: `/.well-known/assetlinks.json` lists the app's SHA-256 certificate fingerprint. Android verifies this at install time so `https://zobia.social/profile/username` opens the app rather than the browser.

Referral format: `?r=<referralCode>` — alphanumeric code stored on the user's row.

Notification tap targets: each notification `payload` contains a `deepLink` field (e.g. `/guilds/<id>/war/<warId>`) resolved by the deep link router on the client.

### Guild War Engine

Location: `lib/guilds/warEngine.ts`

1. **Declaration**: A guild captain declares war → `findWarOpponent()` searches for guilds within ±15% XP of the declaring guild, same tier preferred, no active war against each other, cooldown of 72 hours respected.
2. **Active phase (48 hours)**: All member activity earns War Points. `calculateWarPoints(activity, isFinalHour)` returns points; during the Final Hour the multiplier is `FINAL_HOUR_MULTIPLIER = 2`.
3. **Final Hour**: When `ends_at - 1 hour ≤ now`, the hourly CRON transitions the war to `final_hour` status and notifies all members.
4. **Resolution**: When `ends_at < now`, the hourly CRON calls `resolveWar(db, warId)`. The engine:
   - Determines the winner (higher total war points).
   - Calls `distributeWarRewards()` to distribute XP + credits to winning guild members by contribution rank.
   - Awards a Rematch Token to the losing guild captain.
   - Updates `guilds.wars_won` / `wars_lost`.
5. All war calculations use integer arithmetic. No floating-point values.

### Season System

Seasons are 8-week cycles defined in the `seasons` table. The Season Engine (`lib/seasons/seasonEngine.ts`) manages:
- Phase detection based on current week within the season.
- Season Pass reward tier checks (free vs paid).
- End-of-season reward distribution (credits, cosmetics, prestige points for top-ranked users).
- Season transition (closing the old season, opening the new one).

At season end: competitive rankings reset. Track XP, credits, friends, and history are **not** reset.

### Nemesis System

Location: `lib/nemesis/nemesisEngine.ts`

Weekly assignment algorithm:
1. For each user, find their highest active XP track.
2. Query users within 10% XP of the requesting user on that track.
3. Filter: prefer same city, exclude mutual friends, exclude current Nemesis.
4. Assign the closest match. Store in `nemesis_assignments`.

The home screen shows the XP delta between the user and their Nemesis. Notifications are sent when:
- The Nemesis overtakes the user's XP.
- The user overtakes the Nemesis's XP.

A 7-day XP sprint challenge can be initiated via the **Challenge** button, which creates a temporary head-to-head leaderboard between the two users.

---

## Edge Cases

**User suspended mid-war**
War points stop accumulating for the suspended user's guild. The guild still competes with remaining active members. When the suspension ends, the user resumes accumulating war points (if the war is still active).

**Payout account low**
If the platform's payment provider balance falls below the `payout_low_balance_alert_kobo` threshold in `x_manifest`, the admin alert system fires a `payout_low_balance` system alert. Payouts are queued but not processed. Admin tops up the account → the queue processes on the next CRON run or manual trigger.

**AI provider failure**
The circuit breaker counts consecutive failures per provider. After 3 failures, the router switches to the fallback provider. If both DeepSeek and Gemini are failing, the report is held in `pending` status and a `ai_provider_failure` system alert fires. Human moderators can process the backlog manually. The circuit breaker resets after a configurable cool-down period.

**CRON failure**
CRON failures are caught, logged to Redis (`cron_failure:<handler>:<date>`), and trigger a `cron_failure` system alert. The daily quest deck rollover is designed to be safe to apply late: if the CRON runs at 1:00 AM instead of midnight, it detects which users need their deck reset and applies it. Partial runs (e.g. CRON hit a timeout at user #5000 of 10000) are handled by idempotent checks — already-reset users are skipped on re-run.

**Database provider switch**
1. Change `DATABASE_PROVIDER` env var to the new provider.
2. Redeploy.
3. The ESLint rule enforces that no Supabase-specific SDK calls leak into business logic — the abstraction holds.
4. Data migration is a **separate manual step**: `pg_dump` from old provider, `psql` restore to new provider. The app itself has no migration automation for provider switches.

**Offline messages fail to sync**
Messages saved to IndexedDB (web) or SQLite (Android) while offline are retried on each app open and on `online` events. If a message is older than 72 hours and has not been acknowledged by the server, it is dropped from local storage and a "message not sent" notice is displayed in the conversation thread. The user can manually retry by re-typing the message.

**Referral code collision**
The onboarding flow generates a referral code and immediately checks for uniqueness (`SELECT EXISTS ... WHERE referral_code = $1`). On collision, it appends a suffix character and retries. Collisions are expected to be extremely rare given the code space.

**Leaderboard tie**
`upsertLeaderboardSnapshot` uses a `COUNT(*)` of users with higher XP to calculate `rank_position`. Tied users receive the same rank position. The next rank is offset by the number of tied users (standard competition ranking: 1, 1, 3, 4...).

**Duplicate daily login claim**
The Redis key `daily_login:<userId>:<YYYY-MM-DD>` prevents double-awards within the same calendar day. The `/api/login/daily` endpoint is idempotent — if the key exists, it returns the current streak without re-awarding XP and includes `alreadyClaimedToday: true` in the response.

---

## Testing

### E2E Tests (Playwright)

Located in `e2e/`. Covers all 11 PRD-required user journeys:
- Authentication (register, login, logout, Google OAuth)
- Direct messages (credit cost, anti-spam, gift-them-credits flow)
- Economy (credit purchase, transfer, gift items)
- Rooms (create, join, VIP gate, gift in room)
- Guilds (create, join, declare war, resolve war)
- Leaderboards (global, city, track-specific)
- Referrals (code sharing, tier-1 + tier-2 attribution)
- Creator payouts (request, auto-approve, manual-approve threshold)
- Suspension (admin suspend, session invalidation, restore)
- Season reset (end-of-season competitive reset, track preservation)
- Admin (user management, moderation, financial dashboard)

Run: `cd apps/web && npx playwright test`

### Unit Tests (Jest)

Located in `apps/web/lib/**/__tests__/`. Covers:
- XP engine: all action types, multiplier stack, track attribution
- Coin ledger: credit/debit invariant, `SELECT FOR UPDATE` race guard, append-only
- Financial integrity: transfer fee math (5% floor), insufficient-balance rejection
- Concurrency: sequential credit/debit chain integrity, balance roundtrip
- Creator payouts: 80/20 split, minimum threshold, manual-approval threshold, tier distribution
- Guild wars: war points calculation, Final Hour multiplier, reward distribution
- Season engine: phase detection, pass milestones, end-of-season reset

Run: `cd apps/web && npx jest`

### Load Tests (k6)

Located in `load-tests/`. All scenarios target a staging environment.

| File | Scenario | VUs | Duration |
|---|---|---|---|
| `room-feed.js` | Room discovery feed under load | 1000 | 5 min |
| `guild-war-final-hour.js` | Final Hour simultaneous war point submissions | 500 | 10 min |
| `cron-daily-reset.js` | Daily CRON handler under concurrent requests | 500 | 3 min |
| `daily-login.js` | Daily login endpoint burst | 500 | 5 min |

Run: `k6 run load-tests/room-feed.js --env BASE_URL=https://staging.zobia.app`

### Security / Penetration Tests

Located in `security-tests/`. Covers OWASP Top 10 and platform-specific threats:

| File | Coverage |
|---|---|
| `auth.security.test.ts` | JWT tampering, algorithm confusion (alg:none), brute-force rate limiting |
| `injection.security.test.ts` | SQL injection, XSS in profile fields, SSRF via URL params, NoSQL operators |
| `idor.security.test.ts` | Profile/message/payout IDOR, admin route access by regular users |
| `economy.security.test.ts` | Negative/zero/float/overflow amounts, double-spend race condition |
| `admin.security.test.ts` | Privilege escalation, self-action protection, audit log immutability |
| `ratelimit.security.test.ts` | Login/transfer/report burst 429 enforcement, Retry-After header |

Prerequisites: running dev server + env vars `SECURITY_TEST_BASE_URL`, `SECURITY_TEST_USER_TOKEN`, `SECURITY_TEST_ADMIN_TOKEN`, `SECURITY_TEST_USER_ID`, `SECURITY_TEST_OTHER_USER_ID`.

Run: `cd apps/web && npx jest --testPathPattern="security" --runInBand`

---

## Push Notification System

### Server-Side Delivery

The server sends push notifications via `apps/web/lib/notifications/push.ts` using the Expo Push API (`https://exp.host/--/api/v2/push/send`).

Notifications are sent:
- **Guild War Final Hour** — to all guild members when 60 minutes remain.
- **Mystery XP Drop** — fired when the CRON dispatches a random drop.
- **Leaderboard ripple** — when a user's rank changes while they are offline.
- **Nemesis overtake** — when the Nemesis pulls ahead or the user overtakes them.
- **Friend gift** — when a friend sends a gift.
- **Season reset (24h)** — reminder before competitive season closes.
- **Re-engagement sequences** — at 3, 7, 14, 30, and 90 days of inactivity.

Notification priority levels:
- `high` — sound + banner (Guild War Final Hour, Mystery XP Drop, gifts).
- `normal` — sound + banner (general social notifications).
- `low` — silent badge-only (weekly contribution scores, non-urgent nudges).
- `silent` — no sound or visual interruption (background data updates).

### Client-Side Setup (Expo)

On first authenticated load, the Expo app:
1. Checks if running on a physical device (`expo-device`).
2. Requests permission via `expo-notifications.requestPermissionsAsync()`.
3. Calls `expo-notifications.getExpoPushTokenAsync()` to retrieve the unique device token.
4. Registers the token with `POST /api/users/push-token` (stored in `user_push_tokens` table).

Notification tap handling routes users to the deep-link `action` field attached to each notification payload (e.g. `/guild/wars/[warId]`, `/leaderboards`, `/profile/[userId]`).

---

## Community Notes

Community Notes is an admin-toggleable crowdsourced fact-checking feature (PRD §19, Layer 2 moderation).

### How It Works

1. Any user can submit a note on flagged content (messages, rooms, profiles, guilds).
2. The community votes notes as "Helpful" or "Not Helpful."
3. Notes with a sufficient ratio of helpful votes gain `visible` status and appear alongside the original content.
4. Admin moderators can review and remove notes via the admin panel.

### Feature Flag

Controlled by `community_notes_enabled` in the x_manifest / admin feature flags panel. Default: enabled.

When disabled, the web page at `/community-notes` shows a "Feature Unavailable" notice. The API returns 403.

### API Routes

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/community-notes` | List notes, filterable by status |
| POST | `/api/community-notes` | Submit a new note |
| POST | `/api/community-notes/[noteId]/vote` | Vote helpful or unhelpful |

---

## Gift Spectacle Threshold

Each room creator can set a minimum gift value (coins) required to trigger the full room-wide spectacle animation (PRD §12).

- The spectacle animation dims the message feed for 3 seconds and plays the gift emoji prominently.
- High-value gifts (Tier 2+) always trigger spectacle when no threshold is set.
- Creators set the threshold via the "🎁 Spectacle Threshold" panel in the room sidebar.
- Stored in `rooms.spectacle_threshold_coins`. `NULL` = use gift item's default.
- API: `PUT /api/rooms/[roomId]/spectacle-threshold` with `{ thresholdCoins: number | null }`.

---

## Gift Messages in DMs

When a user sends a gift to another user via `POST /api/economy/gifts/send` (without a `roomId`), the gift:

1. Debits coins from the sender atomically (80/20 or 95/5 split depending on whether recipient is a creator).
2. Credits the recipient's coin balance.
3. **Creates a DM message** with `message_type = 'gift'` so it appears in the conversation feed.
4. Upserts the `dm_conversations` record to ensure the conversation is trackable.

The gift message displays as a special bubble (`🎁 Gift Name (X coins)`) in both sender's and recipient's DM view.

---

## "Gift Them Coins" Flow

When a user does not have enough coins to reply to a DM, the conversation screen shows:

> "Not enough coins to reply. **Gift them coins →**"

Tapping "Gift them coins" opens the **Coin Transfer** flow (not the gift item flow):
- **Web:** Routes to `/wallet?transfer=[userId]` which opens the CoinTransferPanel.
- **Expo:** Routes to `/economy/wallet` with `transfer=[userId]` param.

This allows the current user to send raw coins to the recipient so they can reply.

This allows the current user to send raw coins to the recipient so they can reply.

---

## Flash XP Event Scheduling (PRD §2.4, §8, §25)

Flash XP events follow a two-phase lifecycle managed by the hourly CRON (`GET /api/cron/guild-wars`):

### Phase 1 — Announcement (6-hour advance notice)

When an event's `announced_at` timestamp is reached and `announcement_notification_sent = FALSE`, the CRON:

1. Atomically marks the event as `announcement_notification_sent = TRUE`.
2. Inserts a `flash_xp_announced` in-app notification for all users active in the last 30 days.
3. The notification body tells users a Double XP event is happening *sometime before* the window closes — the exact fire time is never disclosed.

**Admin creates events** via `POST /api/admin/flash-xp` with:
- `announced_at` — when to send the 6-hour advance notification
- `fires_at` — the actual (secret) fire time (must be ≥ 6 hours after `announced_at`)
- `ends_at` — when the XP multiplier deactivates

The 6-hour minimum gap is enforced server-side (returns 400 if violated).

### Phase 2 — Firing (unannounced moment within the window)

When `fires_at <= NOW()` and `fired = FALSE`, the CRON:

1. Atomically marks the event as `fired = TRUE`.
2. Inserts a `flash_xp_live` high-urgency notification for all users active in the last 7 days.
3. The XP award route (`POST /api/xp/award`) checks `flash_xp_events` for any row where `fired = TRUE AND fires_at <= NOW() AND ends_at > NOW()` and applies the multiplier.

The admin controls the exact fire time — from the user perspective, it fires "at a random moment" within the announced window.

---

## Admin: Sponsored Quest Marketplace (PRD §14)

The Sponsored Quest Marketplace has two separate API surfaces:

### Brand / Admin side — `GET|POST /api/admin/sponsored-quests`

Admin creates quests on behalf of brands. Required fields:

| Field | Description |
|---|---|
| `brandName` | Sponsoring brand name |
| `brandLogoUrl` | Optional brand logo |
| `title` | Quest title shown to creators |
| `description` | Full quest brief |
| `requirements` | What creators must do to earn the reward |
| `rewardAmountCoins` | Total reward in Coins |
| `creatorSharePercent` | Creator's share (default 70%) |
| `platformSharePercent` | Platform's share (default 30%, must sum to 100 with creator share) |
| `maxApplications` | Max concurrent creator approvals |
| `deadline` | Application closing date |
| `minCreatorTier` | Minimum creator tier to apply (default: "verified") |

### Creator side — `GET /api/creator/sponsored-quests` + `POST /api/creator/sponsored-quests/[id]/apply`

Verified+ creators browse active quests and apply. Application status: `pending → approved → completed`.

On completion, the Coin reward is split per `creatorSharePercent`/`platformSharePercent`.

---

## PWA Per-Platform Toggle (PRD §3, §20, §22)

Admin controls PWA availability independently for web, Android, and iOS from the admin config panel. Changes are stored in `x_manifest` and take effect within the Redis cache TTL (60 seconds).

### Web PWA

`generateMetadata()` in `app/layout.tsx` reads `manifest.pwa.webEnabled` at request time. When `FALSE`, the `<link rel="manifest">` tag is omitted from the HTML `<head>`, which prevents browsers from offering "Add to Home Screen" for the web version.

The `next.config.js` also reads `NEXT_PUBLIC_PWA_WEB_ENABLED=false` at build time to disable service worker generation for deployments that should never serve a PWA (e.g. admin-only instances).

### Android / iOS PWA

`manifest.pwa.androidEnabled` and `manifest.pwa.iosEnabled` are checked by the Expo app's service worker registration code and the web app's install prompt component. When disabled, the "Install App" banner and prompt are suppressed.

---

## Business Account Tier Upgrades (PRD §17)

Business accounts start at the free `starter` tier. To upgrade to `growth` (₦15,000/month) or `enterprise` (₦50,000+/month):

1. Client calls `PATCH /api/business/tier` with `{ tier, paymentProvider }`.
2. Server looks up the tier price from `x_manifest` (admin-configurable; falls back to PRD defaults).
3. Server stores `pending_tier` and `pending_payment_ref` on the business account record.
4. Server calls Paystack (`initializePayment`) or DodoPayments (`createPaymentSession`) and returns `{ paymentUrl }`.
5. Client redirects user to the checkout page.
6. On `charge.success` (Paystack) or `payment.succeeded` (DodoPayments), the webhook handler:
   - Matches the `pending_payment_ref` on the business account.
   - Updates `tier` to the `newTier` from metadata.
   - Clears `pending_tier` and `pending_payment_ref`.
   - Records `tier_updated_at`.

Tier prices are admin-configurable via `x_manifest` keys `business_growth_price_kobo` and `business_enterprise_price_kobo`.

---

## Weekly Season Leaderboard Snapshot (PRD §25)

Every Sunday (UTC), the daily CRON publishes an official Season leaderboard snapshot:

1. Finds the currently active season.
2. Deletes the previous week's `season_weekly` snapshot rows for that season from `leaderboard_rank_snapshots`.
3. Re-inserts the top 200 users ranked by `season_xp` from `season_leaderboard_entries`.

This snapshot is what powers the "Season Leaderboard snapshot published (every Sunday)" shown in the Platform Vitality Calendar. The live leaderboard continues to update every 15 minutes via the hourly CRON's leaderboard step.

---

## ESLint Supabase Import Restriction (PRD §22.1)

`apps/web/.eslintrc.json` contains a `no-restricted-imports` rule that blocks direct imports from:

- `@supabase/supabase-js`
- `@supabase/auth-helpers-nextjs`
- `@supabase/auth-helpers-react`
- `@supabase/auth-helpers-shared`
- Any `@supabase/auth-helpers-*` package

**Exceptions** — files exempted via `overrides` in `.eslintrc.json`:
- `lib/db/providers/supabase.ts` — database adapter
- `lib/storage/providers/supabase-storage.ts` — storage adapter
- `lib/realtime/**` — realtime providers and client hook (`useRealtimeChannel`)
- `app/api/realtime/**` — realtime auth endpoints (Ably token, Pusher auth)

This enforces the PRD §22.1 requirement: when `DATABASE_PROVIDER != 'supabase'`, no Supabase SDK code is reachable through any import path (except the explicitly exempted realtime layer, which dynamically imports the SDK only when `NEXT_PUBLIC_REALTIME_PROVIDER=supabase-realtime`).

---

## Internationalisation & RTL Support (PRD §21)

The Expo app supports 8 languages: English (`en`), French (`fr`), Arabic (`ar`), Hausa (`ha`), Swahili (`sw`), Amharic (`am`), Zulu (`zu`), and Portuguese (`pt`).

Locale files live at `apps/expo/lib/i18n/locales/<lang>.json`. All locale files use a **nested JSON** structure matching the top-level namespace objects in `en.json` (23 namespaces, ~352 keys). i18next is initialised with `compatibilityJSON: 'v4'`.

### Arabic RTL

`apps/expo/lib/i18n/rtl.ts` exposes `setupRTL(locale)` which calls `I18nManager.forceRTL(true)` for Arabic and `forceRTL(false)` for all other locales. This is called automatically at app startup in `apps/expo/lib/i18n/index.ts` after i18n initialisation, and re-called whenever the language changes at runtime via the `i18n.on('languageChanged', ...)` listener. A full app reload is required for native-side RTL mirroring to take effect.

---

## Room Powers (PRD §11)

Room Powers are credit-purchasable in-room enhancements available to the room creator:

| Power | Cost | Effect |
|---|---|---|
| `room_spotlight` | 500 Credits | Boosts room in discovery for up to 72 hours |
| `member_highlight` | 200 Credits | Highlights a chosen member in the room for up to 8 hours |
| `message_pin` | 100 Credits | Pins a message (creator or co-moderator only) |

The backend is at `POST /api/rooms/[roomId]/powers`. The Expo room screen (`apps/expo/app/rooms/[roomId].tsx`) shows a "Room Powers" button for room creators. Tapping "Highlight Member" opens an inline username input. The app resolves the username to a UUID via `GET /api/users/search`, then posts to the powers endpoint.

---

## Google Play Annual Subscriptions

The Expo subscription screen (`apps/expo/app/settings/subscription.tsx`) supports both monthly and annual billing via a toggle. Annual plans offer 2 months free.

Play Store product IDs:

| Plan | Monthly | Annual |
|---|---|---|
| Plus | `sub_plus_monthly` | `sub_plus_annual` |
| Pro | `sub_pro_monthly` | `sub_pro_annual` |
| Max | `sub_max_monthly` | `sub_max_annual` |

Annual product IDs must be created in the Google Play Console. The verification endpoint (`/api/economy/iap/verify`) handles both monthly and annual subscription tokens identically — the `isSubscription: true` flag distinguishes them from one-time credit purchases.

---

## Cultural Vitality Calendar (PRD §25)

Platform events with XP multipliers are seeded in the `platform_events` table. The complete 2026 calendar includes:

| Event | Dates | Effect |
|---|---|---|
| New Year Hustle Season | Jan 1–7 | 1.5× XP |
| Black History Month | Feb 1–28 | 1.25× XP |
| Valentine's Gift Weekend | Feb 13–15 | 2× gift XP |
| International Women's Month | Mar 1–7 | 1.5× XP (female creators) |
| Eid al-Fitr | Mar 30–31 | 2× gift XP |
| Easter Weekend | Apr 3–5 | 2× gift XP |
| Labour Day | May 1 | 1.5× XP |
| Africa Freedom Day | May 25 | 2× XP |
| Eid al-Adha | Jun 6–8 | 2× gift XP |
| African Union Day | Jul 10–12 | 1.5× XP + alliance bonus |
| Nigerian Independence Day | Oct 1 | 2× XP |
| Kwanzaa Week | Dec 26–Jan 1 | 1.5× XP |
| Detty December | All December | 1.5× XP |
| New Year Countdown | Dec 31 23:00–Jan 1 01:00 | 3× XP |
| AFCON Season | Jan–Feb | 1.5× competitor XP + guild war bonus |

Events are stored with JSONB `metadata` for event-specific flags (e.g. `gift_xp_multiplier`, `female_creator_only`, `guild_war_points_multiplier`). The XP engine and CRON handlers read active `platform_events` and apply the appropriate multipliers at award time.
