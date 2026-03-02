/**
 * k6 load test — Python Processor non-LLM endpoints.
 *
 * Tests the memory and digest endpoints which exercise FastAPI + Cosmos DB
 * WITHOUT calling Azure OpenAI — no cost, safe to run any time.
 *
 * Endpoints tested:
 *   GET  /api/health           — liveness probe
 *   GET  /api/chat/memory      — Cosmos read (Conversations container)
 *   GET  /api/digest/latest    — Cosmos read (Digests container)
 *
 * NOTE: /api/chat (the SSE streaming endpoint) is intentionally excluded
 * because it calls Azure OpenAI and would incur real costs. Test that
 * endpoint manually via curl only when you explicitly want to benchmark LLM
 * latency:
 *   curl -N -X POST http://localhost:7071/api/chat \
 *     -H "Content-Type: application/json" \
 *     -d '{"message":"test","history":[]}'
 *
 * Run:     k6 run k6/chat.js
 * Options: CHAT_API_URL=https://...  DEV_USER_ID=perf-test-user k6 run k6/chat.js
 */

import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const baseUrl   = __ENV.CHAT_API_URL ?? 'http://localhost:7071';
const devUserId = __ENV.DEV_USER_ID  ?? 'perf-test-user';

const processorDuration = new Trend('processor_duration');
const processorErrors   = new Rate('processor_errors');

export const options = {
  scenarios: {
    /** 5 VUs for 30 s — tests Processor HTTP + Cosmos reads, zero LLM calls */
    processor_load: {
      executor: 'constant-vus',
      vus: 5,
      duration: '30s',
    },
  },
  thresholds: {
    'processor_duration': ['p(95)<1000', 'p(99)<2000'],
    'processor_errors':   ['rate<0.05'],
    'http_req_failed':    ['rate<0.01'],
  },
};

function headers() {
  return { 'X-Dev-User-Id': devUserId };
}

export default function () {
  group('GET /api/health', () => {
    const res = http.get(`${baseUrl}/api/health`, { headers: headers() });
    processorDuration.add(res.timings.duration);
    const ok = check(res, {
      'health: status 200': r => r.status === 200,
      'health: response < 1s': r => r.timings.duration < 1000,
    });
    processorErrors.add(!ok);
  });

  group('GET /api/chat/memory', () => {
    const res = http.get(`${baseUrl}/api/chat/memory`, { headers: headers() });
    processorDuration.add(res.timings.duration);
    const ok = check(res, {
      'memory: status 200': r => r.status === 200,
      'memory: has summary field': r => JSON.parse(r.body).hasOwnProperty('summary'),
      'memory: response < 1s': r => r.timings.duration < 1000,
    });
    processorErrors.add(!ok);
  });

  group('GET /api/digest/latest', () => {
    const res = http.get(`${baseUrl}/api/digest/latest`, { headers: headers() });
    processorDuration.add(res.timings.duration);
    const ok = check(res, {
      'digest: status 200': r => r.status === 200,
      'digest: has digest field': r => JSON.parse(r.body).hasOwnProperty('digest'),
      'digest: response < 1s': r => r.timings.duration < 1000,
    });
    processorErrors.add(!ok);
  });

  sleep(1);
}
