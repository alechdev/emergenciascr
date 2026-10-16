export {
  COORDINATES_MOVED_THRESHOLD_KM,
  TIME_BEFORE_INCIDENT_TOLERANCE_MS,
  TIME_IN_FUTURE_TOLERANCE_MS,
  anomalyKey,
  dedupeAnomalies,
  detectAnomalies,
  placeholderAnomalies,
  timeOrderViolation,
  type AnomalyContext
} from "./anomalies";
export {
  INCIDENT_FIELDS,
  STATION_FIELDS,
  VEHICLE_FIELDS,
  diffIncidentState,
  removalChanges
} from "./diff";
export {
  EMPTY_UNITS_POLLS_BEFORE_DELETE,
  applyEmptyUnitsRule,
  type EmptyUnitsDecision
} from "./removal";
export {
  applyKnownReferences,
  collectReferences,
  mergeReferences,
  type AppliedReferences,
  type KnownReferences,
  type ReferenceIds
} from "./references";
