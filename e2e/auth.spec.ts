/**
 * E2E tests for authentication flow.
 *
 * Verifies:
 *  - Unauthenticated users are redirected to /login from the home page
 *  - The login page renders with Google and Telegram sign-in buttons
 *  - Invalid/missing auth tokens return 401 from protected API routes
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Auth redirect
// ---------------------------------------------------------------------------

test.describe('Authentication redirect', () => {
  test('home page redirects unauthenticated users to /login', async ({ page }) => {
    // Navigate to root without any auth cookies/headers
    const response = await page.goto('/', { waitUntil: 'networkidle' });

    // Should end up on the login page
    await expect(page).toHaveURL(/\/login/);
  });

  test('unauthenticated requests to dashboard are redirected to /login', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// Login page rendering
// ---------------------------------------------------------------------------

test.describe('Login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login', { waitUntil: 'networkidle' });
  });

  test('renders the login page successfully (HTTP 200)', async ({ page }) => {
    const response = await page.request.get('/login');
    expect(response.status()).toBeLessThan(400);
  });

  test('shows a Google sign-in button', async ({ page }) => {
    // Look for a button/link with Google-related text or aria-label
    const googleButton = page
      .getByRole('button', { name: /google/i })
      .or(page.getByRole('link', { name: /google/i }))
      .or(page.locator('[data-provider="google"]'))
      .or(page.locator('text=Continue with Google'))
      .or(page.locator('text=Sign in with Google'));

    await expect(googleButton.first()).toBeVisible({ timeout: 10_000 });
  });

  test('shows a Telegram sign-in button', async ({ page }) => {
    const telegramButton = page
      .getByRole('button', { name: /telegram/i })
      .or(page.getByRole('link', { name: /telegram/i }))
      .or(page.locator('[data-provider="telegram"]'))
      .or(page.locator('text=Continue with Telegram'))
      .or(page.locator('text=Sign in with Telegram'));

    await expect(telegramButton.first()).toBeVisible({ timeout: 10_000 });
  });

  test('login page has a visible heading or title', async ({ page }) => {
    // Any meaningful heading on the login page
    const heading = page
      .getByRole('heading')
      .or(page.locator('h1, h2'))
      .first();

    await expect(heading).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// API route auth enforcement
// ---------------------------------------------------------------------------

test.describe('API authentication enforcement', () => {
  test('protected API route returns 401 without auth token', async ({ request }) => {
    const response = await request.get('/api/me');
    // Should be 401 (Unauthorized) or 403 (Forbidden)
    expect([401, 403]).toContain(response.status());
  });

  test('protected API route returns 401 with invalid Bearer token', async ({ request }) => {
    const response = await request.get('/api/me', {
      headers: {
        Authorization: 'Bearer invalid-token-xyz',
      },
    });
    expect([401, 403]).toContain(response.status());
  });

  test('wallet API route returns 401 without auth', async ({ request }) => {
    const response = await request.get('/api/wallet');
    expect([401, 403]).toContain(response.status());
  });
});
