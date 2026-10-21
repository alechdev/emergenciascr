import { normalizePoll } from "../normalize/index";
import { type ReferenceIds, collectReferences, mergeReferences } from "../reconcile/references";

import type { IncidentState } from "../types";
import type { PollClassification } from "./classify";

/**
 * The stations, vehicles, incident types and geography a poll refers to, so the caller can
 * fetch the missing ones before `processPoll` (spec section 9). Empty for polls that
 * store nothing.
 *
 * `current` is what the database holds: the state a poll stores can keep values from it (a
 * partial report never clears fields, a first empty unit list keeps the units), and those
 * references must count as known too.
 */
export function pollReferences(
  incidentId: number,
  classification: PollClassification,
  current: IncidentState | null = null
): ReferenceIds {
  if (classification.kind !== "ok" && classification.kind !== "partial") {
    return {
      stations: [],
      vehicles: [],
      incidentTypes: [],
      provinces: [],
      cantons: [],
      districts: []
    };
  }
  const polled = collectReferences(normalizePoll(incidentId, classification.data));
  return current ? mergeReferences(polled, collectReferences(current)) : polled;
}
