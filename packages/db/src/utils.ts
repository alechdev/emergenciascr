import { getTableColumns, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

import type { PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";

export function conflictUpdateSetAllColumns<TTable extends PgTable>(
  table: TTable
): PgUpdateSetSource<TTable> {
  const columns = getTableColumns(table);
  const { name: tableName } = getTableConfig(table);
  const conflictUpdateSet = Object.entries(columns).reduce((acc, [columnName, columnInfo]) => {
    if (!columnInfo.default) {
      // @ts-ignore
      acc[columnName] = sql.raw(
        `COALESCE(excluded."${columnInfo.name}", "${tableName}"."${columnInfo.name}")`
      );
    }
    return acc;
  }, {}) as PgUpdateSetSource<TTable>;
  return conflictUpdateSet;
}

/**
 * `ON CONFLICT DO UPDATE` values that copy the listed columns from the proposed row, `NULL`s
 * included, unlike {@link conflictUpdateSetAllColumns}.
 */
export function conflictUpdateSetColumns<TTable extends PgTable>(
  table: TTable,
  keys: readonly (keyof TTable["_"]["columns"] & string)[]
): PgUpdateSetSource<TTable> {
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  return Object.fromEntries(
    keys.map((key) => {
      const column = columns[key];
      if (!column) throw new Error(`Unknown column ${key}`);
      return [key, sql`excluded.${sql.identifier(column.name)}`];
    })
  ) as PgUpdateSetSource<TTable>;
}
