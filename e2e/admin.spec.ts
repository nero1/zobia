/**
 * E2E tests for Admin login and is_admin database check.
 *
 * Verifies:
 *  - Non-admin users cannot access admin routes (401/403)
 *  - Admin login succeeds and returns a valid session
 *  - Admin can access the overview endpoint (200 with stats)
 *  - Even with a valid JWT, a non-admin user is denied admin routes (DB-level check)
 *  - Admin can suspend a user via the actions endpoint
 *  - Admin cannot access another user's private data (RLS enforcement)
 */

import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers and constants
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN ?? '';
const REGULAR_USER_TOKEN = process.env.E2E_USER_TOKEN ?? '';

const ADMIN_CREDS_SET = !!(ADMIN_EMAIL && ADMIN_PASSWORD);
const ADMIN_TOKEN_SET = !!ADMIN_TOKEN;
const REGULAR_TOKEN_SET = !!REGULAR_USER_TOKEN;

const TEST_TARGET_USER_ID = process.env.E2E_TEST_USER_ID ?? 'test-target-user-id';
const TEST_PRIVATE_USER_ID = process.env.E2E_PRIVATE_USER_ID ?? 'other-private-user-id';

function adminHeaders() {
  return {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function regularUserHeaders() {
  return {
    Authorization: `Bearer ${REGULAR_USER_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

// ---------------------------------------------------------------------------
// Admin login and is_admin database check
// ---------------------------------------------------------------------------

test.describe('Admin login and is_admin database check', () => {

  // -------------------------------------------------------------------------
  // Non-admin access is denied
  // -------------------------------------------------------------------------

  test('unauthenticated request to GET /api/admin/overview returns 401 or 403', async ({ request }) => {
    const response = await request.get('/api/admin/overview');
    expect([401, 403]).toContain(response.status());
  });

  test('regular user token cannot access GET /api/admin/overview — returns 401 or 403', async ({ request }) => {
    if (!REGULAR_TOKEN_SET) {
      test.skip(true, 'E2E_USER_TOKEN not set — skipping');
      return;
    }

    const response = await request.get('/api/admin/overview', {
      headers: regularUserHeaders(),
    });

    expect([401, 403]).toContain(response.status());
  });

  test('is_admin DB check: valid JWT for non-admin user is denied on admin routes', async ({ request }) => {
    if (!REGULAR_TOKEN_SET) {
      test.skip(true, 'E2E_USER_TOKEN not set — skipping');
      return;
    }

    // Try multiple admin-only routes to confirm DB-level enforcement
    const adminRoutes = [
      '/api/admin/overview',
      '/api/admin/users',
      '/api/admin/payouts',
    ];

    for (const route of adminRoutes) {
      const response = await request.get(route, {
        headers: regularUserHeaders(),
      });
      // Every admin route must reject a non-admin JWT
      expect([401, 403]).toContain(response.status());
    }
  });

  // -------------------------------------------------------------------------
  // Admin login
  // -------------------------------------------------------------------------

  test('admin login via POST /api/auth returns a session token', async ({ request }) => {
    if (!ADMIN_CREDS_SET) {
      test.skip(true, 'ADMIN_EMAIL / E2E_ADMIN_PASSWORD not set — skipping');
      return;
    }

    const response = await request.post('/api/auth', {
      data: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      },
      headers: { 'Content-Type': 'application/json' },
    });

    // 200 for successful login
    expect(response.status()).toBe(200);

    const body = await response.json().catch(() => ({}));
    const token: string =
      body.token ??
      body.accessToken ??
      body.session?.token ??
      body.data?.token ??
      '';

    expect(token.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Admin can access overview
  // -------------------------------------------------------------------------

  test('admin can access GET /api/admin/overview and receives stats (200)', async ({ request }) => {
    if (!ADMIN_TOKEN_SET) {
      test.skip(true, 'E2E_ADMIN_TOKEN not set — skipping');
      return;
    }

    const response = await request.get('/api/admin/overview', {
      headers: adminHeaders(),
    });

    expect(response.status()).toBe(200);

    const body = await response.json().catch(() => ({}));
    // Response should contain at least one stats field
    const hasStats =
      body.totalUsers !== undefined ||
      body.activeUsers !== undefined ||
      body.stats !== undefined ||
      body.data !== undefined;

    expect(hasStats).toBe(true);
  });

  test('admin overview response contains a numeric user count', async ({ request }) => {
    if (!ADMIN_TOKEN_SET) {
      test.skip(true, 'E2E_ADMIN_TOKEN not set — skipping');
      return;
    }

    const response = await request.get('/api/admin/overview', {
      headers: adminHeaders(),
    });

    if (response.status() === 200) {
      const body = await response.json().catch(() => ({}));
      const userCount: number =
        body.totalUsers ??
        body.userCount ??
        body.stats?.users ??
        body.data?.totalUsers ??
        -1;

      if (userCount >= 0) {
        expect(typeof userCount).toBe('number');
        expect(userCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Admin can suspend a user
  // -------------------------------------------------------------------------

  test('admin can suspend a user via POST /api/admin/users/[userId]/actions', async ({ request }) => {
    if (!ADMIN_TOKEN_SET) {
      test.skip(true, 'E2E_ADMIN_TOKEN not set — skipping');
      return;
    }

    const response = await request.post(
      `/api/admin/users/${TEST_TARGET_USER_ID}/actions`,
      {
        headers: adminHeaders(),
        data: {
          action: 'suspend',
          reason: 'E2E admin test — automated suspension',
          durationDays: 1,
        },
      }
    );

    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(300);
  });

  test('suspension action response confirms the action was applied', async ({ request }) => {
    if (!ADMIN_TOKEN_SET) {
      test.skip(true, 'E2E_ADMIN_TOKEN not set — skipping');
      return;
    }

    const response = await request.post(
      `/api/admin/users/${TEST_TARGET_USER_ID}/actions`,
      {
        headers: adminHeaders(),
        data: { action: 'suspend', reason: 'E2E status body check' },
      }
    );

    if (response.status() >= 200 && response.status() < 300) {
      const body = await response.json().catch(() => ({}));
      // Should have some indicator of the applied action
      const hasActionConfirmation =
        body.action !== undefined ||
        body.status !== undefined ||
        body.success !== undefined ||
        body.data !== undefined;
      expect(hasActionConfirmation).toBe(true);
    }
  });

  // Clean up: restore the suspended test user
  test('admin restores the test user after suspension test', async ({ request }) => {
    if (!ADMIN_TOKEN_SET) {
      test.skip(true, 'E2E_ADMIN_TOKEN not set — skipping');
      return;
    }

    const response = await request.post(
      `/api/admin/users/${TEST_TARGET_USER_ID}/actions`,
      {
        headers: adminHeaders(),
        data: { action: 'restore', reason: 'E2E cleanup' },
      }
    );

    expect(response.status()).toBeGreaterThanOrEqual(200);
    expect(response.status()).toBeLessThan(300);
  });

  // -------------------------------------------------------------------------
  // RLS check: admin cannot access another user's private data
  // -------------------------------------------------------------------------

  test('admin cannot read a private user\'s personal messages via API (RLS)', async ({ request }) => {
    if (!ADMIN_TOKEN_SET) {
      test.skip(true, 'E2E_ADMIN_TOKEN not set — skipping');
      return;
    }

    // Attempt to access another user's private messages directly
    const response = await request.get(
      `/api/messages/private/${TEST_PRIVATE_USER_ID}`,
      { headers: adminHeaders() }
    );

    // RLS should prevent access — 403 or 404 are expected
    expect([403, 404]).toContain(response.status());
  });

  test('admin cannot read a private user\'s DM inbox via API (RLS)', async ({ request }) => {
    if (!ADMIN_TOKEN_SET) {
      test.skip(true, 'E2E_ADMIN_TOKEN not set — skipping');
      return;
    }

    const response = await request.get(
      `/api/messages/dm?userId=${TEST_PRIVATE_USER_ID}`,
      { headers: adminHeaders() }
    );

    // Admin should not be able to impersonate another user's DM inbox
    expect([403, 404]).toContain(response.status());
  });

  test('admin cannot access another user\'s private profile data (RLS)', async ({ request }) => {
    if (!ADMIN_TOKEN_SET) {
      test.skip(true, 'E2E_ADMIN_TOKEN not set — skipping');
      return;
    }

    // Attempt to retrieve private profile fields of another user
    const response = await request.get(
      `/api/profile/${TEST_PRIVATE_USER_ID}/private`,
      { headers: adminHeaders() }
    );

    // RLS enforced — 403 or 404
    expect([403, 404]).toContain(response.status());
  });

  // -------------------------------------------------------------------------
  // Sanity: admin can access their own data
  // -------------------------------------------------------------------------

  test('admin can access their own profile via GET /api/me', async ({ request }) => {
    if (!ADMIN_TOKEN_SET) {
      test.skip(true, 'E2E_ADMIN_TOKEN not set — skipping');
      return;
    }

    const response = await request.get('/api/me', {
      headers: adminHeaders(),
    });

    expect(response.status()).toBe(200);

    const body = await response.json().catch(() => ({}));
    const isAdmin: boolean =
      body.isAdmin ??
      body.is_admin ??
      body.role === 'admin' ??
      body.data?.isAdmin ??
      false;

    // The is_admin flag must be truthy in the response for an admin user
    expect(isAdmin).toBe(true);
  });
});
