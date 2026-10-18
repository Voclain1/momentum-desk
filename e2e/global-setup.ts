import migrateTestDatabase from "../test/db-global-setup";

/**
 * Applies migrations to the disposable test database. Tests use unique email
 * addresses, so leftover rows from earlier runs do not matter.
 */
export default function globalSetup() {
  migrateTestDatabase();
}
