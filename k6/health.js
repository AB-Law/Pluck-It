/**
 * k6 smoke test — hits both API health endpoints to verify they respond
 * within acceptable time limits. Designed as a quick sanity check
 * before load tests and as a post-deployment smoke.
 *
 * Target:  .NET Functions API + Python Processor
 * Run:     k6 run k6/health.js
 * Options: BASE_URL=https://your-staging-url k6 run k6/health.js
 */

import http from 'k6/http';
import { sleep, check } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const responseTrend = new Trend('health_response_time');
const errorRate = new Rate('health_errors');

const baseUrlFunctions  = __ENV.API_URL      ?? 'http://localhost:7072';
const baseUrlProcessor  = __ENV.CHAT_API_URL ?? 'http://localhost:7071';

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-vus',
      vus: 1,
      duration: '10s',
    },
  },
  thresholds: {
    // Both health endpoints must respond under 1 second
    'health_response_time': ['p(95)<1000'],
    // No errors allowed in a smoke test
    'health_errors': ['rate<0.01'],
    // HTTP failures should be zero
    'http_req_failed': ['rate<0.01'],
  },
};

export default function () {
  // .NET Functions health check
  const functionsHealth = http.get(`${baseUrlFunctions}/api/health`);
  responseTrend.add(functionsHealth.timings.duration);
  const functionsOk = check(functionsHealth, {
    'Functions API: status 200': r => r.status === 200,
    'Functions API: response < 1000ms': r => r.timings.duration < 1000,
  });
  errorRate.add(!functionsOk);

  // Python Processor health check
  const processorHealth = http.get(`${baseUrlProcessor}/api/health`);
  responseTrend.add(processorHealth.timings.duration);
  const processorOk = check(processorHealth, {
    'Processor API: status 200': r => r.status === 200,
    'Processor API: response < 1000ms': r => r.timings.duration < 1000,
  });
  errorRate.add(!processorOk);

  sleep(1);
}
