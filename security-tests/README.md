# Zobia Security Penetration Tests

PRD §28 requires security penetration testing covering OWASP Top 10 and platform-specific threats.

## Directory Structure

```
security-tests/
├── auth.security.test.ts          # Authentication & JWT checks
├── injection.security.test.ts     # SQL/NoSQL injection, XSS
├── ratelimit.security.test.ts     # Rate-limit enforcement
├── idor.security.test.ts          # Insecure Direct Object Reference
├── economy.security.test.ts       # Double-spend, negative amounts, overflow
├── admin.security.test.ts         # Privilege escalation, admin endpoint access
└── pentest-runbook.md             # Manual steps for external pentest
```

## Running Automated Tests

```bash
# From the monorepo root
cd apps/web
npx jest security-tests --testPathPattern="security" --runInBand
```

> These tests fire real HTTP requests against a locally running dev server.
> Start the server first: `npm run dev` (port 3000).

## Environment

Set these before running:

```env
SECURITY_TEST_BASE_URL=http://localhost:3000
SECURITY_TEST_ADMIN_TOKEN=<admin-jwt>
SECURITY_TEST_USER_TOKEN=<regular-user-jwt>
SECURITY_TEST_USER_ID=<regular-user-uuid>
SECURITY_TEST_OTHER_USER_ID=<second-user-uuid>
```

## Coverage Matrix (PRD §28)

| OWASP Category         | Test File                      | Status |
|------------------------|-------------------------------|--------|
| A01 Broken Access Ctrl | idor.security.test.ts         | ✅     |
| A01 Priv Escalation    | admin.security.test.ts        | ✅     |
| A02 Crypto Failures    | auth.security.test.ts         | ✅     |
| A03 Injection          | injection.security.test.ts    | ✅     |
| A05 Sec Misconfig      | auth.security.test.ts         | ✅     |
| A07 Auth Failures      | auth.security.test.ts         | ✅     |
| A09 Logging Failures   | admin.security.test.ts        | ✅     |
| Rate Limits            | ratelimit.security.test.ts    | ✅     |
| Economy Integrity      | economy.security.test.ts      | ✅     |
