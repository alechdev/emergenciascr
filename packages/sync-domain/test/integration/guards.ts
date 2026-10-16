/**
 * Checks on the servers the integration tests are given, before anything connects: the
 * suites truncate every table and flush Redis, so they must only ever reach throwaway ones.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Created by the harness right after migrating an empty test database. */
export const TEST_DATABASE_MARKER = "__integration_test_marker";

/** Refuses anything but a loopback URL that isn't the app's own configured one. */
export function assertThrowaway(url: string, variable: string, appVariables: string[]): void {
  const host = new URL(url).hostname;
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`${variable} must point at a throwaway server on loopback, not ${host}`);
  }
  for (const name of appVariables) {
    if (process.env[name] && process.env[name] === url && name !== variable) {
      throw new Error(`${variable} must not be the same as ${name}`);
    }
  }
}

/** The database name must say it is a test database (`sync_test`, `test`, …). */
export function assertTestDatabaseUrl(url: string): void {
  assertThrowaway(url, "TEST_DATABASE_URL", ["DRIZZLE_POSTGRES_URL"]);
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  if (!/test/i.test(name)) {
    throw new Error("TEST_DATABASE_URL must name a database with `test` in its name");
  }
}

/**
 * Redis must use a numbered database other than 0 (`redis://127.0.0.1:6379/15`): the tests
 * flush it, and 0 is where every app keeps its data by default.
 */
export function assertTestRedisUrl(url: string): void {
  assertThrowaway(url, "TEST_REDIS_URL", ["REDIS_URL"]);
  const index = redisDatabase(url);
  if (index === null || index === 0) {
    throw new Error("TEST_REDIS_URL must select a Redis database other than 0, like /15");
  }
}

/** The database index of a Redis URL, as ioredis reads it (path, else `?db=`). */
export function redisDatabase(url: string): number | null {
  const parsed = new URL(url);
  const value = parsed.pathname.slice(1) || parsed.searchParams.get("db") || "";
  return /^\d+$/.test(value) ? Number(value) : null;
}

/**
 * Whether a database may be migrated and emptied by the tests: it has no tables yet, or the
 * harness marked it as its own.
 */
export function isThrowawayDatabase(tables: readonly string[]): boolean {
  return tables.length === 0 || tables.includes(TEST_DATABASE_MARKER);
}
