/**
 * Shared by the sync-domain and sync-v2 integration tests: a throwaway Postgres migrated with
 * the migrate runner, synthetic reference rows, a fake SIGAE behind the real client and a
 * fixture replay through `syncIncident`.
 *
 * The database comes only from `TEST_DATABASE_URL`, never from `DRIZZLE_POSTGRES_URL` or a
 * `.env`, and must be on loopback, so the suites can't touch a real database.
 */
import { createDatabase, type Database } from "@bomberoscr/db/client";
import { migrateDatabase } from "@bomberoscr/db/migrate";
import { asc, eq, sql } from "@bomberoscr/db/operators";
import {
  cantons,
  districts,
  incidentChanges,
  incidentTypes,
  provinces,
  sigaeSnapshots,
  stations,
  syncAnomalies,
  vehicles
} from "@bomberoscr/db/schema";
import { createSigaeClient, type SigaeEndpoint } from "@bomberoscr/sigae/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadIncidentState, loadSyncState } from "../../src/persist/incident-state";
import {
  createReferenceResolver,
  type ReferenceResolverOptions
} from "../../src/pipeline/references";
import { type SyncIncidentDeps, syncIncident } from "../../src/pipeline/sync-incident";
import { KNOWN_INCIDENT_TYPES } from "../builders";
import {
  type FixtureOutcome,
  type FixtureSnapshot,
  type Serialized,
  readSnapshot,
  snapshotFiles,
  toPlainJson
} from "../fixture-runner";

import type { SigaeIncidentEndpoint } from "../../src/types";

export { FIXTURES_DIR, listScenarios, readSnapshot, snapshotFiles } from "../fixture-runner";
export type { FixtureOutcome, FixtureSnapshot } from "../fixture-runner";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || undefined;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Refuses anything but a loopback URL that isn't the app's own configured one. */
export function assertThrowaway(url: string, variable: string, appVariables: string[]): void {
  const host = new URL(url).hostname;
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(`${variable} must point at a throwaway server on loopback, not ${host}`);
  }
  for (const name of appVariables) {
    if (process.env[name] && process.env[name] === url && name !== variable) {
      throw new Error(`${variable} must not be the same as ${name}`);
    }
  }
}

export type TestDatabase = ReturnType<typeof createDatabase>;

let migrated: Promise<unknown> | undefined;

/** A pool on the test database, migrated once per process. */
export async function openTestDatabase(): Promise<TestDatabase> {
  const url = TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  assertThrowaway(url, "TEST_DATABASE_URL", ["DRIZZLE_POSTGRES_URL"]);
  migrated ??= migrateDatabase(url);
  await migrated;
  return createDatabase(url);
}

/** Empties every application table. */
export async function resetDatabase(db: Database): Promise<void> {
  const tables = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public'`
  );
  if (tables.rows.length === 0) return;
  const list = sql.join(
    tables.rows.map((row) => sql.identifier(row.tablename)),
    sql.raw(", ")
  );
  await db.execute(sql`truncate ${list} restart identity cascade`);
}

/** Reference rows the fixtures point at (stations 2 and 5, vehicles 140/152/210, …). */
export async function seedReferences(db: Database): Promise<void> {
  await db.insert(provinces).values({ id: 1, name: "SAN JOSE", code: "1" });
  await db.insert(cantons).values({ id: 101, name: "SAN JOSE", code: "101", provinceId: 1 });
  await db.insert(districts).values({ id: 10101, name: "CARMEN", code: "10101", cantonId: 101 });
  await db
    .insert(stations)
    .values([station(2, "METROPOLITANA NORTE", "1-1"), station(5, "PAVAS", "1-4")]);
  await db
    .insert(vehicles)
    .values([vehicle(140, "M-12", 2), vehicle(152, "M-20", 2), vehicle(210, "U-31", 5)]);
  const codes = [...KNOWN_INCIDENT_TYPES].sort((a, b) => a.length - b.length);
  const roots = [...new Set(codes.map((code) => code.split(".")[0] as string))];
  const id = (code: string) => Number(code.replaceAll(".", ""));
  const parent = (code: string) => {
    const parts = code.split(".");
    return parts.length > 1 ? id(parts.slice(0, -1).join(".")) : null;
  };
  await db.insert(incidentTypes).values(
    [...roots, ...codes].map((code) => ({
      id: id(code),
      incidentCode: code,
      name: `TIPO ${code}`,
      parentId: parent(code)
    }))
  );
}

function station(id: number, name: string, stationKey: string) {
  return { id, name, stationKey, latitude: "9.9", longitude: "-84.1", isOperative: true };
}

function vehicle(id: number, internalNumber: string, stationId: number) {
  return {
    id,
    internalNumber,
    plate: `BCB-${id}`,
    stationId,
    descriptionType: "UNIDAD EXTINTORA",
    class: "EXTINCION",
    descriptionOperationalStatus: "OPERATIVO"
  };
}

// --- Fake SIGAE -------------------------------------------------------------------------

/** What a fake endpoint answers: a body, a request failure or an HTTP status. */
export type FakeAnswer =
  | { body: unknown }
  | { error: { kind: string; message?: string } }
  | { status: number };

export interface FakeCall {
  endpoint: SigaeEndpoint;
  /** The request parameters, without credentials. */
  params: Record<string, unknown>;
}

export type FakeHandler = (call: FakeCall) => FakeAnswer | Promise<FakeAnswer>;

export const FAKE_SIGAE_URL = "https://sigae.example.test/ws/api/Servicio/";
export const FAKE_CREDENTIALS = {
  user: "integration-user",
  password: "fake-password",
  systemCode: "INTEGRATION-SYS",
  ip: "192.0.2.10"
};
const CREDENTIAL_KEYS = new Set(["IP", "Password", "Usuario", "codSistema"]);

/** The real SIGAE client over a fake `fetch`. `timeout` errors hang until the client gives up. */
export function fakeSigae(
  handler: FakeHandler,
  options: { timeoutMs?: number; delayMs?: number } = {}
) {
  const calls: FakeCall[] = [];
  const client = createSigaeClient({
    baseUrl: FAKE_SIGAE_URL,
    credentials: FAKE_CREDENTIALS,
    timeoutMs: options.timeoutMs ?? 200,
    // Enough for two concurrent polls, so tests can overlap them.
    maxConcurrency: 16,
    fetch: async (url, init) => {
      const endpoint = url.split("/").at(-1) as SigaeEndpoint;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const params = Object.fromEntries(
        Object.entries(body).filter(([key]) => !CREDENTIAL_KEYS.has(key))
      );
      const call = { endpoint, params };
      calls.push(call);
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      const answer = await handler(call);
      if ("status" in answer) return new Response("upstream error", { status: answer.status });
      if ("error" in answer) {
        if (answer.error.kind === "timeout") return hangUntilAborted(init.signal);
        throw new TypeError(answer.error.message ?? "fetch failed");
      }
      return new Response(JSON.stringify(answer.body), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });
  return { client, calls };
}

function hangUntilAborted(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

export const OK = { Codigo: "00", Descripcion: "Proceso realizado satisfactoriamente" };
export const NOT_FOUND = { Codigo: "03", Descripcion: "No se encontraron registros." };

const SIGAE_FIXTURES = fileURLToPath(new URL("../../../sigae/test/fixtures/", import.meta.url));

/** A synthetic body from the SIGAE client's fixtures, with overrides. */
export function sigaeFixtureBody(
  endpoint: SigaeEndpoint,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const fixture = JSON.parse(readFileSync(`${SIGAE_FIXTURES}${endpoint}/ok.json`, "utf8")) as {
    body: Record<string, unknown>;
  };
  return { ...fixture.body, ...overrides };
}

export type IncidentAnswers = Record<SigaeIncidentEndpoint, FakeAnswer>;

/**
 * A SIGAE whose incident endpoints answer from a mutable poll (`sigae.answers = …`), and
 * whose reference endpoints answer from `references` (missing ones answer `03`).
 */
export function scriptedSigae(
  options: {
    references?: Partial<Record<SigaeEndpoint, FakeHandler>>;
    timeoutMs?: number;
    delayMs?: number;
  } = {}
) {
  const state: { answers: Partial<IncidentAnswers> } = { answers: {} };
  const fake = fakeSigae((call) => {
    const incident = state.answers[call.endpoint as SigaeIncidentEndpoint];
    if (incident) return incident;
    const reference = options.references?.[call.endpoint];
    if (reference) return reference(call);
    return { body: { ...NOT_FOUND } };
  }, options);
  return {
    ...fake,
    get answers() {
      return state.answers;
    },
    set answers(value: Partial<IncidentAnswers>) {
      state.answers = value;
    }
  };
}

// --- Fixture replay --------------------------------------------------------------------

export interface ClockControl {
  now: () => Date;
  set(at: Date | string): void;
  advance(ms: number): void;
}

export function fakeClock(start: Date | string = "2026-10-11T02:30:00.000Z"): ClockControl {
  let current = new Date(start).getTime();
  return {
    now: () => new Date(current),
    set: (at) => {
      current = new Date(at).getTime();
    },
    advance: (ms) => {
      current += ms;
    }
  };
}

export interface PipelineHarness {
  deps: SyncIncidentDeps;
  sigae: ReturnType<typeof scriptedSigae>;
  clock: ClockControl;
}

export function pipelineHarness(
  db: Database,
  options: {
    references?: Partial<Record<SigaeEndpoint, FakeHandler>>;
    resolver?: Partial<ReferenceResolverOptions>;
    delayMs?: number;
  } = {}
): PipelineHarness {
  const clock = fakeClock();
  const sigae = scriptedSigae({ references: options.references, delayMs: options.delayMs });
  const references = createReferenceResolver({
    db,
    sigae: sigae.client,
    now: clock.now,
    ...options.resolver
  });
  return { deps: { db, sigae: sigae.client, references, now: clock.now }, sigae, clock };
}

/** A fixture poll's answers for the fake SIGAE. */
export function fixtureAnswers(snapshot: FixtureSnapshot): IncidentAnswers {
  return snapshot.responses as IncidentAnswers;
}

/**
 * Replays a fixture scenario through `syncIncident` against the database, poll by poll at
 * each file's `fetchedAt`, and returns the outcome in `expected.json`'s shape, with the final
 * state read back from the database.
 */
export async function replayScenario(
  db: Database,
  harness: PipelineHarness,
  scenario: string
): Promise<Serialized<FixtureOutcome>> {
  const outcome: FixtureOutcome = {
    polls: [],
    changes: [],
    anomalies: [],
    final: { state: null, syncState: undefined as never }
  };
  let incidentId = 0;
  for (const file of snapshotFiles(scenario)) {
    const snapshot = readSnapshot(scenario, file);
    incidentId = snapshot.incidentId;
    harness.clock.set(snapshot.fetchedAt);
    harness.sigae.answers = fixtureAnswers(snapshot);
    const result = await syncIncident(harness.deps, incidentId);
    if (result.error) throw result.error;
    outcome.polls.push({
      poll: file,
      kind: result.kind,
      phase: result.syncState.phase,
      nextPollAt: result.syncState.nextPollAt?.toISOString() ?? null,
      deleteIncident: result.deleted
    });
    outcome.changes.push(...result.changes.map((change) => ({ poll: file, ...change })));
    outcome.anomalies.push(...result.anomalies.map((anomaly) => ({ poll: file, ...anomaly })));
  }
  const syncState = await loadSyncState(db, incidentId);
  if (!syncState) throw new Error(`no sync state for ${incidentId}`);
  outcome.final = { state: await loadIncidentState(db, incidentId), syncState };
  return toPlainJson(outcome);
}

/** History rows for an incident, oldest first. */
export async function loadHistory(db: Database, incidentId: number) {
  const [snapshots, changes, anomalies] = await Promise.all([
    db
      .select()
      .from(sigaeSnapshots)
      .where(eq(sigaeSnapshots.incidentId, incidentId))
      .orderBy(asc(sigaeSnapshots.id)),
    db
      .select()
      .from(incidentChanges)
      .where(eq(incidentChanges.incidentId, incidentId))
      .orderBy(asc(incidentChanges.id)),
    db
      .select()
      .from(syncAnomalies)
      .where(eq(syncAnomalies.incidentId, incidentId))
      .orderBy(asc(syncAnomalies.id))
  ]);
  return { snapshots, changes, anomalies };
}
