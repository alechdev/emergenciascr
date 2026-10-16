import { db } from "@bomberoscr/db/index";
import {
  type incidentTypesInsertSchema,
  incidentTypes as incidentTypesTable
} from "@bomberoscr/db/schema";
import { conflictUpdateSetAllColumns } from "@bomberoscr/db/utils";

import type { IncidentType as SigaeIncidentType } from "@bomberoscr/sigae/client";
import type { z } from "zod";

type IncidentType = z.infer<typeof incidentTypesInsertSchema>;

export async function upsertIncidentType(incidentTypes: SigaeIncidentType[]) {
  if (incidentTypes.length === 0) return;

  const incidentTypesList: IncidentType[] = getIncidentTypesRecursively(incidentTypes);

  await db
    .insert(incidentTypesTable)
    .values(incidentTypesList)
    .onConflictDoUpdate({
      target: incidentTypesTable.id,
      set: conflictUpdateSetAllColumns(incidentTypesTable)
    });
}

function getIncidentTypesRecursively(
  items: SigaeIncidentType[],
  parentId?: number
): IncidentType[] {
  const result: IncidentType[] = [];

  for (const item of items) {
    result.push({
      id: item.id_tipo_incidente,
      incidentCode: item.codigo_tipo_incidente,
      name: item.tipo_incidente,
      parentId: parentId ?? null
    });

    if (item.items && item.items.length > 0) {
      result.push(...getIncidentTypesRecursively(item.items, item.id_tipo_incidente));
    }
  }

  return result;
}
