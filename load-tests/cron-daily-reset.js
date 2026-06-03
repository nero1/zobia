/**
 * k6 load test — CRON Daily Reset thundering herd
 *
 * Simulates 10,000 users all triggering login events immediately after
 * the midnight daily reset — the thundering herd scenario described in PRD §28.
 *
 * 500 VUs simultaneously hit the daily login endpoint, modelling the burst
 * of user activity right after the CRON resets daily quests and streaks.
 *
 * Thresholds:
 *  - p(95) response time < 2,000ms (daily login is heavier than reads)
 *  - error rate < 1%
 *
 * Run:
 *   K6_AUTH_TOKEN=<token> K6_BASE_URL=https://zobia.app \
 *   k6 run load-tests/cron-daily-reset.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_URL, AUTH_HEADERS } from './k6.config.js';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const resetErrors = new Rate('cron_reset_errors');
const resetDuration = new Trend('cron_reset_duration', true);

// ---------------------------------------------------------------------------
// Test options
// ---------------------------------------------------------------------------

export const options = {
  // PRD §28: thundering herd — 500 VUs simultaneously hitting the daily login
  // endpoint models the rush of 10,000 users immediately after midnight reset.
  stages: [
    { duration: '10s', target: 500 },  // rapid ramp-up simulating midnight burst
    { duration: '2m',  target: 500 },  // sustain 500 VUs for 2 minutes
    { duration: '10s', target: 0 },    // ramp down
  ],
  thresholds: {
    // Daily login involves DB writes — allow up to 2000ms at p95
    http_req_duration: ['p(95)<2000'],
    // Less than 1% failure rate
    http_req_failed: ['rate<0.01'],
    cron_reset_errors: ['rate<0.01'],
    cron_reset_duration: ['p(95)<2000'],
  },
};

// ---------------------------------------------------------------------------
// Default function (VU entry point)
// ---------------------------------------------------------------------------

export default function cronDailyResetLoad() {
  const params = {
    headers: {
      ...AUTH_HEADERS,
    },
    tags: { name: 'cron-daily-reset' },
  };

  // Each VU hits the daily login endpoint — idempotent per user per day
  const res = http.post(
    `${BASE_URL}/api/login/daily`,
    null,
    params
  );

  resetDuration.add(res.timings.duration);

  const success = check(res, {
    'daily login: status 200': (r) => r.status === 200,
    'daily login: response has body': (r) => r.body !== null && r.body.length > 0,
    'daily login: response is valid JSON': (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body === 'object' && body !== null;
      } catch {
        return false;
      }
    },
    'daily login: response time < 2000ms': (r) => r.timings.duration < 2000,
    'daily login: not a 5xx error': (r) => r.status < 500,
  });

  resetErrors.add(success ? 0 : 1);

  // Very short think time — users are rushing to claim the daily reset bonus
  sleep(Math.random() * 2 + 0.5); // 0.5–2.5 seconds
}
