# Zobia Social — Product Requirements Document
### A Gamified Monetised Social Platform for the Global Mobile Generation

> **Version 2.43 (in development) — Product Requirements Document**
> Covers: Feature Specifications · Technical Architecture · Economy Design · Moderation · Build Sequence
> Scope: Nigeria-first, Pan-African then Global · Mobile-first PWA + Android APK · Admin-minimal operation

---

## Table of Contents

1. [Vision & Design Philosophy](#1-vision--design-philosophy)
2. [Core Design Principles — The Vitality Framework](#2-core-design-principles--the-vitality-framework)
3. [Platform Plans & Subscription Tiers](#3-platform-plans--subscription-tiers)
4. [Onboarding & First-Run Experience](#4-onboarding--first-run-experience)
5. [Messaging Layer](#5-messaging-layer)
6. [XP Engine](#6-xp-engine)
7. [Progression Architecture](#7-progression-architecture)
8. [Season System](#8-season-system)
9. [Prestige System](#9-prestige-system)
10. [Room System](#10-room-system)
11. [Virtual Economy — Dual Currency Model](#11-virtual-economy--dual-currency-model)
12. [Gift Economy](#12-gift-economy)
13. [Guild System](#13-guild-system)
14. [Creator Economy](#14-creator-economy)
15. [Social Architecture](#15-social-architecture)
16. [Notifications & Re-engagement](#16-notifications--re-engagement)
17. [Monetisation Stack](#17-monetisation-stack)
18. [Payments, Payouts & Financial Integrity](#18-payments-payouts--financial-integrity)
19. [Trust, Safety & Community Health](#19-trust-safety--community-health)
20. [Admin Dashboard & Monitoring](#20-admin-dashboard--monitoring)
21. [Internationalisation & Localisation](#21-internationalisation--localisation)
22. [Technical Architecture & Infrastructure](#22-technical-architecture--infrastructure)
23. [Security & Hardening](#23-security--hardening)
24. [Key User Workflows](#24-key-user-workflows)
25. [Platform Vitality Calendar](#25-platform-vitality-calendar)
26. [MVP Build Sequence](#26-mvp-build-sequence)
27. [Expansion Roadmap](#27-expansion-roadmap)
28. [Testing Strategy](#28-testing-strategy)
29. [Documentation Requirements](#29-documentation-requirements)
30. [Games & Gaming Track](#30-games--gaming-track-v172)
31. [Answers — Mini Forum (Q&A)](#31-answers--mini-forum-qa-v196)
32. [Blogs](#32-blogs-v201)

---

## 1. Vision & Design Philosophy

### What Zobia Social Is

Zobia Social is a gamified, monetised social platform built for the African mobile generation — and designed from day one for global expansion. It is not a messaging app. It is not a social network. It is a world where your social activity earns real rewards, your community identity is visible and layered, and every session feels like progress.

### The Problem Zobia Solves

WhatsApp owns messaging in Africa. It is frictionless and free. Zobia does not compete on messaging utility. Zobia competes on an entirely different axis: **meaning, status, earning potential, and community belonging**.

On WhatsApp, your social capital is invisible. Nobody knows how generous you are, how loyal you are to your crew, how much you know, or how active you have been. You can disappear for a month and return to exactly the same world.

Zobia makes social capital visible, earned, displayed, and monetised. Leaving Zobia has a cost. Returning always has a reward.

### Core Value Propositions

**For everyday users:** Every conversation, daily login, gift, and quest completion builds a visible identity and earns real rewards. Being social on Zobia is not a passive activity — it is an investment.

**For creators:** Zobia is the first platform where a creator with 500 deeply loyal community members can earn more than a platform creator with 50,000 passive followers, because monetisation is built around intimacy and loyalty — not reach or ad impressions.

**For competitive users:** The Guild system, Season leaderboards, and Nemesis mechanic provide an ongoing competitive arena where your city and crew battle for recognition at city, national, and global levels.

### Design Tenets

1. **Every session must feel like progress.** No user closes Zobia feeling like they wasted time. Every interaction moves a number forward, completes a quest, or earns something tangible.

2. **Status must be multi-dimensional.** The most generous user is as celebrated as the most active user. No single hierarchy dominates. Identity is layered.

3. **The platform must feel alive when you are not there.** Events, wars, drops, and leaderboard shifts happen on fixed schedules. When users return, the world has moved.

4. **Earning must feel real, not theoretical.** Creators receive payouts on a regular cadence. Credits convert to tangible value. The moment a user earns their first payout on Zobia, their relationship with the platform changes permanently.

5. **Local identity is a first-class feature.** City-based guilds and leaderboards, local cultural events, language-native content. Zobia is not a Western product adapted for Africa — it is built outward from the African digital experience.

6. **Sustainability must be designed in.** Features that incur per-user third-party costs are reserved for paid tiers so that revenue covers the cost. Free tier access is generous where costs are platform-absorbed; metered where costs are service-provider-driven.

---

## 2. Core Design Principles — The Vitality Framework

Vitality is the feeling that a platform is alive — breathing, moving, and evolving — whether or not any individual user is actively present. It is the antidote to the dead-app experience that has killed numerous social platforms that came before.

### Why Vitality Matters More Than Features

A platform with 100 features and no vitality feels like a ghost town within six months. A platform with 20 features and strong vitality feels alive indefinitely. The goal is not feature completeness — it is the feeling that something is always happening and that returning always yields a reward.

### The Five Vitality Mechanisms

**2.1 The Always-Happening World**
The platform generates events on its own schedule, independent of any individual user's actions:
- Season Cycles roll over every 8 weeks regardless of individual participation. Rankings reset, new cosmetics drop, and a new theme emerges.
- Guild Wars ignite on a fixed 72-hour clock. Users who were offline return mid-war to urgency.
- Mystery XP Drops occur at algorithmically randomised moments — not triggered by user action. Variable reward psychology: users cannot predict when the next drop comes.
- Limited Rooms open for brief windows (2–6 hours) and close permanently. The content inside is gone forever. Every limited Room creates re-engagement urgency.
- Daily Resets at midnight reset quests, streaks, and leaderboard positions. Fresh motivation at every dawn.

**2.2 The Presence Layer**
The platform continuously signals that other humans are active:
- Online rings around profile avatars indicate activity level — pulsing softly for recently active, steady bright for active now.
- Room pulse bars animate outside room cards to show live activity volume.
- "X people earned XP in the last hour" banners on the home screen give ambient awareness.
- Leaderboard ripple notifications fire when a user's rank changes without them doing anything.

**2.3 The Nemesis System**
Each user is algorithmically assigned a Nemesis — another user within 10% of their XP score on any active track, prioritising users in the same city or Guild tier, never a mutual friend. The Nemesis is not an enemy — it is a rival in the purest sports sense. When the Nemesis pulls ahead, a notification fires. When the user pulls ahead, a triumph notification fires. The Nemesis refreshes weekly.

**2.4 Earned FOMO**
- Seasonal exclusives: cosmetics, titles, and badges available only during their Season and never again.
- Flash events: Double XP Hours announced 6 hours in advance but firing at an unannounced moment within that window. Users who miss it cannot recover it.
- War momentum notifications: when a Guild is surging, every member receives real-time urgency alerts.
- Top Gifter spotlights: the top gifter in any Room in the last 24 hours has their name pinned in the Room header.

**2.5 Living Identity**
- Seasonal archive badges: every Season's rank and achievements are stored permanently on the profile.
- Guild history wall: every war won, every tier unlocked, every Alliance formed is permanently visible.
- Legacy Score: a number that accumulates across every action and never resets regardless of Prestige.
- "Playing since" timestamp: shown on every profile. Early adopters carry a distinction that compounds as the platform grows.

---

## 3. Platform Plans & Subscription Tiers

### The Four Plans

| Feature | Free | Plus | Pro | Max |
|---|---|---|---|---|
| Monthly price (NGN) | 0 | ₦500 | ₦1,500 | ₦3,500 |
| XP multiplier | 1× | 1.5× | 3× | 5× |
| Ads shown | Yes | Rewarded only | No | No |
| Daily quests | 3 | 4 | 5 | 6 |
| Group chat size cap | 300 | 400 | 500 | 1,000 |
| Message history | 90 days | 180 days | Unlimited | Unlimited |
| Room Pins | 3 | 4 | 5 | 10 |
| Save Slots (games) | 0 | 1 | 3 | 5 |
| Monthly coin bonus | 0 | 50 | 200 | 500 |
| Season Pass discount | 0% | 10% | 20% | 30% |
| Customer support priority | Standard | Standard | Priority | Dedicated |
| Creator tools | Basic | Basic | Full | Full + Boosts |
| Early feature access | No | No | No | Yes (2 weeks) |
| Custom chat themes | No | No | Yes | Yes |
| Extended Season Pass rewards | No | No | Yes | Yes |

### DM and Messaging Entitlements by Plan

| Capability | Free | Plus | Pro | Max |
|---|---|---|---|---|
| Send new DM (initiate) | No | No | Yes (1 Credit/message) | Yes (Free) |
| Max DMs sent per day | — | — | 25 | 250 |
| Reply to DM | Yes (2 Credits) | Yes (1 Credit) | Yes (Free) | Yes (Free) |
| Max DM replies per day | 25 | 50 | 100 | Unlimited |
| Receive DMs | Yes (unless opted out or blocked) | Yes | Yes | Yes |

**DM Rules:**
- Everybody can receive and read DMs unless they have opted out of receiving DMs or have blocked the sender.
- Users who are suspended or temporarily banned cannot receive DMs during the ban period. The sender receives a notice that the recipient's account is temporarily unavailable — no detail about the reason is disclosed.
- If a message is sent to a user who cannot reply due to insufficient credits, the message window displays a notice explaining that the recipient cannot reply at this time, alongside a "Gift them credits" button that opens the credit gifting flow.
- All group messaging — Rooms (free and paid), Guilds, group chats, public comments — is free for all tiers.
- Restrictions on sending phone numbers, links, or email addresses apply to new DM conversations: these are silently blocked until the recipient has replied at least twice in that conversation. This restriction is intentional and is not documented publicly or surfaced to the user. They discover it naturally.
- Anti-spam applies to public areas: links, phone numbers, and email addresses are blocked in all public chats and Room feeds except in designated profile areas or when posted by Room or Group admins.

### Plan Billing and Purchasing

- Plans are billed monthly or annually (annual = 2 months free).
- Plans can be purchased via in-app purchase (Google Pay on Android; Stripe/equivalent on web) or via Paystack (Nigeria web) or crypto (international web).
- Admin can toggle plan availability on or off per region.
- Admin can configure coin-based booster packs, XP boosters, and one-time packs independently of subscription plans.

### Plan Expiry Reminders

When a user has an active Plus/Pro/Max subscription or a Business plan that is due to expire within 14 days, the Home page — and the Business hub (`/business`) for a business plan — shows a dismissible alert immediately on login: *"Your plan ends in N days time. [Resubscribe]"*, linking to Settings → Subscription (or Settings → Business for a business plan). The alert can be dismissed with an × while more than 7 days remain; dismissal is remembered per expiry date (a renewal resets it). Once 7 days or fewer remain, the alert reappears **without** the × and cannot be dismissed until the user resubscribes or the plan lapses. If both a personal and a business plan are expiring, whichever is soonest is shown. (Shared as `components/PlanExpiryBanner.tsx`; for a business plan, "ends" is backed by `business_accounts.current_period_ends_at` — see §17.)

### Switching Plans

- **Free → Plus/Pro/Max**: requires payment — the user is redirected to checkout, and the plan activates as soon as that payment is confirmed.
- **Between two paid plans (e.g. Max → Pro, Plus → Pro)**: takes effect immediately with no new payment and no proration — the remaining time on the current billing period simply continues under the new plan. The plan-switch grid always shows a "Switch to Free" option too; picking it is a downgrade to no paid plan, handled identically to Cancel Subscription below (not a purchase, so it never goes through checkout).
- **Cancel Subscription / Switch to Free**: the user keeps their current plan's benefits until the current billing period ends, then moves to Free. Switching to Free specifically prompts a confirmation dialog first, since it's easy to trigger by mistake from the plan grid.
- **Cancel Plan modal** (Settings → Subscription): shows the current plan, the exact date access continues until, and the specific benefits that will be lost after that date. "Cancel Plan" is the primary (destructive-colored) action; "Change Plan" and "Keep Plan" are secondary pills. Confirming shows a brief "Cancelling plan…" progress state, then an optional exit survey: multi-select reasons (bugs/errors, missing features, taking a break, cost too high, other), each with its own conditional follow-up question shown only when that reason is selected, plus a general feedback box — every field optional, Skip or Submit both close the flow (the cancellation itself already completed before the survey appears). Feedback is stored for product review (`subscription_cancellation_feedback`), never surfaced to the user as "optional."

### Subscription Grace Period

When a Plus/Pro/Max (or Business Starter/Growth/Enterprise) subscription
lapses, the account downgrades immediately but admin-selected data (e.g.
Save Slots, §30.8) is preserved for a default grace period — 30 days
(Max), 14 days (Pro), 7 days (Plus), mirrored per Business tier — before
being purged. Fully admin-configurable at `/admin/config`. See the v1.99
changelog (Appendix) for full detail.

### Pay-As-You-Go Booster Packs

Available to all tiers regardless of subscription status:
- **XP Booster Pack:** 2× XP for 24 hours — 200 Credits or ₦200 equivalent.
- **Quest Accelerator:** +50% XP on quest completions for 7 days — 500 Credits.
- **Guild War Boost:** Double personal War Points for next war — 300 Credits.
- **Room Spotlight:** Feature your Room on the discovery feed for 6 hours — 500 Credits.
- **Message Pin:** Pin your message at the top of a Room for 1 hour — 100 Credits.

---

## 4. Onboarding & First-Run Experience

### Design Goal

A new user must feel the core loop — the sensation of earning something — within the first 90 seconds. They must leave onboarding with at least one social connection already seeded.

### Authentication

- Google OAuth (primary) and Telegram Login (secondary) are the default auth methods. Admin can toggle each on or off independently. The same auth options are available identically on web, PWA, and Android app regardless of which database provider is in use.
- Auth is handled by the platform's own JWT system (not Supabase Auth). In non-Supabase database mode, there are zero Supabase dependencies anywhere in the auth flow — see Section 22.2 for full detail.
- No phone number or SMS authentication. No SMS anything, with exactly one narrow, admin-gated, opt-in exception: a Settings "Phone Number" field for the contacts cross-reference feature (Step 4 below), whose optional SMS OTP confirmation is off by default — see §4.5.
- After onboarding, the user is periodically (but not aggressively) encouraged to add an email address for account recovery and to set a password. Both are optional but surfaced as strongly recommended.
- Users may optionally set a 4-digit PIN to protect login and sensitive operations (payments, payout requests). PIN is not mandatory. Wrong PINs are rate limited and lock the PIN out (5 wrong attempts -> 15 minutes, 3 lockouts in 24 hours -> 24 hours), changing a PIN requires the current PIN, and a forgotten PIN is reset by proving identity another way — see §42.1.
- 2FA defaults to authenticator app (Google Authenticator, Authy, or equivalent). No SMS 2FA.
- The 2FA login flow uses a short-lived `pre_auth` JWT type. After verifying email + password the server issues a `pre_auth` token scoped only to the `/api/auth/2fa/verify` endpoint. All other API routes and app pages reject `pre_auth` tokens, redirecting the browser to `/auth/2fa`. A full-access access token is issued only after successful TOTP verification. TOTP codes are replay-protected with a Redis atomic SET NX keyed by `totp:used:<userId>:<code>` (90-second TTL matching the TOTP window).
- On Android, the JWT and refresh token are stored in an `EncryptedSharedPreferences` file whose AES-256 key is generated and held by the Android Keystore (`SecureTokenStorePlugin.java`, `androidx.security:security-crypto`; hardware-backed where the device supports it) — not plain `@capacitor/preferences` (v2.10; previously the tokens sat in plaintext there, only excluded from Android's backup/device-transfer mechanisms, which stops the sanctioned backup path from leaking them but nothing else). On web, in an HttpOnly cookie.

### The Onboarding Flow

**Step 1 — Identity Creation (target: 60 seconds)**
- User picks a username (permanent, cultural signal — prompt copy encourages creative self-expression), display name (changeable), and avatar emoji.
- User selects a home city from a searchable list (city affects city leaderboards, room discovery feed, and Guild seeding).
- User enters their full date of birth (year, month, and day) for age gate enforcement. The age check is performed client-side using the exact birthday to handle December-31-born edge cases, and server-side as a second gate before the onboarding profile is written.
- Username availability is checked in real time. Profanity and reserved name filtering applied immediately.

**Step 2 — The Vibe Quiz (target: 45 seconds)**
Four quick questions that personalise the experience silently:
1. "What do you do most — argue, gist, learn, or flex?" → seeds Room recommendations.
2. "Are you a lone wolf or a crew person?" → surfaces Guild discovery vs solo track emphasis.
3. "What brings you here — friends, money, or just vibing?" → adjusts onboarding tone.
4. "Pick your city's vibe." → seeds social and competitive graph.

Results are never shown to the user as a score. They silently configure the home feed, first Room invitations, and the first quest deck.

**Step 3 — The Welcome XP Drop (instant)**
Onboarding completion triggers a brief animation: "Welcome to Zobia — you just earned 500 XP." The XP bar fills from zero to a visible fraction of Level 2. The XP and bar are real. The psychological anchor is intentional: the user already has something to protect and build.

**Step 4 — First Contact (guided)**
The user is prompted to:
- Invite contacts from their device phonebook (only those already on Zobia are surfaced).
- Explore a curated "First Room" tailored to their quiz responses.
- Accept a "New Member Quest" — a 6-step guided mission: send a message, join a Room, gift someone, add a friend, send 3 friend requests, complete a daily login. Progress already made before the quest row existed is backfilled, and the reward is claimed with a "Claim reward" button once all steps are done. Payout on completion: 1,000 Credits + 2,000 XP. Designed to be completable within the first session.

**Step 5 — Guild Discovery (after first 24 hours)**
The user is shown a panel: "Crews near you are recruiting." Three local guilds are surfaced based on city — with tier badges, member count, and war records visible. Joining a Guild is optional but deeply prompted. Guild members earn 5–50% more XP from the same activities.

### 4.5 — Phone Number & Contacts Cross-Reference

Step 4's "Invite contacts from their device phonebook" only surfaces matches — it needs some users to have a phone number on file to match against. That capture happens separately, in Settings, not during onboarding (web and the browser-based Android/Capacitor app can't read a device phonebook; only the discontinued Expo app could, and it is not part of this flow going forward).

- **Settings → Phone Number** (web and Android/Capacitor): a user may optionally type in a phone number at any time. By default this is a plain, unverified, self-attested capture — no SMS is sent, consistent with the platform's baseline no-SMS policy (§4 Authentication). The number is normalised to E.164 (Nigeria-biased local-format default, extensible to other markets) and stored on `users.phone_number`.
- **Admin-gated SMS OTP (off by default):** admins can turn on `phone_verification_required` at `/gate44/config` ("Phone Verification" group). When on, saving a number in Settings texts a 6-digit code (via the same Termii integration reserved for admin/mod alert paging, `lib/notifications/sms.ts`) that the user must confirm before the number is stored; `users.phone_verified_at` records when. This is a deliberate, narrowly-scoped, reversible exception to the no-SMS policy — never on by default, never used for anything but confirming this one field. A user can remove their number at any time regardless of this setting.
- **Matching:** `POST /api/users/contacts/cross-reference` takes a list of phone numbers from the caller's device contacts and returns which of them belong to existing Zobia users (capped at 100 results, rate-limited, never echoes the matched number back — only a `"[matched]"` sentinel plus the matched user's public profile fields).

### Age Verification

- Admin sets the minimum age requirement in the platform manifest (x_manifest). Default is 18 years.
- The onboarding flow collects a full date of birth (year, month, and day). Age is computed using the exact birthday (not year-only), so December-birthday users cannot bypass the gate. Users below the configured minimum age are blocked from proceeding with a clear error message.
- The server enforces the age gate independently using the same exact-date calculation before committing the profile to the database.
- The age gate is lightweight (no ID verification at this stage) but is logged and can be escalated by Trust & Safety if signals suggest misrepresentation.

### CAPTCHA

- Google reCAPTCHA is the default CAPTCHA provider.
- Cloudflare Turnstile is supported as an alternative.
- Admin can toggle which provider is active in the admin panel without a deployment (`captcha_provider` manifest key).
- Android (Capacitor WebView) renders the same CAPTCHA widget as web/PWA for any surface it shares a screen with (e.g. Signup) — it is not API-only rate limiting; the widget loading code is duplicated per-app (no shared React runtime between web and Android) but talks to the same `/api/manifest` and verification backend.
- **Per-surface toggles:** on top of the master provider switch, admins can independently enable/disable CAPTCHA on 11 distinct surfaces via the `captcha_active_surfaces` manifest key (JSON array of surface keys, admin panel renders it as a checkbox group next to the provider selector): Login, Admin Login, Signup, Create Blog, Create Room, Contact Us page, Blog Comments, Create Question, Submit Answer, Reply to Answer/Comment, and Blog Contact Form. A surface only requires/verifies a CAPTCHA token when BOTH the master provider is not "None" AND that surface's key is present in the enabled-surfaces list — see `apps/web/lib/security/captchaSurfaces.ts` (registry) and `apps/web/lib/security/captcha.ts` (`isCaptchaSurfaceEnabled`). All 11 surfaces are enabled by default so behavior is unchanged for existing deployments once a provider is selected.
- **Contact Us page:** a new site-wide `/contact` page (distinct from the pre-existing per-blog Contact form) lets any visitor — logged in or not — send a message to platform admins; submissions are stored in `site_contact_messages` and notify all admins in-app. Admin inbox: `/gate44/contact-messages` (web) and `admin/contact-messages.tsx` (Capacitor Android), both listing/marking-read against the same `/api/admin/contact-messages` endpoint.

### Seed Content

- On a new deployment, seed content is loaded: sample Rooms across key categories, sample Guild profiles, a sample platform-managed "Welcome to Zobia" Room open to all new users, and a starter set of public posts for the discovery feed.
- Seed content is clearly flagged in admin views but not flagged to users.

---

## 5. Messaging Layer

### Design Philosophy

The messaging layer is fast, lightweight, and culturally expressive. It rewards participation. It does not attempt to replace WhatsApp — it is the messaging layer that rewards you for using it.

### Message Types (Supported in This Version)

**Text Messages** — full emoji support, Pidgin autocorrect suggestions in Nigerian-locale builds (admin-configurable locale), rich link previews (with anti-spam: link previews only render in DMs after the recipient has replied twice in that conversation; in public Rooms, link previews are disabled unless posted by an admin).

**Reactions** — standard emoji reactions plus purchasable Zobia-specific reaction sets. Reacting with a custom reaction awards 1 XP to the sender.

**Sticker Packs** — three tiers: Free packs (locale-themed expressions), Earnable packs (unlocked through progression milestones), and Premium packs (purchased with Credits). Sticker use is tracked for badge unlocks.

**GIFs** — built-in GIF search via an integrated library (Giphy or Tenor, admin-configurable via env var). Sending a GIF costs nothing.

**Gift Messages** — a special message type where a coin-purchased gift animation plays for the recipient (and room-wide in Rooms) before collapsing into a standard message with gift value displayed.

**Zobia Moments** — ephemeral posts (text, and optionally an image) visible for 24 hours, after which they disappear. Moments live on a public, cross-user `/moments` feed (all users' active Moments, newest first — not follow-gated) so any user can discover and react to any other user's Moment, not just their own.

- **Creation:** Moments can be shared from the dedicated `/moments/create` screen, or from inside a Room via the ⚡ "Moment" toggle on the message composer — sending a Room moment posts an ephemeral 24h bubble in that Room *and* creates the same entry on the public `/moments` feed, so it isn't Room-local. An optional image is attached via an in-app uploader (`POST /api/moments/uploads/image`, same 8MB/JPEG-PNG-WebP-GIF constraints and `message`-profile compression as the Rooms/Forum uploaders) rather than pasting an external image URL — the returned storage URL is what gets submitted as the Moment's `media_url`.
- **Eligibility:** posting a Moment requires the account to have reached a minimum level (default: Level 2 / Rookie), admin-configurable.
- **Pricing:** admin-configurable per Moment — a Credits cost and/or a Stars cost (default: 100 Credits or 1 Star; either currency is accepted when both are priced). Set both to 0 to make Moments free. A user who can't afford either currency sees an explicit "You do not have enough Credits and/or Stars to create a moment" notice before the Moment is charged or posted. Cost displays (here, and the Rooms ⚡ moment indicator) use the admin-configured currency names from Section 3's dual-currency settings, picking the singular form when the cost is exactly 1 (e.g. "Costs 1 Star" vs "Costs 100 Credits").
- **Reactions:** viewers react with a fixed emoji set (❤️ 🔥 😂 😮 👏 💯 🎉 👀); reaction counts persist across page refreshes.
- **Scale:** the feed is cursor-paginated (newest-first keyset on `created_at`) to stay fast at thousands of Moments/day.

> ### ⚠️ FUTURE VERSION FEATURES — NOT IN CURRENT SCOPE
>
> The following messaging features are **explicitly deferred to a future version** and must **not** be built as part of the current development phase:
>
> - **Voice Notes** — audio recording, sending, and playback within DMs and Rooms
> - **Video Notes** — short-form video messages
> - **Voice Calls** — real-time 1:1 and group audio calls
> - **Video Calls** — real-time 1:1 and group video calls
>
> These features are planned for a post-launch phase once the core gamification and monetisation loops are stable. Do not include them in any implementation sprint, backlog ticket, or gap analysis for the current build.

### Group Chats

- Standard group chats support up to 300 total members (scaling by plan as per Section 3) — this is the hard membership cap, distinct from the concurrent cap below.
- **Concurrent capacity (v2.18):** in addition to the total-membership cap, each group has a soft cap on how many members can be *actively present* in the chat at once — default 20, admin-configurable. Members over the cap see "chat is full, try again later"; the group creator can pay coins to raise the cap (admin sets the cost per step and the hard ceiling), mirroring the Room capacity-upgrade mechanic in Section 10. This does not affect total membership — everyone stays a member.
- **Who can create group chats (v2.18, admin-configurable):** Free and Plus members cannot create group chats by default. Pro can create up to 3 concurrently-active groups, Max up to 10. Business Starter accounts can create up to 5, Business Growth up to 10, Business Enterprise up to 20. Guild creators (the guild's founder/captain) may always create at least one group chat regardless of their personal plan.
- Posting in a group chat is free for everyone. Group chats earn **no XP, no quest progress, and no guild-war contribution** for posting — this was previously "all members earn XP for activity" and has been superseded (v2.18). The one exception: a Business account's group creator may configure members to receive credits when they join for the first time (rejoins after leaving earn nothing) and/or when they send their first X messages.
- No ads are shown inline/instream inside a Business account's group chats.
- Group admins can assign tags — "Personal", "General", "Study Group", "Crew", "Business", "Other" — which affect Room discovery signals.
- Anti-spam rules (no links, phone numbers, or email addresses) apply in group chats unless the posting user is a group admin.
- **Group deactivation & reactivation (v2.18):** if the group creator's plan lapses and its grace period fully elapses without renewal, their group chats are deactivated (admin can configure "group_chats" as a preserved grace feature per plan/tier to skip this). When the creator later renews, they are asked, per group, whether to reactivate it (select/deselect each one separately) — reactivating a group counts against the creator's current active-group limit again.

#### Group Chat Moderation

- The group admin can suspend ("mute") any member from posting for a fixed duration — 30 minutes, 1 hour, 3 hours, 1 day, 3 days, 7 days, or 30 days — and can lift the suspension early at any time.
- The group admin can remove any member from the group.
- A member can remove themselves from a group at any time.
- A user can block a group entirely: they no longer see it, and neither the group nor its admin (inviting on the group's behalf) can invite them back while blocked.

#### Group Invitations

- By default, only the group admin — and any participant the admin has explicitly granted invite permission — may invite people to the group. The admin can instead allow any member to invite (subject to the invitee's own privacy setting below and to the group not being blocked by the invitee).
- Users control who can invite them to groups via a privacy setting (Settings → Privacy → "Who can invite me to groups?"): **Anybody**, **Only friends**, or **Nobody** (default: Only friends).
- If an inviter tries to invite someone they are not allowed to invite, they see: "You are not allowed to invite this user." with mini-text explaining why — "This user has opted not to receive group invitations from anybody." / "...from non-friends." — unless the invitee has blocked the group (or its admin) directly, in which case the mini-text is omitted and the message is simply "You are not allowed to invite this user to {group name}."

### 1-on-1 DMs

- Standard private messaging with DM coin costs and daily limits as per Section 3.
- DMs track a "Conversation Score" — the longer two users sustain a daily conversation streak, the higher their score, which unlocks exclusive DM sticker reactions and a "Connection Badge" visible to both parties.

### Message Bandwidth Optimisation

- Automatic image compression on upload. One-tap "HD send" option for Wi-Fi connections.
- Offline messages are queued and delivered when connectivity resumes, with a visual "pending" indicator.
- All payloads are compressed. The app targets full functionality on 2G/3G connections.

---

## 6. XP Engine

### What XP Is

XP (Experience Points) is the universal score reflecting a user's total activity and engagement across Zobia. It feeds the main rank progression and the seven parallel progression tracks. XP is not a currency — it cannot be spent. It only accumulates as a record of presence.

### XP Sources

**Messaging Activity**
- Sending a text message: 1 XP
- Sending a sticker: 1 XP
- Sending a gift message: 10 XP
- Receiving a gift and reacting: 5 XP
- Sustaining a daily message streak (per day): 5–25 XP (scales with streak length)

**Social Activity**
- Adding a new friend: 10 XP
- Accepting a friend request: 5 XP
- Being gifted by someone for the first time: 15 XP
- Referring a new user who completes onboarding: 500 XP

**Room Activity**
- Joining a new Room for the first time: 20 XP
- Sending a message in a Room: 2 XP (capped at 50 messages/day for XP purposes)
- Being tipped in a Room: 25 XP
- Having a Room message reacted to by 5+ people: 10 bonus XP
- Hosting a Room session of 30+ minutes: 50 XP

**Guild Activity**
- Logging in on a Guild War day: 10 bonus XP
- Contributing to a Guild Quest: 30–100 XP depending on contribution
- Winning a Guild War (distributed to all contributing members): 200–500 XP
- Being top contributor in a Guild War: 1,000 XP bonus

**Creator Activity**
- Receiving the first paid subscriber: 100 XP
- Reaching membership milestones (10, 50, 100, 500, 1,000): 200–2,000 XP
- Completing a Sponsored Quest: 300–1,000 XP depending on brand tier

**Daily & System XP**
- Daily login: 50 XP base
- Day-7 login streak: 200 XP bonus
- Day-30 login streak: 1,000 XP bonus
- Completing the full daily quest set: 500 bonus XP
- Mystery XP Drops (algorithmically triggered at random times): 100–1,000 XP

**Multipliers**
- Plus plan: 1.5× multiplier on all messaging XP
- Pro plan: 3× multiplier on all messaging XP
- Max plan: 5× multiplier on all messaging XP
- Guild Tier bonus: +5% (Bronze) to +50% (Legend)
- Active Season Pass: +25% on all activities
- XP Booster Pack: 2× for 24 hours

### XP and Rank Thresholds

| Rank | Name | XP Required |
|---|---|---|
| 1 | Beginner | 0 |
| 2 | Rookie | 2,000 |
| 3 | Hustler | 6,000 |
| 4 | Baller | 15,000 |
| 5 | Boss | 35,000 |
| 6 | Legend | 75,000 |
| 7 | Titan | 150,000 |
| 8 | Goat | 280,000 |
| 9 | Icon | 500,000 |
| 10 | Zobia Icon | 1,000,000 |

Within each rank are sub-levels (I, II, III) providing shorter-term milestones. A user at Baller III is one sub-level from Boss I — this prevents the gaps between major ranks from feeling discouraging.

**Level Up celebration:** whenever an XP award crosses a rank or sub-level threshold, the user is shown a full-screen celebratory overlay (confetti, the new rank name/sub-level, a short chime) delivered in real time via the same push channel as other reward toasts. Admins can preview the animation on demand from `/gate44/notifications-demo`.

---

## 7. Progression Architecture

### The Seven Parallel Tracks

Zobia uses a seven-track parallel progression system. Each track measures a fundamentally different type of engagement. No track gates another — they are independent. A user can be a Level 50 Social user and a Level 5 Explorer simultaneously. The profile displays all tracks, creating a multi-dimensional identity that can never be "complete."

> Gaming (Track 7, added v1.72) is defined in full in §30.2 — this section keeps the original six for historical context plus a summary entry below so the track list stays complete in one place.

**Track 1: Social Track**
Measures conversational depth, friend network size, message volume, reaction generation. Key milestones: Level 5 (Talker — custom conversation badges), Level 25 (Connector — group chats up to 500), Level 50 (The Connector — title on profile, Elder role eligibility).

**Track 2: Creator Track**
Measures Room quality, subscriber growth, revenue earned, member engagement. Key milestones: Level 5 (Room Opener — Rooms up to 100 people), Level 20 (Verified Creator — blue badge, Quest Marketplace access), Level 50 (Room God — revenue share boost, featured in discovery).

**Track 3: Competitor Track**
Measures leaderboard finishes, Guild War contributions, Season rankings, event performance. Key milestones: Level 15 (Fighter — Nemesis system activates), Level 40 (Champion — can challenge users to head-to-head XP sprints), Level 50 (Arena King — trophy shelf on profile).

**Track 4: Generosity Track**
Measures credits gifted, gifts sent, new users invited. Key milestones: Level 10 (Big Spender — top gifter notifications more prominent), Level 40 (Philanthropist — 5% credit bonus on all credit purchases), Level 50 (Big Donor — "Most Generous" badge, monthly feature on platform gifter wall).

**Track 5: Knowledge Track**
Measures ClassRoom completions, in-app quizzes, ClassRoom hosting performance. Key milestones: Level 25 (Scholar — can co-host ClassRooms), Level 40 (Sage — can create and publish quizzes), Level 50 (The Scholar — can issue Zobia Learning Certificates).

**Track 6: Explorer Track**
Measures Rooms discovered, cities represented in friend network, unique Room categories visited. Key milestones: Level 10 (Wanderer — can pin up to 5 Rooms), Level 25 (Nomad — first-access notifications for new city-based rooms), Level 50 (The Explorer — Rooms Visited counter on profile).

**Track 7: Gaming Track** (added v1.72 — full spec in §30.2)
Measures games played and won on the Games hub. A "win" is a new personal best with a positive score; every game route awards `xp_gaming` on each finalized play. Key milestones: Level 5 (Rookie Gamer), Level 20 (Pro Gamer — trophy shelf on profile), Level 50 (Game Legend — Games Legend Wall feature). Tracked via `xp_gaming`/`level_gaming` on `users`, ranked on the Gaming tab of the main Leaderboards page (positioned after Generosity) and on per-game high-score boards under Games → Leaderboards.

### Daily Quest System

Each user receives a daily quest deck at midnight local time. Quest deck size varies by plan (3–6 quests). Sample quests:
- "Send 10 messages today" — 100 XP + 10 Credits
- "Join a Room you haven't visited before" — 150 XP
- "Gift any user today" — 50 XP + 5 Credits
- "Log in for 7 consecutive days" — 200 XP + 50 Credits
- "Complete a Guild Quest contribution" — 200 XP
- "Earn 500 XP today" — 100 XP + 20 Credits (meta-quest)

Completing the full daily quest deck awards a bonus 500 XP. Quest XP feeds both the main rank and the relevant parallel tracks.

On completion of the full daily quest deck, users receive a confetti celebration followed by floating notifications showing the deck completion bonus XP and Credits awarded.

**Quests are algorithmically pooled, not admin-authored one-by-one.** Each day's deck is a cryptographically-random draw (Fisher-Yates over `crypto.randomBytes`) from the pool of active `quest_templates` rows eligible for the user's plan and enabled features — no admin curates who gets which quest on which day. What admins *do* manage is the underlying catalog of quest template rows (reward amounts, target counts, eligibility, and whether a quest is active at all) at **`/gate44/quests`** — see §20 "Quests Catalog" for exactly what is and isn't editable there. This is distinct from the temporary per-feature weighting at `/gate44/quests/boosts` (§17) and the advertiser-funded quests at `/gate44/sponsored-quests` (§14).

### The Elder System

Available to users who have Prestiged at least 3 times and have been active in the past 30 days. Elders can take on up to 5 Mentees — users below Hustler rank who voluntarily request a mentor.

- When a Mentee completes a daily quest, the Elder earns 10% of the quest XP as a Mentorship Bonus.
- When a Mentee levels up, both parties receive a shared celebration notification.
- Elders are ranked by Mentees' collective progress at Season end. Top Elders receive a "Master Teacher" seasonal award.

---

## 8. Season System

### What a Season Is

A Season is an 8-week competitive cycle — a fresh chapter for the platform. It resets competitive standings while preserving all permanent progression. Every Season has a name, a theme, a visual identity, a unique cosmetic set, and a dedicated quest deck.

### Season Structure

- **Weeks 1–2 (Opening):** Season launch with narrative announcement, theme reveal, culturally relevant quests, limited cosmetics, Season Pass goes on sale.
- **Weeks 3–5 (Mid-Season):** Season leaderboards active. Guild Wars count double toward Season rankings. Mid-Season drop: new limited cosmetics, bonus event room, or Flash XP event.
- **Weeks 6–7 (The Push):** Leaderboard positions visible to wider audiences. Top 100 users on Season leaderboard get a special in-app frame.
- **Week 8 (Final Day):** Platform-wide countdown. Leaderboard locked at midnight. "Season Closing" event Room opens, hosted by Zobia, summarising the Season's top moments.

**Season Reset:**
- Competitive rankings reset to zero.
- Seasonal cosmetics become "Retired" — still visible on profiles but no longer earnable.
- All seven track levels are preserved (never reset).
- Prestige, Legacy Score, Credits, inventory, friends, creator history all carry forward.

### Season Pass

**Free Tier** — available to all users. Unlocks at Season milestones through normal play. Rewards: standard sticker packs, credit amounts, non-exclusive Season badge.

**Paid Tier** — price set by admin in x_manifest (default ₦500/Season). Unlocks additional reward nodes at the same milestones: exclusive cosmetics, animated profile frames, premium sticker packs, bonus XP events, ability to earn the Season's exclusive title. Can be gifted to other users.

The paid Season Pass is designed so that a consistent player earns enough credits through the pass to cover its own cost.

### Season Records on Profile

The profile permanently displays a Season History shelf — a visual timeline of every Season the user participated in, with final rank and any exclusive badges earned. This shelf is public.

---

## 9. Prestige System

### What Prestige Is

Prestige is a voluntary progression reset available only to users who have reached the maximum sub-level of Zobia Icon (Rank 10, Level III). Upon Prestige, the main rank resets to Beginner — but the user earns permanent exclusive rewards unavailable any other way.

Prestige is never forced. The platform asks: "You have mastered Zobia. Do you want to Prestige and begin again — with honour?" The user can decline indefinitely.

### What Resets and What Stays

**Resets:** Main rank level, main rank XP counter.

**Never resets:** All seven track levels and XP, Guild tier and war history, Season records and badges, Credits, inventory, friends, Legacy Score, creator subscriptions and revenue history, earned titles, badges, or cosmetics.

### Prestige Rewards

- **Prestige 1:** "Prestige I" profile frame, exclusive "Phoenix" title, 500 bonus Credits.
- **Prestige 3:** "Elder Candidate" marker, 3× XP boost for first 7 days of each new Prestige cycle.
- **Prestige 5:** Council application access, "Veteran Prestige" animated badge.
- **Prestige 10:** Hall of Fame entry, permanent Legacy Score top-100 visibility, custom crest option.

Each Prestige adds a star to the Prestige Badge displayed on the profile avatar.

### Mini-Badges (v2.10)

Three small badges render immediately after a user's display name anywhere a name appears — chat messages (Rooms), Moments, profile headers, and any other surface a username shows (`components/shared/UserBadges.tsx` on web, ported 1:1 to `apps/android/src/components/shared/UserBadges.tsx`), in this fixed order:
1. **XP-level dot** — a small colored circle, one color per rank tier (`lib/xp/engine.ts`'s ten ranks, Beginner → Zobia Icon).
2. **Prestige diamond** — a colored rhombus (an inline-SVG "card-suit diamond," not a fixed-color Unicode emoji, so each tier gets its own exact color and renders identically across web, PWA, and the Capacitor app) once a user has Prestiged at least once: Prestige 1 green, 2 orange, 3 pink, 4 sky blue, 5 yellow, 6 red, 7 teal, 8 indigo, 9 rose, 10 gold. Distinct from — and shown alongside — the star-based Prestige Badge on the profile avatar above, which is the fuller profile-page representation.
3. **Verified checkmark** — the existing blue checkmark (`components/shared/VerifiedBadge.tsx`) for `users.is_verified` accounts.

---

## 10. Room System

### What a Room Is

A Room is a public or semi-public group conversation space — the social and commercial heart of Zobia. If DMs are the platform's living rooms, Rooms are its town squares, marketplaces, classrooms, and arenas. Rooms are the primary unit of creator business on Zobia.

### Room Types

**Free Open Rooms**
- Discoverable by all users. Unlimited members (platform cap: 10,000 concurrent).
- Creator earns through gifting, tips, and sponsored content.
- Ad revenue share applies if Room has 500+ monthly active members.

**VIP Rooms (Gated Subscription)**
- Members pay a monthly subscription set by the creator (admin-configurable minimum and maximum; defaults ₦200–₦10,000).
- Non-subscribers can see a preview of the last 3 public messages to understand the value proposition.
- Creator receives 80% of subscription revenue; platform takes 20%.

**Drop Rooms (One-Time Entry)**
- Event-specific rooms with a one-time entry fee set by the creator.
- Room has a time limit (admin-configurable default: minimum 30 minutes, maximum 24 hours).
- After closing, a text-highlight replay can be published for a smaller replay fee.
- High-urgency, high-FOMO format.

**Tipping Rooms**
- Free to join. Creator earns entirely through gifts and tips.
- Designed for entertainers and live performers.
- Top tipper displayed prominently throughout the session.

**ClassRooms (Knowledge Rooms)**
- Structured educational format with a published curriculum.
- Students pay a one-time enrolment fee (creator-set).
- Defined start date, end date, optional graduation ceremony.
- Graduates receive a Zobia Learning Certificate (Knowledge Track Level 25+ creators can issue these).
- Assessment quizzes inside ClassRooms award bonus Knowledge Track XP (a quiz's XP reward is creator-set, capped at 500). Each member gets one attempt per quiz; correct answers are never sent to the client.
- Every ClassRoom is its own small community plus course — a self-contained, classroom-scoped space (there is no platform-wide classroom feed). It lives at its public homepage, `/c/<slug>`, which is crawlable for public classrooms and becomes the full member experience once enrolled:
  - **Community feed:** members start discussion posts under creator-defined categories (default: General, Announcements, Questions, Wins), like posts and comments, and reply in threads (one level deep). "Announcements" posts are reserved for the creator and moderators and notify every member. The creator can restrict new posts to themselves and moderators.
  - **Lessons:** the curriculum is a list of lessons, each with a title, description, written content (Markdown), an optional video link and resource links. Members mark lessons complete and see their progress; a lesson can be locked until the member reaches a given classroom level. Visitors only ever see the lesson outline.
  - **Live sessions & recordings:** the creator (or a moderator) schedules live sessions that run on an external platform — Zoom, Google Meet, Teams, YouTube Live — by attaching the meeting link. After a session, a link to its recording (a download or watch link hosted on Zoom cloud, YouTube, Google Drive or similar) can be attached so members can catch up. Meeting and recording links are visible to members only; members are notified when a session is scheduled and when its recording is added.
  - **Share & Boost:** anyone can share a classroom's `/c/<slug>` link (Web Share / copy link on web, the native share sheet on Android, which opens back into the app via App Links). The creator can Boost the classroom through the standard content-boost pipeline (§39.6) — a boosted classroom also ranks first in the classroom directory.
- **Classroom URL (slug) economy:** the create form suggests a unique slug from the name, which the creator can edit before creating. After creation, changing the slug is governed by a per-classroom policy the creator sets: either **fully free and uncapped**, or **N free changes, then X Credits per change** (default: first change free, then 500 Credits each), optionally limited to **once every N days or N months**. Each change is re-checked and charged in a single transaction, recorded in the classroom's change history, and every old URL permanently (301) redirects to the new one. A slug retired by one classroom can't be claimed by another.
- **Classroom moderators:** the creator can promote any enrolled member — paid or free — to moderator (up to 20 per classroom) and revoke it at any time. The creator decides what moderators may do: manage posts and comments (pin, lock, hide, delete), mute members, run live sessions, and review reports. Members can report posts and comments to the classroom's own moderation queue; an item reported by three or more members is escalated to platform staff (`/gate44/classrooms`).
- **Per-classroom gamification:** each classroom runs its own points, nine levels, badges and leaderboard (7 days / 30 days / all time), visible only inside that classroom. Members earn points when others like their posts and comments (1 point per like), and by completing lessons, passing quizzes and finishing the course. The creator can rename the nine levels and gate lessons behind them. Classroom activity also earns a smaller bonus on the global Knowledge Track, so it still counts toward the member's platform-wide profile.
- **Creator tools:** "My Classrooms" (`/classroom/by/<username>`) lists every classroom a creator runs, with a per-classroom switch to hide any of them from their public listing. The **Classroom Studio** summarises revenue, members and pending reports across all of a creator's classrooms, and gives each classroom its own panel: stats, lesson and quiz management, members and moderators, reports, live sessions, URL and settings (details, enrolment fee, dates, visibility, archive). Stats depth follows the creator's plan and creator tier — basic totals for Free/Rookie, activity and completion trends for Plus/Rising, and daily charts, lesson funnels and view-to-enrolment conversion for Pro/Max or Verified creators and above. Classroom earnings land in the creator's existing earnings balance and are withdrawn through the standard creator payout flow (bank transfer, Credits or crypto) — there is no separate classroom wallet. A classroom with paying members can be archived (no new enrolments) but not deleted.
- **Discovery:** the Classroom hub offers a searchable directory of public classrooms (by name, topic or creator; free/paid; most popular or newest) next to the member's Enrolled classrooms with their progress and level in each.
- **Draft & Publish:** a classroom is created unpublished (draft) — invisible to the directory, not enrollable, visible only to its creator and moderators — so the creator can build curriculum, pricing and settings at their own pace. Publishing is an explicit action in the Classroom Studio, with an option to also list it on the creator's public "Classrooms by" page. A classroom's public `/c/<slug>` URL is reserved immediately, even while still a draft, so the creator can preview it before publishing.
  - **Per-plan classroom limits** (draft + live combined, admin-configurable per plan via `/gate44/config`): Free 3, Plus 10, Pro 15, Max 20. Every paid plan gets access at any creator level; a Free-plan user must additionally reach a minimum creator level (default 5, admin-configurable) before creating a classroom at all.
- **Chat Room:** each classroom has an associated live chat Room (the same underlying Room the classroom itself is, reachable at `/rooms/<roomId>` and linked from the classroom homepage for enrolled members/moderators/creator). It's off by default and only Pro, Max and Business-plan creators may enable it (Classroom Studio → Settings); enabling it raises the classroom's total member cap to 150 (admin-configurable), with a target of 20 concurrently-active participants.
- **Enrolment payment:** paying with Credits shows a confirmation ("X Credits will be deducted from your Zobia Wallet. Proceed?") before debiting. Pay-by-card (Paystack) only appears when the fee is at or above ₦100 (Paystack's own minimum) and the payer is in Nigeria — otherwise Credits is the only option shown. A card payment that returns from Paystack checkout is reconciled by the client calling a dedicated verify endpoint (which independently re-checks the charge with Paystack and finalizes the enrolment itself if the webhook hasn't landed yet) with a bounded retry, instead of polling indefinitely against data that may never change.

**Guild Rooms**
- Available to Platinum-tier Guilds and above. Private to Guild members only.
- Used for war planning, coordination, and social bonding.
- Guild Rooms earn XP for all members who participate in daily Guild Room activity.
- Every Room type — including Free/Open, VIP, Drop, Tipping, and ClassRoom — requires a creator-eligible account to create; a user who isn't eligible for a given type never sees that type's create button (eligibility is resolved server-side, not just hidden client-side). **Admins bypass every creator-eligibility and Guild-tier gate** and can create/open any Room type, attaching a Guild Room to any guild regardless of tier or membership.

### Room Capacity & Soft Presence Caps (v1.7)

Each Room has a **soft concurrent-participant cap** enforced against **live presence** — who is actively viewing the Room right now — rather than persistent membership. Presence is tracked in Redis with a short TTL and a client heartbeat, so a slot frees automatically when a user closes the tab/app or goes idle; there is no "Leave Room" button. The Room creator and moderators always bypass the cap (soft enforcement). When a Room is at capacity, new viewers see a "Room is full" state and are not subscribed to its realtime channel — this is the primary control on realtime fan-out cost.

Per-room-type default caps are admin-configurable via the manifest (`/admin/config`), with sensible defaults (free/tipping = 30, drop = 100, classroom = 150, guild = 100, VIP = 200). A Room creator can spend Credits to **raise their own Room's cap** in fixed steps up to a hard ceiling (all amounts manifest-tunable). Discovery shows a **"Full" badge** on at-capacity rooms and offers an availability filter (All / Available / Full).

### Push, Realtime & Offline (v1.7)

Live delivery uses a configurable realtime provider (Ably by default) on web, PWA, and mobile, with an adaptive poll that backs off to a slow reconcile while the socket is connected and pauses while the app is backgrounded. Backgrounded/offline recipients receive **push notifications** for DMs and group messages, and for Room messages **only when @mentioned**. Each category (DMs, group chats, room mentions) has an independent push toggle in Settings. A persisted local message cache (localStorage on web/PWA, encrypted MMKV on mobile) renders recent messages instantly on open and keeps a usable view offline.

### Room Discovery

The discovery feed surfaces Rooms based on: city proximity, category affinity (from past Room activity and quiz responses), friends-in-room signal, trending score (activity in last 2 hours weighted heavily), and Creator Tier (Verified and Elite creators get discovery boosts). Rooms can be promoted using Credits for native paid discovery. Live availability (a "Full" badge and an availability filter) is also surfaced per the capacity model above.

Discovery tabs: **Trending**, **Near Me**, **Friends In**, **Recently Visited** (rooms the user has opened, most-recent-first), and **Faves** (rooms the user has favorited via the heart icon on any room card — this is the same bookmark mechanic as Room Pins above; favoriting/unfavoriting is subject to the plan's Room Pin limit). The feed supports both a **list view** (default — the scalable choice once a platform has tens of thousands of Rooms) and a **grid view**, matching the pattern already used on the Games discovery page.

### Room Moderation

Every Room creator is the primary moderator. Capabilities include: muting or removing members, setting auto-moderation rules (block links, restrict new members from posting for 24 hours, require approval for messages in large rooms), appointing co-moderators, and enabling or disabling specific message types per room.

The platform generates a community health score per Room — a rolling metric based on report rates, member churn, and moderator action frequency. Rooms with consistently low scores receive reduced discovery visibility.

---

## 11. Virtual Economy — Dual Currency Model

### Two In-App Currencies

Zobia operates a dual-currency economy designed to serve distinct psychological and financial functions.

#### Currency 1: Zobia Credits (Soft Currency)

Credits are the primary transactional currency for social and platform activities. They sit at the intersection of social gifting, platform economy, and creator monetisation.

**How Credits are acquired:**
- Purchased with real money via in-app purchase, Paystack (Nigeria), or crypto (international).
- Earned through quests and daily logins in small amounts.
- Received as Season Pass rewards.
- Earned through Guild War wins.
- Gifted between users.
- Rewarded via watching ads (free-tier users: up to 5 rewarded ads per day, earn Credits each).

**How Credits are spent:**
- Credit packs for gifts (social gifting).
- Room Spotlights, Message Pins, Member Highlights.
- Sticker packs, custom reaction sets, avatar items, message themes.
- XP boosters and quest boosters.
- Guild Treasury donations, Guild creation fee.
- DM costs (Credit-per-message or Credit-per-reply as per plan).
- Season Pass purchase (can be paid in Credits at a published credit:cash rate).

**Credits cannot be:**
- Converted directly back to cash by non-creators.
- Transferred in bulk outside the platform.
- Spent on anything with real-world monetary value outside of Zobia.

#### Currency 2: Zobia Stars (Prestige / Hard Currency)

Stars are a higher-value, harder-to-earn prestige currency designed for premium platform actions and long-term status.

**How Stars are acquired:**
- Earned through Prestige milestones (not purchasable with money directly).
- Awarded to top Season performers (top 10 nationally).
- Earned by achieving rare platform milestones (first in a city to reach Legend rank, winning 10 Guild Wars, etc.).
- Occasional platform-wide drops as rewards for engagement events.
- Can be purchased directly (at a higher price-to-value ratio than Credits) — admin can toggle this on or off.

**How Stars are spent:**
- Exclusive cosmetics, profile frames, and animated items not available for Credits.
- Unlocking rare titles.
- Purchasing limited-edition seasonal items when Credits are insufficient.
- Gifting Stars to other users (generates significant Generosity Track XP).

Stars are deliberately scarce. They signal that a user has been deeply engaged, not just willing to spend. Displaying Stars on a profile carries status that Credits cannot replicate.

### Credit Pricing (Default — Admin Configurable)

| Pack | Price (NGN) | Credits | Bonus |
|---|---|---|---|
| Starter | ₦200 | 100 | — |
| Regular | ₦500 | 300 | +50 |
| Big | ₦1,000 | 700 | +100 |
| Baller | ₦2,000 | 1,600 | +200 |
| Boss | ₦5,000 | 4,500 | +500 |
| Legend | ₦10,000 | 10,000 | +1,500 |

All prices stored in the database in the smallest currency unit (kobo for NGN). Admin can update prices at runtime via the admin panel without a deployment. Currency display is derived from the user's locale.

### The Credit Store

Accessible from any screen via the wallet icon. Contains:

**Avatar Items:** Profile frames (static and animated, 50–2,000 Credits), avatar borders, background scenes for the profile card, rare emoji variants.

**Message Enhancements:** Custom reaction sets (100–500 Credits per pack), animated sticker packs (150–600 Credits), message themes (coloured message bubble), "Premium Send" animation (per-message or subscription-based).

**Room Powers:** Message Pin, Room Spotlight, Member Highlight.

**Gift Items:** As detailed in Section 12.

**Boosts:** XP Booster, Quest Accelerator, Guild War Boost.

**Profile Themes:** color-skin themes for the profile page (a small admin-editable catalog, mirroring the existing Blog Theme system — §32), one free-default plus several paid tiers purchasable with Credits or Stars. Admin catalog management: `/gate44/profile-themes` (web) and `admin/profile-themes.tsx` (Capacitor Android), both against `/api/admin/profile-themes`.

### Gifting Between Users

Users can send Credits directly to any friend. Credit gifts are subject to a 5% platform transaction fee. The recipient receives the full amount minus the fee. Credit gifting generates XP for both sender (Generosity Track) and receiver (Social Track).

---

## 12. Gift Economy

### What the Gift Economy Is

The Gift Economy is the emotional and financial heart of Zobia's creator monetisation and social culture. It translates the cultural logic of public generosity — familiar across West African social contexts — into a digital format. When someone gives publicly, the act is as much about the giver's identity as the receiver's benefit.

### How Gifts Work

A Gift is a purchasable animated item. When sent:
1. The gift animation plays for the recipient (and room-wide in Rooms for gifts above the creator's configured minimum threshold).
2. The gift's coin value is displayed publicly during the animation.
3. The recipient earns Generosity Track XP for inspiring the gift; the sender earns Generosity Track XP for giving it.
4. The gift appears as a special message in the chat — prominent and impossible to miss.

In Rooms, high-value gifts trigger a room-wide spectacle: the message feed dims and the animation takes priority for 3 seconds.

### Gift Catalogue (Default — Admin Configurable)

**Tier 1 — Social Gifts (1–50 Credits):**
Flower (5), Cold One (10), Respect (15), Fire (25), Big Brain (40).

**Tier 2 — Flex Gifts (50–500 Credits):**
Trophy (80), Diamond (150), Crown (300), Rocket (400), Lion (500).

**Tier 3 — Boss Gifts (500–5,000 Credits):**
Money Bag (800), City Night (1,500 — animated cityscape), Stadium Roar (2,000), Legendary Crown (5,000 — animated gold with particle effects).

**Limited Edition Gifts:**
Each Season includes 2–3 exclusive gifts available only during that Season. Past Season gifts become "Retired" and cannot be gifted again — but receiving one is logged permanently on the recipient's profile.

### Gift Economics for Creators

When a gift is received by a creator inside their Room:
- The coin value is added to the creator's Gift Balance.
- At the platform payout rate (default 80%), the creator receives 80% of the gift's equivalent cash value.
- The platform retains 20% as the platform fee.
- Gifts received in DMs have the same split.
- Creators can set a minimum gift value for the full room-spectacle animation.

### The Top Gifter System

Every Room displays a "Top Gifters" leaderboard — updated in real time, showing the top 5 gifters in the last 24 hours. The current top gifter's name appears in the Room header. Achieving Top Gifter status in 3 or more Rooms unlocks a permanent "The Patron" badge on the Generosity Track.

### Room Custom Rewards

Distinct from the sitewide gift catalogue above, a room owner may fund and configure **one active Custom Reward** for their own Room at a time — a way to directly incentivise gifting them specifically, in that Room. Visible to every member (and the owner) on the Room page.

The owner picks:
- **Title** — a short name for the reward (e.g. "VIP Shoutout").
- **For the first N people** — how many distinct gift senders may claim it.
- **Reward action** — one of:
  - **Credits** or **Stars**: the owner pre-funds a pool from their own balance; it's split evenly among the first N distinct members who send them ANY gift while in the Room, and paid out automatically and immediately on that Nth-or-earlier claim.
  - **Custom text unlock**: no pool — each of the first N claimants is shown the owner's own free-text instructions for how to redeem it (e.g. "DM me your Discord tag for the VIP role"). The platform does not enforce or track fulfilment of a custom-text reward beyond notifying the claimant of the instructions; honouring it is between the owner and the claimant.

A member can only claim a given reward once. Configuring a new reward replaces the room's previous one (any unclaimed pooled funds are not automatically refunded to the owner — deactivate before replacing if a refund is intended, via support). The owner can deactivate their reward at any time without replacing it.

Site admins can disable this feature entirely (master flag), and configure the minimum account level a room owner needs to create a reward and a server-side ceiling on "first N people" (abuse/spam guard) — `/gate44/config`.

### Gift Messages ("Add a message")

When sending a gift, the sender may optionally attach a short text message — a collapsible "+ Add a message (optional)" link below the gift grid reveals a textarea. Before the gift is actually sent, the sender sees a confirm/preview screen showing the gift, the recipient, and the exact message text, with **Edit** and **Confirm & Send** actions (plain gift sends with no message skip this step and stay one tap, as before).

Eligibility and word limits are entirely admin-configurable, per plan/tier, at `/gate44/gifts/message-settings` (web) / `admin/gift-message-settings.tsx` (Capacitor Android):

- **Free plan** — gated by a minimum account level (default **Level 5**). Below that level, the message box does not appear at all. Once eligible, the default max length is **40 words**.
- **Plus** — on by default, max **50 words**.
- **Pro** — on by default, max **100 words**.
- **Max** — on by default, max **250 words**.
- **Business accounts** (Starter/Growth/Enterprise) — on by default, with the same increasing word-limit pattern as personal plans (default 50/100/250 words).

Every plan/tier's on/off toggle and max-word value is independently admin-editable, plus a sitewide master on/off switch and the Free plan's minimum-level gate. The word count is validated server-side (`POST /api/economy/gifts/send`) against the sender's plan, business tier (if any), and current account level — never trust the client-side counter alone. The attached message is stored on the `gifts` row (`message`, `message_word_count`) and surfaces in the recipient's DM/Room feed and both parties' gift history.

---

## 13. Guild System

### What a Guild Is

A Guild is a persistent team of up to 50 users who share a collective identity, compete together, build shared resources, and support each other's progression. Guilds are the social backbone of long-term retention. Individual commitment is fragile — social commitment is durable.

### Guild Creation

Creating a Guild costs 500 Credits. The founding user becomes the Guild Captain. They choose a Guild name, crest emoji, description (max 150 characters), city affiliation, and recruitment settings (open, approval required, or invite-only).

To create a Guild, a user must also: hold account rank level 4 (Baller) or above — admin-configurable via the `guilds.minLevelToCreate` manifest key, default 4 — and meet the minimum trust-score gate (30+, same mechanism used for Classroom creation). Both requirements are visible to every user before they attempt to create a Guild: the Guilds page shows a Create Guild button to everyone, and if the viewer doesn't yet qualify, it explains exactly which requirement (level, trust score, or Credit balance) they're short on rather than hiding the button outright.

### Guild Discovery & Access

The Guilds menu is visible to every user, not just Guild members — Browse Guilds (`/guilds`) is an open directory anyone can search, independent of whether they belong to a Guild.

**Capacitor Android:** `routes/guilds/index.tsx` mirrors the web directory,
and `routes/guild-discovery.tsx` mirrors the dedicated `/guild-discovery`
onboarding page (tier XP-boost badges, "Near you" badge, solo/"too new"
states) against the same `GET /guilds/discovery` and `POST /guilds/:id/join`
endpoints, linked from the guild directory header.

### Guild Roles

**Captain** — Full admin rights: treasury control, war declaration, member management, role assignment. One Captain per Guild.

**Veteran** — Appointed by Captain after 30+ days of consistent contribution. Up to 5 Veterans per Guild. Can approve membership applications, access basic treasury reports.

**Recruiter** — Designated growth role with a unique recruitment link. Up to 3 Recruiters per Guild.

**Member** — Standard role. Earns war points, participates in Guild Quests, gifts to the Treasury, views Guild analytics.

### Guild Tier System

| Tier | Guild XP Range | Min Members | XP Boost | Key Unlocks |
|---|---|---|---|---|
| Bronze I–III | 0–30,000 | 5–10 | +5% | Guild chat, profile badge, war eligibility |
| Silver I–III | 30,000–80,000 | 10–15 | +10% | City leaderboard, Guild Quests, Guild Treasury |
| Gold I–III | 80,000–200,000 | 15–20 | +20% | Sponsor Quest eligibility, Treasury coin vault (50,000 coin cap) |
| Platinum I–III | 200,000–500,000 | 20–25 | +30% | Alliance System, Private Guild Room, national leaderboard rank |
| Legend | 500,000+ | 25+ (all Baller+ rank) | +50% | RIZE co-marketing, custom animated crest, Guild Room revenue share (5%) |

### Guild Administration

Site admins (and, for the same scope, moderators) can fully administer any Guild from `/gate44/guilds` (Capacitor app: `/admin/guilds`):

- **Disable / Enable** — toggles a Guild's `is_active` flag, an indefinite reversible on/off switch.
- **Suspend / Unsuspend** — a temporary, reason-tracked state (who suspended it, when, and why), distinct from disable.
- **Ban / Unban** — a permanent moderation action (admin-only).
- **Edit details** — name, crest, description, city/country, recruitment type.
- **Transfer Captaincy** — reassign the Captain role to any other member; the previous Captain is demoted to Veteran (admin-only — this is the only way to change a Guild's Captain outside of the Captain doing it themselves, since there is no self-service "transfer ownership" flow yet).
- **Remove any member** — including the current Captain (removing the Captain requires a captaincy transfer first). This is a deliberate admin/mod override of the normal rule that Guild member removal is always a Captain's own decision — admins and mods bypass creator-level rules here the same way they already bypass Guild-tier gates elsewhere.
- **Delete** — soft-deletes the Guild and releases all members back to guildless (admin-only).

All destructive/identity-changing actions (ban, unban, admin notes, captaincy transfer) require full admin; moderators can disable/enable, suspend/unsuspend, edit details, and remove members.

Guild XP does not decay. The only way to lose tier is dropping below minimum member count for 7 consecutive days without recovery.

### Guild Treasury

A shared Credit wallet. Credits enter through voluntary member donations, war win bonuses, Guild Quest completions, and brand quest payments. The Captain can spend Treasury Credits on Guild-wide XP boosts, war entry fees, seasonal cosmetics, and monthly top-contributor payouts. All treasury activity is fully logged and visible to all members.

### Guild Wars

A 48-hour battle between two Guilds of similar tier. The captain declares war; an algorithm finds an opponent within ±15% of declaring Guild's XP. War Points accumulate from all member activities (messages, room sessions, daily quests, gifts, daily logins).

The Final Hour (last 60 minutes): all War Point earnings doubled. Every Guild member receives an opt-in push notification. The live score is visible to both Guilds throughout.

**Winner receives:** War Trophy, Guild XP award (500–5,000 based on opponent tier), Coin distribution to members by contribution rank, Seasonal War Points.

**Loser receives:** Participation XP (no member leaves empty-handed), a Rematch Token (50% discount on next war entry fee), immediate option to declare next war.

Maximum war frequency: once per 72 hours. Can reduce to 48 hours during platform War Events.

### Guild Quests

Weekly collective challenges reset every Monday. Examples: "Send a combined 1,000 messages this week," "Have 10+ different members complete daily quests 3 days in a row," "Gift 5,000 Credits collectively to users outside the Guild." Guild Quests reward Guild XP + coin bonuses and pull individual members toward more active engagement in service of a collective goal.

### The Alliance System

Available to Platinum Guilds and above. Up to 4 Guilds form a named Alliance that competes in weekly National Alliance Wars. All member War Points from all Alliance Guilds are pooled. The Alliance with the highest combined weekly score wins the National Alliance Trophy — displayed on all member profiles.

### Guild Contribution Score

Every member has a personal Contribution Score within their Guild — a rolling average of War Points, quest completions, treasury donations, and room activity. Visible to all Guild members. Members with consistently low scores (below Guild average for 2+ consecutive weeks) receive a platform alert. If the score does not improve, the Captain can demote or remove the member. Removal is always a Captain choice, never automatic.

---

## 14. Creator Economy

### Creator Tiers

| Tier | Threshold | Access | Earnings |
|---|---|---|---|
| Rookie | 0–99 Room members | Basic free rooms, tipping | Tips and gifts only |
| Rising | 100–499 members OR 30-day streak | VIP Room creation, broadcasts (3/month) | Subscriptions + tips + gifts |
| Verified Creator | 500+ members OR equivalent earnings | Verification badge, Quest Marketplace, ClassRooms, advanced analytics | All above + Sponsored Quests |
| Elite Creator | 2,000+ members OR equivalent earnings | Creator Fund eligibility, Merch Store, featured placement | All above + Creator Fund + Merch revenue |
| Zobia Icon Creator | Platform-selected, top 0.1% (invitation-based, reviewed quarterly) | Co-marketing, custom animated Room themes, early feature access | 85% revenue share instead of 80% |

### The Seven Revenue Streams

1. **Room Subscriptions:** Monthly membership fees for VIP Rooms. Creator receives 80%; platform 20%. Recurring and predictable.

2. **Gift Economy:** Gifts received inside creator Rooms paid out at 80% of coin value converted to cash at the standard coin rate.

3. **Paid Broadcasts:** Creators can send direct-to-DM Broadcast Messages to all followers. Free at Verified tier (3/month); additional broadcasts ₦200 per send. Brands can sponsor broadcasts.

4. **Sponsored Quests (Creator Quest Marketplace):** Brands publish Sponsored Quests. Verified+ creators apply to run them in their Rooms. Creator earns 70% of brand payment on meeting targets; platform earns 30%.

5. **ClassRoom Enrolment:** One-time enrolment fees for structured courses, paid with Credits or by card. Creator receives 80% (85% for Icon creators), credited to the same creator earnings balance as every other stream and withdrawn through the standard payout flow. The fee can be changed at any time from the classroom's settings; raising a free classroom to paid re-applies the Trust Score gate. ClassRooms scale without marginal cost once built.

6. **Creator Fund:** Platform-level fund distributed to eligible creators (Elite tier+) on the **5th of each month**, based on Room engagement score, member growth rate, quest completion rates, and content consistency. During International Women's Month (first week of March), female creators receive a 1.5× boost to their Creator Fund allocation.
   - **Funding (v2.10):** the pool accrues live, per-transaction, from five contributing activities — room subscriptions, room entry fees, Credit-pack purchases, branded-room sponsorships, and rewarded-ad payouts — each at an independently admin-configurable percentage (default 5% each, matching the original flat 5% design), editable at `/admin/config` under "Creator Fund" (`lib/creator/fundContribution.ts`). Admin can also manually top up the pool ahead of a distribution from the Financial Monitoring admin page (`POST /api/admin/creator-fund/topup`), with every top-up recorded to `admin_audit_log`. The prior "5% of the prior month's ad revenue, seeded on the 1st" design is retired — it depended on an ad-revenue figure nothing in the codebase ever actually wrote, so it had always contributed ₦0.

7. **Creator Merch Store (Elite tier+):** Mini storefront inside the Room for digital products, course materials, and (via logistics partner) physical merchandise. Creator receives 80% of Merch Store sales.

### Creator Dashboard

Accessible to Rising tier and above. Includes: revenue summary (today/week/month/all-time, broken down by stream), daily revenue chart with anomaly flags, member analytics (total, active, churn rate, average session time), top gifters, quest performance, payout history, Room health score.

### Creator Payout Mechanics

Admin has a master toggle to enable or disable creator payouts globally for all users at any time.

**Payout Methods by Region:**

*Nigeria:*
- **Bank transfer** — NGN payout directly to a verified Nigerian bank account via Paystack. Account verified using the Paystack Resolve Account API; a transfer recipient code is generated and stored at verification time.
- **Credits** — Payout credited as platform Credits (immediately available in the creator's credit wallet).
- **USDT/Tron** — Payout in USDT to a Tron (TRC20) wallet address provided by the creator (manual processing by admin).

Each of the three Nigeria methods can be toggled independently via the admin manifest.

*Global (non-Nigerian creators):*
- **Credits** — Payout credited as platform Credits.
- **USDT/Tron** — Payout in USDT to a Tron (TRC20) wallet address (manual processing only — no automated transfer).

**Bank Account Setup (Nigeria):**
Creators add their Nigerian bank account via a two-step flow: enter bank + account number, confirm the account name resolved via Paystack, then receive a transfer recipient code. The account number is encrypted at rest. Adding a bank account for the first time awards XP (5 main XP + 10 Creator Track XP, admin-configurable). A PIN encouragement modal is shown after the first successful add if the creator has no security method set.

**USDT Wallet Setup (Global):**
Creators provide a Tron (TRC20) wallet address. A prominent irreversibility warning is shown: funds sent to an incorrect address or wrong network are permanently lost and cannot be recovered. The creator must explicitly confirm this before saving. The address is encrypted at rest.

**Bank Account Snapshot:**
When a creator submits a payout request, their bank account details (bank name, account name, last 4 digits, recipient code) are snapshotted and stored with the payout record. Subsequent changes to the bank account do not affect in-flight payouts. Creators are shown this behaviour explicitly.

**Approval Modes (Nigeria bank transfer):**
- *Auto-approve mode* (default): payouts meeting the threshold and fraud checks are queued automatically for batch processing via CRON.
- *Manual mode*: all payouts require admin review before processing. Admin can approve, reject, set status to processing/completed/failed, or reject with a reason.

Manual mode is configured per-region via the admin manifest (`nigeria_payout_auto_approve`).

**Payout Processing (Nigeria bank transfer, auto mode):**
A batch CRON runs every 30 minutes (via an external cron service, e.g. cron-jobs.org). Batch size is admin-configurable (default 200). For each eligible payout, the CRON calls `paystack.initiateTransfer()` using the recipient code from the bank account snapshot. On success, status moves to `processing`; Paystack sends a webhook confirming `transfer.success` (→ `completed`) or `transfer.failed` (→ retry or DLQ).

**Retry & Dead-Letter Queue:**
Failed transfers are retried up to 3 times (admin-configurable) with exponential backoff (5 min, 15 min, 45 min). After all retries are exhausted, the payout is moved to a dead-letter queue, the creator's earnings are restored, and both the creator and admin are notified. Reversed transfers (bank returns the money) also restore the creator's earnings balance automatically.

**Minimum Payout Threshold:** Admin-configurable (default ₦1,000). Earnings below threshold roll forward.

**Payout Appeal Pipeline:**
When a payout is rejected, the creator may submit an appeal with a written reason. Admins review appeals and can approve (re-opening the payout) or dismiss them. Both outcomes notify the creator.

**Fraud Detection:**
Automated fraud checks run on every payout request:
1. *New-account gift inflow:* Large gift volumes from newly created accounts (< 7 days old) in the past 7 days trigger a manual review flag.
2. *Payout velocity:* More than 3 payout requests in 24 hours triggers a manual review flag.
3. *Trust score gate:* Creators with a trust score below 30 are always flagged for manual review.

Flagged payouts are not blocked — they are routed to `awaiting_approval` for admin decision. A critical-severity system alert is also created for admin visibility.

**Security Gate:**
Updating or removing a bank account or wallet address requires the creator to verify with their PIN, authenticator code, or password. If no security method is set, a PIN encouragement modal is shown after the first account add. When the creator authenticates with an authenticator code (TOTP), the same atomic Redis replay guard used throughout the platform applies: the code is marked `totp:used:<userId>:<code>` (TTL 90 s) via `SET NX` and rejected if already consumed.

---

## 15. Social Architecture

### Profile as Identity Document

A Zobia profile is a living record of everything the user has done, earned, and become.

**Profile Components:**
- Avatar with animated rank ring (colour and animation speed reflect current rank).
- Display name and username.
- City, "Playing since" timestamp.
- Prestige badge (if applicable).
- Current main rank with XP bar.
- Six track level displays (each with colour-coded fill bar).
- Active badges (current Season, Guild tier, earned titles).
- Season History shelf (visual timeline of past Seasons).
- Guild membership display with war record.
- Legacy Score.
- Creator card (if creator: top 3 rooms by member count with a "see all N rooms by this creator" link, subscriber count, total earnings optionally displayed).
- Public Achievements wall (top lifetime milestones).

### Profile Pictures

Users can set a custom uploaded photo as their avatar, cropped/framed with a Facebook-style pan/zoom/crop step (`components/profile/AvatarCropModal.tsx`), or pick one of the same default icons offered during onboarding — both from `Settings → Profile Photo`, on web and the Capacitor Android app alike, both against the same backend.

- **Paid-plan users** upload a custom photo for free. Downgrading to Free afterward never removes an already-uploaded custom photo — only the *upload/change action* is plan-gated, not the stored avatar.
- **Free-plan users** can still upload a custom photo by paying an admin-configured fee in Credits **or** Stars (their choice) — default 200 Credits or 1 Star, editable at `/gate44/config`. Switching to a **default onboarding icon** is always free, on any plan.
- **Animated GIFs are never stored animated**: an uploaded GIF is reduced server-side to its 2nd frame before storage — avatars are always static. This applies only to the avatar upload path; other image uploads (Tweets, Moments, the BB-style Forum) are unaffected and keep full animated GIFs.
- **Once-a-week cooldown**: any avatar change — a new custom upload, or switching between default icons — is limited to once every 7 days, tracked on a dedicated `users.avatar_changed_at` column.
- Charging and the avatar change are applied atomically in one DB transaction, so a failed change is never charged for.

### Username Change

Usernames are permanent by default, but eligible users may change theirs from Settings.

**Eligibility (admin-configurable, `x_manifest`).** A user qualifies if *any* apply:
- Account level (main rank number) ≥ a configurable minimum (default 5), **or**
- On a configurable set of plans (default: Max only), **or**
- Owns an active Business Account on a configurable set of tiers (default: Growth, Enterprise).

**Cost & frequency (admin-configurable).** 5,000 Credits **or** 50 Stars (user's choice, same "pick your currency" pattern as Moments), once every 90 days (admin-configurable cooldown).

**Flow.**
1. Pick the new username — a live, debounced availability check runs before the user may proceed; a name that isn't available can never reach the payment step.
2. Choose whether the old username should permanently redirect to the new profile, or not.
3. Confirm — eligibility, cooldown, and availability are all re-verified server-side inside one atomic transaction immediately before charging, so a race can never leave the account charged without being renamed, or renamed while the old name is still claimable.

**What happens to the old username:**
- **Redirect on** — `/u/<old>` redirects to the new profile forever; the old name is reserved indefinitely and can never be re-registered by anyone, including the original owner.
- **Redirect off** — for exactly one year, visiting the old username shows a distinct "this account no longer exists" message (not the ordinary "profile not found") and the name cannot be registered by anyone. After one year it's automatically released back into the available pool.

**Admin/mod visibility.** Every change is recorded (old/new username, timestamp, redirect choice, reservation expiry, amount paid) and surfaced as a "Username History" list on the admin user-detail page (`/gate44/users`), visible to admins and moderators.

### User Profile Stats Page (v1.98)

Every user's profile has a dedicated Stats page — a central hub for badges,
levels, achievements, created rooms, leaderboard positions, guild, and
social counts (friends, followers, following, referrals) in one place.

**Visibility.** Only the profile owner or a moderator/admin may open a
user's Stats page — it is never shown to other regular users. A "📊 Stats"
entry point appears on the owner's own profile (`/profile` quick actions)
and, for moderators/admins viewing someone else's profile, as an action
button on that user's public profile card. It is **loaded on demand only**
— clicking "Stats" is what triggers the fetch; it is never eagerly loaded
as part of the profile page itself, keeping the profile page light.

**Basic vs. Full.** The page has two depths, gated by plan/prestige tier:
- **Basic Stats** (default for Free users): profile summary (rank, XP,
  legacy score, prestige), all seven progression tracks, the full badges/
  achievements wall, created rooms (creators only), guild card, social
  counts, and a single "Main track, global scope" leaderboard position.
- **Full Stats** (default for Plus/Pro/Max, admin-configurable): everything
  in Basic, plus detailed leaderboard positions across every track and
  every scope the user belongs to (global, city, guild, active season),
  and full season history.

A dismissible "Unlock Full Stats" banner is shown to Basic-tier viewers on
their own Stats page, linking to Settings → Subscription.

**Admin control** (Admin ▸ Profile Stats, `/gate44/settings/profile-stats`):
- Master on/off toggle lives on the existing Feature Flags panel
  (`feature_profile_stats` — it is picked up automatically since it matches
  the `feature_*` convention). Follows the standard feature-flag visibility
  rules (see "Feature Flags" above): when off, every Stats button/link
  disappears from every profile/settings/wallet surface across web, PWA,
  and the Capacitor Android app — including a user's own profile — except
  for admins (and moderators, if the flag is added to the mods-visibility
  allow-list). A hidden link's page still 404s if visited directly.
- A separate settings page controls which plans/prestige tiers get the
  Full view via the `profile_stats_full_plans` manifest key (JSON array of
  plan slugs and/or `prestige_N` entries), default `["plus","pro","max"]`.
  Everyone not on the list gets Basic.

**Cross-platform.** Ships on web/PWA (`/profile/[userId]/stats`) and the
Capacitor Android app (`apps/android/src/routes/profile/$userId/stats.tsx`),
both backed by the same `GET /api/users/[userId]/stats` endpoint — reusing
the existing leaderboard engine (`lib/leaderboards/engine.ts`), rank engine
(`lib/xp/engine.ts`), and the plan/prestige eligibility helper
(`lib/plans/eligibility.ts`, shared with the profile-privacy gates) rather
than introducing parallel logic.

### Wallet Page — Rank, Badges &amp; Transaction History (v1.98)

The Wallet page (§11) surfaces a compact rank/badges summary — current
rank badge, prestige stars, and total badge count — with a "View full
Stats →" link to the user's Stats page above, so wallet visitors don't
need to leave to see their standing.

Transaction history on the Wallet page shows the **10 most recent**
transactions per currency tab (Credits / Stars) with a "Load more" control
that pages through older transactions via the existing cursor-based
pagination already exposed by `GET /api/economy/coins/balance` (`cursor` /
`star_cursor` query params) — no new backend pagination logic was needed,
only wiring the client up to read `nextCursor`/`nextStarCursor` from the
response.

### Relationship Types

**Friends** — mutual, confirmed. Both users see each other's DM feed, can gift each other without restrictions, appear in each other's social graph for leaderboard and Nemesis purposes. Friendship generates Social Track XP for both parties.

**Followers** — one-directional. Users can follow any public creator or public profile. Followers receive Broadcast Messages from followed creators. Following does not grant DM access.

### Privacy Controls (Settings → Privacy)

Every user can manage the following from Settings, identically on web, PWA and the Android (Capacitor) app:

- **Private profile** (Pro/Max, or Prestige 1+) — only friends can view profile details.
- **Hidden profile sections** (Plus/Pro/Max, or Prestige 1+) — choose which profile sections (avatar, bio, rank, XP, guild, seasons, badges) are hidden from other users.
- **Disable friend requests** (Plus/Pro/Max, or Prestige 1+) — stop receiving new friend requests.
- **Show online status** (Pro/Max, or Prestige 1+) — opt-in toggle controlling whether the user's presence (online / recently active) is surfaced to friends in the "Online Friends" row on the Home page. **Off by default.** Friends who have not opted in never appear in another user's Online Friends row, regardless of their actual presence — this prevents the "friends always show even when offline" experience users previously had when the row simply listed every accepted friendship with no presence filter.
- **Hide my name on leaderboards** (all paid plans incl. business accounts, or an admin-set account level) — appear as "Anonymous" on public leaderboards. **Visible by default.** Free users see the toggle greyed out with a small "Paid" tag. See §42.2.
- **Sitemap opt-out** (all plans) — exclude the public profile from the sitemap.

All plan/prestige eligibility thresholds are admin-configurable in `x_manifest` (`privacy_can_lock_profile`, `privacy_can_hide_sections`, `privacy_can_disable_friend_requests`, `privacy_can_show_online_status`, `privacy_hideable_sections`, `leaderboard_anonymity_enabled`, `leaderboard_anonymity_min_level`, `leaderboard_anonymity_eligible`) so they can be adjusted without a deployment.

### Android Settings Parity (Theme, Notifications, Subscription, Business)

Four Settings sub-areas that existed on web but not the Capacitor Android app were ported, each reusing web's own backend rather than adding new endpoints:

- **Theme (light/dark/system).** Android had no dark-mode mechanism at all before this — no theme context, no `dark:` Tailwind usage anywhere in its components (Tailwind's `darkMode: "class"` was configured but unused). `apps/android/src/lib/theme/{store,ThemeProvider}.tsx` add it: a pure client-side preference — matching web's `next-themes` choice to keep UI theme out of the server-synced chat-theme field — persisted with `@capacitor/preferences` (mirrored to `localStorage` for a flash-free first paint, the same two-tier pattern `lib/i18n` uses for language). The toggle lives at the top of `routes/settings.tsx`. Toggling it correctly flips the `dark` class on `<html>`, but since no other Android screen has been given `dark:` styling yet, it has no visible effect anywhere except future dark-styled components — retrofitting the whole app's existing screens was out of scope for this pass.
- **Per-category push notifications.** New `routes/settings/notifications.tsx` renders the same ten toggles as web's Settings → Notifications section (three chat-push toggles plus seven category toggles: new message, friend request, gift received, rank up, guild wars, season end, announcements), reading/writing `GET`/`PATCH /api/users/me/settings` — identical to web, no backend change.
- **Subscription & Billing.** New `routes/settings/subscription.tsx` shows current plan, renewal/cancellation date, and upgrade tiers, read from the same `GET /api/users/me` + `GET /api/economy/subscriptions` web uses. Per Play Store policy (§18), any actual purchase goes through Google Play Billing (`lib/payments/googlePlay.ts`'s `purchaseSubscription()`) instead of web's Paystack/crypto checkout redirect. Cancelling is a plain subscription-status DB write (`DELETE /api/economy/subscriptions/:id`) with no payment processor involved, so it's reused as-is. There is no "swap between two paid tiers" PUT the way web has — a Play-billed subscription can't be changed that way, so switching tiers on Android is just another Play purchase.
- **Business Account.** New `routes/settings/business.tsx` mirrors web's business page (info editing, verification workflow, tier comparison, analytics). Editing (`PATCH /api/business`) and verification request/cancel (`POST`/`DELETE /api/business/verify`) are plain DB writes with no payment involved, so they're reused directly. Creating the account and changing its tier are payment actions — web uses Paystack/crypto checkout flows, which Android cannot per §18 — so those route through `purchaseBusinessTier()`, which posts the verified Play purchase to the Android-only `POST /api/business/iap/verify` (already implemented, previously unused by any UI). A Play subscription renews itself automatically, so Android has no equivalent of web's manual "Renew Now" action.

### The Nemesis System

Platform-assigned rival updated weekly. Algorithm: within 10% of user's XP on their highest active track, same city preferred, same Guild tier preferred, never a mutual friend.

Displayed on home screen with current score vs user's score on the shared track, the delta, recent activity, and a "Challenge" button (sends a notification opening a 7-day XP sprint between the two users).

Notifications fire when: Nemesis overtakes user, user overtakes Nemesis, Nemesis completes a quest the user has not yet completed.

Users can dismiss a Nemesis assignment to regenerate a new one. Users cannot choose their Nemesis.

Eligible users (anyone who has been assigned a Nemesis at least once) can turn the Nemesis system off entirely from Profile Settings → Privacy. Opting out removes their current assignment immediately, exempts them from future automatic assignment, and excludes them from being selected as anyone else's rival.

If the challenged party does not accept a "Challenge" XP-sprint invite within an admin-configurable window (`nemesis_challenge_accept_days` in `/gate44/config`, default 3 days), the challenge expires and the challenger is assigned a new Nemesis so the rivalry stays active.

### The Platform Council

Monthly, the top 50 users by Legacy Score are invited to join the Platform Council — a user advisory body. Council members receive early feature access (2 weeks before general release), participate in monthly feedback sessions, receive a "Platform Council" badge, and can submit Feature Ideas (top idea per month gets a development commitment).

**Feature-flagged, membership-gated access.** The whole feature sits behind the `platformCouncil` flag (`/gate44/feature-flags`). Unlike most flagged features, the `/council` nav link and page are **not** shown to every regular user once the flag is on — they're visible only to (a) admins (always, as a management exception, matching the disabled-feature staff convention), and (b) users holding an active council seat (`platform_council_members`, `left_at IS NULL`) once the flag is enabled. Moderators get no separate mod-visibility exception here — the council is for members and admins, not staff at large. This is enforced both client-side (nav filtering in `Navbar`/`Sidebar`/`TopBar`) and server-side (the `(app)/layout.tsx` feature gate on web renders a plain 404 for a non-member/non-admin who visits `/council` directly; the Android app applies the same rule inside `routes/council.tsx`). `GET /api/users/me` exposes the caller's current seat as `is_council_member`.

**Membership reconciliation (monthly, 1st of month).** `cron/daily-notify` recomputes the current top 50 by `legacy_score` and closes out (`left_at = NOW()`) any active member who has fallen out of it, sending a `council_removed` notification (push + in-app) so they know their seat ended. This runs alongside the existing last-week-of-month invitation step, which sends a `council_invitation` notification to newly-qualifying top-50 users who aren't members yet; accepting via `POST /api/council/join` requires Prestige 5+ and a live invitation.

### Referral System — Two-Tier

Referral links use numeric IDs and not usernames (for privacy). URL format: `?r=471370973` (not `?ref=`, not `?utm=`).

**The `?r=` parameter may be attached to ANY public URL** — the landing page, a profile, a Room, a course or a game — and attribution still works. Examples:

- `https://zobia.org/?r=471370973` (canonical "share my profile" link)
- `https://zobia.org/u/joe?r=471370973`
- `https://zobia.org/r/dorcas-cuisine?r=471370973`
- `https://zobia.org/g/tapontap?r=8732623`
- `https://zobia.org/c/make-money-online?r=98423`

**Capture & attribution mechanics (cross-platform):** On web/PWA a global, render-nothing client component (`ReferralCapture`, mounted in the root layout) reads `?r=<code>` from the current URL on every navigation, validates it with the shared rules, and persists it to a first-party cookie + `localStorage` (`zobia_ref`, 30-day TTL). On native, an inbound deep/universal link with `?r=` is parsed at the app root (`useReferralCaptureFromLink`) and stored in MMKV. The stored code is replayed in the `/onboarding/complete` request and then cleared, so a later organic signup on the same device is never misattributed. The shared format helpers live in `@zobia/shared/utils` (`REFERRAL_PARAM`, `extractReferralCode`, `appendReferralCode`, `buildProfileReferralUrl`) so web, PWA and Expo stay in lock-step.

**Tier 1 (Direct Referral):** The referrer earns a Credit and XP bonus when their referred user completes onboarding and performs a specified qualifying action (configurable by admin — default: first credit purchase or 7-day streak).

**Tier 2 (Indirect Referral):** If the referred user themselves refers someone who qualifies, the original referrer earns a smaller Tier 2 bonus. The Tier 2 bonus amount is admin-configurable. Tier 2 referrals do not extend further (two tiers maximum).

The `/referrals` page shows a scannable QR code below the referral link (in addition to the copy-to-clipboard link), so the link can be shared in person without typing it.

**Every Share button doubles as a referral link.** Any Share action on the platform — games, polls, quizzes, classrooms, blog posts, tweets, Answers questions, wiki pages, and Market items — auto-appends the sharer's own `?r=` code to the shared URL via the shared `useMyReferralCode()` hook (web) / equivalent (Android) and `appendReferralCode()`. A user never has to visit `/referrals` to generate a referral link; sharing anything already produces one.

**Link visit/click tracking.** Because a `?r=` code can be attached to any public URL, `ReferralCapture` (web/PWA) and the Capacitor app's deep-link handler (`lib/deeplinks/referral.ts`) also record a *visit* — `POST /api/referrals/visit` — whenever a valid referral code is seen, whether or not the visitor ever signs up. This is tracked separately from the `referrals` table (which only records completed sign-ups/qualifications) so a referrer can see their link's actual reach, not just conversions. Visits are deduped in Postgres per (referrer, anonymous visitor, calendar day) — see `db/migrations/0004_referral_visits.sql` — so repeated page loads from the same browser/device never inflate the count; the client-generated `visitorKey` is a random, non-PII id (never an IP or fingerprint).

**Referral stats detail is plan-gated, admin-configurable.** `GET /api/referrals` returns a `statsTier` of `"basic"` or `"full"`, computed the same way as the Profile Stats gate (`lib/plans/eligibility.ts`, driven by the x_manifest key `referral_stats_full_plans`, editable at `/gate44/settings/referrals`; default: every plan/tier except Free). Free-plan users see totals only (referral counts, Credits/XP earned, all-time link-visit count); everyone else additionally sees the daily visit breakdown (last 30 days), top-performing pages, visit-to-signup conversion rate, and the per-referral list of who they've referred.

### Public URL Structure — SEO-Friendly Slugs

Public, shareable, crawlable surfaces use short, human-readable, SEO-friendly paths. The same scheme is used by the web app, the PWA and the Android app (as universal links):

| Surface | URL | Notes |
|---|---|---|
| Public profile | `zobia.org/u/joe` | Addressed by `username` |
| Room | `zobia.org/r/dorcas-cuisine` | Addressed by slug |
| Room (duplicate name) | `zobia.org/r/dorcas-cuisine2` | Numeric suffix, no separator |
| Course / classroom | `zobia.org/c/youtube-monetization-for-beginners` | Classroom-type Rooms; the classroom homepage. Slug is creator-chosen and changeable under the classroom's slug policy (§10); old slugs 301 |
| Game (upcoming) | `zobia.org/g/tapontap` | Backed by the `games` table |
| Forum question (Answers) | `zobia.org/a/what-made-you-join-zobia` | Public preview; interactive experience is at `/answers/<uuid>` (§31.0) |
| Blog | `zobia.org/b/munas-world` | Backed by the `blogs` table (§32); `/b/<slug>/<postSlug>` for articles/pages |
| Business Page | `zobia.org/p/cadbury` | Backed by the `business_pages` table (§17) |

**Identifier model — UUID is internal, slug is public.** Every Room/game keeps its immutable `uuid` primary key as the internal reference (foreign keys, realtime channels, API calls, internal app navigation `/rooms/<uuid>` all continue to use it). The **slug** is a mutable, human-facing **alias** that resolves to the UUID. Slugs are unique among live records via a partial index; duplicates of the same name get a numeric suffix (`dorcas-cuisine`, `dorcas-cuisine2`, `dorcas-cuisine3`), oldest record keeping the bare slug. Slugs are generated server-side from the display name (`slugify` in `@zobia/shared/utils` + DB dedupe in `apps/web/lib/slug.ts`).

**Backward compatibility (no broken links).** Legacy `/r/<uuid>` links and retired slugs (after a rename, tracked in the `slug_redirects` table) **301-redirect** to the current canonical slug URL rather than 404ing. The sitemap, OpenGraph `canonical`, and `robots.txt` all use the slug path.

**Cross-platform deep linking.** The Android app registers universal-link routes (`/u/[username]`, `/r/[slug]`, `/c/[slug]`, `/g/[slug]`) that resolve the slug/username to the internal UUID via `GET /api/public/resolve` and forward to the in-app screen. Android App Links (`/.well-known/assetlinks.json`) are configured for the active web domain via the `zobia://` custom scheme intent-filter in the AndroidManifest.

**Domain.** The canonical domain is configured via `NEXT_PUBLIC_APP_URL` (web) and `VITE_WEB_BASE_URL` (Android). It currently points at the Vercel deployment (`zobia.vercel.app`) during development and switches to `zobia.org` once the custom domain is connected — a single env/config change, no code edits.

**Commission-based referrals:** For creator affiliate scenarios, admin can configure a lifetime 5% cash commission on referred users' credit purchases, paid in Credits or cash depending on the admin's payout configuration.

### Market

`/market` unifies every purchasable thing on the platform into one browsable page — creator digital/physical items from the Creator Merch Store (§14.7), platform cosmetics/themes and Credit/Star packs (§11), and Boosts & Passes — so a user doesn't need to know whether something is "sold by a creator" or "sold by the platform" to find it.

**Sections**, each shown as a capped preview with a "View more" link to the full paginated list:
- **Sponsored** — creator items the creator (or admin) promoted, up to 2 grid rows.
- **Featured** — admin-curated creator and platform items, up to 2 grid rows.
- **Trending** — creator items only, weighted-random rotation so every active item gets discovered but items crossing a completed-order threshold show up more often — up to 2 grid rows.
- **Platform Store** — all active platform items, up to 3 grid rows.

**Categories:** Digital, Physical, Cosmetics & Themes, Boosts & Passes, Credits — filterable on the full listing.

**Sort:** price, popularity, or rating — rating and popularity apply to creator items only (a coin pack has neither).

**List/grid toggle**, matching the existing pattern on Rooms and Games.

**Admin:** `/gate44/market` (web) and `admin/market.tsx` (Capacitor
Android) manage Creator and Platform items — search, Featured/Sponsored
toggles — against the same `/api/admin/market` and `/api/admin/store-items`
endpoints.

**Qualified sellers:** Elite+ creators (per §14's tier table) or a verified, active Business account may open a Merch Store and list items — previously Business accounts were out of scope for merch.

**Referral program on individual Market items** (creator opt-in per listing, admin can enable/disable per item type platform-wide):
- **Digital items** use the platform's standard two-tier referral commission (§15's Tier 1/Tier 2 rates), applied to the item's price.
- **Physical items** use a creator-set commission percentage (minimum 1%) of the sale price — because unlike a digital good, the full price of a physical item isn't profit. The platform takes its standard creator-revenue cut (the same split used elsewhere, e.g. Merch Store's 80/20) out of that percentage first, and the remainder goes to the direct referrer. Example: a 1% commission pool of ₦1,000 is ₦10; the platform's 20% cut is ₦2, leaving the referrer ₦8. Physical-item referral commissions pay out to the direct referrer only (not Tier 2), since the pool is small. Awarded when the buyer confirms receipt, not at purchase, since a physical order can still be refunded before then.
- A referral-enabled item's card shows a collapsible panel (logged-in users only) with the commission rate and a ready-to-share link — the viewer's own referral code already attached — plus a one-tap copy button.

**Boosts & Passes admin catalog:** boost/multiplier types (XP Booster, Quest Accelerator, etc.) are managed from an admin catalog so new boost types can be added without a code deploy. **For the Capacitor Android app specifically:** any new purchasable product — a new boost type or any other new store item — requires a matching product to also be created in Google Play Console, since Google Play Billing only recognizes products it knows about; this is a manual step for admin whenever a new sellable item is introduced for the Android app.

**Daily quest:** a "Market Run" quest (in the regular daily quest pool) is completed by any Market purchase — a creator item, a cosmetic/theme, or a boost.

---

## 16. Notifications & Re-engagement

### Notification Philosophy

Notifications must never feel like interruptions. They must feel like invitations. Every notification Zobia sends must pass a simple test: would the user thank us for sending this?

### Notification Categories

**High-urgency (delivered immediately):**
- Guild War Final Hour alert.
- Mystery XP Drop received.
- Leaderboard rank change (entered top 10, overtaken by Nemesis).
- Friend sent a gift.
- Season reset in 24 hours.

**Medium-urgency (daily cadence):**
- Daily quest deck ready (sent at the user's typical wake-up time, inferred from past session data).
- Daily login streak reminder (after 20 hours since last login if streak is 7+ days).
- Room you follow is active with 50+ messages in the last 30 minutes.

**Low-urgency (maximum 1 per day):**
- "You're 200 XP from levelling up."
- "Your Guild is recruiting — invite a friend."
- "A creator you follow just opened a new ClassRoom."
- "Your Season Pass expires in 3 days."

**Silent (badge only, no sound/banner):**
- New message in a group chat (unless DM).
- Weekly contribution score update.

### In-App "New Notifications" Indicator

The notification bell (and the "Notifications" nav menu item) shows a small red dot whenever a notification has arrived since the Notifications page was last opened on that device — independent of read/unread state. Opening the page clears the dot immediately; it reappears only once a newer notification arrives after that. This is tracked per-device (localStorage, scoped by user id) so it never depends on marking individual notifications as read.

The same pattern applies to the **Inbox** ("Announcements" nav item) and **Messages** nav items: each shows its own red dot whenever something new has arrived there since that page was last visited on this device, clearing on visit regardless of whether anything was marked read, and reappearing only once something newer arrives. Each surface (Notifications/Inbox/Messages) tracks its own "last seen" independently.

### In-App Loading Feedback

Every tap/click that kicks off a network request (a page navigation, an API call) shows a small spinning-circle indicator near the top of the screen — overlaying any pulsing skeleton already on the page — after a brief delay, so a user on a slow connection can immediately tell whether their tap registered and the app is working, rather than wondering if it silently failed or their session expired. It's shown platform-wide (web, PWA, and the Capacitor Android app) with no per-page opt-in required.

### Email Notifications

Email is used sparingly. Free accounts: critical notifications only (password reset, account suspension, security alerts). Paid accounts: more liberal but still purposeful.

Admin can toggle: (a) ALL email off, (b) Non-Critical Email off. Where the plan allows, admin can also select specific email notification types individually.

Email provider: Mailgun.

### Re-engagement Sequences

- **3 days inactive:** Streak-at-risk notification if streak is 5+ days.
- **7 days inactive:** Highlight real events that occurred (Guild war outcome, Season progress).
- **14 days inactive:** Personalised narrative summary of what happened since they left.
- **30 days inactive:** "A new Season just started. Your rank is waiting. Your history is safe."
- **90 days inactive:** "We saved 200 Credits for you. They expire in 7 days." Credits are real and are actually reserved.

No SMS re-engagement of any kind.

### Floating Reward Notifications

When a user receives any positive currency award, a floating pill animation rises from the bottom of the screen, showing the reward amount (e.g., "+50 XP", "+25 Credits", "+5 Stars"). The animation fades out near the top of the viewport over ~2.5 seconds. Multiple notifications can stack gracefully.

**Trigger scenarios (additions only — never for deductions/spends):**
- Any XP award (quest rewards, daily login, gifts, etc.)
- Any Credits (coins) addition  
- Any Stars addition
- New user completing onboarding via the user's referral link → "+1 Referral"
- Daily quest deck completion → confetti + "Daily Quests Complete! 🎉" + individual reward notifications

**Confetti celebrations:** When a single award exceeds a per-currency admin-configured threshold, a canvas confetti animation also fires. Default thresholds: 100 XP, 50 Credits, 10 Stars. **Only earned or gifted inflows may celebrate** — refunds (e.g. "Reduced a poll reward pot", `*_treasury_refund`, `gift_refund`, `game_refund`), purchases, conversions and balance adjustments never trigger confetti however large (allow-list in `shared/utils/celebrations.ts`; see §42.3).

**Admin controls:**
- Feature on/off toggle in the manifest (default: on)
- Per-currency confetti thresholds (configurable via Admin → Config)
- Admin demo page (Admin → Notifications Demo) with buttons to preview every notification type and simulate quest completion

**Platform coverage:** Web app, PWA, and Android app. Implemented via `FloatingNotificationProvider` context.

---

## 17. Monetisation Stack

### Revenue Pillars

**Pillar 1: Subscriptions**
Plus, Pro, and Max plans as detailed in Section 3. Monthly and annual billing.

**Pillar 2: In-App Purchases**
Credit packs (Section 11), Star packs (where admin enables direct Star purchase), Prestige Cosmetic Pack (cosmetic-only prestige aura, does not grant actual Prestige), Guild Boost Pack, Season Starter Pack (available at Season launch only), pay-as-you-go booster packs.

**Pillar 3: Platform Advertising**

Zobia runs a full self-service ad control panel (`/business/ads`, linked from
the sidebar's own **Ads** entry and from the Business Account dashboard) on
top of admin-authored ads and AdMob, all sharing one moderation, billing,
and stats pipeline.

- **Who can advertise.** A user must own a **verified Business Account**
  (`business_accounts.verified = true`) whose owner holds identity
  verification of at least `ad_min_kyc_tier_to_advertise` (x_manifest,
  default KYC Tier 1 — §19.x). This is intentionally stricter than the
  Growth+ tier gate on Sponsored Quests, because ads carry real spend and
  platform-wide impressions. Admins are exempt and can author ads directly
  (`owner_type = 'admin'`) without a Business Account. Tier 3 (bank-grade,
  the highest identity tier, required for the largest selling/spend limits)
  is a manual in-person check — an admin/mod schedules the physical
  verification against `kyc_submissions.physical_verification_scheduled_at`
  / `physical_verification_notes` from the KYC review queue
  (`/admin/kyc`, `PATCH /api/admin/kyc/[id]/schedule`) before approving or
  rejecting the submission.
- **Ad formats & sizes:** square 300×250, mobile banner 320×50, full-screen
  interstitial, rewarded video, and native (in-stream/in-line). Ads may be
  in-house HTML/text creatives, native user/business ads, or (admin-only)
  raw third-party ad-network tags — rendered in a sandboxed iframe, never
  inlined, since a self-service advertiser must never be able to inject
  arbitrary script into the page. Every ad carries a small **"Sponsored"**
  label.
- **Placements** (admin-managed catalogue, `ad_placements`, each with its
  own base CPM): feed banner, messages banner, games banner, blog inline
  native, Business Page native, Room in-stream native, global interstitial,
  global rewarded video. **In free Rooms, one native ad is interleaved into
  the message stream after every `ad_room_instream_interval` messages**
  (default 10, x_manifest-configurable) — paid-tier Rooms never show
  in-stream ads. Paid plans get reduced or no ads platform-wide
  (`ad_plan_<plan>_ads_level` = full/reduced/none, default: Free = full,
  Plus = reduced, Pro/Max = none), plus the option to opt back in to
  Rewarded Ads for bonus Credits regardless of plan.
- **CPM billing.** Campaigns are billed **Credits per 1,000 impressions**
  (CPM). An advertiser funds a campaign's budget by moving Credits from
  their wallet into the campaign (reusing the existing coin_ledger,
  atomic/idempotent per §18) — Credits are acquired via the existing Credit
  Pack purchase flow (Paystack/crypto on web/PWA, Google Play Billing
  on Android) or bought/topped-up directly with cash, Zobia Credits, or
  Stars. Each impression/click is recorded to an append-only `ad_events`
  log and rolled up into `ad_campaign_daily_stats`; a campaign auto-pauses
  (`status = 'completed'`) once `spent_credits` reaches its budget.
- **Moderation.** Admin sets `ad_moderation_mode` to **manual** (admin
  approval queue at `/admin/ads`, same approve/reject pattern as Sponsored
  Quests and Business verification) or **AI** (the platform's existing
  DeepSeek/Gemini moderation pipeline reviews the creative and
  auto-approves above `ad_ai_auto_approve_threshold`, otherwise falling
  back to the manual queue).
- **Boosted content.** A campaign with `objective = boost_post` or
  `boost_room` promotes an existing Blog post or Room — same CPM billing,
  moderation, and stats as a standalone campaign, just carrying a reference
  to the boosted content.
- **Coupons.** Admin can issue promo codes (`ad_coupons`) for free or
  discounted ad budget (percent-off, flat Credits, or free Credits),
  redeemable once per campaign from the Advertising Panel.
- **AdMob (Capacitor Android only):** Banner, interstitial, and rewarded
  video ads via `@capacitor-community/admob`, additive to the in-house ad
  system above (Android shows both). AdMob configuration (App ID, ad unit
  IDs, test mode) lives in x_manifest and is fetched at runtime from
  `GET /api/manifest` — no fixed ad units hardcoded client-side. Ads are
  served only to Free-tier users; paid plans see no AdMob ads.
- **Rewarded Ads:** Free (and, if enabled, Plus) plan users can watch an ad
  to earn `ad_rewarded_credits_min`–`ad_rewarded_credits_max` Credits
  (default 10–20). Daily cap: `ad_rewarded_daily_cap` (default 5) per user,
  enforced with a single Redis `INCR` per claim (`POST
  /api/economy/rewards/ad-reward`, pre-existing endpoint, now
  manifest-configurable instead of hardcoded).
- **Stats & billing management.** Advertisers see campaign impressions,
  clicks, CTR, and spend at `/business/ads` (depth gated by Business tier,
  same convention as Business Page stats — totals only / + per-campaign
  breakdown / + 90-day daily drill-down for Enterprise). Admin sees a
  platform-wide revenue/performance overview, the moderation queue, the
  placement catalogue, and the coupon list at `/admin/ads`.
- **Branded Rooms:** Companies sponsor a dedicated Room. Appears in
  discovery with a "Sponsored" tag. Members who join earn a small coin
  bonus funded by the brand. Remains admin-arranged (contact-sales), not
  self-service.
- **Sponsored Leaderboard Banners:** Weekly leaderboards carry a single
  sponsor banner visible to all users viewing that leaderboard.
  Admin-arranged, not self-service.

**Pillar 4: Creator Platform Fees**
20% platform fee on all creator earnings — subscriptions, gifts, quest payments, ClassRoom enrolments, Merch Store sales. As the creator economy grows, this becomes an increasingly significant self-sustaining revenue stream.

**Pillar 5: Business Accounts (v2.02)**

Any user may create a Business Account — a paid, tiered upgrade layered on
top of their personal account (reusing the platform's existing payment,
verification, and moderation infrastructure rather than a parallel system).
A non-business-account user who opens the sidebar's **Business** link sees
an explainer of the feature, the three tiers with their pricing and feature
comparison, and **a separate "Get Started" button per tier** (Starter/Growth
self-serve checkout; Enterprise is "Contact Us", since its price is
negotiated) — signup is not limited to Starter. Web/PWA checkout is
Paystack/crypto (one-off charge, redirecting back to
`/settings/business/callback` on completion); Android/Capacitor signup and
tier changes go through Google Play Billing instead (§18), which handles
its own recurring renewal natively.

- **Business Starter:** Admin-configurable price (default ₦5,000/month).
  Verified business badge (on approval), broadcast capability, basic
  analytics (account-wide totals only), **up to 2 Business Pages**.
- **Business Growth:** Admin-configurable price (default ₦15,000/month).
  All Starter features, **Quest Marketplace access — self-service Sponsored
  Quests**, Room promotion credits, per-page analytics breakdown, **up to
  10 Business Pages**.
- **Business Enterprise:** Admin-configurable price (default
  ₦50,000+/month). All Growth features, custom Room theming, API access,
  dedicated account management, 90-day daily analytics drill-down + CSV
  export, **up to 50 Business Pages**. Branded Room sponsorship and
  Sponsored Leaderboard Banner placements (below) remain arranged directly
  with the platform team rather than self-service.

**Business Pages.** A Business Account can run one or more Business Pages —
its public-facing brand identity/profile, each with its own name, bio,
avatar/cover image, a lightweight post feed ("post stuff"), and view/post
stats. Pages are reachable at the public, SEO-friendly URL
`zobia.org/p/<slug>` (crawlable SSR, same slug/redirect convention as
`/b/<slug>` for Blogs — see §32.0). The number of pages a tier may create is
admin-configurable (`business_page_limit_<tier>` in `x_manifest`, defaults
2 / 10 / 50 above); deleting a page frees its slot. The account owner
manages all of their pages from a dedicated Business Pages dashboard
(`/business/pages`). **Adverts run by a Business Account (Sponsored Quests
today; Branded Rooms/Leaderboard Banners in future) are attributed to, and
publicly shown as coming from, the Business Page the owner selects at
creation time** — brand identity (name, logo) is copied from the page.

**Stats depth by tier** (mirrors the Blogs stats-tier convention, §32.1):
Starter = account-wide totals only; Growth = totals + a per-page breakdown;
Enterprise = the above plus a 90-day daily drill-down and CSV export
(`GET /api/business/pages/stats/export`). Depth and breadth of both page
stats (views, post views) and advert stats (impressions, clicks) increase
identically with tier.

**Advertising Panel** (`/business/ads`). Business Accounts link here from
their dashboard for a single hub over the platform's existing ads system
(Pillar 3). Growth+ tiers can self-serve-submit **Sponsored Quests**
(reusing the Creator Economy's Sponsored Quest Marketplace, §14) attributed
to one of their Business Pages — every submission **requires approval**
before it goes live. Admin chooses, per `x_manifest`
(`sponsored_quest_moderation_mode`), whether approval is **manual** (an
admin queue, same approve/reject pattern as business verification) or
**AI-moderated** (the platform's existing DeepSeek/Gemini moderation
pipeline reviews the brief and auto-approves above a confidence threshold,
`sponsored_quest_ai_auto_approve_threshold`, otherwise falling back to the
manual queue). Branded Room sponsorships and Sponsored Leaderboard Banners
remain admin-arranged (contact-sales) rather than self-service.

**Admin moderation.** Two dedicated panels, mirroring the platform's
existing verification-queue pattern: `/admin/business` (account
verification/suspend/restore — pre-existing) and `/admin/business/pages`
(pause/suspend/ban/restore/delete an individual Business Page). The
Sponsored Quest admin panel (`/admin/sponsored-quests`) gains an approval
queue for business-submitted (as opposed to admin-published) quests.

**Downgrades & grace period.** A tier downgrade is self-service (no
payment) and takes effect only after a **uniform 30-day grace period**
(admin-configurable, `business_downgrade_grace_days`) across all tiers —
the account keeps its current tier, page slots, and any live sponsored
quests until the grace period elapses. A downgrade can be cancelled at any
time before it takes effect. Once the grace period elapses: pages beyond
the new tier's slot limit are deactivated (oldest pages kept first), and
all currently-running sponsored quests are stopped. Reactivating a
deactivated page or resuming quests requires upgrading again.

**Billing period & renewal (web/PWA).** Paystack/crypto checkout is a
one-off charge, not a native recurring subscription — so
`business_accounts.current_period_ends_at` is set to now + 30 days on
signup, upgrade, and renewal, and is the source of the "business plan
nearing expiry" reminder (§3) via `business_plan_ends_at` on
`GET /api/users/me`. The daily-economy CRON sweep
(`lib/plans/subscriptionSweep.ts`) moves an account whose period has lapsed
into `status = 'grace'` for the same admin-configurable grace-period length
used elsewhere, then to `status = 'lapsed'` once the grace period itself
elapses — distinct from `status = 'suspended'`, which remains an admin
moderation action, not a billing state. A user can renew at any time —
proactively within 14 days of expiry, or after lapsing into grace/lapsed —
via **Renew Now** / **Renew Early** on `/settings/business`
(`POST /api/business/renew`, charges the account's current tier price
again and extends `current_period_ends_at`). Android/Capacitor accounts
don't need this — Google Play Billing renews them natively.

**Business plan expiry reminder** (§3) and the pending-payment guard below
both apply on the Business hub (`/business`) as well as Home, per §3.

**Business Broadcasts.** A Business Account can message its own followers
(opt-in audience — not "all site users", which remains an admin-only bulk
tool, §20) from `/business/broadcasts`, metered per calendar month by tier
with no pay-per-send overage (the account already pays a subscription):
Starter 3/month, Growth 10/month, Enterprise unlimited. Sends are recorded
in `creator_broadcasts` tagged with `business_account_id`, kept separate
from a user's own personal creator-tier broadcast quota (§14) so the two
never bleed into each other when the same person is both a Business Account
owner and a personal Creator.

**Business Panel** (`/business`, "has an account" view). A control-panel
hub: quick status header (tier/verified/status badges, downgrade notice),
link cards to Account & Billing, Business Pages, Advertising Panel, Stats,
and Broadcasts, a quick preview of up to 3 Business Pages with slot usage
(full CRUD at `/business/pages`), and a "More Features" row surfacing
tier-gated capabilities (Sponsored Quests, Custom Room Theming, API Access)
— shown enabled and linked when the account's tier qualifies, or dimmed
with a "`<tier>`+ only" chip linking to the upgrade flow otherwise. Settings
→ Business Account → **Manage** links here (`/business`), not directly to
the billing sub-page.

**Payment edge cases (web/PWA).** Only one signup/upgrade/renewal payment
may be pending at a time (`SIGNUP_ALREADY_PENDING` / `UPGRADE_ALREADY_PENDING`
/ `RENEWAL_ALREADY_PENDING`, 30-minute TTL) — the error names when it
expires, and the UI offers a **Cancel Pending Transaction** button
(`DELETE /api/business/pending`) so an abandoned Paystack checkout (e.g. the
user closed the tab mid-payment) doesn't force a 30-minute wait before
retrying.

---

## 18. Payments, Payouts & Financial Integrity

### Inward Payments (Credit Purchases and Subscriptions)

| Platform | Nigeria | Rest of World |
|---|---|---|
| Android App | Google Play Billing only (via react-native-iap) | Google Play Billing only |
| Web / PWA | Paystack (primary) + crypto (admin-toggled option) | crypto |

Google Play Billing is the exclusive in-app purchase mechanism on Android — this is a Google Play Store policy requirement. Paystack and crypto are web/PWA-only and must not be integrated as in-app purchase flows within the Android APK itself.

### Outward Payments (Creator Payouts and Commissions)

| Market | Provider |
|---|---|
| Nigeria | Paystack |
| Rest of World | crypto |

The active payout provider is configured in the x_manifest before building. Both providers are supported in code simultaneously — the manifest variable determines which is active per deployment or per market. Admin can also configure commissions to be paid in Credits instead of cash, eliminating cash payout complexity at early stages.

### Withdrawal Thresholds and Manual Approval

- Withdrawals above a configurable threshold (default: ₦50,000 or equivalent) require manual admin approval before processing.
- The rationale: ensures the payout account holds sufficient cash before disbursement.
- A monitoring and alert system tracks payout account balances and triggers alerts when the balance drops below a configurable low-water mark.
- The admin receives a push notification and email when the payout balance is low or when a large withdrawal is pending approval.

### Financial Integrity Requirements

All financial operations must satisfy the following properties — the developer must treat these as non-negotiable:

- **Atomicity:** All balance changes (debit + credit) happen in a single database transaction. No partial writes.
- **Idempotency:** All payment webhook handlers and API endpoints that process financial events must be idempotent. Re-delivered webhooks must not cause duplicate credits or debits.
- **Decimal Precision:** All monetary values use Decimal.js or equivalent. No JavaScript floating-point arithmetic for financial calculations.
- **Amounts in smallest unit:** All prices stored in the database in the smallest currency unit (kobo for NGN, cents for USD/EUR). Display layer converts to major unit.
- **Re-entrancy protection:** Coin spend and gift operations are protected against concurrent duplicate requests. Use database-level row locks or optimistic concurrency.
- **Accounting integrity:** All coin movements are logged to an immutable ledger table with before-balance, after-balance, transaction type, reference ID, and timestamp. This table is append-only.
- **Race condition prevention:** User balance reads and writes use SELECT FOR UPDATE or equivalent. Concurrent requests to spend the same credits must be serialised.
- **MEV / front-running protection:** Not applicable to a centralised platform, but all payout ordering must be time-ordered and deterministic.
- **Payout fraud monitoring:** Flag creators whose payout patterns are anomalous (e.g., large gift inflows from newly created accounts followed by immediate payout requests). Escalate to admin review.
- **Database-level is_admin check:** Admin privilege checks must verify against the database role, not just session claims. JWT claims alone are insufficient for financial and admin operations.

---

## 19. Trust, Safety & Community Health

### Community Standards

Prohibited content and behaviours:
- Hate speech, tribalism-based harassment, or ethnic targeting.
- Sexual content of any kind in public Rooms or DMs.
- Financial fraud, Ponzi promotion, or investment scam content.
- Impersonation of other users or brands.
- Spam and artificial XP manipulation (bot activity).
- Links, phone numbers, and email addresses in public chats or Rooms (except in designated profile areas or by group/room admins).

### Moderation Architecture — Three Layers

**Layer 1: Automated (rules-based)**
- Anti-spam filters for links, phone numbers, emails in public areas.
- Profanity filtering (configurable wordlist, admin can extend).
- Duplicate message detection.
- Bot detection signals (message velocity, account age, behavioural patterns).

**Layer 2: Crowdsourced**
- Any user can report a message, Room, user profile, or Guild inline.
- Community Notes feature (admin can toggle on/off): users can append contextual notes to flagged content (Wikipedia-style community fact-checking).
- Reports are auto-categorised by an AI classifier (DeepSeek primary, Gemini fallback) into: harassment, spam, fraud, sexual content, or other.
- Report outcomes are communicated back to the reporter with a general resolution status.

**Layer 3: Human Moderators + AI Escalation**
- Dedicated users can be upgraded to Moderator roles by admin.
- Categorised reports are escalated to human moderators in priority order.
- Advanced moderation (edge cases, appeals, complex context) is escalated to DeepSeek AI with Gemini as fallback. This escalation is used sparingly given cost.
- Admin receives a daily moderation digest and real-time alerts for critical escalations.

### Moderation Center (v2.10, moved to `/watch56` + Forum Mods in v2.17)

A standalone area at **`/watch56`** (outside `/gate44`; renamed from `/moderation` — an externally-reachable URL like `/admin` or `/moderation` is a bad idea per defense in depth, so the path is deliberately non-descriptive). It is never linked from any public page, carries no entry in `sitemap.xml`, and is never mentioned in `robots.txt` (a disallow rule would itself advertise the path). An unauthenticated visit gets the ordinary, generic login page — never anything labelled "Admin" or "Moderator" — because the route sits under the normal authenticated app, not the separate `/gate44` admin-JWT gate. It is reachable by Platform Mods, Forum Mods, and Admins:

- Admin gets a link to it from the Admin nav (web sidebar + hamburger, Capacitor hamburger) as well as their own full `/gate44/moderation` queue.
- Platform Mods get the same nav link, mirroring how the Admin link appears there for admins.
- Forum Mods (see below) reach it via a "Open the Guild Queue" link on their guild's page, and see only the tabs their scope grants them.

It unifies:
- **Reports** — the sitewide report queue (`GET/POST /api/admin/moderation`), `withModeratorOrAdminAuth` — Platform Mods and Admin only.
- **Forum Queue** — Answers question/answer reports (`/api/admin/forum/queue`), Platform Mods and Admin only.
- **Guild Queue** — reports scoped to a Guild or a guild chat message (`GET /api/guild-moderation`, action via `POST /api/guild-moderation/[reportId]/action`) — visible to a Forum Mod/captain for their own guild(s) only, or to Platform Mods/Admin across every guild.
- **Audit Log** (Admin-only tab) — `GET /api/admin/moderation/audit`, every *manual* moderation action (`moderation_actions` where `actor_type = 'manual'`) with the acting moderator's username, distinct from the existing automated-actions log which only ever surfaced system/AI-driven actions. Automated auto-quarantine actions (see "Reporting" flood control below) also land here (`actor_type = 'automated'`).

Every resolved report shows which mod/admin acted on it (`resolved_by_username`) — visible only within this mod/admin-gated area. Any manual action can be reversed (`POST /api/admin/moderation/actions/[actionId]/reverse`, Platform Mods/Admin only) — restores removed content, lifts a suspension/ban/mute, credits back a warning, and resets the report to `pending` for re-review; reversing a ban or an AI escalation requires the same capability as taking it forward (see below).

#### Platform Mods and Forum Mods

Two distinct moderator tiers:

- **Platform Mods** (`users.is_moderator`, granted by Admin) — sitewide jurisdiction across the whole Reports/Forum Queue/Guild Queue surface.
- **Forum Mods** (`guild_members.is_moderator`) — scoped to a single Guild ("forum" here means Guild — Guilds already have a creator/owner and member roles), no sitewide jurisdiction at all. Assigned by that guild's captain (or an Admin) at `POST /api/guilds/[guildId]/moderators` (list: `GET`, revoke: `DELETE`) — managed from a "Forum Mods" panel on the guild's own page, visible to the captain (who can toggle any non-captain member) and to existing Forum Mods (read-only list).

Each tier's available actions are **fully admin-configurable, per action**, at `/gate44/moderation/settings` (also under `/gate44/config`) — Admins can always perform every action regardless of these flags; a non-admin mod is gated by them:
- Platform Mod actions: `dismiss`, `warn`, `remove_content`, `suspend_user`, `ban_user`, `escalate_ai`. Reasonable defaults: everything on except `ban_user` and `escalate_ai` (off by default — an admin can grant either).
- Forum Mod actions (guild-scoped only — never a sitewide action): `dismiss`, `warn`, `remove_content`, `mute_member`, `kick_member`. Reasonable defaults: everything on except `kick_member`. A guild's own captain always bypasses these flags within their own guild, the same way an Admin bypasses them everywhere.

### Reporting

Any user can report a message, guild chat message, Room, user profile, Guild, Answers question/answer, or old-school Forum thread/post inline (`POST /api/reports`). The response is always a generic 200 — a reporter never learns the outcome from the request itself, only via an in-app notification once resolved.

**Rewards (admin-configurable at `/gate44/moderation/settings`, reasonable defaults shown):**
- A report that is **accepted** (any resolution other than dismiss) pays the **first** person to report that target 50 Credits + 50 XP; every **subsequent** reporter of the same target gets 50 XP only (no Credits).
- A report that is **not accepted** (dismissed) pays every reporter (first and subsequent) 1 XP.
- A report the reviewing mod/admin marks **malicious or spammy** pays no reward — instead the *original* (first) reporter's Trust Score is docked (default: 1 point). Reporters who merely piled onto an existing report are treated as ordinary "not accepted" reporters (1 XP) — they didn't originate the bad-faith claim, they had no way to know it was one.

**Flood control (duplicate reports on the same content):** hundreds of people reporting the same bad post would otherwise flood the queue with near-identical rows. Instead, every report against the *same target* within a rolling window (admin-configurable, default 24h) folds into the *one* existing pending report — bumping a `duplicate_count` shown in the queue and recording each additional reporter (for reward/penalty purposes) without creating a new queue entry. If the number of distinct reporters against a target crosses an admin-configurable threshold (default: 5) before a moderator has reviewed it, the target is **automatically quarantined** (soft-hidden) pending review — logged as an `automated` moderation action so it's visible in the Audit Log and reversible exactly like a manual "Remove Content" action. Auto-quarantine currently covers chat messages, guild chat messages, and old-school Forum posts/threads; other target types (Rooms, Guilds, user profiles, Answers Q&A) are not auto-hidden but are still boosted to the top of the queue by their duplicate count.

### Trust Scores

Every user has a private Trust Score derived from: account age, report rate vs report outcomes, verification status, and payment history. Trust Scores are never shown to users. They silently gate certain high-sensitivity features — for example, a new user cannot immediately create a paid ClassRoom; they need 30 days and a minimum Trust Score. A report marked malicious/spammy docks the original reporter's Trust Score (see "Reporting" above).

### Suspended and Banned Users

- Suspended users cannot send or receive DMs during the suspension period.
- Senders receive a generic notice that the recipient's account is temporarily unavailable.
- Suspended users cannot create Rooms, post in public areas, or participate in Guild Wars.
- Temporarily banned users cannot receive Credits, gifts, or payouts during the ban period.
- Permanent bans result in account deactivation. Creator payouts are held and reviewed before release.

#### Login-time UX (v2.32)

- A **banned** account attempting to log in sees a distinct, translated
  message — "Your account has been terminated." — behind a distinct error
  code, not a generic error. A **suspended** account sees the specific
  suspension reason, the exact date/time the suspension lifts (localized),
  and a link to file an appeal. Both are mirrored on the Capacitor Android
  app's native login screen.
- Repeated login attempts against an account already known to be
  suspended/banned are rate-limited tighter than ordinary login attempts
  (`RATE_LIMITS.loginBlocked`, 5 / 15 min, keyed by user id) so the
  suspension/ban notice can't be hammered past.

#### Account Appeals pipeline (v2.32)

- **Identity-gated submission only.** An appeal can only be filed
  immediately after a real login attempt with correct credentials that was
  then blocked by the suspension/ban check — never through a public
  "email us" form. The blocked login issues a short-lived, single-use
  signed appeal link; the appeal form is reached only through that link,
  pre-fills the account's email as the contact address, and lets the user
  optionally supply an alternate contact email (their account email may be
  inaccessible).
- **Outcome timing**: on submission, the user is told a reply may take
  several days and will be sent to the email they provided.
- **Review**: `pending` → `approved` (lifts the suspension/ban — the exact
  same action as an admin's direct "Restore" — for one place that action
  lives) or `denied` (increments a per-appeal refusal counter). Default
  review mode is fully manual; an admin may opt into an AI triage pass
  first (recommendation + confidence + reasoning, shown to the reviewer,
  never auto-deciding). Reviewed at `/gate44/moderation/appeals`.
- **Refusal cap** (admin-configurable, default 3): once a user has been
  denied that many times for the same suspension/ban, no further appeals
  for it can be submitted.

### Anti-Bot & Anti-Spam

- Rate limiting on all message-send endpoints (configurable by tier).
- CAPTCHA required at registration and on suspicious activity signals.
- IP-based rate limiting and geolocation anomaly detection.
- Velocity checks: accounts sending more than a configurable message volume in a short window are flagged and rate-limited.
- Defense against link shorteners and redirect chains in public areas.

---

## 20. Admin Dashboard & Monitoring

### Design Philosophy

Admin interaction should be minimal and maintenance-oriented. The platform runs itself. Admin's ongoing role is: keeping the platform running, maintaining financial health, high-level moderation oversight, and managing configuration. Dedicated moderators handle content moderation day-to-day.

### Admin Panel Architecture

- Web-based admin panel (separate from the user-facing interface).
- Authentication: email + password + mandatory 2FA (authenticator app). No Google OAuth for admin login.
- is_admin checked against the database on every admin API call, not just session data.

### Admin Dashboard Sections

**Platform Overview**
- Daily/weekly/monthly active users.
- New registrations (today, this week).
- Revenue summary (subscriptions, coin sales, creator platform fees) — today, this week, this month.
- Active Rooms, active Guilds, active Guild Wars count.
- Moderation queue depth (pending reports).

**Financial Monitoring**
- Payout account balance with low-water alert status.
- Pending withdrawal approvals (withdrawals above threshold requiring manual approval).
- Coin economy summary: total Coins in circulation, Credits purchased vs Coins earn Credits spent.
- Revenue by payment provider (Paystack / crypto / Google Pay split).
- Anomaly alerts: unusual spike in credit purchases, creator payouts, or refund requests.

**User Management**
- Search users by username, email, or ID.
- View user profile, plan, trust score, payment history, report history.
- Suspend, ban (temporary or permanent), or restore users.
- Upgrade users to Moderator role.
- Reset user passwords, force 2FA, manually verify accounts.

**Signups Toggle** — a master on/off switch for new account creation (`signups_enabled` x_manifest key, default on). When off, a Google/Telegram sign-in for an account that doesn't yet exist is refused with a clear "New signups are paused" message (`/auth/error?code=signups_disabled`); existing users are entirely unaffected and can always still log in. Editable in two places, both writing the same key: the central site settings panel (`/gate44/config`) and a Settings tab on the User Management page (`/gate44/users`) — kept in sync by inline code comments in both files noting the mirror. Mirrored on the Capacitor Android app's `admin/users.tsx` Settings tab.

**20.x Data Management Utility** (`/gate44/data-management`)

A dedicated bulk-data utility, separate from the per-user search/detail flow
above (which stays focused on moderation actions against a single account).

- **Three tabs:** Users (default), Financial, Statistical. Each shows a row
  of quick-stat cards (totals/averages relevant to that tab) at the top.
- **Cached stats, minimal Redis usage:** stat cards are cached in Redis for
  30 minutes rather than computed live on every page load, with a manual
  "Refresh live data" button that bypasses the cache on demand. This is a
  deliberate choice to minimize Redis calls given free-tier plan limits
  (Vercel/Redis) — no live-updating stats, no polling.
- **Granular data export:** admin picks an output format (CSV, TSV, or
  XLSX), which fields to include from a safe allowlist (never password
  hashes or other secrets), and filters — e.g. "export the emails of all
  users at trust score ≥ 80", "export the IDs of every banned user in
  Nigeria", or "export the ID of the #1 XP earner on the leaderboard".
  Built to scale to millions of rows: cursor (keyset) pagination in bounded
  batches, never `OFFSET`, streamed directly into the response.
- **Full-account export/import (install migration):** a separate,
  explicitly-flagged NDJSON export of complete user accounts, used to move
  users between two separate Zobia deployments/installs — not the same as
  the granular export above. Secrets (password hash, TOTP secret) are
  excluded by default and only included when the admin opts in, since doing
  so makes the export file as sensitive as a database backup. Import runs as
  a chunked background job (bounded batches, polled to completion) and
  dedupes incoming rows against existing accounts by email, username, or ID
  — admin chooses whether a match is skipped or has its safe fields
  overwritten; importing can never grant admin access.
- **Individual account lifecycle:** admin can create a new user by hand
  (mirroring the same defaults a Google/Telegram sign-up would produce,
  since there is no email/password signup flow), edit a safe field
  allowlist on an existing account, or soft-delete/anonymize one — all
  audit-logged, and an admin account can never be deleted this way.

**Reporting Content (User-Facing)**
- The reasons shown to a user reporting content are, in order: Scam/Fraud, Spam, Fake Account, Inappropriate Content, Hate Speech, Violence, Misinformation, Self Harm, Other. "Harassment" is not offered as a user-facing reason (it remains a valid internal moderation category the AI classifier can still assign).

**Content Moderation**
- Moderation queue with report categorisation.
- AI-generated confidence score per report.
- One-click actions: dismiss, warn user, remove content, suspend user.
- Escalation history per user.
- Community Notes review panel (if feature enabled).

**Automated Actions Log**
- Real-time log of all automated moderation actions (content removed, users flagged, XP drops triggered, Mystery Drops fired).
- Filterable by action type, date range, user.
- Admin can reverse any automated action with a note.

**Financial Integrity**
- Full immutable ledger of all coin movements, readable by admin.
- Creator payout approval queue.
- Refund management interface.

**Quests Catalog** (`/gate44/quests`)
- The base catalog of `quest_templates` rows the daily deck engine (§7) draws from — the third quest-admin surface alongside the temporary per-feature "Campaign Boosts" at `/gate44/quests/boosts` (weighting only, no template editing) and the advertiser-funded `/gate44/sponsored-quests` (whose own shadow `quest_templates` rows are excluded here and stay owned by that page).
- **Editable per quest:** title, description, XP reward, Credit reward, target count, category, icon, minimum plan required, parallel progression track, feature-flag dependency (or none), and active/inactive. Admin can also create brand-new quest templates, picking the action type from a fixed dropdown (see below).
- **Read-only / genuinely hardcoded, not faked as editable:** a quest's `action_type` is fixed once created — it is the exact string ~20 separate feature endpoints (polls, quizzes, wiki, forum, gifts, messages, etc.) call `triggerActivityQuestProgress()` with to advance that quest, so changing it after creation would silently disconnect the quest from the code that's supposed to progress it. The daily deck size per plan (Free 3 / Plus 4 / Pro 5 / Max 6) and the 500 XP full-deck completion bonus are hardcoded constants in `lib/quests/questEngine.ts`, not data, and are surfaced as read-only notices on the page rather than implied to be configurable. Sponsored-quest injection odds and default CPM are genuinely admin-editable data, but live at `/gate44/config` (`x_manifest` `sponsored_quest_*` keys) — linked from this page, not duplicated.
- **Stats:** each quest shows its assignment and completion counts, and a computed completion rate, over the trailing 30 days.
- All create/edit/toggle actions are audit-logged to `admin_audit_log`.

**Feature Flags**
- Admin can toggle most non-core features on or off without a deployment. Feature flags are stored in the database and read at runtime.
- Examples of flaggable features: Community Notes, Star direct purchase, Nemesis system, Guild Wars, ClassRooms, Business Accounts, AdMob ads, Rewarded ads, Ad Campaigns (self-service), In-stream Room ads, Boosted Posts, Ad Coupons, Creator Merch Store, Platform Council, Alliance System, Profile Stats page (`feature_profile_stats`).
- **Visibility rules when a flag is off** (web, PWA, and the Capacitor Android app all follow the same rule): the nav link/card/button for that feature disappears from menus for regular users and moderators. Admins always keep seeing the entry, marked with a small "disabled for users" indicator, so they can still fully use and manage the feature. Visiting the feature's URL directly while logged out of that access renders a plain, generic 404 page — it never hints that a feature exists there or that it's specifically disabled.
- **Mods-can-access-while-disabled allow-list** — per flag, admin can additionally grant moderators the same access as admins (nav link with the disabled indicator + normal page access) while the master flag stays off for everyone else. Configured at `/gate44/feature-flags` → a flag's "Advanced settings" → "Mods can access while disabled". Leaving the master flag off and turning this on for a flag is also how a feature is soft-launched to moderators only, before a wider release.
- **Two-week early access preview** — per flag, admin can set a future general-release date plus a list of subscription plans (e.g. Max) that get the feature during the 14 days immediately before that date. Configured in the same "Advanced settings" panel. Platform Council members also get early access automatically during that window. This is independent of the on/off master switch and of the mods-visibility allow-list — it schedules *when* a feature turns on for early-access plans vs. everyone else, rather than gating visibility of an already-shipped feature.

**Configuration (x_manifest / Admin Settings)**
- Minimum age requirement.
- CAPTCHA provider (Google reCAPTCHA default / Cloudflare Turnstile toggle). Admin can switch which is active without a deployment.
- Database provider selection (`supabase` / `railway` / `digitalocean`) — configured via env var at deployment time. Not a runtime toggle (changing this requires a deployment).
- Storage provider selection (`supabase-storage` / `r2` / `s3` / other S3-compatible) — configured via env var.
- Realtime provider (`supabase-realtime` / `ably` / `pusher`) — configured via env var based on database provider.
- PWA enablement per platform: admin can independently enable or disable the PWA for web, Android/mobile, and iOS/Apple. e.g., enable for web only, or enable for all, or disable entirely.
- Payment provider routing (Paystack / crypto for web; Google Play Billing hardcoded for Android).
- AdMob App ID and ad unit IDs (banner, interstitial, rewarded video).
- Payout provider (Paystack for Nigeria, crypto for rest of world — always manual admin processing).
- Credit-to-cash conversion rate.
- Payout threshold (manual approval trigger).
- Low payout balance alert threshold.
- Platform-wide default max image upload size: 1 MB, for any image uploaded anywhere on the platform (blog cover images, tweet/moment/forum attachments, ad creatives, etc.). Supported types: GIF, JPEG, PNG, SVG, AVIF, WebP. (KYC identity document uploads are a deliberate exception — they support a larger size and also accept PDF, for verification-quality reasons.)
- Active AI model versions (DeepSeek and Gemini — stored in a central constants file, not hardcoded inline).
- Redis provider (ioredis native or Upstash — configured via env var).
- Email on/off toggle (all email, non-critical email).
- Which auth providers are enabled (Google, Telegram) — admin can toggle each independently; applies identically across web, PWA, and Android app.
- Minimum/maximum VIP Room subscription prices.
- Default Season Pass price.
- CRON job settings (single daily CRON via Vercel Hobby plan by default; external CRON via cron-jobs.org for higher frequency).
- Deep link base URL (used for generating shareable deep links for profiles, Rooms, Guilds, referrals).
- Floating notification settings: master enable/disable toggle; per-currency confetti thresholds (XP, Credits, Stars).

**Floating Notifications Demo** (`/admin/notifications-demo`): Interactive page for admins to preview all notification types and simulate quest completion, referral, confetti, and per-currency floating notifications.

**Admin In-App Messaging**

Admin can initiate messages directly to users from the admin panel. These are one-way administrative communications, distinct from the platform's DM system. They appear as in-app inbox messages to recipients and do not count toward the DM coin costs or daily send limits that apply to regular users.

- **Direct messages:** Admin can compose and send an in-app message to one or more specific users (searched by username or ID). Supports multi-select.
- **Bulk broadcast — all users:** Admin can send a message to every registered user on the platform.
- **Bulk broadcast — by plan:** Admin can send to all users on a specific plan (Free, Plus, Pro, Max) or any combination of plans.
- **Bulk broadcast — by role:** Admin can send to all users with a specific role (e.g., all Moderators, all Verified Creators, all Guild Captains) or any combination of roles.
- **Telegram cross-delivery:** When an admin message is sent to a user, if that user logged in via Telegram or has connected a Telegram account, they also receive the same message as a Telegram DM/direct message via the platform's Telegram bot. This is automatic and requires no additional admin action.
- **Message format:** Rich text or plain text. Admin can compose a subject line (used as the notification title) and a body.
- **Delivery tracking:** Admin can view send status per broadcast (total recipients, delivered, failed). For direct messages to specific users, admin can see whether the message has been read.
- **Announcements on user side:** In-app admin messages appear in a dedicated "Announcements" section in the user's app (`/announcements` — renamed from "Inbox" to avoid confusion with two-way Messages), visually distinct from user-to-user DMs (e.g., labelled "From Zobia" or with an admin badge). Users cannot reply to admin broadcast messages.

**Announcement Modal / Popup**

A full-screen or centred modal that appears when a user logs in, used for sitewide notices.

- Admin can create up to 5 announcement modals. Each modal is **inactive by default** upon creation.
- **Content:** Accepts HTML code or plain text. Rendered safely (HTML is sanitised before display to prevent XSS — admin-authored HTML only, not user-generated).
- **Scheduling:** Admin sets a start date/time (or "start now") and an end date/time. The modal only appears to users between these dates.
- **Activation toggle:** Admin can activate or deactivate any modal at any time, independent of the scheduled dates. Deactivating immediately stops the modal from showing.
- **Audience targeting:** Admin selects which user plans (Free, Plus, Pro, Max — any combination or all) and/or which user roles can see the modal. Users not matching the criteria never see it.
- **Display limit:** Only one modal can be shown per login event. If multiple modals are active and audience-matched for a given user, the display mode determines which one appears:
  - **Serial rotation:** Modals rotate in creation order — each successive login shows the next active modal in the sequence. Tracks per-user which modal was last shown.
  - **Random:** A random active, audience-matched modal is selected on each login.
  - Admin selects the display mode (serial or random) globally in the announcement settings.
- **Dismiss:** Modal has a visible "×" close button. Closing the modal does not prevent it from showing again on the next login (it is a per-login, not a per-lifetime, display).
- **Platforms:** Appears in the web app, Android mobile app, and PWA. Rendering adapts per platform (Capacitor WebView modal on Android; CSS modal on web/PWA).

**Announcement Top Banner**

A fixed, non-scrolling banner pinned at the top of every screen, used for persistent sitewide notices. Remains visible even as the user scrolls content below it. Visually distinct from the modal — narrower, inline, always visible while active.

- Admin can create up to 5 announcement banners. Each banner is **inactive by default** upon creation.
- **Content:** Accepts HTML code or plain text. Sanitised before display (same rules as the modal).
- **Scheduling:** Admin sets a start date/time (or "start now") and an end date/time. The banner only appears between these dates.
- **Activation toggle:** Admin can activate or deactivate any banner at any time.
- **Audience targeting:** Same as the modal — admin selects target plans and/or roles. Multiple selections or show to all.
- **Display limit:** Only one banner can be shown at any given time. If multiple banners are active and audience-matched, the same serial/random display mode that governs the modal also governs the banner (same global setting, applied independently to banners).
- **Dismiss:** Banner has a visible "×" close button. Dismissed banners do not re-appear for that user for the remainder of the current session. On the next login, the banner may appear again if still active and scheduled.
- **Platforms:** Appears in the web app, Android mobile app, and PWA. On Android, the banner is rendered as a fixed-position View above the main navigation content area, ensuring it does not scroll away and does not overlap the system status bar.
- **Layout consideration:** When a banner is active, the main content area shifts down to accommodate the banner height. The bottom tab navigator is unaffected. The fixed positioning must not obscure any critical UI elements.

**Footer Script Manager**
- Admin can insert scripts into the site footer: analytics scripts, third-party scripts, ad network scripts, tracker scripts, footer messages, simple HTML. Stored in the database and injected server-side at render time.

**Admin Email Settings**
- Toggle ALL email off.
- Toggle Non-Critical Email off.
- Granular email notification selection (where plan allows): choose specific alert types to receive.

**Alerts and Monitoring**
- Real-time alert panel for: low payout balance, large withdrawal pending, spike in reports, failed payment webhooks, CRON job failure, AI moderation API errors.
- Alert history with resolution notes.

### 20.1 Admin/Mod Alert Priority System (6 Levels)

A professional-grade priority-based alert & escalation system for admins and moderators, replacing a flat 3-severity model. Implemented in `lib/alerts/` (`types.ts`, `dispatch.ts`, `schedule.ts`, `recipients.ts`), `lib/notifications/sms.ts` (Termii), and the admin panel at `/gate44/alerts` (dashboard) and `/gate44/alerts/settings` (granular per-level configuration). Every part of the platform that needs to page an admin/mod calls the central `raiseAlert()` function rather than inserting into `system_alerts` directly.

**The 6 priority levels** (1 = most severe / Red, 6 = least severe / Green):

| Level | Name | Color | Use cases | Channels | Escalates |
|---|---|---|---|---|---|
| 1 | Critical | `#DC2626` Red | Site down/unreachable, database unreachable, active confirmed security breach, payout treasury/account empty | SMS + Push + Email + Telegram + In-app | Yes |
| 2 | Urgent Emergency | `#EA580C` Orange | DDoS/hacking/bot attack discovered while site still up, payout funds low, payment reconciliation inconsistencies, sitewide mass-report brigading | SMS + Push + Email + Telegram + In-app | Yes (shorter) |
| 3 | Top Priority | `#F59E0B` Amber | Elevated error rate, moderation queue backlog, repeated failed webhook, single critical CRON failure, suspicious staff activity | Push + Email + Telegram + In-app | No |
| 4 | High Priority | `#EAB308` Yellow | Slow query spikes, degraded cache hit ratio, moderate report spike, elevated non-critical API errors | Push + Telegram + In-app | No |
| 5 | Medium Priority | `#84CC16` Lime | Minor anomalies, informational thresholds crossed, auto-quarantine triggered | Telegram + In-app | No |
| 6 | Low Priority | `#22C55E` Green | Routine informational/housekeeping notices | In-app only | No |

**Audience rules** — who gets notified is decided by the alert's `category`, not its level:
- `financial` (payout treasury, reconciliation, withdrawals) → **admin-only, always**. Moderators never see money-related alerts.
- `site`, `security`, `moderation` → admin **and** moderators.
- `infra`, `other` → admin-only by default; admin can opt moderators in via the `alert_notify_mods_infra_other` setting.

**SMS is the one deliberate exception** to the platform's no-SMS policy (§16, §22) — it is used ONLY for Level 1 and Level 2 alert paging, never for anything user-facing, auth, or marketing. Provider: **Termii** (pay-as-you-go, has a free tier), provider-abstracted (`SmsProvider` interface in `lib/notifications/sms.ts`) so additional providers can be added later by implementing the interface and registering it — no call-site changes needed.

**Level 1/2 escalation schedule** (admin-configurable at `/gate44/alerts/settings`, implemented as a state machine in `lib/alerts/schedule.ts`): an hour-based backoff schedule (default: 1h, 2h, 4h, 8h, 16h, 32h after first trigger) repeats for a configurable number of cycles (default 3 for Level 1, 1 for Level 2), then switches to once-a-day paging for a configurable number of days (default 7 for Level 1, 3 for Level 2), then once-a-week for a configurable number of weeks (default 52 for Level 1, 0/disabled for Level 2), then stops permanently. Resolving the alert in the admin panel immediately stops the escalation schedule. Escalation re-checks run via the externally-triggered `/api/cron/alert-escalation` CRON (every 15-30 minutes via an external CRON service — Vercel Hobby only allows daily CRONs).

**Mass-report spike detection**: distinct-reporter counts on a single content cluster (see §19 flood control) raise an alert at increasing priority as thresholds are crossed — default Level 5 at 5 reporters, Level 4 at 15, Level 3 at 40 — folded into ONE alert per cluster (via `dedupeKey`) that upgrades in place rather than spamming a new alert per reporter. A separate sitewide velocity check (default: 100+ reports across all targets in the last hour) raises a Level 2 alert to admins+mods, indicating possible brigading or a coordinated attack rather than one bad piece of content.

**Monitoring dashboard** (`/gate44/monitoring`): uptime proxy derived from Level 1 "site"-category alert history (no separate uptime pinger needed), alert volume by priority level (24h + currently active), CRON job freshness (from `cron_state`), Redis reachability/latency, cache hit ratio, slowest queries, and a recent-alert log feed. Cached in Redis for 30 minutes with a manual "Refresh live data" bypass (mirrors the existing Data Management stats pattern) — deliberately not real-time or to-the-second accurate, to stay within free-tier Redis/DB call budgets.

Cache hit ratio and slow queries are read from data the database/cache already track internally — deliberately NOT a third-party APM (which would add per-request instrumentation overhead and hit free-tier ingest limits fast at scale):
- **Cache hit ratio** (`lib/redis/stats.ts`): Redis's own `INFO stats` counters (`keyspace_hits`/`keyspace_misses`), which Redis increments on every command it processes regardless — reading them adds zero incremental overhead.
- **Slow queries** (`lib/db/slowQueries.ts`): `pg_stat_statements`, a stock Postgres extension (enabled via migration `0049`, best-effort — most managed providers including Supabase ship it preloaded) that aggregates per-normalised-query timing in shared memory as queries run (~1-2% overhead at the Postgres level, not per-request app overhead); reading it later is one cheap `SELECT` against a system view. Reports "unavailable" rather than fabricating data when the extension isn't enabled at the server level.

---

## 21. Internationalisation & Localisation

### Supported Languages at Launch

English, French, Arabic, Hausa, Kiswahili, Amharic, IsiZulu, Portuguese, Pidgin

The i18n architecture must support adding additional languages without code changes — new language files are added to the translations directory and picked up automatically.

### i18n Technical Requirements

- All user-facing strings externalised into translation files (e.g., JSON or ICU message format). No hardcoded strings in components.
- RTL layout support for Arabic. The UI must reflow correctly in RTL mode.
- Number formatting (currencies, large numbers with separators) localised per user locale.
- Date and time formatting localised per user locale.
- Currency display derived from user **region**, independent of UI language: Nigeria (`country = "NG"`) sees Naira (₦); every other/unknown country sees a USD-equivalent, computed from the same admin-configurable USD/NGN rate the crypto checkout already uses (`payment_usd_to_ngn_rate`) so the two never disagree. All monetary values keep being stored in NGN kobo (the smallest unit) — currency selection is a display-layer concern only, never a storage concern (see §18).
  - `users.country` previously defaulted to `"NG"` for every signup with nothing ever setting it from the user's real location, which silently showed Naira pricing to non-Nigerian users. It's now self-healed: `users.country_source` tracks whether the value is still the unconfirmed default, and the first authenticated request carrying a geo header (`x-vercel-ip-country` / `cf-ipcountry`) corrects it (`lib/currency/region.ts`).
  - A user may override the auto-detected currency explicitly (`users.currency_preference`, `PATCH /api/me/currency`) — "Auto" (default), NGN, or USD.
  - Crypto payments remain the sole checkout path for non-Nigerian users (§40); Paystack card checkout is Nigeria-only both server-side (`enforcePaymentContext`) and in the UI.

### Locale Detection

- Default locale detected from browser/device settings.
- User can override in profile settings.
- Admin can set the platform default locale in admin settings.

### Cultural Calendar

The platform Vitality Calendar incorporates Nigerian, Pan-African, and global cultural moments (Section 25). As new markets are added, new cultural events are added to the calendar without code changes — events are data-driven and admin-manageable.

---

## 22. Technical Architecture & Infrastructure

### Guiding Constraints

- **Zero-cost MVP deployment** on Vercel Hobby Plan (web/admin panel) and GitHub Actions (APK, free for public repos).
- **Deployment storage budget (Vercel Hobby, 10 GB Function Storage).** Only the production branch (whichever branch Vercel's Production Branch setting names; nothing in the repo hardcodes it) builds on Vercel; feature branches are verified by GitHub Actions only. Production commits that cannot affect the web app (Android, Expo, docs, load tests) skip the Vercel build. Function bundles stay lean: no per-route `maxDuration`/`memory` overrides outside CRON routes (which all share one value), and nothing that is never read at runtime is traced into functions. See section 44.
- **Active CPU budget (Vercel Hobby, 4 h per 30 days).** Every request is billed, so the product is built for few requests per session: one short-lived client cache for identity and other hot reads (cleared on any write, logout or 401), batched per-page reads (ads), links prefetch only on intent, no refetch on window focus, polling only while visible, one shared realtime connection per session, a CSP that matches everything the app loads, and no requests the client already knows will fail. See section 45.
- **Mobile-first Android APK** built with Capacitor 6 + Vite 5 + React 18. The app runs inside a full-screen WebView served by the Vite bundle — enabling direct sharing of Tailwind tokens, TanStack Query, and TanStack Router with the web codebase. Target Android API Level 36 (Android 16): `compileSdk 36`, `targetSdk 36`, `minSdk 26`.
- **Separate web/PWA** built with Next.js, sharing the same backend API and database as the Android app but as a distinct frontend codebase.
- **Admin panel** is a Next.js web app deployed on Vercel. Admins use browsers; the admin panel is never included in the APK. The Android app mirrors key admin panel metrics in a read-only view.
- **Database-provider-agnostic**: the platform supports multiple PostgreSQL providers. Switching providers requires only an env var change, not code changes.
- **Auth-system-agnostic**: in non-Supabase mode, Supabase Auth and all Supabase dependencies are completely absent. Auth is handled by the platform's own JWT system backed by the configured database.
- **Offline-friendly**: TanStack Query v5 with `experimental_createPersister` (IndexedDB via `idb-keyval`) persists query results across sessions. The app loads previously cached data immediately on restart with no network. Elements requiring live data have graceful fallbacks.
- **Low-bandwidth optimised**: primary users are in bandwidth-constrained settings (2G/3G). All payloads are compressed. Images are compressed on upload.
- **Modular architecture**: features are independently deployable and toggleable. No monolithic coupling between modules.

### Stack

| Layer | Technology |
|---|---|
| Mobile App (Android APK) | Capacitor 6 + Vite 5 + React 18 — the Vite bundle runs inside Capacitor's full-screen WebView. Gradle/AGP compiles the native shell. Target `compileSdk 36`, `targetSdk 36`, `minSdk 26` (Android 8.0+). |
| Mobile Routing | TanStack Router v1 (file-based, `src/routes/`) — same routing paradigm as the web codebase. `TanStackRouterVite` plugin auto-generates `routeTree.gen.ts` at build time. |
| Mobile Data Fetching | TanStack Query v5 with `experimental_createPersister` + `idb-keyval` (IndexedDB) — 24h staleTime, 7d gcTime. Queries pause/resume via `@capacitor/network` events. |
| Mobile Native Bridge | Capacitor 6 — `@capacitor/preferences` (token storage), `@capacitor/network` (connectivity), `@capacitor/app` (foreground/background), `@capacitor/splash-screen`, `@capacitor/push-notifications`. |
| Web / PWA | Next.js (App Router) — separate frontend codebase, shares backend API and database |
| Admin Panel | Next.js (App Router) — browser-only, deployed on Vercel, not included in APK. Key metrics mirrored in the Android app (read-only). |
| Backend (API) | Next.js API Routes + Edge Functions where appropriate, deployed on Vercel. Serves the Android app, the web/PWA, and the admin panel. |
| Database (see Section 22.1) | PostgreSQL — provider is selected via env var. Supported: Supabase, Railway PostgreSQL (with PgBouncer), DigitalOcean Managed PostgreSQL (with PgBouncer). Adding a new provider requires only a new adapter module. |
| Row Level Security | Applied at the database level (PostgreSQL RLS policies). Works across all supported providers. |
| Connection Pooling | PgBouncer — built into Railway and DigitalOcean managed offerings; Supabase uses its built-in connection pooler. All modes use pooled connections. |
| Auth (see Section 22.2) | Platform-managed JWT auth (not Supabase Auth). Google OAuth + Telegram Login. Same auth available on web, PWA, and Android app. In non-Supabase mode, zero Supabase dependencies. |
| Realtime | Ably (primary) via `authCallback` pattern — scoped token endpoint `GET /api/realtime/ably-token?channel=<name>` verifies JWT and confirms channel access. Adaptive baseline poll (`useAdaptiveChatPoll`) runs in parallel as a safety net. |
| Cache / Sessions | Redis (ioredis native or Upstash — configured via env var) + JWT |
| Object Storage (see Section 22.3) | Provider-dependent: Supabase Storage in Supabase mode; S3-compatible storage in non-Supabase mode. Default S3-compatible recommendation: Cloudflare R2. Selected via env var. |
| Email | Mailgun |
| AI (Primary) | DeepSeek API |
| AI (Fallback) | Google Gemini |
| Payments (Nigeria Web/PWA) | Paystack (primary) + crypto (available as toggle) |
| Payments (International Web/PWA) | crypto |
| Payments (Android In-App) | Google Play Billing via `@capacitor-community/in-app-purchases` or WebView-based Paystack/crypto checkout flow. |
| Advertising (Mobile) | AdMob via Capacitor plugin (`@capacitor-community/admob`). |
| CAPTCHA | Google reCAPTCHA (default) / Cloudflare Turnstile (toggle). Admin can switch which is active. |
| Deep Links | `@capacitor/app` `appUrlOpen` listener + TanStack Router navigation. `zobia://` custom scheme in AndroidManifest. SEO-friendly public paths (`/u/<username>`, `/r/<slug>`, `/c/<slug>`, `/g/<slug>`) resolve via `GET /api/public/resolve` to internal UUIDs. |
| PWA | Configurable per platform by admin: enable for web only, mobile/Android only, iOS only, or any combination. |
| CRON | Vercel Hobby Plan (once daily, default) + cron-jobs.org (external, for higher frequency) |
| APK Build & Distribution | GitHub Actions (`.github/workflows/android-build.yml`) — Node 20.19.4 + Java 17 + `./gradlew assembleDebug`. Artifact uploaded with 30-day retention. Required secrets: `VITE_API_BASE_URL`, `VITE_WEB_BASE_URL`. |
| Hosting (Web/API/Admin) | Vercel (Hobby Plan for MVP, upgrade as needed) |

### 22.0.1 — Android App (Capacitor) Build Constraints (must-read before building the APK)

The Android app lives at `apps/android/` and is built with **Capacitor 6 + Vite 5 + React 18**.
The full runbook lives in **`docs/SETUP.md` → "Android App"**. Non-negotiable rules:

1. **Single npm lockfile, installed from the repo root.** npm workspaces only — never
   run `npm install` inside `apps/android/`; never commit a nested `package-lock.json`
   inside `apps/android/`. All dependencies are managed from the root `package.json`.
2. **Node 20.19.4.** `apps/android/.nvmrc` pins this. The GitHub Actions workflow uses
   `actions/setup-node@v4` with `node-version: '20.19.4'`. The `engines` field in
   `apps/android/package.json` declares `"node": ">=20.0.0"`.
3. **Target Android API 36.** `apps/android/android/app/build.gradle` must keep
   `compileSdk 36`, `targetSdk 36`, `minSdk 26`. Do not downgrade these values.
4. **No Capacitor CLI invocations in CI.** The Gradle project under
   `apps/android/android/` is committed directly to the repo. CI runs only
   `npm ci` (root), `vite build` (in `apps/android/`), file copy, and `gradlew assembleDebug`.
   There is no `npx cap sync` or `npx cap add android` step in CI.
5. **Dist copy before Gradle.** The Vite build output (`apps/android/dist/`) must be
   copied into `apps/android/android/app/src/main/assets/public/` before Gradle runs.
   The GitHub Actions workflow does this with a `cp -r` step. Forgetting this step
   produces an APK that opens to a blank WebView.
6. **All user-facing strings via i18next `t('key')`.** No hardcoded English strings in
   React components. English strings live in `shared/i18n/locales/en.json`. The Android
   app loads locale files from `shared/i18n/locales/` via relative imports in
   `src/lib/i18n/index.ts`.
7. **Ably subscribe-once discipline.** `useRealtimeChannel` subscribes to exactly one
   channel per hook instance and unsubscribes strictly on unmount. Never subscribe in
   a loop or inside a render function. The `onEventRef` pattern ensures the callback
   reference is always current without causing re-subscriptions.

### 22.1 — Database Provider Architecture

The platform abstracts all database access behind a provider interface. The active provider is selected via the `DATABASE_PROVIDER` environment variable. Supported values at launch: `supabase`, `railway`, `digitalocean`.

**Adding a new PostgreSQL provider** requires only:
1. Creating a new adapter module in `lib/db/providers/<provider-name>.ts` implementing the standard database interface.
2. Adding the provider name to the `DATABASE_PROVIDER` env var enum.
3. No changes to any business logic, query, or API route.

All three supported providers use standard PostgreSQL. The same migration files and RLS policies apply across all providers. Connection strings, pool size limits, and SSL settings are configured per-provider via env vars.

| Provider | Notes |
|---|---|
| Supabase | Default for MVP. Built-in PgBouncer connection pooler. Supabase Realtime available. Supabase Storage available. |
| Railway PostgreSQL | Managed PostgreSQL on Railway. PgBouncer available as an add-on (must be configured explicitly). Use self-managed Realtime layer (Ably/Pusher). Use S3-compatible storage (Cloudflare R2 recommended). |
| DigitalOcean Managed PostgreSQL | DigitalOcean managed offering. PgBouncer available via connection pooling mode. Use self-managed Realtime layer. Use S3-compatible storage. |

**Important:** When `DATABASE_PROVIDER` is not `supabase`, the codebase must have zero imports from any Supabase SDK package (`@supabase/supabase-js`, `@supabase/auth-helpers-*`, etc.). This is enforced with an ESLint rule that flags Supabase imports when the provider is not set to `supabase`. The developer must validate this during build.

#### 22.1.1 — Data Access Layer: Drizzle ORM

All three providers connect to plain Postgres through the `pg` driver (`lib/db/providers/*.ts`), so a single Drizzle ORM instance (`lib/db/drizzle.ts` → `getDb()`) wraps the same connection pool uniformly across Supabase, Railway, and DigitalOcean — Drizzle is not tied to any one provider and does not change how RLS or authentication is enforced.

- **Schema**: `lib/db/schema.ts` is the single source of truth for every table (camelCase fields mapping to the snake_case columns defined in `db/migrations/`), kept in sync with the SQL migrations by hand. `npx drizzle-kit generate`/`check` (via `drizzle.config.ts`) can be used to validate the schema against a live database.
- **Primary access pattern**: application code calls `const orm = await getDb();` and uses Drizzle's type-safe query builder (`orm.select()/.insert()/.update()/.delete()`, `orm.transaction(async (tx) => {...})`) against `schema.<table>`. Row locking (`FOR UPDATE`), atomic increments, and `ON CONFLICT` upserts all have direct Drizzle equivalents (`.for("update")`, `sql\`col + amount\``, `.onConflictDoUpdate()`/`.onConflictDoNothing()`).
- **Shared helpers that run either standalone or inside a caller's transaction** take a `DbOrTx` parameter (the union of the top-level Drizzle instance and its transaction handle) rather than accepting a raw connection.
- **Escape hatch**: a small number of genuinely complex statements (recursive/window-function queries, dynamic multi-table filters) go through Drizzle's own `sql` tagged-template via `client.execute(sql\`...\`)` instead of the query builder — still fully parameterized and running through the same Drizzle-wrapped pool, just not expressed as chained builder calls.
- **Legacy raw adapter**: `db.query()`/`db.transaction()` from `@/lib/db` (the pre-Drizzle `DatabaseAdapter` interface) is retained only for low-level infrastructure that must stay provider-agnostic and outside the ORM layer — the connection-health circuit breaker (`lib/db/circuit.ts`) and the adapters themselves. Application/business-logic code should not use it for new work.

### 22.2 — Auth Architecture

Authentication is handled by the platform's own JWT system, not Supabase Auth. This ensures auth works identically regardless of the database provider.

**Auth providers:**
- Google OAuth (primary).
- Telegram Login (secondary).
- Admin can toggle each on or off independently per deployment.
- The same auth options are available identically on web, PWA, and Android app.

**Auth flow (web / PWA):**
1. User clicks "Continue with Google" → browser navigates to `/api/auth/google` which sets CSRF cookie and redirects to Google.
2. User signs in with Google → Google redirects to `/api/auth/google/callback` with CSRF cookie intact (same browser session).
3. Callback validates CSRF, upserts user, issues platform JWT and refresh token as HttpOnly cookies, redirects to `/home` or `/onboarding`.

**Auth flow (Android app):**
1. User taps "Continue with Google" → the Android app opens `/api/auth/google?platform=mobile&redirect=zobia://auth/callback` in a Chrome Custom Tab (via Capacitor Browser plugin or `window.open`). The Custom Tab stores CSRF and mobile-redirect cookies.
2. Custom Tab follows the 302 redirect to Google. User selects their account.
3. Google redirects to `/api/auth/google/callback` — the Custom Tab includes the CSRF cookie automatically (same browser session).
4. Callback validates CSRF, creates a one-time exchange code stored in Redis (90s TTL), redirects to `zobia://auth/callback?code=<exchangeCode>`.
5. The `zobia://` scheme is registered in AndroidManifest — the OS routes the redirect back to the Capacitor app via `@capacitor/app`'s `appUrlOpen` event.
6. App POSTs `{ code }` to `/api/auth/mobile-token` over HTTPS → receives `accessToken`, `refreshToken`, and user payload. Tokens stored in `@capacitor/preferences`.
7. All subsequent API calls present the JWT as a `Bearer` token. The backend validates it against the Redis session store.
8. Refresh tokens are stored in Redis with a sliding window. Session invalidation propagates immediately via Redis key deletion.

**Password and recovery:**
- After onboarding, users are periodically (not aggressively) encouraged to set an email address and password for account recovery.
- Email and password are optional but surfaced as strongly recommended.
- Optional 4-digit PIN for login and sensitive operation protection.
- 2FA defaults to authenticator app. No SMS 2FA.

**Non-Supabase mode:** When `DATABASE_PROVIDER` is not `supabase`, no Supabase Auth SDK is imported or used anywhere. User records, sessions, OAuth state, and all auth-related data live entirely in the configured PostgreSQL database and Redis.

### 22.3 — Object Storage Architecture

Object storage (profile images, sticker assets, gift animations, Room attachments) is provider-dependent:

| Mode | Provider | Notes |
|---|---|---|
| Supabase mode | Supabase Storage | Built-in, zero additional config. |
| Non-Supabase mode | S3-compatible storage | Default recommendation: Cloudflare R2 (generous free tier, S3-compatible API, no egress fees). Any S3-compatible provider works: AWS S3, Backblaze B2, Wasabi, MinIO, etc. |

The active storage provider is selected via the `STORAGE_PROVIDER` env var. The storage layer is abstracted behind a uniform interface (`lib/storage/index.ts`). All file upload and retrieval calls go through this interface — no direct S3 SDK or Supabase Storage SDK calls in business logic.

**Cloudflare R2 is the default recommendation for non-Supabase deployments** due to: zero egress fees (critical for media-heavy social platforms), S3-compatible API (no custom SDK required), and a generous free tier suitable for the MVP phase.

### AI Model Configuration

AI model versions (DeepSeek and Gemini) are stored in a single central constants file (e.g., `lib/ai/config.ts`). If a model version is deprecated, the new version is updated in this one file without touching any other code. The developer must never hardcode model version strings inline in call sites — always reference the central constant.

```
// Example structure — not final code
AI_PROVIDERS = {
  primary: {
    provider: 'deepseek',
    model: 'deepseek-chat', // Update here when deprecated
    endpoint: process.env.DEEPSEEK_API_ENDPOINT
  },
  fallback: {
    provider: 'gemini',
    model: 'gemini-flash-2.0', // Update here when deprecated
    endpoint: process.env.GEMINI_API_ENDPOINT
  }
}
```

### CRON Architecture

The Vercel Hobby Plan allows a maximum of one CRON run per day. This once-daily run is the default configuration. For higher-frequency CRON jobs (e.g., hourly leaderboard updates, Guild War scoring), an external CRON service (cron-jobs.org or equivalent) is configured to call authenticated internal API endpoints.

**Important note for the developer:** The Vercel Hobby CRON limit must be documented in the SETUP.md with clear instructions for setting up cron-jobs.org as the external trigger for higher-frequency operations. This is a required part of the setup, not optional.

### Session Management

- JWT + Redis for sessions. JWTs are short-lived (configurable per role via `manifest.sessionTtls`). Refresh tokens are stored in Redis with a sliding window.
- Session invalidation (logout, ban, suspicious activity) is propagated via Redis key deletion — no waiting for JWT expiry.
- Admin sessions have a separate, shorter-lived JWT with stricter validation.
- **(v2.14) Verification is tiered, not uniform.** Reading the Redis session record on *every* authenticated request was the app's highest-volume Redis operation and did not scale on a free tier. Ordinary routes now trust the short-lived signed access token; live Redis + database verification runs on money-moving and privilege-granting surfaces (payments, payouts, transfers, gifting, KYC, 2FA/PIN, bank accounts, session management) and on every `/gate44` admin and moderator route. Correspondingly, revocation is **push-based**: every ban/suspend/delete/downgrade path calls `revokeUserAccess()`, which destroys the user's sessions immediately, and token refresh re-checks account standing from the same row it already reads. A revoked session is therefore cut off instantly everywhere that matters, and at worst finishes out one access-token lifetime on harmless read endpoints. See *HOW-IT-WORKS.md → Redis Cost Controls*.
- **Access-token lifetime is deliberately not shortened.** Once per-request session reads are gone, the only Redis traffic in the auth path is the refresh (~6 commands); a 5-minute TTL costs three times the commands of a 15-minute one over the same browsing session, for a revocation window push-based revocation has already closed.
- **Expired-session UX:** Every authenticated `fetch` on web/PWA goes through a shared wrapper (`lib/api/authFetch.ts` for native `fetch` calls, an axios interceptor for `apiClient` calls) that, on a 401, attempts one silent token refresh and retries once. If the retry also 401s, the session is broadcast as expired via a small pub/sub bus and a blocking "you've been signed out, please sign in again" modal is shown, mounted once in the root layout so it covers every route (including standalone surfaces like `/g/<slug>/play`) — not just the authenticated app shell.
  - **(v2.10) Global 401 guard:** a large number of pages call the native `fetch()` directly (not through `authFetch`/`apiClient`), so a 401 on those calls previously went unnoticed — the modal never fired and the page just silently stopped responding to the user's actions. `lib/auth/sessionExpiredBus.ts` now patches `window.fetch` once at root-layout mount: any same-origin `/api/*` response with status 401 (excluding the auth endpoints themselves) marks the session expired, without needing every call site migrated to the shared wrapper. `authFetch`/`apiClient` route through the pre-patch `rawFetch` so their own silent-refresh-then-retry logic still runs first and this guard never short-circuits it.
  - **(v2.10) Capacitor app:** `AuthGuard` now tags an involuntary sign-out (`signalUnauthenticated`, e.g. a failed refresh) with a reason it carries into the `/auth/login` redirect, and the login screen shows a "your session has expired" banner — previously it silently redirected with zero explanation, which read to users as the app randomly logging them out.

### Connection Pooling

- **Supabase mode:** Built-in PgBouncer via Supabase connection pooler. Enable transaction mode for serverless API routes.
- **Railway mode:** PgBouncer configured as a Railway add-on. Connection string points to the PgBouncer port, not the raw Postgres port.
- **DigitalOcean mode:** DigitalOcean connection pooling enabled in the managed database dashboard. Pool size configured per environment.
- Redis connection pooling via ioredis or Upstash connection management. Both providers are wrapped in adapters implementing one interface, so `REDIS_PROVIDER` can be switched with no code changes; the ioredis adapter normalises pipeline replies and `hgetall` misses to match Upstash semantics.
- HTTP connection pooling for external API calls (DeepSeek, Gemini, payment providers).

### Offline Support

**Web/PWA:**
- Service Worker (via next-pwa or equivalent) caches the app shell and critical assets.
- Recent Room messages, user profile data, and the last-loaded quest deck are cached in IndexedDB.
- Outgoing messages written to IndexedDB when offline and synced when connectivity resumes.
- Cache invalidation strategy: stale-while-revalidate for non-financial data, strict network-first for financial operations.

**Android (React Native):**
- On-device storage via MMKV (fast key-value) for session state, preferences, and lightweight cached data.
- Expo SQLite for structured offline data (cached messages, quest deck, user profile).
- Outgoing messages queued in SQLite when offline and synced when connectivity resumes. Message content in the offline queue is encrypted at rest with AES-256-GCM; the per-device key is generated once and stored in expo-secure-store (backed by Android Keystore / iOS Secure Enclave).
- All screens have graceful offline states — no white screens or crashes on no-internet load.

### Scalability

- Cursor-based pagination for all list endpoints. Offset-based pagination is permitted as a fallback for small lists where cursor complexity is not justified.
- Database indexes on all foreign keys, frequently queried columns, and full-text search fields.
- Leaderboards and aggregated scores materialised at write time (not computed on every read).
- Thundering herd prevention: cache warm-up on CRON, randomised cache expiry to prevent simultaneous cache misses.
- **Realtime strategy is database-provider-dependent:**
  - `DATABASE_PROVIDER=supabase`: Use Supabase Realtime subscriptions for live feeds (rooms, notifications, leaderboards). Do not poll — subscribe via `supabase.channel()`.
  - All other providers (Railway, DigitalOcean, etc.): Use **Server-Sent Events (SSE)** with database polling as the equivalent. The backend exposes `/api/sse/*` endpoints that stream updates to clients using long-lived HTTP connections. The Expo app uses React Query's `refetchInterval` (polling every 2–3 seconds) as its non-Supabase realtime equivalent. No Supabase SDK imports are permitted outside of `DATABASE_PROVIDER=supabase` builds.
- Background processing for expensive operations (AI moderation, payout processing, leaderboard recalculation) via queued jobs or CRON-triggered batches.

### Redis Cost Discipline (v2.14)

The platform must scale toward tens of thousands of concurrent users while
running on a **free Redis tier**. Managed serverless Redis bills **per command**,
which has one non-obvious consequence that governs every decision here:
**pipelining reduces latency, not quota.** A pipeline of five commands is still
five billed commands. Only *removing* commands reduces cost. Batching is used
freely for p95 latency (each sequential call from a lambda is ~80 ms) but is
never mistaken for a cost optimisation.

Standing rules for all future work:

1. **Nothing runs on every request unless it must.** Anything in a middleware,
   a wrapper, or a per-query hook multiplies by total page views, not by logins.
   Auditing these first is always the highest-yield change. The database circuit
   breaker — which wrapped every query and cost two to three Redis commands each
   — was the single largest consumer found, and is now in-process.
2. **Prefer the database when the data already exists there.** Sitewide presence
   duplicated `users.last_active_at`, which is indexed and strictly more
   informative. Deriving it removed a write per heartbeat, a read per lookup and
   a command per recipient on every push fan-out.
3. **Global values belong in the CDN.** Anything identical for every user (the
   app manifest, notices, Zobian of the Month, leaderboard totals) must carry
   `s-maxage` so the edge answers it. Note that `max-age` alone is a *browser*
   directive and leaves cold browsers and native clients hitting the origin.
4. **Rate limits are tiered.** Limits that stop attackers (auth, PIN,
   registration, payouts, purchases, gifting) are counted in Redis and fail
   closed on an outage. Limits that stop runaway clients (`apiRead`, idempotent
   votes) are counted per instance, cost zero Redis and fail open. Never store
   one Redis entry per request to count requests.
5. **Cache in-process first.** `lib/cache/memory.ts` is the L1 in front of every
   Redis read. A Redis TTL is a safety net for a missed invalidation, not the
   propagation mechanism — explicit invalidation is.
6. **Client caches are per-user.** Offline-first persistence (localStorage on
   web/PWA, IndexedDB on Capacitor) is namespaced by user id and purged on owner
   change, so nothing leaks between accounts on a shared device. A denylist of
   "sensitive" keys is not acceptable: it fails open for every key nobody
   thought to list.

Both Redis providers (`ioredis`, `upstash`) are held to the same interface and
kept equally optimised, so `REDIS_PROVIDER` can be switched at any time without
touching code.

### Retries and Resilience

- All external API calls (payment providers, AI providers, email) implement retries with exponential backoff and jitter.
- Circuit breaker pattern for AI fallback: if DeepSeek fails, automatically route to Gemini.
- Payment webhook endpoints acknowledge immediately and process asynchronously to prevent timeouts.
- Idempotency keys required on all payment API calls.

---

## 23. Security & Hardening

### Defense in Depth

The platform applies multiple overlapping security layers. No single mechanism is relied upon alone.

### OWASP Top 10 Mitigations

- **Injection (SQL, NoSQL, Command):** All database queries use parameterised queries via the database provider's client. No raw SQL string interpolation regardless of which provider is active. The provider abstraction layer enforces this.
- **Broken Authentication:** JWT + Redis invalidation, 2FA for sensitive operations, 4-digit PIN option, strong password policy, session expiry.
- **Sensitive Data Exposure:** All data in transit via HTTPS/TLS. Sensitive fields (bank account numbers, USDT wallet addresses, offline message queue content on Android) encrypted at rest using AES-256-GCM. PII minimisation — only collect what is needed.
- **XML External Entities:** Not applicable (JSON API). Input validation on all incoming data.
- **Broken Access Control:** Row Level Security on all PostgreSQL tables (all supported database providers). is_admin and role checks verified against the database on every privileged operation. API routes validate permissions server-side, never trusting client claims.
- **Security Misconfiguration:** Vercel environment variables for all secrets. No secrets in code. Secret rotation runbook in SETUP.md.
- **Cross-Site Scripting (XSS):** React's default escaping for all rendered content. No dangerouslySetInnerHTML except for admin-managed footer scripts, which are admin-only and sandboxed.
- **Insecure Deserialization:** All incoming JSON validated against schemas before processing.
- **Using Components with Known Vulnerabilities:** Dependency audit in CI pipeline (npm audit). Dependabot or equivalent for automated vulnerability alerts.
- **Insufficient Logging & Monitoring:** All security events (failed logins, permission denials, payment anomalies, rate limit hits) logged to a monitored log stream. Admin alert panel surfaces critical events.

### Additional Security Requirements

- **CSRF protection:** CSRF tokens required for all state-changing requests.
- **SSRF protection:** External URL fetching (for link previews, webhook URLs) restricted to allowlisted domains. No requests to internal network ranges.
- **Rate limiting:** Per-user and per-IP rate limits on all API endpoints, configurable per endpoint type.
- **Bot detection:** User agent analysis, request velocity checks, CAPTCHA challenges on suspicious patterns.
- **AI Prompt Injection:** All user-supplied content passed to AI models is sandboxed and prefixed with system-level constraints that cannot be overridden by user input. User content is clearly delimited from system instructions in all AI calls.
- **Payment integrity:** All payment events validated via provider webhook signatures. No trust of client-reported payment amounts.
- **Admin route hardening:** Admin routes are inaccessible to non-admin users at the API level, not just the UI level.
- **Privacy-aware data handling:** User data export and deletion capabilities (GDPR/similar compliance foundation). User deletion anonymises records rather than hard-deleting to preserve referential integrity of non-PII data.

---

## 24. Key User Workflows

### Workflow 1: The Daily Loop (Everyday User)

1. Open Zobia → daily login recorded → streak updated → 50 XP awarded.
2. Daily quest deck served → 3–6 quests displayed (by plan).
3. Check DM inbox → respond to messages → XP earned per message.
4. Check Nemesis panel → see if ahead or behind → motivational nudge.
5. Visit a Room → participate → 2 XP per message.
6. Complete 2–3 quests → 300–600 XP earned.
7. Check Guild page → war active? → contribute activity.
8. Close app → opt-in notification for Guild War Final Hour if war is live.

**Total session: 10–20 minutes. Total XP: 200–800. Every session is progress.**

### Workflow 2: The Creator's Week

Monday: Post a thread in their ClassRoom kicking off the week's module. Members respond. Creator earns XP + Credits from gifts.

Tuesday–Thursday: DM responses to students. Two Broadcast Messages to followers about upcoming content. New VIP Room members join.

Friday: Payout processed. Creator Dashboard shows growth metrics.

Saturday: Apply for a Sponsored Quest from a brand.

Sunday: Host a Drop Room — a live Q&A. One-time entry fee. Creator earns 80% of entry fee revenue plus gifts received during the session.

### Workflow 3: The Guild War Weekend

Friday 6pm: Captain declares war. All members receive push notification.

Friday night: Members log on. Collective War Points accumulate. Guild is ahead.

Saturday: Members grind. One member purchases a War Boost.

Sunday (Final Hour): Push notification fires to all members. Double points. Members log on within 20 minutes. The gap widens.

Sunday (War End): Guild wins. XP distributed. Credits distributed by contribution rank. Captain posts in Guild Room: "Next war, we hit the next tier. Let's go."

### Workflow 4: The New User's First Week

Day 1: Onboarding. Profile created. 500 XP welcome drop. First Room joined. First quest completed (send 10 messages). Level: Rookie I.

Day 2: Returns to check daily quests. Nemesis assigned — someone 150 XP ahead. Sends extra messages to catch up. Joins a second Room.

Day 3: A friend is found on Zobia. Friend invites them to a Guild. Joins. Contribution score begins. Earns Guild XP boost.

Day 5: Completes the New Member Quest. 1,000 Credits + 2,000 XP bonus. Considers buying Plus plan. Decides to earn more first.

Day 7: 7-day login streak. 200 bonus XP. Guild is mid-war. Contributes for the first time. Sends their first gift (5 Credits) to a creator in a Room. Realises there are other tracks to explore.

End of Week 1: User is at Hustler I. Has joined a Guild. Has one active Nemesis. Has sent a gift. Has a 7-day streak. The platform has become a habit.

---

## 25. Platform Vitality Calendar

### The Always-On Event Structure

**Recurring Weekly:**
- Guild Wars (every 72 hours, continuous).
- Season Leaderboard snapshot published (every Sunday).
- Weekly Guild Quests reset (every Monday midnight).
- Nemesis assignments refreshed (every Sunday).
- Mystery XP Drop (algorithmically triggered at a random point within the week — not announced in advance).

**Recurring Monthly:**
- Creator Fund: pool accrues live from contributing activities (see §14) plus admin top-ups; distributed to eligible creators (Elite tier+) on the **5th of each month**.
- Mystery Gift Drop: platform releases 1 exclusive limited gift available for purchase for 48 hours only, then retired permanently. Announced 24 hours in advance with a countdown.
- Platform Council applications open (last week of each month).
- Creator Spotlight: Zobia highlights a Creator of the Month in all users' discovery feeds.

**Seasonal (every 8 weeks):**
- Season launch with themed event Room, new cosmetics, Season Pass release.
- Mid-Season double XP flash event (announced 6 hours in advance, fires at an unannounced moment within that window).
- Final week countdown, Season closing ceremony Room.
- Season archive updated on all profiles.

**Cultural Calendar Events (Africa-first, expandable globally):**
- January: New Year Hustle Season launch.
- February: Valentine's Gift Weekend — double XP for gifts sent, exclusive gift items.
- March: International Women's Month — Women Creators spotlight, female creator Creator Fund boost.
- May–June: Major African sports event season (AFCON or equivalent) — city vs city wars, themed rooms.
- August: Independence prep — "Pride Season," national leaderboard event.
- October 1: Nigerian Independence Day Double XP — one-day, full-platform event.
- November–December: Detty December Season — the biggest Season of the year, maximum guild wars, maximum gifting events, most exclusive cosmetics of the year.

All cultural events are data-driven and admin-manageable without deployments. Admin can add, edit, or cancel events from the admin panel.

---

## 26. MVP Build Sequence

> **Historical note:** this section documents the original Phase 1 plan, written when the Expo (React Native) app was the intended primary mobile product. The mobile strategy later pivoted to the Capacitor app (`apps/android/`) and the Expo app (`apps/expo/`) was discontinued — see §22 "Technical Architecture & Infrastructure" for the current stack, and §31.6 for the discontinuation note. Left unedited below as a record of what was originally planned/built, not as current guidance.

The MVP Build Sequence follows a phased approach. Each phase ends with a stable, testable state that can be deployed independently.

### Phase 1 — Foundation (Core Infrastructure)

**Goal:** Working app shell, auth, database, and basic user profile.

**Deliverables:**
- **Two separate project scaffolds:**
  - Expo (React Native) app for Android APK — this is the primary user-facing product.
  - Next.js project for web/PWA and admin panel — shares the same backend API and database.
- Database provider abstraction layer scaffolded (`lib/db/providers/`) with adapters for Supabase, Railway, and DigitalOcean. Active provider selected via `DATABASE_PROVIDER` env var. ESLint rule configured to flag Supabase imports when provider is not `supabase`.
- Object storage abstraction layer scaffolded (`lib/storage/`) with adapters for Supabase Storage and S3-compatible providers (default non-Supabase: Cloudflare R2). Active provider selected via `STORAGE_PROVIDER` env var.
- Supabase project setup (for Supabase mode): database schema, Row Level Security policies, storage buckets.
- Platform-managed JWT auth system (not Supabase Auth). Google OAuth + Telegram Login integration — works identically on web, PWA, and Android app across all database providers. JWT stored in HttpOnly cookie on web, Expo SecureStore on Android.
- Redis session management (JWT + Redis, configurable for ioredis or Upstash).
- User onboarding flow (Steps 1–3): username, avatar, city, Vibe Quiz, 500 XP welcome drop — built natively in React Native (not WebView).
- React Navigation setup with Expo Router. Bottom tab navigator wired to key sections (native tab bar with icons + labels).
- Basic user profile screen (static — no live data yet).
- Admin panel foundation (Next.js web app): login, auth, basic layout. Admin API routes designed to be consumable by both the Next.js admin panel and the native Android admin section (to be built in Phase 6).
- Deep link configuration scaffolded: Expo Linking + Android App Links + iOS Universal Links. Deep link URL scheme registered in `app.json` (`associatedDomains` for iOS, `intentFilters` for Android). SEO-friendly public routes (`/u/<username>`, `/r/<slug>`, `/c/<slug>`, `/g/<slug>`) defined for: user profiles, Rooms, courses, games, Guilds, referral links (`?r=` attachable to any page), shared content, notification tap targets. App-link association files served at `/.well-known/assetlinks.json` (Android) and `/.well-known/apple-app-site-association` (iOS).
- Environment variable structure defined and documented (separate `.env` for Expo app and for Next.js; `DATABASE_PROVIDER`, `STORAGE_PROVIDER`, `REALTIME_PROVIDER` clearly documented).
- x_manifest structure defined with all configurable values: AdMob IDs, payment provider selection, feature flags, PWA per-platform toggles (web / Android / iOS).
- Seed content loader.
- PWA manifest and Service Worker skeleton (Next.js web version only; PWA per-platform toggle wired from x_manifest).
- Light and Dark mode in the React Native app (using React Native Paper, NativeWind, or equivalent — no gradients, no purple hues).
- i18n architecture setup using `react-i18next` or `expo-localization` + i18next (English only wired initially).
- CAPTCHA integration on web (Google reCAPTCHA default, Cloudflare Turnstile toggle). On mobile: API-side rate limiting and trust signals.
- EAS Build configuration (`eas.json`) scaffolded and committed from day one. `app.json` sets `android.targetSdkVersion: 36` (Android API Level 36 minimum).

**Does not include:** Messaging, Credits, Rooms, Guilds, payments.

---

### Phase 2 — Messaging & Social Graph

**Goal:** Users can communicate. Social connections exist.

**Deliverables:**
- 1-on-1 DMs with plan-based Credit cost enforcement and daily reply/send limits.
- Text messages, reactions, GIF search integration.
- DM conversation score tracking.
- Message bandwidth optimisation (image compression, offline queue).
- Anti-spam: silent blocking of phone numbers, links, and emails in new DM conversations until 2 replies from recipient.
- Group chat creation and management (up to 300 members standard).
- Friend and Follow relationship system.
- XP award for all messaging activities (main rank XP + Social Track XP).
- Offline message queue (IndexedDB for web; Expo SQLite for Android — synced on reconnect).
- Referral link generation and tracking (two-tier referral system, numeric IDs, `?r=` format).
- New Member Quest (Steps 4 and onward from onboarding).
- Guild Discovery prompt (after 24 hours).

---

### Phase 3 — Virtual Economy & Payments

**Goal:** Credits exist, can be purchased, and can be spent.

**Deliverables:**
- Dual currency system: Credits and Stars (data model and ledger).
- Immutable Coin ledger (append-only transaction log).
- Credit Store UI and inventory system.
- Credit packs and pricing (admin-configurable in database).
- Paystack integration (Nigeria web/PWA — credit purchases and subscriptions).
- crypto integration (international web/PWA — credit purchases and subscriptions; also available as Nigeria web option via admin toggle).
- Google Play Billing integration (Android APK only — via react-native-iap; replaces the deprecated expo-in-app-purchases, which does not build on Expo SDK 51). This is the sole in-app purchase mechanism on Android per Google Play policy.
- Gift system: gift catalogue, gift animations, gift messages, room-wide spectacle logic.
- Credit gifting between users (with 5% platform fee).
- DM Credit cost enforcement (deducted from sender's wallet on send).
- Star currency data model and acquisition triggers (Prestige milestones, Season top performers).
- Subscription plan management (Plus, Pro, Max) — billing, plan upgrades/downgrades.
- Pay-as-you-go booster packs.
- Coin wallet UI (balance display, transaction history, top-up flow).
- Admin: withdrawal approval queue, payout account balance monitoring and alerts, financial anomaly detection.
- Financial integrity: atomicity, idempotency, decimal precision, row-level locking.
- Withdrawal threshold configuration and manual approval flow.

---

### Phase 4 — Rooms & Creator Economy

**Goal:** Creators can build communities and earn. Users can discover and join Rooms.

**Deliverables:**
- Room creation flow (all Room types: Free Open, VIP, Drop, Tipping, ClassRoom, Guild Room).
- Room discovery feed (city proximity, category affinity, friends-in-room, trending, creator tier).
- Room moderation tools (mute, remove, auto-moderation rules, co-moderator appointment).
- Room public posting with anti-spam enforcement (no links/phone numbers/emails).
- Top Gifter leaderboard per Room (real-time, updated via Supabase Realtime).
- Gift economy in Rooms: gift animation, room-wide spectacle, creator gift balance.
- Creator dashboard (revenue summary, member analytics, top gifters, payout history, Room health score).
- Creator payout account setup (bank account verification via Paystack Resolve Account API for Nigeria; USDT Tron wallet address for global creators).
- Creator payout flow: method selector (bank transfer / credits / USDT), auto/manual approval mode, retry logic, dead-letter queue, appeal pipeline.
- Creator Fund data model (per-activity admin-configurable contribution splits + manual top-up, distributed by engagement score — see §14).
- ClassRoom curriculum builder (modules, pinned resources, start/end dates).
- Zobia Learning Certificates (Knowledge Track Level 25+ creators can issue).
- Business Account application and management.
- Creator tier progression (Rookie, Rising, Verified, Elite, Zobia Icon).

---

### Phase 5 — Gamification Engine

**Goal:** Full XP engine, progression tracks, Season system, Guilds, and Nemesis active.

**Deliverables:**
- Full XP engine wired to all activity sources (messaging, rooms, guilds, quests, social).
- All six progression tracks (Social, Creator, Competitor, Generosity, Knowledge, Explorer) with milestone unlocks.
- Daily quest deck system (plan-based deck size, midnight reset, CRON-triggered).
- Season system: Season creation (admin-managed), Season Pass (free and paid tiers), Season leaderboards, competitive rank reset, Season closing ceremony Room, Season History shelf on profile.
- Prestige system (unlocks at Zobia Icon max sub-level, voluntary, exclusive rewards).
- Guild system (creation, roles, Treasury, tier progression, Guild Wars, Guild Quests, Contribution Score, Alliance System).
- Guild War engine (declaration, matchmaking, 48-hour active phase, Final Hour double points, resolution, Rematch Token).
- Nemesis system (weekly assignment, home screen widget, Challenge button, notifications).
- Mystery XP Drop trigger (algorithmically randomised, CRON-triggered).
- Elder system (Prestige 3+ eligibility, Mentee management, Mentorship Bonus).
- Platform Council (top 50 by Legacy Score invited monthly).
- Presence layer (online rings, Room pulse bars, ambient XP activity banners, leaderboard ripple notifications).
- Full leaderboard system: user rank, city leaderboard, national leaderboard, Season leaderboard, Guild Season standings.

---

### Phase 6 — Moderation, Monetisation & Ads

**Goal:** Full trust and safety stack, AdMob integration, advertising features operational.

**Deliverables:**
- Reporting system (inline report for messages, Rooms, users, Guilds) with auto-categorisation by AI.
- Community Notes feature (admin-toggled).
- Human moderator role system (admin can upgrade users to Moderator).
- AI moderation escalation pipeline (DeepSeek primary, Gemini fallback). Escalation used sparingly.
- Trust Score system (private, silently gates high-sensitivity features).
- Identity KYC (Tiers 1-3) for the blue verified checkmark and higher selling/ad
  limits: Tier 1 (BVN via Paystack for Nigerians, govt ID + proof of address
  elsewhere, AI or manual review), Tier 2 (video statement + ID + AI liveness
  heuristic, always manually reviewed), Tier 3 (bank-grade physical/in-person
  check, admin-scheduled from the review queue). All KYC PII (BVN digits,
  encrypted ID numbers, uploaded documents) is protected by row-level security
  and hard-deleted immediately on account deletion.
- Suspension and ban enforcement (DMs, Room posting, coin receipt, payout hold).
- AdMob integration (banner, interstitial, rewarded video ads, Capacitor Android only) — configuration from x_manifest.
- Rewarded ad flow: free-tier users watch ad, earn Credits, daily cap enforced.
- Self-service ad control panel (`/business/ads`, `/ads`): verified Business Account + KYC Tier 1+ advertisers create CPM-billed campaigns (banner/native/interstitial/rewarded/in-stream), fund them with Credits, and submit for AI or manual moderation.
- In-stream native ads in free Rooms (one ad every N messages) and Blog/Room boosting via the same campaign system.
- Admin ad control panel (`/admin/ads`): moderation queue, placement/CPM catalogue, coupon system, and platform-wide ad revenue overview.
- Branded Room sponsorship management (admin creates and manages sponsored Rooms).
- Sponsored Leaderboard Banners (admin-managed).
- Business Account management UI (admin and business user facing).
- Full email notification system (Mailgun) with admin toggles and granular controls.
- Re-engagement sequences (3-day, 7-day, 14-day, 30-day, 90-day) via push and email.
- Admin moderation dashboard: queue, AI confidence score, one-click actions, escalation history.
- Admin automated actions log (content removed, users flagged, mystery drops fired — all reversible by admin with note).
- Admin alerts and monitoring dashboard (low payout balance, large withdrawal pending, report spike, webhook failures, CRON failures, AI API errors).
- Footer Script Manager (admin inserts analytics, ad, tracker scripts from admin panel).
- **Admin In-App Messaging:** Direct messages to specific users, bulk broadcast to all users, bulk broadcast by plan, bulk broadcast by role. Cross-delivery via Telegram DM for users with connected Telegram accounts. Delivery tracking (sent, delivered, read). User-side inbox for admin messages (distinct from user DMs, non-repliable for broadcasts). Works on web, Android, and PWA.
- **Announcement Modal:** Admin creates up to 5 modals (inactive by default), with HTML/plain-text content, scheduling (start/end datetime), activation toggle, audience targeting by plan and/or role, serial or random rotation mode, "×" dismiss button. One modal shown per login. Renders correctly on web, Android (React Native Modal), and PWA.
- **Announcement Top Banner:** Admin creates up to 5 banners (inactive by default), with HTML/plain-text content, scheduling, activation toggle, audience targeting by plan and/or role, serial or random rotation mode, "×" dismiss button (dismissed for session only, reappears on next login). Fixed non-scrolling position at top of screen across all platforms. Layout shift applied to main content area when banner is active. One banner shown at any given time.
- **Android admin panel mirror:** A dedicated native admin section in the Android app providing feature parity with the web admin panel where practical. Uses the same admin API routes as the web panel. Accessible only to accounts with admin role. Covers: platform overview stats, user management (search, suspend, ban), moderation queue, financial monitoring, payout approvals, alert notifications, and admin messaging compose/send.

---

### Phase 7 — PWA, APK, Polish & Launch Readiness

**Goal:** Full PWA and Android APK builds, all i18n wired, offline experience complete, documentation done.

**Deliverables:**
- Full PWA build for the Next.js web version (Service Worker, offline shell, offline message queue, cache strategy). PWA per-platform toggle (web / Android / iOS) verified working from x_manifest.
- Android APK finalised via Expo EAS Build. EAS Build configuration (`eas.json`) committed to repo. APK build triggered automatically on push to main via GitHub Actions calling EAS CLI. Keystore managed via EAS or stored as a GitHub secret for self-managed signing. Final APK verified targeting Android API Level 36 (Android 16) minimum.
- React Native offline experience: MMKV for key-value storage, Expo SQLite for structured offline data, offline message queue, graceful fallback states for all network-dependent screens.
- AdMob fully wired via `react-native-google-mobile-ads` in the Expo app.
- Deep links fully verified: all defined deep link routes tested (profiles, Rooms, Guilds, referrals, notification tap targets). Android App Links verified working with HTTPS domain association file.
- Database provider switch tested: a full regression run executed with `DATABASE_PROVIDER=railway` and `DATABASE_PROVIDER=digitalocean` to confirm zero Supabase dependencies leak in non-Supabase modes.
- Storage provider switch tested: Cloudflare R2 storage adapter verified working as a Supabase Storage replacement.
- Full i18n wiring: all nine launch languages (English, French, Arabic, Hausa, Kiswahili, Amharic, IsiZulu, Portuguese, Pidgin) with translations. RTL layout for Arabic.
- APK build configuration from x_manifest (AdMob IDs, payment provider selection, feature flags).
- Performance audit: Lighthouse scores, low-bandwidth simulation tests.
- Accessibility audit (screen reader compatibility, contrast ratios, touch target sizes).
- SEO: meta tags, Open Graph, structured data, sitemap, robots.txt for web-facing public pages.
- Seed content fully populated.
- Cultural Vitality Calendar data populated for first 12 months.
- SETUP.md and HOW-IT-WORKS.md completed (see Section 29).
- E2E test suite complete.
- Load test suite complete.
- Financial test suite complete.

---

## 27. Expansion Roadmap

### Phase A — Nigeria First (Months 1–12)

**Geographic focus:** Lagos, Abuja, Port Harcourt, Kano, Ibadan, Enugu.

**Market approach:** Campus-first seeding. University Guilds form naturally around campus identity. Influencer seeding via skit makers and social media personalities within campus communities.

**Infrastructure priorities:** Paystack as primary payment gateway. Data compression for 3G reliability. Under 15MB APK.

**Success metrics at 12 months:** 100,000 registered users, 15,000 daily active users, 500 active Guilds, 200 monetised Creators, 1 operational Legend Guild.

### Phase B — West Africa (Months 12–24)

**New markets:** Ghana, Côte d'Ivoire, Senegal, Cameroon.

**Localisation:** French-language UI for Francophone markets. Local cultural calendar events. Country-specific city leaderboards. Cedi and FCFA payment integration.

**Key adaptation:** Guild system gains country-level meta-competition — Nigerian Guilds can join Pan-African Alliance Wars.

### Phase C — East Africa (Months 24–36)

**New markets:** Kenya, Tanzania, Uganda.

**Payment:** M-Pesa integration for Kenya and Tanzania.

**Product additions:** Swahili language support (already in launch set), Kenya-specific cultural events, cross-regional Creator ClassRooms.

### Phase D — Diaspora (Months 30–42)

**Target:** African diaspora in UK, US, Canada.

**Features:** Currency-native coin pricing (£, $, CAD), "Home Crew" Guild designation for diaspora members connected to a Nigerian city Guild, Zobia as a cultural identity platform for diaspora communities.

---

## 28. Testing Strategy

### Priority Order

1. End-to-End (E2E) tests.
2. Financial and payment integrity tests.
3. Load and performance tests.
4. Unit tests for business logic (XP calculations, Coin ledger, payout computation).
5. Security penetration tests.

### E2E Tests (Required — using Playwright or Cypress)

- Full onboarding flow (new user creation through first quest completion).
- DM send and receive flow (all plan tiers, Credit deduction verification).
- Coin purchase flow (Paystack sandbox, crypto testnet, Google Pay sandbox).
- Gift send and receive flow (Coin deduction, ledger entry, XP award).
- Room creation, join, and post flow.
- Guild creation, war declaration, war resolution flow.
- Creator payout request and admin approval flow.
- Suspension enforcement (verify suspended user cannot send DMs or post).
- Admin login and is_admin database check verification.
- Season reset flow (verify rank reset, track preservation).
- Referral link flow (Tier 1 and Tier 2 bonus verification).

### Financial Tests (Required)

- Concurrent coin spend race condition (two simultaneous requests to spend the same coins — verify only one succeeds).
- Idempotent webhook delivery (replay the same payment webhook twice — verify only one coin credit).
- Coin ledger atomicity (simulate a failure mid-transaction — verify no partial writes).
- Decimal precision (verify calculations are exact for all coin/cash conversions with no floating-point drift).
- Payout threshold enforcement (verify withdrawals above threshold are held for approval).
- Creator payout calculation (verify 80/20 split is exact across all gift and subscription scenarios).

### Load Tests (Required — using k6 or Locust)

- 1,000 concurrent users on the Room feed (Supabase Realtime).
- 500 concurrent Guild War Final Hour submissions (War Point writes).
- 10,000 daily CRON trigger (quest reset, leaderboard update) — verify completion within acceptable time.
- Thundering herd simulation: 500 users logging in simultaneously at midnight (daily reset).

---

## 29. Documentation Requirements

Upon completing the build, the developer creates a `/docs` folder containing:

### SETUP.md

Assumes a developer new to the project. Must include:
- Prerequisites (Node.js version, Vercel account setup, payment provider accounts, Mailgun account, DeepSeek API key, Gemini API key, AdMob account setup, Expo account and EAS CLI, Redis provider setup).
- Step-by-step project setup with NO CLI assumed beyond `npm install` and `vercel deploy`. Explain every command.
- **Database provider setup:** Separate setup instructions for each supported provider (Supabase, Railway PostgreSQL, DigitalOcean Managed PostgreSQL). Explains `DATABASE_PROVIDER` env var. Explains how to run migrations against each provider. Explains PgBouncer configuration for Railway and DigitalOcean. Explains how to add a new database provider.
- **Object storage setup:** Instructions for Supabase Storage (default) and Cloudflare R2 (non-Supabase recommendation). Explains `STORAGE_PROVIDER` env var. Includes R2 bucket creation, API token setup, and CORS configuration.
- **Auth setup:** Explains that auth is platform-managed (not Supabase Auth). Step-by-step for Google OAuth app creation and Telegram bot creation for Login. Explains that the same auth config applies across web, PWA, and Android app. Notes the `DATABASE_PROVIDER` dependency for the user session table location.
- Environment variable listing: every required env var, what it does, where to get it, and where to put it in Vercel.
- Protecting secrets: which values are sensitive, how to rotate them, what to do if a secret is compromised.
- x_manifest configuration: every field explained, including AdMob IDs, payment provider selection, feature flags, minimum age, CAPTCHA provider (reCAPTCHA default / Turnstile toggle), payout provider, coin conversion rate, PWA per-platform toggles (web / Android / iOS).
- CRON setup: Vercel Hobby Plan CRON limitation (once daily). Detailed instructions for setting up cron-jobs.org (or equivalent) as the external trigger for higher-frequency operations. This is a required setup step.
- Database migrations: how to run them, how to roll back (instructions per database provider where steps differ).
- Seed content: how to load, how to reset.
- Deployment of an updated version: step-by-step for pushing a new version with zero downtime.
- Rollback runbook: how to revert to the previous version if a deployment fails.
- Backup and restore runbook: backup schedule and restore procedure per database provider. How to verify a restore.
- APK build: Expo EAS Build setup, `eas.json` configuration, EAS account creation, Android API Level 36 (`targetSdkVersion`) verification, keystore generation and management, Google Play signing configuration, how to trigger a build from GitHub Actions, how to download the output APK from the EAS dashboard.
- Deep links: how to verify Android App Links are working, how to test deep link routing from the command line, how to update the `/.well-known/assetlinks.json` file when the signing key changes.
- Secret rotation runbook: steps for rotating each secret type (JWT secret, payment provider keys, AI API keys, Mailgun API key) without downtime.

### HOW-IT-WORKS.md

Comprehensive explanation of all platform features — both user-facing and admin-facing. Must include:

- All user features: onboarding, DMs, messaging, Rooms, Guilds, XP system, dual currencies, gifting, Seasons, Prestige, creator economy, social graph, Nemesis, Elder, Platform Council, referral system, notifications, deep links.
- All admin features: dashboard sections, feature flags, financial monitoring, moderation tools, automated actions log, alerts, email controls, footer script manager, configuration management, Android admin mirror.
- Technical explanations: how the XP engine works, how the coin ledger works, how the payout pipeline works, how the AI moderation pipeline works, how the CRON architecture works, how offline sync works (web vs Android), how the JWT + Redis session system works, how the database provider abstraction works, how the storage provider abstraction works, how the auth system works (platform-managed JWT, no Supabase Auth), how deep links are structured and routed.
- Edge cases documented: what happens when a user is suspended mid-war, what happens when a payout account is low, what happens when an AI provider fails, what happens when a CRON job fails, what happens when the active database provider is switched, what happens when offline messages fail to sync.

---

## 30. Games & Gaming Track (v1.72)

A first-class mini-games arcade that reuses the existing economy, progression and
referral systems. Games are a retention and virality lever (challenge friends, share
links, daily play streaks) and a monetisation surface (ads + optional play costs +
wager rake).

### 30.1 Overview

- **Central directory** (`/games`, in-app) lists active games grouped by category.
- **Public game pages** at `/g/<slug>` are crawlable cover pages. Non-members see a
  **login gate** ("Log in to play this game"); members get a **Play** CTA and a
  **share** button that appends their referral code (`/g/<slug>?r=<code>`).
- **Categories (13 categories, 57 games):** Tap (Tap Frenzy, Bubble Burst, Reaction Rush,
  Color Tap, Speed Tap, Color Rain), Arcade (Snake, Brick Buster, Flappy Duck, Stack Tower,
  Platform Jumper, Pixel Runner, Asteroid Dodge), Puzzle (Tetris, 2048, Memory Match, Slide
  Puzzle, Minesweeper, Color Sort, Sudoku, Word Search, Lights Out, Number Match, Nonogram,
  Pipe Connect, Sliding Blocks, Mahjong Solitaire), Card (Blackjack, Whot!, Higher or Lower),
  Board (Chess, Ludo, Ayo), Idle (Cookie Kingdom, Galaxy Miner), Word (Word Scramble, Simon
  Says, Word Guess, Hangman, Anagram Rush), Action (Speed Dodge, Star Blaster, Whack-a-Mole,
  Fruit Slicer), Casual (Rock Paper Scissors, Tic Tac Toe, Connect Four), Trivia (Quick Quiz,
  True or False, Emoji Quiz, Flag Quiz), Strategy (Gem Swap, Dots & Boxes), Sports (Penalty
  Kick, Basketball Shot), Music (Beat Tap).
- **Cross-platform:** each game is a single HTML5/canvas module rendered on web/PWA
  directly and inside a WebView embed (`/g/<slug>/embed`). Write once, run everywhere.
  The now-retired Expo app loaded this embed in `react-native-webview`
  (`GameWebView.tsx`, §32.9 below); the Capacitor app (v2.10) loads the same
  embed page in a plain `<iframe>` — since the Capacitor app already runs
  entirely inside one WebView, that's the native-equivalent way to keep the
  player inside the app instead of handing off to the system browser (the
  prior behaviour, and the one users reported as feeling like being kicked
  out of the app to play). `GameRunner`'s lifecycle bridge (`bridge()`) now
  posts to `window.parent` for this iframe case alongside its existing
  `window.ReactNativeWebView.postMessage`. `middleware.ts`'s CSP narrowly
  allows only `/g/<slug>/embed` to be framed by the Capacitor app's own
  origin (`https://localhost` / `capacitor://localhost`) — every other route
  keeps `frame-ancestors 'self'`. On `game_over`, the Capacitor host
  invalidates the same `['users', 'me']` query the Wallet page already treats
  as the source of truth for `coin_balance`, and fires a floating "+X
  Credits / +X XP" reward pop-up (`FloatingRewardProvider`, Android's first
  such notification — see §32).

### 30.2 Rewards, costs & the Gaming track

- Admin sets, **per game**: credits / XP / stars awarded per win, and an optional
  **play cost** (free, or N credits / N stars to play).
- A **solo "win"** = a new personal best with a positive score (rewards genuine
  improvement, resists farming). Rewards are granted idempotently via the coin/star
  ledgers and `safeAwardXP` on the new **`gaming`** track.
- A new **Gaming progression track** (`xp_gaming` / `level_gaming`) is the 7th of the
  Seven Parallel Tracks (§7), with milestone titles/badges (L5 Rookie Gamer, L20 Pro
  Gamer, L50 Game Legend) via the existing `track_milestone_unlocks` engine. It appears
  everywhere the other six tracks do: profile track badges, and its own tab (positioned
  right after Generosity) on the main Leaderboards page (`/leaderboards?track=gaming`).
- **Games-played milestones** (admin-configurable thresholds → credits/XP/stars)
  reward cumulative play.

### 30.3 Challenges & wagers

- A user challenges another to a game **best-of-1 or best-of-3** (async score model:
  each plays the same game; higher score wins the round).
- Optional **credit wager**: both stakes are escrowed on accept; the winner takes the
  pot **minus a configurable platform rake** (`game_wager_rake_pct`, default 5%).
  Decline / cancel / expiry refunds both. All movements are idempotent.
- **Lifecycle**: a challenge stays open for `game_challenge_expiry_hours`
  (**default 720 = 30 days**) — the challenges list shows a live countdown on every
  pending/active challenge. If the opponent never responds within that window it's
  swept to `expired` (refunding any escrow) by the `/api/cron/games` job. The
  challenger can **delete** a pending challenge any time before the opponent accepts
  (nothing is escrowed yet, so there's nothing to refund); once accepted, use Cancel
  instead. Completed challenges are never deleted (they're the wager/prize audit
  trail) but either participant can **archive** one to hide it from their inbox.
- **Android parity:** `apps/android/src/routes/games/challenges/index.tsx` (inbox +
  create form) and `games/challenges/$id.tsx` (round detail) port the same flow
  natively, reusing every endpoint above — accept/decline/cancel/delete/archive, the
  debounced opponent-username search, and the expiry countdown. The wager is always
  shown as a gold badge before an Accept/Send action commits to it. "Play your round"
  hands off to the existing `games/$slug/play.tsx` embedded iframe player with
  `?c=<challengeId>` forwarded through to `/g/<slug>/embed`, returning to the
  challenge detail page (not the game page) on exit. `game_challenge_*` push
  notifications now deep-link to `/games/challenges/<id>` on both platforms.

### 30.4 Game UX & Discovery

- **Discovery page** (`/games`): Popular / Trending / New / ❤️ Faves / 🔀 Random /
  🕐 Recently Played tabs, a search bar (name/tagline, 250ms-debounced), category
  filter chips, Free/Paid filter, card and list view toggle, cursor-based pagination
  (Load More; Random re-shuffles instead of paging).
  - **Favorites** ("❤️ Faves"): heart icon on every game card/row, backed by
    `game_favorites` (mirrors the Room Pins pattern, unlimited — not plan-gated).
    Favorited games show a `❤️ <count>` alongside their rating/play-count meta.
  - **Recently Played**: a thin recency view over the existing `game_plays` table
    (no separate visits table needed — every play session already has a
    timestamp), most-recently-played game first.
  - The **Leaderboards** link on this page goes straight to the Gaming tab
    (`/leaderboards?track=gaming`); the separate per-game high-score board lives at
    `/games/leaderboards` (§30.5).
- **Difficulty settings**: Easy / Medium / Hard per play session, persisted to localStorage
  per game, passed to every engine via `GameEngineProps.difficulty`. Difficulty can also
  **ramp up over the course of a round** — e.g. Fruit Slicer speeds fruit fall/spawn up a
  notch every 60s (Easy) / 45s (Medium) / 30s (Hard), capped after 8 steps, so a fixed
  score ceiling can't be farmed indefinitely.
- **In-game controls** (via GameRunner): pause/resume button, sound toggle, live score HUD,
  "How to Play" modal (populated from game's `long_description`), a **"Game Over" end
  screen** (final score, new-best banner, reward summary, star rating) with **Play
  Again**, **More Games** (→ `/games`) and **Quit** (→ back to the game's own cover
  page, or the host app for challenge rounds/embeds) actions.
- **Sound effects**: All games use Web Audio API synthetic tones via `useGameSound` hook —
  no external files, subdued and comforting, with on/off toggle in GameRunner.
- **Star ratings**: 1-5 star ratings stored per (user, game) in `game_ratings` table.
  Aggregate `avg_rating` and `rating_count` maintained on the `games` row.  POST
  `/api/games/<slug>/rate` with `{ rating: 1-5 }`.
- **Play counts**: formatted as human-readable abbreviations (1.35K, 42.19M) for display;
  raw integer stored in DB.
- **Share game links**: `/g/<slug>?r=<referral_code>` appended automatically from user's
  referral code.
- **Public cover page** (`/g/<slug>`): includes site navigation (login/signup for guests,
  full nav for members), how-to-play content, cost/reward summary, share button.
  `/g/` root redirects to `/games`.
- **Paid games**: admin sets `play_cost_credits` and/or `play_cost_stars`; cost is shown
  only when > 0. Deducted from user wallet at session start via existing ledger.
- **PvP (Chess, Ludo)**: AI opponent now; base infrastructure is in place to wire into
  realtime multiplayer in a future phase.

### 30.5 Leaderboards & ads

- **Per-game high-score** leaderboards (Postgres `game_best_scores` + 60s Redis cache),
  at `/games/leaderboards`.
- **Gaming-track ranking** via the existing leaderboard snapshots (`track=gaming`), on
  its own tab (after Generosity) on the main `/leaderboards` page.
- **Plan column visibility (all leaderboard tracks, not just Gaming):** the Plan
  column on `/leaderboards` shows another user's subscription tier, so it's only
  rendered for **Moderator/Admin** viewers — `is_admin`/`is_moderator` is re-checked
  fresh from `users` on every request (never trusted from a client claim), and the
  API omits the `plan` field entirely from the response for everyone else rather than
  just hiding it client-side.
- **Ads** are admin-togglable via `game_ads_enabled` and `game_ads_directory_enabled`
  manifest flags (no fixed ad slots hardcoded in game pages).
- **Android parity:** `apps/android/src/routes/games/leaderboards.tsx` is a game
  picker in front of the same `GET /api/games/<slug>/leaderboard` endpoint, linked
  from the Games hub header alongside Challenges.

### 30.6 Admin controls

- **Master toggle** `feature_games` (Feature Flags) turns the whole feature on/off.
- **`/admin/games`**: per-game activate/deactivate, edit cover page (name, slug, short
  & long description, emoji, cover image URL, category), reward & play-cost config,
  score cap, min play time, sort order; view per-game stats (plays, players, wins,
  challenges, wager volume); manage games-played milestones.
- Runtime config keys at `/admin/config`: `game_wager_rake_pct`,
  `game_challenge_expiry_hours` (default 720 = 30 days), `game_default_reward_credits/xp`.

### 30.7 Adding a new game (dev)

The infrastructure is generic — adding a game is a plug-in:
1. Add an entry to `shared/utils/games.ts` (`GAME_REGISTRY`).
2. Add an engine component at `apps/web/components/games/engines/<engineKey>/`.
3. Register it in `apps/web/components/games/engineRegistry.ts`.
4. Add a seed row (admin then edits cover/rewards at runtime).

No new sessions/scoring/leaderboard/challenge/ads/WebView code is required.

### 30.7 Anti-cheat posture

Scores are client-reported (canvas games), mitigated by: server-issued single-use
play-session nonces (one score per session), a per-game `max_score` cap, a
`min_play_seconds` floor, a dedicated `game:score` rate limit, and idempotent reward
references. Documented as a known limitation, acceptable for friendly arcade play.

### 30.8 Save Slots

Users can pause an in-progress game and resume it later — a limited,
plan-gated pool of "save slots" shared across all games (not per-game):
**Free 0 / Plus 1 / Pro 3 / Max 5**, admin-configurable at `/admin/config`
(`save_slots_<plan>`). Only one in-flight save per specific game is kept
(saving again overwrites it); a finished (resumed-and-completed) game frees
its slot automatically.

- **Engine contract**: `GameEngineProps` gains optional `initialState` /
  `onStateChange` (`apps/web/components/games/types.ts`). An engine that
  wants to support Save Slots implements both — reads `initialState` to
  restore, calls `onStateChange` with a JSON-serializable snapshot whenever
  it's meaningful to resume from (at minimum, when `GameRunner` pauses it).
  Engines that don't implement this are simply not save-able; `GameRunner`
  only shows "💾 Save & Quit" for engines listed in `SAVE_SUPPORTED_ENGINES`
  (`components/games/GameRunner.tsx`). Reference implementation: 2048
  (`components/games/engines/g2048`).
- **API**: `GET/POST /api/games/saves`, `GET/DELETE /api/games/saves/[saveId]`,
  `POST /api/games/saves/reconcile` (trims to the current plan limit —
  explicit `deleteIds` for the interactive "pick which to delete" flow, or
  oldest-first automatically).
- **Management UI**: `/games/saved` (web/PWA); `apps/android/src/routes/games/saved.tsx`
  (Capacitor — Android has no in-app gameplay engine yet, so "Resume" opens
  the web play page in the in-app browser).
- **Downgrade/expiry overage**: see "Subscription Grace Period" (§3) —
  Save Slots is a grace-gated feature (`saved_games` in
  `lib/plans/graceFeatures.ts`), preserved by default during the grace
  period and purged (oldest-first, down to the new plan's limit) once it
  elapses, or immediately reconciled interactively when a user manually
  drops save-slot capacity below their current save count.

---

## 31. Answers — Mini Forum (Q&A) (v1.96)

A Reddit-style community Q&A: users ask questions, others answer with
Reddit-style nested (indented) replies, everyone can upvote/downvote, and
questions can be favorited. Built to reuse the platform's existing economy,
progression, moderation and admin infrastructure rather than introducing a
parallel system.

### 31.0 SEO — public URLs, categories, sitemap (v1.97)

- **Public, crawlable question page**: `/a/<slug>` (web/PWA — see
  `app/a/[slug]/page.tsx`), a lightweight SSR preview mirroring the
  `/r/<slug>` room pattern (§ "Public URL Structure — SEO-Friendly Slugs"):
  title/description/OpenGraph/Twitter metadata, a self-referential
  canonical tag, `QAPage`/`Question`/`Answer` JSON-LD structured data, and a
  "Join Zobia Social to answer or vote" CTA. Only `status = 'visible'`,
  non-deleted questions resolve — removed/needs_review content never leaks
  to crawlers. Legacy `/a/<uuid>` links and retired slugs (after a title
  edit) 301-redirect to the canonical slug via the same `slug_redirects`
  mechanism used for rooms/games (`forum_question` added as a valid
  `entity_type`). This public page is distinct from the authenticated,
  interactive experience at `/answers/<id>` (voting, answering, threading),
  exactly as `/r/<slug>` is distinct from the in-room chat UI.
- **Slugs**: `forum_questions.slug` is generated from the question title at
  creation time using the same `generateUniqueSlug()` utility and
  numeric-suffix dedupe convention as rooms/games (`lib/slug.ts`).
- **Categories**: a lightweight `forum_categories` taxonomy (General,
  Relationships & Dating, Money & Business, Tech & Gadgets, School & Career,
  Entertainment & Culture, Sports, Health & Wellness) lets questions be
  organised/browsed by topic. Optional at ask-time (`GET
  /api/answers/categories` powers the picker on `/answers/ask`); shown as a
  badge on the public question page, linking back to a category-filtered
  view of `/answers`.
- **Sitemap**: visible, non-deleted questions are listed at `/a/<slug>` in
  `app/sitemap.ts` (capped at 2000, same convention as rooms/courses/games).
  `/a/` is public in `middleware.ts` (`PUBLIC_PREFIXES`) and allowed in
  `app/robots.ts`.
- **Seed migration**: `db/migrations/0001_consolidated_schema.sql` adds the
  `forum_categories` table + the `slug`/`category_id` columns on
  `forum_questions`, backfills slugs for any pre-existing questions, and
  seeds the 8 categories above (reference taxonomy — always present).
  `db/seed.sql` (run once on fresh deployments, after all migrations) adds
  one starter question per category plus a few sample answers, following
  the exact same platform-admin-authored convention as the seed rooms/
  guilds already in that file.

- **Share (v2.10)**: the authenticated question detail page (`/answers/<id>`
  on web, `routes/answers/$questionId.tsx` on Capacitor) has a Share action
  that shares/copies the canonical public `/a/<slug>` URL (Web Share API
  with a clipboard fallback) — the SEO page above existed with no in-app way
  to actually get its link.

### 31.1 Overview

- **Main page** (`/answers`, web/PWA; `/answers` in the Capacitor Android
  app) has four tabs: **Popular** (highest vote score), **Trending**
  (recency-windowed vote+answer activity in the last 48h), **New** (most
  recent), and **Favorites** (the caller's favorited questions). Cursor-based
  pagination ("Load More" on web, infinite-scroll on Android) — no full
  table scans as content grows.
- **Question detail** (`/answers/:id`) shows the question, an upvote/
  downvote column, a favorite toggle, and threaded answers rendered with
  Reddit-style left-border indentation per nesting level (visually capped
  at depth 6; the data model supports nesting to depth 10). Deep branches
  show **"View N more replies →"**, lazily loading the rest of that
  specific subtree via a bounded recursive query — the initial page load
  only eagerly fetches the first 3 replies per top-level answer.
- **Voting**: one vote per user per question/answer (toggle off by voting
  the same direction again; switch by voting the other direction), enforced
  by a unique `(target_type, target_id, user_id)` constraint. Self-voting is
  blocked. Vote/favorite state for the caller is joined into the list/detail
  SQL query directly (no per-item Redis lookups) — a scalability discipline
  used platform-wide for feed-style data (rooms, games).
- **Best answer**: the question's author (or a moderator/admin) can mark one
  answer as best, shown with a ✓ badge.

### 31.2 Who can post, who can comment

- **Posting a question** requires a minimum account level, admin-configurable
  at `/admin/config` → "Answers" (and mirrored at `/admin/forum/settings`)
  — `forum_min_level_to_post` (default: Level 2).
- **Commenting (answering)** has a separate, lower minimum level —
  `forum_min_level_to_comment` (default: Level 1, i.e. effectively open).
  A user below that level can still comment immediately by spending an
  admin-configured number of Credits instead of leveling up
  (`forum_comment_bypass_cost_credits`, default: 1 Credit).

### 31.3 Rewards

Admin-configurable at `/admin/config` and `/admin/forum/settings` (both
surfaces edit the same `x_manifest` rows):

| Action | Default XP | Default Credits |
|---|---|---|
| Post a question | 10 | 0 |
| Post an answer | 5 | 0 |
| Receive a net new upvote | 1 | 0 |
| Have an answer marked best | 25 | 10 |

Credit rewards default to 0 for questions/answers/upvotes (XP-only) to limit
vote-farming abuse via alt accounts; admins can turn credit rewards on.
A **daily reward cap** (`forum_daily_reward_cap_credits`, default 50)
bounds total forum-sourced Credit rewards a single user can earn per
rolling 24h — an anti-farming ceiling independent of the per-action amounts.
XP is awarded on the existing **Knowledge** progression track.

### 31.4 Moderation & spam filtering

Reuses the platform's existing rules-based content filter
(`lib/moderation/contentFilter.ts`) rather than a parallel system: new
questions/answers are checked for **duplicate-post spam** (same author,
same normalized text, within 60s) and **profanity** (auto-replaced, not
blocking) before being stored. A **Report** button on every question/answer
feeds into the same `moderation_reports` pipeline and AI classifier
(DeepSeek primary, Gemini fallback) used by the rest of the platform — no
separate report queue or AI integration was built.

### 31.5 Admin & moderator control panel

- **`/admin/forum`**: dashboard (pending reports, today's question/answer
  counts, top posters this week).
- **`/admin/forum/queue`**: moderation queue (Pending / Resolved / Escalated
  tabs) for reports targeting forum content, with one-click Dismiss / Warn /
  Remove Content / Suspend / Ban actions.
- **`/admin/forum/posts`**: paginated question/answer management table —
  remove, restore, lock/unlock a question's answers.
- **`/admin/forum/settings`**: the same level-gate/reward/moderation config
  as `/admin/config` → "Answers", exposed in a focused, dedicated view.
- **Moderator access is scoped**: `is_moderator` users (not just `is_admin`)
  can reach `/admin/forum/*` — the queue and posts pages — but not the rest
  of the admin panel. `ban_user` and reversing a removal (`restore`),
  locking/unlocking a question remain admin-only actions within
  `/admin/forum/*`, mirroring the existing admin/moderator split used for
  room moderation. All actions are logged to the shared `admin_actions`/
  `moderation_actions` audit trail and to a forum-specific
  `forum_moderation_log`.

### 31.6 Cross-platform

- **Web/PWA**: `apps/web/app/(app)/answers/**`. Reads flow through
  TanStack Query, which is already persisted to `localStorage`
  (`lib/offline/queryPersist.ts`) — Answers gets offline read caching
  for free, no new offline mechanism was built. Posting requires a live
  server-side level/credit check, so writes are not queued for offline
  replay.
- **Capacitor Android**: `apps/android/src/routes/answers/**`, hand-ported
  (per this app's existing convention — components aren't shared across
  apps, only `@zobia/shared` types) to closely mirror the web/PWA UI,
  reached via the drawer menu (not a 7th bottom-nav tab). Uses the same
  `idb-keyval`-backed query persister already wired into the app for
  offline read caching.
- **Expo app**: intentionally not touched — the Expo app is being
  discontinued in favor of the Capacitor Android app.

### 31.7 Data model

New tables: `forum_questions` (gained `slug` and `category_id` in v1.97 —
see § 31.0), `forum_answers` (self-referencing `parent_answer_id` for
nesting, denormalized `depth`), `forum_votes` (polymorphic
`target_type`/`target_id`, unique per user), `forum_favorites`,
`forum_moderation_log`, `forum_categories` (added v1.97). The existing
`reports`/`moderation_reports` tables gained two new nullable FK columns
(`reported_forum_question_id`, `reported_forum_answer_id`), following the
same discrete-FK convention already used for
`reported_message_id`/`reported_room_id`/`reported_guild_id` — no new
moderation infrastructure was needed.

---

## 32. Blogs (v2.01)

A mini blog/CMS system: any user can run one blog with SEO-friendly public
articles and static pages, categories, comments, subscribers, pay-gated
articles, and a rudimentary purchasable theme system — reusing the
platform's existing economy, XP, plans, moderation and admin
infrastructure rather than introducing a parallel system (same design
principle as § 31 Answers).

### 32.0 Public URLs & SEO

- **Blog home**: `zobia.org/b/<slug>` — SSR, crawlable, lists articles in
  reverse-chronological order with a mini sidebar (categories, popular
  posts) and a top/hamburger menu of the blog's static pages. `/b` and
  `/b/` (no slug) redirect to the authenticated discovery page `/blogs`.
- **Article/page**: `zobia.org/b/<slug>/<postSlug>`. Pages are static, have
  no visible date, and don't show the author info box or appear in
  reverse-chron listings — they only appear in the blog's page menu.
  Articles are dated posts with an author info box (the blog owner can hide
  it) and are listed on the blog home page.
- Pay-gated ("paywalled") articles render a truncated preview
  server-side — good for SEO, crawlers see real content plus the paywall
  notice — with the full body swapped in client-side once a signed-in
  reader has unlocked it (or is the author/a moderator).
- Slugs follow the platform-wide `generateUniqueSlug`/numeric-suffix
  convention (§ "Public URL Structure"); post slugs are unique *within*
  a blog (two different blogs may each have an "about" page). Legacy
  `/b/<uuid>` links and retired blog slugs 301-redirect via
  `slug_redirects` (`entity_type = 'blog'`), same mechanism as
  rooms/games/forum questions.
- `?r=<code>` referral links work on `/b/<slug>` and `/b/<slug>/<postSlug>`
  automatically — no blog-specific capture logic needed (§ "Referral
  System — Two-Tier").
- Live blogs are listed in `app/sitemap.ts` (capped at 2000) and `/b/` is
  public in `middleware.ts` (`PUBLIC_PREFIXES`).

### 32.1 Discovery, creation & the creator dashboard

- **Discovery** (`/blogs`, web/PWA and the Capacitor Android app) mirrors
  the Games/Rooms discovery pages: Popular / Trending / New / Random tabs,
  search, cursor-based pagination. **Subscribed** (web/PWA tab; a simple
  toggle on Android, same convention as the rest of the tab bar being
  web/PWA-only there) lists blogs the signed-in user is subscribed to
  (§32.2), sorted by most recently updated first — "updated" meaning the
  blog's most recent published article, falling back to the blog's creation
  date for blogs with no articles yet.
- Users may create one or more blogs (`POST /api/blogs`), gated by the
  multi-blog quota system in § 32.1.1 — a **personal** blog (default) or,
  additively, a **business** blog under a business account they own
  (`businessAccountId`). The creator dashboard (`/blogs/dashboard`) manages
  articles and pages (draft/published), categories, comment moderation
  queue, stats, and blog settings (comments on/off + moderation,
  author-info-box visibility, subscriber-count visibility, theme, and the
  navigation menu builder, § 32.9) — one blog at a time, with a picker
  ("Your blogs") across the caller's blogs when they own more than one
  (`GET /api/blogs/me` returns `blogs: []` for all of a user's blogs
  across both scopes; `blog` is kept alongside it for backward
  compatibility, set to their first personal blog or else their first
  blog of any scope). The picker, per-post batch draft/delete actions, and
  the articles-remaining nag (§ 32.10) shipped in v2.14 — the web
  "Start a Blog" flow (`/blogs/new`) still only covers plain creation
  within the included quota; surfacing the extra-slot purchase currency
  choice (§ 32.1.1) and business-blog creation inline on that same page,
  rather than only via the API, remains a follow-up UI phase (the
  Android app's equivalent screen already has this).
- **Word limits**: Free-plan articles up to 1,000 words; Plus/Pro/Max up to
  5,000 words. Pages share the same per-plan limit. Admin-configurable
  per plan (`blog_max_words_<plan>` in `x_manifest`).
- **Article/page limits** (combined): Free 30, Plus 100, Pro 200, Max 500.
  Admin-configurable per plan (`blog_max_posts_<plan>`).
- **Stats depth by plan**: Free = totals only ("very basic stats"); Plus =
  totals + a per-post breakdown ("basic stats, more detail"); Pro/Max =
  the above plus a 90-day daily drill-down and CSV export
  (`GET /api/blogs/<slug>/stats/export`). Post view/like/comment counts and
  earnings are visible to the post's creator, blog moderators, and admins
  only.

### 32.1.1 Multi-blog quotas (v2.02)

Blogs are no longer strictly 1:1 with a user. A user's blog quota has two
independent, additive axes — a personal quota from their own plan/level,
and, only if they also own a business account, a separate business quota
from that account's tier. Every number below is admin-configurable via
`x_manifest`; values shown are the shipped defaults.

- **Personal accounts** — included blog count depends on plan, and for the
  Free plan, on the owner's Creator-track level (`users.level_creator`,
  the same creator/reputation level used for other level-gated perks
  elsewhere on the platform):
  - **Free plan, at/above Level 2** (`blog_creator_level_threshold`): 1
    blog included (`blog_included_free`).
  - **Free plan, below Level 2**: 0 blogs included — every blog, including
    the first, requires the extra-slot unlock below.
  - **Plus**: 2 included (`blog_included_plus`) — no level gate.
  - **Pro**: 5 included (`blog_included_pro`) — no level gate.
  - **Max**: 10 included (`blog_included_max`) — no level gate.
- **Business accounts** (additive to the owner's personal quota, mirrors
  the Business Pages tier-slot convention of § 17): Starter 5
  (`blog_business_included_starter`), Growth 20
  (`blog_business_included_growth`), Enterprise 50
  (`blog_business_included_enterprise`).
- **Extra blog slots**: a blog beyond a scope's included count costs a
  one-time unlock, charged automatically at creation time, before the
  blog is created. Personal: 500 Credits or 3 Stars
  (`blog_extra_slot_cost_credits` / `blog_extra_slot_cost_stars`), caller's
  choice of currency, subject to `blog_extra_slot_currencies` (which
  currencies the admin accepts — comma list, default `credits,stars`).
  Business: independently priced, same shape
  (`blog_business_extra_slot_cost_credits` / `_cost_stars` /
  `_currencies`), default identical to personal (500 Credits / 3 Stars).
  Each blog row remembers how its slot was acquired
  (`blogs.slot_source` = `included` or `purchased`, plus the currency/
  amount/ledger-reference actually charged) so quota recalculation after a
  plan or tier change never re-charges or silently drops an already-paid
  slot.
- **Business downgrade grace period**: business blogs are subject to the
  same self-service downgrade grace period as Business Pages (§ 17,
  `business_downgrade_grace_days`, default 30). When the grace period
  elapses, `sweepBusinessDowngrades` deactivates the newest business
  blogs beyond the new tier's included count (oldest-kept, same rule as
  Business Pages) — including ones that were individually paid-unlocked,
  which are not refunded, again matching how excess Business Pages are
  handled.

### 32.2 Categories, comments & subscriptions

- Blog owners define their own categories (`blog_categories`); each
  article optionally belongs to one. Categories and their post counts are
  shown in the blog's sidebar.
- **Comments** default on; the owner can turn them off entirely, or turn on
  moderation so new comments start `pending` and only appear once the
  owner (or a platform moderator/admin) approves them from the dashboard's
  comment queue.
- **Subscriptions**: visitors can subscribe to a blog to be notified (via
  the existing notifications pipeline) when the owner publishes a new
  article. The owner can show or hide the subscriber count publicly.
  A logged-out visitor who taps Subscribe (web/PWA only — the Capacitor
  app is entirely behind its own auth gate, so this can't happen there) is
  sent to login with a one-shot, tab-scoped intent stashed in
  `sessionStorage` (never `localStorage`, so it can't leak between users of
  a shared device); after login they land back on the same blog and the
  subscribe call fires automatically (v2.10) instead of the prior behaviour
  of dropping them at login with no way back to what they were doing.
- **Likes**: readers can like articles; a net-new like awards the author
  1 XP on the Creator track (best-effort, fire-and-forget — never blocks
  the like itself).

### 32.3 Pay-gated ("paywalled") articles

- When publishing an article, the author chooses whether it's free or
  pay-gated, and — if gated — how many Credits unlock it. The public page
  shows a truncated preview with the notice *"Pay N credits to read the
  rest of the article."*
- Unlocking debits the reader's Credit balance once (idempotent — a
  second "unlock" call is a no-op) and credits the article's author with a
  cash-equivalent creator earning (`creator_earnings.source_type =
  'blog_paywall'`), computed as:

  ```
  gross_kobo   = credits_spent × coin_to_cash_rate        (existing platform-wide Credit→kobo rate, § 14 RIZE Coin conversion; default 100 kobo = 1 Credit)
  after_fees   = gross_kobo × (1 − paystack_fee_pct) × (1 − vat_pct)
  creator_net  = after_fees × plan_rev_share_pct
  ```

  Provider-fee/VAT rates and the plan revenue-share table are
  admin-configurable in `x_manifest` (`blog_paystack_fee_pct`,
  `blog_google_play_fee_pct`, `blog_vat_pct`, `blog_rev_share_pct_<plan>`);
  the Credit→kobo conversion reuses the platform's existing
  `coin_to_cash_rate` rather than introducing a second rate. Referral
  commission is **not** re-charged at unlock time — it was already paid
  out to the referrer when the reader originally purchased the Credits
  being spent.
- Default revenue share by the blog owner's platform plan: Free 40%, Plus
  50%, Pro 60%, Max 70% — matching the tiered-value structure used
  elsewhere in the Creator Economy (§ 14).
- Unlocking an article also awards the author 5 XP on the Creator track.

### 32.4 Blog themes

- **Superseded by the theme engine (v2.14, migration 0022)** — kept here
  only as history: the original system equipped one of three purchasable
  Credit cosmetics (`store_items.cosmetic_type = 'blog_theme'`) via
  `POST /api/economy/cosmetics/equip`, which set `blogs.theme_store_item_id`
  and only ever changed a colour skin, not the page's structure. That
  purchase/ownership ledger (`store_items`/`user_cosmetics`) is still the
  underlying record of what a user has bought, and the legacy equip
  endpoint is still a harmless no-op for old clients, but rendering no
  longer reads `theme_store_item_id` at all — see § 32.4.1.

#### 32.4.1 Theme engine v2 (v2.14)

- A `blog_themes` catalogue table (`lib/blogs/themes.ts`) is now the
  source of truth for what a blog can look like: each row is a short
  stable key (`classic`, `minimal`, `editorial`, `sidebar`, `botanical`)
  carrying a structural **layout variant** (`classic` / `magazine` /
  `minimal-cards` / `sidebar-left` — an actual different React component
  tree, not just different colours) plus a `config` of color tokens
  (background/card/accent/text/muted), admin-editable pricing, and
  plan/tier gating. `blogs.active_theme_id` (FK into `blog_themes`,
  default `'classic'`) says which one a blog is currently using.
- **Shipped catalogue**:
  - **Classic** (`classic` layout) — free default, single-column list +
    sidebar. **Minimal Cards** (`minimal-cards` layout) — free default, a
    compact card grid with less metadata per post.
  - **Editorial** (`magazine` layout) — a featured-post hero above a card
    grid; included free for Pro/Max personal plans and Growth/Enterprise
    business tiers, otherwise a 500-Credit purchase.
  - **Noir Sidebar** (`sidebar-left` layout) — a left sidebar of
    categories/recent posts; included free for Max/Enterprise only,
    otherwise 800 Credits.
  - **Botanical** (`minimal-cards` layout, warm green palette) — always a
    1200-Credit purchase regardless of plan/tier.
  - A theme's price and plan/tier-included lists are editable per-theme
    from `/gate44/blogs/themes` without a redeploy; an admin can also
    disable a theme (existing owners keep it equipped, but it drops out of
    the picker for new selections).
- Equipping is per-blog (`POST /api/blogs/<slug>/themes/equip`) rather
  than per-user, matching multi-blog (§ 32.1.1) — two blogs owned by the
  same person can run different themes. A theme that requires purchase or
  plan/tier-inclusion is enforced server-side at equip time, not just
  hidden in the picker UI.
- Every layout variant renders the same anchor targets the default nav
  menu (§ 32.9) points at (`#categories`, `#subscribe`) so the menu builder
  and the theme picker never conflict regardless of which is applied.

### 32.5 Admin controls

- **Feature toggle**: `feature_blogs` in `x_manifest`, following the
  platform-wide `feature_*` convention — turns the entire feature on/off.
- **Monitoring** (`/admin/blogs`): a searchable/filterable table of every
  blog with owner, status, post/subscriber counts, and one-click
  moderation actions — **pause**, **suspend**, **ban**, **deactivate**,
  **restore**, and **delete** — each recorded in `blog_moderation_log`
  with the acting moderator/admin, reason, and timestamp. A suspended/
  banned/deactivated blog and its public pages stop resolving publicly
  (404) until restored.
- **Ownership transfer** (admin-only): `POST
  /api/admin/blogs/<id>/transfer` reassigns a blog (and all of its posts)
  to a different user — e.g. for account-recovery or dispute resolution.
  Since multi-blog (§ 32.1.1), a target user already owning other blogs is
  no longer a blocker — the transferred blog simply becomes one more of
  theirs.

### 32.6 Data model

New tables: `blogs` (slug, status, comment/author-box/subscriber-count
settings, theme; since migration 0018/§32.1.1, `owner_id` is no longer
unique — a user may own several — and gains `business_account_id`
(nullable; set for a business blog) plus `slot_source`/
`slot_unlock_currency`/`slot_unlock_cost`/`slot_unlock_reference_id` for
extra-slot-purchase bookkeeping), `blog_categories`, `blog_posts`
(articles + pages, `type` discriminator, draft/published status, word
count, paywall fields), `blog_post_likes`, `blog_post_comments`
(self-referencing `parent_comment_id`, `visible`/`pending`/`removed`
status), `blog_subscriptions`, `blog_post_unlocks` (one row per
reader-unlock, idempotency guard), `blog_post_daily_stats` (lightweight
per-post/per-day rollup powering the Pro/Max drill-down and CSV export —
incremented alongside the existing view/like/comment/unlock writes, no
extra Redis calls), and `blog_moderation_log`. Revenue reuses the
existing `creator_earnings` table (`source_type = 'blog_paywall'`); themes
reuse the existing `store_items`/`user_cosmetics` tables. Post view counts
are incremented at most once per browser per post — deduped client-side
via `localStorage`, matching the platform's offline-first, low-Redis-call
discipline (§ 22 "Scalability").

Migrations 0019–0024 (v2.14) extend this: `blog_posts` gains
`content_format` (§ 32.7) and `page_key` (§ 32.11); `blogs` gains
`menu_config` (§ 32.9) and `active_theme_id` (§ 32.4.1); new tables
`blog_post_shares`, `blog_post_treasuries`, `blog_post_treasury_claims`
(§ 32.8), `blog_themes` (§ 32.4.1), `blog_contact_messages` (§ 32.11), and
`blog_gift_tiers`/`blog_gift_purchases`/`blog_gift_claims` (§ 32.12) — see
those sections for detail. Full list of blog-related migration files, in
apply order: `0001_consolidated_schema.sql`, `0001_consolidated_schema.sql`,
`0001_consolidated_schema.sql`, `0001_consolidated_schema.sql`,
`0001_consolidated_schema.sql`, `0001_consolidated_schema.sql`,
`0001_consolidated_schema.sql`.

### 32.7 Editor mode: Markdown or plain text (v2.14)

- Every article or page has a `content_format` of `markdown` (default,
  unchanged behaviour) or `plaintext`, chosen per-post by the author in
  the editor. `body_markdown` keeps holding the raw source either way —
  `content_format` only says how to interpret it when regenerating
  `body_html` and when re-populating the editor for a later edit.
- **Plain text mode**: no Markdown syntax is applied; a blank line starts
  a new paragraph, single line breaks are preserved within a paragraph.
  Exists for authors who don't want to learn Markdown and were previously
  seeing their `*`/`#`/`>` characters rendered literally or, worse,
  fighting unintended formatting.
- Existing posts default to `markdown` (the only mode that existed
  before), so no existing content changes appearance.

### 32.8 Per-post credit reward pot ("treasury") (v2.14; edit/close fixed v2.30)

- A blog owner can fund a Credits pot for one of their own posts
  (`POST /api/blogs/<slug>/posts/<postSlug>/treasury`, Credits only —
  no Stars, refused with `BLOG_TREASURY_ALREADY_EXISTS` if an open pot
  already exists): they set the total amount and a maximum number of
  claimants. The first N distinct readers who **comment** on the post or
  **share** it (§ 32.8.1) each earn an equal split, computed at claim time
  as `funded_amount / max_claimants`.
- One claim per reader per post (comment and share don't stack for the
  same person); a claim credits the reader's Credits balance immediately
  and is recorded in `blog_post_treasury_claims`. The pot's status moves
  `active` → `exhausted` once all claimant slots are used.
- **Editing an existing pot** goes through `PATCH` on the same route
  (never a plain re-`POST`, which used to additively bump `funded_amount`
  while overwriting `max_claimants` outright, desyncing the per-claimant
  reward from what earlier claimants had already been paid — fixed
  v2.30): increasing the total debits the difference from the owner,
  decreasing it refunds the difference (never below what's already paid
  out), and `max_claimants` can't drop below the number of people who
  already claimed.
- **Turning a pot off** goes through `DELETE` on the same route: any
  unclaimed Credits are refunded to the owner immediately and the pot
  moves to `closed` (claim history is kept). A closed pot can be re-funded
  from scratch via `POST`.
- The post page shows a "Reward pot" badge with the live per-claimant
  amount and remaining slots to any visitor, and the owner's dashboard
  (`components/blogs/TreasuryPanel.tsx`) shows funded/remaining/claimed
  totals plus "Save changes" (edit) and "Turn off reward" controls.

#### 32.8.1 Share tracking (v2.14)

- Blogs previously had no share signal at all. `blog_post_shares` records
  one row per (post, user) the first time a signed-in reader uses the
  post's Share action (copies the public link) — a unique index makes a
  repeat share a no-op rather than a duplicate treasury claim.

### 32.9 Blog navigation menu & owner toolbar (v2.14, migration 0021)

- Every blog has an owner-configurable `menu_config`
  (`{ orientation: 'horizontal' | 'vertical', items: [...] }`), edited from
  the dashboard's Settings → Navigation menu builder. Each item is a
  label plus one of: a raw URL/anchor (`type: 'url'`, e.g. `#categories`),
  a link to one of the blog's own posts or pages (`type: 'post'` /
  `type: 'page'`, storing the target's slug), or a category anchor
  (`type: 'category'`). The owner can add, relabel, reorder, and remove
  items freely.
- **Orientation only applies on desktop web.** Android and mobile
  web/PWA always render the menu as a vertical accordion inside the
  hamburger icon, regardless of the owner's `orientation` choice, per
  product spec — a phone-width column has no room for a horizontal bar.
- Every new blog is seeded with the same default menu (Home, Categories →
  `#categories`, Subscribe → `#subscribe`); every existing blog was
  backfilled with that same default when the column was added. Every
  layout variant across the theme engine (§ 32.4.1) renders the
  `#categories` and `#subscribe` anchor targets, so the default menu
  resolves correctly no matter which theme is active.
- When a blog is created, its three auto-generated default pages
  (§ 32.11) are appended to this same default menu automatically — the
  owner sees About/Privacy/Contact as menu items from the moment the blog
  exists, not as a separate manual step.
- **Owner toolbar**: the blog owner (or a site admin/moderator) sees an
  extra, visitor-invisible bar alongside the public menu on `/b/<slug>`
  and `/b/<slug>/<postSlug>` with quick links to My Blogs, Blog config,
  Post management, and — on a draft post — a Preview toggle. Rendered
  server-side only when the SSR page has already resolved the viewer as
  the owner/staff, so a regular visitor's HTML never contains this
  markup at all.
- **SEO slug rule**: a blog's slug (and, on rename, its new slug — with
  the old one 301-redirected via the existing `slug_redirects` mechanism,
  same as games/rooms) is generated from at most the **first 6 words** of
  its title, not the full title, keeping URLs short and readable; the
  platform-wide numeric-suffix collision rule still applies on top of
  that.

### 32.10 Articles-remaining quota nag (v2.14)

- The dashboard's post list and the new-post editor show a running
  "You have N article(s) left" (or, at zero, "You have used up all your
  available articles — delete some or upgrade your plan") notice, backed
  by `GET /api/blogs/<slug>/limits` wrapping the existing admin-configurable
  `getMaxBlogPosts` (§ 32.1, `blog_max_posts_<plan>`) — the nag never
  hardcodes plan numbers itself, so an admin changing the manifest values
  is reflected immediately. Below Max plan, it also shows the Plus/Pro/Max
  posts-included figures and an "Upgrade plan" link.

### 32.11 Auto-created About / Privacy / Contact pages (v2.14, migration 0023)

- Every new blog is seeded at creation time with three ordinary
  `blog_posts` rows of `type = 'page'`, tagged `page_key` ∈
  `{'about', 'privacy', 'contact'}` so they survive a title/slug rename
  and get full page CRUD (edit, draft, delete) for free like any other
  page — they are not a special content type. `page_key` is cleared only
  if the owner deletes the page outright.
- **"Reset to default"** (dashboard page editor) regenerates one of the
  three back to its original template text without touching its id, slug,
  or `page_key` — so anything bookmarking or linking to it (including a
  menu item) keeps working. At most one page per key per blog is
  enforced by a unique index.
- **Contact page is special**: rather than rendering `body_html` like
  every other page, the public post page detects `page_key = 'contact'`
  (not a guessable slug string an owner could rename away) and renders a
  live contact form instead. Submissions are captcha-protected for
  anonymous senders (the blog's existing captcha config, admin-set — see
  SETUP.md) and stored in `blog_contact_messages` (sender name/email
  optional for a signed-in sender, message body required), notifying the
  blog owner via the platform's existing notifications pipeline and
  surfaced in a dashboard inbox (`/blogs/dashboard/messages`) that can
  mark messages read.

### 32.12 Rewarded Gifts (v2.14, migration 0024)

A blog subscriber/reader can send an owner-defined "gift" — a one-time
Credits or Stars purchase — to unlock a benefit for themselves. Owners
define any number of **gift tiers** per blog (`blog_gift_tiers`: name,
description, price in Credits and/or Stars, a benefit type, and an
optional `max_redemptions` / `expires_at`), and readers redeem them from
a "Send a Gift" section on the blog's public home page.

- **Benefit types**:
  - `vip_badge` — the buyer gets a small "VIP" badge next to their name
    in that blog's comment threads for as long as the purchase stays
    `active` (one active VIP badge per buyer per blog — a repeat
    purchase renews rather than stacking).
  - `vip_section_access` — the buyer gets the same kind of unlock a
    paywalled post grants (§ 32.3), reusing `blog_post_unlocks` rather
    than a parallel entitlement table.
  - `custom_reward` — an owner-authored reward: a payout from a
    **blog-level** treasury (first N redeemers split a Credits pot,
    reusing the same `blog_post_treasuries` table as § 32.8 with
    `post_id` NULL and `blog_id`/`gift_tier_id` set instead) and/or a
    text blob revealed to the buyer only after purchase
    (`blog_gift_claims.text_revealed`).
- A purchase debits the buyer's chosen currency, records a row in
  `blog_gift_purchases`, and — for `custom_reward` — a corresponding
  `blog_gift_claims` row tracking the text reveal and any treasury
  payout, one row per purchase.
- **Sitewide kill-switch**: `blog_monetization_enabled` in `x_manifest`
  disables Rewarded Gifts *and* the existing paywall/treasury features
  (§ 32.3, § 32.8) in one flip, for a jurisdiction or App-Store-policy
  reason that requires all blog monetization off at once, without
  touching `feature_blogs` itself (the blog feature keeps working,
  just with no money changing hands). A separate, narrower
  `feature_blog_gifts` flag turns off Gifts specifically while leaving
  paywalls/treasuries running. Readers simply see no "Send a Gift"
  section and no reward-pot badge when either is off — no error state.
- **Admin** (`/gate44/blogs/gifts`): both flags plus a cross-blog table
  of every gift tier with a disable override (existing owners' purchases
  are unaffected; the tier just stops accepting new ones). Revenue share
  for gifts follows the same per-plan `blog_rev_share_pct_<plan>` keys as
  paywall unlocks (§ 32.3) — no separate gifts-only rate.

---

## 33. Support Ticket System (v2.10)

A full staff-worked support ticket queue with admin-configurable eligibility,
per-message charging, AI-first triage, and a support/senior-support/admin
escalation path — reusing the platform's existing economy, AI client,
notifications and admin-panel infrastructure rather than introducing a
parallel system (same design principle as §31 Answers and §32 Blogs).

### 33.0 Admin on/off switch and eligibility

- **Master toggle**: `feature_support_tickets` in `x_manifest`
  (`ZobiaManifest.features.supportTickets`), default **off**. When off,
  every `/api/support/*` route returns 503 and the "My Tickets"/"New
  Ticket" UI shows a fallback pointing at the Help Center instead.
- **Who can open a ticket for free**: admin-configurable plan/prestige
  allow-list (`support_eligible_plans`, JSON array), evaluated with the
  same `lib/plans/eligibility.ts` helper (`isPlanEligible`/`getAllowedPlans`)
  already used for Profile Stats tiers and privacy toggles — plan slugs
  (`"plus"`, `"pro"`, `"max"`) and/or prestige-tier entries
  (`"prestige_1"`) are both supported.
- **Paying for access otherwise**: a user outside the allow-list can still
  open a ticket by paying a one-time, admin-set cost in Credits and/or
  Stars (`support_ticket_cost_credits` / `support_ticket_cost_stars` — 0
  means "not payable in that currency"). If neither currency has a cost
  configured, ticket creation is blocked for ineligible users with a clear
  `SUPPORT_ACCESS_DENIED` error, never a silent failure.

### 33.1 Charging model

The admin picks one of four message-charging strategies
(`support_charging_model`, an enum) plus a numeric `support_charging_x`
parameter, applied per-message-index (message 1 is the ticket-opening
message):

- `first_message_only` — the ticket-creation charge covers the first
  message; every reply after that is free.
- `every_message` — every message the user sends is charged.
- `every_x_messages` — every Xth message is charged (X, 2X, 3X, ...).
- `first_x_messages` — only the first X messages are charged; the rest are
  free.

The decision is a pure function (`shouldChargeMessage` in
`lib/support/service.ts`, unit-tested independently of the DB) so the rule
is auditable and safe to change without touching the charging plumbing.
Charging reuses `lib/economy/coins.ts#debitCoins` and
`lib/economy/stars.ts#debitStars` (new `support_ticket_cost` ledger
transaction type on both) with an idempotency reference keyed by
`ticket:message-index`, so a retried request can never double-charge.
**Insufficient balance blocks the message** with a clear client-facing
error — it never silently succeeds uncharged. Free-access users (per
§33.0) are never charged regardless of the model.

### 33.2 Staff roles and senior-support escalation

- **New sitewide role**: `users.is_support` (boolean), grantable/revocable
  exactly like `is_moderator` is today, via the same
  `POST /api/admin/users/[userId]/actions` endpoint
  (`upgrade_support`/`downgrade_support` actions) and the same admin Users
  page UI (`/admin/users`).
- **Senior support**: a second boolean, `users.is_senior_support`, that can
  additionally be set on any support, moderator, or admin account
  (`upgrade_senior_support`/`downgrade_senior_support` actions — the only
  actions in that endpoint explicitly allowed to target an admin account,
  since an admin can also be flagged senior support).
- **Who can see the queue**: an admin-configurable allow-list
  (`support_staff_roles`, JSON array of `"support"`/`"moderator"`/
  `"admin"`) — checked fresh from the database on every request
  (`lib/support/staffAuth.ts#requireSupportStaff`), never trusted from a
  JWT claim, matching the platform's existing `isAdminOrModerator`
  fail-closed convention.
- **Escalation path** (`lib/support/service.ts#canEscalate`, a pure,
  unit-tested function): plain support can escalate to a senior-support
  member or directly to an admin; senior support who is not also a
  moderator/admin can escalate further only to an admin; moderators/admins
  can escalate to any eligible staff member. Escalating assigns the ticket
  (`assigned_to`) and flips its status to `escalated`, and notifies the
  target via the existing `insertNotificationBatch` helper.

### 33.3 AI triage

When `support_ai_triage_enabled` is on (independent of the master
Support Tickets toggle), a newly created ticket's first response is
AI-generated via the platform's existing DeepSeek→Gemini fallback client
(`lib/ai/client.ts`) using the ticket subject + first message as context.
The thread view offers **"This didn't help — talk to a real person"**,
which routes the ticket into the human queue
(`POST /api/support/tickets/:id/ai-reject`). When AI triage is off,
tickets go straight to the human queue with no AI involvement.

### 33.4 Data model

- **`support_tickets`**: `id`, `user_id`, `subject`, `status`
  (`open`/`pending`/`escalated`/`resolved`/`closed`), `priority`,
  `assigned_to`, `is_ai_handled`, `ai_resolved`, `source`
  (`ticket`/`help_center_ai`, linking back to a Help Center doc — see
  §34.5), running `charged_credits`/`charged_stars`/`message_count`
  totals, timestamps.
- **`support_ticket_messages`**: `ticket_id`, `sender_id` (null for AI
  messages), `sender_type` (`user`/`staff`/`ai`), `body`, and per-message
  `charged`/`charged_credits`/`charged_stars` so a user can see exactly
  which of their messages cost them something.
- **`support_ticket_events`**: a lightweight append-only audit log
  (`created`/`status_changed`/`assigned`/`escalated`/`ai_response`/
  `ai_rejected`/`message_added`/`charged`) — escalation/assignment history
  lives here instead of a separate table, per the platform's
  no-table-sprawl convention.
- New migration: `db/migrations/0001_consolidated_schema.sql` (adds
  `users.is_support`/`is_senior_support`, the three tables above, and
  seeds the `x_manifest` defaults in §33.0-33.2).

### 33.5 Surfaces

- **Web/PWA**: `/support` (My Tickets), `/support/new` (create, shows the
  eligibility/cost up front), `/support/:id` (thread + "talk to a real
  person"). Fully responsive, works standalone-installed.
- **Capacitor Android**: mirrored 1:1 against the same API
  (`apps/android/src/routes/support/**`), per the platform's
  android-mirrors-web/PWA rule.
- **Admin**: `/gate44/support/queue` (filterable by status/assignee, reachable
  by support/moderator/admin per §33.2, not admin-only),
  `/gate44/support/tickets/:id` (reply, assign, escalate, change status),
  `/gate44/support/settings` (every toggle/cost/model above, same
  `x_manifest`-key-editing pattern as `/admin/forum/settings`).
  **Capacitor Android:** `admin/support.tsx` mirrors both the ticket
  queue/detail overlay (reply/status/escalate) and the settings tab against
  the same `/api/admin/support/**` endpoints.

---

## 34. Help Center Expansion (v2.10)

The static `/help` FAQ page becomes a real, database-backed Help Center
with SEO-friendly doc URLs, difficulty-tiered content, full-text search,
and an "Ask AI" block that hands off to a Support Ticket (§33) when a
human is needed — built on the same content-editing (markdown → sanitized
HTML, mirroring `blog_posts`) and AI client infrastructure as the rest of
the platform.

### 34.0 Public URLs & SEO

- **Homepage**: `/help` — category grid + search box. Falls back to the
  original static FAQ automatically if the `feature_help_center` flag is
  off or no categories are published yet, so the page is never empty.
- **Category page**: `/help/<category-slug>` — published docs in that
  category, grouped by difficulty tier.
- **Doc page**: `/help/<category-slug>/<doc-slug>` — the canonical,
  crawlable, no-auth-wall URL for a single doc, with per-doc SEO title/
  description metadata and a canonical tag.
- **Search**: `/help/search?q=...` — Postgres full-text search
  (`tsvector`/`ts_headline`, weighted title > body) over doc title/body,
  no new search infrastructure.
- Slugs are generated from the title (`generateUniqueSlug`, `help_doc`/
  `help_category` entity types added to `lib/slug.ts`) but stay stable
  once published — an admin title/slug edit records the old slug in the
  existing `slug_redirects` table (widened to accept `help_doc`/
  `help_category`) so old links 301 instead of 404ing, exactly like
  rooms/games/forum-questions.
- Listed in `app/sitemap.ts` (categories + docs) and allowed in
  `middleware.ts`/`robots.ts`.

### 34.1 Categories, difficulty tiers, and search

Each doc belongs to one category and is tagged with a difficulty tier —
**First Time**, **Beginner**, **Intermediate**, or **Advanced** — shown as
a badge and used to group the category page. The homepage search box posts
to `/help/search`; results link straight to the doc.

### 34.2 Data model

- **`help_categories`**: `slug`, `name`, `description`, `sort_order`,
  `published`.
- **`help_docs`**: `slug` (unique per category), `category_id`, `title`,
  `body_markdown`/`body_html` (same markdown-authored/sanitized-HTML pair
  as `blog_posts`, reusing `lib/security/htmlSanitizer.ts#sanitizeBlogPostHtml`),
  `difficulty`, `seo_title`/`seo_description`, `published`, `view_count`,
  a generated/maintained `search_vector` (trigger-updated on
  title/body change).
- New migration: `db/migrations/0001_consolidated_schema.sql` (both tables, the
  search trigger, the `slug_redirects` check-constraint widening, and the
  `x_manifest` seed defaults in §34.3).

### 34.3 Admin CRUD

`/gate44/help-center` — category list (create/publish-toggle/delete) and doc
list; `/gate44/help-center/docs/new` and `/gate44/help-center/docs/:id` for
the markdown editor, mirroring the Blogs/Answers admin CRUD shape.
**Capacitor Android:** `admin/help-center.tsx` mirrors the same
category/doc CRUD against the same `/api/admin/help-center/**` endpoints.

### 34.4 "Ask AI"

Every doc page ends with an "Ask AI" block: *"Can't find what you're
looking for? Try asking the AI."* Uses the same DeepSeek→Gemini client as
Support AI triage (§33.3), with the current doc's content as context.
Gated by its own toggle (`feature_help_center_ai`), independent of the
Support Ticket master toggle.

### 34.5 From an AI answer to a human, by viewer state

After the AI answers, the block branches:

- **Logged in, ticket-eligible** (§33.0): "Contact a real person" creates a
  Support Ticket prefilled with the AI Q&A transcript
  (`source = 'help_center_ai'`), with a "usually 24-48 hours or less"
  expectation set.
- **Logged in, not otherwise eligible**: the same button is gated by the
  §33.0 cost — unless `help_center_ai_free_for_all` is on, in which case
  the Help Center's "Contact a real person" is always free (bypassing
  §33.0/§33.1 entirely for tickets created with
  `source = 'help_center_ai'`) and all cost messaging is hidden.
- **Logged out**: no AI call is made at all — gated both client-side (the
  block renders a "log in or sign up" prompt instead of the question box)
  and server-side (`POST /api/help/ask-ai` requires a valid access token),
  so an anonymous visitor cannot generate AI spend.

### 34.6 Surfaces

Mirrored in the Capacitor Android app for browsing (categories, docs,
search, Ask AI) at `apps/android/src/routes/help/**`; the admin CRUD stays
web-only, matching how Blogs/Answers admin tooling is web-only today.

---

## Appendix A: The Anti-Dead-App Checklist

Every feature decision on Zobia is tested against this checklist. If any answer is "no," the feature needs revision.

- [ ] Does this feature give users something to do after they have "finished" everything today?
- [ ] Does this feature feel different six months from now than it does on day one?
- [ ] Does this feature benefit from having more users, and does having more users make it better?
- [ ] Does this feature tie a user to something social — a Guild, a creator, a rival — that they would lose if they left?
- [ ] Does this feature create a moment that feels worth telling someone else about?
- [ ] Does this feature respect the user's time and connection quality?
- [ ] Does this feature make the platform feel alive when no one specific is watching?
- [ ] Does this feature pay for itself — directly or indirectly — at the scale it operates?
- [ ] Does this feature work at 2G/3G speeds on a mid-range Android device?

---

## Appendix B: UI & Design Constraints

- Mobile-first. The React Native app is the primary product. All screens are designed for 360–414px width first.
- The Android APK uses React Native's native navigation and gesture libraries (Expo Router, React Navigation, React Native Reanimated, React Native Gesture Handler). Transitions, scroll behavior, and animations feel fully native. No WebView wrappers anywhere in the user-facing app.
- Fixed bottom tab navigator in the Expo app (native tab bar with icons + labels linking to key sections — similar pattern to X/Twitter, Facebook, LinkedIn on Android). Minimum 5 key sections.
- Light mode and Dark mode via the chosen React Native theming library (NativeWind or React Native Paper). Admin can configure additional themes toggled from the admin panel. Themes are applied to both the Expo app and the Next.js web version.
- No gradients in UI colours.
- No purple hues in UI colours.
- Offline-friendly: all screens that require internet have graceful fallback states (skeleton loaders, cached content, clear "no connection" indicators). The app never crashes or white-screens on load without internet. Local data (recent messages, profile, last quest deck) loaded from on-device storage (MMKV or Expo SQLite).
- All interactive elements meet minimum touch target sizes (44×44dp).
- Accessibility: screen reader labels (`accessibilityLabel`) on all interactive elements, sufficient colour contrast ratios.

---

## Appendix C: Developer Code Standards

- Use JSDoc comments on all exported functions, classes, and types.
- Use generous inline comments — comprehensive but not overtly verbose. Explain the "why," not just the "what."
- All financial calculations use Decimal.js or equivalent. No floating-point arithmetic for money.
- All API routes validate input against defined schemas before processing.
- All environment variable access centralised in a single env validation module — never access `process.env` directly in business logic files.
- Feature flags read from database at runtime — never hardcode feature state.
- AI model version strings centralised in `lib/ai/config.ts` — never inline.
- CRON job architecture: a comment at the top of every CRON handler file must explain the Vercel Hobby Plan limitation and the cron-jobs.org external trigger setup.
- Database access: all queries go through the `lib/db/providers/` abstraction interface — never call a provider-specific SDK (Supabase, pg, etc.) directly in business logic or API routes.
- Storage access: all file operations go through the `lib/storage/` abstraction interface — never call a provider-specific SDK directly in business logic.
- Auth: no `@supabase/supabase-js` or `@supabase/auth-helpers-*` imports in auth-related code. Auth is always platform-managed JWT. An ESLint rule enforces this when `DATABASE_PROVIDER !== 'supabase'`.
- Deep links: all navigable deep link paths are registered in a single route map file — never hardcode deep link strings in components.

---

## 33. Old-School Forum — Boards & Threads (v2.16)

A classic bulletin-board/SMF/vBulletin-style forum: boards → sub-boards →
threads → posts, distinct from **Answers** (§31, the Reddit-style Q&A mini
forum). Home page is `/forum`; individual threads get short, SEO-friendly
canonical URLs at `/f/<thread-title-slug>`. Reuses the platform's existing
economy, progression, moderation, storage, and admin infrastructure rather
than introducing a parallel system — mirrors Answers' own architecture
(`lib/bbforum/*` mirrors `lib/forum/*`) wherever the two features share a
concept.

### 33.1 Structure & navigation

- **Boards** (`bb_boards`) can nest one level deep (a board with sub-boards).
  Each board tracks a denormalized `thread_count`/`post_count`/`last_post_at`
  for fast list rendering — no COUNT(*) queries on the hot path.
- **Threads** (`bb_threads`) belong to one board, and **posts** (`bb_posts`)
  belong to one thread; the thread's first post is flagged `is_op = true`.
- Public routes: `/forum` (board list), `/forum/<board-slug>` (thread list),
  `/f/<thread-slug>` (canonical thread page — SSR, crawlable, `DiscussionForumPosting`
  JSON-LD, listed in `app/sitemap.ts`). Admin: `/gate44/forum` (boards),
  `/gate44/forum/queue` (moderation), `/gate44/forum/settings`.

### 33.2 Who can post

- Site admin sets one minimum account level (main rank number) required to
  **both** start a thread and post a reply — `x_manifest.bbforum_min_level_to_post`
  (default **Level 2**), editable at `/gate44/forum/settings` and
  `/gate44/config`. Unlike Answers, there is no separate lower "comment"
  level or pay-to-bypass tier — posting and replying share one gate.

### 33.3 Post editor — plain text or Markdown

- The composer has two tabs, **Plain Text** and **Markdown** — the choice is
  stored per-post as `content_format` so replies within one thread can mix
  formats freely.
  - **Plain text** is rendered as-is: line breaks are preserved, paragraph
    (blank-line) spacing is preserved, but runs of 2+ consecutive blank
    lines collapse to a single paragraph break.
  - **Markdown** is parsed and sanitized the same way as blog posts.
- Both formats are rendered server-side via
  `lib/security/htmlSanitizer.sanitizeForumPostContent(body, format)` (a thin
  dispatcher over the existing `plainTextToBlogPostHtml`/`sanitizeBlogPostHtml`
  functions — no new sanitizer surface). The raw source is what's stored in
  `bb_posts.body`/the thread's OP post, so editing re-opens the original
  source rather than a lossy rendered copy.

### 33.4 Images

- A thread or post may carry one optional image, uploaded via
  `POST /api/forum/uploads/image` (reuses `lib/storage` + `lib/storage/compress`'s
  `message` compression profile — no new storage/CDN plumbing).
- Attaching an image costs an admin-configured amount of **Credits and/or
  Stars** (`bbforum_image_cost_credits` / `bbforum_image_cost_stars`, both
  default 0/free), charged atomically with the thread/post write so a
  charge can never succeed without the content being saved (or vice versa).

### 33.5 Quote system

- Any post can be quoted into a reply (`bb_posts.quoted_post_id`) — the
  reply composer shows a "Quoting <author>" preview banner with a snippet of
  the original, and the rendered reply shows the same preview above the new
  content, mirroring the familiar vBulletin/SMF quote block.

### 33.6 Reactions

- One emoji reaction per user per post (👍 ❤️ 😂 🎉 🤔), toggled on/off —
  posting the same emoji again removes it, posting a different one switches
  it. Tracked in `bb_post_reactions` with a denormalized `reaction_count` on
  the post for fast rendering.

### 33.7 XP & Credit rewards

- Starting a thread or posting a reply awards admin-configured XP and
  Credits (`bbforum_reward_xp_per_thread` / `bbforum_reward_credits_per_thread`
  / `bbforum_reward_xp_per_reply` / `bbforum_reward_credits_per_reply`) —
  **default 1 XP / 0 Credits** for both actions. Rewards are awarded
  best-effort *after* the write transaction commits (`safeAwardXPFireAndForget`
  + a daily-capped `creditCoins` call, `bbforum_daily_reward_cap_credits`,
  default 50/24h) — identical anti-farming discipline to Answers (§31).

### 33.8 Reply pot / treasury

- A thread's original poster can optionally fund a **reply pot**: a fixed
  Credits amount paid to each of the first *N* people who reply (configured
  at thread-creation time as "pay X Credits to the first N repliers"). The
  full pot (`X × N`) is debited from the OP's Credit balance atomically with
  thread creation — funding a pot you can't afford is rejected up front.
- Each qualifying reply claims one pot slot (idempotent per user per
  thread — replying twice never double-pays), credited immediately after
  the reply is saved. The OP cannot claim their own pot.
- **Sharing does not count toward pot eligibility** — only replying does.
  A "share to earn" mechanic was considered and deliberately dropped: there
  is no reliable way to verify an external share happened, and a
  self-reported claim would be trivially gameable.
- **Unclaimed balance refund**: if a pot still has unclaimed slots after
  `bbforum_pot_expiry_days` (default 14) of thread inactivity, the remaining
  balance is refunded to the OP automatically. This runs as a new step in
  the existing `/api/cron/daily-economy` aggregator (no new Vercel Cron
  entry — Hobby plan is limited to one cron trigger per day per job, so new
  scheduled work is always folded into an existing daily aggregator rather
  than requesting a new cron slot).

### 33.9 Moderation

- `lib/bbforum/moderation.ts` mirrors `lib/forum/moderation.ts`: duplicate-
  post detection (same author, same normalized text, within 60s) and a
  profanity filter, both reusing `lib/moderation/contentFilter` — extended
  with `bb_thread`/`bb_post` as detection targets rather than duplicating
  the filter logic. Toggleable via `bbforum_auto_moderation_enabled`
  (default on).
- Reports go through the shared `moderation_reports` pipeline (new
  `reported_bb_thread_id`/`reported_bb_post_id` columns, following the exact
  convention `reported_forum_question_id`/`reported_forum_answer_id`
  already established for Answers) and appear in the
  `/gate44/forum/queue` moderator queue (dismiss/warn/remove content/
  suspend/ban — `ban_user` is admin-only, same as every other moderation
  queue on the platform).
- Authors and moderators can edit or delete any post; deleting a thread's OP
  post soft-deletes the whole thread (mirrors `deleteQuestion` in Answers).
- Moderators can lock (no new replies) or pin a thread.

### 33.10 Capacitor Android

- Mirrored at `/forum`, `/forum/<boardSlug>`, `/forum/thread/<slug>` in the
  Capacitor app (`apps/android/src/routes/forum/*`), calling the exact same
  `/api/forum/*` REST endpoints as web/PWA — plain text/Markdown tabs,
  image attachment, quoting, reactions, edit/delete/report, and the pot
  banner are all present. The Android view renders post bodies as raw
  `whitespace-pre-wrap` text (no in-app Markdown renderer) rather than the
  sanitized-HTML render used on web/PWA — the same simplification already
  used by the Answers detail route in this app.

**New migration to run:** `db/migrations/0001_consolidated_schema.sql` (adds
content-format/image/edit/pot columns to `bb_boards`/`bb_threads`/`bb_posts`,
`bb_post_reactions`, `bb_pot_claims`, and the `moderation_reports`
report-linkage columns; resets `bbforum_min_level_to_post` to the Level 2
default and seeds the new reward/image-cost/pot-expiry `x_manifest` keys).

---

## 36. Polls & Quizzes (v2.20)

Users (and admins) can create custom **Polls** other people vote on, and
custom **Quizzes** other people take and get scored on. Built to reuse the
platform's existing economy, progression, moderation and admin
infrastructure — no parallel system — mirroring how Answers (§31) and Blogs
(§32) were built.

### 36.0 SEO — public URLs, slugs, sitemap

- **Public, crawlable pages**: `/poll/<slug>` and `/quiz/<slug>` (web/PWA —
  `app/poll/[slug]/page.tsx`, `app/quiz/[slug]/page.tsx`), following the
  same `/b/<slug>` and `/a/<slug>` convention (§"Public URL Structure —
  SEO-Friendly Slugs"): SSR, title/description/OpenGraph/Twitter metadata, a
  self-referential canonical tag, and structured data. Only
  `status = 'active'`, non-deleted polls/quizzes resolve — disabled content
  never leaks to crawlers. Unlike Answers' preview+CTA split, these pages
  are the real interactive experience (like Blogs' article page) — voting
  and quiz-taking both work directly on the public page for a signed-in
  viewer, with a "Sign in to vote/take this quiz" CTA for anonymous
  visitors, since polls/quizzes are short-form, sharable content where a
  redirect-to-app hop would hurt conversion.
- **Slugs**: `polls.slug` / `quizzes.slug` are generated from the title at
  creation time using the same `generateUniqueSlug()` utility and
  numeric-suffix dedupe convention as rooms/games/blogs/answers
  (`lib/slug.ts`, `poll`/`quiz` entities).
- **Sitemap**: active, non-deleted polls/quizzes are listed at
  `/poll/<slug>` / `/quiz/<slug>` in `app/sitemap.ts` (capped at 2000 each,
  same convention as blogs/answers). `/poll/`, `/quiz/`, `/api/polls/`,
  `/api/quizzes/` are public in `middleware.ts` (`PUBLIC_PREFIXES`).

### 36.1 Polls

- **Creation**: any user at or above `polls_min_level_to_create` (default
  Level 1) can create a poll with a title, optional description, 2-10
  options, an "allow multiple choices" toggle, and an optional close date.
  `POST /api/polls`.
- **Voting**: one vote per user per poll (or, for multi-choice polls, one
  vote per user per selected option — still exactly one *ballot* per poll).
  Once a poll's creator sets `status = 'closed'`, or its `closesAt` date
  passes, voting stops and only results are shown. `POST
  /api/polls/<slug>/vote`.
- **Discovery**: `/polls` (web/PWA) and `/polls` (Capacitor Android) — New,
  Popular ("Mine" for the signed-in user's own polls) tabs, cursor
  pagination, "Create Poll" CTA.

### 36.2 Quizzes

- **Creation**: any user at or above `quizzes_min_level_to_create` (default
  Level 1) can create a quiz: title, optional description, a passing score
  percentage (default 60%), a max-attempts-per-user (default 1, admin
  configurable default via `quizzes_default_max_attempts`), and 1-25
  questions, each single-choice, multiple-choice, or true/false with 2-8
  options and at least one marked correct. `POST /api/quizzes`.
- **Taking a quiz**: correct answers are never sent to the client before
  grading — a taker only ever sees option labels, never `isCorrect`, until
  they submit an attempt (`POST /api/quizzes/<slug>/attempt`), which grades
  server-side and returns the score, pass/fail, and a per-question
  correct/incorrect breakdown (revealing the correct option(s) only for
  questions already answered). A quiz's creator (or an admin), viewing their
  own quiz, may fetch `?includeAnswers=1` to review/edit the answer key.
- **Discovery**: `/quizzes` — same New/Popular/Mine tab pattern as Polls.

### 36.3 Rewards — baseline (always-on) + reward pots (creator-funded, optional)

Two independent reward layers, mirroring the Answers (§31) config pattern
exactly:

1. **Baseline XP/Credits** — always on, admin-configurable, awarded
   regardless of any pot: creating a poll/quiz, voting on a poll, and
   taking (completing) a quiz each award a small, admin-configured amount
   of XP and/or Credits (default: **1 XP, 0 Credits** for every action),
   capped by a rolling-24h daily Credits cap per user
   (`polls_daily_reward_cap_credits` / `quizzes_daily_reward_cap_credits`,
   default 50). Configurable at `/gate44/polls/settings` and
   `/gate44/quizzes/settings` (also editable at `/gate44/config`).
2. **Reward pots (treasuries)** — optional, creator-funded: a poll or quiz
   creator (or an admin, on the creator's behalf) transfers Credits into a
   pot associated with their poll/quiz and sets a max number of claimants.
   The first N distinct users who **vote or share** a rewarded poll, or who
   **pass or share** a rewarded quiz ("quiz creator can specify prices in
   Credits for the first X users who pass the quiz"), split the pot evenly
   — the per-claimant amount is `funded_amount / max_claimants`. A creator
   can never claim their own pot. This is the *exact* mechanic Blogs'
   per-post reward pot (§32, migration `0001_consolidated_schema.sql`)
   implements, generalised into two shared tables (`content_treasuries`,
   `content_treasury_claims`, `content_type` discriminator
   `'poll'|'quiz'|'wiki'`) rather than duplicated per content type, plus a
   shared `content_shares` idempotent-share-tracking table. Gated by
   `poll_monetization_enabled` / `quiz_monetization_enabled` master
   kill-switches (independent of the base `feature_polls`/`feature_quizzes`
   flags — a poll/quiz still works with pots off, just without payouts).
   - `POST /api/polls/<slug>/treasury` / `POST /api/quizzes/<slug>/treasury`
     **creates** the pot — refused (`TREASURY_ALREADY_EXISTS`) if an open
     one already exists for that poll/quiz.
   - `PATCH` on the same route **edits** an already-open pot's total amount
     and/or max claimants: increasing the amount debits the difference from
     the creator, decreasing it refunds the difference (never below what's
     already been paid to claimants), and `max_claimants` can't drop below
     the number of people who already claimed. (v2.30 fix — a plain re-POST
     used to *add* the new amount on top of the old `funded_amount` while
     *replacing* `max_claimants` outright, silently desyncing the
     per-claimant reward from what earlier claimants had already been
     paid.)
   - `DELETE` on the same route **turns the pot off**: any unclaimed
     Credits are refunded to the creator immediately and the pot moves to
     `closed` (claim history is kept; nobody can claim from it again). A
     closed pot can be re-funded from scratch via `POST`.
   - `GET /api/polls/<slug>/treasury` / `GET /api/quizzes/<slug>/treasury`
     — current pot state, unchanged.

### 36.4 Site Admin controls

- **CRUD + moderation**: admins/moderators can list, search, and change the
  status of any poll/quiz (`active` / `closed` / `disabled`) or soft-delete
  it, at `/gate44/polls` and `/gate44/quizzes` (mirrors the Blogs admin
  table, `/gate44/blogs`). `GET/PATCH/DELETE /api/admin/polls/**`,
  `/api/admin/quizzes/**`.
- **Reward configuration**: admin sets the baseline XP/Credits for
  creating/voting/taking (§36.3.1) at `/gate44/polls/settings` /
  `/gate44/quizzes/settings` — this is *in addition to* whatever a
  creator's own reward pot pays out, never a replacement for it.
- **Feature kill-switches**: `feature_polls` and `feature_quizzes` (each
  independently toggleable at `/gate44/feature-flags`, also surfaced in
  their focused settings pages) turn the entire respective feature off —
  all `/api/polls/**` or `/api/quizzes/**` endpoints return `503
  FEATURE_DISABLED` and the `/poll/*`/`/quiz/*` pages and nav entries
  disappear. `poll_monetization_enabled` / `quiz_monetization_enabled`
  independently kill only the reward-pot sub-feature (§36.3.2).
- Reports on individual polls/quizzes plug into the existing generic
  `reports`/`moderation_reports` tables via new `reported_poll_id`/
  `reported_quiz_id` columns (same convention as
  `reported_forum_question_id`/`reported_blog_post_id`), surfaced in the
  standard moderation queue.

### 36.5 Capacitor Android

Mirrored at `/polls`, `/polls/<slug>`, `/quizzes`, `/quizzes/<slug>` in the
Capacitor app (`apps/android/src/routes/polls/*`,
`apps/android/src/routes/quizzes/*`), calling the exact same
`/api/polls/*`/`/api/quizzes/*` REST endpoints as web/PWA, plus admin
screens at `apps/android/src/routes/admin/polls.tsx` and
`.../quizzes.tsx` mirroring the Blogs admin screen's `AdminUI` kit pattern.

**New migration to run:** `db/migrations/0001_consolidated_schema.sql` (adds
`polls`, `poll_options`, `poll_votes`, `quizzes`, `quiz_questions`,
`quiz_question_options`, `quiz_attempts`, `quiz_attempt_answers`, the shared
`content_shares`/`content_treasuries`/`content_treasury_claims` tables, the
`reported_poll_id`/`reported_quiz_id` columns on `reports` and
`moderation_reports`, and seeds the `feature_polls`, `feature_quizzes`,
`poll_monetization_enabled`, `quiz_monetization_enabled`, and all
`polls_*`/`quizzes_*` reward/config `x_manifest` keys with their defaults).

---

## 37. Tweets (v2.21)

A lightweight, Twitter-style social primitive, deliberately built simpler
than Zobia Moments (§5) — no 24h expiry, but also no ephemerality: Tweets
are a permanent, likeable, replyable, retweetable feed entry at `/tweets`.

### 37.0 Content model

A Tweet has: text content (subject to the length policy in §37.3), an
optional single uploaded image (charged, §37.2), an optional free YouTube or
TikTok video embed (§37.1), an `isPinned` flag (a user may pin exactly one
Tweet to their profile — pinning a new one atomically unpins the previous
one), a denormalised `likesCount`, and — since v2.21 — a nullable
`parentTweetId` (a reply is just a Tweet with this set, denormalised
`repliesCount` on the parent) and `retweetsCount`. No quote/retweet chains
beyond one level (you cannot retweet a retweet — you retweet the original).

- **Eligibility**: Level 2+ by default (`tweets_min_level`), master toggle
  `feature_tweets`, both admin-configurable at `/gate44/config`. The
  composer (`/tweets/create`) checks eligibility via `GET /api/tweets/
  policy` before rendering: a user below `tweets_min_level` never sees the
  compose form (image upload, video embed, submit button) at all — instead
  a level-gate notice with the required level and their current level, and
  a link back to `/tweets` (v2.30 fix — it previously rendered the full
  form with the Post button merely `disabled` and a small reminder text
  underneath, letting an ineligible user fill out a whole Tweet before
  discovering they couldn't post it).
- **Mentions**: `@username` tokens are parsed out of Tweet content (and
  quote-retweet text) on create, using the same matching rule as Room chat
  `@mentions` (`lib/notifications/chatPush.ts`'s `parseMentions`), resolved
  to `tweet_mentions` rows for the Mentions feed tab and routed through the
  existing notifications pipeline (`lib/notifications/insert.ts`).
- **Likes**: Twitter-style single like/unlike toggle (`tweet_likes`), unlike
  Moments' multi-emoji reactions.
- **Deep links**: every Tweet has a stable, authenticated URL, `/tweets/<id>`,
  which is also where its reply thread lives — this is the "posted Nh ago"
  link on every Tweet card, and the target the Capacitor app's
  `zobia://tweet/<id>` / `zobia://tweets/<id>` deep link and its https App
  Link equivalent resolve to. A public, crawlable, SSR short URL also exists
  at `/t/<id>` (the `/t/` counterpart to `/a/` for Answers and `/b/` for
  Blogs) — a lightweight logged-out preview with a CTA to join, used by the
  in-app "Share" action and picked up by `zobia://t/<id>` / its https App
  Link equivalent on Android. The `/tweets/*` app routes and `/api/tweets/**`
  API routes are unchanged; only this additional public preview surface is
  new.

### 37.1 Video embeds (always free)

- **YouTube**: the video ID is extracted client-submitted-URL-side from any
  standard URL shape (`watch?v=`, `youtu.be/`, `/shorts/`, `/embed/`) and
  rendered via the privacy-enhanced `youtube-nocookie.com/embed/<id>`
  iframe — on both web and the Capacitor Android WebView, where a
  cross-origin iframe embed is unremarkable and renders reliably.
- **TikTok**: the video ID is extracted from a full-form URL
  (`tiktok.com/@user/video/<id>`) directly; a shortened share link
  (`vm.tiktok.com/…`, `vt.tiktok.com/…`) is resolved **server-side** at
  submit time with a single `GET` + `redirect: "follow"` request, reading
  the ID off the final resolved URL — this doubles as validating the link
  is a real, reachable video (a dead/invalid short link simply fails to
  resolve and the Tweet is rejected with `INVALID_TIKTOK_URL`). We chose
  this over TikTok's public oEmbed endpoint because oEmbed 404s on some
  private/region-locked videos that still resolve fine via a plain redirect
  follow, and because only the ID is needed (not embed HTML) — see
  `lib/tweets/service.ts`'s `resolveTikTokId` for the full rationale.
  **Rendering differs by platform**: on web, TikTok's official
  `embed.js`-hydrated `<blockquote class="tiktok-embed">` is used (no API
  key required). On the **Capacitor Android app**, that same script-based
  embed was deliberately *not* ported — a same-page iframe injected by a
  third-party script, inside an already-embedded WebView, with no user
  gesture context and stricter default third-party-cookie handling, was
  unreliable in testing. The Android app instead shows a lightweight "Watch
  on TikTok" card that opens the video in the system browser via
  `@capacitor/browser`'s in-app tab — reliable everywhere, at the cost of
  not auto-playing inline.
- **Composer UX**: tapping "Add video" offers a YouTube/TikTok choice, then
  a URL field with a "?" help icon opening a short tooltip explaining
  exactly how to copy the link on each platform (YouTube: Share → Copy
  Link; TikTok: Share → Copy Link, and to open a shortened link once first
  if it doesn't expand).

### 37.2 Image uploads (Credits-only)

Unlike Moments' dual-currency (Credits and/or Stars) pricing, a Tweet image
upload is **Credits-only** — simpler, since Tweets have no equivalent to
Moments' "pay with whichever currency is priced" flexibility need.
`tweets_image_cost_credits` (default 5, admin-configurable, `0` = free) is
charged atomically with the Tweet's creation in one DB transaction (same
charge-then-insert-in-one-`db.transaction()` shape as `createMoment()`) —
if creation fails for any reason, the charge never happens. The upload
itself (`POST /api/tweets/uploads/image`) only stores the file and returns
its URL, mirroring `POST /api/moments/uploads/image`; the charge happens at
Tweet-creation time, not upload time.

### 37.3 Tweet length: default, long-form exemption, and pay-per-long-Tweet

Replacing a flat character cap, Tweet length is governed by an
admin-configurable policy (all keys at `/gate44/config`, group "Tweets"),
computed per-request in `lib/tweets/service.ts`'s `getTweetsEligibility()`:

- **`tweets_default_max_length`** (default **280** characters) — the
  standard limit every eligible user gets for free.
- **Long-form exemption** — a user posts free Tweets above the default
  length, up to their personal max length (below), if they meet **either**:
  - **`tweets_long_min_level`** (default 10) — an XP-rank level gate, same
    convention as `tweets_min_level`/Moments' `minLevel`; or
  - **`tweets_long_min_role`** (default
    `["role_admin","role_moderator","pro","max"]`) — a role/plan allow-list
    check reusing **`lib/plans/eligibility.ts`'s existing `isPlanEligible()`
    helper** (the same "plan slugs / `prestige_N` / `business_N` /
    `role_admin` / `role_moderator`" allow-list vocabulary already powering
    Support Ticket free-access eligibility, §33) — the pre-existing
    "role-vs-tier" gating pattern in this codebase, reused rather than
    reinvented.

  These two combine by **OR** — meeting either qualifies.
- **`tweets_long_max_length`** (default **1000 words**) — the ceiling a
  user's *personal* length preference can be raised to. Deliberately
  expressed in **words**, not characters, per product decision (it's the
  more intuitive unit for an admin setting a "how long is too long" policy)
  — converted internally to an approximate character ceiling
  (`words × ~6 chars/word`, a rough average-English-word-plus-space factor)
  since actual content validation is inherently character-based. This is
  capped by `TWEETS_HARD_CHAR_CAP` (7000 characters, a code constant, *not*
  admin-configurable — a DB-level safety net mirrored as a `CHECK`
  constraint) regardless of how high the word ceiling is set.
- **Personal length preference** — every user (exempt or not) can set their
  own effective max length via **Settings → Tweets** (`PATCH
  /api/users/me/settings` with `{ tweetMaxLength }`, stored on
  `users.tweet_max_length`), clamped server-side to
  `[tweets_default_max_length, longMaxLengthChars]`.
- **`tweets_long_tweet_cost_credits`** (default **10**) — charged, exactly
  like the image charge (same one-`db.transaction()` shape, a second
  `debitCoins()` call alongside the image's when a Tweet has both a long
  body *and* an image), when a **specific Tweet's** content exceeds the
  default length and its author is **not** long-form exempt. Exempt authors
  never pay this — their long Tweets (up to their personal max length) are
  always free.
- **Composer UX**: the character counter reflects the caller's personal
  effective max length (`GET /api/tweets/policy`); past the default length
  while not exempt, an inline notice ("posting this will cost N Credits")
  appears, and a 402 `INSUFFICIENT_TWEET_LENGTH_FUNDS` response (same
  balance/cost-notice modal pattern as Moments' `INSUFFICIENT_MOMENT_FUNDS`)
  is shown if the caller can't afford it.

### 37.4 Replies

A reply is a Tweet with `parentTweetId` set — no separate table. The parent
Tweet's `repliesCount` is bumped atomically alongside the reply's insert.
Same content rules (length policy, optional image/video) apply to replies
as to top-level Tweets. The `/tweets/<id>` deep-link page shows the parent
Tweet, an inline reply composer, and the reply thread — chronological
(oldest first), cursor-paginated (`GET /api/tweets?parentTweetId=<id>`,
same `?cursor=`/`?limit=` convention as every other Tweets feed query).
Replying to someone still fires `@mention` notifications exactly like a
top-level Tweet, and a reply that mentions a user appears in *their*
Mentions tab identically to a top-level mention (mentions are keyed off
`tweet_mentions`, which doesn't distinguish reply vs. top-level).

### 37.5 Retweets (plain and quote)

`tweet_retweets` (`tweetId`, `userId`, nullable `quoteContent`) — one row
per `(tweet, retweeter)`, so re-retweeting is a toggle like a like. A
**quote retweet** is the same row with `quoteContent` set; changing your
quote is un-retweet-then-retweet-again in the UI, upsert-in-place
server-side. Authors may retweet their own Tweets (no self-retweet
restriction). The quote-retweet button is always enabled; an empty comment
is stored as a plain retweet. Same gate (feature flag + level) as posting a
Tweet, but **no separate charge** (a deliberate simplification vs. Tweet
creation's image/length charges — retweeting redistributes existing
content, it doesn't create new billable content).

- **Attribution**: a retweet appears as its own feed entry, "`@username`
  retweeted", carrying the *original* Tweet's content (image, video, likes/
  replies/retweets counts) — implemented as a `UNION ALL` between "tweets
  authored by X" and "tweets retweeted by X" in every feed query that needs
  it (Friends, Following, and a user's own profile), ordered by whichever
  activity (post or retweet) happened when. The For You and Mentions tabs
  deliberately stay tweet-only — a retweet doesn't independently rank or
  get mentioned.
- **Quote content mentions**: `@username` tokens inside quote-retweet text
  fire the same mention-notification pipeline as Tweet content, but don't
  get their own `tweet_mentions` row (there's no separate "quote tweet"
  entity to attach one to — the mention lives on the retweet).

### 37.6 Feeds — four tabs, one endpoint

`GET /api/tweets?tab=<foryou|friends|following|mentions>` (default
`foryou`), or `?authorId=<id>` for a profile's own Tweets+retweets (pinned
first), or `?parentTweetId=<id>` for a reply thread — all cursor-paginated
the same way as `/api/moments` (`?cursor=&limit=`, capped at 50/page).

- **For You**: a query-time "hot" ranking — `score = likesCount /
  (ageInHours + 2)^1.5` (the standard Reddit/HN-style decay formula),
  ×1.5 boosted when the author is a friend or someone the viewer follows —
  computed per-request with no cron/background job (there's no ranking
  infrastructure to reuse, and a daily-only cron cadence would make a "hot"
  feed stale for most of the day, so it's deliberately kept a plain SQL
  expression evaluated at query time). Indexed on `tweets(created_at)` and
  `tweets(user_id, created_at)` for the friend/follow `EXISTS` join. Cursor
  is a base64-encoded `{score, id}` pair, since the ranking key isn't a
  plain column.
- **Friends**: mutual (accepted) `friendships`, chronological, including
  retweets by any friend (§37.5).
- **Following**: one-directional `follows`, chronological, same retweet
  inclusion.
- **Mentions**: tweets/replies where the viewer is `@mentioned`
  (`tweet_mentions`), chronological.

### 37.7 Site Admin controls

All at `/gate44/config`, group "Tweets": `feature_tweets` (master
kill-switch), `tweets_min_level`, `tweets_image_cost_credits`,
`tweets_default_max_length`, `tweets_long_min_level`,
`tweets_long_min_role`, `tweets_long_max_length`,
`tweets_long_tweet_cost_credits` (§37.3). Reports on individual Tweets plug
into the existing generic `reports`/`moderation_reports` tables via a new
`reported_tweet_id` column, same convention as `reported_poll_id` (§36.4).

### 37.8 Capacitor Android

Mirrored feature-for-feature at `apps/android/src/routes/tweets/{index,
create,$tweetId}.tsx`, following the exact porting convention used for
Moments (`apps/android/src/routes/moments/*`) — same feed-with-tabs +
infinite-scroll pattern as `routes/home.tsx`, same composer flow, same
`@capacitor/browser` open-externally fallback pattern already used
elsewhere for links the WebView shouldn't render inline (§37.1's TikTok
caveat is the only rendering divergence from web). A "Tweets" entry was
added to the drawer nav (`components/layout/TopBar.tsx`) and the deep-link
handler (`routes/__root.tsx`) gained a `tweet`/`tweets` prefix case
alongside the existing poll/quiz/game/room ones.

**New migration to run:** `db/migrations/0001_consolidated_schema.sql` (adds `tweets`,
`tweet_likes`, `tweet_mentions`, `tweet_retweets`; `users.tweet_max_length`;
the `reported_tweet_id` column on `reports` and `moderation_reports`; and
seeds `feature_tweets` and all `tweets_*` config `x_manifest` keys with
their defaults).

---

## 38. Wikis (v2.22)

Standard collaborative-wiki behaviour — any eligible user creates a wiki,
other users contribute pages, every edit is kept as a revision anyone can
review or restore. Discovery at `/wiki` (web/PWA and the Capacitor app)
mirrors the Blogs/Polls/Quizzes discovery pages (§32, §36): Popular /
Trending / New / Random tabs, search, cursor pagination. Public SEO pages
sit at `/w/<slug>` (wiki home) and `/w/<slug>/<pageSlug>` (a page),
following the exact `/b/<slug>` convention Blogs uses, including
`slug_redirects` (`entity_type = 'wiki'`) for renamed wikis and readable
sitemap inclusion. The authenticated in-app wiki view at `/wiki/<slug>`
(and `/wiki/<slug>/<pageSlug>`) is a separate, auth-gated route — its
"Share" action shares the public `/w/<slug>` link, not the `/wiki/<slug>`
one (v2.30 fix — it previously shared the auth-gated URL, which forced a
signed-out recipient to log in before they could see anything).

### 38.1 Who can create a wiki

Creating a wiki is gated site-wide by the admin along three independent
axes, all editable at `/gate44/wiki` (backed by `x_manifest`):

- **Plan** — `wiki_create_required_plan` (default `free`).
- **Creator level** — `wiki_create_min_level` (`users.level_creator`,
  default 0).
- **Staff-only mode** — `wiki_create_restricted_to_staff` (default off);
  when on, only moderators/admins may create a wiki regardless of
  plan/level.

Moderators and admins always bypass all three checks. A user who fails the
gate gets the specific reason back from the API (not a generic "no") so
the client can explain exactly what's missing, same UX precedent as Guild
creation's level/Trust Score gate (§13).

Beyond the creation gate, a per-plan quota caps how many wikis a user may
*own* at once (`wiki_max_owned_free/_plus/_pro/_max`, default 1/3/10/25)
and how many pages a single wiki may hold, scaled by its owner's plan
(`wiki_max_pages_free/_plus/_pro/_max`, default 20/75/250/1000) — both
admin-configurable, mirroring Blogs' multi-blog quota shape (§32.1.1)
without the paid-extra-slot purchase mechanic (not part of this feature's
v1 — a wiki beyond the quota simply can't be created yet; extra-slot
purchase can be layered on later using the same pattern if needed).

### 38.2 Contributing to a wiki

The wiki's owner sets a `contribute_policy` (changeable any time in
settings):

- **`everyone`** (default) — any signed-in user may create/edit pages.
- **`friends`** — only users with an accepted friendship (`friendships`,
  §social graph) with the owner.
- **`selected`** — only users the owner (or a wiki moderator) explicitly
  added as a collaborator, either directly or by accepting an invite
  (§38.4).

The owner and any wiki moderator (§38.3) may always contribute and manage
the wiki regardless of `contribute_policy`. The first time a user actually
creates or edits a page, they're recorded as an active `wiki_collaborators`
row (role `contributor`) even under the `everyone`/`friends` policies —
this is what makes them count toward `contributor_count` and appear in the
collaborator list, without requiring the owner to pre-approve them.

### 38.3 Moderators

The wiki owner (or an admin) assigns per-wiki moderators from among its
collaborators — a boolean `is_moderator` flag plus grant-audit columns
(`moderator_granted_by`/`moderator_granted_at`) on `wiki_collaborators`,
the exact same shape as Guilds' Forum Mods (§19, §13's `guild_members.
is_moderator`) rather than a separate roles table. A wiki moderator may
edit/delete any page on that wiki, manage collaborators/invites, and is
otherwise scoped to that one wiki — sitewide Platform Mods/Admins can
always moderate any wiki too, re-verified against the database on every
call, never trusted from a session claim.

### 38.4 Invites

The owner (or a wiki moderator) generates an invite — a random token,
optionally targeted at a specific username (or left open, for anyone with
the link), with a configurable expiry (`wiki_invite_expiry_hours`, default
168h/7 days) and single-use tracking, the same token/expiry/used-by shape
as Guild invites (§13's `guild_invites`). Accepting an invite
(`/wiki/invite/<token>` on web/PWA and the Capacitor app) adds the
accepting user as an active `selected`-policy collaborator regardless of
the wiki's current `contribute_policy`, and the invited user receives a
notification through the existing notifications pipeline
(`wiki_invite_received`) that deep-links straight to the accept screen.

### 38.5 Rewards — XP, Credits, and the reward pot

Creating a wiki or contributing a page each earn a small, always-on,
admin-configurable reward — **default 1 XP / 0 Credits** for either
action, exactly as specified for this feature, edited at `/gate44/wiki`
(`wiki_create_reward_xp`/`_credits`, `wiki_contribute_reward_xp`/
`_credits`). Credits rewards are capped per rolling 24h
(`wiki_daily_reward_cap_credits`, default 50) to prevent farming, same
mechanic as Polls/Quizzes (§36).

Separately, a wiki owner may fund a **reward pot (treasury)** for their
wiki (`/wiki/<slug>/manage/treasury`) — a Credits pot split evenly among
the first N distinct people who either contribute a page or share the
wiki. This reuses the generic `content_
treasuries`/`content_treasury_claims`/`content_shares` tables already
built for Polls/Quizzes (§36) rather than a bespoke `wiki_treasuries`
table — `content_type = 'wiki'`, claim types `contribute`/`share` — and
the same create (`POST`) / edit (`PATCH`) / turn-off (`DELETE`) treasury
API shape documented in §36.3 (v2.30). Gated by the `wikiMonetization`
sub-flag under the master `wiki` feature flag, same two-flag shape
(`feature_x` + `xMonetization`) as every other monetized content type in
this PRD.

### 38.6 Pages & revision history

A page's raw author input (Markdown or plain text — `content_format`,
same split as Blog posts, §32) is rendered to sanitized HTML server-side
via the existing `lib/security/htmlSanitizer.ts` (`sanitizeBlogPostHtml`/
`plainTextToBlogPostHtml`, reused as-is — Markdown is converted to HTML
*before* sanitizing, never after, closing the same injection gap Blogs'
BUG-M06 fix documented) and stored as `content_html` alongside the raw
source. Every save — creating a page or editing one — appends an
immutable row to `wiki_page_revisions` (revision number, full content
snapshot, editor, optional edit summary, timestamp); the live page row
always mirrors the latest revision so a normal page read stays a single
cheap row lookup, while the revisions table exists purely for history,
review, and restore. Any eligible contributor can restore an older
revision, which itself becomes a new revision (never rewrites history) —
this is the one piece of this feature with no existing precedent
elsewhere in the codebase (no other content type here has edit history),
designed as an append-only ledger to match the append-only discipline
already used for `coin_ledger`/`xp_ledger`/`blog_moderation_log`.

### 38.7 Moderation & input safety

Reports on a wiki or an individual page plug into the existing generic
`reports`/`moderation_reports` tables via new `reported_wiki_id`/
`reported_wiki_page_id` columns, the same convention as `reported_poll_id`
(§36.4). Admins moderate at `/gate44/wiki` — suspend/ban/deactivate/pause/
restore/delete a wiki, transfer ownership — every action logged to
`wiki_moderation_log`, mirroring `blog_moderation_log` exactly. All
free-text input (name, description, page title, page content, edit
summaries, usernames used for invites) is length-capped and passed
through the existing HTML sanitizer before storage; nothing user-authored
on a wiki page is ever fed to an LLM in this v1, so the AI-prompt-injection
delimiting discipline documented in §23 doesn't currently apply here — if
a future "Ask AI to summarize this page" feature is added, it must follow
that same pattern (user content clearly delimited from system
instructions, never allowed to redefine the model's role).

### 38.8 Redis & offline discipline

Following this project's low-Redis-call constraint: wiki/page view counts
are plain DB counter increments (no Redis, no per-view ledger row),
deduped client-side via `localStorage` before the client even calls the
view-record endpoint, the same `zobia_blog_viewed`-style pattern Blogs
uses. Discovery, page content, and "my wikis" listings flow through the
same TanStack Query persister (IndexedDB via `idb-keyval` on web/PWA) and
Android's equivalent query-cache config that the rest of the app already
uses for offline support, scoped per-device the same way as every other
cached query in this app so nothing leaks between separate users of a
shared device.

### 38.9 Capacitor Android

Mirrored feature-for-feature under `apps/android/src/routes/wiki/*`,
`components/wiki/*`, and `lib/wiki/*`, hitting the exact same `/api/wiki/*`
backend as web — no separate mobile API. Per this project's mobile-UI-
simplification convention (the same one applied to Blogs/Rooms), the
four-tab discovery bar collapses only if the platform's existing pattern
elsewhere already does so; otherwise it mirrors web directly, and any
horizontal wiki-page nav a wiki owner might configure on web still renders
as a simple vertical list on Android.

**New migration to run:** `db/migrations/0001_consolidated_schema.sql` (adds `wikis`,
`wiki_pages`, `wiki_page_revisions`, `wiki_collaborators`, `wiki_invites`,
`wiki_moderation_log`; extends `content_shares`/`content_treasuries`/
`content_treasury_claims`' check constraints to accept `content_type =
'wiki'` and `claim_type = 'contribute'`; adds `reported_wiki_id`/
`reported_wiki_page_id` columns to `reports`/`moderation_reports`; and
seeds `feature_wiki`, `wiki_monetization_enabled`, and all `wiki_*`
creation-gate/reward/quota config `x_manifest` keys with their defaults).

---

## 39. Home Dashboard (v2.26)

The logged-in Home page (`/home`) is the app's default post-login landing
surface: a personalized feed of platform content plus a "logo tab" hub of
at-a-glance widgets (Zobian of the Month, quests, presence, guild
discovery, leaderboard position). It is powered by a new cross-content-type
feed pipeline (`lib/feed/*`) and reuses — rather than duplicates — the
existing Platform Advertising system (§17 Pillar 3) to let any user boost
their own content into that feed.

### 39.1 UI guidelines

Top-to-bottom layout: a platform ad slot (`home_top`) → an auto-advancing
**Notices** carousel (random start position, ~5s auto-advance, pauses on
user interaction) → a second ad slot (`home_mid`) → the tab bar → tab
content. This ordering is fixed and not admin-configurable.

**Tab bar:** an unlabeled default **logo tab** (the site logo/wordmark;
active on a fresh login) plus four labeled feed tabs — **For You** (FU),
**Trending** (TR), **Friends/Followers** (FF), **New** (NE). Desktop shows
the full tab names; mobile web/PWA and the Android app show the acronyms
only, to keep the bar compact on narrow screens. Selecting a feed tab shows
a small header naming that tab. The logo image is read from
`public/images/logosmall.png` on each platform (web and Android each keep
their own copy — see §39.7); until an image is uploaded, a text/emoji
fallback renders so the tab bar never breaks.

**Logo tab (default) content:** Zobian of the Month spotlight card (§39.5),
site news/announcements, the Daily Quest deck plus the New Member Quest
card (§39.4), a Nemesis/Challenge card, a Presence sub-section (Online
Friends / Recently Active tabs), and the pre-existing Leaderboard position
card, Guild Discovery panel, and Plan Expiry banner.

**The four feed tabs** each show a paginated ("Load more") list of feed
cards, with native ad slots (`home_feed_native`) interleaved roughly every
6 items. Pull-to-refresh is supported on touch devices via a small
dependency-free handler.

### 39.2 The feed ranking pipeline

`GET /api/feed?tab=for_you|trending|friends|new&cursor=&limit=` serves
paginated feed pages. The `for_you` and `trending` tabs are backed by a
precomputed, cached **candidate pool** (see §39.3) rather than a live
per-request query, so the ranking below only has to run occasionally, not
on every page load. `friends` and `new` are lighter, live per-request
queries over a curated subset of content types (moments, tweets, blog
posts, forum questions, rooms, classrooms, wiki pages, games, polls,
quizzes — not bbforum threads or business page posts, to keep the query
bounded); extending that subset to full parity is straightforward future
work.

Feed content types: moments, tweets, blog posts, bbforum threads, Answers
questions (forum_question), rooms, classrooms, wiki pages, games, polls,
quizzes, and business page posts.

For `for_you`, every candidate item is scored into exactly one of seven
priority tiers (an item can only appear in the highest tier it qualifies
for — a lower tier never lets it outrank a higher one, however strong its
in-tier score):

1. **Boosted content** — any content actively boosted through the
   generalized content-boost system (§39.6), authored by a regular (non
   admin/mod) user. Ranked by boost recency.
2. **Organic popular** — all-time engagement (views, likes, replies, etc.,
   per content type's own counters), independent of any boost.
3. **Organic trending** — recent-engagement *velocity* (engagement decayed
   by content age, same "hot" formula used elsewhere on the platform, e.g.
   `/api/tweets` for_you), so fast-rising fresh content surfaces even
   before it accumulates enough all-time engagement to win tier 2.
4. **Business page posts** — non-boosted business page posts, weighted by
   the posting business's account tier (starter/growth/enterprise).
5. **In-house boosted content** — the same boost mechanism as tier 1, but
   authored by an admin or moderator (kept in a lower, separate tier so
   staff-authored boosts never crowd out ordinary users' boosted content).
6. **Interest-based personalization** — scored against the viewing user's
   weighted interests (§39.4), matched against each candidate's content
   type and any category/tag it carries.
7. **Recency fallback** — when an item has no interest match at all, a
   small decayed recency score (30-day half-life) stands in, so a
   personalized feed is never empty for a user with no tracked interests
   yet; this score is deliberately capped low enough that it can never
   outrank a real interest match.

`trending` is a separate, single-tier tab: every content type's recent
engagement velocity, normalized and ranked with no other tiering applied.

**Known simplification:** tier 2 (organic popular) does not currently
subtract engagement a piece of content earned while it was boosted, since
the platform does not yet attribute ad impressions/clicks back to a piece
of content's own counters — a boosted item's popularity score can
therefore double-count its boosted-era engagement. Documented as future
work, not a defect to silently fix.

### 39.3 Candidate pool caching & the feed-refresh job

Because the ranking pipeline above touches every content table, it is not
run per page load. Instead, a new CRON endpoint,
`POST /api/cron/feed-refresh`, recomputes the `for_you` and `trending`
candidate pools and writes them into a two-tier cache (in-process memory,
then Redis) with a configurable TTL —
`homeFeed.cacheTtlSeconds` (x_manifest, default 900s / 15 minutes,
admin-editable at `/gate44/config`). Per-request reads always hit the
cache; personalization (tier 6/7, and light re-weighting elsewhere) is
applied to the already-cached pool per viewer at read time, which is cheap
enough to run on every request.

**This job is intentionally not registered in `apps/web/vercel.json`** —
Vercel's Hobby plan only allows daily CRON schedules, and this job needs to
run every 10–15 minutes. The site owner must add it as an external cron
job (the same cron-jobs.org mechanism already used for the platform's other
sub-daily jobs — see the CRON Setup section of `docs/SETUP.md`) hitting
`POST /api/cron/feed-refresh` with an `Authorization: Bearer <CRON_SECRET>`
header. Until that external job is configured, the feed still works (a
cold cache falls back to a synchronous recompute on first request) but
will not refresh, so trending/popularity data will grow stale.

The same job also folds implicit interest signals into `user_interests`
(§39.4) and auto-computes Zobian of the Month (§39.5).

### 39.4 Interest-based personalization

Each user accumulates weighted interest rows (`user_interests`, tag +
source + weight) from two sources:

- **Onboarding selection** — an interest-picker step shown during
  onboarding, gated by a new admin toggle,
  `interests.onboardingSelectionEnabled` (x_manifest, default **on**,
  admin-editable at `/gate44/config`). When an admin turns this off, new
  users skip the picker and personalization relies entirely on implicit
  signals until enough accumulate.
- **Implicit engagement signals** — lightweight events (`view`, `open`,
  `like`, `comment`, `share`) logged to `content_engagement_signals` as
  users interact with content. The feed-refresh job (§39.3) aggregates the
  last day's signals into weighted `user_interests` rows (source
  `implicit`; heavier weight for comment/share than a bare view) and prunes
  signal rows older than 30 days, so the raw signal log never grows
  unbounded.

### 39.5 Zobian of the Month

A monthly spotlight (`zobian_of_month` table, one row per calendar month)
shown on the logo tab. By default it is **auto-computed** by the
feed-refresh job as the user with the highest total XP gained that
calendar month — but an admin can set a manual override at any time via
`POST /api/admin/zobian-of-month`, which the auto-compute job will never
overwrite for that month once set. Auto-compute itself can also be turned
off platform-wide via `homeFeed.zobianOfMonthAutoComputeEnabled`
(x_manifest, default on). Read publicly via
`GET /api/feed/zobian-of-month`.

### 39.6 Generalized content boosts

`ad_campaigns` already had a `boosted_content_type`/`boosted_content_id`
shape (originally scoped to `boost_post`/`boost_room` objectives) that had
never been fully wired up. This work generalizes it into a real "boost any
content type" flow, conceptually a **Sponsored Post** ad objective — a user
boosts their own (or, for admins/moderators, anyone's) existing content
rather than uploading new ad creative from scratch:

- A new objective, `boost_content`, whose `boosted_content_type` accepts
  any of: `moment`, `tweet`, `blog_post`, `forum_thread`,
  `forum_question`, `room`, `wiki_page`, `game`, `classroom`,
  `business_page_post`, `poll`, `quiz`.
- `createContentBoostCampaign()` (`lib/ads/repo.ts`) builds the campaign
  from an existing piece of content's own metadata (title/body/image),
  exposed via `POST /api/content/boost`; `GET /api/ads/boostable` lists
  what a given user is allowed to boost.
- **This reuses the exact existing ad campaign pipeline as-is** — the same
  moderation queue/AI review, the same Credits-CPM funding and billing
  ledger, the same `ad_events`/`ad_campaign_daily_stats` tracking described
  in §17 Pillar 3. No parallel billing or moderation system was built for
  boosts.
- A boosted item ranks at the top tier of the Home feed for its content
  type (§39.2, tier 1, or tier 5 for staff-authored boosts).
- A **Boost** button was added to the owner-facing action row of tweets,
  blog posts (dashboard), Answers questions, bbforum threads, wiki pages,
  business page posts, and room/classroom creator panels. **Not yet
  available** for moments, games, polls, or quizzes (none has
  owner-management UI wired to the Boost button on web yet — `getBoostableContentSummary`/`BOOSTABLE_TYPES`
  already accept `poll`/`quiz` server-side, so wiring the button up is
  mechanical) or on the Capacitor Android app at all (web-only for now) —
  both noted as follow-up work, not oversights.

### 39.7 Notices, quests, and platform coverage

**Notices carousel:** `GET /api/notices` merges three sources into one
feed for the carousel — the new admin-manageable `notices` table, the
existing `platform_events` engine, and the existing `announcement_banners`
system — so admins are never asked to re-enter data that already exists
elsewhere.

**New Member Quest dismissal:** primarily client-side (localStorage,
scoped per user id, so a shared device doesn't leak one user's dismissal
state to another). A durable server-side fallback
(`new_member_quest_dismissals` table, `POST /api/quests/new-member/dismiss`)
is written only after 4 local dismissals or an explicit "don't remind me
again," to keep this low-traffic. Dismissing the card from Home does not
remove the New Member Quest section from the Quests page (`/quests`) — it
still appears there below the daily quest list.

**Platform coverage:** the Android (Capacitor) app mirrors the web Home
page's structure and behavior with its own component implementations
(`apps/android/src/routes/home.tsx`, `apps/android/src/components/home/*`);
since it is phone-only it always shows the FU/TR/FF/NE acronyms rather than
switching between full names and acronyms by viewport. Its logo image is a
separate file from web's, at `apps/android/public/images/logosmall.png`.

**New migrations to run:** `db/migrations/0001_consolidated_schema.sql` (adds
`user_interests`, `content_engagement_signals`, `zobian_of_month`,
`new_member_quest_dismissals`, `notices`; widens the `ad_campaigns`
objective/`boosted_content_type` CHECK constraints for the generalized
boost flow; seeds a `content_boost` native ad placement and the
`interests`/`homeFeed` `x_manifest` keys) and
`db/migrations/0001_consolidated_schema.sql` (seeds the `home_top`,
`home_mid`, and `home_feed_native` ad placements used by the Home
Dashboard layout).

---

## 40. Crypto Payments (v2.28)

DodoPayments has been removed entirely and replaced with **crypto payments**
as the platform's international payment option: JAGA (a BEP-20 token on
BNB Smart Chain, contract `0x6a093f2134f66d7625724bc775c3b437ea756588`),
native BNB, and native SOL (Solana). §18's payment provider tables above
are updated accordingly.

### Architecture

A formal `PaymentProviderModule` interface
(`apps/web/lib/payments/types.ts`) is implemented identically by Paystack
and the new crypto provider, dispatched through a registry in
`apps/web/lib/payments/index.ts` — adding a future provider #4 means one
new file plus one registry entry, no call-site changes anywhere else. The
crypto provider itself lives in a self-contained, minimally-cross-imported
subtree at `apps/web/lib/payments/crypto/` (chain adapters, token registry,
price feed, settings — designed to be portable to other projects):

- **Chain adapters** (`crypto/chains/`) — `bsc.ts` (viem) and `solana.ts`
  (`@solana/web3.js`), each validating addresses, reading balances, and
  verifying a submitted transaction hash actually pays the expected amount
  to the platform's receiving address. Extension point for new chains.
- **Token registry** (`crypto/tokens.ts`) — JAGA / BNB / SOL, each with a
  chain, decimals, and price-feed strategy. Extension point for new tokens.
- **Price feed** (`crypto/priceFeed.ts`) — BNB/SOL priced via CoinGecko's
  free API; JAGA (unlisted on CoinGecko) via DexScreener's free API against
  its PancakeSwap pool. Refreshed **lazily on read** against an
  admin-configurable interval (default 6h) rather than depending on any
  CRON schedule — correct regardless of CRON cadence, since the platform
  only has Vercel Hobby's daily CRON available. Falls back to the last
  cached price (and logs a warning) if a live fetch fails, and to an admin
  manual override (with optional auto-expiry) if set.
- **Per-currency checkout discount** (default: JAGA 20% off, BNB/SOL 0%)
  and the USD→NGN display rate are both admin-configurable.

### Payment flow (no processor, no inbound webhook)

The user connects their own wallet, sends the exact computed token amount
themselves, and submits the resulting transaction hash to the backend,
which verifies it on-chain before crediting the account:

1. Checkout computes the exact required token amount server-side (never
   trusting a client-submitted amount) from the live/manual price feed and
   any discount, and returns the platform's receiving address for that
   chain.
2. Client shows a wallet-connect UI (MetaMask/WalletConnect on BSC,
   Phantom/Solflare on Solana), a gas-fee estimate, and a confirmation
   screen (original price struck through, discounted price in bold); the
   user approves and sends from their own wallet.
3. Client submits the transaction hash to `POST
   /api/economy/crypto/confirm`, then polls `GET
   /api/economy/crypto/status` every few seconds — this client-side polling
   is the **primary** confirmation path.
4. A daily CRON reconciliation pass (`app/api/cron/daily-platform`) is a
   safety net only, re-checking any payment that received a tx hash but
   never got a final confirmed poll, and marking it failed after 48h.

### Per-payment-context settings & admin controls

Six checkout contexts (Business tier upgrade, Business renewal,
Subscription, Coin pack, Star pack, Creator merch) each independently
configure which Nigeria method(s) are active, which crypto currencies are
active, and whether the context is free (bypass payment entirely). Admin
page `/gate44/payments` lists all six with a bulk-edit mode (select many,
apply one action to all). A non-Nigerian user in a context with no active
international method sees "Only Nigeria is supported for this at this
time. We are working to add more countries." instead of a broken picker.

A **Danger Zone "make all payments free"** action (with a confirmation
modal) sets every context's free flag site-wide — available from both
`/gate44/config` and `/gate44/payments`, calling the same endpoint so the
behavior can never drift between the two entry points.

### User-facing wallet management

Users can save a wallet address per chain (used to *send* payments — not
the same thing as a creator's payout-receiving wallet) from Settings →
Crypto Wallets: masked display (first 4 + `…` + last 4), Edit/Delete with a
confirm dialog.

### What shipped vs. deferred (updated — client-side flow now built)

Originally shipped in v2.28: the full backend (provider architecture, chain
adapters, price feed with fallback chain, per-context settings + admin UI +
bulk actions + Danger Zone, wallet save/delete API + Settings UI,
confirm/status/verify API routes, DB schema, i18n keys, tests).

**Now also shipped** (this pass): the client-side wallet-connect checkout
(`components/payments/CryptoCheckoutModal.tsx` — `wagmi`+`viem`+WalletConnect
v2 on BSC, `@solana/wallet-adapter-react` on Solana; currency picker →
wallet connect (with a "use saved wallet" shortcut) → amount/discount/gas
review → send → poll to confirmation → optional wallet-save prompt), wired
into coin-pack purchase, the free→paid subscription upgrade, and Business
Account signup (star-pack, business tier upgrade/renewal, and merch
purchase still redirect through Paystack/the same backend crypto API today
— the modal isn't yet dropped into those three pages, though nothing
backend-side blocks it); a real "How to buy crypto" Help Center article
(seeded via `db/migrations/0001_consolidated_schema.sql`, category
`payments`, slug `how-to-buy-crypto`) linked from the checkout modal; the
Wallet page's Crypto tab (on-chain balances for saved wallets + crypto
payment history, `GET /api/economy/crypto/overview`); **server-side
enforcement** of `payment_context_settings` on every purchase route (a
client could previously have called the API directly with a
disallowed provider/currency and bypassed the admin toggles entirely —
`enforcePaymentContext()` now closes that); and the `/gate44/data-management`
export UI wiring (role/rank-level/prestige filters, the new wallet fields,
a "wallet addresses only" TXT/CSV quick preset). Two real bugs were found
and fixed in the process: `payments_provider_check` never actually allowed
`provider = 'crypto'` (every crypto payment insert would have violated it),
and every purchase route's `crypto: {...}` response tried to
`JSON.stringify` a raw `bigint` (`expectedBaseUnits`), which throws — both
fixed (`db/migrations/0001_consolidated_schema.sql`,
`serializeComputedAmount()`).

**Still deferred**: the Capacitor Android deep-link wallet flow (native app
still has no crypto checkout UI — Google Play Billing remains its only IAP
mechanism per §18, so this is lower priority there); dropping
`<CryptoCheckoutModal>` into the three web pages noted above; actual
live-chain signing has not been tested end-to-end against a real wallet in
this sandbox (no network access to a live BSC/Solana RPC or an actual
wallet extension) — the flow compiles and typechecks but its first
real-money run should be watched closely.

**New migrations:** `db/migrations/0001_consolidated_schema.sql` — `payments`
table gains `chain`/`token_symbol`/`tx_hash`/`wallet_address`/
`expected_token_amount` columns; new tables `crypto_exchange_rate_overrides`,
`crypto_price_cache`, `payment_context_settings` (seeded to match prior
Paystack-only behavior), `user_crypto_wallets`.
`db/migrations/0001_consolidated_schema.sql` — widens
`payments_provider_check` to allow `'crypto'`/`'free'` (bugfix, see above).
`db/migrations/0001_consolidated_schema.sql` — seeds the "How to buy
crypto" Help Center article + its category.

**New env vars:** `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (optional — get one
free at cloud.reown.com; without it, MetaMask's injected connector still
works, just no WalletConnect QR/deep-link option),
`BSC_RPC_URL` / `SOLANA_RPC_URL` (optional, server-side, default to public
endpoints), `NEXT_PUBLIC_SOLANA_RPC_URL` (optional, browser-side Solana RPC
for the wallet-adapter UI — separate from `SOLANA_RPC_URL` since only
`NEXT_PUBLIC_`-prefixed vars reach the browser bundle),
`CRYPTO_RECEIVING_ADDRESS_BSC` / `CRYPTO_RECEIVING_ADDRESS_SOLANA`
(**required** to actually accept crypto payments — must be set to wallet
addresses the operator actually controls before going live).

### Crypto-native payouts for creators & referrers

Distinct from the Wallet page's existing Crypto tab above (which shows a
*user's own spending* — on-chain balances they hold and crypto payments
*they made*): this is a separate crypto-native *earnings* ledger for
commissions and revenue paid *to* a creator or referrer, kept apart from
NGN/Credits accounting so a JAGA/BNB/SOL-denominated earning is never
silently exchange-rate-converted and merged into Naira bookkeeping.

- **Referral commissions**: when a referred user's coin purchase was paid
  with crypto, the referrer's Tier 1 (5%) / Tier 2 (2%) commission is
  computed as the same percentage of the *token* amount paid, and credited
  in that same currency — not converted to coins — whenever crypto payouts
  are enabled in "crypto" mode. `lib/referrals/commissions.ts`,
  `lib/payments/crypto/payouts.ts`.
- **Admin controls** (`/gate44/config`, group "Crypto Payouts"):
  `crypto_payouts_enabled` (default **off**), `crypto_payout_mode`
  (`credits` default | `crypto`), and per-currency withdrawal thresholds
  (`crypto_payout_threshold_JAGA/BNB/SOL`, default a computed ~$10
  equivalent from the live price feed). While disabled, or while mode is
  `credits`, every crypto-sourced commission still converts to Coins exactly
  as before this feature existed — nothing changes for operators who don't
  opt in.
- **User-facing**: a Crypto Balances section on the Wallet page (hidden
  entirely unless payouts are enabled in "crypto" mode) shows per-currency
  balances, a Withdraw action gated by the admin threshold, saved
  wallet-address management (`user_crypto_wallets`, reused as the
  withdrawal destination), and recent transactions linking to the chain's
  block explorer (BscScan / Solscan).
- **Payout processing**: manual, admin-approved — mirrors the existing
  Tron/USDT `creator_payouts` flow (`payout_method = 'crypto'`,
  `requires_manual_approval = true`); `createPayout()` in
  `lib/payments/crypto/index.ts` still always throws by design (no
  automated on-chain sends).
- All arithmetic uses `Decimal.js`/`bigint` base units throughout — never a
  float — matching the rest of the crypto payment subsystem.

**New migrations:** `db/migrations/0006_currency_crypto_classroom_billing.sql`
— `crypto_balance_ledger`, `creator_crypto_balances` tables;
`creator_payouts` gains `crypto_currency`/`crypto_chain`/
`crypto_amount_base_units`/`crypto_tx_hash`; `creator_wallet_addresses`
relaxed from one wallet per creator to one per (creator, network) so
BSC/Solana receiving addresses can coexist with the legacy Tron/USDT one;
seeds `crypto_payouts_enabled`/`crypto_payout_mode` manifest keys.

---

## 41. Sitewide UI Theming, Icon Sets & Accessibility Text Zoom (v2.36)

A cross-cutting visual/legibility pass across the web app, PWA, and
Capacitor Android app, covering: a +30% base font-size increase plus a
user-adjustable accessibility zoom control, darker/more legible gray tones,
tighter mobile edge padding, narrower tweet images on wide viewports, an
admin-configurable sitewide UI theme system (with Reddit-style, Facebook-
style, and Christmas presets in addition to the Default look), and a
second, monochrome icon set alongside the existing emoji icons.

### Architecture — "skin, not structure"

Sitewide themes follow the same contract the existing per-profile
(`lib/profile/themes.ts`) and per-blog (`lib/blogs/themes.ts`) theme engines
already use: a theme is a set of color/shape/density **tokens**, never a
different component tree. No page renders different markup per theme.

- `shared/tailwind-tokens.js` — the `neutral` (gray) color scale, previously
  static hex values, is now backed by CSS variables
  (`neutral.500: "hsl(var(--neutral-500))"`, etc.). Every existing
  `bg-neutral-*`/`text-neutral-*`/`border-neutral-*` utility class across the
  whole codebase therefore re-colors automatically when the active theme's
  CSS variables change — no per-component edits were needed to make theming
  reach the entire app. `borderRadius` similarly reads a `--radius-scale`
  multiplier, and a new `fontSize` scale (Tailwind's stock sizes × 1.3,
  wrapped in `calc(<size> * var(--font-zoom, 1))`) backs both the sitewide
  font-size increase and the user zoom control.
- `apps/web/app/globals.css` and `apps/android/src/styles/globals.css`
  (kept in sync) define the actual token values: a darkened `:root`/`.dark`
  neutral scale (the stock Tailwind gray scale was too pale for comfortable
  contrast at the 200-500 steps, used for dividers and muted text), and
  `[data-site-theme="reddit"|"facebook"|"christmas"]` (×`.dark`) blocks
  each overriding `--background`, `--card`, `--border`, `--muted-foreground`,
  the neutral scale, `--radius-scale`, and `--content-max-w`. A new
  `.site-container` utility (`max-width: var(--content-max-w, 48rem)`)
  replaces the hardcoded `max-w-3xl` on `AppContentShell` (the wrapper
  nearly every authenticated web/PWA page renders inside), so a theme's
  column width reaches the whole app from one place.
- `shared/utils/uiThemes.ts` — cross-app vocabulary: `SITE_THEME_IDS`
  (`default`/`reddit`/`facebook`/`christmas`), `ICON_SET_IDS`
  (`emoji`/`mono`), and the font-zoom step table (70%-200%, default 100% —
  100% already includes the +30% baseline bump).
- **Admin default**: two new `x_manifest` keys, `ui_site_theme` and
  `ui_icon_set` (migration `0015_ui_site_theme_icon_set.sql`, seeded
  `default`/`emoji`), editable at `/gate44/config` under a new "Theming"
  group, exposed publicly via the existing `/api/manifest` endpoint's `ui`
  section (no new Redis cost — it rides the same cached manifest object
  every other public flag already uses).
- **Per-device override**: exactly like the existing light/dark preference
  next to it in Settings, the sitewide theme, icon set, and font-zoom
  choices are device-scoped `localStorage` (web) / `@capacitor/preferences`
  + localStorage mirror (Android) values — never synced to the server, no
  DB write, fully offline-friendly. Web applies the per-device override
  before first paint via a small blocking inline `<script nonce>` in
  `app/layout.tsx` (the same FOUC-prevention technique `next-themes` uses
  for light/dark), falling back server-side to the admin default rendered
  directly into the SSR'd `<html data-site-theme>` attribute. Android
  applies it at module scope in `lib/theme/ThemeProvider.tsx`, mirroring the
  existing light/dark theme's no-flash pattern exactly.
- Settings > Appearance (`/settings`, and the Android equivalent) exposes a
  Site Theme picker, Icon Set picker, and a `+`/`−` Text Size stepper
  ("Zoom: − 100% +").

### Icon sets

A new `<Icon>` component (`apps/web/components/ui/Icon.tsx`, mirrored at
`apps/android/src/components/ui/Icon.tsx`) renders either the existing
emoji character or a matching `lucide-react` monochrome vector icon
depending on the active icon set, resolved the same way the site theme is
(per-device override, else the admin default). Two usage modes:
`<Icon name="home" />` for the curated nav-chrome vocabulary (top bar,
bottom tab bar, side drawer/menu, profile dropdown), and the
general-purpose `<Icon emoji="🎁" />` for every other UI-chrome icon in the
app, resolved via `shared/utils/emojiIconMap.ts`'s `EMOJI_TO_LUCIDE_NAME`
table (~200 mapped emoji covering navigation/status/commerce/achievement/
content/places/actions glyphs). An emoji with no entry there renders as the
plain character in both icon sets — never broken.

Both `Icon.tsx` files use **explicit named imports** from `lucide-react`
(never a namespace `import *`), indexed into a `LUCIDE_BY_NAME` record —
required for tree-shaking, since a computed `LucideIcons["Foo"]` lookup
against a namespace import can't be statically analyzed by the bundler and
would otherwise ship the entire ~1000-icon library, which matters
especially for the Capacitor Android APK's size.

**Migration scope**: after the initial nav-chrome-only pass, a full
follow-up migrated essentially every UI-chrome emoji across both apps —
roughly 800+ occurrences across ~250 web files and ~170 Android files
(admin panels, feed cards, settings, wallet, messages, profile, games HUB
chrome, etc.) — to the swappable `<Icon>` abstraction. **Deliberately still
raw emoji, by design, not oversight**: anywhere the emoji itself IS content
rather than a decoration — default-avatar-emoji pickers
(`shared/utils/defaultAvatars.ts`), country-flag selectors, gift/sticker
catalog items, cover-emoji pickers, and all in-game emoji data inside
`apps/web/components/games/engines/*` (chess pieces, playing-card suits,
dice faces, memory-match tiles, emoji-quiz/flag-quiz answer keys, fruit/
animal sprites — converting these to a monochrome icon would visibly break
the actual gameplay, e.g. turning a chess board's pieces indistinguishable
or defeating a "guess this emoji" quiz). A small number of translation
strings had their icon-shaped emoji baked directly into the
`shared/i18n/locales/en.json` value rather than as a JSX literal (e.g.
`"kyc.doc.uploaded": "✓ Uploaded"`) — those were stripped and given a
matching `<Icon>` at each call site instead, since leaving the emoji in
the translation string would have rendered a duplicate glyph once nav-style
`<Icon>` badges were added nearby.

### Other fixes in this pass

- Mobile edge padding tightened (`px-4` → `px-3`) on `AppContentShell` and
  the top nav bar, so page content sits closer to the phone screen edge.
- Tweet images (`TweetCard.tsx`, `PublicTweetView.tsx`) now cap at
  `sm:max-w-md` instead of stretching full-width on desktop/tablet
  viewports — unchanged on mobile, where the card is already narrow.
- Profile page alignment/overflow bugs (long display names/usernames/bios
  breaking layout, stat-pill wrapping on narrow viewports, spacing
  inconsistent with the rest of the app) audited and fixed on both web/PWA
  and the Capacitor app — see the repository's commit history for the
  itemized list; this was a bug-fix pass against the existing profile
  pages, not a redesign.

### Scope notes / deliberate simplifications

- Reddit-style and Facebook-style themes are color/density/shape re-skins
  (page background, card contrast, corner radius, column width) — not
  pixel-accurate clones of either product's full visual language.
- The Christmas theme is a festive red/green color re-skin only; no
  animated snow or other decorative effects, to keep the change purely
  additive/low-risk.
- The Capacitor Android app does not have a single shared page-container
  component the way `AppContentShell` centralizes edge padding on
  web/PWA — each Android route manages its own internal padding, and many
  deliberately use edge-to-edge/full-bleed card sections (a common,
  intentional native-app pattern distinct from web's boxed-column layout).
  Investigating a mechanical retrofit of web's `px-4`→`px-3` edge-padding
  change found it would be unsafe to apply blindly: adding outer padding at
  the root would stack with routes' own full-bleed section padding and
  visually break the intentional edge-to-edge design in many screens.
  What *was* safely applied: the shared `.site-container` max-width now
  wraps every route in `apps/android/src/routes/__root.tsx` (a no-op on
  phone-width viewports, bounding width on tablets/foldables). A genuine
  route-by-route edge-padding audit is a per-screen design decision, not a
  mechanical find-replace, and remains a follow-up requiring visual review.
- No new database table — `ui_site_theme`/`ui_icon_set` reuse the existing
  `x_manifest` key/value table, which already has its Supabase Data API
  grants from its original migration.

## 42. PIN Hardening, Leaderboard Anonymity, Session Notice & Loading Fixes (v2.38)

### 42.1 PIN: rate limiting, lockout, change and reset

- **Single choke point.** Every code path that compares a submitted PIN with `user_pins.pin_hash` — `POST /api/auth/pin/verify`, change (`POST /api/auth/pin/setup`), `DELETE /api/auth/pin/remove`, creator bank-account and wallet-address edits, and PIN reset — goes through `lib/auth/pinAttempts.ts`. Previously only `/verify` counted failures, so the other routes could brute-force the 10,000-key space at their (much looser) request rate limits.
- **Policy (defaults, admin-editable at `/gate44/config` → "Auth"; keys `pin_max_failed_attempts`, `pin_fail_window_minutes`, `pin_lockout_minutes`, `pin_strike_limit`, `pin_strike_window_hours`, `pin_long_lockout_hours`, migration `0017`).** 5 wrong PINs within 15 minutes → locked for 15 minutes (`429 PIN_LOCKED`, `Retry-After`). 3 lockouts within 24 hours → locked for 24 hours. A correct PIN clears the counter. A lock rejects even the correct PIN. Redis cost: one `TTL` (lock check) + one `DEL` on the happy path; counters are only written on a wrong PIN.
- **Wrong PIN is `400 INVALID_PIN`** (with `attemptsRemaining`), never `401` — the client treats any `401` as an expired session — and never `200 { verified: false }`, which the web and Android clients used to mistake for success. `200 { verified: true }` is returned only for a correct PIN.
- **Changing a PIN requires the current PIN** (`currentPin` on `POST /api/auth/pin/setup`; `400 CURRENT_PIN_REQUIRED` otherwise). Previously any live session could silently overwrite the PIN.
- **Forgot PIN → reset.** `POST /api/auth/pin/reset { pin, confirmPin, totpCode? | password? }` sets a new PIN after identity re-verification: an authenticator code (mandatory when 2FA is on), or the account password, or — for Google/Telegram-only accounts with neither — a session created in the last 10 minutes (`403 REAUTH_REQUIRED` otherwise: sign in again and retry). A successful reset clears every lockout counter and the "PIN verified" window. Available from the Settings PIN gate ("Forgot PIN?") and Settings → Security PIN on web/PWA, and Settings → Security on the Android (Capacitor) app.
- **How does a user change their PIN?** Settings → Security PIN → Change PIN (enter current PIN + new PIN twice). Forgotten: "Forgot PIN?" as above.

### 42.2 Hide my name on public leaderboards

- **What.** A paid privacy setting, `users.hide_from_leaderboards` (default `false` = visible). When on **and** the user is still eligible, the user appears as **"Anonymous"** (name, avatar, username, city, crest and profile link removed) on every public leaderboard: global/national/city/season boards and Hall of Fame (`/leaderboards`), the season top list, per-game boards, and the home season preview. Rank and score are still shown.
- **Sub-leaderboards.** On leaderboards that have their own admins — a classroom (creator, moderators, staff), a guild board / guild war board (captain and guild moderators) — hidden members also show as "Anonymous" to everyone else, but those admins get a small **Reveal** control that shows the real identity (and **Hide** to put it back). Everyone else never receives the identity (server-side masking, not CSS). A hidden user always sees their own row, tagged "Hidden from others".
- **Who can use it.** Eligibility = feature enabled AND (plan/role list match OR account level ≥ unlock level). Free users see the toggle greyed out with a small "Paid" tag and a "See plans" link; turning the setting OFF is always allowed, and a downgrade silently makes the user visible again (the stored choice only takes effect while eligible).
- **Admin control** (`/gate44/config` → "Privacy", also the Android admin config): `leaderboard_anonymity_enabled` (master switch, default on), `leaderboard_anonymity_min_level` (level that unlocks it irrespective of plan; `0` = plans only), `leaderboard_anonymity_eligible` (plan/role list; default plus, pro, max and the three business tiers).
- **Where users set it.** Settings → Privacy on web/PWA and the Android app (`PATCH /api/users/me/privacy { hide_from_leaderboards }`; `403 LEADERBOARD_ANONYMITY_LOCKED` when not eligible). It is listed as a feature of Plus, Pro, Max and the business plans on the plan management/upgrade pages.
- **Caching.** Cached leaderboard data (in-process/Redis) holds real identities plus an anonymity flag and is masked per viewer *after* the cache, so a warm cache can never leak a hidden name.

### 42.3 Celebrations, streak quest and reward delivery

- Confetti fires only for earned/gifted credit inflows (allow-list `isCelebratableCreditType`); refunds never celebrate.
- **Streak Keeper** ("Log in for 7 consecutive days") now shows the user's live login streak (capped at 7) instead of a per-day counter stuck at 1/7; completion is awarded when the streak reaches the target. The nightly `daily-core` job no longer also increments the streak or re-awards login XP that `POST /api/login/daily` already handled (which double-counted), and only resets streaks after a whole missed day.
- Realtime reward events (reward toasts, confetti, level-up, quest complete) were never delivered on web because the client tried to read the user id from the HttpOnly access-token cookie; it now uses the identity lookup (`/api/auth/me`).

### 42.4 "Session expired" notice

The blocking "you've been signed out" popup no longer appears for visitors who were never signed in (every anonymous page load probed `/api/auth/me` and its 401 was mistaken for an expiry) and no longer repeats on every visit/window after an expiry. A device-level "was signed in" hint (`zobia:auth:had-session` in localStorage; a plain boolean, no user data) arms the notice, a silent token refresh is attempted before concluding a session is dead, and the hint is cleared once the notice has been announced, on logout, and on the sign-in screen.

### 42.5 First-paint fix (blank page with only "Skip to main content")

On a slow network the browser painted the app shell before the large Tailwind stylesheet arrived and before the async server layouts (manifest/DB reads) had streamed any page content, leaving an unstyled "Skip to main content" link on a blank white page. Fixed with (a) critical CSS inlined in `<head>` (skip-link positioning + light/dark page colours), and (b) a root `app/loading.tsx` streaming fallback (spinner) so a real loading state paints immediately.

### 42.6 Other fixes in this release

`/settings` crash ("CHAIN_LABELS is not defined") — chain labels now resolve inside the component via i18n; `/api/seasons/current` no longer sent per-user data with `public` CDN caching; the Seasons page no longer crashes on `entry.xp` (API sends `seasonXP`); the Guild War contributor list now reads the API's actual shape; the leaderboard page highlights the viewer's own row; Android PIN removal used the wrong HTTP verb. Migration: `0016_leaderboard_anonymity.sql`.

## 43. Hashtags & Portals (v2.39)

### 43.1 What it is

**Hashtags** make every public piece of content discoverable by topic, place or school, and **Portals** turn a hashtag into a mini-portal page at `/h/<slug>` (for example `/h/lagos`, `/h/uniben`, `/h/edo`, `/h/detroit`) that gathers content from every primitive in one place: a mini discovery feed, rooms, guilds, top contributors, an official forum board, Q&A, wikis, blogs, polls and quizzes. The name **Portals** was chosen because "Communities" already means ClassRooms (`/c/<slug>`) and Community Notes. The page is public, server-rendered and crawlable (`/h` is the directory, `/h/<slug>` a portal), and the vanity alias `zobia.org/#/<slug>` redirects to it client-side (a URL fragment never reaches the server).

Two kinds of portal share one template:

- **Official** portals are curated by admin at `/gate44/portals` (title, tagline, cover, accent colour, which sections show and in what order, an optional official forum board, a place/school keyword, pinning, boost and sponsorship). They carry a verified badge and are never auto-archived.
- **Auto** portals are created for trending hashtags by the feed-refresh CRON once a tag passes admin thresholds (see 43.4). They are "lazy": only a row is created, and every section is built on the first visit and then cached.

### 43.2 Hashtags

- **Syntax (shared tokenizer, `shared/utils/hashtags.ts`, used by web, PWA and Android).** `#` followed by 2-50 letters, digits or underscores, not preceded by a letter/digit/underscore, `&`, `/` or another `#` (so `# Heading`, `a#b`, `&#39;`, `example.com/#x` and `##x` are not tags), not digits-only (`#1`, `#2024`). Tags are normalised (diacritics removed, lowercased): `#Ọ̀ṣun` and `#osun` are the same tag; `#Lagos` and `#LAGOS` collapse to `lagos`. At most 10 distinct tags are recorded per item.
- **Where they are recorded** (`lib/hashtags/service.ts`, called inside each create transaction, and on edit): Tweets (content), Moments (text content and caption), blog posts (title, excerpt, body; only while published), Answers questions, forum threads, rooms and classrooms (name, description; public only), wiki pages (title, body), polls, quizzes and guilds (name, description). Tagging never fails or rolls back a post when called outside a transaction (`recordContentHashtags` logs and swallows).
- **Linking in the UI.** `#tags` in Tweets and Moments render as links to their portal (web `components/portals/HashtagText.tsx`, Android `components/portals/HashtagText.tsx`), as React nodes only (no `innerHTML`). The Tweet and Moment composers show tag autocomplete chips while typing `#fragment` (`GET /api/public/hashtags/search`, debounced, memoised).
- **Moderation.** Admin can **merge** duplicate tags (`#Uniben` into `#uniben`: links move, the merged tag becomes an alias, old `/h/` links 308 to the survivor, future posts using the old spelling land on the survivor) and **block** abusive tags (links removed, portal suppressed, tag never linked again). Reserved words (`admin`, `gate44`, `api`, `all`, `new`, `trending`, ...) can never become portals.
- **Data hygiene.** Content tables are polymorphic (`content_hashtags` has no foreign key to content), so deleted/unpublished/hidden content is swept by the feed-refresh CRON and expired Moments by the nightly `daily-core` job; every portal query also re-applies the same visibility filters the Home Feed uses, so a stale link can never surface private, expired, draft or deleted content.

### 43.3 The portal page

`GET /api/public/portals/<slug>` (and the SSR page) return one viewer-independent payload, cached in memory (20 s) and Redis (admin TTL, default 10 minutes) with single-flight recompute, so "dynamic on first load, then cached": a cold portal runs the section queries once, everyone else gets one Redis GET or none. Sections (admin-orderable, each can be hidden per portal; empty sections render nothing): **Discover** (mini feed, Top/New, load-more), **Rooms**, **Guilds** (tagged, or whose city matches the portal's place keyword), **Top contributors** (users who chose to hide from leaderboards are excluded), **Forum** (the linked official board's latest threads plus tagged threads), **Questions & answers**, **Wiki**, **Blogs**, **Polls & quizzes**. Ads use the existing `<AdSlot/>` (`portal_top`, `portal_after_3`, `portal_bottom`). Viewer state (am I following?) is a separate call so the cached payload is shared. Page views and feed-suggestion clicks are counted per day (`portal_stats_daily`), deduped client-side in localStorage.

### 43.4 Trending detection and the lifecycle

Run from `/api/cron/feed-refresh` (external scheduler, see `docs/SETUP.md`), set-based and idempotent: **promote** tags with at least `portals_auto_min_posts` tagged posts from at least `portals_auto_min_distinct_users` distinct authors inside `portals_trending_window_hours` (defaults 20 / 8 / 48h; blocked, merged and reserved tags never qualify), **revive** archived portals that are active again, **archive** auto portals quiet for `portals_archive_after_days` (default 30; never official, pinned, boosted or sponsored portals), **sweep** links to deleted content and recompute counters. Admin can promote an auto portal to official, suppress it (404s publicly) or delete it from `/gate44/portals`.

### 43.5 Feed suggestions and admin boost ("in-house ads")

The Home Feed (`GET /api/feed`, tabs For You / Trending / New) may carry one **"Portals for you"** card per page (`FeedPage.portalSuggestion`, after every `portals_feed_suggestion_every` items, default 8; `0` disables), so web, PWA and the Capacitor app all get identical placement from the one response. Portals are chosen by a seeded weighted sample (seed = user, feed page, hour): weight grows with recent activity and followers, is 1.5x for official and 2x for pinned portals, and is multiplied by up to 11x by the admin **boost dial** (0-100 at `/gate44/portals`, with optional start/end dates; an active sponsorship counts as a boost of 50). Portals the viewer already follows are skipped. Boosted or sponsored portals show a "Promoted" tag. This is the first-party, always-free equivalent of an in-house ad: no `ad_campaigns` row is involved, so admin controls frequency and prominence directly. Impressions, views and clicks per day feed the analytics panel in the portal editor. Suggestions can be dismissed for 24h (per-user localStorage key).

### 43.6 Following, search and navigation

- Users can **follow** a portal (`POST/DELETE /api/portals/<slug>/follow`, optimistic, `follower_count` recomputed exactly); `/h` has Trending / Popular / New tabs, search, and a Following tab cached per user in localStorage (web) or react-query (Android).
- **Sitewide search** gains a **Portals** category (`types=portals`; `#lagos` and `lagos` both find it; an exact tag match ranks first).
- **Navigation:** "Portals" entry in the web Navbar/Sidebar and the Android drawer (feature-flagged by `feature_portals`). Nav "active" matching is now path-segment aware, fixing a latent bug where any short route would highlight on longer routes that share its prefix.
- **Deep links:** `https://zobia.org/h/<slug>` (verified Android App Link, already host-wide) and `zobia://h/<slug>` open the portal screen in the Capacitor app; merged tags follow their alias.

### 43.7 Admin and settings

`/gate44/portals` (web; nav entry "Portals"): Portals tab (status filters, search, create official portal, edit copy/cover/accent/place/board/sections/pin/boost/sponsor, promote, suppress, restore, delete, 30-day views/impressions/clicks/follows) and Hashtags tab (explore, make portal, merge, block/unblock). Settings at `/gate44/config` -> "Portals": `feature_portals`, `portals_auto_create_enabled`, `portals_auto_min_posts`, `portals_auto_min_distinct_users`, `portals_trending_window_hours`, `portals_archive_after_days`, `portals_feed_suggestion_every`, `portals_feed_suggestion_max_portals`, `portals_cache_ttl_seconds`. All admin actions are audit-logged (`admin_portal_*`, `admin_hashtag_*`).

### 43.8 Data model and migration

Migration `0018_hashtags_portals.sql` adds `hashtags`, `content_hashtags`, `portals`, `portal_follows` and `portal_stats_daily` (explicit Supabase GRANTs for `anon`/`authenticated`/`service_role`, RLS enabled with public-read policies only on hashtags, content links and non-suppressed portals), seeds the settings above, and registers the ad placements `portal_top`, `portal_after_3`, `portal_bottom`. Drizzle definitions live in `lib/db/schema.ts`.

### 43.10 Discovery hub, tag pages and seed portals (v2.40)

- **Where to see portals.** The hub at `/h` (nav item "Portals", the feed card's "See all", the trending strip above the For You feed) and any `#tag` link. **Official** portals are curated by admin (`/gate44/portals`); **auto** portals appear only after `/api/cron/feed-refresh` has run and a tag passes the thresholds in 43.4. Seeded starter portals (migration `0019_seed_portals.sql`: ten places, six universities, six topics) are official and editable or deletable by admin like any other.
- **Hub sections** (one cached payload, `GET /api/public/portals/discover`, memory 20 s then Redis, single-flight, dropped whenever admin edits a portal or the cron runs): Featured (pinned, actively boosted or sponsored portals, topped up with official ones), Trending hashtags (chips ranked by distinct posters in the trending window, including tags that have no portal), Your portals (signed in), Rising, Places and schools (portals with a place or campus keyword), New and Most followed, plus a "Browse all" grid with Trending / Popular / New tabs. One search box searches hashtags and portals together.
- **Tag pages.** `#tag` links used to 404 unless a portal existed. Now `/h/<slug>` for any tag with visible content renders a read-only **tag page** (`lib/portals/tagPage.ts`): the same sections and cache as a portal, no follow and no view counter, `noindex`, with an admin-only "Make this an official portal" link that opens `/gate44/portals` prefilled. Only a tag with nothing visible (unknown, blocked, empty) returns 404; merged tags redirect to the survivor. `discover` is a reserved slug.
- **Home entry point.** A slim row of trending hashtags above the For You feed (`TrendingTagsStrip`), hidden when there is no trend or the feature is off.
- **Android.** `routes/h/index.tsx` (hub) and the tag-page state in `routes/h/$slug.tsx` mirror the web; react-query persists them per user for offline.

### 43.9 Not built (by design, for later)

Sponsored-portal self-serve checkout for brands and schools, per-portal moderator roles and badges, a per-portal chat room, OG share-card images, and paid creator boosts of a portal through `ad_campaigns` (the boost dial is admin-only today).

---

## 44. Vercel Hobby storage and season-end fixes (v2.41)

### 44.1 Function Storage on the Hobby plan

Vercel's Hobby **Function Storage** (10 GB) counts the function bundles of every deployment Vercel retains, across the team. It is filled by deployment count multiplied by deployment size, not by traffic. Previously every pushed branch created a preview deployment (and Vercel protects deployments of branches that still exist), and each deployment was about 155 MB of function files in 7 function groups.

- **Production-only builds, branch-name agnostic.** `apps/web/scripts/vercel-ignore-build.sh` (`ignoreCommand` in `apps/web/vercel.json`) skips any build whose `VERCEL_ENV` is not `production`. Vercel sets that only for the branch named in Project Settings → Git → Production Branch, so renaming the production branch needs no code change. Skipped builds show as Canceled and store nothing. (An earlier revision used `git.deploymentEnabled` with a hardcoded `main`, which would have silently blocked production deploys after a branch rename; it was removed.)
- **No-op production builds skipped.** The same script skips production commits with no changes under `apps/web`, `shared`, the root package manifests or `patches`. `FORCE_VERCEL_BUILD=1` (Production env only) forces a build.
- **Leaner bundles.** `outputFileTracingExcludes` drops the RSC client manifest from API route handlers (unused there) and the unused musl sharp/libvips binaries.
- **One CRON config.** All CRON routes use `maxDuration = 300` (Hobby maximum with Fluid Compute) so they share one function; no other route overrides `maxDuration`. Enforced by a unit test.
- **Measuring.** `npm run analyze:functions` in `apps/web` after a build. Result: about 77 MB per deployment in 3 function groups.

Operational follow-up for the owner: delete old preview deployments once in the Vercel dashboard, delete merged branches, and enable GitHub's "Automatically delete head branches". Full steps in `docs/SETUP.md` → *Vercel Hobby storage*.

### 44.2 Season end

- **Admin "End Season Early" now really ends the season.** `DELETE /api/admin/seasons/:id` used to try to pay rewards before the season was marked ended (so the payout was silently skipped), then deactivated it so the CRON never processed it either: no ranking reset, no rewards, no ceremony room, while the response claimed rewards were paid. Both the admin action and the `daily-platform` CRON now call one shared, idempotent `endSeason` (rankings archived and reset, top-10 rewards, closing-ceremony room). The web admin `/gate44/seasons` page gains the **End Season Early** button the Android admin already had.
- **Season History shows up.** Profile and stats Season History queried columns that do not exist and were always empty; they now list archived seasons.
- **Admin badge label.** The "Ended" status badge shared an i18n key with the "Season ended and rewards distributed" toast; it now uses `admin.seasons.statusEnded`.

### 44.3 Other fixes

- Default social-share image pointed at a non-existent `/og-default.png`; it now uses the generated `/og-image.png`, and the root layout sets `metadataBase` to `NEXT_PUBLIC_APP_URL` so relative share URLs resolve against the canonical domain.
- Load tests and e2e specs that called the retired `/api/cron/daily` (410) or sent an `x-cron-secret` header (CRON auth only accepts `Authorization: Bearer`) now hit the real daily slots; the season-reset e2e spec was rewritten against real endpoints.
- `drizzle-kit` moved to `devDependencies` (build-time tool only).

---

## 45. Active CPU and bug sweep (v2.42)

### 45.1 Why

With a single tester and short sessions the project used about a quarter of Vercel Hobby's 4 hours of monthly Active CPU. A 12-hour Observability drilldown showed no hot route, just many repeated small requests: `/api/users/me` 167, `/api/auth/me` 75, `/api/ads/serve` 149, each home widget about 25, about 20 nav pages about 21 each (link prefetching), `/api/realtime/ably-token` 85 and `/api/security/csp-report` 31, plus a column of error rates.

### 45.2 Fewer requests (web, PWA, Capacitor Android)

- **Client read cache** for identity, home widgets, the notification badge and ad slots, with per-endpoint TTLs (1 to 60 minutes), shared in-flight requests, and invalidation on any state-changing write, logout, 401, pull-to-refresh and own-channel realtime events. Memory only, per user. A repeat visit to Home now makes zero API requests (was about 18).
- **Links prefetch on intent** (hover/touch/focus) through one shared `Link` component instead of on scroll-into-view.
- **No React Query refetch on window focus** on web (matches Android).
- **One shared Ably connection** per session; the token covers all channels in use (the token route now authorizes a list of channels individually).
- **Ads batched**: slots on a page share one request; answers reused for 5 minutes; "ads disabled" is a cacheable empty 200 instead of a 503.
- **Polling only while visible** for room top-gifters, room/group presence heartbeats, guild war contributors and the room pulse bar.
- **No known-failing requests**: moderators no longer probe the guild-moderation scope; private-classroom calendars and share counters no longer 403 for non-members; the retweet button is hidden on your own tweets; `/profile/<username>` links work.

### 45.3 Content Security Policy

The CSP blocked Ably 2.x (realtime never connected, chat stayed on its fast fallback poll and every attempt filed a CSP report), the crypto checkout (WalletConnect, web3modal, the BSC RPC), YouTube and TikTok tweet embeds, and most Giphy images. All are now allowed, AdSense hosts are allowed only when AdSense is configured, and the AdSense fallback actually loads Google's script (it never did). The CSP report endpoint ignores repeats of the same violation for 10 minutes before writing to the database.

### 45.4 Bugs fixed

- **Raw SQL arrays**: 157 Drizzle bindings of the form `ANY(${array}::uuid[])` / `unnest(${array}::…[])` compiled to a row value that Postgres rejects. Affected daily/sub-daily CRONs, poll voting, @mentions in tweets and room messages, trust scores, forum replies, game saves, theme ownership, blog-theme plan lists and the admin user gender filter. All now bind the array as one parameter (`sql.param`), enforced by a test.
- **Ledger archive CRON** used wrong column names and two archive tables did not exist; fixed with migration `0020_ledger_archive_tables.sql`. It now archives only resolved discrepancies.
- **Guild-wars CRON** drop-room auto-close referenced a non-existent `room_type` column.
- **Classroom boosts**: a "classroom" boost could target a normal room and vice versa.
- **Local development**: pino is now a server-external package, so `next dev` no longer turns every request into a 500 after the first log line.

---

*ZobiaSocial PRD v2.42*
*Project Codename: ZobiaSocialAPK*
*Prepared for developer handoff*

## 46. Content management and privacy contracts (v2.43, in development)

These requirements supersede earlier conflicting defaults. The implementation and validation ledger is [docs/IMPLEMENTATION-STATUS.md](docs/IMPLEMENTATION-STATUS.md); planned requirements are not evidence of completion.

### 46.1 Messages and private content

- Account/conversation-scoped offline caches retain at most 50 messages. Logout/expiry remove personalized content, including legacy caches. Expiry covers the app and clears authentication before login navigation.
- Classroom messages, previews, presence and realtime subscription authorization require enrolment or authorized owner/staff access. No cached classroom transcript may render before authorization.
- Message pagination uses the database timestamp’s full precision and a UUID tie-breaker. Live polling owns its own cursor; realtime delivery and local sends cannot advance it.
- Protected conversations must never publish to a public Broadcast topic. Supabase uses authenticated polling until an authenticated private-channel implementation and its access policies exist. Provider selection cannot weaken privacy.

### 46.2 Challenges, presence and quests

- Challenges expire after 48 hours by default, including when cron is delayed. Invitations cannot be accepted or played after expiry. A configurable cap defaults to ten invitations per sender per UTC day.
- Opponents are friends of any activity age, or opted-in users active within a configurable seven-day window. Warn about inactive friends only when both participants permit activity visibility. Label visible recent players clearly.
- Hiding activity requires Level 2 and makes presence visibility reciprocal. Explain the consequence and link to privacy settings.
- Active, expired, completed and archived lists support 20-item pagination. Archive is per participant. Retain terminal history for 90 days; never prune nonzero escrow.
- Acceptance, escrow, cancellation, expiry, settlement and refunds are transactional and idempotent. Lock shared wallets in a consistent order. Stakes use platform Credits; this release introduces no real-cash wagering.
- Eligible send/accept/win activity quests award their configured XP. Omit quests the user cannot perform, including stale deck entries; links lead to the actual action. Progress tips show real quest XP and XP remaining to Level 2.

### 46.3 Blogs and bookmarks

- Blog discovery has separate Blogs and Posts sections. Each loads six results with Popular, Trending, New, Random and Subscribed tabs. Only published article metadata is discoverable; drafts, private revisions and article bodies are excluded.
- Saving edits to a published article/page creates a private revision. Publish explicitly replaces the public revision. Discard restores the editor baseline; account-scoped recovery protects unsaved text. Unpublish removes public access and reports the new draft state.
- Reward pots start unselected. Zero-price setup copy describes choosing an amount. Frontend owners/staff see Edit; dashboard titles/View pills lead to published posts and draft titles open the editor. Delete warns that removal is permanent.
- First publication produces a success notice, remaining-post count and a one-visit New badge. Quota counts articles and pages; singular wording is grammatical. Offer upgrade when ten or fewer remain and a higher plan exists. Max users can buy permanent per-blog bundles of 100/200/300/500/1000 extra posts in Credits or Stars; defaults include increasing volume discounts and are configurable.
- Paid unlocks require the current displayed price. Commit buyer debit, reader access, statistics and creator earnings atomically. Logged-out users see sign-up/login and return to the post; insufficient-funds guidance links to credits, gifts, quests and help.
- Bookmarks and folders are private. Included folder limits default to Plus 5, Pro 15, Max/Business 30 and remain unlocked after downgrade. Extra folders cost 100 Credits initially, 50 subsequently; administrators control these values. Purchases require explicit current-price confirmation and idempotent requests. Folder deletion retains its items in Unfiled.

### 46.4 Help, administration and localization

- Beginner documentation covers navigation, money, plans, privacy, chat, quests and content creation. Currency labels, limits and prices must use allowlisted public settings, never arbitrary configuration interpolation. Include published help in search.
- Help AI answers Zobia questions, resists unrelated programming and instruction injection, and ends with a help-center link. Default free usage is 20 questions per UTC week; warn after 11, show reset date, and require explicit payment confirmation beyond allowance. Reserve quota atomically, make retries idempotent, and refund/restore failed provider requests.
- Group user menus and administrative panels by purpose. Configuration search includes friendly names, descriptions and keys, with predictive results. Cached operational data has explicit refresh controls.
- Locale identifiers, native names and flags are shared across clients. Profile selections persist; Arabic updates direction immediately. English catalogs stay synchronized. Missing translations and interpolation mismatches are release work, not resolved by copying English into another locale.

### 46.5 Maintainer decisions and verification

- Use the current Capacitor app in `apps/android`; legacy Expo is reference-only. PWA follows web behavior. Use existing Drizzle, ledger, moderation, notification and rendering utilities.
- Read cached product settings before acquiring database locks; nested configuration reads can exhaust small connection pools. Keep provider network calls outside transactions.
- A unique ledger reference alone does not make surrounding balance/statistics updates idempotent. Update derived balances only when the corresponding row is newly inserted, within the same transaction.
- New private tables enable RLS and explicitly grant only server access. Grants and policies ship in the same migration. API ownership validation remains mandatory.
- Test concurrency, rollback and privacy with a disposable real PostgreSQL database. Run the native application’s TypeScript project, not an empty solution config. Record separately what was compiled, unit tested, integrated, exercised in a browser, built as an APK, and tested with providers.
- Historical detail is retained in [the release-note archive](docs/archive/PRD-HISTORICAL-RELEASE-NOTES.md); durable rules are consolidated below and in the feature sections. Do not remove an interspersed feature section merely because it follows an old changelog.

### 46.6 Tales

Tales is a dedicated `/t/` story primitive, distinct from Blogs, with cover images, author management, chapter editing, discovery, votes/comments/sharing, author subscriptions and optional subscriber publication notifications. Level 2 is required to write. Free accounts have ten active stories and twenty drafts; paid plans have unlimited stories/drafts. Paid plans can schedule chapter drip; authors can publish individual or all chapters.

Chapter one is always free and public. Further chapters require login; continuation preserves the destination through login/onboarding. Authors can paywall individual chapters in Credits, including a story-level default with chapter overrides. Confirm price before payment and explain welcome Credits/wallet access. Reuse transactional ledger and idempotent access patterns. Stories and chapters can have funded reward pots.

AI moderation prohibits explicit sexual material and commercial/advertorial content unrelated to the story; clean romance is allowed. Uncertain moderation escalates to humans. Writers can appeal a disapproval or account penalty three times by default, configurable by administrators. Authors control comments; readers can report through the site reporting mechanism. Suspension, banning and demonetization must affect every relevant read/write/payment path.

### 46.7 Official automated content

Use official Z-marked AI accounts and an administrator-controlled scheduler with multiple selectable configured AI providers. Publish only into permitted public/official destinations, including forums, wikis, official blogs and explicitly configured rooms. Prompts use destination descriptions and existing content to create relevant, detailed evergreen material. Detect duplicate and highly similar output across all automated accounts; do not publish low-quality filler. Integrate moderation, permission checks, audit records and idempotent publication. Scheduling frequency is controlled by the operator’s external cron service.

Tales uses first-class story/chapter tables and authenticated APIs; its first chapter is also available through a filtered public API. Scheduled publishing and subscriber fan-out run through `/api/cron/tales`. Body text is withheld before login/unlock, including in API responses. Author revenue is a configurable share in Credits (70% by default), transferred transactionally with reader payment. Story and chapter reward pots reuse the shared treasury system.

The official content studio defaults to disabled jobs and editor review. Official accounts carry a persistent Ⓩ in their display name and have no ordinary login credentials. Selected providers are bounded by the configured provider chain. A leased job reads only eligible public destination context, generates an evergreen contribution, checks substance/source URLs, performs a separate editorial review, and rejects exact or highly similar output across accounts. Publishing and generation state commit together. Official jobs receive no XP or quest rewards. Initial destinations are active public forum boards and blogs/wikis/public free-open rooms owned by the official account. An administrator can edit a held contribution before approval. `/api/cron/auto-content` processes one leased job per invocation; the operator controls invocation frequency externally.

Reward pots retain claim history by funding generation. Concurrent initial funding is serialized. Closing refunds the unclaimed remainder; reopening creates a new generation so earlier claimants can participate again without duplicate payment within a generation. Room rewards support Credit, Star and custom-instruction claims.

## 47. Accepted requirements still awaiting implementation

### 47.1 Dynamic account catalog and translation completion

Provide one central account-type catalog for free, paid and business accounts, sorted by cost, supporting new regular/business types and granular limits. Do not expose new names without integrating actual entitlement enforcement throughout the backend. Complete all supported non-English translations, including Hindi/Arabic/Hausa, and correct interpolation mismatches identified by the locale audit.

## 48. Consolidated requirements and historical engineering decisions

Earlier release-note appendices are now [archived](docs/archive/PRD-HISTORICAL-RELEASE-NOTES.md). This section collects their cross-cutting contracts; the numbered feature specifications remain authoritative for feature details. Historical Expo build investigations describe a discontinued client and must not be reapplied to Capacitor.

### 48.1 Identity, sessions and trust

- Public SEO paths resolve only live content and non-deleted authors. Preserve shared URLs and cross-platform referral attribution. `/t/<UUID>` remains a legacy Tweet preview; Tales uses distinguishable story slugs beneath `/t/`.
- OAuth uses the platform callback/exchange flow. Android opens OAuth in the system browser so CSRF cookies survive redirects; exchange codes are single-use and bound to the mobile flow. Never expose session credentials in redirect URLs.
- Validate return destinations as same-origin relative paths. Complete onboarding before returning new users to content. Account blocking has a clear reason, expiry where applicable, and an appeal route; an authentication failure must not strand users in a signed-in-looking placeholder shell.
- Silent refresh, absolute session expiry and revocation are distinct. Clear stale cookies/tokens before login navigation and deduplicate profile requests. Permissions are requested when needed; client routing never substitutes for server authorization.
- Identity KYC tiers, account appeals and moderation actions retain server validation, rate limits, audit trails and explicit staff capabilities. Security decisions are not derived from UI role labels.

### 48.2 Money and entitlement integrity

- Credits is the public soft-currency name; legacy internal coin columns are retained. Currency display names are administrator configurable. Credit and Star ledgers remain separate, append-only and transactionally linked to derived balances.
- Verify payment authenticity, amount, currency and ownership. Deduplicate webhook side effects, creator earnings, fund contributions and notifications by event reference, not only by transaction status. Derived balances advance only for newly recorded ledger events.
- Personal and business subscription grace periods, gaming save slots and multi-blog quotas use central configured limits. Validate effective entitlement at the server and preserve explicitly permanent purchases on downgrade.
- Reward pots support create, edit-total and close/refund. Editing cannot reduce funding below payouts already made or reduce maximum claimants below the current count. A second Create must never overwrite an existing active pot or silently change earlier claimants’ share. Closed pots can be funded afresh without accidentally reusing old claim records.
- Wallet history renders valid dates and human descriptions, including game names rather than internal source codes. Large balances remain legible. Creator withdrawal progress uses actual eligible earnings and thresholds.
- Crypto payment intents, wallet management, payment-context settings and creator payouts follow §40. Retired payment-provider integrations are historical, not alternative active flows. Use native store billing where required by the supported Android purchase flow.

### 48.3 Content, discovery and progression

- Answers, the board/thread Forum, Polls, Quizzes, Tweets, Wikis, Blogs, Portals and Home feed remain distinct primitives with shared moderation, discovery and economy utilities. Creator publishing rules, canonical share URLs and private/unpublished state apply to every entry point.
- Daily quest decks are persisted so activity progress can find their membership. Feature gates, plan eligibility, campaign boosts and sponsored quests are checked centrally; clients mirror the same deck and reward state.
- Presence needs an actual heartbeat on both web and Capacitor. Online indicators and recent activity obey the reciprocal privacy contract in §46; older broader visibility notes are superseded.
- Friend-request indicators, recent conversations, clickable profiles, gift browsing, gift messages, personal announcements and group chat management preserve their server-backed state after refresh. Concurrent group capacity/creation limits are enforced atomically.
- Home dashboard sections isolate noncritical failures. Feed tabs, generalized content boosts, sponsored content, native ads and rewarded ads follow their distinct eligibility and tracking contracts. Do not report simulated ad completion as a verified reward.
- Content-creation level gates appear before users invest effort in a disabled editor. Quotas count all specified content types consistently on web/PWA and Capacitor.

### 48.4 Operations, moderation and maintainability

- Current Android development targets `apps/android`, with standard Capacitor scaffolding, safe-area handling, authenticated API response normalization, push allowlists and parity for user/admin workflows. Build, sync, APK packaging and actual device testing are separate evidence.
- Shared Drizzle queries use the configured database pool. Circuit breaking wraps the underlying pool so ORM queries cannot bypass outage protection; legacy adapters must not double-count the same call. Protect optional dashboard aggregates without presenting false financial totals.
- Use the central text/vision AI provider registry and fallback circuits. Image classification has guarded fetches, size/MIME limits, common monitoring, confidence-based escalation and human review. Ads/KYC/story moderation apply their own policy prompts rather than sharing unrelated business rules.
- Staff navigation distinguishes administration, support and moderation. Searchable settings show human names and descriptions. Explicit refresh and bounded local/server caching reduce external-service calls; stale cache cannot override authorization.
- Support tickets and Help Center content have publication/access rules, staff queues, escalation and user notices. English source text and interpolation arguments stay aligned across clients; translated catalog drift is measured and fixed explicitly.
- Vercel Hobby storage/CPU constraints require bounded server bundles, lean function dependencies and reduced polling/request fan-out. Operators may run frequent jobs externally; do not rewrite business expiry rules around the host’s daily-cron limit.
- Keep migration grants, RLS, schema definitions and integration fixtures synchronized. Test actual application TypeScript projects. Record unresolved provider credentials, configuration and device checks accurately; never turn a failed readiness check into a success by disabling validation.

## Current concise changelog — v2.43 (development)

- Added private bookmarks, retained folder entitlements, post discovery, private blog revisions, extra-post bundles, beginner help guides, AI usage accounting, quest progress tips, Tales and the official content studio across web/PWA and Capacitor.
- Fixed wallet dates, challenge escrow/refund atomicity, per-viewer archives, exact timestamp pagination, message polling/scroll state, classroom authorization, session cache privacy, notification URLs, repeated notification events, duplicate blog earnings, reward-pot refills and room reward refunds.
- Added searchable configuration/navigation and shared locale metadata. Hindi and full non-English coverage remain unfinished.
- Validation covers TypeScript, unit and disposable-Postgres integration checks; runtime, APK and external provider validation remain separate. See the implementation ledger for remaining scope.

Future changelogs must be concise, use short subheads or lists, and state the change, reason, important patterns/decisions, validation boundaries and maintainer lessons. Move durable requirements into the relevant specification section. Keep only the latest release changelog in this PRD after historical requirements have been reconciled; Git history retains earlier release notes.
