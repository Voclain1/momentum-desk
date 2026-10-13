/**
 * Connection string for database tests. Tests delete every row they can
 * reach, so they only run against a database whose name ends in "_test".
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("Set TEST_DATABASE_URL to run database tests, e.g. postgresql://postgres@localhost:5432/momentum_test");
  }
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to run database tests against "${name}": the database name must end in "_test".`);
  }
  return url;
}

/**
 * Owner connection for the test database: applies migrations and empties
 * tables between tests. Falls back to TEST_DATABASE_URL when tests run as a
 * single role.
 */
export function testMigrationDatabaseUrl(): string {
  const appUrl = testDatabaseUrl();
  const url = process.env.TEST_MIGRATION_DATABASE_URL || appUrl;
  if (new URL(url).pathname !== new URL(appUrl).pathname) {
    throw new Error("TEST_MIGRATION_DATABASE_URL must point at the same database as TEST_DATABASE_URL.");
  }
  return url;
}
