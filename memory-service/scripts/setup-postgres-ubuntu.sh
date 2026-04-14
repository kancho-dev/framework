#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${DB_NAME:-agent_framework}"
DB_USER="${DB_USER:-agent_framework}"
DB_PASSWORD="${DB_PASSWORD:-change-me}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_SCHEMA="${DB_SCHEMA:-memory}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATION_FILE="$ROOT_DIR/migrations/001-init.sql"

if [[ ! -f "$MIGRATION_FILE" ]]; then
  echo "Migration file not found: $MIGRATION_FILE" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "Installing PostgreSQL client/server..."
  apt-get update
  apt-get install -y postgresql postgresql-contrib
fi

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable postgresql || true
  systemctl start postgresql || true
fi

echo "Ensuring database role exists: $DB_USER"
su - postgres -c "psql -v ON_ERROR_STOP=1 -c \"DO \\\$\\
BEGIN \\\$\\
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';
  ELSE
    ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASSWORD';
  END IF;
END
\\\$;\""

echo "Ensuring database exists: $DB_NAME"
su - postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'\" | grep -q 1 || createdb $DB_NAME -O $DB_USER"

echo "Granting database privileges"
su - postgres -c "psql -v ON_ERROR_STOP=1 -d $DB_NAME -c \"GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;\""
su - postgres -c "psql -v ON_ERROR_STOP=1 -d $DB_NAME -c \"CREATE SCHEMA IF NOT EXISTS $DB_SCHEMA AUTHORIZATION $DB_USER;\""
su - postgres -c "psql -v ON_ERROR_STOP=1 -d $DB_NAME -c \"GRANT ALL ON SCHEMA $DB_SCHEMA TO $DB_USER;\""

echo "Applying migration: $MIGRATION_FILE"
PGPASSWORD="$DB_PASSWORD" psql \
  -v ON_ERROR_STOP=1 \
  -h "$DB_HOST" \
  -p "$DB_PORT" \
  -U "$DB_USER" \
  -d "$DB_NAME" \
  -f "$MIGRATION_FILE"

echo "Done."
echo "Database: $DB_NAME"
echo "User: $DB_USER"
echo "Schema: $DB_SCHEMA"
