import type { Anomaly } from "../types";
import type { NormalizedIncident } from "./incident";

const INCIDENT_TYPE_FIELDS = [
  "incidentCode",
  "specificIncidentCode",
  "dispatchIncidentCode",
  "specificDispatchIncidentCode"
] as const;

export interface ResolvedIncidentTypes {
  incident: NormalizedIncident;
  /** Codes missing from `incident_types`; the caller should trigger an incident-types sync. */
  unknownCodes: string[];
  anomalies: Anomaly[];
}

/** Unknown incident type codes become `NULL` (they are foreign keys) plus an anomaly. */
export function resolveIncidentTypes(
  incident: NormalizedIncident,
  knownCodes: ReadonlySet<string>
): ResolvedIncidentTypes {
  const resolved: NormalizedIncident = { ...incident };
  const unknownCodes = new Set<string>();
  const anomalies: Anomaly[] = [];
  for (const field of INCIDENT_TYPE_FIELDS) {
    const code = incident[field];
    if (code === null || knownCodes.has(code)) continue;
    resolved[field] = null;
    unknownCodes.add(code);
    anomalies.push({
      code: "UNKNOWN_INCIDENT_TYPE",
      entity: "incident",
      entityId: incident.id,
      details: { field, incidentCode: code }
    });
  }
  return { incident: resolved, unknownCodes: [...unknownCodes], anomalies };
}
