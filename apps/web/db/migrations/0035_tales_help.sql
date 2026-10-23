BEGIN;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published)
SELECT id,'read-tales','Read stories chapter by chapter','# Read stories on Tales

Open [Tales](/t) and choose a story. The first chapter is always free and can be read without signing in. At the end, choose **Continue to next part**. Sign in or create an account to read further chapters; Zobia keeps the destination through sign-in and onboarding.

Some chapters cost {{currency.softPlural}}. The price appears before you pay. Open [Wallet](/wallet) to check your balance, including welcome credits. Confirm the deduction to unlock the chapter. An unlocked chapter stays available to your account while the author and content remain available. If a price changes, review and confirm the current price again.

You can vote, comment when the author allows it, subscribe to an author, or share a link. Some funded reward pots pay eligible distinct readers for sharing. A pot can run out, so a share does not guarantee a reward. Use **Report story** for content that breaks the rules.'
,'','first_time',TRUE FROM help_categories WHERE slug='creating-and-sharing' ON CONFLICT(category_id,slug) DO NOTHING;
INSERT INTO help_docs(category_id,slug,title,body_markdown,body_html,difficulty,published)
SELECT id,'write-tales','Write and publish a story','# Write your story

Reach Level {{tales.minLevel}} to write. Open [Tales](/t), choose **Write a story**, and save the story details as a draft. Add an optional cover, a synopsis and chapters. Draft recovery belongs to your account and helps protect unsaved text on the same device.

Free writers can keep {{tales.publishedLimit}} published stories and {{tales.draftLimit}} draft stories. Paid plans allow unlimited stories and drafts. Publish approved chapters individually or all at once. Chapter one must be free. Publish an approved first chapter before publishing the story itself. Paid plans can schedule chapters for later; scheduled publishing pauses when the account no longer has a paid plan.

A story default price applies to further chapters unless a chapter overrides it. A chapter price of zero makes that chapter free. Paid chapter sales transfer the configured author share to the author in {{currency.softPlural}}. You may remove paywalls, control comments and choose subscriber notifications. You can fund a reward pot for the story or a chapter; funding deducts credits and closing refunds the unclaimed amount.

Stories and covers are checked before public reading. Clean romance is allowed. Explicit sexual content and unrelated advertising are not. Uncertain reviews go to staff. You can appeal a rejected story, chapter or Tales account restriction up to {{tales.appealLimit}} times per target. Read the reason and explain what should be reconsidered.'
,'','first_time',TRUE FROM help_categories WHERE slug='creating-and-sharing' ON CONFLICT(category_id,slug) DO NOTHING;
COMMIT;
