#!/bin/bash
# Switch local.settings.json between local emulator and production.
#
# Usage:
#   ./scripts/use-env.sh local
#   ./scripts/use-env.sh prod

set -e

ENV=${1:-}

if [[ "$ENV" != "local" && "$ENV" != "prod" ]]; then
  echo "Usage: $0 [local|prod]"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cp "$REPO_ROOT/PluckIt.Functions/local.settings.$ENV.json"  "$REPO_ROOT/PluckIt.Functions/local.settings.json"
cp "$REPO_ROOT/PluckIt.Processor/local.settings.$ENV.json"  "$REPO_ROOT/PluckIt.Processor/local.settings.json"

echo "Switched to: $ENV"
