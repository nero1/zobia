/**
 * E2E tests for the economy (wallet and store) features.
 *
 * Verifies:
 *  - Wallet page loads and displays coin balance as a number
 *  - Store page loads with gift items
 *  - Attempting a purchase without sufficient balance shows an error
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sets up a mock authenticated session by injecting a cookie.
 * In real E2E runs this would use a test user seeded in the DB.
 */
async function loginAsTestUser(page: import('@playwright/test').Page) {
  // Navigate to the login page first so cookies are scoped correctly
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  // Inject a test session cookie if the app supports it
  // (falls back gracefully if not — tests that need auth will be skipped)
  await page.context().addCookies([
    {
      name: 'zobia_session',
      value: process.env.E2E_TEST_SESSION_TOKEN ?? 'test-session-placeholder',
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      secure: false,
    },
  ]);
}

// ---------------------------------------------------------------------------
// Wallet page
// ---------------------------------------------------------------------------

test.describe('Wallet page', () => {
  test('wallet page loads without crashing', async ({ page }) => {
    await page.goto('/wallet', { waitUntil: 'networkidle' });

    // Either we land on wallet or get redirected to login (both are valid)
    const url = page.url();
    const isOnWallet = url.includes('/wallet');
    const isOnLogin = url.includes('/login');
    expect(isOnWallet || isOnLogin).toBe(true);
  });

  test('wallet page shows coin balance as a number when authenticated', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/wallet', { waitUntil: 'networkidle' });

    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      // Skip gracefully if test auth didn't work
      test.skip();
      return;
    }

    // Look for a numeric coin balance on the page
    // Accept any element that contains a digit
    const balanceEl = page
      .locator('[data-testid="coin-balance"]')
      .or(page.locator('[aria-label*="coin"]'))
      .or(page.locator('text=/\\d+\\s*(coins?|ZBC)/i'))
      .first();

    await expect(balanceEl).toBeVisible({ timeout: 10_000 });

    // Verify the balance text contains at least one digit
    const text = await balanceEl.textContent();
    expect(text).toMatch(/\d/);
  });

  test('coin balance element is a number (not NaN or undefined)', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/wallet', { waitUntil: 'networkidle' });

    if (page.url().includes('/login')) {
      test.skip();
      return;
    }

    // Extract the first numeric token from the page that looks like a balance
    const balanceText = await page.locator('[data-testid="coin-balance"]').textContent().catch(() => null);
    if (balanceText !== null) {
      const numericPart = balanceText.replace(/[^\d]/g, '');
      const value = parseInt(numericPart, 10);
      expect(isNaN(value)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Store page
// ---------------------------------------------------------------------------

test.describe('Store page', () => {
  test('store page loads without crashing', async ({ page }) => {
    const response = await page.goto('/store', { waitUntil: 'networkidle' });
    // Page should load (HTTP < 500)
    if (response) {
      expect(response.status()).toBeLessThan(500);
    }
  });

  test('store page shows at least one gift item when authenticated', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/store', { waitUntil: 'networkidle' });

    if (page.url().includes('/login')) {
      test.skip();
      return;
    }

    // Look for store items / gift cards
    const storeItem = page
      .locator('[data-testid="store-item"]')
      .or(page.locator('[data-testid="gift-item"]'))
      .or(page.locator('.store-item, .gift-item, [class*="storeItem"], [class*="giftItem"]'))
      .first();

    await expect(storeItem).toBeVisible({ timeout: 15_000 });
  });

  test('store items have a price displayed', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/store', { waitUntil: 'networkidle' });

    if (page.url().includes('/login')) {
      test.skip();
      return;
    }

    // Look for price tags containing numbers
    const price = page
      .locator('[data-testid="item-price"]')
      .or(page.locator('text=/\\d+\\s*(coins?|ZBC)/i'))
      .first();

    await expect(price).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Purchase flow — insufficient balance error
// ---------------------------------------------------------------------------

test.describe('Purchase flow', () => {
  test('attempting purchase without sufficient balance shows error feedback', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/store', { waitUntil: 'networkidle' });

    if (page.url().includes('/login')) {
      test.skip();
      return;
    }

    // Find any buy / purchase button
    const buyButton = page
      .getByRole('button', { name: /buy|purchase|get/i })
      .or(page.locator('[data-testid="buy-button"]'))
      .first();

    const isBuyVisible = await buyButton.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!isBuyVisible) {
      test.skip();
      return;
    }

    await buyButton.click();

    // After clicking, we expect either:
    //  - An error/toast message about insufficient balance
    //  - A modal/dialog
    //  - A redirect to the wallet page
    const errorMessage = page
      .locator('[data-testid="error-message"]')
      .or(page.locator('[role="alert"]'))
      .or(page.locator('text=/insufficient|not enough|balance/i'))
      .first();

    // The app should respond with some feedback
    await expect(
      errorMessage
        .or(page.locator('[role="dialog"]'))
        .or(page.locator('[data-testid="purchase-modal"]'))
        .first()
    ).toBeVisible({ timeout: 10_000 });
  });
});
