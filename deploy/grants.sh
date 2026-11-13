#!/bin/sh
# Grants the restricted app role its privileges (prisma/sql/app-role.sql).
# Runs in the postgres image after every migration; safe to repeat.
set -eu
: "${MIGRATION_DATABASE_URL:?must be set}"
psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -q -v app_role="${APP_DB_ROLE:-momentum_app}" -f /deploy/app-role.sql
echo "app role privileges applied"
