import { asc, eq, inArray, sql } from "@bomberoscr/db/operators";
import { incidentTypes, incidents } from "@bomberoscr/db/schema";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  findKnownReferences,
  insertInferredIncidentTypes,
  upsertIncidentTypes
} from "../../src/persist/references";
import { syncIncident } from "../../src/pipeline/sync-incident";
import { INCIDENT_ID, detailsBody, listBody, reportBody, station, unit } from "../builders";
import {
  type IncidentAnswers,
  TEST_DATABASE_URL,
  type TestDatabase,
  openTestDatabase,
  pipelineHarness,
  resetDatabase,
  seedReferences,
  sigaeFixtureBody
} from "./harness";

import type { IncidentType } from "@bomberoscr/sigae/client";

const MINUTE = 60_000;

/** Codes and names as SIGAE sent them for an inter-institutional service, absent from its list. */
const SPECIAL_SERVICES = {
  codigo_tipo_incidente: "10",
  tipo_incidente: "SERVICIOS ESPECIALES",
  codigo_tipo_incidente_esp: "10.3",
  tipo_incidente_esp: "INTER-INSTITUCIONAL",
  codigo_tipo_incidente_despacho: "10",
  tipo_incidente_despacho: "SERVICIOS ESPECIALES",
  codigo_tipo_incidente_despacho_esp: "10.3.",
  tipo_incidente_despacho_esp: "INTER-INSTITUCIONAL"
};

function answers(details: Record<string, unknown>): IncidentAnswers {
  return {
    ObtenerDetalleEmergencias: { body: detailsBody(details) },
    ObtenerBoletaIncidente: { body: reportBody() },
    ObtenerEstacionesAtiendeIncidente: { body: listBody([station()]) },
    ObtenerUnidadesDespachadasIncidente: { body: listBody([unit()]) }
  };
}

const typeList = (items: IncidentType[]) => ({
  body: sigaeFixtureBody("ObtenerTiposIncidente", { items })
});

describe.skipIf(!TEST_DATABASE_URL)("incident types SIGAE's list lacks", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await openTestDatabase();
  });
  afterAll(async () => {
    await db?.$client.end();
  });
  beforeEach(async () => {
    await resetDatabase(db);
    await seedReferences(db);
  });

  async function types(codes: string[]) {
    return db
      .select()
      .from(incidentTypes)
      .where(inArray(incidentTypes.incidentCode, codes))
      .orderBy(asc(incidentTypes.incidentCode));
  }

  async function storedCodes() {
    const [incident] = await db
      .select({
        incidentCode: incidents.incidentCode,
        specificIncidentCode: incidents.specificIncidentCode,
        dispatchIncidentCode: incidents.dispatchIncidentCode,
        specificDispatchIncidentCode: incidents.specificDispatchIncidentCode
      })
      .from(incidents)
      .where(eq(incidents.id, INCIDENT_ID));
    return incident;
  }

  it("creates them from the incident's names after the type list refresh", async () => {
    const { deps, sigae, clock } = pipelineHarness(db, {
      references: {
        ObtenerTiposIncidente: () => ({ body: sigaeFixtureBody("ObtenerTiposIncidente") })
      }
    });
    sigae.answers = answers(SPECIAL_SERVICES);
    const typeCalls = () =>
      sigae.calls.filter((call) => call.endpoint === "ObtenerTiposIncidente").length;

    const first = await syncIncident(deps, INCIDENT_ID);

    expect(first.kind).toBe("ok");
    expect(typeCalls()).toBe(1);
    expect(await storedCodes()).toEqual({
      incidentCode: "10",
      specificIncidentCode: "10.3",
      dispatchIncidentCode: "10",
      specificDispatchIncidentCode: "10.3"
    });
    const [category, service] = await types(["10", "10.3"]);
    expect(category).toMatchObject({
      incidentCode: "10",
      name: "SERVICIOS ESPECIALES",
      parentId: null
    });
    expect(category?.id).toBeLessThan(0);
    expect(service).toMatchObject({
      incidentCode: "10.3",
      name: "INTER-INSTITUCIONAL",
      parentId: category?.id
    });
    expect(service?.id).toBeLessThan(0);
    expect(service?.id).not.toBe(category?.id);
    expect(
      first.anomalies
        .filter((anomaly) => anomaly.code === "UNKNOWN_INCIDENT_TYPE")
        .map((anomaly) => anomaly.details.resolution)
    ).toEqual(["created", "created", "created", "created"]);

    // The created types count as known: no refresh, no new anomaly, no new rows.
    clock.advance(20 * MINUTE);
    const second = await syncIncident(deps, INCIDENT_ID);
    expect(second.kind).toBe("ok");
    expect(typeCalls()).toBe(1);
    expect(second.anomalies).toEqual([]);
    expect(await types(["10", "10.3"])).toHaveLength(2);
  });

  it("uses the type list when the refresh brings the code", async () => {
    const { deps, sigae } = pipelineHarness(db, {
      references: {
        ObtenerTiposIncidente: () =>
          typeList([
            {
              codigo_tipo_incidente: "10",
              id_tipo_incidente: 10,
              tipo_incidente: "SERVICIOS ESPECIALES",
              items: [
                {
                  codigo_tipo_incidente: "10.3",
                  id_tipo_incidente: 103,
                  tipo_incidente: "INTER-INSTITUCIONAL",
                  items: []
                }
              ]
            }
          ])
      }
    });
    sigae.answers = answers(SPECIAL_SERVICES);

    const outcome = await syncIncident(deps, INCIDENT_ID);

    expect(outcome.anomalies).toEqual([]);
    expect((await types(["10", "10.3"])).map((row) => row.id)).toEqual([10, 103]);
    expect((await storedCodes())?.specificIncidentCode).toBe("10.3");
  });

  it("links a type to the nearest ancestor and falls back to it without a name", async () => {
    const { deps, sigae } = pipelineHarness(db);
    sigae.answers = answers({
      ...SPECIAL_SERVICES,
      codigo_tipo_incidente_esp: "10.3.1",
      tipo_incidente_esp: "COORDINACION",
      codigo_tipo_incidente_despacho_esp: "10.4.2",
      tipo_incidente_despacho_esp: ""
    });

    const outcome = await syncIncident(deps, INCIDENT_ID);

    expect(outcome.kind).toBe("ok");
    const rows = await types(["10", "10.3", "10.3.1", "10.4", "10.4.2"]);
    expect(rows.map((row) => row.incidentCode)).toEqual(["10", "10.3.1"]);
    expect(rows[1]?.parentId).toBe(rows[0]?.id);
    expect(await storedCodes()).toEqual({
      incidentCode: "10",
      specificIncidentCode: "10.3.1",
      dispatchIncidentCode: "10",
      specificDispatchIncidentCode: "10"
    });
  });

  it("ends with one row when two transactions create the same code at once", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstInserted: () => void = () => {};
    const inserted = new Promise<void>((resolve) => {
      firstInserted = resolve;
    });
    const first = db.transaction(async (tx) => {
      await insertInferredIncidentTypes(tx, [
        { code: "10", name: "SERVICIOS ESPECIALES" },
        { code: "10.3", name: "INTER-INSTITUCIONAL" }
      ]);
      firstInserted();
      await gate;
    });
    await inserted;
    const second = db.transaction(async (tx) => {
      await insertInferredIncidentTypes(tx, [
        { code: "10", name: "OTRO NOMBRE" },
        { code: "10.3", name: "OTRO NOMBRE" },
        { code: "11", name: "SERVICIOS DECLINADOS" }
      ]);
      const known = await findKnownReferences(tx, {
        stations: [],
        vehicles: [],
        incidentTypes: ["10.3", "11"],
        provinces: [],
        cantons: [],
        districts: []
      });
      return known;
    });
    // The second one waits for the first to commit.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await types(["10", "10.3", "11"])).toEqual([]);
    release();
    await first;
    const known = await second;

    const rows = await types(["10", "10.3", "11"]);
    expect(rows.map((row) => [row.incidentCode, row.name])).toEqual([
      ["10", "SERVICIOS ESPECIALES"],
      ["10.3", "INTER-INSTITUCIONAL"],
      ["11", "SERVICIOS DECLINADOS"]
    ]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
    expect(rows.every((row) => row.id < 0)).toBe(true);
    expect([...known.inferredIncidentTypes].sort()).toEqual(["10", "10.3", "11"]);
  });

  it("stores the same new code from two concurrent polls", async () => {
    const one = pipelineHarness(db, { delayMs: 20 });
    one.sigae.answers = answers(SPECIAL_SERVICES);
    const other = INCIDENT_ID + 1;
    const two = pipelineHarness(db, { delayMs: 20 });
    two.sigae.answers = {
      ...answers(SPECIAL_SERVICES),
      ObtenerEstacionesAtiendeIncidente: {
        body: listBody([station({ IdBoletaEstacionAtiende: 3400102 })])
      },
      ObtenerUnidadesDespachadasIncidente: {
        body: listBody([unit({ IdBoletaUnidadDespachada: 5200102 })])
      }
    };

    const outcomes = await Promise.all([
      syncIncident(one.deps, INCIDENT_ID),
      syncIncident(two.deps, other)
    ]);

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["ok", "ok"]);
    expect(await types(["10", "10.3"])).toHaveLength(2);
    const stored = await db
      .select({ id: incidents.id, code: incidents.specificIncidentCode })
      .from(incidents)
      .orderBy(asc(incidents.id));
    expect(stored).toEqual([
      { id: INCIDENT_ID, code: "10.3" },
      { id: other, code: "10.3" }
    ]);
  });

  it("adopts SIGAE's ID and name once its list has a created code", async () => {
    const { deps, sigae } = pipelineHarness(db);
    sigae.answers = answers({
      ...SPECIAL_SERVICES,
      codigo_tipo_incidente_esp: "10.3.1",
      tipo_incidente_esp: "COORDINACION",
      codigo_tipo_incidente_despacho_esp: "10.4",
      tipo_incidente_despacho_esp: "APOYO"
    });
    await syncIncident(deps, INCIDENT_ID);
    await db.transaction((tx) =>
      insertInferredIncidentTypes(tx, [{ code: "11", name: "SERVICIOS DECLINADOS" }])
    );
    const before = await types(["10", "10.3.1", "10.4", "11"]);
    expect(before.every((row) => row.id < 0)).toBe(true);
    const inferredChild = before.find((row) => row.incidentCode === "10.3.1");
    const inferredSibling = before.find((row) => row.incidentCode === "10.4");
    const inferredOther = before.find((row) => row.incidentCode === "11");

    await upsertIncidentTypes(db, [
      {
        codigo_tipo_incidente: "10",
        id_tipo_incidente: 1000,
        tipo_incidente: "SERVICIOS ESPECIALES (SIGAE)",
        items: [
          {
            codigo_tipo_incidente: "10.3",
            id_tipo_incidente: 1003,
            tipo_incidente: "INTER-INSTITUCIONAL",
            items: null
          }
        ]
      }
    ]);

    const after = await types(["10", "10.3", "10.3.1", "10.4", "11"]);
    expect(after.map((row) => [row.incidentCode, row.id, row.name, row.parentId])).toEqual([
      ["10", 1000, "SERVICIOS ESPECIALES (SIGAE)", null],
      ["10.3", 1003, "INTER-INSTITUCIONAL", 1000],
      ["10.3.1", inferredChild?.id, "COORDINACION", 1003],
      ["10.4", inferredSibling?.id, "APOYO", 1000],
      ["11", inferredOther?.id, "SERVICIOS DECLINADOS", null]
    ]);
    expect(await storedCodes()).toEqual({
      incidentCode: "10",
      specificIncidentCode: "10.3.1",
      dispatchIncidentCode: "10",
      specificDispatchIncidentCode: "10.4"
    });

    // Run again, the list changes nothing.
    await upsertIncidentTypes(db, [
      {
        codigo_tipo_incidente: "10",
        id_tipo_incidente: 1000,
        tipo_incidente: "SERVICIOS ESPECIALES (SIGAE)",
        items: [
          {
            codigo_tipo_incidente: "10.3",
            id_tipo_incidente: 1003,
            tipo_incidente: "INTER-INSTITUCIONAL",
            items: null
          }
        ]
      }
    ]);
    expect(await types(["10", "10.3", "10.3.1", "10.4", "11"])).toEqual(after);
    const known = await findKnownReferences(db, {
      stations: [],
      vehicles: [],
      incidentTypes: ["10.3.1"],
      provinces: [],
      cantons: [],
      districts: []
    });
    expect([...known.incidentTypes].sort()).toEqual(["10", "10.3", "10.3.1"]);
    expect([...known.inferredIncidentTypes]).toEqual(["10.3.1"]);
  });

  it("waits for a poll creating types before adopting them", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const poll = db.transaction(async (tx) => {
      await insertInferredIncidentTypes(tx, [
        { code: "10", name: "SERVICIOS ESPECIALES" },
        { code: "10.3", name: "INTER-INSTITUCIONAL" }
      ]);
      await gate;
    });
    // The poll holds the lock before the type sync starts.
    await vi.waitFor(async () => {
      const held = await db.execute<{ count: number }>(
        sql`select count(*)::int as count from pg_locks where locktype = 'advisory' and granted and classid = 5302027`
      );
      expect(Number(held.rows[0]?.count)).toBe(1);
    });
    const sync = upsertIncidentTypes(db, [
      {
        codigo_tipo_incidente: "10",
        id_tipo_incidente: 1000,
        tipo_incidente: "SERVICIOS ESPECIALES",
        items: []
      }
    ]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    release();
    await Promise.all([poll, sync]);

    const rows = await types(["10", "10.3"]);
    expect(rows.map((row) => [row.incidentCode, row.id, row.parentId])).toEqual([
      ["10", 1000, null],
      ["10.3", rows[1]?.id, 1000]
    ]);
    expect(rows[1]?.id).toBeLessThan(0);
  });
});
