import { test, expect } from "@playwright/test";

/**
 * E2E tests — Admin login and is_admin database check
 *
 * PRD §28 requirement: "Admin login and is_admin database check verification"
 *
 * Tests:
 *  1. Non-admin JWT cannot access admin routes (403)
 *  2. Admin login succeeds via email + password + 2FA stub
 *  3. Admin can access /api/admin/overview (200 with stats)
 *  4. Even with a valid non-admin JWT, admin routes return 403
 *  5. Admin can suspend a user
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const TEST_USER_ID = process.env.TEST_USER_ID ?? "";

test.describe("Admin login and is_admin database check", () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "Set ADMIN_EMAIL and ADMIN_PASSWORD env vars to run admin tests");

  let adminToken: string;
  let nonAdminToken: string;

  test.beforeAll(async ({ request }) => {
    // Register a non-admin test user via onboarding
    const userResp = await request.post(`${BASE_URL}/api/onboarding/complete`, {
      data: {
        username: `test_nonadmin_${Date.now()}`,
        displayName: "Non Admin",
        avatarEmoji: "🙂",
        city: "Lagos",
        vibeAnswers: ["argue", "crew", "vibing", "Lagos"],
      },
    });
    if (userResp.ok()) {
      const body = await userResp.json();
      nonAdminToken = body.token ?? "";
    }
  });

  test("non-admin user cannot access /api/admin/overview", async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/admin/overview`, {
      headers: nonAdminToken ? { Authorization: `Bearer ${nonAdminToken}` } : {},
    });
    expect(resp.status()).toBeGreaterThanOrEqual(401);
    expect(resp.status()).toBeLessThanOrEqual(403);
  });

  test("request without any token cannot access admin routes", async ({ request }) => {
    const resp = await request.get(`${BASE_URL}/api/admin/overview`);
    expect(resp.status()).toBeGreaterThanOrEqual(401);
    expect(resp.status()).toBeLessThanOrEqual(403);
  });

  test("admin login returns a JWT token", async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/auth/admin/login`, {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });

    // Admin login endpoint may require 2FA; expect either 200 (with token) or 202 (2FA required)
    expect([200, 202]).toContain(resp.status());
    if (resp.status() === 200) {
      const body = await resp.json();
      expect(body.token).toBeTruthy();
      adminToken = body.token;
    }
  });

  test("admin JWT can access /api/admin/overview", async ({ request }) => {
    test.skip(!adminToken, "Admin token not available — skipping overview access test");

    const resp = await request.get(`${BASE_URL}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty("dailyActiveUsers");
    expect(body).toHaveProperty("newRegistrationsToday");
  });

  test("non-admin JWT is rejected even when Authorization header is present (DB-level check)", async ({ request }) => {
    test.skip(!nonAdminToken, "No non-admin token available");

    // The DB-level is_admin check means the JWT is valid but the DB role denies access
    const resp = await request.get(`${BASE_URL}/api/admin/financial`, {
      headers: { Authorization: `Bearer ${nonAdminToken}` },
    });
    expect(resp.status()).toBe(403);
  });

  test("admin can suspend a user", async ({ request }) => {
    test.skip(!adminToken || !TEST_USER_ID, "Admin token or TEST_USER_ID not available");

    const resp = await request.post(
      `${BASE_URL}/api/admin/users/${TEST_USER_ID}/actions`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { action: "suspend", reason: "E2E test suspension", durationDays: 1 },
      }
    );
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.status).toBe("suspended");
  });

  test("admin can restore a suspended user", async ({ request }) => {
    test.skip(!adminToken || !TEST_USER_ID, "Admin token or TEST_USER_ID not available");

    const resp = await request.post(
      `${BASE_URL}/api/admin/users/${TEST_USER_ID}/actions`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { action: "restore" },
      }
    );
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.status).toBe("active");
  });
});
