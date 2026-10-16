import { db } from "@bomberoscr/db/index";
import { districts as districtsTable } from "@bomberoscr/db/schema";
import { conflictUpdateSetAllColumns } from "@bomberoscr/db/utils";

import type { District } from "@bomberoscr/sigae/client";

export async function upsertDistrict(districts: District[]) {
  if (districts.length === 0) return;

  await Promise.all(
    districts.map((district) =>
      db
        .insert(districtsTable)
        .values({
          id: district.Id_Distrito,
          name: district.Distrito,
          code: district.Codigo_Distrito,
          cantonId: district.Id_Canton
        })
        .onConflictDoUpdate({
          target: districtsTable.id,
          set: conflictUpdateSetAllColumns(districtsTable)
        })
    )
  );
}
