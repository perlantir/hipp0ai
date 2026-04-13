#!/usr/bin/env bash
# Hipp0 Database Backup Script
#
# Usage:
#   ./scripts/backup.sh [BACKUP_DIR]
#
# Creates a pg_dump backup with timestamp in the specified directory.
# Reads DATABASE_URL from environment or .env file.

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/hipp0_${TIMESTAMP}.sql.gz"

# Load .env if present
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DATABASE_URL="${DATABASE_URL:-}"
if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not set. Set it in .env or as an environment variable."
  exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "=== Hipp0 Database Backup ==="
echo "Time: $(date -Iseconds)"
echo "Target: ${BACKUP_FILE}"

# Run pg_dump
if command -v pg_dump &>/dev/null; then
  pg_dump "$DATABASE_URL" --no-owner --no-privileges | gzip > "$BACKUP_FILE"
elif command -v docker &>/dev/null; then
  # If pg_dump not available locally, try via Docker
  docker exec -i "$(docker compose ps -q postgres 2>/dev/null || echo postgres)" \
    pg_dump -U "${POSTGRES_USER:-hipp0}" "${POSTGRES_DB:-hipp0}" --no-owner --no-privileges \
    | gzip > "$BACKUP_FILE"
else
  echo "ERROR: Neither pg_dump nor docker found."
  exit 1
fi

FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "Backup complete: ${BACKUP_FILE} (${FILESIZE})"

# Cleanup old backups (keep last 30)
BACKUP_COUNT=$(find "$BACKUP_DIR" -name "hipp0_*.sql.gz" -type f | wc -l)
if [ "$BACKUP_COUNT" -gt 30 ]; then
  find "$BACKUP_DIR" -name "hipp0_*.sql.gz" -type f | sort | head -n -30 | xargs rm -f
  echo "Cleaned up old backups (kept last 30)"
fi

echo "=== Done ==="
