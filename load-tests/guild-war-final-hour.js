/**
 * k6 load test — Guild War Final Hour
 *
 * Simulates 500 concurrent users simultaneously submitting war point
 * activities during the Guild War Final Hour.
 *
 * PRD §28: This test must run at 500 VUs.
 *
 * Scenario:
 *  - 500 VUs authenticate and POST to the Guild War activity endpoint
 *  - Uses a shared war ID from the K6_WAR_ID environment variable
 *  - Models the intense submission burst during the final hour of a war
 *
 * Thresholds:
 *  - p(95) response time < 500ms
 *  - error rate < 1%
 *
 * Run:
 *   K6_AUTH_TOKEN=<token> K6_WAR_ID=<uuid> K6_BASE_URL=https://zobia.app \
 *   k6 run load-tests/guild-war-final-hour.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { BASE_URL, AUTH_HEADERS } from './k6.config.js';

// ---------------------------------------------------------------------------
// Custom metrics
// ---------------------------------------------------------------------------

const warErrors = new Rate('guild_war_errors');
const warDuration = new Trend('guild_war_duration', true);

// ---------------------------------------------------------------------------
// Test options
// ---------------------------------------------------------------------------

export const options = {
  // PRD §28: Guild War Final Hour must sustain 500 concurrent VUs
  stages: [
    { duration: '30s', target: 500 },  // ramp up to 500 VUs over 30 seconds
    { duration: '2m',  target: 500 },  // sustain 500 VUs for 2 minutes
    { duration: '30s', target: 0 },    // ramp down to 0 over 30 seconds
  ],
  thresholds: {
    // p(95) must be under 500ms during the final hour surge
    http_req_duration: ['p(95)<500'],
    // Less than 1% of requests should fail
    http_req_failed: ['rate<0.01'],
    guild_war_errors: ['rate<0.01'],
    guild_war_duration: ['p(95)<500'],
  },
};

// ---------------------------------------------------------------------------
// Setup — resolve war ID
// ---------------------------------------------------------------------------

/**
 * Retrieve the war ID from the environment.
 * K6_WAR_ID must be set before running this test.
 */
const WAR_ID = __ENV.K6_WAR_ID || '';

// ---------------------------------------------------------------------------
// Default function (VU entry point)
// ---------------------------------------------------------------------------

export default function guildWarFinalHourLoad() {
  if (!WAR_ID) {
    console.error('K6_WAR_ID environment variable is required');
    return;
  }

  const params = {
    headers: {
      ...AUTH_HEADERS,
    },
    tags: { name: 'guild-war-final-hour' },
  };

  // Each VU submits a war point activity (e.g. a contribution event)
  // The war leaderboard endpoint is also checked to simulate real usage
  const activities = [
    // 1. Submit a war point activity (contribute to the war effort)
    () => {
      const res = http.post(
        `${BASE_URL}/api/guilds/wars/${WAR_ID}/activity`,
        JSON.stringify({ action: 'message_sent', points: 10 }),
        params
      );
      warDuration.add(res.timings.duration);
      return check(res, {
        'war activity: status 2xx': (r) => r.status >= 200 && r.status < 300,
        'war activity: response time < 500ms': (r) => r.timings.duration < 500,
      });
    },
    // 2. Poll war status (players check the scoreboard during final hour)
    () => {
      const res = http.get(
        `${BASE_URL}/api/guilds/wars/${WAR_ID}`,
        params
      );
      warDuration.add(res.timings.duration);
      return check(res, {
        'war status: status 200': (r) => r.status === 200,
        'war status: response time < 500ms': (r) => r.timings.duration < 500,
      });
    },
    // 3. Check individual leaderboard position
    () => {
      const res = http.get(
        `${BASE_URL}/api/guilds/wars/${WAR_ID}/leaderboard`,
        params
      );
      warDuration.add(res.timings.duration);
      return check(res, {
        'war leaderboard: status 200': (r) => r.status === 200,
        'war leaderboard: response time < 500ms': (r) => r.timings.duration < 500,
      });
    },
  ];

  // Each VU cycles through activities to model realistic final-hour behaviour
  const activityIdx = Math.floor(Math.random() * activities.length);
  const success = activities[activityIdx]();

  warErrors.add(success ? 0 : 1);

  // Short think time — final hour is intense, minimal user pausing
  sleep(Math.random() * 1 + 0.5); // 0.5–1.5 seconds
}
