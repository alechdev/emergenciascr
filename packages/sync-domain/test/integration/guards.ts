/**
 * Checks on the servers the integration tests are given, before anything connects: the
 * suites truncate every table and flush Redis, so they must only ever reach throwaway ones.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const DEFAULT_PORTS: Readonly<Record<string, string>> = {
  "postgres:": "5432",
  "postgresql:": "5432",
  "redis:": "6379",
  "rediss:": "6379"
};

/** Created by the harness right after migrating an empty test database. */
export const TEST_DATABASE_MARKER = "__integration_test_marker";

/**
 * Refuses anything but a loopback URL that isn't the app's own configured one, however
 * either is spelled (any loopback host, a default port left out).
 */
export function assertThrowaway(url: string, variable: string, appVariables: string[]): void {
  const host = new URL(url).hostname;
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`${variable} must point at a throwaway server on loopback, not ${host}`);
  }
  const target = serverTarget(url);
  for (const name of appVariables) {
    const app = process.env[name];
    if (app && name !== variable && serverTarget(app) === target) {
      throw new Error(`${variable} must not be the same as ${name}`);
    }
  }
}

/** The server and database a Postgres or Redis URL points at, or `null` if it isn't a URL. */
function serverTarget(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const scheme = parsed.protocol.startsWith("redis")
    ? "redis"
    : parsed.protocol.startsWith("postgres")
      ? "postgres"
      : parsed.protocol;
  const host = LOOPBACK_HOSTS.has(parsed.hostname) ? "loopback" : parsed.hostname.toLowerCase();
  const port = parsed.port || DEFAULT_PORTS[parsed.protocol] || "";
  // Postgres defaults the database to the user name; ioredis defaults to database 0.
  const database =
    scheme === "redis"
      ? String(redisDatabase(url) ?? 0)
      : decodeURIComponent(parsed.pathname.slice(1)) || decodeURIComponent(parsed.username);
  return `${scheme} ${host}:${port}/${database}`;
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
