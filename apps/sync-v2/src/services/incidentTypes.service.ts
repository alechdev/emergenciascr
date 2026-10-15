import { db } from "@bomberoscr/db/index";
import {
  type incidentTypesInsertSchema,
  incidentTypes as incidentTypesTable
} from "@bomberoscr/db/schema";
import { conflictUpdateSetAllColumns } from "@bomberoscr/db/utils";
import { ResultAsync, okAsync } from "neverthrow";

import { sigae } from "@/config/sigae";
import { SyncError } from "@/lib/errors";
import { expectOk } from "@/lib/sigae";

import type { IncidentType as SigaeIncidentType } from "@bomberoscr/sigae/client";
import type { z } from "zod";

type IncidentType = z.infer<typeof incidentTypesInsertSchema>;

/** Parents come before their children, so the self-reference holds within one insert. */
function flattenIncidentTypes(items: SigaeIncidentType[], parentId?: number): IncidentType[] {
  const result: IncidentType[] = [];
  for (const item of items) {
    result.push({
      id: item.id_tipo_incidente,
      incidentCode: item.codigo_tipo_incidente,
      name: item.tipo_incidente,
      parentId: parentId ?? null
    });
    if (item.items && item.items.length > 0) {
      result.push(...flattenIncidentTypes(item.items, item.id_tipo_incidente));
    }
  }
  return result;
}

export function syncIncidentTypes(): ResultAsync<string, SyncError> {
  return expectOk(sigae.getIncidentTypes(), "incident types").andThen((response) => {
    const rows = flattenIncidentTypes(response.items);
    if (rows.length === 0) return okAsync("0 incident types");

    return ResultAsync.fromPromise(
      db
        .insert(incidentTypesTable)
        .values(rows)
        .onConflictDoUpdate({
          target: incidentTypesTable.id,
          set: conflictUpdateSetAllColumns(incidentTypesTable)
        }),
      (cause) => new SyncError("failed to store incident types", { cause })
    ).map(() => `${rows.length} incident types`);
  });
}
