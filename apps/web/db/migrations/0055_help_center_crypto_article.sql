-- 0055_help_center_crypto_article.sql
--
-- "How to buy crypto" Help Center article, linked from the crypto checkout
-- flow's "How to buy crypto?" text (components/payments/CryptoCheckoutModal.tsx).
-- Seeded via migration (rather than left for an admin to author) so the link
-- always resolves — same body_markdown/body_html convention as blog_posts.
-- body_html was rendered ahead of time through the same
-- lib/security/htmlSanitizer allow-list (h2/p/ol/li/strong/a only) the admin
-- editor itself sanitizes through, so it renders identically either way.

INSERT INTO help_categories (slug, name, description, sort_order, published)
VALUES ('payments', 'Payments & Wallets', 'Paying with Paystack or crypto, coins, stars, and your wallet.', 10, true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO help_docs (category_id, slug, title, body_markdown, body_html, difficulty, sort_order, seo_title, seo_description, published)
SELECT
  hc.id,
  'how-to-buy-crypto',
  'How to buy crypto (JAGA, BNB, SOL)',
  $md$## Before you start

You only need this if you chose **Pay with Crypto** at checkout. If Paystack works for you, you don't need any of this.

You'll need a **wallet app** — this is like a bank app, except you (not Zobia, not any company) hold the keys, and only you can move the money out of it. Never share your wallet's recovery phrase (usually 12-24 words) with anyone, including someone claiming to be Zobia support — we will never ask for it.

## 1. Install a wallet app

- **For JAGA or BNB** (both run on BNB Smart Chain): install **MetaMask** or **Trust Wallet** from your phone's app store (or the MetaMask browser extension on desktop).
- **For SOL** (Solana): install **Phantom** from your phone's app store (or the browser extension on desktop).

Open the app and follow its setup — it will create a new wallet and show you a recovery phrase. Write that phrase down on paper and keep it somewhere safe. Do not screenshot it or save it in a notes app.

## 2. Buy BNB (if you're paying with JAGA or BNB)

1. Inside MetaMask or Trust Wallet, tap **Buy** (or **Buy Crypto**).
2. Pick **BNB** as the coin, and pick a payment method the app offers (card, bank transfer, or a local option depending on your country).
3. Follow the on-screen steps for that provider — you may need to verify your ID the first time.
4. Once it completes, you'll see a BNB balance in your wallet within a few minutes.

If you only need **BNB** (not JAGA), you're done — go back to Zobia's checkout, connect this same wallet, and send the payment.

## 3. Swap BNB for JAGA on PancakeSwap (only if paying with JAGA)

1. Open your wallet app's built-in browser (MetaMask and Trust Wallet both have one) and go to **pancakeswap.finance**.
2. Tap **Connect Wallet** on PancakeSwap and approve the connection from your wallet app.
3. On the **Swap** screen, set "From" to **BNB** and "To" to **JAGA**. If JAGA doesn't show up automatically, paste in its contract address (Zobia's checkout screen shows this, or ask in Support).
4. Enter how much BNB you want to swap — leave a small amount of BNB unswapped, since you'll need a little for the network fee when you actually send your payment.
5. Tap **Swap**, review the amount, and confirm in your wallet app when it pops up.
6. Wait about 10-30 seconds — your wallet will now show a JAGA balance.

## 4. Buy SOL (if you're paying with SOL)

1. Inside Phantom, tap **Buy**.
2. Pick **SOL** and a payment method the app offers (card, bank transfer, or a local option).
3. Follow the provider's steps — again, you may need to verify your ID the first time.
4. Your SOL balance appears in Phantom within a few minutes.

## 5. Come back and pay

Go back to Zobia's checkout, choose your currency, and connect the same wallet you just funded (MetaMask/Trust Wallet for JAGA or BNB, Phantom for SOL). Zobia will show you the exact amount to send — approve it in your wallet app, and the payment confirms automatically once it's seen on the blockchain.

## Troubleshooting

- **"Insufficient funds for gas"** — you need a small amount of BNB (for JAGA/BNB) or SOL (for SOL) left over to cover the network fee, even if you have enough of the token itself.
- **Payment stuck on "pending"** — blockchain confirmations can take a minute or two, especially on busy days. Leave the checkout screen open; it checks automatically.
- **Sent to the wrong address / wrong amount** — crypto transactions cannot be reversed by Zobia or anyone else. Always double-check the address and amount your wallet shows before confirming.
$md$,
  '<h2>Before you start</h2><p>You only need this if you chose <strong>Pay with Crypto</strong> at checkout. If Paystack works for you, you don''t need any of this.</p><p>You''ll need a <strong>wallet app</strong> — this is like a bank app, except you (not Zobia, not any company) hold the keys, and only you can move the money out of it. Never share your wallet''s recovery phrase (usually 12-24 words) with anyone, including someone claiming to be Zobia support — we will never ask for it.</p><h2>1. Install a wallet app</h2><ul><li><strong>For JAGA or BNB</strong> (both run on BNB Smart Chain): install <strong>MetaMask</strong> or <strong>Trust Wallet</strong> from your phone''s app store (or the MetaMask browser extension on desktop).</li><li><strong>For SOL</strong> (Solana): install <strong>Phantom</strong> from your phone''s app store (or the browser extension on desktop).</li></ul><p>Open the app and follow its setup — it will create a new wallet and show you a recovery phrase. Write that phrase down on paper and keep it somewhere safe. Do not screenshot it or save it in a notes app.</p><h2>2. Buy BNB (if you''re paying with JAGA or BNB)</h2><ol><li>Inside MetaMask or Trust Wallet, tap <strong>Buy</strong> (or <strong>Buy Crypto</strong>).</li><li>Pick <strong>BNB</strong> as the coin, and pick a payment method the app offers (card, bank transfer, or a local option depending on your country).</li><li>Follow the on-screen steps for that provider — you may need to verify your ID the first time.</li><li>Once it completes, you''ll see a BNB balance in your wallet within a few minutes.</li></ol><p>If you only need <strong>BNB</strong> (not JAGA), you''re done — go back to Zobia''s checkout, connect this same wallet, and send the payment.</p><h2>3. Swap BNB for JAGA on PancakeSwap (only if paying with JAGA)</h2><ol><li>Open your wallet app''s built-in browser (MetaMask and Trust Wallet both have one) and go to <strong>pancakeswap.finance</strong>.</li><li>Tap <strong>Connect Wallet</strong> on PancakeSwap and approve the connection from your wallet app.</li><li>On the <strong>Swap</strong> screen, set "From" to <strong>BNB</strong> and "To" to <strong>JAGA</strong>. If JAGA doesn''t show up automatically, paste in its contract address (Zobia''s checkout screen shows this, or ask in Support).</li><li>Enter how much BNB you want to swap — leave a small amount of BNB unswapped, since you''ll need a little for the network fee when you actually send your payment.</li><li>Tap <strong>Swap</strong>, review the amount, and confirm in your wallet app when it pops up.</li><li>Wait about 10-30 seconds — your wallet will now show a JAGA balance.</li></ol><h2>4. Buy SOL (if you''re paying with SOL)</h2><ol><li>Inside Phantom, tap <strong>Buy</strong>.</li><li>Pick <strong>SOL</strong> and a payment method the app offers (card, bank transfer, or a local option).</li><li>Follow the provider''s steps — again, you may need to verify your ID the first time.</li><li>Your SOL balance appears in Phantom within a few minutes.</li></ol><h2>5. Come back and pay</h2><p>Go back to Zobia''s checkout, choose your currency, and connect the same wallet you just funded (MetaMask/Trust Wallet for JAGA or BNB, Phantom for SOL). Zobia will show you the exact amount to send — approve it in your wallet app, and the payment confirms automatically once it''s seen on the blockchain.</p><h2>Troubleshooting</h2><ul><li><strong>"Insufficient funds for gas"</strong> — you need a small amount of BNB (for JAGA/BNB) or SOL (for SOL) left over to cover the network fee, even if you have enough of the token itself.</li><li><strong>Payment stuck on "pending"</strong> — blockchain confirmations can take a minute or two, especially on busy days. Leave the checkout screen open; it checks automatically.</li><li><strong>Sent to the wrong address / wrong amount</strong> — crypto transactions cannot be reversed by Zobia or anyone else. Always double-check the address and amount your wallet shows before confirming.</li></ul>',
  'first_time',
  1,
  'How to buy crypto (JAGA, BNB, SOL) — Zobia Help Center',
  'A beginner-friendly, step-by-step guide to installing a wallet, buying BNB or SOL, and swapping for JAGA to pay on Zobia.',
  true
FROM help_categories hc
WHERE hc.slug = 'payments'
ON CONFLICT (category_id, slug) DO NOTHING;
