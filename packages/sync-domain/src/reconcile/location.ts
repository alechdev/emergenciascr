import { toJson } from "../types";
import { isMissing } from "./diff";

import type { NormalizedIncident } from "../normalize/incident";
import type { IncidentRow, JsonValue } from "../types";

/** From `ObtenerDetalleEmergencias`; `"0"` is unknown. */
const COORDINATE_FIELDS = [
  "latitude",
  "longitude"
] as const satisfies readonly (keyof IncidentRow)[];
/** From `ObtenerBoletaIncidente`; `NULL` is unknown. */
const GEOGRAPHY_FIELDS = [
  "provinceId",
  "cantonId",
  "districtId"
] as const satisfies readonly (keyof IncidentRow)[];

export type LocationFields = "coordinates" | "geography";

/** A known location kept although SIGAE sent it as unknown. */
export interface KeptLocation {
  fields: LocationFields;
  /** The stored values, which stay. */
  kept: { [field: string]: JsonValue };
  /** What SIGAE sent instead. */
  received: { [field: string]: JsonValue };
}

export interface KnownLocationDecision {
  incident: NormalizedIncident;
  kept: KeptLocation[];
}

type Location = Pick<
  IncidentRow,
  (typeof COORDINATE_FIELDS)[number] | (typeof GEOGRAPHY_FIELDS)[number]
>;

/**
 * Once an incident has a known location, SIGAE sending it as unknown doesn't clear it (spec
 * section 6.3): operators clear it for minutes or hours and set it again. A different known
 * value still replaces it.
 *
 * - Coordinates are a pair: either one missing while both stored are known keeps both, so a
 *   half pair is never stored over a full one.
 * - Province, canton and district are a unit: all three missing while any stored one is known
 *   keeps the stored three. When SIGAE sends some of them, what it sent is stored, so a new
 *   province is never mixed with an old canton.
 */
export function keepKnownLocation(
  stored: Location | null,
  next: NormalizedIncident
): KnownLocationDecision {
  if (stored === null) return { incident: next, kept: [] };
  const incident = { ...next };
  const kept: KeptLocation[] = [];
  const known = (row: Location, field: keyof Location) => !isMissing(field, row[field]);

  if (
    COORDINATE_FIELDS.every((field) => known(stored, field)) &&
    COORDINATE_FIELDS.some((field) => !known(next, field))
  ) {
    kept.push(keptLocation("coordinates", COORDINATE_FIELDS, stored, next));
    incident.latitude = stored.latitude;
    incident.longitude = stored.longitude;
  }

  if (
    GEOGRAPHY_FIELDS.some((field) => known(stored, field)) &&
    GEOGRAPHY_FIELDS.every((field) => !known(next, field))
  ) {
    kept.push(keptLocation("geography", GEOGRAPHY_FIELDS, stored, next));
    incident.provinceId = stored.provinceId;
    incident.cantonId = stored.cantonId;
    incident.districtId = stored.districtId;
  }

  return { incident, kept };
}

function keptLocation(
  fields: LocationFields,
  names: readonly (keyof Location)[],
  stored: Location,
  next: Location
): KeptLocation {
  const pick = (row: Location) =>
    Object.fromEntries(names.map((name) => [name, toJson(row[name])]));
  return { fields, kept: pick(stored), received: pick(next) };
}
