#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${CONTAINER_NAME:-agent-framework-memory-pg}"
DB_NAME="${DB_NAME:-agent_framework}"
DB_USER="${DB_USER:-agent_framework}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/migrations"

if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "Migrations directory not found: $MIGRATIONS_DIR" >&2
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

shopt -s nullglob
migration_files=("$MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

if [[ ${#migration_files[@]} -eq 0 ]]; then
  echo "No migration files found in: $MIGRATIONS_DIR" >&2
  exit 1
fi

echo "Applying migrations to container: $CONTAINER_NAME"
for migration_file in "${migration_files[@]}"; do
  echo "- $(basename "$migration_file")"
  docker exec -i "$CONTAINER_NAME" \
    psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    < "$migration_file"
done

echo "Done. Verifying tables..."
docker exec -i "$CONTAINER_NAME" \
  psql -U "$DB_USER" -d "$DB_NAME" -c '\dt memory.*'
