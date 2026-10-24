import { isMissingDate } from "@bomberoscr/lib/missing-date";

import { toJson } from "../types";

import type {
  Change,
  ChangeEntity,
  ChangeKind,
  DispatchedStationRow,
  DispatchedVehicleRow,
  IncidentRow,
  IncidentState,
  JsonValue
} from "../types";

type FieldValue = Date | string | number | boolean | null;

export const INCIDENT_FIELDS = [
  "EEConsecutive",
  "address",
  "importantDetails",
  "incidentTimestamp",
  "provinceId",
  "cantonId",
  "districtId",
  "incidentCode",
  "specificIncidentCode",
  "dispatchIncidentCode",
  "specificDispatchIncidentCode",
  "responsibleStation",
  "latitude",
  "longitude",
  "coordinatesClearedUpstream",
  "isOpen",
  "controlledAt",
  "fireUnderControlAt",
  "lossesStoppedAt",
  "allClearAt",
  "closedAt",
  "closedAtSource"
] as const satisfies readonly (keyof IncidentRow)[];

export const VEHICLE_FIELDS = [
  "stationId",
  "vehicleId",
  "vehicleInternalNumber",
  "dispatchedTime",
  "arrivalTime",
  "departureTime",
  "baseReturnTime",
  "attentionOnFoot"
] as const satisfies readonly (keyof DispatchedVehicleRow)[];

export const STATION_FIELDS = [
  "stationId",
  "serviceTypeId",
  "attentionOnFoot"
] as const satisfies readonly (keyof DispatchedStationRow)[];

const COORDINATE_FIELDS: ReadonlySet<string> = new Set(["latitude", "longitude"]);

/**
 * Field-level changes from the stored state to the next one. New and deleted rows produce a
 * single `added` / `removed` change with the whole row; existing rows produce `set`,
 * `changed` or `cleared` per field. A field unknown before and after (see {@link isMissing})
 * has no change.
 */
export function diffIncidentState(current: IncidentState | null, next: IncidentState): Change[] {
  return [
    ...diffRows("incident", current ? [current.incident] : [], [next.incident], INCIDENT_FIELDS),
    ...diffRows("dispatched_vehicle", current?.vehicles ?? [], next.vehicles, VEHICLE_FIELDS),
    ...diffRows("dispatched_station", current?.stations ?? [], next.stations, STATION_FIELDS)
  ];
}

/** `removed` changes for an incident and everything under it. */
export function removalChanges(current: IncidentState): Change[] {
  return [
    ...current.vehicles.map((row) => removed("dispatched_vehicle", row, VEHICLE_FIELDS)),
    ...current.stations.map((row) => removed("dispatched_station", row, STATION_FIELDS)),
    removed("incident", current.incident, INCIDENT_FIELDS)
  ];
}

function diffRows<Row extends { id: number }>(
  entity: ChangeEntity,
  currentRows: readonly Row[],
  nextRows: readonly Row[],
  fields: readonly (keyof Row & string)[]
): Change[] {
  const changes: Change[] = [];
  const currentById = new Map(currentRows.map((row) => [row.id, row]));
  const nextIds = new Set(nextRows.map((row) => row.id));

  for (const row of nextRows) {
    const previous = currentById.get(row.id);
    if (!previous) {
      changes.push({
        entity,
        entityId: row.id,
        field: "*",
        kind: "added",
        oldValue: null,
        newValue: rowToJson(row, fields)
      });
      continue;
    }
    for (const field of fields) {
      const oldValue = previous[field] as FieldValue;
      const newValue = row[field] as FieldValue;
      if (sameValue(oldValue, newValue)) continue;
      if (isMissing(field, oldValue) && isMissing(field, newValue)) continue;
      changes.push({
        entity,
        entityId: row.id,
        field,
        kind: changeKind(field, oldValue, newValue),
        oldValue: toJson(oldValue),
        newValue: toJson(newValue)
      });
    }
  }
  for (const row of currentRows) {
    if (!nextIds.has(row.id)) changes.push(removed(entity, row, fields));
  }
  return changes;
}

function removed<Row extends { id: number }>(
  entity: ChangeEntity,
  row: Row,
  fields: readonly (keyof Row & string)[]
): Change {
  return {
    entity,
    entityId: row.id,
    field: "*",
    kind: "removed",
    oldValue: rowToJson(row, fields),
    newValue: null
  };
}

export function rowToJson<Row>(
  row: Row,
  fields: readonly (keyof Row & string)[]
): { [key: string]: JsonValue } {
  return Object.fromEntries(fields.map((field) => [field, toJson(row[field] as FieldValue)]));
}

export function sameValue(a: FieldValue, b: FieldValue): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/**
 * Whether a stored value means "unknown": `NULL`, an empty string, a `"0"` coordinate, or a
 * placeholder date (the legacy sync stored SIGAE's `0001-01-01` instead of `NULL`).
 */
export function isMissing(field: string, value: FieldValue): boolean {
  if (value === null || value === "") return true;
  if (value instanceof Date) return isMissingDate(value);
  return COORDINATE_FIELDS.has(field) && Number(value) === 0;
}

function changeKind(field: string, oldValue: FieldValue, newValue: FieldValue): ChangeKind {
  if (isMissing(field, oldValue)) return "set";
  if (isMissing(field, newValue)) return "cleared";
  return "changed";
}
