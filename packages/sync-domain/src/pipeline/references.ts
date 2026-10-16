import {
  type KnownReferenceRows,
  findKnownReferences,
  upsertIncidentTypes,
  upsertStationDetails,
  upsertVehicleDetails
} from "../persist/references";
import { describeError } from "./errors";

import type { Executor } from "../persist/executor";
import type { ReferenceIds } from "../reconcile/references";
import type { SigaeClient, SigaeResponse } from "@bomberoscr/sigae/client";
import type { Result } from "neverthrow";

const MINUTE_MS = 60_000;

/** The SIGAE calls the resolver makes. */
export type ReferenceSigae = Pick<
  SigaeClient,
  "getStationDetails" | "getVehicleDetails" | "getIncidentTypes"
>;

export interface ReferenceResolverOptions {
  db: Executor;
  sigae: ReferenceSigae;
  now?: () => Date;
  /** How long a station or vehicle SIGAE couldn't provide isn't asked for again. */
  retryMissingAfterMs?: number;
  /** The shortest time between two incident type list fetches. */
  incidentTypesRefreshMs?: number;
}

export interface ReferenceResolution {
  known: KnownReferenceRows;
  /** References fetched from SIGAE and stored by this call. */
  fetched: { stations: number[]; vehicles: number[]; incidentTypes: number | null };
  /** Why some missing references couldn't be fetched or stored. */
  failures: string[];
}

export interface ReferenceResolver {
  /** Which references exist after fetching the missing ones (spec section 9). */
  resolve(ids: ReferenceIds): Promise<ReferenceResolution>;
}

/**
 * On-demand reference resolution: an incident that refers to an unknown station or vehicle
 * fetches its details first, and an unknown incident type code refreshes the incident type
 * list. Geography is not fetched on demand; the reference job brings it.
 *
 * Misses are remembered for a while, so an incident pointing at a station SIGAE has no
 * details for doesn't ask again on every poll. The state is per resolver, so one per process.
 */
export function createReferenceResolver(options: ReferenceResolverOptions): ReferenceResolver {
  const { db, sigae } = options;
  const now = options.now ?? (() => new Date());
  const retryMissingAfterMs = options.retryMissingAfterMs ?? 15 * MINUTE_MS;
  const incidentTypesRefreshMs = options.incidentTypesRefreshMs ?? 15 * MINUTE_MS;
  const missUntil = new Map<string, number>();
  let incidentTypesFetchedAt = -Infinity;

  const recentlyMissed = (key: string) => {
    const until = missUntil.get(key);
    if (until === undefined) return false;
    if (until > now().getTime()) return true;
    missUntil.delete(key);
    return false;
  };
  const missed = (key: string) => missUntil.set(key, now().getTime() + retryMissingAfterMs);

  async function fetchStation(id: number, failures: string[]): Promise<boolean> {
    const key = `station-${id}`;
    if (recentlyMissed(key)) return false;
    const result = await sigae.getStationDetails(id);
    const details = okData(result, `station ${id} details`, failures);
    if (!details) {
      missed(key);
      return false;
    }
    try {
      await upsertStationDetails(db, id, details);
      return true;
    } catch (error) {
      failures.push(`station ${id}: failed to store: ${describeError(error)}`);
      missed(key);
      return false;
    }
  }

  async function fetchVehicle(
    id: number,
    knownStations: ReadonlySet<number>,
    fetchedStations: number[],
    failures: string[]
  ): Promise<boolean> {
    const key = `vehicle-${id}`;
    if (recentlyMissed(key)) return false;
    const result = await sigae.getVehicleDetails(id);
    const details = okData(result, `vehicle ${id} details`, failures);
    if (!details) {
      missed(key);
      return false;
    }
    const stationId = details.Id_estacion;
    if (!knownStations.has(stationId) && !fetchedStations.includes(stationId)) {
      const stored = await findKnownReferences(db, { ...EMPTY_IDS, stations: [stationId] });
      if (!stored.stations.has(stationId)) {
        if (!(await fetchStation(stationId, failures))) {
          failures.push(`vehicle ${id}: its station ${stationId} is unknown`);
          missed(key);
          return false;
        }
        fetchedStations.push(stationId);
      }
    }
    try {
      await upsertVehicleDetails(db, id, details);
      return true;
    } catch (error) {
      failures.push(`vehicle ${id}: failed to store: ${describeError(error)}`);
      missed(key);
      return false;
    }
  }

  return {
    async resolve(ids) {
      let known = await findKnownReferences(db, ids);
      const failures: string[] = [];
      const fetched: ReferenceResolution["fetched"] = {
        stations: [],
        vehicles: [],
        incidentTypes: null
      };

      for (const id of ids.stations) {
        if (!known.stations.has(id) && (await fetchStation(id, failures))) {
          fetched.stations.push(id);
        }
      }
      for (const id of ids.vehicles) {
        if (known.vehicles.has(id)) continue;
        if (await fetchVehicle(id, known.stations, fetched.stations, failures)) {
          fetched.vehicles.push(id);
        }
      }

      const unknownTypes = ids.incidentTypes.filter((code) => !known.incidentTypes.has(code));
      if (
        unknownTypes.length > 0 &&
        now().getTime() - incidentTypesFetchedAt >= incidentTypesRefreshMs
      ) {
        incidentTypesFetchedAt = now().getTime();
        const types = okData(await sigae.getIncidentTypes(), "incident types", failures);
        if (types) {
          try {
            fetched.incidentTypes = await upsertIncidentTypes(db, types.items);
          } catch (error) {
            failures.push(`incident types: failed to store: ${describeError(error)}`);
          }
        }
      }

      if (
        fetched.stations.length > 0 ||
        fetched.vehicles.length > 0 ||
        fetched.incidentTypes !== null
      ) {
        known = await findKnownReferences(db, ids);
      }
      return { known, fetched, failures };
    }
  };
}

const EMPTY_IDS: ReferenceIds = {
  stations: [],
  vehicles: [],
  incidentTypes: [],
  provinces: [],
  cantons: [],
  districts: []
};

function okData<T>(
  result: Result<SigaeResponse<T>, Error>,
  what: string,
  failures: string[]
): T | null {
  if (result.isErr()) {
    failures.push(`${what}: ${result.error.message}`);
    return null;
  }
  const response = result.value;
  if (response.kind === "ok") return response.data;
  failures.push(
    response.kind === "not_found"
      ? `${what}: SIGAE has no records (Codigo 03)`
      : `${what}: SIGAE answered Codigo ${response.code} (${response.description})`
  );
  return null;
}
