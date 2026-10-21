import * as schema from "@bomberoscr/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * A database for a connection string, without reading env. `@bomberoscr/db/index` builds the
 * shared one from `DRIZZLE_POSTGRES_URL`; tests and tools build their own with this.
 */
export function createDatabase(connectionString: string): Database & { $client: Pool } {
  return drizzle(connectionString, { schema });
}
