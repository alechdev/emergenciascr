import { normalizeIncidentTypeCode, type NormalizedIncident } from "./incident";

import type { Anomaly } from "../types";
import type { IncidentDetails } from "@bomberoscr/sigae/client";

/** Each incident type column with the detail fields SIGAE sends its code and name in. */
const INCIDENT_TYPE_FIELDS = [
  ["incidentCode", "codigo_tipo_incidente", "tipo_incidente"],
  ["specificIncidentCode", "codigo_tipo_incidente_esp", "tipo_incidente_esp"],
  ["dispatchIncidentCode", "codigo_tipo_incidente_despacho", "tipo_incidente_despacho"],
  [
    "specificDispatchIncidentCode",
    "codigo_tipo_incidente_despacho_esp",
    "tipo_incidente_despacho_esp"
  ]
] as const satisfies readonly [
  keyof NormalizedIncident,
  keyof IncidentDetails,
  keyof IncidentDetails
][];

/**
 * What an `UNKNOWN_INCIDENT_TYPE` stored: `created`, the code, from a type this poll creates
 * from the incident's names; `inferred`, the code, from a type an earlier poll created that
 * way; `parent`, the nearest known ancestor; `none`, `NULL`.
 */
export type IncidentTypeResolution = "created" | "inferred" | "parent" | "none";

/** An incident type to create from an incident's data, since SIGAE's type list lacks it. */
export interface NewIncidentType {
  code: string;
  name: string;
}

export interface KnownIncidentTypes {
  /** Codes in `incident_types`, with the ancestors of the incident's codes. */
  known: ReadonlySet<string>;
  /** Known codes whose types were created from incident data, not SIGAE's type list. */
  inferred?: ReadonlySet<string>;
  /** The name SIGAE sent with each code in the same detail response. */
  names?: ReadonlyMap<string, string>;
}

export interface ResolvedIncidentTypes {
  incident: NormalizedIncident;
  /** Codes missing from `incident_types`; the caller should trigger an incident-types sync. */
  unknownCodes: string[];
  /** Types to create before the incident is stored, parents first. */
  created: NewIncidentType[];
  anomalies: Anomaly[];
}

/**
 * Incident type codes are foreign keys (spec section 6.3). A code missing from
 * `incident_types` gets a type created from the name SIGAE sent with it; without one, the
 * nearest known ancestor is stored, and without that, `NULL`. Each such code, and each
 * code of a type created that way, is an `UNKNOWN_INCIDENT_TYPE`.
 */
export function resolveIncidentTypes(
  incident: NormalizedIncident,
  types: KnownIncidentTypes
): ResolvedIncidentTypes {
  const { known, inferred = new Set<string>(), names = new Map<string, string>() } = types;
  const resolved: NormalizedIncident = { ...incident };
  const unknownCodes = new Set<string>();
  const available = new Set(known);
  const created: NewIncidentType[] = [];
  for (const [field] of INCIDENT_TYPE_FIELDS) {
    const code = incident[field];
    if (code === null || known.has(code)) continue;
    unknownCodes.add(code);
    const name = names.get(code);
    if (name === undefined || available.has(code)) continue;
    available.add(code);
    created.push({ code, name });
  }
  const createdCodes = new Set(created.map((type) => type.code));

  const anomalies: Anomaly[] = [];
  for (const [field] of INCIDENT_TYPE_FIELDS) {
    const code = incident[field];
    if (code === null) continue;
    let storedCode: string | null = code;
    let resolution: IncidentTypeResolution;
    if (known.has(code)) {
      if (!inferred.has(code)) continue;
      resolution = "inferred";
    } else if (createdCodes.has(code)) {
      resolution = "created";
    } else {
      storedCode = nearestIncidentTypeAncestor(code, available);
      resolution = storedCode === null ? "none" : "parent";
    }
    resolved[field] = storedCode;
    anomalies.push({
      code: "UNKNOWN_INCIDENT_TYPE",
      entity: "incident",
      entityId: incident.id,
      details: { field, incidentCode: code, storedCode, resolution }
    });
  }
  return {
    incident: resolved,
    unknownCodes: [...unknownCodes],
    created: created.sort((a, b) => depth(a.code) - depth(b.code)),
    anomalies
  };
}

/**
 * The non-empty name SIGAE sent with each code in a detail response. A name is only trusted
 * for the code it came with; the first one wins if two fields disagree.
 */
export function incidentTypeNames(details: IncidentDetails): Map<string, string> {
  const names = new Map<string, string>();
  for (const [, codeField, nameField] of INCIDENT_TYPE_FIELDS) {
    const code = normalizeIncidentTypeCode(details[codeField]);
    // Typed as a string, but SIGAE may send `null`.
    const raw: unknown = details[nameField];
    const name = typeof raw === "string" ? raw.trim() : "";
    if (code !== null && name !== "" && !names.has(code)) names.set(code, name);
  }
  return names;
}

/** Codes are dotted paths: `6.1.1` → `["6.1", "6"]`, nearest first. */
export function incidentTypeAncestors(code: string): string[] {
  const segments = code.split(".");
  const ancestors: string[] = [];
  for (let length = segments.length - 1; length > 0; length -= 1) {
    ancestors.push(segments.slice(0, length).join("."));
  }
  return ancestors;
}

/** The nearest ancestor of `code` among `available`, skipping missing levels. */
export function nearestIncidentTypeAncestor(
  code: string,
  available: ReadonlySet<string>
): string | null {
  return incidentTypeAncestors(code).find((ancestor) => available.has(ancestor)) ?? null;
}

const depth = (code: string) => code.split(".").length;
