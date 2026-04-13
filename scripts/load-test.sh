#!/usr/bin/env bash
# Hipp0 Load Test — 100 concurrent compile requests
#
# Usage:
#   ./scripts/load-test.sh [BASE_URL] [PROJECT_ID]
#
# Requires: curl (always available), optionally 'hey' or 'ab' for proper load testing

set -euo pipefail

BASE_URL="${1:-http://localhost:3100}"
PROJECT_ID="${2:-44c6cebd-b6ff-47b7-ad93-52925bf26eb0}"
CONCURRENCY=100
TOTAL_REQUESTS=100

COMPILE_PAYLOAD=$(cat <<EOF
{
  "agent_name": "backend-engineer",
  "project_id": "${PROJECT_ID}",
  "task_description": "implement authentication middleware for the API"
}
EOF
)

echo "=== Hipp0 Load Test ==="
echo "Target: ${BASE_URL}/api/compile"
echo "Concurrency: ${CONCURRENCY}"
echo "Total requests: ${TOTAL_REQUESTS}"
echo ""

# Health check first
echo "--- Health Check ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/health")
if [ "$HTTP_CODE" != "200" ]; then
  echo "FAIL: Health check returned ${HTTP_CODE}"
  exit 1
fi
echo "OK: Server is healthy"
echo ""

# Check for hey (preferred load testing tool)
if command -v hey &>/dev/null; then
  echo "--- Using 'hey' for load test ---"
  echo "${COMPILE_PAYLOAD}" | hey -n ${TOTAL_REQUESTS} -c ${CONCURRENCY} \
    -m POST \
    -H "Content-Type: application/json" \
    -D /dev/stdin \
    "${BASE_URL}/api/compile"

# Check for ab (Apache Bench)
elif command -v ab &>/dev/null; then
  echo "--- Using 'ab' for load test ---"
  TMPFILE=$(mktemp)
  echo "${COMPILE_PAYLOAD}" > "$TMPFILE"
  ab -n ${TOTAL_REQUESTS} -c ${CONCURRENCY} \
    -p "$TMPFILE" \
    -T "application/json" \
    "${BASE_URL}/api/compile"
  rm -f "$TMPFILE"

# Fallback: parallel curl
else
  echo "--- Using parallel curl (hey/ab not found) ---"
  TMPFILE=$(mktemp)
  START_TIME=$(date +%s%N)
  SUCCESSES=0
  FAILURES=0

  for i in $(seq 1 ${TOTAL_REQUESTS}); do
    (
      HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d "${COMPILE_PAYLOAD}" \
        "${BASE_URL}/api/compile" 2>/dev/null)
      echo "$HTTP_CODE" >> "$TMPFILE"
    ) &

    # Limit concurrency
    if [ $((i % CONCURRENCY)) -eq 0 ]; then
      wait
    fi
  done
  wait

  END_TIME=$(date +%s%N)
  ELAPSED_MS=$(( (END_TIME - START_TIME) / 1000000 ))

  SUCCESSES=$(grep -c "200" "$TMPFILE" 2>/dev/null || echo 0)
  FAILURES=$(grep -cv "200" "$TMPFILE" 2>/dev/null || echo 0)
  rm -f "$TMPFILE"

  echo ""
  echo "--- Results ---"
  echo "Total requests: ${TOTAL_REQUESTS}"
  echo "Successful (200): ${SUCCESSES}"
  echo "Failed: ${FAILURES}"
  echo "Total time: ${ELAPSED_MS}ms"
  echo "Avg per request: $((ELAPSED_MS / TOTAL_REQUESTS))ms"
  echo ""

  if [ "$FAILURES" -gt 10 ]; then
    echo "WARN: More than 10% failure rate"
    exit 1
  fi
fi

echo ""
echo "=== Load test complete ==="
