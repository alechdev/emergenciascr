/**
 * Shapes shared by the pure core (`poll/`, `normalize/`, `reconcile/`, `lifecycle/`,
 * `redact/`). They mirror the database rows without importing the database, so the core can
 * be tested without one.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const SIGAE_INCIDENT_ENDPOINTS = [
  "ObtenerBoletaIncidente",
  "ObtenerDetalleEmergencias",
  "ObtenerEstacionesAtiendeIncidente",
  "ObtenerUnidadesDespachadasIncidente"
] as const;
export type SigaeIncidentEndpoint = (typeof SIGAE_INCIDENT_ENDPOINTS)[number];

export type ClosedAtSource = "observed" | "estimated";

/** An `incidents` row as the sync writes it. `modifiedAt` is set by the writer. */
export interface IncidentRow {
  id: number;
  EEConsecutive: string;
  address: string;
  importantDetails: string;
  incidentTimestamp: Date;
  provinceId: number | null;
  cantonId: number | null;
  districtId: number | null;
  incidentCode: string | null;
  specificIncidentCode: string | null;
  dispatchIncidentCode: string | null;
  specificDispatchIncidentCode: string | null;
  responsibleStation: number | null;
  /** `"0"` when unknown; the web relies on it. */
  latitude: string;
  longitude: string;
  /** SIGAE sends the coordinates as unknown and the stored ones are kept (spec section 6.3). */
  coordinatesClearedUpstream: boolean;
  isOpen: boolean;
  controlledAt: Date | null;
  fireUnderControlAt: Date | null;
  lossesStoppedAt: Date | null;
  allClearAt: Date | null;
  closedAt: Date | null;
  closedAtSource: ClosedAtSource | null;
}

export interface DispatchedVehicleRow {
  id: number;
  incidentId: number;
  stationId: number;
  vehicleId: number | null;
  vehicleInternalNumber: string | null;
  dispatchedTime: Date | null;
  arrivalTime: Date | null;
  departureTime: Date | null;
  baseReturnTime: Date | null;
  /** The sync always writes a boolean, but the column is nullable. */
  attentionOnFoot: boolean | null;
}

export interface DispatchedStationRow {
  id: number;
  incidentId: number;
  stationId: number;
  serviceTypeId: number | null;
  attentionOnFoot: boolean;
}

/** An incident with its children: what the database holds, or what a poll says it should. */
export interface IncidentState {
  incident: IncidentRow;
  vehicles: DispatchedVehicleRow[];
  stations: DispatchedStationRow[];
}

export type ChangeEntity = "incident" | "dispatched_vehicle" | "dispatched_station";
export type ChangeKind = "set" | "changed" | "cleared" | "added" | "removed";

/** A field-level fact. The writer adds `incidentId`, `snapshotIds` and `detectedAt`. */
export interface Change {
  entity: ChangeEntity;
  entityId: number;
  /** Field name, or `*` for added and removed rows. */
  field: string;
  kind: ChangeKind;
  oldValue: JsonValue;
  newValue: JsonValue;
}

export const ANOMALY_CODES = [
  "VALUE_REGRESSED",
  "VALUE_CHANGED_AFTER_SET",
  "TIME_ORDER_VIOLATION",
  "TIME_BEFORE_INCIDENT",
  "TIME_IN_FUTURE",
  "PLACEHOLDER_SHAPE_UNKNOWN",
  "UNIT_NEVER_ARRIVED",
  "UNIT_REMOVED",
  "COORDINATES_MISSING",
  "COORDINATES_MOVED",
  "LOCATION_CLEARED_UPSTREAM",
  "UNKNOWN_INCIDENT_TYPE",
  "MISSING_REFERENCE",
  "REOPENED",
  "OPEN_TOO_LONG",
  "UPSTREAM_PARTIAL_REPORT",
  "INCIDENT_DELETED_UPSTREAM"
] as const;
export type AnomalyCode = (typeof ANOMALY_CODES)[number];

/** A judgment about upstream data. The writer adds `incidentId` and `detectedAt`. */
export interface Anomaly {
  code: AnomalyCode;
  entity: ChangeEntity;
  entityId: number | null;
  details: { [key: string]: JsonValue };
}

export type IncidentSyncPhase = "active" | "settling" | "done" | "deleted" | "failed";

/** An `incident_sync_state` row. */
export interface SyncState {
  incidentId: number;
  phase: IncidentSyncPhase;
  nextPollAt: Date | null;
  lastPolledAt: Date | null;
  upstreamClosedAt: Date | null;
  consecutiveFailures: number;
  notFoundCount: number;
  emptyUnitsCount: number;
  lastError: string | null;
  firstSeenAt: Date;
}

/** A value as stored in `incident_changes` / `sync_anomalies` JSON columns. */
export function toJson(value: Date | string | number | boolean | null | undefined): JsonValue {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}
