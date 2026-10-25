# Optional starter content

The migration installs the schema and built-in catalogs, including **26 quest templates**, games, gifts, stickers, store items, themes, help articles and reference categories. The optional [`seed.sql`](../apps/web/db/seed.sql) adds administrator-authored examples; it is not another migration.

## Run from Supabase SQL Editor

- Finish the migrations and create your verified administrator account using [SETUP.md, section 8](SETUP.md#8-deploy-the-website-and-create-your-administrator).
- Open `apps/web/db/seed.sql` on GitHub, click **Raw**, and copy the complete file.
- Open **Supabase → SQL Editor → New query** and paste it.
- Near the top, replace `REPLACE_WITH_YOUR_ADMIN_EMAIL` with your administrator email, keeping the surrounding single quotes.
- Click **Run**. Use the database owner/editor connection, not an anonymous Data API key. The same SQL works in another supported PostgreSQL provider's query editor.
- After success, refresh the website and review the content in your account and admin panel. Draft, inactive, private, disabled-feature and membership-only content follows its normal visibility rules.

There is one transaction: an error commits no seed changes. If the email is missing, ambiguous, unverified or not an active administrator, fix the account/setup and rerun the complete file. A reserved starter slug/ID conflict stops safely rather than replacing existing content.

## What is added

The full example set contains **296 rows across 57 tables**, including child records. Existing memberships, stores and business eligibility can reduce the inserted set.

| Content family | Starter examples |
|---|---|
| Feed and Moments | Six posts, one reply and three text Moments |
| Rooms | Eight public topic rooms, one free classroom, creator memberships and welcome messages |
| Classrooms | Three curriculum lessons, three discussion posts, a comment, one practice quiz and a sample calendar reminder |
| Group chats | One private study group, with only the owner as member, and a welcome message |
| Guilds | One community guild and welcome message, plus three inactive collective quest drafts; skipped if the owner already belongs to a guild |
| Blogs | One blog/category, three published articles, About page, Privacy/Contact drafts and a comment |
| Wikis | One wiki, three pages, matching revisions and its owner collaborator |
| Tales | One free fictional story, three published chapters and an author's discussion prompt |
| Q&A | Eight questions and six editorial answers, with zero votes |
| Bulletin board | Three threads with original posts and one reply |
| Polls and quizzes | Four polls with 16 options; three quizzes with nine questions and 36 answer options |
| Portals | One topic portal and hashtag links to starter content |
| Business pages | A deactivated page and three post drafts, only if the owner already has an active business account |
| Merch | An inactive store with digital, physical and course-material listing drafts; skipped if the owner already owns a store |
| Reaction packs | Three packs with nine reactions |
| Announcements and notices | One seven-day welcome banner, one inactive modal and two notices |
| Council | One open suggestion, with zero votes |
| Seasons and events | One inactive season, three inactive cultural events and an inactive flash-event example |
| Ads and sponsored quests | One unfunded draft campaign/creative and three inactive, pending sponsored quests |
| Daily quests | **80 additional templates** covering all 20 currently supported quest activity types |

The baseline already supplies games, gifts, stickers, cosmetics/boosters, themes, help and reference catalogs; the optional seed does not duplicate them. Media uploads need real files, so the examples use text rather than broken image/video URLs or promised downloads.

Private DMs, unsolicited broadcasts, support conversations, subscriptions, paid entitlements, payments, wallet/treasury ledgers, orders, KYC, sessions, votes, ratings, completed quests and user activity are not seedable editorial content. They must arise through real application flows. No new accounts, privileges or balances are created. The seed adds only the owner's required memberships and assigns its new guild when the owner has no guild.

## Quests and rewards

- The existing 26 templates came from the consolidated migration. The New Member Quest is created separately during onboarding.
- The additional 80 templates provide four variants for each supported action. Their action types match the actual server quest hooks, not invented activity names.
- They cover messages, room joins, gifts, login streaks, guild contributions, XP milestones, verified games/challenges, blog publishing/comments, wiki edits, polls, quizzes, bulletin-board discussions and market purchases.
- **72 start active.** Eight verified game-play/win templates stay inactive until a trusted game-result provider is configured. Feature switches and plan eligibility still apply.
- Additional templates award **no Coins**. Most offer 25–75 XP after a real completion; XP-milestone templates award zero XP to avoid self-feeding progress.
- Daily-login variants require only today’s sign-in; they do not demand a multi-day streak that a newcomer cannot finish today.
- Today's assigned deck stays unchanged. New templates can appear when a new deck is generated; users do not receive the whole catalog at once.
- Content actions without a quest hook—such as publishing a Tale or a Moment—do not get uncompletable templates. Adding those action types requires application tracking; this seed covers the full existing activity vocabulary.

## Review before launch

- Edit the administrator-authored content, including the blog introduction. Privacy/Contact pages remain drafts until you supply accurate information.
- Review dates and settings before enabling seasons, XP events or guild quest drafts. The classroom calendar item is explicitly a sample reminder, not a promised live meeting.
- Configure real products, images, stock, prices and fulfilment before enabling the merch store.
- Configure and fund campaigns/sponsored quests through normal flows before activation; no advertising balance is seeded.
- Reruns preserve existing rows, edits, moderation states and dates. They do not extend expired Moments/banners or reactivate disabled content. Hard-deleted starter rows can be inserted again; soft-deleted rows are preserved.
- Reuse the same owner email on reruns. Run against a backup/restorable deployment when adding examples to an existing live site.
