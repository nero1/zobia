BEGIN;
INSERT INTO help_categories(slug,name,description,published) VALUES('getting-started','Getting started','Find your way around Zobia and set up your account.',TRUE) ON CONFLICT(slug) DO NOTHING;
INSERT INTO help_categories(slug,name,description,published) VALUES('wallet-and-plans','Wallet and plans','Understand credits, purchases, subscriptions, and your history.',TRUE) ON CONFLICT(slug) DO NOTHING;
INSERT INTO help_categories(slug,name,description,published) VALUES('safety-and-privacy','Safety and privacy','Control your privacy, report problems, and keep your account safe.',TRUE) ON CONFLICT(slug) DO NOTHING;
INSERT INTO help_categories(slug,name,description,published) VALUES('creating-and-sharing','Creating and sharing','Publish, chat, learn, save, and play.',TRUE) ON CONFLICT(slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'your-first-visit','Your first visit','# Your first visit

Start on **Home**. Your feed brings together posts, games, discussions and classrooms. Select a card to open it. Use **Search** to find people or content. Open the menu to browse related features under their section headings.

Open **Profile** to check your account and choose your language. Open **Settings** to change your privacy choices and notifications. You can change these choices later.

Your daily quests suggest actions you can do now. Select a quest to open the relevant area. A progress bar shows how close you are to finishing it. Your reward is shown before you start.

Never share your password, PIN, sign-in code or recovery information in a chat. Staff will not ask you to send these secrets to them.','', 'first_time',TRUE FROM help_categories WHERE slug='getting-started' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'get-credits','How to get credits','# How to get {{currency.softPlural}}

Open [Wallet](/wallet) to see your balance and transaction history. Your welcome tasks, eligible quests and other activities may reward {{currency.softPlural}}. Each activity shows its current reward; some quests award XP rather than credits.

To buy more, choose an available bundle in Wallet and follow the checkout steps. Check the bundle price and currency before confirming. The Android app uses its available in-app purchase flow. Payment options may differ between Android and the website.

Someone can also send you a [gift](/gifts). Gifts and purchases appear in your wallet history when processed. Do not send money to an unknown person who promises to add credits manually.

To unlock a paid post, return to the post, select Unlock, and check the amount in the confirmation. If your balance is too low, you can buy a bundle, receive a gift or complete an eligible rewarded quest. A failed unlock does not give access to the paid content.','', 'first_time',TRUE FROM help_categories WHERE slug='wallet-and-plans' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'understand-wallet-history','Read your wallet history','# Read your wallet history

Open [Wallet](/wallet) and find the transaction history. Each entry explains an amount added or spent, with its date. Check the description to distinguish a purchase, gift, reward, refund or game stake.

Credits and stars have separate histories. A pending payment or payout may not be a completed wallet transaction yet. Refresh once to check its latest status. If a charge looks wrong, contact Support with the transaction reference and date. Never include your card details or sign-in secrets.','', 'first_time',TRUE FROM help_categories WHERE slug='wallet-and-plans' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'choose-a-plan','Choose or change a plan','# Choose or change a plan

Open [Subscription settings](/settings/subscription) to compare the current plans. Read the price, billing period, features and limits shown there. These can change, so the checkout and your account settings are the place to check current amounts.

Upgrading may unlock higher limits. A cancellation normally stops the next renewal; check your subscription status and end date for what remains available. Some features have grace periods after a plan ends. Existing bookmark folder slots stay unlocked after a downgrade.

Do not buy a plan through a message from someone claiming to be staff. Start from your account''s own plan screen.','', 'first_time',TRUE FROM help_categories WHERE slug='wallet-and-plans' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'save-bookmarks','Save and organise bookmarks','# Save and organise bookmarks

Select **Save bookmark** below a feed card. Open [Bookmarks](/bookmarks) from the menu to find your saved content. Select a title to open it.

Use the folder selector beside a saved item to move it. Choose Unfiled to remove it from a folder without deleting the bookmark. Removing a bookmark does not delete the original content.

Paid plans unlock folder slots: Plus includes {{bookmarks.plusFolders}}, Pro includes {{bookmarks.proFolders}}, and Max includes {{bookmarks.maxFolders}}. Once unlocked, those slots remain available after a downgrade. Existing folders are kept.

If you need another slot, the first purchased slot costs {{bookmarks.firstFolderCost}} {{currency.softPlural}}, and later purchased slots cost {{bookmarks.extraFolderCost}} each. The confirmation shows the current price before your wallet is charged. Deleting a folder keeps its saved items and frees the slot.','', 'first_time',TRUE FROM help_categories WHERE slug='creating-and-sharing' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'classroom-chatrooms','Join a classroom chatroom','# Join a classroom chatroom

Open the classroom''s page first. Read its description and enrolment options. A free classroom lets you enrol without a payment. A paid classroom shows its current fee before you confirm.

After you are enrolled, select **Chat** if the creator has enabled the classroom chatroom. Classroom chat messages are for enrolled members and authorised classroom staff. A chatroom link by itself does not give access.

If you see an enrolment message, use its link to return to the classroom and check your membership. If you have paid but still cannot enter, refresh your classroom page and contact Support with your payment reference. Do not pay again just to try to fix an access problem.','', 'first_time',TRUE FROM help_categories WHERE slug='creating-and-sharing' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'send-a-game-challenge','Send a game challenge','# Send a game challenge

Open [Challenges](/games/challenges), choose a game and select another player. Suggestions include your friends and people who have chosen to share recent activity. Pick the round format and check any credit stake before sending.

You can send up to {{challenges.dailyLimit}} challenges per day. A new challenge expires after {{challenges.expiryHours}} hours. The Expired label means it can no longer be accepted or played, even if a scheduled cleanup has not run yet.

When a staked challenge is accepted, both players'' stakes move into escrow together. A challenge with an unaffordable stake cannot be accepted. Cancellation rules may include a forfeiture after rounds have been played; read the displayed terms. Expired active challenges are refunded by the games housekeeping job.

The Results tab contains completed challenges. Archiving your result hides it from your own inbox; it does not remove it from the other player''s inbox.','', 'first_time',TRUE FROM help_categories WHERE slug='creating-and-sharing' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'edit-a-blog-post','Write and edit a blog post','# Write and edit a blog post

Open Blogs, choose your blog and open its dashboard. Select a new article or page, then add a title and content. The editor shows your current word and post limits.

**Save draft** keeps an unpublished post private. **Publish** makes it available to readers. For a published post, **Save** stores your changes as a private revision; readers keep seeing the previous published version until you select Publish. **Unpublish** takes the post out of public view.

The editor keeps a recovery copy on your device for the signed-in account. This helps after a refresh, but clearing browser/app data can remove it. Save important work to the server as well.

Select Reward pot to open its controls. A new post needs to be saved before its pot can be funded. Pay-gating and reward pots are separate choices. Check all amounts before confirming a charge.','', 'first_time',TRUE FROM help_categories WHERE slug='creating-and-sharing' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'recent-activity-privacy','Control your recent activity','# Control your recent activity

Open [Privacy settings](/settings#privacy). Recently active controls become available at Level 2. If you turn visibility off, you will not appear in other people''s recent-activity lists, and you also stop seeing their recent activity.

To see activity again, turn your own visibility on. A missing activity indicator does not prove that someone has left Zobia or is ignoring you. They may have hidden it or be away from the app.

On shared devices, log out when you finish. When your session expires, sign in again before opening private content. Do not leave an unlocked device with a private conversation on screen.','', 'first_time',TRUE FROM help_categories WHERE slug='safety-and-privacy' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'ask-ai-or-support','Ask AI or contact Support','# Ask AI or contact Support

Use the Ask AI box at the end of a help document for questions about using Zobia. Tell it what you were trying to do and what happened. Do not include passwords, PINs, payment secrets or private identity documents.

The Free plan includes {{help.aiFreeWeeklyLimit}} questions per week. Your usage notice appears as you approach the limit. The reset date is shown in the notice. A paid question after the allowance costs {{help.aiQuestionCost}} {{currency.softPlural}}; you must confirm the displayed charge first. Failed answers release the question allowance and refund any question charge.

AI answers can be incomplete. If an answer does not solve your problem, browse or search [Help](/help), or use the Contact a real person option. Your support eligibility and any ticket cost are shown before you submit a ticket.','', 'first_time',TRUE FROM help_categories WHERE slug='getting-started' ON CONFLICT(category_id,slug) DO NOTHING;
COMMIT;
