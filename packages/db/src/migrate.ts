import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

// Shared by every process that migrates this database (web, sync and the migrate app can
// deploy at the same time). Changing it lets two runners migrate concurrently.
const MIGRATION_LOCK_KEY = 4_120_250_101;

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

export const defaultMigrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export type MigrateOptions = {
  migrationsFolder?: string;
};

export type MigrateResult = {
  applied: string[];
  total: number;
};

export async function migrateDatabase(
  connectionString: string,
  options: MigrateOptions = {}
): Promise<MigrateResult> {
  const migrationsFolder = options.migrationsFolder ?? defaultMigrationsFolder;
  const migrations = readMigrationFiles({ migrationsFolder });
  const tags = readMigrationTags(migrationsFolder);

  const pool = new Pool({ connectionString, max: 2 });
  try {
    const client = await pool.connect();
    try {
      await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
      try {
        const db: NodePgDatabase = drizzle({ client });
        const appliedMillis = await readAppliedMillis(db);
        const lastApplied = appliedMillis.length > 0 ? Math.max(...appliedMillis) : -Infinity;

        // drizzle only applies migrations newer than the last applied one, so a migration
        // merged from another branch with an older timestamp would be skipped silently.
        const skipped = migrations.filter(
          (m) => m.folderMillis <= lastApplied && !appliedMillis.includes(m.folderMillis)
        );
        if (skipped.length > 0) {
          const names = skipped.map((m) => tags.get(m.folderMillis) ?? String(m.folderMillis));
          throw new Error(
            `Migrations older than the last applied one were never applied: ${names.join(", ")}. ` +
              "Regenerate them with a newer timestamp."
          );
        }

        const pending = migrations.filter((m) => m.folderMillis > lastApplied);
        await migrate(db, {
          migrationsFolder,
          migrationsSchema: MIGRATIONS_SCHEMA,
          migrationsTable: MIGRATIONS_TABLE
        });

        return {
          applied: pending.map((m) => tags.get(m.folderMillis) ?? String(m.folderMillis)),
          total: migrations.length
        };
      } finally {
        await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function readAppliedMillis(db: NodePgDatabase): Promise<number[]> {
  const table = `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`;
  const exists = await db.execute<{ exists: boolean }>(
    sql`select to_regclass(${table}) is not null as "exists"`
  );
  if (!exists.rows[0]?.exists) {
    return [];
  }

  const rows = await db.execute<{ created_at: string | null }>(
    sql`select created_at from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}`
  );
  return rows.rows.flatMap((row) => (row.created_at === null ? [] : [Number(row.created_at)]));
}

function readMigrationTags(migrationsFolder: string): Map<number, string> {
  const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, "utf8")) as {
    entries: { when: number; tag: string }[];
  };
  return new Map(journal.entries.map((entry) => [entry.when, entry.tag]));
}
