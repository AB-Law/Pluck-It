# k6 Performance Tests

End-to-end load and smoke tests for the PluckIt API using [k6](https://k6.io).

## Prerequisites

```bash
# macOS
brew install k6

# Docker
docker run --rm -v $(pwd)/k6:/scripts grafana/k6 run /scripts/health.js
```

## Test Files

| File | Purpose | Typical duration |
|---|---|---|
| `health.js` | Smoke — verifies both APIs respond < 1 s | ~10 s |
| `wardrobe.js` | Load — `GET /api/wardrobe` with 10 VU ramp | ~2 min |
| `chat.js` | Load — `POST /api/chat` SSE streaming, 3 VUs | ~1 min |

## Running Locally

```bash
# Against local dev servers (no auth required — uses LOCAL_DEV_USER_ID bypass)
k6 run k6/health.js
k6 run k6/wardrobe.js
k6 run k6/chat.js

# Against staging with a real token
API_URL=https://pluckit-prod-api-func.azurewebsites.net \
CHAT_API_URL=https://pluckit-prod-processor-func.azurewebsites.net \
AUTH_TOKEN="Bearer <google-id-token>" \
k6 run k6/wardrobe.js
```

## Thresholds (pass/fail criteria)

| Metric | Threshold |
|---|---|
| Health endpoints | p(95) < 1 000 ms |
| Wardrobe list | p(95) < 2 000 ms |
| Chat TTFB | p(95) < 8 000 ms (LLM streaming) |

## CI Integration

Performance tests are intentionally **not** run on every PR to avoid side-effects on Cosmos DB and OpenAI quotas.  
They are run manually after staging deployments or on a nightly schedule:

```yaml
# .github/workflows/perf-test.yml (optional — add when needed)
- name: Run k6 smoke test
  run: k6 run --exit-on-running-error k6/health.js
  env:
    API_URL: ${{ vars.STAGING_API_URL }}
    CHAT_API_URL: ${{ vars.STAGING_CHAT_API_URL }}
```
