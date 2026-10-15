import { toJson } from "../types";
import { INCIDENT_FIELDS, STATION_FIELDS, VEHICLE_FIELDS, isMissing, sameValue } from "./diff";

import type { PlaceholderIssue } from "../normalize/dates";
import type {
  Anomaly,
  AnomalyCode,
  ChangeEntity,
  DispatchedVehicleRow,
  IncidentRow,
  IncidentState
} from "../types";

const MINUTE_MS = 60_000;

/** How much earlier than the incident time a unit time may be before it is reported. */
export const TIME_BEFORE_INCIDENT_TOLERANCE_MS = 5 * MINUTE_MS;
/** How far in the future a time may be (clock skew) before it is reported. */
export const TIME_IN_FUTURE_TOLERANCE_MS = 5 * MINUTE_MS;
export const COORDINATES_MOVED_THRESHOLD_KM = 1;

const VEHICLE_TIME_FIELDS = [
  "dispatchedTime",
  "arrivalTime",
  "departureTime",
  "baseReturnTime"
] as const satisfies readonly (keyof DispatchedVehicleRow)[];

const INCIDENT_TIME_FIELDS = [
  "incidentTimestamp",
  "controlledAt",
  "fireUnderControlAt",
  "lossesStoppedAt",
  "allClearAt"
] as const satisfies readonly (keyof IncidentRow)[];

/** Derived by the sync, not reported by SIGAE, so they can't regress upstream. */
const DERIVED_INCIDENT_FIELDS: ReadonlySet<string> = new Set(["closedAt", "closedAtSource"]);

/**
 * Anomalies describing a state of the data rather than an event. They are recorded once per
 * incident, field and row (see {@link dedupeAnomalies}), not on every poll that sees them.
 */
const CONDITION_CODES: ReadonlySet<AnomalyCode> = new Set<AnomalyCode>([
  "TIME_ORDER_VIOLATION",
  "TIME_BEFORE_INCIDENT",
  "TIME_IN_FUTURE",
  "PLACEHOLDER_SHAPE_UNKNOWN",
  "UNKNOWN_INCIDENT_TYPE",
  "MISSING_REFERENCE",
  "UPSTREAM_PARTIAL_REPORT"
]);

export interface AnomalyContext {
  now: Date;
  /** The report answered `99`. */
  partialReport?: { description: string };
  issues?: readonly PlaceholderIssue[];
  /** This poll moved the incident to `done`. */
  reachedDone?: boolean;
}

/**
 * Judgments about a poll (spec section 7), comparing the stored state with the next one.
 * Anomalies never change what gets stored.
 */
export function detectAnomalies(
  previous: IncidentState | null,
  next: IncidentState,
  context: AnomalyContext
): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const add = (
    code: AnomalyCode,
    entity: ChangeEntity,
    entityId: number | null,
    details: Anomaly["details"] = {}
  ) => anomalies.push({ code, entity, entityId, details });
  const incident = next.incident;

  if (context.partialReport) {
    add("UPSTREAM_PARTIAL_REPORT", "incident", incident.id, {
      description: context.partialReport.description
    });
  }
  for (const issue of context.issues ?? []) {
    add("PLACEHOLDER_SHAPE_UNKNOWN", issue.entity, issue.entityId, {
      field: issue.field,
      sigaeField: issue.sigaeField,
      raw: issue.raw
    });
  }

  if (previous) {
    const before = previous.incident;
    if (!before.isOpen && incident.isOpen) add("REOPENED", "incident", incident.id);
    for (const field of INCIDENT_FIELDS) {
      if (DERIVED_INCIDENT_FIELDS.has(field)) continue;
      if (!isMissing(field, before[field]) && isMissing(field, incident[field])) {
        add("VALUE_REGRESSED", "incident", incident.id, {
          field,
          oldValue: toJson(before[field])
        });
      }
    }
    for (const field of ["latitude", "longitude"] as const) {
      if (changedAfterSet(field, before[field], incident[field])) {
        add("VALUE_CHANGED_AFTER_SET", "incident", incident.id, {
          field,
          oldValue: before[field],
          newValue: incident[field]
        });
      }
    }
    const distanceKm = coordinatesDistanceKm(before, incident);
    if (distanceKm !== null && distanceKm > COORDINATES_MOVED_THRESHOLD_KM) {
      add("COORDINATES_MOVED", "incident", incident.id, {
        from: { latitude: before.latitude, longitude: before.longitude },
        to: { latitude: incident.latitude, longitude: incident.longitude },
        distanceKm: Math.round(distanceKm * 1000) / 1000
      });
    }

    const nextVehicles = new Map(next.vehicles.map((row) => [row.id, row]));
    for (const stored of previous.vehicles) {
      const vehicle = nextVehicles.get(stored.id);
      if (!vehicle) {
        add("UNIT_REMOVED", "dispatched_vehicle", stored.id, {
          stationId: stored.stationId,
          vehicleId: stored.vehicleId,
          vehicleInternalNumber: stored.vehicleInternalNumber
        });
        continue;
      }
      for (const field of VEHICLE_FIELDS) {
        if (!isMissing(field, stored[field]) && isMissing(field, vehicle[field])) {
          add("VALUE_REGRESSED", "dispatched_vehicle", vehicle.id, {
            field,
            oldValue: toJson(stored[field])
          });
        }
      }
      for (const field of VEHICLE_TIME_FIELDS) {
        if (changedAfterSet(field, stored[field], vehicle[field])) {
          add("VALUE_CHANGED_AFTER_SET", "dispatched_vehicle", vehicle.id, {
            field,
            oldValue: toJson(stored[field]),
            newValue: toJson(vehicle[field])
          });
        }
      }
    }

    const nextStations = new Map(next.stations.map((row) => [row.id, row]));
    for (const stored of previous.stations) {
      const station = nextStations.get(stored.id);
      if (!station) {
        add("UNIT_REMOVED", "dispatched_station", stored.id, { stationId: stored.stationId });
        continue;
      }
      for (const field of STATION_FIELDS) {
        if (!isMissing(field, stored[field]) && isMissing(field, station[field])) {
          add("VALUE_REGRESSED", "dispatched_station", station.id, {
            field,
            oldValue: toJson(stored[field])
          });
        }
      }
    }
  }

  const futureLimit = context.now.getTime() + TIME_IN_FUTURE_TOLERANCE_MS;
  for (const field of INCIDENT_TIME_FIELDS) {
    const value = incident[field];
    if (value && value.getTime() > futureLimit) {
      add("TIME_IN_FUTURE", "incident", incident.id, { field, value: value.toISOString() });
    }
  }

  const earliestUnitTime = incident.incidentTimestamp.getTime() - TIME_BEFORE_INCIDENT_TOLERANCE_MS;
  for (const vehicle of next.vehicles) {
    for (const field of VEHICLE_TIME_FIELDS) {
      const value = vehicle[field];
      if (!value) continue;
      if (value.getTime() > futureLimit) {
        add("TIME_IN_FUTURE", "dispatched_vehicle", vehicle.id, {
          field,
          value: value.toISOString()
        });
      }
      if (value.getTime() < earliestUnitTime) {
        add("TIME_BEFORE_INCIDENT", "dispatched_vehicle", vehicle.id, {
          field,
          value: value.toISOString(),
          incidentTimestamp: incident.incidentTimestamp.toISOString()
        });
      }
    }
    const violation = timeOrderViolation(vehicle);
    if (violation) {
      add("TIME_ORDER_VIOLATION", "dispatched_vehicle", vehicle.id, {
        earlierField: violation[0],
        laterField: violation[1],
        times: Object.fromEntries(VEHICLE_TIME_FIELDS.map((f) => [f, toJson(vehicle[f])]))
      });
    }
  }

  if (context.reachedDone) {
    for (const vehicle of next.vehicles) {
      if (vehicle.dispatchedTime && !vehicle.arrivalTime && !vehicle.departureTime) {
        add("UNIT_NEVER_ARRIVED", "dispatched_vehicle", vehicle.id, {
          dispatchedTime: vehicle.dispatchedTime.toISOString()
        });
      }
    }
    if (isMissing("latitude", incident.latitude) || isMissing("longitude", incident.longitude)) {
      add("COORDINATES_MISSING", "incident", incident.id);
    }
  }

  return anomalies;
}

/**
 * The first pair of times out of order: dispatched ≤ arrival ≤ departure ≤ base return,
 * ignoring missing times.
 */
export function timeOrderViolation(vehicle: DispatchedVehicleRow): [string, string] | null {
  let previous: { field: string; time: number } | null = null;
  for (const field of VEHICLE_TIME_FIELDS) {
    const value = vehicle[field];
    if (!value) continue;
    if (previous && value.getTime() < previous.time) return [previous.field, field];
    previous = { field, time: value.getTime() };
  }
  return null;
}

/** Identifies a condition anomaly across polls. */
export function anomalyKey(anomaly: Pick<Anomaly, "code" | "entity" | "entityId" | "details">) {
  const field = anomaly.details.field;
  return [
    anomaly.code,
    anomaly.entity,
    anomaly.entityId ?? "",
    typeof field === "string" ? field : ""
  ].join(":");
}

/**
 * Drops condition anomalies already recorded for the incident (`recorded` holds their
 * {@link anomalyKey}s) or repeated within the batch. Event anomalies are always kept.
 */
export function dedupeAnomalies(
  anomalies: readonly Anomaly[],
  recorded: ReadonlySet<string>
): Anomaly[] {
  const seen = new Set(recorded);
  return anomalies.filter((anomaly) => {
    if (!CONDITION_CODES.has(anomaly.code)) return true;
    const key = anomalyKey(anomaly);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function changedAfterSet(
  field: string,
  before: Date | string | null,
  after: Date | string | null
): boolean {
  return !isMissing(field, before) && !isMissing(field, after) && !sameValue(before, after);
}

function coordinatesDistanceKm(a: IncidentRow, b: IncidentRow): number | null {
  const points = [a.latitude, a.longitude, b.latitude, b.longitude].map(Number);
  if (points.some((value) => !Number.isFinite(value) || value === 0)) return null;
  const [lat1, lon1, lat2, lon2] = points as [number, number, number, number];
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
