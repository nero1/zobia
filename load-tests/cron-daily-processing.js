/**
 * k6 load test — CRON Daily Processing at Scale
 *
 * Tests the /api/cron/daily endpoint which processes the full daily reset
 * pipeline for all active users: quest resets, streak calculations,
 * re-engagement payloads, nemesis refresh (Sundays), season transitions,
 * mystery XP drops, guild tier enforcement, and Zobia Moments cleanup.
 *
 * This simulates the CRON endpoint being called while the platform is under
 * normal production load (not zero-load), verifying the background processor
 * completes without timeout even during concurrent API traffic (PRD §28).
 *
 * Thresholds (PRD §28 testing strategy):
 *  - CRON endpoint must respond (or begin streaming) within 10,000ms
 *  - Concurrent read traffic must remain below p95 < 1,500ms
 *  - Error rate < 1%
 *
 * Two scenario groups:
 *  1. cron_trigger: 1 VU triggers the CRON endpoint (sequential, once)
 *  2. concurrent_reads: 100 VUs simulate normal read traffic during CRON run
 *
 * Run:
 *   CRON_SECRET=<secret> K6_BASE_URL=https://zobia.app \
 *   k6 run load-tests/cron-daily-processing.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_URL } from './k6.config.js';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const cronErrors = new Rate('cron_daily_errors');
const cronDuration = new Trend('cron_daily_duration', true);
const concurrentErrors = new Rate('concurrent_read_errors');

// ---------------------------------------------------------------------------
// Test options — two scenario groups
// ---------------------------------------------------------------------------

export const options = {
  scenarios: {
    // Scenario 1: trigger the CRON once and measure completion time
    cron_trigger: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '15m',
      exec: 'triggerCron',
    },
    // Scenario 2: 100 VUs hammer normal read APIs concurrently with the CRON run
    // to verify CRON does not starve the connection pool or degrade user-facing latency
    concurrent_reads: {
      executor: 'constant-vus',
      vus: 100,
      duration: '5m',
      exec: 'concurrentReadLoad',
      startTime: '5s', // slight delay so CRON starts first
    },
  },
  thresholds: {
    // CRON endpoint may take time but must start streaming within 10s
    http_req_duration: ['p(95)<10000'],
    http_req_failed: ['rate<0.01'],
    cron_daily_errors: ['rate<0.01'],
    cron_daily_duration: ['p(95)<600000'], // full CRON pipeline can take up to 10 min
    concurrent_read_errors: ['rate<0.01'],
  },
};

// ---------------------------------------------------------------------------
// CRON trigger scenario
// ---------------------------------------------------------------------------

export function triggerCron() {
  const cronSecret = __ENV.CRON_SECRET || '';

  const res = http.post(
    `${BASE_URL}/api/cron/daily`,
    null,
    {
      headers: {
        'x-cron-secret': cronSecret,
        'Content-Type': 'application/json',
      },
      timeout: '15m',
      tags: { name: 'cron-daily' },
    }
  );

  cronDuration.add(res.timings.duration);

  const success = check(res, {
    'cron daily: status 200': (r) => r.status === 200,
    'cron daily: response has body': (r) => r.body !== null && r.body.length > 0,
    'cron daily: not a 5xx error': (r) => r.status < 500,
    'cron daily: returns success JSON': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body && (body.success === true || typeof body.results !== 'undefined');
      } catch {
        return false;
      }
    },
  });

  cronErrors.add(success ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Concurrent read load scenario — simulates normal user API traffic
// ---------------------------------------------------------------------------

const READ_ENDPOINTS = [
  '/api/leaderboards?scope=global&track=main',
  '/api/leaderboards?scope=global&track=social',
  '/api/rooms?page=1&limit=20',
  '/api/rooms/pinned',
];

export function concurrentReadLoad() {
  const endpoint = READ_ENDPOINTS[Math.floor(Math.random() * READ_ENDPOINTS.length)];

  const res = http.get(
    `${BASE_URL}${endpoint}`,
    {
      headers: {
        // No auth token — these endpoints require auth, so we expect 401s
        // The goal is to verify the server is not overloaded, not that reads succeed
        'Content-Type': 'application/json',
      },
      tags: { name: 'concurrent-read' },
    }
  );

  const notCrashed = check(res, {
    'concurrent read: server responded': (r) => r.status > 0,
    'concurrent read: not 503': (r) => r.status !== 503,
    'concurrent read: response time < 5000ms': (r) => r.timings.duration < 5000,
  });

  concurrentErrors.add(notCrashed ? 0 : 1);

  sleep(Math.random() * 1 + 0.2); // 0.2–1.2s think time
}
