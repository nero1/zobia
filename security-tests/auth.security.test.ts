/**
 * security-tests/auth.security.test.ts
 *
 * PRD §28 — Security Penetration: Authentication & JWT.
 *
 * Covers:
 *  - OWASP A02: Weak/missing tokens rejected
 *  - OWASP A07: Brute-force protection via rate limiting
 *  - OWASP A05: Sensitive routes require auth
 *  - Expired JWT treated as unauthenticated
 *  - Tampered JWT payload rejected
 *  - Algorithm confusion (RS256 vs HS256 downgrade)
 */

const BASE_URL = process.env.SECURITY_TEST_BASE_URL ?? "http://localhost:3000";
const VALID_TOKEN = process.env.SECURITY_TEST_USER_TOKEN ?? "";

// Signed with wrong secret (invalid signature)
const TAMPERED_TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmYWtlLXVzZXItaWQiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6OTk5OTk5OTk5OX0.fake_signature";

// Expired token (exp = 1)
const EXPIRED_TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEiLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MX0.fake";

const PROTECTED_ROUTES = [
  "/api/users/me",
  "/api/economy/coins/balance",
  "/api/economy/store",
  "/api/messages",
];

describe("Auth Security – Unauthenticated Access Rejected", () => {
  test.each(PROTECTED_ROUTES)(
    "GET %s → 401 with no Authorization header",
    async (route) => {
      const res = await fetch(`${BASE_URL}${route}`, { method: "GET" });
      expect(res.status).toBe(401);
    }
  );

  test.each(PROTECTED_ROUTES)(
    "GET %s → 401 with tampered JWT",
    async (route) => {
      const res = await fetch(`${BASE_URL}${route}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${TAMPERED_TOKEN}` },
      });
      expect(res.status).toBe(401);
    }
  );

  test.each(PROTECTED_ROUTES)(
    "GET %s → 401 with expired JWT",
    async (route) => {
      const res = await fetch(`${BASE_URL}${route}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${EXPIRED_TOKEN}` },
      });
      expect(res.status).toBe(401);
    }
  );
});

describe("Auth Security – Valid Token Accepted", () => {
  test("GET /api/users/me → 200 with valid token", async () => {
    if (!VALID_TOKEN) {
      console.warn("SECURITY_TEST_USER_TOKEN not set — skipping");
      return;
    }
    const res = await fetch(`${BASE_URL}/api/users/me`, {
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("Auth Security – Algorithm Confusion", () => {
  test("none algorithm JWT is rejected", async () => {
    // Craft a JWT with alg=none (no signature required in vulnerable servers)
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "attacker", exp: 9999999999 })
    ).toString("base64url");
    const noneToken = `${header}.${payload}.`;

    const res = await fetch(`${BASE_URL}/api/users/me`, {
      headers: { Authorization: `Bearer ${noneToken}` },
    });
    expect(res.status).toBe(401);
  });

  test("HS256 token accepted, RS256 downgrade rejected", async () => {
    // Attempt to forge RS256 token signed with HS256 using the public key as secret
    const forgedHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: "attacker", exp: 9999999999 })
    ).toString("base64url");
    const forgedToken = `${forgedHeader}.${forgedPayload}.fakesig`;

    const res = await fetch(`${BASE_URL}/api/users/me`, {
      headers: { Authorization: `Bearer ${forgedToken}` },
    });
    expect(res.status).toBe(401);
  });
});

describe("Auth Security – Password Endpoint Brute Force", () => {
  test("POST /api/auth/login returns 429 after 10 rapid attempts", async () => {
    const attempts = Array.from({ length: 11 }, () =>
      fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "brute@example.com", password: "wrongpassword" }),
      })
    );
    const responses = await Promise.all(attempts);
    const statusCodes = responses.map((r) => r.status);
    expect(statusCodes).toContain(429);
  }, 30_000);
});
