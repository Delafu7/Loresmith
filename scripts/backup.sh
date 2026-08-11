#!/usr/bin/env bash
# Dumps the Postgres database running in docker-compose.yml's `postgres`
# service to backups/<timestamp>.sql (gitignored — see .gitignore). Reads
# credentials from .env if present, falling back to docker-compose.yml's
# defaults (dnd/dnd/dnd_campaign_manager) so this works out of the box on a
# fresh checkout with no .env yet.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; source .env; set +a
fi

POSTGRES_USER="${POSTGRES_USER:-dnd}"
POSTGRES_DB="${POSTGRES_DB:-dnd_campaign_manager}"

mkdir -p backups
timestamp="$(date +%Y%m%d-%H%M%S)"
out="backups/${timestamp}.sql"

echo "Backing up ${POSTGRES_DB} to ${out}..."
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" > "${out}"
echo "Done: ${out} ($(du -h "${out}" | cut -f1))"
