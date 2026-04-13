#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:-smoke}"

export BASE_URL="${BASE_URL:-https://kack.li}"
export TEST_PROFILE="$PROFILE"
export THINK_TIME_MS="${THINK_TIME_MS:-200}"

mkdir -p k6/reports

echo "▶ k6 profile: $TEST_PROFILE"
echo "▶ base url:   $BASE_URL"
if [[ "${ENABLE_PROTECTED:-0}" == "1" ]]; then
  echo "▶ protected:  enabled"
else
  echo "▶ protected:  disabled"
fi

echo ""

k6 run k6/api-test.js
