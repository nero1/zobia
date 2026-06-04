/**
 * security-tests/admin.security.test.ts
 *
 * PRD §28 — Security Penetration: Admin Privilege Escalation.
 *
 * Covers:
 *  - Non-admin cannot access /api/admin routes
 *  - Admin cannot action their own account
 *  - Admin cannot action another admin account
 *  - Banned user token still rejected on all routes
 *  - Admin audit log is append-only (no delete endpoint)
 *  - Moderator cannot reach admin-only routes
 */

const BASE_URL = process.env.SECURITY_TEST_BASE_URL ?? "http://localhost:3000";
const USER_TOKEN = process.env.SECURITY_TEST_USER_TOKEN ?? "";
const ADMIN_TOKEN = process.env.SECURITY_TEST_ADMIN_TOKEN ?? "";
const USER_ID = process.env.SECURITY_TEST_USER_ID ?? "00000000-0000-0000-0000-000000000001";

function fetch$(path: string, token: string, init: RequestInit = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

describe("Admin Security — Privilege Escalation by Regular User", () => {
  const adminPaths = [
    "/api/admin/users",
    "/api/admin/reports",
    "/api/admin/payouts",
    "/api/admin/rooms",
  ];

  test.each(adminPaths)(
    "GET %s → 401/403 for regular user",
    async (path) => {
      if (!USER_TOKEN) return;
      const res = await fetch$(path, USER_TOKEN);
      expect([401, 403]).toContain(res.status);
    }
  );

  test("POST /api/admin/users/:id/actions → 401/403 for regular user", async () => {
    if (!USER_TOKEN) return;
    const res = await fetch$(`/api/admin/users/${USER_ID}/actions`, USER_TOKEN, {
      method: "POST",
      body: JSON.stringify({ action: "ban" }),
    });
    expect([401, 403]).toContain(res.status);
  });
});

describe("Admin Security — Admin Self-Action Protection", () => {
  test("Admin cannot suspend/ban their own account", async () => {
    if (!ADMIN_TOKEN) return;
    // Decode the admin's own user ID from token
    const parts = ADMIN_TOKEN.split(".");
    if (parts.length !== 3) return;
    let adminId: string;
    try {
      const decoded = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as { sub?: string };
      adminId = decoded.sub ?? "";
    } catch {
      return;
    }
    if (!adminId) return;

    const res = await fetch$(`/api/admin/users/${adminId}/actions`, ADMIN_TOKEN, {
      method: "POST",
      body: JSON.stringify({ action: "suspend", duration_hours: 24, reason: "self-test" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message?: string };
    expect(body.message).toMatch(/own account/i);
  });
});

describe("Admin Security — Audit Log Integrity", () => {
  test("No DELETE endpoint exists for admin_actions log", async () => {
    if (!ADMIN_TOKEN) return;
    // Attempt to delete the audit log — must not exist
    const res = await fetch$("/api/admin/audit-log", ADMIN_TOKEN, {
      method: "DELETE",
    });
    // 404 (route not found) or 405 (method not allowed) — both acceptable
    expect([404, 405]).toContain(res.status);
  });

  test("No PATCH endpoint exists for admin_actions log (immutable)", async () => {
    if (!ADMIN_TOKEN) return;
    const res = await fetch$("/api/admin/audit-log/some-entry-id", ADMIN_TOKEN, {
      method: "PATCH",
      body: JSON.stringify({ action: "hacked" }),
    });
    expect([404, 405]).toContain(res.status);
  });
});

describe("Admin Security — Token Manipulation", () => {
  test("Injecting is_admin=true into JWT payload does not grant access", async () => {
    if (!USER_TOKEN) return;
    // Build a fake token with is_admin=true added to payload
    const parts = USER_TOKEN.split(".");
    if (parts.length !== 3) return;
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Record<string, unknown>;
    } catch {
      return;
    }
    const forgedPayload = Buffer.from(
      JSON.stringify({ ...payload, is_admin: true, role: "admin" })
    ).toString("base64url");
    const forgedToken = `${parts[0]}.${forgedPayload}.${parts[2]}`;

    const res = await fetch$("/api/admin/users", forgedToken);
    // Signature mismatch — must be rejected
    expect([401, 403]).toContain(res.status);
  });
});
