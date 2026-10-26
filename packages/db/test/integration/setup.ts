/**
 * Runs before every integration test file. The queries import `@bomberoscr/db/index`, which
 * builds a pool from `DRIZZLE_POSTGRES_URL` (and this package's `.env`), so that is pointed at
 * an unreachable loopback port first: the tests pass the throwaway database in, and nothing may
 * reach the configured one. dotenv never overrides a variable that is already set.
 */
import { assertTestDatabaseUrl } from "./harness";

const databaseUrl = process.env.TEST_DATABASE_URL || undefined;
if (databaseUrl) assertTestDatabaseUrl(databaseUrl);

process.env.DRIZZLE_POSTGRES_URL = "postgres://none@127.0.0.1:9/none";
