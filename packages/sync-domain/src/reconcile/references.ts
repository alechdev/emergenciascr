import type { Anomaly, IncidentRow, IncidentState } from "../types";

/** Reference rows an incident state points to through foreign keys (spec section 9). */
export interface ReferenceIds {
  stations: number[];
  vehicles: number[];
  incidentTypes: string[];
  provinces: number[];
  cantons: number[];
  districts: number[];
}

/** The referenced rows the database has. */
export interface KnownReferences {
  stations: ReadonlySet<number>;
  vehicles: ReadonlySet<number>;
  provinces: ReadonlySet<number>;
  cantons: ReadonlySet<number>;
  districts: ReadonlySet<number>;
}

const INCIDENT_TYPE_FIELDS = [
  "incidentCode",
  "specificIncidentCode",
  "dispatchIncidentCode",
  "specificDispatchIncidentCode"
] as const satisfies readonly (keyof IncidentRow)[];

const GEOGRAPHY_FIELDS = [
  ["provinceId", "provinces"],
  ["cantonId", "cantons"],
  ["districtId", "districts"]
] as const satisfies readonly [keyof IncidentRow, keyof KnownReferences][];

type ReferencingState = {
  incident: Pick<
    IncidentRow,
    | "responsibleStation"
    | "provinceId"
    | "cantonId"
    | "districtId"
    | (typeof INCIDENT_TYPE_FIELDS)[number]
  >;
  vehicles: Pick<IncidentState["vehicles"][number], "stationId" | "vehicleId">[];
  stations: Pick<IncidentState["stations"][number], "stationId">[];
};

/** Every reference ID the state uses, without duplicates. */
export function collectReferences(state: ReferencingState): ReferenceIds {
  const stations = new Set<number>();
  const vehicles = new Set<number>();
  if (state.incident.responsibleStation !== null) stations.add(state.incident.responsibleStation);
  for (const row of state.stations) stations.add(row.stationId);
  for (const row of state.vehicles) {
    stations.add(row.stationId);
    if (row.vehicleId !== null) vehicles.add(row.vehicleId);
  }
  const incidentTypes = new Set<string>();
  for (const field of INCIDENT_TYPE_FIELDS) {
    const code = state.incident[field];
    if (code !== null) incidentTypes.add(code);
  }
  const ids = (value: number | null) => (value === null ? [] : [value]);
  return {
    stations: [...stations],
    vehicles: [...vehicles],
    incidentTypes: [...incidentTypes],
    provinces: ids(state.incident.provinceId),
    cantons: ids(state.incident.cantonId),
    districts: ids(state.incident.districtId)
  };
}

export interface AppliedReferences {
  state: IncidentState;
  /** `MISSING_REFERENCE` for every unknown station, vehicle or geography ID. */
  anomalies: Anomaly[];
  /** Unknown stations: they are required foreign keys, so the poll can't be stored. */
  missingStations: number[];
}

/**
 * Spec section 9, after the on-demand fetch: an unknown vehicle becomes `vehicleId = NULL`
 * (the row keeps `vehicleInternalNumber`), an unknown province, canton or district becomes
 * `NULL`, and an unknown station is reported so the poll fails. Each one is a
 * `MISSING_REFERENCE`.
 */
export function applyKnownReferences(
  state: IncidentState,
  known: KnownReferences
): AppliedReferences {
  const anomalies: Anomaly[] = [];
  const missingStations = new Set<number>();
  const incident = { ...state.incident };
  const missingStation = (
    entity: Anomaly["entity"],
    entityId: number,
    field: string,
    stationId: number
  ) => {
    if (known.stations.has(stationId)) return;
    missingStations.add(stationId);
    anomalies.push({
      code: "MISSING_REFERENCE",
      entity,
      entityId,
      details: { field, stationId }
    });
  };

  if (incident.responsibleStation !== null) {
    missingStation("incident", incident.id, "responsibleStation", incident.responsibleStation);
  }
  for (const [field, kind] of GEOGRAPHY_FIELDS) {
    const id = incident[field];
    if (id === null || known[kind].has(id)) continue;
    incident[field] = null;
    anomalies.push({
      code: "MISSING_REFERENCE",
      entity: "incident",
      entityId: incident.id,
      details: { field, [field]: id }
    });
  }
  for (const row of state.stations) {
    missingStation("dispatched_station", row.id, "stationId", row.stationId);
  }
  const vehicles = state.vehicles.map((row) => {
    missingStation("dispatched_vehicle", row.id, "stationId", row.stationId);
    if (row.vehicleId === null || known.vehicles.has(row.vehicleId)) return row;
    anomalies.push({
      code: "MISSING_REFERENCE",
      entity: "dispatched_vehicle",
      entityId: row.id,
      details: {
        field: "vehicleId",
        vehicleId: row.vehicleId,
        vehicleInternalNumber: row.vehicleInternalNumber
      }
    });
    return { ...row, vehicleId: null };
  });

  return {
    state: { incident, vehicles, stations: state.stations },
    anomalies,
    missingStations: [...missingStations]
  };
}
