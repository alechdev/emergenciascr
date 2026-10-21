/** The sync-domain integration harness: a throwaway Postgres migrated with the migrate runner. */
export {
  TEST_DATABASE_URL,
  type TestDatabase,
  assertTestDatabaseUrl,
  openTestDatabase,
  resetDatabase
} from "../../../sync-domain/test/integration/harness";
