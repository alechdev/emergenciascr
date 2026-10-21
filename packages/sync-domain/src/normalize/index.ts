import { normalizeIncident, type NormalizedIncident } from "./incident";
import { normalizeDispatchedStations } from "./stations";
import { normalizeDispatchedVehicles } from "./units";

import type { IncidentPollData } from "../poll/classify";
import type { DispatchedStationRow, DispatchedVehicleRow } from "../types";
import type { PlaceholderIssue } from "./dates";

export { incidentTimestamp, normalizeDate, type PlaceholderIssue } from "./dates";
export {
  REPORT_FIELDS,
  keepReportValues,
  normalizeIncident,
  normalizeIncidentTypeCode,
  type NormalizedIncident
} from "./incident";
export {
  incidentTypeAncestors,
  incidentTypeNames,
  nearestIncidentTypeAncestor,
  resolveIncidentTypes,
  type IncidentTypeResolution,
  type KnownIncidentTypes,
  type NewIncidentType,
  type ResolvedIncidentTypes
} from "./incident-types";
export { normalizeDispatchedStations, responsibleStation } from "./stations";
export { ON_FOOT_UNIT, normalizeDispatchedVehicles } from "./units";

export interface NormalizedPoll {
  incident: NormalizedIncident;
  vehicles: DispatchedVehicleRow[];
  stations: DispatchedStationRow[];
  /** Implausible dates that were stored as `NULL`. */
  issues: PlaceholderIssue[];
}

/** Normalizes the data of an `ok` or `partial` poll. */
export function normalizePoll(incidentId: number, data: IncidentPollData): NormalizedPoll {
  const issues: PlaceholderIssue[] = [];
  return {
    incident: normalizeIncident(incidentId, data, issues),
    vehicles: normalizeDispatchedVehicles(incidentId, data.units, issues),
    stations: normalizeDispatchedStations(incidentId, data.stations),
    issues
  };
}
