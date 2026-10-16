// biome-ignore lint/performance/noBarrelFile: re-exporting to only have drizzle-orm installed in one package
export {
  aliasedTable,
  and,
  asc,
  between,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  like,
  lt,
  gte,
  ne,
  not,
  or,
  sql
} from "drizzle-orm";
import { type Database, createDatabase } from "./client";
import env from "./env";

const database = createDatabase(env.DRIZZLE_POSTGRES_URL);

export const db: Database = database;

/** Ends the connection pool, for a clean shutdown. */
export function closeDb(): Promise<void> {
  return database.$client.end();
}

export type Db = Database;
export type { Database, Transaction } from "./client";

export default db;
