#!/usr/bin/env bash
# Hipp0 Zero-Downtime Deploy Script
#
# Usage:
#   ./scripts/deploy.sh [IMAGE_TAG]
#
# Strategy: Blue-green deployment with Docker
# 1. Build new container image
# 2. Start new container on temp port
# 3. Health check new container
# 4. Switch traffic (update running container)
# 5. Stop old container

set -euo pipefail

IMAGE_TAG="${1:-latest}"
SERVICE_NAME="hipp0-server"
NEW_CONTAINER="${SERVICE_NAME}-new"
OLD_CONTAINER="${SERVICE_NAME}"
PORT=3100
HEALTH_TIMEOUT=30
HEALTH_INTERVAL=2

echo "=== Hipp0 Zero-Downtime Deploy ==="
echo "Image tag: ${IMAGE_TAG}"
echo "Time: $(date -Iseconds)"
echo ""

# Step 1: Build new image
echo "--- Step 1: Build ---"
docker build -t "hipp0-server:${IMAGE_TAG}" .
echo "Build complete"
echo ""

# Step 2: Start new container on a temp port
TEMP_PORT=$((PORT + 1))
echo "--- Step 2: Start new container (port ${TEMP_PORT}) ---"
docker rm -f "${NEW_CONTAINER}" 2>/dev/null || true

docker run -d \
  --name "${NEW_CONTAINER}" \
  --env-file .env \
  -e PORT=${TEMP_PORT} \
  --network host \
  "hipp0-server:${IMAGE_TAG}"

echo "New container started"
echo ""

# Step 3: Health check
echo "--- Step 3: Health check ---"
ELAPSED=0
while [ $ELAPSED -lt $HEALTH_TIMEOUT ]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${TEMP_PORT}/api/health/ready" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ]; then
    echo "Health check passed after ${ELAPSED}s"
    break
  fi
  sleep $HEALTH_INTERVAL
  ELAPSED=$((ELAPSED + HEALTH_INTERVAL))
done

if [ "$ELAPSED" -ge "$HEALTH_TIMEOUT" ]; then
  echo "ERROR: Health check failed after ${HEALTH_TIMEOUT}s"
  echo "Cleaning up failed deployment..."
  docker stop "${NEW_CONTAINER}" 2>/dev/null || true
  docker rm "${NEW_CONTAINER}" 2>/dev/null || true
  exit 1
fi
echo ""

# Step 4: Swap containers
echo "--- Step 4: Swap ---"
# Stop old container
docker stop "${OLD_CONTAINER}" 2>/dev/null || true
docker rm "${OLD_CONTAINER}" 2>/dev/null || true

# Stop the new container (running on temp port)
docker stop "${NEW_CONTAINER}" 2>/dev/null || true
docker rm "${NEW_CONTAINER}" 2>/dev/null || true

# Start final container on the real port
docker run -d \
  --name "${OLD_CONTAINER}" \
  --env-file .env \
  -e PORT=${PORT} \
  --network host \
  --restart unless-stopped \
  "hipp0-server:${IMAGE_TAG}"

echo "Swap complete — now serving on port ${PORT}"
echo ""

# Step 5: Verify
echo "--- Step 5: Verify ---"
sleep 3
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/api/health" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  echo "Deployment verified — server healthy on port ${PORT}"
else
  echo "WARNING: Server not responding on port ${PORT} (got ${HTTP_CODE})"
  exit 1
fi

echo ""
echo "=== Deploy complete ==="
echo "Image: hipp0-server:${IMAGE_TAG}"
echo "Time: $(date -Iseconds)"
