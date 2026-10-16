import { db } from "@bomberoscr/db/index";
import { cantons, districts, provinces } from "@bomberoscr/db/schema";
import { conflictUpdateSetAllColumns } from "@bomberoscr/db/utils";
import { ResultAsync } from "neverthrow";

import { sigae } from "@/config/sigae";
import { SyncError } from "@/lib/errors";
import { expectOk } from "@/lib/sigae";

/** Provinces, then cantons, then districts, in one transaction (each references the last). */
export function syncDistricts(): ResultAsync<string, SyncError> {
  return ResultAsync.combine([
    expectOk(sigae.getProvinces(), "provinces"),
    expectOk(sigae.getCantons(), "cantons"),
    expectOk(sigae.getDistricts(), "districts")
  ]).andThen(([provinceList, cantonList, districtList]) =>
    ResultAsync.fromPromise(
      db.transaction(async (tx) => {
        if (provinceList.items.length > 0) {
          await tx
            .insert(provinces)
            .values(
              provinceList.items.map((province) => ({
                id: province.IdProvincia,
                name: province.Provincia,
                code: province.CodigoProvincia
              }))
            )
            .onConflictDoUpdate({
              target: provinces.id,
              set: conflictUpdateSetAllColumns(provinces)
            });
        }
        if (cantonList.items.length > 0) {
          await tx
            .insert(cantons)
            .values(
              cantonList.items.map((canton) => ({
                id: canton.IdCanton,
                name: canton.Canton,
                code: canton.CodigoCanton,
                provinceId: canton.IdProvincia
              }))
            )
            .onConflictDoUpdate({ target: cantons.id, set: conflictUpdateSetAllColumns(cantons) });
        }
        if (districtList.items.length > 0) {
          await tx
            .insert(districts)
            .values(
              districtList.items.map((district) => ({
                id: district.Id_Distrito,
                name: district.Distrito,
                code: district.Codigo_Distrito,
                cantonId: district.Id_Canton
              }))
            )
            .onConflictDoUpdate({
              target: districts.id,
              set: conflictUpdateSetAllColumns(districts)
            });
        }
      }),
      (cause) => new SyncError("failed to store provinces, cantons and districts", { cause })
    ).map(
      () =>
        `${provinceList.items.length} provinces, ${cantonList.items.length} cantons, ${districtList.items.length} districts`
    )
  );
}
