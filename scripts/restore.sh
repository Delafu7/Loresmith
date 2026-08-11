#!/usr/bin/env bash
# Restores a dump produced by backup.sh into docker-compose.yml's `postgres`
# service. DESTRUCTIVE: drops and recreates the target database first, so
# this only ever restores onto a clean slate rather than merging into
# existing data. Usage: scripts/restore.sh backups/20260101-120000.sql
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -z "${1:-}" ]; then
  echo "Usage: $0 <path-to-dump.sql>" >&2
  exit 1
fi
dump="$1"
if [ ! -f "${dump}" ]; then
  echo "No such file: ${dump}" >&2
  exit 1
fi

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; source .env; set +a
fi

POSTGRES_USER="${POSTGRES_USER:-dnd}"
POSTGRES_DB="${POSTGRES_DB:-dnd_campaign_manager}"

read -r -p "This will DROP and recreate '${POSTGRES_DB}' before restoring ${dump}. Continue? [y/N] " confirm
if [ "${confirm}" != "y" ] && [ "${confirm}" != "Y" ]; then
  echo "Aborted."
  exit 1
fi

echo "Dropping and recreating ${POSTGRES_DB}..."
docker compose exec -T postgres dropdb -U "${POSTGRES_USER}" --if-exists "${POSTGRES_DB}"
docker compose exec -T postgres createdb -U "${POSTGRES_USER}" "${POSTGRES_DB}"

echo "Restoring from ${dump}..."
docker compose exec -T postgres psql -U "${POSTGRES_USER}" "${POSTGRES_DB}" < "${dump}"
echo "Done."
