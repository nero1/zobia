/**
 * k6 load test — Daily login CRON endpoint
 *
 * Simulates the thundering herd after midnight reset: 500 concurrent
 * users hitting the daily CRON endpoint simultaneously.
 * PRD §28 requires this test to run at 500 VUs.
 *
 * Scenario:
 *  - GET /api/cron/daily
 *  - Authenticated with the CRON_SECRET header
 *  - 500 VUs — models the spike immediately after midnight when all
 *    users attempt to claim their daily login bonus
 *  - Assert response status 200 and acceptable response time
 *
 * Run:
 *   k6 run load-tests/daily-login.js
 *   K6_CRON_SECRET=<secret> K6_BASE_URL=https://zobia.app k6 run load-tests/daily-login.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_URL } from './k6.config.js';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const cronErrors = new Rate('daily_cron_errors');
const cronDuration = new Trend('daily_cron_duration', true);

// ---------------------------------------------------------------------------
// Test options — low VU count for CRON endpoints
// ---------------------------------------------------------------------------

export const options = {
  // PRD §28: thundering herd simulation requires 500 VUs at midnight reset
  stages: [
    { duration: '10s', target: 500 },  // ramp up to 500 VUs (simulates midnight rush)
    { duration: '2m',  target: 500 },  // sustain 500 VUs for 2 minutes
    { duration: '10s', target: 0 },    // ramp down
  ],
  thresholds: {
    // CRON endpoint can be slightly slower — allow up to 2000ms at p95
    http_req_duration: ['p(95)<2000'],
    http_req_failed: ['rate<0.01'],
    daily_cron_errors: ['rate<0.01'],
    daily_cron_duration: ['p(95)<2000'],
  },
};

// ---------------------------------------------------------------------------
// Default function (VU entry point)
// ---------------------------------------------------------------------------

export default function dailyLoginCronLoad() {
  const url = `${BASE_URL}/api/cron/daily`;

  // CRON secret must be provided via environment variable
  const cronSecret = __ENV.K6_CRON_SECRET || __ENV.CRON_SECRET || '';

  const params = {
    headers: {
      'x-cron-secret': cronSecret,
      'Content-Type': 'application/json',
    },
    tags: { name: 'daily-login-cron' },
  };

  const res = http.get(url, params);

  // Track custom duration
  cronDuration.add(res.timings.duration);

  const success = check(res, {
    'daily cron: status is 200 or 202': (r) => r.status === 200 || r.status === 202,
    'daily cron: response has body': (r) => r.body !== null && r.body.length > 0,
    'daily cron: response time < 2000ms': (r) => r.timings.duration < 2000,
    'daily cron: not a 5xx error': (r) => r.status < 500,
  });

  if (!success) {
    cronErrors.add(1);
  } else {
    cronErrors.add(0);
  }

  // Longer sleep between CRON hits — simulate scheduled invocations
  sleep(Math.random() * 5 + 5); // 5–10 seconds between calls
}
