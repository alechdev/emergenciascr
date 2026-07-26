/** Minimum stations+vehicles (totalDispatched) required to index a closed, older incident. */
export const INCIDENT_INDEX_MIN_HEAT = 5;

/** Rolling freshness window: all incidents newer than this are indexable. */
export const INCIDENT_INDEX_MAX_AGE_DAYS = 7;

export type IncidentIndexabilityInput = {
  isOpen: boolean;
  incidentTimestamp: Date | string;
  /** stations dispatched + vehicles dispatched (same as list `totalDispatched`) */
  totalDispatched: number;
  now?: Date;
};

/**
 * Index when the incident is open, recent, or notably large.
 * Non-indexable pages stay public with `noindex, follow` and are omitted from sitemaps.
 */
export function isIncidentIndexable({
  isOpen,
  incidentTimestamp,
  totalDispatched,
  now = new Date()
}: IncidentIndexabilityInput): boolean {
  if (isOpen) return true;
  if (totalDispatched >= INCIDENT_INDEX_MIN_HEAT) return true;

  const timestamp =
    typeof incidentTimestamp === "string" ? new Date(incidentTimestamp) : incidentTimestamp;
  const ageMs = now.getTime() - timestamp.getTime();
  const maxAgeMs = INCIDENT_INDEX_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

  return ageMs <= maxAgeMs;
}

export function getIncidentRobotsContent(indexable: boolean): string {
  return indexable ? "index, follow" : "noindex, follow";
}
