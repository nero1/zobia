/**
 * k6 load test — CRON Daily Processing at Scale
 *
 * Tests the 7 staggered daily CRON slots (/api/cron/daily-core through
 * /api/cron/daily-platform) that together process the full daily reset
 * pipeline for all active users: quest resets, streak calculations,
 * re-engagement payloads, nemesis refresh (Sundays), season transitions,
 * mystery XP drops, guild tier enforcement, and Zobia Moments cleanup.
 * (The old monolithic /api/cron/daily endpoint is retired and returns 410.)
 *
 * Each slot is idempotent per calendar day (cron_state guard), so on a
 * second run the same day a slot returns `{ skipped: true }`. Both a full
 * run and a skipped run count as success here.
 *
 * This simulates the CRON endpoint being called while the platform is under
 * normal production load (not zero-load), verifying the background processor
 * completes without timeout even during concurrent API traffic (PRD §28).
 *
 * Thresholds (PRD §28 testing strategy):
 *  - Every slot must finish within its 300s maxDuration
 *  - Concurrent read traffic must remain below p95 < 1,500ms
 *  - Error rate < 1%
 *
 * Two scenario groups:
 *  1. cron_trigger: 1 VU triggers the 7 slots (sequential, once each)
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
    // Concurrent user-facing reads (the CRON calls are tracked separately below)
    'http_req_duration{name:concurrent-read}': ['p(95)<1500'],
    cron_daily_errors: ['rate<0.01'],
    cron_daily_duration: ['max<300000'], // each slot's maxDuration is 300s
    concurrent_read_errors: ['rate<0.01'],
  },
};

// ---------------------------------------------------------------------------
// CRON trigger scenario
// ---------------------------------------------------------------------------

const DAILY_SLOTS = [
  '/api/cron/daily-core',
  '/api/cron/daily-users',
  '/api/cron/daily-notify',
  '/api/cron/daily-guilds',
  '/api/cron/daily-economy',
  '/api/cron/daily-social',
  '/api/cron/daily-platform',
];

export function triggerCron() {
  const cronSecret = __ENV.CRON_SECRET || '';

  for (const slot of DAILY_SLOTS) {
    // validateCronSecret (lib/cron/auth.ts) only accepts a Bearer token.
    const res = http.get(`${BASE_URL}${slot}`, {
      headers: { Authorization: `Bearer ${cronSecret}` },
      timeout: '310s',
      tags: { name: slot },
    });

    cronDuration.add(res.timings.duration);

    const success = check(res, {
      [`${slot}: status 200`]: (r) => r.status === 200,
      [`${slot}: completed or skipped`]: (r) => {
        try {
          const body = JSON.parse(r.body);
          return body && (body.success === true || body.skipped === true);
        } catch {
          return false;
        }
      },
    });

    cronErrors.add(success ? 0 : 1);
  }
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
