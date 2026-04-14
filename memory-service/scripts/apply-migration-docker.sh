#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-agent-framework-memory-pg}"
DB_NAME="${DB_NAME:-agent_framework}"
DB_USER="${DB_USER:-agent_framework}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATION_FILE="$ROOT_DIR/migrations/001-init.sql"

if [[ ! -f "$MIGRATION_FILE" ]]; then
  echo "Migration file not found: $MIGRATION_FILE" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required but not installed" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "Container is not running: $CONTAINER_NAME" >&2
  echo "Run 'docker ps' to see running containers." >&2
  exit 1
fi

echo "Applying migration to container: $CONTAINER_NAME"
docker exec -i "$CONTAINER_NAME" \
  psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
  < "$MIGRATION_FILE"

echo "Done. Verifying tables..."
docker exec -it "$CONTAINER_NAME" \
  psql -U "$DB_USER" -d "$DB_NAME" -c '\dt memory.*'
