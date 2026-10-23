BEGIN;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'join-forum-discussions','Join a forum discussion','# Join a forum discussion

Open [Forum](/forum) and choose a board that matches your topic. Read the board description and a few existing discussions first. Search for your question before starting another thread.

Choose a thread to read its opening post and replies. Use Reply to add to the discussion. If you quote another reply, keep only the part you are answering. A useful reply explains what you mean, gives an example and stays on the topic.

To start a discussion, choose the new-thread action, pick a clear title and write the opening post. Review the preview and any image or reward-pot cost shown before posting. If an action is unavailable, check the level or plan notice rather than repeatedly submitting it.

You can report a post that breaks the rules. Disagree with ideas without attacking the person. Never put passwords, payment codes or someone else''s private information in a public thread.','','first_time',TRUE FROM help_categories WHERE slug='creating-and-sharing' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'ask-and-answer','Ask and answer questions','# Ask and answer questions

[Answers](/answers) is for questions that other people can answer. Search first. If the answer is not already there, choose Ask and select the best category.

Use a title that says what you need to know. In the question, explain what you tried and which part is confusing. Avoid putting several unrelated questions in one post. Check the page for any level requirement before writing a long question.

When answering, explain the steps and say when your advice may not apply. Link to a reliable source when it helps. If you do not know, it is fine to ask a clarifying question instead of guessing.

Votes help other readers find useful contributions. The question author can mark the answer that solved the problem when that option is available. Comments, votes and accepted answers have different purposes; do not use reports to punish an answer you simply disagree with.','','first_time',TRUE FROM help_categories WHERE slug='creating-and-sharing' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'use-wikis','Read and contribute to a wiki','# Read and contribute to a wiki

Open [Wikis](/wiki), choose a subject and search or browse its pages. A wiki groups reference pages about one topic. Read the wiki description so you know what belongs there.

If you want to help, check its contribution policy. Some wikis allow contributions from everyone; others require an invitation or owner permission. Creation and page limits depend on the current plan settings shown in the app.

To create a page, choose a specific title and write an introduction, useful sections and sources. To improve a page, use Edit, explain the change and save it. Keep the page focused on the subject rather than promoting yourself or a product.

The revision history helps people see how a page changed. A moderator may review or remove a contribution. If a page has a reward pot, read the qualifying action and current pot state; simply visiting or editing does not guarantee a payout.','','first_time',TRUE FROM help_categories WHERE slug='creating-and-sharing' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'moments-and-tweets','Share a Moment or Tweet','# Share a Moment or Tweet

Use [Moments](/moments) for updates on the Moments wall and [Tweets](/tweets) for short posts and conversations. Choose the composer in the area you want to use.

Write your text and add media only if you want it. Check the audience, preview and any current media cost before publishing. A disabled composer may mean you have not reached the required level or an administrator has turned that feature off.

A reply continues a conversation. A share or repost brings an existing post to more people. Give credit to the original author and avoid posting the same message repeatedly.

Hashtags connect related public posts. Use a few relevant terms rather than filling a post with unrelated tags. Public posts can be read by people outside your friend list. Remove private details before sharing. Use the report action for content that breaks the rules.','','first_time',TRUE FROM help_categories WHERE slug='creating-and-sharing' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'polls-and-quizzes','Take part in polls and quizzes','# Take part in polls and quizzes

Open [Polls](/polls) to answer a poll or [Quizzes](/quizzes) to test what you know. Read the question, choices and any explanation before submitting.

A poll collects opinions. A quiz checks answers against the creator''s chosen answers. Some quizzes require a passing score before an associated reward can be claimed. The page shows the current rules, closing time and reward state.

When creating content, use a clear question and choices that are easy to tell apart. Check the creation-level notice, time settings and preview. If you fund a reward pot, review the total deduction and claimant limit before confirming. Edit the existing pot to change its total; close it to refund what remains unclaimed.

A reward is not guaranteed just because a page shows a pot. You must meet the qualifying action, and the pot must still have available funds and claimant places. Report misleading or unsafe content using its report action.','','first_time',TRUE FROM help_categories WHERE slug='creating-and-sharing' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'friends-and-messages','Find friends and send a message','# Find friends and send a message

Open [Friends](/friends) and search for a username or display name. Open the profile to check that you found the right person, then send a friend request if requests are available. The other person decides whether to accept it.

Open [Messages](/messages) to read your conversations or start one with a selected person. Check the username and write your message. Any current message or attachment cost is shown by the app. A delivery problem or expired session does not mean the other person has read your message.

Do not send repeated messages to someone who is not responding. Use mute, block or report when needed. Keep payment codes, passwords and private account information out of messages.

Online and recent indicators follow both people''s privacy choices. If you hide your activity, you also stop seeing other people''s activity. [Privacy settings](/settings/privacy) explains the current eligibility and controls.','','first_time',TRUE FROM help_categories WHERE slug='getting-started' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'group-conversations','Start and manage a group conversation','# Group conversations

Open [Messages](/messages) and use the group creation option when your account is eligible. Choose a clear group name and invite the people who should join. The app shows the current member and group limits.

A group is a shared conversation. Messages are visible to its members, so check the member list before sharing private information. A room or classroom is a different feature and can have different access rules.

Group owners or authorized managers can use the available member controls. If a group becomes unavailable after a plan change, read the notice before creating another one. Upgrade or restore the appropriate entitlement when you want to recover a preserved group.

When you leave, you may lose access to later conversation content. Do not rely on an offline copy as a permanent record. Report harassment and block unwanted direct contact through the available safety controls.','','first_time',TRUE FROM help_categories WHERE slug='getting-started' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'join-a-guild','Join a guild and contribute','# Join a guild

Open [Guilds](/guilds) and browse groups that match your interests. Read the guild description, joining rules and any current requirements before applying or joining.

After joining, introduce yourself and check the guild''s announcements and activities. Quests, events or wars may have their own entry rules and deadlines. The page shows which actions count toward a contribution.

A guild role gives only the permissions described by the app. It does not make someone platform staff. Never send passwords or sign-in codes to a guild leader or another member.

Rewards and leaderboards depend on recorded qualifying activity. Repeating empty messages or arranging fake activity can lead to moderation. If you want to leave, use the membership controls and read any effect on current activities or rewards.','','first_time',TRUE FROM help_categories WHERE slug='getting-started' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'play-games','Play games and keep your progress','# Play games

Open [Games](/games), choose a game and read its instructions before starting. The game page shows available modes, current entry costs and any limits or rewards.

If the game supports saved progress, use the game''s save controls. Available save slots depend on your current account entitlement. A saved game, a completed score and a challenge round are different records; wait for the completion result before leaving a scored session.

For a friend challenge, open [Challenges](/games/challenges), choose an eligible opponent and review the game, rounds and any Credit stake. Invitations expire according to the displayed deadline. A challenge that expires cannot be accepted or played afterward.

If a round does not finish, read the error and refresh the challenge status before trying again. Do not assume a local animation means a reward has been credited. Check [Wallet](/wallet) for actual transactions.','','first_time',TRUE FROM help_categories WHERE slug='getting-started' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'choose-a-plan','Choose or change a plan','# Choose a plan

Open [Subscription settings](/settings/subscription) to compare current plans, prices and included limits. The app reads the current catalog, so use those displayed figures when deciding. A business plan and a personal plan cover different account features.

Choose the plan and billing option you want, then review the total, currency and payment method before confirming. On supported Android purchase flows, the store handles the purchase confirmation. Payment success and account activation may arrive at different moments; check the plan status before paying again.

If you change or stop a paid plan, read the renewal and grace-period notice. Some features remain preserved for a period, some stop being available, and explicitly permanent purchases remain unlocked. Bookmark folder allowances already earned through a paid plan are retained.

For a failed or unclear payment, check your payment history and contact support with the payment reference. Do not send your full card details, PIN or sign-in code.','','first_time',TRUE FROM help_categories WHERE slug='wallet-and-plans' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'send-and-receive-gifts','Send and receive gifts','# Send a gift

Open [Gifts](/gifts) and browse the catalog. Select the recipient carefully and review the gift, current price and currency. If a message option is available, write a message that is appropriate for the recipient.

Confirm only after checking the username and deduction. A gift is different from a cash payout or a subscription. Read the gift''s description to understand what it provides and whether a separate reward is involved.

Your history shows sent and received gifts. If the balance or history looks out of date, refresh it and wait for the transaction result before trying again. Repeated tapping does not make a delayed transaction finish sooner.

Never pay someone outside the official flow because they promise a special gift or account upgrade. Use the report and support options if another user asks for your password, PIN or payment code.','','first_time',TRUE FROM help_categories WHERE slug='wallet-and-plans' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'referrals-and-invitations','Invite someone with your referral link','# Invite someone

Open [Referrals](/referrals) to find your referral link and the current reward rules. Share the link with someone who wants to join Zobia.

The invited person must complete the required steps shown in the referral rules. A click, an account creation and a completed qualifying action are different events. A reward appears only after the server records the required activity and any checks are complete.

Use your own link and explain what you are inviting people to. Do not create fake accounts, buy artificial signups or promise rewards that the app does not offer.

The referral page shows recorded progress. If something looks wrong, refresh it and check the eligibility rules before contacting support. Include the relevant username or reference, but never share account secrets.','','first_time',TRUE FROM help_categories WHERE slug='getting-started' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'notifications-and-announcements','Manage notifications and announcements','# Notifications and announcements

Open [Notifications](/notifications) to see account events, activity and notices. Select an available action to open the related content. A notification is a pointer to the current content; a removed post or expired activity may no longer be available.

Public platform announcements appear in [Announcements](/announcements). A personal conversation is found in Messages instead. Check the sender and destination before following any instruction that asks you to pay or change account details.

Notification preferences and device permissions work together. The app cannot show a device notification if the operating system has denied permission. Use the app''s settings and your device''s notification settings to adjust them.

Marking a notice read is different from completing the action it describes. Check the related page or Wallet for the actual result. Staff will not ask you to reply with a password, sign-in code or PIN.','','first_time',TRUE FROM help_categories WHERE slug='safety-and-privacy' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'report-a-problem','Report unsafe content or get support','# Report a problem

Use the report action on the specific story, post, message or profile that concerns you. Choose the closest reason and explain what happened. Include useful context without copying passwords, payment codes or unrelated private information.

A report goes to moderation; it does not guarantee that the content will be removed. Staff may review the context and automated classification. Do not submit the same report repeatedly or organize false reports against someone you disagree with.

For an account, purchase or technical problem, open [Help](/help) and use the support option. Explain what you were doing, what you expected and what happened. A payment reference can help support find the right transaction.

If your content or account was restricted, read the reason and use the available appeal route. Explain why the decision should be reconsidered and include relevant details. Appeal limits and eligibility are shown by the app.','','first_time',TRUE FROM help_categories WHERE slug='safety-and-privacy' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published) SELECT id,'business-and-creator-tools','Find business and creator tools','# Business and creator tools

A personal account, a creator feature and a business account have different purposes. Open [Business](/business) to compare current business options and requirements. Check the included limits and pricing before buying or upgrading.

Creator tools can include blogs, paid content, rooms, classes and earnings. Each feature shows its own eligibility, fees, revenue-share rules and available controls. Publishing content does not automatically make it eligible for a cash payout.

Keep descriptions, prices and promises accurate. Check the preview and payment settings before publishing. Use the available statistics to understand recorded views, purchases or participation rather than treating every interaction as earnings.

Identity checks, payout thresholds and account standing may affect withdrawals. Follow the official payout flow and provide only the information it requests. Never give another user your password, sign-in code or PIN to set up a business or creator feature.','','first_time',TRUE FROM help_categories WHERE slug='creating-and-sharing' ON CONFLICT(category_id,slug) DO NOTHING;
COMMIT;
