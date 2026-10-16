import { db } from "@bomberoscr/db/index";
import { upsertListedStation, upsertStationDetails } from "@bomberoscr/sync-domain/persist";
import { ResultAsync, okAsync } from "neverthrow";

import { sigae } from "@/config/sigae";
import { SyncError } from "@/lib/errors";
import { expectOk } from "@/lib/sigae";

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
        ? store(id, upsertListedStation(db, station))
        : expectOk(okAsync(response), `station ${id} details`).andThen((details) =>
            store(id, upsertStationDetails(db, id, details, station))
          )
    );
}

function store(id: number, write: Promise<void>): ResultAsync<void, SyncError> {
  return ResultAsync.fromPromise(
    write,
    (cause) => new SyncError(`failed to store station ${id}`, { cause })
  );
}
