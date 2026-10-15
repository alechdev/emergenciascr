import { db } from "@bomberoscr/db/index";
import { provinces as provincesTable } from "@bomberoscr/db/schema";
import { conflictUpdateSetAllColumns } from "@bomberoscr/db/utils";

import type { Province } from "@bomberoscr/sigae/client";

export async function upsertProvince(provinces: Province[]) {
  if (provinces.length === 0) return;

  await Promise.all(
    provinces.map((province) =>
      db
        .insert(provincesTable)
        .values({
          id: province.IdProvincia,
          name: province.Provincia,
          code: province.CodigoProvincia
        })
        .onConflictDoUpdate({
          target: provincesTable.id,
          set: conflictUpdateSetAllColumns(provincesTable)
        })
    )
  );
}
