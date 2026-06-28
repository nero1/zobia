# Zobia Social — Product Requirements Document
### A Gamified Monetised Social Platform for the Global Mobile Generation

> **Version 1.86 — Product Requirements Document**
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
- Plans can be purchased via in-app purchase (Google Pay on Android; Stripe/equivalent on web) or via Paystack (Nigeria web) or DodoPayments (international web).
- Admin can toggle plan availability on or off per region.
- Admin can configure coin-based booster packs, XP boosters, and one-time packs independently of subscription plans.

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
- No phone number or SMS authentication. No SMS anything.
- After onboarding, the user is periodically (but not aggressively) encouraged to add an email address for account recovery and to set a password. Both are optional but surfaced as strongly recommended.
- Users may optionally set a 4-digit PIN to protect login and sensitive operations (payments, payout requests). PIN is not mandatory.
- 2FA defaults to authenticator app (Google Authenticator, Authy, or equivalent). No SMS 2FA.
- The 2FA login flow uses a short-lived `pre_auth` JWT type. After verifying email + password the server issues a `pre_auth` token scoped only to the `/api/auth/2fa/verify` endpoint. All other API routes and app pages reject `pre_auth` tokens, redirecting the browser to `/auth/2fa`. A full-access access token is issued only after successful TOTP verification. TOTP codes are replay-protected with a Redis atomic SET NX keyed by `totp:used:<userId>:<code>` (90-second TTL matching the TOTP window).
- On Android, the JWT is stored in Expo SecureStore. On web, in an HttpOnly cookie.

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
- Accept a "New Member Quest" — a 5-step guided mission: send a message, join a Room, gift someone, add a friend, complete a daily login. Payout on completion: 1,000 Credits + 2,000 XP. Designed to be completable within the first session.

**Step 5 — Guild Discovery (after first 24 hours)**
The user is shown a panel: "Crews near you are recruiting." Three local guilds are surfaced based on city — with tier badges, member count, and war records visible. Joining a Guild is optional but deeply prompted. Guild members earn 5–50% more XP from the same activities.

### Age Verification

- Admin sets the minimum age requirement in the platform manifest (x_manifest). Default is 18 years.
- The onboarding flow collects a full date of birth (year, month, and day). Age is computed using the exact birthday (not year-only), so December-birthday users cannot bypass the gate. Users below the configured minimum age are blocked from proceeding with a clear error message.
- The server enforces the age gate independently using the same exact-date calculation before committing the profile to the database.
- The age gate is lightweight (no ID verification at this stage) but is logged and can be escalated by Trust & Safety if signals suggest misrepresentation.

### CAPTCHA

- Google reCAPTCHA is the default CAPTCHA provider.
- Cloudflare Turnstile is supported as an alternative.
- Admin can toggle which provider is active in the admin panel without a deployment.
- CAPTCHA is applied on web and PWA at registration and on suspicious activity signals. On Android, bot protection is handled at the API level via rate limiting, velocity checks, and trust signals rather than a UI CAPTCHA.

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

**Zobia Moments** — ephemeral messages visible for 24 hours, after which they disappear. Conversational ephemeral content — distinct from Stories (which are profile-level).

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

- Standard group chats support up to 300 members (scaling by plan as per Section 3).
- Group chats earn all members XP for activity.
- Group admins can assign tags — "Study Group", "Crew", "Business" — which affect Room discovery signals.
- Anti-spam rules (no links, phone numbers, or email addresses) apply in group chats unless the posting user is a group admin.

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

XP (Experience Points) is the universal score reflecting a user's total activity and engagement across Zobia. It feeds the main rank progression and the six parallel progression tracks. XP is not a currency — it cannot be spent. It only accumulates as a record of presence.

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

---

## 7. Progression Architecture

### The Six Parallel Tracks

Zobia uses a six-track parallel progression system. Each track measures a fundamentally different type of engagement. No track gates another — they are independent. A user can be a Level 50 Social user and a Level 5 Explorer simultaneously. The profile displays all tracks, creating a multi-dimensional identity that can never be "complete."

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
- All six track levels are preserved (never reset).
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

**Never resets:** All six track levels and XP, Guild tier and war history, Season records and badges, Credits, inventory, friends, Legacy Score, creator subscriptions and revenue history, earned titles, badges, or cosmetics.

### Prestige Rewards

- **Prestige 1:** "Prestige I" profile frame, exclusive "Phoenix" title, 500 bonus Credits.
- **Prestige 3:** "Elder Candidate" marker, 3× XP boost for first 7 days of each new Prestige cycle.
- **Prestige 5:** Council application access, "Veteran Prestige" animated badge.
- **Prestige 10:** Hall of Fame entry, permanent Legacy Score top-100 visibility, custom crest option.

Each Prestige adds a star to the Prestige Badge displayed on the profile avatar.

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
- Assessment quizzes inside ClassRooms award bonus Knowledge Track XP.

**Guild Rooms**
- Available to Platinum-tier Guilds and above. Private to Guild members only.
- Used for war planning, coordination, and social bonding.
- Guild Rooms earn XP for all members who participate in daily Guild Room activity.

### Room Capacity & Soft Presence Caps (v1.7)

Each Room has a **soft concurrent-participant cap** enforced against **live presence** — who is actively viewing the Room right now — rather than persistent membership. Presence is tracked in Redis with a short TTL and a client heartbeat, so a slot frees automatically when a user closes the tab/app or goes idle; there is no "Leave Room" button. The Room creator and moderators always bypass the cap (soft enforcement). When a Room is at capacity, new viewers see a "Room is full" state and are not subscribed to its realtime channel — this is the primary control on realtime fan-out cost.

Per-room-type default caps are admin-configurable via the manifest (`/admin/config`), with sensible defaults (free/tipping = 30, drop = 100, classroom = 150, guild = 100, VIP = 200). A Room creator can spend Credits to **raise their own Room's cap** in fixed steps up to a hard ceiling (all amounts manifest-tunable). Discovery shows a **"Full" badge** on at-capacity rooms and offers an availability filter (All / Available / Full).

### Push, Realtime & Offline (v1.7)

Live delivery uses a configurable realtime provider (Ably by default) on web, PWA, and mobile, with an adaptive poll that backs off to a slow reconcile while the socket is connected and pauses while the app is backgrounded. Backgrounded/offline recipients receive **push notifications** for DMs and group messages, and for Room messages **only when @mentioned**. Each category (DMs, group chats, room mentions) has an independent push toggle in Settings. A persisted local message cache (localStorage on web/PWA, encrypted MMKV on mobile) renders recent messages instantly on open and keeps a usable view offline.

### Room Discovery

The discovery feed surfaces Rooms based on: city proximity, category affinity (from past Room activity and quiz responses), friends-in-room signal, trending score (activity in last 2 hours weighted heavily), and Creator Tier (Verified and Elite creators get discovery boosts). Rooms can be promoted using Credits for native paid discovery. Live availability (a "Full" badge and an availability filter) is also surfaced per the capacity model above.

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
- Purchased with real money via in-app purchase, Paystack (Nigeria), or DodoPayments (international).
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

---

## 13. Guild System

### What a Guild Is

A Guild is a persistent team of up to 50 users who share a collective identity, compete together, build shared resources, and support each other's progression. Guilds are the social backbone of long-term retention. Individual commitment is fragile — social commitment is durable.

### Guild Creation

Creating a Guild costs 500 Credits. The founding user becomes the Guild Captain. They choose a Guild name, crest emoji, description (max 150 characters), city affiliation, and recruitment settings (open, approval required, or invite-only).

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

5. **ClassRoom Enrolment:** One-time enrolment fees for structured courses. Creator receives 80%. ClassRooms scale without marginal cost once built.

6. **Creator Fund:** Platform-level monthly fund seeded from 5% of the prior month's platform advertising revenue on the **1st of each month**. Funds are distributed to eligible creators (Elite tier+) on the **5th of each month**, based on Room engagement score, member growth rate, quest completion rates, and content consistency. During International Women's Month (first week of March), female creators receive a 1.5× boost to their Creator Fund allocation.

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
- Creator card (if creator: Room link, subscriber count, total earnings optionally displayed).
- Public Achievements wall (top lifetime milestones).

### Relationship Types

**Friends** — mutual, confirmed. Both users see each other's DM feed, can gift each other without restrictions, appear in each other's social graph for leaderboard and Nemesis purposes. Friendship generates Social Track XP for both parties.

**Followers** — one-directional. Users can follow any public creator or public profile. Followers receive Broadcast Messages from followed creators. Following does not grant DM access.

### The Nemesis System

Platform-assigned rival updated weekly. Algorithm: within 10% of user's XP on their highest active track, same city preferred, same Guild tier preferred, never a mutual friend.

Displayed on home screen with current score vs user's score on the shared track, the delta, recent activity, and a "Challenge" button (sends a notification opening a 7-day XP sprint between the two users).

Notifications fire when: Nemesis overtakes user, user overtakes Nemesis, Nemesis completes a quest the user has not yet completed.

Users can dismiss a Nemesis assignment to regenerate a new one. Users cannot choose their Nemesis.

### The Platform Council

Monthly, the top 50 users by Legacy Score are invited to join the Platform Council — a user advisory body. Council members receive early feature access (2 weeks before general release), participate in monthly feedback sessions, receive a "Platform Council" badge, and can submit Feature Ideas (top idea per month gets a development commitment).

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

### Public URL Structure — SEO-Friendly Slugs

Public, shareable, crawlable surfaces use short, human-readable, SEO-friendly paths. The same scheme is used by the web app, the PWA and the Expo app (as universal links):

| Surface | URL | Notes |
|---|---|---|
| Public profile | `zobia.org/u/joe` | Addressed by `username` |
| Room | `zobia.org/r/dorcas-cuisine` | Addressed by slug |
| Room (duplicate name) | `zobia.org/r/dorcas-cuisine2` | Numeric suffix, no separator |
| Course / classroom | `zobia.org/c/youtube-monetization-for-beginners` | Classroom-type Rooms |
| Game (upcoming) | `zobia.org/g/tapontap` | Backed by the `games` table |

**Identifier model — UUID is internal, slug is public.** Every Room/game keeps its immutable `uuid` primary key as the internal reference (foreign keys, realtime channels, API calls, internal app navigation `/rooms/<uuid>` all continue to use it). The **slug** is a mutable, human-facing **alias** that resolves to the UUID. Slugs are unique among live records via a partial index; duplicates of the same name get a numeric suffix (`dorcas-cuisine`, `dorcas-cuisine2`, `dorcas-cuisine3`), oldest record keeping the bare slug. Slugs are generated server-side from the display name (`slugify` in `@zobia/shared/utils` + DB dedupe in `apps/web/lib/slug.ts`).

**Backward compatibility (no broken links).** Legacy `/r/<uuid>` links and retired slugs (after a rename, tracked in the `slug_redirects` table) **301-redirect** to the current canonical slug URL rather than 404ing. The sitemap, OpenGraph `canonical`, and `robots.txt` all use the slug path.

**Cross-platform deep linking.** The Expo app registers universal-link screens (`/u/[username]`, `/r/[slug]`, `/c/[slug]`, `/g/[slug]`) that resolve the slug/username to the internal UUID via `GET /api/public/resolve` and forward to the in-app screen. Android App Links (`/.well-known/assetlinks.json`) and iOS Universal Links (`/.well-known/apple-app-site-association`) are configured for the active web domain.

**Domain.** The canonical domain is configured via `NEXT_PUBLIC_APP_URL` (web) and `WEB_BASE_URL` (Expo). It currently points at the Vercel deployment (`zobia.vercel.app`) during development and switches to `zobia.org` once the custom domain is connected — a single env/config change, no code edits.

**Commission-based referrals:** For creator affiliate scenarios, admin can configure a lifetime 5% cash commission on referred users' credit purchases, paid in Credits or cash depending on the admin's payout configuration.

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

**Confetti celebrations:** When a single award exceeds a per-currency admin-configured threshold, a canvas confetti animation also fires. Default thresholds: 100 XP, 50 Credits, 10 Stars.

**Admin controls:**
- Feature on/off toggle in the manifest (default: on)
- Per-currency confetti thresholds (configurable via Admin → Config)
- Admin demo page (Admin → Notifications Demo) with buttons to preview every notification type and simulate quest completion

**Platform coverage:** Web app, PWA, and Expo mobile app (iOS/Android). Implemented via `FloatingNotificationProvider` context.

---

## 17. Monetisation Stack

### Revenue Pillars

**Pillar 1: Subscriptions**
Plus, Pro, and Max plans as detailed in Section 3. Monthly and annual billing.

**Pillar 2: In-App Purchases**
Credit packs (Section 11), Star packs (where admin enables direct Star purchase), Prestige Cosmetic Pack (cosmetic-only prestige aura, does not grant actual Prestige), Guild Boost Pack, Season Starter Pack (available at Season launch only), pay-as-you-go booster packs.

**Pillar 3: Platform Advertising**
- **AdMob (Android/mobile):** Banner ads, interstitial ads, and rewarded video ads. AdMob configuration (App ID, ad unit IDs, banner/interstitial settings) is specified in the x_manifest file. Ads are served only to Free-tier users. Paid users see no ads.
- **Rewarded Ads:** Free-tier users can watch a 30-second ad to earn 10–20 Credits. Daily cap: 5 rewarded ads per user.
- **Branded Rooms:** Companies sponsor a dedicated Room. Appears in discovery with a "Sponsored" tag. Members who join earn a small coin bonus funded by the brand.
- **Sponsored Leaderboard Banners:** Weekly leaderboards carry a single sponsor banner visible to all users viewing that leaderboard.

**Pillar 4: Creator Platform Fees**
20% platform fee on all creator earnings — subscriptions, gifts, quest payments, ClassRoom enrolments, Merch Store sales. As the creator economy grows, this becomes an increasingly significant self-sustaining revenue stream.

**Pillar 5: Business Accounts**
- **Business Starter:** Admin-configurable price (default ₦5,000/month). Verified business badge, broadcast capability, basic analytics.
- **Business Growth:** Admin-configurable price (default ₦15,000/month). All Starter features, Quest Marketplace access, Room promotion credits.
- **Business Enterprise:** Admin-configurable price (default ₦50,000+/month). All Growth features, custom Room theming, API access, dedicated account management.

---

## 18. Payments, Payouts & Financial Integrity

### Inward Payments (Credit Purchases and Subscriptions)

| Platform | Nigeria | Rest of World |
|---|---|---|
| Android App | Google Play Billing only (via react-native-iap) | Google Play Billing only |
| Web / PWA | Paystack (primary) + DodoPayments (admin-toggled option) | DodoPayments |

Google Play Billing is the exclusive in-app purchase mechanism on Android — this is a Google Play Store policy requirement. Paystack and DodoPayments are web/PWA-only and must not be integrated as in-app purchase flows within the Android APK itself.

### Outward Payments (Creator Payouts and Commissions)

| Market | Provider |
|---|---|
| Nigeria | Paystack |
| Rest of World | DodoPayments |

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

### Trust Scores

Every user has a private Trust Score derived from: account age, report rate vs report outcomes, verification status, and payment history. Trust Scores are never shown to users. They silently gate certain high-sensitivity features — for example, a new user cannot immediately create a paid ClassRoom; they need 30 days and a minimum Trust Score.

### Suspended and Banned Users

- Suspended users cannot send or receive DMs during the suspension period.
- Senders receive a generic notice that the recipient's account is temporarily unavailable.
- Suspended users cannot create Rooms, post in public areas, or participate in Guild Wars.
- Temporarily banned users cannot receive Credits, gifts, or payouts during the ban period.
- Permanent bans result in account deactivation. Creator payouts are held and reviewed before release.

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
- Revenue by payment provider (Paystack / DodoPayments / Google Pay split).
- Anomaly alerts: unusual spike in credit purchases, creator payouts, or refund requests.

**User Management**
- Search users by username, email, or ID.
- View user profile, plan, trust score, payment history, report history.
- Suspend, ban (temporary or permanent), or restore users.
- Upgrade users to Moderator role.
- Reset user passwords, force 2FA, manually verify accounts.

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

**Feature Flags**
- Admin can toggle most non-core features on or off without a deployment. Feature flags are stored in the database and read at runtime.
- Examples of flaggable features: Community Notes, Star direct purchase, Nemesis system, Guild Wars, ClassRooms, Business Accounts, AdMob ads, Rewarded ads, Creator Merch Store, Platform Council, Alliance System.

**Configuration (x_manifest / Admin Settings)**
- Minimum age requirement.
- CAPTCHA provider (Google reCAPTCHA default / Cloudflare Turnstile toggle). Admin can switch which is active without a deployment.
- Database provider selection (`supabase` / `railway` / `digitalocean`) — configured via env var at deployment time. Not a runtime toggle (changing this requires a deployment).
- Storage provider selection (`supabase-storage` / `r2` / `s3` / other S3-compatible) — configured via env var.
- Realtime provider (`supabase-realtime` / `ably` / `pusher`) — configured via env var based on database provider.
- PWA enablement per platform: admin can independently enable or disable the PWA for web, Android/mobile, and iOS/Apple. e.g., enable for web only, or enable for all, or disable entirely.
- Payment provider routing (Paystack / DodoPayments for web; Google Play Billing hardcoded for Android).
- AdMob App ID and ad unit IDs (banner, interstitial, rewarded video).
- Payout provider (Paystack for Nigeria, DodoPayments for rest of world).
- Credit-to-cash conversion rate.
- Payout threshold (manual approval trigger).
- Low payout balance alert threshold.
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
- **Inbox on user side:** In-app admin messages appear in a dedicated "Notifications" or "Inbox" section in the user's app, visually distinct from user-to-user DMs (e.g., labelled "From Zobia" or with an admin badge). Users cannot reply to admin broadcast messages.

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
- **Platforms:** Appears in the web app, Android mobile app, and PWA. Rendering adapts appropriately per platform (React Native Modal component on Android; CSS modal on web/PWA).

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
- Currency display derived from user locale (₦ for Nigeria, etc.). Conversion rates from CoinGecko or equivalent where needed (e.g., for cross-border coin pricing display).

### Locale Detection

- Default locale detected from browser/device settings.
- User can override in profile settings.
- Admin can set the platform default locale in admin settings.

### Cultural Calendar

The platform Vitality Calendar incorporates Nigerian, Pan-African, and global cultural moments (Section 25). As new markets are added, new cultural events are added to the calendar without code changes — events are data-driven and admin-manageable.

---

## 22. Technical Architecture & Infrastructure

### Guiding Constraints

- **Zero-cost MVP deployment** on Vercel Hobby Plan (web/admin panel) and Expo EAS Build free tier (APK).
- **Mobile-first native Android APK** built with Expo (React Native). The app must feel fully native — native scroll behavior, native gestures, native transitions. No WebView wrappers. Target Android API Level 35 (Android 15). *(Correction v1.89: previously stated "API Level 36".)*
- **Separate web/PWA** built with Next.js, sharing the same backend API and database as the Expo app but as a distinct frontend codebase.
- **Admin panel** is a Next.js web app deployed on Vercel. Admins use browsers; the admin panel is never included in the APK. The Android app mirrors all admin panel functionality available on web wherever feasible.
- **Database-provider-agnostic**: the platform supports multiple PostgreSQL providers. Switching providers requires only an env var change, not code changes.
- **Auth-system-agnostic**: in non-Supabase mode, Supabase Auth and all Supabase dependencies are completely absent. Auth is handled by the platform's own JWT system backed by the configured database.
- **Offline-friendly**: the app loads without breaking when there is no internet. Elements requiring internet have graceful fallbacks. Local storage and cache maintain reasonable data freshness and integrity.
- **Low-bandwidth optimised**: primary users are in bandwidth-constrained settings (2G/3G). All payloads are compressed. Images are compressed on upload.
- **Modular architecture**: features are independently deployable and toggleable. No monolithic coupling between modules.

### Stack

| Layer | Technology |
|---|---|
| Mobile App (Android APK) | Expo (React Native) — compiles to a real native Android APK via Expo EAS Build (cloud build, no local Android Studio required). UI components render as native Android views, not WebViews. Target Android API Level 35 (Android 15). *(Correction v1.89: previously stated "API Level 36".)* |
| Mobile Navigation & Gestures | Expo Router (file-based routing, close to Next.js App Router patterns) + React Navigation + React Native Reanimated + React Native Gesture Handler |
| Web / PWA | Next.js (App Router) — separate frontend codebase, shares backend API and database |
| Admin Panel | Next.js (App Router) — browser-only, deployed on Vercel, not included in APK. Feature-mirrored on Android app where feasible. |
| Backend (API) | Next.js API Routes + Edge Functions where appropriate, deployed on Vercel. Serves the Expo app, the web/PWA, and the admin panel. |
| Database (see Section 22.1) | PostgreSQL — provider is selected via env var. Supported: Supabase, Railway PostgreSQL (with PgBouncer), DigitalOcean Managed PostgreSQL (with PgBouncer). Adding a new provider requires only a new adapter module. |
| Row Level Security | Applied at the database level (PostgreSQL RLS policies). Works across all supported providers. |
| Connection Pooling | PgBouncer — built into Railway and DigitalOcean managed offerings; Supabase uses its built-in connection pooler. All modes use pooled connections. |
| Auth (see Section 22.2) | Platform-managed JWT auth (not Supabase Auth). Google OAuth + Telegram Login. Same auth available on web, PWA, and Android app. In non-Supabase mode, zero Supabase dependencies. |
| Realtime | Provider-dependent: **Supabase Realtime only when `DATABASE_PROVIDER=supabase`**. When using any other database provider (Railway, DigitalOcean, etc.), Supabase Realtime is completely absent. Non-Supabase modes use **Server-Sent Events (SSE)** with periodic DB polling as the equivalent construct — the backend exposes a `/api/sse/rooms/[roomId]` endpoint that polls the database every 1–3 seconds and pushes updates to connected clients via the EventSource API. The web app uses the browser `EventSource` API; the Expo app uses a simple polling loop via `setInterval` on React Query's `refetchInterval`. This approach requires zero additional infrastructure and works on Vercel serverless functions up to the 30-second response streaming limit. |
| Cache / Sessions | Redis (ioredis native or Upstash — configured via env var) + JWT |
| Object Storage (see Section 22.3) | Provider-dependent: Supabase Storage in Supabase mode; S3-compatible storage in non-Supabase mode. Default S3-compatible recommendation: Cloudflare R2. Selected via env var. |
| Email | Mailgun |
| AI (Primary) | DeepSeek API |
| AI (Fallback) | Google Gemini |
| Payments (Nigeria Web/PWA) | Paystack (primary) + DodoPayments (available as toggle) |
| Payments (International Web/PWA) | DodoPayments |
| Payments (Android In-App) | Google Play Billing only (via react-native-iap). No Paystack or DodoPayments SDK in the Android app for in-app purchases. |
| Advertising (Mobile) | AdMob via `react-native-google-mobile-ads` |
| CAPTCHA | Google reCAPTCHA (default) / Cloudflare Turnstile (toggle). Admin can switch which is active. |
| Deep Links | Expo Linking + Android App Links + iOS Universal Links. SEO-friendly public paths (`/u/<username>`, `/r/<slug>`, `/c/<slug>`, `/g/<slug>`) resolve via `GET /api/public/resolve` to internal UUIDs. Deep links supported for: user profiles, Rooms, courses, games, Guilds, referral links (`?r=` on any page), shared content, and notification tap targets. |
| PWA | Configurable per platform by admin: enable for web only, mobile/Android only, iOS only, or any combination. |
| CRON | Vercel Hobby Plan (once daily, default) + cron-jobs.org (external, for higher frequency) |
| APK Build & Distribution | Expo EAS Build (cloud build, free tier for MVP). Keystore managed via EAS or GitHub secrets for self-managed signing. |
| Hosting (Web/API/Admin) | Vercel (Hobby Plan for MVP, upgrade as needed) |

### 22.0.1 — Mobile (Expo) Build Constraints (must-read before building the APK)

The monorepo deliberately runs **two different React majors** — `apps/web` (Next.js 15)
on `react@18.3.1` and `apps/expo` (React Native 0.74) on `react@18.2.0`, because RN 0.74
has a strict `react@18.2.0` peer. This split has non-obvious consequences that have
repeatedly broken the EAS Android build at the final Metro-bundle step. The full
runbook lives in **`docs/SETUP.md` → "Mobile (Expo) Android APK Build"**; the
non-negotiable rules are:

1. **Single npm lockfile, installed from the repo root.** npm-workspaces only — never
   `npm install` inside `apps/expo`/`apps/web`; never commit a nested `package-lock.json`.
2. **Do not unify the React versions.** The split is intentional; unifying either fails
   `npm install` (RN peer) or causes a dual-React `Invalid hook call` crash.
3. **Keep the explicit `expoRouterBabelPlugin` in `apps/expo/babel.config.js`.** Because
   `expo-router` stays nested under `apps/expo` (it binds `react@18.2.0`), the root-hoisted
   `babel-preset-expo` can't auto-detect it, so the router transform must be applied
   explicitly or the release bundle fails on `EXPO_ROUTER_APP_ROOT` / `require.context`.
4. **AdMob App IDs are configured via `app.config.js`** (a dynamic Expo config that reads
   `ADMOB_APP_ID_ANDROID` and `ADMOB_APP_ID_IOS` environment variables, falling back to
   Google's public test IDs for non-production builds). The `react-native-google-mobile-ads`
   block is merged at build time by `app.config.js`; it must **not** appear as a static key
   in `app.json`. Production App IDs are set via EAS build environment variables.
   `mobileAds().initialize()` runs once at startup via `initializeAds()`.
5. **Target Android API level 35.** *(Correction v1.89: previously stated "API 36". The actual `expo-build-properties` config sets `targetSdkVersion: 35`.)* Builds run via `.github/workflows/build-android.yml` and require the `EXPO_TOKEN` secret (no token ⇒ the APK step is skipped).
6. **Android 15 (API 35) forces full-screen edge-to-edge — handle insets, do not try to opt out.**
   Android 15 (API 35) forces every app targeting API 35+ into edge-to-edge display. The XML opt-out
   attribute `android:windowOptOutEdgeToEdgeEnforcement` cannot be used: it is not present in
   the EAS build image's `android.jar`, causing an AAPT2 build failure. The correct approach is to embrace edge-to-edge
   and handle system-bar insets using `react-native-safe-area-context` throughout the app (wrap all
   screens in `SafeAreaView` or call `useSafeAreaInsets()`). The `plugins/withAndroidEdgeToEdge.js`
   file exists in the repo but is **not registered** in `app.json` and must remain disabled. When
   Expo SDK 52+ support is available on EAS, migrate to the `expo-edge-to-edge` package which
   handles edge-to-edge correctly via the platform's supported APIs.

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

### 22.2 — Auth Architecture

Authentication is handled by the platform's own JWT system, not Supabase Auth. This ensures auth works identically regardless of the database provider.

**Auth providers:**
- Google OAuth (primary).
- Telegram Login (secondary).
- Admin can toggle each on or off independently per deployment.
- The same auth options are available identically on web, PWA, and Android app.

**Auth flow:**
1. User initiates OAuth with Google or Telegram.
2. The backend validates the OAuth callback, creates or retrieves the user record in the configured database, issues a platform JWT and refresh token.
3. The JWT is stored securely: in an HttpOnly cookie on web; in Expo SecureStore on Android.
4. All subsequent API calls present the JWT. The backend validates it against the Redis session store on every privileged request.
5. Refresh tokens are stored in Redis with a sliding window. Session invalidation propagates immediately via Redis key deletion.

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

- JWT + Redis for sessions. JWTs are short-lived (configurable expiry). Refresh tokens are stored in Redis with a sliding window.
- Session invalidation (logout, ban, suspicious activity) is propagated via Redis key deletion — no waiting for JWT expiry.
- Admin sessions have a separate, shorter-lived JWT with stricter validation.

### Connection Pooling

- **Supabase mode:** Built-in PgBouncer via Supabase connection pooler. Enable transaction mode for serverless API routes.
- **Railway mode:** PgBouncer configured as a Railway add-on. Connection string points to the PgBouncer port, not the raw Postgres port.
- **DigitalOcean mode:** DigitalOcean connection pooling enabled in the managed database dashboard. Pool size configured per environment.
- Redis connection pooling via ioredis or Upstash connection management.
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
- Creator Fund: pool seeded on the **1st of each month** from 5% of the prior month's platform advertising revenue; distributed to eligible creators (Elite tier+) on the **5th of each month**.
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
- DodoPayments integration (international web/PWA — credit purchases and subscriptions; also available as Nigeria web option via admin toggle).
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
- Creator Fund data model (seeded from 5% of ad revenue, distributed by engagement score).
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
- Suspension and ban enforcement (DMs, Room posting, coin receipt, payout hold).
- AdMob integration (banner, interstitial, rewarded video ads) — configuration from x_manifest.
- Rewarded ad flow: free-tier users watch ad, earn Credits, daily cap enforced.
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
- Coin purchase flow (Paystack sandbox, DodoPayments sandbox, Google Pay sandbox).
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
  directly and inside the Expo app via a WebView embed (`/g/<slug>/embed`). Write
  once, run everywhere.

### 30.2 Rewards, costs & the Gaming track

- Admin sets, **per game**: credits / XP / stars awarded per win, and an optional
  **play cost** (free, or N credits / N stars to play).
- A **solo "win"** = a new personal best with a positive score (rewards genuine
  improvement, resists farming). Rewards are granted idempotently via the coin/star
  ledgers and `safeAwardXP` on the new **`gaming`** track.
- A new **Gaming progression track** (`xp_gaming` / `level_gaming`) mirrors the six
  existing tracks, with milestone titles/badges (L5 Rookie Gamer, L20 Pro Gamer,
  L50 Game Legend) via the existing `track_milestone_unlocks` engine.
- **Games-played milestones** (admin-configurable thresholds → credits/XP/stars)
  reward cumulative play.

### 30.3 Challenges & wagers

- A user challenges another to a game **best-of-1 or best-of-3** (async score model:
  each plays the same game; higher score wins the round).
- Optional **credit wager**: both stakes are escrowed on accept; the winner takes the
  pot **minus a configurable platform rake** (`game_wager_rake_pct`, default 5%).
  Decline / cancel / expiry refunds both. All movements are idempotent.

### 30.4 Game UX & Discovery

- **Discovery page** (`/games`): New / Popular / Trending tabs, category filter chips,
  Free/Paid filter, card and list view toggle, cursor-based pagination (Load More).
- **Difficulty settings**: Easy / Medium / Hard per play session, persisted to localStorage
  per game, passed to every engine via `GameEngineProps.difficulty`.
- **In-game controls** (via GameRunner): pause/resume button, sound toggle, live score HUD,
  "How to Play" modal (populated from game's `long_description`), "More games" link.
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

- **Per-game high-score** leaderboards (Postgres `game_best_scores` + 60s Redis cache).
- **Gaming-track ranking** via the existing leaderboard snapshots (`track=gaming`).
- **Ads** are admin-togglable via `game_ads_enabled` and `game_ads_directory_enabled`
  manifest flags (no fixed ad slots hardcoded in game pages).

### 30.5 Admin controls

- **Master toggle** `feature_games` (Feature Flags) turns the whole feature on/off.
- **`/admin/games`**: per-game activate/deactivate, edit cover page (name, slug, short
  & long description, emoji, cover image URL, category), reward & play-cost config,
  score cap, min play time, sort order; view per-game stats (plays, players, wins,
  challenges, wager volume); manage games-played milestones.
- Runtime config keys at `/admin/config`: `game_wager_rake_pct`,
  `game_challenge_expiry_hours`, `game_default_reward_credits/xp`.

### 30.6 Adding a new game (dev)

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

## Appendix: Version 1.74 Change Log

### v1.74 — Changelog

- **SQL migration fix (0025):** Dollar-quoted policy blocks in `CREATE POLICY` statements inside `DO $...$` blocks no longer double-escape single quotes — all four affected RLS policies (messages, kyc_submissions, creator_kyc, failed_xp_awards) corrected.
- **Quest deck shuffle (CSPRNG):** Replaced `ORDER BY MD5(JWT_SECRET || id)` with application-layer Fisher-Yates shuffle using `crypto.randomBytes` rejection-sampling, eliminating the MD5 bias and removing the JWT secret from DB queries entirely.
- **Cache headers:** Added correct `Cache-Control` headers to six previously uncached API routes: `/api/games/[slug]/leaderboard`, `/api/config/games`, `/api/config/rewards-ui`, `/api/announcements/banner`, `/api/announcements/modal`, `/api/leaderboards/banner`.
- **Rate-limit cookie clearing:** All rate-limit error paths now clear all session and OAuth cookies before returning the error, preventing stale cookie loops.
- **Games navigation:** Games added as the 4th item in the user sidebar accordion and the desktop header nav; Messages removed from the bottom mobile toolbar and replaced with Games.
- **Google OAuth error UX:** All auth callback error paths (CSRF expiry, invalid state, rate limit, banned/suspended) now redirect to a user-friendly `/auth/error?code=...` page instead of returning raw JSON. All OAuth cookies are cleared on every error path. The `/auth/error` page is public (added to middleware's `PUBLIC_PREFIXES`).
- **Onboarding gate:** JWT `AccessTokenPayload` gains an `onboarding_completed?: boolean` claim. Middleware redirects any authenticated user with `onboarding_completed === false` to `/onboarding` for all app pages not in the allowed-prefixes list.
- **Username "taken" fix:** The onboarding gate ensures users with incomplete Google-auth sign-up cannot bypass onboarding; the auto-generated username is reserved but the onboarding flow allows claiming a new one before completion.
- **PWA install prompt:** New `PWAInstallPrompt` client component added to the app layout. On Android, shows an admin-configured APK download link (from `android_app_url` in the manifest). On iOS/desktop, shows the standard "Add to Home Screen" guide or triggers the `beforeinstallprompt` native dialog. "Not now" suppresses for 7 days; "Already installed/downloaded" suppresses for 90 days. Prompt is skipped inside standalone PWA.
- **Admin gifts catalog:** New admin page `/admin/gifts` with cursor-based pagination for managing all gift items (create, edit, retire/restore). Backed by new admin API routes `GET/POST /api/admin/gifts` and `PATCH/DELETE /api/admin/gifts/:id`. Entry added to admin sidebar nav. User-facing `/gifts` page gains a "Browse gift catalog" link.
- **i18n:** 23 new English keys added for auth error page and PWA install prompt (`authError.*`, `pwa.*`).

---

## Appendix: Version 1.75 Change Log

### v1.75 — Changelog

- **Games Catalog Major Expansion (30 new games, 4 new categories):** Added Sudoku, Word
  Search, Lights Out, Number Match, Nonogram, Pipe Connect, Sliding Blocks, Mahjong Solitaire
  (Puzzle); Whack-a-Mole, Fruit Slicer (Action); Ayo — traditional Nigerian Mancala (Board);
  Platform Jumper, Pixel Runner, Asteroid Dodge (Arcade); Speed Tap, Color Rain (Tap); Quick
  Quiz, True or False, Emoji Quiz, Flag Quiz (Trivia — new); Word Guess, Hangman, Anagram Rush
  (Word); Tic Tac Toe, Connect Four (Casual); Gem Swap, Dots & Boxes (Strategy — new); Penalty
  Kick, Basketball Shot (Sports — new); Beat Tap (Music — new). Total catalog: 57 games.
- **GameCategory type expanded** to include Trivia, Strategy, Sports, Music. GAME_CATEGORIES
  array updated in shared types.
- **User star rating system with play-gate:** Interactive 1–5 star rating widget added to
  GameRunner result screen (after every play) and the `/g/<slug>` cover page (for users who
  have already played). Server-side play-gate enforced at `POST /api/games/<slug>/rate` —
  checks `game_best_scores` table; returns 400 if user has never played. New
  `GET /api/games/<slug>/my-rating` endpoint returns `{ yourRating, hasPlayed }`.
- **Admin games management card/list views:** Admin `/admin/games` page now has a list
  (table, default) + card grid toggle, inline search, and category filter dropdown. All 30
  new engine keys and 4 new categories added to admin selectors.
- **i18n (English):** New strings for Trivia/Strategy/Sports/Music categories, rating UI
  ("Rate this game", "Thanks for rating!", play-gate prompt), and admin view controls.
- **DB migration 0029:** Seeds all 30 new games; idempotent `ON CONFLICT DO NOTHING`.
- **Scalability:** Games list uses cursor-based pagination (offset+cursor keyset) already
  in place, designed for thousands of games. Redis leaderboard cache 60s TTL. Rating
  play-gate is a single indexed lookup on `game_best_scores (game_id, user_id)`.

---

## Appendix: Version 1.73 Change Log

### v1.73 — Changelog

- **Games Catalog Expansion (20 new games, 9 categories):** Added Tap Frenzy, Bubble
  Burst, Reaction Rush, Color Tap (Tap); Flappy Duck, Stack Tower (Arcade); Memory Match,
  Slide Puzzle, Minesweeper, Color Sort (Puzzle); Blackjack, Whot!, Higher or Lower (Card);
  Chess vs AI, Ludo vs AI (Board); Cookie Kingdom, Galaxy Miner (Idle); Word Scramble,
  Simon Says (Word); Rock Paper Scissors (Casual).
- **Game UX:** Difficulty selector (Easy/Medium/Hard) per play session, pause/resume,
  sound toggle, in-game score HUD, "How to Play" modal, "More games" link — all via
  GameRunner (zero per-engine code needed).
- **Sound effects:** All games use Web Audio API synthetic tones (subdued, comforting)
  via `useGameSound` hook. No external files.
- **Game discovery page redesign:** New/Popular/Trending tabs, category chips, Free/Paid
  filter, card and list view, cursor-based pagination.
- **Star ratings (1-5):** `game_ratings` table, `avg_rating` / `rating_count` on `games`,
  POST `/api/games/<slug>/rate`.
- **Play count formatting:** abbreviated display (1.35K, 42.19M, 567.34M) in UI.
- **Public cover page nav:** login/signup for guests, full nav for members.
- **/g/ redirect:** `/g/` root now redirects to `/games/`.
- **Paid games:** `play_cost_credits` / `play_cost_stars` — cost shown only when > 0.
- **Existing game fixes:** Snake (slowed, D-pad added), Star Blaster (collision fixed,
  particle effects), Tetris (side buttons for mobile, ghost piece, grid), Speed Dodge
  (5 lanes, starts slower, narrower cars).
- **Profile page:** Games section added with links to discover, leaderboards, challenges.
- **Admin games page:** Updated with all 26 engine keys and 9 categories.
- **i18n:** English strings added for all new games-related UI.

---

## Appendix: Version 1.72 Change Log

### v1.72 — Changelog

- **Added §30 Games & Gaming Track.** New mini-games arcade across web, PWA and Expo:
  central directory, crawlable `/g/<slug>` cover pages with a login gate for
  non-members, and 6 launch games in 3 categories (Puzzle: Tetris, 2048; Action: Speed
  Dodge, Star Blaster; Arcade: Snake, Brick Buster).
- **Gaming progression track** (`xp_gaming` / `level_gaming`) mirroring the existing six
  tracks, with milestone titles/badges and games-played milestones.
- **User-vs-user challenges** (best-of-1/3, async score model) with optional credit
  **wagers** (escrow on accept; winner takes pot minus configurable rake).
- **Per-game leaderboards** + gaming-track ranking; **ads** wired into game surfaces;
  **referral share links** for games.
- **Admin:** master `feature_games` toggle, `/admin/games` CRUD (cover page, per-game
  rewards, free/paid play cost, stats) and games-played milestone management.
- Modular engine abstraction so adding a new game is a plug-in (registry + engine
  component), reusing all sessions/scoring/leaderboard/challenge/ads infrastructure.

---

## Appendix: Version 1.81 Change Log

### v1.81 — Changelog

Security hardening, reliability improvements, UX/i18n consistency, and build configuration fixes across the Expo mobile app.

#### Security

- **OAuth deep link validation (BUG-SEC-01):** The deep-link handler in `auth/login.tsx` now performs strict origin + pathname validation using `new URL()` instead of a substring match (`url.includes('auth/callback')`). A crafted URL like `https://evil.com/?r=auth/callback` is now correctly rejected.
- **signOut CSRF fix (BUG-SEC-02):** `signOut()` in `lib/auth/context.tsx` now calls `apiClient.post('/auth/logout')` instead of a raw `fetch()`. The raw fetch bypassed the CSRF `Origin` header required by server middleware.
- **Captive portal false-online fix (BUG-SEC-03):** `onlineManager` in `lib/api/client.ts` now checks `state.isInternetReachable !== false` in addition to `state.isConnected`, preventing spurious API calls on hotel/airport Wi-Fi captive portals.
- **JWT in-memory cache (BUG-SEC-04):** A module-level `_cachedToken` variable in `lib/api/client.ts` holds the current access token after the first SecureStore read. All request interceptor calls use the cache and only fall back to SecureStore when the cache is empty. The cache is populated on `signIn`, `restoreSession`, and token refresh; cleared on `signOut`. This eliminates one Android Keystore round-trip per concurrent API request.
- **APP_ENV removed from app.json (BUG-SEC-05):** `"APP_ENV": "development"` has been removed from `app.json` `extra`. Each EAS build profile's `env` block in `eas.json` now sets the correct value (`development`, `preview`, `staging`, `production`), so the build pipeline controls the environment rather than a hardcoded default.
- **OTA runtimeVersion policy (BUG-SEC-07 / BUG-CFG-03):** `"runtimeVersion": { "policy": "fingerprint" }` added to the `expo-updates` plugin config in `app.json`, preventing incompatible JS bundles from being pushed to old native builds. The `fingerprint` policy derives the runtime version from the native layer fingerprint (native modules, config plugins, assets), so OTA updates are only delivered to builds whose native environment exactly matches.

#### Reliability / Data Integrity

- **Cold-start offline queue reset (BUG-REL-01):** `resetSendingMessages()` is now called immediately after `initOfflineDB()` on every cold start in `app/_layout.tsx`, ensuring messages stuck in `sending` state from a previous crash are retried on next launch rather than requiring a connectivity cycle.
- **Daily login XP persistence (BUG-REL-02):** The MMKV `daily_login_last_date` write in `app/(tabs)/index.tsx` is now inside the mutation's `onSuccess` callback rather than pre-mutation. On server error, the key is not written and the mutation retries on the next launch. An `onError` handler logs the failure.
- **Room auto-scroll on entry (BUG-REL-03):** `isAtBottomRef` in `app/rooms/[roomId].tsx` is initialised to `true` (was `false`), so new messages auto-scroll immediately when entering a room.
- **Presence heartbeat gated on membership (BUG-REL-04):** The heartbeat `setInterval` in the room screen now returns early if `!isMember`, preventing spurious 401/403 heartbeat calls for private rooms the user has not joined.
- **Idempotency key field name standardised (BUG-REL-05):** GIF/sticker sends in `app/rooms/[roomId].tsx` now use `idempotencyKey` (camelCase), matching all other send paths. The inconsistent `idempotency_key` (snake_case) field is removed.
- **DM reaction `userReacted` fix (BUG-REL-06):** `mapApiDM()` in `app/messages/[conversationId].tsx` now accepts and uses `currentUserId` to set `userReacted: true` on reactions the current user has applied. Reaction pills now correctly highlight for own reactions.
- **Ad load listener cross-cleanup (BUG-REL-07):** In `lib/ads/admob.ts`, the LOADED callback now calls `unsubscribeError()` before resolving, and the ERROR callback calls `unsubscribeLoaded()` before rejecting, for both `loadRewardedAd()` and `loadInterstitialAd()`.
- **SlugRedirect timeout (BUG-REL-08):** `components/deeplink/SlugRedirect.tsx` now uses an `AbortController` with a 15-second timeout. On abort or unrecoverable error, an error state with a "Go Back" button is rendered instead of an infinite spinner.
- **Cold-start notification routing (BUG-REL-09):** `app/_layout.tsx` now calls `Notifications.getLastNotificationResponseAsync()` on startup. If a notification response is present (app was cold-started from a push tap), it is routed through the same `VALID_PUSH_ROUTES` allowlist handler used for foreground taps.
- **Android keyboard double-offset fix (BUG-REL-10):** `<KeyboardAvoidingView>` in `app/rooms/[roomId].tsx` and `app/messages/[conversationId].tsx` uses `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}`. `softwareKeyboardLayoutMode: "adjustResize"` in `app.json` (Android) ensures the window shrinks when the soft keyboard appears, keeping inverted FlatList input bars visible on Android API 35 with dynamic-height predictive keyboards.
- **Dedup set cap check order (BUG-REL-11):** The `seenIds` pruning in the room message dedup loop now occurs *before* `seenIds.add(id)` (check `size >= 500`), preventing the set from momentarily growing to 501 entries.
- **PIN double-advance race prevention (BUG-REL-12):** `app/settings/pin.tsx` uses an `advancingRef` to ensure `advance()` cannot be called twice within the 150 ms transition window, even when both the hidden `TextInput.onChangeText` and a numpad `Pressable.onPress` fire simultaneously.
- **War countdown timer stops on end (BUG-REL-13):** The countdown `tick()` function in `app/guilds/wars/[warId].tsx` now calls `clearInterval(id)` when `diff <= 0`, preventing indefinite state updates after the war has ended.
- **War query polling stops on end (BUG-REL-14):** `refetchInterval` in the war screen query is now `war?.status === 'ended' ? false : 10_000`, stopping the 10-second polling once the war is over.
- **Tied-score display fix (BUG-REL-15):** `guild1Winning` in the war screen is now `!isTied && guild1.score > guild2.score`. When scores are tied, both are rendered in the neutral text colour rather than highlighting guild 1 as the winner.
- **Settings patch silent failure fixed (BUG-REL-16):** `patchMutation` in `app/settings/index.tsx` now has an `onError` handler that shows an `Alert` with `t('settings.saveFailed')`, making setting save failures visible to the user.
- **Date-of-birth calendrical validation (BUG-REL-17):** After the regex check in the DoB save flow, the date is now validated calendrically via `new Date()` and compared back to the ISO string. Structurally valid but impossible dates (e.g. 2000-13-45) are now rejected.

#### UX / I18N / Consistency

- **Push registration failure no longer blocks app (BUG-UX-01):** The `Alert.alert()` on push token registration failure in `app/_layout.tsx` has been replaced with `console.warn()`. Push failures are non-blocking; the user can retry via Settings.
- **Quests tab migrated to React Query (BUG-UX-02):** `app/(tabs)/quests.tsx` now uses `useQuery` for both daily quests and new-member quest data, enabling stale-while-revalidate, background refetch on tab focus, and pull-to-refresh via `refetch()`.
- **Wallet tab migrated to React Query (BUG-UX-03):** `app/(tabs)/wallet.tsx` now uses `useQuery` with `queryKey: ['wallet', 'summary']`, replacing the manual `useState`/`useEffect` pattern.
- **Settings `/users/me` deduplicated (BUG-UX-04):** `TwoFactorSection` and the DoB pre-fill in `app/settings/index.tsx` now share a single `useQuery` with `queryKey: ['user-me-totp']`, eliminating the duplicate `/users/me` network call.
- **Data export uses file sharing (BUG-UX-05):** `handleExport()` in `app/settings/index.tsx` now writes the JSON to `FileSystem.cacheDirectory` via `expo-file-system` and shares via `Share.shareAsync()` with `mimeType: 'application/json'`. The previous `Share.share({ message: json })` approach failed or truncated on Android for large payloads.
- **`formatPlayingSince` uses active locale (BUG-UX-06):** `app/(tabs)/profile.tsx` now passes `i18n.language` to `formatPlayingSince()` instead of the hardcoded `'en-US'` locale.
- **Profile tab i18n (BUG-UX-07):** "Edit Profile", "Track Levels", "Season History", "No Guild", "No past seasons yet", "My Wallet", "Credit Store", "Creator Dashboard" are now passed through `t()` using the `profile.*` keys added to `lib/i18n/locales/en.json`.
- **Messages tab section headers i18n (BUG-UX-08):** "Direct Messages" and "Group Chats" in `app/(tabs)/messages.tsx` are now `t('messages.directMessages')` and `t('messages.groupChats')`.
- **SwipeDrawer gesture conflict resolved (BUG-UX-09):** The pan gesture in `components/layout/SwipeDrawer.tsx` now sets `.activeOffsetX([5, Infinity]).failOffsetY([-10, 10])`, preventing the drawer from opening when the user is horizontally scrolling child content.
- **PIN brute-force rate limiting (BUG-UX-10):** Both `app/settings/pin.tsx` and `app/economy/store.tsx` now track failed PIN attempts and lock the numpad for 30 seconds after 5 consecutive failures.
- **Reaction endpoints corrected and standardised (BUG-UX-11):** DM reactions now call `POST /messages/dm/{conversationId}/reactions` with `{ messageId, emoji }` in the request body (was incorrectly calling `/messages/dm/{id}/messages/{msgId}/react`). Room reactions now use `POST` (was `PATCH`) to match the server route at `/api/rooms/{roomId}/messages/{messageId}/reactions`.
- **`formatCoins()` uses Decimal.js (BUG-UX-12):** `app/economy/wallet.tsx` now computes M/K coin display values using `new Decimal(amount).div(...)` instead of native float division, eliminating precision risk at large balances.
- **Admin user list guard against double-fetch (BUG-UX-13):** `FlatList.onEndReached` in `app/admin/users.tsx` now checks `!loading && !refreshing` before calling `loadUsers()`, preventing a second page from being fetched while one is already in flight.
- **Typed route objects replace `as never` casts (BUG-UX-14):** Route pushes in `app/(tabs)/guild.tsx` now use typed `{ pathname, params }` objects and static string routes, enabling TypeScript to catch route renames at compile time.
- **Admin financial formatting deterministic (BUG-UX-15):** All numeric metrics in `app/admin/index.tsx` now use `.toLocaleString('en-US')` with an explicit locale, ensuring consistent display across all admin devices regardless of device locale.

#### Build Configuration

- **`googleServicesFile` added to `app.json` (BUG-CFG-02):** `"googleServicesFile": "./google-services.json"` is now present in the `android` block, enabling reliable FCM delivery on Android API 33+.
- **`prefsStore` intent documented (BUG-CFG-04):** The unencrypted MMKV instance in `lib/i18n/index.ts` now has an explicit comment confirming it stores only UI language preference (non-sensitive) and must never be used for user data or auth tokens.

---

## Appendix: Version 1.71 Change Log

### v1.71 — Changelog

#### SEO-Friendly Public URLs + Cross-Platform Referral Attribution

Introduced human-readable, crawlable, shareable public URLs across web, PWA and Expo, plus a working `?r=` referral capture/attribution layer.

- **Public URL scheme:** `/u/<username>` (profiles), `/r/<slug>` (Rooms), `/c/<slug>` (courses/classrooms), `/g/<slug>` (games — upcoming). See "Public URL Structure — SEO-Friendly Slugs".
- **Identifier model:** immutable UUID stays the internal reference; a mutable, unique **slug** is the public alias. Duplicate names get a numeric suffix with no separator (`dorcas-cuisine`, `dorcas-cuisine2`). Slug source of truth: `slugify` in `@zobia/shared/utils` + DB dedupe in `apps/web/lib/slug.ts`.
- **New schema (migration `0012_slugs_and_referrals.sql`):** `rooms.slug` (+ partial unique index, backfilled for existing rooms), new `games` table, new `slug_redirects` table (rename history for 301s).
- **Backward compatible:** legacy `/r/<uuid>` links and retired slugs 301-redirect to the canonical slug. Sitemap, `canonical` tags and `robots.txt` use slug paths.
- **Referral param stays `?r=`** (not `?ref=`/`?utm=`) and now works when attached to ANY public page. Capture is automatic: `ReferralCapture` (web/PWA, cookie + localStorage) and `useReferralCaptureFromLink` (Expo, MMKV); replayed at `/onboarding/complete` then cleared. Previously the web onboarding never sent the captured code — now fixed.
- **Deep linking:** Expo universal-link screens (`/u`, `/r`, `/c`, `/g`) resolve slugs to UUIDs via new `GET /api/public/resolve`. iOS Universal Links (`apple-app-site-association`) added; Android `assetlinks.json` package name corrected to `org.zobia.social`.
- **Domain:** retired `zobia.social`; defaults now point at `zobia.vercel.app`, configurable via `NEXT_PUBLIC_APP_URL` (web) / `WEB_BASE_URL` (Expo), switching to `zobia.org` on custom-domain connection. `robots.txt` is now generated dynamically (`app/robots.ts`).

---

## Appendix: Version 1.6 Change Log

### v1.6 — Changelog

#### 1. Soft Currency Renamed: Coins → Credits

The soft (earned) currency has been renamed from **Coins** to **Credits** across all user-facing surfaces — web app, PWA, and Expo mobile app. All i18n strings in all 8 supported locales have been updated accordingly. Internal database identifiers (`coin_ledger`, `coin_balance`, `coin_to_cash_rate`) are unchanged.

#### 2. Admin-Configurable Currency Display Names

Both currencies now have admin-configurable display names, stored in `x_manifest`:

| Key | Default | Description |
|---|---|---|
| `currency_soft_name_singular` | `Credit` | Singular form of the soft currency |
| `currency_soft_name_plural` | `Credits` | Plural form of the soft currency |
| `currency_premium_name_singular` | `Star` | Singular form of the premium currency |
| `currency_premium_name_plural` | `Stars` | Plural form of the premium currency |

Admins can change these from **Admin → Platform Configuration → Economy**. Changes are reflected within the manifest cache TTL (60 seconds). The `ZobiaManifest` interface exposes these under `manifest.currency.*`. A DB migration (009) seeds the defaults.

#### 3. Authenticated Root Redirect

When a logged-in user visits the root URL (`/` or the bare domain e.g. `zobia.vercel.app`), they are now redirected to `/home` instead of seeing the public marketing landing page. This is enforced in `middleware.ts` — the existing JWT verification is reused; no additional DB call is made.

---

## Appendix: Version 1.80 Change Log

### v1.80 — Changelog

- **PIN verification sends plaintext (BUG-SEC-02 revised):** The store PIN submission now sends `{ pin: plaintext }` directly to the server instead of a client-side SHA-256 hash. Client-side hashing was removed because (a) the server must hash the PIN itself with a server-side salt for security, and (b) the v1.79 implementation exposed the hash over the wire with no additional benefit. Hashing is the server's responsibility.
- **Dynamic AdMob App IDs via `app.config.ts` (BUG-CFG-01):** AdMob App IDs are now driven by `ADMOB_APP_ID_ANDROID` / `ADMOB_APP_ID_IOS` env vars read in `app.config.ts`. Non-production builds fall back to Google's public test IDs. The static `react-native-google-mobile-ads` block has been removed from `app.json`.
- **Star packs purchasable via Google Play Billing (BUG-PAY-01):** `purchaseStars()` function added to `lib/payments/googlePlay.ts` following the same session/resolver/timeout pattern as `purchaseCoins()`. The global purchase listener now forwards `starsGranted` from server verification to the resolver. `store.tsx` routes star-pack purchases through Google Play Billing on Android instead of opening an external URL.
- **Change Password screen (BUG-UI-11):** `/settings/change-password` route is now implemented with a three-field form (current password, new password, confirm). The settings screen "Change Password" row navigates to this screen instead of showing a stub Alert.
- **EAS build channels + OTA targeting (BUG-CFG-02):** `eas.json` now includes `"channel"` fields (`development`, `preview`, `production`) in each build profile, enabling channel-based OTA update targeting via `expo-updates`.
- **DropRoomTimer ESLint/deps fix:** `useEffect` dependency in `DropRoomTimer` now uses `dropEndsAt` as the dependency and computes the initial value inside the effect, eliminating the `react-hooks/exhaustive-deps` warning introduced by the v1.78 timer-leak fix.
- **i18n string added:** `settings.changePasswordSuccess` — "Password changed successfully."

## Appendix: Version 1.79 Change Log

### v1.79 — Changelog

- **GameWebView security hardening (BUG-SEC-01 + BUG-WV-01):** The raw JWT is no longer injected into WebView's JavaScript scope via `injectedJavaScriptBeforeContentLoaded`. Games now communicate with the API via a **postMessage-based proxy**: the game posts `{ type: 'API_REQUEST', requestId, method, endpoint, body }` and the React Native host makes the call using the authenticated `apiClient`, then posts back `{ type: 'API_RESPONSE', requestId, data/error }`. The `originWhitelist` is derived from `API_BASE_URL` at runtime instead of being hardcoded.
- **i18n language preference persistence (BUG-I18N-01):** `resolveLocale()` now checks MMKV (`user_language` key in the `zobia_prefs` store) before falling back to device locale. This is required for Pidgin, which has no standard OS locale code and must be manually selected by the user.
- **Google Play Billing connection cleanup (BUG-PAY-02):** `disconnectGooglePlayBilling()` now clears all in-memory resolver, session, and recovery maps after `endConnection()`, preventing stale callbacks from firing after reconnect.
- **AdMob listener leak fixes (BUG-ADS-01 + BUG-ADS-02):** Interstitial ad failure path now unsubscribes the CLOSED listener before resolving. Rewarded ad EARNED_REWARD/CLOSED race condition fixed with a settle-once pattern and a 150 ms CLOSED delay.
- **PIN security (BUG-SEC-02):** PIN is now SHA-256 hashed (salted with `userId:pin`) via `expo-crypto` on device before being sent to the server.
- **Safe Area tab bar (BUG-UI-01):** Tab bar height and padding now account for Android gesture navigation bottom inset using `useSafeAreaInsets`.
- **Offline message queue (BUG-OFFLINE-01):** Send failure in room chat now queues the message to SQLite via `queueMessage()` so it syncs when connectivity resumes.
- **Home screen fixes:** Toast timer leak fixed with `useRef` cleanup (BUG-MEM-02); MMKV daily-login read guarded against pre-init crash (BUG-CRASH-01); QuestCard and NemesisXPBar progress bars clamped to `flex: 0.005` minimum to prevent flex-zero collapse (BUG-UI-02).
- **SwipeDrawer navigation (BUG-NAV-01/02/03):** Navigation no longer uses a fragile `setTimeout`; `signOut` has error handling; backdrop is always mounted with `pointerEvents` toggled instead of conditionally rendered (eliminates dual-state divergence).
- **Profile non-null crash fix (BUG-CRASH-02):** `friendMutation` and `followMutation` in `profile/[userId].tsx` guard against `profile` being undefined instead of using `!` non-null assertions.
- **Subscription API shape fix (BUG-API-01):** `fetchMe()` in subscription screen now handles `{ user: {} }`, `{ data: {} }`, and flat `{}` response shapes.
- **Wallet theme hook (BUG-THEME-01):** `wallet.tsx` now uses `useTheme()` instead of `useColorScheme()` to respect app-level theme overrides.
- **CI auth gate fix (BUG-CI-01):** `continue-on-error: true` removed from EAS credentials step so build failures surface properly.
- **Duplicate contacts fix (BUG-MINOR-02):** Phone numbers are deduplicated with `new Set()` before cross-referencing.
- **Idempotency key dedup (BUG-MINOR-01):** Redundant `_${Date.now()}` suffix removed from offline message `idempotencyKey`.
- **Duplicate capacity handler refactor (BUG-DUP-01):** Room "Increase Capacity" logic extracted into a single `handleIncreaseCapacity` `useCallback`; the duplicated `.then`/`.catch` chain in Room Powers is replaced with a single call.
- **CountdownTimer null guard (BUG-CHAT-04):** CountdownTimer only renders when `room.dropEndsAt` is set.
- **i18n string added:** `offline.queued` — "Message saved — will send when you're back online."

## Appendix: Version 1.78 Change Log

### v1.78 — Changelog

- **Pidgin added as a supported language:** Pidgin is now listed as a ninth launch language. The `isPidginLocale` helper and `getPidginSuggestions` now match both `'pcm'` and `'pidgin'` locale codes, and the settings screen language picker includes Pidgin as a selectable option.
- **Bug fixes (31 code-fixable issues):** Critical auth/session-expiry fixes (signOut clears session-expired flag; handleLogout/handleConfirmDelete now call signIn correctly); theme preference persisted synchronously via a dedicated unencrypted MMKV instance; SQLite encryption-key promise cache cleared on rejection; Google Play Billing reconnects on app foreground and initialises before purchase; push-notification route allowlist extended to cover group messages and guild chat; broadcast messages now render in MessageBubble; pending-message deduplication is content-based; KeyboardAvoidingView behaviour corrected per platform; floating notification timers cleaned up on unmount; gift spectacle detection moved from React Query `select` to a pure `useEffect`; wallet date formatting passes active locale; AppState token-refresh listener uses ref to avoid stale closure; several minor type-safety, comment, and i18n improvements.
- **Remaining external items (not fixable in code):** BUG-CRIT-04 (AdMob production IDs — requires AdMob account), BUG-MED-21 (iOS AASA deployment), BUG-LOW-23 (Telegram bot name — requires BotFather verification).

---

## Appendix: Version 1.83 Change Log

### v1.83 — Changelog

Bug fixes and security hardening across the Expo mobile app. All 28 bugs from the forensic audit (custom-bugs-report.md) resolved.

#### Critical Fixes

- **C-1 — `displayName` missing from token refresh user object:** `refreshAccessToken()` in `lib/api/client.ts` now includes `displayName` (coalescing `me.displayName ?? me.display_name`) in the `updatedUser` object written to SecureStore and broadcast via `notifyUserUpdated()`. Previously, any token rotation silently stripped `displayName` from the in-memory user, causing profile display regressions.
- **C-2 — Undefined `total` in admin payouts screen:** `AdminPayoutsScreen` in `app/admin/payouts.tsx` now declares a `total` state variable (initially 0, updated from `data.total ?? payouts.length` on each page load) so the `ListHeaderComponent` renders the payout count without crashing.
- **C-3 — MMKV `authToken` always undefined in admin refunds:** Both `loadRefunds()` and `handleIssueRefund()` in `app/admin/refunds.tsx` now use `apiClient.get()` / `apiClient.post()` (which reads the JWT from SecureStore via its request interceptor) instead of `storage.getString('authToken')` (which always returned undefined). All admin API calls are now authenticated.
- **C-4 — Cold-start notification navigates before nav tree exists:** `getLastNotificationResponseAsync()` result is now stored in a `pendingNotifAction` ref instead of calling `router.push()` immediately. A new effect keyed on `(!isLoading && storeReady && user)` fires the navigation once the nav tree is mounted and the session is confirmed.

#### High-Priority Fixes

- **H-2 — Deprecated Play Billing subscription upgrade API:** `purchaseSubscription()` in `lib/payments/googlePlay.ts` now uses `subscriptionReplacementInfo: { oldPurchaseToken, prorationMode }` (Play Billing v5+) instead of the removed `replaceSku` / `prorationMode` root fields. Purchase tokens for active subscriptions are persisted to MMKV (`STORE_KEYS.ACTIVE_SUB_TOKENS`) on successful verification. A new exported `getActiveSubscriptionToken(productId)` helper allows callers to supply the old token for upgrades.
- **H-3 — AdMob ad unit IDs missing from production EAS build:** `eas.json` production profile now includes `EXPO_PUBLIC_ADMOB_REWARDED_ANDROID`, `EXPO_PUBLIC_ADMOB_BANNER_ANDROID`, and `EXPO_PUBLIC_ADMOB_INTERSTITIAL_ANDROID` env vars alongside the existing App ID vars.
- **H-4 — `apiFetch` reads SecureStore on every call instead of in-memory cache:** `apiFetch.ts` now imports and uses `getCachedToken()` (new export from `lib/api/client.ts`) for the Authorization header instead of `SecureStore.getItemAsync()`. A 401 response now triggers a single silent token refresh (via `refreshAccessToken()`) and retries the request, matching the behaviour of the Axios interceptor.
- **H-5 — Stale `setUser(parsedUser)` overwrites fresh user after token refresh:** After a successful token refresh at app restore, `AuthProvider` now re-reads the user from SecureStore (which `refreshAccessToken()` has already updated with the fresh `/users/me` profile) instead of calling `setUser(parsedUser)` with the pre-refresh stale object.

#### Medium-Priority Fixes

- **M-1 — Ably client leaked when error thrown after connect:** `useRealtimeChannel.ts` now tracks the Ably client reference in an outer `ablyClient` variable. The catch block calls `ablyClient.close()` when the client was created before the error, preventing WebSocket leaks.
- **M-2 — TOTP attempt count resets on app restart:** `TwoFactorScreen` now reads/writes `STORE_KEYS.TOTP_ATTEMPTS` and `STORE_KEYS.TOTP_LOCKED_UNTIL` to MMKV. Lockout state is restored on mount, and a 15-minute lockout is persisted on 5th failure.
- **M-3/M-10 — Notification listener fires for logged-out users:** A `userRef` is now maintained alongside `isLoadingRef` in `_layout.tsx`. The notification response listener guards on `!userRef.current` in addition to `isLoadingRef.current`, preventing routing to protected screens when the session has expired.
- **M-4 — Gift-send PIN lockout resets on app restart:** `gift-send.tsx` now reads/writes `STORE_KEYS.GIFT_PIN_ATTEMPTS` and `STORE_KEYS.GIFT_PIN_LOCKED_UNTIL` to MMKV. 15-minute lockout is enforced and survives restarts.
- **M-5 — Creator payout PIN lockout resets on app restart:** `creator/dashboard.tsx` now reads/writes `STORE_KEYS.PAYOUT_PIN_ATTEMPTS` and `STORE_KEYS.PAYOUT_PIN_LOCKED_UNTIL` to MMKV. Same 15-minute lockout pattern as M-4.
- **M-6 — Date of birth transmitted as URL params (PII exposure):** Onboarding step 1 (`app/onboarding/index.tsx`) now writes `{ birthYear, birthMonth, birthDay }` to `STORE_KEYS.ONBOARDING_DRAFT` in MMKV and omits these fields from the route params. `vibe-quiz.tsx` type declaration updated to remove DOB fields. `welcome-drop.tsx` reads DOB from MMKV draft and clears it after successful `/onboarding/complete`.
- **M-7 — Chat message cache grows unboundedly:** `lib/chat/messageCache.ts` now maintains a `STORE_KEYS.CHAT_CACHE_INDEX` list (max 50 entries). When the cap is exceeded, the oldest conversation's cache entry is evicted via `removeItem()`.
- **M-8 — Admin financial screen swallows load errors silently:** `app/admin/financial.tsx` now has a `loadError` state. When both API calls fail, an error message with a Retry button is shown instead of an empty screen.
- **M-9 — Store PIN lockout resets to same window on each lockout:** `app/economy/store.tsx` now tracks `PIN_LOCKOUT_COUNT` in MMKV. Each successive lockout doubles the window (30s → 60s → 120s … capped at 30 min), instead of always 30s. Count resets to 0 on successful PIN verification.

#### Low-Priority Fixes

- **L-1 — Set eviction in room screen evicts only one entry per batch:** The spectacle dedup Set eviction in `app/rooms/[roomId].tsx` now removes all excess entries in a single pass (`toRemove = size - 499`) so a large message batch cannot temporarily inflate the Set beyond the intended cap.
- **L-2 — `LANGUAGE_PREF` not in STORE_KEYS registry:** `STORE_KEYS.LANGUAGE_PREF` added so future code can reference this key without risk of typos.
- **L-5 — Birth year validation allows current year:** `validateBirthYear()` in `onboarding/index.tsx` now caps at `currentYear - MINIMUM_AGE` instead of `currentYear`, preventing a user who hasn't turned 18 yet this calendar year from passing the year-only check.
- **L-6 — Non-NGN currency uses imprecise `toLocaleString`:** `formatKobo()` in `store.tsx` now uses `.toFixed(2)` for the major-unit conversion for non-NGN currencies, eliminating floating-point representation errors.
- **L-7 — Contacts upload is fire-and-forget with premature `done` status:** `handleFindFriends()` in `onboarding/index.tsx` now awaits the `apiClient.post()` call before setting `contactsStatus('done')`. API errors are still swallowed so the flow is non-blocking, but the status now accurately reflects completion.
- **L-8 — No warning when EAS `projectId` is absent:** `registerForPushNotifications()` in `_layout.tsx` now logs a `console.warn` when `Constants.expoConfig?.extra?.eas?.projectId` is undefined, making misconfigured staging builds easier to diagnose.

#### Store Keys Added

`STORE_KEYS` in `lib/offline/store.ts` gains: `ONBOARDING_DRAFT`, `TOTP_ATTEMPTS`, `TOTP_LOCKED_UNTIL`, `GIFT_PIN_ATTEMPTS`, `GIFT_PIN_LOCKED_UNTIL`, `PAYOUT_PIN_ATTEMPTS`, `PAYOUT_PIN_LOCKED_UNTIL`, `CHAT_CACHE_INDEX`, `LANGUAGE_PREF`, `ACTIVE_SUB_TOKENS`, `PIN_LOCKOUT_COUNT`.

#### Remaining External Items (not fixable in code)

- **H-1 (Android App Links SHA256):** `apps/web/public/.well-known/assetlinks.json` contains a placeholder `REPLACE_WITH_YOUR_APP_SIGNING_CERT_SHA256`. The correct fingerprint must be obtained from Play Console (Setup → App integrity → App signing → SHA-256 certificate fingerprint) and substituted before App Links verification will work on Android 12+.

---

## Appendix: Version 1.84 Change Log

### v1.84 — Changelog

Security hardening, UX improvements, and architectural cleanup across the Expo mobile app (25 issues from the second forensic audit resolved).

#### Security Fixes

- **SEC-01/HARD-04 — EAS Project ID hardcoded in `eas.json`:** All four build profiles (development, preview, staging, production) now read the project ID from the `$EAS_PROJECT_ID` environment variable instead of a hardcoded string. Push notifications now work correctly across all EAS build environments.
- **SEC-02 — Email change exposed inline in settings (PII):** A dedicated `/settings/change-email` screen is now implemented with fields for current password, new email, and confirm email. The settings screen "Change Email" row navigates to this screen. The current email is no longer displayed inline as editable text on the main settings screen. Calls `POST /auth/change-email`.
- **SEC-03 — AdMob always requests personalised ads regardless of consent:** `lib/ads/admob.ts` now tracks a `_personalizedAdsEnabled` flag. After UMP consent resolves, the flag is set to `true` only when status is `NOT_REQUIRED` or `OBTAINED`. All ad load calls pass `requestNonPersonalizedAdsOnly: !_personalizedAdsEnabled`, ensuring GDPR/CCPA compliance.
- **SEC-04 — No GIF URL validation (SSRF/content injection risk):** `lib/utils/mediaUrl.ts` introduces `isTrustedGifUrl(url)`, which validates GIF URLs against an allowlist of trusted CDN hostnames (`giphy.com`, `media.giphy.com`, `tenor.com`, `media.tenor.com`, `c.tenor.com`) and enforces `https:`. GIF messages in rooms and DMs now call `isTrustedGifUrl` before sending; untrusted URLs are blocked client-side.
- **SEC-05 — GameWebView origin validation uses first-navigation URL instead of current URL:** `components/games/GameWebView.tsx` now derives `gameOrigin` from a `currentUrlRef` that tracks the active page URL via `onNavigationStateChange`. The `originWhitelist` is rebuilt on each navigation, preventing a compromised redirect from injecting messages under the original game's origin.
- **SEC-06 — PIN lockout keys not in STORE_KEYS registry (cleared on sign-out):** `STORE_KEYS.SETTINGS_PIN_ATTEMPTS`, `SETTINGS_PIN_LOCKED_UNTIL`, `SETTINGS_PIN_LOCKOUT_COUNT`, `TOTP_LOCKOUT_COUNT`, and `GIFT_PIN_LOCKOUT_COUNT` added to the STORE_KEYS registry in `lib/offline/store.ts`. All PIN and TOTP lockout state is now named via the registry, ensuring it is cleared on sign-out.

#### Bug Fixes

- **BF-01 — TOTP lockout does not use exponential backoff:** `app/auth/two-factor.tsx` now implements exponential backoff for TOTP lockouts: 15 min → 30 min → 1 h → 2 h → 4 h → 8 h → 24 h (max). A `TOTP_LOCKOUT_COUNT` counter persisted to MMKV tracks successive lockouts. The count resets to 0 on successful verification.
- **BF-03 — Settings PIN lockout window is only 1 minute:** The PIN lockout window in `app/settings/pin.tsx` has been increased from 1 minute to 15 minutes (`PIN_LOCKOUT_MS = 15 * 60_000`), matching the lockout duration used by gift-send and creator payout flows.

#### UX Improvements

- **UX-01 — Notification rows are not tappable:** `app/notifications/index.tsx` now wraps each `NotifRow` in a `Pressable`. A `getNotificationRoute()` helper maps notification type + payload to the appropriate in-app route (DM → `/messages/:id`, guild war → `/guilds/:id`, gift → wallet, etc.). Tapping a notification also marks it read via a `POST /notifications/:id/read` API call.
- **UX-02/HARD-03 — TOTP screen shows no countdown and does not auto-unlock:** A `remainingSeconds` state and a `useEffect` with a 1-second `setInterval` have been added to `app/auth/two-factor.tsx`. The lockout message now displays a live countdown. When the timer reaches zero the lockout state is cleared automatically and the input is re-enabled.
- **UX-03 — Change-password button renders "undefined" label:** The `Button` component in `app/settings/change-password.tsx` now uses the `label` prop (correct) instead of the non-existent `title` prop.
- **UX-04 — Contacts upload status has no error state:** `app/onboarding/index.tsx` now has a distinct `'error'` contacts status (separate from `'unavailable'`). Upload failures set status to `'error'` and display an error banner; permission denials remain `'unavailable'`.
- **UX-05 — Dead `enter_remove` PIN step causes unreachable state:** The `enter_remove` step and its associated `removePin` state variable have been removed from `app/settings/pin.tsx`. The hidden-input `onChangeText` setter ternary no longer references the removed `setRemovePin` function.
- **UX-06 — Welcome-drop submit retries indefinitely on server error:** `app/onboarding/welcome-drop.tsx` now handles error responses by status class: 409 Conflict → mark onboarding complete and navigate away (no loop); other 4xx → mark complete and let server reconcile; 5xx/network → show error banner and allow retry.
- **UX-07 — Notification toggle patches entire settings object:** The notification-preference toggle in `app/settings/index.tsx` now sends a diff-only PATCH (only the changed key) instead of re-sending all notification fields. This prevents stale data overwrites when multiple toggles are changed in rapid succession.

#### Architecture & Performance

- **ARCH-01 — PIN rate-limiting logic duplicated across three screens:** `lib/hooks/usePinRateLimit.ts` is a new shared hook that implements exponential-backoff PIN rate limiting. Accepts MMKV key names for attempts, lockout timestamp, and lockout count. Used by settings PIN, gift-send PIN, and creator payout PIN screens.
- **ARCH-02 — `/users/me` query key inconsistent across screens:** The React Query key for the current user has been normalised to `['user-me']` in `app/settings/index.tsx`. All screens sharing this query now see the same cached data.
- **ARCH-03 — GameWebView has no message rate limiting:** `components/games/GameWebView.tsx` now enforces a 30-message-per-second rate limit. A counter resets every second; when the limit is exceeded, a 5-second penalty window is applied and subsequent messages from the game are dropped until the window expires.

#### Data Integrity

- **DATA-01 — `currentTier` missing from `useCallback` dependency array:** The subscription-upgrade callback in `app/settings/subscription.tsx` now includes `currentTier` in its `useCallback` dependency array, preventing stale-closure upgrades.
- **DATA-03 — Contacts uploaded in one request (payload size risk):** `app/onboarding/index.tsx` now chunks the contacts array into batches of 500 before uploading. Each batch is sent sequentially via `POST /contacts/sync`, preventing request-size errors for users with large address books.

#### Financial / Currency

- **FIN-01 — Non-NGN subscription price display:** `app/settings/subscription.tsx` now reads the user's locale currency from the manifest and formats non-NGN prices using the correct symbol and decimal format rather than defaulting to ₦.
- **FIN-02 — Minor-unit helpers coupled to Naira:** `lib/utils/currency.ts` now exports currency-agnostic `minorUnitToStr(amount, symbol, divisor)`, `minorUnitToDecimal(amount, divisor)`, and `minorUnitToInt(amount, divisor)`. The existing `koboToNairaStr`, `koboToDecimal`, and `koboToNairaInt` functions are retained as backward-compatible aliases.

#### Performance

- **PERF-02 — App manifest fetched twice (settings + currency hook):** `lib/hooks/useManifest.ts` is a new shared hook that exports `useManifest()` and `useFeatureFlags()` under the single query key `['manifest']`. The settings screen and currency hook now both consume this shared hook, eliminating the duplicate network request.
- **PERF-03 — `Image` from `react-native` used for GIF rendering:** The room screen (`app/rooms/[roomId].tsx`) now imports `Image` from `expo-image`, which has native GIF decoding and better memory management. The DM screen already used `expo-image`.

#### Internationalisation

- **MISC-01 — RTL layout not reapplied when language changes at runtime:** `lib/i18n/index.ts` now subscribes to `i18n.on('languageChanged')`. When the new language requires a different text direction, `I18nManager.forceRTL()` is called and `Updates.reloadAsync()` reloads the JS bundle so React Native rebuilds the native layout tree in the correct direction.

#### New i18n Strings (en.json)

- `settings.changeEmail` — "Change Email"
- `settings.changeEmailDescription` — "Update your account email address"
- `settings.changeEmailSuccess` — "Email updated. Please verify your new email address."
- `settings.newEmail` — "New Email Address"
- `settings.confirmNewEmail` — "Confirm New Email"
- `settings.sendVerification` — "Send Verification"
- `settings.emailReadOnly` — "Email address cannot be edited here"
- `validation.emailMatch` — "Email addresses do not match."
- `validation.invalidEmail` — "Please enter a valid email address."
- `auth.twoFaVerify.countdownPrefix` — "Try again in"
- `onboarding.contactsError` — "Could not upload contacts. You can continue."

#### New Store Keys Added

`STORE_KEYS` in `lib/offline/store.ts` gains: `SETTINGS_PIN_ATTEMPTS`, `SETTINGS_PIN_LOCKED_UNTIL`, `SETTINGS_PIN_LOCKOUT_COUNT`, `TOTP_LOCKOUT_COUNT`, `GIFT_PIN_LOCKOUT_COUNT`.

---

## Appendix: Version 1.85 Change Log

### v1.85 — Changelog

Comprehensive forensic-audit bug fix pass (55 issues identified; 54 resolved, 1 skipped — see below). Covers the Expo mobile app across security, reliability, performance, correctness, and accessibility dimensions.

#### Critical / High

- **Stars transaction history endpoint (Bug 1):** `app/economy/wallet.tsx` stars tab now calls `/economy/stars/transactions` instead of the balance endpoint, restoring the history list.
- **Duplicate PIN verification logic (Bug 2):** `app/economy/store.tsx` now has a single `verifyPin()` callback replacing the two previously-divergent PIN code paths (auto-submit on 4 digits, manual submit button).
- **`endBillingConnection` stale promise (Bug 4):** `lib/payments/googlePlay.ts` clears `_initPromise = null` alongside `initialised = false` so a subsequent `initGooglePlayBilling()` call gets a fresh promise, not a stale resolved one.
- **`pendingRecovery` lost on restart (Bug 34):** `pendingRecovery` Map is now persisted to SecureStore (key `PENDING_RECOVERY`) with a 72-hour expiry timestamp per entry, and loaded back on `initGooglePlayBilling`. Unacknowledged IAP purchases survive app restarts.
- **`SlugRedirect` infinite re-resolve loop (Bug 23):** `toInternalPath` prop is stored in a ref and excluded from the `useEffect` dependency array, preventing infinite `/public/resolve` calls when callers pass inline arrow functions.
- **Gift-send zero stars balance (Bug 27):** Gift-send screen now parallel-fetches both `/economy/coins/balance` and `/economy/stars/balance` so the stars field is populated correctly.

#### Medium

- **EAS Project ID placeholder in production builds (Bug 5):** `app.config.ts` now throws on missing `EAS_PROJECT_ID` when `APP_VARIANT === 'production'`, falling back to `'dev-placeholder'` in non-production builds only.
- **Non-NGN floating-point currency (Bug 3):** All non-NGN minor-unit → major-unit conversions in `app/economy/store.tsx` now use `new Decimal(kobo).div(100).toFixed(2)`.
- **Duplicate session-expired modal (Bug 11):** `_notifiedUnauthenticated` flag in `lib/api/client.ts` no longer resets via a 5-second `setTimeout`. A new `resetUnauthenticatedFlag()` export is called from auth context on explicit sign-in, ensuring exactly one session-expiry modal per logout cycle.
- **`myUserId` empty-string own-message rendering (Bug 9):** `app/messages/[conversationId].tsx` guards against rendering before auth is ready; `myUserIdOrEmpty` is now correctly defaulted.
- **GameWebView postMessage origin (Bug 22):** Injected JavaScript wraps each postMessage with a `{ __origin, __data }` envelope; the React Native handler validates `__origin` before processing, replacing the page-URL-based check.
- **GameWebView navigation block (Bug 48):** `onShouldStartLoadWithRequest` now intercepts navigation at the request level instead of the `onNavigationStateChange` + `stopLoading()` approach.
- **Notification mark-read optimistic update (Bug 24):** `markReadMutation` in `app/notifications/index.tsx` uses `cancelQueries` + `setQueryData` for optimistic update and rolls back on error, instead of fire-and-forget.
- **Notification route path for gifts (Bug 25):** Gift/gift_received notifications now route to `'/(tabs)/wallet'` (correct) instead of `'/(tabs)/economy/wallet'`.
- **Notification route UUID sanitisation (Bug 55):** All payload IDs are validated against a UUID regex before route string construction in `getNotificationRoute`.
- **Notification pagination (Bug 38):** `app/notifications/index.tsx` migrated to `useInfiniteQuery` with cursor pagination; FlatList triggers `fetchNextPage` via `onEndReached`.
- **Friend toggle API path (Bug 26):** `app/profile/[userId].tsx` now calls `POST /friends` with `{ targetUserId }` body, matching the `ContactsImporter` pattern.
- **Notification toggle debounce (Bug 28):** `app/settings/index.tsx` debounces notification preference PATCH calls 400 ms via `notifDebounceRef`.
- **Delete-account PIN error feedback (Bug 29):** Invalid PIN format on account deletion now sets a visible `deletePinError` state instead of silently returning.
- **DOB keyboard type (Bug 30):** Date-of-birth field uses `keyboardType="numeric"` (was `numbers-and-punctuation`, unreliable on Android).
- **RTL reload before save confirmation (Bug 53):** `I18nManager.forceRTL()` and `Updates.reloadAsync()` are now called inside `patchMutation.onSuccess`, so the RTL reload only fires when the server confirms the language save.
- **TOTP MMKV read during render (Bug 32):** Lockout state in `app/auth/two-factor.tsx` is now read in a deferred `useEffect` guarded by `lockoutInitialized`, preventing synchronous MMKV access during the initial render.
- **Presence heartbeat continues when backgrounded (Bug 35):** Heartbeat interval in `app/rooms/[roomId].tsx` is now managed by `useFocusEffect` so it stops when the screen is out of focus.
- **Gift balance not re-verified after PIN delay (Bug 40):** Gift-send screen invalidates and re-checks the balance query after the PIN modal resolves before firing `sendMutation`.
- **Gift PIN flat lockout (Bugs 45, 46):** Gift-send PIN lockout now uses exponential backoff (15 min × 2^n, capped at 24 h) using the previously-unused `STORE_KEYS.GIFT_PIN_LOCKOUT_COUNT`.
- **Contacts importer re-import duplicates (Bug 49):** `ContactsImporter` tracks a `hasImported` flag and disables the button after first import to prevent duplicate friend requests.
- **Android keyboard / inverted FlatList (Bug 41):** `app.json` sets `softwareKeyboardLayoutMode: "adjustResize"` for Android, ensuring the viewport shrinks on keyboard open and the message input remains visible on API 35 devices.
- **Ad reward server-side cap (Bug 52):** `RewardedAdButton` now handles `429` from `/economy/rewards/ad-reward` by syncing the local MMKV cap to `AD_DAILY_CAP`. The server endpoint must independently enforce the cap per user per day (Redis counter with UTC-midnight TTL) — the client-side MMKV cap is a UX hint only.

#### Low / Accessibility

- **MMKV LRU eviction order (Bug 8):** `lib/chat/messageCache.ts` removes the existing index entry before re-inserting to maintain correct LRU order.
- **Telegram bot name in dev/preview (Bug 13):** `EXPO_PUBLIC_TELEGRAM_BOT_NAME` added to `development` and `preview` EAS profiles.
- **PIN_MAX_ATTEMPTS constant exported (Bug 15):** `lib/hooks/usePinRateLimit.ts` exports `PIN_MAX_ATTEMPTS = 5`; `store.tsx` no longer defines a local copy.
- **Pidgin autocomplete endsWith (Bug 19):** `lower.endsWith(key)` clause removed from `getPidginSuggestions`; only prefix-match is used.
- **Announcement dismiss key collision (Bug 20):** `getSessionKey` now incorporates `modal.id + (modal.version ?? 'v1')`, eliminating collisions from shared content prefixes.
- **RTL reload guard in dev builds (Bug 14):** `Updates.reloadAsync()` in `lib/i18n/index.ts` is wrapped in `Updates.isEnabled` (the correct expo-updates SDK ~0.25.0 / SDK 51 API; `isAvailable` does not exist in this version) and falls back to an informational `Alert` in dev.
- **`__DEV__` guard for push route warnings (Bug 12):** Invalid push route logging is now gated behind `__DEV__` to avoid noise in production.
- **MMKV storage proxy deprecation (Bug 33):** `storage` direct-proxy export in `lib/offline/store.ts` is annotated `@deprecated`.
- **O(n) message ID eviction (Bug 10):** `prevMessageIdsRef` in `app/rooms/[roomId].tsx` is now a `Map<string, true>` allowing O(1) oldest-entry eviction via `map.keys().next().value`.
- **Binary search for delta merge (Bug 43):** `mergeNewestFirst` in `lib/chat/delta.ts` uses binary search insertion instead of O(n log n) full resort.
- **OfflineBanner cold-start state (Bug 44):** `NetInfo.fetch()` is called at mount to immediately reflect offline state before the async event listener fires.
- **OfflineBanner null reachability comment (Bug 50):** Strict `=== false` check is documented to clarify that `null` (unknown state) is treated as connected.
- **SwipeDrawer state desync (Bug 36):** `setIsOpen` in `components/layout/SwipeDrawer.tsx` is now called only in the `withSpring` completion callback when `finished === true`, preventing desync between Reanimated shared value and React state.
- **TOTP duplicated lockout logic (Bug 51):** `handleFailedAttempt` extracted from two catch blocks in `app/auth/two-factor.tsx`.
- **`accessibilityHint` on RewardedAdButton (Bug 16 partial):** Main `TouchableOpacity` now has `accessibilityHint`.
- **FlatList `accessibilityLabel` (Bug 47):** Room messages, DM conversation, and notification list FlatLists now have descriptive `accessibilityLabel` props for TalkBack.

#### Skipped

- **Bug 42 — Pidgin dictionary offensive terms:** Intentionally skipped per product team decision.

---

## Appendix: Version 1.86 Change Log

### v1.86 — Changelog

#### Android 15 (API 35) White-Screen Fix

> **Correction (v1.89):** This section previously said "Android 16 (API 36)". The actual `expo-build-properties` config in `app.json` sets `targetSdkVersion: 35` (Android 15), NOT 36. The SDK-level references below have been corrected.

Resolved a permanent blank white screen that appeared after the splash screen on Android 15 (API 35) devices when running non-production EAS builds (preview / staging). Three independent root causes were identified and fixed:

- **Android SDK 35 forced edge-to-edge enforcement (primary cause):** Android 15 (API 35) and later force every app into full-screen edge-to-edge window mode regardless of whether the app handles insets. Apps not adapted for this end up with the root view sized or positioned incorrectly, rendering a blank white screen. The XML opt-out attribute `android:windowOptOutEdgeToEdgeEnforcement` was initially added via a config plugin but was subsequently removed because the EAS build image's AAPT2 cannot find the attribute in its `android.jar`, causing a build failure. The correct approach is to embrace edge-to-edge and rely on `react-native-safe-area-context` for proper inset handling. The `apps/expo/plugins/withAndroidEdgeToEdge.js` file is retained in the repo for reference but is not registered in `app.json`.

- **`return null` loading state exposed white background:** While `isLoading` (auth) or `!storeReady` (MMKV) was true, `RootLayoutNav` returned `null`, leaving the GestureHandlerRootView empty after the splash screen hid (which the edge-to-edge enforcement caused to happen earlier than expected). Fixed by replacing `null` with an `ActivityIndicator` spinner on a white background, matching the splash colour so the transition is seamless.

- **`DebugOverlay` hidden behind Android navigation bar:** The floating debug badge was anchored to `bottom: 70/90`, which placed it behind the system navigation bar on various Android navigation modes (gesture nav, 3-button, API 35 edge-to-edge). Fixed by moving the badge to `top: topOffset` (using safe area insets via `useSafeAreaInsets`), where it is always visible. `SafeAreaProvider` was hoisted above `RootErrorBoundary` in `_layout.tsx` so `DebugOverlay` (a sibling of `RootErrorBoundary`) inherits insets context without needing its own provider.

#### Documentation Corrections (v1.86)

- **`app.config.ts` → `app.config.js`:** References to `app.config.ts` in BUG-REL-10 and Bug 41 corrected to `app.config.js` / `app.json`. The dynamic Expo config file uses the `.js` extension in this codebase; there is no `.ts` variant.
- **OTA runtimeVersion policy corrected:** BUG-SEC-07 previously stated `"policy": "sdkVersion"`. The actual `app.json` uses `"policy": "fingerprint"`. Entry updated to reflect the correct value and clarify what fingerprint-based versioning means.

---

## Appendix: Version 1.87 Change Log

### v1.87 — Changelog

#### Android APK Build Fix — Duplicate i18n Keys

Resolved an Android release build failure caused by duplicate property keys in `apps/expo/lib/i18n/locales/en.json`. The Kotlin/JS bundler treats duplicate object keys as an error during release compilation.

**Root cause:** `en.json` contained two separate blocks defining the same friend-request translation keys, introduced when a more complete second block was added without removing the original. The duplicated keys were:

- `friends.requests.received`
- `friends.requests.sent`
- `friends.requests.withdraw`
- `friends.empty.noReceivedRequests`
- `friends.empty.noSentRequests`

**Fix:** The first (older, less complete) block was removed. The retained second block includes the additional `friends.requests.withdrawing` key and uses the more descriptive string values (`"No received friend requests."`, `"No sent friend requests."`).

No runtime behaviour change — the final resolved strings are identical to what the app displayed before in any locale that was already using the second block's values.

---

## Appendix: Version 1.88 Change Log

### v1.88 — Changelog

#### Android APK White-Screen (Root Cause Chain) — Full Resolution

This version closes the multi-root-cause chain that produced a permanent white screen after
the splash, with no debug chip and no native alert, on Android API 35 release/preview builds.

---

##### Root cause 1 — `SafeAreaProvider` null-child guard (fixed in v1.85 / PR #403)

`react-native-safe-area-context` 4.10.x renders `{insets != null ? children : null}`. On
Android SDK 35 with edge-to-edge enforcement the native inset callback can be delayed or
never fire, so the provider stays on `null` and the entire tree (including `DebugOverlay`
and `RootErrorBoundary`) is never rendered — white screen, no chip, no red box.

**Fix:** pass `initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}` to
`SafeAreaProvider` so `insets` is non-null on the very first render.

---

##### Root cause 2 — `expo-updates` native controller gating the JS bundle (fixed PR #404)

`expo-updates` owns `getJSBundleFile()` in release builds. If the controller cannot resolve
a launchable bundle (runtime-version mismatch, malformed config) it returns nothing — JS
never runs, splash fades, permanent white screen, no chip, no alert.

The config was also malformed: `runtimeVersion` and `projectId` were passed as _plugin
props_ (`["expo-updates", { "projectId": "...", "runtimeVersion": ... }]`). The
`expo-updates` config plugin ignores plugin props for these fields; they must be top-level
Expo config keys. So the effective `runtimeVersion` was unset, causing the controller to
fail every bundle resolution.

**Fix:**
- Top-level `"updates": { "enabled": false }` and `"runtimeVersion": "1.0.0"` in
  `app.json` so the updates controller is bypassed and React Native loads the embedded
  bundle directly.
- Replace `["expo-updates", { … }]` with the plain string `"expo-updates"` in the plugins
  list.

**RULE FOR FUTURE WORK:** `expo-updates` top-level config keys (`runtimeVersion`, `updates`,
`projectId`) belong at the `expo.*` level in `app.json`, NOT inside plugin props. Plugin
props for `expo-updates` are only for native-only settings like `launchWaitMs`.

---

##### Root cause 3 — React import order causes null crash in Hermes (fixed PR #406)

After the two fixes above, logcat still showed a crash at 12ms after "Running main":

```
TypeError: Cannot read property 'useMemo' of null
```

**Root cause:** In Hermes, ES `import` statements compile to CommonJS `require()` calls
executed in _source-file order_. `app/_layout.tsx` had NativeWind (`global.css`) at
position 2 and `expo-router` at position 3, both **before** `import … from 'react'` at
position 4. NativeWind and expo-router access React internals (e.g. `useMemo`) during their
own module evaluation. Because React hadn't been required yet at that point, the CommonJS
module cache still held `null` for `'react'` — crash.

**Fix 1 — import order in `app/_layout.tsx`:**
```ts
import '@/lib/polyfills';                    // 1. polyfills (always first)
import { useEffect, ... } from 'react';      // 2. React (MUST be before NativeWind)
import { ..., Dimensions, ... } from 'react-native'; // 3. React Native
import '../global.css';                      // 4. NativeWind (now gets initialised React)
export { ErrorBoundary } from 'expo-router'; // 5. expo-router (same)
```

**Fix 2 — `resolveRequest` in `metro.config.js`:**
Replace `extraNodeModules` with a `resolveRequest` hook that intercepts _every_ resolution
call (including nested requires inside node_modules) and pins `'react'` and `'react-native'`
to a single physical path. `extraNodeModules` only covers top-level resolution and can be
bypassed by nested requires from within packages.

**RULE FOR FUTURE WORK:**
- In any Expo/React Native entry file, `import 'react'` and `import 'react-native'` MUST
  appear before any library that wraps React (NativeWind CSS imports, expo-router,
  react-navigation, etc.).
- Use `resolveRequest` in `metro.config.js` to deduplicate React in monorepos; do NOT rely
  on `extraNodeModules` alone.

---

##### How to diagnose a white-screen-no-chip failure

The absence of the `EXPO_PUBLIC_DEBUG_OVERLAY=1` chip proves React never mounted. Work
backwards through the layers:

1. **Check logcat** for `AndroidRuntime` / `FATAL EXCEPTION` / `Running main`. A JS crash
   at < 100ms after "Running main" is a module-evaluation error (import order, dual React).
2. **Check expo-updates**: is it enabled? Does the manifest runtime version match the
   controller's expectation? Disable OTA (`"updates": { "enabled": false }`) to rule it out.
3. **Check import order** in the entry layout: polyfills → React → React Native → NativeWind
   → everything else.
4. **Check metro.config.js**: does `nodeModulesPaths` list multiple node_modules roots? If
   so, add a `resolveRequest` hook to deduplicate `'react'` and `'react-native'`. Crucially,
   also cover `react/jsx-runtime` and `react/jsx-dev-runtime` — React 18's automatic JSX
   transform imports these as separate module strings, bypassing a `'react'`-only intercept
   and allowing a second React instance to be loaded just for JSX rendering.
5. **Check for a stray `react-native` in the root `devDependencies`.** If the root
   `package.json` lists a different `react-native` version than `apps/expo/package.json`,
   npm installs two copies. Subpath imports such as `react-native/Libraries/AppRegistry`
   bypass the `resolveRequest` hook and load from whichever copy `nodeModulesPaths` resolves
   first — potentially the wrong one. Remove the root-level entry and rely on the version
   declared inside `apps/expo/package.json` only.
6. **Check babel.config.js**: does the expo-router Babel plugin load silently as `undefined`?
   If `expoRouterBabelPlugin` is not found and Babel ignores the `undefined` entry,
   `EXPO_ROUTER_APP_ROOT` is never inlined and `require.context(undefined, ...)` fails at
   runtime — `AppRegistry` never registers, n=0.

---

##### Android SDK version config rule (from v1.86)

`android.compileSdkVersion`, `android.targetSdkVersion`, and `android.minSdkVersion` are
**NOT** valid top-level Expo Android config keys — Expo silently ignores them. The only
supported way to set Android SDK levels in an Expo prebuild project is the
[`expo-build-properties`](https://docs.expo.dev/versions/latest/sdk/build-properties/)
plugin. Always configure SDK levels via:

```json
["expo-build-properties", { "android": { "compileSdkVersion": 35, "targetSdkVersion": 35, "minSdkVersion": 24 } }]
```

---

---

## Appendix: Version 1.89 Change Log

### v1.89 — Changelog

#### AppRegistry n=0 White-Screen Fix (Root Cause Chain Continued)

After the fixes in v1.88, the app still crashed on launch with:

```
Invariant Violation: Failed to call into JavaScript module method AppRegistry.runApplication().
Module has not been registered as callable. Bridgeless Mode: false.
Registered callable JavaScript modules (n = 0):
```

This error means `AppRegistry.registerComponent` was never called — the JS bundle evaluated
but expo-router never registered the root component. Three new root causes were identified:

---

##### Root cause 4 — `react/jsx-runtime` and `react/jsx-dev-runtime` bypass Metro deduplication (fixed)

The `resolveRequest` hook in `metro.config.js` intercepted `'react'` and `'react-native'`
but not the JSX runtime paths. React 18 uses the automatic JSX transform: every file with
JSX compiles to imports of `'react/jsx-runtime'` (prod) or `'react/jsx-dev-runtime'` (dev)
rather than calling `React.createElement` directly. These are separate module strings that
bypassed the `'react'` intercept entirely. If Metro resolved them from a different physical
React copy than the one pinned by the hook, two React internal registries existed in the same
bundle — hooks crossed the registry boundary and `AppRegistry` registration failed silently.

**Fix (`metro.config.js`):** Extended the `resolveRequest` hook to also cover
`react/jsx-runtime` and `react/jsx-dev-runtime`, pointing both to the same `REACT_PATH`
that already governs `'react'` itself.

```js
if (moduleName === 'react/jsx-runtime') {
  return { filePath: path.join(REACT_PATH, 'jsx-runtime.js'), type: 'sourceFile' };
}
if (moduleName === 'react/jsx-dev-runtime') {
  return { filePath: path.join(REACT_PATH, 'jsx-dev-runtime.js'), type: 'sourceFile' };
}
```

---

##### Root cause 5 — Unguarded expo-router Babel plugin import in `babel.config.js` (fixed)

`babel.config.js` imported the expo-router Babel plugin via:

```js
require('babel-preset-expo/build/expo-router-plugin').expoRouterBabelPlugin,
```

If `expoRouterBabelPlugin` is `undefined` (e.g. after a `babel-preset-expo` upgrade renames
the export), Babel silently skips the `undefined` entry. `process.env.EXPO_ROUTER_APP_ROOT`
is never inlined in `expo-router/_ctx.*.js`, so Metro's `require.context` transform rejects
the non-string argument, expo-router cannot build the route tree, and `AppRegistry.registerComponent`
is never called — n=0 crash, even though the build succeeds.

**Fix (`babel.config.js`):** Wrapped the plugin import in an IIFE that validates the export
is a function. If it is not found, it tries the `expo-router/babel` fallback (SDK 52+).
If neither path works, it throws a descriptive error **at build time** so the APK is never
shipped with a broken bundle:

```js
(() => {
  const mod = require('babel-preset-expo/build/expo-router-plugin');
  if (typeof mod.expoRouterBabelPlugin === 'function') return mod.expoRouterBabelPlugin;
  // fallback for SDK 52+
  const p = require('expo-router/babel');
  if (typeof p === 'function') return p;
  if (typeof p?.default === 'function') return p.default;
  throw new Error('[babel.config.js] expo-router Babel plugin not found — EXPO_ROUTER_APP_ROOT will not be inlined, causing n=0 at runtime.');
})()
```

---

##### Root cause 6 — Stray `react-native@0.74.0` in root `devDependencies` (fixed)

The root `package.json` declared `"react-native": "0.74.0"` in `devDependencies`, while
`apps/expo/package.json` uses `react-native@0.74.5`. npm installed both, placing
`react-native@0.74.0` at the workspace root and `react-native@0.74.5` inside
`apps/expo/node_modules`. Metro's `nodeModulesPaths` lists both roots, so subpath imports
such as `react-native/Libraries/AppRegistry` could resolve from the wrong version (0.74.0)
while the main `react-native` import resolved from 0.74.5 — two distinct copies of
React Native's internal registry in the same bundle.

**Fix (`package.json` root):** Removed `"react-native": "0.74.0"` from root
`devDependencies`. The single canonical copy is now `react-native@0.74.5` inside
`apps/expo/node_modules`, consistent with what the `resolveRequest` hook already pins.

---

#### Additional Bug Fixes (v1.89)

- **`Updates.isAvailable` wrong API (`lib/i18n/index.ts`):** expo-updates SDK ~0.25.0 (Expo SDK 51)
  does not expose an `isAvailable` property — the correct API is `Updates.isEnabled`. The
  `languageChanged` handler was guarded by `Updates.isAvailable` which was always `undefined`
  (falsy), so the RTL layout reload after switching to Arabic was silently never triggered.
  Fixed: changed to `Updates.isEnabled` and made the `expo-updates` import lazy (moved to a
  `require()` inside the handler) so the module is not evaluated at i18n module init time.

- **Duplicate `import '@/lib/i18n'` removed (`app/_layout.tsx`):** Line 44 imported
  `applyStoredLanguagePref` from `@/lib/i18n`, which evaluates the module. Line 48 had a
  redundant side-effect `import '@/lib/i18n'` — a no-op since the module was already cached,
  but a source of confusion and a maintenance hazard. The duplicate was removed.

---

#### Documentation Corrections (v1.89)

- **Android API level corrected throughout:** Multiple sections previously stated
  "Android 16 (API 36)" or "Target Android API Level 36". The actual `expo-build-properties`
  config in `app.json` uses `targetSdkVersion: 35` (Android 15). All references corrected.
- **`Updates.isAvailable` → `Updates.isEnabled`:** v1.85 changelog entry for Bug 14 corrected
  to reflect the proper expo-updates SDK 51 API.

---

*ZobiaSocial PRD v1.89*
*Project Codename: ZobiaSocialAPK*
*Prepared for developer handoff*
