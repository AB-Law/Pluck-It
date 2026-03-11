#!/usr/bin/env bash
# sonar-scan.sh — Full local SonarQube scan for PluckIt
#
# Required env vars:
#   SONAR_TOKEN  — your SonarQube user token (never commit this)
#   SONAR_HOST   — SonarQube URL (default: http://localhost:9001)
#
# Usage:
#   export SONAR_TOKEN="sqp_..."
#   bash scripts/sonar-scan.sh
set -euo pipefail

if [ -z "${SONAR_TOKEN:-}" ]; then
  echo "ERROR: SONAR_TOKEN env var is not set. Export it before running this script." >&2
  exit 1
fi

SONAR_HOST="${SONAR_HOST:-http://localhost:9001}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INCLUDE_DOTNET_INTEGRATION_TESTS="${INCLUDE_DOTNET_INTEGRATION_TESTS:-false}"
RUN_MODE="unit-only"
DOTNET_TEST_FILTER_ARGS=(--filter "Category!=Integration")

case "${INCLUDE_DOTNET_INTEGRATION_TESTS}" in
  1 | true | TRUE | yes | YES | on | ON)
    DOTNET_TEST_FILTER_ARGS=()
    RUN_MODE="unit + integration"
    echo "Including .NET integration tests in this run."
    ;;
esac

echo "==> [1/6] Run Angular tests with LCOV coverage"
cd "$ROOT/PluckIt.Client"
npm run test -- --watch=false
cd "$ROOT"

echo ""
echo "==> [2/6] Begin SonarQube scan"
dotnet sonarscanner begin \
  /k:"PluckIt" \
  /d:sonar.host.url="$SONAR_HOST" \
  /d:sonar.token="$SONAR_TOKEN" \
  /d:sonar.cs.opencover.reportsPaths="**/coverage.opencover.xml" \
  /d:sonar.python.coverage.reportPaths="PluckIt.Processor/coverage.xml" \
  /d:sonar.javascript.lcov.reportPaths="PluckIt.Client/coverage/PluckIt.Client/lcov.info" \
  /d:sonar.exclusions="PluckIt.Processor/.venv/**,PluckIt.Functions/bin/**,PluckIt.Functions/obj/**,**/node_modules/**,PluckIt.Processor/tests/**,PluckIt.Segmentation.Modal/tests/**,k6/**,scripts/**" \
  /d:sonar.coverage.exclusions="PluckIt.Functions/Program.cs,PluckIt.Functions/Serialization/PluckItJsonContext.cs" \
  /d:sonar.test.inclusions="PluckIt.Processor/tests/**,PluckIt.Segmentation.Modal/tests/**,PluckIt.Tests/**,PluckIt.Client/src/**/*.spec.ts"

echo ""
echo "==> [3/6] Build C#"
dotnet build "$ROOT/PluckIt.sln" --no-restore

echo ""
echo "==> [4/6] Run C# tests with OpenCover coverage ($RUN_MODE)"
dotnet test "$ROOT/PluckIt.sln" \
  --no-build \
  "${DOTNET_TEST_FILTER_ARGS[@]}" \
  --collect:"XPlat Code Coverage" \
  -- DataCollectionRunSettings.DataCollectors.DataCollector.Configuration.Format=opencover

echo ""
echo "==> [5/6] Run Python tests with coverage"
cd "$ROOT/PluckIt.Processor"
# Use the project's venv if present, otherwise fall back to system python
if [ -f ".venv/bin/activate" ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi
pytest --cov=. \
  --cov-report=xml:coverage.xml \
  --ignore=tests/integration \
  -m "not integration" \
  --tb=short \
  -q
cd "$ROOT"

echo ""
echo "==> [6/6] End SonarQube scan"
dotnet sonarscanner end /d:sonar.token="$SONAR_TOKEN"

echo ""
echo "Done! Open $SONAR_HOST/dashboard?id=PluckIt to view results."
