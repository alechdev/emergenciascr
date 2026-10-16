import { normalizePoll } from "../normalize/index";
import { type ReferenceIds, collectReferences } from "../reconcile/references";

import type { PollClassification } from "./classify";

/**
 * The stations, vehicles, incident types and geography a poll refers to, so the caller can
 * fetch the missing ones before `processPoll` (spec section 9). Empty for polls that
 * store nothing.
 */
export function pollReferences(
  incidentId: number,
  classification: PollClassification
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
  return collectReferences(normalizePoll(incidentId, classification.data));
}
