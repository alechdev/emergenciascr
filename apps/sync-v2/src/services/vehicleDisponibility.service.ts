import { db } from "@bomberoscr/db/index";
import { vehicleDisponibility as vehicleDisponibilityTable } from "@bomberoscr/db/schema";
import { conflictUpdateSetAllColumns } from "@bomberoscr/db/utils";
import { ResultAsync, okAsync } from "neverthrow";

import { sigae } from "@/config/sigae";
import { SyncError } from "@/lib/errors";
import { expectOk } from "@/lib/sigae";

export function syncVehicleDisponibility(): ResultAsync<string, SyncError> {
  return expectOk(sigae.getVehicleAvailabilityStates(), "vehicle availability states").andThen(
    (response) => {
      const rows = response.items.map((state) => ({
        id: state.IdGrupoClasificacion,
        description: state.Descripcion
      }));
      if (rows.length === 0) return okAsync("0 vehicle availability states");

      return ResultAsync.fromPromise(
        db
          .insert(vehicleDisponibilityTable)
          .values(rows)
          .onConflictDoUpdate({
            target: vehicleDisponibilityTable.id,
            set: conflictUpdateSetAllColumns(vehicleDisponibilityTable)
          }),
        (cause) => new SyncError("failed to store vehicle availability states", { cause })
      ).map(() => `${rows.length} vehicle availability states`);
    }
  );
}
