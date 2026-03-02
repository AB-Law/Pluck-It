/**
 * k6 load test — Wardrobe API (GetWardrobe, GetWardrobeItem).
 *
 * Run:     k6 run k6/wardrobe.js
 * Options: API_URL=https://...  AUTH_TOKEN=Bearer\ eyJ...  k6 run k6/wardrobe.js
 *
 * In CI this is run against the staging slot after deployment.
 * AUTH_TOKEN should be a short-lived Google ID token or the Local:DevUserId
 * bypass (sets X-Dev-User-Id header).
 */

import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const baseUrl   = __ENV.API_URL    ?? 'http://localhost:7072';
const authToken = __ENV.AUTH_TOKEN ?? '';
const devUserId = __ENV.DEV_USER_ID ?? 'perf-test-user';

const wardrobeDuration  = new Trend('wardrobe_duration');
const wardrobeErrors    = new Rate('wardrobe_errors');
const requestCount      = new Counter('wardrobe_requests');

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (authToken) {
    h['Authorization'] = authToken;
  } else {
    // Dev bypass: the .NET API checks config["Local:DevUserId"] before real auth
    h['X-Dev-User-Id'] = devUserId;
  }
  return h;
}

export const options = {
  scenarios: {
    /** Warm-up: 1 VU for 10 s */
    warmup: {
      executor: 'constant-vus',
      vus: 1,
      duration: '10s',
      tags: { scenario: 'warmup' },
    },
    /** Load: ramp to 10 VU over 30 s, hold for 60 s, ramp down */
    load: {
      executor: 'ramping-vus',
      startTime: '15s',
      stages: [
        { duration: '30s', target: 10 },
        { duration: '60s', target: 10 },
        { duration: '15s', target: 0 },
      ],
      tags: { scenario: 'load' },
    },
  },
  thresholds: {
    'wardrobe_duration': ['p(95)<2000', 'p(99)<3000'],
    'wardrobe_errors':   ['rate<0.05'],
    'http_req_failed':   ['rate<0.05'],
  },
};

export default function () {
  group('GET /api/wardrobe (list)', () => {
    const res = http.get(
      `${baseUrl}/api/wardrobe?page=0&pageSize=24`,
      { headers: headers() },
    );
    wardrobeDuration.add(res.timings.duration);
    requestCount.add(1);
    const ok = check(res, {
      'status 200': r => r.status === 200,
      'response < 2 s': r => r.timings.duration < 2000,
    });
    wardrobeErrors.add(!ok);
  });

  sleep(1);
}
