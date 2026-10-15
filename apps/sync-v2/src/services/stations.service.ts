import { db } from "@bomberoscr/db/index";
import { stations as stationsTable } from "@bomberoscr/db/schema";
import { conflictUpdateSetAllColumns } from "@bomberoscr/db/utils";
import { ResultAsync, okAsync } from "neverthrow";

import { sigae } from "@/config/sigae";
import { SyncError } from "@/lib/errors";
import { expectOk } from "@/lib/sigae";

import type { StationDetails } from "@bomberoscr/sigae/client";

export interface StationJobData {
  id: number;
  isOperative: boolean;
  name: string;
  stationKey: string;
}

/** Every station SIGAE lists, with whether it is operative. */
export function listStations(): ResultAsync<StationJobData[], SyncError> {
  return ResultAsync.combine([
    expectOk(sigae.getStations(), "stations list"),
    expectOk(sigae.getOperativeStations(), "operative stations")
  ]).map(([stationList, operativeStations]) => {
    const operative = new Set(operativeStations.items.map((station) => station.IdEstacion));
    return stationList.items.map((station) => ({
      id: station.IdEstacion,
      isOperative: operative.has(station.IdEstacion),
      name: station.Nombre,
      stationKey: station.ClaveEstacion
    }));
  });
}

export function syncSingleStation(station: StationJobData): ResultAsync<void, SyncError> {
  const { id } = station;
  return sigae
    .getStationDetails(id)
    .mapErr((cause) => new SyncError(`station ${id} details: SIGAE request failed`, { cause }))
    .andThen((response) =>
      response.kind === "not_found"
        ? storeListedStation(station)
        : expectOk(okAsync(response), `station ${id} details`).andThen((details) =>
            storeStation(station, details)
          )
    );
}

/**
 * Some listed stations have no details (`03`). Incidents can still reference them, so the
 * row is kept with what the list says, and details stored earlier are left as they are.
 */
function storeListedStation(station: StationJobData): ResultAsync<void, SyncError> {
  return ResultAsync.fromPromise(
    db
      .insert(stationsTable)
      .values({
        id: station.id,
        name: station.name,
        stationKey: station.stationKey,
        latitude: "0",
        longitude: "0",
        isOperative: station.isOperative
      })
      .onConflictDoUpdate({
        target: stationsTable.id,
        set: {
          name: station.name,
          stationKey: station.stationKey,
          isOperative: station.isOperative
        }
      }),
    (cause) => new SyncError(`failed to store station ${station.id}`, { cause })
  ).map(() => undefined);
}

function storeStation(
  station: StationJobData,
  details: StationDetails
): ResultAsync<void, SyncError> {
  const { id } = station;
  const row = {
    id,
    name: details.Nombre ?? station.name,
    stationKey: details.ClaveEstacion ?? station.stationKey,
    radioChannel: details.CanalRadio,
    latitude: details.Latitud.toString(),
    longitude: details.Longitud.toString(),
    address: details.Direccion,
    phoneNumber: details.Telefono,
    fax: details.Fax,
    email: details.Email,
    isOperative: station.isOperative
  };

  return ResultAsync.fromPromise(
    db
      .insert(stationsTable)
      .values(row)
      .onConflictDoUpdate({
        target: stationsTable.id,
        set: conflictUpdateSetAllColumns(stationsTable)
      }),
    (cause) => new SyncError(`failed to store station ${id}`, { cause })
  ).map(() => undefined);
}
