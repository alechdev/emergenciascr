import { asc, eq } from "@bomberoscr/db/operators";
import { sigaeSnapshots } from "@bomberoscr/db/schema";
/**
 * Turns an incident's `sigae_snapshots` history into fixture polls (`NNN.json`, see
 * `test/fixture-runner.ts`). Used by `capture-fixture.ts`; kept apart so tests can run it
 * against a throwaway database.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { type Allowlist, SNAPSHOT_ALLOWLISTS, redactSnapshot } from "../src/redact/index";
import { SIGAE_INCIDENT_ENDPOINTS } from "../src/types";

import type { JsonValue, SigaeIncidentEndpoint } from "../src/types";
import type { Database } from "@bomberoscr/db/client";

export interface SnapshotRow {
  endpoint: SigaeIncidentEndpoint;
  fetchedAt: Date;
  payload: unknown;
}

export type CapturedResponse =
  | { body: JsonValue }
  | { error: { kind: "network"; message: string } };

export interface CapturedPoll {
  incidentId: number;
  fetchedAt: string;
  responses: Record<SigaeIncidentEndpoint, CapturedResponse>;
}

/** Fixture files list the endpoints in this order. */
const ENDPOINT_ORDER: readonly SigaeIncidentEndpoint[] = [
  "ObtenerBoletaIncidente",
  "ObtenerDetalleEmergencias",
  "ObtenerEstacionesAtiendeIncidente",
  "ObtenerUnidadesDespachadasIncidente"
];

/** Same values as the SIGAE client's recorded fixtures (`packages/sigae/scripts`). */
const SYNTHETIC_ADDRESS = "DIRECCION DE PRUEBA";
const SYNTHETIC_LATITUDE = 9.9333;
const SYNTHETIC_LONGITUDE = -84.0833;

/** Free-text location fields, per endpoint. */
const ADDRESS_FIELDS: Readonly<Record<SigaeIncidentEndpoint, readonly string[]>> = {
  ObtenerBoletaIncidente: ["DesUbicacion", "Direccion"],
  ObtenerDetalleEmergencias: ["direccion"],
  ObtenerEstacionesAtiendeIncidente: [],
  ObtenerUnidadesDespachadasIncidente: []
};
const COORDINATE_FIELDS: Readonly<Record<string, number>> = {
  latitud: SYNTHETIC_LATITUDE,
  longitud: SYNTHETIC_LONGITUDE
};

/** The connection string with every transaction read-only, so a capture can't write. */
export function readOnlyConnection(url: string): string {
  const connection = new URL(url);
  connection.searchParams.set("options", "-c default_transaction_read_only=on");
  return connection.toString();
}

export async function loadSnapshotRows(db: Database, incidentId: number): Promise<SnapshotRow[]> {
  return db
    .select({
      endpoint: sigaeSnapshots.endpoint,
      fetchedAt: sigaeSnapshots.fetchedAt,
      payload: sigaeSnapshots.payload
    })
    .from(sigaeSnapshots)
    .where(eq(sigaeSnapshots.incidentId, incidentId))
    .orderBy(asc(sigaeSnapshots.fetchedAt), asc(sigaeSnapshots.id));
}

/**
 * Replaces locations with synthetic values: fixtures are public, snapshots are not. Each
 * distinct address gets its own numbered synthetic address, so a changed address still shows
 * as a change. Coordinates move to a synthetic point but keep their offsets from the first
 * one seen, so moves keep their distance (`COORDINATES_MOVED`). Empty values, `null` and `0`
 * are kept because they carry meaning.
 */
export function createLocationMasker() {
  const addresses = new Map<string, string>();
  const anchors = new Map<string, number>();

  function address(value: string): string {
    let masked = addresses.get(value);
    if (masked === undefined) {
      masked = `${SYNTHETIC_ADDRESS} ${addresses.size + 1}`;
      addresses.set(value, masked);
    }
    return masked;
  }

  function coordinate(field: string, value: number): number {
    const anchor = anchors.get(field) ?? value;
    anchors.set(field, anchor);
    return Number(((COORDINATE_FIELDS[field] ?? 0) + (value - anchor)).toFixed(6));
  }

  return (endpoint: SigaeIncidentEndpoint, payload: JsonValue): JsonValue => {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return payload;
    const masked: Record<string, JsonValue> = { ...payload };
    for (const field of ADDRESS_FIELDS[endpoint]) {
      const value = masked[field];
      if (typeof value === "string" && value.trim() !== "") masked[field] = address(value);
    }
    if (endpoint === "ObtenerDetalleEmergencias") {
      for (const field of Object.keys(COORDINATE_FIELDS)) {
        const value = masked[field];
        if (typeof value === "number" && value !== 0) masked[field] = coordinate(field, value);
      }
    }
    return masked;
  };
}

/**
 * One poll per distinct `fetchedAt`, each with the latest snapshot of every endpoint up to
 * then. Snapshots only exist for answers whose payload changed, so polls that changed nothing
 * are missing, and a request that failed replays as the endpoint's previous answer. An
 * endpoint with no snapshot yet replays as a network error.
 */
export function buildFixturePolls(
  incidentId: number,
  rows: readonly SnapshotRow[]
): CapturedPoll[] {
  const mask = createLocationMasker();
  const latest = new Map<SigaeIncidentEndpoint, JsonValue>();
  const byTime = new Map<number, SnapshotRow[]>();
  for (const row of [...rows].sort((a, b) => a.fetchedAt.getTime() - b.fetchedAt.getTime())) {
    const time = row.fetchedAt.getTime();
    byTime.set(time, [...(byTime.get(time) ?? []), row]);
  }

  const polls: CapturedPoll[] = [];
  for (const [time, group] of byTime) {
    for (const row of group) {
      // Snapshots are already redacted; redacting again also drops anything an older
      // allowlist kept that the current one doesn't.
      const payload = redactSnapshot(row.endpoint, row.payload);
      latest.set(
        row.endpoint,
        mask(row.endpoint, inAllowlistOrder(payload, SNAPSHOT_ALLOWLISTS[row.endpoint]))
      );
    }
    const responses = {} as Record<SigaeIncidentEndpoint, CapturedResponse>;
    for (const endpoint of ENDPOINT_ORDER) {
      const body = latest.get(endpoint);
      responses[endpoint] =
        body === undefined
          ? { error: { kind: "network", message: "no snapshot before this poll" } }
          : { body };
    }
    polls.push({ incidentId, fetchedAt: new Date(time).toISOString(), responses });
  }
  validateFixturePolls(polls);
  return polls;
}

/** jsonb doesn't keep key order; fixtures list keys in allowlist order, like SIGAE does. */
function inAllowlistOrder(value: JsonValue, allowlist: Allowlist): JsonValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const ordered: Record<string, JsonValue> = {};
  for (const [key, rule] of Object.entries(allowlist)) {
    if (!Object.hasOwn(value, key)) continue;
    const field = value[key] as JsonValue;
    ordered[key] =
      rule !== true && Array.isArray(field)
        ? field.map((item) => inAllowlistOrder(item, rule.each))
        : field;
  }
  return ordered;
}

/** Throws if a body has a field outside the snapshot allowlists or an unmasked location. */
export function validateFixturePolls(polls: readonly CapturedPoll[]): void {
  for (const poll of polls) {
    for (const endpoint of SIGAE_INCIDENT_ENDPOINTS) {
      const response = poll.responses[endpoint];
      if (!response || !("body" in response)) continue;
      const body = response.body;
      if (JSON.stringify(redactSnapshot(endpoint, body)) !== JSON.stringify(body)) {
        throw new Error(`${poll.fetchedAt} ${endpoint}: a field is outside the allowlist`);
      }
      if (typeof body !== "object" || body === null || Array.isArray(body)) continue;
      for (const field of ADDRESS_FIELDS[endpoint]) {
        const value = body[field];
        if (
          typeof value === "string" &&
          value.trim() !== "" &&
          !value.startsWith(SYNTHETIC_ADDRESS)
        ) {
          throw new Error(`${poll.fetchedAt} ${endpoint}: ${field} is not synthetic`);
        }
      }
    }
  }
}

/** Writes `001.json`, `002.json`, … into an empty or new scenario directory. */
export function writeFixturePolls(directory: string, polls: readonly CapturedPoll[]): string[] {
  if (existsSync(directory) && readdirSync(directory).length > 0) {
    throw new Error(`${directory} is not empty`);
  }
  mkdirSync(directory, { recursive: true });
  return polls.map((poll, index) => {
    const file = `${String(index + 1).padStart(3, "0")}.json`;
    writeFileSync(join(directory, file), `${JSON.stringify(poll, null, 2)}\n`);
    return file;
  });
}
