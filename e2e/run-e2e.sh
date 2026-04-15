#!/usr/bin/env bash
# One-shot E2E orchestrator: brings up stack, seeds, runs vitest, tears down.
set -euo pipefail
cd "$(dirname "$0")"

echo '[e2e] Starting docker stack...'
docker compose up --build --wait 2>&1 | tail -5

echo '[e2e] Waiting for server health...'
for i in $(seq 1 30); do
  if curl -sf http://localhost:3001/api/health > /dev/null; then echo '  OK'; break; fi
  sleep 1
done

echo '[e2e] Seeding data...'
npx tsx seed.ts > /tmp/e2e-seed.json
head /tmp/e2e-seed.json

echo '[e2e] Running E2E suite...'
cd ..
HIPP0_BASE_URL=http://localhost:3001 HIPP0_SEED_FILE=/tmp/e2e-seed.json \
  npx vitest run e2e/ 2>&1 | tail -15

echo '[e2e] Tearing down...'
cd e2e && docker compose down -v
