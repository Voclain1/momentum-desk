#!/bin/sh
# Nightly database backup (docs/go-live.md §backups). Run from deploy/:
#   ./backup.sh            -> backups/momentum-YYYYMMDD-HHMMSS.dump
# Keeps BACKUP_KEEP_DAYS (default 14) days of dumps. Copy them off the server.
set -eu
cd "$(dirname "$0")"
mkdir -p backups
file="backups/momentum-$(date -u +%Y%m%d-%H%M%S).dump"
docker compose exec -T db sh -c 'pg_dump --format=custom --username "$POSTGRES_USER" "$POSTGRES_DB"' > "$file.partial"
mv "$file.partial" "$file"
find backups -name 'momentum-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
echo "$file"
