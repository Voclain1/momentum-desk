#!/bin/sh
# Runs once, when the database volume is first created (postgres image
# /docker-entrypoint-initdb.d). Creates the restricted role the app connects
# as: it cannot change the schema or bypass row-level security
# (docs/tenant-isolation.md). deploy/migrate.sh grants its privileges.
set -eu
psql -v ON_ERROR_STOP=1 -v pw="$APP_DB_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE momentum_app LOGIN PASSWORD :'pw' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
SQL
