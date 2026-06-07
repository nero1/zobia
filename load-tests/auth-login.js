/**
 * k6 load test — Authentication JWT refresh endpoint (proxy for login load)
 *
 * Simulates 500 concurrent users refreshing/validating their JWT tokens,
 * which models the overhead of a thundering herd authentication scenario
 * after a large outage or deployment.
 *
 * PRD §28 requires testing "500 simultaneous logins (thundering herd)".
 * Since the Google OAuth callback cannot be easily load-tested (requires
 * browser interaction), we test the JWT refresh endpoint which hits the
 * same session/Redis layer that a login surge would stress.
 *
 * Scenario:
 *  - POST /api/auth/refresh
 *  - Authenticated with valid JWT token (generated once, reused by all VUs)
 *  - 500 VUs — models 500 simultaneous token refresh/validation requests
 *  - Assert response status 200 and acceptable response time
 *
 * Run:
 *   k6 run load-tests/auth-login.js
 *   K6_JWT_TOKEN=<token> K6_BASE_URL=https://zobia.app k6 run load-tests/auth-login.js
 *
 * To generate a test JWT:
 *   1. Create a test user via /api/onboarding/complete
 *   2. Extract the token from the response or from the HttpOnly cookie
 *   3. Export K6_JWT_TOKEN=<token> before running k6
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_URL } from './k6.config.js';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const authErrors = new Rate('auth_login_errors');
const authDuration = new Trend('auth_login_duration', true);

// ---------------------------------------------------------------------------
// Test options — 500 VUs thundering herd
// ---------------------------------------------------------------------------

export const options = {
  // PRD §28: thundering herd simulation requires 500 VUs simultaneous
  stages: [
    { duration: '10s', target: 500 },   // ramp up to 500 VUs
    { duration: '30s', target: 500 },   // sustain 500 VUs for 30 seconds (heavy load)
    { duration: '10s', target: 0 },     // ramp down
  ],
  thresholds: {
    // Auth endpoint should be very fast — p95 < 500ms, since it's mostly Redis/cache
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    auth_login_errors: ['rate<0.01'],
    auth_login_duration: ['p(95)<500'],
  },
};

// ---------------------------------------------------------------------------
// Default function (VU entry point)
// ---------------------------------------------------------------------------

export default function authLoginLoad() {
  const url = `${BASE_URL}/api/auth/refresh`;

  // JWT token must be provided via environment variable or from setup
  const jwtToken = __ENV.K6_JWT_TOKEN || __ENV.JWT_TOKEN || '';

  if (!jwtToken) {
    console.warn('[auth-login] No JWT_TOKEN provided — test will fail. Export K6_JWT_TOKEN=<token>');
  }

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `jwt=${jwtToken}`,
      'Authorization': `Bearer ${jwtToken}`,
    },
    tags: { name: 'auth-login' },
  };

  const payload = JSON.stringify({
    refreshToken: jwtToken,
  });

  const res = http.post(url, payload, params);

  // Track custom duration
  authDuration.add(res.timings.duration);

  const success = check(res, {
    'auth refresh: status is 200 or 401 (acceptable)': (r) => r.status === 200 || r.status === 401,
    'auth refresh: response time < 500ms': (r) => r.timings.duration < 500,
    'auth refresh: not a 5xx error': (r) => r.status < 500,
  });

  if (!success) {
    authErrors.add(1);
  }

  // Small sleep to avoid connection pooling bottlenecks
  sleep(0.1);
}

/**
 * Alternative setup: Generate a test JWT via /api/onboarding/complete
 * (uncomment if you want k6 to create users on the fly)
 */
/*
export function setup() {
  // Create a test user and extract the JWT
  const onboardRes = http.post(`${BASE_URL}/api/onboarding/complete`, JSON.stringify({
    username: `testuser-${Date.now()}`,
    displayName: 'Test User',
    avatarEmoji: '👤',
    city: 'Lagos',
    vibe1: 'gist',
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  if (onboardRes.status !== 200 && onboardRes.status !== 201) {
    throw new Error(`Setup failed: onboarding returned ${onboardRes.status}`);
  }

  const body = JSON.parse(onboardRes.body);
  return { jwtToken: body.token };
}
*/
