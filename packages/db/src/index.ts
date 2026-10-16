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
import * as schema from "@bomberoscr/db/schema";
import { drizzle } from "drizzle-orm/node-postgres";

import env from "./env";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const database = drizzle(env.DRIZZLE_POSTGRES_URL, { schema });

export const db: NodePgDatabase<typeof schema> = database;

/** Ends the connection pool, for a clean shutdown. */
export function closeDb(): Promise<void> {
  return database.$client.end();
}

export type Db = typeof db;

export default db;
