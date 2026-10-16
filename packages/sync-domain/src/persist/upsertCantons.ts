import { db } from "@bomberoscr/db/index";
import { cantons as cantonsTable } from "@bomberoscr/db/schema";
import { conflictUpdateSetAllColumns } from "@bomberoscr/db/utils";

import type { Canton } from "@bomberoscr/sigae/client";

export async function upsertCanton(cantons: Canton[]) {
  if (cantons.length === 0) return;

  await Promise.all(
    cantons.map((canton) =>
      db
        .insert(cantonsTable)
        .values({
          id: canton.IdCanton,
          name: canton.Canton,
          code: canton.CodigoCanton,
          provinceId: canton.IdProvincia
        })
        .onConflictDoUpdate({
          target: cantonsTable.id,
          set: conflictUpdateSetAllColumns(cantonsTable)
        })
    )
  );
}
