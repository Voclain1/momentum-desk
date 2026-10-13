-- Privileges for the restricted role the application connects as.
--
-- Run once per database as the owner (the role migrations run as), after
-- creating the role and applying migrations, e.g. on Neon:
--
--   CREATE ROLE momentum_app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS
--     NOCREATEDB NOCREATEROLE;
--   psql "$MIGRATION_DATABASE_URL" -v app_role=momentum_app -f prisma/sql/app-role.sql
--
-- The app role can read and write rows but cannot change the schema, cannot
-- bypass row-level security and owns no tables. Default privileges cover
-- tables that later migrations create, as long as the same owner runs them.

GRANT CONNECT ON DATABASE :"DBNAME" TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO :"app_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO :"app_role";
-- Prisma's migration history is for the owner only.
SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS has_migrations_table \gset
\if :has_migrations_table
REVOKE ALL ON TABLE "_prisma_migrations" FROM :"app_role";
\else
\echo 'Note: run this script again after the first migration to lock _prisma_migrations.'
\endif
