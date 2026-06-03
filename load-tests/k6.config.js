/**
 * k6 load test configuration.
 *
 * Defines the default options used across all Zobia load tests.
 * Import and spread these options in individual test files, then override
 * as needed for each scenario.
 *
 * Load profile:
 *  0  →  30s : ramp up to 50 VUs
 *  30s → 2m30s: sustained at 50 VUs
 *  2m30s → 3m : ramp down to 0
 *
 * Thresholds:
 *  - p(95) of http_req_duration < 500ms
 *  - error rate (non-2xx) < 1%
 */

export const options = {
  stages: [
    { duration: '30s', target: 50 },   // ramp up to 50 VUs over 30 seconds
    { duration: '2m', target: 50 },    // sustain 50 VUs for 2 minutes
    { duration: '30s', target: 0 },    // ramp down to 0 over 30 seconds
  ],
  thresholds: {
    // 95th percentile response time must be under 500ms
    http_req_duration: ['p(95)<500'],
    // Less than 1% of requests should fail (non-2xx)
    http_req_failed: ['rate<0.01'],
  },
};

/**
 * Base URL helper — reads from the K6_BASE_URL environment variable.
 * Falls back to localhost:3000 for local development.
 *
 * @example
 * import { BASE_URL } from './k6.config.js';
 * const res = http.get(`${BASE_URL}/api/rooms`);
 */
export const BASE_URL = __ENV.K6_BASE_URL || 'http://localhost:3000';

/**
 * Default auth headers for authenticated endpoints.
 * Set K6_AUTH_TOKEN in your environment or CI secrets.
 */
export const AUTH_HEADERS = {
  Authorization: `Bearer ${__ENV.K6_AUTH_TOKEN || ''}`,
  'Content-Type': 'application/json',
};
