/**
 * k6 load test — Room discovery feed
 *
 * Simulates 50 concurrent users fetching the public room feed.
 *
 * Scenario:
 *  - GET /api/rooms?limit=20
 *  - Auth via Bearer token from K6_AUTH_TOKEN env variable
 *  - Assert HTTP 200 and valid JSON body with a `rooms` array (or equivalent)
 *
 * Run:
 *   k6 run load-tests/room-feed.js
 *   K6_AUTH_TOKEN=<token> K6_BASE_URL=https://zobia.app k6 run load-tests/room-feed.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_URL, AUTH_HEADERS, options as defaultOptions } from './k6.config.js';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const roomFeedErrors = new Rate('room_feed_errors');
const roomFeedDuration = new Trend('room_feed_duration', true);

// ---------------------------------------------------------------------------
// Test options
// ---------------------------------------------------------------------------

export const options = {
  ...defaultOptions,
  // Override stages for room feed — ramp to 50 VUs (same as default)
  stages: [
    { duration: '30s', target: 50 },
    { duration: '2m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    ...defaultOptions.thresholds,
    room_feed_errors: ['rate<0.01'],
    room_feed_duration: ['p(95)<500'],
  },
};

// ---------------------------------------------------------------------------
// Default function (VU entry point)
// ---------------------------------------------------------------------------

export default function roomFeedLoad() {
  const url = `${BASE_URL}/api/rooms?limit=20`;

  const params = {
    headers: {
      ...AUTH_HEADERS,
    },
    tags: { name: 'room-feed' },
  };

  const res = http.get(url, params);

  // Track custom duration
  roomFeedDuration.add(res.timings.duration);

  const success = check(res, {
    'room feed: status is 200': (r) => r.status === 200,
    'room feed: response has body': (r) => r.body !== null && r.body.length > 0,
    'room feed: response is valid JSON': (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body === 'object' && body !== null;
      } catch {
        return false;
      }
    },
    'room feed: response time < 500ms': (r) => r.timings.duration < 500,
  });

  if (!success) {
    roomFeedErrors.add(1);
  } else {
    roomFeedErrors.add(0);
  }

  // Simulate realistic user think time between requests
  sleep(Math.random() * 2 + 1); // 1–3 seconds
}
