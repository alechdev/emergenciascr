import { parseSigaeDate } from "@bomberoscr/sigae/dates";

import type { ChangeEntity } from "../types";

/** A pre-1971 date that is not SIGAE's known placeholder. Stored as `NULL`. */
export interface PlaceholderIssue {
  entity: ChangeEntity;
  entityId: number;
  /** Normalized field name. */
  field: string;
  sigaeField: string;
  raw: string;
}

const FIRST_PLAUSIBLE_YEAR = 1971;

export interface DateSource {
  entity: ChangeEntity;
  entityId: number;
  issues: PlaceholderIssue[];
}

/**
 * Parses a SIGAE date (section 6.2). The known placeholder and missing values become `null`;
 * any other year before 1971 also becomes `null` and is recorded as an issue.
 */
export function normalizeDate(
  raw: string | null | undefined,
  field: string,
  sigaeField: string,
  source: DateSource
): Date | null {
  const parsed = parseSigaeDate(raw);
  if (parsed === null || raw === null || raw === undefined) return null;
  if (Number(raw.slice(0, 4)) < FIRST_PLAUSIBLE_YEAR) {
    source.issues.push({
      entity: source.entity,
      entityId: source.entityId,
      field,
      sigaeField,
      raw
    });
    return null;
  }
  return parsed;
}

/**
 * The incident time: the date of `Fecha` (midnight of the incident day) with the time of
 * `Hora_Aviso`. `null` when either is missing.
 */
export function incidentTimestamp(
  fecha: string | null | undefined,
  horaAviso: string | null | undefined,
  source: DateSource
): Date | null {
  const date = normalizeDate(fecha, "incidentTimestamp", "Fecha", source);
  const time = normalizeDate(horaAviso, "incidentTimestamp", "Hora_Aviso", source);
  if (date === null || time === null || !fecha || !horaAviso) return null;
  return parseSigaeDate(`${fecha.slice(0, 10)}T${horaAviso.slice(11)}`);
}
